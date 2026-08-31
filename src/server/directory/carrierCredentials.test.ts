/**
 * FMCSA credential parsing — the unit that decides what we are willing to
 * publish about a real company's insurance and tenure.
 *
 * The fixtures below are REAL rows captured from the live FMCSA Socrata API on
 * 2026-08-30 and frozen here. CI must never hit the portal. They were chosen
 * because they happen to exercise both traps at once: a `19740601` bulk-load
 * add_date, and a Satisfactory safety rating assigned in the year 2000.
 */
import { describe, expect, it } from 'vitest';
import {
  BIPD_UNIT_DOLLARS,
  EMPTY_CREDENTIALS,
  FMCSA_ADD_DATE_SENTINEL,
  LI_EXTRACT_DATE,
  buildCarrierCredentials,
  formatCoverage,
  formatCredentialDate,
  hasInsuranceFilings,
  isYes,
  parseCoverageDollars,
  parseFmcsaDate,
  registeredSinceLabel,
  yearsRegistered,
} from './carrierCredentials.js';
import {
  CARRIER_CHANGED_SQL,
  CARRIER_MUTABLE_COLUMNS,
  CARRIER_UPSERT_SET,
  filterAndNormalizeCarriers,
  normalizeDot,
  type CensusRow,
  type LiCarrierRow,
} from './carrierIngest.js';

// ─── Frozen live rows (data.transportation.gov, 2026-08-30) ───────────────
/** L&I 6eyk-hxee — STALEY GENERAL TRANSPORTATION, USDOT 100655. */
const LI_REAL: LiCarrierRow = {
  dot_number: '00100655',
  docket_number: 'MC135640',
  legal_name: 'STALEY GENERAL TRANSPORTATION, INC.',
  common_stat: 'A',
  contract_stat: 'A',
  property_chk: 'Y',
  bus_state_code: 'IN',
  bipd_file: '01000',
  min_cov_amount: '01000',
  cargo_file: 'Y',
  bond_file: 'N',
};
/** Census az4n-8mr2 — the matching row for USDOT 100655. */
const CENSUS_REAL: CensusRow = {
  dot_number: '100655',
  legal_name: 'STALEY GENERAL TRANSPORTATION INC',
  power_units: '18',
  total_drivers: '17',
  safety_rating: 'S',
  safety_rating_date: '20001024',
  add_date: '19740601',
  status_code: 'A',
  phy_state: 'IN',
  phy_zip: '46151',
};
/**
 * L&I's `00000000` sentinel — a REAL row, captured the same day. 278 rows inside
 * the ingest's own $where carry it. It is not zero-padding: it is a placeholder
 * shared by unrelated companies, so anything that treats it as a USDOT merges
 * hundreds of businesses into one profile.
 */
const LI_SENTINEL_DOT: LiCarrierRow = {
  dot_number: '00000000',
  docket_number: 'MC195904',
  legal_name: 'CALIFORNIA EXPANDED METAL PRODUCTS COMPANY',
  common_stat: 'A',
  contract_stat: 'N',
  property_chk: 'Y',
  bus_state_code: 'CA',
  bipd_file: '01000',
  min_cov_amount: '00750',
  cargo_file: 'Y',
  bond_file: 'N',
};

describe('parseCoverageDollars — L&I stores THOUSANDS, we store dollars', () => {
  it('multiplies the zero-padded thousands into real dollars', () => {
    expect(parseCoverageDollars('00750')).toBe(750_000);
    expect(parseCoverageDollars('01000')).toBe(1_000_000);
    expect(parseCoverageDollars('05000')).toBe(5_000_000);
    expect(BIPD_UNIT_DOLLARS).toBe(1_000);
  });

  it('anchors the unit on the federal general-freight minimum', () => {
    // If this ever reads $750 instead of $750,000 the unit has been lost.
    expect(parseCoverageDollars('00750')).toBeGreaterThan(100_000);
  });

  it('reads "no filing" as null, never as $0', () => {
    // "00000" means nothing is on record. Collapsing it to null is what makes a
    // "$0 of liability cover" string unrenderable by construction.
    expect(parseCoverageDollars('00000')).toBeNull();
    expect(parseCoverageDollars('')).toBeNull();
    expect(parseCoverageDollars(null)).toBeNull();
    expect(parseCoverageDollars(undefined)).toBeNull();
    expect(parseCoverageDollars('N/A')).toBeNull();
    expect(parseCoverageDollars('-5')).toBeNull();
  });
});

describe('isYes', () => {
  it('accepts only Y', () => {
    expect(isYes('Y')).toBe(true);
    expect(isYes(' y ')).toBe(true);
    expect(isYes('N')).toBe(false);
    expect(isYes('')).toBe(false);
    expect(isYes(undefined)).toBe(false);
  });
});

