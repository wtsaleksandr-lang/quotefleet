-- 0070_indexnow_submissions.sql
--
-- IndexNow submission ledger: what we have already announced to Bing / Yandex /
-- Seznam, and the content state it was in when we announced it.
--
-- The IndexNow protocol treats resubmission of UNCHANGED URLs as abuse, and the
-- penalty is silent (the key stops being honoured with no error). There is no
-- server-side "did I already send this?" query, so this table is the local
-- memory that makes the rule enforceable. A row is written ONLY after a 2xx
-- response, so a failed submission stays a candidate for the next run.
--
-- Keyed by (kind, ref) rather than the full URL so the ~330k-row carrier
-- anti-join joins straight onto carrier_directory.public_slug through this
-- composite primary key. See src/server/directory/indexNow.ts.
--
-- Mirrored byte-for-byte in src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS —
-- Replit skips db:migrate, so that boot-time heal is what actually creates it
-- there.
CREATE TABLE IF NOT EXISTS "indexnow_submissions" (
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"change_key" text NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "indexnow_submissions_kind_ref_pk" PRIMARY KEY("kind","ref")
);
