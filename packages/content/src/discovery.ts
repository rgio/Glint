import type { CatalogQueries } from './catalog-queries';
import { dot, normalize } from './embedder';
import type { StoredRecommendation, UserDataStore } from './user-data';
import type { OwnerKind, VectorIndex } from './vector-index';

// Discovery v0: retrieval and a few rules, no trained model. A listener's highlights and notes
// form a handful of interests; each interest finds its nearest episodes and moments.

export type ProfileItem = {
  highlightId: string;
  episodeId: string;
  vec: Float32Array;
  createdAt: number;
  /** What to show in "Because you highlighted …". */
  text: string;
};

export type Interest = {
  centroid: Float32Array;
  members: ProfileItem[];
  /** Share of the listener's (recency-weighted) highlights in this interest. */
  weight: number;
};

const DAY_MS = 86_400_000;

/**
 * Groups highlight vectors into up to `maxK` interests with weighted k-means (cosine). One
 * average would blur distinct interests, say trade policy and running, into a vector that matches
 * neither. Recent highlights count more (half-life `halfLifeDays`). Deterministic: farthest-first
 * seeding from the heaviest item.
 */
export function buildInterests(items: ProfileItem[], opts: { now: number; halfLifeDays?: number; maxK?: number; iterations?: number }): Interest[] {
  if (!items.length) return [];
  const halfLife = (opts.halfLifeDays ?? 60) * DAY_MS;
  const weights = items.map((i) => 0.5 ** (Math.max(0, opts.now - i.createdAt) / halfLife));
  const k = Math.min(opts.maxK ?? 5, Math.ceil(items.length / 3));

  const centroids: Float32Array[] = [items[weights.indexOf(Math.max(...weights))]!.vec];
  while (centroids.length < k) {
    let far = -1;
    let farSim = Infinity;
    items.forEach((it, i) => {
      const sim = Math.max(...centroids.map((c) => dot(c, it.vec)));
      if (sim < farSim) {
        farSim = sim;
        far = i;
      }
    });
    if (far === -1 || farSim > 0.999) break; // everything left is a duplicate
    centroids.push(items[far]!.vec);
  }

  let assignment: number[] = [];
  for (let iter = 0; iter < (opts.iterations ?? 20); iter++) {
    const next = items.map((it) => {
      let best = 0;
      centroids.forEach((c, ci) => {
        if (dot(c, it.vec) > dot(centroids[best]!, it.vec)) best = ci;
      });
      return best;
    });
    const changed = next.some((a, i) => a !== assignment[i]);
    assignment = next;
    centroids.forEach((_, ci) => {
      const sum = new Float32Array(items[0]!.vec.length);
      items.forEach((it, i) => {
        if (assignment[i] !== ci) return;
        for (let d = 0; d < sum.length; d++) sum[d]! += weights[i]! * it.vec[d]!;
      });
      if (sum.some((x) => x !== 0)) centroids[ci] = normalize(sum);
    });
    if (!changed) break;
  }

  const total = weights.reduce((a, b) => a + b, 0);
  return centroids
    .map((centroid, ci) => {
      const members = items.filter((_, i) => assignment[i] === ci);
      const weight = items.reduce((s, _, i) => s + (assignment[i] === ci ? weights[i]! : 0), 0) / total;
      return { centroid, members, weight };
    })
    .filter((i) => i.members.length > 0)
    .sort((a, b) => b.weight - a.weight);
}

/** The member that best represents an interest, for the explanation. */
const representative = (interest: Interest) =>
  interest.members.reduce((best, m) => (dot(m.vec, interest.centroid) > dot(best.vec, interest.centroid) ? m : best));

export type RecommendDeps = {
  index: VectorIndex;
  catalog: CatalogQueries;
  userData: UserDataStore;
  model: string;
};

export type RecommendOptions = {
  now: number;
  limit?: number;
  /** Most episodes from one show. */
  perShow?: number;
  candidatesPerInterest?: number;
  /** Episodes never to return (on top of what the listener has touched). */
  exclude?: Set<string>;
  /** Skip excluding touched episodes (the offline evaluation hides an episode instead). */
  includeTouched?: boolean;
};

/** What gets matched: whole-episode descriptions and transcript chunks (windows, chapters, takeaways). */
const CANDIDATE_KINDS: OwnerKind[] = ['episode', 'chunk'];

/** Ranking bonuses, hand-tuned: small next to similarity, which does most of the work. */
const RECENCY_BONUS = 0.05;
const NEW_SHOW_BONUS = 0.03;

