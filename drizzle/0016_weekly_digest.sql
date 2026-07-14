-- Weekly performance digest — per-tenant last-sent timestamp.
--
-- Drives the double-send guard for the weekly digest cron
-- (src/email/weeklyDigestCron.ts): a tenant sent within the last 6 days is
-- skipped, so ticks/restarts around the Monday send window never double-send.
--
-- Nullable, no default, no backfill: existing tenants read null (never sent)
-- and become eligible on the next Monday tick. Idempotent
-- (ADD COLUMN IF NOT EXISTS) so it's safe to re-run on deploy.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "last_weekly_digest_at" timestamp;
