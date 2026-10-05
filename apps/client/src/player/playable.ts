import type { Episode, Podcast } from '@podcast/shared';

import type { PlayableEpisode } from './types';

/** What the player needs from a catalog episode and its show. */
export function toPlayable(episode: Episode, podcast: Podcast): PlayableEpisode {
  return {
    id: episode.id,
    podcastId: podcast.id,
    title: episode.title,
    podcastTitle: podcast.title,
    url: episode.enclosureUrl,
    artworkUrl: episode.artworkUrl ?? podcast.artworkUrl,
    durationSec: episode.durationSec,
  };
}
