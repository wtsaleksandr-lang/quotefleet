/**
 * TIER 1 — the routed per-state split, its guards, and its ground truth.
 *
 * Reads the two COMMITTED assets: the 4.5 MB routing graph and the Census
 * state-boundary archive. No network, no database — this suite passes with the
 * database down, which is the point of a tier that ships its own data.
 *
 * ── THE ONLY REAL GROUND TRUTH ────────────────────────────────────────────
 * Published interstate route logs. A reference router is one router's opinion,
 * and where it and this method pick different corridors neither is wrong. A
 * published route log is a measured fact about a road, so the two assertions
 * below are the ones that say whether the geometry pipeline works at all.
 */
import { describe, expect, it } from 'vitest';

import {
  NETWORK_DETOUR_LIMIT,
  loadStateBoundaries,
  routedStateMileage,
} from './routedMileage.js';
import { loadUsnet } from './usnet.js';
import type { LatLng } from './corridor.js';

const net = loadUsnet();
const boundaries = loadStateBoundaries();
const options = { net, boundaries };

const at = (latitude: number, longitude: number): LatLng => ({ latitude, longitude });

const LITTLE_ROCK = at(34.7465, -92.2896);
const ASHEVILLE = at(35.5951, -82.5515);
const BRISTOL_TN = at(36.5951, -82.1887);
const HAGERSTOWN_MD = at(39.6418, -77.72);
const MEMPHIS = at(35.1495, -90.049);
const KNOXVILLE = at(35.9606, -83.9207);
const SHREVEPORT = at(32.5252, -93.7502);
const RICHMOND = at(37.5407, -77.436);
const HOUSTON = at(29.7604, -95.3698);
const BUFFALO = at(42.8864, -78.8784);
const ELY_NEVADA = at(39.2472, -114.8883);
const TORONTO = at(43.6532, -79.3832);
const COLORADO_SPRINGS = at(38.8339, -104.8214);
const AMARILLO = at(35.222, -101.8313);

function milesIn(
  result: ReturnType<typeof routedStateMileage>,
  stateCode: string,
): number {
  if (!result.ok) throw new Error(`expected a measurement, got ${result.reason}`);
  return result.best.legs
    .filter((leg) => leg.stateCode === stateCode)
    .reduce((sum, leg) => sum + leg.miles, 0);
}

describe('ground truth — published interstate route logs', () => {
  it('measures I-40 through TENNESSEE to within 1% of its published 455.28 mi', () => {
    // Little Rock -> Asheville runs the whole length of I-40 across Tennessee,
    // so whatever error is left is this pipeline's OWN measurement error and
    // not a disagreement about which road to take. Measured: +0.11%.
    const result = routedStateMileage(LITTLE_ROCK, ASHEVILLE, options);
    expect(result.ok).toBe(true);
    const tennessee = milesIn(result, 'TN');
    expect(tennessee).toBeGreaterThan(455.28 * 0.99);
    expect(tennessee).toBeLessThan(455.28 * 1.01);
  });

  it('measures I-81 through VIRGINIA to within 2% of its published 324.92 mi', () => {
    // Measured: +0.42%, which beats the self-hosted OSRM the earlier evaluation
    // recommended (+3.98%) at $0/month instead of $25-40/month.
    const result = routedStateMileage(BRISTOL_TN, HAGERSTOWN_MD, options);
    expect(result.ok).toBe(true);
    const virginia = milesIn(result, 'VA');
    expect(virginia).toBeGreaterThan(324.92 * 0.98);
    expect(virginia).toBeLessThan(324.92 * 1.02);
  });
});

