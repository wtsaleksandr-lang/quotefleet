import { describe, expect, it } from 'vitest';
import {
  operatorSuppliedStateMileage,
  osowLegsFrom,
  prepareTigerStateBoundaries,
  priceOsowWithStateMileage,
  splitRouteMileageByState,
  TIGER_LINE_STATE_BOUNDARIES_URL,
  type TigerStateBoundaryCollection,
} from './stateMileage.js';
import { calculateOsow } from './engine.js';

/**
 * A clipped two-state fixture around the I-95 Virginia/North Carolina crossing.
 * Production uses the full ZIP; rectangles here keep the expected mileage
 * auditable and test the crossing math independently of data updates.
 */
const VA_NC_I95_FIXTURE: TigerStateBoundaryCollection = {
  type: 'FeatureCollection',
  tigerLine: { sourceUrl: TIGER_LINE_STATE_BOUNDARIES_URL, resolution: 'full' },
  features: [
    {
      type: 'Feature',
      properties: { STUSPS: 'VA', NAME: 'Virginia' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-78, 36.543], [-77, 36.543], [-77, 38], [-78, 38], [-78, 36.543]]],
      },
    },
    {
      type: 'Feature',
      properties: { STUSPS: 'NC', NAME: 'North Carolina' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-78, 35], [-77, 35], [-77, 36.543], [-78, 36.543], [-78, 35]]],
      },
    },
  ],
};

/**
 * The same two states with a strip of unclaimed water between them — the shape
 * a real boundary file takes at a wide river or a coastal shoreline. The
 * salvaged implementation THREW on this; a Mississippi bridge on a Houston-to-
 * Buffalo corridor is exactly this geometry, and losing the whole quote to it
 * was the worst defect in the file.
 */
const GAPPED_FIXTURE: TigerStateBoundaryCollection = {
  type: 'FeatureCollection',
  tigerLine: { sourceUrl: TIGER_LINE_STATE_BOUNDARIES_URL, resolution: 'full' },
  features: [
    {
      type: 'Feature',
      properties: { STUSPS: 'AR', NAME: 'Arkansas' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-91, 35], [-90.2, 35], [-90.2, 36], [-91, 36], [-91, 35]]],
      },
    },
    {
      type: 'Feature',
      properties: { STUSPS: 'TN', NAME: 'Tennessee' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-90, 35], [-89, 35], [-89, 36], [-90, 36], [-90, 35]]],
      },
    },
  ],
};

/** A 64-edge ring, to exercise the chunked index past its 32-edge chunk size. */
function circleFixture(): TigerStateBoundaryCollection {
  const points: Array<[number, number]> = [];
  for (let step = 0; step <= 64; step += 1) {
    const angle = (step / 64) * Math.PI * 2;
    points.push([-95 + Math.cos(angle) * 2, 35 + Math.sin(angle) * 2]);
  }
  return {
    type: 'FeatureCollection',
    tigerLine: { sourceUrl: TIGER_LINE_STATE_BOUNDARIES_URL, resolution: 'full' },
    features: [
      {
        type: 'Feature',
        properties: { STUSPS: 'XX', NAME: 'Circleland' },
        geometry: { type: 'Polygon', coordinates: [points] },
      },
    ],
  };
}

describe('per-state route mileage — polyline split', () => {
  it('splits a known I-95-area Virginia-to-North-Carolina route in traversal order', () => {
    const split = splitRouteMileageByState(
      [
        { latitude: 36.68598, longitude: -77.5 }, // Emporia, Virginia latitude
        { latitude: 36.4615, longitude: -77.5 }, // Roanoke Rapids, North Carolina latitude
      ],
      VA_NC_I95_FIXTURE,
    );

    expect(split.legs.map((leg) => leg.stateCode)).toEqual(['VA', 'NC']);
    expect(split.legs[0]?.miles).toBeCloseTo(9.88, 1);
    expect(split.legs[1]?.miles).toBeCloseTo(5.63, 1);
    expect(split.totalMiles).toBeCloseTo(15.51, 1);
    expect(split.unassignedMiles).toBe(0);
  });

  it('labels a polyline split as approximate and says why, on every result', () => {
    const split = splitRouteMileageByState(
      [
        { latitude: 36.68598, longitude: -77.5 },
        { latitude: 36.4615, longitude: -77.5 },
      ],
      VA_NC_I95_FIXTURE,
    );

    expect(split.basis).toBe('routedPolyline');
    expect(split.approximate).toBe(true);
    // The undercount direction is the part that misprices, so it must be stated.
    expect(split.warnings.join(' ')).toMatch(/SHORT of the road distance/i);
  });

  it('reports miles it cannot place in a state instead of throwing', () => {
    // Crosses the unclaimed strip between -90.2 and -90.0 longitude.
    const split = splitRouteMileageByState(
      [
        { latitude: 35.5, longitude: -90.6 },
        { latitude: 35.5, longitude: -89.6 },
      ],
      GAPPED_FIXTURE,
    );

    expect(split.legs.map((leg) => leg.stateCode)).toEqual(['AR', 'TN']);
    expect(split.unassignedMiles).toBeGreaterThan(0);
    expect(split.requiresManualReview).toBe(true);
    expect(split.warnings.join(' ')).toMatch(/could not be assigned to a state/i);
    // The unassigned miles must NOT be quietly folded into a neighbour.
    const placed = split.legs.reduce((sum, leg) => sum + leg.miles, 0);
    expect(placed).toBeLessThan(placed + split.unassignedMiles);
  });

  it('keeps a re-entered state as two legs but bills it once', () => {
    // Out of Virginia into North Carolina and back into Virginia.
    const split = splitRouteMileageByState(
      [
        { latitude: 36.7, longitude: -77.5 },
        { latitude: 36.3, longitude: -77.5 },
        { latitude: 36.7, longitude: -77.4 },
      ],
      VA_NC_I95_FIXTURE,
    );

    expect(split.legs.map((leg) => leg.stateCode)).toEqual(['VA', 'NC', 'VA']);
    const legs = osowLegsFrom(split);
    expect(legs.map((leg) => (typeof leg === 'string' ? leg : leg.code))).toEqual(['VA', 'NC']);
    const virginia = legs[0];
    const bothVirginiaStretches =
      (split.legs[0]?.miles ?? 0) + (split.legs[2]?.miles ?? 0);
    expect(typeof virginia === 'string' ? 0 : virginia?.milesInJurisdiction).toBeCloseTo(
      bothVirginiaStretches,
      1,
    );
  });

  it('indexes rings in chunks without changing the answer on a >32-edge ring', () => {
    const split = splitRouteMileageByState(
      [
        { latitude: 35, longitude: -98 },
        { latitude: 35, longitude: -92 },
      ],
      circleFixture(),
    );

    // The chord through the centre of a 2-degree-radius circle is 4 degrees of
    // longitude at 35N; anything outside it is unclaimed by the one fixture state.
    expect(split.legs.map((leg) => leg.stateCode)).toEqual(['XX']);
    expect(split.legs[0]?.miles).toBeCloseTo(4 * 69.0946 * Math.cos((35 * Math.PI) / 180), 0);
  });

  it('rejects cartographic or unverified boundary metadata', () => {
    const cartographic = structuredClone(VA_NC_I95_FIXTURE);
    cartographic.tigerLine.sourceUrl =
      'https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_20m.zip';
    expect(() => prepareTigerStateBoundaries(cartographic)).toThrow(/full-resolution/i);
  });
});

