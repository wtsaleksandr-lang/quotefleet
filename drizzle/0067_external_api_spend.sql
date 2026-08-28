-- external_api_spend — audit ledger for PAID external provider calls.
--
-- ImportYeti / Hunter / the importer AI draft are metered, real-money APIs. ~$20
-- of credits were burned in two days, largely by dev/test/agent traffic, and the
-- only place that spend showed up was the provider's own dashboard: the app
-- logged live pulls to the console and kept an in-process counter that reset on
-- every restart.
--
-- This table is the durable audit trail. Exactly one row is written per call
-- that ACTUALLY went out over the network, from the single choke point in
-- src/server/directory/externalPullGuard.ts — so a live pull that is not in this
-- table cannot exist. Surfaced in admin at GET /api/admin/importers/usage.
--
-- SAFETY: read ONLY as a bounded, indexed query (ORDER BY occurred_at DESC LIMIT
-- n) plus small aggregates — never an unbounded scan (QuoteFleet had repeated
-- prod outages from those). A phantom-drop loses audit history only, never
-- product data, and src/db/migrate.ts re-creates it on every boot.

CREATE TABLE IF NOT EXISTS "external_api_spend" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"context" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"credits_remaining" integer,
	"est_usd_cents" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "external_api_spend_at_idx" ON "external_api_spend" ("occurred_at");
