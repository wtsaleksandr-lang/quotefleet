-- Widget theming foundation (Wave 1).
--
-- Adds the three fields the customer quote widget is skinned from:
--   theme_preset    — curated preset id (midnight | slate | carbon | ocean
--                     | emerald | cream). Default 'midnight' reproduces the
--                     current widget look exactly, so existing tenants see
--                     zero change.
--   accent_override — optional custom accent hex (#RRGGBB). NULL = use the
--                     preset accent. When set it supersedes the preset accent.
--   font_family     — self-hosted font id (satoshi | inter | sora | system).
--                     Default 'satoshi'.
--
-- The legacy primary_color / accent_color columns are intentionally kept for
-- back-compat; the theme engine (src/server/widgetThemes.ts) drives colour now.
--
-- Idempotent so it's safe to re-run alongside `drizzle-kit push`.
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "theme_preset" text DEFAULT 'midnight' NOT NULL;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "accent_override" text;
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "font_family" text DEFAULT 'satoshi' NOT NULL;
