import {
  changeKey,
  clampRate,
  DEFAULT_SETTINGS,
  mergeEpisodeState,
  mergeOnSignIn,
  SYNC_BATCH_LIMIT,
  type Episode,
  type EpisodeState,
  type Podcast,
  type Settings,
  type SyncChange,
  type SyncPullResponse,
} from '@podcast/shared';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { authedRequest, useAuth } from '@/auth/session';
import { useLibrary } from '@/library/store';
import { audioPlayer } from '@/player/audio-player';
import { toPlayable } from '@/player/playable';
import { usePlayer, type QueueEntry, type SavedState } from '@/player/store';
import { persistStorage } from '@/storage/persist';

/** F-13: pull at least this often while something is playing. */
const PLAYING_SYNC_MS = 60_000;
/** Wait this long after a local change before syncing, so a burst of changes goes in one push. */
const PUSH_DEBOUNCE_MS = 3_000;

type SyncState = {
  /** Local changes not yet sent, at most one per record (the newest). */
  outbox: SyncChange[];
  /** Server version of the newest change this device has pulled. */
  cursor: string;
  /** The account whose data has been merged with this device's (F-12 first sign-in). */
  mergedFor: string | null;
  /** The last settings seen from the server, so pushing ours keeps fields this app doesn't edit. */
  remoteSettings: Settings | null;
  lastSyncedAt: number | null;
  status: 'idle' | 'syncing' | 'error';
  error: string | null;
};

const initial = (): Pick<SyncState, 'outbox' | 'cursor' | 'mergedFor' | 'remoteSettings' | 'lastSyncedAt'> => ({
  outbox: [],
  cursor: '0',
  mergedFor: null,
  remoteSettings: null,
  lastSyncedAt: null,
});

export const useSync = create<SyncState>()(
  persist((): SyncState => ({ ...initial(), status: 'idle', error: null }), {
    name: 'sync',
    version: 1,
    storage: persistStorage<SyncState>(),
    partialize: ({ outbox, cursor, mergedFor, remoteSettings, lastSyncedAt }) =>
      ({ outbox, cursor, mergedFor, remoteSettings, lastSyncedAt }) as SyncState,
  }),
);

// ---- Recording local changes ----

/** True while changes from the server are written to the stores, so they aren't sent back. */
let applyingRemote = false;

function enqueue(changes: SyncChange[]) {
  if (changes.length === 0) return;
  const outbox = new Map(useSync.getState().outbox.map((c) => [changeKey(c), c]));
  for (const c of changes) outbox.set(changeKey(c), c);
  useSync.setState({ outbox: [...outbox.values()] });
  // Positions saved during playback wait for the 60-second sync or the pause, as the spec says;
  // anything else goes out shortly.
  if (changes.every((c) => c.kind === 'episodeState') && usePlayer.getState().playing) return;
  schedulePush();
}

const subscriptionChange = (podcastId: string, subscribedAt: number, deleted: boolean, now: number): SyncChange => ({
  kind: 'subscription',
  value: { podcastId, subscribedAt, autoDownload: false, updatedAt: now, deleted },
});
const stateChange = (episodeId: string, s: SavedState): SyncChange => ({
  kind: 'episodeState',
  value: { episodeId, positionSec: s.positionSec, played: s.played, updatedAt: s.updatedAt },
});
const queueChange = (e: Pick<QueueEntry, 'id' | 'sortKey'>, deleted: boolean, now: number): SyncChange => ({
  kind: 'queueItem',
  value: { episodeId: e.id, sortKey: e.sortKey, updatedAt: now, deleted },
});
function settingsChange(now: number): SyncChange {
  const { rate, skipBackSec, skipForwardSec } = usePlayer.getState();
  const base = useSync.getState().remoteSettings ?? DEFAULT_SETTINGS;
  return {
    kind: 'settings',
    value: {
      ...base,
      playbackRate: rate,
      skipBackSec: skipBackSec as Settings['skipBackSec'],
      skipForwardSec: skipForwardSec as Settings['skipForwardSec'],
      updatedAt: now,
    },
  };
}

