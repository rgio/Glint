import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

const production = {
  NODE_ENV: 'production',
  AUTH_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'postgres://db/podcast',
  WEB_URL: 'https://listen.example.com',
  EMAIL_PROVIDER: 'resend',
  EMAIL_API_KEY: 're_123',
  EMAIL_FROM: 'Podcasts <sign-in@example.com>',
};

const errorsOf = (env: NodeJS.ProcessEnv) => {
  const result = loadConfig(env);
  return 'errors' in result ? result.errors : [];
};

describe('loadConfig', () => {
  it('runs in development with nothing set', () => {
    const result = loadConfig({});
    expect('config' in result && result.config).toMatchObject({
      production: false,
      port: 4000,
      migrateOnStart: true,
      trustProxy: false,
      email: { provider: 'log' },
    });
  });

  it('accepts a complete production setup', () => {
    const result = loadConfig({ ...production, TRUST_PROXY: '1', CORS_ORIGINS: 'https://a.example, https://b.example' });
    expect('config' in result && result.config).toMatchObject({
      production: true,
      trustProxy: 1,
      corsOrigins: ['https://a.example', 'https://b.example'],
      email: { provider: 'resend', apiKey: 're_123', from: 'Podcasts <sign-in@example.com>' },
    });
  });

  it('lists every production problem at once', () => {
    const errors = errorsOf({ NODE_ENV: 'production', WEB_URL: 'http://listen.example.com', AUTH_SECRET: 'short' });
    expect(errors).toEqual([
      expect.stringContaining('AUTH_SECRET'),
      expect.stringContaining('DATABASE_URL'),
      expect.stringContaining('WEB_URL must be https'),
      expect.stringContaining('EMAIL_PROVIDER must be resend or postmark'),
    ]);
  });

  it('needs a key and sender for a real email provider, and both Podcast Index values', () => {
    expect(errorsOf({ EMAIL_PROVIDER: 'postmark', PODCAST_INDEX_KEY: 'k' })).toEqual([
      expect.stringContaining('EMAIL_API_KEY'),
      expect.stringContaining('EMAIL_FROM'),
      expect.stringContaining('PODCAST_INDEX_SECRET'),
    ]);
  });

  it('rejects malformed values', () => {
    expect(errorsOf({ PORT: 'eighty' })).toEqual([expect.stringContaining('PORT')]);
    expect(errorsOf({ EMAIL_PROVIDER: 'carrier-pigeon' })).toEqual([expect.stringContaining('EMAIL_PROVIDER')]);
  });

  it('reads trust-proxy forms', () => {
    const trust = (TRUST_PROXY: string) => {
      const result = loadConfig({ TRUST_PROXY });
      return 'config' in result ? result.config.trustProxy : null;
    };
    expect(trust('true')).toBe(true);
    expect(trust('false')).toBe(false);
    expect(trust('2')).toBe(2);
    expect(trust('10.0.0.0/8, 127.0.0.1')).toEqual(['10.0.0.0/8', '127.0.0.1']);
  });
});
