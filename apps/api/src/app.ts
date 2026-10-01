import cors from '@fastify/cors';
import { FeedParseError } from '@podcast/feed-parser';
import { ResolveFeedRequest } from '@podcast/shared';
import Fastify from 'fastify';
import { z } from 'zod';

import { Catalog } from './catalog';
import { fetchFeed as defaultFetchFeed, FeedFetchError, type FetchFeed } from './fetch-feed';
import { InMemoryCatalogStore, type CatalogStore } from './store';

export type AppDeps = {
  store?: CatalogStore;
  fetchFeed?: FetchFeed;
  corsOrigins?: string[];
  logger?: boolean;
};

const EpisodeListQuery = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

export function buildApp(deps: AppDeps = {}) {
  const store = deps.store ?? new InMemoryCatalogStore();
  const catalog = new Catalog(store, deps.fetchFeed ?? defaultFetchFeed);
  const app = Fastify({ logger: deps.logger ?? false });

  app.register(cors, { origin: deps.corsOrigins ?? true });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'invalid_request', issues: err.issues });
    }
    if (err instanceof FeedFetchError) {
      const error = err.status === 400 ? 'invalid_feed_url' : 'feed_unreachable';
      return reply.status(err.status).send({ error, message: err.message });
    }
    if (err instanceof FeedParseError) {
      return reply.status(422).send({ error: 'feed_invalid', message: err.message });
    }
    if (err instanceof TypeError && /Invalid URL/i.test(err.message)) {
      return reply.status(400).send({ error: 'invalid_url' });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal' });
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/v1/podcasts/resolve', async (req) => {
    const { feedUrl } = ResolveFeedRequest.parse(req.body);
    return { podcast: await catalog.resolve(feedUrl) };
  });

  app.get<{ Params: { id: string } }>('/v1/podcasts/:id', async (req, reply) => {
    const podcast = await store.findPodcastById(req.params.id);
    if (!podcast) return reply.status(404).send({ error: 'not_found' });
    return { podcast };
  });

  app.get<{ Params: { id: string } }>('/v1/podcasts/:id/episodes', async (req, reply) => {
    const podcast = await store.findPodcastById(req.params.id);
    if (!podcast) return reply.status(404).send({ error: 'not_found' });
    const { cursor, limit, sort } = EpisodeListQuery.parse(req.query);
    const episodes = await store.listEpisodes(podcast.id, { offset: cursor, limit, sort });
    return {
      episodes,
      nextCursor: episodes.length === limit ? String(cursor + limit) : null,
    };
  });

  return app;
}
