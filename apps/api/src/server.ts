import { existsSync } from 'node:fs';

import { migrate, PostgresCatalogStore } from '@podcast/catalog';
import postgres from 'postgres';

import { buildApp } from './app';
import { PodcastIndexDirectory } from './podcast-index';

// Local secrets (see .env.example). Real deployments set the environment directly.
if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT ?? 4000);
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim());

const { PODCAST_INDEX_KEY, PODCAST_INDEX_SECRET, DATABASE_URL } = process.env;
const directory =
  PODCAST_INDEX_KEY && PODCAST_INDEX_SECRET
    ? new PodcastIndexDirectory({ apiKey: PODCAST_INDEX_KEY, apiSecret: PODCAST_INDEX_SECRET })
    : undefined;

const sql = DATABASE_URL ? postgres(DATABASE_URL, { onnotice: () => {} }) : undefined;
const store = sql ? new PostgresCatalogStore(sql) : undefined;

const app = buildApp({ logger: true, corsOrigins, directory, store });
if (!directory) app.log.warn('PODCAST_INDEX_KEY / PODCAST_INDEX_SECRET not set: search and charts are disabled');
if (sql) {
  app.addHook('onClose', () => sql.end({ timeout: 5 }));
} else {
  app.log.warn('DATABASE_URL not set: the catalog is in memory and is lost on restart');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}

try {
  if (sql) {
    const applied = await migrate(sql);
    if (applied.length) app.log.info({ applied }, 'applied database migrations');
  }
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  await sql?.end({ timeout: 5 });
  process.exit(1);
}
