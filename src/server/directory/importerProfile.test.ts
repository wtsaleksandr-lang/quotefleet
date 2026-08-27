/**
 * Importer Company Profile page (Phase 2) — aggregation, the 3-free-profile
 * detail-quota gate, and the cache-hit ($0 on repeat) path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  aggregateProfile,
  sanitizeSlug,
  titleFromSlug,
  profileCacheKey,
  handleImporterProfile,
} from './importerProfile.js';
import { companySlugFromLink } from './importerLeads.js';
import { FREE_DETAIL_QUOTA, DETAIL_COOKIE, __resetQuotaStateForTests } from './importerQuota.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.IMPORTYETI_API_KEY;
  __resetQuotaStateForTests();
});

/** Express res double capturing status / html / cookies / redirect. */
function fakeRes() {
  const res = {
    _status: 200,
    _html: null as string | null,
    _cookies: {} as Record<string, string>,
    _redirect: null as string | null,
    status(c: number) {
      this._status = c;
      return this as unknown as Response;
    },
    type() {
      return this as unknown as Response;
    },
    send(b: string) {
      this._html = b;
      return this as unknown as Response;
    },
    cookie(name: string, val: string) {
      this._cookies[name] = val;
      return this as unknown as Response;
    },
    redirect(code: number | string, loc?: string) {
      if (typeof code === 'string') this._redirect = code;
      else {
        this._status = code;
        this._redirect = loc ?? null;
      }
      return this as unknown as Response;
    },
  };
  return res;
}
type FakeRes = ReturnType<typeof fakeRes>;

function fakeReq(slug: string, cookie?: string): Request {
  return {
    params: { slug },
    ip: '10.0.0.1',
    headers: cookie ? { cookie } : {},
  } as unknown as Request;
}

/** In-memory BOL cache double (never touches the DB). */
function memBolStore() {
  const m = new Map<string, { rows: Record<string, unknown>[]; creditsRemaining: number | null; fetchedAt: Date }>();
  return {
    async get(k: string) {
      return m.get(k) ?? null;
    },
    async put(k: string, rows: Record<string, unknown>[], creditsRemaining: number | null) {
      m.set(k, { rows, creditsRemaining, fetchedAt: new Date() });
    },
    _map: m,
  };
}

/** One company's BOL rows (two months, two suppliers, two origins). */
const ROWS = [
  {
    bol_number: 'BOL1', arrival_date: '07/20/2026', company_name: 'Valbruna Stainless Inc',
    company_basename: 'Valbruna Stainless', company_link: '/company/valbruna-stainless',
    company_address: '2400 Taylor St W, Fort Wayne, IN 46802', company_country_code: 'US',
    company_main_phone_number: '2604342910', company_total_shipments: 13266,
    company_shipments_12m: 559, company_teu_12m: 1340, company_first_shipment_date: '01/02/2015',
    supplier_name: 'Acciaierie Valbruna Spa', supplier_basename: 'Acciaierie Valbruna',
    supplier_country_code: 'IT', product_description: 'Stainless bars', hs_code: '721890',
    hs_code_description: 'Stainless steel', entry_port: 'Savannah, Ga.', exit_port: 'Genova',
    carrier_scac_code: 'HLCU', notify_party_name: 'Expeditors Intl', weight: 24454,
    quantity: 37, quantity_unit: 'PKG', containers_count: 1, container_types: '40ft',
  },
  {
    bol_number: 'BOL2', arrival_date: '07/28/2026', company_name: 'Valbruna Stainless Inc',
    company_basename: 'Valbruna Stainless', company_link: '/company/valbruna-stainless',
    company_total_shipments: 13266, company_shipments_12m: 559, company_teu_12m: 1340,
    supplier_name: 'Cogne Acciai', supplier_basename: 'Cogne Acciai', supplier_country_code: 'IT',
    product_description: 'Nickel alloy', hs_code: '722100', entry_port: 'Savannah, Ga.',
    exit_port: 'Genova', carrier_scac_code: 'MAEU', notify_party_name: 'Expeditors Intl',
    weight: 18000, quantity: 20, quantity_unit: 'PKG', containers_count: 1,
  },
  {
    bol_number: 'BOL3', arrival_date: '06/15/2026', company_name: 'Valbruna Stainless Inc',
    company_basename: 'Valbruna Stainless', company_link: '/company/valbruna-stainless',
    company_total_shipments: 13266, company_shipments_12m: 559, company_teu_12m: 1340,
    supplier_name: 'Acciaierie Valbruna Spa', supplier_basename: 'Acciaierie Valbruna',
    supplier_country_code: 'DE', product_description: 'Stainless bars', hs_code: '721890',
    entry_port: 'Savannah, Ga.', exit_port: 'Bremerhaven', carrier_scac_code: 'HLCU',
    notify_party_name: 'Valbruna Stainless Inc', weight: 12000, quantity: 10, quantity_unit: 'PKG',
    containers_count: 1,
  },
];

function mockYeti(rows: unknown[]) {
  const spy = vi.fn(async () => ({
    ok: true,
    json: async () => ({ requestCost: 5, creditsRemaining: 100, data: { data: rows } }),
  })) as unknown as typeof fetch;
  globalThis.fetch = spy;
  return spy as unknown as { mock: { calls: unknown[] } };
}

