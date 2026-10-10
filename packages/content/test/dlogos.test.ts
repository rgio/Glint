import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DlogosClient, DlogosError, dlogosToTranscript } from '../src';

// Same structure as a real response saved on 25 August 2026, with made-up text. Its audio runs
// past the reported duration (635 s against 600 s), like the real one did (2333 s against 2221 s).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/dlogos-episode.json', import.meta.url), 'utf8')) as {
  ready: Record<string, unknown>;
  page2: Record<string, unknown>;
};

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data, message: 'ok', error: null }), { status });

function fakeFetch(handler: (url: URL, init: RequestInit) => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input.toString());
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('DlogosClient', () => {
  it('submits with the show slug and episode GUID, sending the key', async () => {
    const { fetch, calls } = fakeFetch(() => ok({ poll_url: '/api/v2/partner/episodes/abc', episode_id: 'abc', status: 'queued' }));
    const client = new DlogosClient({ apiKey: 'secret', fetch });
    expect(await client.submit('town-talk-a1b2c3d4', { guid: 'guid-main-street' })).toEqual({
      pollUrl: '/api/v2/partner/episodes/abc',
      episodeId: 'abc',
      status: 'queued',
    });
    expect(calls[0]!.url.toString()).toBe('https://dlogos.xyz/api/v2/partner/episodes/process');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ podcast: { slug: 'town-talk-a1b2c3d4' }, episode: { guid: 'guid-main-street' } });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('follows transcript pages from the page number dLogos reports', async () => {
    const { fetch, calls } = fakeFetch((url) => (url.searchParams.get('transcript_page') === '1' ? ok(fixture.page2) : ok(fixture.ready)));
    const result = await new DlogosClient({ apiKey: 'k', fetch }).poll('/api/v2/partner/episodes/abc');
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;
    expect(result.data.transcript?.segments).toHaveLength(12);
    expect(calls.map((c) => c.url.searchParams.get('transcript_page'))).toEqual([null, '1']);
  });

  it('reports processing and failure states', async () => {
    const processing = new DlogosClient({ apiKey: 'k', fetch: fakeFetch(() => ok({ episode_id: 'x', status: 'transcribing' })).fetch });
    expect(await processing.poll('/p')).toEqual({ state: 'processing', status: 'transcribing' });
    const failed = new DlogosClient({ apiKey: 'k', fetch: fakeFetch(() => ok({ episode_id: 'x', status: 'failed' })).fetch });
    expect(await failed.poll('/p')).toEqual({ state: 'failed', status: 'failed' });
  });

  it('never sends the key to another host', async () => {
    const { fetch, calls } = fakeFetch(() => ok({}));
    await expect(new DlogosClient({ apiKey: 'k', fetch }).poll('https://evil.example.com/steal')).rejects.toThrow(/not dLogos/);
    expect(calls).toHaveLength(0);
  });

  it('turns error envelopes into DlogosError, retryable only for 429 and 5xx', async () => {
    const answer = (status: number) =>
      new DlogosClient({
        apiKey: 'k',
        fetch: fakeFetch(() => new Response(JSON.stringify({ success: false, data: null, error: 'nope', message: 'bad' }), { status })).fetch,
      }).submit('s', { guid: 'g' });
    const notFound = await answer(404).catch((e: DlogosError) => e);
    expect(notFound).toBeInstanceOf(DlogosError);
    expect((notFound as DlogosError).retryable).toBe(false);
    expect(((await answer(503).catch((e) => e)) as DlogosError).retryable).toBe(true);
    expect(((await answer(429).catch((e) => e)) as DlogosError).retryable).toBe(true);
  });
});

describe('dlogosToTranscript', () => {
  it('keeps segments, chapters and takeaways in order, with the reported duration', () => {
    const data = { ...fixture.ready, transcript: { segments: [...(fixture.ready.transcript as { segments: unknown[] }).segments, ...(fixture.page2.transcript as { segments: unknown[] }).segments] } };
    const t = dlogosToTranscript(data as never);
    expect(t.content.segments).toHaveLength(12);
    expect(t.content.segments[0]).toEqual({ startMs: 500, endMs: 55_000, speaker: 'Host A', text: expect.stringContaining('Welcome back') });
    expect(t.content.chapters.map((c) => c.title)).toEqual(['Introduction', 'Foot traffic first', 'Who loses']);
    expect(t.content.takeaways[0]).toMatchObject({ startMs: 220_500, tags: ['Urban Planning', 'Economics'] });
    expect(t).toMatchObject({ externalId: '11111111-2222-4333-8444-555555555555', reportedDurationSec: 600, audioUrl: 'https://cdn.example.com/main-street.mp3' });
  });
});
