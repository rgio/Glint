/** Speeds the UI offers. Native players cap lower; see `clampRate`. */
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
export const RATE_STEP = 0.1;

/** expo-audio supports at most 2.0x on iOS and Android. */
export const NATIVE_MAX_RATE = 2;

export function clampRate(rate: number, max = MAX_RATE): number {
  const stepped = Math.round(rate / RATE_STEP) * RATE_STEP;
  return Math.min(max, Math.max(MIN_RATE, Number(stepped.toFixed(1))));
}

/** F-09: an episode counts as played at 95%, or with under 30 s left. */
export function shouldMarkPlayed(positionSec: number, durationSec: number | null): boolean {
  if (!durationSec || durationSec <= 0) return false;
  return positionSec / durationSec >= 0.95 || durationSec - positionSec < 30;
}

/** F-08: how often to persist the position while playing. */
export const POSITION_SAVE_INTERVAL_MS = 10_000;

/** F-14: sleep timer lengths, in minutes. */
export const SLEEP_TIMER_MINUTES = [5, 15, 30, 60] as const;
/** F-14: the audio fades out over the last 10 s before the sleep timer stops it. */
export const SLEEP_FADE_MS = 10_000;

export type SleepTimer = { kind: 'minutes'; minutes: number; endsAt: number } | { kind: 'endOfEpisode' };

/**
 * Wall-clock milliseconds until a sleep timer stops playback, or null when that isn't known
 * yet (end of episode with no duration). Playback speed shortens what's left of an episode.
 */
export function sleepTimerRemainingMs(
  timer: SleepTimer,
  { now, positionSec, durationSec, rate }: { now: number; positionSec: number; durationSec: number | null; rate: number },
): number | null {
  if (timer.kind === 'minutes') return Math.max(0, timer.endsAt - now);
  if (!durationSec) return null;
  return Math.max(0, ((durationSec - positionSec) / rate) * 1000);
}

/**
 * Volume while a sleep timer runs: full until the last 10 s, then a linear fade to silence.
 * Unknown or nonsensical input keeps full volume.
 */
export function sleepFadeVolume(remainingMs: number | null): number {
  if (remainingMs === null || !Number.isFinite(remainingMs) || remainingMs >= SLEEP_FADE_MS) return 1;
  return Math.max(0, remainingMs / SLEEP_FADE_MS);
}
