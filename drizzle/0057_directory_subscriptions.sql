-- directory_subscriptions — "Directory Pro" ($19/mo) per-SHIPPER entitlement.
--
-- The buyer is a SHIPPER persona: a `users` row with `tenant_id = null` and
-- `role = 'shipper'`, reusing the existing auth/session stack. This table is
-- FULLY DECOUPLED from `tenants.plan` — Directory Pro is an access subscription
-- on a user account, NOT the QuoteQuick calculator tenant's plan.
--
--   user_id             — the shipper user (UNIQUE; one entitlement per user).
--   status              — 'active' | 'trialing' | 'past_due' | 'inactive'.
--   stripe_customer_id  — Stripe Customer id; the webhook upsert join key (UNIQUE).
--   stripe_subscription_id — Stripe Subscription id (portal / reference).
--   price_id            — the $19/mo Directory Pro Stripe Price id.
--   current_period_end  — entitlement lapses after this once no longer live.
--
-- Platform-level like carrier_directory: references `users` only, never
-- `tenants`, so a Directory Pro subscription stays out of tenant MRR/plan/trial
-- by construction.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate. Also mirrored byte-for-byte in
-- src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS so a Replit phantom-drop is
-- re-created before the server serves.
CREATE TABLE IF NOT EXISTS "directory_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "status" text DEFAULT 'inactive' NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "price_id" text,
  "current_period_end" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "directory_subscriptions_user_idx" ON "directory_subscriptions" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "directory_subscriptions_customer_idx" ON "directory_subscriptions" ("stripe_customer_id");
