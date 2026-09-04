/**
 * DDL for `seasonal_restrictions`, in a LEAF module on purpose.
 *
 * Two places need these exact statements — `migrate.ts`, which folds them into
 * `SELF_HEAL_TABLE_STATEMENTS` so the boot self-heal and the schema tests both
 * see them, and `server/seasonal/store.ts`, which owns the table. `store.ts`
 * already imports `migrate.ts` for `runSelfHealStatements`, so migrate cannot
 * import store back without a cycle, and copy-pasting the SQL into both is how
 * two "identical" definitions drift by a column and a phantom heal starts
 * failing at 3am.
 *
 * A leaf with no imports of its own resolves it: both sides read the SAME
 * string, and byte-identity is guaranteed by construction rather than by a
 * test that has to notice.
 *
 * WHY SELF-HEAL AT ALL, rather than a drizzle migration: Replit's deploy skips
 * `db:migrate`, and its publish tool has repeatedly proposed removing tables the
 * ORM does not know about. Every at-risk object in this codebase is re-asserted
 * on each boot instead, so a phantom removal repairs itself on the next start.
 *
 * WHY THESE SHAPES: `selfHealTarget()` recognises exactly
 * `CREATE TABLE IF NOT EXISTS "t"` and `CREATE INDEX IF NOT EXISTS "i"`, and
 * that recognition is what gives the healthy-boot case a catalog pre-check and
 * therefore NO table lock at all. `ADD COLUMN IF NOT EXISTS` takes
 * ACCESS EXCLUSIVE *before* it checks existence — "idempotent" is not "free" —
 * which is what took prod down on 2026-08-28. Anything added here must keep one
 * of the two recognised shapes.
 */
export const SEASONAL_RESTRICTIONS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "seasonal_restrictions" (
    "state" text PRIMARY KEY,
    "programme" text NOT NULL,
    "source_url" text NOT NULL,
    "source_title" text NOT NULL,
    "source_revised_on" date,
    "retrieved_on" date,
    "rows_json" jsonb,
    "row_count" integer,
    "record_count" integer,
    "verified_clear" boolean DEFAULT false NOT NULL,
    "content_hash" text,
    "fetch_status" text DEFAULT 'never' NOT NULL,
    "last_attempt_at" timestamptz,
    "last_success_at" timestamptz,
    "last_error" text,
    "updated_at" timestamptz DEFAULT now() NOT NULL
  )`,
  // The scheduler's only query is "when was each state last attempted". The
  // table is one row per state — a couple of dozen — so nothing else needs an
  // index, and adding one would cost more on write than it could ever save.
  `CREATE INDEX IF NOT EXISTS "seasonal_restrictions_attempt_idx" ON "seasonal_restrictions" ("last_attempt_at")`,
];
