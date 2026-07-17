/**
 * Run pending Drizzle migrations at server boot.
 *
 * WHY THIS EXISTS: the Replit deploy (`.replit`) runs only
 * `pnpm install && pnpm build` then `pnpm start` — it does NOT run
 * `db:migrate`. So historically, a republish that shipped code referencing a
 * new column would 500 on every query until someone manually ran the migration
 * (exactly what happened with 0018/0019/0020 → `features_json` / `map_style` /
 * `ingest_email_token`). Running migrations here, before the server accepts
 * traffic, makes every deploy self-healing.
 *
 * Uses a dedicated single (max:1) connection that is closed immediately after —
 * the app's own pool (src/db/client.ts) is untouched. Idempotent: drizzle skips
 * migrations already recorded in its `__drizzle_migrations` table, so this is a
 * no-op cost (one round-trip) on a healthy, up-to-date database.
 *
 * FAIL-FAST: if a migration errors we throw, so boot fails loudly in the deploy
 * logs rather than silently serving a schema-mismatched app that 500s.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadEnv } from '../config.js';

export async function runMigrations(): Promise<void> {
  const env = loadEnv();
  // Dedicated one-shot connection for the migration run; `max: 1` so drizzle's
  // migrator gets a single serial connection, closed in `finally`.
  const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
  try {
    // migrationsFolder is resolved from cwd. The deploy runs
    // `node dist/server/index.js` from the repo root, where `drizzle/` (the .sql
    // files + meta/_journal.json) lives, so this relative path is correct.
    await migrate(drizzle(migrationClient), { migrationsFolder: 'drizzle' });
    console.log('[server] DB migrations up to date');
  } finally {
    await migrationClient.end();
  }
}
