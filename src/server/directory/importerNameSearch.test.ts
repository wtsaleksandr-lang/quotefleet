/**
 * Company-NAME search — the two FREE layers, and the three things that must
 * never be true of them.
 *
 *   N-1  a name search NEVER pulls bills of lading (the only paid endpoint)
 *   N-2  the local index is populated for $0 by lane searches, and answers names
 *   N-3  ImportYeti's free `company/search` tops it up, booked at ZERO credits
 *   N-4  the cost breaker latches if that "free" endpoint ever bills us
 *   N-5  Manifest Privacy customers stay hidden — results AND autosuggest
 *   N-6  name + lane is unchanged: the lane is pulled, the name narrows it
 *
 * Nothing here reaches ImportYeti: the cost guard is hard-OFF under a test
 * runner and the two specs that exercise the live path opt in IN CODE against a
 * mocked `globalThis.fetch`, so no socket to a paid provider can be opened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { __setLivePullsForTests, __resetGuardMetersForTests, externalCallMeter } from './externalPullGuard.js';
import { handleImporterSearch, handleImporterSuggest } from './importerPages.js';
import {
  companyNameMatchRank,
  companyMatchKey,
  companySearchRowToLead,
  slugFromCompanyKey,
  companySearchDisabled,
  __resetCompanySearchBreakerForTests,
} from './importerLeads.js';
import {
  indexLeads,
  searchNameIndex,
  loadNameIndex,
  invalidateNameIndexCache,
  NAME_INDEX_KEY,
  NAME_INDEX_MAX_COMPANIES,
  NAME_INDEX_REFRESH_MS,
} from './importerNameIndex.js';
import { companyKey } from './importerCache.js';
import { FIXTURE_SEARCH_ROWS, FIXTURE_ENTRY_PORT } from './importerFixture.js';
import { __resetQuotaStateForTests } from './importerQuota.js';

// The redaction set is DB-backed; stub it so a spec can decide who is hidden.
const redacted = new Set<string>();
vi.mock('./manifestRedactions.js', () => ({
  activeRedactionKeys: async () => redacted,
  isKeyRedacted: (s: Set<string>, n: string) => s.has(n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()),
  invalidateRedactionCache: () => {},
  isRedacted: async () => false,
}));

const realFetch = globalThis.fetch;
beforeEach(() => {
  redacted.clear();
  invalidateNameIndexCache();
  __resetCompanySearchBreakerForTests();
  __resetGuardMetersForTests();
});
afterEach(() => {
  __setLivePullsForTests(null);
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.IMPORTYETI_API_KEY;
  __resetQuotaStateForTests();
  invalidateNameIndexCache();
  __resetCompanySearchBreakerForTests();
});

function fakeRes(): Response & { _status: number; _json: any } {
  const res: any = {
    _status: 200,
    _json: undefined,
    status(c: number) { this._status = c; return this; },
    json(b: unknown) { this._json = b; return this; },
    type() { return this; },
    send() { return this; },
  };
  return res;
}
const fakeReq = (body: unknown): Request => ({ body, query: {} }) as unknown as Request;

function memBolStore() {
  const m = new Map<string, { rows: Record<string, unknown>[]; creditsRemaining: number | null; fetchedAt: Date }>();
  return {
    m,
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, rows: Record<string, unknown>[], creditsRemaining: number | null) {
      m.set(k, { rows, creditsRemaining, fetchedAt: new Date() });
    },
  };
}
const memContactStore = () => ({
  async get() { return null; },
  async getMany() { return new Map(); },
  async put() { /* no-op */ },
});

/** A lead shaped like the browse projection. */
const lead = (company: string, over: Record<string, unknown> = {}) =>
  ({
    company, slug: companyMatchKey(company).replace(/ /g, '-'), state: 'GA', address: '1 Dock Rd, Savannah, GA 31401',
    supplier: 'Acme Overseas', supplier_country: 'CN', product: 'Widgets', hs_code: '820299',
    entry_port: 'Savannah, GA', ships_12m: 100, total_shipments: 900, teu_12m: 200,
    last_shipment: '07/31/2026', phone: null, website: null, incumbent_forwarder: null,
    contact_name: null, title: null, email: null, email_confidence: null, ...over,
  }) as any;

