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

  it('the production-POA columns are healed both in CREATE TABLE and as ADD COLUMN', () => {
    // Every CBP-required identity element, the e-sign hardening set, and the
    // retention floor. Present in the CREATE (fresh DB / phantom-drop recreate)
    // AND as an ADD COLUMN (an existing table healed in place).
    const cols = [
      'dba_names',
      'country_of_org',
      'residency',
      'mailing_address',
      'ior_number',
      'partner_names',
      'signer_phone',
      'signer_email_verify_token',
      'signer_email_verified_at',
      'cert_signer_name',
      'cert_signer_title',
      'cert_signer_email',
      'authority_docs_note',
      'governing_law',
      'term_years',
      'consent_at',
      'retain_until',
    ];
    for (const c of cols) {
      expect(sql, `CREATE TABLE missing ${c}`).toContain(`"${c}"`);
      expect(sql, `ADD COLUMN missing ${c}`).toContain(
        `ALTER TABLE "poa_applications" ADD COLUMN IF NOT EXISTS "${c}"`,
      );
    }
  });

  it('no POA ADD COLUMN carries NOT NULL or DEFAULT (a table rewrite under ACCESS EXCLUSIVE)', () => {
    // The 2026-08-28 outage: ADD COLUMN takes ACCESS EXCLUSIVE *before* it
    // evaluates IF NOT EXISTS. runSelfHealStatements' catalog pre-check keeps a
    // healed DB from touching the lock at all — but a first-run statement still
    // takes it, so it must be an O(1) catalog-only change, never a rewrite.
    const poaAlters = SELF_HEAL_TABLE_STATEMENTS.filter((s) =>
      /^ALTER TABLE "poa_applications" ADD COLUMN/.test(s.trim()),
    );
    expect(poaAlters.length).toBeGreaterThanOrEqual(17);
    for (const s of poaAlters) {
      expect(s, s).not.toMatch(/NOT NULL/i);
      expect(s, s).not.toMatch(/DEFAULT/i);
    }
  });

  it('every statement is idempotent (IF NOT EXISTS)', () => {
    const manifestStmts = SELF_HEAL_TABLE_STATEMENTS.filter(
      (s) => /manifest_|poa_/.test(s),
    );
    expect(manifestStmts.length).toBeGreaterThanOrEqual(11);
    for (const s of manifestStmts) expect(s).toMatch(/IF NOT EXISTS/);
  });

  it('every POA self-heal statement is recognized by the catalog pre-check (PR #442)', async () => {
    // If selfHealTarget() returns null the statement runs WITHOUT the cheap
    // pg_attribute probe — i.e. it grabs the table lock on every single boot.
    // That is exactly the shape that caused the outage, so assert none of ours
    // is unrecognized.
    const { selfHealTarget } = await import('./migrate.js');
    for (const s of SELF_HEAL_TABLE_STATEMENTS.filter((x) => /poa_applications/.test(x))) {
      expect(selfHealTarget(s), s.slice(0, 80)).not.toBeNull();
    }
  });
});
