-- Route-map PNG cache — persisted rendered quote route snapshots.
--
-- The public map proxy (GET /api/public/quote-map/:refId.png,
-- src/server/routes/quoteMap.ts) fetches a Google Static Maps PNG server-side
-- (so the API key never reaches the browser) and stores the bytes here as
-- base64. On a cache hit it serves the stored bytes, so redeploys and any
-- multi-instance fan-out never re-bill the Directions / Static Maps APIs for
-- the same lane. The lane geometry is not tenant-specific, so the cache is
-- shared across all tenants.
--
-- cache_key = `${laneCacheKey}|${theme}` where laneCacheKey is the rounded
-- origin+destination coords (see src/server/routeMap.ts) and theme is
-- light|dark — so the two day/night renders never collide.
--
-- Additive + idempotent (CREATE TABLE / INDEX IF NOT EXISTS): safe to re-run
-- on every deploy.
CREATE TABLE IF NOT EXISTS "route_map_cache" (
  "id" serial PRIMARY KEY NOT NULL,
  "cache_key" text NOT NULL,
  "png_base64" text NOT NULL,
  "kind" text DEFAULT 'route' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "route_map_cache_idx" ON "route_map_cache" ("cache_key");
