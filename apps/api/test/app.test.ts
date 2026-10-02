import { readFileSync } from 'node:fs';

import type { FetchFeed } from '@podcast/catalog';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
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

describe('background feed refresh', () => {
  const HOUR = 60 * 60_000;
  const newEpisode = `<item>
      <title>Episode three</title>
      <guid>ep-3</guid>
      <pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep3.mp3" type="audio/mpeg" length="1"/>
    </item>
    <item>`;

  async function setupRefresh() {
    let now = Date.UTC(2026, 9, 2);
    let nextResult: Awaited<ReturnType<FetchFeed>> | Error = {
      notModified: false,
      xml,
      etag: '"v1"',
      lastModified: null,
      finalUrl: '',
    };
    const fetchFeed = vi.fn<FetchFeed>(async () => {
      if (nextResult instanceof Error) throw nextResult;
      return nextResult;
    });
    const app = buildApp({ fetchFeed, now: () => now });
    const { podcast } = (
      await app.inject({ method: 'POST', url: '/v1/podcasts/resolve', payload: { feedUrl: 'https://example.com/feed.xml' } })
    ).json();
    const titles = async () =>
      (await app.inject({ url: `/v1/podcasts/${podcast.id}/episodes` })).json().episodes.map((e: { title: string }) => e.title);
    return {
      app,
      fetchFeed,
      id: podcast.id as string,
      titles,
      advance: (ms: number) => (now += ms),
      willReturn: (result: typeof nextResult) => (nextResult = result),
    };
  }

  it('leaves a recently fetched feed alone', async () => {
    const { app, fetchFeed, id, advance } = await setupRefresh();
    advance(HOUR - 1000);
    await app.inject({ url: `/v1/podcasts/${id}` });
    await app.inject({ url: `/v1/podcasts/${id}/episodes` });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchFeed).toHaveBeenCalledTimes(1);
  });

  it('re-fetches a stale feed conditionally and picks up new episodes', async () => {
    const { app, fetchFeed, id, titles, advance, willReturn } = await setupRefresh();
    advance(HOUR);
    willReturn({ notModified: false, xml: xml.replace('<item>', newEpisode), etag: '"v2"', lastModified: null, finalUrl: '' });

    // Details and episodes are requested together, as the show page does: one fetch between them.
    await Promise.all([app.inject({ url: `/v1/podcasts/${id}` }), app.inject({ url: `/v1/podcasts/${id}/episodes` })]);
    await vi.waitFor(async () => expect(await titles()).toContain('Episode three'));
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(fetchFeed.mock.calls[1]![1]).toMatchObject({ etag: '"v1"' });
  });

  it('counts a "not modified" answer as a fresh check', async () => {
    const { app, fetchFeed, id, advance, willReturn } = await setupRefresh();
    advance(HOUR);
    willReturn({ notModified: true });
    await app.inject({ url: `/v1/podcasts/${id}` });
    await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(2));

    advance(HOUR - 1000);
    await app.inject({ url: `/v1/podcasts/${id}` });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchFeed).toHaveBeenCalledTimes(2);
  });

  it('still answers when the refresh fails, and waits before retrying', async () => {
    const { app, fetchFeed, id, titles, advance, willReturn } = await setupRefresh();
    advance(HOUR);
    willReturn(new Error('feed host down'));
    const res = await app.inject({ url: `/v1/podcasts/${id}` });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));

    // Requests right after a failure don't retry...
    expect(await titles()).toEqual(['Episode two', 'Episode one']);
    await app.inject({ url: `/v1/podcasts/${id}` });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchFeed).toHaveBeenCalledTimes(2);

    // ...but ten minutes later they do.
    advance(10 * 60_000);
    willReturn({ notModified: true });
    await app.inject({ url: `/v1/podcasts/${id}` });
    await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(3));
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