// ── slug helpers ─────────────────────────────────────────────────────────────
describe('slug helpers', () => {
  it('companySlugFromLink extracts the slug ImportYeti actually filters on', () => {
    expect(companySlugFromLink('/company/valbruna-stainless')).toBe('valbruna-stainless');
    expect(companySlugFromLink('/company/robert-bosch-tool')).toBe('robert-bosch-tool');
    expect(companySlugFromLink('')).toBe('');
    expect(companySlugFromLink(null)).toBe('');
    // reject junk / path traversal
    expect(companySlugFromLink('/company/../../etc')).toBe('');
  });
  it('sanitizeSlug clamps to the safe charset', () => {
    expect(sanitizeSlug('Valbruna-Stainless')).toBe('valbruna-stainless');
    expect(sanitizeSlug('../secret')).toBe('');
    expect(sanitizeSlug('a b c')).toBe('');
    expect(sanitizeSlug('')).toBe('');
  });
  it('titleFromSlug produces a readable teaser name', () => {
    expect(titleFromSlug('valbruna-stainless')).toBe('Valbruna Stainless');
  });
});

// ── aggregation ──────────────────────────────────────────────────────────────
describe('aggregateProfile', () => {
  const p = aggregateProfile(ROWS, 'valbruna-stainless');
  it('takes headline totals from the per-row company aggregates', () => {
    expect(p.company).toBe('Valbruna Stainless');
    expect(p.totalShipments).toBe(13266);
    expect(p.ships12m).toBe(559);
    expect(p.teu12m).toBe(1340);
    expect(p.avgTeu).toBeCloseTo(2.4, 1);
    expect(p.estSpend).toMatch(/^~\$/);
  });
  it('builds a chronological monthly series from arrival dates', () => {
    expect(p.months.map((m) => m.key)).toEqual(['2026-06', '2026-07']);
    expect(p.months[1].count).toBe(2); // two July bills
    expect(p.months[0].count).toBe(1); // one June bill
  });
  it('aggregates suppliers, HS codes and origin countries', () => {
    expect(p.suppliers[0].name).toBe('Acciaierie Valbruna'); // 2 shipments → top
    expect(p.suppliers[0].ships).toBe(2);
    expect(p.hsBreakdown.some((h) => h.hs.startsWith('7218'))).toBe(true);
    const origins = p.origins.map((o) => o.cc);
    expect(origins).toContain('IT');
    expect(origins).toContain('DE');
  });
  it('surfaces the incumbent notify party but never the importer itself', () => {
    expect(p.incumbent).toBe('Expeditors Intl');
    expect(p.notifyParties.some((n) => /valbruna/i.test(n.name))).toBe(false);
  });
  it('masks the phone to a contact-unlock teaser', () => {
    expect(p.phoneMasked).toBe('***-***-2910');
  });
});

// ── the profile route + freemium gate ────────────────────────────────────────
describe('handleImporterProfile', () => {
  it('redirects an invalid slug back to search', async () => {
    const res = fakeRes();
    await handleImporterProfile(fakeReq('../etc/passwd'), res as unknown as Response, {});
    expect(res._redirect).toBe('/importers');
  });

  it('serves the full profile under quota and records the open (bumps cookie)', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    mockYeti(ROWS);
    const res = fakeRes();
    await handleImporterProfile(fakeReq('valbruna-stainless'), res as unknown as Response, {
      bolCache: memBolStore(),
    });
    expect(res._status).toBe(200);
    expect(String(res._html)).toContain('Valbruna Stainless');
    expect(String(res._html)).toContain('Shipments over time');
    // the detailed open was counted → slug-aware cookie records the opened slug
    expect(res._cookies[DETAIL_COOKIE]).toBe('s:1:valbruna-stainless');
    // real contact data is NEVER rendered — only the honest "coming soon" reveal
    expect(String(res._html)).toContain('Contact reveal');
    expect(String(res._html)).not.toContain('2604342910'); // raw phone never leaks
  });

  it('shows the subscribe WALL once the free quota is spent (no credit spent)', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    const spy = mockYeti(ROWS);
    const res = fakeRes();
    // cookie already at the free limit → over quota
    await handleImporterProfile(
      fakeReq('valbruna-stainless', `${DETAIL_COOKIE}=${FREE_DETAIL_QUOTA}`),
      res as unknown as Response,
      { bolCache: memBolStore() },
    );
    expect(String(res._html)).toContain('Subscribe to open more importer profiles');
    // over-quota + uncached → we must NOT hit ImportYeti (no credit burned)
    expect(spy.mock.calls).toHaveLength(0);
    // the open was NOT recorded (no new cookie beyond what was sent)
    expect(res._cookies[DETAIL_COOKIE]).toBeUndefined();
  });

  it('serves a repeat profile open from cache — ZERO extra ImportYeti calls', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    const spy = mockYeti(ROWS);
    const cache = memBolStore();

    const r1 = fakeRes();
    await handleImporterProfile(fakeReq('valbruna-stainless'), r1 as unknown as Response, { bolCache: cache });
    // second open (cookie now =1, still under quota) → cache hit
    const r2 = fakeRes();
    await handleImporterProfile(
      fakeReq('valbruna-stainless', `${DETAIL_COOKIE}=1`),
      r2 as unknown as Response,
      { bolCache: cache },
    );

    expect(r1._status).toBe(200);
    expect(r2._status).toBe(200);
    expect(String(r2._html)).toContain('Valbruna Stainless');
    // Only the FIRST open pulled live; the profile cache served the second.
    expect(spy.mock.calls).toHaveLength(1);
    // and it was stored under the profile-scoped key
    expect((cache._map.has(profileCacheKey('valbruna-stainless')))).toBe(true);
  });

  it('degrades to a clean page (not a 500) when the ImportYeti key is unset', async () => {
    const res = fakeRes();
    await handleImporterProfile(fakeReq('valbruna-stainless'), res as unknown as Response, {
      bolCache: memBolStore(),
    });
    expect(res._status).toBe(503);
    expect(String(res._html)).toContain('coming soon');
  });
});
