import type { Highlight, TranscriptConfidence } from '@podcast/shared';
import type { Sql } from 'postgres';

// Per-user data the content worker reads and writes. Highlights are written by sync (the API's
// account store); the worker only adds what it derives: context, recommendations.

export type UserHighlight = { userId: string; highlight: Highlight };

export type SavedContext = {
  transcriptId: string | null;
  excerpt: string | null;
  chapterTitle: string | null;
  offsetSec: number;
  confidence: TranscriptConfidence;
  /** The range edit this was computed for; ignored if the range has changed since. */
  forRangeUpdatedAt: number;
};

export type StoredRecommendation = {
  episodeId: string;
  score: number;
  startSec: number | null;
  because: { highlightId: string; text: string; episodeTitle: string | null } | null;
};

export type RecEvent = 'shown' | 'opened' | 'played' | 'highlighted' | 'dismissed';

export interface UserDataStore {
  liveHighlightsForEpisode(episodeId: string): Promise<UserHighlight[]>;
  getHighlight(userId: string, id: string): Promise<Highlight | null>;
  /** Live highlights, with their context, newest first. */
  userHighlights(userId: string): Promise<Highlight[]>;
  /**
   * Saves derived context and bumps the highlight's sync version so devices pull it. Returns
   * false (and saves nothing) if the highlight's range changed since the context was computed.
   */
  saveHighlightContext(userId: string, highlightId: string, ctx: SavedContext): Promise<boolean>;
  /** Episodes the listener has played, started, queued or highlighted: not worth recommending. */
  touchedEpisodes(userId: string): Promise<Set<string>>;
  subscribedPodcasts(userId: string): Promise<Set<string>>;
  saveRecommendations(userId: string, items: StoredRecommendation[]): Promise<void>;
  recommendations(userId: string): Promise<{ items: StoredRecommendation[]; generatedAt: Date } | null>;
  recordRecEvent(userId: string, episodeId: string, event: RecEvent): Promise<void>;
  /** Listeners with highlights in at least `minEpisodes` episodes, for the offline evaluation. */
  usersWithHighlightedEpisodes(minEpisodes: number): Promise<string[]>;
}

type HighlightRow = {
  user_id: string;
  id: string;
  episode_id: string;
  podcast_id: string;
  start_sec: number;
  end_sec: number;
  note: string | null;
  source: Highlight['source'];
  anchor_duration_sec: number | null;
  anchor_enclosure_url: string | null;
  created_at: string;
  range_updated_at: string;
  note_updated_at: string;
  deleted: boolean;
  excerpt: string | null;
  chapter_title: string | null;
  confidence: TranscriptConfidence | null;
};

/**
 * Columns for a highlight plus its context. The context counts only while it was computed for the
 * current range (`for_range_updated_at`), so a range edit hides a stale excerpt.
 */
export const HIGHLIGHT_SELECT = `h.user_id, h.id, h.episode_id, h.podcast_id, h.start_sec, h.end_sec, h.note, h.source,
  h.anchor_duration_sec, h.anchor_enclosure_url, h.created_at, h.range_updated_at, h.note_updated_at, h.deleted,
  c.excerpt, c.chapter_title, c.confidence`;
export const HIGHLIGHT_FROM = `highlights h left join highlight_context c
  on c.user_id = h.user_id and c.highlight_id = h.id and c.for_range_updated_at = h.range_updated_at`;

export const rowToHighlight = (r: HighlightRow): Highlight => ({
  id: r.id,
  episodeId: r.episode_id,
  podcastId: r.podcast_id,
  startSec: r.start_sec,
  endSec: r.end_sec,
  note: r.note,
  transcriptExcerpt: r.excerpt ?? null,
  chapterTitle: r.chapter_title ?? null,
  transcriptConfidence: r.confidence ?? null,
  anchorDurationSec: r.anchor_duration_sec,
  anchorEnclosureUrl: r.anchor_enclosure_url,
  source: r.source,
  createdAt: Number(r.created_at),
  rangeUpdatedAt: Number(r.range_updated_at),
  noteUpdatedAt: Number(r.note_updated_at),
  deleted: r.deleted,
});

