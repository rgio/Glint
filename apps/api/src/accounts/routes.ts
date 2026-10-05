import { randomUUID } from 'node:crypto';

import type { CatalogStore } from '@podcast/catalog';
import {
  EmailSignInStart,
  EmailSignInVerify,
  RefreshRequest,
  SyncPushRequest,
  type AuthSession,
  type ClientKind,
  type Episode,
  type Podcast,
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

export type AccountDeps = {
  accounts: AccountStore;
  catalog: CatalogStore;
  email: EmailSender;
  /** Signs access tokens. Must be set (and kept) in production. */
  authSecret: string;
  webUrl: string;
  now?: () => number;
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

const PullQuery = z.object({
  since: z
    .string()
    .regex(/^\d{1,19}$/)
    .default('0'),
  limit: z.coerce.number().int().min(1).max(PULL_LIMIT).default(PULL_LIMIT),
});

/** F-12 accounts and F-13 sync. */
export function registerAccountRoutes(app: FastifyInstance, deps: AccountDeps) {
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
  app.post('/v1/auth/email/start', async (req, reply) => {
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

  app.post('/v1/auth/email/verify', async (req, reply) => {
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

  app.post('/v1/auth/refresh', async (req, reply) => {
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
    return { applied: await accounts.applyChanges(user.id, changes) };
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
    const episodes = (await Promise.all([...episodeIds].map((id) => deps.catalog.findEpisodeById(id)))).filter(
      (e): e is Episode => e !== null,
    );
    for (const e of episodes) podcastIds.add(e.podcastId);
    const podcasts = (await Promise.all([...podcastIds].map((id) => deps.catalog.findPodcastById(id)))).filter(
      (p): p is Podcast => p !== null,
    );

    return {
      changes: page.map(({ version: _version, ...change }) => change),
      cursor: (page.at(-1)?.version ?? BigInt(since)).toString(),
      hasMore: found.length > limit,
      podcasts,
      episodes,
    };
  });
}
