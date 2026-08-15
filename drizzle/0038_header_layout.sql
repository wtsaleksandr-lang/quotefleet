-- Header layout redesign — a carrier can now run a BIGGER logo AND keep the
-- company name + tagline (previously the only "big logo" mode hid the name).
--
--   header_logo_size  's' | 'm' | 'l' | 'xl'  — how tall the logo renders
--                     (always object-fit:contain, never cropped). Default 'm'.
--   header_layout     'beside' (logo next to the name, today's look) | 'stacked'
--                     (logo on its own line above name+tagline — best for wide
--                     wordmarks). Default 'beside'.
--   header_show_name  whether the company name + tagline show alongside the logo
--                     (off = logo-only). Default true.
--   header_align      'left' (default) | 'center'.
--
-- The widget applies these as #qf-header[data-logo-size]/[data-header-layout]/
-- [data-show-name]/[data-header-align] (see renderHeader in widget.js +
-- calculator-header.css). ADD COLUMN IF NOT EXISTS with NOT-NULL defaults so it
-- is idempotent + safe to re-run on every boot via runMigrations()
-- (src/db/migrate.ts) — the Replit deploy does not run db:migrate, so this makes
-- the republish self-healing (same pattern as 0032). Existing rows backfill to
-- the defaults, which reproduce today's header exactly, so no tenant changes
-- visually until they choose new options.
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_logo_size" text DEFAULT 'm' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_layout" text DEFAULT 'beside' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_show_name" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "header_align" text DEFAULT 'left' NOT NULL;--> statement-breakpoint
-- Preserve the look of tenants on the old 'full' logo mode (big logo, name
-- hidden): map them to the equivalent new controls so their header is unchanged.
UPDATE "brand_configs" SET "header_logo_size" = 'l', "header_show_name" = false WHERE "header_logo_fill" = 'full';
