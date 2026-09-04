/**
 * THE DDL, AND THE LOCK SAFETY THAT MAKES IT SAFE ON THE BOOT PATH.
 *
 * On 2026-08-28 a self-heal statement took production down by queueing for an
 * ACCESS EXCLUSIVE lock behind crawler reads. The fix was a catalog pre-check
 * plus `lock_timeout`/`statement_timeout`, and it only works for the three
 * statement SHAPES `selfHealTarget()` recognises. A new table added in the
 * wrong shape silently loses the no-lock fast path.
 *
 * So this file asserts the shape, asserts the table is actually in the list the
 * boot path runs, and asserts the two copies of the DDL are ONE copy.
 */
import { describe, expect, it } from 'vitest';
import { SEASONAL_RESTRICTIONS_DDL } from './seasonalRestrictionsDdl.js';
import { SELF_HEAL_TABLE_STATEMENTS, selfHealTarget } from './migrate.js';
import { SEASONAL_SELF_HEAL_STATEMENTS } from '../server/seasonal/store.js';

describe('seasonal_restrictions DDL', () => {
  it('is the SAME object the store uses — not a copy that can drift', () => {
    expect(SEASONAL_SELF_HEAL_STATEMENTS).toBe(SEASONAL_RESTRICTIONS_DDL);
  });

  it('is wired into the boot self-heal list', () => {
    for (const stmt of SEASONAL_RESTRICTIONS_DDL) {
      expect(SELF_HEAL_TABLE_STATEMENTS).toContain(stmt);
    }
  });

  it('every statement is coverable by a catalog probe, so a healthy boot takes NO lock', () => {
    for (const stmt of SEASONAL_RESTRICTIONS_DDL) {
      expect(selfHealTarget(stmt), stmt.slice(0, 60)).not.toBeNull();
    }
    expect(selfHealTarget(SEASONAL_RESTRICTIONS_DDL[0] as string)).toEqual({
      kind: 'relation',
      relation: 'seasonal_restrictions',
    });
    expect(selfHealTarget(SEASONAL_RESTRICTIONS_DDL[1] as string)).toEqual({
      kind: 'relation',
      relation: 'seasonal_restrictions_attempt_idx',
    });
  });

  it('is idempotent and moves no data — nothing heavy may run on the boot path', () => {
    for (const stmt of SEASONAL_RESTRICTIONS_DDL) {
      expect(stmt).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS)/);
      expect(stmt).toContain('IF NOT EXISTS');
      expect(stmt).not.toMatch(/\b(UPDATE|DELETE|INSERT|TRUNCATE|CONCURRENTLY)\b/);
    }
  });

  it('carries the columns the honesty contract needs, and keeps them apart', () => {
    const sql = SEASONAL_RESTRICTIONS_DDL.join('\n');
    // The date the DOCUMENT carries and the date WE read it are two different
    // facts — conflating them is the bug provenance.ts exists to prevent.
    expect(sql).toContain('"source_revised_on" date');
    expect(sql).toContain('"retrieved_on" date');
    // "we read it and it says clear" vs "we could not tell" — see verifiedClear.
    expect(sql).toContain('"verified_clear" boolean');
    // The no-change check, and the failure bookkeeping that must never touch data.
    expect(sql).toContain('"content_hash" text');
    expect(sql).toContain('"last_attempt_at" timestamptz');
    expect(sql).toContain('"last_success_at" timestamptz');
    expect(sql).toContain('"last_error" text');
  });
});
