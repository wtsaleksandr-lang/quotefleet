/**
 * The anti-thin floor — the contract that decides whether a page may exist.
 *
 * `buildCarrierData` is the single chokepoint: raw corpus stats in, gated
 * result out. If a below-floor cut can ever emit a number, thin pages become
 * possible and the whole surface is a doorway-page liability. So these tests
 * assert the floor structurally (the insufficient shape carries NO statistics
 * at all, not merely statistics we promise not to read) and cover the sub-cut
 * and sparse-rating cases where a naive implementation leaks thin numbers into
 * otherwise-healthy prose.
 *
 * No database: the loader is injected, and the pure builder is driven directly.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_MIN_SAMPLE,
  buildCarrierData,
  clearCarrierDataCache,
  computeUniqueDataScore,
  cutKey,
  cutLabel,
  displayCity,
  getCarrierDataForCut,
  getMinSample,
  type CarrierCut,
  type CarrierCutStats,
  type SufficientCarrierData,
} from './carrierDataService.js';

const CITY_CUT: CarrierCut = { kind: 'city', state: 'TX', city: 'HOUSTON' };
const EQUIP_CUT: CarrierCut = { kind: 'state_equipment', state: 'CA', equipment: 'reefer' };

function stats(over: Partial<CarrierCutStats> = {}): CarrierCutStats {
  return {
    totalInCut: 300,
    pricedCount: 280,
    min: 1,
    p25: 2,
    median: 5,
    p75: 14,
    max: 620,
    totalPowerUnits: 4200,
    ownerOperators: 140,
    largeFleets: 21,
    flagCounts: { reefer: 60, flatbed: 90, intermodal: 30 },
    rated: 40,
    satisfactory: 35,
    conditional: 5,
    topPort: { code: 'USHOU', count: 210 },
    variations: [],
    ...over,
  };
}

describe('minimum-sample floor', () => {
  it('defaults to 25 — well above the 5 the source engine used', () => {
    // The corpus is public federal data, so the floor is doing anti-thin duty
    // only, and can afford to be strict: 2,289 (state,city) cells still clear it.
    expect(DEFAULT_MIN_SAMPLE).toBe(25);
    expect(getMinSample()).toBe(25);
  });

  it('reads SEO_DATA_MIN_SAMPLE when set to a sane value', () => {
    process.env.SEO_DATA_MIN_SAMPLE = '40';
    expect(getMinSample()).toBe(40);
    process.env.SEO_DATA_MIN_SAMPLE = 'nonsense';
    expect(getMinSample()).toBe(DEFAULT_MIN_SAMPLE);
    delete process.env.SEO_DATA_MIN_SAMPLE;
  });
});

describe('buildCarrierData — the gate', () => {
  it('emits NO statistics below the floor', () => {
    const out = buildCarrierData(stats({ pricedCount: 24 }), CITY_CUT, 25);
    expect(out.sufficient).toBe(false);
    if (out.sufficient) throw new Error('unreachable');
    expect(out.sampleSize).toBe(24);
    expect(out.minSample).toBe(25);
    // Structural assertion: the below-floor shape must not carry a single
    // aggregate. Reading any of these off the result is a type error AND, here,
    // a runtime absence — so a regression cannot quietly start emitting them.
    for (const k of ['median', 'p25', 'p75', 'max', 'totalPowerUnits', 'equipmentMix']) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it('emits statistics exactly at the floor', () => {
    const out = buildCarrierData(stats({ pricedCount: 25 }), CITY_CUT, 25);
    expect(out.sufficient).toBe(true);
    if (!out.sufficient) throw new Error('unreachable');
    expect(out.median).toBe(5);
    expect(out.totalPowerUnits).toBe(4200);
  });

  it('shapes shares and rounds money-like values to whole units', () => {
    const out = buildCarrierData(
      stats({ pricedCount: 200, ownerOperators: 100, largeFleets: 20, median: 5.5 }),
      CITY_CUT,
      25,
    ) as SufficientCarrierData;
    expect(out.ownerOperatorShare).toBe(0.5);
    expect(out.largeFleetShare).toBe(0.1);
    expect(out.median).toBe(6); // rounded, never a fractional truck
  });

  it('orders the equipment mix by carrier count, densest first', () => {
    const out = buildCarrierData(stats(), CITY_CUT, 25) as SufficientCarrierData;
    expect(out.equipmentMix.map((e) => e.count)).toEqual([90, 60, 30]);
    expect(out.equipmentMix[0].label).toBe('flatbed');
  });

  it('drops zero-count equipment rather than citing "0 carriers"', () => {
    const out = buildCarrierData(
      stats({ flagCounts: { reefer: 60, flatbed: 0, tanker: 0 } }),
      CITY_CUT,
      25,
    ) as SufficientCarrierData;
    expect(out.equipmentMix).toHaveLength(1);
  });
});

describe('sub-cut leakage', () => {
  it('quotes only sub-cuts that independently clear the floor', () => {
    // A guide that says "Bakersfield: 3 carriers, median 2 trucks" is exactly
    // the thin claim the floor exists to prevent — being inside an otherwise
    // healthy page does not make it citable.
    const out = buildCarrierData(
      stats({
        variations: [
          { label: 'LOS ANGELES', sampleSize: 400, medianFleet: 6 },
          { label: 'FRESNO', sampleSize: 90, medianFleet: 4 },
          { label: 'TINYTOWN', sampleSize: 3, medianFleet: 2 },
        ],
      }),
      EQUIP_CUT,
      25,
    ) as SufficientCarrierData;
    expect(out.variations.map((v) => v.label)).toEqual(['LOS ANGELES', 'FRESNO']);
  });
});

describe('sparse FMCSA safety ratings', () => {
  it('reports ratings when the RATED subset itself clears the floor', () => {
    const out = buildCarrierData(stats({ rated: 40 }), CITY_CUT, 25) as SufficientCarrierData;
    expect(out.safety).toEqual({ rated: 40, satisfactory: 35, conditional: 5 });
  });

  it('suppresses ratings when too few carriers are rated', () => {
    // ~92% of the census is unrated. "100% Satisfactory" over 3 rated carriers
    // is a true sentence that reads as a claim about a whole market.
    const out = buildCarrierData(
      stats({ rated: 3, satisfactory: 3, conditional: 0 }),
      CITY_CUT,
      25,
    ) as SufficientCarrierData;
    expect(out.safety).toBeNull();
  });
});

describe('computeUniqueDataScore', () => {
  it('dedupes equal percentile anchors so a flat cut cannot inflate its score', () => {
    const flat = buildCarrierData(
      stats({ min: 3, p25: 3, median: 3, p75: 3, max: 3, rated: 0, topPort: null, flagCounts: {} }),
      CITY_CUT,
      25,
    ) as SufficientCarrierData;
    const varied = buildCarrierData(stats({ rated: 0, topPort: null, flagCounts: {} }), CITY_CUT, 25) as SufficientCarrierData;
    expect(computeUniqueDataScore(flat)).toBeLessThan(computeUniqueDataScore(varied));
  });

  it('rewards genuinely distinct cuts', () => {
    const rich = buildCarrierData(
      stats({ variations: [{ label: 'LOS ANGELES', sampleSize: 400, medianFleet: 6 }] }),
      EQUIP_CUT,
      25,
    ) as SufficientCarrierData;
    expect(computeUniqueDataScore(rich)).toBeGreaterThanOrEqual(9);
  });
});

describe('cut identity', () => {
  it('produces distinct, stable keys per cut kind', () => {
    expect(cutKey(CITY_CUT)).toBe('city|TX|HOUSTON');
    expect(cutKey(EQUIP_CUT)).toBe('state_equipment|CA|reefer');
    expect(cutKey(CITY_CUT)).not.toBe(cutKey(EQUIP_CUT));
  });

  it('labels cuts in prose-ready form, title-casing the stored city', () => {
    // The corpus stores 'HOUSTON'. Every human-facing string — title, meta
    // description, body prose — must read 'Houston', so the conversion belongs
    // here, next to the cut, and not at each call site.
    expect(cutLabel(CITY_CUT)).toBe('Houston, TX');
    expect(cutLabel(EQUIP_CUT)).toBe('refrigerated (reefer) carriers in CA');
  });

  it('title-cases multi-word cities', () => {
    expect(displayCity('LOS ANGELES')).toBe('Los Angeles');
  });
});

describe('getCarrierDataForCut — injected loader, no DB', () => {
  beforeEach(() => clearCarrierDataCache());
  afterEach(() => clearCarrierDataCache());

  it('passes the loader result through the gate', async () => {
    const out = await getCarrierDataForCut(CITY_CUT, async () => stats({ pricedCount: 10 }));
    expect(out.sufficient).toBe(false);
  });

  it('memoizes per cut so the generator can call it freely', async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return stats();
    };
    await getCarrierDataForCut(CITY_CUT, loader);
    await getCarrierDataForCut(CITY_CUT, loader);
    expect(calls).toBe(1);
    await getCarrierDataForCut(EQUIP_CUT, loader);
    expect(calls).toBe(2);
  });
});