/** The listener's main language, from the shows they've highlighted. */
async function dominantLanguage(catalog: CatalogQueries, episodeIds: string[]): Promise<string | null> {
  const counts = new Map<string, number>();
  for (const { podcast } of await catalog.episodes([...new Set(episodeIds)])) {
    const lang = podcast.language?.toLowerCase().split('-')[0];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function recommend(deps: RecommendDeps, userId: string, interests: Interest[], opts: RecommendOptions): Promise<StoredRecommendation[]> {
  if (!interests.length) return [];
  const touched = opts.includeTouched ? new Set<string>() : await deps.userData.touchedEpisodes(userId);
  const exclude = [...touched, ...(opts.exclude ?? [])];
  const subscribed = await deps.userData.subscribedPodcasts(userId);
  const language = await dominantLanguage(deps.catalog, interests.flatMap((i) => i.members.map((m) => m.episodeId)));

  const best = new Map<string, { score: number; startMs: number | null; interest: Interest }>();
  for (const interest of interests) {
    const hits = await deps.index.search(interest.centroid, {
      k: opts.candidatesPerInterest ?? 50,
      filter: { model: deps.model, ownerKinds: CANDIDATE_KINDS, excludeEpisodeIds: exclude, language },
    });
    for (const hit of hits) {
      if (!hit.episodeId) continue;
      const prev = best.get(hit.episodeId);
      if (!prev || hit.score > prev.score) {
        best.set(hit.episodeId, { score: hit.score, startMs: hit.ownerKind === 'chunk' ? hit.startMs : (prev?.startMs ?? null), interest });
      }
    }
  }

  const found = await deps.catalog.episodes([...best.keys()]);
  const ranked = found
    .map(({ episode, podcast }) => {
      const b = best.get(episode.id)!;
      const ageDays = episode.publishedAt ? (opts.now - Date.parse(episode.publishedAt)) / DAY_MS : Infinity;
      const recency = ageDays <= 30 ? 1 : ageDays >= 365 ? 0 : 1 - (ageDays - 30) / 335;
      const score = b.score + RECENCY_BONUS * recency + (subscribed.has(podcast.id) ? 0 : NEW_SHOW_BONUS);
      return { episode, podcast, score, b };
    })
    .sort((a, b) => b.score - a.score || (a.episode.id < b.episode.id ? -1 : 1));

  const perShow = new Map<string, number>();
  const out: StoredRecommendation[] = [];
  const titles = new Map((await deps.catalog.episodes(interests.flatMap((i) => i.members.map((m) => m.episodeId)))).map((e) => [e.episode.id, e.episode.title]));
  for (const r of ranked) {
    if (out.length >= (opts.limit ?? 20)) break;
    const n = perShow.get(r.podcast.id) ?? 0;
    if (n >= (opts.perShow ?? 2)) continue;
    perShow.set(r.podcast.id, n + 1);
    const rep = representative(r.b.interest);
    out.push({
      episodeId: r.episode.id,
      score: Math.round(r.score * 1000) / 1000,
      startSec: r.b.startMs === null ? null : Math.floor(r.b.startMs / 1000),
      because: { highlightId: rep.highlightId, text: rep.text.slice(0, 200), episodeTitle: titles.get(rep.episodeId) ?? null },
    });
  }
  return out;
}

/**
 * The listener's highlight vectors (each embeds the excerpt and the note together), joined to their
 * highlights, for building interests. Owner kind `note` is kept for standalone notes, if those come.
 */
export async function profileItems(deps: Pick<RecommendDeps, 'index' | 'userData' | 'model'>, userId: string): Promise<ProfileItem[]> {
  const highlights = new Map((await deps.userData.userHighlights(userId)).map((h) => [h.id, h]));
  const vectors = await deps.index.listForUser(userId, ['highlight'], deps.model);
  return vectors.flatMap((v) => {
    const h = highlights.get(v.ownerId);
    if (!h) return [];
    return [{ highlightId: h.id, episodeId: h.episodeId, vec: v.vec, createdAt: h.createdAt, text: h.note ?? h.transcriptExcerpt ?? '' }];
  });
}

export type EvalResult = { users: number; hits: number; hitRate: number; perUser: { userId: string; hit: boolean; rank: number | null }[] };

/**
 * Offline hold-out: for each listener with highlights in `minEpisodes`+ episodes, hide the episode
 * of their newest highlight, build interests from the rest, and check whether the hidden episode
 * comes back in the top `k`. Compares chunk sizes, models and partial-vs-full windows without
 * shipping anything.
 */
export async function holdoutEval(deps: RecommendDeps, opts: { now: number; k?: number; minEpisodes?: number }): Promise<EvalResult> {
  const perUser: EvalResult['perUser'] = [];
  for (const userId of await deps.userData.usersWithHighlightedEpisodes(opts.minEpisodes ?? 3)) {
    const items = await profileItems(deps, userId);
    const newest = [...items].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!newest) continue;
    const hidden = newest.episodeId;
    const train = items.filter((i) => i.episodeId !== hidden);
    if (!train.length) continue;
    const trainEpisodes = new Set(train.map((i) => i.episodeId));
    const recs = await recommend(deps, userId, buildInterests(train, { now: opts.now }), {
      now: opts.now,
      limit: opts.k ?? 20,
      perShow: opts.k ?? 20,
      includeTouched: true,
      exclude: trainEpisodes,
    });
    const rank = recs.findIndex((r) => r.episodeId === hidden);
    perUser.push({ userId, hit: rank !== -1, rank: rank === -1 ? null : rank + 1 });
  }
  const hits = perUser.filter((u) => u.hit).length;
  return { users: perUser.length, hits, hitRate: perUser.length ? hits / perUser.length : 0, perUser };
}
