import { InMemoryCatalogStore } from '@podcast/catalog';
import type { Episode, Podcast } from '@podcast/shared';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { previewText } from '../src/share';

const podcast: Podcast = {
  id: 'pod_1',
  feedUrl: 'https://example.com/feed.xml',
  title: 'Show & Tell',
  author: null,
  description: 'About the show',
  artworkUrl: 'https://cdn.example.com/show.jpg',
  language: 'en',
  categories: [],
  explicit: false,
  lastPublishedAt: null,
};

const episode: Episode = {
  id: 'ep_1',
  podcastId: 'pod_1',
  guid: 'g1',
  title: 'Ep 1: <script>alert("x")</script>',
  publishedAt: '2026-10-01T08:00:00.000Z',
  durationSec: 600,
  enclosureUrl: 'https://cdn.example.com/ep1.mp3',
  enclosureType: 'audio/mpeg',
  enclosureBytes: 1,
  showNotesHtml: '<p>We talk about <b>things</b> &amp; stuff.</p><script>bad()</script>',
  artworkUrl: null,
  season: null,
  episodeNumber: null,
};

async function setup() {
  const store = new InMemoryCatalogStore();
  await store.upsertPodcast(podcast, { etag: null, lastModified: null, fetchedAt: new Date().toISOString() });
  await store.upsertEpisodes([episode]);
  return buildApp({ store, webUrl: 'https://listen.example.com/' });
}

const meta = (html: string, property: string) =>
  html.match(new RegExp(`<meta property="${property}" content="([^"]*)">`))?.[1];

describe('GET /s/e/:id', () => {
  it('serves link-preview tags and sends people on to the episode page', async () => {
    const app = await setup();
    const res = await app.inject({ url: '/s/e/ep_1', headers: { host: 'share.example.com' } });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    const html = res.body;
    expect(meta(html, 'og:title')).toBe('Ep 1: &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(meta(html, 'og:description')).toBe('Show &amp; Tell · We talk about things &amp; stuff.');
    expect(meta(html, 'og:image')).toBe('https://cdn.example.com/show.jpg');
    expect(meta(html, 'og:audio')).toBe('https://cdn.example.com/ep1.mp3');
    expect(meta(html, 'og:url')).toBe('http://share.example.com/s/e/ep_1');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=https://listen.example.com/episode/ep_1">');
    expect(html).toContain('<link rel="canonical" href="https://listen.example.com/episode/ep_1">');
    // The episode title can't inject markup.
    expect(html).not.toContain('<script>');
  });

  it('uses the episode artwork when it has its own, and defaults the web app to localhost', async () => {
    const store = new InMemoryCatalogStore();
    await store.upsertPodcast(podcast, { etag: null, lastModified: null, fetchedAt: null });
    await store.upsertEpisodes([{ ...episode, artworkUrl: 'https://cdn.example.com/ep1.jpg' }]);
    const res = await buildApp({ store }).inject({ url: '/s/e/ep_1' });
    expect(meta(res.body, 'og:image')).toBe('https://cdn.example.com/ep1.jpg');
    expect(res.body).toContain('url=http://localhost:8081/episode/ep_1');
  });

  it('answers an unknown episode with a 404 page that links to the web app', async () => {
    const app = await setup();
    const res = await app.inject({ url: '/s/e/ep_missing' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('<a href="https://listen.example.com">Browse podcasts</a>');
  });
});

describe('previewText', () => {
  it('flattens HTML to one line and drops scripts', () => {
    expect(previewText('<p>One</p>\n<p>Two&nbsp;&lt;3</p><style>p{}</style>')).toBe('One Two <3');
    expect(previewText(null)).toBe('');
  });

  it('shortens long text at a word boundary', () => {
    const text = previewText(`${'word '.repeat(60)}`, 50);
    expect(text.length).toBeLessThanOrEqual(51);
    expect(text.endsWith('word…')).toBe(true);
  });
});
