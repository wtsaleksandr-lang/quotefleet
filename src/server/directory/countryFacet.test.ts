/**
 * DOMICILE-COUNTRY FACET — the filter behind the hero's flag segment.
 *
 * The owner asked for the reference's 🌐/🇨🇦/🇺🇸/🇲🇽 country control. The measured
 * FMCSA reality is that US-domiciled active property carriers outnumber the
 * cross-border ones ~27:1, and that `carrier_directory` today holds NO non-US
 * rows at all (the ingest tags Canadian carriers only behind INGEST_INCLUDE_CANADA
 * + a re-ingest, and drops Mexico-domiciled carriers outright). So the control is
 * built to be DATA-DRIVEN rather than hard-coded, and these tests pin both halves
 * of that contract:
 *
 *   1. when a country HAS rows, picking it genuinely filters, chips and round-trips;
 *   2. when it does NOT, no flag is rendered for it — ever.
 *
 * (2) is the one that matters. A flag that returns zero carriers is a broken
 * promise, and it is exactly what copying the reference literally would have shipped.
 *
 * Pure render/logic — no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and } from 'drizzle-orm';
import { renderDirectoryResults, renderDirectoryLanding } from './pages.js';
import {
  normalizeFilters,
  buildConditions,
  countriesWithData,
  countryName,
  COUNTRY_OPTIONS,
  FACET_QUERY_KEYS,
  facetCacheKey,
  type FacetCounts,
  type CarrierListResult,
  type VisibleCarrier,
  type DirectorySummary,
} from './queries.js';

const dialect = new PgDialect();
const sqlOf = (f: ReturnType<typeof normalizeFilters>): string => {
  const c = buildConditions(f);
  return c.length ? dialect.sqlToQuery(and(...c)!).sql.toLowerCase() : '';
};

function carrier(overrides: Partial<VisibleCarrier> = {}): VisibleCarrier {
  return {
    slug: 'acme-drayage-inc-107080',
    legalName: 'ACME DRAYAGE INC',
    dbaName: null,
    usdot: '107080',
    mcNumber: 'MC012892',
    city: 'CHICAGO',
    state: 'IL',
    zip: '60601',
    phone: '3125550921',
    email: 'dispatch@acme.com',
    contactHidden: false,
    powerUnits: 25,
    drivers: 30,
    safetyRating: 'S',
    authorityType: 'common',
    intermodal: true,
    nearestPortCode: 'USCHI',
    aboutOverride: null,
    capabilities: {},
    provenance: { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' },
    ...overrides,
  } as VisibleCarrier;
}

/** Facet counts with an explicit country mix (the dimension under test). */
const countsWith = (country: Record<string, number>): FacetCounts =>
  ({
    country,
    fleet: { '1-25': 12 },
    drivers: {},
    equipment: {},
    cargo: {},
    ports: {},
    goodStanding: 2,
    authorityActive: 2,
    intermodal: 2,
    recent: 0,
  }) as unknown as FacetCounts;

const summaryWith = (byCountry: { country: string; count: number }[]): DirectorySummary => ({
  total: byCountry.reduce((s, c) => s + c.count, 0),
  intermodalTotal: 2,
  states: 1,
  byState: [],
  byCountry,
  byPort: [],
});

function list(filters: ReturnType<typeof normalizeFilters>, total = 3): CarrierListResult {
  return { carriers: [carrier()], total, page: 1, perPage: 24, totalPages: 1, filters };
}

/** Render the faceted results page for a given query + country mix. */
function results(query: Record<string, string>, byCountry: { country: string; count: number }[]): string {
  const filters = normalizeFilters(query);
  const country = Object.fromEntries(byCountry.map((c) => [c.country, c.count]));
  return renderDirectoryResults({
    filters,
    list: list(filters),
    counts: countsWith(country),
    summary: summaryWith(byCountry),
  });
}

const MIXED = [
  { country: 'US', count: 330_498 },
  { country: 'CA', count: 12_861 },
];
const US_ONLY = [{ country: 'US', count: 330_498 }];

// ─── 1. The filter actually filters ───────────────────────────────────────

