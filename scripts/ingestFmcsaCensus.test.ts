/**
 * FMCSA ingest — pure parse + broker-filter + normalize tests. No network, no DB.
 * Fixtures mirror the REAL Socrata column names:
 *   L&I Carrier (6eyk-hxee): broker_stat / property_chk / docket_number / bus_*
 *   Census    (az4n-8mr2)  : email_address / power_units / status_code / phy_*
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeDot,
  normalizeEmail,
  normalizePhone,
  isActivePropertyBroker,
  censusAllowsOperate,
  filterAndNormalizeBrokers,
  type LiCarrierRow,
  type CensusRow,
} from './ingestFmcsaCensus.js';

// ── Real-shaped fixtures ────────────────────────────────────────────────
const activeBroker: LiCarrierRow = {
  docket_number: 'MC009153',
  dot_number: '00107080', // zero-padded in L&I
  broker_stat: 'A',
  property_chk: 'Y',
  hhg_chk: 'N',
  legal_name: 'J R CHRISTONI INC',
  dba_name: 'CHRISTONI FREIGHT',
  bus_street_po: '10 MAIN ST',
  bus_city: 'CHESHIRE',
  bus_state_code: 'ct',
  bus_zip_code: '06410',
  bus_telno: '2032650921',
};

// A carrier with NO broker authority — must be dropped.
const carrierOnly: LiCarrierRow = {
  docket_number: 'MC012892',
  dot_number: '02217388',
  broker_stat: 'N',
  property_chk: 'N',
  hhg_chk: 'N',
  legal_name: 'NORMAN CHARLES BRINKE',
  bus_city: 'HIALEAH',
  bus_state_code: 'FL',
  bus_telno: '3055551234',
};

// A HHG-only broker (property_chk='N') — must be dropped (not general freight).
const hhgBroker: LiCarrierRow = {
  docket_number: 'MC099999',
  dot_number: '03000000',
  broker_stat: 'A',
  property_chk: 'N',
  hhg_chk: 'Y',
  legal_name: 'MOVERS BROKER LLC',
  bus_state_code: 'TX',
};

const censusByDot = new Map<string, CensusRow>([
  [
    '107080',
    {
      dot_number: '107080',
      legal_name: 'J R CHRISTONI INC',
      email_address: 'TRUCKS@att.NET',
      power_units: '2',
      phone: '2032650921',
      status_code: 'A',
      phy_street: '10 MAIN ST',
      phy_city: 'CHESHIRE',
      phy_state: 'CT',
      phy_zip: '06410-1234',
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
  it('normalizeEmail lowercases and rejects junk', () => {
    expect(normalizeEmail('TRUCKS@att.NET')).toBe('trucks@att.net');
    expect(normalizeEmail('N/A')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });
  it('normalizePhone keeps ≥10-digit numbers as digits', () => {
    expect(normalizePhone('(203) 265-0921')).toBe('2032650921');
    expect(normalizePhone('12345')).toBeNull();
  });
  it('isActivePropertyBroker gates on broker_stat + property_chk', () => {
    expect(isActivePropertyBroker(activeBroker)).toBe(true);
    expect(isActivePropertyBroker(carrierOnly)).toBe(false);
    expect(isActivePropertyBroker(hhgBroker)).toBe(false);
  });
  it('censusAllowsOperate drops status I, keeps A / missing', () => {
    expect(censusAllowsOperate({ status_code: 'A' })).toBe(true);
    expect(censusAllowsOperate({ status_code: 'I' })).toBe(false);
    expect(censusAllowsOperate(undefined)).toBe(true);
  });
});

// ── filter + normalize ──────────────────────────────────────────────────
describe('filterAndNormalizeBrokers', () => {
  it('keeps only the active property broker and drops carrier-only + HHG rows', () => {
    const out = filterAndNormalizeBrokers([activeBroker, carrierOnly, hhgBroker], censusByDot);
    expect(out).toHaveLength(1);
    expect(out[0].mcNumber).toBe('MC009153');
  });

  it('normalizes fields and captures the census email + power units', () => {
    const [lead] = filterAndNormalizeBrokers([activeBroker], censusByDot);
    expect(lead.dotNumber).toBe('107080'); // zeros stripped
    expect(lead.legalName).toBe('J R CHRISTONI INC');
    expect(lead.dbaName).toBe('CHRISTONI FREIGHT');
    expect(lead.censusEmail).toBe('trucks@att.net'); // captured + lowercased
    expect(lead.powerUnits).toBe(2);
    expect(lead.phone).toBe('2032650921');
    expect(lead.addrState).toBe('CT'); // upper-cased
    expect(lead.addrZip).toBe('06410-1234'); // census physical preferred
    expect(lead.segment).toBe('broker');
  });

  it('keeps an active broker with NO census match (email null, L&I address used)', () => {
    const out = filterAndNormalizeBrokers([activeBroker], new Map());
    expect(out).toHaveLength(1);
    expect(out[0].censusEmail).toBeNull();
    expect(out[0].powerUnits).toBeNull();
    expect(out[0].addrState).toBe('CT'); // from L&I bus_state_code, upper-cased
    expect(out[0].phone).toBe('2032650921');
  });

  it('drops an active broker whose census row is status I (not allowed to operate)', () => {
    const inactive = new Map<string, CensusRow>([['107080', { dot_number: '107080', status_code: 'I' }]]);
    expect(filterAndNormalizeBrokers([activeBroker], inactive)).toHaveLength(0);
  });
});
