-- Outreach emails — persisted AI-drafted cold emails (Phase 2 of the AI Outreach Engine).
--
-- Each row is a reviewed-before-send draft produced by draftOutreachEmail():
-- the personalized subject + HTML/plaintext body, the prospect's demo token, and
-- the per-recipient unsubscribe token that powers CASL/CAN-SPAM one-click opt-out.
-- Phase 3 will send the exact draft a human approved. Like prospect_demos, this
-- table NEVER touches tenants/users/leads — it is isolated by construction.
--
--   demo_token        — the prospect_demos token this email links to (their branded demo).
--   domain            — normalized apex/host the email was drafted for.
--   recipient_email   — best-known recipient (may be null until a contact is chosen).
--   unsubscribe_token — per-recipient opt-out token (UNIQUE); /outreach/unsubscribe/:token.
--   ai_generated      — true when the AI wrote the copy, false for the template fallback.
--   suppressed        — set true on unsubscribe click; Phase 3 must not send to it.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS) so it is safe to re-run on every
-- boot via runMigrations() (src/db/migrate.ts) — the Replit deploy does not run
-- db:migrate, so this makes the republish self-healing (same pattern as 0026).
CREATE TABLE IF NOT EXISTS "outreach_emails" (
  "id" serial PRIMARY KEY NOT NULL,
  "demo_token" text,
  "domain" text NOT NULL,
  "recipient_email" text,
  "unsubscribe_token" text NOT NULL,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "body_text" text NOT NULL,
  "ai_generated" boolean DEFAULT false NOT NULL,
  "suppressed" boolean DEFAULT false NOT NULL,
  "suppressed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_emails_unsub_token_idx" ON "outreach_emails" ("unsubscribe_token");
CREATE INDEX IF NOT EXISTS "outreach_emails_domain_idx" ON "outreach_emails" ("domain");
