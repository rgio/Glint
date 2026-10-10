import type { TranscriptSegment, TranscriptSource } from '@podcast/shared';

// Publisher transcripts from `podcast:transcript` tags: Podcasting 2.0 JSON, WebVTT and SRT.
// Only timed formats are parsed; plain text and HTML can't be matched to a highlight's range.

export class TranscriptFormatError extends Error {}

/** The source for a transcript MIME type, or null when we can't use it (untimed or unknown). */
export function sourceForType(type: string | null, url: string): Exclude<TranscriptSource, 'dlogos'> | null {
  const t = (type ?? '').toLowerCase().split(';')[0]!.trim();
  if (t === 'application/json') return 'publisher_json';
  if (t === 'text/vtt') return 'publisher_vtt';
  if (t === 'application/x-subrip' || t === 'application/srt' || t === 'text/srt') return 'publisher_srt';
  // Some feeds leave the type off; trust a clear extension.
  const ext = new URL(url).pathname.toLowerCase().split('.').pop();
  if (!t && ext === 'json') return 'publisher_json';
  if (!t && ext === 'vtt') return 'publisher_vtt';
  if (!t && ext === 'srt') return 'publisher_srt';
  return null;
}

/** "01:02:03.456", "02:03,456" or "3.5" to milliseconds. */
function timestampMs(value: string): number {
  const parts = value.trim().replace(',', '.').split(':');
  if (parts.some((p) => p === '' || Number.isNaN(Number(p)))) throw new TranscriptFormatError(`Bad timestamp: ${value}`);
  const seconds = parts.reduce((total, p) => total * 60 + Number(p), 0);
  return Math.round(seconds * 1000);
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Cue = { startMs: number; endMs: number; speaker: string | null; text: string };

function cuesFromBlocks(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing === -1) continue; // header, NOTE, STYLE or a cue number on its own
    const [from, rest] = lines[timing]!.split('-->');
    const to = rest!.trim().split(/\s+/)[0]!; // drop WebVTT cue settings
    const body = lines.slice(timing + 1).join(' ');
    // WebVTT voice span: <v Speaker Name>words</v>
    const voice = /<v(?:\.[\w.-]+)?\s+([^>]+)>/.exec(body);
    const words = stripTags(body);
    if (!words) continue;
    cues.push({ startMs: timestampMs(from!), endMs: timestampMs(to), speaker: voice ? voice[1]!.trim() : null, text: words });
  }
  return cues;
}

export function parseVtt(text: string): Cue[] {
  if (!/^﻿?WEBVTT/.test(text)) throw new TranscriptFormatError('Not a WebVTT file');
  return cuesFromBlocks(text);
}

export function parseSrt(text: string): Cue[] {
  const cues = cuesFromBlocks(text.replace(/^﻿/, ''));
  if (!cues.length) throw new TranscriptFormatError('No SRT cues found');
  return cues;
}

/** Podcasting 2.0 JSON: `{ version, segments: [{ speaker?, startTime, endTime, body }] }`, times in seconds. */
export function parseJsonTranscript(text: string): Cue[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new TranscriptFormatError('Transcript is not valid JSON');
  }
  const segments = (doc as { segments?: unknown })?.segments;
  if (!Array.isArray(segments)) throw new TranscriptFormatError('JSON transcript has no segments');
  return segments
    .map((s: { startTime?: unknown; endTime?: unknown; body?: unknown; speaker?: unknown }) => ({
      startMs: Math.round(Number(s.startTime) * 1000),
      endMs: Math.round(Number(s.endTime) * 1000),
      speaker: typeof s.speaker === 'string' && s.speaker.trim() ? s.speaker.trim() : null,
      text: typeof s.body === 'string' ? stripTags(s.body) : '',
    }))
    .filter((c) => c.text && Number.isFinite(c.startMs) && Number.isFinite(c.endMs));
}

/** Longest a merged segment gets, and how long one must be before a sentence end closes it. */
const MAX_SEGMENT_MS = 20_000;
const MIN_SEGMENT_MS = 5_000;

/**
 * Publisher cues are often a few words (or one word, in JSON) long. Merges them into utterances
 * like dLogos' segments: same speaker, ending at a sentence end once 5 s long, never over 20 s.
 */
export function mergeCues(cues: Cue[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let cur = null as TranscriptSegment | null;
  for (const cue of [...cues].sort((a, b) => a.startMs - b.startMs)) {
    if (cur && (cue.speaker !== cur.speaker || cue.endMs - cur.startMs > MAX_SEGMENT_MS)) {
      out.push(cur);
      cur = null;
    }
    cur = cur ? { ...cur, endMs: Math.max(cur.endMs, cue.endMs), text: `${cur.text} ${cue.text}` } : { ...cue };
    if (cur.endMs - cur.startMs >= MIN_SEGMENT_MS && /[.?!]["')\]]?$/.test(cur.text)) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function parsePublisherTranscript(source: Exclude<TranscriptSource, 'dlogos'>, text: string): TranscriptSegment[] {
  const cues = source === 'publisher_json' ? parseJsonTranscript(text) : source === 'publisher_vtt' ? parseVtt(text) : parseSrt(text);
  if (!cues.length) throw new TranscriptFormatError('Transcript has no timed text');
  return mergeCues(cues);
}
