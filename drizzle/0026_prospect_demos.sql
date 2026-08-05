-- Prospect demos — shareable, on-brand preview pages for the AI Outreach Engine.
--
-- A prospect_demo is a LIGHTWEIGHT preview built from a freight company's domain
-- (super-admin provisioner → enrichCompany → this row). It is deliberately NOT a
-- tenant: it creates no tenant/user/brand/rate-card/lead row, so it never appears
-- in tenant lists, MRR, trials, reminders, or quota. It only carries the brand +
-- a small sample-rate calculator config, keyed by an unguessable `token` used in
-- the public /demo/:token URL.
--
--   token       — unguessable slug for the public URL (UNIQUE).
--   domain      — normalized apex/host; UNIQUE so re-provisioning updates in place
--                 (dedupe by domain) rather than minting duplicate demos.
--   profile_json — the full CompanyProfile from enrichment (admin + regeneration).
--   brand_json  — { primary, secondary, logoUrl, companyName } applied to the theme.
--   config_json — widget config: modes + fields + SAMPLE rates the demo prices against.
--   viewed_at   — first time the public demo page loaded; null until then.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS) so it is safe to re-run on every
-- boot via runMigrations() (src/db/migrate.ts) — the Replit deploy does not run
-- db:migrate, so this makes the republish self-healing (same pattern as 0023/0024/0025).
CREATE TABLE IF NOT EXISTS "prospect_demos" (
  "id" serial PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "domain" text NOT NULL,
  "company_name" text,
  "profile_json" jsonb,
  "brand_json" jsonb,
  "config_json" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "viewed_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "prospect_demos_token_idx" ON "prospect_demos" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "prospect_demos_domain_idx" ON "prospect_demos" ("domain");
