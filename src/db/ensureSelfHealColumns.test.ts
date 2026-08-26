import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SELF_HEAL_COLUMN_STATEMENTS, SELF_HEAL_TABLE_STATEMENTS } from './migrate.js';

/**
 * The eager, journal-independent self-heal step must always re-add the 11
 * at-risk brand_configs columns that Replit's publish tool keeps phantom-
 * dropping (from drizzle/0038_header_layout.sql + 0039_lead_routing_validity.sql
 * + 0040_header_show_credentials.sql + 0045_show_tagline.sql
 * + 0047_tagline_style.sql).
 * We assert against the exact SQL the function runs — no live DB required.
 *
 * NOTE: the carrier_directory `country` column (0042) is self-healed in
 * SELF_HEAL_TABLE_STATEMENTS (ensureSelfHealTables), NOT here — that step creates
 * the table first, so its ADD COLUMN is safe even when the table was dropped;
 * running it here (before ensureSelfHealTables at boot) could hit a missing table.
 */
describe('ensureSelfHealColumns — at-risk brand_configs columns', () => {
  const sql = SELF_HEAL_COLUMN_STATEMENTS.join('\n');

  // [column, expected ADD COLUMN IF NOT EXISTS fragment incl. type/default]
  const expected: Array<[string, string]> = [
    // 0038 — NOT NULL with defaults; types/defaults match src/db/schema.ts.
    ['header_logo_size', `ADD COLUMN IF NOT EXISTS "header_logo_size" text DEFAULT 'm' NOT NULL`],
    ['header_layout', `ADD COLUMN IF NOT EXISTS "header_layout" text DEFAULT 'beside' NOT NULL`],
    ['header_show_name', `ADD COLUMN IF NOT EXISTS "header_show_name" boolean DEFAULT true NOT NULL`],
    ['header_align', `ADD COLUMN IF NOT EXISTS "header_align" text DEFAULT 'left' NOT NULL`],
    // 0039 — nullable.
    ['quote_validity_days', `ADD COLUMN IF NOT EXISTS "quote_validity_days" integer`],
    ['lead_email_to', `ADD COLUMN IF NOT EXISTS "lead_email_to" text`],
    ['lead_email_cc', `ADD COLUMN IF NOT EXISTS "lead_email_cc" text`],
    // 0040 — NOT NULL with default; type/default match src/db/schema.ts.
    ['header_show_credentials', `ADD COLUMN IF NOT EXISTS "header_show_credentials" boolean DEFAULT true NOT NULL`],
    // 0045 — NOT NULL with default; type/default match src/db/schema.ts.
    ['show_tagline', `ADD COLUMN IF NOT EXISTS "show_tagline" boolean DEFAULT true NOT NULL`],
    // 0047 — NOT NULL with defaults; types/defaults match src/db/schema.ts.
    ['tagline_size', `ADD COLUMN IF NOT EXISTS "tagline_size" text DEFAULT 'm' NOT NULL`],
    ['tagline_style', `ADD COLUMN IF NOT EXISTS "tagline_style" text DEFAULT 'solid' NOT NULL`],
  ];

  it('covers all 11 columns with matching types/defaults', () => {
    expect(SELF_HEAL_COLUMN_STATEMENTS).toHaveLength(expected.length);
    for (const [, fragment] of expected) {
      expect(sql).toContain(fragment);
    }
  });

  it.each(expected)('re-adds %s idempotently on brand_configs', (_col, fragment) => {
    expect(sql).toContain('ALTER TABLE "brand_configs"');
    expect(sql).toContain(fragment);
  });

  it('every statement is an idempotent ADD COLUMN IF NOT EXISTS on brand_configs', () => {
    for (const stmt of SELF_HEAL_COLUMN_STATEMENTS) {
      expect(stmt).toMatch(/^ALTER TABLE "brand_configs" ADD COLUMN IF NOT EXISTS /);
    }
  });
});

