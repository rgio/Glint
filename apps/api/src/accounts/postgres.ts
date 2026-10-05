import type { Settings, SyncChange, User } from '@podcast/shared';
import type { Sql, TransactionSql } from 'postgres';

import { mergeChange, type AccountStore, type Session, type SignInRequest, type VersionedChange } from './store';

type RequestRow = {
  id: string;
  email: string;
  token_hash: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
};

const toRequest = (r: RequestRow): SignInRequest => ({
  id: r.id,
  email: r.email,
  tokenHash: r.token_hash,
  codeHash: r.code_hash,
  attempts: r.attempts,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
  createdAt: r.created_at,
});

const toUser = (r: { id: string; email: string; created_at: Date }): User => ({
  id: r.id,
  email: r.email,
  createdAt: r.created_at.toISOString(),
});

type SessionRow = {
  id: string;
  user_id: string;
  refresh_hash: string;
  platform: string;
  expires_at: Date;
  revoked_at: Date | null;
};

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  userId: r.user_id,
  refreshHash: r.refresh_hash,
  platform: r.platform,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

// bigint columns arrive as strings; client timestamps fit safely in a JS number.
const ms = (v: string | number) => Number(v);

export class PostgresAccountStore implements AccountStore {
  constructor(private sql: Sql) {}

  async createSignInRequest(r: Omit<SignInRequest, 'attempts' | 'usedAt'>) {
    await this.sql`
      insert into sign_in_requests (id, email, token_hash, code_hash, expires_at, created_at)
      values (${r.id}, ${r.email}, ${r.tokenHash}, ${r.codeHash}, ${r.expiresAt}, ${r.createdAt})`;
  }

