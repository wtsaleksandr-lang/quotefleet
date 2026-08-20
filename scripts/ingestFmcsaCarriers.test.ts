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
  normalizeEmail,
  isActivePropertyCarrier,
  authorityType,
  isIntermodal,
  isHazmat,
  isDryVan,
  isReefer,
  isTanker,
  isFlatbed,
  isDryBulk,
  censusAllowsOperate,
  makeSlug,
  buildCarrierWhere,
  filterAndNormalizeCarriers,
  carrierCountry,
  CARRIER_UPSERT_SET,
  type LiCarrierRow,
  type CensusRow,
} from './ingestFmcsaCarriers.js';
import {
  nearestPortToPoint,
  nearestPortForZip,
  nearestCaPortForProvince,
  portByCode,
} from '../src/server/directory/containerPorts.js';

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
      email_address: 'Dispatch@ACME.com',
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
  it('normalizeEmail lower-cases a valid address and rejects blank/garbage', () => {
    expect(normalizeEmail('Dispatch@ACME.com')).toBe('dispatch@acme.com');
    expect(normalizeEmail('  Ops@Acme.CO  ')).toBe('ops@acme.co');
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail('N/A')).toBeNull();
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull(); // no TLD
    expect(normalizeEmail('a b@c.com')).toBeNull(); // internal space
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
  it('isHazmat reads the census hm_ind flag (Y/X truthy, else false)', () => {
    expect(isHazmat({ hm_ind: 'Y' })).toBe(true);
    expect(isHazmat({ hm_ind: 'y' })).toBe(true); // case-insensitive
    expect(isHazmat({ hm_ind: ' Y ' })).toBe(true); // trims whitespace
    expect(isHazmat({ hm_ind: 'X' })).toBe(true); // tolerate the sibling 'X' convention
    expect(isHazmat({ hm_ind: 'N' })).toBe(false);
    expect(isHazmat({ hm_ind: '' })).toBe(false);
    expect(isHazmat({ hm_ind: undefined })).toBe(false);
    expect(isHazmat(undefined)).toBe(false); // missing census → not hazmat
  });
  it('equipment flags read their FMCSA crgo_* census columns (X = set)', () => {
    // Dry van ← crgo_genfreight
    expect(isDryVan({ crgo_genfreight: 'X' })).toBe(true);
    expect(isDryVan({ crgo_genfreight: undefined })).toBe(false);
    expect(isDryVan(undefined)).toBe(false);
    // Reefer ← crgo_coldfood (there is NO crgo_reefer column on az4n-8mr2)
    expect(isReefer({ crgo_coldfood: 'X' })).toBe(true);
    expect(isReefer({ crgo_coldfood: 'N' })).toBe(false);
    // Tanker ← crgo_liqgas OR crgo_chem
    expect(isTanker({ crgo_liqgas: 'X' })).toBe(true);
    expect(isTanker({ crgo_chem: 'X' })).toBe(true);
    expect(isTanker({ crgo_liqgas: undefined, crgo_chem: undefined })).toBe(false);
    // Flatbed ← crgo_metalsheet OR crgo_machlrg OR crgo_logpole
    expect(isFlatbed({ crgo_metalsheet: 'X' })).toBe(true);
    expect(isFlatbed({ crgo_machlrg: 'X' })).toBe(true);
    expect(isFlatbed({ crgo_logpole: 'X' })).toBe(true);
    expect(isFlatbed({ crgo_genfreight: 'X' })).toBe(false); // general freight is not flatbed
    // Dry bulk ← crgo_drybulk
    expect(isDryBulk({ crgo_drybulk: 'X' })).toBe(true);
    expect(isDryBulk({ crgo_drybulk: '' })).toBe(false);
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
  it('maps an INTERIOR point to its nearest INLAND rail hub (not a coastal seaport)', () => {
    // Columbus, OH → Rickenbacker inland hub, not a far-off seaport.
    expect(nearestPortToPoint(39.9612, -82.9988)).toBe('INLCMH');
    // Memphis, TN → Memphis inland hub.
    expect(nearestPortToPoint(35.1495, -90.049)).toBe('INLMEM');
    // Minneapolis, MN → MSP inland hub.
    expect(nearestPortToPoint(44.9778, -93.265)).toBe('INLMSP');
  });
  it('resolves an inland-hub code back to a named hub (portByCode covers inland)', () => {
    expect(portByCode('INLMEM')?.city).toBe('Memphis');
    expect(portByCode('INLCMH')?.name).toContain('Columbus');
    expect(portByCode('INLTOR')?.country).toBe('CA');
    expect(portByCode('USSAV')?.city).toBe('Savannah'); // seaports still resolve
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
    expect(rec.email).toBe('dispatch@acme.com'); // captured + lower-cased from census
    expect(rec.powerUnits).toBe(25);
    expect(rec.drivers).toBe(30);
    expect(rec.safetyRating).toBe('S');
    expect(rec.authorityType).toBe('common');
    expect(rec.intermodal).toBe(true);
    expect(rec.hazmat).toBe(false); // census fixture has no hm_ind → not hazmat
    expect(rec.nearestPortCode).toBe('USSAV'); // ZIP 31401 → Savannah
    expect(rec.publicSlug).toBe('acme-drayage-inc-107080');
  });

  it('captures a census hazmat carrier (hm_ind=Y) as hazmat=true', () => {
    const hazCensus = new Map<string, CensusRow>([
      ['107080', { dot_number: '107080', status_code: 'A', phy_state: 'GA', hm_ind: 'Y' }],
    ]);
    const [rec] = filterAndNormalizeCarriers([activeCarrier], hazCensus);
    expect(rec.hazmat).toBe(true);
  });

  it('captures the FMCSA equipment / cargo-type flags from the crgo_* columns', () => {
    const eqCensus = new Map<string, CensusRow>([
      [
        '107080',
        {
          dot_number: '107080',
          status_code: 'A',
          phy_state: 'GA',
          crgo_genfreight: 'X', // dry van
          crgo_coldfood: 'X', // reefer
          crgo_chem: 'X', // tanker (via chem)
          crgo_logpole: 'X', // flatbed (via logpole)
          crgo_drybulk: 'X', // dry bulk
        },
      ],
    ]);
    const [rec] = filterAndNormalizeCarriers([activeCarrier], eqCensus);
    expect(rec.dryVan).toBe(true);
    expect(rec.reefer).toBe(true);
    expect(rec.tanker).toBe(true);
    expect(rec.flatbed).toBe(true);
    expect(rec.dryBulk).toBe(true);
  });

  it('defaults every equipment flag to false with no census match', () => {
    const [rec] = filterAndNormalizeCarriers([activeCarrier], new Map());
    expect(rec.dryVan).toBe(false);
    expect(rec.reefer).toBe(false);
    expect(rec.tanker).toBe(false);
    expect(rec.flatbed).toBe(false);
    expect(rec.dryBulk).toBe(false);
  });

  it('keeps an active carrier with NO census match (fleet null, L&I address used)', () => {
    const [rec] = filterAndNormalizeCarriers([activeCarrier], new Map());
    expect(rec.powerUnits).toBeNull();
    expect(rec.drivers).toBeNull();
    expect(rec.email).toBeNull(); // no census → no email
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

  it('drops a carrier with no domicile state at all (unplaceable in the geo browse)', () => {
    // No census phy_state and no L&I bus_state_code → state null → dropped, so the
    // landing per-state total and the faceted count(*) stay in agreement.
    const noState = { ...activeCarrier, bus_state_code: undefined };
    expect(filterAndNormalizeCarriers([noState], new Map())).toHaveLength(0);
  });

  it('upper-cases safety_rating so the badge count matches the exact-match filter', () => {
    const lower = new Map<string, CensusRow>([
      ['107080', { dot_number: '107080', status_code: 'A', phy_state: 'GA', safety_rating: 's' }],
    ]);
    const [rec] = filterAndNormalizeCarriers([activeCarrier], lower);
    expect(rec.safetyRating).toBe('S');
  });

  it('tags a US carrier country="US" by default', () => {
    const [rec] = filterAndNormalizeCarriers([activeCarrier], censusByDot);
    expect(rec.country).toBe('US');
  });
});

// ── country-aware Canada gate (GATED OFF by default) ─────────────────────
describe('carrierCountry', () => {
  it('maps US states/territories → US, CA provinces → CA, else null', () => {
    expect(carrierCountry('GA')).toBe('US');
    expect(carrierCountry('PR')).toBe('US'); // territory
    expect(carrierCountry('ON')).toBe('CA');
    expect(carrierCountry('BC')).toBe('CA');
    expect(carrierCountry('AG')).toBeNull(); // Aguascalientes (Mexico)
    expect(carrierCountry('ZZ')).toBeNull();
    expect(carrierCountry(null)).toBeNull();
  });
});

// ── opt-out preservation across re-ingests ───────────────────────────────
describe('CARRIER_UPSERT_SET (opt-out preservation)', () => {
  const keys = Object.keys(CARRIER_UPSERT_SET);

  it('refreshes email on a re-ingest', () => {
    expect(keys).toContain('email');
  });

  it('refreshes hazmat on a re-ingest (verified FMCSA fact, not an opt-out)', () => {
    expect(keys).toContain('hazmat');
  });

  it('refreshes every equipment / cargo-type flag on a re-ingest', () => {
    for (const k of ['dryVan', 'reefer', 'tanker', 'flatbed', 'dryBulk']) {
      expect(keys).toContain(k);
    }
  });

  it('NEVER sets contact_hidden — a carrier who opted out stays hidden', () => {
    // The opt-out flag must not appear in the ON CONFLICT DO UPDATE SET (by the
    // drizzle column property name, or the raw column name), so a future
    // re-ingest can never clear a carrier's opt-out.
    expect(keys).not.toContain('contactHidden');
    expect(keys).not.toContain('contact_hidden');
  });

  it('does not carry contact_hidden anywhere in its compiled SQL', () => {
    // Belt-and-suspenders: none of the SET expressions reference contact_hidden.
    const sqlText = JSON.stringify(
      Object.values(CARRIER_UPSERT_SET).map((expr) => (expr as { queryChunks?: unknown }).queryChunks),
    );
    expect(sqlText).not.toContain('contact_hidden');
  });
});

describe('nearestCaPortForProvince', () => {
  it('maps each province to its dominant Canadian hub (seaport OR inland rail)', () => {
    expect(nearestCaPortForProvince('BC')).toBe('CAVAN'); // Pacific gateway
    expect(nearestCaPortForProvince('AB')).toBe('INLCGY'); // Calgary inland ramp
    expect(nearestCaPortForProvince('SK')).toBe('INLWPG'); // Winnipeg inland ramp
    expect(nearestCaPortForProvince('MB')).toBe('INLWPG');
    expect(nearestCaPortForProvince('ON')).toBe('INLTOR'); // Toronto inland ramp
    expect(nearestCaPortForProvince('QC')).toBe('CAMTR'); // Montreal seaport
    expect(nearestCaPortForProvince('NS')).toBe('CAHAL');
    expect(nearestCaPortForProvince('PE')).toBe('CAHAL');
    expect(nearestCaPortForProvince('NL')).toBe('CAHAL');
    expect(nearestCaPortForProvince('NB')).toBe('CASJB');
    expect(nearestCaPortForProvince('on')).toBe('INLTOR'); // case-insensitive
    expect(nearestCaPortForProvince('XX')).toBeNull();
    expect(nearestCaPortForProvince(null)).toBeNull();
  });
});

describe('Canada gate in filterAndNormalizeCarriers', () => {
  // Same active carrier, but census places it in Ontario (a Canadian province).
  const caCensus = new Map<string, CensusRow>([
    ['107080', { dot_number: '107080', status_code: 'A', phy_state: 'ON', phy_city: 'TORONTO' }],
  ]);
  const mxCensus = new Map<string, CensusRow>([
    ['107080', { dot_number: '107080', status_code: 'A', phy_state: 'AG' }], // Aguascalientes, MX
  ]);

  it('DROPS a Canada-province carrier when includeCanada is off (default) — US-only preserved', () => {
    expect(filterAndNormalizeCarriers([activeCarrier], caCensus)).toHaveLength(0);
    expect(filterAndNormalizeCarriers([activeCarrier], caCensus, false)).toHaveLength(0);
  });

  it('KEEPS + tags a Canada-province carrier when includeCanada is on', () => {
    const [rec] = filterAndNormalizeCarriers([activeCarrier], caCensus, true);
    expect(rec.country).toBe('CA');
    expect(rec.state).toBe('ON');
    expect(rec.nearestPortCode).toBe('INLTOR'); // ON → Toronto inland ramp (province fallback)
  });

  it('DROPS a Mexico/other-domicile carrier regardless of includeCanada', () => {
    expect(filterAndNormalizeCarriers([activeCarrier], mxCensus, false)).toHaveLength(0);
    expect(filterAndNormalizeCarriers([activeCarrier], mxCensus, true)).toHaveLength(0);
  });

  it('produces the EXACT same US set from a mixed US+CA batch with the flag off', () => {
    // Two carriers: one US (activeCarrier/GA), one CA (contractCarrier relocated to ON).
    const caContract: LiCarrierRow = { ...contractCarrier, bus_state_code: 'ON', bus_zip_code: undefined };
    const usOnly = filterAndNormalizeCarriers([activeCarrier, caContract], censusByDot); // flag off
    expect(usOnly).toHaveLength(1);
    expect(usOnly[0].usdot).toBe('107080');
    expect(usOnly[0].country).toBe('US');
    // Turning the flag on adds the CA carrier without disturbing the US one.
    const withCa = filterAndNormalizeCarriers([activeCarrier, caContract], censusByDot, true);
    expect(withCa.map((c) => c.country).sort()).toEqual(['CA', 'US']);
  });
});
