/**
 * The heavy-haul composer, its geography and its confidence KPI.
 *
 * ZERO NETWORK CALLS. Every geocoder test injects a stub `fetch`, and every
 * pricing test is handed already-resolved endpoints — the real Census
 * coordinates for the two worked-example addresses, recorded once and compiled
 * in. Nothing in this file reaches the internet or the database.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  geocodeAddress,
  clearGeocodeCache,
  CENSUS_BENCHMARKS,
} from './geocode.js';
import {
  corridorStates,
  scalarLaneDistance,
  filedLaneDistance,
  haversineMiles,
  STRAIGHT_TO_ROAD_FACTOR,
  MILEAGE_TIERS,
  LIKELY_RUN_MILES,
} from './corridor.js';
import {
  scoreHeavyHaulConfidence,
  labelForScore,
  confidenceRange,
  CONFIDENCE_BANDS,
  type ConfidenceInput,
} from './confidence.js';
import {
  priceHeavyHaulLane,
  heavyHaulCalcLines,
  HEAVY_HAUL_NOT_INCLUDED,
  type DieselReading,
  type LaneEndpoint,
} from './quote.js';
import { hasOsowCoverage } from '../osow/jurisdictions/index.js';

/**
 * The date the permit corpus is read as of, pinned so a schedule taking effect
 * tomorrow cannot silently move an assertion. Same value the permits suite uses.
 */
const ASOF = '2026-09-03';

/** Real US Census results for the worked-example endpoints. */
const HOUSTON: LaneEndpoint = {
  address: '1500 McKinney St, Houston, TX 77010',
  matchedAddress: '1500 MCKINNEY ST, HOUSTON, TX, 77010',
  latitude: 29.754276036552,
  longitude: -95.360587104838,
  state: 'TX',
  benchmark: 'Public_AR_Current',
  ambiguous: false,
};
const BUFFALO: LaneEndpoint = {
  address: '403 Main St, Buffalo, NY 14203',
  matchedAddress: '403 MAIN ST, BUFFALO, NY, 14203',
  latitude: 42.885553091904,
  longitude: -78.874342511112,
  state: 'NY',
  benchmark: 'Public_AR_Current',
  ambiguous: false,
};

const DIESEL: DieselReading = {
  usdPerGal: 3.9,
  asOf: '2026-07-27',
  source: 'eia',
  stale: false,
};

/**
 * THE REFERENCE LANE. The same load and the same seven legs the permits
 * calculator prices at $1,223.18 — pinned here so a change to the composer can
 * never move a permit fee.
 */
const REFERENCE_CARGO = {
  grossWeightLbs: 120_000,
  widthIn: 12 * 12 + 6,
  heightIn: 14 * 12 + 6,
  overallLengthIn: 85 * 12,
  axleCount: 8,
  routeClass: 'interstate' as const,
};

const REFERENCE_LEGS = [
  { stateCode: 'TX', stateName: 'Texas', miles: 214.98 },
  { stateCode: 'AR', stateName: 'Arkansas', miles: 337 },
  { stateCode: 'TN', stateName: 'Tennessee', miles: 250 },
  { stateCode: 'KY', stateName: 'Kentucky', miles: 62.4 },
  { stateCode: 'OH', stateName: 'Ohio', miles: 145 },
  { stateCode: 'PA', stateName: 'Pennsylvania', miles: 46 },
  { stateCode: 'NY', stateName: 'New York', miles: 60 },
];

// ──────────────────────────────────────────────────────────────────────────
// Geocoding — the provider that fails closed
// ──────────────────────────────────────────────────────────────────────────

function censusResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

const HIT = {
  result: {
    addressMatches: [
      {
        matchedAddress: '1500 MCKINNEY ST, HOUSTON, TX, 77010',
        coordinates: { x: -95.360587104838, y: 29.754276036552 },
        addressComponents: { state: 'TX', zip: '77010' },
      },
    ],
  },
};

const MISS = { result: { addressMatches: [] } };

