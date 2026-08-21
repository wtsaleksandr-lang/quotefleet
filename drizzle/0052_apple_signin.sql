-- Sign in with Apple — stable Apple subject id on users.
--
-- Same shape + rationale as 0024_oauth_social_login.sql (google/microsoft/meta):
-- a nullable column holding the opaque Apple "sub", matched on the sub (not the
-- display email) so repeat logins stay reliable even if Apple's relay email
-- changes. Nullable with no backfill — every existing user reads NULL and is
-- unaffected. A UNIQUE index lets the Apple POST callback resolve a user from
-- the sub; Postgres allows many NULLs under a UNIQUE index so existing rows
-- never collide.
--
-- Idempotent (ADD COLUMN / CREATE INDEX IF NOT EXISTS) so it is safe to re-run
-- on every boot via runMigrations() (src/db/migrate.ts) — the Replit deploy does
-- not run db:migrate, so this makes the republish self-healing, exactly like the
-- google_sub / microsoft_sub / meta_sub columns.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "apple_sub" text;
CREATE UNIQUE INDEX IF NOT EXISTS "users_apple_sub_idx" ON "users" ("apple_sub");
