import { Share } from 'react-native';

import { episodeShareUrl, type ShareOutcome } from './share-link';

export type ShareContent = { title: string; text: string; url: string; copy?: string };

/** Opens the system share sheet. */
export async function shareText({ title, text, url }: ShareContent): Promise<ShareOutcome> {
  // iOS shares `url` as a link alongside the message; Android only reads `message`.
  const result = await Share.share({ title, message: `${text}\n${url}`, url }, { dialogTitle: title });
  return result.action === Share.dismissedAction ? 'cancelled' : 'shared';
}

/** F-15: shares an episode's link. */
export function shareEpisode(episode: { id: string; title: string; podcastTitle: string }): Promise<ShareOutcome> {
  return shareText({ title: episode.title, text: `${episode.title} · ${episode.podcastTitle}`, url: episodeShareUrl(episode.id) });
}
