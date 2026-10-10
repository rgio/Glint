import { readFileSync } from 'node:fs';

import type { Episode, Highlight, Podcast } from '@podcast/shared';
import { describe, expect, it } from 'vitest';

import {
  DlogosClient,
  HashingEmbedder,
  InMemoryCatalogQueries,
  InMemoryJobQueue,
  InMemoryTranscriptStore,
  InMemoryUserDataStore,
  InMemoryVectorIndex,
  onHighlightChanged,
  runDueJobs,
  type ContentDeps,
} from '../src';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/dlogos-episode.json', import.meta.url), 'utf8')) as {
  ready: Record<string, unknown>;
  page2: Record<string, unknown>;
};

const U1 = '00000000-0000-4000-8000-000000000001';
const H1 = '6a6f0b4e-8a4a-4c8e-9f0e-1d2c3b4a5f60';

const podcast = (id: string, title: string, language = 'en'): Podcast => ({
  id,
  feedUrl: `https://example.com/${id}.xml`,
  title,
  author: null,
  description: null,
  artworkUrl: null,
  language,
  categories: [],
  explicit: false,
  lastPublishedAt: null,
});

const episode = (id: string, podcastId: string, title: string, notes: string, extra: Partial<Episode> = {}): Episode => ({
  id,
  podcastId,
  guid: `guid-${id}`,
  title,
  publishedAt: '2026-10-01T08:00:00.000Z',
  durationSec: 600,
  enclosureUrl: `https://cdn.example.com/${id}.mp3`,
  enclosureType: 'audio/mpeg',
  enclosureBytes: null,
  showNotesHtml: `<p>${notes}</p>`,
  artworkUrl: null,
  season: null,
  episodeNumber: null,
  transcriptUrl: null,
  transcriptType: null,
  chaptersUrl: null,
  ...extra,
});

const town = podcast('pod_town', 'Town Talk');
const catalogItems = [
  { podcast: town, episode: episode('ep_main', 'pod_town', 'Rebuilding Main Street', 'How small towns rebuild', { guid: 'guid-main-street' }) },
  {
    podcast: podcast('pod_city', 'City Desk'),
    episode: episode('ep_sidewalks', 'pod_city', 'Wider sidewalks, busier shops', 'Why foot traffic and wider sidewalks bring shops and cafes back to main streets'),
  },
  { podcast: podcast('pod_food', 'Kitchen Hour'), episode: episode('ep_bread', 'pod_food', 'Sourdough basics', 'Starter, flour, hydration and baking bread at home') },
  { podcast: podcast('pod_es', 'Ciudad', 'es'), episode: episode('ep_es', 'pod_es', 'Aceras y tiendas', 'foot traffic sidewalks shops main streets') },
];

const highlight: Highlight = {
  id: H1,
  episodeId: 'ep_main',
  podcastId: 'pod_town',
  // Starts at the end of "…no grant will save it." (segment 5, 250.5–305 s) and runs into segment 6.
  startSec: 280,
  endSec: 315,
  note: 'sidewalks before parking',
  transcriptExcerpt: null,
  chapterTitle: null,
  anchorDurationSec: 635,
  anchorEnclosureUrl: 'https://cdn.example.com/ep_main.mp3',
  source: 'player',
  createdAt: Date.UTC(2026, 9, 5),
  rangeUpdatedAt: Date.UTC(2026, 9, 5),
  noteUpdatedAt: Date.UTC(2026, 9, 5),
  deleted: false,
};

