import type { Category, DirectoryPodcast, Episode, Podcast } from '@podcast/shared';
import { Platform } from 'react-native';

// Android emulators reach the host machine at 10.0.2.2, not localhost.
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;

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

export const api = {
  resolvePodcast: (feedUrl: string) =>
    request<{ podcast: Podcast }>('/v1/podcasts/resolve', {
      method: 'POST',
      body: JSON.stringify({ feedUrl }),
    }),

  getPodcast: (id: string) => request<{ podcast: Podcast }>(`/v1/podcasts/${encodeURIComponent(id)}`),

  listEpisodes: (id: string, cursor: string | null, limit = 50) =>
    request<{ episodes: Episode[]; nextCursor: string | null }>(
      `/v1/podcasts/${encodeURIComponent(id)}/episodes?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    ),

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
