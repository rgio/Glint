import type { OpmlFeed } from '@podcast/feed-parser';
import type { Podcast } from '@podcast/shared';

export type ImportResult = {
  added: Podcast[];
  alreadySubscribed: number;
  failed: { name: string; feedUrl: string; reason: string }[];
};

/** Compares feed URLs the way the server stores them: parsed, without a fragment. */
export function sameFeed(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u.trim().replace(/^feed:\/\//i, 'https://'));
      url.hash = '';
      return url.toString();
    } catch {
      return u.trim();
    }
  };
  return norm(a) === norm(b);
}

/**
 * F-03 OPML import: adds each feed (`resolve` fetches it on the server), a few at a time.
 * Feeds already subscribed are skipped without a request; a failure is recorded and the rest
 * carry on.
 */
export async function importFeeds(
  feeds: OpmlFeed[],
  {
    subscribedUrls,
    resolve,
    subscribe,
    concurrency = 4,
    onProgress,
  }: {
    subscribedUrls: string[];
    resolve: (feedUrl: string) => Promise<Podcast>;
    subscribe: (podcast: Podcast) => void;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<ImportResult> {
  const result: ImportResult = { added: [], alreadySubscribed: 0, failed: [] };
  const todo = feeds.filter((f) => {
    const known = subscribedUrls.some((url) => sameFeed(url, f.feedUrl));
    if (known) result.alreadySubscribed++;
    return !known;
  });

  let next = 0;
  let done = 0;
  onProgress?.(0, todo.length);
  const worker = async () => {
    while (next < todo.length) {
      const feed = todo[next++]!;
      try {
        const podcast = await resolve(feed.feedUrl);
        subscribe(podcast);
        result.added.push(podcast);
      } catch (err) {
        result.failed.push({ name: feed.title ?? feed.feedUrl, feedUrl: feed.feedUrl, reason: (err as Error).message });
      }
      onProgress?.(++done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

  // Keep the file's order in the report, not the order requests happened to finish.
  const order = new Map(feeds.map((f, i) => [f.feedUrl, i]));
  result.failed.sort((a, b) => order.get(a.feedUrl)! - order.get(b.feedUrl)!);
  return result;
}
