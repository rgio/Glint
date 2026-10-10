import type { TranscriptChapter, TranscriptSegment } from '@podcast/shared';

import type { Takeaway, TranscriptContent } from './transcripts';

// dLogos Partner Episode API (no public docs; shapes from dlogos_test.py and a saved response).
// Every response is enveloped as { success, data, message, error }. Requests carry only a show's
// public slug and an episode GUID, never anything about a listener.

export const DLOGOS_BASE_URL = 'https://dlogos.xyz';

export class DlogosError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 for network errors. 4xx other than 429 won't succeed on retry. */
    readonly status: number,
  ) {
    super(message);
  }

  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

type Envelope<T> = { success: boolean; data: T; message?: string; error?: string };

type RawSegment = { idx: number; start_ms: number; end_ms: number; speaker: string | null; text: string };
type RawTranscriptPage = { segments?: RawSegment[]; total?: number; page?: number; page_size?: number; has_more?: boolean };

/** What a poll returns once the episode is known to dLogos. */
export type DlogosEpisodeData = {
  episode_id: string;
  status: string;
  detail?: { transcript_status?: string; jobs?: { job_type: string; status: string }[] };
  episode?: {
    id: string;
    guid?: string;
    slug?: string;
    title?: string;
    duration_seconds?: number;
    audio_url?: string;
    podcast?: { id: string; name?: string; slug: string };
  };
  transcript?: RawTranscriptPage;
  speaker_map?: Record<string, string>;
  takeaways?: { text: string; tags?: string[]; position: number; start_ms?: number | null }[];
  chapters?: { title: string; start_ms: number; position: number }[];
  claims?: unknown[];
};

export type DlogosSubmitResult = { pollUrl: string; episodeId: string | null; status: string | null };

export type DlogosPollResult =
  | { state: 'ready'; data: DlogosEpisodeData }
  | { state: 'processing'; status: string }
  | { state: 'failed'; status: string };

const FAILED_STATUSES = new Set(['failed', 'error', 'rejected', 'not_found']);

export type DlogosClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class DlogosClient {
  private readonly base: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: DlogosClientOptions) {
    this.base = new URL(opts.baseUrl ?? DLOGOS_BASE_URL);
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** Asks dLogos to process an episode, identified by the show's slug and the episode's feed GUID. */
  async submit(podcastSlug: string, episode: { guid: string } | { slug: string }): Promise<DlogosSubmitResult> {
    const data = await this.request<{ poll_url: string; episode_id?: string; status?: string }>(
      new URL('/api/v2/partner/episodes/process', this.base),
      { method: 'POST', body: JSON.stringify({ podcast: { slug: podcastSlug }, episode }) },
    );
    if (!data?.poll_url) throw new DlogosError('dLogos accepted the episode but returned no poll_url', 502);
    return { pollUrl: data.poll_url, episodeId: data.episode_id ?? null, status: data.status ?? null };
  }

  /** One poll. When ready, follows `transcript.has_more` pages so the result holds every segment. */
  async poll(pollUrl: string): Promise<DlogosPollResult> {
    const url = this.pollUrl(pollUrl);
    const data = await this.request<DlogosEpisodeData>(url);
    const status = String(data.status ?? '');
    if (FAILED_STATUSES.has(status)) return { state: 'failed', status };
    if (status !== 'ready') return { state: 'processing', status };

    // Pages are numbered from 0 (the first response says `page: 0`), so ask for the one after
    // whatever page we last got rather than assuming a starting number.
    const segments = [...(data.transcript?.segments ?? [])];
    let page = data.transcript;
    for (let fetched = 1; page?.has_more; fetched++) {
      if (fetched > 200) throw new DlogosError('dLogos transcript has more than 200 pages', 502);
      const next = new URL(url);
      next.searchParams.set('transcript_page', String((page.page ?? fetched - 1) + 1));
      page = (await this.request<{ transcript?: RawTranscriptPage }>(next)).transcript;
      segments.push(...(page?.segments ?? []));
    }
    return { state: 'ready', data: { ...data, transcript: { ...data.transcript, segments, has_more: false } } };
  }

  /** Poll URLs come back from dLogos; the API key is only ever sent to dLogos' own host. */
  private pollUrl(pollUrl: string): URL {
    const url = new URL(pollUrl, this.base);
    if (url.origin !== this.base.origin) throw new DlogosError(`Refusing to poll ${url.origin}: not dLogos`, 400);
    return url;
  }

  private async request<T>(url: URL, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      throw new DlogosError(`Could not reach dLogos: ${(err as Error).message}`, 0);
    }
    let body: Envelope<T>;
    try {
      body = (await res.json()) as Envelope<T>;
    } catch {
      throw new DlogosError(`dLogos returned non-JSON (HTTP ${res.status})`, res.status || 502);
    }
    if (!res.ok || !body.success) {
      throw new DlogosError(`dLogos error ${res.status} ${body.error ?? ''}: ${body.message ?? ''}`.trim(), res.ok ? 502 : res.status);
    }
    return body.data;
  }
}

/** A ready dLogos response as our transcript content. */
export function dlogosToTranscript(data: DlogosEpisodeData): {
  content: TranscriptContent;
  externalId: string;
  audioUrl: string | null;
  reportedDurationSec: number | null;
} {
  const segments: TranscriptSegment[] = [...(data.transcript?.segments ?? [])]
    .sort((a, b) => a.idx - b.idx)
    .filter((s) => s.text?.trim())
    .map((s) => ({ startMs: s.start_ms, endMs: s.end_ms, speaker: s.speaker ?? null, text: s.text.trim() }));
  const chapters: TranscriptChapter[] = [...(data.chapters ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ startMs: c.start_ms, title: c.title }));
  const takeaways: Takeaway[] = [...(data.takeaways ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((t) => ({ startMs: t.start_ms ?? null, text: t.text, tags: t.tags ?? [] }));
  return {
    content: { segments, chapters, takeaways, raw: data },
    externalId: data.episode_id,
    audioUrl: data.episode?.audio_url ?? null,
    reportedDurationSec: data.episode?.duration_seconds ?? null,
  };
}
