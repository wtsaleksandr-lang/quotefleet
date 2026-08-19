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

/**
 * Raw, journal-INDEPENDENT ensure step for at-risk `brand_configs` columns.
 *
 * WHY THIS EXISTS (separate from runMigrations above): Replit's publish
 * "database migration" tool repeatedly proposes to DROP these 7 columns from
 * prod — added by `drizzle/0038_header_layout.sql` (header_logo_size,
 * header_layout, header_show_name, header_align) and
 * `drizzle/0039_lead_routing_validity.sql` (quote_validity_days, lead_email_to,
 * lead_email_cc). The problem is that runMigrations() uses Drizzle's migrator,
 * which is JOURNAL-BASED: once 0038/0039 are recorded in `__drizzle_migrations`
 * it SKIPS them forever. So if Replit externally drops the columns, Drizzle will
 * NOT re-add them and every brand_configs query 500s.
 *
 * This function bypasses the journal entirely: it runs plain
 * `ADD COLUMN IF NOT EXISTS` statements on EVERY boot, independent of what the
 * migration journal records. `IF NOT EXISTS` makes each a no-op when the column
 * is present, so on a healthy DB this costs one round-trip and changes nothing;
 * on a DB that Replit just phantom-dropped a column from, it silently re-adds it
 * before the server accepts traffic. This makes approving Replit's publish DROP
 * safe — the column is restored on the next boot.
 *
 * Types/defaults MUST stay in sync with src/db/schema.ts (and 0038/0039).
 * To protect a future at-risk column, append its `ADD COLUMN IF NOT EXISTS`
 * statement to SELF_HEAL_COLUMN_STATEMENTS below.
 */
