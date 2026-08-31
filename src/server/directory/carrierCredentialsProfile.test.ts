/**
 * WHAT THE CARRIER PROFILE IS ALLOWED TO SAY about a real company's insurance
 * and tenure.
 *
 * These pages are public, indexable and name real businesses, so the assertions
 * here are mostly about restraint:
 *   1. A FILING IS NOT COVERAGE — never "insured", never "verified".
 *   2. ABSENCE IS NOT A NEGATIVE — no "Not on file" row for the ~96% of carriers
 *      that were never required to carry cargo insurance or a bond.
 *   3. A REGISTRATION DATE IS NOT A FOUNDING DATE.
 *   4. A RATING TRAVELS WITH ITS DATE — most published ratings are years old.
 *   5. THE SOURCE FILE IS FROZEN, so the figures carry its refresh date.
 * Plus the global no-orphan rule and a crawl-budget cap on the whole block.
 */
import { describe, expect, it } from 'vitest';
import { renderCarrierProfile } from './pages.js';
import type { VisibleCarrier } from './queries.js';
import { EMPTY_SAFETY, type CarrierSafety } from './safetyData.js';
import { EMPTY_CREDENTIALS, type CarrierCredentials } from './carrierCredentials.js';

const FULL_SAFETY: CarrierSafety = {
  inspTotal: 5043,
  driverInspTotal: 5034,
  driverOosTotal: 26,
  vehicleInspTotal: 2658,
  vehicleOosTotal: 381,
  crashesTotal: 200,
  crashesFatal: 7,
  crashesInjury: 67,
  crashesTow: 192,
  safetyDataAsOf: new Date('2026-08-30T00:00:00Z'),
};

/** The common shape: a liability filing above the federal floor, real tenure. */
const TYPICAL: CarrierCredentials = {
  bipdOnFile: 1_000_000,
  bipdRequired: 750_000,
  cargoInsuranceOnFile: false,
  bondOnFile: false,
  fmcsaRegisteredSince: new Date(Date.UTC(2012, 3, 13)),
  safetyRatingDate: new Date(Date.UTC(2000, 9, 24)),
};
/** Every filing present — the widest the block ever gets. */
const MAXIMAL: CarrierCredentials = { ...TYPICAL, cargoInsuranceOnFile: true, bondOnFile: true };

