/**
 * Importer Search page + search API — render + freemium-gate + safety tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { renderImporterSearchPage, handleImporterSearch } from './importerPages.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.IMPORTYETI_API_KEY;
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
    expect(html).toContain('US importer database');
  });
  it('leads with the provider-first pickers (port / state / commodity)', () => {
    expect(html).toContain('id="imp-port"');
    expect(html).toContain('id="imp-state"');
    expect(html).toContain('id="imp-commodity"');
    // company-name box is present but secondary.
    expect(html).toContain('id="imp-company"');
    expect(html).toContain('Or search by company name');
  });
  it('shows the freemium locked state (contact + CSV export gated)', () => {
    expect(html).toContain('Export CSV');
    expect(html.toLowerCase()).toContain('unlock');
    // CTA points at signup (placeholder unlock, no payment wired).
    expect(html).toContain('href="/signup"');
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
    // Only the FIRST search hit ImportYeti; the second was fully cache-served.
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
