-- Carrier overrides — human-editable OVERRIDES for a public carrier card, keyed
-- by USDOT. The nightly FMCSA re-ingest rewrites `carrier_directory` (see
-- CARRIER_UPSERT_SET in src/server/directory/carrierIngest.ts) but NEVER touches
-- this table, so any admin/carrier edit here PERSISTS across every re-ingest —
-- the same survive-the-ingest guarantee already proven by
-- `carrier_directory.contact_hidden`, lifted into a dedicated table so we can
-- edit ANY card field (not just the opt-out) without the ingest clobbering it.
--
--   usdot           — USDOT (leading zeros stripped); PK, joins carrier_directory.
--   about_override  — replaces the auto-generated FMCSA "About" prose.
--   email_override  — replaces the FMCSA census email on the profile.
--   phone_override  — replaces the FMCSA census phone on the profile.
--   hidden          — hides public contact (OR'd with carrier_directory.contact_hidden).
--   capabilities    — self-declared credentials JSON ({ uiia, twic, bonded,
--                     reefer, transload, yard }); flips the matching profile
--                     badge to ACTIVE but still labeled "self-declared".
--   updated_by      — actor identity (admin email / user id) of the last write.
--
-- Every override column is nullable: NULL means "no override — fall back to the
-- FMCSA value". Platform-level like carrier_directory (no tenantId).
--
-- Idempotent (CREATE TABLE IF NOT EXISTS, no backfill) so it is safe to re-run on
-- every boot via runMigrations() (src/db/migrate.ts) — the Replit deploy does not
-- run db:migrate, so this makes the republish self-healing (same pattern as 0041).
CREATE TABLE IF NOT EXISTS "carrier_overrides" (
  "usdot" text PRIMARY KEY NOT NULL,
  "about_override" text,
  "email_override" text,
  "phone_override" text,
  "hidden" boolean,
  "capabilities" jsonb,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" text
);
