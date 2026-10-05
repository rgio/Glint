import { InMemoryCatalogStore } from '@podcast/catalog';
import type { Episode, Podcast, SyncChange } from '@podcast/shared';
import { describe, expect, it } from 'vitest';

import type { EmailSender } from '../src/accounts/email';
import { buildApp } from '../src/app';

const MINUTE = 60_000;

const podcast: Podcast = {
  id: 'pod_1',
  feedUrl: 'https://example.com/feed.xml',
  title: 'Show',
  author: null,
  description: null,
  artworkUrl: null,
  language: null,
  categories: [],
  explicit: false,
  lastPublishedAt: null,
};
const episode: Episode = {
  id: 'ep_1',
  podcastId: 'pod_1',
  guid: 'g1',
  title: 'Episode 1',
  publishedAt: null,
  durationSec: 600,
  enclosureUrl: 'https://cdn.example.com/1.mp3',
  enclosureType: null,
  enclosureBytes: null,
  showNotesHtml: null,
  artworkUrl: null,
  season: null,
  episodeNumber: null,
};

async function setup() {
  let now = Date.UTC(2026, 9, 5, 12);
  const sent: { to: string; link: string; code: string }[] = [];
  const email: EmailSender = {
    async sendSignIn(to, { link, code }) {
      sent.push({ to, link, code });
    },
  };
  const store = new InMemoryCatalogStore();
  await store.upsertPodcast(podcast, { etag: null, lastModified: null, fetchedAt: null });
  await store.upsertEpisodes([episode]);
  const app = buildApp({ store, email, authSecret: 'test-secret', webUrl: 'https://listen.example.com', now: () => now });

  const start = (address: string) => app.inject({ method: 'POST', url: '/v1/auth/email/start', payload: { email: address } });
  const verify = (payload: object) => app.inject({ method: 'POST', url: '/v1/auth/email/verify', payload });
  /** Signs in on a phone with the emailed code; returns the session. */
  const signIn = async (address: string) => {
    await start(address);
    const res = await verify({ email: address, code: sent.at(-1)!.code, client: 'native' });
    expect(res.statusCode).toBe(200);
    return res.json() as { user: { id: string; email: string }; accessToken: string; refreshToken: string };
  };
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  return { app, sent, start, verify, signIn, auth, advance: (ms: number) => (now += ms) };
}

describe('email sign-in', () => {
  it('signs in on a phone with the emailed code', async () => {
    const { start, verify, sent, app, auth } = await setup();
    expect((await start(' Ann@Example.com ')).statusCode).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('ann@example.com');
    expect(sent[0]!.code).toMatch(/^\d{6}$/);
    expect(sent[0]!.link).toMatch(/^https:\/\/listen\.example\.com\/sign-in\?token=/);

    const res = await verify({ email: 'ann@example.com', code: sent[0]!.code, client: 'native' });
    expect(res.statusCode).toBe(200);
    const session = res.json();
    expect(session.user.email).toBe('ann@example.com');
    expect(session.refreshToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeUndefined();

    const me = await app.inject({ url: '/v1/me', headers: auth(session.accessToken) });
    expect(me.json().user).toEqual(session.user);
  });

  it('signs in on the web with the link, keeping the refresh token in an HttpOnly cookie', async () => {
    const { start, verify, sent } = await setup();
    await start('ann@example.com');
    const token = new URL(sent[0]!.link).searchParams.get('token');
    const res = await verify({ token, client: 'web' });
    expect(res.statusCode).toBe(200);
    expect(res.json().refreshToken).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^refresh_token=[^;]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/v1/auth');
  });

  it('returns the same account for the same email', async () => {
    const { signIn } = await setup();
    const a = await signIn('ann@example.com');
    const b = await signIn('ANN@example.com');
    expect(b.user.id).toBe(a.user.id);
  });

  it('accepts a link or code once, and not after 15 minutes', async () => {
    const { start, verify, sent, advance } = await setup();
    await start('ann@example.com');
    const token = new URL(sent[0]!.link).searchParams.get('token');
    expect((await verify({ token, client: 'web' })).statusCode).toBe(200);
    expect((await verify({ token, client: 'web' })).json().error).toBe('invalid_sign_in');

    await start('bo@example.com');
    advance(15 * MINUTE);
    expect((await verify({ email: 'bo@example.com', code: sent[1]!.code, client: 'native' })).json().error).toBe(
      'invalid_sign_in',
    );
  });

  it('locks a code after 5 wrong tries', async () => {
    const { start, verify, sent } = await setup();
    await start('ann@example.com');
    const right = sent[0]!.code;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await verify({ email: 'ann@example.com', code: wrong, client: 'native' })).json().error).toBe('invalid_sign_in');
    }
    expect((await verify({ email: 'ann@example.com', code: right, client: 'native' })).json().error).toBe('too_many_attempts');
  });

  it('limits sign-in emails to 5 per address per 15 minutes', async () => {
    const { start, advance } = await setup();
    for (let i = 0; i < 5; i++) expect((await start('ann@example.com')).statusCode).toBe(204);
    const sixth = await start('ann@example.com');
    expect(sixth.statusCode).toBe(429);
    expect((await start('other@example.com')).statusCode).toBe(204);
    advance(15 * MINUTE);
    expect((await start('ann@example.com')).statusCode).toBe(204);
  });

  it('rejects malformed requests', async () => {
    const { start, verify } = await setup();
    expect((await start('not an email')).statusCode).toBe(400);
    expect((await verify({ email: 'ann@example.com', code: '12ab56', client: 'native' })).statusCode).toBe(400);
  });
});

