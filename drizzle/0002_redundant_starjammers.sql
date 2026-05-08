ALTER TABLE "tenants" ADD COLUMN "custom_domain_verified_at" timestamp;--> statement-breakpoint
-- Backfill: any tenant that already had a customDomain claim before
-- this migration was serving traffic on it; mark as verified-from-now
-- so they retain access. New claims from here on must verify.
UPDATE "tenants"
   SET "custom_domain_verified_at" = "created_at"
 WHERE "custom_domain" IS NOT NULL
   AND "custom_domain_verified_at" IS NULL;
