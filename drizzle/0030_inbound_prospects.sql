-- Inbound prospects — REVERSE OUTREACH harvest table (Phase 0, ships inert).
--
-- Each row is one inbound broker/carrier MARKETING email harvested from a
-- freight company's own mailbox. A later phase replies IN-THREAD with that
-- sender's OWN branded QuoteFleet demo (the reverse of cold outreach). Like
-- prospect_demos / outreach_emails, this table is DELIBERATELY ISOLATED: it
-- never references tenants / users / leads, so a harvested prospect stays out of
-- MRR, trials, quota, and every tenant list by construction.
--
--   harvest_mailbox        — which monitored mailbox this inbound came from.
--   from_email/from_domain — the broker/carrier marketer we'll reply to.
--   original_message_id    — RFC 5322 Message-ID; the in-thread reply anchor
--                            (nullable; UNIQUE when present → idempotent harvest).
--   original_references    — jsonb string[] of the References/In-Reply-To chain.
--   original_subject       — subject of the harvested email.
--   received_at            — the harvested email's Date.
--   signature_json         — parsed signature block for personalization.
--   classify_category      — classifier verdict; null until the classifier runs.
--   status                 — pipeline state (default 'harvested').
--   demo_token             — prospect_demos token minted for this sender, if any.
--   outreach_email_id      — outreach_emails.id once an in-thread reply exists.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS, no backfill) so it is safe to
-- re-run on every boot via runMigrations() (src/db/migrate.ts) — the Replit
-- deploy does not run db:migrate, so this makes the republish self-healing (same
-- pattern as 0026/0029). Nothing writes here until the poller phase lands.
CREATE TABLE IF NOT EXISTS "inbound_prospects" (
  "id" serial PRIMARY KEY NOT NULL,
  "harvest_mailbox" text NOT NULL,
  "from_email" text NOT NULL,
  "from_domain" text NOT NULL,
  "original_message_id" text,
  "original_references" jsonb,
  "original_subject" text,
  "received_at" timestamp,
  "signature_json" jsonb,
  "classify_category" text,
  "status" text DEFAULT 'harvested' NOT NULL,
  "demo_token" text,
  "outreach_email_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_prospects_message_id_idx" ON "inbound_prospects" ("original_message_id");
