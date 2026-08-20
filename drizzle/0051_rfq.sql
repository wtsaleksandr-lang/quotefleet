-- Multi-carrier RFQ (rate request) — the flow that beats LoadMatch: a shipper
-- filters carriers in the directory, then sends ONE rate request to all of them
-- and collects quotes back in one place.
--
-- THREE tables, all PLATFORM-LEVEL (no tenantId — like carrier_directory, the RFQ
-- lives on the public directory surface, not inside a tenant workspace):
--   rfq_requests    — one shipper rate-request (the lane + shipper contact + the
--                     directory filter snapshot that generated the recipient set).
--   rfq_recipients  — one row per carrier the request fans out to (its per-carrier
--                     send + opt-out + quote status, each with an unguessable
--                     quote_token that links the carrier's private quote page).
--   rfq_quotes      — one submitted quote (price / transit / validity / notes),
--                     linked back to its request + recipient.
--
-- Idempotent (CREATE TABLE / CREATE INDEX IF NOT EXISTS, no backfill) so it is
-- safe to re-run on every boot via runMigrations() AND mirrored into the journal-
-- independent self-heal step (SELF_HEAL_TABLE_STATEMENTS in src/db/migrate.ts) —
-- the Replit deploy does not run db:migrate, so this makes the republish self-
-- healing (same pattern as 0041_carrier_directory.sql).
CREATE TABLE IF NOT EXISTS "rfq_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "view_token" text NOT NULL,
  "shipper_name" text NOT NULL,
  "shipper_company" text,
  "shipper_email" text NOT NULL,
  "shipper_phone" text,
  "origin" text NOT NULL,
  "destination" text NOT NULL,
  "equipment" text,
  "container_type" text,
  "commodity" text,
  "weight" text,
  "ready_date" text,
  "target_rate" text,
  "notes" text,
  "filter_snapshot" jsonb,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "rfq_recipients" (
  "id" serial PRIMARY KEY NOT NULL,
  "rfq_id" integer NOT NULL,
  "carrier_dot" text NOT NULL,
  "carrier_name" text NOT NULL,
  "carrier_email" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "quote_token" text NOT NULL,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "rfq_quotes" (
  "id" serial PRIMARY KEY NOT NULL,
  "rfq_id" integer NOT NULL,
  "recipient_id" integer NOT NULL,
  "carrier_dot" text NOT NULL,
  "price" text,
  "transit_days" integer,
  "notes" text,
  "valid_until" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "rfq_requests_view_token_idx" ON "rfq_requests" ("view_token");
CREATE UNIQUE INDEX IF NOT EXISTS "rfq_recipients_quote_token_idx" ON "rfq_recipients" ("quote_token");
CREATE INDEX IF NOT EXISTS "rfq_recipients_rfq_idx" ON "rfq_recipients" ("rfq_id");
CREATE INDEX IF NOT EXISTS "rfq_quotes_rfq_idx" ON "rfq_quotes" ("rfq_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rfq_quotes_recipient_idx" ON "rfq_quotes" ("recipient_id");