describe('parseFmcsaDate', () => {
  it('parses the bare YYYYMMDD census form as UTC midnight', () => {
    const d = parseFmcsaDate('20120413');
    expect(d?.toISOString()).toBe('2012-04-13T00:00:00.000Z');
  });

  it('ignores the trailing time some census dates carry', () => {
    expect(parseFmcsaDate('20180709 0000')?.toISOString()).toBe('2018-07-09T00:00:00.000Z');
  });

  it('SUPPRESSES the 19740601 bulk-load sentinel', () => {
    // 12,864 active carriers (0.58%) carry it. It is when a batch of legacy
    // records was loaded, not when those carriers registered — publishing
    // "registered since 1974 · 52 yrs" off it would invent half a century of
    // tenure for a company that might be five years old.
    expect(parseFmcsaDate(FMCSA_ADD_DATE_SENTINEL)).toBeNull();
    expect(parseFmcsaDate(CENSUS_REAL.add_date)).toBeNull();
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // Date.UTC(2026, 1, 31) silently becomes 3 March. Publishing a date FMCSA
    // never recorded is worse than publishing nothing.
    expect(parseFmcsaDate('20260231')).toBeNull();
    expect(parseFmcsaDate('20261301')).toBeNull();
    expect(parseFmcsaDate('18000101')).toBeNull();
    expect(parseFmcsaDate('')).toBeNull();
    expect(parseFmcsaDate('not-a-date')).toBeNull();
    expect(parseFmcsaDate(undefined)).toBeNull();
  });

  it('is STABLE — the same input always yields the same instant', () => {
    // An unstable parse would make every weekly ingest look like a change and
    // manufacture fake <lastmod> freshness across ~330k sitemap rows.
    expect(parseFmcsaDate('20120413')!.getTime()).toBe(parseFmcsaDate('20120413')!.getTime());
  });
});

describe('buildCarrierCredentials — against the frozen live rows', () => {
  const cred = buildCarrierCredentials(LI_REAL, CENSUS_REAL);

  it('reads the liability filing and the federal minimum, in dollars', () => {
    expect(cred.bipdOnFile).toBe(1_000_000);
    expect(cred.bipdRequired).toBe(1_000_000);
  });

  it('reads the cargo and bond filing flags', () => {
    expect(cred.cargoInsuranceOnFile).toBe(true);
    expect(cred.bondOnFile).toBe(false);
  });

  it('reads the safety-rating date, which is a quarter-century old on this row', () => {
    expect(cred.safetyRatingDate?.toISOString()).toBe('2000-10-24T00:00:00.000Z');
  });

  it('nulls the tenure date because this row carries the bulk-load sentinel', () => {
    expect(cred.fmcsaRegisteredSince).toBeNull();
  });

  it('returns the empty shape when neither row is present', () => {
    expect(buildCarrierCredentials(undefined, undefined)).toEqual(EMPTY_CREDENTIALS);
  });

  it('survives an L&I row with no census match — dates null, filings intact', () => {
    const c = buildCarrierCredentials(LI_REAL, undefined);
    expect(c.bipdOnFile).toBe(1_000_000);
    expect(c.fmcsaRegisteredSince).toBeNull();
    expect(c.safetyRatingDate).toBeNull();
  });
});

describe('tenure wording — a registration date is NOT a founding date', () => {
  const NOW = new Date('2026-08-30T00:00:00Z');

  it('counts whole years from the registration date', () => {
    expect(yearsRegistered(new Date(Date.UTC(2012, 3, 13)), NOW)).toBe(14);
    expect(yearsRegistered(null, NOW)).toBeNull();
  });

  it('refuses a future date instead of publishing a negative tenure', () => {
    expect(yearsRegistered(new Date(Date.UTC(2030, 0, 1)), NOW)).toBeNull();
    expect(registeredSinceLabel(new Date(Date.UTC(2030, 0, 1)), NOW)).toBeNull();
  });

  it('says FMCSA-registered, never "in business" or "founded"', () => {
    // A company can predate its USDOT number, and a re-registration mints a new
    // one — so this is a FLOOR on tenure and the copy must not overclaim.
    const label = registeredSinceLabel(new Date(Date.UTC(2012, 3, 13)), NOW)!;
    expect(label).toBe('FMCSA-registered since 2012 · 14 yrs');
    expect(label).not.toMatch(/in business|founded|established|operating since/i);
  });

  it('never publishes "0 yrs" for a carrier registered this year', () => {
    expect(registeredSinceLabel(new Date(Date.UTC(2026, 5, 1)), NOW)).toBe('FMCSA-registered 2026');
  });

  it('singularises one year', () => {
    expect(registeredSinceLabel(new Date(Date.UTC(2025, 0, 1)), NOW)).toBe('FMCSA-registered since 2025 · 1 yr');
  });
});

