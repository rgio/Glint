import { randomUUID } from 'node:crypto';

import type { TranscriptChapter, TranscriptSegment, TranscriptSource, TranscriptStatus } from '@podcast/shared';

export type Takeaway = { startMs: number | null; text: string; tags: string[] };

export type TranscriptContent = {
  segments: TranscriptSegment[];
  chapters: TranscriptChapter[];
  takeaways: Takeaway[];
  /** The source's full response, kept so we can reprocess without asking again. */
  raw?: unknown;
};

export type TranscriptRow = {
  id: string;
  episodeId: string;
  source: TranscriptSource;
  status: 'pending' | 'ready' | 'failed' | 'unavailable';
  language: string | null;
  /** Length of the audio that was transcribed: its last segment's end. */
  audioDurationSec: number | null;
  reportedDurationSec: number | null;
  audioUrl: string | null;
  externalId: string | null;
  pollUrl: string | null;
  error: string | null;
  requestedAt: Date;
  fetchedAt: Date | null;
};

/** A stored segment, with its position in the transcript. */
export type StoredSegment = TranscriptSegment & { idx: number };

export type ChunkKind = 'window' | 'chapter' | 'takeaway';

export type Chunk = {
  kind: ChunkKind;
  /** First and last segment covered (windows and chapters). */
  segFrom: number | null;
  segTo: number | null;
  startMs: number;
  endMs: number;
  text: string;
  isAd: boolean;
};

export type StoredChunk = Chunk & { id: string; transcriptId: string };

export type DlogosPurpose = 'highlight' | 'transcript_view' | 'seed';

/** Readers prefer dLogos, then timed publisher formats in this order. */
export const SOURCE_PREFERENCE: TranscriptSource[] = ['dlogos', 'publisher_json', 'publisher_vtt', 'publisher_srt'];

/** Transcripts, their parts, chunks, and the dLogos show mapping. Global content, not per user. */
export interface TranscriptStore {
  find(episodeId: string, source: TranscriptSource): Promise<TranscriptRow | null>;
  /** The transcript readers use: dLogos when ready, else the best ready publisher one. */
  current(episodeId: string): Promise<TranscriptRow | null>;
  status(episodeId: string): Promise<{ status: TranscriptStatus; source: TranscriptSource | null }>;
  /** Records a request in progress (creating the row, or resetting a failed one). */
  markPending(episodeId: string, source: TranscriptSource, opts?: { externalId?: string | null; pollUrl?: string | null }): Promise<TranscriptRow>;
  markFailed(episodeId: string, source: TranscriptSource, status: 'failed' | 'unavailable', error: string): Promise<void>;
  /** Stores a finished transcript, replacing any earlier content for the same source. */
  saveReady(
    episodeId: string,
    source: TranscriptSource,
    meta: { language?: string | null; reportedDurationSec?: number | null; audioUrl?: string | null; externalId?: string | null },
    content: TranscriptContent,
  ): Promise<TranscriptRow>;
  segments(transcriptId: string, range?: { fromMs: number; toMs: number }): Promise<StoredSegment[]>;
  chapters(transcriptId: string): Promise<TranscriptChapter[]>;
  takeaways(transcriptId: string): Promise<Takeaway[]>;

  /** Replaces a transcript's chunks for this chunker version. */
  saveChunks(transcriptId: string, chunkerVersion: number, chunks: Chunk[]): Promise<StoredChunk[]>;
  chunks(transcriptId: string, chunkerVersion: number): Promise<StoredChunk[]>;

  dlogosSlug(podcastId: string): Promise<string | null>;
  setDlogosSlug(podcastId: string, slug: string, matchedBy: 'manual' | 'api_lookup' | 'title_match'): Promise<void>;
  /** Counts a dLogos request against today's budget; returns today's total for that purpose. */
  countDlogosRequest(day: string, purpose: DlogosPurpose): Promise<number>;
  dlogosRequests(day: string, purpose: DlogosPurpose): Promise<number>;
}

/** Status for an episode given its transcript rows, the same rule both stores use. */
export function statusOf(rows: Pick<TranscriptRow, 'source' | 'status'>[]): { status: TranscriptStatus; source: TranscriptSource | null } {
  const ready = rows.filter((r) => r.status === 'ready').sort((a, b) => SOURCE_PREFERENCE.indexOf(a.source) - SOURCE_PREFERENCE.indexOf(b.source))[0];
  if (ready) return { status: 'ready', source: ready.source };
  const pending = rows.find((r) => r.status === 'pending');
  if (pending) return { status: 'pending', source: pending.source };
  return rows.length ? { status: 'unavailable', source: null } : { status: 'none', source: null };
}

export const audioDurationOf = (segments: TranscriptSegment[]) =>
  segments.length ? Math.max(...segments.map((s) => s.endMs)) / 1000 : null;

