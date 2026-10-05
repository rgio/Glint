import type { Podcast } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';

import { importFeeds, sameFeed } from './import-feeds';

const podcast = (feedUrl: string): Podcast => ({
  id: `pod_${feedUrl}`,
  feedUrl,
  title: feedUrl,
  author: null,
  description: null,
  artworkUrl: null,
  language: null,
  categories: [],
  explicit: false,
  lastPublishedAt: null,
});

describe('sameFeed', () => {
  it('ignores host case, fragments and the feed:// scheme', () => {
    expect(sameFeed('https://Example.com/feed.xml#top', 'https://example.com/feed.xml')).toBe(true);
    expect(sameFeed('feed://example.com/feed.xml', 'https://example.com/feed.xml')).toBe(true);
    expect(sameFeed('https://example.com/a.xml', 'https://example.com/b.xml')).toBe(false);
  });
});

describe('importFeeds', () => {
  const feeds = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ title: n.toUpperCase(), feedUrl: `https://example.com/${n}.xml` }));

  it('adds new feeds, skips ones already subscribed, and reports failures in file order', async () => {
    const resolve = vi.fn(async (url: string) => {
      if (url.endsWith('/d.xml')) throw new Error('Feed returned HTTP 404');
      if (url.endsWith('/b.xml')) {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error('Feed returned HTTP 500');
      }
      return podcast(url);
    });
    const subscribe = vi.fn();
    const progress: [number, number][] = [];

    const result = await importFeeds(feeds, {
      subscribedUrls: ['https://EXAMPLE.com/c.xml'],
      resolve,
      subscribe,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(result.added.map((p) => p.feedUrl)).toEqual(['https://example.com/a.xml', 'https://example.com/e.xml']);
    expect(result.alreadySubscribed).toBe(1);
    expect(result.failed).toEqual([
      { name: 'B', feedUrl: 'https://example.com/b.xml', reason: 'Feed returned HTTP 500' },
      { name: 'D', feedUrl: 'https://example.com/d.xml', reason: 'Feed returned HTTP 404' },
    ]);
    expect(resolve).toHaveBeenCalledTimes(4);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(progress[0]).toEqual([0, 4]);
    expect(progress.at(-1)).toEqual([4, 4]);
  });

  it('never runs more than `concurrency` requests at once', async () => {
    let running = 0;
    let peak = 0;
    const resolve = async (url: string) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return podcast(url);
    };
    await importFeeds(feeds, { subscribedUrls: [], resolve, subscribe: () => {}, concurrency: 2 });
    expect(peak).toBe(2);
  });

  it('does nothing for an empty list', async () => {
    const resolve = vi.fn();
    expect(await importFeeds([], { subscribedUrls: [], resolve, subscribe: () => {} })).toEqual({
      added: [],
      alreadySubscribed: 0,
      failed: [],
    });
    expect(resolve).not.toHaveBeenCalled();
  });
});