export type { HighlightRow };

export class PostgresUserDataStore implements UserDataStore {
  constructor(private sql: Sql) {}

  async liveHighlightsForEpisode(episodeId: string) {
    const rows = await this.sql<HighlightRow[]>`
      select ${this.sql.unsafe(HIGHLIGHT_SELECT)} from ${this.sql.unsafe(HIGHLIGHT_FROM)}
      where h.episode_id = ${episodeId} and not h.deleted`;
    return rows.map((r) => ({ userId: r.user_id, highlight: rowToHighlight(r) }));
  }

  async getHighlight(userId: string, id: string) {
    const [r] = await this.sql<HighlightRow[]>`
      select ${this.sql.unsafe(HIGHLIGHT_SELECT)} from ${this.sql.unsafe(HIGHLIGHT_FROM)}
      where h.user_id = ${userId} and h.id = ${id}`;
    return r ? rowToHighlight(r) : null;
  }

  async userHighlights(userId: string) {
    const rows = await this.sql<HighlightRow[]>`
      select ${this.sql.unsafe(HIGHLIGHT_SELECT)} from ${this.sql.unsafe(HIGHLIGHT_FROM)}
      where h.user_id = ${userId} and not h.deleted order by h.created_at desc`;
    return rows.map(rowToHighlight);
  }

  async saveHighlightContext(userId: string, highlightId: string, ctx: SavedContext) {
    return this.sql.begin(async (tx) => {
      // Lock the highlight so a sync push can't change the range between the check and the write.
      const [h] = await tx<{ range_updated_at: string }[]>`
        select range_updated_at from highlights where user_id = ${userId} and id = ${highlightId} for update`;
      if (!h || Number(h.range_updated_at) !== ctx.forRangeUpdatedAt) return false;
      await tx`
        insert into highlight_context (user_id, highlight_id, transcript_id, excerpt, chapter_title, offset_sec,
          confidence, for_range_updated_at)
        values (${userId}, ${highlightId}, ${ctx.transcriptId}, ${ctx.excerpt}, ${ctx.chapterTitle}, ${ctx.offsetSec},
          ${ctx.confidence}, ${ctx.forRangeUpdatedAt})
        on conflict (user_id, highlight_id) do update set transcript_id = excluded.transcript_id,
          excerpt = excluded.excerpt, chapter_title = excluded.chapter_title, offset_sec = excluded.offset_sec,
          confidence = excluded.confidence, for_range_updated_at = excluded.for_range_updated_at, computed_at = now()`;
      // A new version, so devices pull the highlight with its excerpt.
      await tx`update highlights set version = nextval('sync_version') where user_id = ${userId} and id = ${highlightId}`;
      return true;
    });
  }

  async touchedEpisodes(userId: string) {
    const rows = await this.sql<{ episode_id: string }[]>`
      select episode_id from user_episode_states where user_id = ${userId} and (played or position_sec > 0)
      union select episode_id from user_queue_items where user_id = ${userId} and not deleted
      union select episode_id from highlights where user_id = ${userId}`;
    return new Set(rows.map((r) => r.episode_id));
  }

  async subscribedPodcasts(userId: string) {
    const rows = await this.sql<{ podcast_id: string }[]>`
      select podcast_id from user_subscriptions where user_id = ${userId} and not deleted`;
    return new Set(rows.map((r) => r.podcast_id));
  }

  async saveRecommendations(userId: string, items: StoredRecommendation[]) {
    await this.sql`
      insert into user_recommendations (user_id, items) values (${userId}, ${this.sql.json(items as never)})
      on conflict (user_id) do update set items = excluded.items, generated_at = now()`;
  }

  async recommendations(userId: string) {
    const [r] = await this.sql<{ items: StoredRecommendation[]; generated_at: Date }[]>`
      select items, generated_at from user_recommendations where user_id = ${userId}`;
    return r ? { items: r.items, generatedAt: r.generated_at } : null;
  }

