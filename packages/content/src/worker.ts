import type { TranscriptChapter } from '@podcast/shared';

import { contextFor } from './align';
import { episodeText, type CatalogQueries } from './catalog-queries';
import { CHUNKER_VERSION, chunkTranscript } from './chunk';
import { buildInterests, profileItems, recommend } from './discovery';
import { DlogosError, dlogosToTranscript, type DlogosClient } from './dlogos';
import { EmbedderError, inputHash, type Embedder } from './embedder';
import type { Job, JobKind, JobQueue } from './jobs';
import { parsePublisherTranscript, sourceForType, TranscriptFormatError } from './publisher';
import type { DlogosPurpose, TranscriptRow, TranscriptStore } from './transcripts';
import type { UserDataStore } from './user-data';
import type { VectorIndex, VectorRow } from './vector-index';

export type Logger = {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};

export type ContentDeps = {
  jobs: JobQueue;
  transcripts: TranscriptStore;
  userData: UserDataStore;
  catalog: CatalogQueries;
  index: VectorIndex;
  /** Null when DLOGOS_API_KEY isn't set: publisher transcripts only. */
  dlogos: DlogosClient | null;
  /** Null when embeddings are off: no vectors, no recommendations. */
  embedder: Embedder | null;
  /** Fetches a transcript or chapters file (fetchPublicText from @podcast/catalog in production). */
  fetchText: (url: string, opts?: { accept?: string; maxBytes?: number }) => Promise<string>;
  now: () => number;
  /** dLogos requests per day for discovery corpus seeding. 0 turns seeding off. */
  seedDailyBudget: number;
  /**
   * dLogos requests per day triggered by highlights and transcript views, so a burst (or one
   * account highlighting across the catalog) can't spend the whole quota. Over it, requests wait
   * for the next day.
   */
  requestDailyBudget: number;
  /** Nightly index accuracy check (pgvector only). */
  recallCheck?: (model: string) => Promise<object>;
  log: Logger;
};

/** What a handler wants done with its job. */
export type Outcome =
  | { type: 'done' }
  | { type: 'later'; runAt: Date; payload?: Record<string, unknown> }
  | { type: 'failed'; error: string };

const done: Outcome = { type: 'done' };
const later = (deps: ContentDeps, ms: number, payload?: Record<string, unknown>): Outcome => ({
  type: 'later',
  runAt: new Date(deps.now() + ms),
  ...(payload && { payload }),
});

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Gaps between dLogos polls, then every 10 minutes until `POLL_GIVE_UP_MS` after the request. */
const POLL_DELAYS = [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE];
const POLL_GIVE_UP_MS = 2 * HOUR;
/** An episode no source could transcribe is tried again after this long: coverage grows. */
const UNAVAILABLE_RETRY_MS = 7 * DAY;
/** Wait after a highlight edit before embedding it, so typing a note doesn't embed every word. */
export const HIGHLIGHT_EMBED_DELAY_MS = 30 * SECOND;
/** Wait after a highlight vector changes before rebuilding the listener's interests. */
const PROFILE_DEBOUNCE_MS = 5 * MINUTE;
/** Episode descriptions embedded per sweep job. */
const SWEEP_BATCH = 200;
/** Thrown or retryable failures are retried with backoff this many times, then given up. */
export const MAX_ATTEMPTS = 6;

const today = (deps: ContentDeps) => new Date(deps.now()).toISOString().slice(0, 10);

// --- transcripts --------------------------------------------------------------------------

async function afterTranscriptReady(deps: ContentDeps, episodeId: string, transcript: TranscriptRow) {
  await deps.jobs.enqueue('chunk', transcript.id, { payload: { episodeId } });
  await deps.jobs.enqueue('highlight.context', `episode:${episodeId}`);
}

/**
 * dLogos first: submit and poll. A timed publisher transcript is fetched alongside, so excerpts
 * can show while dLogos works; readers switch to dLogos once it's ready.
 */
