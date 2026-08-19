/**
 * Admin carrier-override WRITE path — `POST /api/admin/carrier/:usdot/override`.
 *
 * Tests drive `upsertCarrierOverride` directly (the extracted route core, same
 * pattern as patchTenantAdmin / adminHardening.test.ts) against a mocked db:
 *   - valid upsert → 200 + audit row (action 'admin.carrier.override');
 *   - USDOT absent from carrier_directory → 404 (never orphan an override);
 *   - non-numeric USDOT → 400; unknown/invalid field → 400; empty body → 400;
 *   - USDOT is normalized (leading zeros stripped) before the directory lookup;
 *   - capabilities + blank-clears are passed through to the upsert SET.
 *
 * The route itself is `requireAuth, requireSuperAdmin` (same guard as every
 * other /api/admin route) — auth is exercised by the middleware tests; here we
 * test the handler core with the actor already resolved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    carrierRows: [] as Record<string, unknown>[], // carrier_directory existence lookup
    upserts: [] as Array<{ values: Record<string, unknown>; set: Record<string, unknown> }>,
    audits: [] as Record<string, unknown>[],
  };
  return { state };
});

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  function makeSelect() {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) { table = t; return chain; },
      where() { return chain; },
      limit() {
        return Promise.resolve(getTableName(table as never) === 'carrier_directory' ? h.state.carrierRows : []);
      },
    };
    return chain;
  }
  function makeInsert(t: unknown) {
    const name = getTableName(t as never);
    return {
      values(v: Record<string, unknown>) {
        if (name === 'audit_log') {
          h.state.audits.push(v);
          return Promise.resolve();
        }
        // carrier_overrides upsert chain.
        const rec = { values: v, set: {} as Record<string, unknown> };
        return {
          onConflictDoUpdate(cfg: { set: Record<string, unknown> }) {
            rec.set = cfg.set;
            return {
              returning() {
                h.state.upserts.push(rec);
                return Promise.resolve([{ ...v }]);
              },
            };
          },
        };
      },
    };
  }
  return {
    db: () => ({
      select: () => makeSelect(),
      insert: (t: unknown) => makeInsert(t),
    }),
  };
});

import { upsertCarrierOverride } from './admin.js';

beforeEach(() => {
  h.state.carrierRows = [{ usdot: '107080' }];
  h.state.upserts = [];
  h.state.audits = [];
});

describe('upsertCarrierOverride', () => {
  it('upserts about/email/phone/hidden and returns 200 + writes an audit row', async () => {
    const r = await upsertCarrierOverride({
      usdot: '107080',
      body: { about: 'Curated blurb.', email: 'ops@acme.com', phone: '8005551234', hidden: true },
      actorUserId: 7,
      actorLabel: 'admin@quotefleet.net',
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(h.state.upserts).toHaveLength(1);
    const set = h.state.upserts[0].set;
    expect(set.aboutOverride).toBe('Curated blurb.');
    expect(set.emailOverride).toBe('ops@acme.com');
    expect(set.phoneOverride).toBe('8005551234');
    expect(set.hidden).toBe(true);
    expect(set.updatedBy).toBe('admin@quotefleet.net');
    expect(set.updatedAt).toBeInstanceOf(Date);
    // Insert values carry the PK.
    expect(h.state.upserts[0].values.usdot).toBe('107080');
    // Audit written with the carrier-override action.
    expect(h.state.audits).toHaveLength(1);
    expect(h.state.audits[0].action).toBe('admin.carrier.override');
  });

  it('passes self-declared capabilities through to the upsert SET', async () => {
    const r = await upsertCarrierOverride({
      usdot: '107080',
      body: { capabilities: { uiia: true, twic: true, reefer: false } },
      actorUserId: 7,
    });
    expect(r.status).toBe(200);
    expect(h.state.upserts[0].set.capabilities).toEqual({ uiia: true, twic: true, reefer: false });
  });

  it('normalizes a zero-padded USDOT before the directory lookup', async () => {
    const r = await upsertCarrierOverride({ usdot: '00107080', body: { hidden: true }, actorUserId: 7 });
    expect(r.status).toBe(200);
    expect(h.state.upserts[0].values.usdot).toBe('107080');
  });

  it('null clears an override (blank string normalized to null too)', async () => {
    const r = await upsertCarrierOverride({
      usdot: '107080',
      body: { about: null, email: '' },
      actorUserId: 7,
    });
    expect(r.status).toBe(200);
    expect(h.state.upserts[0].set.aboutOverride).toBeNull();
    expect(h.state.upserts[0].set.emailOverride).toBeNull();
  });

  it('returns 404 when the USDOT is not in carrier_directory (never orphans an override)', async () => {
    h.state.carrierRows = [];
    const r = await upsertCarrierOverride({ usdot: '999999', body: { hidden: true }, actorUserId: 7 });
    expect(r.status).toBe(404);
    expect(h.state.upserts).toHaveLength(0);
  });

  it('returns 400 for a non-numeric USDOT', async () => {
    const r = await upsertCarrierOverride({ usdot: 'abc', body: { hidden: true }, actorUserId: 7 });
    expect(r.status).toBe(400);
  });

  it('returns 400 for an unknown field or a bad email', async () => {
    expect((await upsertCarrierOverride({ usdot: '107080', body: { bogus: 1 }, actorUserId: 7 })).status).toBe(400);
    expect((await upsertCarrierOverride({ usdot: '107080', body: { email: 'not-an-email' }, actorUserId: 7 })).status).toBe(400);
  });

  it('returns 400 for an empty body (no fields to write)', async () => {
    const r = await upsertCarrierOverride({ usdot: '107080', body: {}, actorUserId: 7 });
    expect(r.status).toBe(400);
    expect(h.state.upserts).toHaveLength(0);
  });
});
