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
  citedCarriesNoBand,
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
  REGIONS_WITH_PUBLISHED_FLATBED_RATE,
  MINIMUM_CROSSOVER_MILES,
  PROCUREMENT_CROSSOVER_MILES,
  OBSERVED_FLATBED_MEDIAN_USD_PER_MILE,
  OBSERVED_CURVE_ANCHOR_MILES,
  atsAxleFormulaUsd,
  observedCurveUsdPerMile,
  observedCurveMultiplier,
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
  CRANE_BAND_PCT_MOB_EXCLUDED,
  CRANE_BAND_PCT_NORMAL,
  CRANE_BAND_PCT_REGION_KNOWN,
  CRANE_BAND_PCT_WIDE,
  CRANE_MOB_EXCLUDED_CARGO_LBS,
  CRANE_REFUSAL_CARGO_LBS,
  CRANE_REGION_MULTIPLIERS,
  craneMinHours,
  craneRateUsdPerHour,
  craneRegionForState,
  detentionRiskLine,
  detentionUsdPerHour,
  excessValueLine,
  headlineOf,
  layoverRiskLine,
  permitServiceLine,
  physicalRouteSurveyLine,
  priceLoading,
  securementChainCount,
  securementLine,
  stateAnalysisFee,
  stateAnalysisFeeLine,
  tarpingLine,
  tarpingUsd,
  utilityClearanceRiskLine,
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

  it('A CITED FIGURE CARRIES NO BAND — and that is the test for the category', () => {
    // The rule exists because the judgement it replaces is easy to get wrong.
    // "A published fee schedule" reads as though a filed carrier tariff counts,
    // and it does not: a statute binds every carrier, a tariff binds the one
    // that filed it, and the shipper has not picked a carrier yet. So the rule
    // is arithmetic instead of prose -- if it needs a range, we do not know it.
    const banded = {
      code: 'tarping_pretending_to_be_a_statute',
      name: 'A tariff charge wearing a statute’s label',
      basis: 'sourced',
      amountUsd: 225,
      accuracy: rate({
        tier: 'cited',
        bandPct: 20,
        lowUsd: 180,
        highUsd: 270,
        hover: 'x',
        detail: 'y',
      }),
    };
    expect(citedCarriesNoBand(banded)).toMatch(/carries no band/);
    expect(accuracyBasisViolations([banded])).toHaveLength(1);
    expect(() => assertAccuracyBasisInvariant([banded])).toThrow(/carries no band/);

    // Both honest forms pass: no low/high at all, or low and high that ARE the
    // figure. Tennessee's $320 is the second.
    const noRange = {
      code: 'permit_TN',
      name: 'Tennessee single-trip OS/OW permit',
      basis: 'sourced',
      amountUsd: 320,
      accuracy: rate({ tier: 'cited', bandPct: 0, hover: 'x', detail: 'y' }),
    };
    const pointRange = {
      ...noRange,
      accuracy: rate({
        tier: 'cited',
        bandPct: 0,
        lowUsd: 320,
        highUsd: 320,
        hover: 'x',
        detail: 'y',
      }),
    };
    expect(citedCarriesNoBand(noRange)).toBeNull();
    expect(citedCarriesNoBand(pointRange)).toBeNull();
    expect(accuracyBasisViolations([noRange, pointRange])).toEqual([]);
  });

  it('leaves NOTHING in this engine claiming CITED — every figure here is a market one', () => {
    // After the retier the only cited money on a quote is the state permit fees
    // and the published police-escort floors, and neither is produced in this
    // directory. A filed carrier tariff is excellent evidence and it is still
    // one carrier's schedule.
    const everyAccessorial = [
      ...priceLoading({
        cargoWeightLbs: 40_000,
        end: 'origin',
        stateCode: 'TX',
        cargoWeightDerived: false,
      }),
      tarpingLine(120, 96),
      securementLine(40_000, 240),
      detentionRiskLine(13),
      layoverRiskLine(),
      permitServiceLine(3),
      stateAnalysisFeeLine(['TX']),
      physicalRouteSurveyLine({ heightIn: 180, routeMiles: 1_484 }),
      excessValueLine(500_000),
    ].filter((l): l is NonNullable<typeof l> => l !== null);
    for (const l of everyAccessorial) {
      expect(l.accuracy.tier).not.toBe('cited');
    }
  });

  it('says a filed tariff is a filed tariff, in the hover, in as many words', () => {
    // More useful to a shipper than either "cited" or a bare "market estimate".
    expect(tarpingLine(120, 96).accuracy.hover).toMatch(/not a statute/);
    expect(detentionRiskLine(13).accuracy.hover).toMatch(/not a statute/);
    expect(layoverRiskLine().accuracy.hover).toMatch(/not a statute/);
  });

  it('EACH TIER CARRIES ITS OWN BAND — there is no global ± number', () => {
    expect(TIER_DEFAULT_BAND_PCT.cited).toBe(0);
    expect(TIER_DEFAULT_BAND_PCT.indexed).toBeLessThan(TIER_DEFAULT_BAND_PCT.benchmark);
    // And a component's own measured spread overrides the tier default: the
    // research measured detention at ±15% and a route survey at ±70%.
    expect(detentionUsdPerHour(13)).toBe(605);
    expect(detentionRiskLine(13).accuracy.bandPct).toBe(15);
    // The route-survey line used to be ±70% because ONE line was carrying two
    // products. Split, the state's own analysis fee in Texas is a statutory
    // $500 (±10%) and the private drive-the-route survey is ±35%.
    const analysis = stateAnalysisFeeLine(['TX']);
    expect(analysis?.accuracy.bandPct).toBe(10);
    const survey = physicalRouteSurveyLine({ heightIn: 180, routeMiles: 1_484 });
    expect(survey?.accuracy.bandPct).toBe(35);
    const svc = permitServiceLine(7);
    expect(svc?.accuracy.bandPct).toBe(20);
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
      stateAnalysisFeeLine(['TX']),
      physicalRouteSurveyLine({ heightIn: 180, routeMiles: 1_484 }),
      utilityClearanceRiskLine(180),
      securementLine(120_000, 600),
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

  it('HOLDS THE ANCHOR AT $2.67 against 2,636 observed flatbed postings', () => {
    // The observed median is $2.84/mi (p25 $2.16, p75 $3.49), and DAT's own
    // June-2026 flatbed line-haul was $2.94. $2.67 therefore sits near the 40th
    // percentile of what open-deck freight actually posts at: conservative, not
    // wrong, and it is not raised because the anchor's value is that it is a
    // dated published figure rather than an unpublished observed median.
    expect(OBSERVED_FLATBED_MEDIAN_USD_PER_MILE).toBe(2.84);
    expect(BASE_FLATBED_LINEHAUL_USD_PER_MILE).toBeLessThan(
      OBSERVED_FLATBED_MEDIAN_USD_PER_MILE,
    );
    // Inside the observed p25-p75, and within 7% of the observed median.
    expect(BASE_FLATBED_LINEHAUL_USD_PER_MILE).toBeGreaterThan(2.16);
    expect(
      Math.abs(BASE_FLATBED_LINEHAUL_USD_PER_MILE / OBSERVED_FLATBED_MEDIAN_USD_PER_MILE - 1),
    ).toBeLessThan(0.07);
  });

  it('CORRECTS THE SHORT-HAUL RUNG from a reefer-produce 1.90 to 1.28', () => {
    // 1.90 came from USDA REEFER PRODUCE lanes: real data, wrong market. Two
    // independent angles agree on the replacement -- published rate structures
    // give 1.22-1.30 (median 1.25) and observed postings give $3.73/mi at
    // 150-300 mi against $2.87/mi at 800-1,200 mi, a ratio of 1.30. 1.28 is the
    // midpoint of those two central estimates.
    expect(distanceMultiplier(120)).toBe(1.28);
    expect(1.28).toBeGreaterThanOrEqual(1.25);
    expect(1.28).toBeLessThanOrEqual(1.3);
    expect(3.73 / 2.87).toBeCloseTo(1.3, 2);
    // And the cliff is gone: 1.90 -> 1.25 was a 34% step at 250 miles; 1.28 ->
    // 1.25 is 2.4%, so the curve degrades smoothly into the next band.
    const step = distanceMultiplier(249) / distanceMultiplier(251) - 1;
    expect(step).toBeLessThan(0.03);
    expect(distanceMultiplier(300)).toBe(1.25);
    expect(distanceMultiplier(750)).toBe(1.0);
    expect(distanceMultiplier(1200)).toBe(0.87);
    expect(distanceMultiplier(2000)).toBe(0.85);
    expect(DISTANCE_BANDS).toHaveLength(5);
  });

  it('THE MINIMUM GOVERNS EVERY LANE BELOW THE ~250-MILE CROSSOVER', () => {
    // The crossover, not the level, is what two unrelated methods agree on:
    // USDA's flat sub-100-mile totals put it at 256 miles, and an interagency
    // lowboy schedule that pays "the guarantee OR the mileage, whichever is
    // greater" crosses its own rates at 244-261. So every rung of the ladder is
    // the price of a 250-mile lane for its class.
    for (const miles of [1, 25, 60, 100, 185, 240]) {
      const out = priceMarketLinehaul({ miles, equipment: 'flatbed' });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.minimumBinds).toBe(true);
      expect(out.totalUsd).toBe(850);
    }
    // EVERY class crosses inside the range the interagency schedule measures.
    for (const equipment of ['flatbed', 'stepDeck', 'rgn', 'multiAxle'] as const) {
      const crossover = notionalCrossoverMiles(equipment);
      expect(crossover).toBeGreaterThanOrEqual(PROCUREMENT_CROSSOVER_MILES.low);
      expect(crossover).toBeLessThanOrEqual(PROCUREMENT_CROSSOVER_MILES.high);
      // And each rung really is the price of a 250-mile lane, to the rounding.
      const exact =
        BASE_FLATBED_LINEHAUL_USD_PER_MILE *
        DISTANCE_BANDS[0].multiplier *
        EQUIPMENT[equipment].multiplier *
        MINIMUM_CROSSOVER_MILES;
      expect(Math.abs(EQUIPMENT[equipment].minimumUsd - exact)).toBeLessThanOrEqual(5);
    }
    // Rounding to the nearest $10 is the only reason they are not identical,
    // and it leaves under two miles of spread across the four classes.
    const crossings = (['flatbed', 'stepDeck', 'rgn', 'multiAxle'] as const).map((e) =>
      notionalCrossoverMiles(e),
    );
    expect(Math.max(...crossings) - Math.min(...crossings)).toBeLessThan(2);
  });

  it('LOWERS THE FLATBED RUNG from a reefer-produce $1,300 to a published $850', () => {
    // Every published open-deck minimum is below $1,300, most by 2-4x: a
    // $600-$1,400 day rate, $300-$800 for a local legal move, ~$500 flat fees.
    // $1,300 was USDA REFRIGERATED PRODUCE, where the reefer unit and produce
    // urgency support a floor open-deck local work does not.
    expect(EQUIPMENT.flatbed.minimumUsd).toBe(850);
    expect(EQUIPMENT.flatbed.minimumUsd).toBeGreaterThanOrEqual(600);
    expect(EQUIPMENT.flatbed.minimumUsd).toBeLessThanOrEqual(1400);
    // The heavy rungs stay well above it, because the procurement figures that
    // support THEM are for a different product: fully-operated heavy haul.
    expect(EQUIPMENT.rgn.minimumUsd).toBe(1370);
    expect(EQUIPMENT.rgn.minimumUsd).toBeGreaterThanOrEqual(1100);
    expect(EQUIPMENT.rgn.minimumUsd).toBeLessThanOrEqual(1500);
    expect(EQUIPMENT.multiAxle.minimumUsd).toBe(1750);
    expect(EQUIPMENT.multiAxle.minimumUsd).toBeGreaterThanOrEqual(800);
    expect(EQUIPMENT.multiAxle.minimumUsd).toBeLessThanOrEqual(2500);
    // The ladder keeps its shape: each rung is its class multiplier times the
    // flatbed rung, to the rounding.
    for (const equipment of ['stepDeck', 'rgn', 'multiAxle'] as const) {
      const ratio = EQUIPMENT[equipment].minimumUsd / EQUIPMENT.flatbed.minimumUsd;
      expect(ratio).toBeCloseTo(EQUIPMENT[equipment].multiplier, 1);
    }
  });

  it('is 35% higher than a pure per-mile model on the 185-mile step-deck lane', () => {
    const out = priceMarketLinehaul({ miles: 185, equipment: 'stepDeck' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.totalUsd).toBe(870);
    // A pure per-mile model with no floor returns $645 on this lane. The floor
    // is smaller than it used to be AND the short-haul multiplier is smaller,
    // so the gap between the two is almost exactly what it was: the two
    // corrections were of the same double-count, from opposite ends.
    const naive = 2.67 * 1.28 * 1.02 * 185;
    expect(naive).toBeCloseTo(644.9, 1);
    expect(out.totalUsd / naive).toBeGreaterThan(1.34);
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
    // At 1,115 mi the 1,000-1,500 band multiplier is 0.87, giving $4.76/mi --
    // but the 500-1,000 band's ceiling price ($5,473) is higher and acts as this
    // lane's floor. A row reading "1,115 mi x $4.76/mi" beside a $5,473 total is
    // arithmetic a reader can check and find wrong, so the row quotes $4.91.
    const out = priceMarketLinehaul({ miles: 1115.38, equipment: 'multiAxle' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.effectiveUsdPerMile).toBeCloseTo(2.67 * 0.87 * 2.05, 3);
    expect(out.bandCeilingGoverns).toBe(true);
    expect(out.totalUsd).toBeCloseTo(2.67 * 1.0 * 2.05 * 1000, 2);
    expect(out.realisedUsdPerMile * out.miles).toBeCloseTo(out.totalUsd, 0);
    expect(out.notes.join(' ')).toMatch(/cannot price below what a 1,000-mile lane costs/);

    // At 1,484 mi the band's own rate has overtaken the ceiling again.
    const longer = priceMarketLinehaul({ miles: 1484, equipment: 'multiAxle' });
    expect(longer.ok).toBe(true);
    if (!longer.ok) return;
    expect(longer.bandCeilingGoverns).toBe(false);
    expect(longer.totalUsd).toBeCloseTo(2.67 * 0.87 * 2.05 * 1484, 2);
  });

  it('carries the equipment multipliers and minimums the three angles settled on', () => {
    expect(EQUIPMENT.flatbed.multiplier).toBe(1.0);
    expect(EQUIPMENT.stepDeck.multiplier).toBe(1.02);
    expect(EQUIPMENT.rgn.multiplier).toBe(1.6);
    expect(EQUIPMENT.multiAxle.multiplier).toBe(2.05);
    expect(EQUIPMENT.flatbed.minimumUsd).toBe(850);
    expect(EQUIPMENT.multiAxle.minimumUsd).toBe(1750);
  });

  it('MOVES STEP DECK TO 1.02 — the only multiplier that is actually measured', () => {
    // 162 matched state-pair lanes carrying BOTH a flatbed and a step-deck row
    // with >=5 observed loads each: median ratio 0.970, load-weighted mean
    // 0.985, on 10,245 step-deck postings. Five publishers say 1.10. On a
    // legal-weight equipment class, transaction volume wins -- so 1.02 sits just
    // above parity rather than at the guides' figure, and BOTH are recorded.
    expect(EQUIPMENT.stepDeck.multiplier).toBe(1.02);
    expect(EQUIPMENT.stepDeck.multiplier).toBeGreaterThan(0.97);
    expect(EQUIPMENT.stepDeck.multiplier).toBeLessThan(1.108);
    expect(EQUIPMENT.stepDeck.basis).toMatch(/0\.970/);
    expect(EQUIPMENT.stepDeck.basis).toMatch(/10,245/);
    expect(EQUIPMENT.stepDeck.basis).toMatch(/1\.10/);
  });

  it('HOLDS RGN AT 1.60 BECAUSE TWO METHODS BRACKET IT, and says bracketed not confirmed', () => {
    // Published: 10 publishers, median 1.523. Observed: 3 marketplace rate sets,
    // 1.71 / 1.75 / 1.86. They straddle 1.60. When two independent methods
    // bracket a value, the value is not the thing to change -- moving to either
    // would be picking a side the evidence does not pick.
    expect(EQUIPMENT.rgn.multiplier).toBe(1.6);
    expect(1.523).toBeLessThan(EQUIPMENT.rgn.multiplier);
    expect(1.75).toBeGreaterThan(EQUIPMENT.rgn.multiplier);
    expect(EQUIPMENT.rgn.basis).toMatch(/BRACKETED, not confirmed/);
    const out = priceMarketLinehaul({ miles: 900, equipment: 'rgn' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.accuracy.hover).toMatch(/bracketed/i);
    expect(out.accuracy.detail).toMatch(/BRACKETED, NOT CONFIRMED/);
    // Bracketed is not confirmed, so the band does not narrow.
    expect(LINEHAUL_BAND_PCT.rgn).toBe(40);
  });

  it('MOVES MULTI-AXLE 2.40 -> 2.05 because 2.40 DOUBLE-COUNTED permits and escorts', () => {
    // 2.40 came from PERMITTED-BAND rates, and three publishers state those
    // bands are all-in -- "linehaul plus permits, escorts, and fuel", "the total
    // cost to the shipper". This engine prices permits and escorts as separate
    // lines, so 2.40 charged for them twice. That is a category error, not a
    // calibration error, and it is the reason the higher figure was rejected.
    expect(EQUIPMENT.multiAxle.multiplier).toBe(2.05);
    // Two independent angles converge once the accessorials come back out:
    // three decomposed published quotes give 1.79-2.12 (median 2.07), and a
    // government lowboy schedule whose rate is explicitly ex-escort gives
    // 1.85-2.00. 2.05 is inside both.
    expect(EQUIPMENT.multiAxle.multiplier).toBeGreaterThanOrEqual(1.85);
    expect(EQUIPMENT.multiAxle.multiplier).toBeLessThanOrEqual(2.12);
    expect(EQUIPMENT.multiAxle.basis).toMatch(/2\.40 was rejected/);
    expect(EQUIPMENT.multiAxle.basis).toMatch(/all-in/);
  });

  it('SAYS CORROBORATED, NOT MEASURED — a recalibration is not a promotion', () => {
    // The heavy end has almost no public transaction record: two lowboy
    // postings in a 4,087-load board, and nothing above 47,000 lb in the whole
    // weight sample. So multi-axle moved from ONE inference to TWO AGREEING
    // inferences -- better, and still not an observation.
    const out = priceMarketLinehaul({ miles: 900, equipment: 'multiAxle' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.accuracy.hover).toMatch(/corroborated, not measured/);
    expect((out.accuracy.hover ?? '').length).toBeLessThanOrEqual(MAX_HOVER_CHARS);
    expect(out.accuracy.detail).toMatch(/CORROBORATED, NOT MEASURED/);
    expect(out.accuracy.detail).toMatch(/47,000 lb/);
    expect(out.accuracy.sample).toMatch(/no observed transaction/);
    // AND THE BAND DOES NOT NARROW. This is the one dishonest move available in
    // this recalibration and the test exists to stop it being made later.
    expect(LINEHAUL_BAND_PCT.multiAxle).toBe(40);
  });

  it('CROSS-CHECKS THE MULTI-AXLE RATE AGAINST A REAL CARRIER’S PUBLISHED FORMULA', () => {
    // Anderson Trucking Service -- an asset-based specialized carrier, not a
    // broker guide -- publishes $1 x axles x miles up to 100,000 lb, with a
    // worked example: 70,000 lb boiler, New Orleans->Indianapolis, 819 mi,
    // 7 axles, $5,733. Reproduce it exactly first.
    expect(atsAxleFormulaUsd(7, 819)).toBe(5733);

    // That figure is ALL-IN by the carrier's own policy. Strip fuel at our own
    // multi-axle divisor and what is left STILL contains light permits, so our
    // permits-excluded line-haul must sit AT OR BELOW it.
    const fuelPerMile = (5.454 - 1.25) / mpgForEquipment('multiAxle');
    const atsExFuelPerMile = atsAxleFormulaUsd(7, 819) / 819 - fuelPerMile;
    expect(atsExFuelPerMile).toBeCloseTo(5.8, 1);

    const ours = priceMarketLinehaul({ miles: 819, equipment: 'multiAxle' });
    expect(ours.ok).toBe(true);
    if (!ours.ok) return;
    expect(ours.effectiveUsdPerMile).toBeLessThanOrEqual(atsExFuelPerMile);
    // And not absurdly below it either -- a real carrier's published number is
    // the sanity rail in both directions.
    expect(ours.effectiveUsdPerMile).toBeGreaterThan(atsExFuelPerMile * 0.75);

    // THIS TEST HAS TEETH: the old 2.40 multiplier fails the upper bound.
    expect(BASE_FLATBED_LINEHAUL_USD_PER_MILE * 2.4).toBeGreaterThan(atsExFuelPerMile);
    // It is evaluated at the shipping anchor. If the anchor is refetched much
    // higher and this fires, that is a real calibration alarm, not flake.
    expect(BASE_FLATBED_LINEHAUL_USD_PER_MILE).toBe(2.67);
  });

  it('TESTED THE FITTED DISTANCE CURVE AS A REPLACEMENT, AND KEPT THE BANDS', () => {
    // 626 lanes / 12,881 observed open-deck loads fit $/mi = 8.34 x mi^-0.168.
    // The three conditions a replacement had to meet, all three of which it
    // MEETS -- so the reason it is not adopted has to be stated, not implied.

    // 1. Monotone-decreasing in $/mile.
    let previousRate = Infinity;
    for (let miles = 50; miles <= 3000; miles += 25) {
      const r = observedCurveUsdPerMile(miles);
      expect(r).toBeLessThan(previousRate);
      previousRate = r;
    }
    // 2. Total dollars never fall as miles rise.
    let previousTotal = 0;
    for (let miles = 50; miles <= 3000; miles += 25) {
      const total = observedCurveUsdPerMile(miles) * miles;
      expect(total).toBeGreaterThan(previousTotal);
      previousTotal = total;
    }
    // 3. Reproduces every observed band median inside that band's own p25-p75.
    const observedBands: ReadonlyArray<[number, number, number, number]> = [
      // [geometric midpoint, p25, median, p75]
      [Math.sqrt(150 * 300), 3.21, 3.73, 4.01],
      [Math.sqrt(300 * 500), 2.26, 2.83, 3.42],
      [Math.sqrt(500 * 800), 2.25, 3.04, 3.59],
      [Math.sqrt(800 * 1200), 2.33, 2.87, 3.4],
      [Math.sqrt(1200 * 2000), 2.03, 2.27, 2.51],
      [2500, 1.8, 1.98, 2.3],
    ];
    for (const [mid, p25, , p75] of observedBands) {
      const fitted = observedCurveUsdPerMile(mid);
      expect(fitted).toBeGreaterThanOrEqual(p25);
      expect(fitted).toBeLessThanOrEqual(p75);
    }

    // AND IT IS STILL NOT ADOPTED. The curve is an ABSOLUTE $/mi; this model
    // needs a RELATIVE multiplier on DAT's published flatbed line-haul, and DAT
    // publishes no lane length for its own figure. Normalising it means
    // inventing that constant and then making it load-bearing on every quote.
    // The bands need no such constant: USDA's observation is already relative.
    expect(OBSERVED_CURVE_ANCHOR_MILES).toBeCloseTo(707.1, 1);
    expect(observedCurveMultiplier(OBSERVED_CURVE_ANCHOR_MILES)).toBeCloseTo(1, 6);

    // And the gain is small where the model operates: beyond 600 miles the two
    // agree to about 6%, well inside the +/-25-40% the model already declares.
    for (let miles = 600; miles <= 3000; miles += 50) {
      const banded = distanceMultiplier(miles);
      const fitted = observedCurveMultiplier(miles);
      expect(Math.abs(banded / fitted - 1)).toBeLessThan(0.09);
    }
    // They diverge more inside the 250-500 band -- and that divergence is about
    // that rung's level, the last USDA-reefer-derived multiplier in the table,
    // not about step-versus-curve.
    expect(distanceMultiplier(499) / observedCurveMultiplier(499) - 1).toBeGreaterThan(0.15);
  });

  it('REFUSES A SUPERLOAD and routes it to a carrier quote', () => {
    const out = priceMarketLinehaul({ miles: 1500, equipment: 'superload' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.accuracy.tier).toBe('refused');
    expect(out.accuracy.lowUsd).toBeNull();
    expect(out.message).toMatch(/carrier for a lane quote/);
  });

  it('SHIPS REGIONAL MULTIPLIERS OFF — and the sign is no longer reversed', () => {
    const off = priceMarketLinehaul({ miles: 1000, equipment: 'flatbed' });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.regionMultiplier).toBe(1);
    expect(off.notes.join(' ')).toMatch(/Regional adjustment is OFF/);
    // The table exists and is opt-in, and it does move the number when asked.
    const on = priceMarketLinehaul({ miles: 1000, equipment: 'flatbed', region: 'midwest' });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(on.regionMultiplier).toBe(REGION_MULTIPLIERS.midwest);
    expect(on.totalUsd).toBeGreaterThan(off.totalUsd);
  });

  it('CORRECTS A REVERSED REGIONAL SIGN that was waiting behind the flag', () => {
    // DAT's March 2026 regional FLATBED spot rates: national $2.95, MIDWEST
    // HIGHEST at $3.14 (1.064x), WEST LOWEST at $2.39 (0.810x). The old table
    // read Midwest 0.90 and West 1.00 -- both backwards -- and put the Northeast
    // at 1.15, above the published maximum. Nothing was ever mispriced, because
    // the table ships off; but the first person to switch it on would have been
    // handed the exact opposite of the market.
    expect(REGION_MULTIPLIERS.midwest).toBe(1.06);
    expect(REGION_MULTIPLIERS.west).toBe(0.81);
    expect(REGION_MULTIPLIERS.midwest).toBeGreaterThan(REGION_MULTIPLIERS.west);
    expect(3.14 / 2.95).toBeCloseTo(REGION_MULTIPLIERS.midwest, 2);
    expect(2.39 / 2.95).toBeCloseTo(REGION_MULTIPLIERS.west, 2);
    // Midwest is the published maximum and West the published minimum, so no
    // region may sit outside them.
    for (const m of Object.values(REGION_MULTIPLIERS)) {
      expect(m).toBeLessThanOrEqual(REGION_MULTIPLIERS.midwest);
      expect(m).toBeGreaterThanOrEqual(REGION_MULTIPLIERS.west);
    }
    // Exactly two regions have a published flatbed figure. The other four sit
    // at 1.00 rather than carrying a produce or heavy-equipment proxy dressed
    // up as a flatbed rate.
    expect([...REGIONS_WITH_PUBLISHED_FLATBED_RATE].sort()).toEqual(['midwest', 'west']);
    for (const [region, m] of Object.entries(REGION_MULTIPLIERS)) {
      if (REGIONS_WITH_PUBLISHED_FLATBED_RATE.includes(region as never)) continue;
      expect(m).toBe(1.0);
    }
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

  it('renders as a range whose width reflects which joint is weak — AND NONE OF THEM MOVED', () => {
    // The declared bands are unchanged by the recalibration, deliberately.
    expect(LINEHAUL_BAND_PCT.flatbed).toBe(25);
    expect(LINEHAUL_BAND_PCT.stepDeck).toBe(25);
    expect(LINEHAUL_BAND_PCT.rgn).toBe(40);
    expect(LINEHAUL_BAND_PCT.multiAxle).toBe(40);
    // +/-25% is now a MEASUREMENT rather than an argument: 2,636 observed
    // flatbed postings run p25 $2.16 / median $2.84 / p75 $3.49, which is
    // -24% / +23%.
    expect(1 - 2.16 / OBSERVED_FLATBED_MEDIAN_USD_PER_MILE).toBeCloseTo(0.24, 2);
    expect(3.49 / OBSERVED_FLATBED_MEDIAN_USD_PER_MILE - 1).toBeCloseTo(0.23, 2);
    const rgn = priceMarketLinehaul({ miles: 900, equipment: 'rgn' });
    expect(rgn.ok).toBe(true);
    if (!rgn.ok) return;
    expect(rgn.accuracy.tier).toBe('benchmark');
    expect(rgn.accuracy.lowUsd).toBeLessThan(rgn.totalUsd);
    expect(rgn.accuracy.highUsd).toBeGreaterThan(rgn.totalUsd);
    expect(rgn.accuracy.detail).toMatch(/BRACKETED, NOT CONFIRMED/);
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

  it('HOLDS FLAT above the published curve rather than extrapolating its slope', () => {
    // The curve flattens hard up there: $440 to $595 from 165 t to 350 t is
    // +35% of price for +112% of capacity, and a second card prices a 350 t
    // machine at $575 — BELOW this card's 275 t figure. Continuing the sub-100 t
    // slope would invent a rise the market does not charge.
    expect(craneRateUsdPerHour(275)).toBe(595);
    expect(craneRateUsdPerHour(350)).toBe(595);
    expect(craneRateUsdPerHour(500)).toBe(595);
    const slopeBelow = craneRateUsdPerHour(120) - craneRateUsdPerHour(60);
    const slopeAbove = craneRateUsdPerHour(275) - craneRateUsdPerHour(215);
    expect(slopeAbove).toBeLessThan(slopeBelow);
  });

  it('climbs the PUBLISHED minimum-hours ladder, which is the real floor', () => {
    // Five cards publish 3 / 4 / 6 / 8 / 10 hr by capacity. The old flat
    // "3 up to 30 t else 4" under-billed the 100–120 t floor by roughly 2x.
    expect(craneMinHours(25)).toBe(3);
    expect(craneMinHours(30)).toBe(3);
    expect(craneMinHours(40)).toBe(4);
    expect(craneMinHours(80)).toBe(4);
    expect(craneMinHours(100)).toBe(6);
    expect(craneMinHours(120)).toBe(8);
    expect(craneMinHours(250)).toBe(8);
    expect(craneMinHours(350)).toBe(10);
  });

  it('indexes the region on METRO DENSITY, not compass — two old rows had the wrong sign', () => {
    // Charleston SC measured 0.91x and Missoula MT 0.91x against the Dallas
    // spine. The old table put the Southeast at 1.00x and the Mountain states
    // ABOVE Texas at 1.05-1.15x. Both were backwards.
    expect(craneRegionForState('SC')).toBe('southeast');
    expect(craneRegionForState('MT')).toBe('mountainPlains');
    expect(CRANE_REGION_MULTIPLIERS.southeast).toBeLessThan(
      CRANE_REGION_MULTIPLIERS.texasSouthCentral,
    );
    expect(CRANE_REGION_MULTIPLIERS.mountainPlains).toBeLessThan(
      CRANE_REGION_MULTIPLIERS.texasSouthCentral,
    );
    // Chicago metro and the West Coast are above it, and California is confirmed.
    expect(CRANE_REGION_MULTIPLIERS.midwestMetro).toBe(1.15);
    expect(CRANE_REGION_MULTIPLIERS.westCoastMetro).toBe(1.22);
    expect(craneRegionForState('CA')).toBe('westCoastMetro');
    expect(craneRegionForState('IL')).toBe('midwestMetro');
    // With no state we do NOT guess a middle row and quietly apply an uplift
    // nobody evidenced. We fall back to the spine's own market and widen.
    expect(craneRegionForState(null)).toBe('texasSouthCentral');
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

  it('reproduces the Houston worked example on the PUBLISHED minimum-hours ladder', () => {
    // 120,000 lb piece, 120-180 t class, $440-$530/hr on the published curve,
    // Texas 1.00x. The floor is the ladder's 8 hr at this capacity, not the old
    // flat 4 hr: crane $3,766-$4,537 headline $4,267, which is where the ~2x
    // under-billing of the 100-120 t floor gets corrected. And at 120 t the crew
    // is a rigger AND an oiler, so the rigging line doubles at the minimum:
    // $760-$2,280 headline $1,748. The crane road permit is unchanged.
    const lines = priceLoading({
      cargoWeightLbs: 120_000,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    });
    const crane = lines.find((l) => l.code === 'loading_crane_origin');
    expect(crane?.lowUsd).toBeCloseTo(3766.4, 1);
    expect(crane?.highUsd).toBeCloseTo(4536.8, 1);
    expect(Math.round(crane?.headlineUsd ?? 0)).toBe(4267);
    // The old model billed this floor at 4 hr. Exactly twice as much time now.
    expect((crane?.lowUsd ?? 0) / (440 * 4 * 1.07)).toBeCloseTo(2, 5);
    const rigger = lines.find((l) => l.code === 'loading_rigging_origin');
    expect(rigger?.name).toMatch(/rigger \+ oiler/i);
    expect(rigger?.lowUsd).toBe(760);
    expect(rigger?.highUsd).toBe(2280);
    expect(Math.round(rigger?.headlineUsd ?? 0)).toBe(1748);
    const permit = lines.find((l) => l.code === 'loading_crane_permit_origin');
    expect(permit?.lowUsd).toBe(125);
    expect(permit?.highUsd).toBe(275);
    expect(Math.round(permit?.headlineUsd ?? 0)).toBe(223);
  });

  it('carries an OILER as a second wage unit at 100 t and above, and not below', () => {
    // One card prices its 100 t and 175 t machines "full dress with oiler" and
    // itemises him; the smaller machines on the same card carry none. A quote
    // that adds a single rigger to a 100 t pick is a body short.
    const small = priceLoading({
      cargoWeightLbs: 40_000, // 40-60 t class
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    }).find((l) => l.code === 'loading_rigging_origin');
    expect(small?.name).not.toMatch(/oiler/i);
    expect(small?.lowUsd).toBe(380); // one rigger at the 4 hr minimum
    const big = priceLoading({
      cargoWeightLbs: 100_000, // 100-150 t class
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    }).find((l) => l.code === 'loading_rigging_origin');
    expect(big?.name).toMatch(/oiler/i);
    expect(big?.lowUsd).toBe(760); // two bodies at the 4 hr minimum
  });

  it('applies the Northeast metro uplift at the Buffalo end', () => {
    const lines = priceLoading({
      cargoWeightLbs: 120_000,
      end: 'destination',
      stateCode: 'NY',
      cargoWeightDerived: false,
    });
    const crane = lines.find((l) => l.code === 'loading_crane_destination');
    expect(crane?.lowUsd).toBeCloseTo(4595.01, 1);
    expect(crane?.highUsd).toBeCloseTo(5534.9, 1);
    // The Northeast row is the ONE cell with no commercial card behind it, and
    // the line says so rather than passing it off as measured.
    expect(crane?.accuracy.detail).toMatch(/is DERIVED/);
  });

  it('REFUSES ABOVE 200,000 LB — the wall moved, and only half of it did', () => {
    const lines = priceLoading({
      cargoWeightLbs: CRANE_REFUSAL_CARGO_LBS + 1,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    });
    expect(CRANE_REFUSAL_CARGO_LBS).toBe(200_000);
    expect(lines).toHaveLength(1);
    expect(lines[0].headlineUsd).toBeNull();
    expect(lines[0].lowUsd).toBeNull();
    expect(lines[0].accuracy.tier).toBe('refused');
    // A refusal that hands the shipper their next action is not a dead end.
    expect(lines[0].accuracy.detail).toMatch(/site survey/i);
    expect(lines[0].accuracy.hover).toMatch(/From about \$/);
    // The honest sentence: we can quote the crane, not getting it there.
    expect(lines[0].accuracy.detail).toMatch(/cannot quote getting it there/i);
    // 200,000 lb exactly still prices.
    const ok = priceLoading({
      cargoWeightLbs: CRANE_REFUSAL_CARGO_LBS,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    });
    expect(ok.length).toBe(3);
  });

  it('quotes 160k-200k lb as a FLOOR with mobilisation excluded, and says so', () => {
    // The operated hour is published to 350 t by three cards and is flat across
    // the band. Assembly and multi-trailer mobilisation are still published by
    // nobody, so they come out of the number and into the sentence.
    const lines = priceLoading({
      cargoWeightLbs: CRANE_MOB_EXCLUDED_CARGO_LBS + 1,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    });
    expect(lines).toHaveLength(3);
    const crane = lines[0];
    expect(crane.headlineUsd).not.toBeNull();
    expect(crane.accuracy.bandPct).toBe(CRANE_BAND_PCT_MOB_EXCLUDED);
    expect(crane.accuracy.hover).toMatch(/mobilisation are NOT included/);
    expect(crane.accuracy.detail).toMatch(/ARE NOT IN THIS FIGURE/);
    expect(crane.accuracy.detail).toMatch(/a floor, not a total/);
  });

  it('NEVER implies bare hire is a cheaper option — both bidders refused to quote one', () => {
    for (const cargo of [40_000, 120_000, 180_000, 260_000]) {
      const lines = priceLoading({
        cargoWeightLbs: cargo,
        end: 'origin',
        stateCode: 'TX',
        cargoWeightDerived: false,
      });
      expect(lines[0].accuracy.detail).toMatch(/no cheaper bare option/);
      expect(lines[0].accuracy.detail).toMatch(/declined all sixteen lines/);
    }
  });

  it('narrows the band ONLY where the region is known, never nationally', () => {
    const known = priceLoading({
      cargoWeightLbs: 40_000,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    })[0];
    const unknown = priceLoading({
      cargoWeightLbs: 40_000,
      end: 'origin',
      stateCode: null,
      cargoWeightDerived: false,
    })[0];
    // Regional variance is now MODELLED instead of absorbed into the band, so a
    // job whose market we know carries the interquartile spread plus site risk.
    expect(known.accuracy.bandPct).toBe(CRANE_BAND_PCT_REGION_KNOWN);
    expect(known.accuracy.bandPct).toBe(25);
    // Without the region you are still exposed to the full 0.85x-1.30x spread.
    expect(unknown.accuracy.bandPct).toBe(CRANE_BAND_PCT_NORMAL);
    expect(unknown.accuracy.bandPct).toBe(35);
    expect(unknown.accuracy.detail).toMatch(/No state was given/);
  });

  it('tightens 80,000-160,000 lb from ±55% to ±40%, and says why', () => {
    const large = priceLoading({
      cargoWeightLbs: 120_000,
      end: 'origin',
      stateCode: 'TX',
      cargoWeightDerived: false,
    })[0];
    expect(large.accuracy.bandPct).toBe(CRANE_BAND_PCT_WIDE);
    expect(large.accuracy.bandPct).toBe(40);
    // What is left at this size is SITE risk, not price risk.
    expect(large.accuracy.detail).toMatch(/how far the crane can set up/);
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

  it('tiers tarping as a BENCHMARK, because one carrier’s tariff is not a statute', () => {
    const t = tarpingLine(120, 96);
    expect(t.accuracy.tier).toBe('benchmark');
    expect(t.accuracy.lowUsd).toBe(180);
    expect(t.accuracy.highUsd).toBe(270);
    expect(t.accuracy.detail).toMatch(/another carrier will quote another number/);
  });

  it('prices tarping by dimension and REFUSES above the tariff’s own threshold', () => {
    expect(tarpingUsd(96, 96)).toBe(150);
    expect(tarpingUsd(120, 96)).toBe(225);
    expect(tarpingUsd(150, 96)).toBe(315);
    // Over 14 ft wide the filed tariff itself prints SPOT BID.
    expect(tarpingUsd(14 * 12 + 1, 96)).toBeNull();
    expect(tarpingUsd(96, 12 * 12 + 1)).toBeNull();
  });

  it('prices the permit AGENT’S fee as TWO TIERS, which is what the old ±45% was', () => {
    const svc = permitServiceLine(7);
    // The published edges are $27 and $82, not the old $30 and $85.
    expect(svc?.lowUsd).toBe(189);
    expect(svc?.highUsd).toBe(574);
    expect(svc?.headlineUsd).toBe(385);
    expect(svc?.accuracy.tier).toBe('benchmark');
    expect(svc?.accuracy.bandPct).toBe(20);
    expect(svc?.accuracy.detail).toMatch(/never added to the permit total/);
    expect(permitServiceLine(0)).toBeNull();
  });

  it('tightens to ±11% when the service tier is declared — each tier is internally tight', () => {
    const budget = permitServiceLine(7, { tier: 'budget' });
    expect(budget?.lowUsd).toBe(168); // 7 x $24
    expect(budget?.highUsd).toBe(210); // 7 x $30
    expect(budget?.accuracy.bandPct).toBe(11);
    const full = permitServiceLine(7, { tier: 'fullService' });
    expect(full?.lowUsd).toBe(507.5); // 7 x $72.50
    expect(full?.highUsd).toBe(633.5); // 7 x $90.50
    expect(full?.accuracy.bandPct).toBe(11);
    // The 3x spread is BETWEEN the tiers, not inside either of them.
    expect((full?.headlineUsd ?? 0) / (budget?.headlineUsd ?? 1)).toBeGreaterThan(2.5);
  });

  it('keeps the superload uplift SMALL, because the state fee is what costs money', () => {
    const plain = permitServiceLine(2);
    const withSuper = permitServiceLine(2, { superloadPermitCount: 1 });
    expect(withSuper?.headlineUsd ?? 0).toBeGreaterThan(plain?.headlineUsd ?? 0);
    // $60-$90.50 published against $27-$82 standard: more, but not a lot more.
    expect((withSuper?.headlineUsd ?? 0) / (plain?.headlineUsd ?? 1)).toBeLessThan(1.5);
    expect(withSuper?.name).toMatch(/1 at the superload rate/);
    expect(withSuper?.accuracy.detail).toMatch(/SUPERLOAD UPLIFT IS SMALL/);
  });

  it('does NOT bill the NJ and TX portal surcharges twice — the permits engine has them', () => {
    // Both are real, both are published, and both are already `transactionFee`
    // inside the CITED permit total. Adding them here would charge the shipper
    // twice for the same statutory add-on.
    const svc = permitServiceLine(7);
    expect(svc?.accuracy.detail).toMatch(/already inside the cited permit total/);
  });

  it('splits the state ANALYSIS fee from the private ROUTE SURVEY', () => {
    expect(stateAnalysisFeeLine([])).toBeNull();
    // The state's own engineers: Texas is a statutory $500, or $100 with no
    // bridges on the route. Ohio's schedule has not been read, so it keeps the
    // original width — and the widest state on the lane governs the line.
    const analysis = stateAnalysisFeeLine(['TX', 'OH']);
    expect(analysis?.lowUsd).toBe(200);
    expect(analysis?.highUsd).toBe(1000);
    expect(analysis?.name).toMatch(/TX, OH/);
    expect(analysis?.accuracy.bandPct).toBe(70);
    expect(stateAnalysisFeeLine(['TX'])?.accuracy.bandPct).toBe(10);
    // And the reframe that made the split possible.
    expect(analysis?.accuracy.detail).toMatch(/no state charges for one/);
  });

  it('drives Missouri off ROUTE MILES, which is the only distance-tiered schedule found', () => {
    expect(stateAnalysisFee('MO', { routeMiles: 40 }).headlineUsd).toBe(425);
    expect(stateAnalysisFee('MO', { routeMiles: 150 }).headlineUsd).toBe(625);
    expect(stateAnalysisFee('MO', { routeMiles: 900 }).headlineUsd).toBe(925);
    // A long Missouri superload is $925, not a flat mid-four-hundreds figure.
    expect(stateAnalysisFee('MO', { routeMiles: 900 }).bandPct).toBe(10);
  });

  it('shows $0 for a state whose COMPLETE published fee list contains none', () => {
    // Negative evidence, not a gap. Imputing a national average to Washington
    // would invent a fee the state does not charge.
    const wa = stateAnalysisFee('WA', {});
    expect(wa.headlineUsd).toBe(0);
    expect(wa.architecture).toBe('nonePublished');
    expect(wa.note).toMatch(/negative evidence/);
  });

  it('prices per-unit states on an exact RATE and an unknown COUNT', () => {
    expect(stateAnalysisFee('MD', {}).architecture).toBe('perStructure');
    expect(stateAnalysisFee('MD', {}).bandPct).toBe(40);
    expect(stateAnalysisFee('IN', {}).lowUsd).toBe(10);
    expect(stateAnalysisFee('WI', {}).architecture).toBe('perReview');
    expect(stateAnalysisFee('IL', {}).lowUsd).toBe(160); // $40/hr x 4 hr
    expect(stateAnalysisFee('IL', {}).highUsd).toBe(480); // $40/hr x 12 hr
    // South Carolina steps on GROSS WEIGHT and adds its $100 application fee.
    expect(stateAnalysisFee('SC', { grossWeightLbs: 150_000 }).headlineUsd).toBe(200);
    expect(stateAnalysisFee('SC', { grossWeightLbs: 320_000 }).headlineUsd).toBe(450);
    expect(stateAnalysisFee('SC', { grossWeightLbs: 100_000 }).headlineUsd).toBe(0);
  });

  it('fires the physical route survey on HEIGHT, not weight — five states key it there', () => {
    // 13 ft 11 in to 14 ft 6 in across CT, DE, MD, NY and PA.
    expect(physicalRouteSurveyLine({ heightIn: 160, routeMiles: 500 })).toBeNull();
    const survey = physicalRouteSurveyLine({ heightIn: 174, routeMiles: 500 });
    expect(survey).not.toBeNull();
    expect(survey?.name).toMatch(/triggered by 14 ft 6 in of height/);
    // $1.90-$2.50 a mile on the published high-pole escort rate, one pass.
    expect(survey?.lowUsd).toBe(950);
    expect(survey?.highUsd).toBe(1250);
    expect(survey?.accuracy.bandPct).toBe(35);
    // CONDITIONAL: headline is likelihood-weighted at the midpoint, not the
    // 65th percentile, so a may-not-apply item does not inflate every quote.
    expect(survey?.headlineUsd).toBeCloseTo(
      ((survey?.lowUsd ?? 0) + (survey?.highUsd ?? 0)) / 2,
      2,
    );
    // A short local survey is billed below a full escort day: the floor binds.
    expect(physicalRouteSurveyLine({ heightIn: 174, routeMiles: 100 })?.lowUsd).toBe(350);
    // Superload width is the secondary trigger, with no height given.
    expect(physicalRouteSurveyLine({ widthIn: 200, routeMiles: 500 })).not.toBeNull();
  });

  it('surveys the miles that NEED a survey, not the whole lane', () => {
    // A permit binds the state that issued it and so does the survey it asks
    // for. Billing 1,484 miles because 80 of them are in New York would be the
    // same error as quoting a permit in a state the load never enters.
    const scoped = physicalRouteSurveyLine({
      heightIn: 14 * 12 + 6,
      routeMiles: 1_484,
      stateCodes: ['TX', 'AR', 'TN', 'KY', 'OH', 'PA', 'NY'],
      stateMiles: [
        { stateCode: 'TX', miles: 286 },
        { stateCode: 'AR', miles: 448 },
        { stateCode: 'TN', miles: 333 },
        { stateCode: 'KY', miles: 83 },
        { stateCode: 'OH', miles: 193 },
        { stateCode: 'PA', miles: 61 },
        { stateCode: 'NY', miles: 80 },
      ],
    });
    // 14 ft 6 in trips New York (13 ft 11 in) and NOT Pennsylvania, Maryland or
    // Delaware, whose threshold is 14 ft 6 in exactly. So 80 miles, not 1,484.
    expect(scoped?.name).toMatch(/^Physical route survey \(80 mi/);
    expect(scoped?.lowUsd).toBe(350); // the short-route floor binds
    expect(scoped?.accuracy.detail).toMatch(/rather than the whole 1,484-mile lane/);
    // With no per-state mileage the whole lane is the only figure there is.
    const unscoped = physicalRouteSurveyLine({
      heightIn: 14 * 12 + 6,
      routeMiles: 1_484,
      stateCodes: ['TX', 'NY'],
    });
    expect(unscoped?.lowUsd).toBe(2819.6);
  });

  it('REFUSES to band utility clearance, and warns instead', () => {
    expect(utilityClearanceRiskLine(160)).toBeNull();
    const util = utilityClearanceRiskLine(180);
    expect(util?.accuracy.tier).toBe('refused');
    expect(util?.headlineUsd).toBeNull();
    expect(util?.inTotal).toBe(false);
    // $90,000 on a 100-mile project and $200,000 on a 1,000-mile move, billed
    // unitemised. Averaging that into a ±35% survey line would be the single
    // most dangerous thing available in this model.
    expect(util?.accuracy.detail).toMatch(/\$90,000/);
    expect(util?.accuracy.detail).toMatch(/\$200,000/);
  });

  it('treats securement as an ALLOWANCE anchored at the bottom of its band', () => {
    // A CONDITIONAL component: the headline is the low end, not the 65th
    // percentile, because biasing a may-not-apply item upward would inflate
    // every quote on the site. It is also off by default in the composer,
    // because securement is normally inside the heavy-haul rate already priced.
    const sec = securementLine(45_000, 360);
    expect(sec.headlineUsd).toBe(sec.lowUsd);
    expect(sec.accuracy.tier).toBe('benchmark');
    expect(sec.accuracy.hover).toMatch(/ALLOWANCE, not a price/);
    // The band did NOT narrow, and that is now a result rather than a shrug:
    // four carrier tariffs and one binding government tariff price it at zero.
    expect(sec.accuracy.bandPct).toBe(60);
  });

  it('drives the securement allowance off CARGO WEIGHT via the federal chain count', () => {
    // 49 CFR 393.106(d) with 393.110, on 3/8in Grade 70 chain at a 6,600 lb WLL.
    expect(securementChainCount(20_000, 240)).toBe(4);
    expect(securementChainCount(45_000, 360)).toBe(7);
    expect(securementChainCount(80_000, 480)).toBe(13);
    expect(securementChainCount(120_000, 600)).toBe(19);
    // Above ~33,000 lb the WEIGHT rule always governs and the count is linear.
    expect(securementChainCount(120_000, 120)).toBe(19);
    // Below it, length governs.
    expect(securementChainCount(5_000, 480)).toBe(5);
    // And the allowance moves with the load instead of sitting flat.
    const light = securementLine(20_000, 240);
    const heavy = securementLine(120_000, 600);
    expect(light.lowUsd).toBe(100);
    expect(light.highUsd).toBe(240);
    expect(heavy.lowUsd).toBe(475);
    expect(heavy.highUsd).toBe(1140);
    // The gear value is NOT converted into a price, and the line says why.
    expect(heavy.accuracy.detail).toMatch(/QUANTITY OF GEAR, NOT A CHARGE/);
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