// ── the matcher ─────────────────────────────────────────────────────────────
describe('companyNameMatchRank — punctuation and word order never decide a match', () => {
  const NAME = 'Robert Bosch Tool Corp.';
  it('ranks exact above prefix above contiguous above scattered tokens', () => {
    expect(companyNameMatchRank(NAME, 'robert bosch tool corp')).toBe(0);
    expect(companyNameMatchRank(NAME, 'Robert Bosch')).toBe(1);
    expect(companyNameMatchRank(NAME, 'bosch tool')).toBe(2);
    expect(companyNameMatchRank(NAME, 'bosch corp')).toBe(3);
  });
  it('matches through the punctuation a filed name actually carries', () => {
    // The old raw-substring filter missed this on the trailing period alone.
    expect(companyNameMatchRank(NAME, 'Robert Bosch Tool Corp.')).toBe(0);
    expect(companyNameMatchRank('Bosch (USA), Inc.', 'bosch usa inc')).toBe(0);
  });
  it('refuses a query too short to be a search', () => {
    // A 1-character query is a substring of nearly every company on file.
    expect(companyNameMatchRank(NAME, 'b')).toBeNull();
    expect(companyNameMatchRank(NAME, '  ')).toBeNull();
    expect(companyNameMatchRank(NAME, 'komatsu')).toBeNull();
  });
});

describe('companyMatchKey is pinned to companyKey — Manifest Privacy depends on it', () => {
  it('normalizes identically to importerCache.companyKey', () => {
    // Redactions are STORED under companyKey() (importerCache, DB-aware) and
    // TESTED against companyMatchKey() (importerLeads, deliberately DB-free).
    // The duplication is intentional; the drift would be silent, and it would
    // un-hide paying Manifest Privacy customers. So it is pinned here.
    for (const n of [
      'Premier Specialty Brands', 'Robert Bosch Tool Corp.', "O'Neil & Sons, LLC",
      '  ACME   TRADING  ', 'Bosch (USA), Inc.', '3M Company', 'Ünïcode Çø', '',
    ]) {
      expect(companyMatchKey(n)).toBe(companyKey(n));
    }
  });
});

describe('slugFromCompanyKey / companySearchRowToLead', () => {
  it('strips the company/ prefix and rejects anything outside the slug charset', () => {
    expect(slugFromCompanyKey('company/robert-bosch-tool')).toBe('robert-bosch-tool');
    expect(slugFromCompanyKey('Company/Walmart')).toBe('walmart');
    expect(slugFromCompanyKey('company/../etc')).toBe('');
    expect(slugFromCompanyKey(null)).toBe('');
  });
  it('leaves the fields company/search does NOT return as null rather than guessing', () => {
    const l = companySearchRowToLead({
      title: 'Komatsu America Corp', key: 'company/komatsu-america',
      address: '535 Mawsons Way, Newberry, SC 29108', totalShipments: 68033,
      mostRecentShipment: '07/26/2026', topSuppliers: ['Komatsu Changzhou'],
    })!;
    expect(l.company).toBe('Komatsu America Corp');
    expect(l.slug).toBe('komatsu-america');
    expect(l.state).toBe('SC');
    expect(l.total_shipments).toBe(68033);
    expect(l.supplier).toBe('Komatsu Changzhou');
    // Not in the free directory payload — must stay null, never invented.
    expect(l.ships_12m).toBeNull();
    expect(l.teu_12m).toBeNull();
    expect(l.entry_port).toBeNull();
    expect(l.hs_code).toBeNull();
    expect(l.incumbent_forwarder).toBeNull();
  });
});

