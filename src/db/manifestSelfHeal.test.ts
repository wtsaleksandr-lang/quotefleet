/**
 * The eager, journal-independent self-heal step must (re)create the 4 Manifest
 * Privacy tables + their indexes on every boot (Replit skips db:migrate and can
 * phantom-drop tables). We assert against the exact SQL the function runs — no
 * live DB required — and that they stay byte-compatible with src/db/schema.ts.
 */
import { describe, expect, it } from 'vitest';
import { SELF_HEAL_TABLE_STATEMENTS } from './migrate.js';

describe('ensureSelfHealTables — Manifest Privacy tables', () => {
  const sql = SELF_HEAL_TABLE_STATEMENTS.join('\n');

  const tables = [
    'manifest_subscriptions',
    'poa_applications',
    'poa_audit_events',
    'manifest_redactions',
  ];
  for (const t of tables) {
    it(`creates ${t} idempotently`, () => {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${t}"`);
    });
  }

  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "manifest_subscriptions_user_idx" ON "manifest_subscriptions" ("user_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "manifest_subscriptions_customer_idx" ON "manifest_subscriptions" ("stripe_customer_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "poa_applications_token_idx" ON "poa_applications" ("public_token")`,
    `CREATE INDEX IF NOT EXISTS "poa_applications_status_idx" ON "poa_applications" ("status")`,
    `CREATE INDEX IF NOT EXISTS "poa_applications_expires_idx" ON "poa_applications" ("expires_at")`,
    `CREATE INDEX IF NOT EXISTS "poa_audit_events_application_idx" ON "poa_audit_events" ("application_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "manifest_redactions_name_key_idx" ON "manifest_redactions" ("name_key")`,
  ];
  for (const idx of indexes) {
    it(`creates index: ${idx.slice(0, 60)}…`, () => {
      expect(sql).toContain(idx);
    });
  }

  it('key POA columns are present (ESIGN record shape)', () => {
    for (const col of ['"public_token"', '"doc_sha256"', '"signed_at"', '"name_variations"', '"expires_at"', '"last_reminder_at"']) {
      expect(sql).toContain(col);
    }
  });

  it('every statement is idempotent (IF NOT EXISTS)', () => {
    const manifestStmts = SELF_HEAL_TABLE_STATEMENTS.filter(
      (s) => /manifest_|poa_/.test(s),
    );
    expect(manifestStmts.length).toBeGreaterThanOrEqual(11);
    for (const s of manifestStmts) expect(s).toMatch(/IF NOT EXISTS/);
  });
});