/** Turns every change to the library and player stores into outbox entries, by comparing state. */
function recordLocalChanges() {
  useLibrary.subscribe((next, prev) => {
    if (applyingRemote || !useAuth.getState().user || next.subscriptions === prev.subscriptions) return;
    const now = Date.now();
    const changes: SyncChange[] = [];
    for (const [id, s] of Object.entries(next.subscriptions)) {
      if (!prev.subscriptions[id]) changes.push(subscriptionChange(id, s.subscribedAt, false, now));
    }
    for (const [id, s] of Object.entries(prev.subscriptions)) {
      if (!next.subscriptions[id]) changes.push(subscriptionChange(id, s.subscribedAt, true, now));
    }
    enqueue(changes);
  });

  usePlayer.subscribe((next, prev) => {
    if (applyingRemote || !useAuth.getState().user) return;
    const now = Date.now();
    const changes: SyncChange[] = [];
    if (next.saved !== prev.saved) {
      for (const [id, s] of Object.entries(next.saved)) if (prev.saved[id] !== s) changes.push(stateChange(id, s));
    }
    if (next.queue !== prev.queue) {
      const before = new Map(prev.queue.map((q) => [q.id, q]));
      const after = new Map(next.queue.map((q) => [q.id, q]));
      for (const q of next.queue) if (before.get(q.id)?.sortKey !== q.sortKey) changes.push(queueChange(q, false, now));
      for (const q of prev.queue) if (!after.has(q.id)) changes.push(queueChange(q, true, now));
    }
    if (next.rate !== prev.rate || next.skipBackSec !== prev.skipBackSec || next.skipForwardSec !== prev.skipForwardSec) {
      changes.push(settingsChange(now));
    }
    enqueue(changes);
  });
}

// ---- Applying changes from the server ----

type Catalog = { podcasts: Map<string, Podcast>; episodes: Map<string, Episode> };

function catalogOf(pages: Pick<SyncPullResponse, 'podcasts' | 'episodes'>[]): Catalog {
  return {
    podcasts: new Map(pages.flatMap((p) => p.podcasts).map((p) => [p.id, p])),
    episodes: new Map(pages.flatMap((p) => p.episodes).map((e) => [e.id, e])),
  };
}

const savedToState = (episodeId: string, s: SavedState): EpisodeState => ({ episodeId, ...s });

/** Writes server changes into the local stores, merging episode states with the shared rule. */
function applyRemote(changes: SyncChange[], catalog: Catalog, mergeState = mergeEpisodeState) {
  applyingRemote = true;
  try {
    const subscriptions = { ...useLibrary.getState().subscriptions };
    const player = usePlayer.getState();
    const saved = { ...player.saved };
    const queue = new Map(player.queue.map((q) => [q.id, q]));
    let settings: Settings | null = null;

    for (const change of changes) {
      switch (change.kind) {
        case 'subscription': {
          const { podcastId, deleted, subscribedAt } = change.value;
          const podcast = catalog.podcasts.get(podcastId) ?? subscriptions[podcastId]?.podcast;
          if (deleted) delete subscriptions[podcastId];
          else if (podcast) subscriptions[podcastId] = { podcast, subscribedAt };
          break;
        }
        case 'episodeState': {
          const local = saved[change.value.episodeId];
          const merged = local ? mergeState(savedToState(change.value.episodeId, local), change.value) : change.value;
          saved[change.value.episodeId] = { positionSec: merged.positionSec, played: merged.played, updatedAt: merged.updatedAt };
          break;
        }
        case 'queueItem': {
          const { episodeId, sortKey, deleted } = change.value;
          if (deleted || player.current?.id === episodeId) {
            queue.delete(episodeId);
            break;
          }
          const episode = catalog.episodes.get(episodeId);
          const podcast = episode && catalog.podcasts.get(episode.podcastId);
          const playable = queue.get(episodeId) ?? (episode && podcast ? toPlayable(episode, podcast) : null);
          if (playable) queue.set(episodeId, { ...playable, sortKey });
          break;
        }
        case 'settings':
          settings = change.value;
          break;
      }
    }

    useLibrary.setState({ subscriptions });
    const sortedQueue = [...queue.values()].sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    usePlayer.setState({ saved, queue: sortedQueue });
    if (settings) {
      const rate = clampRate(settings.playbackRate, audioPlayer.maxRate);
      audioPlayer.setRate(rate);
      usePlayer.setState({ rate, skipBackSec: settings.skipBackSec, skipForwardSec: settings.skipForwardSec });
      useSync.setState({ remoteSettings: settings });
    }

    // Another device listened further: move the paused current episode there.
    const { current, playing, positionSec, seekTo } = usePlayer.getState();
    const remote = current && saved[current.id];
    if (current && remote && !playing && !remote.played && Math.abs(remote.positionSec - positionSec) > 1) {
      seekTo(remote.positionSec);
    }
  } finally {
    applyingRemote = false;
  }
}

// ---- Talking to the server ----

async function pullAll(since: string): Promise<{ changes: SyncChange[]; catalog: Catalog; cursor: string }> {
  const pages: SyncPullResponse[] = [];
  let cursor = since;
  for (;;) {
    const page = await authedRequest<SyncPullResponse>(`/v1/sync?since=${cursor}`);
    pages.push(page);
    cursor = page.cursor;
    if (!page.hasMore) break;
  }
  return { changes: pages.flatMap((p) => p.changes), catalog: catalogOf(pages), cursor };
}

