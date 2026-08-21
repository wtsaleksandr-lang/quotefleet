/**
 * Super-admin "extend trial" shortcut — POST /api/admin/tenants/:slug/extend-trial.
 *
 *   - Extends from the LATER of now or the existing trial end:
 *       · ACTIVE trial  → N days added onto its remaining tail.
 *       · LAPSED / null → a fresh N-day trial starting from now.
 *   - `days` is a closed set (7/14/21/30); anything else → 400.
 *   - A slug that matches 0 rows → 404.
 *   - A successful extension writes a `admin.tenant.extendTrial` audit row
 *     scoped to the target tenant, and returns the new `trialEndsAt`.
 *   - The route is guarded by requireAuth + requireSuperAdmin → 401 with no
 *     session, 403 for a non-super-admin (verified against the middleware).
 *
 * Drives `extendTenantTrialAdmin` (the extracted route core, same pattern as
 * `patchTenantAdmin`) against a mocked db, plus the `requireSuperAdmin` guard
 * with mock req/res.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

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
      // an empty tenantRows set means 0 affected rows (the 404 race path).
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

const NOW = new Date('2026-08-21T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const baseTenant = (over?: Record<string, unknown>) => ({
  id: 7,
  slug: 'acme-freight',
  name: 'Acme Freight',
  plan: 'free',
  status: 'active',
  contactEmail: 'ops@acme.com',
  trialEndsAt: null as Date | null,
  ...over,
});

beforeEach(() => {
  h.state.tenantRows = [baseTenant()];
  h.state.inserts = [];
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
});

const auditRows = () => h.state.inserts.filter((i) => i.table === 'audit_log');

// ── Extend semantics ─────────────────────────────────────────────────
describe('extend-trial — extends from the later of now or existing end', () => {
  it('ACTIVE trial: adds N days onto the existing (future) end', async () => {
    // Trial ends 10 days from NOW → +7d must land 7 days AFTER that end.
    const activeEnd = new Date(NOW.getTime() + 10 * DAY);
    h.state.tenantRows = [baseTenant({ trialEndsAt: activeEnd })];
    const { extendTenantTrialAdmin } = await import('./admin.js');
    const r = await extendTenantTrialAdmin({ slug: 'acme-freight', body: { days: 7 }, actorUserId: 1, now: NOW });
    expect(r.status).toBe(200);
    expect(r.json.trialEndsAt).toBe(new Date(activeEnd.getTime() + 7 * DAY).toISOString());
  });

  it('LAPSED trial: restarts N days from now (not from the past end)', async () => {
    const lapsedEnd = new Date(NOW.getTime() - 20 * DAY);
    h.state.tenantRows = [baseTenant({ trialEndsAt: lapsedEnd })];
    const { extendTenantTrialAdmin } = await import('./admin.js');
    const r = await extendTenantTrialAdmin({ slug: 'acme-freight', body: { days: 14 }, actorUserId: 1, now: NOW });
    expect(r.status).toBe(200);
    expect(r.json.trialEndsAt).toBe(new Date(NOW.getTime() + 14 * DAY).toISOString());
  });

  it('NULL trial (not on trial): starts a fresh N-day trial from now', async () => {
    h.state.tenantRows = [baseTenant({ trialEndsAt: null })];
    const { extendTenantTrialAdmin } = await import('./admin.js');
    const r = await extendTenantTrialAdmin({ slug: 'acme-freight', body: { days: 30 }, actorUserId: 1, now: NOW });
    expect(r.status).toBe(200);
    expect(r.json.trialEndsAt).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
  });

  it('writes a scoped audit row with before→after and the day count', async () => {
    const activeEnd = new Date(NOW.getTime() + 5 * DAY);
    h.state.tenantRows = [baseTenant({ trialEndsAt: activeEnd })];
    const { extendTenantTrialAdmin } = await import('./admin.js');
    await extendTenantTrialAdmin({ slug: 'acme-freight', body: { days: 21 }, actorUserId: 42, now: NOW });
    const audits = auditRows();
    expect(audits).toHaveLength(1);
    const row = audits[0].values;
    expect(row.action).toBe('admin.tenant.extendTrial');
    expect(row.actorKind).toBe('super_admin');
    expect(row.userId).toBe(42);
    expect(row.tenantId).toBe(7);
    const details = row.detailsJson as Record<string, unknown>;
    expect(details.slug).toBe('acme-freight');
    expect(details.days).toBe(21);
    const te = details.trialEndsAt as { before: string; after: string };
    expect(te.before).toBe(activeEnd.toISOString());
    expect(te.after).toBe(new Date(activeEnd.getTime() + 21 * DAY).toISOString());
  });
});

// ── Validation ───────────────────────────────────────────────────────
describe('extend-trial — rejects an invalid day count', () => {
  it.each([5, 10, 0, -7, 60, 'seven'])('rejects days=%p (400) and writes NOTHING', async (bad) => {
    const { extendTenantTrialAdmin } = await import('./admin.js');
    const r = await extendTenantTrialAdmin({ slug: 'acme-freight', body: { days: bad }, actorUserId: 1, now: NOW });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid input');
    expect(auditRows()).toHaveLength(0);
  });

  it('rejects a missing days field (400)', async () => {
    const { extendTenantTrialAdmin } = await import('./admin.js');
    const r = await extendTenantTrialAdmin({ slug: 'acme-freight', body: {}, actorUserId: 1, now: NOW });
    expect(r.status).toBe(400);
    expect(auditRows()).toHaveLength(0);
  });

  it.each([7, 14, 21, 30])('accepts the valid day count %p (200)', async (good) => {
    const { extendTenantTrialAdmin } = await import('./admin.js');
    const r = await extendTenantTrialAdmin({ slug: 'acme-freight', body: { days: good }, actorUserId: 1, now: NOW });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });
});

// ── 404 on a slug that matches no tenant ─────────────────────────────
describe('extend-trial — 404 on a non-existent slug', () => {
  it('404s and writes no audit', async () => {
    h.state.tenantRows = [];
    const { extendTenantTrialAdmin } = await import('./admin.js');
    const r = await extendTenantTrialAdmin({ slug: 'ghost', body: { days: 7 }, actorUserId: 1, now: NOW });
    expect(r.status).toBe(404);
    expect(r.json.ok).toBeUndefined();
    expect(String(r.json.error)).toContain('ghost');
    expect(auditRows()).toHaveLength(0);
  });
});

// ── Guard — requires a super-admin session ───────────────────────────
describe('extend-trial — guarded by requireSuperAdmin', () => {
  function mockRes() {
    const out: { code?: number; body?: Record<string, unknown> } = {};
    const res = {
      status(c: number) { out.code = c; return res; },
      json(b: Record<string, unknown>) { out.body = b; return res; },
    } as unknown as Response;
    return { res, out };
  }

  it('401 when there is no authenticated user', async () => {
    const { requireSuperAdmin } = await import('../middleware.js');
    const { res, out } = mockRes();
    let nexted = false;
    await requireSuperAdmin({} as Request, res, (() => { nexted = true; }) as NextFunction);
    expect(out.code).toBe(401);
    expect(nexted).toBe(false);
  });

  it('403 for a logged-in non-super-admin', async () => {
    const { requireSuperAdmin } = await import('../middleware.js');
    const { res, out } = mockRes();
    let nexted = false;
    await requireSuperAdmin({ user: { role: 'owner' } } as unknown as Request, res, (() => { nexted = true; }) as NextFunction);
    expect(out.code).toBe(403);
    expect(nexted).toBe(false);
  });

  it('calls next() for a super-admin', async () => {
    const { requireSuperAdmin } = await import('../middleware.js');
    const { res, out } = mockRes();
    let nexted = false;
    await requireSuperAdmin({ user: { role: 'super_admin' } } as unknown as Request, res, (() => { nexted = true; }) as NextFunction);
    expect(nexted).toBe(true);
    expect(out.code).toBeUndefined();
  });
});
