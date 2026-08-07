-- Hosted trust-wrap (Phase 1) — a lean, conversion-focused landing shell that
-- surrounds the calculator on a tenant's HOSTED page (/w/:slug). The embedded
-- JS-snippet widget and the /w/demo showcase keep serving the bare calculator.
--
-- Five nullable / safe-defaulted brand_configs columns feed the wrap:
--   hosted_headline / hosted_subhead   — marketing copy above/beside the calc
--   hosted_trust_badges                — surface USDOT/MC/insurance credibility
--   hosted_testimonials_json           — 2–4 short reviews
--   hosted_ctas_json                   — 2–3 call/email/url buttons
--   hosted_background_json             — page theme + colour preset + hero image
--
-- ADD COLUMN IF NOT EXISTS with nullable / safe defaults so it is idempotent and
-- safe to re-run on every boot via runMigrations() (src/db/migrate.ts) — the
-- Replit deploy does not run db:migrate, so this makes the republish
-- self-healing (same pattern as 0026/0029/0030/0031/0032/0034). Existing rows
-- get NULL copy / NULL JSON / trust-badges OFF, which renders the current bare
-- calculator with only its theme background, so no tenant changes visually.
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "hosted_headline" text;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "hosted_subhead" text;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "hosted_trust_badges" boolean DEFAULT false NOT NULL;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "hosted_testimonials_json" jsonb;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "hosted_ctas_json" jsonb;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "hosted_background_json" jsonb;
