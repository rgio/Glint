import { randomBytes } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  Catalog,
  fetchFeed as defaultFetchFeed,
  FeedFetchError,
  InMemoryCatalogStore,
  type CatalogStore,
  type FetchFeed,
} from '@podcast/catalog';
import { FeedParseError } from '@podcast/feed-parser';
import { ResolveFeedRequest } from '@podcast/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { z } from 'zod';

import { EmailDeliveryError, LogEmailSender, type EmailSender } from './accounts/email';
import { AuthError, registerAccountRoutes } from './accounts/routes';
import { InMemoryAccountStore, type AccountStore } from './accounts/store';
import { DirectoryUnavailableError, type PodcastDirectory } from './podcast-index';
import { renderShareNotFound, renderSharePage } from './share';

export type AppDeps = {
  store?: CatalogStore;
  fetchFeed?: FetchFeed;
  /** Accounts, sessions and synced state. Defaults to in memory. */
  accounts?: AccountStore;
  /** Sends sign-in emails. Defaults to writing them to the log. */
  email?: EmailSender;
  /** Signs access tokens. Defaults to a random secret, so tokens die with the process. */
  authSecret?: string;
  /** Where the web app is served; share links send people on to its episode pages. */
  webUrl?: string;
  /** Clock for feed freshness checks; tests move it forward. */
  now?: () => number;
  /** Search and charts. Without one, those endpoints answer 503. */
  directory?: PodcastDirectory;
  /** Origins allowed to call the API besides the web app's own (`webUrl`). */
  corsOrigins?: string[];
  logger?: FastifyServerOptions['logger'];
  /** Behind a proxy, which X-Forwarded-* headers to believe (client address, https). */
  trustProxy?: FastifyServerOptions['trustProxy'];
  /**
   * Requests per client address per minute across the API (default 600); auth routes have their
   * own, lower limits. `false` turns all limits off (the end-to-end tests sign in a lot).
   */
  rateLimit?: false | { perMinute: number };
  /** Readiness: throws if a dependency (the database) isn't reachable. */
  ready?: () => Promise<void>;
};

/** Headers for every response: no sniffing, no framing, no referrer beyond the origin. */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
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
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: deps.trustProxy ?? false });
  const webUrl = (deps.webUrl ?? 'http://localhost:8081').replace(/\/$/, '');
  const catalog = new Catalog(store, deps.fetchFeed ?? defaultFetchFeed, deps.now, (err, podcast) =>
    app.log.warn({ err, podcastId: podcast.id }, 'background feed refresh failed'),
  );

  // Credentials (the web app's refresh cookie) are allowed, so only the web app's origin may call.
  // The plugin allows only GET, HEAD and POST unless told otherwise; DELETE /v1/me needs DELETE.
  app.register(cors, { origin: [webUrl, ...(deps.corsOrigins ?? [])], credentials: true, methods: ['GET', 'HEAD', 'POST', 'DELETE'] });
  app.register(cookie);
  // Per client address (behind a proxy, set trustProxy so this is the real one). In memory, so
  // each API instance counts separately; a shared store comes with Redis.
  if (deps.rateLimit !== false) {
    app.register(rateLimit, {
      max: deps.rateLimit?.perMinute ?? 600,
      timeWindow: '1 minute',
      errorResponseBuilder: (_req, context) => ({
        statusCode: 429,
        error: 'too_many_requests',
        message: `Too many requests. Try again in ${context.after}.`,
      }),
    });
  }
  app.addHook('onSend', async (req, reply) => {
    reply.headers(SECURITY_HEADERS);
    if (req.protocol === 'https') reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });

  // Routes go in a plugin so they're added after the plugins above have loaded (rate limiting
  // attaches itself to each route as it's added).
  app.register(async (app) => {
    app.setErrorHandler((err, req, reply) => {
      if (err instanceof AuthError) {
        return reply.status(err.status).send({ error: err.code, message: err.message });
      }
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
      if (err instanceof EmailDeliveryError) {
        req.log.error(err);
        return reply
          .status(503)
          .send({ error: 'email_unavailable', message: "We couldn't send the email just now. Try again in a minute." });
      }
      if (err instanceof TypeError && /Invalid URL/i.test(err.message)) {
        return reply.status(400).send({ error: 'invalid_url' });
      }
      // Fastify's own request errors (bad content type, empty JSON body, too large) and the rate
      // limiter's carry a 4xx.
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 429) {
        return reply.status(429).send({ error: 'too_many_requests', message: (err as Error).message });
      }
      if (status && status >= 400 && status < 500) {
        return reply.status(status).send({ error: 'invalid_request', message: (err as Error).message });
      }
      req.log.error(err);
      return reply.status(500).send({ error: 'internal' });
    });

    // Liveness: the process answers. Readiness: it can also reach the database.
    app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }));
    app.get('/ready', { config: { rateLimit: false } }, async (req, reply) => {
      try {
        await deps.ready?.();
        return { ok: true };
      } catch (err) {
        req.log.warn({ err }, 'not ready');
        return reply.status(503).send({ ok: false });
      }
    });

    app.post('/v1/podcasts/resolve', async (req) => {
      const { feedUrl } = ResolveFeedRequest.parse(req.body);
      return { podcast: await catalog.resolve(feedUrl) };
    });

    app.get<{ Params: { id: string } }>('/v1/podcasts/:id', async (req, reply) => {
      const podcast = await store.findPodcastById(req.params.id);
      if (!podcast) return reply.status(404).send({ error: 'not_found' });
      void catalog.refreshIfStale(podcast);
      return { podcast };
    });

    app.get<{ Params: { id: string } }>('/v1/podcasts/:id/episodes', async (req, reply) => {
      const podcast = await store.findPodcastById(req.params.id);
      if (!podcast) return reply.status(404).send({ error: 'not_found' });
      void catalog.refreshIfStale(podcast);
      const { cursor, limit, sort } = EpisodeListQuery.parse(req.query);
      const episodes = await store.listEpisodes(podcast.id, { offset: cursor, limit, sort });
      return {
        episodes,
        nextCursor: episodes.length === limit ? String(cursor + limit) : null,
      };
    });

    // F-05: one episode with its show, for the episode page.
    app.get<{ Params: { id: string } }>('/v1/episodes/:id', async (req, reply) => {
      const episode = await store.findEpisodeById(req.params.id);
      const podcast = episode && (await store.findPodcastById(episode.podcastId));
      if (!episode || !podcast) return reply.status(404).send({ error: 'not_found' });
      void catalog.refreshIfStale(podcast);
      return { episode, podcast };
    });

    // F-15: shared episode links. Link previews come from this page's Open Graph tags; people
    // are sent on to the episode page in the web app.
    app.get<{ Params: { id: string } }>('/s/e/:id', async (req, reply) => {
      const episode = await store.findEpisodeById(req.params.id);
      const podcast = episode && (await store.findPodcastById(episode.podcastId));
      reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=300');
      if (!episode || !podcast) return reply.status(404).send(renderShareNotFound(webUrl));
      const shareUrl = `${req.protocol}://${req.host}${req.url.split('?')[0]}`;
      const episodeUrl = `${webUrl}/episode/${encodeURIComponent(episode.id)}`;
      return renderSharePage({ episode, podcast, shareUrl, episodeUrl });
    });

    registerAccountRoutes(app, {
      accounts: deps.accounts ?? new InMemoryAccountStore(),
      catalog: store,
      email: deps.email ?? new LogEmailSender((message) => app.log.info(message)),
      authSecret: deps.authSecret ?? randomBytes(32).toString('base64url'),
      webUrl,
      now: deps.now,
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
  });

  return app;
}
