import { describe, expect, it } from 'vitest';

import { chapterChunks, chunkTranscript, looksLikeAd, windows } from '../src';

const seg = (idx: number, startSec: number, endSec: number, text = 'some words here') => ({
  idx,
  startMs: startSec * 1000,
  endMs: endSec * 1000,
  speaker: null,
  text,
});

describe('windows', () => {
  it('closes windows at about a minute and overlaps by one segment', () => {
    const segs = Array.from({ length: 10 }, (_, i) => seg(i, i * 15, i * 15 + 15));
    const w = windows(segs);
    expect(w[0]).toMatchObject({ segFrom: 0, segTo: 3, startMs: 0, endMs: 60_000 });
    expect(w[1]!.segFrom).toBe(3);
    // Covers everything, always moving forward.
    expect(w.at(-1)!.segTo).toBe(9);
    for (let i = 1; i < w.length; i++) expect(w[i]!.segFrom!).toBeGreaterThan(w[i - 1]!.segFrom!);
  });

  it('keeps a very long segment in a window of its own', () => {
    const w = windows([seg(0, 0, 10), seg(1, 10, 200), seg(2, 200, 210)]);
    expect(w.map((x) => [x.segFrom, x.segTo])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('flags sponsor reads', () => {
    const w = windows([seg(0, 0, 30, 'This episode is brought to you by Acme. Use code SLEEP.')]);
    expect(w[0]!.isAd).toBe(true);
    expect(looksLikeAd('We talked about the code base.')).toBe(false);
  });
});

describe('chapter and takeaway chunks', () => {
  it('describes each chapter by its title and opening words', () => {
    const segs = [seg(0, 0, 10, 'intro words'), seg(1, 60, 70, 'main words')];
    const chunks = chapterChunks(
      [
        { startMs: 0, title: 'Intro' },
        { startMs: 60_000, title: 'Main' },
      ],
      segs,
    );
    expect(chunks.map((c) => c.text)).toEqual(['Intro\nintro words', 'Main\nmain words']);
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 60_000, segFrom: 0, segTo: 0 });
  });

  it('builds all kinds together', () => {
    const kinds = chunkTranscript({
      segments: [seg(0, 0, 30)],
      chapters: [{ startMs: 0, title: 'Only' }],
      takeaways: [{ startMs: 5000, text: 'A point', tags: ['Topic'] }],
    }).map((c) => c.kind);
    expect(kinds).toEqual(['takeaway', 'chapter', 'window']);
  });
});
