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
  // 0047_tagline_style.sql — tagline chip size + visual style (NOT NULL w/
  // defaults). Same brand_configs phantom-drop risk as the header columns above.
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "tagline_size" text DEFAULT 'm' NOT NULL`,
  `ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "tagline_style" text DEFAULT 'solid' NOT NULL`,
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
 * FMCSA cargo/equipment BOOLEAN facet columns that get a PARTIAL index
 * (0066_directory_query_indexes.sql). One entry per user-selectable
 * equipment/cargo option in the /directory sidebar.
 *
 * `dry_van` is deliberately EXCLUDED: it is true for 78.6% of the 330k prod rows,
 * so a partial index over it would cover most of the table and the planner would
 * never choose it over a sequential scan — it would be pure write cost on the
 * weekly FMCSA re-ingest. Every other flag is true for ≤ 17.5% of rows (meat is
 * 0.13%), which is exactly the range where a partial index pays for itself.
 */
export const DIRECTORY_FLAG_INDEX_COLUMNS: readonly string[] = [
  'intermodal',
  'hazmat',
  'reefer',
  'tanker',
  'flatbed',
  'dry_bulk',
  'household_goods',
  'beverages',
  'produce',
  'motor_vehicles',
  'livestock',
  'grain_feed',
  'oilfield',
  'meat',
  'paper',
  'construction',
  'farm_supplies',
  'coal_coke',
  'building_materials',
];

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
  // 0049_carrier_equipment.sql — FMCSA equipment / cargo-type flags (crgo_*).
  // Healed HERE (same reasoning as hazmat above): they run right after the CREATE
  // TABLE so the table exists and IF NOT EXISTS no-ops on a healthy DB. Each
  // defaults false so every existing row is unchanged until the next re-ingest.
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "dry_van" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "reefer" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "tanker" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "flatbed" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "dry_bulk" boolean NOT NULL DEFAULT false`,
  // 0050_carrier_cargo_classes.sql — additional FMCSA cargo-CLASS specialties
  // (crgo_*). Healed HERE (same reasoning as 0049 above): they run right after the
  // CREATE TABLE so the table exists and IF NOT EXISTS no-ops on a healthy DB. Each
  // defaults false so every existing row is unchanged until the next re-ingest.
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "household_goods" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "beverages" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "produce" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "motor_vehicles" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "livestock" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "grain_feed" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "oilfield" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "meat" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "paper" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "construction" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "farm_supplies" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "coal_coke" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "building_materials" boolean NOT NULL DEFAULT false`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "carrier_directory_usdot_idx" ON "carrier_directory" ("usdot")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "carrier_directory_slug_idx" ON "carrier_directory" ("public_slug")`,
  `CREATE INDEX IF NOT EXISTS "carrier_directory_state_idx" ON "carrier_directory" ("state")`,
  `CREATE INDEX IF NOT EXISTS "carrier_directory_port_idx" ON "carrier_directory" ("nearest_port_code")`,
  // ── 0066_directory_query_indexes.sql ──────────────────────────────────────
  // The /directory list + filtered-count path (listCarriers → listCarriersUnsafe)
  // was hitting the 8s statement_timeout on prod and degrading to an empty list
  // ("[directory] listCarriers failed; serving empty list ... 57014"). The two
  // single-column indexes above narrow to a state/port, but the SORT keys
  // (power_units, intermodal) and the ~20 cargo BOOLEANs live only in the heap,
  // so every filtered page had to bitmap-fetch 4.6k–12k heap pages out of the
  // 94 MB / 330k-row table and then top-N sort them. Warm that costs ~10–100 ms;
  // on a cold Neon page cache (post-deploy / scale-from-zero / crawler burst on
  // many distinct facet combos) those page fetches are remote and blow the
  // budget. These indexes put the ORDER BY and the facet predicates INTO the
  // index so the LIMIT terminates early and the heap is touched ~24 times.
  //
  // Composites are deliberately LEAN — (filter, sort-prefix) only, no
  // legal_name/id tail. Measured on a 330k-row replica of prod, adding the tail
  // made the indexes ~2.2x larger for an identical plan (Postgres finishes the
  // name/id tie-break with a cheap Incremental Sort), and a smaller index is
  // strictly better on Neon where index pages compete for the local file cache.
  //
  // NOT `CREATE INDEX CONCURRENTLY`: postgres.js sends these over the extended
  // query protocol, which wraps each statement in an implicit transaction, and
  // CONCURRENTLY cannot run inside a transaction block. A plain CREATE INDEX
  // takes a SHARE lock — it blocks WRITES to carrier_directory (only the weekly
  // FMCSA ingest writes here) but never READS, and each build measured ~1s on a
  // 330k-row table. IF NOT EXISTS makes every subsequent boot a no-op.
  //
  // MUST stay byte-for-byte equivalent to drizzle/0066_directory_query_indexes.sql
  // and src/db/schema.ts `carrierDirectory`.
  //
  // (state|port|∅, intermodal DESC, power_units DESC NULLS LAST) — the DEFAULT
  // `featured` sort (orderForSort's 'featured' branch), which is what every
  // /directory, /directory?state=, /directory?port= and city page uses.
  `CREATE INDEX IF NOT EXISTS "carrier_directory_state_featured_idx" ON "carrier_directory" ("state", "intermodal" DESC, "power_units" DESC NULLS LAST)`,
  `CREATE INDEX IF NOT EXISTS "carrier_directory_port_featured_idx" ON "carrier_directory" ("nearest_port_code", "intermodal" DESC, "power_units" DESC NULLS LAST)`,
  `CREATE INDEX IF NOT EXISTS "carrier_directory_featured_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST)`,
  // (state|port, power_units DESC NULLS LAST) — the `fleet` sort AND the
  // fleet-bucket range predicate (`power_units BETWEEN a AND b`), which the
  // featured indexes above cannot serve as a range because `intermodal` sits
  // between the equality column and power_units.
  `CREATE INDEX IF NOT EXISTS "carrier_directory_state_fleet_idx" ON "carrier_directory" ("state", "power_units" DESC NULLS LAST)`,
  `CREATE INDEX IF NOT EXISTS "carrier_directory_port_fleet_idx" ON "carrier_directory" ("nearest_port_code", "power_units" DESC NULLS LAST)`,
  // One PARTIAL index per cargo/equipment facet, keyed on the default sort
  // prefix. Small (a few hundred KB each — they only index the rows where the
  // flag is true) and they serve three shapes: an index-only `count(*)` for the
  // facet badge, a BitmapAnd/BitmapOr leg when the facet is combined with
  // others, and an ordered scan for a cargo-only list page.
  ...DIRECTORY_FLAG_INDEX_COLUMNS.map(
    (col) =>
      `CREATE INDEX IF NOT EXISTS "carrier_directory_flag_${col}_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "${col}"`,
  ),
  // 0048_carrier_overrides.sql — human-editable OVERRIDES that survive the FMCSA
  // re-ingest (the ingest touches carrier_directory ONLY, never this table).
  // Healed HERE (like carrier_directory) because the Replit deploy skips
  // db:migrate; IF NOT EXISTS no-ops on a healthy DB. MUST stay byte-for-byte
  // equivalent to drizzle/0048_carrier_overrides.sql + schema.ts `carrierOverrides`.
  `CREATE TABLE IF NOT EXISTS "carrier_overrides" (
    "usdot" text PRIMARY KEY NOT NULL,
    "about_override" text,
    "email_override" text,
    "phone_override" text,
    "hidden" boolean,
    "capabilities" jsonb,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "updated_by" text
  )`,
  // 0055_carrier_operating_locations.sql — carrier-declared OTHER operating
  // cities/terminals (metros beyond the single FMCSA HQ), rendered as the
  // profile's "Also operating in" list. Healed HERE (right after the
  // carrier_overrides CREATE above, same reasoning as the directory_terminals
  // ALTERs): the Replit deploy skips db:migrate and its publish tool can drop
  // the column, so this ADD COLUMN IF NOT EXISTS runs on every boot and no-ops
  // on a healthy DB. Nullable, no backfill.
  `ALTER TABLE "carrier_overrides" ADD COLUMN IF NOT EXISTS "operating_locations" jsonb`,
  // 0046_terminals.sql — canonical intermodal-terminal reference list backing the
  // public directory. Healed HERE (a separate at-risk TABLE, same reasoning as
  // carrier_directory): the seed (seedDirectoryTerminals) runs at boot after this
  // step and needs the table to exist even on a prod DB that never received 0046.
  // Must stay byte-for-byte equivalent to drizzle/0046_terminals.sql + schema.ts.
  `CREATE TABLE IF NOT EXISTS "directory_terminals" (
    "id" serial PRIMARY KEY NOT NULL,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "city" text NOT NULL,
    "state" text NOT NULL,
    "country" text DEFAULT 'US' NOT NULL,
    "type" text NOT NULL,
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "directory_terminals_code_idx" ON "directory_terminals" ("code")`,
  `CREATE INDEX IF NOT EXISTS "directory_terminals_country_idx" ON "directory_terminals" ("country")`,
  `CREATE INDEX IF NOT EXISTS "directory_terminals_type_idx" ON "directory_terminals" ("type")`,
  // 0054_terminal_address_operator.sql — nullable anchor-facility address +
  // operator on directory_terminals. Healed HERE (right after the CREATE TABLE
  // above, same reasoning as the carrier_directory ALTERs): the seed
  // (seedDirectoryTerminals) writes these on boot and needs the columns to exist
  // even on a prod DB that never received 0054 or where Replit phantom-dropped
  // them. Both nullable, no backfill, so IF NOT EXISTS no-ops on a healthy DB.
  `ALTER TABLE "directory_terminals" ADD COLUMN IF NOT EXISTS "address" text`,
  `ALTER TABLE "directory_terminals" ADD COLUMN IF NOT EXISTS "operator" text`,
  // 0051_rfq.sql — multi-carrier RFQ (rate request) tables. Healed HERE (same
  // reasoning as carrier_directory): the Replit deploy skips db:migrate and its
  // publish tool can drop tables, so these CREATE TABLE IF NOT EXISTS statements
  // run on every boot and no-op on a healthy DB. MUST stay byte-for-byte
  // equivalent to drizzle/0051_rfq.sql + schema.ts (rfqRequests/Recipients/Quotes).
  `CREATE TABLE IF NOT EXISTS "rfq_requests" (
    "id" serial PRIMARY KEY NOT NULL,
    "view_token" text NOT NULL,
    "shipper_name" text NOT NULL,
    "shipper_company" text,
    "shipper_email" text NOT NULL,
    "shipper_phone" text,
    "origin" text NOT NULL,
    "destination" text NOT NULL,
    "equipment" text,
    "container_type" text,
    "commodity" text,
    "weight" text,
    "ready_date" text,
    "target_rate" text,
    "notes" text,
    "filter_snapshot" jsonb,
    "status" text DEFAULT 'open' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "rfq_recipients" (
    "id" serial PRIMARY KEY NOT NULL,
    "rfq_id" integer NOT NULL,
    "carrier_dot" text NOT NULL,
    "carrier_name" text NOT NULL,
    "carrier_email" text,
    "status" text DEFAULT 'pending' NOT NULL,
    "quote_token" text NOT NULL,
    "sent_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "rfq_quotes" (
    "id" serial PRIMARY KEY NOT NULL,
    "rfq_id" integer NOT NULL,
    "recipient_id" integer NOT NULL,
    "carrier_dot" text NOT NULL,
    "price" text,
    "transit_days" integer,
    "notes" text,
    "valid_until" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  // 0056_rfq_email_drafts.sql — per-carrier AI/template email drafts persisted on
  // the recipient row for the two-phase (generate → review/edit → send) flow.
  // Both nullable, no backfill, so IF NOT EXISTS no-ops on a healthy DB and
  // re-adds them after a Replit phantom-drop. Byte-for-byte with the drizzle
  // migration + schema.ts (rfqRecipients.draftSubject / draftBody).
  `ALTER TABLE "rfq_recipients" ADD COLUMN IF NOT EXISTS "draft_subject" text`,
  `ALTER TABLE "rfq_recipients" ADD COLUMN IF NOT EXISTS "draft_body" text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "rfq_requests_view_token_idx" ON "rfq_requests" ("view_token")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "rfq_recipients_quote_token_idx" ON "rfq_recipients" ("quote_token")`,
  `CREATE INDEX IF NOT EXISTS "rfq_recipients_rfq_idx" ON "rfq_recipients" ("rfq_id")`,
  `CREATE INDEX IF NOT EXISTS "rfq_quotes_rfq_idx" ON "rfq_quotes" ("rfq_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "rfq_quotes_recipient_idx" ON "rfq_quotes" ("recipient_id")`,
  // 0053_affiliate_referral.sql — affiliate + referral program (Phase 1). Healed
  // HERE (same reasoning as carrier_directory/rfq above): the Replit deploy skips
  // db:migrate and its publish tool can drop tables, so these CREATE TABLE / ADD
  // COLUMN IF NOT EXISTS statements run on every boot and no-op on a healthy DB.
  // MUST stay byte-for-byte equivalent to drizzle/0053_affiliate_referral.sql +
  // schema.ts (tenants.referralCode / affiliates / referralAttributions /
  // referralCredits / affiliateCommissions). The tenants ALTER is safe here —
  // the tenants table always predates this step.
  `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "referral_code" text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "tenants_referral_code_idx" ON "tenants" ("referral_code")`,
  `CREATE TABLE IF NOT EXISTS "affiliates" (
    "id" serial PRIMARY KEY NOT NULL,
    "owner_tenant_id" integer,
    "owner_user_id" integer,
    "email" text NOT NULL,
    "name" text,
    "code" text NOT NULL,
    "tier" text DEFAULT 'base' NOT NULL,
    "commission_rate" double precision DEFAULT 0.25 NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "payout_method" text,
    "payout_details" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "referral_attributions" (
    "id" serial PRIMARY KEY NOT NULL,
    "code" text NOT NULL,
    "kind" text DEFAULT 'unknown' NOT NULL,
    "referred_tenant_id" integer,
    "visitor_token" text NOT NULL,
    "landed_at" timestamp DEFAULT now() NOT NULL,
    "converted_at" timestamp,
    "reward_status" text DEFAULT 'pending' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "referral_credits" (
    "id" serial PRIMARY KEY NOT NULL,
    "tenant_id" integer NOT NULL,
    "source_attribution_id" integer,
    "months_granted" integer DEFAULT 1 NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "applied_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "affiliate_commissions" (
    "id" serial PRIMARY KEY NOT NULL,
    "affiliate_id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "period_month" text NOT NULL,
    "amount_cents" integer DEFAULT 0 NOT NULL,
    "rate" double precision DEFAULT 0.25 NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_code_idx" ON "affiliates" ("code")`,
  `CREATE INDEX IF NOT EXISTS "affiliates_email_idx" ON "affiliates" ("email")`,
  `CREATE INDEX IF NOT EXISTS "affiliates_owner_tenant_idx" ON "affiliates" ("owner_tenant_id")`,
  `CREATE INDEX IF NOT EXISTS "referral_attributions_code_idx" ON "referral_attributions" ("code")`,
  `CREATE INDEX IF NOT EXISTS "referral_attributions_tenant_idx" ON "referral_attributions" ("referred_tenant_id")`,
  `CREATE INDEX IF NOT EXISTS "referral_attributions_visitor_idx" ON "referral_attributions" ("visitor_token")`,
  `CREATE INDEX IF NOT EXISTS "referral_credits_tenant_idx" ON "referral_credits" ("tenant_id")`,
  `CREATE INDEX IF NOT EXISTS "referral_credits_status_idx" ON "referral_credits" ("status")`,
  `CREATE INDEX IF NOT EXISTS "affiliate_commissions_affiliate_idx" ON "affiliate_commissions" ("affiliate_id")`,
  `CREATE INDEX IF NOT EXISTS "affiliate_commissions_tenant_idx" ON "affiliate_commissions" ("tenant_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commissions_uniq_idx" ON "affiliate_commissions" ("affiliate_id","tenant_id","period_month")`,
  // 0057_directory_subscriptions.sql — "Directory Pro" ($19/mo) per-SHIPPER
  // entitlement (a `users` row with tenant_id=null, role='shipper'). Healed HERE
  // (same reasoning as carrier_directory/rfq above): the Replit deploy skips
  // db:migrate and its publish tool can drop tables, so this CREATE TABLE / INDEX
  // IF NOT EXISTS runs on every boot and no-ops on a healthy DB. MUST stay
  // byte-for-byte equivalent to drizzle/0057_directory_subscriptions.sql +
  // schema.ts `directorySubscriptions`. References `users` only, never `tenants`.
  `CREATE TABLE IF NOT EXISTS "directory_subscriptions" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL,
    "status" text DEFAULT 'inactive' NOT NULL,
    "stripe_customer_id" text,
    "stripe_subscription_id" text,
    "price_id" text,
    "current_period_end" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "directory_subscriptions_user_idx" ON "directory_subscriptions" ("user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "directory_subscriptions_customer_idx" ON "directory_subscriptions" ("stripe_customer_id")`,
  // Super-admin comp/free-grant columns (admin subscription ops). ALTER runs
  // right after the CREATE TABLE so the table is guaranteed present; IF NOT EXISTS
  // no-ops on a healthy DB and back-fills an existing table. Keep in sync with
  // schema.ts `directorySubscriptions`.
  `ALTER TABLE "directory_subscriptions" ADD COLUMN IF NOT EXISTS "comp" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "directory_subscriptions" ADD COLUMN IF NOT EXISTS "comp_note" text`,
  // 0058_directory_rfq_usage.sql — per-account monthly RFQ send meter (the
  // un-gameable quota behind RFQ gating). Healed HERE (same reasoning as
  // directory_subscriptions above): the Replit deploy skips db:migrate and its
  // publish tool can drop tables, so this CREATE TABLE / INDEX IF NOT EXISTS runs
  // on every boot and no-ops on a healthy DB. MUST stay byte-for-byte equivalent
  // to drizzle/0058_directory_rfq_usage.sql + schema.ts `directoryRfqUsage`. A
  // phantom-drop loses the current month's counts only (a bounded, self-refilling
  // meter) — never any subscription/entitlement state.
  `CREATE TABLE IF NOT EXISTS "directory_rfq_usage" (
    "id" serial PRIMARY KEY NOT NULL,
    "account_key" text NOT NULL,
    "period" text NOT NULL,
    "sends" integer DEFAULT 0 NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "directory_rfq_usage_account_period_idx" ON "directory_rfq_usage" ("account_key","period")`,
  // 0059_carrier_contacts.sql — the ENRICHED-CONTACTS layer behind the Directory
  // Pro "Reveal additional contacts" button (PR C). Three tables: the cached
  // additional contacts, the per-DOT attempt marker (TTL cache), and the daily
  // fresh-reveal cost meter. Healed HERE (same reasoning as the directory tables
  // above): the Replit deploy skips db:migrate and its publish tool can drop
  // tables, so these CREATE TABLE / INDEX IF NOT EXISTS run on every boot and
  // no-op on a healthy DB. MUST stay byte-for-byte equivalent to
  // drizzle/0059_carrier_contacts.sql + schema.ts. A phantom-drop loses only a
  // self-refilling cache/meter — never any subscription/entitlement state.
  `CREATE TABLE IF NOT EXISTS "carrier_contacts" (
    "id" serial PRIMARY KEY NOT NULL,
    "carrier_dot" text NOT NULL,
    "source" text NOT NULL,
    "contact_name" text,
    "title" text,
    "email" text,
    "phone" text,
    "confidence" text,
    "enriched_at" timestamp with time zone DEFAULT now() NOT NULL,
    "raw_json" jsonb
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "carrier_contacts_dot_email_idx" ON "carrier_contacts" ("carrier_dot","email")`,
  `CREATE INDEX IF NOT EXISTS "carrier_contacts_dot_idx" ON "carrier_contacts" ("carrier_dot")`,
  `CREATE TABLE IF NOT EXISTS "carrier_enrichment_state" (
    "id" serial PRIMARY KEY NOT NULL,
    "carrier_dot" text NOT NULL,
    "attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
    "contact_count" integer DEFAULT 0 NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "carrier_enrichment_state_dot_idx" ON "carrier_enrichment_state" ("carrier_dot")`,
  `CREATE TABLE IF NOT EXISTS "directory_reveal_usage" (
    "id" serial PRIMARY KEY NOT NULL,
    "account_key" text NOT NULL,
    "period" text NOT NULL,
    "reveals" integer DEFAULT 0 NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "directory_reveal_usage_account_period_idx" ON "directory_reveal_usage" ("account_key","period")`,
  // 0060_saved_lists.sql — Directory Pro "saved lists": a logged-in shipper
  // groups carriers into named lists (PR D). Healed HERE (same reasoning as the
  // directory tables above): the Replit deploy skips db:migrate and its publish
  // tool can drop tables, so these CREATE TABLE / INDEX IF NOT EXISTS run on
  // every boot and no-op on a healthy DB. MUST stay byte-for-byte equivalent to
  // drizzle/0060_saved_lists.sql + schema.ts (savedLists / savedListItems).
  // References `users` only, never `tenants`.
  `CREATE TABLE IF NOT EXISTS "saved_lists" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL,
    "name" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "saved_lists_user_idx" ON "saved_lists" ("user_id")`,
  `CREATE TABLE IF NOT EXISTS "saved_list_items" (
    "id" serial PRIMARY KEY NOT NULL,
    "list_id" integer NOT NULL,
    "carrier_dot" text NOT NULL,
    "added_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "saved_list_items_list_dot_idx" ON "saved_list_items" ("list_id","carrier_dot")`,
  `CREATE INDEX IF NOT EXISTS "saved_list_items_list_idx" ON "saved_list_items" ("list_id")`,
  // 0061_password_reset_tokens.sql — single-use "forgot password" reset links.
  // Replit's deploy skips db:migrate and its publish tool can drop tables, so
  // this CREATE TABLE / INDEX IF NOT EXISTS runs on every boot and no-ops on a
  // healthy DB — a phantom-dropped table is re-created (empty) before the server
  // serves, so the forgot-password flow can never 500 on a missing table. MUST
  // stay byte-for-byte equivalent to drizzle/0061_password_reset_tokens.sql +
  // schema.ts (passwordResetTokens). References `users` only, never `tenants`.
  `CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "token_hash" text PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL,
    "expires_at" timestamp NOT NULL,
    "used_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id")`,
  // 0063_directory_aggregate_cache.sql — the PRECOMPUTED single-row global
  // directory aggregates (summary + unfiltered base facet counts) that remove
  // the ~330k-row carrier_directory scan from the /directory request path (the
  // recurring all-domains-down outage). Healed HERE (same reasoning as the
  // directory tables above): the Replit deploy skips db:migrate and its publish
  // tool can drop tables, so this CREATE TABLE IF NOT EXISTS runs on every boot
  // and no-ops on a healthy DB. A phantom-drop loses ONLY a derived cache that
  // the next ingest/cron/boot recomputes — never any real carrier data. MUST
  // stay byte-for-byte equivalent to drizzle/0063_directory_aggregate_cache.sql
  // + schema.ts `directoryAggregateCache`.
  `CREATE TABLE IF NOT EXISTS "directory_aggregate_cache" (
    "id" integer PRIMARY KEY NOT NULL,
    "summary" jsonb NOT NULL,
    "base_facets" jsonb NOT NULL,
    "computed_at" timestamp DEFAULT now() NOT NULL
  )`,
  // 0064_importer_cache.sql — persistent cache for the Importer Search feature
  // (/importers). Two tables: pulled ImportYeti BOL result sets (keyed by a
  // normalized-filter hash) and resolved contacts (keyed by company basename).
  // ImportYeti's ToS permits storing + reselling the data, so caching is a
  // licensed cost guard: a repeat search inside the 14-day TTL spends ZERO
  // external credits. Both are read ONLY by their UNIQUE key index (never a
  // scan). Healed HERE (Replit skips db:migrate + its publish tool can drop
  // tables): these CREATE TABLE / INDEX IF NOT EXISTS run on every boot and
  // no-op on a healthy DB; a phantom-drop loses only a re-fetchable cache, never
  // real data. MUST stay byte-for-byte equivalent to drizzle/0064_importer_cache.sql
  // + schema.ts `importerBolCache` / `importerContactCache`.
  `CREATE TABLE IF NOT EXISTS "importer_bol_cache" (
    "id" serial PRIMARY KEY NOT NULL,
    "search_key" text NOT NULL,
    "rows" jsonb NOT NULL,
    "credits_remaining" integer,
    "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "importer_bol_cache_key_idx" ON "importer_bol_cache" ("search_key")`,
  `CREATE TABLE IF NOT EXISTS "importer_contact_cache" (
    "id" serial PRIMARY KEY NOT NULL,
    "company_key" text NOT NULL,
    "domain" text,
    "confidence" text NOT NULL,
    "contact" jsonb,
    "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "importer_contact_cache_key_idx" ON "importer_contact_cache" ("company_key")`,
  // 0067_external_api_spend.sql — audit ledger for PAID external provider calls
  // (ImportYeti / Hunter / importer AI draft). One row per call that actually
  // went out, written from the single choke point in externalPullGuard.ts, so
  // spend is auditable in admin instead of invisible in console output. Healed
  // HERE (same reasoning as the caches above): read only as a bounded indexed
  // query; a phantom-drop loses audit history, never product data. MUST stay
  // byte-for-byte equivalent to drizzle/0067_external_api_spend.sql + schema.ts
  // `externalApiSpend`.
  `CREATE TABLE IF NOT EXISTS "external_api_spend" (
    "id" serial PRIMARY KEY NOT NULL,
    "provider" text NOT NULL,
    "context" text,
    "credits" integer DEFAULT 0 NOT NULL,
    "credits_remaining" integer,
    "est_usd_cents" integer DEFAULT 0 NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "external_api_spend_at_idx" ON "external_api_spend" ("occurred_at")`,
  // leads_subscriptions + leads_reveal_usage — the "Leads Pro" contact-reveal
  // subscription (per-USER, cloned from directory/manifest) and its per-account
  // reveal allowance meter. Healed HERE (same reasoning as the directory tables
  // above): the Replit deploy skips db:migrate and its publish tool can drop
  // tables, so these CREATE TABLE / INDEX IF NOT EXISTS run on every boot and
  // no-op on a healthy DB. MUST stay byte-for-byte equivalent to schema.ts
  // (leadsSubscriptions / leadsRevealUsage). leads_subscriptions references
  // `users` only, never `tenants`; a phantom-drop of leads_reveal_usage loses
  // only the current reveal counts (self-refilling) — never entitlement state.
  `CREATE TABLE IF NOT EXISTS "leads_subscriptions" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL,
    "tier" text DEFAULT 'pro' NOT NULL,
    "status" text DEFAULT 'inactive' NOT NULL,
    "stripe_customer_id" text,
    "stripe_subscription_id" text,
    "price_id" text,
    "current_period_end" timestamp,
    "reveal_allowance" integer DEFAULT 50 NOT NULL,
    "comp" boolean DEFAULT false NOT NULL,
    "comp_note" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "leads_subscriptions_user_idx" ON "leads_subscriptions" ("user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "leads_subscriptions_customer_idx" ON "leads_subscriptions" ("stripe_customer_id")`,
  `CREATE TABLE IF NOT EXISTS "leads_reveal_usage" (
    "id" serial PRIMARY KEY NOT NULL,
    "account_key" text NOT NULL,
    "period" text NOT NULL,
    "reveals" integer DEFAULT 0 NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "leads_reveal_usage_account_period_idx" ON "leads_reveal_usage" ("account_key","period")`,
  // 0065_manifest_privacy.sql — the managed CBP vessel-manifest-confidentiality
  // service (Manifest Privacy). Four tables: the cloned SHIPPER subscription, the
  // e-signed POA applications (the RETAINED ESIGN record), its append-only audit
  // trail, and the active in-app redaction set. Healed HERE (same reasoning as the
  // directory tables above): the Replit deploy skips db:migrate and its publish
  // tool can drop tables, so these CREATE TABLE / INDEX IF NOT EXISTS run on every
  // boot and no-op on a healthy DB. MUST stay byte-for-byte equivalent to
  // src/db/schema.ts (manifestSubscriptions / poaApplications / poaAuditEvents /
  // manifestRedactions). These reference `users` only, never `tenants`.
  `CREATE TABLE IF NOT EXISTS "manifest_subscriptions" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL,
    "tier" text DEFAULT 'basic' NOT NULL,
    "status" text DEFAULT 'inactive' NOT NULL,
    "stripe_customer_id" text,
    "stripe_subscription_id" text,
    "price_id" text,
    "current_period_end" timestamp,
    "entity_quota" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "manifest_subscriptions_user_idx" ON "manifest_subscriptions" ("user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "manifest_subscriptions_customer_idx" ON "manifest_subscriptions" ("stripe_customer_id")`,
  // Super-admin comp/free-grant columns (admin subscription ops). Keep in sync
  // with schema.ts `manifestSubscriptions`.
  `ALTER TABLE "manifest_subscriptions" ADD COLUMN IF NOT EXISTS "comp" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "manifest_subscriptions" ADD COLUMN IF NOT EXISTS "comp_note" text`,
  `CREATE TABLE IF NOT EXISTS "poa_applications" (
    "id" serial PRIMARY KEY NOT NULL,
    "public_token" text NOT NULL,
    "user_id" integer,
    "status" text DEFAULT 'draft' NOT NULL,
    "grantor_legal_name" text,
    "entity_type" text,
    "state_of_org" text,
    "grantor_address" text,
    "ein_or_importer_no" text,
    "name_variations" jsonb,
    "address_variations" jsonb,
    "importer_slug" text,
    "signer_name" text,
    "signer_title" text,
    "signer_email" text,
    "consent_disclosure_version" text,
    "signature_typed" text,
    "signature_drawn_png" text,
    "signed_at" timestamp with time zone,
    "signer_ip" text,
    "signer_ua" text,
    "doc_sha256" text,
    "cbp_channel" text,
    "cbp_submitted_at" timestamp with time zone,
    "cbp_confirmed_at" timestamp with time zone,
    "effective_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "last_reminder_at" timestamp with time zone,
    "docs" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "poa_applications_token_idx" ON "poa_applications" ("public_token")`,
  `CREATE INDEX IF NOT EXISTS "poa_applications_user_idx" ON "poa_applications" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "poa_applications_status_idx" ON "poa_applications" ("status")`,
  `CREATE INDEX IF NOT EXISTS "poa_applications_expires_idx" ON "poa_applications" ("expires_at")`,
  // CBP receipt/confirmation reference captured on confirm (admin renewal-ops).
  // Keep in sync with schema.ts `poaApplications`.
  `ALTER TABLE "poa_applications" ADD COLUMN IF NOT EXISTS "cbp_reference" text`,
  `CREATE TABLE IF NOT EXISTS "poa_audit_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "application_id" integer NOT NULL,
    "event" text NOT NULL,
    "ip" text,
    "user_agent" text,
    "meta" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "poa_audit_events_application_idx" ON "poa_audit_events" ("application_id")`,
  `CREATE TABLE IF NOT EXISTS "manifest_redactions" (
    "id" serial PRIMARY KEY NOT NULL,
    "name_key" text NOT NULL,
    "application_id" integer,
    "reason" text,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "manifest_redactions_name_key_idx" ON "manifest_redactions" ("name_key")`,
  // importer_saved — a logged-in user's saved importers (broker workflow), the
  // importer-search analogue of saved_lists. Healed HERE (same reasoning as the
  // directory tables above): the Replit deploy skips db:migrate and its publish
  // tool can drop tables, so this CREATE TABLE / INDEX IF NOT EXISTS runs on every
  // boot and no-ops on a healthy DB; a phantom-drop loses saved importers (user
  // data, not billing state) and is re-created empty on the next boot. MUST stay
  // byte-for-byte equivalent to schema.ts `importerSaved`. References `users` only.
  `CREATE TABLE IF NOT EXISTS "importer_saved" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL,
    "slug" text NOT NULL,
    "company" text NOT NULL,
    "note" text,
    "status" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "importer_saved_user_slug_idx" ON "importer_saved" ("user_id","slug")`,
  `CREATE INDEX IF NOT EXISTS "importer_saved_user_idx" ON "importer_saved" ("user_id")`,
  // 0065_sitemap_cache.sql — the PRECOMPUTED sitemap documents (index + cities +
  // carriers-N chunks) that let /sitemap*.xml enumerate all ~334k carrier
  // profiles for SEO discovery WITHOUT re-scanning carrier_directory on the
  // request path (the same scan-stampede class as directory_aggregate_cache).
  // Healed HERE (Replit skips db:migrate + its publish tool can drop tables):
  // this CREATE TABLE IF NOT EXISTS runs on every boot and no-ops on a healthy
  // DB. A phantom-drop loses ONLY a derived cache the next ingest/cron/boot
  // recomputes — never any real carrier data. MUST stay byte-for-byte equivalent
  // to drizzle/0065_sitemap_cache.sql + schema.ts `sitemapCache`.
  `CREATE TABLE IF NOT EXISTS "sitemap_cache" (
    "key" text PRIMARY KEY NOT NULL,
    "xml" text NOT NULL,
    "url_count" integer DEFAULT 0 NOT NULL,
    "computed_at" timestamp DEFAULT now() NOT NULL
  )`,
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
