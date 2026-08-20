-- Carrier directory — add more FMCSA public cargo-CLASS flags.
--
-- Sourced FREE from the FMCSA Company Census file (Socrata az4n-8mr2) cargo-
-- classification columns (each is 'X' when the carrier reports that cargo class).
-- These are shipper-relevant SPECIALTIES beyond the equipment flags added by
-- 0049_carrier_equipment.sql (dry_van/reefer/tanker/flatbed/dry_bulk):
--   household_goods     ← crgo_household   (household goods / HHG)
--   beverages           ← crgo_beverages   (liquor / beverages)
--   produce             ← crgo_produce     (fresh produce)
--   motor_vehicles      ← crgo_motoveh     (motor vehicles)
--   livestock           ← crgo_livestock   (livestock)
--   grain_feed          ← crgo_grainfeed   (grain & feed)
--   oilfield            ← crgo_oilfield    (oilfield equipment / supplies)
--   meat                ← crgo_meat        (meat / perishable)
--   paper               ← crgo_paperprod   (paper products)
--   construction        ← crgo_construct   (construction)
--   farm_supplies       ← crgo_farmsupp    (farm supplies)
--   coal_coke           ← crgo_coalcoke    (coal / coke)
--   building_materials  ← crgo_bldgmat     (building materials)
--
-- Captured on the next re-ingest; each defaults false until then so every
-- existing row stays valid (unchanged). These are verified FMCSA facts, refreshed
-- by the ingest upsert (never touched by a carrier opt-out).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS, NOT NULL w/ default) so it is safe to
-- re-run on every boot via runMigrations() — the Replit deploy does not run
-- db:migrate, so this makes the republish self-healing (same pattern as 0049).
-- The same statements are mirrored in the carrier_directory
-- SELF_HEAL_TABLE_STATEMENTS step (src/db/migrate.ts) so a Replit phantom-drop of
-- a column is re-added before the server serves — table-first-safe (they run
-- right after CREATE TABLE).
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "household_goods" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "beverages" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "produce" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "motor_vehicles" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "livestock" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "grain_feed" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "oilfield" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "meat" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "paper" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "construction" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "farm_supplies" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "coal_coke" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "building_materials" boolean NOT NULL DEFAULT false;
