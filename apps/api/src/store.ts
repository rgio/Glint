import type { Episode, Podcast } from '@podcast/shared';

export type FeedCacheInfo = { etag: string | null; lastModified: string | null };

/**
 * Catalog storage. The in-memory version backs tests and local development;
 * the PostgreSQL implementation will satisfy the same interface.
 */
export interface CatalogStore {
  findPodcastById(id: string): Promise<Podcast | null>;
  findPodcastByFeedUrl(feedUrl: string): Promise<Podcast | null>;
  upsertPodcast(podcast: Podcast, cache: FeedCacheInfo): Promise<void>;
  getFeedCache(podcastId: string): Promise<FeedCacheInfo | null>;
  /** Inserts new episodes and updates changed ones, matched by id. */
  upsertEpisodes(episodes: Episode[]): Promise<void>;
  listEpisodes(
    podcastId: string,
    opts: { offset: number; limit: number; sort: 'newest' | 'oldest' },
  ): Promise<Episode[]>;
}

export class InMemoryCatalogStore implements CatalogStore {
  private podcasts = new Map<string, Podcast>();
  private cache = new Map<string, FeedCacheInfo>();
  private episodes = new Map<string, Episode>();

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
      .sort((a, b) => dir * (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
      .slice(offset, offset + limit);
  }
}
