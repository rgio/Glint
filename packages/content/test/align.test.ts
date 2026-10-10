import { describe, expect, it } from 'vitest';

import { chapterAt, contextFor, excerptBetween, placeRange } from '../src';

const seg = (startSec: number, endSec: number, text: string) => ({ startMs: startSec * 1000, endMs: endSec * 1000, speaker: null, text });

describe('placeRange', () => {
  it('is exact when the heard and transcribed audio are the same length', () => {
    expect(placeRange({ startSec: 600, anchorDurationSec: 2221, transcriptDurationSec: 2222.5 })).toEqual({ offsetSec: 0, confidence: 'exact' });
  });

  it('spreads a length difference through the episode when they differ', () => {
    // The Daily: transcribed audio 112 s longer. Halfway through, assume half the extra came before.
    const p = placeRange({ startSec: 1110.5, anchorDurationSec: 2221, transcriptDurationSec: 2333 });
    expect(p.confidence).toBe('approximate');
    expect(p.offsetSec).toBeCloseTo(56, 0);
  });

  it('is approximate without a duration to compare', () => {
    expect(placeRange({ startSec: 10, anchorDurationSec: null, transcriptDurationSec: 100 })).toEqual({ offsetSec: 0, confidence: 'approximate' });
  });
});

describe('excerptBetween', () => {
  // Ten words over ten seconds: one word per second, each placed at the middle of its second.
  const segments = [seg(0, 10, 'One two three. Four five six seven. Eight nine ten.')];

  it('keeps the words in the range, widened to whole sentences nearby', () => {
    // 4.2 s–6.0 s holds "five six"; widen back to "Four" and forward to "seven."
    expect(excerptBetween(segments, 4200, 6000)).toBe('Four five six seven.');
  });

  it('starts from the transcript start when no sentence end is near', () => {
    expect(excerptBetween([seg(0, 4, 'alpha beta gamma delta')], 2000, 4000)).toBe('alpha beta gamma delta');
  });

  it('skips the tail of a sentence that began too long ago', () => {
    // 20 words over 20 s; the long first sentence ends at "it." (14.5 s).
    const words = `${Array.from({ length: 14 }, (_, i) => `w${i}`).join(' ')} it. Towns that widened sidewalks thrived.`;
    expect(excerptBetween([seg(0, 20, words)], 14_000, 20_000)).toBe('Towns that widened sidewalks thrived.');
  });

  it('does not widen past the 5 second limit', () => {
    const long = [seg(0, 20, `Start. ${Array.from({ length: 19 }, (_, i) => `w${i}`).join(' ')}`)];
    expect(excerptBetween(long, 15_000, 16_000)?.split(' ')[0]).not.toBe('Start.');
  });

  it('is null when nothing was said in the range', () => {
    expect(excerptBetween(segments, 20_000, 30_000)).toBeNull();
  });
});

describe('chapterAt and contextFor', () => {
  const chapters = [
    { startMs: 0, title: 'Intro' },
    { startMs: 60_000, title: 'Main' },
  ];

  it('finds the chapter playing at a time', () => {
    expect(chapterAt(chapters, 59_999)).toBe('Intro');
    expect(chapterAt(chapters, 60_000)).toBe('Main');
  });

  it('puts the excerpt, chapter and confidence together', () => {
    const ctx = contextFor(
      { startSec: 61, endSec: 64, anchorDurationSec: 120 },
      { audioDurationSec: 120, segments: [seg(60, 70, 'Here we go. The main point is simple. Then more.')], chapters },
    );
    expect(ctx).toMatchObject({ chapterTitle: 'Main', confidence: 'exact', offsetSec: 0 });
    expect(ctx.excerpt).toContain('main point');
  });
});
