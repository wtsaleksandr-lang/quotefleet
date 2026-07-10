-- Per-tenant calculator access control (PUBLIC vs PRIVATE invite-only).
--
-- Adds:
--   tenants.access_mode  — 'public' (default; original behavior — anyone
--                          with the link can get a quote) or 'private'
--                          (invite-only via access_links + signed cookie).
--   access_links         — one named, revocable invite link per customer.
--
-- Backward-compatible: access_mode defaults to 'public', so every existing
-- tenant is unchanged. Idempotent so it's safe to re-run alongside
-- `drizzle-kit push`.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "access_mode" text DEFAULT 'public' NOT NULL;

CREATE TABLE IF NOT EXISTS "access_links" (
  "id"           serial PRIMARY KEY,
  "tenant_id"    integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "token"        text NOT NULL,
  "label"        text NOT NULL,
  "active"       boolean NOT NULL DEFAULT true,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "last_used_at" timestamp,
  "use_count"    integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "access_links_token_idx"
  ON "access_links" ("token");

CREATE INDEX IF NOT EXISTS "access_links_tenant_idx"
  ON "access_links" ("tenant_id");
