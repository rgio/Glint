import { HIGHLIGHT_MAX_SEC, HIGHLIGHT_MIN_SEC } from '@podcast/shared';

/** Spec default: capture the last 30 seconds the listener heard. */
export const LOOKBACK_SEC = 30;
/** A second capture this soon after the last, on the same episode, extends it instead. */
export const EXTEND_WINDOW_MS = 10_000;

export type LastCapture = { id: string; episodeId: string; startSec: number; endSec: number; capturedAt: number };

export type CaptureResult =
  | { kind: 'new'; startSec: number; endSec: number }
  | { kind: 'extend'; id: string; startSec: number; endSec: number };

/**
 * The range to save when the listener highlights "what I just heard". The look-back counts
 * listening time, so at 1.5x the last 30 seconds heard is 45 seconds of audio.
 */
export function captureRange({
  episodeId,
  positionSec,
  rate,
  durationSec,
  now,
  last,
  lookbackSec = LOOKBACK_SEC,
}: {
  episodeId: string;
  positionSec: number;
  rate: number;
  durationSec: number | null;
  now: number;
  last: LastCapture | null;
  lookbackSec?: number;
}): CaptureResult {
  const limit = durationSec ?? Infinity;
  let endSec = Math.min(Math.max(0, positionSec), limit);

  // Repeated presses on the same moment extend it. A seek since the last press (playback moved
  // more than the elapsed time allows, or back before it) means a new moment.
  const elapsedMs = last ? now - last.capturedAt : Infinity;
  const playedSince = last ? endSec - last.endSec : 0;
  if (
    last &&
    last.episodeId === episodeId &&
    elapsedMs <= EXTEND_WINDOW_MS &&
    endSec >= last.startSec &&
    playedSince <= (elapsedMs / 1000) * rate + 2
  ) {
    endSec = Math.max(endSec, last.endSec);
    return { kind: 'extend', id: last.id, startSec: Math.max(last.startSec, endSec - HIGHLIGHT_MAX_SEC), endSec };
  }

  let startSec = Math.max(0, endSec - lookbackSec * rate);
  if (endSec - startSec < HIGHLIGHT_MIN_SEC) {
    // Right at the start of an episode: take the first few seconds instead.
    endSec = Math.min(limit, startSec + HIGHLIGHT_MIN_SEC);
    startSec = Math.max(0, endSec - HIGHLIGHT_MIN_SEC);
  }
  return { kind: 'new', startSec, endSec };
}

/** A random version-4 UUID; the platform's when it has one. Not used for anything secret. */
export function newId(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (native) return native.call((globalThis as { crypto: object }).crypto);
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