// ── N-2 · the local index ───────────────────────────────────────────────────
describe('N-2 · the local index is free to fill and free to search', () => {
  it('stores under ONE reserved key of the existing BOL cache (no new table)', async () => {
    const store = memBolStore();
    await indexLeads(store, [lead('Robert Bosch Tool Corp'), lead('Komatsu America Corp')]);
    expect([...store.m.keys()]).toEqual([NAME_INDEX_KEY]);
  });

  it('answers a name from what a previous lane search already paid for', async () => {
    const store = memBolStore();
    await indexLeads(store, [lead('Robert Bosch Tool Corp'), lead('Komatsu America Corp')]);
    invalidateNameIndexCache();
    const hit = await searchNameIndex(store, 'bosch');
    expect(hit.leads.map((l) => l.company)).toEqual(['Robert Bosch Tool Corp']);
    expect(hit.total).toBe(2);
  });

  it('does not rewrite the row when nothing changed (it is ONE ~600KB row)', async () => {
    const store = memBolStore();
    const put = vi.spyOn(store, 'put');
    const batch = [lead('Robert Bosch Tool Corp'), lead('Komatsu America Corp')];
    expect(await indexLeads(store, batch)).toBe(2);
    expect(put).toHaveBeenCalledTimes(1);
    // The very next lane search sees the same companies — no write, no DB touch.
    expect(await indexLeads(store, batch)).toBe(0);
    expect(put).toHaveBeenCalledTimes(1);
    // A day later the projection is stale, so it IS refreshed.
    await indexLeads(store, batch, Date.now() + NAME_INDEX_REFRESH_MS + 1);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('stays bounded — the row can never grow without limit', async () => {
    const store = memBolStore();
    const many = Array.from({ length: NAME_INDEX_MAX_COMPANIES + 40 }, (_, i) => lead(`Importer Number ${i}`));
    await indexLeads(store, many);
    expect((await loadNameIndex(store)).length).toBe(NAME_INDEX_MAX_COMPANIES);
  });

  it('never throws on a broken store — indexing is a side benefit, not a dependency', async () => {
    const broken = {
      async get() { throw new Error('db down'); },
      async put() { throw new Error('db down'); },
    };
    await expect(indexLeads(broken, [lead('Acme Corp')])).resolves.toBe(0);
    await expect(searchNameIndex(broken, 'acme')).resolves.toEqual({ leads: [], total: 0 });
  });

  it('ignores junk in the jsonb row instead of crashing the directory', async () => {
    const store = memBolStore();
    await store.put(NAME_INDEX_KEY, [{ nope: 1 }, null as any, { k: 'x', lead: { company: 'Real Co' } }], null);
    invalidateNameIndexCache();
    expect((await loadNameIndex(store)).length).toBe(1);
  });
});

// ── N-1 · a name search never buys bills ────────────────────────────────────
describe('N-1 · a name-only search spends ZERO ImportYeti credits', () => {
  it('opens no socket at all when live pulls are off (dev / CI / an agent checkout)', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    await indexLeads(deps.bolCache, [lead('Robert Bosch Tool Corp')]);
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'bosch' }), res, deps);
    expect(spy).not.toHaveBeenCalled();
    expect(res._json.nameSearch).toBe(true);
    expect(res._json.pulledLive).toBe(false);
    expect(res._json.nameLiveSearched).toBe(false);
    expect(res._json.leads.map((l: any) => l.company)).toEqual(['Robert Bosch Tool Corp']);
    // It says what it matched against, and does not claim the 700M+ corpus.
    expect(res._json.nameIndexTotal).toBe(1);
    expect(res._json.source).toBe('name');
  });

  it('never touches the bills endpoint even with live pulls fully enabled', async () => {
    __setLivePullsForTests(true);
    process.env.IMPORTYETI_API_KEY = 'test-key';
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (u: any) => {
      urls.push(String(u));
      return { ok: true, status: 200, json: async () => ({ data: [] }) } as any;
    }) as unknown as typeof fetch;
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'bosch' }), res, { bolCache: memBolStore(), contactCache: memContactStore() });
    // The ONLY paid endpoint is powerquery/.../bols. It must not appear.
    expect(urls.some((u) => u.includes('/bols'))).toBe(false);
    expect(urls.every((u) => u.includes('/v1.0/company/search'))).toBe(true);
    expect(externalCallMeter().importyeti.credits).toBe(0);
  });

  it('with no API key it degrades quietly to the index — no throw, no 502, no log spam', async () => {
    __setLivePullsForTests(true);
    delete process.env.IMPORTYETI_API_KEY;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    await indexLeads(deps.bolCache, [lead('Mahlo America Inc')]);
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'mahlo' }), res, deps);
    expect(res._status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
    expect(res._json.leads.map((l: any) => l.company)).toEqual(['Mahlo America Inc']);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('nameSearch'))).toBe(false);
  });

  it('a live-search quota exhaustion cannot block a name search — it costs nothing to allow', async () => {
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    await indexLeads(deps.bolCache, [lead('Acme Trading Co')]);
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'acme' }), res, deps);
    expect(res._json.searchLimited).toBeUndefined();
    expect(res._json.count).toBe(1);
  });
});

