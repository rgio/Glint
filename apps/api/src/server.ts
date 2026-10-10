import { existsSync } from 'node:fs';

import { migrate, PostgresCatalogStore } from '@podcast/catalog';
import { PostgresJobQueue, PostgresTranscriptStore, PostgresUserDataStore } from '@podcast/content';
import postgres from 'postgres';

import { buildApp } from './app';
import { LogEmailSender, PostmarkEmailSender, ResendEmailSender, type EmailSender } from './accounts/email';
import { PostgresAccountStore } from './accounts/postgres';
import { loadConfig } from './config';
import { PodcastIndexDirectory } from './podcast-index';

// Local secrets (see .env.example). Real deployments set the environment directly.
if (existsSync('.env')) process.loadEnvFile('.env');

const loaded = loadConfig();
if ('errors' in loaded) {
  console.error(`The API can't start; fix these settings:\n${loaded.errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
const { config } = loaded;

const hopsWithin = (hops: number) => (_address: string, hop: number) => hop < hops;

const directory = config.podcastIndex && new PodcastIndexDirectory(config.podcastIndex);
const sql = config.databaseUrl ? postgres(config.databaseUrl, { onnotice: () => {} }) : undefined;

let email: EmailSender | undefined;
if (config.email.provider === 'resend') email = new ResendEmailSender(config.email);
if (config.email.provider === 'postmark') email = new PostmarkEmailSender(config.email);

const app = buildApp({
  logger: { level: config.logLevel },
  // A hop count means "trust the nearest N proxies", which Fastify takes as a function.
  trustProxy: typeof config.trustProxy === 'number' ? hopsWithin(config.trustProxy) : config.trustProxy,
  corsOrigins: config.corsOrigins,
  directory,
  store: sql && new PostgresCatalogStore(sql),
  accounts: sql && new PostgresAccountStore(sql),
  email: email ?? new LogEmailSender((message) => app.log.info(message)),
  authSecret: config.authSecret,
  webUrl: config.webUrl,
  ready: sql && (async () => void (await sql`select 1`)),
  content: sql && {
    transcripts: new PostgresTranscriptStore(sql),
    jobs: new PostgresJobQueue(sql),
    userData: new PostgresUserDataStore(sql),
  },
});
if (!config.authSecret) app.log.warn('AUTH_SECRET not set: using a random one, so sign-ins need a refresh after a restart');
if (!directory) app.log.warn('PODCAST_INDEX_KEY / PODCAST_INDEX_SECRET not set: search and charts are disabled');
if (config.email.provider === 'log') app.log.warn('EMAIL_PROVIDER is log: sign-in emails are written to this log, not sent');
if (sql) {
  app.addHook('onClose', () => sql.end({ timeout: 5 }));
} else {
  app.log.warn('DATABASE_URL not set: the catalog and accounts are in memory and are lost on restart');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}

try {
  if (sql && config.migrateOnStart) {
    const applied = await migrate(sql);
    if (applied.length) app.log.info({ applied }, 'applied database migrations');
  }
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  await sql?.end({ timeout: 5 });
  process.exit(1);
}
