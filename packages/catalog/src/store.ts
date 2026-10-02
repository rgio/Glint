import type { Episode, Podcast } from '@podcast/shared';

export type FeedCacheInfo = {
  /** Conditional-request headers from the last fetch. */
  etag: string | null;
  lastModified: string | null;
  /** ISO time of the last fetch, including "not modified" answers. */
  fetchedAt: string | null;
};

/** A feed the worker should poll now. */
export type DueFeed = { id: string; feedUrl: string; pollFailures: number };

/**
 * Catalog storage. `PostgresCatalogStore` is the real one; the in-memory version backs tests
 * and runs when no database is configured.
 */
export interface CatalogStore {
  findPodcastById(id: string): Promise<Podcast | null>;
  findPodcastByFeedUrl(feedUrl: string): Promise<Podcast | null>;
  upsertPodcast(podcast: Podcast, cache: FeedCacheInfo): Promise<void>;
  getFeedCache(podcastId: string): Promise<FeedCacheInfo | null>;
  findEpisodeById(id: string): Promise<Episode | null>;
  /** Inserts new episodes and updates changed ones, matched by id. */
  upsertEpisodes(episodes: Episode[]): Promise<void>;
  listEpisodes(
    podcastId: string,
    opts: { offset: number; limit: number; sort: 'newest' | 'oldest' },
  ): Promise<Episode[]>;
  /**
   * Claims up to `limit` feeds that were never polled or are past their next poll time,
   * choosing never-polled and most overdue first, and returns them in id order. Each is leased
   * until `leaseUntil`: other workers skip it meanwhile, and if this worker crashes it comes
   * back when the lease runs out. Times are ISO strings.
   */
  claimDueFeeds(opts: { now: string; leaseUntil: string; limit: number }): Promise<DueFeed[]>;
  /** Schedules the next poll and records how many polls in a row have failed. */
  recordPoll(podcastId: string, result: { nextPollAt: string; failures: number }): Promise<void>;
}

const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class InMemoryCatalogStore implements CatalogStore {
  private podcasts = new Map<string, Podcast>();
  private cache = new Map<string, FeedCacheInfo>();
  private episodes = new Map<string, Episode>();
  private schedule = new Map<string, { nextPollAt: string | null; failures: number }>();

  async findPodcastById(id: string) {
    return this.podcasts.get(id) ?? null;
  }

  async findPodcastByFeedUrl(feedUrl: string) {
    for (const p of this.podcasts.values()) if (p.feedUrl === feedUrl) return p;
    return null;
  }

  async upsertPodcast(podcast: Podcast, cache: FeedCacheInfo) {
    this.podcasts.set(podcast.id, podcast);
    this.cache.set(podcast.id, cache);
  }

  async getFeedCache(podcastId: string) {
    return this.cache.get(podcastId) ?? null;
  }

  async findEpisodeById(id: string) {
    return this.episodes.get(id) ?? null;
  }

  async upsertEpisodes(episodes: Episode[]) {
    for (const e of episodes) this.episodes.set(e.id, e);
  }

  async listEpisodes(
    podcastId: string,
    { offset, limit, sort }: { offset: number; limit: number; sort: 'newest' | 'oldest' },
  ) {
    const dir = sort === 'newest' ? -1 : 1;
    return [...this.episodes.values()]
      .filter((e) => e.podcastId === podcastId)
      // Same order as Postgres: undated last when newest-first, first when oldest-first; ties by id.
      .sort((a, b) => dir * (a.publishedAt ?? '').localeCompare(b.publishedAt ?? '') || byteOrder(a.id, b.id))
      .slice(offset, offset + limit);
  }

  async claimDueFeeds({ now, leaseUntil, limit }: { now: string; leaseUntil: string; limit: number }) {
    const due = [...this.podcasts.values()]
      .map((p) => ({ podcast: p, poll: this.schedule.get(p.id) ?? { nextPollAt: null, failures: 0 } }))
      .filter(({ poll }) => poll.nextPollAt === null || Date.parse(poll.nextPollAt) <= Date.parse(now))
      // Same order as Postgres: never polled first, then most overdue, ties by id.
      .sort(
        (a, b) =>
          (a.poll.nextPollAt === null ? -Infinity : Date.parse(a.poll.nextPollAt)) -
            (b.poll.nextPollAt === null ? -Infinity : Date.parse(b.poll.nextPollAt)) ||
          byteOrder(a.podcast.id, b.podcast.id),
      )
      .slice(0, limit);
    for (const { podcast, poll } of due) this.schedule.set(podcast.id, { ...poll, nextPollAt: leaseUntil });
    return due
      .map(({ podcast, poll }) => ({ id: podcast.id, feedUrl: podcast.feedUrl, pollFailures: poll.failures }))
      .sort((a, b) => byteOrder(a.id, b.id));
  }

  async recordPoll(podcastId: string, { nextPollAt, failures }: { nextPollAt: string; failures: number }) {
    if (this.podcasts.has(podcastId)) this.schedule.set(podcastId, { nextPollAt, failures });
  }
}