async function requestTranscript(job: Job, deps: ContentDeps): Promise<Outcome> {
  const episodeId = job.key;
  const purpose = (job.payload.purpose as DlogosPurpose | undefined) ?? 'highlight';
  const status = await deps.transcripts.status(episodeId);
  if (status.status === 'ready' && status.source === 'dlogos') return done;

  const found = await deps.catalog.episode(episodeId);
  if (!found) return { type: 'failed', error: `Unknown episode ${episodeId}` };
  const { episode, podcast } = found;

  if (episode.transcriptUrl && sourceForType(episode.transcriptType, episode.transcriptUrl)) {
    await deps.jobs.enqueue('transcript.publisher', episodeId);
  }

  const existing = await deps.transcripts.find(episodeId, 'dlogos');
  if (existing?.status === 'pending') return done; // a poll job owns it
  const slug = deps.dlogos && (await deps.transcripts.dlogosSlug(podcast.id));
  if (!deps.dlogos || !slug) {
    if (!episode.transcriptUrl) {
      await deps.transcripts.markFailed(episodeId, 'dlogos', 'unavailable', deps.dlogos ? 'No dLogos mapping for this show' : 'dLogos is not configured');
      // Try again in a week; mapping the show wakes this job sooner (JobQueue.runNow).
      if (purpose !== 'seed') return later(deps, UNAVAILABLE_RETRY_MS);
    }
    return done;
  }
  if (purpose === 'seed' && (await deps.transcripts.dlogosRequests(today(deps), 'seed')) >= deps.seedDailyBudget) return done;
  if (purpose !== 'seed' && (await deps.transcripts.dlogosRequests(today(deps), purpose)) >= deps.requestDailyBudget) {
    deps.log.warn({ episodeId, purpose, budget: deps.requestDailyBudget }, 'dLogos daily budget spent; trying tomorrow');
    const tomorrow = new Date(today(deps));
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { type: 'later', runAt: tomorrow };
  }

  try {
    const submitted = await deps.dlogos.submit(slug, { guid: episode.guid });
    await deps.transcripts.countDlogosRequest(today(deps), purpose);
    await deps.transcripts.markPending(episodeId, 'dlogos', { externalId: submitted.episodeId, pollUrl: submitted.pollUrl });
    await deps.jobs.enqueue('transcript.poll', episodeId, { runAt: new Date(deps.now() + POLL_DELAYS[0]!), payload: { polls: 0 } });
    deps.log.info({ episodeId, slug, purpose }, 'requested dLogos transcript');
    return done;
  } catch (err) {
    if (err instanceof DlogosError && !err.retryable) {
      await deps.transcripts.markFailed(episodeId, 'dlogos', 'unavailable', err.message);
      return purpose === 'seed' ? done : later(deps, UNAVAILABLE_RETRY_MS);
    }
    throw err;
  }
}

async function pollTranscript(job: Job, deps: ContentDeps): Promise<Outcome> {
  const episodeId = job.key;
  const row = await deps.transcripts.find(episodeId, 'dlogos');
  if (!deps.dlogos || !row?.pollUrl || row.status !== 'pending') return done;

  const result = await deps.dlogos.poll(row.pollUrl);
  if (result.state === 'ready') {
    const found = await deps.catalog.episode(episodeId);
    const t = dlogosToTranscript(result.data);
    const saved = await deps.transcripts.saveReady(
      episodeId,
      'dlogos',
      { language: found?.podcast.language ?? null, reportedDurationSec: t.reportedDurationSec, audioUrl: t.audioUrl, externalId: t.externalId },
      t.content,
    );
    deps.log.info({ episodeId, segments: t.content.segments.length, audioSec: saved.audioDurationSec, reportedSec: t.reportedDurationSec }, 'dLogos transcript ready');
    await afterTranscriptReady(deps, episodeId, saved);
    return done;
  }
  if (result.state === 'failed') {
    await deps.transcripts.markFailed(episodeId, 'dlogos', 'unavailable', `dLogos status ${result.status}`);
    return done;
  }
  if (deps.now() - row.requestedAt.getTime() > POLL_GIVE_UP_MS) {
    await deps.transcripts.markFailed(episodeId, 'dlogos', 'failed', `Still ${result.status} after ${POLL_GIVE_UP_MS / HOUR} h`);
    await deps.jobs.enqueue('transcript.request', episodeId, { runAt: new Date(deps.now() + DAY) });
    return done;
  }
  const polls = Number(job.payload.polls ?? 0) + 1;
  return later(deps, POLL_DELAYS[Math.min(polls, POLL_DELAYS.length - 1)]!, { polls });
}