function setup() {
  let clock = Date.UTC(2026, 9, 9, 12);
  let polls = 0;
  const requests: string[] = [];
  const dlogosFetch = (async (input: string | URL | Request) => {
    const url = new URL(input.toString());
    requests.push(url.pathname + url.search);
    const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
    if (url.pathname.endsWith('/process')) return ok({ poll_url: '/api/v2/partner/episodes/abc', episode_id: 'abc' });
    if (url.searchParams.get('transcript_page') === '1') return ok(fixture.page2);
    return ok(++polls === 1 ? { episode_id: 'abc', status: 'transcribing' } : fixture.ready);
  }) as typeof fetch;

  const index = new InMemoryVectorIndex();
  const userData = new InMemoryUserDataStore();
  userData.addHighlight(U1, highlight);
  const transcripts = new InMemoryTranscriptStore();
  const deps: ContentDeps = {
    jobs: new InMemoryJobQueue(),
    transcripts,
    userData,
    catalog: new InMemoryCatalogQueries(catalogItems, {
      hasVector: async (id, model) => (await index.get('episode', id, model)) !== null,
      windowsWanted: (id) => id === 'ep_main',
    }),
    index,
    dlogos: new DlogosClient({ apiKey: 'k', fetch: dlogosFetch }),
    embedder: new HashingEmbedder(),
    fetchText: async () => {
      throw new Error('no publisher transcripts in this test');
    },
    now: () => clock,
    seedDailyBudget: 0,
    requestDailyBudget: 100,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  /** Runs due jobs, moving the clock to the next waiting job, until nothing is due within `horizonMs`. */
  const drain = async (horizonMs = 10 * 60_000) => {
    const end = clock + horizonMs;
    for (let round = 0; round < 200; round++) {
      if (await runDueJobs(deps)) continue;
      const next = (await deps.jobs.pending()).map((j) => j.runAt.getTime()).filter((t) => t <= end).sort((a, b) => a - b)[0];
      if (next === undefined) return;
      clock = Math.max(clock, next);
    }
    throw new Error('jobs did not settle');
  };
  return { deps, drain, requests, transcripts, userData, index, advance: (ms: number) => (clock += ms) };
}

describe('content worker, end to end in memory', () => {
  it('turns a highlight into an excerpt, vectors and recommendations', async () => {
    const t = setup();
    await t.transcripts.setDlogosSlug('pod_town', 'town-talk-a1b2c3d4');
    await t.deps.jobs.enqueue('embed.sweep', 'sweep');
    await onHighlightChanged(t.deps.jobs, U1, highlight, t.deps.now());
    await t.drain();

    // dLogos: one submit, a "still transcribing" poll, then the ready poll and its second page.
    expect(t.requests).toEqual([
      '/api/v2/partner/episodes/process',
      '/api/v2/partner/episodes/abc',
      '/api/v2/partner/episodes/abc',
      '/api/v2/partner/episodes/abc?transcript_page=1',
    ]);
    expect(await t.transcripts.status('ep_main')).toEqual({ status: 'ready', source: 'dlogos' });

    // The listener heard the same length of audio as dLogos transcribed (635 s): exact.
    const h = await t.userData.getHighlight(U1, H1);
    expect(h).toMatchObject({ chapterTitle: 'Foot traffic first', transcriptConfidence: 'exact' });
    expect(h!.transcriptExcerpt).toBe("Towns that widened sidewalks saw rents recover first. That's surprising.");
    expect(t.userData.versions.get(`${U1}\n${H1}`)).toBe(1);

    // Vectors: every episode's description, the transcript's chunks, the highlight, the profile.
    const model = t.deps.embedder!.model;
    expect((await t.index.episodesWith('episode', catalogItems.map((i) => i.episode.id), model)).size).toBe(4);
    expect(await t.index.get('highlight', H1, model)).not.toBeNull();
    expect(await t.index.listForUser(U1, ['profile'], model)).toHaveLength(1);

    // Recommendations: the sidewalks episode, not the one already highlighted, nor the Spanish show.
    const recs = (await t.userData.recommendations(U1))!.items;
    expect(recs[0]).toMatchObject({ episodeId: 'ep_sidewalks', because: { highlightId: H1, episodeTitle: 'Rebuilding Main Street' } });
    expect(recs.map((r) => r.episodeId)).not.toContain('ep_main');
    expect(recs.map((r) => r.episodeId)).not.toContain('ep_es');
  });

  it('holds highlight-driven dLogos requests to a daily budget', async () => {
    const t = setup();
    t.deps.requestDailyBudget = 0;
    await t.transcripts.setDlogosSlug('pod_town', 'town-talk-a1b2c3d4');
    await t.deps.jobs.enqueue('transcript.request', 'ep_main');
    await t.drain(60_000);
    expect(t.requests).toEqual([]);
    expect((await t.deps.jobs.pending())[0]!.runAt.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('does not embed ad reads', async () => {
    const t = setup();
    await t.transcripts.setDlogosSlug('pod_town', 'town-talk-a1b2c3d4');
    await t.deps.jobs.enqueue('transcript.request', 'ep_main');
    await t.drain();
    const transcript = await t.transcripts.current('ep_main');
    const chunks = await t.transcripts.chunks(transcript!.id, 1);
    const ad = chunks.find((c) => c.isAd);
    expect(ad?.text).toContain('Acme Mattresses');
    expect(await t.index.get('chunk', ad!.id, t.deps.embedder!.model)).toBeNull();
    expect(await t.index.get('chunk', chunks.find((c) => !c.isAd)!.id, t.deps.embedder!.model)).not.toBeNull();
  });

  it('marks an episode unavailable when its show has no dLogos mapping, and retries in a week', async () => {
    const t = setup();
    await t.deps.jobs.enqueue('transcript.request', 'ep_main');
    await t.drain();
    expect(await t.transcripts.status('ep_main')).toEqual({ status: 'unavailable', source: null });
    expect(t.requests).toEqual([]);
    const waiting = await t.deps.jobs.pending();
    expect(waiting).toEqual([{ kind: 'transcript.request', key: 'ep_main', runAt: expect.any(Date) }]);
    expect(waiting[0]!.runAt.getTime() - t.deps.now()).toBeGreaterThan(6 * 24 * 3_600_000);

    // Mapping the show wakes the waiting request.
    await t.transcripts.setDlogosSlug('pod_town', 'town-talk-a1b2c3d4');
    await t.deps.jobs.runNow('transcript.request', 'ep_main');
    await t.drain();
    expect(await t.transcripts.status('ep_main')).toEqual({ status: 'ready', source: 'dlogos' });
  });

  it('recomputes context when the range changes, and removes the vector of a deleted highlight', async () => {
    const t = setup();
    await t.transcripts.setDlogosSlug('pod_town', 'town-talk-a1b2c3d4');
    await onHighlightChanged(t.deps.jobs, U1, highlight, t.deps.now());
    await t.drain();

    const moved = { ...highlight, startSec: 470, endSec: 500, rangeUpdatedAt: highlight.rangeUpdatedAt + 1 };
    t.userData.addHighlight(U1, moved);
    // Until it's recomputed, the old excerpt doesn't show for the new range.
    expect((await t.userData.getHighlight(U1, H1))!.transcriptExcerpt).toBeNull();
    await onHighlightChanged(t.deps.jobs, U1, moved, t.deps.now());
    await t.drain();
    expect(await t.userData.getHighlight(U1, H1)).toMatchObject({ chapterTitle: 'Who loses' });

    t.userData.addHighlight(U1, { ...moved, deleted: true });
    await onHighlightChanged(t.deps.jobs, U1, { ...moved, deleted: true }, t.deps.now());
    await t.drain();
    expect(await t.index.get('highlight', H1, t.deps.embedder!.model)).toBeNull();
  });
});
