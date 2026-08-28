/**
 * Importer-leads engine — pure-logic + guard tests (no live network).
 *
 * Focus areas that matter for correctness AND for the outage-safety invariants:
 *   • forwarder filter + dedup (the #1 data trap)
 *   • Hunter precision guard (domainMatchesCompany) — reject fuzzy drift
 *   • timeout wrapper aborts a hung call
 *   • mapLimit bounds concurrency
 *   • browse path pulls ImportYeti ONLY (never Hunter/Anthropic), caps at MAX_LEADS
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  isForwarder,
  dedupImporters,
  domainMatchesCompany,
  toLead,
  toCSV,
  winnability,
  aiAngle,
  mapLimit,
  fetchWithTimeout,
  pullImportBols,
  enrichContact,
  resolveContactTiered,
  findImporterLeads,
  MAX_LEADS,
  ROLE_LOCALPARTS,
  CONTACT_TIER_COPY,
  TIER_ORDER,
  type BolRow,
  type ContactConfidence,
  type TieredContact,
} from './importerLeads.js';
import { __setLivePullsForTests } from './externalPullGuard.js';

const realFetch = globalThis.fetch;
// The specs below drive the LIVE provider paths against a MOCKED fetch, so they
// opt in to the cost guard explicitly. The opt-in is in-code only (no env var can
// do it under a test runner), so it can never reach a real provider. The guard's
// own default-OFF / zero-fetch contract is covered in externalPullGuard.test.ts.
beforeEach(() => {
  __setLivePullsForTests(true);
});
afterEach(() => {
  __setLivePullsForTests(null); // back to the default: OFF
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.IMPORTYETI_API_KEY;
  delete process.env.HUNTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

describe('isForwarder', () => {
  it('flags forwarders / NVOCCs / brokers', () => {
    for (const n of ['Expeditors Intl', 'DHL Global Forwarding', 'ACME Logistics LLC', 'Ocean Freight Co', 'Kuehne Nagel']) {
      expect(isForwarder(n)).toBe(true);
    }
  });
  it('passes real importers through', () => {
    for (const n of ['Robert Bosch Tool Corp', 'Komatsu America Corp', 'Premier Specialty Brands']) {
      expect(isForwarder(n)).toBe(false);
    }
  });
});

describe('dedupImporters', () => {
  const rows: BolRow[] = [
    { company_name: 'Bosch Tool Corp', company_shipments_12m: 100 },
    { company_name: 'Bosch Tool Corp', company_shipments_12m: 300 }, // higher 12m wins
    { company_name: 'DHL Global Forwarding', company_shipments_12m: 999 }, // forwarder → dropped
    { company_name: 'Secret Importer', company_shipments_12m: 50, company_manifest_confidentiality: true }, // dropped
    { company_name: 'Komatsu America', company_shipments_12m: 200 },
  ];
  it('drops forwarders + confidential, keeps highest 12m per company, sorts desc', () => {
    const out = dedupImporters(rows);
    expect(out.map((r) => r.company_name)).toEqual(['Bosch Tool Corp', 'Komatsu America']);
    expect(out[0].company_shipments_12m).toBe(300);
  });
});

describe('domainMatchesCompany (precision guard)', () => {
  it('accepts a host that shares a distinctive token', () => {
    expect(domainMatchesCompany('Robert Bosch Tool Corp', 'bosch.com')).toBe(true);
    expect(domainMatchesCompany('Axis Communications AB', 'axis.com')).toBe(true);
  });
  it('accepts a solid substring hit', () => {
    expect(domainMatchesCompany('Global Stone Impex', 'globalstoneimpex.com')).toBe(true);
  });
  it('REJECTS a fuzzy drift with no shared token', () => {
    expect(domainMatchesCompany('Robert Bosch Tool Corp', 'motopaja.fi')).toBe(false);
    expect(domainMatchesCompany('Premier Specialty Brands', 'randomvendor.io')).toBe(false);
  });
});

describe('toLead', () => {
  it('maps fields and derives state from the address', () => {
    const lead = toLead({
      company_name: 'Komatsu America Corp',
      company_address: '535 Mawsons Way, Newberry, SC 29108',
      supplier_name: 'Komatsu Changzhou',
      supplier_country_code: 'CN',
      product_description: 'Loader frames',
      hs_code: '843149',
      entry_port: 'Savannah, GA',
      company_shipments_12m: 6644,
      company_total_shipments: 68033,
      notify_party_name: 'Some Forwarder',
      arrival_date: '07/31/2026',
    });
    expect(lead.company).toBe('Komatsu America Corp');
    expect(lead.state).toBe('SC');
    expect(lead.supplier_country).toBe('CN');
    expect(lead.ships_12m).toBe(6644);
    expect(lead.incumbent_forwarder).toBe('Some Forwarder');
    // No enrichment → contact fields null.
    expect(lead.email).toBeNull();
    expect(lead.contact_name).toBeNull();
  });
});

describe('toCSV', () => {
  it('emits a header + CSV-escapes values', () => {
    const csv = toCSV([toLead({ company_name: 'Acme "Big" Co', company_shipments_12m: 5 })]);
    const [header, row] = csv.split('\n');
    expect(header.startsWith('company,state,supplier')).toBe(true);
    expect(row).toContain('"Acme ""Big"" Co"');
  });
});

describe('winnability + aiAngle', () => {
  it('scores within bounds and labels High/Medium', () => {
    const hi = toLead({ company_name: 'Big Importer', company_shipments_12m: 5000, notify_party_name: 'Expeditors' });
    const w = winnability(hi);
    expect(w.score).toBeGreaterThanOrEqual(53);
    expect(w.score).toBeLessThanOrEqual(94);
    expect(['High', 'Medium']).toContain(w.label);
  });
  it('aiAngle names the incumbent when present, else says none named', () => {
    const withInc = toLead({ company_name: 'X', entry_port: 'Savannah, GA', notify_party_name: 'Expeditors Intl' });
    expect(aiAngle(withInc)).toContain('Expeditors Intl');
    const noInc = toLead({ company_name: 'X', entry_port: 'Savannah, GA' });
    expect(aiAngle(noInc)).toContain('no forwarder named');
  });
});

describe('mapLimit', () => {
  it('preserves order and never exceeds the concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const out = await mapLimit(items, 3, async (x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return x * 2;
    });
    expect(out).toEqual(items.map((x) => x * 2));
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});

describe('fetchWithTimeout', () => {
  it('aborts a hung request at the timeout', async () => {
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    }) as unknown as typeof fetch;
    await expect(fetchWithTimeout('https://slow.example', {}, 20)).rejects.toThrow(/abort/i);
  });
});

describe('pullImportBols / enrichContact key guards', () => {
  it('pullImportBols throws a clean error when the key is unset', async () => {
    await expect(pullImportBols({ entryPort: 'Savannah, GA' })).rejects.toThrow(/IMPORTYETI_API_KEY not set/);
  });
  it('enrichContact throws a clean error when the key is unset', async () => {
    await expect(enrichContact('Bosch')).rejects.toThrow(/HUNTER_API_KEY not set/);
  });
  it('enrichContact requests Hunter with limit=10 and applies the precision guard', async () => {
    process.env.HUNTER_API_KEY = 'test';
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      seen.push(url);
      return {
        ok: true,
        json: async () => ({ data: { domain: 'motopaja.fi', emails: [{ value: 'a@motopaja.fi', confidence: 90 }] } }),
      } as Response;
    }) as unknown as typeof fetch;
    // Fuzzy drift (Bosch → motopaja.fi) must be rejected → null.
    const c = await enrichContact('Robert Bosch Tool Corp');
    expect(c).toBeNull();
    expect(seen[0]).toContain('limit=10');
  });
});

describe('resolveContactTiered (never-empty fallback tiers)', () => {
  it('tier 1 — verified decision-maker email from Hunter', async () => {
    process.env.HUNTER_API_KEY = 'test';
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: { domain: 'bosch.com', emails: [{ value: 'j.smith@bosch.com', first_name: 'J', last_name: 'Smith', position: 'Head of Logistics', confidence: 95 }] },
      }),
    })) as unknown as typeof fetch;
    const c = await resolveContactTiered('Robert Bosch Tool Corp', { phone: '555', address: 'A' });
    expect(c.contact_confidence).toBe('verified');
    expect(c.email).toBe('j.smith@bosch.com');
  });

  it('tier 2 — role-based (unverified) when the domain resolves but no named DM', async () => {
    process.env.HUNTER_API_KEY = 'test';
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { domain: 'bosch.com', emails: [] } }),
    })) as unknown as typeof fetch;
    const c = await resolveContactTiered('Robert Bosch Tool Corp', { phone: '555', address: 'A' });
    expect(c.contact_confidence).toBe('role_based');
    expect(c.role_emails).toEqual(ROLE_LOCALPARTS.map((lp) => `${lp}@bosch.com`));
  });

  it('tier 3 — phone_only fallback (never empty) when Hunter has nothing / no key', async () => {
    // No HUNTER_API_KEY set → resolveContactTiered must NOT throw, degrade to phone_only.
    const c = await resolveContactTiered('Some Importer', { phone: '555-123', address: '1 Main St' });
    expect(c.contact_confidence).toBe('phone_only');
    expect(c.phone).toBe('555-123');
    expect(c.address).toBe('1 Main St');
  });
});

/* ── HONEST CLAIMS: what a tier SAYS must equal what it HANDS OVER ───────────
 * The audit that produced this suite found the paid `phone_only` tier selling
 * "the phone & address on file" while the street address renders FREE on the
 * importer profile (identity header + Organization JSON-LD). The address is not
 * scarce — it is on the company's own website — so the decision was to keep it
 * free and stop claiming it. These specs are the regression fence. */
