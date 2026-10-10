import { randomUUID } from 'node:crypto';

import type { CatalogStore } from '@podcast/catalog';
import { onHighlightChanged, type JobQueue, type UserDataStore } from '@podcast/content';
import {
  EmailSignInStart,
  EmailSignInVerify,
  RefreshRequest,
  SyncPushRequest,
  type AuthSession,
  type ClientKind,
  type Episode,
  type HighlightSearchResponse,
  type Podcast,
  type Recommendation,
  type RecommendationsResponse,
  type SyncPullResponse,
  type User,
} from '@podcast/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { EmailSender } from './email';
import type { AccountStore } from './store';
import { hashSecret, randomCode, randomToken, sameSecret, signAccessToken, verifyAccessToken } from './tokens';

const MINUTE = 60_000;
const SIGN_IN_TTL_MS = 15 * MINUTE;
/** Sign-in emails per address per window, so nobody can flood an inbox. */
const SIGN_IN_LIMIT = 5;
/** Wrong codes allowed per request before it's locked; 5 in a million guesses. */
const CODE_ATTEMPTS = 5;
const ACCESS_TTL_MS = 15 * MINUTE;
const REFRESH_TTL_MS = 90 * 24 * 60 * MINUTE;
const REFRESH_COOKIE = 'refresh_token';
const PULL_LIMIT = 500;
/**
 * Per client address, on top of the per-email limits: sign-in emails cost money and reputation,
 * and codes are guessable in bulk across many requests. Generous enough for a shared office IP.
 */
const AUTH_RATE_LIMITS = {
  start: { max: 20, timeWindow: '15 minutes' },
  verify: { max: 40, timeWindow: '15 minutes' },
  refresh: { max: 120, timeWindow: '15 minutes' },
};

export type AccountDeps = {
  accounts: AccountStore;
  catalog: CatalogStore;
  email: EmailSender;
  /** Signs access tokens. Must be set (and kept) in production. */
  authSecret: string;
  webUrl: string;
  now?: () => number;
  /** Background work for the content worker (transcripts, excerpts, vectors). Optional in tests. */
  jobs?: JobQueue;
  /** Cached recommendations and their events. */
  userData?: UserDataStore;
};

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const HighlightSearchQuery = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const RecommendationEvent = z.object({
  episodeId: z.string().min(1).max(200),
  event: z.enum(['shown', 'opened', 'played', 'highlighted', 'dismissed']),
});

const PullQuery = z.object({
  since: z
    .string()
    .regex(/^\d{1,19}$/)
    .default('0'),
  limit: z.coerce.number().int().min(1).max(PULL_LIMIT).default(PULL_LIMIT),
});

export type RequireUser = (req: FastifyRequest) => Promise<{ user: User; sessionId: string }>;

