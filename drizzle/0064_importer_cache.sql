-- Importer Search (/importers) persistent cache.
-- ImportYeti ToS permits storing + reselling the purchased data, so caching is
-- a licensed cost guard: a repeat search inside the 14-day TTL spends ZERO
-- external credits. Both tables are read ONLY by their UNIQUE key index.
-- Mirrored byte-for-byte in src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS
-- (Replit skips db:migrate), so a phantom-drop just re-creates an empty cache.
CREATE TABLE IF NOT EXISTS "importer_bol_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_key" text NOT NULL,
	"rows" jsonb NOT NULL,
	"credits_remaining" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "importer_bol_cache_key_idx" ON "importer_bol_cache" ("search_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "importer_contact_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_key" text NOT NULL,
	"domain" text,
	"confidence" text NOT NULL,
	"contact" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "importer_contact_cache_key_idx" ON "importer_contact_cache" ("company_key");