describe('the Census geocoder', () => {
  it('resolves an address and reports what it MATCHED, not what was typed', async () => {
    clearGeocodeCache();
    const fetchImpl = vi.fn(async () => censusResponse(HIT));
    const out = await geocodeAddress(
      '1500 McKinney St, Houston, TX 77010',
      fetchImpl as unknown as typeof fetch,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.matchedAddress).toBe('1500 MCKINNEY ST, HOUSTON, TX, 77010');
    expect(out.state).toBe('TX');
    expect(out.latitude).toBeCloseTo(29.7542, 3);
    expect(out.benchmark).toBe(CENSUS_BENCHMARKS[0]);
  });

  it('CYCLES BENCHMARKS, which is free coverage — a miss on the current file is not a verdict', async () => {
    clearGeocodeCache();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return censusResponse(call === 1 ? MISS : HIT);
    });
    const out = await geocodeAddress(
      '191 Beale St, Memphis, TN 38103',
      fetchImpl as unknown as typeof fetch,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The second benchmark answered, and the result says so — an older address
    // file is a real signal and it costs the quote confidence points.
    expect(out.benchmark).toBe(CENSUS_BENCHMARKS[1]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('FAILS CLOSED: no match on any benchmark returns a refusal, never a nearby guess', async () => {
    clearGeocodeCache();
    const fetchImpl = vi.fn(async () => censusResponse(MISS));
    const out = await geocodeAddress('nowhere at all', fetchImpl as unknown as typeof fetch);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('noMatch');
    expect(out.reason).toMatch(/could not place/i);
    expect(fetchImpl).toHaveBeenCalledTimes(CENSUS_BENCHMARKS.length);
  });

  it('distinguishes "no such address" from "the service was unreachable"', async () => {
    clearGeocodeCache();
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const out = await geocodeAddress('1 Any St, Anywhere, TX 70000', fetchImpl as unknown as typeof fetch);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('unavailable');
  });

  it('refuses an empty address without touching the network', async () => {
    clearGeocodeCache();
    const fetchImpl = vi.fn(async () => censusResponse(HIT));
    const out = await geocodeAddress('   ', fetchImpl as unknown as typeof fetch);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('empty');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caches a hit so a repeated lane makes no second call', async () => {
    clearGeocodeCache();
    const fetchImpl = vi.fn(async () => censusResponse(HIT));
    await geocodeAddress('1500 McKinney St, Houston, TX 77010', fetchImpl as unknown as typeof fetch);
    await geocodeAddress('1500 MCKINNEY ST,  Houston, TX 77010', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a failure — a typo about to be corrected must not stick for a day', async () => {
    clearGeocodeCache();
    const fetchImpl = vi.fn(async () => censusResponse(MISS));
    await geocodeAddress('nowhere at all', fetchImpl as unknown as typeof fetch);
    await geocodeAddress('nowhere at all', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(CENSUS_BENCHMARKS.length * 2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Geography — a lane total, and never a per-state split
// ──────────────────────────────────────────────────────────────────────────

describe('lane distance', () => {
  it('is the shipped circuity factor, not a new one', () => {
    expect(STRAIGHT_TO_ROAD_FACTOR).toBe(1.18);
  });

  it('lands Houston→Buffalo inside the measured ±15% of a routed 1,484 mi', () => {
    const d = scalarLaneDistance(HOUSTON, BUFFALO);
    expect(d.tier).toBe('scalar');
    expect(d.mayPriceStates).toBe(false);
    // The routed reference for this lane is 1,484.0 mi.
    expect(Math.abs(d.totalMiles - 1484) / 1484).toBeLessThan(0.15);
    expect(d.totalPlusMinusMiles).toBe(Math.round(d.totalMiles * 0.15));
  });

  it('sums filed legs exactly and claims a zero band, because they ARE the billed miles', () => {
    const d = filedLaneDistance(REFERENCE_LEGS);
    expect(d.tier).toBe('filed');
    expect(d.totalMiles).toBe(1115.38);
    expect(d.totalPlusMinusMiles).toBe(0);
    expect(d.mayPriceStates).toBe(true);
  });

  it('NO TIER THAT CANNOT PRICE STATES EVER CLAIMS A PER-STATE BAND', () => {
    for (const spec of Object.values(MILEAGE_TIERS)) {
      if (!spec.mayPriceStates) {
        expect(spec.stateBandPct === null || spec.stateBandPct >= 60).toBe(true);
      }
    }
    expect(MILEAGE_TIERS.scalar.stateBandPct).toBeNull();
  });

  it('haversine agrees with the permits engine’s own implementation', () => {
    // Houston → Buffalo great-circle, cross-checked against the evaluation.
    expect(haversineMiles(HOUSTON, BUFFALO)).toBeCloseTo(1286, 0);
  });
});

describe('the corridor prompt', () => {
  const states = corridorStates(HOUSTON, BUFFALO, hasOsowCoverage, {
    originState: 'TX',
    destinationState: 'NY',
  });
  const codes = states.map((s) => s.stateCode);

  it('names both endpoints as certain', () => {
    expect(states.find((s) => s.stateCode === 'TX')?.likelihood).toBe('endpoint');
    expect(states.find((s) => s.stateCode === 'NY')?.likelihood).toBe('endpoint');
  });

  it('names every state the real routed lane crosses', () => {
    // The routed path is TX → AR → TN → KY → OH → PA → NY. Missing one of
    // these would be an unbudgeted permit at a scale house, which is the
    // failure this list exists to prevent.
    for (const code of ['TX', 'AR', 'TN', 'KY', 'OH', 'PA', 'NY']) {
      expect(codes).toContain(code);
    }
  });

  it('OVER-NAMES, and that is the point — Louisiana is listed and NOT priced', () => {
    // A geodesic-vs-polygon split put 148.9 mi in Louisiana on this lane and
    // would have charged $285 for a permit the truck never needs. The box scan
    // also sees Louisiana — and because this list is a PROMPT and never a
    // price, naming it costs the user a blank row instead of $285.
    expect(codes).toContain('LA');
    for (const s of states) {
      expect(Object.keys(s)).toEqual(['stateCode', 'likelihood', 'covered']);
      expect(s).not.toHaveProperty('miles');
    }
  });

  it('marks coverage honestly, so an uncovered state reads as uncovered', () => {
    const ms = states.find((s) => s.stateCode === 'MS');
    if (ms) expect(ms.covered).toBe(hasOsowCoverage('MS'));
    expect(states.find((s) => s.stateCode === 'TN')?.covered).toBe(true);
  });

  it('separates a real crossing from a clipped corner', () => {
    expect(LIKELY_RUN_MILES).toBe(25);
    const likelihoods = new Set(states.map((s) => s.likelihood));
    expect(likelihoods.has('endpoint')).toBe(true);
    expect(likelihoods.has('crosses')).toBe(true);
  });

  it('starts at the origin state and ends at the destination state', () => {
    expect(codes[0]).toBe('TX');
    expect(codes[codes.length - 1]).toBe('NY');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The confidence KPI
// ──────────────────────────────────────────────────────────────────────────

const CLEAN: ConfidenceInput = {
  mileageTier: { label: 'Your filed per-state miles', totalBandPct: 0, mayPriceStates: true },
  permitsPriced: true,
  statesOnLane: 7,
  uncoveredStates: [],
  unpriceableStates: [],
  reviewStates: [],
  superloadStates: [],
  absorbedConflictUsd: 0,
  dataQualityNotes: 0,
  mileageSplitReview: false,
  mileageCrossCheck: null,
  filedMissingEndpointStates: [],
  linehaulPriced: true,
  escortsRequired: 0,
  escortsPriced: true,
  policeFloorIncomplete: false,
  fuelSource: 'eia',
  fuelStale: false,
  geocodeAmbiguous: false,
  geocodeOldBenchmark: false,
  totalUsd: 8400,
};

describe('the confidence score', () => {
  it('is 100 and empty when every component priced from a cited figure or your own rate', () => {
    const c = scoreHeavyHaulConfidence(CLEAN);
    expect(c.score).toBe(100);
    expect(c.label).toBe('high');
    expect(c.findings).toEqual([]);
    expect(c.headline).toMatch(/confidence 100%/);
  });

  it('NEVER RETURNS A NUMBER WITHOUT THE REASONS BEHIND IT', () => {
    const c = scoreHeavyHaulConfidence({
      ...CLEAN,
      mileageTier: { label: 'Straight line × 1.18', totalBandPct: 15, mayPriceStates: false },
      permitsPriced: false,
      linehaulPriced: false,
    });
    expect(c.score).toBeLessThan(100);
    expect(c.findings.length).toBeGreaterThan(0);
    // 100 − the sum of what is listed IS the score. A deduction that is not in
    // the list cannot exist, which is what makes the number decomposable.
    expect(c.score).toBe(100 - c.deducted);
  });

  it('every finding names the engine field it keys on and how its weight was set', () => {
    const c = scoreHeavyHaulConfidence({
      ...CLEAN,
      uncoveredStates: ['MS'],
      superloadStates: ['TX'],
      fuelSource: 'default',
      fuelStale: true,
      geocodeAmbiguous: true,
    });
    for (const f of c.findings) {
      expect(f.source.length).toBeGreaterThan(10);
      expect(['measured', 'ratio', 'judgement']).toContain(f.grounding);
      expect(f.points).toBeGreaterThan(0);
      expect(f.headline.length).toBeGreaterThan(0);
      expect(f.detail.length).toBeGreaterThan(30);
    }
  });

  it('THE MILEAGE DEDUCTION IS THE MEASURED BAND, not a number I chose', () => {
    const c = scoreHeavyHaulConfidence({
      ...CLEAN,
      mileageTier: { label: 'Straight line × 1.18', totalBandPct: 15, mayPriceStates: false },
    });
    const mileage = c.findings.find((f) => f.code === 'mileage_estimated');
    expect(mileage?.points).toBe(15);
    expect(mileage?.grounding).toBe('measured');
  });

  it('scales the uncovered-state deduction by the SHARE of the lane it covers', () => {
    const one = scoreHeavyHaulConfidence({ ...CLEAN, statesOnLane: 7, uncoveredStates: ['MS'] });
    const three = scoreHeavyHaulConfidence({
      ...CLEAN,
      statesOnLane: 7,
      uncoveredStates: ['MS', 'AL', 'GA'],
    });
    const a = one.findings.find((f) => f.code === 'states_uncovered');
    const b = three.findings.find((f) => f.code === 'states_uncovered');
    expect(a?.grounding).toBe('ratio');
    expect((b?.points ?? 0)).toBeGreaterThan(a?.points ?? 0);
  });

  it('a lane whose permits could not be priced is LOW, never a comfortable medium', () => {
    const c = scoreHeavyHaulConfidence({
      ...CLEAN,
      mileageTier: { label: 'Straight line × 1.18', totalBandPct: 15, mayPriceStates: false },
      permitsPriced: false,
      linehaulPriced: false,
    });
    expect(c.label).toBe('low');
  });

  it('floors at 5, because a scored quote always rests on something', () => {
    const c = scoreHeavyHaulConfidence({
      ...CLEAN,
      mileageTier: { label: 'Straight line × 1.18', totalBandPct: 15, mayPriceStates: false },
      permitsPriced: false,
      statesOnLane: 1,
      uncoveredStates: ['MS'],
      unpriceableStates: [],
      reviewStates: [],
      superloadStates: ['TX'],
      mileageSplitReview: true,
      linehaulPriced: false,
      escortsRequired: 4,
      escortsPriced: false,
      policeFloorIncomplete: true,
      fuelSource: 'default',
      fuelStale: true,
      geocodeAmbiguous: true,
      geocodeOldBenchmark: true,
    });
    expect(c.score).toBe(5);
    expect(c.deducted).toBeGreaterThan(95);
  });

  it('EXTENDS the engine’s existing ± bands rather than replacing them', () => {
    expect(CONFIDENCE_BANDS.high).toBe(0.04);
    expect(CONFIDENCE_BANDS.medium).toBe(0.08);
    expect(CONFIDENCE_BANDS.low).toBe(0.18);
    expect(labelForScore(100)).toBe('high');
    expect(labelForScore(70)).toBe('medium');
    expect(labelForScore(30)).toBe('low');
  });

  it('snaps the range to clean dollars and always brackets the total', () => {
    const r = confidenceRange(8400, 0.08);
    expect(r.low).toBeLessThan(8400);
    expect(r.high).toBeGreaterThan(8400);
    expect(r.low % 50).toBe(0);
    expect(r.high % 50).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The composed quote
// ──────────────────────────────────────────────────────────────────────────

describe('the reference lane, composed', () => {
  const out = priceHeavyHaulLane({
    cargo: REFERENCE_CARGO,
    lane: { origin: HOUSTON, destination: BUFFALO },
    filedLegs: REFERENCE_LEGS,
    rates: { linehaulUsdPerMile: 4.85, pilotCar: { usdPerMile: 2.25 } },
    diesel: DIESEL,
    asOf: ASOF,
  });

  it('PRICES THE PERMITS AT EXACTLY THE PERMITS-ONLY TOOL’S $1,223.18', () => {
    expect(out.permits?.totalPermitUsd).toBe(1223.18);
  });

  it('the SOURCED subtotal is those permit fees and nothing else', () => {
    // No police escort is required on this lane, so `sourced` is the permit
    // total exactly. A pilot-car figure appearing here would mean the caller's
    // own rate had been laundered into the cited column.
    expect(out.subtotalSourcedUsd).toBe(1223.18);
  });

  it('keeps the caller’s own rates in their own subtotal, never blended', () => {
    // 1,115.38 filed miles × $4.85 = $5,409.59, plus KY+NY pilot cars at $2.25.
    expect(out.subtotalYourRatesUsd).toBeCloseTo(5409.59 + 275.4, 2);
    const linehaul = out.lines.find((l) => l.code === 'linehaul');
    expect(linehaul?.basis).toBe('yours');
    expect(linehaul?.note).toMatch(/YOUR rate/);
  });

  it('derives fuel from the EIA index and says which half of the model is ours', () => {
    expect(out.fuel.perMileUsd).toBeCloseTo((3.9 - 1.25) / 6, 3);
    expect(out.subtotalDerivedUsd).toBeCloseTo(out.fuel.perMileUsd * 1115.38, 1);
    expect(out.fuel.modelNote).toMatch(/are OUR assumptions/);
    expect(out.fuel.modelNote).toMatch(/EIA weekly national on-highway/);
    // The provenance sentence must LEAD, because the page clamps the note to
    // three lines and this is the sentence that must never be the clipped one.
    expect(out.fuel.modelNote.indexOf('OUR assumptions')).toBeLessThan(
      out.fuel.modelNote.indexOf('DOE-index model'),
    );
  });

  it('the delivered figure is the three subtotals and nothing else — no margin', () => {
    expect(out.deliveredUsd).toBeCloseTo(
      out.subtotalSourcedUsd + out.subtotalYourRatesUsd + out.subtotalDerivedUsd,
      2,
    );
    expect(out.lines.some((l) => l.kind === 'margin')).toBe(false);
  });

  it('is not partial, and scores in the top band', () => {
    expect(out.partial).toBe(false);
    expect(out.partialBecause).toEqual([]);
    expect(out.confidence.score).toBeGreaterThanOrEqual(60);
    expect(out.lowUsd).toBeLessThan(out.deliveredUsd as number);
    expect(out.highUsd).toBeGreaterThan(out.deliveredUsd as number);
  });

  it('runs the free cross-check against the map, AND CHANGES NOTHING WITH IT', () => {
    // These reference legs sum to 1,115 mi while the real routed Houston→Buffalo
    // lane is 1,484 — the fixture's per-state figures were chosen to exercise
    // fee bands, not to be a real route. The cross-check spots that honestly and
    // says so. What it must never do is edit a mileage or move a fee.
    expect(out.mileage.crossCheck).not.toBeNull();
    expect(out.mileage.crossCheck?.disagrees).toBe(true);
    expect(out.mileage.crossCheck?.differencePct).toBeLessThan(-25);
    expect(out.permits?.totalPermitUsd).toBe(1223.18);
    expect(out.mileage.totalMiles).toBe(1115.38);
    expect(out.confidence.findings.map((f) => f.code)).toContain('mileage_crosscheck');
  });

  it('offers no corridor prompt, because the states are already known', () => {
    // The corridor is still COMPUTED at tier 0 — it is what the endpoint check
    // reads — but it is only exposed when it is genuinely a prompt. A complete
    // filing needs no prompt; an incomplete one does.
    expect(out.corridor).toBeNull();
    expect(out.confidence.findings.map((f) => f.code)).not.toContain(
      'filed_missing_endpoint_state',
    );
  });

  it('exports its priced rows in the engine’s own CalcLine vocabulary', () => {
    const calcLines = heavyHaulCalcLines(out);
    expect(calcLines.length).toBeGreaterThan(0);
    for (const l of calcLines) {
      expect(typeof l.amount).toBe('number');
      expect(['linehaul', 'minimum', 'accessorial', 'fuel', 'margin', 'note', 'permit', 'escort']).toContain(l.kind);
    }
    expect(calcLines.some((l) => l.kind === 'permit')).toBe(true);
    expect(calcLines.some((l) => l.kind === 'escort')).toBe(true);
  });
});

describe('the same lane with only addresses — tier 4', () => {
  const out = priceHeavyHaulLane({
    cargo: REFERENCE_CARGO,
    lane: { origin: HOUSTON, destination: BUFFALO },
    rates: { linehaulUsdPerMile: 4.85 },
    diesel: DIESEL,
    asOf: ASOF,
  });

  it('ASKS, IT DOES NOT PRICE — no permit money is in the total', () => {
    expect(out.permits).toBeNull();
    const permitLine = out.lines.find((l) => l.kind === 'permit');
    expect(permitLine?.amountUsd).toBeNull();
    expect(out.subtotalSourcedUsd).toBe(0);
  });

  it('names the states to ask about, and says it did not route the lane', () => {
    expect(out.corridor).not.toBeNull();
    expect(out.corridor?.states.map((s) => s.stateCode)).toContain('TN');
    expect(out.corridor?.disclaimer).toMatch(/did NOT route this lane/);
    expect(out.corridor?.disclaimer).toMatch(/not one permit is priced from this list/);
  });

  it('still prices what it honestly can — line haul and fuel off the lane total', () => {
    expect(out.subtotalYourRatesUsd).toBeGreaterThan(0);
    expect(out.subtotalDerivedUsd).toBeGreaterThan(0);
    expect(out.deliveredUsd).toBeGreaterThan(0);
  });

  it('is PARTIAL, says why, and scores low', () => {
    expect(out.partial).toBe(true);
    expect(out.partialBecause.join(' ')).toMatch(/permit/i);
    expect(out.confidence.label).toBe('low');
    expect(out.confidence.findings.map((f) => f.code)).toContain('permits_not_priced');
    expect(out.confidence.findings.map((f) => f.code)).toContain('mileage_estimated');
  });

  it('the headline names what dragged the score down', () => {
    expect(out.confidence.headline).toMatch(/confidence \d+%/);
    expect(out.confidence.headline).toMatch(/no state permit priced|mileage estimated/);
  });
});

describe('a lane touching an uncovered state', () => {
  const out = priceHeavyHaulLane({
    cargo: REFERENCE_CARGO,
    lane: { origin: HOUSTON, destination: BUFFALO },
    filedLegs: [
      { stateCode: 'TX', miles: 200 },
      { stateCode: 'MS', stateName: 'Mississippi', miles: 180 },
      { stateCode: 'TN', miles: 250 },
    ],
    rates: { linehaulUsdPerMile: 4.85 },
    diesel: DIESEL,
    asOf: ASOF,
    stateNames: { MS: 'Mississippi' },
  });

  it('NAMES IT AND LEAVES IT UNPRICED — never $0, never inferred from a neighbour', () => {
    expect(out.permits?.uncoveredJurisdictions).toContain('MS');
    const ms = out.lines.find((l) => l.code === 'permit_MS');
    expect(ms?.amountUsd).toBeNull();
    expect(ms?.name).toContain('Mississippi');
    expect(ms?.note).toMatch(/will not infer one from a neighbouring state/);
  });

  it('marks the delivered figure PARTIAL and names the missing state', () => {
    expect(out.partial).toBe(true);
    expect(out.partialBecause.join(' ')).toContain('MS');
  });

  it('takes points off, and the finding names Mississippi', () => {
    const finding = out.confidence.findings.find((f) => f.code === 'states_uncovered');
    expect(finding?.headline).toContain('MS');
    expect(finding?.grounding).toBe('ratio');
  });
});

describe('a superload', () => {
  const out = priceHeavyHaulLane({
    cargo: { ...REFERENCE_CARGO, grossWeightLbs: 400_000 },
    lane: { origin: HOUSTON, destination: BUFFALO },
    filedLegs: [{ stateCode: 'TX', miles: 214.98 }],
    rates: { linehaulUsdPerMile: 4.85 },
    diesel: DIESEL,
    asOf: ASOF,
  });

  it('quotes NO permit for it, because no published fee exists', () => {
    const tx = out.permits?.jurisdictions.find((j) => j.jurisdiction === 'TX');
    expect(tx?.superload).toBe(true);
    expect(tx?.subtotalUsd).toBeNull();
    expect(out.lines.find((l) => l.code === 'permit_TX')?.amountUsd).toBeNull();
  });

  it('is partial and carries the superload finding', () => {
    expect(out.partial).toBe(true);
    expect(out.confidence.findings.map((f) => f.code)).toContain('superload');
  });
});

describe('a quote with no line-haul rate', () => {
  const out = priceHeavyHaulLane({
    cargo: REFERENCE_CARGO,
    lane: { origin: HOUSTON, destination: BUFFALO },
    filedLegs: REFERENCE_LEGS,
    diesel: DIESEL,
    asOf: ASOF,
  });

  it('excludes line haul by name rather than inventing a market rate', () => {
    const linehaul = out.lines.find((l) => l.code === 'linehaul');
    expect(linehaul?.amountUsd).toBeNull();
    expect(linehaul?.note).toMatch(/will not invent a market rate/);
    expect(out.subtotalYourRatesUsd).toBe(0);
  });

  it('still prices every permit exactly as before — the exclusion moves nothing', () => {
    expect(out.permits?.totalPermitUsd).toBe(1223.18);
  });

  it('is partial, and says line haul is what is missing', () => {
    expect(out.partial).toBe(true);
    expect(out.partialBecause.join(' ')).toMatch(/line haul/i);
    expect(out.confidence.findings.map((f) => f.code)).toContain('linehaul_excluded');
  });
});

describe('the fuel index’s own honesty', () => {
  it('costs the quote points when the diesel price is a hardcoded fallback', () => {
    const out = priceHeavyHaulLane({
      cargo: REFERENCE_CARGO,
      lane: { origin: HOUSTON, destination: BUFFALO },
      filedLegs: REFERENCE_LEGS,
      rates: { linehaulUsdPerMile: 4.85 },
      diesel: { usdPerGal: 3.9, asOf: '', source: 'default', stale: true },
      asOf: ASOF,
    });
    expect(out.confidence.findings.map((f) => f.code)).toContain('fuel_default_price');
    expect(out.fuel.source).toBe('default');
  });
});

describe('the exclusions list', () => {
  it('says plainly that no margin is added, anywhere', () => {
    const margin = HEAVY_HAUL_NOT_INCLUDED.find((n) => /margin/i.test(n.item));
    expect(margin).toBeDefined();
    expect(margin?.why).toMatch(/no code path in this tool that adds one/);
  });
});

/**
 * THE SCORE MUST NOT REWARD UNDER-REPORTING.
 *
 * An independent review found that filing ONE state's mileage for a
 * seven-state lane scored 100% HIGH with no PARTIAL badge and no deductions —
 * while the complete, correct filing of the same lane scored 87%. Fewer states
 * filed meant higher confidence AND a smaller bill, which is exactly backwards
 * and made the headline claim ("every component priced from a cited figure or
 * a rate you supplied") false rather than merely optimistic.
 *
 * The property pinned here is the one that matters, and it is an inequality
 * rather than a magic number: a complete filing of a lane must score strictly
 * higher than any filing of the same lane that omits a state the load
 * provably touches. Every variant below is one the review reached by hand.
 */
describe('a truncated filing cannot out-score a complete one', () => {
  const honest = priceHeavyHaulLane({
    cargo: REFERENCE_CARGO,
    lane: { origin: HOUSTON, destination: BUFFALO },
    filedLegs: REFERENCE_LEGS,
    rates: { linehaulUsdPerMile: 4.85, pilotCar: { usdPerMile: 2.25 } },
    diesel: DIESEL,
    asOf: ASOF,
  });

  const truncated = (legs: Array<{ stateCode: string; miles: number }>) =>
    priceHeavyHaulLane({
      cargo: REFERENCE_CARGO,
      lane: { origin: HOUSTON, destination: BUFFALO },
      filedLegs: legs,
      rates: { linehaulUsdPerMile: 4.85, pilotCar: { usdPerMile: 2.25 } },
      diesel: DIESEL,
      asOf: ASOF,
    });

  const VARIANTS: Array<[string, Array<{ stateCode: string; miles: number }>]> = [
    ['TX only', [{ stateCode: 'TX', miles: 1500 }]],
    ['TX + AR', [{ stateCode: 'TX', miles: 800 }, { stateCode: 'AR', miles: 700 }]],
    ['OH only', [{ stateCode: 'OH', miles: 1500 }]],
    ['PA only', [{ stateCode: 'PA', miles: 1500 }]],
    ['CA + WA', [{ stateCode: 'CA', miles: 760 }, { stateCode: 'WA', miles: 760 }]],
  ];

  for (const [name, legs] of VARIANTS) {
    it(`${name} scores strictly below the complete filing`, () => {
      const out = truncated(legs);
      expect(out.confidence.score).toBeLessThan(honest.confidence.score);
    });

    it(`${name} names the omitted endpoint state and marks the quote partial`, () => {
      const out = truncated(legs);
      expect(out.confidence.findings.map((f) => f.code)).toContain(
        'filed_missing_endpoint_state',
      );
      expect(out.partial).toBe(true);
      // A prompt appears precisely because it is now useful.
      expect(out.corridor).not.toBeNull();
    });
  }

  it('never labels a filing that omits an endpoint state as HIGH confidence', () => {
    for (const [, legs] of VARIANTS) {
      expect(truncated(legs).confidence.label).not.toBe('high');
    }
  });

  it('leaves a genuine single-state lane alone — the check is endpoints, not count', () => {
    // Both endpoints in Texas: one filed row is the complete and correct filing.
    const intrastate = priceHeavyHaulLane({
      cargo: REFERENCE_CARGO,
      lane: { origin: HOUSTON, destination: { ...HOUSTON, state: 'TX' } },
      filedLegs: [{ stateCode: 'TX', miles: 240 }],
      rates: { linehaulUsdPerMile: 4.85 },
      diesel: DIESEL,
      asOf: ASOF,
    });
    expect(intrastate.confidence.findings.map((f) => f.code)).not.toContain(
      'filed_missing_endpoint_state',
    );
  });
});

/**
 * THE FUEL MODEL'S TWO ASSUMPTIONS ARE THE CALLER'S TO SET.
 *
 * The diesel PRICE is sourced from the EIA index and stays sourced. The peg and
 * the fuel economy are the only assumptions inside the surcharge, and every
 * carrier's FSC table pegs somewhere — so leaving them hardcoded meant the page
 * told the reader they were our assumptions while giving no way to replace them.
 */
describe('the fuel surcharge model', () => {
  const lane = (rates: Record<string, unknown>) =>
    priceHeavyHaulLane({
      cargo: REFERENCE_CARGO,
      lane: { origin: HOUSTON, destination: BUFFALO },
      filedLegs: REFERENCE_LEGS,
      rates: rates as never,
      diesel: DIESEL,
      asOf: ASOF,
    });

  it('defaults to the OOIDA figures and says they are OURS', () => {
    const out = lane({ linehaulUsdPerMile: 4.85 });
    expect(out.fuel.perMileUsd).toBeCloseTo((DIESEL.usdPerGal - 1.25) / 6, 3);
    expect(out.fuel.modelNote).toMatch(/OUR assumptions/);
    expect(out.fuel.modelNote).toMatch(/Enter your own peg and mpg/);
  });

  it('uses the caller’s peg when supplied, and relabels the line as theirs', () => {
    const out = lane({ linehaulUsdPerMile: 4.85, fuelPegUsdPerGal: 2.5 });
    expect(out.fuel.perMileUsd).toBeCloseTo((DIESEL.usdPerGal - 2.5) / 6, 3);
    expect(out.fuel.modelNote).toMatch(/YOURS/);
    expect(out.fuel.modelNote).not.toMatch(/OUR assumptions/);
  });

  it('uses the caller’s fuel economy when supplied', () => {
    const out = lane({ linehaulUsdPerMile: 4.85, fuelMpg: 5 });
    expect(out.fuel.perMileUsd).toBeCloseTo((DIESEL.usdPerGal - 1.25) / 5, 3);
    expect(out.fuel.modelNote).toMatch(/5 mpg/);
  });

  it('never lets the caller’s model touch the SOURCED column', () => {
    // The peg is theirs; the permit fees are not. A change to one must not move
    // the other -- the whole point of keeping the three subtotals apart.
    const a = lane({ linehaulUsdPerMile: 4.85 });
    const b = lane({ linehaulUsdPerMile: 4.85, fuelPegUsdPerGal: 3.75, fuelMpg: 4 });
    expect(b.subtotalSourcedUsd).toBe(a.subtotalSourcedUsd);
    expect(b.permits?.totalPermitUsd).toBe(1223.18);
    expect(b.subtotalDerivedUsd).not.toBe(a.subtotalDerivedUsd);
  });

  it('a peg above the pump price yields no surcharge, not a negative one', () => {
    const out = lane({ linehaulUsdPerMile: 4.85, fuelPegUsdPerGal: 19 });
    expect(out.fuel.perMileUsd).toBe(0);
    expect(out.subtotalDerivedUsd).toBe(0);
  });
});
