/** Applies database migrations and exits: `pnpm --filter @podcast/api migrate`, e.g. as a release step. */
import { existsSync } from 'node:fs';

import { migrate } from '@podcast/catalog';
import postgres from 'postgres';

if (existsSync('.env')) process.loadEnvFile('.env');

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = postgres(DATABASE_URL, { onnotice: () => {} });
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date');
} finally {
  await sql.end({ timeout: 5 });
}
