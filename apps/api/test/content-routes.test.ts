import { InMemoryCatalogStore } from '@podcast/catalog';
import { InMemoryJobQueue, InMemoryTranscriptStore, InMemoryUserDataStore } from '@podcast/content';
import type { Episode, Highlight, Podcast } from '@podcast/shared';
import { describe, expect, it } from 'vitest';

import type { EmailSender } from '../src/accounts/email';
import { buildApp } from '../src/app';

const podcast: Podcast = {
  id: 'pod_1',
  feedUrl: 'https://example.com/feed.xml',
  title: 'Town Talk',
  author: null,
  description: null,
  artworkUrl: null,
  language: 'en',
  categories: [],
  explicit: false,
  lastPublishedAt: null,
};
const episode = (id: string, title = `Episode ${id}`): Episode => ({
  id,
  podcastId: 'pod_1',
  guid: `g-${id}`,
  title,
  publishedAt: null,
  durationSec: 600,
  enclosureUrl: `https://cdn.example.com/${id}.mp3`,
  enclosureType: null,
  enclosureBytes: null,
  showNotesHtml: null,
  artworkUrl: null,
  season: null,
  episodeNumber: null,
  transcriptUrl: null,
  transcriptType: null,
  chaptersUrl: null,
});
const highlight = (id: string, extra: Partial<Highlight> = {}): Highlight => ({
  id,
  episodeId: 'ep_1',
  podcastId: 'pod_1',
  startSec: 10,
  endSec: 40,
  note: null,
  transcriptExcerpt: null,
  chapterTitle: null,
  anchorDurationSec: 600,
  anchorEnclosureUrl: null,
  source: 'player',
  createdAt: 1000,
  rangeUpdatedAt: 1000,
  noteUpdatedAt: 1000,
  deleted: false,
  ...extra,
});

async function setup() {
  const sent: string[] = [];
  const email: EmailSender = {
    async sendSignIn(_to, { code }) {
      sent.push(code);
    },
  };
  const store = new InMemoryCatalogStore();
  await store.upsertPodcast(podcast, { etag: null, lastModified: null, fetchedAt: null });
  await store.upsertEpisodes([episode('ep_1', 'Rebuilding Main Street'), episode('ep_2', 'Wider sidewalks')]);
  const transcripts = new InMemoryTranscriptStore();
  const jobs = new InMemoryJobQueue();
  const userData = new InMemoryUserDataStore();
  const now = Date.UTC(2026, 9, 9, 12);
  const app = buildApp({ store, email, authSecret: 'test-secret', now: () => now, rateLimit: false, content: { transcripts, jobs, userData } });

  const signIn = async (address: string) => {
    await app.inject({ method: 'POST', url: '/v1/auth/email/start', payload: { email: address } });
    const res = await app.inject({ method: 'POST', url: '/v1/auth/email/verify', payload: { email: address, code: sent.at(-1), client: 'native' } });
    const session = res.json() as { user: { id: string }; accessToken: string };
    return { userId: session.user.id, headers: { authorization: `Bearer ${session.accessToken}` } };
  };
  return { app, transcripts, jobs, userData, signIn, now };
}