describe('?country= filters the result set', () => {
  it('emits a country predicate on carrier_directory.country', () => {
    const sql = sqlOf(normalizeFilters({ country: 'CA' }));
    expect(sql).toContain('"country"');
    expect(sql).toMatch(/"country"\s*=/);
  });

  it('adds NO predicate when absent — the unfiltered directory is unchanged', () => {
    expect(sqlOf(normalizeFilters({}))).toBe('');
  });

  it('ANDs with other facets rather than replacing them', () => {
    const sql = sqlOf(normalizeFilters({ country: 'CA', fleet: '1-25' }));
    expect(sql).toContain('"country"');
    expect(sql).toContain('power_units');
    expect(sql).toContain(' and ');
  });

  it('accepts only real country codes — junk degrades to unfiltered, never a 200 with zero rows', () => {
    for (const junk of ['ZZ', 'XX', 'US;DROP', '', '1', 'CAN', '🇨🇦']) {
      expect(normalizeFilters({ country: junk }).country, `country=${junk}`).toBeNull();
    }
  });

  it('is case-insensitive on input but canonical upper-case in state', () => {
    expect(normalizeFilters({ country: 'ca' }).country).toBe('CA');
    expect(normalizeFilters({ country: 'Mx' }).country).toBe('MX');
  });

  it('keys the facet-count cache, so two countries can never share one count set', () => {
    const ca = facetCacheKey(normalizeFilters({ country: 'CA' }));
    const us = facetCacheKey(normalizeFilters({ country: 'US' }));
    const none = facetCacheKey(normalizeFilters({}));
    expect(ca).not.toBe(us);
    expect(ca).not.toBe(none);
  });
});

// ─── 2. It round-trips in the URL ─────────────────────────────────────────

describe('?country= round-trips through the URL contract', () => {
  it('is a recognised facet key, so /directory?country=CA opens the RESULTS view', () => {
    expect(FACET_QUERY_KEYS).toContain('country');
  });

  it('survives a normalize → render → re-normalize cycle', () => {
    const first = normalizeFilters({ country: 'CA', fleet: '1-25' });
    expect(first.country).toBe('CA');
    // The rendered page must carry the value forward in its own links.
    const html = results({ country: 'CA', fleet: '1-25' }, MIXED);
    expect(html).toContain('country=CA');
    expect(normalizeFilters({ country: first.country ?? '' }).country).toBe('CA');
  });

  it('every other facet link preserves the active country', () => {
    const html = results({ country: 'CA' }, MIXED);
    // A sibling facet (fleet) must keep country=CA in its href.
    expect(html).toMatch(/href="\/directory\?[^"]*country=CA[^"]*fleet=/);
  });
});

// ─── 3. It appears as a removable applied chip ────────────────────────────

describe('the active country shows as a removable applied chip', () => {
  const html = results({ country: 'CA' }, MIXED);

  it('renders a chip labelled with the country NAME, not the raw code', () => {
    expect(html).toContain('class="applied-chip"');
    expect(html).toContain('Canada');
    expect(countryName('CA')).toBe('Canada');
    expect(countryName('MX')).toBe('Mexico');
  });

  it('the chip removes only the country, leaving siblings intact', () => {
    const withFleet = results({ country: 'CA', fleet: '1-25' }, MIXED);
    // The chip's href drops country= but keeps fleet=.
    const chips = withFleet.match(/<a class="applied-chip" href="([^"]+)"[^>]*>Canada/);
    expect(chips, 'a Canada chip should render').toBeTruthy();
    expect(chips![1]).not.toContain('country=');
    expect(chips![1]).toContain('fleet=1-25');
  });

  it('renders NO country chip when the facet is inactive', () => {
    const plain = results({}, MIXED);
    expect(plain).not.toMatch(/<a class="applied-chip"[^>]*>Canada/);
  });
});

// ─── 4. Only countries WITH DATA are ever offered ─────────────────────────

