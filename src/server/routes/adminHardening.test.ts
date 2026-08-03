/**
 * Super-admin tenant PATCH hardening — audit findings H1 / H3 / H2.
 *
 *   H1  plan/status are enum-validated; a typo can't silently collapse a
 *       paying tenant to free or 404 its public quote pages. Unknown enum
 *       value → 400 (parse fail); a valid value passes.
 *   H3  a PATCH to a slug that matches 0 rows returns 404 — not {ok:true}.
 *   H2  a successful PATCH writes a before→after audit row scoped to the
 *       TARGET tenant (actorKind 'super_admin', acting operator's user id).
 *
 * Tests drive `patchTenantAdmin` directly (the extracted route core, same
 * pattern as quoteDoc.ts) against a mocked db.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    tenantRows: [] as Record<string, unknown>[],
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  };
  return { state };
});

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  function rowsFor(table: unknown): Record<string, unknown>[] {
    return getTableName(table as never) === 'tenants' ? h.state.tenantRows : [];
  }
  function makeSelect() {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) { table = t; return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return Promise.resolve(rowsFor(table)); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(rowsFor(table)).then(res, rej);
      },
    };
    return chain;
  }
  function makeUpdate() {
    let patch: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      set(v: Record<string, unknown>) { patch = v; return chain; },
      where() { return chain; },
      // .returning() reflects the patch onto whatever tenant rows matched —
      // an empty tenantRows set means 0 affected rows (the H3 race path).
      returning() {
        return Promise.resolve(h.state.tenantRows.map((r) => ({ ...r, ...patch })));
      },
    };
    return chain;
  }
  return {
    db: () => ({
      select: () => makeSelect(),
      update: () => makeUpdate(),
      insert: (t: unknown) => ({
        values: (v: Record<string, unknown>) => {
          h.state.inserts.push({ table: getTableName(t as never), values: v });
          return Promise.resolve();
        },
      }),
    }),
  };
});

const baseTenant = () => ({
  id: 7,
  slug: 'acme-freight',
  name: 'Acme Freight',
  plan: 'pro',
  status: 'active',
  contactEmail: 'ops@acme.com',
});

beforeEach(() => {
  h.state.tenantRows = [baseTenant()];
  h.state.inserts = [];
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
});

const auditRows = () => h.state.inserts.filter((i) => i.table === 'audit_log');

// ── H1 — enum validation ─────────────────────────────────────────────
describe('H1 — PATCH enum-validates plan/status', () => {
  it('rejects an invalid plan (400, parse fail) and writes NOTHING', async () => {
    const { patchTenantAdmin } = await import('./admin.js');
    const r = await patchTenantAdmin({ slug: 'acme-freight', body: { plan: 'gold' }, actorUserId: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid input');
    expect(auditRows()).toHaveLength(0);
  });

  it('rejects an invalid status (400) and writes NOTHING', async () => {
    const { patchTenantAdmin } = await import('./admin.js');
    const r = await patchTenantAdmin({ slug: 'acme-freight', body: { status: 'deleted' }, actorUserId: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid input');
    expect(auditRows()).toHaveLength(0);
  });

  it('accepts a valid plan (200)', async () => {
    const { patchTenantAdmin } = await import('./admin.js');
    const r = await patchTenantAdmin({ slug: 'acme-freight', body: { plan: 'vital' }, actorUserId: 1 });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it('accepts a valid status (200)', async () => {
    const { patchTenantAdmin } = await import('./admin.js');
    const r = await patchTenantAdmin({ slug: 'acme-freight', body: { status: 'suspended' }, actorUserId: 1 });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });
});

// ── H3 — 404 on a slug that matches no tenant ────────────────────────
describe('H3 — PATCH to a non-existent slug returns 404', () => {
  it('404s (not {ok:true}) and writes no audit', async () => {
    h.state.tenantRows = []; // no tenant with this slug
    const { patchTenantAdmin } = await import('./admin.js');
    const r = await patchTenantAdmin({ slug: 'ghost', body: { plan: 'vital' }, actorUserId: 1 });
    expect(r.status).toBe(404);
    expect(r.json.ok).toBeUndefined();
    expect(String(r.json.error)).toContain("ghost");
    expect(auditRows()).toHaveLength(0);
  });
});

// ── H2 — audit trail on a successful mutation ────────────────────────
describe('H2 — successful PATCH writes a before→after audit row', () => {
  it('records the target tenant, changed fields, before/after, and actor', async () => {
    const { patchTenantAdmin } = await import('./admin.js');
    const r = await patchTenantAdmin({
      slug: 'acme-freight',
      body: { plan: 'vital', status: 'suspended' },
      actorUserId: 42,
    });
    expect(r.status).toBe(200);

    const audits = auditRows();
    expect(audits).toHaveLength(1);
    const row = audits[0].values;
    expect(row.action).toBe('admin.tenant.update');
    expect(row.actorKind).toBe('super_admin');
    expect(row.userId).toBe(42);
    // Scoped to the TARGET tenant so it surfaces in that tenant's audit log.
    expect(row.tenantId).toBe(7);

    const details = row.detailsJson as Record<string, unknown>;
    expect(details.slug).toBe('acme-freight');
    const changed = details.changed as Record<string, { before: unknown; after: unknown }>;
    expect(changed.plan).toEqual({ before: 'pro', after: 'vital' });
    expect(changed.status).toEqual({ before: 'active', after: 'suspended' });
    // Only the fields the caller sent are audited.
    expect(Object.keys(changed).sort()).toEqual(['plan', 'status']);
  });
});
