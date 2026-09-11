/**
 * CROSS-BORDER INGEST — classifying and rendering Canadian and Mexican carriers.
 *
 * THE DEFECT THIS PINS. `carrierCountry()` knew US states and Canadian
 * provinces and returned null for everything else, and `normalizeCarrier`
 * dropped a null-country row. FMCSA licenses ~14.7k Mexico-domiciled active
 * property carriers under exactly the same authority we already ingest, so the
 * directory silently excluded all of them — which is also why #548's data-driven
 * country control could never render: it needs two countries with rows and the
 * table held one.
 *
 * The tests below are grouped by the thing that can go wrong:
 *   1. CLASSIFICATION — including `NL`, the one code the Canadian and Mexican
 *      sets genuinely share.
 *   2. NEAREST HUB — the Mexican-postal-code-is-a-valid-US-ZIP trap.
 *   3. ACCOUNTING — an unplaceable row is counted, not silently discarded.
 *   4. RENDERING — a non-US carrier must not come out wearing a US label.
 *
 * Pure — no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import {
  carrierCountry,
  deriveNearestPortCode,
  normalizeCarrier,
  filterAndNormalizeCarriers,
  type LiCarrierRow,
  type CensusRow,
} from './carrierIngest.js';
import { MX_STATE_CODES, mxStateByCode, MX_STATES } from './mxStates.js';
import { CA_PROVINCE_CODES } from './caProvinces.js';
import { US_STATE_CODES } from './usStates.js';
import { carrierDomicile, carrierAbout, carrierCard, renderCarrierProfile } from './pages.js';
import type { VisibleCarrier } from './queries.js';

// ─── 1. Classification ────────────────────────────────────────────────────
describe('carrierCountry() places all three North-American domiciles', () => {
  it('classifies a Mexican state code as MX', () => {
    expect(carrierCountry('TA')).toBe('MX'); // Tamaulipas — the largest MX domicile
    expect(carrierCountry('BN')).toBe('MX'); // Baja California
    expect(carrierCountry('CI')).toBe('MX'); // Chihuahua
    expect(carrierCountry('SO')).toBe('MX'); // Sonora
  });

  it('classifies a Canadian province as CA', () => {
    expect(carrierCountry('ON')).toBe('CA');
    expect(carrierCountry('BC')).toBe('CA');
    expect(carrierCountry('QC')).toBe('CA');
  });

  it('classifies a US state as US', () => {
    expect(carrierCountry('IL')).toBe('US');
    expect(carrierCountry('TX')).toBe('US');
    expect(carrierCountry('PR')).toBe('US'); // territory
  });

  it('classifies an unrecognised code as unknown (null) rather than guessing', () => {
    expect(carrierCountry('ZZ')).toBeNull();
    expect(carrierCountry('')).toBeNull();
    expect(carrierCountry(null)).toBeNull();
  });

  it("takes FMCSA's own phy_country over any code inference", () => {
    // Census says Mexico; the code alone would have said Illinois.
    expect(carrierCountry('IL', 'MX')).toBe('MX');
    expect(carrierCountry('TA', 'US')).toBe('US');
    expect(carrierCountry('ON', 'ca')).toBe('CA'); // case-insensitive
  });

  it('returns null for a country outside North America, not a code fallback', () => {
    // Guatemala (245 carriers), El Salvador, Honduras… are real FMCSA domiciles
    // and genuinely unplaceable in a US/CA/MX browse. The state code must not
    // rescue them into the wrong country.
    expect(carrierCountry('GU', 'GT')).toBeNull();
    expect(carrierCountry('IL', 'HN')).toBeNull();
  });

  describe('NL — the one code Canada and Mexico share', () => {
    it('is in BOTH code sets, so set membership alone cannot decide it', () => {
      expect(CA_PROVINCE_CODES.has('NL')).toBe(true); // Newfoundland and Labrador
      expect(MX_STATE_CODES.has('NL')).toBe(true); // Nuevo León
    });

    it("resolves by FMCSA's country when the census row is present", () => {
      expect(carrierCountry('NL', 'MX')).toBe('MX');
      expect(carrierCountry('NL', 'CA')).toBe('CA');
    });

    it('falls back to Nuevo León without a census row — the measured reading', () => {
      // Every one of 40 sampled L&I rows with bus_state_code='NL' resolves to
      // phy_country='MX' (Monterrey / Guadalupe / Apodaca), and the filtered L&I
      // file contains no Newfoundland rows under any spelling.
      expect(carrierCountry('NL')).toBe('MX');
    });
  });

  it('keeps the three code sets otherwise disjoint (NL is the only overlap)', () => {
    const overlaps = [...MX_STATE_CODES].filter(
      (c) => US_STATE_CODES.has(c) || CA_PROVINCE_CODES.has(c),
    );
    expect(overlaps).toEqual(['NL']);
  });
});

describe('mxStates registry', () => {
  it('names the census codes and slugifies the accents away', () => {
    expect(mxStateByCode('NL')?.name).toBe('Nuevo León');
    expect(mxStateByCode('NL')?.slug).toBe('nuevo-leon');
    expect(mxStateByCode('DF')?.slug).toBe('ciudad-de-mexico');
    expect(MX_STATES).toHaveLength(32);
  });

  it('synthesizes rather than blanks an L&I-only spelling', () => {
    // 'TM' is L&I's Tamaulipas. It is classifiable but deliberately unnamed —
    // see mxStates.ts on the two files disagreeing about CH and TA.
    expect(MX_STATE_CODES.has('TM')).toBe(true);
    expect(mxStateByCode('TM')).toEqual({ code: 'TM', name: 'TM', slug: 'tm' });
  });
});

// ─── 2. Nearest hub ───────────────────────────────────────────────────────
describe('deriveNearestPortCode() refuses to fabricate Mexican geography', () => {
  it('returns null for a Mexican carrier', () => {
    expect(deriveNearestPortCode('MX', 'NL', '64000')).toBeNull();
    expect(deriveNearestPortCode('MX', 'TA', '88000')).toBeNull();
  });

  it('does NOT fall through to the US ZIP lookup — the silent-mismatch trap', () => {
    // MEASURED, not hypothetical: Mexican postal codes are five digits, so a
    // real share of them are also valid US ZCTAs. Running 1,840 live FMCSA
    // Mexican carriers' phy_zip values through nearestPortForZip resolved 157
    // of them (8.5%) to a confident US hub — Tijuana 22125 → Baltimore,
    // Ciudad Juárez 32410 → Mobile, Nogales 84066 → Salt Lake City. Those are
    // the rows that would have been silently misfiled, and this is the branch
    // that stops it. 22125 is one of the real ones.
    expect(deriveNearestPortCode('US', 'MD', '22125')).not.toBeNull();
    expect(deriveNearestPortCode('MX', 'BN', '22125')).toBeNull();
  });

  it('still derives US and CA hubs exactly as before', () => {
    expect(deriveNearestPortCode('CA', 'ON', 'M5V 3A8')).toBe('INLTOR');
    expect(deriveNearestPortCode('US', 'IL', '60601')).toBe('USCHI');
  });
});

// ─── 3. Accounting ────────────────────────────────────────────────────────
const li = (over: Partial<LiCarrierRow> = {}): LiCarrierRow => ({
  docket_number: 'MC012892',
  dot_number: '00107080',
  common_stat: 'A',
  property_chk: 'Y',
  legal_name: 'TRANSPORTES DEL NORTE SA DE CV',
  bus_city: 'MONTERREY',
  bus_state_code: 'NL',
  bus_zip_code: '64000',
  ...over,
});

const census = (over: Partial<CensusRow> = {}): CensusRow => ({
  dot_number: '107080',
  status_code: 'A',
  phy_city: 'MONTERREY',
  phy_state: 'NL',
  phy_zip: '64000',
  phy_country: 'MX',
  power_units: '40',
  ...over,
});

describe('normalizeCarrier() keeps cross-border carriers and counts the rest', () => {
  it('keeps a Mexican carrier, tagged MX with a null hub', () => {
    const rec = normalizeCarrier(li(), census());
    expect(rec).not.toBeNull();
    expect(rec!.country).toBe('MX');
    expect(rec!.state).toBe('NL');
    expect(rec!.nearestPortCode).toBeNull();
  });

  it('keeps a Mexican carrier even with includeCanada off — MX is ungated', () => {
    expect(normalizeCarrier(li(), census(), false)?.country).toBe('MX');
  });

  it('still gates Canada behind includeCanada', () => {
    const caLi = li({ bus_state_code: 'ON', bus_city: 'TORONTO' });
    const caCensus = census({
      phy_state: 'ON',
      phy_city: 'TORONTO',
      phy_country: 'CA',
      phy_zip: undefined,
    });
    expect(normalizeCarrier(caLi, caCensus, false)).toBeNull();
    expect(normalizeCarrier(caLi, caCensus, true)?.country).toBe('CA');
    expect(normalizeCarrier(caLi, caCensus, true)?.nearestPortCode).toBe('INLTOR');
  });

  it('reports an unplaceable domicile instead of silently discarding it', () => {
    const dropped: Array<string | null> = [];
    const rec = normalizeCarrier(
      li({ bus_state_code: 'GU', bus_city: 'GUATEMALA' }),
      census({ phy_state: 'GU', phy_country: 'GT' }),
      true,
      undefined,
      (code) => dropped.push(code),
    );
    expect(rec).toBeNull();
    expect(dropped).toEqual(['GU']);
  });

  it('forwards the callback through filterAndNormalizeCarriers', () => {
    const dropped: Array<string | null> = [];
    const rows = filterAndNormalizeCarriers(
      [li(), li({ dot_number: '2', bus_state_code: 'ZZ' })],
      new Map([['107080', census()]]),
      true,
      undefined,
      (code) => dropped.push(code),
    );
    expect(rows.map((r) => r.country)).toEqual(['MX']);
    expect(dropped).toEqual(['ZZ']);
  });
});

// ─── 4. Rendering ─────────────────────────────────────────────────────────
function visible(overrides: Partial<VisibleCarrier> = {}): VisibleCarrier {
  return {
    slug: 'transportes-del-norte-107080',
    legalName: 'TRANSPORTES DEL NORTE SA DE CV',
    dbaName: null,
    usdot: '107080',
    mcNumber: 'MC012892',
    city: 'MONTERREY',
    state: 'NL',
    country: 'MX',
    zip: '64000',
    phone: '8181234567',
    email: null,
    contactHidden: false,
    powerUnits: 40,
    drivers: 45,
    safetyRating: 'S',
    authorityType: 'common',
    intermodal: true,
    nearestPortCode: null,
    aboutOverride: null,
    capabilities: {},
    provenance: { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' },
    ...overrides,
  } as VisibleCarrier;
}

describe('carrierDomicile() reads the stored country, not the state code', () => {
  it('returns the stored value for all three countries', () => {
    expect(carrierDomicile({ country: 'MX', state: 'NL' })).toBe('MX');
    expect(carrierDomicile({ country: 'CA', state: 'NL' })).toBe('CA');
    expect(carrierDomicile({ country: 'US', state: 'IL' })).toBe('US');
  });

  it('falls back to the code, MX before CA, when no country is stored', () => {
    expect(carrierDomicile({ state: 'NL' })).toBe('MX');
    expect(carrierDomicile({ state: 'ON' })).toBe('CA');
    expect(carrierDomicile({ state: 'IL' })).toBe('US');
  });
});

describe('a Mexican carrier renders as Mexican', () => {
  it('shows its real city/state on a listing row and no US claim', () => {
    const html = carrierCard(visible());
    expect(html).toContain('MONTERREY, NL');
    expect(html).not.toMatch(/United States/);
  });

  it('publishes addressCountry MX in structured data', () => {
    const html = renderCarrierProfile({ carrier: visible() });
    expect(html).toContain('"addressCountry":"MX"');
    expect(html).not.toContain('"addressCountry":"US"');
  });

  it('does not link a breadcrumb to a state page that does not exist', () => {
    const html = renderCarrierProfile({ carrier: visible() });
    // stateByCode would have synthesized {code:'NL', slug:'nl'} and produced a
    // confident /directory/nl link — and a BreadcrumbList item URL — to a 404.
    expect(html).not.toContain('/directory/nl');
    expect(html).toContain('Nuevo León');
  });

  it('describes cross-border lanes, not US ports and rail ramps', () => {
    const html = renderCarrierProfile({ carrier: visible() });
    expect(html).toContain('US–Mexico cross-border lanes');
    expect(html).not.toContain('at US ports and rail ramps');
  });

  it('names Mexico, not the United States, when FMCSA gave no city/state', () => {
    const html = renderCarrierProfile({
      carrier: visible({ city: null, state: null, zip: null }),
    });
    expect(html).toContain('Based in Mexico.');
  });

  it('writes an About line that never asserts a US state name', () => {
    const about = carrierAbout(visible());
    expect(about).toContain('Monterrey, NL'); // title-cased city, real state code
    expect(about).not.toContain('US container ports');
    expect(about).not.toContain('US intermodal hubs');
  });
});

describe('a Canadian carrier still renders as Canadian', () => {
  const ca = visible({
    slug: 'maple-freight-ltd-9001',
    legalName: 'MAPLE FREIGHT LTD',
    usdot: '9001',
    city: 'TORONTO',
    state: 'ON',
    country: 'CA',
    zip: 'M5V3A8',
    nearestPortCode: 'INLTOR',
  });

  it('shows its province on a listing row', () => {
    expect(carrierCard(ca)).toContain('TORONTO, ON');
  });

  it('publishes addressCountry CA and links no US state page', () => {
    const html = renderCarrierProfile({ carrier: ca });
    expect(html).toContain('"addressCountry":"CA"');
    expect(html).not.toContain('/directory/on');
    expect(html).toContain('Ontario');
    expect(html).toContain('across Canadian trade lanes');
  });
});

describe('a US carrier is unchanged', () => {
  const us = visible({
    slug: 'acme-drayage-inc-107081',
    legalName: 'ACME DRAYAGE INC',
    usdot: '107081',
    city: 'CHICAGO',
    state: 'IL',
    country: 'US',
    zip: '60601',
    nearestPortCode: 'USCHI',
  });

  it('keeps its US state breadcrumb link and US structured data', () => {
    const html = renderCarrierProfile({ carrier: us });
    expect(html).toContain('"addressCountry":"US"');
    expect(html).toContain('/directory/illinois');
    expect(html).toContain('at US ports and rail ramps');
  });
});
