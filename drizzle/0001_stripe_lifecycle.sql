ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "subscription_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "lifecycle_emails_json" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_stripe_customer_id_unique" UNIQUE("stripe_customer_id");