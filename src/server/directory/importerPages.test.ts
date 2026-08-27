/**
 * Importer Search page + search API — render + freemium-gate + safety tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  renderImporterSearchPage,
  handleImporterSearch,
  handleImporterSuggest,
  portToStateCode,
  entryPortsForState,
  MAX_STATE_PORTS,
} from './importerPages.js';
import {
  IP_DAILY_LIVE_SEARCH_CAP,
  DETAIL_COOKIE,
  FREE_DETAIL_QUOTA,
  recordLiveSearch,
  __resetQuotaStateForTests,
} from './importerQuota.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.IMPORTYETI_API_KEY;
  __resetQuotaStateForTests();
});

/** Minimal Express res double capturing status + json/html body. */
function fakeRes(): Response & { _status: number; _json: unknown; _html: string | null } {
  const res: Partial<Response> & { _status: number; _json: unknown; _html: string | null } = {
    _status: 200,
    _json: undefined,
    _html: null,
    status(code: number) {
      this._status = code;
      return this as Response;
    },
    json(body: unknown) {
      this._json = body;
      return this as Response;
    },
    type() {
      return this as Response;
    },
    send(body: string) {
      this._html = body;
      return this as Response;
    },
  };
  return res as Response & { _status: number; _json: unknown; _html: string | null };
}
function fakeReq(body: unknown): Request {
  return { body } as Request;
}

/** Hermetic in-memory cache stores so the handler never touches the DB. */
function memBolStore() {
  const m = new Map<string, { rows: Record<string, unknown>[]; creditsRemaining: number | null; fetchedAt: Date }>();
  return {
    async get(k: string) {
      return m.get(k) ?? null;
    },
    async put(k: string, rows: Record<string, unknown>[], creditsRemaining: number | null) {
      m.set(k, { rows, creditsRemaining, fetchedAt: new Date() });
    },
  };
}
function memContactStore() {
  return {
    async get() {
      return null;
    },
    async getMany() {
      return new Map();
    },
    async put() {
      /* no-op */
    },
  };
}
const memDeps = () => ({ bolCache: memBolStore(), contactCache: memContactStore() });

describe('renderImporterSearchPage', () => {
  const html = renderImporterSearchPage();
  it('renders a server-rendered page with the right SEO + canonical', () => {
    expect(html).toContain('<title>US Importer Database');
    expect(html).toContain('href="https://quotefleet.net/importers"');
    // directory-portal redesign: visible eyebrow removed; SEO h1 is now sr-only
    expect(html).toContain('Find US importers to pitch');
  });
  it('leads with the provider-first pickers (port / state / commodity)', () => {
    expect(html).toContain('id="imp-port"');
    expect(html).toContain('id="imp-state"');
    expect(html).toContain('id="imp-commodity"');
    // company-name box is present but secondary.
    expect(html).toContain('id="imp-company"');
    expect(html).toContain('Or search by company name');
  });
  it('shows the honest freemium state (CSV export + save free, contact reveal coming soon)', () => {
    // CSV export + saved-importers surfaces are present (free with an account).
    expect(html).toContain('Export CSV');
    expect(html).toContain('/importers/saved');
    // Contact reveal is HONEST: a "coming soon" state, NOT a dead /signup unlock.
    expect(html).toContain('Contact reveal');
    expect(html).toContain('coming soon');
  });
  it('carries the nav Importer link (discovery wiring)', () => {
    expect(html).toContain('href="/importers"');
  });
});

