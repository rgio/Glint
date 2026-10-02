import { describe, expect, it } from 'vitest';

import { MAX_POLL_MS, MIN_POLL_MS, nextPollDelay } from '../src/schedule';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 2, 12);
const noJitter = () => 0.5;

/** Publish dates `everyMs` apart, the newest `ageMs` before NOW. */
const cadence = (everyMs: number, count = 10, ageMs = HOUR) =>
  Array.from({ length: count }, (_, i) => new Date(NOW - ageMs - i * everyMs).toISOString());

const delay = (publishedAt: (string | null)[], failures = 0) =>
  nextPollDelay({ publishedAt, now: NOW, failures, jitter: noJitter });

describe('nextPollDelay', () => {
  it('polls daily shows every 15 minutes', () => {
    expect(delay(cadence(DAY))).toBe(15 * MINUTE);
  });

  it('polls weekly shows every 1 h 45 min', () => {
    expect(delay(cadence(7 * DAY))).toBe(105 * MINUTE);
  });

  it('polls monthly shows every 7.5 hours', () => {
    expect(delay(cadence(30 * DAY, 10, DAY))).toBe(7.5 * HOUR);
  });

  it('never polls more often than every 15 minutes', () => {
    expect(delay(cadence(HOUR))).toBe(MIN_POLL_MS);
  });

  it('polls inactive shows once a day', () => {
    expect(delay(cadence(DAY, 10, 31 * DAY))).toBe(MAX_POLL_MS);
  });

  it('polls feeds with no dated episodes once a day', () => {
    expect(delay([])).toBe(MAX_POLL_MS);
    expect(delay([null, 'not a date'])).toBe(MAX_POLL_MS);
  });

  it('polls a show with a single recent episode hourly', () => {
    expect(delay(cadence(DAY, 1))).toBe(HOUR);
  });

  it('uses the median gap, so one long break does not slow a daily show', () => {
    const dates = cadence(DAY, 9);
    dates.push(new Date(Date.parse(dates.at(-1)!) - 60 * DAY).toISOString());
    expect(delay(dates)).toBe(15 * MINUTE);
  });

  it('ignores the order dates arrive in', () => {
    expect(delay(cadence(7 * DAY).reverse())).toBe(105 * MINUTE);
  });

  it('doubles the wait for each consecutive failure, up to a day', () => {
    expect(delay(cadence(DAY), 1)).toBe(30 * MINUTE);
    expect(delay(cadence(DAY), 3)).toBe(2 * HOUR);
    expect(delay(cadence(DAY), 20)).toBe(MAX_POLL_MS);
  });

  it('adds up to ±10% jitter', () => {
    const at = (j: number) => nextPollDelay({ publishedAt: cadence(DAY), now: NOW, failures: 0, jitter: () => j });
    expect(at(0)).toBe(13.5 * MINUTE);
    expect(at(0.999999)).toBeCloseTo(16.5 * MINUTE, -3);
  });
});
