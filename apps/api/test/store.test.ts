import { existsSync } from 'node:fs';

import type { Episode, Podcast } from '@podcast/shared';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../src/db/migrate';
import { PostgresCatalogStore } from '../src/postgres-store';
import { InMemoryCatalogStore, type CatalogStore } from '../src/store';

// The Postgres suite runs when TEST_DATABASE_URL is set (see .env.example), and is skipped otherwise.
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const podcast: Podcast = {
  id: 'pod_1',
  feedUrl: 'https://example.com/feed.xml',
  title: 'Show',
  author: 'Host',
  description: 'About the show',
  artworkUrl: 'https://example.com/art.jpg',
  language: 'en',
  categories: ['News', 'Technology'],
  explicit: true,
  lastPublishedAt: '2026-09-30T08:00:00.000Z',
};

const noCache = { etag: null, lastModified: null, fetchedAt: null };

const episode = (id: string, publishedAt: string | null, extra: Partial<Episode> = {}): Episode => ({
  id,
  podcastId: 'pod_1',
  guid: `guid-${id}`,
  title: `Episode ${id}`,
  publishedAt,
  durationSec: 1834.5,
  enclosureUrl: `https://example.com/${id}.mp3`,
  enclosureType: 'audio/mpeg',
  enclosureBytes: 5_000_000_000, // over 2^32, to check bigint survives
  showNotesHtml: '<p>Notes</p>',
  artworkUrl: null,
  season: 2,
  episodeNumber: 7,
  ...extra,
});

function catalogStoreContract(makeStore: () => Promise<CatalogStore>) {
  let store: CatalogStore;
  beforeEach(async () => {
    store = await makeStore();
  });

  it('stores and finds podcasts by id and feed URL', async () => {
    await store.upsertPodcast(podcast, { ...noCache, etag: '"v1"', lastModified: 'Wed, 30 Sep 2026 08:00:00 GMT' });
    expect(await store.findPodcastById('pod_1')).toEqual(podcast);
    expect(await store.findPodcastByFeedUrl('https://example.com/feed.xml')).toEqual(podcast);
    expect(await store.findPodcastById('pod_missing')).toBeNull();
    expect(await store.findPodcastByFeedUrl('https://example.com/other.xml')).toBeNull();
  });

  it('round-trips empty and null fields', async () => {
    const bare = {
      ...podcast,
      author: null,
      description: null,
      artworkUrl: null,
      language: null,
      categories: [],
      explicit: false,
      lastPublishedAt: null,
    };
    await store.upsertPodcast(bare, noCache);
    expect(await store.findPodcastById('pod_1')).toEqual(bare);
    expect(await store.getFeedCache('pod_1')).toEqual(noCache);
  });

  it('updates a podcast and its feed cache info', async () => {
    await store.upsertPodcast(podcast, { ...noCache, etag: '"v1"', fetchedAt: '2026-09-30T08:00:00.000Z' });
    const v2 = { etag: '"v2"', lastModified: 'Thu, 01 Oct 2026 09:00:00 GMT', fetchedAt: '2026-10-01T09:00:00.123Z' };
    await store.upsertPodcast({ ...podcast, title: 'Renamed' }, v2);
    expect((await store.findPodcastById('pod_1'))?.title).toBe('Renamed');
    expect(await store.getFeedCache('pod_1')).toEqual(v2);
    expect(await store.getFeedCache('pod_missing')).toBeNull();
  });

  it('upserts episodes by id and round-trips every field', async () => {
    await store.upsertPodcast(podcast, noCache);
    const first = episode('ep_a', '2026-09-01T10:00:00.000Z');
    const bare = episode('ep_b', null, {
      durationSec: null,
      enclosureType: null,
      enclosureBytes: null,
      showNotesHtml: null,
      season: null,
      episodeNumber: null,
    });
    await store.upsertEpisodes([first, bare]);
    await store.upsertEpisodes([{ ...first, title: 'Edited' }]);

    const all = await store.listEpisodes('pod_1', { offset: 0, limit: 10, sort: 'newest' });
    expect(all).toEqual([{ ...first, title: 'Edited' }, bare]);
  });

  it('pages newest and oldest first, with undated episodes at the end of newest', async () => {
    await store.upsertPodcast(podcast, noCache);
    await store.upsertEpisodes([
      episode('ep_mid', '2026-09-15T00:00:00.000Z'),
      episode('ep_undated', null),
      episode('ep_new', '2026-09-30T00:00:00.000Z'),
      // Same date as ep_mid: ties are broken by id in byte order (uppercase sorts first).
      episode('ep_Mid', '2026-09-15T00:00:00.000Z'),
      episode('ep_old', '2026-09-01T00:00:00.000Z'),
    ]);
    const ids = async (sort: 'newest' | 'oldest', offset: number, limit: number) =>
      (await store.listEpisodes('pod_1', { offset, limit, sort })).map((e) => e.id);

    expect(await ids('newest', 0, 10)).toEqual(['ep_new', 'ep_Mid', 'ep_mid', 'ep_old', 'ep_undated']);
    expect(await ids('oldest', 0, 10)).toEqual(['ep_undated', 'ep_old', 'ep_Mid', 'ep_mid', 'ep_new']);
    expect(await ids('newest', 1, 2)).toEqual(['ep_Mid', 'ep_mid']);
    expect(await ids('newest', 10, 2)).toEqual([]);
    expect(await store.listEpisodes('pod_missing', { offset: 0, limit: 10, sort: 'newest' })).toEqual([]);
  });

  it('handles a feed with thousands of episodes', async () => {
    await store.upsertPodcast(podcast, noCache);
    const many = Array.from({ length: 2500 }, (_, i) =>
      episode(`ep_${String(i).padStart(4, '0')}`, new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString()),
    );
    await store.upsertEpisodes(many);
    const newest = await store.listEpisodes('pod_1', { offset: 0, limit: 1, sort: 'newest' });
    expect(newest[0]?.id).toBe('ep_2499');
    expect(await store.listEpisodes('pod_1', { offset: 2499, limit: 5, sort: 'newest' })).toHaveLength(1);
  });
}

describe('InMemoryCatalogStore', () => {
  catalogStoreContract(async () => new InMemoryCatalogStore());
});

describe.skipIf(!TEST_DATABASE_URL)('PostgresCatalogStore', () => {
  const sql = postgres(TEST_DATABASE_URL ?? '', { onnotice: () => {} });

  afterAll(() => sql.end());

  catalogStoreContract(async () => {
    await migrate(sql);
    await sql`truncate podcasts cascade`;
    return new PostgresCatalogStore(sql);
  });

  it('migrations are idempotent', async () => {
    await migrate(sql);
    expect(await migrate(sql)).toEqual([]);
  });
});
