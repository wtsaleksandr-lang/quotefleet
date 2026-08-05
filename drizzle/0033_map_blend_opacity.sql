-- Per-tenant MAP-BLEND OPACITY (0–100) on brand_configs.
--
-- Supersedes the binary map_blend on/off with a 0–100 intensity slider. 0 = OFF
-- (crisp rectangular map — the default); 1–100 = blend ON at that feather
-- strength. resolveWidgetTheme (src/server/widgetThemes.ts) derives the on/off
-- master (map_blend / body[data-qf-map-blend]) from opacity>0 and scales the
-- feather via the --qf-map-blend-opacity custom property. The dashboard
-- Customize panel writes it via PUT /api/tenant/brand.
--
-- NOT NULL DEFAULT 0 — Postgres fills every existing row with 0 as it adds the
-- column, so tenants are unchanged with no separate backfill. Idempotent
-- (ADD COLUMN IF NOT EXISTS) so it's safe to re-run on every deploy / boot.
ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS "map_blend_opacity" integer NOT NULL DEFAULT 0;

-- Backward-compat: tenants who had the legacy toggle ON map to a sensible
-- non-zero intensity (60) so their widget keeps blending. Only touches rows
-- still at the freshly-added default (0) whose legacy flag is 'on', so it's
-- safe + idempotent and never overrides a value a tenant later set via the
-- slider.
UPDATE "brand_configs" SET "map_blend_opacity" = 60 WHERE "map_blend" = 'on' AND "map_blend_opacity" = 0;
