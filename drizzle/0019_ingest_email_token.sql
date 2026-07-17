-- Per-tenant inbound rate-email secret token (forward-email auto-import).
--
-- Each tenant that turns the "Auto-import rates from email" feature ON gets a
-- dedicated, unguessable inbound address `rates-<token>@<INBOUND_EMAIL_DOMAIN>`.
-- The token is stored here — DISTINCT from embed_token, which is public (it
-- ships in the widget <script> src) and so must never double as this secret.
--
-- Nullable, no default, no backfill — existing tenants read null and simply
-- have no inbound address until they enable the feature (the token is minted
-- lazily on first enable). A UNIQUE index lets us resolve a tenant from the
-- inbound `to` address token; Postgres allows many NULLs under a UNIQUE index,
-- so existing null rows never collide. Idempotent so it's safe to re-run.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "ingest_email_token" text;
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_ingest_email_token_idx" ON "tenants" ("ingest_email_token");