/** Podcasting 2.0 chapters JSON: `{ chapters: [{ startTime, title }] }`. */
function parseChapters(text: string): TranscriptChapter[] {
  const doc = JSON.parse(text) as { chapters?: { startTime?: unknown; title?: unknown; toc?: unknown }[] };
  return (doc.chapters ?? [])
    .filter((c) => typeof c.title === 'string' && Number.isFinite(Number(c.startTime)) && c.toc !== false)
    .map((c) => ({ startMs: Math.round(Number(c.startTime) * 1000), title: String(c.title) }));
}

async function fetchPublisherTranscript(job: Job, deps: ContentDeps): Promise<Outcome> {
  const found = await deps.catalog.episode(job.key);
  if (!found?.episode.transcriptUrl) return done;
  const { episode, podcast } = found;
  const source = sourceForType(episode.transcriptType, episode.transcriptUrl!);
  if (!source) return done;
  if ((await deps.transcripts.find(episode.id, source))?.status === 'ready') return done;

  try {
    const segments = parsePublisherTranscript(source, await deps.fetchText(episode.transcriptUrl!, { maxBytes: 10 * 1024 * 1024 }));
    let chapters: TranscriptChapter[] = [];
    if (episode.chaptersUrl) {
      try {
        chapters = parseChapters(await deps.fetchText(episode.chaptersUrl, { accept: 'application/json', maxBytes: 1024 * 1024 }));
      } catch (err) {
        deps.log.warn({ err, episodeId: episode.id }, 'chapters unreadable; saving the transcript without them');
      }
    }
    const saved = await deps.transcripts.saveReady(episode.id, source, { language: podcast.language }, { segments, chapters, takeaways: [] });
    await afterTranscriptReady(deps, episode.id, saved);
    return done;
  } catch (err) {
    if (err instanceof TranscriptFormatError || err instanceof SyntaxError) {
      await deps.transcripts.markFailed(episode.id, source, 'unavailable', (err as Error).message);
      return done;
    }
    throw err;
  }
}

/** Spends the day's seeding budget on the shows people want most. */
async function seedTranscripts(_job: Job, deps: ContentDeps): Promise<Outcome> {
  if (!deps.dlogos || deps.seedDailyBudget <= 0) return done;
  const remaining = deps.seedDailyBudget - (await deps.transcripts.dlogosRequests(today(deps), 'seed'));
  if (remaining <= 0) return done;
  for (const c of await deps.catalog.seedCandidates(remaining)) {
    await deps.jobs.enqueue('transcript.request', c.episodeId, { payload: { purpose: 'seed' } });
  }
  return done;
}

async function chunk(job: Job, deps: ContentDeps): Promise<Outcome> {
  const transcriptId = job.key;
  const [segments, chapters, takeaways] = await Promise.all([
    deps.transcripts.segments(transcriptId),
    deps.transcripts.chapters(transcriptId),
    deps.transcripts.takeaways(transcriptId),
  ]);
  await deps.transcripts.saveChunks(transcriptId, CHUNKER_VERSION, chunkTranscript({ segments, chapters, takeaways }));
  if (deps.embedder) await deps.jobs.enqueue('embed.transcript', transcriptId, { payload: job.payload });
  return done;
}

