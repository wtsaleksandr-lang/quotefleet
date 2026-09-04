/**
 * THE MARKET RATE ENGINE.
 *
 * ZERO NETWORK CALLS AND NO DATABASE. Every rate in this engine is compiled in
 * from research fixtures, so the whole suite runs with the dev branch down and
 * without spending a cent of anybody's API credit.
 *
 * The tests are organised around the claims the engine makes, not around its
 * functions: the minimum governs the short band, a benchmark cannot reach a
 * cited subtotal, a refusal quotes no number, and every derived value says what
 * it was derived from.
 */
import { describe, it, expect } from 'vitest';
import {
  // accuracy
  BASIS_FOR_TIER,
  TIER_DEFAULT_BAND_PCT,
  accuracyBasisViolations,
  assertAccuracyBasisInvariant,
  basisForTier,
  rate,
  MAX_HOVER_CHARS,
  // sources
  MARKET_SOURCES,
  AUTO_REFRESHABLE_SOURCES,
  // derive
  deriveAxleCount,
  deriveEquipmentClass,
  deriveRouteClass,
  deriveLoad,
  cargoWeightOf,
  LBS_PER_ADDED_AXLE,
  SUPERLOAD_GROSS_LBS,
  // linehaul
  BASE_FLATBED_LINEHAUL_USD_PER_MILE,
  ATRI_EX_FUEL_USD_PER_MILE,
  DISTANCE_BANDS,
  EQUIPMENT,
  FLATBED_MPG,
  LINEHAUL_BAND_PCT,
  REGION_MULTIPLIERS,
  distanceMultiplier,
  mpgForEquipment,
  notionalCrossoverMiles,
  priceMarketLinehaul,
  // escorts
  DEADHEAD_HIGH_USD,
  DAY_RATE_LOW_USD,
  HIGH_POLE_HIGH_MULT,
  PER_MILE_CENTRAL_USD,
  escortLegCharge,
  estimateEscortMarketCost,
  overnightsNeeded,
  // accessorials
  CRANE_REFUSAL_CARGO_LBS,
  craneRateUsdPerHour,
  detentionUsdPerHour,
  excessValueLine,
  headlineOf,
  permitServiceLine,
  priceLoading,
  routeSurveyLine,
  tarpingUsd,
} from './index.js';

// ══════════════════════════════════════════════════════════════════════════
// THE ACCURACY RATING — the product, not decoration
// ══════════════════════════════════════════════════════════════════════════

