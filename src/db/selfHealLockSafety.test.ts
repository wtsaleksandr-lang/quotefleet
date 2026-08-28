/**
 * SELF-HEAL DDL LOCK SAFETY — regression cover for the 2026-08-28 outage.
 *
 * A publish took prod fully down for ~15 minutes. pg_stat_activity showed ONE
 * statement running 15+ minutes —
 *
 *   ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "country" ...
 *
 * — with 14/14 connections active and every city/facet/count query blocked
 * behind it. Cancelling that one backend restored the site instantly.
 *
 * THREE facts make this worse than it looks, and each has a test below:
 *   1. `ADD COLUMN IF NOT EXISTS` takes ACCESS EXCLUSIVE *before* it checks
 *      existence, so an idempotent no-op is exactly as dangerous as a real DDL.
 *   2. A DDL WAITING on ACCESS EXCLUSIVE blocks every query that arrives after
 *      it — including plain SELECTs. Waiting IS the outage.
 *   3. Nothing bounded the wait: no lock_timeout, no statement_timeout.
 *
 * The statements are idempotent and run post-listen, so SKIPPING one is free —
 * the next boot retries. That is the trade this file locks in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  selfHealTarget,
  SELF_HEAL_LOCK_TIMEOUT_MS,
  SELF_HEAL_STATEMENT_TIMEOUT_MS,
  SELF_HEAL_COLUMN_STATEMENTS,
  SELF_HEAL_TABLE_STATEMENTS,
} from './migrate.js';

// ── A postgres.js double that records every statement and can fail on cue ────
interface Recorded {
  text: string;
}

const state = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  /** statement substring → SQLSTATE to throw. */
  failWith: new Map<string, string>(),
  /** relations/columns the fake catalog reports as already present. */
  existing: new Set<string>(),
  ended: 0,
}));

vi.mock('postgres', () => {
  const makeErr = (code: string) => Object.assign(new Error(`fake ${code}`), { code });
  const client = (strings: TemplateStringsArray | string, ...vals: unknown[]) => {
    // Tagged-template form — only used by the catalog probes.
    const text = Array.isArray(strings) ? (strings as TemplateStringsArray).join('?') : String(strings);
    if (text.includes('to_regclass') && text.includes('pg_attribute')) {
      const [relation, column] = vals as [string, string];
      return Promise.resolve(state.existing.has(`${relation}.${column}`) ? [{ ok: true }] : []);
    }
    if (text.includes('to_regclass')) {
      const [relation] = vals as [string];
      return Promise.resolve([{ ok: state.existing.has(String(relation)) }]);
    }
    return Promise.resolve([]);
  };
  client.unsafe = (text: string) => {
    state.recorded.push({ text });
    for (const [needle, code] of state.failWith) {
      if (text.includes(needle)) return Promise.reject(makeErr(code));
    }
    return Promise.resolve([]);
  };
  client.end = () => {
    state.ended++;
    return Promise.resolve();
  };
  return { default: () => client };
});

vi.mock('../config.js', () => ({ loadEnv: () => ({ DATABASE_URL: 'postgresql://fake/db' }) }));

const executed = () => state.recorded.map((r) => r.text);
const ddlExecuted = () => executed().filter((t) => !t.startsWith('SET '));

