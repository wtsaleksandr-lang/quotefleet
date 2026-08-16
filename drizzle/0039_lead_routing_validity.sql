-- Lead routing + quote validity — two carrier-facing customization controls.
--
--   quote_validity_days  how long each quote's "Valid until" date lasts (null =
--                        the app default QUOTE_VALIDITY_DAYS).
--   lead_email_to        where quote-request notifications are emailed (null =
--                        the account contact email — today's behavior).
--   lead_email_cc        comma-separated extra CC addresses (dispatch/sales/team).
--
-- All three are NULLABLE, so existing rows keep exactly today's behavior until a
-- carrier sets them. ADD COLUMN IF NOT EXISTS so this is idempotent + self-heals
-- on every boot via runMigrations() (src/db/migrate.ts) — the Replit deploy does
-- not run db:migrate (same pattern as 0032 / 0038).
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "quote_validity_days" integer;--> statement-breakpoint
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "lead_email_to" text;--> statement-breakpoint
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "lead_email_cc" text;
