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
  findImporterLeads,
  MAX_LEADS,
  type BolRow,
} from './importerLeads.js';

const realFetch = globalThis.fetch;
afterEach(() => {
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
  it('post-filters by state and by minimum 12-mo shipments', async () => {
    const rows: BolRow[] = [
      { company_name: 'GA Co', company_address: 'x, GA 30000', company_shipments_12m: 500, entry_port: 'Savannah, GA' },
      { company_name: 'SC Co', company_address: 'y, SC 29000', company_shipments_12m: 50, entry_port: 'Savannah, GA' },
    ];
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ data: { data: rows } }),
    })) as unknown as typeof fetch;
    const { leads } = await findImporterLeads({ filters: { state: 'GA', minShipments12m: 100 } });
    expect(leads.map((l) => l.company)).toEqual(['GA Co']);
  });
});
