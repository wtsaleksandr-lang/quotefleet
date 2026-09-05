/**
 * PHASE 10 SCHEMA — the mechanisms nine researched states need, proved against
 * fixtures rather than against encoded jurisdictions.
 *
 * EVERY FIXTURE HERE IS A TEST FIXTURE. The rules are real and are named in the
 * titles, but no jurisdiction data file is created or changed by this PR: it
 * adds capability and encodes no new state. Each test therefore proves one
 * thing — that the model CAN hold what the research found, and that holding it
 * changes nothing for a jurisdiction that declares none of it.
 */
import { describe, it, expect } from 'vitest';
import {
  applyFeeAbsorption,
  applyRounding,
  evaluateAxleSpacingTable,
  perMileAmountBreakdown,
  perMilePerAxleGroupAmount,
  roundedSpacingFt,
  combinedFeeRulesEqual,
  additionalAuthoritiesEqual,
  type AxleGroupCostFactor,
  type AxleSpacingWeightTable,
  type CombinedFeeRule,
  type PerMileRate,
  type PerMilePerAxleGroupRate,
} from './types.js';
import { resolveSourced, type SourceDoc, type Sourced } from './provenance.js';
import { evaluateEscortRules, ftIn, type EscortRule } from './escortRules.js';
import { calculateOsowForJurisdiction, type OsowLoad } from './engine.js';
import { OSOW_JURISDICTIONS } from './jurisdictions/index.js';

const AS_OF = '2026-09-05';

const doc = (id: string): SourceDoc => ({
  id,
  title: `${id} (test fixture)`,
  url: `https://example.gov/${id}`,
  publisher: 'Test',
  revisedOn: '2026-01-01',
  retrievedOn: AS_OF,
});