function carrier(over: Partial<VisibleCarrier> = {}): VisibleCarrier {
  return {
    slug: 'acme-drayage-inc-107080',
    legalName: 'ACME DRAYAGE INC',
    dbaName: null,
    usdot: '107080',
    mcNumber: 'MC012892',
    city: 'SAVANNAH',
    state: 'GA',
    zip: '31401',
    phone: '9125550921',
    email: 'dispatch@acme.com',
    contactHidden: false,
    powerUnits: 25,
    drivers: 30,
    safetyRating: 'S',
    authorityType: 'common',
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
    nearestPortCode: 'USSAV',
    aboutOverride: null,
    capabilities: {},
    operatingLocations: [],
    provenance: { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' },
    safety: EMPTY_SAFETY,
    credentials: TYPICAL,
    ...over,
  } as VisibleCarrier;
}

describe('insurance filings — present', () => {
  const html = renderCarrierProfile({ carrier: carrier() });

  it('publishes the liability amount on file', () => {
    expect(html).toContain('Insurance filings on record');
    expect(html).toContain('Liability (BIPD)');
    expect(html).toContain('$1,000,000');
  });

  it('prints the federal minimum beside it, so the figure has a scale', () => {
    // Without this, $750,000 reads as an achievement rather than as the legal
    // floor. Same neutral-context device the out-of-service rates use.
    expect(html).toContain('federal minimum for this authority $750,000');
  });

  it('says FILING ON RECORD — never "insured", "verified" or "guaranteed"', () => {
    const block = html.slice(html.indexOf('Insurance filings on record'));
    expect(block).toContain('filing on record is not proof of current coverage');
    expect(block).not.toMatch(/\binsured\b|\bfully covered\b|\bguaranteed\b/i);
    expect(html).not.toMatch(/insurance verified|verified insurance/i);
  });

  it('tells the reader to get a certificate before tendering', () => {
    expect(html).toContain('ask the carrier for a certificate of insurance before tendering');
  });

  it('dates the figures to the frozen L&I extract, not to today', () => {
    expect(html).toContain('last refreshed 14 May 2026');
  });

  it('renders cargo and bond rows only when those filings exist', () => {
    expect(html).not.toContain('Cargo insurance');
    expect(html).not.toContain('Surety bond');
    const max = renderCarrierProfile({ carrier: carrier({ credentials: MAXIMAL }) });
    expect(max).toContain('Cargo insurance');
    expect(max).toContain('Surety bond');
  });

  it('never writes a "Not on file" line — absence is not a black mark', () => {
    // Cargo insurance is required of 2.2% of carriers and a bond of 8.5%, so a
    // "Not on file" row would smear the overwhelming majority who were never
    // required to have one.
    expect(html).not.toMatch(/not on file|no insurance|uninsured/i);
  });
});

describe('insurance filings — absent (must not read as a warning)', () => {
  for (const [label, credentials] of [
    ['empty credentials', EMPTY_CREDENTIALS],
    ['no credentials at all', null],
    ['a requirement but no filing', { ...EMPTY_CREDENTIALS, bipdRequired: 750_000 }],
  ] as Array<[string, CarrierCredentials | null]>) {
    it(`omits the whole card entirely — ${label}`, () => {
      const html = renderCarrierProfile({ carrier: carrier({ credentials }) });
      expect(html).not.toContain('Insurance filings on record');
      expect(html).not.toMatch(/not on file|uninsured|no liability/i);
    });

    it(`never invents a $0 figure — ${label}`, () => {
      const html = renderCarrierProfile({ carrier: carrier({ credentials }) });
      expect(html).not.toContain('$0');
    });
  }
});

describe('safety rating carries its assignment date', () => {
  it('shows when the rating was assigned', () => {
    // This row's Satisfactory rating is from the year 2000. Publishing it
    // undated would present a 26-year-old judgement as current.
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('assigned Oct 24, 2000');
  });

  it('adds NO date line for an unrated carrier', () => {
    // An unrated carrier has nothing to date, and a dangling line would imply
    // something is missing. 97.6% of carriers are unrated; that is the norm.
    const html = renderCarrierProfile({
      carrier: carrier({ safetyRating: null, credentials: { ...TYPICAL, safetyRatingDate: null } }),
    });
    expect(html).toContain('Not rated');
    expect(html).not.toContain('assigned ');
  });

  it('does not date a rating we do not have, even if a stray date is stored', () => {
    const html = renderCarrierProfile({ carrier: carrier({ safetyRating: null }) });
    expect(html).not.toContain('assigned Oct 24, 2000');
  });
});

describe('credential fact chips', () => {
  const html = renderCarrierProfile({ carrier: carrier() });

  it('shows tenure as a registration fact, not a founding claim', () => {
    expect(html).toContain('FMCSA-registered since 2012');
    expect(html).not.toMatch(/in business since|founded in|established in/i);
  });

  it('shows the liability filing as a scannable credential', () => {
    expect(html).toContain('$1,000,000 liability on file');
  });

  it('renders them as neutral OUTLINE chips, never another bright fill', () => {
    // Positive credentials are outline-and-tint. Eight saturated badges would
    // be noise, and a filled "insurance" badge would read as certification.
    expect(html).toContain('class="cp-badge cp-badge--fact"');
  });

  it('omits the tenure chip when the date was the bulk-load sentinel', () => {
    // Asserted on the CHIP, not on the string: the About prose legitimately
    // calls the company "an active FMCSA-registered motor carrier", which is a
    // statement about authority, not about how long it has been registered.
    const html2 = renderCarrierProfile({
      carrier: carrier({ credentials: { ...TYPICAL, fmcsaRegisteredSince: null } }),
    });
    expect(html2).not.toContain('FMCSA-registered since');
    expect(html2).not.toMatch(/cp-badge--fact">FMCSA-registered/);
  });

  it('does NOT repeat fleet size or the inspection count as chips', () => {
    // Fleet is already in the FMCSA snapshot grid on this same tab, and a bare
    // inspection count without the out-of-service rates beside it would strip
    // the context that keeps the number honest.
    const withSafety = renderCarrierProfile({ carrier: carrier({ safety: FULL_SAFETY }) });
    expect(withSafety).not.toContain('>5,043 roadside inspections<');
    expect(withSafety).not.toContain('>25 power units<');
  });
});

describe('layout — no badge or figure is ever stranded alone on a line', () => {
  it('keeps the fixed-count badge groups inside the orphan-safe 1..6 range', () => {
    for (const sample of [carrier(), carrier({ credentials: MAXIMAL }), carrier({ credentials: null })]) {
      const html = renderCarrierProfile({ carrier: sample });
      for (const m of html.matchAll(/class="cp-badgegroup[^"]*" data-n="(\d+)"/g)) {
        const n = Number(m[1]);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(6);
      }
    }
  });

  it('puts the variable-length fact chips in a structurally orphan-safe row', () => {
    // `.cp-chiprow` spans the first chip across both columns on an ODD count, so
    // the last line always holds >=2 — the fixed data-n map only covers 1..6 and
    // this row's length depends on which filings exist.
    const html = renderCarrierProfile({ carrier: carrier({ credentials: MAXIMAL }) });
    expect(html).toContain('class="cp-chiprow cp-factrow"');
  });

  it('gives the 1-to-3-row insurance grid the same odd-count rule', () => {
    const html = renderCarrierProfile({ carrier: carrier({ credentials: MAXIMAL }) });
    expect(html).toContain('class="cp-datagrid cp-datagrid--auto"');
  });

  it('leaves the roadside-inspection grid at exactly four items', () => {
    // The insurance card sits ABOVE the safety record, so it must not leak a
    // fifth figure into that 2x2 grid (which PR #461's visual gate fixed).
    const html = renderCarrierProfile({ carrier: carrier({ safety: FULL_SAFETY, credentials: MAXIMAL }) });
    const block = html.slice(html.indexOf('Roadside inspection'));
    expect((block.match(/class="cp-dt"/g) ?? []).length).toBe(4);
  });
});

describe('the Credentials card', () => {
  it('renders when only fact chips exist (no solid credential badges)', () => {
    const html = renderCarrierProfile({
      carrier: carrier({ authorityType: null, intermodal: false, hazmat: false, safetyRating: null }),
    });
    expect(html).toContain('Credentials');
    expect(html).toContain('$1,000,000 liability on file');
  });

  it('disappears entirely when there is nothing to show', () => {
    const html = renderCarrierProfile({
      carrier: carrier({
        authorityType: null,
        intermodal: false,
        hazmat: false,
        safetyRating: null,
        credentials: EMPTY_CREDENTIALS,
      }),
    });
    expect(html).not.toContain('<h2 class="cp-h">Credentials</h2>');
  });

  it('leads the Overview tab, ahead of the raw FMCSA snapshot', () => {
    // The scannable credential summary is what a shipper judges on; the
    // identifier grid is reference material.
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html.indexOf('>Credentials<')).toBeLessThan(html.indexOf('>FMCSA snapshot<'));
  });
});

describe('structured data states the real country', () => {
  it('uses the stored domicile instead of assuming US', () => {
    const ca = renderCarrierProfile({ carrier: carrier({ country: 'CA', state: 'ON', city: 'TORONTO' }) });
    expect(ca).toContain('"addressCountry":"CA"');
    const us = renderCarrierProfile({ carrier: carrier({ country: 'US' }) });
    expect(us).toContain('"addressCountry":"US"');
  });

  it('still says US when no country is stored', () => {
    expect(renderCarrierProfile({ carrier: carrier({ country: null }) })).toContain('"addressCountry":"US"');
  });
});

describe('crawl budget', () => {
  /**
   * Every byte here ships on ~330k near-identical pages, so the credential block
   * has to pay for itself. Measured ~855 B for the typical carrier (a liability
   * filing plus tenure) and ~1,187 B with every filing present; the cap leaves
   * room for copy edits but not for a redesign that reintroduces page bloat.
   */
  const BUDGET_BYTES = 1_600;
  const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
  const bare = bytes(renderCarrierProfile({ carrier: carrier({ credentials: EMPTY_CREDENTIALS }) }));

  it('stays inside the byte budget with every filing present', () => {
    const max = bytes(renderCarrierProfile({ carrier: carrier({ credentials: MAXIMAL }) }));
    expect(max - bare).toBeGreaterThan(0);
    expect(max - bare).toBeLessThan(BUDGET_BYTES);
  });

  it('costs a carrier with NO credential data absolutely nothing', () => {
    // 5.0% of carriers have no liability filing at all. Their pages must not pay
    // for a feature they cannot show.
    expect(bytes(renderCarrierProfile({ carrier: carrier({ credentials: null }) }))).toBe(bare);
  });
});
