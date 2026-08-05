-- Per-prospect branded QUOTE SCREENSHOT on prospect_demos.
--
-- The AI Outreach email embeds a clickable screenshot of the prospect's OWN
-- branded calculator with a real quote already in it (the biggest click driver).
-- The screenshot is captured by the (Playwright-capable) orchestrator at
-- provision time and stored here as base64 PNG, so the Replit app — which has no
-- headless browser — can serve it at /demo-shot/:token.png and the drafter can
-- embed that absolute URL. Both columns are nullable: a demo with no shot yet
-- simply falls back to the email's text preview card.
--
--   quote_shot_b64 — base64-encoded PNG of the branded quote (null until captured).
--   quote_shot_at  — when the shot was last captured.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS, nullable, no backfill) so it's
-- safe to re-run on every deploy via runMigrations() (src/db/migrate.ts) — the
-- Replit deploy does not run db:migrate, so this makes the republish self-healing.
ALTER TABLE "prospect_demos" ADD COLUMN IF NOT EXISTS "quote_shot_b64" text;
ALTER TABLE "prospect_demos" ADD COLUMN IF NOT EXISTS "quote_shot_at" timestamp;
