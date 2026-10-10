import { readdir, readFile } from 'node:fs/promises';

import type { Sql } from 'postgres';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
// Any constant works; it just has to be the same for every server process.
const MIGRATION_LOCK_ID = 7_294_401;

/**
 * Applies `migrations/NNN_name.sql` files that haven't run yet, in order, in one transaction:
 * either all pending migrations apply or none do. An advisory lock keeps two servers starting
 * at once from racing.
 */
export async function migrate(sql: Sql): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;
    await tx`create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set((await tx<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version));
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      try {
        await tx.unsafe(await readFile(new URL(file, MIGRATIONS_DIR), 'utf8'));
      } catch (err) {
        if (/extension "vector" is not available|could not open extension control file.*vector/i.test(String((err as Error).message))) {
          throw new Error(
            `Migration ${file} needs the pgvector extension, which this PostgreSQL server doesn't have. ` +
              'Install pgvector 0.7 or newer for this server version (docs/deploy.md has the steps).',
            { cause: err },
          );
        }
        throw err;
      }
      await tx`insert into schema_migrations (version) values (${file})`;
      applied.push(file);
    }
    return applied;
  });
}