describe('ensureSelfHealTables — carrier_directory country heal (0042)', () => {
  const sql = SELF_HEAL_TABLE_STATEMENTS.join('\n');

  it('CREATE TABLE seeds the country column NOT NULL DEFAULT US', () => {
    expect(sql).toContain(`"country" text DEFAULT 'US' NOT NULL`);
  });

  it('adds an idempotent ADD COLUMN IF NOT EXISTS country for the drop-column case', () => {
    expect(SELF_HEAL_TABLE_STATEMENTS).toContain(
      `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "country" text NOT NULL DEFAULT 'US'`,
    );
  });

  it('the country ADD COLUMN comes AFTER the CREATE TABLE (table-first-safe)', () => {
    const createIdx = SELF_HEAL_TABLE_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE'));
    const alterIdx = SELF_HEAL_TABLE_STATEMENTS.findIndex((s) =>
      s.startsWith('ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "country"'),
    );
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(alterIdx).toBeGreaterThan(createIdx);
  });

  it('creates the directory_aggregate_cache singleton table (the never-created regression)', () => {
    expect(SELF_HEAL_TABLE_STATEMENTS).toContain(
      `CREATE TABLE IF NOT EXISTS "directory_aggregate_cache" (
    "id" integer PRIMARY KEY NOT NULL,
    "summary" jsonb NOT NULL,
    "base_facets" jsonb NOT NULL,
    "computed_at" timestamp DEFAULT now() NOT NULL
  )`,
    );
  });

  it('contains ONLY idempotent IF NOT EXISTS DDL — no backfill/heavy ALTER that could hold locks on the boot path', () => {
    for (const s of SELF_HEAL_TABLE_STATEMENTS) {
      // Every statement is a CREATE TABLE/INDEX or an ADD COLUMN, each IF NOT EXISTS.
      expect(s).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE)/);
      expect(s).toContain('IF NOT EXISTS');
      // No data-moving / rewriting operations may sneak onto the boot self-heal.
      expect(s).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|TRUNCATE)\b/);
    }
  });
});

/**
 * Boot-path WIRING guard — the regression was that the boot path NEVER called
 * ensureSelfHealTables, so directory_aggregate_cache was never created in prod
 * and the persisted-aggregate outage fix was silently disabled. This asserts the
 * fix stays wired, and stays wired the SAFE way: POST-LISTEN and NON-BLOCKING, so
 * a DDL lock can never delay a healthz probe (src/server/index.ts:45-48 rationale).
 */
describe('src/server/index.ts — self-heal is wired into boot, post-listen + non-blocking', () => {
  const src = readFileSync(fileURLToPath(new URL('../server/index.ts', import.meta.url)), 'utf8');

  it('imports ensureSelfHealTables from the migrate module', () => {
    expect(src).toMatch(/import\s*\{[^}]*ensureSelfHealTables[^}]*\}\s*from\s*'\.\.\/db\/migrate\.js'/);
  });

  it('invokes ensureSelfHealTables fire-and-forget (void ... .catch — never throws into boot)', () => {
    expect(src).toMatch(/void\s+ensureSelfHealTables\(\)/);
    expect(src).toContain('.catch(');
  });

  it('runs the self-heal from POST-LISTEN work, not before app.listen (healthz-safe)', () => {
    // ensureSelfHealTables must appear inside runPostListenJobs (fired after listen),
    // which lives strictly before main()/app.listen in the file.
    const healIdx = src.indexOf('ensureSelfHealTables()');
    const postListenIdx = src.indexOf('async function runPostListenJobs');
    const mainIdx = src.indexOf('async function main(');
    expect(healIdx).toBeGreaterThan(postListenIdx);
    expect(healIdx).toBeLessThan(mainIdx);
  });

  it('chains the aggregate precompute AFTER the table heal (table exists before the singleton write)', () => {
    expect(src).toMatch(/ensureSelfHealTables\(\)\s*\n?\s*\.then\(\(\)\s*=>\s*ensureFreshDirectoryAggregates\(\)\)/);
  });
});
