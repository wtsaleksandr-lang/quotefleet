-- Outreach send + sequence + tracking columns — Phase 3 of the AI Outreach Engine.
--
-- Extends `outreach_emails` (0027) so a reviewed draft can be SENT, its outcome
-- recorded, a light multi-step sequence attached, and a click optionally tracked:
--
--   sent_at          — when the email was handed to the provider (null until sent).
--   status           — 'sent' | 'failed' | 'skipped' | 'unconfigured' (null = draft).
--   provider_id      — provider message id on a successful send.
--   send_error       — human-readable failure summary (never a secret value).
--   step             — sequence step 1..3; only step 1 sends today (scaffold for a
--                      future scheduled follow-up worker).
--   next_followup_at — when a future scheduled follow-up may fire (null = none).
--   clicked_at       — first CTA/demo-link click through /outreach/click/:token.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-run on every boot via
-- runMigrations() (src/db/migrate.ts) — the Replit deploy does not run db:migrate,
-- so this keeps the republish self-healing (same pattern as 0026/0027).
ALTER TABLE "outreach_emails" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;
ALTER TABLE "outreach_emails" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "outreach_emails" ADD COLUMN IF NOT EXISTS "provider_id" text;
ALTER TABLE "outreach_emails" ADD COLUMN IF NOT EXISTS "send_error" text;
ALTER TABLE "outreach_emails" ADD COLUMN IF NOT EXISTS "step" integer DEFAULT 1 NOT NULL;
ALTER TABLE "outreach_emails" ADD COLUMN IF NOT EXISTS "next_followup_at" timestamp;
ALTER TABLE "outreach_emails" ADD COLUMN IF NOT EXISTS "clicked_at" timestamp;