/** F-12 accounts and F-13 sync. Returns the sign-in check for other routes to use. */
export function registerAccountRoutes(app: FastifyInstance, deps: AccountDeps): { requireUser: RequireUser } {
  const { accounts, email } = deps;
  const now = deps.now ?? Date.now;

  const issueSession = async (
    reply: FastifyReply,
    req: FastifyRequest,
    user: User,
    sessionId: string,
    refreshToken: string,
    client: ClientKind,
  ): Promise<AuthSession> => {
    const accessExpiresAt = now() + ACCESS_TTL_MS;
    const accessToken = signAccessToken({ userId: user.id, sessionId, expiresAt: accessExpiresAt }, deps.authSecret);
    if (client === 'web') {
      // The web app never sees the refresh token: it rides in an HttpOnly cookie scoped to /v1/auth.
      reply.setCookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.protocol === 'https',
        path: '/v1/auth',
        maxAge: REFRESH_TTL_MS / 1000,
      });
    }
    return {
      user,
      accessToken,
      accessTokenExpiresAt: new Date(accessExpiresAt).toISOString(),
      ...(client === 'native' && { refreshToken }),
    };
  };

  const startSession = async (reply: FastifyReply, req: FastifyRequest, user: User, client: ClientKind) => {
    const refreshToken = randomToken();
    const sessionId = randomUUID();
    await accounts.createSession({
      id: sessionId,
      userId: user.id,
      refreshHash: hashSecret(refreshToken),
      platform: client,
      expiresAt: new Date(now() + REFRESH_TTL_MS),
    });
    return issueSession(reply, req, user, sessionId, refreshToken, client);
  };

  /** The signed-in user, from `Authorization: Bearer <access token>`; 401 otherwise. */
  const requireUser = async (req: FastifyRequest): Promise<{ user: User; sessionId: string }> => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? verifyAccessToken(token, deps.authSecret, now()) : null;
    const user = claims && (await accounts.findUserById(claims.userId));
    if (!claims || !user) throw new AuthError(401, 'unauthorized', 'Sign in again.');
    return { user, sessionId: claims.sessionId };
  };

  // Always 204, whether or not the address has an account, so this can't be used to find accounts.
  app.post('/v1/auth/email/start', { config: { rateLimit: AUTH_RATE_LIMITS.start } }, async (req, reply) => {
    const address = EmailSignInStart.parse(req.body).email;
    const recent = await accounts.countSignInRequestsSince(address, new Date(now() - SIGN_IN_TTL_MS));
    if (recent >= SIGN_IN_LIMIT) {
      throw new AuthError(429, 'too_many_requests', 'Too many sign-in emails. Try again in a few minutes.');
    }
    const token = randomToken();
    const code = randomCode();
    await accounts.createSignInRequest({
      id: randomUUID(),
      email: address,
      tokenHash: hashSecret(token),
      codeHash: hashSecret(code),
      expiresAt: new Date(now() + SIGN_IN_TTL_MS),
      createdAt: new Date(now()),
    });
    const link = `${deps.webUrl}/sign-in?token=${encodeURIComponent(token)}`;
    await email.sendSignIn(address, { link, code, expiresInMinutes: SIGN_IN_TTL_MS / MINUTE });
    return reply.status(204).send();
  });

  app.post('/v1/auth/email/verify', { config: { rateLimit: AUTH_RATE_LIMITS.verify } }, async (req, reply) => {
    const body = EmailSignInVerify.parse(req.body);
    const invalid = () => new AuthError(400, 'invalid_sign_in', 'That link or code is invalid or has expired.');

    let request;
    if ('token' in body) {
      request = await accounts.findSignInRequestByToken(hashSecret(body.token));
      if (!request) throw invalid();
    } else {
      request = await accounts.findLatestSignInRequest(body.email);
      if (!request) throw invalid();
      if (request.attempts >= CODE_ATTEMPTS) {
        throw new AuthError(400, 'too_many_attempts', 'Too many wrong codes. Request a new one.');
      }
      if (!sameSecret(hashSecret(body.code), request.codeHash)) {
        await accounts.recordSignInAttempt(request.id);
        throw invalid();
      }
    }
    if (request.usedAt || request.expiresAt.getTime() <= now()) throw invalid();
    // Atomic, so two concurrent uses of one link can't both succeed.
    if (!(await accounts.markSignInRequestUsed(request.id))) throw invalid();

    const user = await accounts.findOrCreateUser(request.email, randomUUID());
    return startSession(reply, req, user, body.client);
  });

  app.post('/v1/auth/refresh', { config: { rateLimit: AUTH_RATE_LIMITS.refresh } }, async (req, reply) => {
    const { client, refreshToken: fromBody } = RefreshRequest.parse(req.body ?? {});
    const presented = client === 'web' ? req.cookies[REFRESH_COOKIE] : fromBody;
    const unauthorized = () => new AuthError(401, 'unauthorized', 'Sign in again.');
    if (!presented) throw unauthorized();

    const oldHash = hashSecret(presented);
    const session = await accounts.findSessionByRefreshHash(oldHash);
    const user = session && (await accounts.findUserById(session.userId));
    if (!session || !user || session.revokedAt || session.expiresAt.getTime() <= now()) throw unauthorized();

    // Each refresh token works once: rotating it invalidates the one just presented.
    const next = randomToken();
    const rotated = await accounts.rotateSession(session.id, oldHash, hashSecret(next), new Date(now() + REFRESH_TTL_MS));
    if (!rotated) throw unauthorized();
    return issueSession(reply, req, user, session.id, next, client);
  });

  app.post('/v1/auth/sign-out', async (req, reply) => {
    const { sessionId } = await requireUser(req);
    await accounts.revokeSession(sessionId);
    reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    return reply.status(204).send();
  });

  app.get('/v1/me', async (req) => ({ user: (await requireUser(req)).user }));

  // GDPR/CCPA: deleting the account removes it and all its synced data.
  app.delete('/v1/me', async (req, reply) => {
    const { user } = await requireUser(req);
    await accounts.deleteUser(user.id);
    reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    return reply.status(204).send();
  });

  app.post('/v1/sync', async (req) => {
    const { user } = await requireUser(req);
    const { changes } = SyncPushRequest.parse(req.body);
    const applied = await accounts.applyChanges(user.id, changes);
    // Excerpts, transcripts and vectors follow a highlight change. Enqueueing is idempotent, so a
    // change that merged to nothing new costs only a no-op insert.
    if (deps.jobs) {
      for (const c of changes) {
        if (c.kind !== 'highlight') continue;
        try {
          await onHighlightChanged(deps.jobs, user.id, c.value, now());
        } catch (err) {
          req.log.error({ err }, 'could not enqueue highlight jobs');
        }
      }
    }
    return { applied };
  });

  /** The shows and episodes these episode ids belong to, for lists that must render offline. */
  const withCatalog = async (episodeIds: Iterable<string>, extraPodcastIds: Iterable<string> = []) => {
    const episodes = (await Promise.all([...new Set(episodeIds)].map((id) => deps.catalog.findEpisodeById(id)))).filter(
      (e): e is Episode => e !== null,
    );
    const podcastIds = new Set([...extraPodcastIds, ...episodes.map((e) => e.podcastId)]);
    const podcasts = (await Promise.all([...podcastIds].map((id) => deps.catalog.findPodcastById(id)))).filter(
      (p): p is Podcast => p !== null,
    );
    return { episodes, podcasts };
  };

  // Library > Highlights on the web before local data loads, and search across devices.
  app.get('/v1/me/highlights', async (req): Promise<HighlightSearchResponse> => {
    const { user } = await requireUser(req);
    const { q, cursor, limit } = HighlightSearchQuery.parse(req.query);
    const page = await accounts.searchHighlights(user.id, { q: q || null, offset: cursor, limit });
    return {
      highlights: page.highlights,
      nextCursor: page.hasMore ? String(cursor + limit) : null,
      ...(await withCatalog(page.highlights.map((h) => h.episodeId))),
    };
  });

  // Discovery: episodes like the listener's highlights, rebuilt by the content worker.
  app.get('/v1/me/recommendations', async (req): Promise<RecommendationsResponse> => {
    const { user } = await requireUser(req);
    const cached = await deps.userData?.recommendations(user.id);
    if (!cached) return { recommendations: [], generatedAt: null };
    const { episodes, podcasts } = await withCatalog(cached.items.map((r) => r.episodeId));
    const episodeById = new Map(episodes.map((e) => [e.id, e]));
    const podcastById = new Map(podcasts.map((p) => [p.id, p]));
    const recommendations = cached.items.flatMap((r): Recommendation[] => {
      const episode = episodeById.get(r.episodeId);
      const podcast = episode && podcastById.get(episode.podcastId);
      return episode && podcast ? [{ episode, podcast, score: r.score, startSec: r.startSec, because: r.because }] : [];
    });
    return { recommendations, generatedAt: cached.generatedAt.toISOString() };
  });

  // What happened to a recommendation: the measure of whether discovery works.
  app.post('/v1/me/recommendations/events', async (req, reply) => {
    const { user } = await requireUser(req);
    const { episodeId, event } = RecommendationEvent.parse(req.body);
    await deps.userData?.recordRecEvent(user.id, episodeId, event);
    return reply.status(204).send();
  });

  app.get('/v1/sync', async (req): Promise<SyncPullResponse> => {
    const { user } = await requireUser(req);
    const { since, limit } = PullQuery.parse(req.query);
    const found = await accounts.changesSince(user.id, BigInt(since), limit + 1);
    const page = found.slice(0, limit);

    // Include the shows and episodes these changes refer to, so a new device can show them.
    const episodeIds = new Set<string>();
    const podcastIds = new Set<string>();
    for (const c of page) {
      if (c.kind === 'subscription') podcastIds.add(c.value.podcastId);
      if (c.kind === 'episodeState' || c.kind === 'queueItem' || c.kind === 'highlight') episodeIds.add(c.value.episodeId);
    }
    const { episodes, podcasts } = await withCatalog(episodeIds, podcastIds);

    return {
      changes: page.map(({ version: _version, ...change }) => change),
      cursor: (page.at(-1)?.version ?? BigInt(since)).toString(),
      hasMore: found.length > limit,
      podcasts,
      episodes,
    };
  });

  return { requireUser };
}
