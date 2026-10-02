import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { DirectoryUnavailableError, PodcastIndexDirectory } from '../src/podcast-index';

const NOW = 1_790_000_000_000;

function setup(body: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status }));
  let now = NOW;
  const directory = new PodcastIndexDirectory({ apiKey: 'KEY', apiSecret: 'SECRET', fetch, now: () => now });
  return { directory, fetch, advance: (ms: number) => (now += ms) };
}

const feed = {
  id: 920666,
  url: 'https://feeds.example.com/show.xml',
  title: 'Example Show',
  author: 'Example Media',
  ownerName: 'Owner',
  description: 'A show.',
  image: 'https://cdn.example.com/small.jpg',
  artwork: 'https://cdn.example.com/large.jpg',
  language: 'en-us',
  categories: { '9': 'Business', '55': 'News' },
  dead: 0,
};

describe('PodcastIndexDirectory', () => {
  it('signs requests with the Podcast Index auth headers', async () => {
    const { directory, fetch } = setup({ feeds: [] });
    await directory.search('batman university', 10);

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.podcastindex.org/api/1.0/search/byterm?q=batman+university&max=10&clean=true',
    );
    const headers = init?.headers as Record<string, string>;
    const date = String(NOW / 1000);
    expect(headers['X-Auth-Key']).toBe('KEY');
    expect(headers['X-Auth-Date']).toBe(date);
    expect(headers.Authorization).toBe(createHash('sha1').update(`KEYSECRET${date}`).digest('hex'));
    expect(headers['User-Agent']).toMatch(/PodcastApp/);
  });

  it('maps feeds and skips dead or unusable ones', async () => {
    const { directory } = setup({
      feeds: [
        feed,
        { ...feed, url: 'https://feeds.example.com/dead.xml', dead: 1 },
        { ...feed, url: 'not a url' },
        { ...feed, url: 'https://feeds.example.com/bare.xml', author: '', artwork: '', categories: null },
      ],
    });
    const results = await directory.search('example', 10);

    expect(results).toEqual([
      {
        feedUrl: 'https://feeds.example.com/show.xml',
        title: 'Example Show',
        author: 'Example Media',
        description: 'A show.',
        artworkUrl: 'https://cdn.example.com/large.jpg',
        categories: ['Business', 'News'],
        language: 'en-us',
      },
      expect.objectContaining({
        feedUrl: 'https://feeds.example.com/bare.xml',
        author: 'Owner',
        artworkUrl: 'https://cdn.example.com/small.jpg',
        categories: [],
      }),
    ]);
  });

  it('passes the category and language to trending', async () => {
    const { directory, fetch } = setup({ feeds: [feed] });
    await directory.trending({ limit: 5, categoryId: 55, language: 'en' });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://api.podcastindex.org/api/1.0/podcasts/trending?max=5&cat=55&lang=en',
    );
  });

  it('caches results until they expire', async () => {
    const { directory, fetch, advance } = setup({ feeds: [{ id: 1, name: 'Arts' }] });
    expect(await directory.categories()).toEqual([{ id: 1, name: 'Arts' }]);
    await directory.categories();
    expect(fetch).toHaveBeenCalledTimes(1);

    advance(25 * 60 * 60 * 1000);
    await directory.categories();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports upstream errors and does not cache them', async () => {
    const { directory, fetch } = setup({ status: 'false' }, 401);
    await expect(directory.search('x', 5)).rejects.toBeInstanceOf(DirectoryUnavailableError);
    await expect(directory.search('x', 5)).rejects.toBeInstanceOf(DirectoryUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports network failures', async () => {
    const directory = new PodcastIndexDirectory({
      apiKey: 'KEY',
      apiSecret: 'SECRET',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(directory.trending({ limit: 5 })).rejects.toThrow(/fetch failed/);
  });
});
