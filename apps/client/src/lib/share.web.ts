import { episodeShareUrl, type ShareOutcome } from './share-link';

/** The browser's share dialog where there is one (phones, Safari); otherwise copies the link. */
export async function shareEpisode(episode: { id: string; title: string; podcastTitle: string }): Promise<ShareOutcome> {
  const url = episodeShareUrl(episode.id);
  const data = { title: episode.title, text: `${episode.title} · ${episode.podcastTitle}`, url };
  if (typeof navigator.share === 'function' && (navigator.canShare?.(data) ?? true)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
      // Some browsers refuse share() outside particular contexts; fall back to copying.
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
