import { describe, expect, it } from 'vitest';

import {
  clampRate,
  mergeEpisodeState,
  mergeOnSignIn,
  NATIVE_MAX_RATE,
  shouldMarkPlayed,
  sortKeyAfter,
  sortKeyBefore,
  sortKeyBetween,
  type EpisodeState,
} from '../src';

const state = (positionSec: number, updatedAt: number, played = false): EpisodeState => ({
  episodeId: 'e1',
  positionSec,
  played,
  updatedAt,
});

describe('shouldMarkPlayed', () => {
  it('marks at 95% or under 30 s remaining', () => {
    expect(shouldMarkPlayed(950, 1000)).toBe(true);
    expect(shouldMarkPlayed(3571, 3600)).toBe(true);
    expect(shouldMarkPlayed(500, 1000)).toBe(false);
  });

  it('never marks when the duration is unknown', () => {
    expect(shouldMarkPlayed(500, null)).toBe(false);
    expect(shouldMarkPlayed(500, 0)).toBe(false);
  });
});

describe('clampRate', () => {
  it('snaps to 0.1 steps within bounds', () => {
    expect(clampRate(1.26)).toBe(1.3);
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(5)).toBe(3);
    expect(clampRate(2.5, NATIVE_MAX_RATE)).toBe(2);
  });
});

describe('mergeEpisodeState', () => {
  it('takes the newer write', () => {
    expect(mergeEpisodeState(state(100, 1_000), state(50, 60_000)).positionSec).toBe(50);
  });

  it('keeps the further position for concurrent writes', () => {
    const merged = mergeEpisodeState(state(100, 10_000), state(40, 11_000, true));
    expect(merged).toEqual(state(100, 11_000, true));
  });
});

describe('mergeOnSignIn', () => {
  it('keeps the furthest position and any played mark', () => {
    expect(mergeOnSignIn(state(10, 99_000, true), state(300, 1_000))).toEqual(
      state(300, 99_000, true),
    );
  });
});

describe('sortKeyBetween', () => {
  it('orders keys for append, prepend and insert', () => {
    const first = sortKeyAfter(null);
    const second = sortKeyAfter(first);
    const front = sortKeyBefore(first);
    const middle = sortKeyBetween(first, second);
    expect([second, middle, front, first].sort()).toEqual([front, first, middle, second]);
  });

  it('keeps finding room after many inserts at the same spot', () => {
    let lo = sortKeyAfter(null);
    const hi = sortKeyAfter(lo);
    for (let i = 0; i < 200; i++) {
      const k = sortKeyBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      lo = k;
    }
    let up = sortKeyBefore(hi);
    for (let i = 0; i < 200; i++) {
      const k = sortKeyBefore(up);
      expect(k < up).toBe(true);
      up = k;
    }
  });

  it('rejects inverted bounds', () => {
    expect(() => sortKeyBetween('b', 'a')).toThrow();
  });
});