// --- highlights ---------------------------------------------------------------------------

/** Key `episode:<id>` recomputes every highlight on an episode; `<userId>:<highlightId>` one. */
async function highlightContext(job: Job, deps: ContentDeps): Promise<Outcome> {
  let targets: { userId: string; highlight: NonNullable<Awaited<ReturnType<UserDataStore['getHighlight']>>> }[];
  let episodeId: string;
  if (job.key.startsWith('episode:')) {
    episodeId = job.key.slice('episode:'.length);
    targets = await deps.userData.liveHighlightsForEpisode(episodeId);
  } else {
    const [userId, id] = job.key.split(':') as [string, string];
    const highlight = await deps.userData.getHighlight(userId, id);
    if (!highlight || highlight.deleted) return done;
    episodeId = highlight.episodeId;
    targets = [{ userId, highlight }];
  }
  if (!targets.length) return done;
  const transcript = await deps.transcripts.current(episodeId);
  if (!transcript) return done; // recomputed when one arrives

  const [segments, chapters] = await Promise.all([deps.transcripts.segments(transcript.id), deps.transcripts.chapters(transcript.id)]);
  let stale = false;
  for (const { userId, highlight: h } of targets) {
    const ctx = contextFor(h, { audioDurationSec: transcript.audioDurationSec, segments, chapters });
    const saved = await deps.userData.saveHighlightContext(userId, h.id, { ...ctx, transcriptId: transcript.id, forRangeUpdatedAt: h.rangeUpdatedAt });
    // The range changed while we worked: run again with the new one.
    if (!saved) stale = true;
    else if (deps.embedder) await deps.jobs.enqueue('embed.highlight', `${userId}:${h.id}`);
  }
  return stale ? later(deps, 0) : done;
}

/** What a highlight's vector is made from: the words, the listener's note, and where it was. */
export const highlightText = (h: { transcriptExcerpt: string | null; note: string | null; chapterTitle: string | null }) =>
  [h.transcriptExcerpt, h.note, h.chapterTitle && `Chapter: ${h.chapterTitle}`].filter(Boolean).join('\n');

async function embedHighlight(job: Job, deps: ContentDeps): Promise<Outcome> {
  if (!deps.embedder) return done;
  const [userId, id] = job.key.split(':') as [string, string];
  const h = await deps.userData.getHighlight(userId, id);
  const text = h && !h.deleted ? highlightText(h) : '';
  if (!h || !text) {
    await deps.index.delete([{ ownerKind: 'highlight', ownerId: id }]);
    await deps.jobs.enqueue('profile.rebuild', userId, { runAt: new Date(deps.now() + PROFILE_DEBOUNCE_MS) });
    return done;
  }
  const hash = inputHash(text);
  if ((await deps.index.get('highlight', id, deps.embedder.model))?.inputHash === hash) return done;
  const [vec] = await deps.embedder.embed([text]);
  await deps.index.upsert([
    {
      ownerKind: 'highlight',
      ownerId: id,
      userId,
      episodeId: h.episodeId,
      podcastId: h.podcastId,
      language: null,
      startMs: Math.round(h.startSec * 1000),
      model: deps.embedder.model,
      inputHash: hash,
      vec: vec!,
    },
  ]);
  await deps.jobs.enqueue('profile.rebuild', userId, { runAt: new Date(deps.now() + PROFILE_DEBOUNCE_MS) });
  // Edited while we embedded: do it again.
  const after = await deps.userData.getHighlight(userId, id);
  return after && inputHash(highlightText(after)) !== hash ? later(deps, 0) : done;
}

// --- vectors and discovery ----------------------------------------------------------------

