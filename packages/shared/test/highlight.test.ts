import { describe, expect, it } from 'vitest';

import { changeKey, mergeHighlight, SyncChange, type Highlight } from '../src';

const base: Highlight = {
  id: '6a6f0b4e-8a4a-4c8e-9f0e-1d2c3b4a5f60',
  episodeId: 'ep_1',
  podcastId: 'pod_1',
  startSec: 100,
  endSec: 130,
  note: null,
  transcriptExcerpt: null,
  chapterTitle: null,
  anchorDurationSec: 1800,
  anchorEnclosureUrl: 'https://cdn.example.com/1.mp3',
  source: 'player',
  createdAt: 1000,
  rangeUpdatedAt: 1000,
  noteUpdatedAt: 1000,
  deleted: false,
};

describe('mergeHighlight', () => {
  it('keeps the newer range and the newer note independently', () => {
    const rangeEdited = { ...base, startSec: 90, rangeUpdatedAt: 2000 };
    const noteEdited = { ...base, note: 'try this', noteUpdatedAt: 3000 };
    const merged = mergeHighlight(rangeEdited, noteEdited);
    expect(merged).toMatchObject({ startSec: 90, endSec: 130, note: 'try this', rangeUpdatedAt: 2000, noteUpdatedAt: 3000 });
    expect(mergeHighlight(noteEdited, rangeEdited)).toEqual(merged);
  });

  it('lets a deletion win over any edit', () => {
    const deleted = { ...base, deleted: true };
    const edited = { ...base, note: 'later', noteUpdatedAt: 9000 };
    expect(mergeHighlight(deleted, edited).deleted).toBe(true);
    expect(mergeHighlight(edited, deleted).deleted).toBe(true);
  });

  it('gives the same answer whichever side is first, even on a tie', () => {
    const x = { ...base, note: 'a', noteUpdatedAt: 5000 };
    const y = { ...base, note: 'b', noteUpdatedAt: 5000 };
    expect(mergeHighlight(x, y)).toEqual(mergeHighlight(y, x));
  });
});

describe('highlight sync changes', () => {
  it('validate and key by id', () => {
    const change = SyncChange.parse({ kind: 'highlight', value: base });
    expect(changeKey(change)).toBe(`highlight:${base.id}`);
    expect(() => SyncChange.parse({ kind: 'highlight', value: { ...base, id: 'not-a-uuid' } })).toThrow();
    expect(() => SyncChange.parse({ kind: 'highlight', value: { ...base, note: 'x'.repeat(5001) } })).toThrow();
  });
});