describe('handleImporterSearch', () => {
  it('400s when no filter is provided (no engine / external call)', async () => {
    const res = fakeRes();
    await handleImporterSearch(fakeReq({}), res, memDeps());
    expect(res._status).toBe(400);
    expect((res._json as { error: string }).error).toBe('no_filter');
  });

  it('503s cleanly (not_configured) when the ImportYeti key is unset', async () => {
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ entryPort: 'Savannah, GA' }), res, memDeps());
    expect(res._status).toBe(503);
    expect((res._json as { error: string }).error).toBe('not_configured');
  });

  it('returns FREE card fields + winnability + aiAngle, and NEVER leaks contact data', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    const rows = [
      {
        company_name: 'Robert Bosch Tool Corp',
        company_address: '1980 Indian Creek Rd, Lincolnton, NC 28092',
        supplier_name: 'Scintilla AG',
        supplier_country_code: 'DE',
        product_description: 'Saw blades',
        hs_code: '820299',
        entry_port: 'Savannah, GA',
        company_shipments_12m: 10761,
        company_total_shipments: 169818,
        notify_party_name: 'Expeditors Intl',
        arrival_date: '07/31/2026',
      },
    ];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ requestCost: 1, creditsRemaining: 50, data: { data: rows } }),
    })) as unknown as typeof fetch;

    const res = fakeRes();
    await handleImporterSearch(fakeReq({ entryPort: 'Savannah, GA' }), res, memDeps());
    expect(res._status).toBe(200);
    const body = res._json as { leads: Array<Record<string, unknown>> };
    expect(body.leads).toHaveLength(1);
    const card = body.leads[0];
    // Free, visible fields.
    expect(card.company).toBe('Robert Bosch Tool Corp');
    expect(card.incumbent_forwarder).toBe('Expeditors Intl');
    expect((card.winnability as { label: string }).label).toBeTruthy();
    expect(typeof card.aiAngle).toBe('string');
    expect(card.contactLocked).toBe(true);
    // Tier label is exposed honestly; a lead is never empty (phone_only floor).
    expect(['verified', 'role_based', 'phone_only']).toContain(card.contact_confidence);
    // Locked fields (values) must NOT be present in the browse projection.
    expect('email' in card).toBe(false);
    expect('contact_name' in card).toBe(false);
    expect('phone' in card).toBe(false);
    expect('address' in card).toBe(false);
    expect('draft_email' in card).toBe(false);
  });

  it('serves a repeat search from the BOL cache — ZERO extra ImportYeti calls', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    const rows = [{ company_name: 'Cached Co', company_shipments_12m: 100, entry_port: 'Savannah, GA' }];
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ requestCost: 1, creditsRemaining: 10, data: { data: rows } }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const deps = memDeps();

    const r1 = fakeRes();
    await handleImporterSearch(fakeReq({ entryPort: 'Savannah, GA' }), r1, deps);
    const r2 = fakeRes();
    await handleImporterSearch(fakeReq({ entryPort: 'Savannah, GA' }), r2, deps);

    expect((r1._json as { cached: boolean }).cached).toBe(false);
    expect((r2._json as { cached: boolean }).cached).toBe(true);
    // The cache hit spent NO credit — it was NOT a live pull.
    expect((r2._json as { pulledLive: boolean }).pulledLive).toBe(false);
    // Only the FIRST search hit ImportYeti; the second was fully cache-served.
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('search is FREE — a visitor at the detail-open quota can still search live', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ requestCost: 1, creditsRemaining: 5, data: { data: [{ company_name: 'X Co', company_shipments_12m: 1, entry_port: 'Newark, NJ' }] } }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    // Detail cookie is maxed out — must NOT gate searching.
    const req = { body: { entryPort: 'Newark, NJ' }, ip: '9.9.9.9', headers: { cookie: `${DETAIL_COOKIE}=${FREE_DETAIL_QUOTA}` } } as unknown as Request;
    const res = fakeRes();
    await handleImporterSearch(req, res, memDeps());
    const body = res._json as { leads: unknown[]; searchLimited?: boolean; pulledLive?: boolean };
    expect(body.searchLimited).toBeUndefined();
    expect(body.leads).toHaveLength(1);
    expect(body.pulledLive).toBe(true);
    // No subscribe-wall fields leak onto the search response.
    expect('quotaExhausted' in (res._json as object)).toBe(false);
  });

  it('the generous anti-abuse cap soft-limits a cache MISS without spending a credit', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ requestCost: 1, creditsRemaining: 5, data: { data: [{ company_name: 'X', company_shipments_12m: 1 }] } }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const ip = '8.8.4.4';
    // Exhaust the per-IP daily live-search cap first.
    for (let i = 0; i < IP_DAILY_LIVE_SEARCH_CAP; i++) recordLiveSearch({ ip, headers: {} } as unknown as Request);
    const req = { body: { entryPort: 'Newark, NJ' }, ip, headers: {} } as unknown as Request;
    const res = fakeRes();
    await handleImporterSearch(req, res, memDeps());
    const body = res._json as { searchLimited?: boolean; leads: unknown[]; message?: string };
    expect(body.searchLimited).toBe(true);
    expect(body.leads).toHaveLength(0);
    expect(String(body.message)).not.toMatch(/subscribe/i); // NOT a paywall
    // A blocked live pull never touched ImportYeti.
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});