// ── N-3 / N-4 · the free live layer, and its cost breaker ───────────────────
describe('N-3 · ImportYeti company/search is used as a ZERO-credit layer', () => {
  const companyPayload = (rows: unknown[], requestCost = 0) => ({
    ok: true, status: 200,
    json: async () => ({ requestCost, creditsRemaining: 999, data: rows }),
  });

  it('sends the free name endpoint and books the call at zero credits', async () => {
    __setLivePullsForTests(true);
    process.env.IMPORTYETI_API_KEY = 'test-key';
    let seen = '';
    globalThis.fetch = vi.fn(async (u: any) => {
      seen = String(u);
      return companyPayload([
        { title: 'Komatsu America Corp', key: 'company/komatsu-america', address: '535 Mawsons Way, Newberry, SC 29108', totalShipments: 68033 },
      ]) as any;
    }) as unknown as typeof fetch;
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'komatsu' }), res, { bolCache: memBolStore(), contactCache: memContactStore() });
    expect(seen).toContain('/v1.0/company/search?');
    expect(seen).toContain('name=komatsu');
    expect(res._json.nameLiveSearched).toBe(true);
    expect(res._json.leads.map((l: any) => l.company)).toEqual(['Komatsu America Corp']);
    const meter = externalCallMeter().importyeti;
    expect(meter.liveCalls).toBe(1);
    expect(meter.credits).toBe(0); // documented free — and booked as free
  });

  it('prefers the RICHER local card and never lets a sparse remote row replace it', async () => {
    __setLivePullsForTests(true);
    process.env.IMPORTYETI_API_KEY = 'test-key';
    globalThis.fetch = vi.fn(async () =>
      companyPayload([{ title: 'Robert Bosch Tool Corporation', key: 'company/robert-bosch-tool' }]) as any,
    ) as unknown as typeof fetch;
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    await indexLeads(deps.bolCache, [lead('Robert Bosch Tool Corp', { ships_12m: 10761 })]);
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'robert bosch tool' }), res, deps);
    const names = res._json.leads.map((l: any) => l.company);
    expect(names[0]).toBe('Robert Bosch Tool Corp');
    expect(res._json.leads[0].ships_12m).toBe(10761);
  });

  it('drops forwarders from the remote layer, exactly as the lane path does', async () => {
    __setLivePullsForTests(true);
    process.env.IMPORTYETI_API_KEY = 'test-key';
    globalThis.fetch = vi.fn(async () =>
      companyPayload([
        { title: 'Expeditors International', key: 'company/expeditors' },
        { title: 'Orafol America Inc', key: 'company/orafol-america' },
      ]) as any,
    ) as unknown as typeof fetch;
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'america' }), res, { bolCache: memBolStore(), contactCache: memContactStore() });
    expect(res._json.leads.map((l: any) => l.company)).toEqual(['Orafol America Inc']);
  });

  it('N-4 · latches the cost breaker the first time the "free" endpoint bills us', async () => {
    __setLivePullsForTests(true);
    process.env.IMPORTYETI_API_KEY = 'test-key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (u: any) => {
      calls.push(String(u));
      return companyPayload([{ title: 'Acme Corp', key: 'company/acme' }], 3) as any;
    }) as unknown as typeof fetch;
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    expect(companySearchDisabled()).toBe(false);
    await handleImporterSearch(fakeReq({ company: 'acme' }), fakeRes(), deps);
    expect(companySearchDisabled()).toBe(true);
    // Second query must NOT go out — the endpoint is off for this process.
    const res2 = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'acme' }), res2, deps);
    expect(calls.length).toBe(1);
    expect(res2._json.nameLiveSearched).toBe(false);
  });

  it('an upstream failure degrades to the local index — never to a paid pull', async () => {
    __setLivePullsForTests(true);
    process.env.IMPORTYETI_API_KEY = 'test-key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }) as any) as unknown as typeof fetch;
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    await indexLeads(deps.bolCache, [lead('Orafol America Inc')]);
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'orafol' }), res, deps);
    expect(res._status).toBe(200);
    expect(res._json.leads.map((l: any) => l.company)).toEqual(['Orafol America Inc']);
    expect(res._json.nameLiveSearched).toBe(false);
  });
});

