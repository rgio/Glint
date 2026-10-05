import { episodeShareUrl, type ShareOutcome } from './share-link';

export type ShareContent = { title: string; text: string; url: string; /** What to copy when there's no share dialog; the link by default. */ copy?: string };

/** The browser's share dialog where there is one (phones, Safari); otherwise copies to the clipboard. */
export async function shareText({ title, text, url, copy }: ShareContent): Promise<ShareOutcome> {
  const data = { title, text, url };
  if (typeof navigator.share === 'function' && (navigator.canShare?.(data) ?? true)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
      // Some browsers refuse share() outside particular contexts; fall back to copying.
    }
  }
  await navigator.clipboard.writeText(copy ?? url);
  return 'copied';
}

/** F-15: shares an episode's link. */
export function shareEpisode(episode: { id: string; title: string; podcastTitle: string }): Promise<ShareOutcome> {
  return shareText({ title: episode.title, text: `${episode.title} · ${episode.podcastTitle}`, url: episodeShareUrl(episode.id) });
}