describe('per-state route mileage — supplying miles', () => {
  it('labels operator-supplied mileage as supplied, with the figures in the warning', () => {
    const split = operatorSuppliedStateMileage([
      { stateCode: 'tx', stateName: 'Texas', miles: 120 },
      { stateCode: 'AR', stateName: 'Arkansas', miles: 287 },
    ]);

    expect(split.basis).toBe('operatorSupplied');
    expect(split.approximate).toBe(false);
    expect(split.legs.map((leg) => leg.stateCode)).toEqual(['TX', 'AR']);
    expect(split.totalMiles).toBe(407);
    expect(split.warnings.join(' ')).toMatch(/SUPPLIED, not measured/);
    expect(split.warnings.join(' ')).toContain('AR 287 mi');
  });

  it('drops an unusable mileage row rather than inventing one', () => {
    const split = operatorSuppliedStateMileage([
      { stateCode: 'TN', miles: Number.NaN },
      { stateCode: '', miles: 10 },
      { stateCode: 'KY', miles: 40 },
    ]);

    expect(split.legs.map((leg) => leg.stateCode)).toEqual(['KY']);
    expect(split.requiresManualReview).toBe(true);
    expect(split.warnings.join(' ')).toMatch(/not a usable distance/i);
  });
});

/**
 * Pinned as-of date, matching the newest retrieval date in the jurisdiction
 * files (the same convention `engine.test.ts` uses per phase). Every row on
 * file is in effect on it, so a refusal here is the engine's rule and not an
 * out-of-window artefact.
 */
const ASOF = '2026-09-03';

describe('per-state route mileage — reaching the engine', () => {
  const OVERWEIGHT_LOAD = {
    grossWeightLbs: 120_000,
    widthIn: 120,
    heightIn: 162,
    trailerLengthIn: 636,
    overallLengthIn: 900,
    axleCount: 7,
  };

  it('supplies the miles a distance-priced state refuses to be quoted without', () => {
    // The refusal is the baseline and it must stay: Tennessee prices per
    // ton-mile and will not guess the distance.
    const withoutMiles = calculateOsow(['TN'], OVERWEIGHT_LOAD, ASOF);
    expect(withoutMiles.jurisdictions[0]?.requiresManualReview).toBe(true);
    expect(withoutMiles.warnings.join(' ')).toMatch(/per mile travelled inside the state/i);

    const split = operatorSuppliedStateMileage([
      { stateCode: 'TN', stateName: 'Tennessee', miles: 200 },
    ]);
    const withMiles = priceOsowWithStateMileage(split, OVERWEIGHT_LOAD, ASOF);
    const tennessee = withMiles.jurisdictions[0];
    const overweight = tennessee?.lines.find((line) => line.code === 'osow_overweight');
    // 6c per ton-mile: 20 tons over the 80,000 lb limit x 200 mi x $0.06.
    expect(overweight?.amountUsd).toBeCloseTo(240, 2);
  });

  it('carries the mileage basis into the quote, so a priced lane cannot hide it', () => {
    const split = operatorSuppliedStateMileage([
      { stateCode: 'TN', stateName: 'Tennessee', miles: 200 },
    ]);
    const quote = priceOsowWithStateMileage(split, OVERWEIGHT_LOAD, ASOF);
    expect(quote.warnings[0]).toMatch(/SUPPLIED, not measured/);
  });

  it('propagates a split that could not be trusted into the quote review flag', () => {
    const split = operatorSuppliedStateMileage([
      { stateCode: 'TN', stateName: 'Tennessee', miles: 200 },
      { stateCode: 'KY', miles: -5 },
    ]);
    const quote = priceOsowWithStateMileage(split, OVERWEIGHT_LOAD, ASOF);
    expect(quote.requiresManualReview).toBe(true);
  });
});
