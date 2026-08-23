/**
 * carrierLookup — the "Find your company" self-service prefill query.
 *
 * The DB client is mocked with a chain that captures the WHERE clause + limit
 * and resolves canned carrier_directory rows, so this exercises the REAL query
 * logic: param precedence (dot → mc → q), the normalized MC match, the name
 * ILIKE, the contact-opt-out nulling, and the empty/short-query guard (which
 * must return [] WITHOUT ever touching the DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const h = vi.hoisted(() => ({
  state: { rows: [] as Record<string, unknown>[], where: undefined as unknown, limit: 0, selectCalls: 0 },
}));

vi.mock('../../db/client.js', () => ({
  db: () => ({
    select: () => {
      h.state.selectCalls++;
      return {
        from: () => ({
          where: (w: unknown) => {
            h.state.where = w;
            return {
              orderBy: () => ({
                limit: (n: number) => {
                  h.state.limit = n;
                  return Promise.resolve(h.state.rows);
                },
              }),
            };
          },
        }),
      };
    },
  }),
}));

const { carrierLookup, normalizeUsdotQuery, normalizeMcQuery, CARRIER_LOOKUP_LIMIT } = await import('./queries.js');

const dialect = new PgDialect();
function render(w: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery((w as { getSQL: () => SQL }).getSQL());
  return { sql: q.sql.toLowerCase(), params: q.params };
}

function row(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    publicSlug: 'harbor-link-2841196',
    legalName: 'HARBOR LINK DRAYAGE LLC',
    dbaName: null,
    usdot: '2841196',
    mcNumber: 'MC012892',
    city: 'LONG BEACH',
    state: 'CA',
    zip: '90802',
    phone: '5625551234',
    email: 'ops@harbor.example',
    contactHidden: false,
    powerUnits: 40,
    drivers: 45,
    safetyRating: 'S',
    authorityType: 'C',
    country: 'US',
    intermodal: true,
    hazmat: false,
    dryVan: false,
    reefer: false,
    tanker: false,
    flatbed: false,
    dryBulk: false,
    householdGoods: false,
    beverages: false,
    produce: false,
    motorVehicles: false,
    livestock: false,
    grainFeed: false,
    oilfield: false,
    meat: false,
    paper: false,
    construction: false,
    farmSupplies: false,
    coalCoke: false,
    buildingMaterials: false,
    nearestPortCode: 'USLALB',
    updatedAt: new Date(),
    ...o,
  };
}

beforeEach(() => {
  h.state.rows = [];
  h.state.where = undefined;
  h.state.limit = 0;
  h.state.selectCalls = 0;
});

describe('normalize helpers', () => {
  it('normalizeUsdotQuery strips non-digits + leading zeros', () => {
    expect(normalizeUsdotQuery('00123456')).toBe('123456');
    expect(normalizeUsdotQuery('USDOT 123456')).toBe('123456');
    expect(normalizeUsdotQuery('abc')).toBeNull();
    expect(normalizeUsdotQuery('')).toBeNull();
  });
  it('normalizeMcQuery reduces any MC form to bare digits', () => {
    expect(normalizeMcQuery('MC012892')).toBe('12892');
    expect(normalizeMcQuery('012892')).toBe('12892');
    expect(normalizeMcQuery('12892')).toBe('12892');
    expect(normalizeMcQuery('MC-012892')).toBe('12892');
    expect(normalizeMcQuery('N/A')).toBeNull();
  });
});

describe('carrierLookup — dot lookup', () => {
  it('matches usdot exactly (zeros stripped) as a single row', async () => {
    h.state.rows = [row()];
    await carrierLookup({ dot: '00123456' });
    const r = render(h.state.where);
    expect(r.sql).toContain('usdot');
    expect(r.sql).toContain('=');
    expect(r.params).toContain('123456');
    expect(h.state.limit).toBe(1);
  });
});

describe('carrierLookup — mc lookup (normalized match)', () => {
  it('normalizes both sides so "MC012892" and "12892" hit the same key', async () => {
    await carrierLookup({ mc: 'MC012892' });
    const a = render(h.state.where);
    expect(a.sql).toContain('ltrim');
    expect(a.sql).toContain('regexp_replace');
    expect(a.params).toContain('12892');
    expect(h.state.limit).toBe(CARRIER_LOOKUP_LIMIT);

    await carrierLookup({ mc: '12892' });
    expect(render(h.state.where).params).toContain('12892');

    await carrierLookup({ mc: '012892' });
    expect(render(h.state.where).params).toContain('12892');
  });
});

describe('carrierLookup — name lookup (ILIKE)', () => {
  it('uses a case-insensitive substring match, capped at the lookup limit', async () => {
    await carrierLookup({ q: 'harbor' });
    const r = render(h.state.where);
    expect(r.sql).toContain('ilike');
    expect(r.params.some((p) => String(p).includes('harbor'))).toBe(true);
    expect(h.state.limit).toBe(CARRIER_LOOKUP_LIMIT);
  });
});

describe('carrierLookup — contact opt-out + slim shape', () => {
  it('nulls phone + email for a contactHidden carrier', async () => {
    h.state.rows = [row({ contactHidden: true, phone: '5625551234', email: 'ops@harbor.example' })];
    const res = await carrierLookup({ dot: '2841196' });
    expect(res).toHaveLength(1);
    expect(res[0].phone).toBeNull();
    expect(res[0].email).toBeNull();
  });
  it('returns the slim projection for a visible carrier', async () => {
    h.state.rows = [row()];
    const res = await carrierLookup({ dot: '2841196' });
    expect(res[0]).toEqual({
      usdot: '2841196',
      mcNumber: 'MC012892',
      legalName: 'HARBOR LINK DRAYAGE LLC',
      dbaName: null,
      phone: '5625551234',
      email: 'ops@harbor.example',
      city: 'LONG BEACH',
      state: 'CA',
      zip: '90802',
    });
  });
});

describe('carrierLookup — empty / short guard', () => {
  it('returns [] and never touches the DB for absent/too-short/non-numeric input', async () => {
    expect(await carrierLookup({})).toEqual([]);
    expect(await carrierLookup({ q: 'a' })).toEqual([]); // below NAME_SEARCH_MIN
    expect(await carrierLookup({ dot: 'abc' })).toEqual([]); // no digits
    expect(await carrierLookup({ mc: 'N/A' })).toEqual([]);
    expect(h.state.selectCalls).toBe(0);
  });
});

describe('carrierLookup — param precedence dot > mc > q', () => {
  it('prefers dot when several params are supplied', async () => {
    await carrierLookup({ dot: '123', mc: '999', q: 'foo' });
    const r = render(h.state.where);
    expect(r.sql).toContain('usdot');
    expect(r.params).toContain('123');
    expect(h.state.limit).toBe(1);
  });
});
