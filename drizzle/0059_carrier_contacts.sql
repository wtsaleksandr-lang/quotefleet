-- carrier_contacts / carrier_enrichment_state / directory_reveal_usage —
-- the ENRICHED-CONTACTS layer behind the Directory Pro "Reveal additional
-- contacts" button (PR C).
--
--   carrier_contacts        — cached ADDITIONAL contacts (scraped from the
--                             carrier's own website via enrichCompany), keyed
--                             by normalized USDOT. Never duplicates the free
--                             FMCSA phone/email on carrier_directory.
--   carrier_enrichment_state— per-DOT "already attempted" marker (attempted_at +
--                             contact_count) so a dead/no-email domain is not
--                             re-scraped on every reveal (TTL cache).
--   directory_reveal_usage  — per-account DAILY fresh-reveal meter (cost
--                             governor); one increment per fresh reveal.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate. Also mirrored byte-for-byte in src/db/migrate.ts
-- SELF_HEAL_TABLE_STATEMENTS so a Replit phantom-drop is re-created before serve.
CREATE TABLE IF NOT EXISTS "carrier_contacts" (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS "carrier_contacts_dot_email_idx" ON "carrier_contacts" ("carrier_dot","email");
CREATE INDEX IF NOT EXISTS "carrier_contacts_dot_idx" ON "carrier_contacts" ("carrier_dot");

CREATE TABLE IF NOT EXISTS "carrier_enrichment_state" (
  "id" serial PRIMARY KEY NOT NULL,
  "carrier_dot" text NOT NULL,
  "attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "contact_count" integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "carrier_enrichment_state_dot_idx" ON "carrier_enrichment_state" ("carrier_dot");

CREATE TABLE IF NOT EXISTS "directory_reveal_usage" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_key" text NOT NULL,
  "period" text NOT NULL,
  "reveals" integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "directory_reveal_usage_account_period_idx" ON "directory_reveal_usage" ("account_key","period");