function row<T>(value: T, source: string, extra: Partial<Sourced<T>> = {}): Sourced<T> {
  return {
    value,
    source: doc(source),
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    ...extra,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MECHANISM 2 — A MAX / ABSORPTION COMBINATOR, FOR FEES AND FOR ESCORTS
// ═══════════════════════════════════════════════════════════════════════════

describe('fee absorption — Wisconsin § 348.25(8)(c) and (d)', () => {
  const wisconsin: CombinedFeeRule = {
    kind: 'absorption',
    absorption: [
      {
        absorber: 'width',
        absorbs: ['length'],
        quote: 'the fee for width or height absorbs the fee for length',
      },
      {
        absorber: 'overweight',
        absorbs: ['width', 'height', 'length'],
        quote: 'the weight fee absorbs every size fee',
      },
    ],
    explanation: 'Test fixture modelled on Wis. Stat. § 348.25(8)(c)-(d).',
  };

  it('THE WEIGHT FEE ABSORBS EVERY SIZE FEE — an engine that adds them overcharges', () => {
    expect(
      applyFeeAbsorption(['base', 'width', 'height', 'length', 'overweight'], wisconsin).sort(),
    ).toEqual(['base', 'overweight']);
  });

  it('a LEGAL-WEIGHT load still pays its width fee — an absent absorber absorbs nothing', () => {
    expect(applyFeeAbsorption(['base', 'width', 'length'], wisconsin).sort()).toEqual([
      'base',
      'width',
    ]);
  });

  it('applies the lattice TRANSITIVELY, so a reader need not chase the chain', () => {
    // The weight fee absorbs width, and width absorbs length. Length must go
    // even if the weight entry had not listed it.
    const partial: CombinedFeeRule = {
      kind: 'absorption',
      absorption: [
        { absorber: 'width', absorbs: ['length'], quote: 'q' },
        { absorber: 'overweight', absorbs: ['width'], quote: 'q' },
      ],
      explanation: 'test',
    };
    expect(applyFeeAbsorption(['width', 'length', 'overweight'], partial)).toEqual(['overweight']);
  });

  it('IS A NO-OP FOR EVERY OTHER KIND, which is every jurisdiction on file', () => {
    const cumulative: CombinedFeeRule = { kind: 'cumulative', explanation: 'Texas' };
    expect(applyFeeAbsorption(['base', 'oversize', 'overweight'], cumulative)).toEqual([
      'base',
      'oversize',
      'overweight',
    ]);
    expect(applyFeeAbsorption(['base', 'oversize'], null)).toEqual(['base', 'oversize']);
  });

  it('treats two DIFFERENT lattices as a real disagreement, not two wordings', () => {
    const other: CombinedFeeRule = {
      kind: 'absorption',
      absorption: [{ absorber: 'overweight', absorbs: ['width'], quote: 'q' }],
      explanation: 'different reading',
    };
    expect(combinedFeeRulesEqual(wisconsin, other)).toBe(false);
    expect(combinedFeeRulesEqual(wisconsin, { ...wisconsin, explanation: 'reworded' })).toBe(true);
  });
});

describe('escort counts — Utah’s "most stringent requirement" against the additive default', () => {
  const src = doc('escort-fixture');
  const rules: EscortRule[] = [
    {
      id: 'front-on-width',
      jurisdiction: 'ZZ',
      description: 'One front escort over 12 ft wide',
      when: { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
      then: { front: 1 },
      source: src,
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
    },
    {
      id: 'front-and-rear-on-length',
      jurisdiction: 'ZZ',
      description: 'Front and rear escorts over 110 ft long',
      when: { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
      then: { front: 1, rear: 1 },
      source: src,
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
    },
  ];
  const load = { widthIn: ftIn(14), overallLengthIn: ftIn(120) };

  it('THE DEFAULT IS UNCHANGED — max per position, then add', () => {
    const out = evaluateEscortRules(rules, load, AS_OF);
    expect(out.front).toBe(1);
    expect(out.rear).toBe(1);
    expect(out.totalEscorts).toBe(2);
  });

  it('MOST-STRINGENT TAKES THE SINGLE HEAVIEST RULE, and the two differ by a pilot car', () => {
    const out = evaluateEscortRules(rules, load, AS_OF, {
      combination: {
        kind: 'mostStringent',
        explanation: 'Test fixture modelled on Utah Admin. Code R909-2-14(1)(b).',
      },
    });
    expect(out.totalEscorts).toBe(2);
    // Only the heaviest rule's positions survive; the width rule's front car is
    // satisfied by the length rule's, not added to it.
    expect(out.front).toBe(1);
    expect(out.rear).toBe(1);
  });

  it('most-stringent does NOT sum two single-car rules into two cars', () => {
    const twoOnes: EscortRule[] = [
      { ...(rules[0] as EscortRule) },
      {
        ...(rules[1] as EscortRule),
        id: 'rear-on-length',
        then: { rear: 1 },
      },
    ];
    expect(evaluateEscortRules(twoOnes, load, AS_OF).totalEscorts).toBe(2);
    expect(
      evaluateEscortRules(twoOnes, load, AS_OF, {
        combination: { kind: 'mostStringent', explanation: 'test' },
      }).totalEscorts,
    ).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MECHANISM 5 — OUTCOMES THAT ARE NOT NUMBERS
// ═══════════════════════════════════════════════════════════════════════════

describe('an escort requirement that is real and is not a count', () => {
  const src = doc('wi-trans-254');

  const wisconsin: EscortRule = {
    id: 'wi-over-16-ft',
    jurisdiction: 'ZZ',
    description: 'Escorts over 16 ft wide',
    when: { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    then: {
      reviewRequired: {
        kind: 'countNotPublished',
        atLeast: 1,
        quote: 'All loads exceeding 16 feet in width shall have one or more properly equipped escorts',
      },
    },
    source: src,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
  };

  it('IS NEITHER A COUNT NOR `unknown` — the rule fired and the answer is not a number', () => {
    const out = evaluateEscortRules([wisconsin], { widthIn: ftIn(17) }, AS_OF);
    expect(out.applied).toHaveLength(1); // it FIRED
    expect(out.undecided).toHaveLength(0); // the condition RESOLVED
    expect(out.reviewRequired?.[0]?.kind).toBe('countNotPublished');
    expect(out.requiresManualReview).toBe(true);
  });

  it('BILLS THE PUBLISHED FLOOR — "one or more" costs at least one escort', () => {
    const out = evaluateEscortRules([wisconsin], { widthIn: ftIn(17) }, AS_OF);
    expect(out.totalEscorts).toBe(1);
    expect(out.warnings.join(' ')).toContain('one or more properly equipped escorts');
  });

  it('says nothing at all when the rule does not fire', () => {
    const out = evaluateEscortRules([wisconsin], { widthIn: ftIn(10) }, AS_OF);
    expect(out.reviewRequired).toBeUndefined();
    expect(out.requiresManualReview).toBe(false);
  });

  it('HOLDS A COUNT SET BY THE ROUTE — Kansas’s escort per side-road intersection', () => {
    const kansas: EscortRule = {
      ...wisconsin,
      id: 'ks-large-structure',
      description: 'Large structure: an escort at each side-road intersection',
      then: {
        reviewRequired: {
          kind: 'countDependsOnRoute',
          countDependsOn: 'the number of side-road intersections on the route',
          quote:
            'An escort vehicle shall be stationed at side road intersections during the movement of large structures',
        },
      },
    };
    const out = evaluateEscortRules([kansas], { widthIn: ftIn(17) }, AS_OF);
    // Unbounded and not derivable from any dimension — so no floor is invented.
    expect(out.totalEscorts).toBe(0);
    expect(out.requiresManualReview).toBe(true);
    expect(out.warnings.join(' ')).toContain('side-road intersections');
  });

  it('HOLDS "a front AND/OR rear escort" — the count is settled, the position is not', () => {
    const mississippi: EscortRule = {
      ...wisconsin,
      id: 'ms-front-and-or-rear',
      description: 'A front and/or rear escort',
      then: {
        reviewRequired: {
          kind: 'positionNotPublished',
          atLeast: 1,
          quote: 'a front and/or rear escort',
        },
      },
    };
    const out = evaluateEscortRules([mississippi], { widthIn: ftIn(17) }, AS_OF);
    expect(out.totalEscorts).toBe(1);
    expect(out.front).toBe(0);
    expect(out.rear).toBe(0);
    expect(out.warnings.join(' ')).toContain('in front or behind');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MECHANISM 6 — RICHER MEASUREMENT AND ROUNDING
// ═══════════════════════════════════════════════════════════════════════════

describe('Minnesota measures width twice in one sentence', () => {
  const src = doc('mn-169-812');
  const rules: EscortRule[] = [
    {
      id: 'mn-width-bottom',
      jurisdiction: 'ZZ',
      description: 'Escort over 15 ft at the bottom of the load',
      when: { kind: 'gt', measure: 'widthAtBottomIn', value: ftIn(15) },
      then: { escorts: 1 },
      source: src,
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
    },
    {
      id: 'mn-width-top',
      jurisdiction: 'ZZ',
      description: 'Escort over 16 ft at the top of the load',
      when: { kind: 'gt', measure: 'widthAtTopIn', value: ftIn(16) },
      then: { escorts: 1 },
      source: src,
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
    },
  ];

  it('CATCHES THE TANK A SINGLE `widthIn` MISSES — 14 ft at the deck, 17 ft at the shell', () => {
    const out = evaluateEscortRules(
      rules,
      { widthIn: ftIn(17), widthAtBottomIn: ftIn(14), widthAtTopIn: ftIn(17) },
      AS_OF,
    );
    expect(out.totalEscorts).toBe(1);
  });

  it('DOES NOT DERIVE EITHER FROM `widthIn` — an unstated profile is a review', () => {
    const out = evaluateEscortRules(rules, { widthIn: ftIn(17) }, AS_OF);
    expect(out.undecided).toHaveLength(2);
    expect(out.requiresManualReview).toBe(true);
    expect(out.warnings.join(' ')).toContain('width at the top of the load');
  });
});

describe('Utah applies three rounding directions to one fee', () => {
  // § 72-7-406(7)(b)(i): $.012 per mile for each 1,000 lb above 80,000, floored
  // at $80 and capped at $540. § 72-7-406(7)(c): miles UP to the nearest 50,
  // pounds UP to the nearest 25,000, dollars TO THE NEAREST $10.
  const base: PerMileRate = {
    minLbs: 80_001,
    maxLbs: null,
    ratePerMileUsd: 0.012,
    perIncrementLbs: 1_000,
    excessBaseLbs: 80_000,
    roundIncrementUp: true,
    minimumUsd: 80,
    maximumUsd: 540,
    roundMilesUpTo: 50,
    roundDollarsTo: {
      direction: 'nearest',
      toMultipleOf: 10,
      quote: 'rounded to the nearest $10',
    },
  };

  it('ROUNDS DOLLARS TO THE NEAREST TEN — which the old boolean shape could not say', () => {
    // 300 mi, 126,000 lb, excess rounded up to 50,000 → 50 increments.
    // 0.012 × 300 × 50 = $180.00 → nearest $10 → $180.00.
    const excessReading: PerMileRate = {
      ...base,
      roundPoundsTo: {
        direction: 'up',
        toMultipleOf: 25_000,
        appliesTo: 'excessOverBase',
        quote: 'rounded up to the nearest 25,000 pound increment',
      },
    };
    const out = perMileAmountBreakdown(excessReading, 126_000, 300);
    expect(out.billedPoundsBasis).toEqual({ rounded: 50_000, raw: 46_000, appliesTo: 'excessOverBase' });
    expect(out.units).toBe(50);
    expect(out.amountUsd).toBe(180);
  });

  it('HOLDS BOTH READINGS OF "the pounds", WHICH ARE $72 APART', () => {
    // The gross reading: 126,000 → 150,000 → excess 70,000 → 70 increments.
    // 0.012 × 300 × 70 = $252.00.
    const grossReading: PerMileRate = {
      ...base,
      roundPoundsTo: {
        direction: 'up',
        toMultipleOf: 25_000,
        appliesTo: 'gross',
        quote: 'rounded up to the nearest 25,000 pound increment',
      },
    };
    const out = perMileAmountBreakdown(grossReading, 126_000, 300);
    expect(out.billedPoundsBasis).toEqual({ rounded: 150_000, raw: 126_000, appliesTo: 'gross' });
    expect(out.amountUsd).toBe(250);
  });

  it('APPLIES THE FLOOR AND THE CAP AFTER THE ROUNDING, in the state’s order', () => {
    const short = perMileAmountBreakdown(base, 82_000, 10);
    // 10 mi bills as 50; 2,000 lb excess is 2 increments; 0.012 × 50 × 2 = $1.20
    // → nearest $10 → $0 → floored at the $80 minimum.
    expect(short.billedMiles).toBe(50);
    expect(short.amountUsd).toBe(80);
    const huge = perMileAmountBreakdown(base, 400_000, 900);
    expect(huge.amountUsd).toBe(540);
  });

  it('LEAVES EVERY EXISTING RATE UNTOUCHED — no rounding rule, no new fields', () => {
    const plain: PerMileRate = {
      minLbs: 80_001,
      maxLbs: null,
      ratePerMileUsd: 0.07,
      perIncrementLbs: null,
      excessBaseLbs: null,
      roundIncrementUp: true,
      minimumUsd: null,
      maximumUsd: null,
      roundDollars: 'nearest',
    };
    const out = perMileAmountBreakdown(plain, 100_000, 293);
    expect(out.amountUsd).toBe(21); // Washington's published reading, unchanged
    expect(out.billedPoundsBasis).toBeUndefined();
    expect(out.dollarRounding).toBeUndefined();
  });

  it('rounds in every direction to any step', () => {
    expect(applyRounding(180.4, { direction: 'nearest', toMultipleOf: 10, quote: 'q' })).toBe(180);
    expect(applyRounding(185, { direction: 'nearest', toMultipleOf: 10, quote: 'q' })).toBe(190);
    expect(applyRounding(180.01, { direction: 'up', toMultipleOf: 10, quote: 'q' })).toBe(190);
    expect(applyRounding(189.99, { direction: 'down', toMultipleOf: 10, quote: 'q' })).toBe(180);
    // Already on a step, and not pushed off it by floating-point dust.
    expect(applyRounding(0.012 * 300 * 50, { direction: 'up', toMultipleOf: 10, quote: 'q' })).toBe(180);
  });
});

describe('axle-spacing rounding with Minnesota’s anti-gaming carve-out', () => {
  const table: AxleSpacingWeightTable = {
    name: 'test spacing table',
    selector: { kind: 'grossWeightAbove', thresholdLbs: 0 },
    rows: [
      {
        label: '4 ft or more',
        minSpacingFt: 4,
        minInclusive: true,
        maxSpacingFt: null,
        maxInclusive: true,
        maxAxleLoadLbs: 20_000,
        conditionedOn: null,
      },
      {
        label: 'under 4 ft',
        minSpacingFt: null,
        minInclusive: true,
        maxSpacingFt: 4,
        maxInclusive: false,
        maxAxleLoadLbs: 13_000,
        conditionedOn: null,
      },
    ],
    maxAxles: null,
    tandemAllowance: null,
    spacingRounding: {
      direction: 'nearest',
      toMultipleOfFt: 1,
      carveOuts: [
        {
          fromFt: 3 + 4 / 12,
          toFt: 3.5,
          treatAsFt: 3,
          quote: 'a distance of 3 feet 4 inches to 3 feet 6 inches is taken as 3 feet',
        },
      ],
      quote: 'measured longitudinally to the nearest foot',
    },
    explanation: 'Test fixture modelled on Minn. Stat. § 169.824.',
  };

  it('THE CARVE-OUT WINS OVER THE GENERAL RULE — which is what makes it a carve-out', () => {
    // Nearest-foot alone would round 3'6" UP to 4 ft and buy 7,000 lb of axle.
    expect(roundedSpacingFt(3.5, table.spacingRounding)).toBe(3);
    expect(roundedSpacingFt(3 + 5 / 12, table.spacingRounding)).toBe(3);
  });

  it('rounds to the nearest foot outside the carved band', () => {
    expect(roundedSpacingFt(3.6, table.spacingRounding)).toBe(4);
    expect(roundedSpacingFt(4.4, table.spacingRounding)).toBe(4);
  });

  it('CHANGES THE ROW A REAL AXLE IS JUDGED BY, AND THE CARVE-OUT IS WHY', () => {
    // Two 15,000 lb axles 3 ft 6 in apart — exactly the band the statute names.
    const axles = [
      { positionFt: 0, weightLbs: 15_000 },
      { positionFt: 3.5, weightLbs: 15_000 },
    ];
    // With the carve-out: taken as 3 ft, so the 13,000 lb row governs and both
    // axles are over.
    expect(evaluateAxleSpacingTable(table, axles).violations).toHaveLength(2);

    // The SAME nearest-foot rule without the carve-out rounds 3'6\" UP to 4 ft
    // and clears both axles under the 20,000 lb row. That is the 2,000 lb per
    // axle the carve-out exists to stop a carrier buying by measurement.
    const generalRuleOnly: AxleSpacingWeightTable = {
      ...table,
      spacingRounding: {
        direction: 'nearest',
        toMultipleOfFt: 1,
        carveOuts: [],
        quote: 'measured longitudinally to the nearest foot',
      },
    };
    expect(evaluateAxleSpacingTable(generalRuleOnly, axles).violations).toHaveLength(0);
  });

  it('IS THE IDENTITY WHEN A TABLE DECLARES NONE, which is every table on file', () => {
    expect(roundedSpacingFt(8.96, undefined)).toBe(8.96);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A FEE THAT IS A FUNCTION OF THE AXLE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

describe('per-mile, per-overweight-axle-group — Minnesota § 169.86 subd. 5(e)', () => {
  const rate: PerMilePerAxleGroupRate = {
    name: 'overweight axle group cost factors (test fixture)',
    factors: [
      {
        label: 'single axle, 20,001–22,000 lb',
        axleCount: 1,
        minSpacingFt: null,
        maxSpacingFt: null,
        minLbs: 20_001,
        maxLbs: 22_000,
        costPerMileUsd: 0.14,
      },
      {
        label: 'tandem, 34,001–38,000 lb',
        axleCount: 2,
        minSpacingFt: 0,
        maxSpacingFt: 8,
        minLbs: 34_001,
        maxLbs: 38_000,
        costPerMileUsd: 0.21,
      },
    ],
    roundFactorToCents: true,
    minimumUsd: null,
    maximumUsd: null,
    explanation: 'Test fixture modelled on Minn. Stat. § 169.86 subd. 5(e).',
  };

  it('SUMS THE GROUP FACTORS AND MULTIPLIES BY THE DISTANCE', () => {
    const out = perMilePerAxleGroupAmount(
      rate,
      [
        { axleCount: 1, spanFt: 0, weightLbs: 21_000 },
        { axleCount: 2, spanFt: 4, weightLbs: 36_000 },
      ],
      200,
    );
    expect(out.sumPerMileUsd).toBeCloseTo(0.35, 6);
    expect(out.amountUsd).toBe(70);
  });

  it('PRICES TWO LOADS OF THE SAME GROSS DIFFERENTLY — which gross-weight banding cannot', () => {
    const spread = perMilePerAxleGroupAmount(
      rate,
      [
        { axleCount: 1, spanFt: 0, weightLbs: 21_000 },
        { axleCount: 1, spanFt: 0, weightLbs: 21_000 },
      ],
      200,
    );
    const tandem = perMilePerAxleGroupAmount(
      rate,
      [{ axleCount: 2, spanFt: 4, weightLbs: 42_000 }],
      200,
    );
    expect(spread.amountUsd).toBe(56);
    // Same 42,000 lb over the two axles, but the tandem row does not reach it.
    expect(tandem.amountUsd).toBeNull();
  });

  it('RETURNS null, NOT A PARTIAL SUM, WHEN A GROUP HAS NO ROW', () => {
    // Summing only the groups the chart covers would under-bill by exactly the
    // amount nobody noticed was missing.
    const out = perMilePerAxleGroupAmount(
      rate,
      [
        { axleCount: 1, spanFt: 0, weightLbs: 21_000 },
        { axleCount: 3, spanFt: 10, weightLbs: 50_000 },
      ],
      200,
    );
    expect(out.amountUsd).toBeNull();
    expect(out.unpricedGroups).toBe(1);
  });

  it('rounds each factor to the cent BEFORE summing, where the state says so', () => {
    const unrounded: PerMilePerAxleGroupRate = {
      ...rate,
      roundFactorToCents: false,
      factors: [{ ...(rate.factors[0] as AxleGroupCostFactor), costPerMileUsd: 0.1449 }],
    };
    const rounded: PerMilePerAxleGroupRate = { ...unrounded, roundFactorToCents: true };
    const groups = [{ axleCount: 1, spanFt: 0, weightLbs: 21_000 }];
    expect(perMilePerAxleGroupAmount(unrounded, groups, 1_000).amountUsd).toBe(144.9);
    expect(perMilePerAxleGroupAmount(rounded, groups, 1_000).amountUsd).toBe(140);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A SOURCED ROW CONFINED TO PART OF A JURISDICTION
// ═══════════════════════════════════════════════════════════════════════════

describe('`appliesWhen` — one source stating two numbers about two different moves', () => {
  // Kansas: 80,000 lb on the interstate system, the printed table off it.
  const interstate = row(80_000, 'ks-8-1909', {
    appliesWhen: { kind: 'routeClassIn', anyOf: ['interstate'] },
    note: 'interstate system only',
  });
  const offInterstate = row(95_000, 'ks-8-1909-table', {
    appliesWhen: { kind: 'routeClassIn', anyOf: ['two-lane', 'divided'] },
    note: 'the printed table, off the interstate',
  });
  const rows = [interstate, offInterstate];

  it('RESOLVES CLEANLY ONCE THE ROAD IS NAMED — this is not a source conflict', () => {
    const onI = resolveSourced('legal gross', rows, AS_OF, undefined, {
      move: { routeClass: 'interstate' },
    });
    expect(onI.value).toBe(80_000);
    expect(onI.conflict).toBe(false);
    expect(onI.requiresManualReview).toBe(false);

    const offI = resolveSourced('legal gross', rows, AS_OF, undefined, {
      move: { routeClass: 'two-lane' },
    });
    expect(offI.value).toBe(95_000);
  });

  it('WITHOUT THE ROAD, KEEPS BOTH ROWS AND ASKS FOR THE FACT THAT WOULD SETTLE IT', () => {
    const unknown = resolveSourced('legal gross', rows, AS_OF, undefined, { move: {} });
    expect(unknown.value).toBeNull();
    expect(unknown.conflict).toBe(true);
    expect(unknown.warnings.join(' ')).toContain('supplying that would decide between them');
    expect(unknown.conditionsUnresolved?.join(' ')).toContain('road class');
  });

  it('NEVER DROPS AN UNDECIDABLE ROW — that would answer from the decidable ones alone', () => {
    const noContext = resolveSourced('legal gross', rows, AS_OF);
    expect(noContext.candidates).toHaveLength(2);
    expect(noContext.value).toBeNull();
  });

  it('is silent when the undecided rows AGREE, because the answer did not depend on them', () => {
    const agreeing = [
      row(80_000, 'a', { appliesWhen: { kind: 'inDarkness' } }),
      row(80_000, 'b'),
    ];
    const out = resolveSourced('legal gross', agreeing, AS_OF, undefined, { move: {} });
    expect(out.value).toBe(80_000);
    expect(out.warnings).toEqual([]);
    expect(out.requiresManualReview).toBe(false);
    // Recorded, not warned about.
    expect(out.conditionsUnresolved).toBeDefined();
  });

  it('says every row was ruled out BY THE MOVE, not by the calendar', () => {
    const out = resolveSourced(
      'night-only ceiling',
      [row(144, 'nv', { appliesWhen: { kind: 'inDarkness' }, note: 'night only' })],
      AS_OF,
      undefined,
      { move: { darkness: false } },
    );
    expect(out.value).toBeNull();
    expect(out.warnings.join(' ')).toContain('conditions this move does not meet');
  });

  it('AN UNCONDITIONED ROW SET IS BYTE-IDENTICAL WITH AND WITHOUT A CONTEXT', () => {
    // This is the claim the 24 encoded jurisdictions rest on.
    const plain = [row(102, 'a'), row(102, 'b')];
    expect(JSON.stringify(resolveSourced('legal width', plain, AS_OF))).toBe(
      JSON.stringify(resolveSourced('legal width', plain, AS_OF, undefined, { move: { routeClass: 'two-lane' } })),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUB-JURISDICTIONS, ZERO-FEE PERMITS, ENVELOPES — THROUGH THE REAL ENGINE
// ═══════════════════════════════════════════════════════════════════════════

const TX = OSOW_JURISDICTIONS.TX;
if (TX === undefined) throw new Error('Texas fixture missing');

const OVERSIZE_LOAD: OsowLoad = {
  grossWeightLbs: 79_000,
  widthIn: ftIn(14),
  heightIn: ftIn(14),
  overallLengthIn: ftIn(80),
  trailerLengthIn: ftIn(53),
};

describe('engine wiring — each capability is inert until a jurisdiction declares it', () => {
  it('AN AUTHORITY THAT REPLACES THE STATE PERMIT IS NOT AN ADDITIONAL ONE', () => {
    // KTA: "Special permits from KDOT are not required to move oversized loads
    // on the Kansas Turnpike." Treating it as additional charges a fee that is
    // not owed AND applies the wrong escort rule.
    const withTurnpike = {
      ...TX,
      additionalAuthorities: [
        row(
          {
            name: 'Turnpike Authority',
            appliesWhen: 'On the Turnpike roadway.',
            priceable: true,
            replacesStatePermit: true,
            segmentIds: ['ZZ:turnpike'],
          },
          'kta',
        ),
      ],
    };
    // Route not resolved against the roadway: the engine says the fee MAY not
    // be owed and sends it to review, rather than quietly charging it.
    const unresolved = calculateOsowForJurisdiction(withTurnpike, OVERSIZE_LOAD, AS_OF);
    expect(unresolved.warnings.join(' ')).toContain('not by the state');
    expect(unresolved.requiresManualReview).toBe(true);

    // Named on the roadway: the state fee is stated as not owed, and the
    // Authority's own escort and travel-window rules are named as governing.
    const onIt = calculateOsowForJurisdiction(
      withTurnpike,
      { ...OVERSIZE_LOAD, routeSegments: ['ZZ:turnpike'] },
      AS_OF,
    );
    expect(onIt.warnings.join(' ')).toContain('issues its OWN permit in place of');
    expect(onIt.warnings.join(' ')).toContain('is not owed on that roadway');
  });

  it('distinguishes a replacing authority from an additional one in equality', () => {
    const additional = { name: 'A', appliesWhen: 'x', priceable: false };
    expect(
      additionalAuthoritiesEqual(additional, { ...additional, replacesStatePermit: true }),
    ).toBe(false);
  });

  it('A $0 PERMIT IS PRINTED AS A LINE, NOT SUPPRESSED AS AN ABSENCE', () => {
    const withFree = {
      ...TX,
      zeroFeePermits: [
        row(
          { name: 'government vehicle', quote: 'no fee shall be charged for a government vehicle' },
          'ks-free',
          { appliesWhen: { kind: 'vehicleConfiguration', property: 'governmentVehicle', is: true } },
        ),
      ],
    };
    const out = calculateOsowForJurisdiction(
      withFree,
      { ...OVERSIZE_LOAD, vehicleConfiguration: { governmentVehicle: true } },
      AS_OF,
    );
    const line = out.lines.find((l) => l.code === 'osow_permit_no_fee');
    expect(line?.amountUsd).toBe(0);
    expect(line?.note).toContain('A permit IS required');

    // A non-government vehicle does not get the line at all.
    const other = calculateOsowForJurisdiction(
      withFree,
      { ...OVERSIZE_LOAD, vehicleConfiguration: { governmentVehicle: false } },
      AS_OF,
    );
    expect(other.lines.some((l) => l.code === 'osow_permit_no_fee')).toBe(false);
  });

  it('A PERMIT ENVELOPE THAT MOVES WITH THE CLOCK — and absent time is never "day"', () => {
    const withEnvelope = {
      ...TX,
      permitEnvelopes: [
        row({ product: 'annual', widthIn: ftIn(14), quote: '14 feet by day' }, 'nv-night', {
          appliesWhen: { kind: 'inDarkness' },
        }),
      ],
    };
    // With darkness answered "no", the row is excluded and nothing is left.
    const byDay = calculateOsowForJurisdiction(
      withEnvelope,
      { ...OVERSIZE_LOAD, darkness: false },
      AS_OF,
    );
    expect(byDay.warnings.join(' ')).toContain('conditions this move does not meet');

    // With darkness unanswered the row stands and the envelope is applied.
    const unknownTime = calculateOsowForJurisdiction(
      withEnvelope,
      { ...OVERSIZE_LOAD, widthIn: ftIn(16) },
      AS_OF,
    );
    expect(unknownTime.warnings.join(' ')).toContain('will not issue its annual permit');
    expect(unknownTime.requiresManualReview).toBe(true);
  });

  it('A LIVE SEGMENT TABLE SENDS THE MOVE TO REVIEW NAMING THE TABLE', () => {
    const withTable = {
      ...TX,
      liveSegmentTables: [
        row(
          {
            name: 'Table 4',
            url: 'https://example.gov/table4',
            heldSegments: [],
            quote: 'provided by the Department',
            explanation: 'The authoritative table is served live and cannot be held.',
          },
          'az-table-4',
        ),
      ],
    };
    const out = calculateOsowForJurisdiction(withTable, OVERSIZE_LOAD, AS_OF);
    expect(out.warnings.join(' ')).toContain('Table 4');
    expect(out.warnings.join(' ')).toContain('served live');
    expect(out.requiresManualReview).toBe(true);
  });

  it('AN AFFIRMATIVE ABSENCE IS A NOTE, NOT A WARNING — nothing is wrong', () => {
    const withAbsence = {
      ...TX,
      publishedAbsences: [
        row(
          {
            subject: 'overhangEscortTrigger' as const,
            statement: 'No overhang limit is set, so no overhang escort trigger exists.',
            consequence: 'A quote must not port another state’s overhang escorts across the line.',
          },
          'ks-absence',
        ),
      ],
    };
    const out = calculateOsowForJurisdiction(withAbsence, OVERSIZE_LOAD, AS_OF);
    expect(out.dataQuality.join(' ')).toContain('publishes no overhang escort trigger');
    expect(out.warnings.join(' ')).not.toContain('publishes no overhang escort trigger');
    // A recorded negative must never stop a quote.
    expect(out.requiresManualReview).toBe(false);
  });

  it('A PER-COMPONENT DISTANCE CHARGE OVERRIDES THE JURISDICTION-WIDE BOOLEAN', () => {
    // Iowa: flat for a general single trip, per-mile for a building hauler.
    const iowaish = {
      ...TX,
      feesDependOnDistance: false,
      feeDistanceDependence: [
        row(
          {
            component: 'building-hauler registration',
            dependsOnDistance: true,
            appliesWhen: {
              kind: 'vehicleConfiguration' as const,
              property: 'transportingBuilding' as const,
              is: true,
            },
            quote: 'five cents per ton per mile',
          },
          'ia-321e-12',
        ),
      ],
    };
    const ordinary = calculateOsowForJurisdiction(
      iowaish,
      { ...OVERSIZE_LOAD, vehicleConfiguration: { transportingBuilding: false } },
      AS_OF,
    );
    expect(ordinary.warnings.join(' ')).not.toContain('five cents per ton per mile');

    const building = calculateOsowForJurisdiction(
      iowaish,
      { ...OVERSIZE_LOAD, vehicleConfiguration: { transportingBuilding: true } },
      AS_OF,
    );
    expect(building.warnings.join(' ')).toContain('five cents per ton per mile');
    expect(building.requiresManualReview).toBe(true);

    // And a quote that has not said which it is gets asked, not defaulted.
    const unstated = calculateOsowForJurisdiction(iowaish, OVERSIZE_LOAD, AS_OF);
    expect(unstated.warnings.join(' ')).toContain('has not said whether that charge applies');
  });
});

describe('THE 24 ENCODED JURISDICTIONS ARE UNCHANGED', () => {
  it('declares none of the Phase 10 fields, so every one takes the untouched path', () => {
    for (const [code, rules] of Object.entries(OSOW_JURISDICTIONS)) {
      if (rules === undefined) continue;
      const declared = [
        rules.routeVocabulary,
        rules.routeSegments,
        rules.liveSegmentTables,
        rules.travelWindows,
        rules.permitEnvelopes,
        rules.escortCountCombination,
        rules.overweightPerMilePerAxleGroup,
        rules.feeDistanceDependence,
        rules.zeroFeePermits,
        rules.publishedAbsences,
      ].filter((f) => f !== undefined);
      expect(declared, `${code} declares a Phase 10 field`).toHaveLength(0);
    }
  });

  it('carries no conditioned sourced row anywhere, so no resolution is filtered', () => {
    const conditioned: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      const rec = node as Record<string, unknown>;
      if ('appliesWhen' in rec && 'effectiveFrom' in rec) conditioned.push(path);
      for (const [k, v] of Object.entries(rec)) walk(v, `${path}.${k}`);
    };
    for (const [code, rules] of Object.entries(OSOW_JURISDICTIONS)) walk(rules, code);
    expect(conditioned).toEqual([]);
  });
});
