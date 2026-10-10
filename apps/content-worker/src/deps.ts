import { fetchPublicText } from '@podcast/catalog';
import {
  DlogosClient,
  HashingEmbedder,
  OpenAIEmbedder,
  PgvectorIndex,
  PostgresCatalogQueries,
  PostgresJobQueue,
  PostgresTranscriptStore,
  PostgresUserDataStore,
  type ContentDeps,
  type Embedder,
  type Logger,
} from '@podcast/content';
import type { Sql } from 'postgres';

import type { WorkerConfig } from './config';

/** Searches slower than this are logged as warnings: one of the vector-store switch triggers. */
const SLOW_SEARCH_MS = 100;

export function buildDeps(sql: Sql, config: WorkerConfig, log: Logger): ContentDeps {
  let embedder: Embedder | null = null;
  if (config.embeddings.provider === 'openai') embedder = new OpenAIEmbedder({ apiKey: config.embeddings.apiKey });
  if (config.embeddings.provider === 'hashing') embedder = new HashingEmbedder();

  const index = new PgvectorIndex(sql, {
    efSearch: config.efSearch,
    // Latency and underfill on every search; see "When it's smart to switch" in the plan.
    onSearch: (m) => {
      const underfilled = m.returned < m.k;
      if (m.ms > SLOW_SEARCH_MS || (underfilled && m.filtered)) log.warn({ ...m, underfilled }, 'slow or underfilled vector search');
    },
  });

  return {
    jobs: new PostgresJobQueue(sql),
    transcripts: new PostgresTranscriptStore(sql),
    userData: new PostgresUserDataStore(sql),
    catalog: new PostgresCatalogQueries(sql),
    index,
    dlogos: config.dlogos ? new DlogosClient(config.dlogos) : null,
    embedder,
    fetchText: fetchPublicText,
    now: Date.now,
    seedDailyBudget: config.seedDailyBudget,
    requestDailyBudget: config.requestDailyBudget,
    recallCheck: (model) => index.recallSample(model),
    log,
  };
}
