-- Carrier directory — add FMCSA equipment / cargo-type flags.
--
-- Sourced FREE from the FMCSA Company Census file (Socrata az4n-8mr2) cargo-
-- classification columns (each is 'X' when the carrier reports that cargo type):
--   dry_van  ← crgo_genfreight                                   (dry van / general freight)
--   reefer   ← crgo_coldfood                                     (refrigerated — NOTE: az4n-8mr2 has NO crgo_reefer column)
--   tanker   ← crgo_liqgas OR crgo_chem                          (bulk liquids / gas / chemicals)
--   flatbed  ← crgo_metalsheet OR crgo_machlrg OR crgo_logpole   (heavy / dimensional freight, "flatbed / oversized")
--   dry_bulk ← crgo_drybulk                                      (dry bulk)
--
-- Captured on the next re-ingest; each defaults false until then so every
-- existing row stays valid (unchanged). These are verified FMCSA facts, refreshed
-- by the ingest upsert (never touched by a carrier opt-out).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS, NOT NULL w/ default) so it is safe to
-- re-run on every boot via runMigrations() — the Replit deploy does not run
-- db:migrate, so this makes the republish self-healing (same pattern as 0044).
-- The same statements are mirrored in the carrier_directory
-- SELF_HEAL_TABLE_STATEMENTS step (src/db/migrate.ts) so a Replit phantom-drop of
-- a column is re-added before the server serves — table-first-safe (they run
-- right after CREATE TABLE).
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "dry_van" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "reefer" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "tanker" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "flatbed" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "dry_bulk" boolean NOT NULL DEFAULT false;
