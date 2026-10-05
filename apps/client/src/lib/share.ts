import { Share } from 'react-native';

import { episodeShareUrl, type ShareOutcome } from './share-link';

/** Opens the system share sheet with the episode's link. */
export async function shareEpisode(episode: { id: string; title: string; podcastTitle: string }): Promise<ShareOutcome> {
  const url = episodeShareUrl(episode.id);
  // iOS shares `url` as a link alongside the message; Android only reads `message`.
  const result = await Share.share(
    { title: episode.title, message: `${episode.title} · ${episode.podcastTitle}\n${url}`, url },
    { dialogTitle: 'Share episode' },
  );
  return result.action === Share.dismissedAction ? 'cancelled' : 'shared';
}
