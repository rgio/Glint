import type { Episode, Podcast } from '@podcast/shared';
import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';

import { useLibrary } from './store';

import { api } from '@/api/client';
import { usePlayer } from '@/player/store';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Episodes listed in Home's "New" section at most. */
const MAX_LISTED = 20;
/** Re-check subscriptions this often while the app is open, so the badge stays current. */
const REFRESH_MS = 15 * 60_000;

export type NewEpisode = { episode: Episode; podcast: Podcast };

/**
 * F-11: episodes from subscriptions published since the listener last left Home (the past
 * week on a first visit), newest first. Home and its tab badge both use this; React Query
 * shares the requests between them.
 */
export function useNewEpisodes() {
  const subscriptions = useLibrary((s) => s.subscriptions);
  const lastVisit = useLibrary((s) => s.lastHomeVisitAt);
  const [now] = useState(Date.now);

  const subs = Object.values(subscriptions);
  const results = useQueries({
    queries: subs.map(({ podcast }) => ({
      queryKey: ['episodes', podcast.id, 'latest'],
      queryFn: () => api.listEpisodes(podcast.id, null, 10),
      refetchInterval: REFRESH_MS,
    })),
  });

  const since = lastVisit || now - WEEK_MS;
  const all: NewEpisode[] = results
    .flatMap((r, i) => (r.data?.episodes ?? []).map((episode) => ({ episode, podcast: subs[i]!.podcast })))
    .filter(({ episode }) => episode.publishedAt && Date.parse(episode.publishedAt) > since)
    .sort((a, b) => (b.episode.publishedAt ?? '').localeCompare(a.episode.publishedAt ?? ''));

  return {
    all,
    listed: all.slice(0, MAX_LISTED),
    loading: results.some((r) => r.isPending),
    subscribed: subs.length > 0,
  };
}

/** How many new episodes the listener hasn't played yet, for the Home tab badge. */
export function useUnplayedNewCount(): number {
  const { all } = useNewEpisodes();
  const ids = all.map(({ episode }) => episode.id);
  return usePlayer((s) => ids.filter((id) => !s.saved[id]?.played).length);
}

/** Badge text: the count, capped at "9+"; undefined when there's nothing new. */
export function badgeText(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 9 ? '9+' : String(count);
}
