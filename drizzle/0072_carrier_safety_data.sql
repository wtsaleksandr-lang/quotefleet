-- FMCSA SAFETY record on carrier_directory.
--
-- Roadside inspections + out-of-service orders from the SMS AB PassProperty
-- file (Socrata 4y6x-dmck — one pre-aggregated 24-month row per carrier), and
-- crashes aggregated server-side off the FMCSA Crash File (aayw-vxb3) over the
-- SAME 24-month window.
--
-- EVERY COLUMN IS NULLABLE ON PURPOSE. `null` means "FMCSA published no record",
-- never "zero": only ~74% of directory carriers appear in the SMS file at all,
-- and rendering a missing record as a clean 0 would invent a spotless safety
-- history for a real company.
--
-- Nullable + NO DEFAULT is also the cheap DDL — a catalog-only change in
-- Postgres, so these ten ALTERs do not rewrite the 330k-row table. Mirrored
-- byte-for-byte in src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS (the mechanism
-- that actually creates them on Replit, which skips db:migrate) and in
-- src/db/schema.ts.
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "insp_total" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "driver_insp_total" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "driver_oos_total" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "vehicle_insp_total" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "vehicle_oos_total" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "crashes_total" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "crashes_fatal" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "crashes_injury" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "crashes_tow" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "safety_data_as_of" timestamp;
