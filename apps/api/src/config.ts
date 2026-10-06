import { z } from 'zod';

const list = z
  .string()
  .transform((s) => s.split(',').map((item) => item.trim()).filter(Boolean))
  .optional();

const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().optional(),
  /** Apply database migrations when the API starts. Turn off to run `pnpm migrate` as a release step. */
  MIGRATE_ON_START: flag(true),
  AUTH_SECRET: z.string().optional(),
  WEB_URL: z.url().optional(),
  CORS_ORIGINS: list,
  /**
   * Behind a load balancer or proxy: `true` trusts X-Forwarded-* from any hop, a number trusts
   * that many hops, otherwise a comma-separated list of proxy addresses or CIDR ranges.
   */
  TRUST_PROXY: z.string().optional(),
  PODCAST_INDEX_KEY: z.string().optional(),
  PODCAST_INDEX_SECRET: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['log', 'resend', 'postmark']).default('log'),
  EMAIL_API_KEY: z.string().optional(),
  /** The sender, e.g. `Podcasts <sign-in@example.com>`, on a domain verified with the provider. */
  EMAIL_FROM: z.string().optional(),
});

export type Config = {
  production: boolean;
  port: number;
  host: string;
  logLevel: z.infer<typeof Env>['LOG_LEVEL'];
  databaseUrl?: string;
  migrateOnStart: boolean;
  authSecret?: string;
  webUrl?: string;
  corsOrigins?: string[];
  trustProxy: boolean | number | string[];
  podcastIndex?: { apiKey: string; apiSecret: string };
  email: { provider: 'log' } | { provider: 'resend' | 'postmark'; apiKey: string; from: string };
};

const parseTrustProxy = (value: string | undefined): Config['trustProxy'] => {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(',').map((s) => s.trim()).filter(Boolean);
};

/**
 * Reads the API's settings from the environment. Returns every problem at once, so a deploy
 * fails with the full list rather than one setting at a time. Production refuses settings that
 * work in development but would lose data or leak sign-in codes.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): { config: Config } | { errors: string[] } {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const errors: string[] = [];

  if (e.EMAIL_PROVIDER !== 'log') {
    if (!e.EMAIL_API_KEY) errors.push(`EMAIL_API_KEY is required with EMAIL_PROVIDER=${e.EMAIL_PROVIDER}`);
    if (!e.EMAIL_FROM) errors.push(`EMAIL_FROM is required with EMAIL_PROVIDER=${e.EMAIL_PROVIDER}`);
  }
  if (Boolean(e.PODCAST_INDEX_KEY) !== Boolean(e.PODCAST_INDEX_SECRET)) {
    errors.push('Set both PODCAST_INDEX_KEY and PODCAST_INDEX_SECRET, or neither');
  }
  if (production) {
    if (!e.AUTH_SECRET || e.AUTH_SECRET.length < 32) {
      errors.push('AUTH_SECRET must be set in production, at least 32 characters (e.g. `openssl rand -base64 32`)');
    }
    if (!e.DATABASE_URL) errors.push('DATABASE_URL must be set in production');
    if (!e.WEB_URL) errors.push('WEB_URL must be set in production');
    else if (!e.WEB_URL.startsWith('https://')) errors.push('WEB_URL must be https in production');
    if (e.EMAIL_PROVIDER === 'log') {
      errors.push('EMAIL_PROVIDER must be resend or postmark in production (log would write sign-in codes to the log)');
    }
  }
  if (errors.length) return { errors };

  return {
    config: {
      production,
      port: e.PORT,
      host: e.HOST,
      logLevel: e.LOG_LEVEL,
      databaseUrl: e.DATABASE_URL,
      migrateOnStart: e.MIGRATE_ON_START,
      authSecret: e.AUTH_SECRET,
      webUrl: e.WEB_URL,
      corsOrigins: e.CORS_ORIGINS,
      trustProxy: parseTrustProxy(e.TRUST_PROXY),
      podcastIndex:
        e.PODCAST_INDEX_KEY && e.PODCAST_INDEX_SECRET
          ? { apiKey: e.PODCAST_INDEX_KEY, apiSecret: e.PODCAST_INDEX_SECRET }
          : undefined,
      email:
        e.EMAIL_PROVIDER === 'log'
          ? { provider: 'log' }
          : { provider: e.EMAIL_PROVIDER, apiKey: e.EMAIL_API_KEY!, from: e.EMAIL_FROM! },
    },
  };
}
