import { describe, expect, it } from 'vitest';
import { SELF_HEAL_COLUMN_STATEMENTS, SELF_HEAL_TABLE_STATEMENTS } from './migrate.js';

/**
 * The eager, journal-independent self-heal step must always re-add the 8
 * at-risk brand_configs columns that Replit's publish tool keeps phantom-
 * dropping (from drizzle/0038_header_layout.sql + 0039_lead_routing_validity.sql
 * + 0040_header_show_credentials.sql).
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
  ];

  it('covers all 8 columns with matching types/defaults', () => {
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
});
