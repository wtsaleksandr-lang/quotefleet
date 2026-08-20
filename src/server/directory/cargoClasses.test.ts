/**
 * FMCSA cargo-CLASS ingest mapping — verifies each new census crgo_* flag ('X')
 * maps to the correct carrier_directory boolean (migration 0050), and that the
 * upsert set refreshes every one on a re-ingest. Pure — no DB / network.
 */
import { describe, it, expect } from 'vitest';
import {
  cargoClassFlags,
  normalizeCarrier,
  CARRIER_UPSERT_SET,
  type CensusRow,
  type LiCarrierRow,
} from './carrierIngest.js';

const CARGO_PAIRS: Array<[keyof CensusRow, keyof ReturnType<typeof cargoClassFlags>]> = [
  ['crgo_household', 'householdGoods'],
  ['crgo_beverages', 'beverages'],
  ['crgo_produce', 'produce'],
  ['crgo_motoveh', 'motorVehicles'],
  ['crgo_livestock', 'livestock'],
  ['crgo_grainfeed', 'grainFeed'],
  ['crgo_oilfield', 'oilfield'],
  ['crgo_meat', 'meat'],
  ['crgo_paperprod', 'paper'],
  ['crgo_construct', 'construction'],
  ['crgo_farmsupp', 'farmSupplies'],
  ['crgo_coalcoke', 'coalCoke'],
  ['crgo_bldgmat', 'buildingMaterials'],
];

describe('cargoClassFlags — census crgo_* → boolean mapping', () => {
  it('defaults every cargo flag to false for a missing census row', () => {
    const flags = cargoClassFlags(undefined);
    for (const [, prop] of CARGO_PAIRS) expect(flags[prop]).toBe(false);
  });

  it("maps each crgo_*='X' to exactly its own boolean (no cross-wiring)", () => {
    for (const [col, prop] of CARGO_PAIRS) {
      const flags = cargoClassFlags({ [col]: 'X' } as CensusRow);
      expect(flags[prop]).toBe(true);
      // Every OTHER cargo flag stays false — proves 1:1 column wiring.
      for (const [, other] of CARGO_PAIRS) {
        if (other !== prop) expect(flags[other]).toBe(false);
      }
    }
  });

  it("treats lower-case 'x' as set and anything else as unset", () => {
    expect(cargoClassFlags({ crgo_household: 'x' } as CensusRow).householdGoods).toBe(true);
    expect(cargoClassFlags({ crgo_household: 'N' } as CensusRow).householdGoods).toBe(false);
    expect(cargoClassFlags({ crgo_household: '' } as CensusRow).householdGoods).toBe(false);
  });
});

describe('normalizeCarrier — cargo classes flow onto the persisted record', () => {
  const li: LiCarrierRow = {
    dot_number: '107080',
    common_stat: 'A',
    property_chk: 'Y',
    legal_name: 'ACME PRODUCE HAULERS',
    bus_state_code: 'TX',
  };

  it('carries the census cargo flags through to the record', () => {
    const rec = normalizeCarrier(li, { crgo_produce: 'X', crgo_meat: 'X' } as CensusRow);
    expect(rec).not.toBeNull();
    expect(rec!.produce).toBe(true);
    expect(rec!.meat).toBe(true);
    expect(rec!.householdGoods).toBe(false);
  });
});

describe('CARRIER_UPSERT_SET — re-ingest refreshes every cargo column', () => {
  it('includes all thirteen new cargo columns so a re-ingest backfills them', () => {
    const keys = Object.keys(CARRIER_UPSERT_SET);
    for (const [, prop] of CARGO_PAIRS) expect(keys).toContain(prop);
  });
});
