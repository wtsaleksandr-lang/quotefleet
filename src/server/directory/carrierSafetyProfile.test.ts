/**
 * How the FMCSA SAFETY record RENDERS on a public carrier profile.
 *
 * These pages are indexable and name a real company, so the assertions below are
 * as much about what we must NOT print as about what we must. The four rules,
 * each pinned by tests here:
 *
 *   1. No record ⇒ say "no record". Never zeros — "0 crashes" for a carrier we
 *      have no data on invents a spotless history we cannot support.
 *   2. Counts always; a RATE only above a meaningful sample. "1 of 1 = 100%
 *      out-of-service" is noise that would read as a damning statistic.
 *   3. Neutral comparison to the national average — never a grade or a verdict.
 *   4. "Not rated" is the most common value and must be explained as normal,
 *      never implied to be a failure.
 *
 * Pure HTML render (renderCarrierProfile) — no DB, no network.
 */
import { describe, expect, it } from 'vitest';
import { renderCarrierProfile } from './pages.js';
import type { VisibleCarrier } from './queries.js';
import { EMPTY_SAFETY, type CarrierSafety } from './safetyData.js';

const AS_OF = new Date('2026-08-30T00:00:00Z');

/** Real DOT 74432 figures captured from the live FMCSA API on 2026-08-30. */
const REAL_SAFETY: CarrierSafety = {
  inspTotal: 5043,
  driverInspTotal: 5034,
  driverOosTotal: 26,
  vehicleInspTotal: 2658,
  vehicleOosTotal: 381,
  crashesTotal: 200,
  crashesFatal: 7,
  crashesInjury: 67,
  crashesTow: 192,
  safetyDataAsOf: AS_OF,
};

function carrier(overrides: Partial<VisibleCarrier> = {}): VisibleCarrier {
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
    ...overrides,
  } as VisibleCarrier;
}

const render = (safety: CarrierSafety | null | undefined): string =>
  renderCarrierProfile({ carrier: carrier({ safety }) });

describe('safety record — present', () => {
  const html = render(REAL_SAFETY);

  it('shows the inspection and out-of-service counts', () => {
    expect(html).toContain('Roadside inspection &amp; crash record');
    expect(html).toContain('5,043');
    expect(html).toContain('26 of 5,034');
    expect(html).toContain('381 of 2,658');
  });

  it('shows the crash total with its severity split as a sub-line breakdown', () => {
    expect(html).toContain('Reported crashes');
    expect(html).toContain('200');
    expect(html).toContain('7 fatal · 67 with injuries · 192 towed away');
  });

  it('keeps the grid at four items, so no line strands a single figure', () => {
    // 4 stats → clean 2×2 on desktop, 4 stacked at 375px. A 5th would leave an
    // orphan on the last row (the global no-orphan rule).
    const block = html.slice(html.indexOf('Roadside inspection'));
    const grid = block.slice(block.indexOf('cp-datagrid'), block.indexOf('</div>', block.indexOf('cp-datagrid')));
    expect((block.match(/class="cp-dt"/g) ?? []).length).toBe(4);
    expect(grid).toBeTruthy();
  });

  it('puts the national average beside each rate, as neutral arithmetic', () => {
    // 26/5034 = 0.5% vs 5.4% national; 381/2658 = 14.3% vs 21.5% national.
    expect(html).toContain('0.5%');
    expect(html).toContain('14.3%');
    expect(html).toContain('below the national average of 5.4%');
    expect(html).toContain('below the national average of 21.5%');
  });

  it('states the as-of date so stale data is never passed off as current', () => {
    expect(html).toContain('FMCSA safety data as of Aug 30, 2026');
  });

  it('disclaims that we do not rate, certify or endorse', () => {
    expect(html).toMatch(/does not rate, certify or endorse/i);
  });

  it('notes that crash counts are unadjusted for fault or mileage', () => {
    // Raw crash counts favour small carriers; saying so is the difference
    // between a statistic and a misleading one.
    expect(html).toMatch(/not adjusted for fault or for how many miles/i);
  });

  it('never editorialises about the carrier', () => {
    const block = html.slice(html.indexOf('Roadside inspection'));
    expect(block).not.toMatch(/\bunsafe\b|\bdangerous\b|\brisky\b|\bpoor\b|\bavoid\b|\bbad\b/i);
  });
});