beforeEach(() => {
  state.recorded.length = 0;
  state.failWith.clear();
  state.existing.clear();
  state.ended = 0;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('selfHealTarget — the catalog probe that avoids the lock entirely', () => {
  it('maps ADD COLUMN IF NOT EXISTS to a column probe', () => {
    expect(
      selfHealTarget(`ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "country" text DEFAULT 'US' NOT NULL`),
    ).toEqual({ kind: 'column', relation: 'carrier_directory', column: 'country' });
  });

  it('maps CREATE TABLE / CREATE INDEX / CREATE UNIQUE INDEX to a relation probe', () => {
    expect(selfHealTarget(`CREATE TABLE IF NOT EXISTS "sitemap_cache" ("key" text PRIMARY KEY)`)).toEqual({
      kind: 'relation',
      relation: 'sitemap_cache',
    });
    expect(selfHealTarget(`CREATE INDEX IF NOT EXISTS "cd_state_idx" ON "carrier_directory" ("state")`)).toEqual({
      kind: 'relation',
      relation: 'cd_state_idx',
    });
    expect(selfHealTarget(`CREATE UNIQUE INDEX IF NOT EXISTS "cd_usdot_idx" ON "carrier_directory" ("usdot")`)).toEqual({
      kind: 'relation',
      relation: 'cd_usdot_idx',
    });
  });

  it('returns null for an unrecognized shape rather than guessing', () => {
    expect(selfHealTarget('UPDATE carrier_directory SET country = 1')).toBeNull();
  });

  it('EVERY shipped self-heal statement is coverable by a catalog probe', () => {
    // If someone adds a fourth statement shape, it silently loses the
    // no-lock fast path — and that is exactly how this outage becomes possible
    // again. Fail here instead.
    const uncovered = [...SELF_HEAL_COLUMN_STATEMENTS, ...SELF_HEAL_TABLE_STATEMENTS].filter(
      (s) => selfHealTarget(s) === null,
    );
    expect(uncovered).toEqual([]);
  });
});

describe('runSelfHealStatements — bounded, skippable, non-fatal', () => {
  const load = async () => (await import('./migrate.js')).runSelfHealStatements;

  it('sets BOTH timeouts on the session before any DDL runs', async () => {
    await (await load())('t', [`CREATE TABLE IF NOT EXISTS "a" ()`]);
    const first = executed()[0];
    const second = executed()[1];
    expect(first).toBe(`SET lock_timeout = ${SELF_HEAL_LOCK_TIMEOUT_MS}`);
    expect(second).toBe(`SET statement_timeout = ${SELF_HEAL_STATEMENT_TIMEOUT_MS}`);
    // The lock wait must stay SHORT — the whole point is to give up fast.
    expect(SELF_HEAL_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(SELF_HEAL_STATEMENT_TIMEOUT_MS).toBeGreaterThan(SELF_HEAL_LOCK_TIMEOUT_MS);
  });

  it('does NOT issue the DDL at all when the catalog says it is already there', async () => {
    // THE OUTAGE FIX. `ADD COLUMN IF NOT EXISTS` grabs ACCESS EXCLUSIVE before it
    // checks existence, so on a healthy DB the no-op still had to take the lock.
    state.existing.add('carrier_directory.country');
    await (await load())('t', [
      `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "country" text DEFAULT 'US' NOT NULL`,
    ]);
    expect(ddlExecuted()).toEqual([]);
  });

  it('issues the DDL when the object is genuinely missing', async () => {
    const stmt = `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "country" text`;
    await (await load())('t', [stmt]);
    expect(ddlExecuted()).toEqual([stmt]);
  });

  it('a LOCK TIMEOUT (55P03) is skipped, not thrown, and the run continues', async () => {
    const blocked = `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "country" text`;
    const after = `CREATE TABLE IF NOT EXISTS "sitemap_cache" ()`;
    state.failWith.set('ADD COLUMN IF NOT EXISTS "country"', '55P03');
    await expect((await load())('t', [blocked, after])).resolves.toBeUndefined();
    // The statement AFTER the blocked one still ran — one busy table must not
    // abandon the rest of the heal.
    expect(ddlExecuted()).toContain(after);
  });

  it('a STATEMENT TIMEOUT (57014) is skipped the same way', async () => {
    state.failWith.set('CREATE INDEX', '57014');
    await expect(
      (await load())('t', [`CREATE INDEX IF NOT EXISTS "cd_x_idx" ON "carrier_directory" ("state")`]),
    ).resolves.toBeUndefined();
  });

  it('a REAL DDL error still throws — a code defect must not be swallowed', async () => {
    state.failWith.set('CREATE TABLE', '42601'); // syntax_error
    await expect((await load())('t', [`CREATE TABLE IF NOT EXISTS "oops" ()`])).rejects.toThrow();
  });

  it('always closes its one-shot connection, including on a fatal error', async () => {
    await (await load())('t', [`CREATE TABLE IF NOT EXISTS "a" ()`]);
    expect(state.ended).toBe(1);
    state.failWith.set('CREATE TABLE', '42601');
    await expect((await load())('t', [`CREATE TABLE IF NOT EXISTS "b" ()`])).rejects.toThrow();
    expect(state.ended).toBe(2);
  });
});

describe('boot wiring — a skipped or failed heal can never take the process down', () => {
  it('both heals stay fire-and-forget with a catch, post-listen', async () => {
    const src = await (await import('node:fs/promises')).readFile(
      (await import('node:path')).resolve(process.cwd(), 'src/server/index.ts'),
      'utf8',
    );
    expect(src).toMatch(/void\s+ensureSelfHealTables\(\)/);
    expect(src).toMatch(/void\s+ensureSelfHealColumns\(\)\.catch\(/);
  });

  it('both heals route through the shared guard, so neither can drift', async () => {
    const src = await (await import('node:fs/promises')).readFile(
      (await import('node:path')).resolve(process.cwd(), 'src/db/migrate.ts'),
      'utf8',
    );
    const columns = src.slice(src.indexOf('export async function ensureSelfHealColumns'));
    const tables = src.slice(src.indexOf('export async function ensureSelfHealTables'));
    expect(columns.slice(0, 300)).toContain('runSelfHealStatements(');
    expect(tables.slice(0, 900)).toContain('runSelfHealStatements(');
    // No self-heal path may open its own unguarded connection any more.
    expect(columns.slice(0, 300)).not.toContain('postgres(');
    expect(tables.slice(0, 900)).not.toContain('postgres(');
  });
});
