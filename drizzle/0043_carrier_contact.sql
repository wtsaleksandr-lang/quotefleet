-- Carrier directory — add contact columns: `email` + `contact_hidden` opt-out.
--
-- Contact layer: the public carrier profile shows phone + email (from FREE
-- public FMCSA records) so shippers can reach carriers directly. `email` is
-- captured from the census email_address on the next re-ingest (null until
-- then). `contact_hidden` is the carrier opt-out: when true the profile hides
-- BOTH phone and email. It defaults false and is NEVER touched by the ingest
-- upsert, so an opted-out carrier stays hidden across every future re-ingest.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-run on every boot
-- via runMigrations() — the Replit deploy does not run db:migrate, so this makes
-- the republish self-healing (same pattern as 0042). Both statements are
-- mirrored in the carrier_directory SELF_HEAL_TABLE_STATEMENTS step
-- (src/db/migrate.ts) so a Replit phantom-drop is re-added before the server
-- serves — table-first-safe (they run right after the CREATE TABLE).
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "contact_hidden" boolean NOT NULL DEFAULT false;
