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

export class Catalog {
  constructor(
    private store: CatalogStore,
    private fetchFeed: FetchFeed,
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

  /** Fetches a feed (conditionally, when we have cache headers) and stores the result. */
  async ingest(feedUrl: string): Promise<Podcast> {
    const id = podcastIdFor(feedUrl);
    const cache = await this.store.getFeedCache(id);
    const result = await this.fetchFeed(feedUrl, cache);
    if (result.notModified) {
      const podcast = await this.store.findPodcastById(id);
      if (podcast) return podcast;
      return this.ingestUncached(feedUrl, id);
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
    await this.store.upsertPodcast(podcast, { etag, lastModified });
    await this.store.upsertEpisodes(toEpisodes(id, feed));
    return podcast;
  }
}
