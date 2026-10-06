/**
 * Starts what the end-to-end tests talk to: a fixture server (feeds, audio, captured sign-in
 * emails) and the real API wired to it. Playwright starts this, plus the Expo web app.
 */
import { createServer } from 'node:http';

import { FeedFetchError, type FetchFeed } from '@podcast/catalog';
import type { DirectoryPodcast } from '@podcast/shared';

import { buildApp } from '../../api/src/app';
import { feedXml, SHOWS, silentWav } from './fixtures';
import { API_PORT, FIXTURE_PORT, FIXTURE_URL, WEB_URL } from './ports';

const audio = silentWav();
const sentEmails = new Map<string, { code: string; link: string }>();

const fixtures = createServer((req, res) => {
  const url = new URL(req.url ?? '/', FIXTURE_URL);
  const show = SHOWS.find((s) => url.pathname === `/feeds/${s.slug}.xml`);
  if (show) {
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    return res.end(feedXml(show, FIXTURE_URL));
  }
  if (url.pathname === '/audio.wav') {
    // Range support, so the player can seek.
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    const start = range?.[1] ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : audio.length - 1;
    res.writeHead(range ? 206 : 200, {
      'content-type': 'audio/wav',
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
      ...(range && { 'content-range': `bytes ${start}-${end}/${audio.length}` }),
      'access-control-allow-origin': '*',
    });
    return res.end(audio.subarray(start, end + 1));
  }
  if (url.pathname === '/test/sign-in') {
    const sent = sentEmails.get(url.searchParams.get('email') ?? '');
    res.writeHead(sent ? 200 : 404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(sent ?? { error: 'no email sent' }));
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

// The production fetcher refuses private and loopback hosts (SSRF guard); the fixtures live on
// localhost, so the tests use a plain fetch.
const fetchFeed: FetchFeed = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new FeedFetchError(`Feed returned HTTP ${res.status}`);
  return { notModified: false, xml: await res.text(), etag: null, lastModified: null, finalUrl: url };
};

const directoryEntry = (slug: string): DirectoryPodcast => {
  const show = SHOWS.find((s) => s.slug === slug)!;
  return {
    feedUrl: `${FIXTURE_URL}/feeds/${slug}.xml`,
    title: show.title,
    author: show.author,
    description: show.description,
    artworkUrl: null,
    categories: [],
    language: 'en',
  };
};

const app = buildApp({
  fetchFeed,
  webUrl: WEB_URL,
  authSecret: 'e2e-secret',
  // Every test signs in from this machine; production limits would lock later tests out.
  rateLimit: false,
  email: {
    async sendSignIn(to, { code, link }) {
      sentEmails.set(to, { code, link });
    },
  },
  directory: {
    async search(q) {
      return SHOWS.filter((s) => s.title.toLowerCase().includes(q.toLowerCase())).map((s) => directoryEntry(s.slug));
    },
    async trending({ categoryId }) {
      return categoryId === 55 ? [directoryEntry('daily')] : SHOWS.map((s) => directoryEntry(s.slug));
    },
    async categories() {
      return [
        { id: 55, name: 'News' },
        { id: 102, name: 'Technology' },
      ];
    },
  },
});

fixtures.listen(FIXTURE_PORT, () => console.log(`fixtures on ${FIXTURE_URL}`));
await app.listen({ port: API_PORT, host: '127.0.0.1' });
console.log(`api on http://localhost:${API_PORT}`);
