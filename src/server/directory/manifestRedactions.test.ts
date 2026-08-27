/**
 * Manifest Privacy redaction — the "Hidden on QuoteFleet" choke-point.
 *
 * Asserts:
 *   • isKeyRedacted matches a company name against the set using the SAME
 *     companyKey normalization the redaction is stored under (so search + profile
 *     choke-points agree).
 *   • findImporterLeads drops a redacted importer from search results AND spends
 *     no ImportYeti credit (served from cache, redaction applied post-dedup).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isKeyRedacted } from './manifestRedactions.js';
import { companyKey } from './importerCache.js';
import { findImporterLeads, type BolRow } from './importerLeads.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('isKeyRedacted — normalization parity with companyKey', () => {
  const set = new Set([companyKey('Acme Imports LLC')]);
  it('matches regardless of case/punctuation/spacing', () => {
    expect(isKeyRedacted(set, 'ACME  imports,  LLC')).toBe(true);
    expect(isKeyRedacted(set, 'acme imports llc')).toBe(true);
  });
  it('does not match a different company', () => {
    expect(isKeyRedacted(set, 'Beta Trading Co')).toBe(false);
  });
  it('is false for an empty name', () => {
    expect(isKeyRedacted(set, '')).toBe(false);
  });
});

describe('findImporterLeads — redaction removes a company from search (no credit)', () => {
  it('drops the redacted importer and never calls ImportYeti (cache hit)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const cachedRows: BolRow[] = [
      { company_name: 'Acme Imports LLC', company_shipments_12m: 500, entry_port: 'Savannah, GA' },
      { company_name: 'Beta Trading Co', company_shipments_12m: 200, entry_port: 'Savannah, GA' },
    ];
    const store = {
      get: vi.fn(async () => ({ rows: cachedRows, creditsRemaining: 10, fetchedAt: new Date() })),
      put: vi.fn(async () => {}),
    };
    const redactKeys = new Set([companyKey('Acme Imports LLC')]);
    const { leads, cached, pulledLive } = await findImporterLeads({
      filters: { entryPort: 'Savannah, GA' },
      bolCache: store,
      cacheKey: 'k-redact',
      redactKeys,
    });
    // Redacted importer is gone; the other remains.
    expect(leads.map((l) => l.company)).toEqual(['Beta Trading Co']);
    // Served from cache — ZERO credits spent on a redacted profile / search.
    expect(cached).toBe(true);
    expect(pulledLive).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('without a redaction set, both importers are returned', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const cachedRows: BolRow[] = [
      { company_name: 'Acme Imports LLC', company_shipments_12m: 500 },
      { company_name: 'Beta Trading Co', company_shipments_12m: 200 },
    ];
    const store = {
      get: vi.fn(async () => ({ rows: cachedRows, creditsRemaining: 10, fetchedAt: new Date() })),
      put: vi.fn(async () => {}),
    };
    const { leads } = await findImporterLeads({
      filters: { entryPort: 'Savannah, GA' },
      bolCache: store,
      cacheKey: 'k-noredact',
    });
    expect(leads.map((l) => l.company).sort()).toEqual(['Acme Imports LLC', 'Beta Trading Co']);
  });
});
