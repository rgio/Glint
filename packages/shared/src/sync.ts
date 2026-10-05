import { z } from 'zod';

import { Episode, EpisodeState, Highlight, Podcast, QueueItem, Settings, Subscription } from './models';

/**
 * Two writes this close together (ms) are treated as concurrent, so the
 * position tie-break applies instead of trusting slightly skewed clocks.
 */
export const CONCURRENT_WINDOW_MS = 2_000;

/**
 * Ongoing sync: the most recent write wins. When two writes are effectively
 * concurrent, keep the further position so a lagging device never rewinds.
 */
export function mergeEpisodeState(a: EpisodeState, b: EpisodeState): EpisodeState {
  if (Math.abs(a.updatedAt - b.updatedAt) <= CONCURRENT_WINDOW_MS) {
    const further = a.positionSec >= b.positionSec ? a : b;
    return {
      ...further,
      played: a.played || b.played,
      updatedAt: Math.max(a.updatedAt, b.updatedAt),
    };
  }
  return a.updatedAt > b.updatedAt ? a : b;
}

/**
 * First sign-in: local signed-out data is merged into the account. Keep the
 * furthest position and any played mark (spec F-12).
 */
export function mergeOnSignIn(local: EpisodeState, remote: EpisodeState): EpisodeState {
  return {
    episodeId: local.episodeId,
    positionSec: Math.max(local.positionSec, remote.positionSec),
    played: local.played || remote.played,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

/** Last write wins for whole records (subscriptions, queue items, settings). */
export function lastWriteWins<T extends Subscription | QueueItem | Settings>(a: T, b: T): T {
  return a.updatedAt >= b.updatedAt ? a : b;
}

/**
 * Highlights merge field by field: the range and the note each keep the newer edit, so editing
 * the note on one device while adjusting the range on another keeps both. A deletion wins.
 * Ties go to the larger value, so the result doesn't depend on which side is `a`.
 */
export function mergeHighlight(a: Highlight, b: Highlight): Highlight {
  const newer = <T>(at: number, bt: number, av: T, bv: T) =>
    at !== bt ? (at > bt ? av : bv) : JSON.stringify(av) >= JSON.stringify(bv) ? av : bv;
  const range = newer(a.rangeUpdatedAt, b.rangeUpdatedAt, a, b);
  const note = newer(a.noteUpdatedAt, b.noteUpdatedAt, a, b);
  return {
    ...range,
    startSec: range.startSec,
    endSec: range.endSec,
    transcriptExcerpt: range.transcriptExcerpt ?? note.transcriptExcerpt,
    rangeUpdatedAt: range.rangeUpdatedAt,
    note: note.note,
    noteUpdatedAt: note.noteUpdatedAt,
    createdAt: Math.min(a.createdAt, b.createdAt),
    deleted: a.deleted || b.deleted,
  };
}

/** A change recorded in the client outbox and sent to `POST /v1/sync`. */
export const SyncChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('subscription'), value: Subscription }),
  z.object({ kind: z.literal('episodeState'), value: EpisodeState }),
  z.object({ kind: z.literal('queueItem'), value: QueueItem }),
  z.object({ kind: z.literal('settings'), value: Settings }),
  z.object({ kind: z.literal('highlight'), value: Highlight }),
]);
export type SyncChange = z.infer<typeof SyncChange>;

/** What a change is about, e.g. `subscription:pod_1`. Two changes with the same key update the same record. */
export function changeKey(change: SyncChange): string {
  switch (change.kind) {
    case 'subscription':
      return `subscription:${change.value.podcastId}`;
    case 'episodeState':
      return `episodeState:${change.value.episodeId}`;
    case 'queueItem':
      return `queueItem:${change.value.episodeId}`;
    case 'settings':
      return 'settings';
    case 'highlight':
      return `highlight:${change.value.id}`;
  }
}

/** F-13: the client sends its outbox in batches of at most this many changes. */
export const SYNC_BATCH_LIMIT = 200;

export const SyncPushRequest = z.object({ changes: z.array(SyncChange).max(SYNC_BATCH_LIMIT) });
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

/**
 * `GET /v1/sync?since=<cursor>`: changes newer than the cursor, oldest first, with the shows
 * and episodes they refer to, so a new device can show them without more requests.
 */
export type SyncPullResponse = {
  changes: SyncChange[];
  cursor: string;
  hasMore: boolean;
  podcasts: Podcast[];
  episodes: Episode[];
};
