-- Broker leads — FMCSA active property-BROKER prospect list (outreach pipeline).
--
-- Each row is one active US freight broker ingested from FMCSA's free public
-- data. The L&I (Licensing & Insurance) Carrier file supplies operating
-- authority (broker_stat='A' + property_chk='Y') plus the docket/MC number, and
-- the Company Census file supplies the e-mail address + power units. Rows are
-- written ONLY by scripts/ingestFmcsaCensus.ts via src/server/outreach/leadStore.ts.
--
-- Like prospect_demos / inbound_prospects / outreach_emails, this table is
-- DELIBERATELY ISOLATED: it never references tenants / users / the tenant-scoped
-- `leads` table, so an outreach prospect stays out of MRR, trials, quota, and
-- every tenant list by construction. It is named `broker_leads` (not `leads`)
-- because `leads` is already the tenant-scoped end-customer quote-request table.
--
--   mc_number        — L&I docket_number (e.g. "MC012892"); UNIQUE dedupe key.
--   dot_number       — USDOT number (census ⇄ L&I join key, leading zeros stripped).
--   legal_name/dba   — from L&I / census.
--   phone, addr_*    — physical business contact from L&I / census.
--   census_email     — email_address from the Census file (nullable).
--   resolved_domain  — apex resolved from the email / a later web step (nullable).
--   resolved_email   — best send-to address after resolution (nullable).
--   email_source     — where resolved_email came from ('census' | 'web' | …).
--   email_verified   — set once an address passes verification (false until then).
--   power_units      — census power_units (fleet-size proxy).
--   segment          — 'broker' for this ingest; reserved for future segments.
--   demo_token       — prospect_demos token minted for this lead, if any.
--   outreach_email_id— outreach_emails.id once a draft/send exists.
--   status           — pipeline state (default 'new').
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate, so this makes the republish self-healing (same
-- pattern as 0026/0029/0030). The nullable-UNIQUE index on mc_number is what
-- makes the ingest itself idempotent (re-runs upsert by MC number).
CREATE TABLE IF NOT EXISTS "broker_leads" (
  "id" serial PRIMARY KEY NOT NULL,
  "mc_number" text,
  "dot_number" text,
  "legal_name" text NOT NULL,
  "dba_name" text,
  "phone" text,
  "addr_street" text,
  "addr_city" text,
  "addr_state" text,
  "addr_zip" text,
  "census_email" text,
  "resolved_domain" text,
  "resolved_email" text,
  "email_source" text,
  "email_verified" boolean DEFAULT false NOT NULL,
  "power_units" integer,
  "segment" text DEFAULT 'broker' NOT NULL,
  "demo_token" text,
  "outreach_email_id" integer,
  "status" text DEFAULT 'new' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "broker_leads_mc_number_idx" ON "broker_leads" ("mc_number");