describe('transcripts', () => {
  it('reports status for known episodes only', async () => {
    const { app, transcripts } = await setup();
    expect((await app.inject({ url: '/v1/episodes/ep_1/transcript/status' })).json()).toEqual({ status: 'none', source: null });
    await transcripts.markPending('ep_1', 'dlogos');
    expect((await app.inject({ url: '/v1/episodes/ep_1/transcript/status' })).json()).toEqual({ status: 'pending', source: 'dlogos' });
    expect((await app.inject({ url: '/v1/episodes/nope/transcript/status' })).statusCode).toBe(404);
  });

  it('serves the words in a range to signed-in listeners, at most 15 minutes at a time', async () => {
    const { app, transcripts, signIn } = await setup();
    const segments = Array.from({ length: 40 }, (_, i) => ({ startMs: i * 60_000, endMs: i * 60_000 + 60_000, speaker: 'A', text: `Minute ${i}.` }));
    await transcripts.saveReady('ep_1', 'dlogos', {}, { segments, chapters: [{ startMs: 0, title: 'Intro' }], takeaways: [] });

    expect((await app.inject({ url: '/v1/episodes/ep_1/transcript?start=0&end=60' })).statusCode).toBe(401);
    const { headers } = await signIn('ann@example.com');
    const range = (await app.inject({ url: '/v1/episodes/ep_1/transcript?start=90&end=200', headers })).json();
    expect(range).toMatchObject({ status: 'ready', source: 'dlogos', chapters: [{ startMs: 0, title: 'Intro' }] });
    expect(range.segments.map((s: { text: string }) => s.text)).toEqual(['Minute 1.', 'Minute 2.', 'Minute 3.']);

    const capped = (await app.inject({ url: '/v1/episodes/ep_1/transcript', headers })).json();
    expect(capped.segments).toHaveLength(15);
    expect((await app.inject({ url: '/v1/episodes/ep_1/transcript?start=50&end=10', headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/v1/episodes/ep_2/transcript', headers })).json()).toEqual({ status: 'none', source: null, segments: [], chapters: [] });
  });
});

describe('highlights and discovery', () => {
  it('enqueues transcript, context and embedding work when a highlight syncs', async () => {
    const { app, jobs, signIn, now } = await setup();
    const { userId, headers } = await signIn('ann@example.com');
    const h = highlight('30000000-0000-4000-8000-000000000001');
    await app.inject({ method: 'POST', url: '/v1/sync', headers, payload: { changes: [{ kind: 'highlight', value: h }] } });
    expect(await jobs.pending()).toEqual([
      { kind: 'transcript.request', key: 'ep_1', runAt: new Date(0) },
      { kind: 'highlight.context', key: `${userId}:${h.id}`, runAt: new Date(0) },
      { kind: 'embed.highlight', key: `${userId}:${h.id}`, runAt: new Date(now + 30_000) },
    ]);
  });

  it('searches the listener’s highlights with their episodes and shows', async () => {
    const { app, signIn } = await setup();
    const { headers } = await signIn('ann@example.com');
    await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers,
      payload: {
        changes: [
          { kind: 'highlight', value: highlight('30000000-0000-4000-8000-000000000001', { note: 'try on the onboarding flow' }) },
          { kind: 'highlight', value: highlight('30000000-0000-4000-8000-000000000002', { note: 'pricing', episodeId: 'ep_2' }) },
        ],
      },
    });
    const res = (await app.inject({ url: '/v1/me/highlights?q=onboarding', headers })).json();
    expect(res.highlights.map((h: Highlight) => h.note)).toEqual(['try on the onboarding flow']);
    expect(res).toMatchObject({ nextCursor: null, episodes: [{ id: 'ep_1' }], podcasts: [{ id: 'pod_1' }] });
    expect((await app.inject({ url: '/v1/me/highlights?limit=1', headers })).json().nextCursor).toBe('1');
    expect((await app.inject({ url: '/v1/me/highlights' })).statusCode).toBe(401);
  });

  it('returns cached recommendations with their episodes, and records events', async () => {
    const { app, userData, signIn } = await setup();
    const { userId, headers } = await signIn('ann@example.com');
    expect((await app.inject({ url: '/v1/me/recommendations', headers })).json()).toEqual({ recommendations: [], generatedAt: null });

    await userData.saveRecommendations(userId, [
      { episodeId: 'ep_2', score: 0.8, startSec: 120, because: { highlightId: 'h', text: 'sidewalks', episodeTitle: 'Rebuilding Main Street' } },
      { episodeId: 'gone', score: 0.7, startSec: null, because: null },
    ]);
    const res = (await app.inject({ url: '/v1/me/recommendations', headers })).json();
    expect(res.recommendations).toEqual([
      expect.objectContaining({ episode: expect.objectContaining({ id: 'ep_2' }), podcast: expect.objectContaining({ id: 'pod_1' }), startSec: 120 }),
    ]);
    expect(res.generatedAt).toEqual(expect.any(String));

    const event = await app.inject({ method: 'POST', url: '/v1/me/recommendations/events', headers, payload: { episodeId: 'ep_2', event: 'opened' } });
    expect(event.statusCode).toBe(204);
    expect(userData.events).toEqual([{ userId, episodeId: 'ep_2', event: 'opened' }]);
    expect((await app.inject({ method: 'POST', url: '/v1/me/recommendations/events', headers, payload: { episodeId: 'ep_2', event: 'liked' } })).statusCode).toBe(400);
  });
});
