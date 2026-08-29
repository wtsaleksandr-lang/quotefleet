/**
 * The /guides tables must be (re)created on every boot, and — more importantly
 * after the 2026-08-28 outage — must do it WITHOUT ever queueing for a lock.
 *
 * `selfHealTarget()` is what buys that: a statement it can parse gets a cheap
 * catalog probe first and takes no lock on a healthy database. A statement it
 * CANNOT parse silently loses the fast path and goes straight to DDL. So the
 * load-bearing assertion here is not "the tables are created" but "every
 * statement we added is still one of the three recognised shapes".
 *
 * No live DB — we assert against the exact SQL the boot step runs.
 */
import { describe, expect, it } from 'vitest';
import { SELF_HEAL_TABLE_STATEMENTS, selfHealTarget } from './migrate.js';

const seoStatements = SELF_HEAL_TABLE_STATEMENTS.filter((s) => s.includes('seo_'));
const sqlText = SELF_HEAL_TABLE_STATEMENTS.join('\n');

describe('SEO engine tables self-heal', () => {
  for (const t of ['seo_content_pages', 'seo_content_approvals', 'seo_engine_settings']) {
    it(`creates ${t} idempotently`, () => {
      expect(sqlText).toContain(`CREATE TABLE IF NOT EXISTS "${t}"`);
    });
  }

  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "seo_content_pages_slug_idx" ON "seo_content_pages" ("slug")`,
    `CREATE INDEX IF NOT EXISTS "seo_content_pages_status_surface_idx" ON "seo_content_pages" ("status", "surface")`,
    `CREATE INDEX IF NOT EXISTS "seo_content_approvals_page_idx" ON "seo_content_approvals" ("page_id", "created_at")`,
  ];
  for (const idx of indexes) {
    it(`creates index: ${idx.slice(0, 64)}…`, () => {
      expect(sqlText).toContain(idx);
    });
  }

  it('every SEO statement keeps the no-lock catalog fast path', () => {
    // #442's whole point. An unparseable statement still WORKS, but it grabs
    // ACCESS EXCLUSIVE before discovering there is nothing to do — which is how
    // a "harmless idempotent no-op" took prod down for 15 minutes.
    expect(seoStatements.length).toBeGreaterThan(0);
    for (const s of seoStatements) {
      expect(selfHealTarget(s), `no catalog probe for: ${s.slice(0, 80)}`).not.toBeNull();
    }
  });

  it('never uses CREATE INDEX CONCURRENTLY (illegal in an implicit transaction)', () => {
    for (const s of seoStatements) expect(s).not.toMatch(/CONCURRENTLY/i);
  });

  it('indexes only the two queries that exist: the review queue and the public read', () => {
    // The slug index serves /guides/:slug and the generator's dedup check; the
    // (status, surface) index serves both the review queue and the sitemap.
    // Anything else would be an index with no query behind it.
    const seoIndexes = seoStatements.filter((s) => /CREATE (UNIQUE )?INDEX/i.test(s));
    expect(seoIndexes).toHaveLength(3);
  });

  it('the drizzle .sql documentation copy stays in step with the executed DDL', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = readFileSync('drizzle/0069_seo_content_engine.sql', 'utf8');
    for (const idx of indexes) expect(doc).toContain(idx.replace(/\s+/g, ' '));
    for (const t of ['seo_content_pages', 'seo_content_approvals', 'seo_engine_settings']) {
      expect(doc).toContain(`CREATE TABLE IF NOT EXISTS "${t}"`);
    }
  });
});
