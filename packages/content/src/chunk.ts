import type { TranscriptChapter } from '@podcast/shared';

import type { Chunk, StoredSegment, Takeaway } from './transcripts';

/** Bump when chunking changes; chunks and their vectors are rebuilt for the new version. */
export const CHUNKER_VERSION = 1;

/** A window closes once it's this long, or has this many words (~400 tokens). */
const WINDOW_MIN_MS = 60_000;
const WINDOW_MAX_MS = 90_000;
const WINDOW_MAX_WORDS = 300;
/** Words of a chapter's opening used to describe it. */
const CHAPTER_WORDS = 200;

/**
 * Sponsor reads. Leaving them in makes every show that runs the same sponsor look alike, which
 * would skew discovery. A first pass on wording; dLogos may later tell us where ads are.
 */
const AD_PATTERNS = [
  /\bbrought to you by\b/i,
  /\bsponsored by\b/i,
  /\b(this|today's) (episode|show) is sponsored\b/i,
  /\bsupport for (this|the) (podcast|show|episode) comes from\b/i,
  /\b(promo|discount|offer) code\b/i,
  /\buse code [A-Z0-9]+\b/i,
  /\bthis (message|ad) (comes from|is from)\b/i,
];

export const looksLikeAd = (text: string) => AD_PATTERNS.some((p) => p.test(text));

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Windows of about 60–90 s, cut on segment boundaries, each starting with the previous window's
 * last segment so a thought that spans the cut is whole in one of them.
 */
export function windows(segments: StoredSegment[]): Chunk[] {
  const segs = [...segments].sort((a, b) => a.idx - b.idx);
  const out: Chunk[] = [];
  let start = 0;
  while (start < segs.length) {
    let end = start;
    let words = wordCount(segs[start]!.text);
    while (end + 1 < segs.length) {
      const span = segs[end]!.endMs - segs[start]!.startMs;
      if (span >= WINDOW_MIN_MS || words >= WINDOW_MAX_WORDS) break;
      if (segs[end + 1]!.endMs - segs[start]!.startMs > WINDOW_MAX_MS) break;
      end++;
      words += wordCount(segs[end]!.text);
    }
    const covered = segs.slice(start, end + 1);
    const text = covered.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n');
    out.push({
      kind: 'window',
      segFrom: segs[start]!.idx,
      segTo: segs[end]!.idx,
      startMs: segs[start]!.startMs,
      endMs: segs[end]!.endMs,
      text,
      isAd: looksLikeAd(text),
    });
    if (end + 1 >= segs.length) break;
    // Overlap by one segment, but always move forward.
    start = end > start ? end : end + 1;
  }
  return out;
}

/** A chunk per chapter: its title and the words that open it. */
export function chapterChunks(chapters: TranscriptChapter[], segments: StoredSegment[]): Chunk[] {
  const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);
  const lastEnd = Math.max(0, ...segments.map((s) => s.endMs));
  return sorted.map((c, i) => {
    const endMs = sorted[i + 1]?.startMs ?? lastEnd;
    const inside = segments.filter((s) => s.startMs >= c.startMs && s.startMs < endMs).sort((a, b) => a.idx - b.idx);
    const opening = inside
      .map((s) => s.text)
      .join(' ')
      .split(/\s+/)
      .slice(0, CHAPTER_WORDS)
      .join(' ');
    return {
      kind: 'chapter' as const,
      segFrom: inside[0]?.idx ?? null,
      segTo: inside.at(-1)?.idx ?? null,
      startMs: c.startMs,
      endMs,
      text: `${c.title}\n${opening}`.trim(),
      isAd: false,
    };
  });
}

export function takeawayChunks(takeaways: Takeaway[]): Chunk[] {
  return takeaways.map((t) => ({
    kind: 'takeaway' as const,
    segFrom: null,
    segTo: null,
    startMs: t.startMs ?? 0,
    endMs: t.startMs ?? 0,
    text: t.tags.length ? `${t.text}\nTopics: ${t.tags.join(', ')}` : t.text,
    isAd: false,
  }));
}

export function chunkTranscript(input: { segments: StoredSegment[]; chapters: TranscriptChapter[]; takeaways: Takeaway[] }): Chunk[] {
  return [...takeawayChunks(input.takeaways), ...chapterChunks(input.chapters, input.segments), ...windows(input.segments)];
}