async function push() {
  for (;;) {
    const batch = useSync.getState().outbox.slice(0, SYNC_BATCH_LIMIT);
    if (batch.length === 0) return;
    await authedRequest('/v1/sync', { method: 'POST', body: JSON.stringify({ changes: batch }) });
    // Only drop what was sent: a newer change to the same record may have arrived meanwhile.
    const sent = new Set(batch);
    useSync.setState({ outbox: useSync.getState().outbox.filter((c) => !sent.has(c)) });
  }
}

/**
 * F-12 first sign-in on this device: subscriptions are combined, and each episode keeps the
 * furthest position and any played mark. Server data is applied here; this device's data that
 * the server lacks (or has behind) is queued to push.
 */
async function mergeOnFirstSignIn(userId: string) {
  const { changes, catalog, cursor } = await pullAll('0');
  const remote = new Map(changes.map((c) => [changeKey(c), c]));
  const now = Date.now();
  const toPush: SyncChange[] = [];

  for (const [id, s] of Object.entries(useLibrary.getState().subscriptions)) {
    const theirs = remote.get(`subscription:${id}`);
    if (!theirs || (theirs.kind === 'subscription' && theirs.value.deleted)) toPush.push(subscriptionChange(id, s.subscribedAt, false, now));
  }
  for (const [id, s] of Object.entries(usePlayer.getState().saved)) {
    const theirs = remote.get(`episodeState:${id}`);
    const mine = savedToState(id, s);
    const merged = theirs?.kind === 'episodeState' ? mergeOnSignIn(mine, theirs.value) : mine;
    if (!theirs || JSON.stringify(merged) !== JSON.stringify(theirs.value)) toPush.push({ kind: 'episodeState', value: merged });
  }
  for (const q of usePlayer.getState().queue) {
    if (!remote.has(`queueItem:${q.id}`)) toPush.push(queueChange(q, false, now));
  }
  if (!remote.has('settings')) toPush.push(settingsChange(now));

  // Subscriptions the server has deleted but this device still has stay (combined), so skip
  // applying those deletions; everything else from the server applies, positions by the
  // sign-in rule.
  const localSubs = useLibrary.getState().subscriptions;
  const applicable = changes.filter((c) => !(c.kind === 'subscription' && c.value.deleted && localSubs[c.value.podcastId]));
  applyRemote(applicable, catalog, mergeOnSignIn);
  enqueue(toPush);
  useSync.setState({ cursor, mergedFor: userId });
}

let running: Promise<void> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void syncNow(), PUSH_DEBOUNCE_MS);
}

/** Pushes the outbox, then pulls everything newer than the cursor. Safe to call any time. */
export function syncNow(): Promise<void> {
  const user = useAuth.getState().user;
  if (!user) return Promise.resolve();
  running ??= (async () => {
    useSync.setState({ status: 'syncing', error: null });
    try {
      if (useSync.getState().mergedFor !== user.id) await mergeOnFirstSignIn(user.id);
      await push();
      const { changes, catalog, cursor } = await pullAll(useSync.getState().cursor);
      applyRemote(changes, catalog);
      useSync.setState({ cursor, status: 'idle', lastSyncedAt: Date.now() });
    } catch (err) {
      useSync.setState({ status: 'error', error: (err as Error).message });
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Resolves once the store has loaded its saved state. */
function hydrated(store: { persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void } }) {
  return new Promise<void>((resolve) => {
    if (store.persist.hasHydrated()) return resolve();
    const unsubscribe = store.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

let started = false;

/**
 * F-13: starts syncing once saved state has loaded: now, on return to the app, when playback
 * pauses, every 60 s during playback, and shortly after local changes. Call once at startup.
 */
export async function startSync() {
  if (started) return;
  started = true;
  await Promise.all([hydrated(useLibrary), hydrated(usePlayer), hydrated(useAuth), hydrated(useSync)]);
  // Start recording only after loading, so restoring saved state isn't mistaken for changes.
  recordLocalChanges();

  AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncNow();
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  usePlayer.subscribe((next, prev) => {
    if (next.playing === prev.playing) return;
    if (prev.playing && !next.playing) void syncNow();
    if (next.playing && !timer) timer = setInterval(() => void syncNow(), PLAYING_SYNC_MS);
    if (!next.playing && timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  useAuth.subscribe((next, prev) => {
    if (next.user?.id === prev.user?.id) return;
    // Signed out, or a different account: this device's sync position no longer applies.
    useSync.setState({ ...initial(), status: 'idle', error: null });
    if (next.user) void syncNow();
  });

  void syncNow();
}
