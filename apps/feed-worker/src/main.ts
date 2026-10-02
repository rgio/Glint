import { existsSync } from 'node:fs';

import { Catalog, fetchFeed, migrate, pollDueFeeds, PostgresCatalogStore } from '@podcast/catalog';
import { pino } from 'pino';
import postgres from 'postgres';

// Local settings (see .env.example). Real deployments set the environment directly.
if (existsSync('.env')) process.loadEnvFile('.env');

const log = pino({ name: 'feed-worker' });

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  log.fatal('DATABASE_URL is not set');
  process.exit(1);
}

/** Feeds claimed per round. A full round means more may be due, so the next starts at once. */
const BATCH = 25;
/** Wait between rounds when the last one wasn't full. */
const IDLE_MS = 30_000;

const sql = postgres(DATABASE_URL, { onnotice: () => {} });
const store = new PostgresCatalogStore(sql);
const catalog = new Catalog(store, fetchFeed);

// Stop between rounds: finish the feeds in flight, then exit.
let stopping = false;
let wake = () => {};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true;
    wake();
  });
}
const idle = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });

try {
  await migrate(sql);
  log.info('started');
  while (!stopping) {
    try {
      const { polled, failed } = await pollDueFeeds({
        store,
        catalog,
        limit: BATCH,
        onError: (err, feed) =>
          log.warn({ err, feedUrl: feed.feedUrl, failures: feed.pollFailures + 1 }, 'feed poll failed'),
      });
      if (polled) log.info({ polled, failed }, 'polled feeds');
      if (polled < BATCH) await idle(IDLE_MS);
    } catch (err) {
      // The database is unreachable or similar: claimed feeds come back when their lease ends.
      log.error({ err }, 'poll round failed');
      await idle(IDLE_MS);
    }
  }
} finally {
  await sql.end({ timeout: 5 });
  log.info('stopped');
}
