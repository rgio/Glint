import { existsSync } from 'node:fs';

import { migrate, PostgresCatalogStore } from '@podcast/catalog';
import type { Episode, Podcast } from '@podcast/shared';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EMBEDDING_DIMENSIONS,
  HashingEmbedder,
  InMemoryJobQueue,
  InMemoryTranscriptStore,
  InMemoryVectorIndex,
  normalize,
  PgvectorIndex,
  PostgresCatalogQueries,
  PostgresJobQueue,
  PostgresTranscriptStore,
  PostgresUserDataStore,
  type JobQueue,
  type TranscriptStore,
  type VectorIndex,
  type VectorRow,
} from '../src';

// The Postgres suites run when TEST_DATABASE_URL is set (see this package's .env.example; the
// database needs pgvector), and are skipped otherwise.
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const U1 = '00000000-0000-4000-8000-0000000000c1';
const T0 = new Date(Date.UTC(2026, 9, 9, 12));
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

const podcast = (id: string, language = 'en'): Podcast => ({
  id,
  feedUrl: `https://example.com/${id}.xml`,
  title: `Show ${id}`,
  author: null,
  description: null,
  artworkUrl: null,
  language,
  categories: [],
  explicit: false,
  lastPublishedAt: null,
});
const episode = (id: string, podcastId: string, publishedAt = '2026-10-01T00:00:00.000Z'): Episode => ({
  id,
  podcastId,
  guid: `g-${id}`,
  title: `Episode ${id}`,
  publishedAt,
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

function jobQueueContract(make: () => Promise<JobQueue>) {
  let jobs: JobQueue;
  beforeEach(async () => {
    jobs = await make();
  });

  it('keeps one waiting job per kind and key', async () => {
    expect(await jobs.enqueue('chunk', 't1', { runAt: T0 })).toBe(true);
    expect(await jobs.enqueue('chunk', 't1', { runAt: T0 })).toBe(false);
    expect(await jobs.enqueue('chunk', 't2', { runAt: T0 })).toBe(true);
    expect(await jobs.enqueue('embed.transcript', 't1', { runAt: T0 })).toBe(true);
    expect(await jobs.pending()).toHaveLength(3);
  });

  it('claims due jobs with a lease, and hands them out again when it runs out', async () => {
    await jobs.enqueue('chunk', 'now', { runAt: T0, payload: { a: 1 } });
    await jobs.enqueue('chunk', 'later', { runAt: at(60) });
    const [job] = await jobs.claim({ now: T0, leaseMs: 30_000, limit: 10 });
    expect(job).toMatchObject({ kind: 'chunk', key: 'now', payload: { a: 1 }, attempts: 0 });
    expect(await jobs.claim({ now: at(10), leaseMs: 30_000, limit: 10 })).toEqual([]);
    expect((await jobs.claim({ now: at(61), leaseMs: 30_000, limit: 10 })).map((j) => j.key)).toEqual(['now', 'later']);
  });

  it('completes, retries later with an attempt count, and fails', async () => {
    await jobs.enqueue('chunk', 'a', { runAt: T0 });
    await jobs.enqueue('chunk', 'b', { runAt: T0 });
    const [a, b] = await jobs.claim({ now: T0, leaseMs: 30_000, limit: 10 });
    await jobs.complete(a!.id);
    await jobs.retry(b!.id, { runAt: at(100), error: 'boom', payload: { polls: 2 } });
    expect(await jobs.enqueue('chunk', 'a', { runAt: T0 })).toBe(true); // done jobs free their key
    const again = await jobs.claim({ now: at(100), leaseMs: 30_000, limit: 10 });
    expect(again.find((j) => j.key === 'b')).toMatchObject({ attempts: 1, payload: { polls: 2 } });
    await jobs.fail(again.find((j) => j.key === 'b')!.id, 'gave up');
    expect((await jobs.pending()).map((j) => j.key)).toEqual(['a']);
  });

  it('runs a waiting job now, or enqueues it', async () => {
    await jobs.enqueue('transcript.request', 'ep', { runAt: at(1000) });
    await jobs.runNow('transcript.request', 'ep');
    expect((await jobs.claim({ now: new Date(), leaseMs: 1000, limit: 10 })).map((j) => j.key)).toEqual(['ep']);
    await jobs.runNow('chunk', 'new');
    expect((await jobs.pending()).map((j) => j.key)).toContain('new');
  });
}

function transcriptStoreContract(make: () => Promise<TranscriptStore>) {
  let store: TranscriptStore;
  beforeEach(async () => {
    store = await make();
  });

  const content = {
    segments: [
      { startMs: 0, endMs: 10_000, speaker: 'A', text: 'First.' },
      { startMs: 10_000, endMs: 20_000, speaker: 'B', text: 'Second.' },
      { startMs: 20_000, endMs: 31_000, speaker: null, text: 'Third.' },
    ],
    chapters: [{ startMs: 0, title: 'Only chapter' }],
    takeaways: [{ startMs: 5000, text: 'A point', tags: ['Tag'] }],
    raw: { any: 'thing' },
  };

  it('reports none, pending, unavailable and ready', async () => {
    expect(await store.status('ep_1')).toEqual({ status: 'none', source: null });
    await store.markPending('ep_1', 'dlogos', { externalId: 'x', pollUrl: '/poll' });
    expect(await store.status('ep_1')).toEqual({ status: 'pending', source: 'dlogos' });
    expect(await store.find('ep_1', 'dlogos')).toMatchObject({ externalId: 'x', pollUrl: '/poll', status: 'pending' });
    await store.markFailed('ep_1', 'dlogos', 'unavailable', 'no mapping');
    expect(await store.status('ep_1')).toEqual({ status: 'unavailable', source: null });
    await store.saveReady('ep_1', 'publisher_vtt', { language: 'en' }, content);
    expect(await store.status('ep_1')).toEqual({ status: 'ready', source: 'publisher_vtt' });
  });

  it('prefers dLogos once it is ready, and serves segments in a range', async () => {
    await store.saveReady('ep_1', 'publisher_vtt', {}, content);
    const d = await store.saveReady('ep_1', 'dlogos', { reportedDurationSec: 25, audioUrl: 'https://a.example/x.mp3' }, content);
    expect(d).toMatchObject({ status: 'ready', audioDurationSec: 31, reportedDurationSec: 25 });
    expect((await store.current('ep_1'))?.id).toBe(d.id);
    expect((await store.segments(d.id, { fromMs: 12_000, toMs: 21_000 })).map((s) => [s.idx, s.text])).toEqual([
      [1, 'Second.'],
      [2, 'Third.'],
    ]);
    expect(await store.chapters(d.id)).toEqual(content.chapters);
    expect(await store.takeaways(d.id)).toEqual(content.takeaways);
  });

  it('replaces content and chunks on a new save', async () => {
    const t = await store.saveReady('ep_1', 'dlogos', {}, content);
    await store.saveChunks(t.id, 1, [{ kind: 'window', segFrom: 0, segTo: 1, startMs: 0, endMs: 20_000, text: 'w', isAd: false }]);
    expect(await store.chunks(t.id, 1)).toHaveLength(1);
    const again = await store.saveReady('ep_1', 'dlogos', {}, { ...content, segments: content.segments.slice(0, 1) });
    expect(again.id).toBe(t.id);
    expect(await store.segments(t.id)).toHaveLength(1);
    const chunks = await store.saveChunks(t.id, 1, [{ kind: 'takeaway', segFrom: null, segTo: null, startMs: 5000, endMs: 5000, text: 'A point', isAd: false }]);
    expect(await store.chunks(t.id, 1)).toEqual(chunks);
  });

  it('maps shows to dLogos and counts requests per day', async () => {
    expect(await store.dlogosSlug('pod_1')).toBeNull();
    await store.setDlogosSlug('pod_1', 'show-abc', 'manual');
    expect(await store.dlogosSlug('pod_1')).toBe('show-abc');
    expect(await store.countDlogosRequest('2026-10-09', 'seed')).toBe(1);
    expect(await store.countDlogosRequest('2026-10-09', 'seed')).toBe(2);
    expect(await store.dlogosRequests('2026-10-09', 'seed')).toBe(2);
    expect(await store.dlogosRequests('2026-10-09', 'highlight')).toBe(0);
  });
}

async function vectors(texts: string[]) {
  return new HashingEmbedder().embed(texts);
}

const MODEL = 'hashing-v1@512';
const row = (ownerKind: VectorRow['ownerKind'], ownerId: string, vec: Float32Array, extra: Partial<VectorRow> = {}): VectorRow => ({
  ownerKind,
  ownerId,
  userId: null,
  episodeId: null,
  podcastId: null,
  language: null,
  startMs: null,
  model: MODEL,
  inputHash: 'h',
  vec,
  ...extra,
});

function vectorIndexContract(make: () => Promise<VectorIndex>) {
  let index: VectorIndex;
  beforeEach(async () => {
    index = await make();
  });

  it('finds the nearest global vectors, with filters', async () => {
    const [bread, sourdough, chess, query] = await vectors(['bread baking', 'sourdough bread baking at home', 'chess openings', 'baking bread']);
    await index.upsert([
      row('episode', 'ep_1', bread!, { episodeId: 'ep_1', language: 'en' }),
      row('chunk', '1', sourdough!, { episodeId: 'ep_2', language: 'en', startMs: 60_000 }),
      row('episode', 'ep_3', chess!, { episodeId: 'ep_3', language: 'en' }),
      row('episode', 'ep_es', bread!, { episodeId: 'ep_es', language: 'es' }),
      row('highlight', 'h1', bread!, { userId: U1, episodeId: 'ep_9' }),
    ]);
    const hits = await index.search(query!, { k: 2, filter: { model: MODEL, ownerKinds: ['episode', 'chunk'], language: 'en' } });
    expect(hits.map((h) => h.ownerId)).toEqual(['ep_1', '1']);
    expect(hits[1]).toMatchObject({ ownerKind: 'chunk', episodeId: 'ep_2', startMs: 60_000 });
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);

    const excluded = await index.search(query!, { k: 5, filter: { model: MODEL, ownerKinds: ['episode', 'chunk'], excludeEpisodeIds: ['ep_1'] } });
    expect(excluded.map((h) => h.ownerId)).not.toContain('ep_1');
    expect(excluded.map((h) => h.ownerId)).not.toContain('h1'); // per-user vectors stay out of global search

    const mine = await index.search(query!, { k: 5, filter: { model: MODEL, ownerKinds: ['highlight'], userId: U1 } });
    expect(mine.map((h) => h.ownerId)).toEqual(['h1']);
  });

  it('gets, lists, prunes and deletes', async () => {
    const [v] = await vectors(['anything']);
    await index.upsert([
      row('chunk', '1', v!, { episodeId: 'ep_1' }),
      row('chunk', '2', v!, { episodeId: 'ep_1' }),
      row('highlight', 'h1', v!, { userId: U1, inputHash: 'abc' }),
    ]);
    expect(await index.get('highlight', 'h1', MODEL)).toMatchObject({ inputHash: 'abc', userId: U1 });
    expect((await index.get('highlight', 'h1', MODEL))!.vec[0]).toBeCloseTo(v![0]!, 2);
    expect(await index.listForUser(U1, ['highlight'], MODEL)).toHaveLength(1);
    expect(await index.episodesWith('chunk', ['ep_1', 'ep_2'], MODEL)).toEqual(new Set(['ep_1']));
    await index.prune('chunk', 'ep_1', ['2']);
    expect(await index.get('chunk', '1', MODEL)).toBeNull();
    expect(await index.get('chunk', '2', MODEL)).not.toBeNull();
    await index.delete([{ ownerKind: 'highlight', ownerId: 'h1' }]);
    expect(await index.get('highlight', 'h1', MODEL)).toBeNull();
  });
}

describe('in memory', () => {
  describe('JobQueue', () => jobQueueContract(async () => new InMemoryJobQueue()));
  describe('TranscriptStore', () => transcriptStoreContract(async () => new InMemoryTranscriptStore()));
  describe('VectorIndex', () => vectorIndexContract(async () => new InMemoryVectorIndex()));
});

describe.skipIf(!TEST_DATABASE_URL)('Postgres', () => {
  const sql = postgres(TEST_DATABASE_URL ?? '', { onnotice: () => {} });
  afterAll(() => sql.end());

  const reset = async () => {
    await migrate(sql);
    await sql`truncate podcasts, users, jobs, dlogos_usage, embeddings cascade`;
    const catalog = new PostgresCatalogStore(sql);
    for (const id of ['pod_1', 'pod_2']) await catalog.upsertPodcast(podcast(id), { etag: null, lastModified: null, fetchedAt: null });
    await catalog.upsertEpisodes([episode('ep_1', 'pod_1'), episode('ep_2', 'pod_1'), episode('ep_3', 'pod_2'), episode('ep_9', 'pod_2'), episode('ep_es', 'pod_2')]);
    await sql`insert into users (id, email) values (${U1}, 'content@example.com')`;
  };

  describe('JobQueue', () =>
    jobQueueContract(async () => {
      await reset();
      return new PostgresJobQueue(sql);
    }));
  describe('TranscriptStore', () =>
    transcriptStoreContract(async () => {
      await reset();
      return new PostgresTranscriptStore(sql);
    }));
  describe('VectorIndex', () =>
    vectorIndexContract(async () => {
      await reset();
      return new PgvectorIndex(sql);
    }));

  it('concurrent claims never hand out the same job', async () => {
    await reset();
    const jobs = new PostgresJobQueue(sql);
    for (let i = 0; i < 40; i++) await jobs.enqueue('chunk', `t${i}`, { runAt: T0 });
    const batches = await Promise.all(Array.from({ length: 4 }, () => jobs.claim({ now: at(1), leaseMs: 60_000, limit: 15 })));
    const keys = batches.flat().map((j) => j.key);
    expect(keys).toHaveLength(40);
    expect(new Set(keys).size).toBe(40);
  });

  it('saves highlight context only for the current range, and bumps the sync version', async () => {
    await reset();
    const id = '6a6f0b4e-8a4a-4c8e-9f0e-1d2c3b4a5f61';
    await sql`
      insert into highlights (user_id, id, episode_id, podcast_id, start_sec, end_sec, note, source, created_at,
        range_updated_at, note_updated_at, version)
      values (${U1}, ${id}, 'ep_1', 'pod_1', 10, 40, 'a note', 'player', 1000, 2000, 1000, nextval('sync_version'))`;
    const version = async () => (await sql<{ version: string }[]>`select version from highlights where id = ${id}`)[0]!.version;
    const before = await version();
    const users = new PostgresUserDataStore(sql);
    const ctx = { transcriptId: null, excerpt: 'the words', chapterTitle: 'Ch', offsetSec: 0, confidence: 'exact' as const };
    expect(await users.saveHighlightContext(U1, id, { ...ctx, forRangeUpdatedAt: 1999 })).toBe(false);
    expect(await users.saveHighlightContext(U1, id, { ...ctx, forRangeUpdatedAt: 2000 })).toBe(true);
    expect(await users.getHighlight(U1, id)).toMatchObject({ transcriptExcerpt: 'the words', chapterTitle: 'Ch', transcriptConfidence: 'exact', note: 'a note' });
    expect(BigInt(await version())).toBeGreaterThan(BigInt(before));

    // A range edit hides the context until it's recomputed.
    await sql`update highlights set range_updated_at = 3000 where id = ${id}`;
    expect((await users.getHighlight(U1, id))!.transcriptExcerpt).toBeNull();

    await sql`insert into user_queue_items (user_id, episode_id, sort_key, updated_at, version) values (${U1}, 'ep_2', 'a', 1, nextval('sync_version'))`;
    expect(await users.touchedEpisodes(U1)).toEqual(new Set(['ep_1', 'ep_2']));
    expect(await new PostgresCatalogQueries(sql).windowsWanted('ep_1')).toBe(true);
    expect(await new PostgresCatalogQueries(sql).windowsWanted('ep_3')).toBe(false);

    // Deleting the account deletes its highlights, context and vectors.
    const [v] = await vectors(['x']);
    await new PgvectorIndex(sql).upsert([row('highlight', id, v!, { userId: U1 })]);
    await sql`delete from users where id = ${U1}`;
    const [left] = await sql<{ n: number }[]>`
      select (select count(*) from highlights) + (select count(*) from highlight_context)
        + (select count(*) from embeddings where user_id is not null) as n`;
    expect(Number(left!.n)).toBe(0);
  });

  it('lists episodes missing a description vector, and seed candidates by demand', async () => {
    await reset();
    const queries = new PostgresCatalogQueries(sql);
    const [v] = await vectors(['x']);
    await new PgvectorIndex(sql).upsert([row('episode', 'ep_1', v!, { episodeId: 'ep_1' })]);
    const missing = (await queries.episodesMissingVector(MODEL, 10)).map((e) => e.episode.id);
    expect(missing).not.toContain('ep_1');
    expect(missing).toContain('ep_2');
    expect((await queries.episode('ep_3'))?.podcast.title).toBe('Show pod_2');

    await new PostgresTranscriptStore(sql).setDlogosSlug('pod_1', 'show-1', 'manual');
    await new PostgresTranscriptStore(sql).saveReady('ep_1', 'dlogos', {}, { segments: [], chapters: [], takeaways: [] });
    expect((await queries.seedCandidates(10)).map((c) => c.episodeId)).toEqual(['ep_2']);
  });

  it('measures recall against exact search', async () => {
    await reset();
    // Seeded random unit vectors: no ties, so exact and approximate search agree on what's nearest.
    let seed = 42;
    const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31) - 0.5;
    const vecs = Array.from({ length: 30 }, () => normalize(Float32Array.from({ length: EMBEDDING_DIMENSIONS }, random)));
    await new PgvectorIndex(sql).upsert(vecs.map((v, i) => row('episode', `e${i}`, v)));
    const result = await new PgvectorIndex(sql).recallSample(MODEL, { samples: 5, k: 5 });
    expect(result.samples).toBe(5);
    expect(result.recall).toBeGreaterThan(0.8);
    expect(result.vectors).toBe(30);
  });
});
