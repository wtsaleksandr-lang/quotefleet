-- Social login (Google / Microsoft / Meta) — provider subject IDs on users.
--
-- Ported from WeFixTrades' social-login foundation, adapted to QuoteFleet.
-- Each column stores the stable, opaque provider "sub" (subject) for a user
-- who has linked that provider. Matching a returning login on the sub (not the
-- display email) keeps repeat logins reliable even if the provider's email
-- later changes.
--
-- All three are nullable with no backfill — every existing (password-only) user
-- reads NULL for all three and is completely unaffected. A UNIQUE index per
-- column lets the callback resolve a user from the provider sub; Postgres allows
-- many NULLs under a UNIQUE index, so existing null rows never collide.
--
-- Idempotent (ADD COLUMN / CREATE INDEX IF NOT EXISTS) so it is safe to re-run
-- on every boot via runMigrations() (src/db/migrate.ts) — the Replit deploy does
-- not run db:migrate, so this makes the republish self-healing.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_sub" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "microsoft_sub" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "meta_sub" text;
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_sub_idx" ON "users" ("google_sub");
CREATE UNIQUE INDEX IF NOT EXISTS "users_microsoft_sub_idx" ON "users" ("microsoft_sub");
CREATE UNIQUE INDEX IF NOT EXISTS "users_meta_sub_idx" ON "users" ("meta_sub");
