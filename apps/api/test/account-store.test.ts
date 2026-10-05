import { existsSync } from 'node:fs';

import { migrate } from '@podcast/catalog';
import type { SyncChange } from '@podcast/shared';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresAccountStore } from '../src/accounts/postgres';
import { InMemoryAccountStore, type AccountStore } from '../src/accounts/store';

// The Postgres suite runs when TEST_DATABASE_URL is set (see .env.example), and is skipped otherwise.
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const sub = (podcastId: string, updatedAt: number, deleted = false): SyncChange => ({
  kind: 'subscription',
  value: { podcastId, subscribedAt: 1000, autoDownload: false, updatedAt, deleted },
});
const state = (episodeId: string, positionSec: number, updatedAt: number, played = false): SyncChange => ({
  kind: 'episodeState',
  value: { episodeId, positionSec, played, updatedAt },
});

function accountStoreContract(makeStore: () => Promise<AccountStore>) {
  let store: AccountStore;
  beforeEach(async () => {
    store = await makeStore();
  });

  it('finds or creates users by email', async () => {
    const a = await store.findOrCreateUser('a@example.com', U1);
    const again = await store.findOrCreateUser('a@example.com', U2);
    expect(again).toEqual(a);
    expect(a).toMatchObject({ id: U1, email: 'a@example.com' });
    expect(await store.findUserById(U1)).toEqual(a);
    expect(await store.findUserById(U2)).toBeNull();
  });

  it('keeps sign-in requests usable once, newest first, with an attempt count', async () => {
    const base = { email: 'a@example.com', codeHash: 'c', expiresAt: new Date(Date.now() + 60_000) };
    await store.createSignInRequest({ ...base, id: '10000000-0000-4000-8000-000000000001', tokenHash: 't1', createdAt: new Date(Date.now() - 2000) });
    await store.createSignInRequest({ ...base, id: '10000000-0000-4000-8000-000000000002', tokenHash: 't2', createdAt: new Date(Date.now() - 1000) });

    expect(await store.countSignInRequestsSince('a@example.com', new Date(Date.now() - 60_000))).toBe(2);
    const latest = await store.findLatestSignInRequest('a@example.com');
    expect(latest?.tokenHash).toBe('t2');
    await store.recordSignInAttempt(latest!.id);
    expect((await store.findSignInRequestByToken('t2'))?.attempts).toBe(1);

    expect(await store.markSignInRequestUsed(latest!.id)).toBe(true);
    expect(await store.markSignInRequestUsed(latest!.id)).toBe(false);
    expect((await store.findLatestSignInRequest('a@example.com'))?.tokenHash).toBe('t1');
  });

  it('rotates a refresh token only once', async () => {
    await store.findOrCreateUser('a@example.com', U1);
    const id = '20000000-0000-4000-8000-000000000001';
    await store.createSession({ id, userId: U1, refreshHash: 'r1', platform: 'web', expiresAt: new Date(Date.now() + 60_000) });
    expect(await store.rotateSession(id, 'r1', 'r2', new Date(Date.now() + 120_000))).toBe(true);
    expect(await store.rotateSession(id, 'r1', 'r3', new Date(Date.now() + 120_000))).toBe(false);
    expect((await store.findSessionByRefreshHash('r2'))?.id).toBe(id);
    expect(await store.findSessionByRefreshHash('r1')).toBeNull();

    await store.revokeSession(id);
    expect((await store.findSessionByRefreshHash('r2'))?.revokedAt).toBeInstanceOf(Date);
    expect(await store.rotateSession(id, 'r2', 'r4', new Date())).toBe(false);
  });

  it('applies changes with the merge rules and lists them by version', async () => {
    await store.findOrCreateUser('a@example.com', U1);
    expect(await store.applyChanges(U1, [sub('pod_a', 100), state('ep_1', 60, 100)])).toBe(2);
    // An older subscription write loses; a newer one wins.
    expect(await store.applyChanges(U1, [sub('pod_a', 50, true)])).toBe(0);
    expect(await store.applyChanges(U1, [sub('pod_a', 200, true)])).toBe(1);
    // Within 2 s of each other the further position wins, even over the newer write; only the
    // timestamp moves forward.
    expect(await store.applyChanges(U1, [state('ep_1', 30, 1100)])).toBe(1);
    expect((await store.changesSince(U1, 0n, 10)).find((c) => c.kind === 'episodeState')?.value).toEqual({
      episodeId: 'ep_1',
      positionSec: 60,
      played: false,
      updatedAt: 1100,
    });
    // Identical values change nothing.
    expect(await store.applyChanges(U1, [state('ep_1', 60, 100)])).toBe(0);
    const settings: SyncChange = {
      kind: 'settings',
      value: { skipBackSec: 10, skipForwardSec: 30, playbackRate: 1.5, wifiOnlyDownloads: true, autoDeletePlayed: true, updatedAt: 300 },
    };
    expect(await store.applyChanges(U1, [settings, { kind: 'queueItem', value: { episodeId: 'ep_2', sortKey: 'm', updatedAt: 300, deleted: false } }])).toBe(2);

    const all = await store.changesSince(U1, 0n, 100);
    expect(all.map((c) => c.kind)).toEqual(['subscription', 'episodeState', 'settings', 'queueItem']);
    expect(all[0]).toMatchObject({ kind: 'subscription', value: { podcastId: 'pod_a', deleted: true, updatedAt: 200 } });
    expect(all[2]?.value).toEqual(settings.value);
    const versions = all.map((c) => c.version);
    expect([...versions].sort((a, b) => (a < b ? -1 : 1))).toEqual(versions);

    const after = await store.changesSince(U1, all[1]!.version, 100);
    expect(after.map((c) => c.kind)).toEqual(['settings', 'queueItem']);
    expect(await store.changesSince(U1, 0n, 2)).toHaveLength(2);
  });

  it('merges highlights field by field and lets deletions win', async () => {
    await store.findOrCreateUser('a@example.com', U1);
    const h = {
      id: '30000000-0000-4000-8000-000000000001',
      episodeId: 'ep_1',
      podcastId: 'pod_1',
      startSec: 100,
      endSec: 130,
      note: null,
      transcriptExcerpt: null,
      chapterTitle: null,
      anchorDurationSec: 1800,
      anchorEnclosureUrl: null,
      source: 'player' as const,
      createdAt: 1000,
      rangeUpdatedAt: 1000,
      noteUpdatedAt: 1000,
      deleted: false,
    };
    expect(await store.applyChanges(U1, [{ kind: 'highlight', value: h }])).toBe(1);
    // Two devices: one adjusts the range, the other adds a note. Both survive.
    await store.applyChanges(U1, [{ kind: 'highlight', value: { ...h, startSec: 90, rangeUpdatedAt: 2000 } }]);
    await store.applyChanges(U1, [{ kind: 'highlight', value: { ...h, note: 'idea', noteUpdatedAt: 3000 } }]);
    const [stored] = await store.changesSince(U1, 0n, 10);
    expect(stored).toMatchObject({ kind: 'highlight', value: { startSec: 90, note: 'idea', deleted: false } });

    await store.applyChanges(U1, [{ kind: 'highlight', value: { ...h, deleted: true } }]);
    await store.applyChanges(U1, [{ kind: 'highlight', value: { ...h, note: 'late edit', noteUpdatedAt: 9000 } }]);
    expect((await store.changesSince(U1, 0n, 10))[0]?.value).toMatchObject({ deleted: true });
  });

  it('keeps users apart and deletes everything with the account', async () => {
    await store.findOrCreateUser('a@example.com', U1);
    await store.findOrCreateUser('b@example.com', U2);
    await store.applyChanges(U1, [sub('pod_a', 100)]);
    await store.applyChanges(U2, [sub('pod_b', 100)]);
    expect((await store.changesSince(U2, 0n, 10)).map((c) => (c.value as { podcastId: string }).podcastId)).toEqual(['pod_b']);

    await store.createSession({ id: '20000000-0000-4000-8000-000000000009', userId: U1, refreshHash: 'rx', platform: 'native', expiresAt: new Date(Date.now() + 60_000) });
    await store.deleteUser(U1);
    expect(await store.findUserById(U1)).toBeNull();
    expect(await store.changesSince(U1, 0n, 10)).toEqual([]);
    expect(await store.findSessionByRefreshHash('rx')).toBeNull();
    expect(await store.changesSince(U2, 0n, 10)).toHaveLength(1);
  });
}

describe('InMemoryAccountStore', () => {
  accountStoreContract(async () => new InMemoryAccountStore());
});

describe.skipIf(!TEST_DATABASE_URL)('PostgresAccountStore', () => {
  const sql = postgres(TEST_DATABASE_URL ?? '', { onnotice: () => {} });
  afterAll(() => sql.end());
  accountStoreContract(async () => {
    await migrate(sql);
    await sql`truncate users, sign_in_requests cascade`;
    return new PostgresAccountStore(sql);
  });
});
