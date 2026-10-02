import { createHash } from 'node:crypto';

import { USER_AGENT } from '@podcast/catalog';
import type { Category, DirectoryPodcast } from '@podcast/shared';

/** Search and charts (F-01, F-02). Podcast Index backs it; tests use a fake. */
export interface PodcastDirectory {
  search(query: string, limit: number): Promise<DirectoryPodcast[]>;
  trending(opts: { limit: number; categoryId?: number; language?: string }): Promise<DirectoryPodcast[]>;
  categories(): Promise<Category[]>;
}

/** The directory isn't configured, or the upstream service failed. */
export class DirectoryUnavailableError extends Error {}

const BASE_URL = 'https://api.podcastindex.org/api/1.0';
const TIMEOUT_MS = 10_000;
const MINUTE = 60_000;
const TTL_MS = { search: 10 * MINUTE, trending: 60 * MINUTE, categories: 24 * 60 * MINUTE };

/** The fields we read from Podcast Index feed objects (search/byterm and podcasts/trending). */
type PiFeed = {
  url?: string;
  title?: string;
  author?: string;
  ownerName?: string;
  description?: string;
  image?: string;
  artwork?: string;
  language?: string;
  categories?: Record<string, string> | null;
  dead?: number;
};

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function toDirectoryPodcast(feed: PiFeed): DirectoryPodcast | null {
  const feedUrl = httpUrl(feed.url);
  if (!feedUrl || !feed.title || feed.dead) return null;
  return {
    feedUrl,
    title: feed.title,
    author: feed.author || feed.ownerName || null,
    description: feed.description || null,
    artworkUrl: httpUrl(feed.artwork) ?? httpUrl(feed.image),
    categories: Object.values(feed.categories ?? {}),
    language: feed.language || null,
  };
}

export type PodcastIndexOptions = {
  apiKey: string;
  apiSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export class PodcastIndexDirectory implements PodcastDirectory {
  private fetch: typeof fetch;
  private now: () => number;
  // Promises are cached so concurrent identical requests share one upstream call.
  private cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

  constructor(private opts: PodcastIndexOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  search(query: string, limit: number) {
    const params = new URLSearchParams({ q: query, max: String(limit), clean: 'true' });
    return this.cached(`search:${params}`, TTL_MS.search, async () => {
      const body = await this.get<{ feeds?: PiFeed[] }>('/search/byterm', params);
      return (body.feeds ?? []).map(toDirectoryPodcast).filter((p) => p !== null);
    });
  }

  trending({ limit, categoryId, language }: { limit: number; categoryId?: number; language?: string }) {
    const params = new URLSearchParams({ max: String(limit) });
    if (categoryId != null) params.set('cat', String(categoryId));
    if (language) params.set('lang', language);
    return this.cached(`trending:${params}`, TTL_MS.trending, async () => {
      const body = await this.get<{ feeds?: PiFeed[] }>('/podcasts/trending', params);
      return (body.feeds ?? []).map(toDirectoryPodcast).filter((p) => p !== null);
    });
  }

  categories() {
    return this.cached('categories', TTL_MS.categories, async () => {
      const body = await this.get<{ feeds?: { id: number; name: string }[] }>(
        '/categories/list',
        new URLSearchParams(),
      );
      return (body.feeds ?? []).map(({ id, name }) => ({ id, name }));
    });
  }

  private cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { expiresAt: this.now() + ttlMs, value });
    // Don't keep failures around.
    value.catch(() => this.cache.get(key)?.value === value && this.cache.delete(key));
    return value;
  }

  private async get<T>(path: string, params: URLSearchParams): Promise<T> {
    // Podcast Index auth: SHA-1 of key + secret + the unix time sent in X-Auth-Date.
    const date = String(Math.floor(this.now() / 1000));
    const auth = createHash('sha1')
      .update(this.opts.apiKey + this.opts.apiSecret + date)
      .digest('hex');
    const query = params.size ? `?${params}` : '';
    let res: Response;
    try {
      res = await this.fetch(`${BASE_URL}${path}${query}`, {
        headers: {
          'User-Agent': USER_AGENT,
          'X-Auth-Key': this.opts.apiKey,
          'X-Auth-Date': date,
          Authorization: auth,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new DirectoryUnavailableError(`Podcast Index request failed: ${(err as Error).message}`);
    }
    if (!res.ok) throw new DirectoryUnavailableError(`Podcast Index answered ${res.status} for ${path}`);
    return (await res.json()) as T;
  }
}