describe('State ⇄ Port entry-geography pair', () => {
  it('State-only search expands to the state’s entry ports and dedups across them', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    const seenPorts: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      const port = new URL(url).searchParams.get('entry_port') || '';
      seenPorts.push(port);
      const co = /brunswick/i.test(port) ? 'Brunswick Importer' : 'Savannah Importer';
      const rows = [
        { company_name: co, company_shipments_12m: 100, entry_port: port },
        // Shared across ports → must be deduped to a single card.
        { company_name: 'Shared Importer', company_shipments_12m: 500, entry_port: port },
      ];
      return { ok: true, json: async () => ({ requestCost: 1, creditsRemaining: 20, data: { data: rows } }) };
    }) as unknown as typeof fetch;

    const res = fakeRes();
    await handleImporterSearch(fakeReq({ state: 'GA' }), res, memDeps());
    expect(res._status).toBe(200);
    const body = res._json as { leads: Array<{ company: string }> };
    // Both GA entry ports were queried (Savannah from the lock map + Brunswick).
    expect(seenPorts.some((p) => /savannah/i.test(p))).toBe(true);
    expect(seenPorts.some((p) => /brunswick/i.test(p))).toBe(true);
    // Shared importer appears exactly once (deduped across the two port pulls).
    expect(body.leads.map((l) => l.company).sort()).toEqual([
      'Brunswick Importer', 'Savannah Importer', 'Shared Importer',
    ]);
  });

  it('Port + locked State does NOT HQ-filter — a Newark importer HQ’d in NY is still returned', async () => {
    process.env.IMPORTYETI_API_KEY = 'test';
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(new URL(url).searchParams.get('entry_port') || '');
      const rows = [
        { company_name: 'NJ HQ Co', company_address: '1 Dock Rd, Newark, NJ 07114', company_shipments_12m: 300, entry_port: 'Newark, NJ' },
        { company_name: 'NY HQ Co', company_address: '5 Wall St, New York, NY 10005', company_shipments_12m: 400, entry_port: 'Newark, NJ' },
      ];
      return { ok: true, json: async () => ({ requestCost: 1, creditsRemaining: 20, data: { data: rows } }) };
    }) as unknown as typeof fetch;

    // The client locks State=NJ when the Newark port is chosen; both must survive.
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ entryPort: 'Newark, NJ', state: 'NJ' }), res, memDeps());
    const body = res._json as { leads: Array<{ company: string; state: string }> };
    expect(body.leads.map((l) => l.company).sort()).toEqual(['NJ HQ Co', 'NY HQ Co']);
    // A single PORT pull — not a per-port state fan-out.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('Newark, NJ');
  });
});

describe('entryPortsForState (state → entry ports: inverted lock map + supplement)', () => {
  it('expands GA to Savannah + Brunswick', () => {
    const ga = entryPortsForState('GA');
    expect(ga).toContain('Savannah, GA');
    expect(ga).toContain('Brunswick, GA');
  });
  it('includes both LA and Long Beach for CA (multi-port state), case-insensitive', () => {
    const ca = entryPortsForState('ca');
    expect(ca).toContain('Los Angeles, CA');
    expect(ca).toContain('Long Beach, CA');
  });
  it('is capped and empty for an unknown / blank state', () => {
    expect(entryPortsForState('ZZ')).toEqual([]);
    expect(entryPortsForState('')).toEqual([]);
    expect(entryPortsForState(null)).toEqual([]);
    expect(entryPortsForState('GA').length).toBeLessThanOrEqual(MAX_STATE_PORTS);
  });
});

describe('portToStateCode (port → state lock)', () => {
  it('maps a port to its single US state', () => {
    expect(portToStateCode('Newark, NJ')).toBe('NJ');
    expect(portToStateCode('Long Beach, CA')).toBe('CA');
    expect(portToStateCode('Savannah, GA')).toBe('GA');
  });
  it('is case-insensitive and null for an unknown port', () => {
    expect(portToStateCode('savannah, ga')).toBe('GA');
    expect(portToStateCode('Nowhere, ZZ')).toBeNull();
    expect(portToStateCode('')).toBeNull();
  });
});

describe('handleImporterSuggest', () => {
  it('returns curated HS/commodity suggestions (never calls ImportYeti)', () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = fakeRes();
    handleImporterSuggest({ query: { field: 'commodity', q: '8202' } } as unknown as Request, res);
    const items = (res._json as { items: Array<{ value: string }> }).items;
    expect(items[0].value).toBe('8202');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('returns an empty list for an unknown field', () => {
    const res = fakeRes();
    handleImporterSuggest({ query: { field: 'nope', q: 'x' } } as unknown as Request, res);
    expect((res._json as { items: unknown[] }).items).toEqual([]);
  });
});
