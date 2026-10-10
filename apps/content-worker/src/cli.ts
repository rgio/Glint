import { existsSync } from 'node:fs';

import { migrate, normalizeFeedUrl, podcastIdFor } from '@podcast/catalog';
import { holdoutEval } from '@podcast/content';
import { pino } from 'pino';
import postgres from 'postgres';

import { loadConfig } from './config';
import { buildDeps } from './deps';

// Operator commands for the content layer:
//   pnpm --filter @podcast/content-worker cli map-dlogos <podcast id or feed URL> <dLogos slug>
//   pnpm --filter @podcast/content-worker cli request <episode id>
//   pnpm --filter @podcast/content-worker cli eval [k]

if (existsSync('.env')) process.loadEnvFile('.env');

const usage = `Usage:
  cli map-dlogos <podcast id | feed URL> <dLogos slug>   Map a show to dLogos (e.g. the-daily-a12f141d)
  cli request <episode id>                               Ask for an episode's transcript now
  cli eval [k]                                           Offline hold-out evaluation of discovery (default k=20)`;

const loaded = loadConfig();
if ('errors' in loaded) {
  console.error(loaded.errors.join('\n'));
  process.exit(1);
}
const [command, ...args] = process.argv.slice(2);
const sql = postgres(loaded.config.databaseUrl, { onnotice: () => {} });
const deps = buildDeps(sql, loaded.config, pino({ name: 'content-cli', level: 'warn' }));

try {
  await migrate(sql);
  switch (command) {
    case 'map-dlogos': {
      const [show, slug] = args;
      if (!show || !slug) throw new Error(usage);
      const podcastId = show.startsWith('pod_') ? show : podcastIdFor(normalizeFeedUrl(show));
      const [podcast] = await sql<{ title: string }[]>`select title from podcasts where id = ${podcastId}`;
      if (!podcast) throw new Error(`No show ${podcastId} in the catalog; add it in the app first`);
      await deps.transcripts.setDlogosSlug(podcastId, slug, 'manual');
      // Wake transcript requests that were waiting for a mapping.
      const waiting = await sql<{ key: string }[]>`
        select j.key from jobs j join episodes e on e.id = j.key
        where j.kind = 'transcript.request' and j.done_at is null and e.podcast_id = ${podcastId}`;
      for (const { key } of waiting) await deps.jobs.runNow('transcript.request', key);
      console.log(`Mapped ${podcast.title} (${podcastId}) to dLogos slug ${slug}; woke ${waiting.length} waiting request(s).`);
      break;
    }
    case 'request': {
      const [episodeId] = args;
      if (!episodeId) throw new Error(usage);
      await deps.jobs.runNow('transcript.request', episodeId, { payload: { purpose: 'transcript_view' } });
      console.log(`Queued a transcript request for ${episodeId}. The worker picks it up within seconds.`);
      break;
    }
    case 'eval': {
      if (!deps.embedder) throw new Error('Set EMBEDDINGS_PROVIDER to evaluate discovery');
      const k = Number(args[0] ?? 20);
      const result = await holdoutEval(
        { index: deps.index, catalog: deps.catalog, userData: deps.userData, model: deps.embedder.model },
        { now: Date.now(), k },
      );
      console.log(JSON.stringify({ model: deps.embedder.model, k, ...result }, null, 2));
      break;
    }
    default:
      console.log(usage);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
