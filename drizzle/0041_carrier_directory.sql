-- Carrier directory — PUBLIC, browsable US motor-carrier directory (ALL carrier
-- types with operating authority), sourced from FMCSA's free public data.
--
-- Each row is one ACTIVE US motor CARRIER ingested by
-- scripts/ingestFmcsaCarriers.ts. The L&I (Licensing & Insurance) Carrier file
-- supplies operating authority (common_stat='A' OR contract_stat='A', with
-- property_chk='Y') plus the docket/MC number and business address; the Company
-- Census file supplies power_units, total_drivers, safety_rating, and the
-- cargo-classification flags (crgo_intermodal='X' → the container/drayage flag).
--
--   usdot             — USDOT number (leading zeros stripped); UNIQUE identity.
--   mc_number         — L&I docket_number (e.g. "MC012892"); nullable.
--   legal_name/dba    — from L&I / census.
--   city/state/zip    — physical business address (census phy_* preferred).
--   phone             — physical business phone.
--   power_units       — census power_units (fleet size).
--   drivers           — census total_drivers.
--   safety_rating     — census safety_rating ('S'/'C'/'U'/null).
--   authority_type    — 'common' | 'contract' | 'common,contract'.
--   intermodal        — census crgo_intermodal === 'X' (drayage filter).
--   nearest_port_code — derived: nearest major US container port (ZIP centroid).
--   public_slug       — unique URL slug for the public carrier page.
--
-- Platform-level like broker_leads: no tenantId, never references tenants /
-- users / leads, so a directory carrier stays out of MRR, trials, and every
-- tenant list by construction.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate, so this makes the republish self-healing (same
-- pattern as 0026/0029/0030/0031). The unique index on usdot is what makes the
-- ingest itself idempotent (re-runs upsert by USDOT number).
CREATE TABLE IF NOT EXISTS "carrier_directory" (
  "id" serial PRIMARY KEY NOT NULL,
  "usdot" text NOT NULL,
  "mc_number" text,
  "legal_name" text NOT NULL,
  "dba_name" text,
  "city" text,
  "state" text,
  "zip" text,
  "phone" text,
  "power_units" integer,
  "drivers" integer,
  "safety_rating" text,
  "authority_type" text,
  "intermodal" boolean DEFAULT false NOT NULL,
  "nearest_port_code" text,
  "public_slug" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "carrier_directory_usdot_idx" ON "carrier_directory" ("usdot");
CREATE UNIQUE INDEX IF NOT EXISTS "carrier_directory_slug_idx" ON "carrier_directory" ("public_slug");
CREATE INDEX IF NOT EXISTS "carrier_directory_state_idx" ON "carrier_directory" ("state");
CREATE INDEX IF NOT EXISTS "carrier_directory_port_idx" ON "carrier_directory" ("nearest_port_code");
