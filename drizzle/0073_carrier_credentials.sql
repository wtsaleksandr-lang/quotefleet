-- FMCSA CREDENTIALS on carrier_directory.
--
-- Insurance filings from the L&I file (Socrata 6eyk-hxee — the SAME row the
-- ingest already reads for operating authority), plus two dates from the Company
-- Census file (az4n-8mr2 — likewise already fetched): when FMCSA registered the
-- carrier, and when the safety rating we already publish was assigned. No new
-- Socrata request: every column rides an existing fetch.
--
-- THE AMOUNTS ARE STORED IN DOLLARS. L&I encodes them as zero-padded THOUSANDS
-- ("00750" = $750,000); the ingest multiplies by 1,000 on the way in so no later
-- reader can mistake the unit.
--
-- NULLABLE ON PURPOSE for the amounts and dates: `null` means "FMCSA has no such
-- filing / no such date on record", never zero. 5.0% of carriers have no
-- liability filing and 97.6% have no safety rating, so a 0 default would invent
-- a fact for millions of page-views. The two Y/N flags are NOT NULL DEFAULT
-- false because they come from the L&I row that DEFINES a carrier's presence in
-- this directory — if we have the carrier we have its Y/N, so there is no third
-- "unknown" state.
--
-- Nullable + no default (and, on PG 11+, NOT NULL + a constant default) is a
-- catalog-only change, so these six ALTERs do not rewrite the 330k-row table.
-- Mirrored byte-for-byte in src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS (the
-- mechanism that actually creates them on Replit, which skips db:migrate) and in
-- src/db/schema.ts.
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "bipd_on_file" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "bipd_required" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "cargo_insurance_on_file" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "bond_on_file" boolean NOT NULL DEFAULT false;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "fmcsa_registered_since" timestamp;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "safety_rating_date" timestamp;
