import { randomUUID } from 'node:crypto';

import type { TranscriptSource } from '@podcast/shared';
import type { Sql } from 'postgres';

import {
  audioDurationOf,
  statusOf,
  type Chunk,
  type DlogosPurpose,
  type StoredChunk,
  type TranscriptContent,
  type TranscriptRow,
  type TranscriptStore,
} from './transcripts';

type Row = {
  id: string;
  episode_id: string;
  source: TranscriptSource;
  status: TranscriptRow['status'];
  language: string | null;
  audio_duration_sec: number | null;
  reported_duration_sec: number | null;
  audio_url: string | null;
  external_id: string | null;
  poll_url: string | null;
  error: string | null;
  requested_at: Date;
  fetched_at: Date | null;
};

const COLUMNS = `id, episode_id, source, status, language, audio_duration_sec, reported_duration_sec, audio_url,
  external_id, poll_url, error, requested_at, fetched_at`;

const toRow = (r: Row): TranscriptRow => ({
  id: r.id,
  episodeId: r.episode_id,
  source: r.source,
  status: r.status,
  language: r.language,
  audioDurationSec: r.audio_duration_sec,
  reportedDurationSec: r.reported_duration_sec,
  audioUrl: r.audio_url,
  externalId: r.external_id,
  pollUrl: r.poll_url,
  error: r.error,
  requestedAt: r.requested_at,
  fetchedAt: r.fetched_at,
});

// 6 columns per segment; Postgres allows 65,535 parameters per statement.
const SEGMENT_BATCH = 5000;

export class PostgresTranscriptStore implements TranscriptStore {
  constructor(private sql: Sql) {}

  async find(episodeId: string, source: TranscriptSource) {
    const [r] = await this.sql<Row[]>`
      select ${this.sql.unsafe(COLUMNS)} from transcripts where episode_id = ${episodeId} and source = ${source}`;
    return r ? toRow(r) : null;
  }

  async current(episodeId: string) {
    const [r] = await this.sql<Row[]>`
      select ${this.sql.unsafe(COLUMNS)} from episode_transcript where episode_id = ${episodeId}`;
    return r ? toRow(r) : null;
  }

  async status(episodeId: string) {
    const rows = await this.sql<{ source: TranscriptSource; status: TranscriptRow['status'] }[]>`
      select source, status from transcripts where episode_id = ${episodeId}`;
    return statusOf(rows);
  }

  async markPending(episodeId: string, source: TranscriptSource, opts: { externalId?: string | null; pollUrl?: string | null } = {}) {
    const [r] = await this.sql<Row[]>`
      insert into transcripts (id, episode_id, source, status, external_id, poll_url)
      values (${randomUUID()}, ${episodeId}, ${source}, 'pending', ${opts.externalId ?? null}, ${opts.pollUrl ?? null})
      on conflict (episode_id, source) do update set status = 'pending', error = null, requested_at = now(),
        external_id = coalesce(excluded.external_id, transcripts.external_id),
        poll_url = coalesce(excluded.poll_url, transcripts.poll_url)
      returning ${this.sql.unsafe(COLUMNS)}`;
    return toRow(r!);
  }

  async markFailed(episodeId: string, source: TranscriptSource, status: 'failed' | 'unavailable', error: string) {
    await this.sql`
      insert into transcripts (id, episode_id, source, status, error)
      values (${randomUUID()}, ${episodeId}, ${source}, ${status}, ${error})
      on conflict (episode_id, source) do update set status = excluded.status, error = excluded.error`;
  }

  async saveReady(
    episodeId: string,
    source: TranscriptSource,
    meta: { language?: string | null; reportedDurationSec?: number | null; audioUrl?: string | null; externalId?: string | null },
    content: TranscriptContent,
  ) {
    return this.sql.begin(async (tx) => {
      const [r] = await tx<Row[]>`
        insert into transcripts (id, episode_id, source, status, language, audio_duration_sec, reported_duration_sec,
          audio_url, external_id, raw, fetched_at)
        values (${randomUUID()}, ${episodeId}, ${source}, 'ready', ${meta.language ?? null}, ${audioDurationOf(content.segments)},
          ${meta.reportedDurationSec ?? null}, ${meta.audioUrl ?? null}, ${meta.externalId ?? null},
          ${content.raw === undefined ? null : tx.json(content.raw as never)}, now())
        on conflict (episode_id, source) do update set status = 'ready', error = null, language = excluded.language,
          audio_duration_sec = excluded.audio_duration_sec, reported_duration_sec = excluded.reported_duration_sec,
          audio_url = excluded.audio_url, external_id = coalesce(excluded.external_id, transcripts.external_id),
          raw = excluded.raw, fetched_at = now()
        returning ${tx.unsafe(COLUMNS)}`;
      const id = r!.id;
      // Content is replaced whole; chunks built from the old content go with it.
      await tx`delete from transcript_segments where transcript_id = ${id}`;
      await tx`delete from episode_chapters where transcript_id = ${id}`;
      await tx`delete from episode_takeaways where transcript_id = ${id}`;
      await tx`delete from transcript_chunks where transcript_id = ${id}`;
      const segs = content.segments.map((s, idx) => ({
        transcript_id: id,
        idx,
        start_ms: Math.round(s.startMs),
        end_ms: Math.round(s.endMs),
        speaker: s.speaker,
        text: s.text,
      }));
      for (let i = 0; i < segs.length; i += SEGMENT_BATCH) await tx`insert into transcript_segments ${tx(segs.slice(i, i + SEGMENT_BATCH))}`;
      if (content.chapters.length) {
        await tx`insert into episode_chapters ${tx(
          content.chapters.map((c, position) => ({ transcript_id: id, position, start_ms: Math.round(c.startMs), title: c.title })),
        )}`;
      }
      if (content.takeaways.length) {
        await tx`insert into episode_takeaways ${tx(
          content.takeaways.map((t, position) => ({
            transcript_id: id,
            position,
            start_ms: t.startMs === null ? null : Math.round(t.startMs),
            text: t.text,
            tags: t.tags,
          })),
        )}`;
      }
      return toRow(r!);
    });
  }

