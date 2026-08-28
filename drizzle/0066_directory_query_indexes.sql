-- /directory query indexes.
--
-- carrier_directory had only carrier_directory_state_idx (state) and
-- carrier_directory_port_idx (nearest_port_code). Those narrow to a state/port
-- but leave the ORDER BY keys (intermodal, power_units) and the ~20 cargo
-- BOOLEAN facet columns in the heap, so every filtered /directory page had to
-- bitmap-fetch 4,600-12,000 heap pages out of the 94 MB / 330k-row table and
-- top-N sort them. Warm that is 10-100 ms; on a cold Neon page cache those are
-- remote reads and the query blew the 8s statement_timeout, so listCarriers
-- degraded to an empty list (PostgresError 57014).
--
-- Composites are LEAN — (filter, sort-prefix) only, no legal_name/id tail:
-- measured on a 330k-row replica of prod, adding the tail produced an identical
-- plan for ~2.2x the index size (the name/id tie-break finishes as a cheap
-- Incremental Sort), and a smaller index is strictly better on Neon where index
-- pages compete for the local file cache.
--
-- Plain CREATE INDEX, not CONCURRENTLY: the runtime path is
-- ensureSelfHealTables() (Replit skips db:migrate) which sends DDL over the
-- extended query protocol, and CONCURRENTLY cannot run inside the implicit
-- transaction that creates. CREATE INDEX takes a SHARE lock: it blocks WRITES to
-- carrier_directory (only the weekly FMCSA ingest writes here) but never READS,
-- and each build measured ~1s at 330k rows.

-- Default `featured` sort: intermodal DESC, power_units DESC NULLS LAST.
CREATE INDEX IF NOT EXISTS "carrier_directory_state_featured_idx" ON "carrier_directory" ("state", "intermodal" DESC, "power_units" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "carrier_directory_port_featured_idx" ON "carrier_directory" ("nearest_port_code", "intermodal" DESC, "power_units" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "carrier_directory_featured_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST);

-- `fleet` sort AND the fleet-bucket range predicate (power_units BETWEEN a AND b),
-- which the featured indexes cannot serve as a range because `intermodal` sits
-- between the equality column and power_units.
CREATE INDEX IF NOT EXISTS "carrier_directory_state_fleet_idx" ON "carrier_directory" ("state", "power_units" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "carrier_directory_port_fleet_idx" ON "carrier_directory" ("nearest_port_code", "power_units" DESC NULLS LAST);

-- One PARTIAL index per cargo/equipment facet, keyed on the default sort prefix.
-- Each only indexes the rows where the flag is true (a few hundred KB), and
-- serves an index-only count(*) for the facet badge, a BitmapAnd/BitmapOr leg
-- when combined with other facets, and an ordered scan for a cargo-only page.
-- `dry_van` is EXCLUDED on purpose: true for 78.6% of prod rows, so the planner
-- would never choose it over a sequential scan.
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_intermodal_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "intermodal";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_hazmat_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "hazmat";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_reefer_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "reefer";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_tanker_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "tanker";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_flatbed_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "flatbed";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_dry_bulk_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "dry_bulk";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_household_goods_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "household_goods";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_beverages_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "beverages";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_produce_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "produce";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_motor_vehicles_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "motor_vehicles";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_livestock_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "livestock";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_grain_feed_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "grain_feed";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_oilfield_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "oilfield";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_meat_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "meat";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_paper_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "paper";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_construction_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "construction";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_farm_supplies_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "farm_supplies";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_coal_coke_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "coal_coke";
CREATE INDEX IF NOT EXISTS "carrier_directory_flag_building_materials_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "building_materials";
