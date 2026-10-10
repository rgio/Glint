import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().optional(),
  DLOGOS_API_KEY: z.string().optional(),
  DLOGOS_BASE_URL: z.url().optional(),
  DLOGOS_SEED_DAILY_BUDGET: z.coerce.number().int().nonnegative().default(0),
  DLOGOS_REQUEST_DAILY_BUDGET: z.coerce.number().int().nonnegative().default(500),
  EMBEDDINGS_PROVIDER: z.enum(['off', 'openai', 'hashing']).default('off'),
  OPENAI_API_KEY: z.string().optional(),
  HNSW_EF_SEARCH: z.coerce.number().int().min(10).max(1000).optional(),
});

export type WorkerConfig = {
  production: boolean;
  logLevel: z.infer<typeof Env>['LOG_LEVEL'];
  databaseUrl: string;
  dlogos?: { apiKey: string; baseUrl?: string };
  seedDailyBudget: number;
  requestDailyBudget: number;
  embeddings: { provider: 'off' } | { provider: 'hashing' } | { provider: 'openai'; apiKey: string };
  efSearch?: number;
};

/** The worker's settings, with every problem listed at once (like the API's). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): { config: WorkerConfig } | { errors: string[] } {
  const parsed = Env.safeParse(env);
  if (!parsed.success) return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const errors: string[] = [];
  if (!e.DATABASE_URL) errors.push('DATABASE_URL must be set: the content worker reads and writes the same database as the API');
  if (e.EMBEDDINGS_PROVIDER === 'openai' && !e.OPENAI_API_KEY) errors.push('OPENAI_API_KEY is required with EMBEDDINGS_PROVIDER=openai');
  if (production && e.EMBEDDINGS_PROVIDER === 'hashing') {
    errors.push('EMBEDDINGS_PROVIDER=hashing is for local testing; use openai or off in production');
  }
  if (e.DLOGOS_SEED_DAILY_BUDGET > 0 && !e.DLOGOS_API_KEY) errors.push('DLOGOS_SEED_DAILY_BUDGET needs DLOGOS_API_KEY');
  if (errors.length) return { errors };

  return {
    config: {
      production,
      logLevel: e.LOG_LEVEL,
      databaseUrl: e.DATABASE_URL!,
      dlogos: e.DLOGOS_API_KEY ? { apiKey: e.DLOGOS_API_KEY, baseUrl: e.DLOGOS_BASE_URL } : undefined,
      seedDailyBudget: e.DLOGOS_SEED_DAILY_BUDGET,
      requestDailyBudget: e.DLOGOS_REQUEST_DAILY_BUDGET,
      embeddings:
        e.EMBEDDINGS_PROVIDER === 'openai'
          ? { provider: 'openai', apiKey: e.OPENAI_API_KEY! }
          : { provider: e.EMBEDDINGS_PROVIDER },
      efSearch: e.HNSW_EF_SEARCH,
    },
  };
}
