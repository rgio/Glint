import { existsSync } from 'node:fs';

import { buildApp } from './app';
import { PodcastIndexDirectory } from './podcast-index';

// Local secrets (see .env.example). Real deployments set the environment directly.
if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT ?? 4000);
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim());

const { PODCAST_INDEX_KEY, PODCAST_INDEX_SECRET } = process.env;
const directory =
  PODCAST_INDEX_KEY && PODCAST_INDEX_SECRET
    ? new PodcastIndexDirectory({ apiKey: PODCAST_INDEX_KEY, apiSecret: PODCAST_INDEX_SECRET })
    : undefined;

const app = buildApp({ logger: true, corsOrigins, directory });
if (!directory) app.log.warn('PODCAST_INDEX_KEY / PODCAST_INDEX_SECRET not set: search and charts are disabled');

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
