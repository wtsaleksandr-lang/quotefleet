-- FREE-FOREVER carrier-directory PROFILE CLAIMS.
--
-- A carrier proves it owns its FMCSA directory profile (src/server/directory/
-- claims.ts) and gets a "Verified owner" badge + the right to edit the public
-- card. Claiming is free forever: no trial, no card, no plan. Only the quote
-- tool is paid, and a profile owner who opts into it gets a 30-day trial
-- (plans.ts CLAIM_OWNER_TRIAL_DAYS) instead of 14.
--
-- carrier_claims — one row per claim attempt. For the email-code method we
-- store ONLY the SHA-256 hash of the 6-digit code (never the code), a 15-min
-- expiry, and a wrong-guess counter that locks the row at the cap.
--
-- carrier_directory.claimed_* — mirror of the ONE verified claim, written only
-- by the claim flow. Like `contact_hidden` these are NEVER in the ingest's
-- CARRIER_UPSERT_SET, so a re-ingest can never un-claim a profile. Nullable,
-- no default (null = unclaimed) — a catalog-only change on the 330k-row table.
--
-- tenants.is_directory_owner / signup_source — flag the tenant as a
-- free-forever profile owner (trialGating.ts reads `status:'directory'` when
-- the flag is set and trial_ends_at is NULL, so no UI ever says "trial
-- expired" to them) and record where the tenant came from.
--
-- Idempotent (IF NOT EXISTS, no backfill) so it is safe to re-run on every
-- boot; mirrored byte-for-byte in src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS
-- (the mechanism that actually creates these on Replit, which skips db:migrate)
-- and in src/db/schema.ts.
CREATE TABLE IF NOT EXISTS "carrier_claims" (
  "id" serial PRIMARY KEY NOT NULL,
  "usdot" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "method" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "otp_hash" text,
  "otp_expires_at" timestamp,
  "attempts" integer DEFAULT 0 NOT NULL,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "verified_at" timestamp,
  "rejected_reason" text
);
CREATE INDEX IF NOT EXISTS "carrier_claims_usdot_idx" ON "carrier_claims" ("usdot");
CREATE INDEX IF NOT EXISTS "carrier_claims_tenant_idx" ON "carrier_claims" ("tenant_id");
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "claimed_tenant_id" integer;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp;
ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "claim_method" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "is_directory_owner" boolean NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "signup_source" text;
