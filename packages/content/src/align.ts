import type { TranscriptChapter, TranscriptConfidence, TranscriptSegment } from '@podcast/shared';

// Turning a highlight's range (seconds of the audio the listener heard) into transcript words.
// The listener's audio and the transcribed audio can differ, usually by dynamically inserted ads:
// dLogos' copy of a 37-minute Daily episode ran ~112 s longer than the duration it reported.

/** Durations within this many seconds count as the same audio. */
export const SAME_AUDIO_TOLERANCE_SEC = 2;
/** How far an excerpt may grow to reach a sentence start or end. */
export const SNAP_LIMIT_SEC = 5;
/** How far the start may move forward, past the tail of a sentence that began long before. */
const FORWARD_START_LIMIT_SEC = 3;

export type Placement = { offsetSec: number; confidence: TranscriptConfidence };

/**
 * Where the highlight's range falls in the transcript.
 *
 * - `exact`: the listener's audio and the transcribed audio are the same length; no shift.
 * - `approximate`: they differ, or a length is unknown. The difference is assumed to be spread
 *   evenly through the episode (inserted ads usually are: pre-, mid- and post-roll), so the shift
 *   grows with the position. Right on average, possibly off by an ad break's length.
 *
 * `aligned` (a shift backed by evidence from the listener's audio, e.g. an on-device fingerprint)
 * isn't produced yet. Matching captured edges to segment boundaries was considered and dropped:
 * dLogos segments run 10–18 s, so any shift fits the boundaries about as well as any other.
 */
export function placeRange(input: { startSec: number; anchorDurationSec: number | null; transcriptDurationSec: number | null }): Placement {
  const { startSec, anchorDurationSec: heard, transcriptDurationSec: transcribed } = input;
  if (heard === null || transcribed === null || heard <= 0) return { offsetSec: 0, confidence: 'approximate' };
  const delta = transcribed - heard;
  if (Math.abs(delta) <= SAME_AUDIO_TOLERANCE_SEC) return { offsetSec: 0, confidence: 'exact' };
  return { offsetSec: delta * Math.min(1, Math.max(0, startSec / heard)), confidence: 'approximate' };
}

type Word = { text: string; atMs: number };

/** Segments carry no word timings, so place each word evenly through its segment. */
function wordsOf(segments: TranscriptSegment[]): Word[] {
  const words: Word[] = [];
  for (const s of [...segments].sort((a, b) => a.startMs - b.startMs)) {
    const parts = s.text.split(/\s+/).filter(Boolean);
    const span = Math.max(0, s.endMs - s.startMs);
    parts.forEach((text, i) => words.push({ text, atMs: s.startMs + ((i + 0.5) / parts.length) * span }));
  }
  return words;
}

const endsSentence = (w: string) => /[.?!]["')\]”’]?$/.test(w);

/**
 * The words spoken between `fromMs` and `toMs`, widened to the start of the first sentence and
 * the end of the last one when that's no more than `SNAP_LIMIT_SEC` away. Pass segments that
 * reach a little past both ends so there's room to widen.
 */
export function excerptBetween(segments: TranscriptSegment[], fromMs: number, toMs: number): string | null {
  const words = wordsOf(segments);
  let first = words.findIndex((w) => w.atMs >= fromMs);
  if (first === -1) return null;
  let last = words.length - 1;
  while (last >= 0 && words[last]!.atMs > toMs) last--;
  if (last < first) return null;

  const limitMs = SNAP_LIMIT_SEC * 1000;
  // Back to the word after the previous sentence's end.
  let snapped = first === 0 || endsSentence(words[first - 1]!.text);
  for (let i = first - 1; !snapped && i >= 0 && fromMs - words[i]!.atMs <= limitMs; i--) {
    if (endsSentence(words[i]!.text) || i === 0) {
      first = endsSentence(words[i]!.text) ? i + 1 : 0;
      snapped = true;
    }
  }
  // The sentence started too long ago: rather than open mid-sentence, skip its last few words if
  // it ends just after the range starts ("…save it. Towns that…" becomes "Towns that…").
  if (!snapped) {
    for (let i = first; i < last && words[i]!.atMs - fromMs <= FORWARD_START_LIMIT_SEC * 1000; i++) {
      if (endsSentence(words[i]!.text)) {
        first = i + 1;
        break;
      }
    }
  }
  // Forward to this sentence's end.
  if (!endsSentence(words[last]!.text)) {
    for (let i = last + 1; i < words.length && words[i]!.atMs - toMs <= limitMs; i++) {
      if (endsSentence(words[i]!.text)) {
        last = i;
        break;
      }
    }
  }
  return words
    .slice(first, last + 1)
    .map((w) => w.text)
    .join(' ');
}

/** The chapter playing at `ms`: the last one starting at or before it. */
export function chapterAt(chapters: TranscriptChapter[], ms: number): string | null {
  let title: string | null = null;
  for (const c of [...chapters].sort((a, b) => a.startMs - b.startMs)) {
    if (c.startMs <= ms) title = c.title;
    else break;
  }
  return title;
}

export type HighlightContext = {
  excerpt: string | null;
  chapterTitle: string | null;
  offsetSec: number;
  confidence: TranscriptConfidence;
};

/** Everything the server derives for one highlight from its range and the episode's transcript. */
export function contextFor(
  range: { startSec: number; endSec: number; anchorDurationSec: number | null },
  transcript: { audioDurationSec: number | null; segments: TranscriptSegment[]; chapters: TranscriptChapter[] },
): HighlightContext {
  const placement = placeRange({
    startSec: range.startSec,
    anchorDurationSec: range.anchorDurationSec,
    transcriptDurationSec: transcript.audioDurationSec,
  });
  const fromMs = (range.startSec + placement.offsetSec) * 1000;
  const toMs = (range.endSec + placement.offsetSec) * 1000;
  return {
    excerpt: excerptBetween(transcript.segments, fromMs, toMs),
    chapterTitle: chapterAt(transcript.chapters, fromMs),
    offsetSec: placement.offsetSec,
    confidence: placement.confidence,
  };
}
