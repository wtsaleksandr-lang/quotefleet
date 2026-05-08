ALTER TABLE "tenants" ALTER COLUMN "host_domain" SET DEFAULT 'quotefleet.net';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "dpa_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "dpa_version" text;--> statement-breakpoint
-- Backfill 1: any existing tenant that was created when host_domain
-- defaulted to quotefleet.app (a domain we never owned) is moved to
-- the canonical owned domain.
UPDATE "tenants" SET "host_domain" = 'quotefleet.net'
 WHERE "host_domain" = 'quotefleet.app';
--> statement-breakpoint
-- Backfill 2: existing tenants pre-date the DPA-acceptance schema.
-- They signed up under the original Terms (which already included the
-- DPA) so we mark them as legacy-accepted on their original signup
-- date. New signups now set this explicitly via the form checkbox.
UPDATE "tenants"
   SET "dpa_accepted_at" = "created_at",
       "dpa_version" = '1.0'
 WHERE "dpa_accepted_at" IS NULL;
