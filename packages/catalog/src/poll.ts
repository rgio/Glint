import type { Catalog } from './catalog';
import { nextPollDelay } from './schedule';
import type { CatalogStore, DueFeed } from './store';

/** How long a claimed feed is reserved for one worker; comfortably longer than a fetch can take. */
export const POLL_LEASE_MS = 10 * 60_000;
/** Recent episodes used to estimate how often a show publishes. */
const CADENCE_SAMPLE = 10;

const iso = (ms: number) => new Date(ms).toISOString();

async function forEachLimit<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await run(items[next++]!);
  });
  await Promise.all(workers);
}

export type PollOptions = {
  store: CatalogStore;
  catalog: Catalog;
  /** Feeds claimed per call. */
  limit?: number;
  /** Feeds fetched at once. */
  concurrency?: number;
  now?: () => number;
  jitter?: () => number;
  onError?: (err: unknown, feed: DueFeed) => void;
};

/**
 * Claims the feeds that are due, fetches each one (conditionally, so unchanged feeds are
 * cheap), and schedules its next poll from how often it publishes. A failure backs that feed
 * off; a success resets it.
 */
export async function pollDueFeeds({
  store,
  catalog,
  limit = 25,
  concurrency = 5,
  now = Date.now,
  jitter,
  onError,
}: PollOptions): Promise<{ polled: number; failed: number }> {
  const start = now();
  const due = await store.claimDueFeeds({ now: iso(start), leaseUntil: iso(start + POLL_LEASE_MS), limit });
  let failed = 0;

  await forEachLimit(due, concurrency, async (feed) => {
    let failures = 0;
    try {
      await catalog.ingest(feed.feedUrl);
    } catch (err) {
      failures = feed.pollFailures + 1;
      failed++;
      onError?.(err, feed);
    }
    const recent = await store.listEpisodes(feed.id, { offset: 0, limit: CADENCE_SAMPLE, sort: 'newest' });
    const delay = nextPollDelay({ publishedAt: recent.map((e) => e.publishedAt), now: now(), failures, jitter });
    await store.recordPoll(feed.id, { nextPollAt: iso(now() + delay), failures });
  });

  return { polled: due.length, failed };
}
