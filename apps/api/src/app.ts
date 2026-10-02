import cors from '@fastify/cors';
import { FeedParseError } from '@podcast/feed-parser';
import { ResolveFeedRequest } from '@podcast/shared';
import Fastify from 'fastify';
import { z } from 'zod';

import { Catalog } from './catalog';
import { fetchFeed as defaultFetchFeed, FeedFetchError, type FetchFeed } from './fetch-feed';
import { DirectoryUnavailableError, type PodcastDirectory } from './podcast-index';
import { InMemoryCatalogStore, type CatalogStore } from './store';

export type AppDeps = {
  store?: CatalogStore;
  fetchFeed?: FetchFeed;
  /** Search and charts. Without one, those endpoints answer 503. */
  directory?: PodcastDirectory;
  corsOrigins?: string[];
  logger?: boolean;
};

const EpisodeListQuery = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

const DiscoverQuery = z.object({
  // `top`, or `category:<id>` with an id from /v1/discover/categories.
  section: z
    .string()
    .regex(/^(top|category:\d+)$/)
    .default('top'),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  lang: z
    .string()
    .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i)
    .optional(),
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
    if (err instanceof DirectoryUnavailableError) {
      if (!deps.directory) {
        return reply
          .status(503)
          .send({ error: 'directory_not_configured', message: 'Search and charts are not set up on this server.' });
      }
      req.log.warn(err.message);
      return reply
        .status(503)
        .send({ error: 'directory_unavailable', message: 'Search and charts are unavailable right now. Try again soon.' });
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

  const directory = (): PodcastDirectory => {
    if (!deps.directory) throw new DirectoryUnavailableError('No podcast directory is configured');
    return deps.directory;
  };

  app.get('/v1/search', async (req) => {
    const { q, limit } = SearchQuery.parse(req.query);
    return { results: await directory().search(q, limit) };
  });

  app.get('/v1/discover', async (req) => {
    const { section, limit, lang } = DiscoverQuery.parse(req.query);
    const categoryId = section.startsWith('category:') ? Number(section.slice('category:'.length)) : undefined;
    return { section, results: await directory().trending({ limit, categoryId, language: lang }) };
  });

  app.get('/v1/discover/categories', async () => ({ categories: await directory().categories() }));

  return app;
}
