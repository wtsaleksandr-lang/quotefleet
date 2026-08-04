-- Stripe Connect (Express) — carrier payout onboarding (payments PR 1).
--
-- Adds the connected-account id + a small cache of the account's readiness
-- flags to tenants. This is the FOUNDATION of deposit-to-book: a carrier
-- connects a Stripe Express account here so that a LATER PR can collect a
-- deposit from a shipper (carrier = connected account, QuoteFleet = platform
-- taking a fee). NO charge / money movement is introduced by this migration —
-- it only records the onboarding link + status.
--
-- tenants.stripe_connect_account_id — the Express connected-account id
-- (acct_...), written the first time the owner starts onboarding via
-- POST /api/tenant/connect/onboard. UNIQUE so one Stripe account maps to one
-- tenant (mirrors stripe_customer_id). Nullable, no backfill — every existing
-- tenant reads NULL and simply shows "not connected" until they opt in.
--
-- connect_details_submitted / connect_charges_enabled / connect_payouts_enabled
-- — a cache of the account's live readiness, refreshed from Stripe on every
-- /connect/status read and by the account.updated webhook. The live Stripe
-- account stays authoritative; these let the UI render state without a
-- round-trip. All nullable (unknown until the account exists / first read).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS) so
-- it is safe to re-run on every boot via runMigrations() (src/db/migrate.ts) —
-- the Replit deploy does not run db:migrate, so this makes the republish
-- self-healing (same pattern as 0023/0024).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_connect_account_id" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "connect_details_submitted" boolean;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "connect_charges_enabled" boolean;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "connect_payouts_enabled" boolean;
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripe_connect_account_id_idx" ON "tenants" ("stripe_connect_account_id");
