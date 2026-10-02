import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import { isPrivateAddress, type FetchFeed } from '../src/fetch-feed';
import { DirectoryUnavailableError, type PodcastDirectory } from '../src/podcast-index';

const xml = readFileSync(
  new URL('../../../packages/feed-parser/test/fixtures/sample.xml', import.meta.url),
  'utf8',
);

function setup() {
  const fetchFeed = vi.fn<FetchFeed>(async (url) => ({
    notModified: false,
    xml,
    etag: '"v1"',
    lastModified: null,
    finalUrl: url,
  }));
  return { app: buildApp({ fetchFeed }), fetchFeed };
}

describe('POST /v1/podcasts/resolve', () => {
  it('fetches a new feed once and returns the same podcast afterwards', async () => {
    const { app, fetchFeed } = setup();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/podcasts/resolve',
      payload: { feedUrl: 'https://Example.com/feed.xml#top' },
    });
    expect(first.statusCode).toBe(200);
    const { podcast } = first.json();
    expect(podcast).toMatchObject({ title: '1984', feedUrl: 'https://example.com/feed.xml' });

    const again = await app.inject({
      method: 'POST',
      url: '/v1/podcasts/resolve',
      payload: { feedUrl: 'https://example.com/feed.xml' },
    });
    expect(again.json().podcast.id).toBe(podcast.id);
    expect(fetchFeed).toHaveBeenCalledTimes(1);
  });

  it('rejects a body without a valid URL', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/v1/podcasts/resolve', payload: { feedUrl: 'nope' } });
    expect(res.statusCode).toBe(400);
  });

  it('reports feeds that are not RSS', async () => {
    const app = buildApp({
      fetchFeed: async (url) => ({ notModified: false, xml: '<html/>', etag: null, lastModified: null, finalUrl: url }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/podcasts/resolve',
      payload: { feedUrl: 'https://example.com/page' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /v1/podcasts/:id/episodes', () => {
  it('pages episodes newest first', async () => {
    const { app } = setup();
    const resolved = await app.inject({
      method: 'POST',
      url: '/v1/podcasts/resolve',
      payload: { feedUrl: 'https://example.com/feed.xml' },
    });
    const id = resolved.json().podcast.id;

    const page1 = (await app.inject({ url: `/v1/podcasts/${id}/episodes?limit=1` })).json();
    expect(page1.episodes.map((e: { title: string }) => e.title)).toEqual(['Episode two']);
    expect(page1.nextCursor).toBe('1');

    const page2 = (await app.inject({ url: `/v1/podcasts/${id}/episodes?limit=1&cursor=1` })).json();
    expect(page2.episodes.map((e: { title: string }) => e.title)).toEqual(['Episode one']);
  });

  it('returns 404 for an unknown podcast', async () => {
    const { app } = setup();
    expect((await app.inject({ url: '/v1/podcasts/pod_missing/episodes' })).statusCode).toBe(404);
  });
});

describe('search and discover', () => {
  const show = {
    feedUrl: 'https://feeds.example.com/show.xml',
    title: 'Example Show',
    author: null,
    description: null,
    artworkUrl: null,
    categories: [],
    language: 'en',
  };

  function withDirectory(overrides: Partial<PodcastDirectory> = {}) {
    const directory = {
      search: vi.fn<PodcastDirectory['search']>(async () => [show]),
      trending: vi.fn<PodcastDirectory['trending']>(async () => [show]),
      categories: vi.fn<PodcastDirectory['categories']>(async () => [{ id: 55, name: 'News' }]),
      ...overrides,
    };
    return { app: buildApp({ directory }), directory };
  }

  it('searches by term', async () => {
    const { app, directory } = withDirectory();
    const res = await app.inject({ url: '/v1/search?q=%20example%20&limit=5' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [show] });
    expect(directory.search).toHaveBeenCalledWith('example', 5);
  });

  it('rejects an empty search', async () => {
    const { app } = withDirectory();
    expect((await app.inject({ url: '/v1/search?q=%20' })).statusCode).toBe(400);
  });

  it('serves top charts and category charts', async () => {
    const { app, directory } = withDirectory();
    expect((await app.inject({ url: '/v1/discover' })).json()).toEqual({ section: 'top', results: [show] });
    expect(directory.trending).toHaveBeenLastCalledWith({ limit: 25, categoryId: undefined, language: undefined });

    await app.inject({ url: '/v1/discover?section=category:55&lang=en&limit=10' });
    expect(directory.trending).toHaveBeenLastCalledWith({ limit: 10, categoryId: 55, language: 'en' });

    expect((await app.inject({ url: '/v1/discover?section=editors' })).statusCode).toBe(400);
  });

  it('lists categories', async () => {
    const { app } = withDirectory();
    expect((await app.inject({ url: '/v1/discover/categories' })).json()).toEqual({
      categories: [{ id: 55, name: 'News' }],
    });
  });

  it('answers 503, saying whether the directory is missing or failing', async () => {
    const { app } = setup();
    const res = await app.inject({ url: '/v1/search?q=example' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('directory_not_configured');

    const failing = withDirectory({
      trending: async () => {
        throw new DirectoryUnavailableError('Podcast Index answered 500');
      },
    });
    const down = await failing.app.inject({ url: '/v1/discover' });
    expect(down.statusCode).toBe(503);
    expect(down.json().error).toBe('directory_unavailable');
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['::1', true],
    ['fd00::1', true],
    ['::ffff:10.0.0.1', true],
    ['8.8.8.8', false],
    ['2606:4700::1111', false],
  ])('%s -> %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});
