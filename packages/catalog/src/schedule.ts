const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const MIN_POLL_MS = 15 * MINUTE;
export const MAX_POLL_MS = DAY;
/** A show with no episode for this long is polled at the slowest rate. */
export const INACTIVE_AFTER_MS = 30 * DAY;
/** Polls per typical gap between episodes: a daily show every 15 minutes, a weekly one every ~2 hours. */
const POLLS_PER_GAP = 96;
/** With one dated episode there's no gap to measure yet. */
const SINGLE_EPISODE_POLL_MS = HOUR;

/**
 * How long to wait before polling a feed again (spec: every 15 min for daily shows, down to
 * every 24 h for inactive ones). Consecutive failures double the wait, capped at a day, and
 * ±10% jitter keeps feeds added together from polling in lockstep.
 */
export function nextPollDelay({
  publishedAt,
  now,
  failures,
  jitter = Math.random,
}: {
  /** Publish dates of the feed's most recent episodes, in any order; nulls are ignored. */
  publishedAt: (string | null)[];
  now: number;
  failures: number;
  /** Returns a number in [0, 1). */
  jitter?: () => number;
}): number {
  const dates = publishedAt
    .map((d) => (d ? Date.parse(d) : NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);

  let base: number;
  if (dates.length === 0 || now - dates[0]! > INACTIVE_AFTER_MS) {
    base = MAX_POLL_MS;
  } else if (dates.length === 1) {
    base = SINGLE_EPISODE_POLL_MS;
  } else {
    const gaps = dates.slice(1).map((d, i) => dates[i]! - d);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)]!;
    base = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, median / POLLS_PER_GAP));
  }

  const backedOff = Math.min(MAX_POLL_MS, base * 2 ** Math.min(failures, 10));
  return Math.round(backedOff * (0.9 + 0.2 * jitter()));
}