describe('CONTACT_TIER_COPY — every tier claims only what it delivers', () => {
  /** Street address, but NOT the "address" inside "email address". */
  const STREET_ADDRESS = /(?<!e-?mail\s)\baddress(es)?\b/i;
  const prose = (t: ContactConfidence): string =>
    `${CONTACT_TIER_COPY[t].badge} ${CONTACT_TIER_COPY[t].blurb}`;

  /** Resolve a real TieredContact for each tier through the real code path, so
   *  `delivers` is checked against actual output rather than a second opinion. */
  async function resolveTier(tier: ContactConfidence): Promise<TieredContact> {
    if (tier === 'phone_only') {
      delete process.env.HUNTER_API_KEY; // no key → honest degrade
      return resolveContactTiered('Some Importer', { phone: '555-123', address: '1 Main St' });
    }
    process.env.HUNTER_API_KEY = 'test';
    const emails =
      tier === 'verified'
        ? [{ value: 'j.smith@bosch.com', first_name: 'J', last_name: 'Smith', position: 'Head of Logistics', confidence: 95 }]
        : [];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { domain: 'bosch.com', emails } }),
    })) as unknown as typeof fetch;
    return resolveContactTiered('Robert Bosch Tool Corp', { phone: '555', address: '1 Main St' });
  }

  it('covers every tier exactly once, best-first', () => {
    expect([...TIER_ORDER]).toEqual(['verified', 'role_based', 'phone_only']);
    expect(Object.keys(CONTACT_TIER_COPY).sort()).toEqual([...TIER_ORDER].sort());
  });

  it.each([...TIER_ORDER])('%s actually delivers every field it promises', async (tier) => {
    const c = await resolveTier(tier);
    expect(c.contact_confidence).toBe(tier);
    for (const field of CONTACT_TIER_COPY[tier].delivers) {
      const v = c[field];
      const present = Array.isArray(v) ? v.length > 0 : v != null && v !== '';
      expect(present, `${tier} promises "${String(field)}" but resolved ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it.each([...TIER_ORDER])('%s never sells the street address (it is free on the profile)', (tier) => {
    expect(CONTACT_TIER_COPY[tier].delivers).not.toContain('address');
    expect(prose(tier)).not.toMatch(STREET_ADDRESS);
  });

  it('verified promises a named person, a title and a verified email', () => {
    const { blurb, delivers } = CONTACT_TIER_COPY.verified;
    expect(delivers).toEqual(expect.arrayContaining(['contact_name', 'title', 'email']));
    expect(blurb).toMatch(/named/i);
    expect(blurb).toMatch(/title/i);
    expect(blurb).toMatch(/verified[^.]*email/i);
  });

  it('role_based says plainly that it is a role inbox, not a named person', () => {
    const { badge, blurb, delivers } = CONTACT_TIER_COPY.role_based;
    expect(delivers).not.toContain('contact_name');
    expect(delivers).not.toContain('email');
    expect(delivers).toEqual(expect.arrayContaining(['role_emails']));
    expect(`${badge} ${blurb}`).toMatch(/role-based/i);
    expect(blurb).toMatch(/not a named person/i);
  });

  it('phone_only claims the phone and nothing else', () => {
    const { badge, blurb, delivers } = CONTACT_TIER_COPY.phone_only;
    expect([...delivers]).toEqual(['phone']);
    expect(`${badge} ${blurb}`).toMatch(/phone|number/i);
    // No email of any kind is delivered at this tier, so none may be implied.
    expect(`${badge} ${blurb}`).not.toMatch(/\bemail\b|\binbox\b/i);
  });
});

describe('toLead address', () => {
  it('carries the physical address (phone_only tier source)', () => {
    const lead = toLead({ company_name: 'X', company_address: '1 Main St, Newberry, SC 29108', company_main_phone_number: '555' });
    expect(lead.address).toBe('1 Main St, Newberry, SC 29108');
    expect(lead.phone).toBe('555');
  });
});

describe('findImporterLeads (browse path)', () => {
  beforeEach(() => {
    process.env.IMPORTYETI_API_KEY = 'test';
  });
  it('pulls ImportYeti ONLY (never Hunter/Anthropic) and caps at MAX_LEADS', async () => {
    const calls: string[] = [];
    const rows = Array.from({ length: 60 }, (_, i) => ({
      company_name: `Importer ${i}`,
      company_shipments_12m: 1000 - i,
      entry_port: 'Savannah, GA',
      supplier_country_code: 'DE',
    }));
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ requestCost: 1, creditsRemaining: 99, data: { data: rows } }) } as Response;
    }) as unknown as typeof fetch;

    const { leads, creditsRemaining } = await findImporterLeads({ filters: { entryPort: 'Savannah, GA' } });
    expect(leads.length).toBe(MAX_LEADS);
    expect(creditsRemaining).toBe(99);
    // Exactly one external call, and it was ImportYeti (no hunter.io / anthropic.com).
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('data.importyeti.com');
    expect(calls.some((u) => /hunter\.io|anthropic\.com/.test(u))).toBe(false);
  });
  it('serves a fresh cached result set WITHOUT calling ImportYeti', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const cachedRows: BolRow[] = [{ company_name: 'Cached Co', company_shipments_12m: 5, entry_port: 'Savannah, GA' }];
    const store = {
      get: vi.fn(async () => ({ rows: cachedRows, creditsRemaining: 42, fetchedAt: new Date() })),
      put: vi.fn(async () => {}),
    };
    const { leads, creditsRemaining, cached } = await findImporterLeads({
      filters: { entryPort: 'Savannah, GA' },
      bolCache: store,
      cacheKey: 'k1',
    });
    expect(cached).toBe(true);
    expect(creditsRemaining).toBe(42);
    expect(leads[0].company).toBe('Cached Co');
    expect(fetchSpy).not.toHaveBeenCalled(); // ZERO external credits on a cache hit
    expect(store.put).not.toHaveBeenCalled();
  });

  it('on a cache MISS pulls ImportYeti and writes the result back', async () => {
    const rows: BolRow[] = [{ company_name: 'Fresh Co', company_shipments_12m: 9, entry_port: 'Savannah, GA' }];
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ requestCost: 1, creditsRemaining: 7, data: { data: rows } }),
    })) as unknown as typeof fetch;
    const store = { get: vi.fn(async () => null), put: vi.fn(async () => {}) };
    const { cached } = await findImporterLeads({ filters: { entryPort: 'Savannah, GA' }, bolCache: store, cacheKey: 'k2' });
    expect(cached).toBe(false);
    expect(store.put).toHaveBeenCalledWith('k2', rows, 7);
  });

  it('treats a STALE cache row as a miss (TTL)', async () => {
    const rows: BolRow[] = [{ company_name: 'Fresh Co', company_shipments_12m: 9 }];
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ data: { data: rows } }) }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20d old > 14d TTL
    const store = {
      get: vi.fn(async () => ({ rows: [{ company_name: 'Stale Co' }], creditsRemaining: 1, fetchedAt: old })),
      put: vi.fn(async () => {}),
    };
    const { leads, cached } = await findImporterLeads({ filters: { entryPort: 'x' }, bolCache: store, cacheKey: 'k3' });
    expect(cached).toBe(false);
    expect(leads[0].company).toBe('Fresh Co');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('no longer HQ-filters by state — state is ENTRY-geography, not the company HQ', async () => {
    // Both importers enter through Newark but are HQ'd in different states. The
    // old HQ post-filter dropped the NY-HQ'd one when the state locked to NJ;
    // it must now be returned (state is realized via the port upstream).
    const rows: BolRow[] = [
      { company_name: 'NJ HQ Co', company_address: '1 Dock Rd, Newark, NJ 07114', company_shipments_12m: 300, entry_port: 'Newark, NJ' },
      { company_name: 'NY HQ Co', company_address: '5 Wall St, New York, NY 10005', company_shipments_12m: 200, entry_port: 'Newark, NJ' },
    ];
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ data: { data: rows } }),
    })) as unknown as typeof fetch;
    const { leads } = await findImporterLeads({ filters: { entryPort: 'Newark, NJ', state: 'NJ' } });
    // The NY-HQ'd importer is NOT dropped by the locked NJ state.
    expect(leads.map((l) => l.company).sort()).toEqual(['NJ HQ Co', 'NY HQ Co']);
  });

  it('still post-filters by minimum 12-mo shipments (unaffected by the state change)', async () => {
    const rows: BolRow[] = [
      { company_name: 'Big Co', company_shipments_12m: 500, entry_port: 'Savannah, GA' },
      { company_name: 'Small Co', company_shipments_12m: 50, entry_port: 'Savannah, GA' },
    ];
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ data: { data: rows } }),
    })) as unknown as typeof fetch;
    const { leads } = await findImporterLeads({ filters: { entryPort: 'Savannah, GA', minShipments12m: 100 } });
    expect(leads.map((l) => l.company)).toEqual(['Big Co']);
  });

  it('threads the page number through to the ImportYeti pull (pagination)', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ data: { data: [{ company_name: 'P2 Co', company_shipments_12m: 1 }] } }) } as Response;
    }) as unknown as typeof fetch;
    const { pulledLive, recordsScanned } = await findImporterLeads({ filters: { entryPort: 'Savannah, GA' }, page: 3 });
    expect(pulledLive).toBe(true);
    expect(recordsScanned).toBe(1);
    expect(calls[0]).toContain('page=3');
  });

  it('allowLivePull=false vetoes a cache MISS — ZERO ImportYeti calls, empty result', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const store = { get: vi.fn(async () => null), put: vi.fn(async () => {}) };
    const out = await findImporterLeads({
      filters: { entryPort: 'Savannah, GA' },
      bolCache: store,
      cacheKey: 'blocked',
      allowLivePull: false,
    });
    expect(out.leads).toEqual([]);
    expect(out.pulledLive).toBe(false);
    expect(out.cached).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it('allowLivePull=false still serves a fresh CACHE HIT (cache costs nothing)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const store = {
      get: vi.fn(async () => ({ rows: [{ company_name: 'Cached Co', company_shipments_12m: 5 }], creditsRemaining: 9, fetchedAt: new Date() })),
      put: vi.fn(async () => {}),
    };
    const out = await findImporterLeads({
      filters: { entryPort: 'Savannah, GA' },
      bolCache: store,
      cacheKey: 'hit',
      allowLivePull: false,
    });
    expect(out.cached).toBe(true);
    expect(out.pulledLive).toBe(false);
    expect(out.leads[0].company).toBe('Cached Co');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
