-- password_reset_tokens — single-use, short-lived "forgot password" links.
--
-- Backs POST /api/auth/password/forgot (issue) + POST /api/auth/password/reset
-- (consume). SECURITY: we store ONLY the SHA-256 hash of the token (the primary
-- key), never the raw token — the raw value lives solely in the emailed link,
-- so a dump of this table cannot be replayed to reset a password. `used_at`
-- enforces single-use; `expires_at` bounds the lifetime (~45 min).
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate. Also mirrored byte-for-byte in
-- src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS so a Replit phantom-drop is
-- re-created before the server serves. References `users` only.
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id");