  async recordRecEvent(userId: string, episodeId: string, event: RecEvent) {
    await this.sql`insert into rec_events (user_id, episode_id, event) values (${userId}, ${episodeId}, ${event})`;
  }

  async usersWithHighlightedEpisodes(minEpisodes: number) {
    const rows = await this.sql<{ user_id: string }[]>`
      select user_id from highlights where not deleted
      group by user_id having count(distinct episode_id) >= ${minEpisodes}`;
    return rows.map((r) => r.user_id);
  }
}

/** For tests and the API without a database: highlights and listening state are set directly. */
export class InMemoryUserDataStore implements UserDataStore {
  highlights = new Map<string, UserHighlight>();
  contexts = new Map<string, SavedContext>();
  touched = new Map<string, Set<string>>();
  subscriptions = new Map<string, Set<string>>();
  recs = new Map<string, { items: StoredRecommendation[]; generatedAt: Date }>();
  events: { userId: string; episodeId: string; event: RecEvent }[] = [];
  /** Bumped when context is saved, standing in for the sync version. */
  versions = new Map<string, number>();

  addHighlight(userId: string, highlight: Highlight) {
    this.highlights.set(`${userId}\n${highlight.id}`, { userId, highlight });
  }

  private withContext({ userId, highlight }: UserHighlight): Highlight {
    const ctx = this.contexts.get(`${userId}\n${highlight.id}`);
    const current = ctx && ctx.forRangeUpdatedAt === highlight.rangeUpdatedAt ? ctx : null;
    return {
      ...highlight,
      transcriptExcerpt: current?.excerpt ?? null,
      chapterTitle: current?.chapterTitle ?? null,
      transcriptConfidence: current?.confidence ?? null,
    };
  }

  async liveHighlightsForEpisode(episodeId: string) {
    return [...this.highlights.values()]
      .filter((h) => h.highlight.episodeId === episodeId && !h.highlight.deleted)
      .map((h) => ({ userId: h.userId, highlight: this.withContext(h) }));
  }

  async getHighlight(userId: string, id: string) {
    const h = this.highlights.get(`${userId}\n${id}`);
    return h ? this.withContext(h) : null;
  }

  async userHighlights(userId: string) {
    return [...this.highlights.values()]
      .filter((h) => h.userId === userId && !h.highlight.deleted)
      .map((h) => this.withContext(h))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async saveHighlightContext(userId: string, highlightId: string, ctx: SavedContext) {
    const key = `${userId}\n${highlightId}`;
    const h = this.highlights.get(key);
    if (!h || h.highlight.rangeUpdatedAt !== ctx.forRangeUpdatedAt) return false;
    this.contexts.set(key, ctx);
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    return true;
  }

  async touchedEpisodes(userId: string) {
    const highlighted = [...this.highlights.values()].filter((h) => h.userId === userId).map((h) => h.highlight.episodeId);
    return new Set([...(this.touched.get(userId) ?? []), ...highlighted]);
  }

  async subscribedPodcasts(userId: string) {
    return new Set(this.subscriptions.get(userId) ?? []);
  }

  async saveRecommendations(userId: string, items: StoredRecommendation[]) {
    this.recs.set(userId, { items, generatedAt: new Date() });
  }

  async recommendations(userId: string) {
    return this.recs.get(userId) ?? null;
  }

  async recordRecEvent(userId: string, episodeId: string, event: RecEvent) {
    this.events.push({ userId, episodeId, event });
  }

  async usersWithHighlightedEpisodes(minEpisodes: number) {
    const byUser = new Map<string, Set<string>>();
    for (const { userId, highlight } of this.highlights.values()) {
      if (highlight.deleted) continue;
      byUser.set(userId, (byUser.get(userId) ?? new Set()).add(highlight.episodeId));
    }
    return [...byUser].filter(([, eps]) => eps.size >= minEpisodes).map(([u]) => u);
  }
}