describe('display helpers', () => {
  it('formats coverage as whole dollars', () => {
    expect(formatCoverage(1_000_000)).toBe('$1,000,000');
    expect(formatCoverage(750_000)).toBe('$750,000');
  });

  it('formats a credential date in UTC so the server timezone cannot shift it', () => {
    expect(formatCredentialDate(new Date('2000-10-24T00:00:00Z'))).toBe('Oct 24, 2000');
  });

  it('states the L&I extract date, because that file is frozen', () => {
    expect(LI_EXTRACT_DATE).toBe('14 May 2026');
  });
});

describe('hasInsuranceFilings — the gate on rendering the card at all', () => {
  it('is false when nothing is on record', () => {
    expect(hasInsuranceFilings(EMPTY_CREDENTIALS)).toBe(false);
    expect(hasInsuranceFilings(null)).toBe(false);
    expect(hasInsuranceFilings(undefined)).toBe(false);
  });

  it('is false when only a REQUIREMENT is known — a requirement is not a filing', () => {
    expect(hasInsuranceFilings({ ...EMPTY_CREDENTIALS, bipdRequired: 750_000 })).toBe(false);
  });

  it('is true for any actual filing', () => {
    expect(hasInsuranceFilings({ ...EMPTY_CREDENTIALS, bipdOnFile: 750_000 })).toBe(true);
    expect(hasInsuranceFilings({ ...EMPTY_CREDENTIALS, cargoInsuranceOnFile: true })).toBe(true);
    expect(hasInsuranceFilings({ ...EMPTY_CREDENTIALS, bondOnFile: true })).toBe(true);
  });
});

describe('ingest wiring', () => {
  it('carries credentials through filterAndNormalizeCarriers', () => {
    const [rec] = filterAndNormalizeCarriers([LI_REAL], new Map([['100655', CENSUS_REAL]]));
    expect(rec.usdot).toBe('100655');
    expect(rec.credentials.bipdOnFile).toBe(1_000_000);
    expect(rec.credentials.cargoInsuranceOnFile).toBe(true);
    expect(rec.credentials.safetyRatingDate?.getUTCFullYear()).toBe(2000);
  });

  it('leaves credentials empty-but-present when there is no census match', () => {
    const [rec] = filterAndNormalizeCarriers([LI_REAL], new Map());
    expect(rec.credentials.fmcsaRegisteredSince).toBeNull();
    expect(rec.credentials.bipdOnFile).toBe(1_000_000);
  });

  it('DROPS the L&I 00000000 sentinel instead of merging unrelated companies', () => {
    // The single most likely join bug on this feed: 278 rows inside our own
    // $where share this placeholder. normalizeDot strips the zeros to an empty
    // string, which is not a USDOT, so the row is refused.
    expect(normalizeDot('00000000')).toBeNull();
    expect(filterAndNormalizeCarriers([LI_SENTINEL_DOT], new Map())).toEqual([]);
  });
});

describe('the new columns cannot manufacture fake sitemap freshness', () => {
  const NEW_COLUMNS = [
    'bipd_on_file',
    'bipd_required',
    'cargo_insurance_on_file',
    'bond_on_file',
    'fmcsa_registered_since',
    'safety_rating_date',
  ];

  it('is registered in the change-detection tuple', () => {
    for (const col of NEW_COLUMNS) {
      expect(CARRIER_MUTABLE_COLUMNS).toContain(col);
      expect(CARRIER_CHANGED_SQL).toContain(`"carrier_directory"."${col}"`);
      expect(CARRIER_CHANGED_SQL).toContain(`excluded."${col}"`);
    }
  });

  it('is refreshed by the upsert, so the two lists stay in parity', () => {
    const setColumns = Object.keys(CARRIER_UPSERT_SET);
    for (const prop of [
      'bipdOnFile',
      'bipdRequired',
      'cargoInsuranceOnFile',
      'bondOnFile',
      'fmcsaRegisteredSince',
      'safetyRatingDate',
    ]) {
      expect(setColumns).toContain(prop);
    }
  });

  it('stores STABLE facts, never a per-run timestamp', () => {
    // This is what keeps `updated_at` truthful. A column stamped with the ingest
    // clock would differ on every weekly run, mark all ~330k rows changed, and
    // republish a <lastmod> promise for pages that did not change — the exact
    // failure the conditional updated_at exists to prevent. Re-deriving the same
    // credentials from the same source rows must be byte-identical.
    const a = buildCarrierCredentials(LI_REAL, CENSUS_REAL);
    const b = buildCarrierCredentials(LI_REAL, CENSUS_REAL);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
