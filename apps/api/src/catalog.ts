import { createHash } from 'node:crypto';

import { parseFeed, type ParsedFeed } from '@podcast/feed-parser';
import type { Episode, Podcast } from '@podcast/shared';

import type { FetchFeed } from './fetch-feed';
import type { CatalogStore } from './store';

/** Stable ids, so the same feed or episode gets the same id on every server. */
function stableId(prefix: string, ...parts: string[]): string {
  const hash = createHash('sha256').update(parts.join('\n')).digest('base64url');
  return `${prefix}_${hash.slice(0, 22)}`;
}

export const podcastIdFor = (feedUrl: string) => stableId('pod', feedUrl);
export const episodeIdFor = (podcastId: string, guid: string) => stableId('ep', podcastId, guid);

function toPodcast(id: string, feedUrl: string, feed: ParsedFeed): Podcast {
  const latest = feed.episodes
    .map((e) => e.publishedAt)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  return {
    id,
    feedUrl,
    title: feed.title,
    author: feed.author,
    description: feed.description,
    artworkUrl: feed.artworkUrl,
    language: feed.language,
    categories: feed.categories,
    explicit: feed.explicit,
    lastPublishedAt: latest ?? null,
  };
}

function toEpisodes(podcastId: string, feed: ParsedFeed): Episode[] {
  return feed.episodes.map((e) => ({
    id: episodeIdFor(podcastId, e.guid),
    podcastId,
    guid: e.guid,
    title: e.title,
    publishedAt: e.publishedAt,
    durationSec: e.durationSec,
    enclosureUrl: e.enclosureUrl,
    enclosureType: e.enclosureType,
    enclosureBytes: e.enclosureBytes,
    showNotesHtml: e.showNotesHtml,
    artworkUrl: e.artworkUrl,
    season: e.season,
    episodeNumber: e.episodeNumber,
  }));
}

/** Normalizes user-typed feed URLs: trims, lowercases the host, upgrades the feed:// scheme. */
export function normalizeFeedUrl(input: string): string {
  const url = new URL(input.trim().replace(/^feed:\/\//i, 'https://'));
  url.hash = '';
  return url.toString();
}

/** How long a feed is trusted before a request for it triggers a background re-check. */
export const REFRESH_AFTER_MS = 60 * 60_000;
/** After a failed re-check, wait this long before trying that feed again. */
export const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

export class Catalog {
  private refreshing = new Map<string, Promise<void>>();
  private failedAt = new Map<string, number>();

  constructor(
    private store: CatalogStore,
    private fetchFeed: FetchFeed,
    private now: () => number = Date.now,
    private onRefreshError: (err: unknown, podcast: Podcast) => void = () => {},
  ) {}

  /**
   * F-03: add a podcast by RSS URL. Returns the existing podcast if we already
   * know the feed; otherwise fetches, parses and stores it.
   */
  async resolve(feedUrlInput: string): Promise<Podcast> {
    const feedUrl = normalizeFeedUrl(feedUrlInput);
    const existing = await this.store.findPodcastByFeedUrl(feedUrl);
    if (existing) return existing;
    return this.ingest(feedUrl);
  }

  /**
   * Re-fetches a known feed in the background if it hasn't been checked for an hour, so new
   * episodes show up. A stand-in until the feed worker polls feeds on its own schedule.
   */
  refreshIfStale(podcast: Podcast): Promise<void> {
    const running = this.refreshing.get(podcast.id);
    if (running) return running;
    if (this.now() - (this.failedAt.get(podcast.id) ?? -Infinity) < RETRY_AFTER_FAILURE_MS) {
      return Promise.resolve();
    }
    const run = (async () => {
      const cache = await this.store.getFeedCache(podcast.id);
      const fetchedAt = cache?.fetchedAt ? Date.parse(cache.fetchedAt) : 0;
      if (this.now() - fetchedAt >= REFRESH_AFTER_MS) await this.ingest(podcast.feedUrl);
      this.failedAt.delete(podcast.id);
    })()
      .catch((err) => {
        // Don't hammer a host that's down: every request would otherwise retry.
        this.failedAt.set(podcast.id, this.now());
        this.onRefreshError(err, podcast);
      })
      .finally(() => this.refreshing.delete(podcast.id));
    this.refreshing.set(podcast.id, run);
    return run;
  }

  /** Fetches a feed (conditionally, when we have cache headers) and stores the result. */
  async ingest(feedUrl: string): Promise<Podcast> {
    const id = podcastIdFor(feedUrl);
    const cache = await this.store.getFeedCache(id);
    const result = await this.fetchFeed(feedUrl, cache);
    if (result.notModified) {
      const podcast = await this.store.findPodcastById(id);
      if (!podcast || !cache) return this.ingestUncached(feedUrl, id);
      // Unchanged, but checked: don't re-check for another hour.
      await this.store.upsertPodcast(podcast, { ...cache, fetchedAt: new Date(this.now()).toISOString() });
      return podcast;
    }
    return this.save(feedUrl, id, result.xml, result.etag, result.lastModified);
  }

  private async ingestUncached(feedUrl: string, id: string): Promise<Podcast> {
    const result = await this.fetchFeed(feedUrl, null);
    if (result.notModified) throw new Error('Feed answered 304 to an unconditional request');
    return this.save(feedUrl, id, result.xml, result.etag, result.lastModified);
  }

  private async save(
    feedUrl: string,
    id: string,
    xml: string,
    etag: string | null,
    lastModified: string | null,
  ): Promise<Podcast> {
    const feed = parseFeed(xml);
    const podcast = toPodcast(id, feedUrl, feed);
    await this.store.upsertPodcast(podcast, { etag, lastModified, fetchedAt: new Date(this.now()).toISOString() });
    await this.store.upsertEpisodes(toEpisodes(id, feed));
    return podcast;
  }
}
