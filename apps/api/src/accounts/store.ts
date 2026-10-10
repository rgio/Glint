import {
  changeKey,
  lastWriteWins,
  mergeEpisodeState,
  mergeHighlight,
  type Highlight,
  type EpisodeState,
  type QueueItem,
  type Settings,
  type Subscription,
  type SyncChange,
  type User,
  withoutDerivedFields,
} from '@podcast/shared';

export type SignInRequest = {
  id: string;
  email: string;
  tokenHash: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type Session = {
  id: string;
  userId: string;
  refreshHash: string;
  platform: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** A change as stored: the synced value plus the server version that orders it. */
export type VersionedChange = SyncChange & { version: bigint };

export type HighlightPage = { highlights: Highlight[]; hasMore: boolean };

/** Accounts, sessions and per-user synced state. Postgres in production, in memory for tests. */
export interface AccountStore {
  createSignInRequest(request: Omit<SignInRequest, 'attempts' | 'usedAt'>): Promise<void>;
  /** Requests for this email made after `since`. */
  countSignInRequestsSince(email: string, since: Date): Promise<number>;
  findSignInRequestByToken(tokenHash: string): Promise<SignInRequest | null>;
  /** The newest unused request for this email, for checking a typed code. */
  findLatestSignInRequest(email: string): Promise<SignInRequest | null>;
  recordSignInAttempt(id: string): Promise<void>;
  /** Marks a request used; false if it was already used (so a link or code works once). */
  markSignInRequestUsed(id: string): Promise<boolean>;

  findOrCreateUser(email: string, newId: string): Promise<User>;
  findUserById(id: string): Promise<User | null>;
  /** Deletes the account and everything that belongs to it. */
  deleteUser(id: string): Promise<void>;

  createSession(session: Omit<Session, 'revokedAt'>): Promise<void>;
  findSessionByRefreshHash(refreshHash: string): Promise<Session | null>;
  /** Swaps the refresh token, only if it is still `oldHash` (so a token can be used once). */
  rotateSession(id: string, oldHash: string, newHash: string, expiresAt: Date): Promise<boolean>;
  revokeSession(id: string): Promise<void>;

  /** Applies pushed changes with the shared merge rules; returns how many changed anything. */
  applyChanges(userId: string, changes: SyncChange[]): Promise<number>;
  /** Changes with a version above `since`, oldest first, at most `limit`. */
  changesSince(userId: string, since: bigint, limit: number): Promise<VersionedChange[]>;
  /**
   * The listener's live highlights, newest first, optionally matching `q` in the note, the
   * transcript excerpt, or the episode or show title.
   */
  searchHighlights(userId: string, opts: { q: string | null; offset: number; limit: number }): Promise<HighlightPage>;
}

/**
 * Synced records are flat, so compare them key by key regardless of key order: a record stored
 * as columns and one parsed from a request list their keys differently.
 */
const sameRecord = (a: object, b: object) => {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return JSON.stringify(a, keys) === JSON.stringify(b, keys);
};

/** The merge rule for one kind of change: the value to keep, or null to keep what's stored. */
export function mergeChange(existing: SyncChange | undefined, incoming: SyncChange): SyncChange | null {
  if (!existing) return incoming;
  let merged: SyncChange['value'];
  switch (incoming.kind) {
    case 'episodeState':
      merged = mergeEpisodeState(existing.value as EpisodeState, incoming.value);
      break;
    case 'subscription':
      merged = lastWriteWins(existing.value as Subscription, incoming.value);
      break;
    case 'queueItem':
      merged = lastWriteWins(existing.value as QueueItem, incoming.value);
      break;
    case 'settings':
      merged = lastWriteWins(existing.value as Settings, incoming.value);
      break;
    case 'highlight':
      merged = mergeHighlight(existing.value as Highlight, incoming.value);
      break;
  }
  return sameRecord(merged, existing.value) ? null : ({ kind: incoming.kind, value: merged } as SyncChange);
}

export class InMemoryAccountStore implements AccountStore {
  private requests = new Map<string, SignInRequest>();
  private users = new Map<string, User>();
  private sessions = new Map<string, Session>();
  private state = new Map<string, Map<string, VersionedChange>>();
  private version = 0n;

  async createSignInRequest(request: Omit<SignInRequest, 'attempts' | 'usedAt'>) {
    this.requests.set(request.id, { ...request, attempts: 0, usedAt: null });
  }

  async countSignInRequestsSince(email: string, since: Date) {
    return [...this.requests.values()].filter((r) => r.email === email && r.createdAt > since).length;
  }

  async findSignInRequestByToken(tokenHash: string) {
    return [...this.requests.values()].find((r) => r.tokenHash === tokenHash) ?? null;
  }

  async findLatestSignInRequest(email: string) {
    const mine = [...this.requests.values()].filter((r) => r.email === email && !r.usedAt);
    return mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }

  async recordSignInAttempt(id: string) {
    const r = this.requests.get(id);
    if (r) r.attempts++;
  }

  async markSignInRequestUsed(id: string) {
    const r = this.requests.get(id);
    if (!r || r.usedAt) return false;
    r.usedAt = new Date();
    return true;
  }

  async findOrCreateUser(email: string, newId: string) {
    for (const u of this.users.values()) if (u.email === email) return u;
    const user = { id: newId, email, createdAt: new Date().toISOString() };
    this.users.set(newId, user);
    return user;
  }

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }

  async deleteUser(id: string) {
    this.users.delete(id);
    this.state.delete(id);
    for (const [sid, s] of this.sessions) if (s.userId === id) this.sessions.delete(sid);
  }

  async createSession(session: Omit<Session, 'revokedAt'>) {
    this.sessions.set(session.id, { ...session, revokedAt: null });
  }

  async findSessionByRefreshHash(refreshHash: string) {
    return [...this.sessions.values()].find((s) => s.refreshHash === refreshHash) ?? null;
  }

  async rotateSession(id: string, oldHash: string, newHash: string, expiresAt: Date) {
    const s = this.sessions.get(id);
    if (!s || s.refreshHash !== oldHash || s.revokedAt) return false;
    s.refreshHash = newHash;
    s.expiresAt = expiresAt;
    return true;
  }

  async revokeSession(id: string) {
    const s = this.sessions.get(id);
    if (s) s.revokedAt = new Date();
  }

  async applyChanges(userId: string, changes: SyncChange[]) {
    const mine = this.state.get(userId) ?? new Map<string, VersionedChange>();
    this.state.set(userId, mine);
    let applied = 0;
    for (const pushed of changes) {
      // The excerpt, chapter and confidence are the server's to set, never the client's.
      const change: SyncChange = pushed.kind === 'highlight' ? { kind: 'highlight', value: withoutDerivedFields(pushed.value) } : pushed;
      const key = changeKey(change);
      const merged = mergeChange(mine.get(key), change);
      if (!merged) continue;
      mine.set(key, { ...merged, version: ++this.version });
      applied++;
    }
    return applied;
  }

  async changesSince(userId: string, since: bigint, limit: number) {
    return [...(this.state.get(userId)?.values() ?? [])]
      .filter((c) => c.version > since)
      .sort((a, b) => (a.version < b.version ? -1 : 1))
      .slice(0, limit);
  }

  async searchHighlights(userId: string, { q, offset, limit }: { q: string | null; offset: number; limit: number }) {
    const needle = q?.trim().toLowerCase();
    // No catalog here, so titles aren't searched; Postgres covers them.
    const matches = [...(this.state.get(userId)?.values() ?? [])]
      .flatMap((c) => (c.kind === 'highlight' && !c.value.deleted ? [c.value] : []))
      .filter((h) => !needle || [h.note, h.transcriptExcerpt].some((t) => t?.toLowerCase().includes(needle)))
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    return { highlights: matches.slice(offset, offset + limit), hasMore: matches.length > offset + limit };
  }
}