export class InMemoryTranscriptStore implements TranscriptStore {
  private rows = new Map<string, TranscriptRow>();
  private content = new Map<string, TranscriptContent>();
  private chunkSets = new Map<string, StoredChunk[]>();
  private slugs = new Map<string, string>();
  private usage = new Map<string, number>();
  private chunkId = 1;

  private key = (episodeId: string, source: TranscriptSource) => `${episodeId}\n${source}`;

  async find(episodeId: string, source: TranscriptSource) {
    return this.rows.get(this.key(episodeId, source)) ?? null;
  }

  private forEpisode(episodeId: string) {
    return [...this.rows.values()].filter((r) => r.episodeId === episodeId);
  }

  async current(episodeId: string) {
    const { status, source } = statusOf(this.forEpisode(episodeId));
    return status === 'ready' && source ? this.find(episodeId, source) : null;
  }

  async status(episodeId: string) {
    return statusOf(this.forEpisode(episodeId));
  }

  async markPending(episodeId: string, source: TranscriptSource, opts: { externalId?: string | null; pollUrl?: string | null } = {}) {
    const existing = await this.find(episodeId, source);
    const row: TranscriptRow = {
      id: existing?.id ?? randomUUID(),
      episodeId,
      source,
      status: 'pending',
      language: existing?.language ?? null,
      audioDurationSec: existing?.audioDurationSec ?? null,
      reportedDurationSec: existing?.reportedDurationSec ?? null,
      audioUrl: existing?.audioUrl ?? null,
      externalId: opts.externalId ?? existing?.externalId ?? null,
      pollUrl: opts.pollUrl ?? existing?.pollUrl ?? null,
      error: null,
      requestedAt: new Date(),
      fetchedAt: existing?.fetchedAt ?? null,
    };
    this.rows.set(this.key(episodeId, source), row);
    return row;
  }

  async markFailed(episodeId: string, source: TranscriptSource, status: 'failed' | 'unavailable', error: string) {
    const row = (await this.find(episodeId, source)) ?? (await this.markPending(episodeId, source));
    this.rows.set(this.key(episodeId, source), { ...row, status, error });
  }

  async saveReady(
    episodeId: string,
    source: TranscriptSource,
    meta: { language?: string | null; reportedDurationSec?: number | null; audioUrl?: string | null; externalId?: string | null },
    content: TranscriptContent,
  ) {
    const existing = await this.find(episodeId, source);
    const row: TranscriptRow = {
      id: existing?.id ?? randomUUID(),
      episodeId,
      source,
      status: 'ready',
      language: meta.language ?? null,
      audioDurationSec: audioDurationOf(content.segments),
      reportedDurationSec: meta.reportedDurationSec ?? null,
      audioUrl: meta.audioUrl ?? null,
      externalId: meta.externalId ?? existing?.externalId ?? null,
      pollUrl: existing?.pollUrl ?? null,
      error: null,
      requestedAt: existing?.requestedAt ?? new Date(),
      fetchedAt: new Date(),
    };
    this.rows.set(this.key(episodeId, source), row);
    this.content.set(row.id, content);
    return row;
  }

  async segments(transcriptId: string, range?: { fromMs: number; toMs: number }) {
    const segs = (this.content.get(transcriptId)?.segments ?? []).map((s, idx) => ({ ...s, idx }));
    return range ? segs.filter((s) => s.endMs > range.fromMs && s.startMs < range.toMs) : segs;
  }

  async chapters(transcriptId: string) {
    return this.content.get(transcriptId)?.chapters ?? [];
  }

  async takeaways(transcriptId: string) {
    return this.content.get(transcriptId)?.takeaways ?? [];
  }

  async saveChunks(transcriptId: string, chunkerVersion: number, chunks: Chunk[]) {
    const stored = chunks.map((c) => ({ ...c, id: String(this.chunkId++), transcriptId }));
    this.chunkSets.set(`${transcriptId}\n${chunkerVersion}`, stored);
    return stored;
  }

  async chunks(transcriptId: string, chunkerVersion: number) {
    return this.chunkSets.get(`${transcriptId}\n${chunkerVersion}`) ?? [];
  }

  async dlogosSlug(podcastId: string) {
    return this.slugs.get(podcastId) ?? null;
  }

  async setDlogosSlug(podcastId: string, slug: string) {
    this.slugs.set(podcastId, slug);
  }

  async countDlogosRequest(day: string, purpose: DlogosPurpose) {
    const n = (this.usage.get(`${day}\n${purpose}`) ?? 0) + 1;
    this.usage.set(`${day}\n${purpose}`, n);
    return n;
  }

  async dlogosRequests(day: string, purpose: DlogosPurpose) {
    return this.usage.get(`${day}\n${purpose}`) ?? 0;
  }
}
