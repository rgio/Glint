import type { CatalogStore } from '@podcast/catalog';
import type { TranscriptStore } from '@podcast/content';
import type { TranscriptRangeResponse, TranscriptStatusResponse } from '@podcast/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { RequireUser } from './accounts/routes';

/**
 * Longest stretch of transcript one request returns. dLogos' terms on displaying its transcripts
 * aren't settled, so text is for signed-in listeners and comes in pieces, not whole episodes.
 */
export const TRANSCRIPT_MAX_RANGE_SEC = 15 * 60;

const RangeQuery = z
  .object({
    start: z.coerce.number().nonnegative().default(0),
    end: z.coerce.number().nonnegative().optional(),
  })
  .transform(({ start, end }) => ({ start, end: Math.min(end ?? start + TRANSCRIPT_MAX_RANGE_SEC, start + TRANSCRIPT_MAX_RANGE_SEC) }))
  .refine(({ start, end }) => end > start, { message: 'end must be after start' });

export function registerTranscriptRoutes(
  app: FastifyInstance,
  deps: { catalog: CatalogStore; transcripts: TranscriptStore; requireUser: RequireUser },
) {
  // Whether words are available yet, so the app knows when to refresh excerpts.
  app.get<{ Params: { id: string } }>('/v1/episodes/:id/transcript/status', async (req, reply): Promise<TranscriptStatusResponse> => {
    if (!(await deps.catalog.findEpisodeById(req.params.id))) return reply.status(404).send({ error: 'not_found' });
    return deps.transcripts.status(req.params.id);
  });

  // The words between `start` and `end` (seconds), from the transcript readers use (dLogos first).
  app.get<{ Params: { id: string } }>('/v1/episodes/:id/transcript', async (req, reply): Promise<TranscriptRangeResponse> => {
    await deps.requireUser(req);
    if (!(await deps.catalog.findEpisodeById(req.params.id))) return reply.status(404).send({ error: 'not_found' });
    const { start, end } = RangeQuery.parse(req.query);
    const transcript = await deps.transcripts.current(req.params.id);
    if (!transcript) return { ...(await deps.transcripts.status(req.params.id)), segments: [], chapters: [] };
    const [segments, chapters] = await Promise.all([
      deps.transcripts.segments(transcript.id, { fromMs: start * 1000, toMs: end * 1000 }),
      deps.transcripts.chapters(transcript.id),
    ]);
    return {
      status: 'ready',
      source: transcript.source,
      segments: segments.map(({ startMs, endMs, speaker, text }) => ({ startMs, endMs, speaker, text })),
      chapters,
    };
  });
}