describe('request errors', () => {
  it('reports an empty JSON body as a bad request, not a server error', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'DELETE', url: '/v1/me', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });
});

describe('CORS', () => {
  it("lets the web app call every account endpoint with credentials, and nobody else", async () => {
    const { app } = await setup();
    const preflight = (origin: string, method: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/v1/me',
        headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'authorization' },
      });
    const ok = await preflight('https://listen.example.com', 'DELETE');
    expect(ok.headers['access-control-allow-origin']).toBe('https://listen.example.com');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(String(ok.headers['access-control-allow-methods'])).toContain('DELETE');
    expect((await preflight('https://evil.example.com', 'DELETE')).headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('sessions', () => {
  it('rotates the refresh token on every use; an old one stops working', async () => {
    const { app, signIn, auth } = await setup();
    const first = await signIn('ann@example.com');
    const refresh = (refreshToken: string) =>
      app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { client: 'native', refreshToken } });

    const second = await refresh(first.refreshToken);
    expect(second.statusCode).toBe(200);
    expect(second.json().refreshToken).not.toBe(first.refreshToken);
    expect((await app.inject({ url: '/v1/me', headers: auth(second.json().accessToken) })).statusCode).toBe(200);

    expect((await refresh(first.refreshToken)).statusCode).toBe(401);
    expect((await refresh(second.json().refreshToken)).statusCode).toBe(200);
  });

  it('refreshes a web session from its cookie', async () => {
    const { app, start, verify, sent } = await setup();
    await start('ann@example.com');
    const res = await verify({ token: new URL(sent[0]!.link).searchParams.get('token'), client: 'web' });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;

    const refreshed = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { client: 'web' }, headers: { cookie } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toEqual(expect.any(String));
    expect(String(refreshed.headers['set-cookie'])).not.toContain(cookie);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { client: 'web' } })).statusCode).toBe(401);
  });

  it('expires access tokens after 15 minutes and rejects tampered ones', async () => {
    const { app, signIn, auth, advance } = await setup();
    const { accessToken } = await signIn('ann@example.com');
    const [v, payload, sig] = accessToken.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'someone-else', sid: 'x', exp: Date.UTC(2030, 0) })).toString('base64url');
    expect((await app.inject({ url: '/v1/me', headers: auth(`${v}.${forged}.${sig}`) })).statusCode).toBe(401);
    expect((await app.inject({ url: '/v1/me', headers: auth(`${v}.${payload}.${sig}x`) })).statusCode).toBe(401);
    expect((await app.inject({ url: '/v1/me' })).statusCode).toBe(401);

    advance(15 * MINUTE);
    expect((await app.inject({ url: '/v1/me', headers: auth(accessToken) })).statusCode).toBe(401);
  });

  it('signs out by revoking the session', async () => {
    const { app, signIn, auth } = await setup();
    const s = await signIn('ann@example.com');
    // As the app sends it: no body, no content type.
    expect((await app.inject({ method: 'POST', url: '/v1/auth/sign-out', headers: auth(s.accessToken) })).statusCode).toBe(204);
    const refresh = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { client: 'native', refreshToken: s.refreshToken } });
    expect(refresh.statusCode).toBe(401);
  });

  it('deletes the account and its data', async () => {
    const { app, signIn, auth } = await setup();
    const s = await signIn('ann@example.com');
    await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: auth(s.accessToken),
      payload: { changes: [{ kind: 'subscription', value: { podcastId: 'pod_1', subscribedAt: 1, autoDownload: false, updatedAt: 1 } }] },
    });
    expect((await app.inject({ method: 'DELETE', url: '/v1/me', headers: auth(s.accessToken) })).statusCode).toBe(204);
    expect((await app.inject({ url: '/v1/me', headers: auth(s.accessToken) })).statusCode).toBe(401);

    const again = await signIn('ann@example.com');
    expect(again.user.id).not.toBe(s.user.id);
    expect((await app.inject({ url: '/v1/sync', headers: auth(again.accessToken) })).json().changes).toEqual([]);
  });
});

