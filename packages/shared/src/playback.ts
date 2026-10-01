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