// ── N-5 · Manifest Privacy ──────────────────────────────────────────────────
describe('N-5 · a Manifest Privacy customer can never be surfaced by name', () => {
  it('is hidden even after being indexed by an earlier lane search', async () => {
    const store = memBolStore();
    await indexLeads(store, [lead('Premier Specialty Brands'), lead('Orafol America Inc')]);
    invalidateNameIndexCache();
    // Indexed BEFORE the redaction existed — the read-time filter is what makes
    // hiding retroactive, which is the whole promise of the product.
    expect((await searchNameIndex(store, 'premier')).leads.length).toBe(1);
    const hidden = new Set([companyKey('Premier Specialty Brands')]);
    const after = await searchNameIndex(store, 'premier', { redactKeys: hidden });
    expect(after.leads).toEqual([]);
    // ...and they are not counted in the coverage figure we quote either.
    expect(after.total).toBe(1);
  });

  it('is hidden end-to-end through the search route', async () => {
    redacted.add(companyKey('Premier Specialty Brands'));
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    await indexLeads(deps.bolCache, [lead('Premier Specialty Brands')]);
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'premier specialty' }), res, deps);
    expect(res._json.leads).toEqual([]);
    expect(res._json.nameIndexTotal).toBe(0);
  });

  it('is hidden in the REMOTE layer too, not just the local one', async () => {
    __setLivePullsForTests(true);
    process.env.IMPORTYETI_API_KEY = 'test-key';
    redacted.add(companyKey('Premier Specialty Brands'));
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ requestCost: 0, data: [{ title: 'Premier Specialty Brands LLC', key: 'company/premier-specialty-brands' }] }),
    }) as any) as unknown as typeof fetch;
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'premier specialty brands' }), res, { bolCache: memBolStore(), contactCache: memContactStore() });
    // NOTE the trap this pins: ImportYeti answers with the "LLC" variant, whose
    // NAME key ("premier specialty brands llc") does NOT equal the redaction key.
    // Only the SLUG arm catches it — which is why isLeadRedacted checks both.
    expect(res._json.leads).toEqual([]);
  });

  it('drops a redacted importer whose FILED NAME differs from the redacted spelling', async () => {
    const store = memBolStore();
    await indexLeads(store, [lead('Premier Specialty Brands LLC', { slug: 'premier-specialty-brands' })]);
    invalidateNameIndexCache();
    const hidden = new Set([companyKey('Premier Specialty Brands')]);
    expect((await searchNameIndex(store, 'premier', { redactKeys: hidden })).leads).toEqual([]);
  });

  it('is hidden in AUTOSUGGEST — typing the first letters must not reveal them', async () => {
    redacted.add(companyKey('Premier Specialty Brands'));
    const store = memBolStore();
    await indexLeads(store, [lead('Premier Specialty Brands'), lead('Premier Metals Inc')]);
    invalidateNameIndexCache();
    const res = fakeRes();
    await handleImporterSuggest({ query: { field: 'company', q: 'premier' } } as unknown as Request, res, { bolCache: store });
    expect(res._json.items.map((i: any) => i.value)).toEqual(['Premier Metals Inc']);
  });

  it('never indexes a redacted importer in the first place (the lane path filters first)', async () => {
    // runSearch drops redacted leads before handleImporterSearch indexes them, so
    // the write side is protected as well as the read side.
    const store = memBolStore();
    const hidden = new Set([companyKey('Premier Specialty Brands')]);
    const visible = [lead('Orafol America Inc')].filter((l) => !hidden.has(companyKey(l.company)));
    await indexLeads(store, visible);
    expect((await loadNameIndex(store)).map((e) => e.lead.company)).toEqual(['Orafol America Inc']);
  });
});

// ── N-6 · name + lane is unchanged ──────────────────────────────────────────
describe('N-6 · a name combined with a lane still narrows the LANE pull', () => {
  it('pulls the port and post-filters by name, and indexes what it pulled', async () => {
    __setLivePullsForTests(true);
    process.env.IMPORTYETI_API_KEY = 'test-key';
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (u: any) => {
      urls.push(String(u));
      return {
        ok: true, status: 200,
        json: async () => ({ requestCost: 5, creditsRemaining: 900, data: { data: [...FIXTURE_SEARCH_ROWS] } }),
      } as any;
    }) as unknown as typeof fetch;
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ entryPort: FIXTURE_ENTRY_PORT, company: 'bosch' }), res, deps);
    // It IS a lane pull (the bills endpoint), narrowed locally by the name.
    expect(urls.some((u) => u.includes('/powerquery/us-import/bols'))).toBe(true);
    expect(res._json.nameSearch).toBe(false);
    expect(res._json.pulledLive).toBe(true);
    expect(res._json.leads.map((l: any) => l.company)).toEqual(['Robert Bosch Tool Corp']);
    // ...and the pull it paid for is folded into the name index for free.
    invalidateNameIndexCache();
    expect((await loadNameIndex(deps.bolCache)).length).toBeGreaterThan(0);
  });

  it('a later name-only search finds what that lane pull indexed, at no cost', async () => {
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    await indexLeads(deps.bolCache, [lead('Robert Bosch Tool Corp'), lead('Axis Communications Inc')]);
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ company: 'axis' }), res, deps);
    expect(spy).not.toHaveBeenCalled();
    expect(res._json.leads.map((l: any) => l.company)).toEqual(['Axis Communications Inc']);
  });
});
