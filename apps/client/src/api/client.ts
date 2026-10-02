import type { Category, DirectoryPodcast, Episode, Podcast } from '@podcast/shared';
import { Platform } from 'react-native';

import { useLibrary } from '@/library/store';

// Android emulators reach the host machine at 10.0.2.2, not localhost.
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;

export type EpisodeSort = 'newest' | 'oldest';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0, 'network');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status, body.error ?? 'unknown');
  }
  return body as T;
}

// The server can forget a show the app still knows (its catalog is in memory today, and may
// drop shows later). Ids are derived from the feed URL, so re-adding the feed restores the same
// id. Feed URLs come from subscriptions, or from shows loaded since the app started.
const seenFeedUrls = new Map<string, string>();
const readding = new Map<string, Promise<unknown>>();

function remember<T extends { podcast: Podcast }>(result: T): T {
  seenFeedUrls.set(result.podcast.id, result.podcast.feedUrl);
  return result;
}

/** Runs `load`; if the server no longer knows the podcast, re-adds its feed once and retries. */
async function withReadd<T>(podcastId: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    const feedUrl = useLibrary.getState().subscriptions[podcastId]?.podcast.feedUrl ?? seenFeedUrls.get(podcastId);
    if (!(err instanceof ApiError && err.status === 404) || !feedUrl) throw err;
    // Parallel requests for the same show (details and episodes) share one re-add.
    let pending = readding.get(podcastId);
    if (!pending) {
      pending = api.resolvePodcast(feedUrl).finally(() => readding.delete(podcastId));
      readding.set(podcastId, pending);
    }
    await pending;
    return load();
  }
}

export const api = {
  resolvePodcast: (feedUrl: string) =>
    request<{ podcast: Podcast }>('/v1/podcasts/resolve', {
      method: 'POST',
      body: JSON.stringify({ feedUrl }),
    }).then(remember),

  getPodcast: (id: string) =>
    withReadd(id, () => request<{ podcast: Podcast }>(`/v1/podcasts/${encodeURIComponent(id)}`)).then(remember),

  listEpisodes: (id: string, cursor: string | null, limit = 50, sort: EpisodeSort = 'newest') =>
    withReadd(id, () =>
      request<{ episodes: Episode[]; nextCursor: string | null }>(
        `/v1/podcasts/${encodeURIComponent(id)}/episodes?limit=${limit}&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`,
      ),
    ),

  getEpisode: (id: string) =>
    request<{ episode: Episode; podcast: Podcast }>(`/v1/episodes/${encodeURIComponent(id)}`),

  search: (q: string, limit = 25) =>
    request<{ results: DirectoryPodcast[] }>(`/v1/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  /** `section` is `top` or `category:<id>`; `lang` is a language code such as `en`. */
  discover: (section: string, lang: string, limit = 25) =>
    request<{ section: string; results: DirectoryPodcast[] }>(
      `/v1/discover?section=${encodeURIComponent(section)}&lang=${encodeURIComponent(lang)}&limit=${limit}`,
    ),

  categories: () => request<{ categories: Category[] }>('/v1/discover/categories'),
};

/** Search and charts are optional: a server without a Podcast Index key answers this. */
export const isDirectoryNotConfigured = (err: unknown) =>
  err instanceof ApiError && err.code === 'directory_not_configured';