/** Description vectors for every catalog episode: discovery's corpus from day one. */
async function embedSweep(_job: Job, deps: ContentDeps): Promise<Outcome> {
  if (!deps.embedder) return done;
  const batch = await deps.catalog.episodesMissingVector(deps.embedder.model, SWEEP_BATCH);
  if (!batch.length) return done;
  const texts = batch.map(episodeText);
  const vecs = await deps.embedder.embed(texts);
  await deps.index.upsert(
    batch.map(({ episode, podcast }, i): VectorRow => ({
      ownerKind: 'episode',
      ownerId: episode.id,
      userId: null,
      episodeId: episode.id,
      podcastId: podcast.id,
      language: podcast.language?.toLowerCase().split('-')[0] ?? null,
      startMs: null,
      model: deps.embedder!.model,
      inputHash: inputHash(texts[i]!),
      vec: vecs[i]!,
    })),
  );
  deps.log.info({ episodes: batch.length }, 'embedded episode descriptions');
  return batch.length === SWEEP_BATCH ? later(deps, 0) : done;
}

/**
 * A transcript's chunks. Takeaways and chapters always; windows only where they're likely useful
 * (someone highlighted the episode or subscribes to the show, or it was seeded for discovery).
 * Ad reads are never embedded.
 */
async function embedTranscript(job: Job, deps: ContentDeps): Promise<Outcome> {
  if (!deps.embedder) return done;
  const transcriptId = job.key;
  const episodeId = String(job.payload.episodeId ?? '');
  const found = await deps.catalog.episode(episodeId);
  if (!found) return done;
  const chunks = await deps.transcripts.chunks(transcriptId, CHUNKER_VERSION);
  const wantWindows = job.payload.purpose === 'seed' || (await deps.catalog.windowsWanted(episodeId));
  const selected = chunks.filter((c) => !c.isAd && (c.kind !== 'window' || wantWindows));

  const model = deps.embedder.model;
  const todo: typeof selected = [];
  for (const c of selected) if ((await deps.index.get('chunk', c.id, model))?.inputHash !== inputHash(c.text)) todo.push(c);
  if (todo.length) {
    const vecs = await deps.embedder.embed(todo.map((c) => c.text));
    await deps.index.upsert(
      todo.map((c, i): VectorRow => ({
        ownerKind: 'chunk',
        ownerId: c.id,
        userId: null,
        episodeId,
        podcastId: found.podcast.id,
        language: found.podcast.language?.toLowerCase().split('-')[0] ?? null,
        startMs: c.startMs,
        model,
        inputHash: inputHash(c.text),
        vec: vecs[i]!,
      })),
    );
  }
  // Chunks from an earlier version of this transcript (or another source) go.
  await deps.index.prune('chunk', episodeId, selected.map((c) => c.id));
  deps.log.info({ episodeId, embedded: todo.length, kept: selected.length, windows: wantWindows }, 'embedded transcript chunks');
  return done;
}

/** Rebuilds the listener's interests and recommendations. */
async function rebuildProfile(job: Job, deps: ContentDeps): Promise<Outcome> {
  if (!deps.embedder) return done;
  const userId = job.key;
  const model = deps.embedder.model;
  const items = await profileItems({ index: deps.index, userData: deps.userData, model }, userId);
  const interests = buildInterests(items, { now: deps.now() });

  const old = await deps.index.listForUser(userId, ['profile'], model);
  await deps.index.delete(old.map((r) => ({ ownerKind: 'profile' as const, ownerId: r.ownerId })));
  await deps.index.upsert(
    interests.map((interest, i) => ({
      ownerKind: 'profile' as const,
      ownerId: `${userId}:${i}`,
      userId,
      episodeId: null,
      podcastId: null,
      language: null,
      startMs: null,
      model,
      inputHash: interest.members.map((m) => m.highlightId).sort().join(','),
      vec: interest.centroid,
    })),
  );

  const recs = await recommend({ index: deps.index, catalog: deps.catalog, userData: deps.userData, model }, userId, interests, { now: deps.now() });
  await deps.userData.saveRecommendations(userId, recs);
  deps.log.info({ highlights: items.length, interests: interests.length, recommendations: recs.length }, 'rebuilt recommendations');
  return done;
}

