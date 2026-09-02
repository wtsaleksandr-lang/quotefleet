import { describe, expect, it } from 'vitest';
import {
  prepareTigerStateBoundaries,
  splitRouteMileageByState,
  TIGER_LINE_STATE_BOUNDARIES_URL,
  type TigerStateBoundaryCollection,
} from './stateMileage.js';

/**
 * A clipped two-state fixture around the I-95 Virginia/North Carolina
 * crossing. Production uses the full ZIP; rectangles here keep the expected
 * mileage auditable and test the crossing math independently of data updates.
 */
const VA_NC_I95_FIXTURE: TigerStateBoundaryCollection = {
  type: 'FeatureCollection',
  tigerLine: {
    sourceUrl: TIGER_LINE_STATE_BOUNDARIES_URL,
    vintage: 2025,
    resolution: 'full',
  },
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

describe('per-state route mileage', () => {
  it('splits a known I-95-area Virginia-to-North-Carolina route in traversal order', () => {
    const mileage = splitRouteMileageByState(
      [
        { latitude: 36.68598, longitude: -77.5 }, // Emporia, Virginia latitude
        { latitude: 36.4615, longitude: -77.5 }, // Roanoke Rapids, North Carolina latitude
      ],
      VA_NC_I95_FIXTURE,
    );

    expect(mileage.map((leg) => leg.stateCode)).toEqual(['VA', 'NC']);
    expect(mileage[0]?.miles).toBeCloseTo(9.88, 1);
    expect(mileage[1]?.miles).toBeCloseTo(5.63, 1);
    expect(mileage.reduce((sum, leg) => sum + leg.miles, 0)).toBeCloseTo(15.51, 1);
  });

  it('rejects cartographic or unverified boundary metadata', () => {
    const cartographic = structuredClone(VA_NC_I95_FIXTURE);
    cartographic.tigerLine.sourceUrl =
      'https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_20m.zip';
    expect(() => prepareTigerStateBoundaries(cartographic)).toThrow(/full-resolution/i);
  });
});
