/**
 * FMCSA carrier-directory ingest — pure parse + carrier-filter + normalize +
 * nearest-port tests. No network, no DB. Fixtures mirror the REAL Socrata
 * column names:
 *   L&I Carrier (6eyk-hxee): common_stat / contract_stat / property_chk / bus_*
 *   Census    (az4n-8mr2)  : power_units / total_drivers / safety_rating /
 *                            crgo_intermodal / status_code / phy_*
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeDot,
  normalizePhone,
  isActivePropertyCarrier,
  authorityType,
  isIntermodal,
  censusAllowsOperate,
  makeSlug,
  buildCarrierWhere,
  filterAndNormalizeCarriers,
  type LiCarrierRow,
  type CensusRow,
} from './ingestFmcsaCarriers.js';
import { nearestPortToPoint, nearestPortForZip } from '../src/server/directory/containerPorts.js';

// ── Real-shaped fixtures ────────────────────────────────────────────────
const activeCarrier: LiCarrierRow = {
  docket_number: 'MC012892',
  dot_number: '00107080', // zero-padded in L&I
  common_stat: 'A',
  contract_stat: 'N',
  broker_stat: 'N',
  property_chk: 'Y',
  passenger_chk: 'N',
  hhg_chk: 'N',
  legal_name: 'ACME DRAYAGE INC',
  dba_name: 'ACME PORT HAUL',
  bus_street_po: '10 DOCK ST',
  bus_city: 'SAVANNAH',
  bus_state_code: 'ga',
  bus_zip_code: '31401',
  bus_telno: '9125550921',
};

// Contract-only carrier — must be kept (authority via contract_stat).
const contractCarrier: LiCarrierRow = {
  docket_number: 'MC022222',
  dot_number: '02217388',
  common_stat: 'N',
  contract_stat: 'A',
  broker_stat: 'N',
  property_chk: 'Y',
  legal_name: 'CONTRACT HAUL LLC',
  bus_state_code: 'TX',
  bus_zip_code: '77002',
};

// No operating authority (all *_stat N) — must be dropped.
const noAuthority: LiCarrierRow = {
  docket_number: 'MC099999',
  dot_number: '03000000',
  common_stat: 'N',
  contract_stat: 'N',
  broker_stat: 'I',
  property_chk: 'N',
  legal_name: 'DORMANT CO',
  bus_state_code: 'FL',
};

// Active authority but PASSENGER (property_chk='N') — must be dropped.
const passengerCarrier: LiCarrierRow = {
  docket_number: 'MC088888',
  dot_number: '04000000',
  common_stat: 'A',
  contract_stat: 'N',
  property_chk: 'N',
  passenger_chk: 'Y',
  legal_name: 'BUS LINES INC',
  bus_state_code: 'NV',
};

const censusByDot = new Map<string, CensusRow>([
  [
    '107080',
    {
      dot_number: '107080',
      legal_name: 'ACME DRAYAGE INC',
      power_units: '25',
      total_drivers: '30',
      safety_rating: 'S',
      status_code: 'A',
      crgo_intermodal: 'X',
      phone: '9125550921',
      phy_city: 'SAVANNAH',
      phy_state: 'GA',
      phy_zip: '31401',
    },
  ],
]);

// ── Pure helper units ───────────────────────────────────────────────────
describe('normalizers', () => {
  it('normalizeDot strips leading zeros so L&I joins census', () => {
    expect(normalizeDot('00107080')).toBe('107080');
    expect(normalizeDot('107080')).toBe('107080');
    expect(normalizeDot('')).toBeNull();
    expect(normalizeDot(undefined)).toBeNull();
  });
  it('normalizePhone keeps ≥10-digit numbers as digits', () => {
    expect(normalizePhone('(912) 555-0921')).toBe('9125550921');
    expect(normalizePhone('12345')).toBeNull();
  });
  it('isActivePropertyCarrier gates on common/contract authority + property_chk', () => {
    expect(isActivePropertyCarrier(activeCarrier)).toBe(true);
    expect(isActivePropertyCarrier(contractCarrier)).toBe(true);
    expect(isActivePropertyCarrier(noAuthority)).toBe(false);
    expect(isActivePropertyCarrier(passengerCarrier)).toBe(false);
  });
  it('authorityType reflects the *_stat flags', () => {
    expect(authorityType(activeCarrier)).toBe('common');
    expect(authorityType(contractCarrier)).toBe('contract');
    expect(authorityType({ common_stat: 'A', contract_stat: 'A' })).toBe('common,contract');
    expect(authorityType(noAuthority)).toBeNull();
  });
  it('isIntermodal reads the census crgo_intermodal X flag', () => {
    expect(isIntermodal({ crgo_intermodal: 'X' })).toBe(true);
    expect(isIntermodal({ crgo_intermodal: undefined })).toBe(false);
    expect(isIntermodal(undefined)).toBe(false);
  });
  it('censusAllowsOperate drops status I, keeps A / missing', () => {
    expect(censusAllowsOperate({ status_code: 'A' })).toBe(true);
    expect(censusAllowsOperate({ status_code: 'I' })).toBe(false);
    expect(censusAllowsOperate(undefined)).toBe(true);
  });
  it('makeSlug is url-safe and suffixed with USDOT for uniqueness', () => {
    expect(makeSlug('ACME Drayage, Inc.', '107080')).toBe('acme-drayage-inc-107080');
    expect(makeSlug('B & B Trucking', '55')).toBe('b-and-b-trucking-55');
  });
  it('buildCarrierWhere adds a state IN() clause when states are given', () => {
    expect(buildCarrierWhere([])).not.toContain('bus_state_code');
    expect(buildCarrierWhere(['ri', 'de'])).toContain("bus_state_code in ('RI','DE')");
  });
});

// ── nearest-port derivation ─────────────────────────────────────────────
describe('nearest container port', () => {
  it('picks the nearest seeded port to a lat/lng (Houston coords → USHOU)', () => {
    expect(nearestPortToPoint(29.76, -95.37)).toBe('USHOU');
  });
  it('picks Savannah for a Savannah point', () => {
    expect(nearestPortToPoint(32.08, -81.09)).toBe('USSAV');
  });
  it('maps a real ZIP to a valid port code, and unknown ZIP → null', () => {
    expect(nearestPortForZip('31401')).toBe('USSAV'); // Savannah, GA
    expect(nearestPortForZip('00000')).toBeNull(); // not a real ZCTA
    expect(nearestPortForZip(null)).toBeNull();
  });
});

// ── filter + normalize ──────────────────────────────────────────────────
describe('filterAndNormalizeCarriers', () => {
  it('keeps active property carriers (common + contract) and drops the rest', () => {
    const out = filterAndNormalizeCarriers(
      [activeCarrier, contractCarrier, noAuthority, passengerCarrier],
      censusByDot,
    );
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.usdot).sort()).toEqual(['107080', '2217388']);
  });

  it('normalizes fields + captures census fleet, safety, intermodal, port, slug', () => {
    const [rec] = filterAndNormalizeCarriers([activeCarrier], censusByDot);
    expect(rec.usdot).toBe('107080'); // zeros stripped
    expect(rec.mcNumber).toBe('MC012892');
    expect(rec.legalName).toBe('ACME DRAYAGE INC');
    expect(rec.dbaName).toBe('ACME PORT HAUL');
    expect(rec.state).toBe('GA'); // upper-cased
    expect(rec.city).toBe('SAVANNAH');
    expect(rec.phone).toBe('9125550921');
    expect(rec.powerUnits).toBe(25);
    expect(rec.drivers).toBe(30);
    expect(rec.safetyRating).toBe('S');
    expect(rec.authorityType).toBe('common');
    expect(rec.intermodal).toBe(true);
    expect(rec.nearestPortCode).toBe('USSAV'); // ZIP 31401 → Savannah
    expect(rec.publicSlug).toBe('acme-drayage-inc-107080');
  });

  it('keeps an active carrier with NO census match (fleet null, L&I address used)', () => {
    const [rec] = filterAndNormalizeCarriers([activeCarrier], new Map());
    expect(rec.powerUnits).toBeNull();
    expect(rec.drivers).toBeNull();
    expect(rec.intermodal).toBe(false);
    expect(rec.state).toBe('GA'); // from L&I bus_state_code, upper-cased
    expect(rec.nearestPortCode).toBe('USSAV'); // still derived from L&I bus_zip_code
  });

  it('drops an active carrier whose census row is status I (not allowed to operate)', () => {
    const inactive = new Map<string, CensusRow>([['107080', { dot_number: '107080', status_code: 'I' }]]);
    expect(filterAndNormalizeCarriers([activeCarrier], inactive)).toHaveLength(0);
  });

  it('de-dupes within a page by USDOT (multiple docket rows for one carrier)', () => {
    const dupe = { ...activeCarrier, docket_number: 'FF001234' };
    const out = filterAndNormalizeCarriers([activeCarrier, dupe], censusByDot);
    expect(out).toHaveLength(1);
  });

  it('drops a carrier domiciled outside the US (Canada/Mexico), keeps US + territories', () => {
    const foreign = new Map<string, CensusRow>([
      ['107080', { dot_number: '107080', status_code: 'A', phy_state: 'ON' }], // Ontario, CA
    ]);
    expect(filterAndNormalizeCarriers([activeCarrier], foreign)).toHaveLength(0);
    // A US territory (Puerto Rico) is kept.
    const pr = new Map<string, CensusRow>([
      ['107080', { dot_number: '107080', status_code: 'A', phy_state: 'PR' }],
    ]);
    const [rec] = filterAndNormalizeCarriers([activeCarrier], pr);
    expect(rec.state).toBe('PR');
  });
});
