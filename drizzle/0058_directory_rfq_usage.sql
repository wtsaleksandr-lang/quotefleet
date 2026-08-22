-- directory_rfq_usage — per-account monthly RFQ (rate-request) send meter.
--
-- The un-gameable meter behind RFQ gating: sending a multi-carrier rate request
-- requires a logged-in shipper account (a `users` row), and each account gets a
-- monthly BLAST allowance (free tier small, Directory Pro larger). One
-- POST /directory/rfq = ONE increment regardless of carrier count.
--
--   account_key — the identified account, `user:<id>`.
--   period      — the billing month, `YYYY-MM` (UTC).
--   sends       — blasts started this period (incremented once per blast).
--
-- UNIQUE(account_key, period) so the counter is a single upsert-and-increment
-- row per account per month.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate. Also mirrored byte-for-byte in
-- src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS so a Replit phantom-drop is
-- re-created before the server serves.
CREATE TABLE IF NOT EXISTS "directory_rfq_usage" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_key" text NOT NULL,
  "period" text NOT NULL,
  "sends" integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "directory_rfq_usage_account_period_idx" ON "directory_rfq_usage" ("account_key","period");
