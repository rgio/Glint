import { describe, expect, it } from 'vitest';

import { EmailDeliveryError } from '../src/accounts/email';
import { buildApp } from '../src/app';

const silentEmail = { async sendSignIn() {} };

describe('production hardening', () => {
  it('sets security headers, and HSTS only over https from a trusted proxy', async () => {
    const app = buildApp({ trustProxy: true, email: silentEmail });
    const plain = await app.inject({ url: '/health' });
    expect(plain.headers['x-content-type-options']).toBe('nosniff');
    expect(plain.headers['x-frame-options']).toBe('DENY');
    expect(plain.headers['strict-transport-security']).toBeUndefined();

    const viaProxy = await app.inject({ url: '/health', headers: { 'x-forwarded-proto': 'https' } });
    expect(viaProxy.headers['strict-transport-security']).toContain('max-age=');
  });

  it('allows the web app and any extra origins to call with credentials, and no one else', async () => {
    const app = buildApp({ webUrl: 'https://listen.example.com', corsOrigins: ['https://beta.example.com'], email: silentEmail });
    const allowed = async (origin: string) =>
      (await app.inject({ url: '/health', headers: { origin } })).headers['access-control-allow-origin'];
    expect(await allowed('https://listen.example.com')).toBe('https://listen.example.com');
    expect(await allowed('https://beta.example.com')).toBe('https://beta.example.com');
    expect(await allowed('https://evil.example.com')).toBeUndefined();
  });

  it('limits sign-in emails per client address, across email addresses', async () => {
    const app = buildApp({ trustProxy: true, email: silentEmail });
    const start = (ip: string, n: number) =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/email/start',
        headers: { 'x-forwarded-for': ip },
        payload: { email: `person${n}@example.com` },
      });
    for (let n = 0; n < 20; n++) expect((await start('203.0.113.7', n)).statusCode).toBe(204);
    const limited = await start('203.0.113.7', 20);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'too_many_requests' });
    // Another address is unaffected.
    expect((await start('198.51.100.1', 21)).statusCode).toBe(204);
  });

  it('limits all requests per client address per minute', async () => {
    const app = buildApp({ rateLimit: { perMinute: 3 }, email: silentEmail });
    const responses = [];
    for (let n = 0; n < 4; n++) responses.push(await app.inject({ url: '/v1/podcasts/nope' }));
    expect(responses.map((r) => r.statusCode)).toEqual([404, 404, 404, 429]);
    expect(responses[3]!.json()).toMatchObject({ error: 'too_many_requests', message: expect.stringContaining('Try again in') });
    // Health checks are never limited.
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
  });

  it('answers 503 when the email provider fails', async () => {
    const app = buildApp({
      email: {
        async sendSignIn() {
          throw new EmailDeliveryError('Email provider answered 500');
        },
      },
    });
    const res = await app.inject({ method: 'POST', url: '/v1/auth/email/start', payload: { email: 'me@example.com' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'email_unavailable' });
  });

  it('is ready only when its dependencies are', async () => {
    let up = true;
    const app = buildApp({
      email: silentEmail,
      ready: async () => {
        if (!up) throw new Error('database unreachable');
      },
    });
    expect((await app.inject({ url: '/ready' })).statusCode).toBe(200);
    up = false;
    expect((await app.inject({ url: '/ready' })).statusCode).toBe(503);
  });
});