export const SELF_HEAL_COLUMN_STATEMENTS: readonly string[] = [
  // 0038_header_layout.sql — header rendering controls (NOT NULL w/ defaults).
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_logo_size" text DEFAULT 'm' NOT NULL`,
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_layout" text DEFAULT 'beside' NOT NULL`,
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_show_name" boolean DEFAULT true NOT NULL`,
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_align" text DEFAULT 'left' NOT NULL`,
  // 0039_lead_routing_validity.sql — lead routing + quote validity (nullable).
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "quote_validity_days" integer`,
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "lead_email_to" text`,
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "lead_email_cc" text`,
  // 0040_header_show_credentials.sql — header credential meta-lines toggle
  // (NOT NULL w/ default true). Same Replit phantom-drop risk as 0038's header
  // columns, so it MUST be self-healed here too.
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_show_credentials" boolean DEFAULT true NOT NULL`,
  // 0045_show_tagline.sql — header tagline on/off toggle (NOT NULL w/ default
  // true). Same brand_configs phantom-drop risk as the header columns above.
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "show_tagline" boolean DEFAULT true NOT NULL`,
];

export async function ensureSelfHealColumns(): Promise<void> {
  const env = loadEnv();
  // Dedicated one-shot connection (same pattern as runMigrations); `max: 1`,
  // closed in `finally` so the app's own pool (src/db/client.ts) is untouched.
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    for (const statement of SELF_HEAL_COLUMN_STATEMENTS) {
      // IF NOT EXISTS ⇒ a no-op when the column already exists; never an error.
      // Any OTHER failure (bad DDL, connection loss) throws and fails boot loud.
      await sql.unsafe(statement);
    }
    console.log('[server] brand_configs self-heal columns ensured');
  } finally {
    await sql.end();
  }
}

/**
 * Raw, journal-INDEPENDENT ensure step for at-risk TABLES.
 *
 * WHY THIS EXISTS (separate from ensureSelfHealColumns above, which only heals
 * COLUMNS on an existing table): the public `carrier_directory` table — created
 * by `drizzle/0041_carrier_directory.sql` and backing the public `/directory`
 * and `/compliance` pages — can be MISSING on prod entirely. Replit's deploy
 * does not run `db:migrate`, and its journal-based migration flow is unreliable,
 * so the CREATE TABLE from 0041 may never have been applied to the prod DB even
 * though runMigrations() thinks the journal is "up to date". A missing table
 * makes every directory query throw → the public pages 500.
 *
 * This bypasses the journal entirely: it runs plain `CREATE TABLE IF NOT EXISTS`
 * + `CREATE INDEX IF NOT EXISTS` on EVERY boot, independent of what the journal
 * records. `IF NOT EXISTS` makes each a no-op when the object already exists, so
 * on a healthy DB this costs a few round-trips and changes nothing; on a DB that
 * never received 0041 (or where the table was dropped) it silently (re)creates
 * an EMPTY table + its indexes before the server accepts traffic. The table is
 * later populated by scripts/ingestFmcsaCarriers.ts; an empty table renders a
 * clean empty state, never a 500.
 *
 * These statements MUST stay byte-for-byte equivalent to
 * drizzle/0041_carrier_directory.sql (and src/db/schema.ts `carrierDirectory`).
 * To protect a future at-risk table, append its `CREATE TABLE IF NOT EXISTS`
 * (+ indexes) here.
 */
export const SELF_HEAL_TABLE_STATEMENTS: readonly string[] = [
  // 0041_carrier_directory.sql — public carrier directory table.
  `CREATE TABLE IF NOT EXISTS "carrier_directory" (
    "id" serial PRIMARY KEY NOT NULL,
    "usdot" text NOT NULL,
    "mc_number" text,
    "legal_name" text NOT NULL,
    "dba_name" text,
    "city" text,
    "state" text,
    "country" text DEFAULT 'US' NOT NULL,
    "zip" text,
    "phone" text,
    "email" text,
    "contact_hidden" boolean DEFAULT false NOT NULL,
    "power_units" integer,
    "drivers" integer,
    "safety_rating" text,
    "authority_type" text,
    "intermodal" boolean DEFAULT false NOT NULL,
    "hazmat" boolean DEFAULT false NOT NULL,
    "nearest_port_code" text,
    "public_slug" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  // 0042_carrier_country.sql — domicile country. Healed HERE (the carrier_directory
  // self-heal step) rather than in SELF_HEAL_COLUMN_STATEMENTS because that step
  // runs BEFORE this one at boot (src/server/index.ts) and the table can be absent
  // there; this ALTER runs immediately after the CREATE TABLE above, so the table
  // is guaranteed to exist and the IF NOT EXISTS no-ops on a healthy DB. Defaults
  // 'US' so every existing row stays US — the live directory is unchanged.
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "country" text NOT NULL DEFAULT 'US'`,
  // 0043_carrier_contact.sql — contact email + carrier opt-out. Healed HERE
  // (same reasoning as country above): the ALTERs run right after the CREATE
  // TABLE so the table is guaranteed to exist and IF NOT EXISTS no-ops on a
  // healthy DB. `contact_hidden` defaults false so healing NEVER clears a
  // carrier's opt-out (the column is only re-ADDed when missing, never reset).
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "email" text`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "contact_hidden" boolean NOT NULL DEFAULT false`,
  // 0044_carrier_hazmat.sql — FMCSA-verified hazmat flag (census hm_ind='Y').
  // Healed HERE (same reasoning as above): runs right after the CREATE TABLE so
  // the table exists and IF NOT EXISTS no-ops on a healthy DB. Defaults false so
  // every existing row is unchanged until the next re-ingest populates it.
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "hazmat" boolean NOT NULL DEFAULT false`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "carrier_directory_usdot_idx" ON "carrier_directory" ("usdot")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "carrier_directory_slug_idx" ON "carrier_directory" ("public_slug")`,
  `CREATE INDEX IF NOT EXISTS "carrier_directory_state_idx" ON "carrier_directory" ("state")`,
  `CREATE INDEX IF NOT EXISTS "carrier_directory_port_idx" ON "carrier_directory" ("nearest_port_code")`,
];

export async function ensureSelfHealTables(): Promise<void> {
  const env = loadEnv();
  // Dedicated one-shot connection (same pattern as runMigrations); `max: 1`,
  // closed in `finally` so the app's own pool (src/db/client.ts) is untouched.
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    for (const statement of SELF_HEAL_TABLE_STATEMENTS) {
      // IF NOT EXISTS ⇒ a no-op when the table/index already exists; never an
      // error. Any OTHER failure (bad DDL, connection loss) throws and fails
      // boot loud — same fail-fast contract as ensureSelfHealColumns.
      await sql.unsafe(statement);
    }
    console.log('[server] carrier_directory self-heal table ensured');
  } finally {
    await sql.end();
  }
}
