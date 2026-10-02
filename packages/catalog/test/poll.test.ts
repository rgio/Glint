import { describe, expect, it, vi } from 'vitest';

import { Catalog } from '../src/catalog';
import type { FetchFeed } from '../src/fetch-feed';
import { pollDueFeeds, POLL_LEASE_MS } from '../src/poll';
import { InMemoryCatalogStore } from '../src/store';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A feed with one episode a day, the newest published an hour before `now`. */
function dailyFeed(title: string, now: number, episodes = 5) {
  const items = Array.from({ length: episodes }, (_, i) => {
    const date = new Date(now - 60 * MINUTE - i * DAY).toUTCString();
    return `<item><title>${title} ${i}</title><guid>${title}-${i}</guid><pubDate>${date}</pubDate>
      <enclosure url="https://cdn.example.com/${title}-${i}.mp3" type="audio/mpeg" length="1"/></item>`;
  });
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items.join('')}</channel></rss>`;
}

async function setup(feedCount = 3) {
  let now = Date.UTC(2026, 9, 2, 12);
  const failing = new Set<string>();
  const fetchFeed = vi.fn<FetchFeed>(async (url, cache): ReturnType<FetchFeed> => {
    if (failing.has(url)) throw new Error(`${url} is down`);
    if (cache?.etag) return { notModified: true };
    return { notModified: false, xml: dailyFeed(url.split('/').pop()!, now), etag: '"v1"', lastModified: null, finalUrl: url };
  });
  const store = new InMemoryCatalogStore();
  const catalog = new Catalog(store, fetchFeed, () => now);
  const urls = Array.from({ length: feedCount }, (_, i) => `https://feeds.example.com/show${i}`);
  for (const url of urls) await catalog.resolve(url);
  fetchFeed.mockClear();

  const poll = (opts: { limit?: number } = {}) =>
    pollDueFeeds({ store, catalog, now: () => now, jitter: () => 0.5, ...opts });
  return { store, fetchFeed, urls, failing, poll, advance: (ms: number) => (now += ms) };
}

describe('pollDueFeeds', () => {
  it('polls newly added feeds, then waits for their next scheduled time', async () => {
    const { fetchFeed, poll, advance } = await setup();
    expect(await poll()).toEqual({ polled: 3, failed: 0 });
    // Conditional: each feed answers "not modified" to its stored ETag.
    expect(fetchFeed.mock.calls.map(([, cache]) => cache?.etag)).toEqual(['"v1"', '"v1"', '"v1"']);

    expect(await poll()).toEqual({ polled: 0, failed: 0 });
    advance(14 * MINUTE);
    expect((await poll()).polled).toBe(0);
    // Daily shows are polled every 15 minutes.
    advance(MINUTE);
    expect((await poll()).polled).toBe(3);
  });

  it('claims at most `limit` feeds per call', async () => {
    const { poll } = await setup(5);
    expect((await poll({ limit: 2 })).polled).toBe(2);
    expect((await poll({ limit: 2 })).polled).toBe(2);
    expect((await poll({ limit: 2 })).polled).toBe(1);
  });

  it('backs a failing feed off, and resets it once it recovers', async () => {
    const { urls, failing, poll, advance } = await setup(1);
    failing.add(urls[0]!);
    expect(await poll()).toEqual({ polled: 1, failed: 1 });

    // One failure doubles the 15-minute wait to 30.
    advance(29 * MINUTE);
    expect((await poll()).polled).toBe(0);
    advance(MINUTE);
    expect(await poll()).toEqual({ polled: 1, failed: 1 });

    // Two failures in a row: an hour.
    advance(59 * MINUTE);
    expect((await poll()).polled).toBe(0);
    advance(MINUTE);
    failing.clear();
    expect(await poll()).toEqual({ polled: 1, failed: 0 });

    // Recovered: back to every 15 minutes.
    advance(15 * MINUTE);
    expect((await poll()).polled).toBe(1);
  });

  it('reports failures to onError without stopping the other feeds', async () => {
    const { store, urls, failing, fetchFeed } = await setup(3);
    failing.add(urls[1]!);
    const onError = vi.fn();
    const now = Date.UTC(2026, 9, 2, 12);
    const catalog = new Catalog(store, fetchFeed, () => now);
    const result = await pollDueFeeds({ store, catalog, now: () => now, onError });
    expect(result).toEqual({ polled: 3, failed: 1 });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ feedUrl: urls[1] }));
  });

  it('leaves a claimed feed alone until its lease runs out, if the worker died mid-poll', async () => {
    const { store, poll, advance } = await setup(1);
    const start = new Date(Date.UTC(2026, 9, 2, 12)).toISOString();
    const leaseUntil = new Date(Date.UTC(2026, 9, 2, 12) + POLL_LEASE_MS).toISOString();
    // Claim without recording a result, as a crashed worker would.
    expect(await store.claimDueFeeds({ now: start, leaseUntil, limit: 10 })).toHaveLength(1);
    expect((await poll()).polled).toBe(0);
    advance(POLL_LEASE_MS);
    expect((await poll()).polled).toBe(1);
  });
});