describe('safety record — absent (the majority-adjacent case we must not fake)', () => {
  for (const [label, value] of [
    ['null safety', null],
    ['undefined safety', undefined],
    ['all-null record', EMPTY_SAFETY],
  ] as const) {
    it(`says plainly that FMCSA published no record — ${label}`, () => {
      const html = render(value);
      expect(html).toMatch(/has not published a roadside inspection or crash record/i);
      expect(html).toMatch(/That is common — it does not indicate a problem/i);
    });

    it(`does NOT invent zero counts — ${label}`, () => {
      const html = render(value);
      const block = html.slice(html.indexOf('Roadside inspection'));
      expect(block).not.toMatch(/Reported crashes/);
      expect(block).not.toMatch(/out-of-service/i);
    });
  }
});

describe('safety record — partial coverage', () => {
  it('renders crashes alone when the carrier is absent from the SMS file', () => {
    // ~26% of directory carriers have no SMS row. Inspection rows must simply
    // not appear rather than showing as zeros.
    const html = render({
      ...EMPTY_SAFETY,
      crashesTotal: 0,
      crashesFatal: 0,
      crashesInjury: 0,
      crashesTow: 0,
      safetyDataAsOf: AS_OF,
    });
    expect(html).toContain('Reported crashes');
    expect(html).not.toMatch(/Driver out-of-service/);
    expect(html).not.toMatch(/Vehicle out-of-service/);
  });

  it('omits the severity split when there were genuinely no crashes', () => {
    const html = render({
      ...EMPTY_SAFETY,
      crashesTotal: 0,
      crashesFatal: 0,
      crashesInjury: 0,
      crashesTow: 0,
      safetyDataAsOf: AS_OF,
    });
    const block = html.slice(html.indexOf('Roadside inspection'));
    expect(block).not.toMatch(/towed away/i);
    expect(block).not.toMatch(/fatal/i);
  });

  it('SUPPRESSES the rate on a tiny sample but still shows the counts', () => {
    // The smear case: 1 inspection, 1 out-of-service. A "100.0%" here would be
    // the single most damaging thing we could print about a real company.
    const html = render({
      ...EMPTY_SAFETY,
      driverInspTotal: 1,
      driverOosTotal: 1,
      safetyDataAsOf: AS_OF,
    });
    expect(html).toContain('1 of 1');
    expect(html).not.toContain('100.0%');
    expect(html).toMatch(/too few inspections to compute a rate/i);
  });
});

describe('safety RATING honesty', () => {
  it('explains that an unrated carrier has not failed anything', () => {
    const html = renderCarrierProfile({ carrier: carrier({ safetyRating: null }) });
    expect(html).toContain('Not rated');
    expect(html).toMatch(/Most carriers are unrated/i);
    expect(html).toMatch(/does not mean the carrier failed/i);
  });

  it('does not colour an unrated carrier as a negative', () => {
    const html = renderCarrierProfile({ carrier: carrier({ safetyRating: null }) });
    // `pill-bad` is the red tone reserved for an actual Unsatisfactory rating.
    expect(html).not.toContain('pill-bad');
  });

  it('attributes a real rating to FMCSA rather than to us', () => {
    const html = renderCarrierProfile({ carrier: carrier({ safetyRating: 'C' }) });
    expect(html).toMatch(/FMCSA assigned a Conditional rating/);
    expect(html).toMatch(/It does not stop the carrier operating/);
  });
});
