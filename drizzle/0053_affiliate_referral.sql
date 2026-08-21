-- Affiliate + Referral program (Phase 1).
-- Adds the shareable referral code to tenants and the four program tables.
-- Mirrored, journal-independently, by SELF_HEAL_TABLE_STATEMENTS in
-- src/db/migrate.ts (Replit deploy skips db:migrate + phantom-drops).

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "referral_code" text;
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_referral_code_idx" ON "tenants" ("referral_code");

CREATE TABLE IF NOT EXISTS "affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_tenant_id" integer,
	"owner_user_id" integer,
	"email" text NOT NULL,
	"name" text,
	"code" text NOT NULL,
	"tier" text DEFAULT 'base' NOT NULL,
	"commission_rate" double precision DEFAULT 0.25 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payout_method" text,
	"payout_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "affiliates_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "referral_attributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"referred_tenant_id" integer,
	"visitor_token" text NOT NULL,
	"landed_at" timestamp DEFAULT now() NOT NULL,
	"converted_at" timestamp,
	"reward_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "referral_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"source_attribution_id" integer,
	"months_granted" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "affiliate_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliate_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"period_month" text NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"rate" double precision DEFAULT 0.25 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_code_idx" ON "affiliates" ("code");
CREATE INDEX IF NOT EXISTS "affiliates_email_idx" ON "affiliates" ("email");
CREATE INDEX IF NOT EXISTS "affiliates_owner_tenant_idx" ON "affiliates" ("owner_tenant_id");
CREATE INDEX IF NOT EXISTS "referral_attributions_code_idx" ON "referral_attributions" ("code");
CREATE INDEX IF NOT EXISTS "referral_attributions_tenant_idx" ON "referral_attributions" ("referred_tenant_id");
CREATE INDEX IF NOT EXISTS "referral_attributions_visitor_idx" ON "referral_attributions" ("visitor_token");
CREATE INDEX IF NOT EXISTS "referral_credits_tenant_idx" ON "referral_credits" ("tenant_id");
CREATE INDEX IF NOT EXISTS "referral_credits_status_idx" ON "referral_credits" ("status");
CREATE INDEX IF NOT EXISTS "affiliate_commissions_affiliate_idx" ON "affiliate_commissions" ("affiliate_id");
CREATE INDEX IF NOT EXISTS "affiliate_commissions_tenant_idx" ON "affiliate_commissions" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commissions_uniq_idx" ON "affiliate_commissions" ("affiliate_id","tenant_id","period_month");
