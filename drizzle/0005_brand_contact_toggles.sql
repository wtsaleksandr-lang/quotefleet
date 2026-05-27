-- Carrier-controlled lead capture flags.
--
-- Lets a tenant decide what contact info the widget must collect
-- before it'll submit a lead. Defaults match the original behavior:
--   require_email = true                  (preserves existing UX)
--   require_phone = false                 (phone has always been optional)
--   show_quote_before_contact = false     (preserves contact-then-quote flow)
--
-- Idempotent so it's safe to re-run on environments where these
-- columns may already exist from an earlier hotfix or `drizzle-kit push`.
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "require_email" boolean DEFAULT true NOT NULL;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "require_phone" boolean DEFAULT false NOT NULL;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "show_quote_before_contact" boolean DEFAULT false NOT NULL;
