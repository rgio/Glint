import { existsSync } from 'node:fs';

import { migrate } from '@podcast/catalog';
import { runDueJobs } from '@podcast/content';
import { pino } from 'pino';
import postgres from 'postgres';

import { loadConfig } from './config';
import { buildDeps } from './deps';

// Local settings (see .env.example). Real deployments set the environment directly.
if (existsSync('.env')) process.loadEnvFile('.env');

const loaded = loadConfig();
if ('errors' in loaded) {
  console.error(`The content worker can't start; fix these settings:\n${loaded.errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
const { config } = loaded;
const log = pino({ name: 'content-worker', level: config.logLevel });

/** Jobs claimed per round. A full round means more may be due, so the next starts at once. */
const BATCH = 20;
/** Wait between rounds when the last one wasn't full. */
const IDLE_MS = 5_000;

const sql = postgres(config.databaseUrl, { onnotice: () => {} });
const deps = buildDeps(sql, config, log);

/** Recurring work, enqueued when due. Keys make repeats within a period no-ops. */
const PERIODIC = [
  { every: 5 * 60_000, enqueue: () => deps.jobs.enqueue('embed.sweep', 'sweep') },
  { every: 60 * 60_000, enqueue: () => deps.jobs.enqueue('transcript.seed', `seed:${new Date().toISOString().slice(0, 13)}`) },
  { every: 24 * 60 * 60_000, enqueue: () => deps.jobs.enqueue('vector.recall_check', `recall:${new Date().toISOString().slice(0, 10)}`) },
];
const lastRun = new Map<number, number>();

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
  log.info(
    { dlogos: Boolean(deps.dlogos), embeddings: deps.embedder?.model ?? 'off', seedDailyBudget: config.seedDailyBudget },
    'started',
  );
  if (!deps.dlogos) log.warn('DLOGOS_API_KEY not set: only publisher transcripts will be fetched');
  if (!deps.embedder) log.warn('EMBEDDINGS_PROVIDER is off: no vectors or recommendations');
  while (!stopping) {
    try {
      for (const [i, p] of PERIODIC.entries()) {
        if (Date.now() - (lastRun.get(i) ?? 0) >= p.every) {
          await p.enqueue();
          lastRun.set(i, Date.now());
        }
      }
      const ran = await runDueJobs(deps, { limit: BATCH });
      if (ran < BATCH) await idle(IDLE_MS);
    } catch (err) {
      // The database is unreachable or similar: claimed jobs come back when their lease ends.
      log.error({ err }, 'job round failed');
      await idle(IDLE_MS * 6);
    }
  }
} finally {
  await sql.end({ timeout: 5 });
  log.info('stopped');
}
