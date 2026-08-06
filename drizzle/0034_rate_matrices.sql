-- Native rate-matrix pricing (Tier 2) — rate_zones + rate_matrices.
--
-- rate_zones: the zip/city → zone-id legend (research pattern 3's separate tab)
-- so a shipment's origin/dest can resolve to a matrix key. rate_matrices: one
-- priced CELL per lane (patterns 1 origin×dest, 3 zone×zone, 5 drayage
-- port→zone per-container). Where Tier 1 flattened a matrix to lane_zones and
-- warned, the engine now prices the exact cell.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate, so this makes the republish self-healing (same
-- pattern as 0026/0029/0030/0031).
CREATE TABLE IF NOT EXISTS "rate_zones" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "zone_id" text NOT NULL,
  "match_kind" text NOT NULL,
  "match_value" text,
  "match_from" text,
  "match_to" text,
  "label" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "rate_zones_tenant_idx" ON "rate_zones" ("tenant_id");
CREATE INDEX IF NOT EXISTS "rate_zones_tenant_zone_idx" ON "rate_zones" ("tenant_id", "zone_id");

CREATE TABLE IF NOT EXISTS "rate_matrices" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "equipment" text,
  "origin_key" text NOT NULL,
  "dest_key" text NOT NULL,
  "rate" double precision NOT NULL,
  "unit_basis" text DEFAULT 'flat' NOT NULL,
  "min_charge" double precision,
  "currency" text,
  "effective_date" text,
  "source_ref" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "rate_matrices_tenant_idx" ON "rate_matrices" ("tenant_id");
CREATE INDEX IF NOT EXISTS "rate_matrices_lookup_idx" ON "rate_matrices" ("tenant_id", "mode", "origin_key", "dest_key");
