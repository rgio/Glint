import type { EpisodeState, QueueItem, Subscription } from './models';

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

/** Last write wins for whole records (subscriptions, queue items). */
export function lastWriteWins<T extends Subscription | QueueItem>(a: T, b: T): T {
  return a.updatedAt >= b.updatedAt ? a : b;
}

/** A change recorded in the client outbox and sent to `POST /v1/sync`. */
export type SyncChange =
  | { kind: 'episodeState'; value: EpisodeState }
  | { kind: 'subscription'; value: Subscription }
  | { kind: 'queueItem'; value: QueueItem };