  async countSignInRequestsSince(email: string, since: Date) {
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from sign_in_requests where email = ${email} and created_at > ${since}`;
    return row?.n ?? 0;
  }

  async findSignInRequestByToken(tokenHash: string) {
    const [row] = await this.sql<RequestRow[]>`select * from sign_in_requests where token_hash = ${tokenHash}`;
    return row ? toRequest(row) : null;
  }

  async findLatestSignInRequest(email: string) {
    const [row] = await this.sql<RequestRow[]>`
      select * from sign_in_requests where email = ${email} and used_at is null
      order by created_at desc limit 1`;
    return row ? toRequest(row) : null;
  }

  async recordSignInAttempt(id: string) {
    await this.sql`update sign_in_requests set attempts = attempts + 1 where id = ${id}`;
  }

  async markSignInRequestUsed(id: string) {
    const rows = await this.sql`update sign_in_requests set used_at = now() where id = ${id} and used_at is null returning id`;
    return rows.length === 1;
  }

  async findOrCreateUser(email: string, newId: string) {
    // `do update` (a no-op) so the existing row comes back from `returning`.
    const [row] = await this.sql<{ id: string; email: string; created_at: Date }[]>`
      insert into users (id, email) values (${newId}, ${email})
      on conflict (email) do update set email = excluded.email
      returning id, email, created_at`;
    return toUser(row!);
  }

  async findUserById(id: string) {
    const [row] = await this.sql<{ id: string; email: string; created_at: Date }[]>`
      select id, email, created_at from users where id = ${id}`;
    return row ? toUser(row) : null;
  }

  async deleteUser(id: string) {
    await this.sql`delete from users where id = ${id}`;
  }

  async createSession(s: Omit<Session, 'revokedAt'>) {
    await this.sql`
      insert into sessions (id, user_id, refresh_hash, platform, expires_at)
      values (${s.id}, ${s.userId}, ${s.refreshHash}, ${s.platform}, ${s.expiresAt})`;
  }

  async findSessionByRefreshHash(refreshHash: string) {
    const [row] = await this.sql<SessionRow[]>`select * from sessions where refresh_hash = ${refreshHash}`;
    return row ? toSession(row) : null;
  }

  async rotateSession(id: string, oldHash: string, newHash: string, expiresAt: Date) {
    const rows = await this.sql`
      update sessions set refresh_hash = ${newHash}, expires_at = ${expiresAt}, last_used_at = now()
      where id = ${id} and refresh_hash = ${oldHash} and revoked_at is null
      returning id`;
    return rows.length === 1;
  }

  async revokeSession(id: string) {
    await this.sql`update sessions set revoked_at = now() where id = ${id} and revoked_at is null`;
  }

  async applyChanges(userId: string, changes: SyncChange[]) {
    return this.sql.begin(async (tx) => {
      let applied = 0;
      for (const change of changes) {
        const existing = await this.load(tx, userId, change);
        const merged = mergeChange(existing, change);
        if (!merged) continue;
        await this.save(tx, userId, merged);
        applied++;
      }
      return applied;
    });
  }

  /** The stored value for the same key as `change`, locked until the transaction ends. */
  private async load(tx: TransactionSql, userId: string, change: SyncChange): Promise<SyncChange | undefined> {
    switch (change.kind) {
      case 'subscription': {
        const [r] = await tx<{ subscribed_at: string; auto_download: boolean; updated_at: string; deleted: boolean }[]>`
          select subscribed_at, auto_download, updated_at, deleted from user_subscriptions
          where user_id = ${userId} and podcast_id = ${change.value.podcastId} for update`;
        return r && {
          kind: 'subscription',
          value: {
            podcastId: change.value.podcastId,
            subscribedAt: ms(r.subscribed_at),
            autoDownload: r.auto_download,
            updatedAt: ms(r.updated_at),
            deleted: r.deleted,
          },
        };
      }
      case 'episodeState': {
        const [r] = await tx<{ position_sec: number; played: boolean; updated_at: string }[]>`
          select position_sec, played, updated_at from user_episode_states
          where user_id = ${userId} and episode_id = ${change.value.episodeId} for update`;
        return r && {
          kind: 'episodeState',
          value: { episodeId: change.value.episodeId, positionSec: r.position_sec, played: r.played, updatedAt: ms(r.updated_at) },
        };
      }
      case 'queueItem': {
        const [r] = await tx<{ sort_key: string; updated_at: string; deleted: boolean }[]>`
          select sort_key, updated_at, deleted from user_queue_items
          where user_id = ${userId} and episode_id = ${change.value.episodeId} for update`;
        return r && {
          kind: 'queueItem',
          value: { episodeId: change.value.episodeId, sortKey: r.sort_key, updatedAt: ms(r.updated_at), deleted: r.deleted },
        };
      }
      case 'settings': {
        const [r] = await tx<{ settings: Settings }[]>`
          select settings from user_settings where user_id = ${userId} for update`;
        return r && { kind: 'settings', value: r.settings };
      }
    }
  }

  private async save(tx: TransactionSql, userId: string, change: SyncChange) {
    switch (change.kind) {
      case 'subscription': {
        const v = change.value;
        await tx`
          insert into user_subscriptions (user_id, podcast_id, subscribed_at, auto_download, updated_at, deleted, version)
          values (${userId}, ${v.podcastId}, ${v.subscribedAt}, ${v.autoDownload}, ${v.updatedAt}, ${v.deleted}, nextval('sync_version'))
          on conflict (user_id, podcast_id) do update set subscribed_at = excluded.subscribed_at,
            auto_download = excluded.auto_download, updated_at = excluded.updated_at, deleted = excluded.deleted,
            version = excluded.version`;
        return;
      }
      case 'episodeState': {
        const v = change.value;
        await tx`
          insert into user_episode_states (user_id, episode_id, position_sec, played, updated_at, version)
          values (${userId}, ${v.episodeId}, ${v.positionSec}, ${v.played}, ${v.updatedAt}, nextval('sync_version'))
          on conflict (user_id, episode_id) do update set position_sec = excluded.position_sec,
            played = excluded.played, updated_at = excluded.updated_at, version = excluded.version`;
        return;
      }
      case 'queueItem': {
        const v = change.value;
        await tx`
          insert into user_queue_items (user_id, episode_id, sort_key, updated_at, deleted, version)
          values (${userId}, ${v.episodeId}, ${v.sortKey}, ${v.updatedAt}, ${v.deleted}, nextval('sync_version'))
          on conflict (user_id, episode_id) do update set sort_key = excluded.sort_key,
            updated_at = excluded.updated_at, deleted = excluded.deleted, version = excluded.version`;
        return;
      }
      case 'settings': {
        await tx`
          insert into user_settings (user_id, settings, updated_at, version)
          values (${userId}, ${tx.json(change.value)}, ${change.value.updatedAt}, nextval('sync_version'))
          on conflict (user_id) do update set settings = excluded.settings, updated_at = excluded.updated_at,
            version = excluded.version`;
        return;
      }
    }
  }

  async changesSince(userId: string, since: bigint, limit: number): Promise<VersionedChange[]> {
    const after = since.toString();
    const [subs, states, queue, settings] = await Promise.all([
      this.sql<{ podcast_id: string; subscribed_at: string; auto_download: boolean; updated_at: string; deleted: boolean; version: string }[]>`
        select podcast_id, subscribed_at, auto_download, updated_at, deleted, version from user_subscriptions
        where user_id = ${userId} and version > ${after} order by version limit ${limit}`,
      this.sql<{ episode_id: string; position_sec: number; played: boolean; updated_at: string; version: string }[]>`
        select episode_id, position_sec, played, updated_at, version from user_episode_states
        where user_id = ${userId} and version > ${after} order by version limit ${limit}`,
      this.sql<{ episode_id: string; sort_key: string; updated_at: string; deleted: boolean; version: string }[]>`
        select episode_id, sort_key, updated_at, deleted, version from user_queue_items
        where user_id = ${userId} and version > ${after} order by version limit ${limit}`,
      this.sql<{ settings: Settings; version: string }[]>`
        select settings, version from user_settings where user_id = ${userId} and version > ${after}`,
    ]);
    const all: VersionedChange[] = [
      ...subs.map((r): VersionedChange => ({
        kind: 'subscription',
        value: { podcastId: r.podcast_id, subscribedAt: ms(r.subscribed_at), autoDownload: r.auto_download, updatedAt: ms(r.updated_at), deleted: r.deleted },
        version: BigInt(r.version),
      })),
      ...states.map((r): VersionedChange => ({
        kind: 'episodeState',
        value: { episodeId: r.episode_id, positionSec: r.position_sec, played: r.played, updatedAt: ms(r.updated_at) },
        version: BigInt(r.version),
      })),
      ...queue.map((r): VersionedChange => ({
        kind: 'queueItem',
        value: { episodeId: r.episode_id, sortKey: r.sort_key, updatedAt: ms(r.updated_at), deleted: r.deleted },
        version: BigInt(r.version),
      })),
      ...settings.map((r): VersionedChange => ({ kind: 'settings', value: r.settings, version: BigInt(r.version) })),
    ];
    return all.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0)).slice(0, limit);
  }
}
