-- saved_lists / saved_list_items — Directory Pro "saved lists" (PR D).
--
-- A logged-in SHIPPER (a `users` row with tenant_id = null, role = 'shipper')
-- groups carriers into named lists and revisits them. Directory Pro feature —
-- the entitlement is enforced at the route layer (hasDirectoryPro); the tables
-- reference `users` only, never `tenants`, so saved lists stay out of tenant
-- MRR/plan by construction (same posture as directory_subscriptions).
--
--   saved_lists       — one row per (user, list name). Indexed by user_id.
--   saved_list_items  — carriers saved into a list, keyed by carrier USDOT (the
--                       carrier_directory identity). UNIQUE(list_id, carrier_dot)
--                       makes an add idempotent; indexed by list_id.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate. Also mirrored byte-for-byte in
-- src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS so a Replit phantom-drop is
-- re-created before the server serves.
CREATE TABLE IF NOT EXISTS "saved_lists" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "saved_lists_user_idx" ON "saved_lists" ("user_id");

CREATE TABLE IF NOT EXISTS "saved_list_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "list_id" integer NOT NULL,
  "carrier_dot" text NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "saved_list_items_list_dot_idx" ON "saved_list_items" ("list_id","carrier_dot");
CREATE INDEX IF NOT EXISTS "saved_list_items_list_idx" ON "saved_list_items" ("list_id");