async function recallCheck(_job: Job, deps: ContentDeps): Promise<Outcome> {
  if (!deps.embedder || !deps.recallCheck) return done;
  deps.log.info({ ...(await deps.recallCheck(deps.embedder.model)), model: deps.embedder.model }, 'vector index recall check');
  return done;
}

const HANDLERS: Record<JobKind, (job: Job, deps: ContentDeps) => Promise<Outcome>> = {
  'transcript.request': requestTranscript,
  'transcript.poll': pollTranscript,
  'transcript.publisher': fetchPublisherTranscript,
  'transcript.seed': seedTranscripts,
  chunk,
  'highlight.context': highlightContext,
  'embed.sweep': embedSweep,
  'embed.transcript': embedTranscript,
  'embed.highlight': embedHighlight,
  'profile.rebuild': rebuildProfile,
  'vector.recall_check': recallCheck,
};

const isRetryable = (err: unknown) =>
  err instanceof DlogosError || err instanceof EmbedderError ? err.retryable : true; // network blips, the database

/** Runs one claimed job and records the result. Errors retry with backoff, then fail the job. */
export async function runJob(job: Job, deps: ContentDeps): Promise<Outcome> {
  let outcome: Outcome;
  try {
    outcome = await HANDLERS[job.kind](job, deps);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (!isRetryable(err) || job.attempts + 1 >= MAX_ATTEMPTS) {
      deps.log.error({ err, kind: job.kind, key: job.key, attempts: job.attempts + 1 }, 'job failed');
      await deps.jobs.fail(job.id, message);
      return { type: 'failed', error: message };
    }
    const backoff = Math.min(HOUR, 30 * SECOND * 2 ** job.attempts);
    deps.log.warn({ err, kind: job.kind, key: job.key, attempts: job.attempts + 1 }, 'job errored; retrying');
    await deps.jobs.retry(job.id, { runAt: new Date(deps.now() + backoff), error: message });
    return { type: 'later', runAt: new Date(deps.now() + backoff) };
  }
  if (outcome.type === 'done') await deps.jobs.complete(job.id);
  else if (outcome.type === 'later') await deps.jobs.retry(job.id, { runAt: outcome.runAt, payload: outcome.payload });
  else await deps.jobs.fail(job.id, outcome.error);
  return outcome;
}

/** Claims and runs up to `limit` due jobs, `concurrency` at a time. Returns how many ran. */
export async function runDueJobs(deps: ContentDeps, opts: { limit?: number; concurrency?: number; leaseMs?: number } = {}): Promise<number> {
  const jobs = await deps.jobs.claim({ now: new Date(deps.now()), leaseMs: opts.leaseMs ?? 10 * MINUTE, limit: opts.limit ?? 20 });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency ?? 4, jobs.length) }, async () => {
      while (next < jobs.length) await runJob(jobs[next++]!, deps);
    }),
  );
  return jobs.length;
}

/**
 * What to enqueue when a listener's highlight changes (called by the API after sync):
 * its context and vector, and a transcript for its episode if there isn't one yet.
 */
export async function onHighlightChanged(jobs: JobQueue, userId: string, h: { id: string; episodeId: string; deleted: boolean }, now: number) {
  if (!h.deleted) {
    await jobs.enqueue('transcript.request', h.episodeId, { payload: { purpose: 'highlight' } });
    await jobs.enqueue('highlight.context', `${userId}:${h.id}`);
  }
  await jobs.enqueue('embed.highlight', `${userId}:${h.id}`, { runAt: new Date(now + HIGHLIGHT_EMBED_DELAY_MS) });
}