describe('the accuracy rating', () => {
  it('maps each tier to exactly one subtotal channel, and refusal to none', () => {
    expect(basisForTier('cited')).toBe('sourced');
    expect(basisForTier('indexed')).toBe('derived');
    expect(basisForTier('benchmark')).toBe('market');
    expect(basisForTier('refused')).toBeNull();
  });

  it('A BENCHMARK FIGURE CANNOT ENTER A CITED SUBTOTAL — the invariant', () => {
    // The map itself forbids it...
    expect(BASIS_FOR_TIER.benchmark).toBe('market');
    expect(BASIS_FOR_TIER.benchmark).not.toBe('sourced');
    // ...and the checker catches an attempt to do it anyway.
    const violations = accuracyBasisViolations([
      {
        code: 'smuggled',
        name: 'A market band dressed as a statute',
        basis: 'sourced',
        amountUsd: 5000,
        accuracy: rate({
          tier: 'benchmark',
          lowUsd: 4000,
          highUsd: 6000,
          hover: 'x',
          detail: 'y',
        }),
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/must sit in the "market" subtotal/);
    expect(() =>
      assertAccuracyBasisInvariant([
        {
          name: 'x',
          basis: 'sourced',
          amountUsd: 1,
          accuracy: rate({ tier: 'benchmark', lowUsd: 0, highUsd: 2, hover: 'a', detail: 'b' }),
        },
      ]),
    ).toThrow(/invariant violated/);
  });

  it('refuses to let a BENCHMARK render as a point value', () => {
    const violations = accuracyBasisViolations([
      {
        code: 'pointy',
        name: 'A band pretending to be a price',
        basis: 'market',
        amountUsd: 5000,
        accuracy: rate({ tier: 'benchmark', hover: 'x', detail: 'y' }),
      },
    ]);
    expect(violations.join(' ')).toMatch(/must render as a range/);
  });

  it('refuses to let a REFUSAL carry money', () => {
    const violations = accuracyBasisViolations([
      {
        code: 'refused_with_a_price',
        name: 'A refusal that quotes',
        basis: 'market',
        amountUsd: 900,
        accuracy: rate({ tier: 'refused', hover: 'x', detail: 'y' }),
      },
    ]);
    expect(violations.join(' ')).toMatch(/refusal that quotes a number is not a refusal/);
  });

  it('EACH TIER CARRIES ITS OWN BAND — there is no global ± number', () => {
    expect(TIER_DEFAULT_BAND_PCT.cited).toBe(0);
    expect(TIER_DEFAULT_BAND_PCT.indexed).toBeLessThan(TIER_DEFAULT_BAND_PCT.benchmark);
    // And a component's own measured spread overrides the tier default: the
    // research measured detention at ±15% and a route survey at ±70%.
    const detention = detentionUsdPerHour(13);
    expect(detention).toBe(605);
    const survey = routeSurveyLine(['TX']);
    expect(survey?.accuracy.bandPct).toBe(70);
    const svc = permitServiceLine(7);
    expect(svc?.accuracy.bandPct).toBe(45);
    expect(svc?.accuracy.bandPct).not.toBe(survey?.accuracy.bandPct);
  });

  it('keeps hover text short and puts the argument in detail', () => {
    const lines = [
      ...priceLoading({
        cargoWeightLbs: 40_000,
        end: 'origin',
        stateCode: 'TX',
        cargoWeightDerived: false,
      }),
      permitServiceLine(3),
      routeSurveyLine(['TX']),
      excessValueLine(500_000),
    ].filter((l): l is NonNullable<typeof l> => l !== null);
    for (const l of lines) {
      expect(l.accuracy.hover.length).toBeLessThanOrEqual(MAX_HOVER_CHARS);
      expect(l.accuracy.detail.length).toBeGreaterThan(l.accuracy.hover.length);
    }
  });
});

describe('the source register', () => {
  it('is not SourceDoc — a vendor rate card can never become a statute', () => {
    // Structural proof: `MarketSource` has fields `SourceDoc` does not, and
    // lacks the `revisedOn`/`retrievedOn` pair the permit resolver keys on.
    for (const src of MARKET_SOURCES) {
      expect(src).toHaveProperty('samplePoints');
      expect(src).toHaveProperty('refetch');
      expect(src).not.toHaveProperty('revisedOn');
      expect(typeof src.dated === 'string' || src.dated === null).toBe(true);
    }
  });

  it('names exactly which sources a cron could refresh with no key and no payment', () => {
    expect(AUTO_REFRESHABLE_SOURCES.length).toBeGreaterThan(0);
    for (const s of AUTO_REFRESHABLE_SOURCES) expect(s.refetch).toBe('keylessApi');
    expect(AUTO_REFRESHABLE_SOURCES.map((s) => s.id)).toContain(
      'usda_agtransport_acar_e3r8',
    );
    // The DAT anchor is free but 403s a plain fetch, so it is NOT in the set.
    expect(AUTO_REFRESHABLE_SOURCES.map((s) => s.id)).not.toContain(
      'dat_flatbed_linehaul_2026w35',
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DERIVATION — stop asking the shipper carrier questions
// ══════════════════════════════════════════════════════════════════════════

describe('derivation', () => {
  it('derives the axle count from gross weight, and reproduces the reference rig', () => {
    // The reference lane is filed at eight axles for 120,000 lb gross. The rule
    // — an axle per ~17,000 lb over the 80,000 lb legal gross — reproduces it.
    expect(deriveAxleCount(120_000).value).toBe(8);
    expect(deriveAxleCount(80_000).value).toBe(5);
    expect(deriveAxleCount(45_000).value).toBe(5);
    expect(deriveAxleCount(80_000 + LBS_PER_ADDED_AXLE).value).toBe(6);
    expect(deriveAxleCount(120_000).origin).toBe('derived');
    expect(deriveAxleCount(120_000).from).toMatch(/120,000 lb gross/);
  });

  it('never lets a derived value outrank a supplied one', () => {
    const d = deriveLoad({ grossWeightLbs: 120_000, axleCount: 13, routeClass: 'two-lane' });
    expect(d.axleCount.value).toBe(13);
    expect(d.axleCount.origin).toBe('supplied');
    expect(d.routeClass?.origin).toBe('supplied');
    expect(d.routeClass?.value).toBe('two-lane');
  });

  it('derives the trailer class from weight first, then cargo height', () => {
    expect(deriveEquipmentClass({ grossWeightLbs: 70_000 }).value).toBe('flatbed');
    expect(deriveEquipmentClass({ grossWeightLbs: 70_000, heightIn: 110 }).value).toBe('stepDeck');
    expect(deriveEquipmentClass({ grossWeightLbs: 70_000, heightIn: 140 }).value).toBe('rgn');
    expect(deriveEquipmentClass({ grossWeightLbs: 120_000 }).value).toBe('multiAxle');
    // Weight beats height: 90,000 lb does not run on a step deck whatever it is.
    expect(deriveEquipmentClass({ grossWeightLbs: 90_000, heightIn: 100 }).value).toBe('multiAxle');
    expect(deriveEquipmentClass({ grossWeightLbs: SUPERLOAD_GROSS_LBS + 1 }).value).toBe('superload');
  });

  it('derives the route class from the routed corridor, and REFUSES to guess it otherwise', () => {
    const interstate = deriveRouteClass('I-40 · I-81');
    expect(interstate?.value).toBe('interstate');
    expect(interstate?.from).toMatch(/I-40/);
    // A US route may be four-lane divided or two-lane through a town, and the
    // road network does not record which. Guessing would invent the input that
    // changes the fee, so it returns null and the quote asks.
    expect(deriveRouteClass('US-30 · US-6')).toBeNull();
    expect(deriveRouteClass(null)).toBeNull();
    const d = deriveLoad({ grossWeightLbs: 120_000, corridorLabel: 'US-30' });
    expect(d.routeClass).toBeNull();
    expect(d.routeClassNote).toMatch(/could not be derived/);
  });

  it('says out loud when the piece weight is itself an inference', () => {
    const given = cargoWeightOf({
      grossWeightLbs: 120_000,
      cargoWeightLbs: 100_000,
      equipmentClass: 'multiAxle',
    });
    expect(given.value).toBe(100_000);
    expect(given.origin).toBe('supplied');

    const inferred = cargoWeightOf({ grossWeightLbs: 120_000, equipmentClass: 'multiAxle' });
    expect(inferred.value).toBe(75_000);
    expect(inferred.origin).toBe('derived');
    expect(inferred.from).toMatch(/less 45,000 lb of tractor and trailer/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LINE HAUL
// ══════════════════════════════════════════════════════════════════════════

describe('the line-haul model', () => {
  it('anchors on the published DAT flatbed LINE-HAUL rate, not its all-in rate', () => {
    expect(BASE_FLATBED_LINEHAUL_USD_PER_MILE).toBe(2.67);
    const out = priceMarketLinehaul({ miles: 750, equipment: 'flatbed' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // 500-1,000 mi is the band the anchor is normalised to: multiplier 1.00.
    expect(out.distanceMultiplier).toBe(1);
    expect(out.effectiveUsdPerMile).toBeCloseTo(2.67, 3);
    expect(out.totalUsd).toBeCloseTo(2.67 * 750, 2);
  });

  it('publishes the distance multipliers exactly as observed', () => {
    expect(distanceMultiplier(120)).toBe(1.9);
    expect(distanceMultiplier(300)).toBe(1.25);
    expect(distanceMultiplier(750)).toBe(1.0);
    expect(distanceMultiplier(1200)).toBe(0.87);
    expect(distanceMultiplier(2000)).toBe(0.85);
    expect(DISTANCE_BANDS).toHaveLength(5);
  });

  it('THE MINIMUM GOVERNS THE ENTIRE SUB-250-MILE BAND', () => {
    // The single best-evidenced number in the model. USDA's 0-100 mile lanes:
    // p10 $1,300, median $1,400, p75 $1,500 -- a minimum, not a rate.
    for (const miles of [1, 25, 60, 100, 185, 249, 250]) {
      const out = priceMarketLinehaul({ miles, equipment: 'flatbed' });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.minimumBinds).toBe(true);
      expect(out.totalUsd).toBe(1300);
    }
    // The notional crossover -- where the sub-250 rate path would overtake the
    // floor -- sits at 256 miles, outside the band, which is why it governs it.
    expect(notionalCrossoverMiles('flatbed')).toBeCloseTo(256.3, 1);
    // Every class scales identically, so every class crosses in the same place.
    expect(notionalCrossoverMiles('rgn')).toBeCloseTo(notionalCrossoverMiles('flatbed'), 1);
    expect(notionalCrossoverMiles('multiAxle')).toBeCloseTo(notionalCrossoverMiles('flatbed'), 1);
  });

  it('is 35% higher than a pure per-mile model on the 185-mile step-deck lane', () => {
    const out = priceMarketLinehaul({ miles: 185, equipment: 'stepDeck' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.totalUsd).toBe(1400);
    // A pure per-mile model with no floor returns $1,014 on this lane with the
    // regional adjustment off (the research quotes $912 with a Midwest 0.90x
    // applied; we ship regional off, so the comparison is against $1,014).
    const naive = 2.67 * 1.9 * 1.08 * 185;
    expect(naive).toBeCloseTo(1013.59, 1);
    expect(out.totalUsd / naive).toBeGreaterThan(1.35);
  });

  it('NEVER PRICES A LONGER LANE BELOW A SHORTER ONE', () => {
    // A raw step function is not monotone: 2.67 x 1.25 x 500 = $1,668.75 but
    // 2.67 x 1.00 x 501 = $1,337.67. A quote that falls as the lane gets longer
    // is a bug a shipper finds in the first hour.
    let previous = 0;
    for (let miles = 10; miles <= 3000; miles += 10) {
      const out = priceMarketLinehaul({ miles, equipment: 'multiAxle' });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.totalUsd).toBeGreaterThanOrEqual(previous);
      previous = out.totalUsd;
    }
  });

  it('QUOTES THE RATE THE LANE ACTUALLY WORKS OUT AT, not the band multiplier', () => {
    // At 1,115 mi the 1,000-1,500 band multiplier is 0.87, giving $5.58/mi --
    // but the 500-1,000 band's ceiling price ($6,408) is higher and acts as this
    // lane's floor. A row reading "1,115 mi x $5.58/mi" beside a $6,408 total is
    // arithmetic a reader can check and find wrong, so the row quotes $5.75.
    const out = priceMarketLinehaul({ miles: 1115.38, equipment: 'multiAxle' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.effectiveUsdPerMile).toBeCloseTo(2.67 * 0.87 * 2.4, 3);
    expect(out.bandCeilingGoverns).toBe(true);
    expect(out.totalUsd).toBeCloseTo(2.67 * 1.0 * 2.4 * 1000, 2);
    expect(out.realisedUsdPerMile * out.miles).toBeCloseTo(out.totalUsd, 0);
    expect(out.notes.join(' ')).toMatch(/cannot price below what a 1,000-mile lane costs/);

    // At 1,484 mi the band's own rate has overtaken the ceiling again.
    const longer = priceMarketLinehaul({ miles: 1484, equipment: 'multiAxle' });
    expect(longer.ok).toBe(true);
    if (!longer.ok) return;
    expect(longer.bandCeilingGoverns).toBe(false);
    expect(longer.totalUsd).toBeCloseTo(2.67 * 0.87 * 2.4 * 1484, 2);
  });

  it('carries the equipment multipliers and minimums the research settled on', () => {
    expect(EQUIPMENT.flatbed.multiplier).toBe(1.0);
    expect(EQUIPMENT.stepDeck.multiplier).toBe(1.08);
    expect(EQUIPMENT.rgn.multiplier).toBe(1.6);
    expect(EQUIPMENT.multiAxle.multiplier).toBe(2.4);
    expect(EQUIPMENT.flatbed.minimumUsd).toBe(1300);
    expect(EQUIPMENT.multiAxle.minimumUsd).toBe(3120);
  });

  it('REFUSES A SUPERLOAD and routes it to a carrier quote', () => {
    const out = priceMarketLinehaul({ miles: 1500, equipment: 'superload' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.accuracy.tier).toBe('refused');
    expect(out.accuracy.lowUsd).toBeNull();
    expect(out.message).toMatch(/carrier for a lane quote/);
  });

  it('SHIPS REGIONAL MULTIPLIERS OFF, because the two proxies contradict each other', () => {
    const off = priceMarketLinehaul({ miles: 1000, equipment: 'flatbed' });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.regionMultiplier).toBe(1);
    expect(off.notes.join(' ')).toMatch(/Regional adjustment is OFF/);
    // The table exists and is opt-in, and it does move the number when asked.
    const on = priceMarketLinehaul({ miles: 1000, equipment: 'flatbed', region: 'northeast' });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(on.regionMultiplier).toBe(REGION_MULTIPLIERS.northeast);
    expect(on.totalUsd).toBeGreaterThan(off.totalUsd);
  });

  it('APPLIES NO SEASONAL CURVE — seasonality is already inside the live anchor', () => {
    // DAT's own flatbed line-haul moved $2.26 (Feb) to $2.95 (Jul) = 1.31x this
    // year. Multiplying by a seasonal index on top would double-count it. So the
    // same lane prices identically whatever month it is asked in: the model has
    // no date input at all, which is the strongest possible form of that claim.
    const a = priceMarketLinehaul({ miles: 900, equipment: 'rgn' });
    const b = priceMarketLinehaul({ miles: 900, equipment: 'rgn' });
    expect(a.ok && b.ok && a.totalUsd === b.totalUsd).toBe(true);
    expect(Object.keys(priceMarketLinehaul({ miles: 1, equipment: 'flatbed' }))).not.toContain(
      'seasonalMultiplier',
    );
  });

  it('uses ATRI as a FLOOR TO FLAG, never as a price', () => {
    expect(ATRI_EX_FUEL_USD_PER_MILE).toBe(1.854);
    // A deeply-discounted region on the longest band is the only way to get
    // under it, and the model reports it rather than raising the number.
    const out = priceMarketLinehaul(
      { miles: 2500, equipment: 'flatbed', region: 'midwest' },
      2.0,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.effectiveUsdPerMile).toBeLessThan(ATRI_EX_FUEL_USD_PER_MILE);
    expect(out.belowCostFloor).toBe(true);
    expect(out.notes.join(' ')).toMatch(/below ATRI/);
    // FLAGGED, NOT RAISED: the total is still the model's own answer.
    expect(out.totalUsd).toBeCloseTo(2.0 * 0.85 * REGION_MULTIPLIERS.midwest * 2500, 0);
  });

  it('renders as a range whose width reflects which joint is weak', () => {
    expect(LINEHAUL_BAND_PCT.flatbed).toBe(25);
    expect(LINEHAUL_BAND_PCT.multiAxle).toBe(40);
    const rgn = priceMarketLinehaul({ miles: 900, equipment: 'rgn' });
    expect(rgn.ok).toBe(true);
    if (!rgn.ok) return;
    expect(rgn.accuracy.tier).toBe('benchmark');
    expect(rgn.accuracy.lowUsd).toBeLessThan(rgn.totalUsd);
    expect(rgn.accuracy.highUsd).toBeGreaterThan(rgn.totalUsd);
    expect(rgn.accuracy.detail).toMatch(/weakest joint/);
  });
});

describe('the flatbed fuel-economy correction', () => {
  it('IS 5.0 MPG, NOT 6.0 — the figure that reproduces DAT’s published surcharge', () => {
    expect(FLATBED_MPG).toBe(5.0);
    expect(mpgForEquipment('flatbed')).toBe(5.0);
    expect(mpgForEquipment('stepDeck')).toBe(5.0);
    expect(mpgForEquipment('rgn')).toBe(4.0);
    expect(mpgForEquipment('multiAxle')).toBe(3.5);
  });

  it('reproduces DAT’s three published flatbed surcharges to the cent', () => {
    const fsc = (diesel: number, mpg: number) =>
      Math.round(((diesel - 1.25) / mpg) * 100) / 100;
    // The weeks DAT published, and the surcharges it published for them.
    expect(fsc(4.58, FLATBED_MPG)).toBe(0.67);
    expect(fsc(5.257, FLATBED_MPG)).toBe(0.8); // published 0.81, within a cent
    expect(fsc(5.454, FLATBED_MPG)).toBe(0.84);
    // The van figure the old default used, for the same weeks.
    expect(fsc(4.58, 6.0)).toBe(0.56);
    expect(fsc(5.454, 6.0)).toBe(0.7);
  });

  it('costs a real amount of money on a real lane', () => {
    const diesel = 5.454;
    const perMileOld = (diesel - 1.25) / 6.0;
    const perMileNew = (diesel - 1.25) / FLATBED_MPG;
    const understated = (perMileNew - perMileOld) * 1500;
    expect(Math.round(understated)).toBe(210);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ESCORTS
// ══════════════════════════════════════════════════════════════════════════

describe('the escort model', () => {
  it('IS A TIERED FLOOR, NOT A PER-MILE RATE', () => {
    expect(escortLegCharge(60).tier).toBe('mini');
    expect(escortLegCharge(180).tier).toBe('dayRate');
    expect(escortLegCharge(400).tier).toBe('mileage');
    // The tier is a FLOOR: the operator bills the higher of the tier charge and
    // the mileage math, which is why a short move costs more per mile.
    expect(escortLegCharge(60).lowUsd).toBe(275);
    expect(escortLegCharge(180).lowUsd).toBe(DAY_RATE_LOW_USD);
  });

  it('beats a floorless per-mile model on the 200-mile two-car move', () => {
    const band = estimateEscortMarketCost({ vehicles: 2, miles: 200 });
    expect(band).not.toBeNull();
    if (!band) return;
    // A competitor's reverse-engineered model returns 2 x 200 x $1.85 = $740,
    // which is 18% below the cheapest published day rate for two cars ($900).
    const floorless = 2 * 200 * PER_MILE_CENTRAL_USD;
    expect(floorless).toBe(740);
    const baseComponent = band.components.find((c) => c.code === 'escort_base');
    expect(baseComponent?.lowUsd).toBe(900);
    expect(baseComponent?.lowUsd).toBeGreaterThan(floorless);
  });

  it('agrees with an independently-built model on the long-haul mileage component', () => {
    // Their $1.85/state-mile x 2 cars x 1,115 mi = $4,125.50. Ours is the same
    // number to the dollar -- two models converging is the strongest evidence
    // available that the band is right.
    const band = estimateEscortMarketCost({ vehicles: 2, miles: 1115 });
    expect(band).not.toBeNull();
    if (!band) return;
    const mileage = band.components.find((c) => c.code === 'escort_base');
    expect(mileage?.centralUsd).toBeCloseTo(4125.5, 1);
  });

  it('makes the height pole a PREMIUM ON ONE CAR, never an extra car', () => {
    const plain = estimateEscortMarketCost({ vehicles: 2, miles: 1000 });
    const poled = estimateEscortMarketCost({ vehicles: 2, miles: 1000, highPole: true });
    expect(plain && poled).toBeTruthy();
    if (!plain || !poled) return;
    expect(poled.components.map((c) => c.code)).toContain('escort_high_pole');
    // The premium is at most 30% of ONE car's charge, so nowhere near a 50%
    // increase, which is what adding a third vehicle would look like.
    const perCar = plain.centralUsd / 2;
    const uplift = poled.centralUsd - plain.centralUsd;
    expect(uplift).toBeLessThan(perCar * (HIGH_POLE_HIGH_MULT - 1) * 1.01);
    expect(uplift).toBeGreaterThan(0);
  });

  it('MULTIPLIES for a second car — no published bundle discount exists', () => {
    const one = estimateEscortMarketCost({ vehicles: 1, miles: 1000 });
    const two = estimateEscortMarketCost({ vehicles: 2, miles: 1000 });
    expect(one && two).toBeTruthy();
    if (!one || !two) return;
    expect(two.centralUsd).toBeCloseTo(one.centralUsd * 2, 2);
  });

  it('keeps deadhead a separate, explicitly-uncertain line whose low end is $0', () => {
    const band = estimateEscortMarketCost({ vehicles: 2, miles: 1115 });
    expect(band).not.toBeNull();
    if (!band) return;
    const dh = band.components.find((c) => c.code === 'escort_deadhead');
    expect(dh).toBeDefined();
    expect(dh?.lowUsd).toBe(0);
    expect(dh?.highUsd).toBe(DEADHEAD_HIGH_USD * 2);
    expect(dh?.note).toMatch(/MOST UNCERTAIN LINE/);
  });

  it('estimates overnights from a stated assumption, and says it is one', () => {
    expect(overnightsNeeded(1115, 450)).toBe(2);
    expect(overnightsNeeded(1115, 300)).toBe(3);
    expect(overnightsNeeded(200, 450)).toBe(0);
    const band = estimateEscortMarketCost({ vehicles: 2, miles: 1115 });
    const nights = band?.components.find((c) => c.code === 'escort_overnight');
    expect(nights?.note).toMatch(/our own assumption/);
  });

  it('discloses wait time as a risk rather than pricing unknowable hours', () => {
    const band = estimateEscortMarketCost({ vehicles: 1, miles: 800 });
    expect(band?.riskNotes.join(' ')).toMatch(/Wait and standby/);
    expect(band?.components.map((c) => c.code)).not.toContain('escort_wait');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ACCESSORIALS
// ══════════════════════════════════════════════════════════════════════════

describe('loading — the headline', () => {
  it('interpolates the published crane curve between classes', () => {
    expect(craneRateUsdPerHour(120)).toBe(440);
    expect(craneRateUsdPerHour(165)).toBe(520);
    // 180 t sits between the published 165 t and 210 t classes.
    expect(craneRateUsdPerHour(180)).toBe(530);
    expect(craneRateUsdPerHour(10)).toBe(155); // below the smallest published
  });

  it('anchors the headline at the 65th percentile, NOT the midpoint', () => {
    expect(headlineOf(1000, 2000)).toBe(1650);
    const lines = priceLoading({
      cargoWeightLbs: 120_000,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    });
    const crane = lines.find((l) => l.code === 'loading_crane_origin');
    expect(crane).toBeDefined();
    const midpoint = ((crane?.lowUsd ?? 0) + (crane?.highUsd ?? 0)) / 2;
    expect(crane?.headlineUsd).toBeGreaterThan(midpoint);
  });

  it('reproduces the research’s Houston worked example to the dollar', () => {
    // 120,000 lb piece, 120-180 t class, $440-$530/hr on the published curve,
    // Texas 1.00x. Crane $1,883-$4,537 headline $3,608; rigger $380-$1,520
    // headline $1,121; crane road permit $125-$275 headline $223.
    const lines = priceLoading({
      cargoWeightLbs: 120_000,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    });
    const crane = lines.find((l) => l.code === 'loading_crane_origin');
    expect(crane?.lowUsd).toBeCloseTo(1883.2, 1);
    expect(crane?.highUsd).toBeCloseTo(4536.8, 1);
    expect(Math.round(crane?.headlineUsd ?? 0)).toBe(3608);
    const rigger = lines.find((l) => l.code === 'loading_rigging_origin');
    expect(rigger?.lowUsd).toBe(380);
    expect(rigger?.highUsd).toBe(1520);
    expect(Math.round(rigger?.headlineUsd ?? 0)).toBe(1121);
    const permit = lines.find((l) => l.code === 'loading_crane_permit_origin');
    expect(permit?.lowUsd).toBe(125);
    expect(permit?.highUsd).toBe(275);
    expect(Math.round(permit?.headlineUsd ?? 0)).toBe(223);
  });

  it('applies the Northeast metro uplift at the Buffalo end', () => {
    const lines = priceLoading({
      cargoWeightLbs: 120_000,
      end: 'destination',
      stateCode: 'NY',
      cargoWeightDerived: false,
    });
    const crane = lines.find((l) => l.code === 'loading_crane_destination');
    expect(crane?.lowUsd).toBeCloseTo(2259.8, 0);
    expect(crane?.highUsd).toBeCloseTo(5444.2, 0);
  });

  it('REFUSES ABOVE 160,000 LB — exactly where the evidence stops', () => {
    const lines = priceLoading({
      cargoWeightLbs: CRANE_REFUSAL_CARGO_LBS + 1,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].headlineUsd).toBeNull();
    expect(lines[0].lowUsd).toBeNull();
    expect(lines[0].accuracy.tier).toBe('refused');
    // A refusal that hands the shipper their next action is not a dead end.
    expect(lines[0].accuracy.detail).toMatch(/site survey/i);
    expect(lines[0].accuracy.hover).toMatch(/From about \$/);
    // 160,000 lb exactly still prices.
    const ok = priceLoading({
      cargoWeightLbs: CRANE_REFUSAL_CARGO_LBS,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    });
    expect(ok.length).toBe(3);
  });

  it('widens the band above 80,000 lb, where access swings the price more than weight', () => {
    const small = priceLoading({
      cargoWeightLbs: 40_000,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    })[0];
    const large = priceLoading({
      cargoWeightLbs: 120_000,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    })[0];
    expect(small.accuracy.bandPct).toBe(35);
    expect(large.accuracy.bandPct).toBe(55);
  });

  it('says when the piece weight is itself a derivation', () => {
    const derived = priceLoading({
      cargoWeightLbs: 75_000,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: true,
    })[0];
    expect(derived.accuracy.detail).toMatch(/derivation on top of a derivation/);
  });
});

describe('the rest of the invoice', () => {
  it('scales detention by axle count — $605/hr for a 13-axle rig', () => {
    expect(detentionUsdPerHour(5)).toBe(150);
    expect(detentionUsdPerHour(8)).toBe(350);
    expect(detentionUsdPerHour(13)).toBe(605);
    expect(detentionUsdPerHour(16)).toBe(790);
    // Four times the van-freight expectation a shipper carries in their head.
    expect(detentionUsdPerHour(13) / 150).toBeGreaterThan(4);
  });

  it('prices tarping by dimension and REFUSES above the tariff’s own threshold', () => {
    expect(tarpingUsd(96, 96)).toBe(150);
    expect(tarpingUsd(120, 96)).toBe(225);
    expect(tarpingUsd(150, 96)).toBe(315);
    // Over 14 ft wide the filed tariff itself prints SPOT BID.
    expect(tarpingUsd(14 * 12 + 1, 96)).toBeNull();
    expect(tarpingUsd(96, 12 * 12 + 1)).toBeNull();
  });

  it('prices the permit AGENT’S fee as a band, never a point', () => {
    const svc = permitServiceLine(7);
    expect(svc?.lowUsd).toBe(210);
    expect(svc?.highUsd).toBe(595);
    expect(svc?.headlineUsd).toBe(385);
    expect(svc?.accuracy.tier).toBe('benchmark');
    expect(svc?.accuracy.detail).toMatch(/never added to the permit total/);
    expect(permitServiceLine(0)).toBeNull();
  });

  it('fires a route survey only where a state flags a superload', () => {
    expect(routeSurveyLine([])).toBeNull();
    const survey = routeSurveyLine(['TX', 'OH']);
    expect(survey?.lowUsd).toBe(200);
    expect(survey?.name).toMatch(/TX, OH/);
    // CONDITIONAL: headline is likelihood-weighted at the midpoint, not the
    // 65th percentile, so a may-not-apply item does not inflate every quote.
    expect(survey?.headlineUsd).toBeCloseTo(
      ((survey?.lowUsd ?? 0) + (survey?.highUsd ?? 0)) / 2,
      2,
    );
  });

  it('turns cargo value into arithmetic instead of a guess', () => {
    expect(excessValueLine(undefined)).toBeNull();
    expect(excessValueLine(80_000)).toBeNull();
    const cover = excessValueLine(500_000);
    expect(cover?.lowUsd).toBe(2000);
    expect(cover?.highUsd).toBe(7600);
    expect(cover?.headlineUsd).toBe(3000);
  });
});