describe('sync', () => {
  const changes: SyncChange[] = [
    { kind: 'subscription', value: { podcastId: 'pod_1', subscribedAt: 1, autoDownload: false, updatedAt: 1, deleted: false } },
    { kind: 'episodeState', value: { episodeId: 'ep_1', positionSec: 120, played: false, updatedAt: 1 } },
    { kind: 'queueItem', value: { episodeId: 'ep_1', sortKey: 'm', updatedAt: 1, deleted: false } },
    {
      kind: 'settings',
      value: { skipBackSec: 15, skipForwardSec: 30, playbackRate: 1.5, wifiOnlyDownloads: true, autoDeletePlayed: true, updatedAt: 1 },
    },
  ];

  it('pushes changes and pulls them back with the shows and episodes they mention', async () => {
    const { app, signIn, auth } = await setup();
    const { accessToken } = await signIn('ann@example.com');
    const push = await app.inject({ method: 'POST', url: '/v1/sync', headers: auth(accessToken), payload: { changes } });
    expect(push.json()).toEqual({ applied: 4 });

    const pull = (await app.inject({ url: '/v1/sync?since=0', headers: auth(accessToken) })).json();
    expect(pull.changes).toEqual(changes);
    expect(pull.hasMore).toBe(false);
    expect(pull.podcasts).toEqual([podcast]);
    expect(pull.episodes).toEqual([episode]);

    const nothingNew = (await app.inject({ url: `/v1/sync?since=${pull.cursor}`, headers: auth(accessToken) })).json();
    expect(nothingNew).toMatchObject({ changes: [], cursor: pull.cursor, hasMore: false });
  });

  it('keeps the newer write and never moves a position back from a stale device', async () => {
    const { app, signIn, auth } = await setup();
    const { accessToken } = await signIn('ann@example.com');
    const send = (c: SyncChange[]) => app.inject({ method: 'POST', url: '/v1/sync', headers: auth(accessToken), payload: { changes: c } });
    await send([{ kind: 'episodeState', value: { episodeId: 'ep_1', positionSec: 300, played: false, updatedAt: 10_000 } }]);
    expect((await send([{ kind: 'episodeState', value: { episodeId: 'ep_1', positionSec: 5, played: false, updatedAt: 1_000 } }])).json().applied).toBe(0);
    const pulled = (await app.inject({ url: '/v1/sync', headers: auth(accessToken) })).json().changes;
    expect(pulled[0].value.positionSec).toBe(300);
  });

  it('pages through changes', async () => {
    const { app, signIn, auth } = await setup();
    const { accessToken } = await signIn('ann@example.com');
    await app.inject({ method: 'POST', url: '/v1/sync', headers: auth(accessToken), payload: { changes } });
    const page1 = (await app.inject({ url: '/v1/sync?limit=3', headers: auth(accessToken) })).json();
    expect(page1.changes).toHaveLength(3);
    expect(page1.hasMore).toBe(true);
    const page2 = (await app.inject({ url: `/v1/sync?since=${page1.cursor}&limit=3`, headers: auth(accessToken) })).json();
    expect(page2.changes).toEqual([changes[3]]);
    expect(page2.hasMore).toBe(false);
  });

  it("keeps each account's data to itself and requires sign-in", async () => {
    const { app, signIn, auth } = await setup();
    const ann = await signIn('ann@example.com');
    const bo = await signIn('bo@example.com');
    await app.inject({ method: 'POST', url: '/v1/sync', headers: auth(ann.accessToken), payload: { changes } });
    expect((await app.inject({ url: '/v1/sync', headers: auth(bo.accessToken) })).json().changes).toEqual([]);
    expect((await app.inject({ url: '/v1/sync' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/sync', payload: { changes } })).statusCode).toBe(401);
  });

  it('rejects invalid changes and oversized batches', async () => {
    const { app, signIn, auth } = await setup();
    const { accessToken } = await signIn('ann@example.com');
    const send = (payload: object) => app.inject({ method: 'POST', url: '/v1/sync', headers: auth(accessToken), payload });
    expect((await send({ changes: [{ kind: 'episodeState', value: { episodeId: 'ep_1', positionSec: -1, played: false, updatedAt: 1 } }] })).statusCode).toBe(400);
    expect((await send({ changes: [{ kind: 'nope', value: {} }] })).statusCode).toBe(400);
    expect((await send({ changes: Array.from({ length: 201 }, () => changes[0]) })).statusCode).toBe(400);
    expect((await app.inject({ url: '/v1/sync?since=abc', headers: auth(accessToken) })).statusCode).toBe(400);
  });
});
