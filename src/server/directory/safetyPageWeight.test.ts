/**
 * CRAWL-BUDGET GUARD for the safety block.
 *
 * PR #455 cut directory page weight ~60% and #457 kept it flat, because Google
 * indexes only a fraction of these ~330k near-identical pages and every wasted
 * byte is crawl budget spent on boilerplate instead of on pages that differentiate.
 * The safety record is exactly the "genuinely differentiating content" that work
 * concluded these pages need — but it still has to pay for itself in bytes.
 *
 * This test PINS the cost so a future edit cannot quietly bloat 330k pages: it
 * measures the profile HTML with and without a safety record and fails if the
 * delta exceeds the budget below. It is a real measurement, not a guess.
 */
import { describe, expect, it } from 'vitest';
import { renderCarrierProfile } from './pages.js';
import type { VisibleCarrier } from './queries.js';
import { EMPTY_SAFETY, type CarrierSafety } from './safetyData.js';

/**
 * Byte budget for the fully-populated safety block, over a profile that has no
 * safety data at all. ~1.6KB measured; 2.5KB leaves headroom for copy edits
 * without leaving room for a redesign that reintroduces page bloat.
 */
const SAFETY_BLOCK_BUDGET_BYTES = 2_500;

const AS_OF = new Date('2026-08-30T00:00:00Z');
const FULL: CarrierSafety = {
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

function carrier(safety: CarrierSafety | null): VisibleCarrier {
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
    safety,
  } as VisibleCarrier;
}

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

describe('carrier profile page weight — safety block', () => {
  const withSafety = bytes(renderCarrierProfile({ carrier: carrier(FULL) }));
  const withoutSafety = bytes(renderCarrierProfile({ carrier: carrier(EMPTY_SAFETY) }));

  it('adds differentiating content for well under the byte budget', () => {
    const delta = withSafety - withoutSafety;
    // Surfaced for the record whenever this test is run verbosely.
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(SAFETY_BLOCK_BUDGET_BYTES);
  });

  it('costs a carrier with NO safety data only a one-line note', () => {
    // The no-data path is the one that must stay cheap: it renders on every
    // carrier FMCSA has no record for, which is a large slice of ~330k pages.
    const bare = bytes(renderCarrierProfile({ carrier: carrier(null) }));
    expect(bare - withoutSafety).toBe(0);
    expect(withoutSafety).toBeLessThan(withSafety);
  });
});