describe('the control renders only the countries that have data', () => {
  it('returns the present countries, in canonical order, with live counts', () => {
    const present = countriesWithData(MIXED);
    expect(present.map((c) => c.id)).toEqual(['US', 'CA']);
    expect(present.find((c) => c.id === 'CA')!.count).toBe(12_861);
  });

  it('DROPS a country with zero rows — no flag for an empty filter', () => {
    const present = countriesWithData([...MIXED, { country: 'MX', count: 0 }]);
    expect(present.map((c) => c.id)).toEqual(['US', 'CA']);
  });

  it('renders NOTHING when only one country has data — a one-option segment is not a filter', () => {
    expect(countriesWithData(US_ONLY)).toEqual([]);
    expect(countriesWithData([])).toEqual([]);
    expect(countriesWithData(undefined)).toEqual([]);
  });

  it('the landing hero shows the flag segment when 2+ countries have carriers', () => {
    const html = renderDirectoryLanding(summaryWith(MIXED));
    expect(html).toContain('class="dsh-cseg"');
    expect(html).toContain('country=CA');
    // Both present flags render; the absent one does not.
    expect(html).toContain('dsh-flag');
    expect(html).not.toContain('country=MX');
  });

  it('the landing hero OMITS the segment entirely on today’s US-only data', () => {
    const html = renderDirectoryLanding(summaryWith(US_ONLY));
    expect(html).not.toContain('class="dsh-cseg"');
    expect(html).not.toContain('country=US');
    expect(html).not.toContain('country=CA');
  });

  it('the sidebar country group follows the same gate', () => {
    expect(results({}, MIXED)).toContain('FMCSA physical domicile');
    expect(results({}, US_ONLY)).not.toContain('FMCSA physical domicile');
  });
});

// ─── 5. Honesty of the copy the data drives ───────────────────────────────

describe('hero copy states OUR coverage, never the reference’s', () => {
  it('names the cross-border countries only when they have carriers', () => {
    const mixed = renderDirectoryLanding(summaryWith(MIXED));
    expect(mixed).toContain('cross-border operators domiciled in Canada');
    const usOnly = renderDirectoryLanding(summaryWith(US_ONLY));
    expect(usOnly).not.toContain('cross-border');
    expect(usOnly).not.toContain('Canada');
    expect(usOnly).not.toContain('Mexico');
  });

  it('drops "US" from the eyebrow/H1 once non-US domiciles are present', () => {
    const mixed = renderDirectoryLanding(summaryWith(MIXED));
    expect(mixed).toContain('North America carrier directory');
    expect(mixed).toContain('Find the right carrier for your shipment');
    // …and keeps the US framing when the data really is US-only (no regression).
    const usOnly = renderDirectoryLanding(summaryWith(US_ONLY));
    expect(usOnly).toContain('US carrier directory');
    expect(usOnly).toContain('Find the right US carrier for your shipment');
  });

  it('keeps "searchable by …" attached to the verb, coverage aside LAST', () => {
    const mixed = renderDirectoryLanding(summaryWith(MIXED));
    const by = mixed.indexOf('by name, fleet size');
    const aside = mixed.indexOf('cross-border operators domiciled in');
    expect(by).toBeGreaterThan(-1);
    expect(aside).toBeGreaterThan(by);
    // The garden-path ordering must not come back.
    expect(mixed).not.toMatch(/domiciled in [A-Za-z ]+ by name/);
  });

  it('never claims to VERIFY companies — we restate FMCSA status, and say so', () => {
    const html = renderDirectoryLanding(summaryWith(MIXED));
    expect(html).not.toMatch(/verified compan/i);
    expect(html).toContain('FMCSA public records');
  });

  it('never reproduces the reference’s invented million-carrier framing', () => {
    const html = renderDirectoryLanding(summaryWith(MIXED));
    expect(html).not.toContain('1,000,000+');
    expect(html).not.toMatch(/\b1 million\b/i);
  });
});

// ─── 6. The registry itself ───────────────────────────────────────────────

describe('COUNTRY_OPTIONS registry', () => {
  it('covers exactly the codes the schema can hold, with display names', () => {
    expect(COUNTRY_OPTIONS.map((c) => c.id)).toEqual(['US', 'CA', 'MX']);
    for (const c of COUNTRY_OPTIONS) {
      expect(c.name.length).toBeGreaterThan(2);
      expect(c.label).toBe(c.id);
    }
  });
});
