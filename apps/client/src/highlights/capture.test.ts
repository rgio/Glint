import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { captureRange, newId } from './capture';

const at = (positionSec: number, rest: Partial<Parameters<typeof captureRange>[0]> = {}) =>
  captureRange({ episodeId: 'ep_1', positionSec, rate: 1, durationSec: 1800, now: 100_000, last: null, ...rest });

describe('captureRange', () => {
  it('takes the last 30 seconds heard', () => {
    expect(at(600)).toEqual({ kind: 'new', startSec: 570, endSec: 600 });
  });

  it('counts listening time, so faster playback covers more audio', () => {
    expect(at(600, { rate: 1.5 })).toEqual({ kind: 'new', startSec: 555, endSec: 600 });
  });

  it('stops at the start of the episode, keeping at least 3 seconds', () => {
    expect(at(12)).toEqual({ kind: 'new', startSec: 0, endSec: 12 });
    expect(at(1)).toEqual({ kind: 'new', startSec: 0, endSec: 3 });
  });

  it('never ends past the end of the episode', () => {
    expect(at(1805)).toEqual({ kind: 'new', startSec: 1770, endSec: 1800 });
  });

  it('extends the last highlight when pressed again within 10 seconds', () => {
    const last = { id: 'h1', episodeId: 'ep_1', startSec: 570, endSec: 600, capturedAt: 95_000 };
    expect(at(605, { last })).toEqual({ kind: 'extend', id: 'h1', startSec: 570, endSec: 605 });
    // Too late, another episode, or after seeking back before it: a new highlight.
    expect(at(605, { last: { ...last, capturedAt: 80_000 } }).kind).toBe('new');
    expect(at(605, { last: { ...last, episodeId: 'ep_2' } }).kind).toBe('new');
    expect(at(300, { last }).kind).toBe('new');
  });

  it('starts a new highlight after a jump forward, even within 10 seconds', () => {
    const last = { id: 'h1', episodeId: 'ep_1', startSec: 30, endSec: 60, capturedAt: 95_000 };
    // 5 s later, playback is 2 minutes on: the listener skipped ahead.
    expect(at(180, { last })).toEqual({ kind: 'new', startSec: 150, endSec: 180 });
    // 5 s later at 2x, 10 s of audio has played: still the same moment.
    expect(at(70, { last, rate: 2 }).kind).toBe('extend');
  });

  it('caps an extended highlight at 5 minutes', () => {
    // Already 298 s long; 5 s later, 5 s more has played.
    const last = { id: 'h1', episodeId: 'ep_1', startSec: 100, endSec: 398, capturedAt: 95_000 };
    expect(at(403, { last })).toEqual({ kind: 'extend', id: 'h1', startSec: 103, endSec: 403 });
  });
});

describe('newId', () => {
  it('makes valid, distinct v4 UUIDs', () => {
    const ids = Array.from({ length: 100 }, newId);
    for (const id of ids) expect(z.uuid().safeParse(id).success).toBe(true);
    expect(new Set(ids).size).toBe(100);
  });
});
