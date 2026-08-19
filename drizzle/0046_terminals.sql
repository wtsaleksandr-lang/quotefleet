-- directory_terminals — canonical, PUBLIC reference list of major North-American
-- intermodal terminal metros: coastal SEAPORT gateways + inland RAIL intermodal
-- metros. Platform-level (no tenantId); a single global browse facet for the
-- public carrier directory. Seeded from src/server/directory/terminals.ts
-- (INTERMODAL_TERMINALS) via seedDirectoryTerminals().
--
--   code     — UN/LOCODE (seaport) or `INL`-prefixed inland-rail code; UNIQUE.
--   name     — display name (e.g. "Port of Los Angeles", "Memphis Intermodal").
--   city/state — metro city + two-letter US state / CA province.
--   country  — 'US' (default) or 'CA'.
--   type     — 'seaport' | 'rail'.
--   lat/lng  — widely-known public infrastructure coordinates (4 decimals).
--
-- Distinct from the tenant-scoped `terminals` table (per-carrier berths/ramps).
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() — the Replit deploy does not run
-- db:migrate, so this makes the republish self-healing (same pattern as 0041).
-- Also mirrored byte-for-byte in src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS so
-- a Replit phantom-drop of the table is re-created before the server serves.
CREATE TABLE IF NOT EXISTS "directory_terminals" (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS "directory_terminals_code_idx" ON "directory_terminals" ("code");
CREATE INDEX IF NOT EXISTS "directory_terminals_country_idx" ON "directory_terminals" ("country");
CREATE INDEX IF NOT EXISTS "directory_terminals_type_idx" ON "directory_terminals" ("type");