  async segments(transcriptId: string, range?: { fromMs: number; toMs: number }) {
    const rows = range
      ? await this.sql<{ idx: number; start_ms: number; end_ms: number; speaker: string | null; text: string }[]>`
          select idx, start_ms, end_ms, speaker, text from transcript_segments
          where transcript_id = ${transcriptId} and end_ms > ${range.fromMs} and start_ms < ${range.toMs}
          order by idx`
      : await this.sql<{ idx: number; start_ms: number; end_ms: number; speaker: string | null; text: string }[]>`
          select idx, start_ms, end_ms, speaker, text from transcript_segments where transcript_id = ${transcriptId} order by idx`;
    return rows.map((r) => ({ idx: r.idx, startMs: r.start_ms, endMs: r.end_ms, speaker: r.speaker, text: r.text }));
  }

  async chapters(transcriptId: string) {
    const rows = await this.sql<{ start_ms: number; title: string }[]>`
      select start_ms, title from episode_chapters where transcript_id = ${transcriptId} order by position`;
    return rows.map((r) => ({ startMs: r.start_ms, title: r.title }));
  }

  async takeaways(transcriptId: string) {
    const rows = await this.sql<{ start_ms: number | null; text: string; tags: string[] }[]>`
      select start_ms, text, tags from episode_takeaways where transcript_id = ${transcriptId} order by position`;
    return rows.map((r) => ({ startMs: r.start_ms, text: r.text, tags: r.tags }));
  }

  async saveChunks(transcriptId: string, chunkerVersion: number, chunks: Chunk[]): Promise<StoredChunk[]> {
    return this.sql.begin(async (tx) => {
      await tx`delete from transcript_chunks where transcript_id = ${transcriptId} and chunker_version = ${chunkerVersion}`;
      if (!chunks.length) return [];
      const rows = await tx<{ id: string }[]>`
        insert into transcript_chunks ${tx(
          chunks.map((c) => ({
            transcript_id: transcriptId,
            chunker_version: chunkerVersion,
            kind: c.kind,
            seg_from: c.segFrom,
            seg_to: c.segTo,
            start_ms: Math.round(c.startMs),
            end_ms: Math.round(c.endMs),
            text: c.text,
            is_ad: c.isAd,
          })),
        )}
        returning id`;
      return chunks.map((c, i) => ({ ...c, id: String(rows[i]!.id), transcriptId }));
    });
  }

  async chunks(transcriptId: string, chunkerVersion: number) {
    const rows = await this.sql<
      { id: string; kind: Chunk['kind']; seg_from: number | null; seg_to: number | null; start_ms: number; end_ms: number; text: string; is_ad: boolean }[]
    >`select id, kind, seg_from, seg_to, start_ms, end_ms, text, is_ad from transcript_chunks
      where transcript_id = ${transcriptId} and chunker_version = ${chunkerVersion} order by id`;
    return rows.map((r) => ({
      id: String(r.id),
      transcriptId,
      kind: r.kind,
      segFrom: r.seg_from,
      segTo: r.seg_to,
      startMs: r.start_ms,
      endMs: r.end_ms,
      text: r.text,
      isAd: r.is_ad,
    }));
  }

  async dlogosSlug(podcastId: string) {
    const [r] = await this.sql<{ slug: string }[]>`select slug from dlogos_podcasts where podcast_id = ${podcastId}`;
    return r?.slug ?? null;
  }

  async setDlogosSlug(podcastId: string, slug: string, matchedBy: 'manual' | 'api_lookup' | 'title_match') {
    await this.sql`
      insert into dlogos_podcasts (podcast_id, slug, matched_by) values (${podcastId}, ${slug}, ${matchedBy})
      on conflict (podcast_id) do update set slug = excluded.slug, matched_by = excluded.matched_by, checked_at = now()`;
  }

  async countDlogosRequest(day: string, purpose: DlogosPurpose) {
    const [r] = await this.sql<{ requests: number }[]>`
      insert into dlogos_usage (day, purpose, requests) values (${day}, ${purpose}, 1)
      on conflict (day, purpose) do update set requests = dlogos_usage.requests + 1
      returning requests`;
    return r!.requests;
  }

  async dlogosRequests(day: string, purpose: DlogosPurpose) {
    const [r] = await this.sql<{ requests: number }[]>`
      select requests from dlogos_usage where day = ${day} and purpose = ${purpose}`;
    return r?.requests ?? 0;
  }
}
