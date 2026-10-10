import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

describe('content worker settings', () => {
  it('needs a database, and defaults to no embeddings or seeding', () => {
    expect(loadConfig({})).toEqual({ errors: [expect.stringContaining('DATABASE_URL')] });
    const ok = loadConfig({ DATABASE_URL: 'postgres://localhost/podcast' });
    expect(ok).toMatchObject({ config: { embeddings: { provider: 'off' }, seedDailyBudget: 0, dlogos: undefined } });
  });

  it('lists every problem at once', () => {
    const result = loadConfig({ NODE_ENV: 'production', EMBEDDINGS_PROVIDER: 'hashing', DLOGOS_SEED_DAILY_BUDGET: '50' });
    expect('errors' in result && result.errors).toHaveLength(3);
    expect(loadConfig({ DATABASE_URL: 'x', EMBEDDINGS_PROVIDER: 'openai' })).toEqual({ errors: ['OPENAI_API_KEY is required with EMBEDDINGS_PROVIDER=openai'] });
  });

  it('reads dLogos and OpenAI settings', () => {
    expect(
      loadConfig({ DATABASE_URL: 'x', DLOGOS_API_KEY: 'd', DLOGOS_SEED_DAILY_BUDGET: '25', EMBEDDINGS_PROVIDER: 'openai', OPENAI_API_KEY: 'o', HNSW_EF_SEARCH: '100' }),
    ).toMatchObject({ config: { dlogos: { apiKey: 'd' }, seedDailyBudget: 25, embeddings: { provider: 'openai', apiKey: 'o' }, efSearch: 100 } });
  });
});