describe('the per-state split', () => {
  it('puts a single-state lane in that state and nowhere else', () => {
    const result = routedStateMileage(MEMPHIS, KNOXVILLE, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.permitStates).toContain('TN');
    expect(milesIn(result, 'TN')).toBeGreaterThan(350);
    // Nothing may leak into a neighbour it never enters — that is a permit.
    expect(result.permitStates).not.toContain('KY');
  });

  it("LANDS LOUISIANA IN ITS DISTANCE BAND, which is where the money is", () => {
    // Louisiana prices the overweight permit in DISTANCE BANDS, so a mileage a
    // few miles off can jump a band and change the fee by $180. The reference
    // route measures 170.7 mi of Louisiana on this lane and this method measures
    // 170.6 — the same `151-200` column, the same $375.00, to the cent. A
    // straight line measured 81.8 mi, landed in `51-100`, and quoted $195.
    const result = routedStateMileage(SHREVEPORT, RICHMOND, options);
    expect(result.ok).toBe(true);
    const louisiana = milesIn(result, 'LA');
    expect(louisiana).toBeGreaterThan(151);
    expect(louisiana).toBeLessThanOrEqual(200);
  });

  it('sums the legs to the lane, with nothing quietly dropped', () => {
    const result = routedStateMileage(HOUSTON, BUFFALO, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const legSum = result.best.legs.reduce((sum, leg) => sum + leg.miles, 0);
    // Unassigned miles are REPORTED, never dropped: dropping them under-bills
    // every per-mile state on the lane.
    expect(legSum + result.split.unassignedMiles).toBeGreaterThan(
      result.best.totalMiles * 0.95,
    );
  });
});

describe('the union of corridors — the permit list', () => {
  it('lists every state on any corridor, never only the priced one', () => {
    const result = routedStateMileage(HOUSTON, BUFFALO, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The permit list must be a SUPERSET of the corridor the miles came from.
    for (const code of result.best.stateCodes) expect(result.permitStates).toContain(code);
    // …and of every alternate's states. This is the whole design: a permit we
    // omit is an illegal load, one we invent is a phone call.
    for (const alternate of result.alternates) {
      for (const code of alternate.stateCodes) expect(result.permitStates).toContain(code);
    }
  });

  it('NEVER PRICES a state that is only on an alternate', () => {
    const result = routedStateMileage(HOUSTON, BUFFALO, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const code of result.unpricedStates) {
      // On the list…
      expect(result.permitStates).toContain(code);
      // …and with no measured mileage behind it. Pricing it from the
      // alternate's miles would invent a permit for a road we have no reason to
      // think the truck takes.
      expect(result.best.stateCodes).not.toContain(code);
      expect(milesIn(result, code)).toBe(0);
    }
    if (result.unpricedStates.length > 0) expect(result.requiresManualReview).toBe(true);
  });

  it('names the corridors by the roads that carry them', () => {
    const result = routedStateMileage(MEMPHIS, KNOXVILLE, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "Corridor 2, 1,567 mi" is not a choice a dispatcher can make. "via I-40" is.
    expect(result.best.label).toMatch(/^via /);
    expect(result.best.label).toContain('I-40');
  });
});

describe('the guards', () => {
  it('REFUSES an endpoint outside coverage instead of routing from far away', () => {
    // The nearest mapped primary road to Ely, Nevada is 121 miles away, because
    // US-50 and US-93 are classified below S1100. Routing from the nearest node
    // would invent 121 miles and any state that hop crossed.
    const result = routedStateMileage(ELY_NEVADA, KNOXVILLE, options);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outsideCoverage');
    expect(result.warnings.join(' ')).toMatch(/nearest road/i);
  });

  it('REFUSES a Canadian endpoint, which is the correct answer today', () => {
    const result = routedStateMileage(TORONTO, KNOXVILLE, options);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outsideCoverage');
  });

  it('REFUSES a lane the network had to detour around', () => {
    // The real Colorado Springs -> Amarillo route runs US-87 and US-64 across
    // north-eastern New Mexico, and neither is in this dataset. The graph goes
    // down to Albuquerque and back on I-40: 663 mi against a real 359, and NEW
    // MEXICO'S 100 MILES DISAPPEAR from the permit list. Answering would have
    // replaced an honest question with a confident, well-formed error.
    const result = routedStateMileage(COLORADO_SPRINGS, AMARILLO, options);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('networkDetour');
    expect(result.warnings.join(' ')).toMatch(/not in the dataset/i);
  });

  it('keeps the detour limit where the measurement put it', () => {
    // Measured over 80 lanes: 1.12 refuses 14 of them and leaves the rest at
    // 2.1% mean total error against 5.1% with no gate at all. Moving this
    // number without re-running scripts/tiger-net/validate.ts is guessing.
    expect(NETWORK_DETOUR_LIMIT).toBe(1.12);
  });

  it('passes an ordinary interstate lane through every guard', () => {
    const result = routedStateMileage(MEMPHIS, KNOXVILLE, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverage.ok).toBe(true);
    expect(result.requiresManualReview).toBe(false);
    expect(result.unpricedStates).toEqual([]);
  });
});

describe('provenance', () => {
  it('says the mileage was measured and that filed miles beat it', () => {
    const result = routedStateMileage(MEMPHIS, KNOXVILLE, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const said = result.warnings.join(' ');
    expect(said).toMatch(/MEASURED/);
    expect(said).toMatch(/public domain/i);
    // The tier must never let itself read as authoritative: tier 0 outranks it.
    expect(said).toMatch(/PC\*Miler|ProMiles/);
  });

  it('refuses cartographic boundaries — the guard that stops mis-billed states', () => {
    // Generalized `cb_*` boundaries move state lines by miles. The archive we
    // ship is the full-resolution file, byte-identical to what Census serves,
    // which is what keeps this check meaningful rather than a tautology.
    expect(boundaries.sourceUrl).toMatch(/tl_\d{4}_us_state\.zip$/);
    expect(boundaries.states.length).toBeGreaterThanOrEqual(50);
  });
});
