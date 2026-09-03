import { describe, it, expect } from 'vitest';
import {
  IMMATERIAL_CONFLICT_THRESHOLD_USD,
  aggregateExceedsThreshold,
  absorbedTotalUsd,
  priceSourced,
} from './materiality.js';
import {
  calculateOsow,
  calculateOsowForJurisdiction,
  type OsowLoad,
} from './engine.js';
import { OSOW_JURISDICTIONS, osowRulesFor } from './jurisdictions/index.js';
import { resolveSourced, type SourceDoc, type Sourced } from './provenance.js';
import { ftIn } from './escortRules.js';
import type {
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  PerMileRate,
  TransactionFee,
} from './types.js';
import { LOUISIANA_CLASS_II_OCEAN_CONTAINER_FEE_USD } from './jurisdictions/louisiana.js';

/**
 * The materiality threshold, from both ends.
 *
 * Two kinds of evidence live here. The REAL-STATE tests are the deliverable —
 * Louisiana's $8-vs-$10, Pennsylvania's $35-vs-$46 and New York's $40-vs-$60 are
 * disagreements that exist in the shipped datasets, and they are the quotes that
 * stopped needing a human. The SYNTHETIC ones exist because the eighteen states
 * on file happen not to contain an over-threshold fee conflict, a per-mile fee
 * conflict, or two absorbed conflicts in one state, and a threshold nobody has
 * seen refuse anything is not a threshold. Each fixture below says which it is.
 */

const ASOF = '2026-09-03';

// ── Synthetic fixture plumbing ────────────────────────────────────────────

function doc(id: string, revisedOn: string | null = '2026-01-01'): SourceDoc {
  return {
    id,
    title: `Testland source ${id}`,
    url: `https://dot.testland.example/${id}`,
    publisher: 'Testland DOT',
    revisedOn,
    retrievedOn: '2026-01-01',
  };
}

const DOC_A = doc('zz-a', '2026-01-01');
const DOC_B = doc('zz-b', '2025-01-01');
const DOC_C = doc('zz-c', '2024-01-01');

function src<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const INCLUDED: Sourced<OverweightPricing>[] = [
  src<OverweightPricing>(
    { kind: 'includedInBaseFee', explanation: 'Testland folds weight into the base fee.' },
    DOC_A,
  ),
];

/** A minimal, deliberately boring jurisdiction. Only the overrides are on test. */
function testland(overrides: Partial<JurisdictionOsowRules> = {}): JurisdictionOsowRules {
  return {
    code: 'ZZ',
    name: 'Testland',
    country: 'US',
    legalLimits: {
      widthIn: [src(102, DOC_A)],
      heightIn: [src(ftIn(13, 6), DOC_A)],
      trailerLengthIn: [src(ftIn(53), DOC_A)],
      grossWeightLbs: [src(80000, DOC_A)],
      singleAxleLbs: [src(20000, DOC_A)],
      tandemAxleLbs: [src(34000, DOC_A)],
    },
    permitBaseFeeUsd: [src(20, DOC_A)],
    overweightPricing: INCLUDED,
    overweightBands: [],
    overweightPerMile: [],
    conditionalFees: [],
    transactionFee: [],
    routeAnalysisFeeUsd: [],
    noBridgeRouteFeeUsd: [],
    superload: { shortSpacing: [] },
    routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
    escortRules: [],
    feesDependOnDistance: false,
    ...overrides,
  };
}

/** Over on width, nothing else — the simplest load that owes a permit. */
const OVERSIZE_LOAD: OsowLoad = {
  widthIn: ftIn(12),
  heightIn: ftIn(13),
  overallLengthIn: ftIn(70),
  trailerLengthIn: ftIn(48),
  grossWeightLbs: 70000,
};

function priceZZ(rules: JurisdictionOsowRules, load: OsowLoad = OVERSIZE_LOAD) {
  return calculateOsowForJurisdiction(rules, load, ASOF);
}

// ── The constant ──────────────────────────────────────────────────────────

describe('the threshold itself', () => {
  it('is Alex’s $50, exported by name so it can be retuned without touching logic', () => {
    expect(IMMATERIAL_CONFLICT_THRESHOLD_USD).toBe(50);
    expect(aggregateExceedsThreshold(50)).toBe(false);
    expect(aggregateExceedsThreshold(50.01)).toBe(true);
    expect(absorbedTotalUsd([])).toBe(0);
  });
});

// ── Both directions, on a flat fee ────────────────────────────────────────

describe('a flat fee conflict, from both sides of the line', () => {
  const withBaseFees = (a: number, b: number) =>
    testland({ permitBaseFeeUsd: [src(a, DOC_A), src(b, DOC_B)] });

  it('under the threshold: prices at the HIGHER figure, with no review flag', () => {
    const r = priceZZ(withBaseFees(100, 145));
    const line = r.lines.find((l) => l.code === 'osow_permit_base');
    expect(line?.amountUsd).toBe(145);
    expect(line?.lowUsd).toBeUndefined();
    expect(line?.highUsd).toBeUndefined();
    expect(r.subtotalUsd).toBe(145);
    expect(r.requiresManualReview).toBe(false);
    expect(r.warnings.join(' ')).not.toContain('Official sources disagree');
    expect(r.absorbedConflictTotalUsd).toBe(45);
  });

  it('over the threshold: still nulls the line, still shows the range, still reviews', () => {
    const r = priceZZ(withBaseFees(100, 155));
    const line = r.lines.find((l) => l.code === 'osow_permit_base');
    expect(line?.amountUsd).toBeNull();
    expect(line?.lowUsd).toBe(100);
    expect(line?.highUsd).toBe(155);
    expect(r.subtotalUsd).toBeNull();
    expect(r.subtotalLowUsd).toBe(100);
    expect(r.subtotalHighUsd).toBe(155);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('Official sources disagree');
    expect(r.absorbedConflicts).toEqual([]);
  });

  it('takes the boundary itself as immaterial, and one cent past it as material', () => {
    expect(priceZZ(withBaseFees(100, 150)).requiresManualReview).toBe(false);
    expect(priceZZ(withBaseFees(100, 150)).subtotalUsd).toBe(150);
    expect(priceZZ(withBaseFees(100, 150.01)).requiresManualReview).toBe(true);
    expect(priceZZ(withBaseFees(100, 150.01)).subtotalUsd).toBeNull();
  });

  it('with three or more candidates takes the max, and calls the spread max − min', () => {
    const r = priceZZ(
      testland({
        permitBaseFeeUsd: [src(100, DOC_A), src(120, DOC_B), src(135, DOC_C)],
      }),
    );
    expect(r.subtotalUsd).toBe(135);
    expect(r.requiresManualReview).toBe(false);
    const absorbed = r.absorbedConflicts[0];
    expect(absorbed?.adoptedUsd).toBe(135);
    expect(absorbed?.lowUsd).toBe(100);
    expect(absorbed?.highUsd).toBe(135);
    expect(absorbed?.spreadUsd).toBe(35);
    expect(absorbed?.candidates).toHaveLength(3);
    // The ADOPTED ROW is the one whose amount is the max — not merely the max
    // amount reported beside whichever row the resolver ranked first. Everything
    // the line says about itself is read off that row.
    const chosen = priceSourced(
      resolveSourced('ZZ base', [src(100, DOC_A), src(120, DOC_B), src(135, DOC_C)], ASOF),
      (v) => v,
      { absorb: true },
    );
    expect(chosen.value).toBe(135);
    expect(chosen.chosen?.source.id).toBe('zz-c');
    // Three candidates whose extremes are 50 apart still absorb; 51 does not,
    // and the middle candidate never decides it either way.
    expect(
      priceZZ(testland({ permitBaseFeeUsd: [src(100, DOC_A), src(120, DOC_B), src(151, DOC_C)] }))
        .requiresManualReview,
    ).toBe(true);
  });
});

// ── The deferral: the same rate conflict at two distances ─────────────────

describe('a PER-MILE rate conflict resolves differently on a short and a long move', () => {
  /**
   * SYNTHETIC, and it is the load-bearing test in this file. Virginia charges
   * $0.30 a mile; the disagreement here is 1.2 cents on that rate — the sort of
   * discrepancy that is invisible in the source document. Comparing the
   * PUBLISHED numbers would call it immaterial everywhere, or material
   * everywhere, and both answers are wrong: the money it moves is a function of
   * the move. So the rate is priced for THIS load first and adjudicated second.
   */
  const rate = (perMile: number, source: SourceDoc): Sourced<PerMileRate> =>
    src<PerMileRate>(
      {
        minLbs: 80001,
        maxLbs: null,
        ratePerMileUsd: perMile,
        perIncrementLbs: null,
        excessBaseLbs: null,
        roundIncrementUp: false,
        minimumUsd: null,
        maximumUsd: null,
      },
      source,
    );

  const disputedRate = testland({
    permitBaseFeeUsd: [src(0, DOC_A)],
    overweightPricing: [
      src<OverweightPricing>(
        { kind: 'perMile', explanation: 'Testland charges by the mile inside the state.' },
        DOC_A,
      ),
    ],
    overweightPerMile: [rate(0.3, DOC_A), rate(0.312, DOC_B)],
    feesDependOnDistance: true,
  });

  const heavyAt = (miles: number) =>
    priceZZ(disputedRate, {
      widthIn: 102,
      heightIn: ftIn(13),
      overallLengthIn: ftIn(70),
      trailerLengthIn: ftIn(48),
      grossWeightLbs: 100000,
      milesInJurisdiction: miles,
    });

  it('is $12 apart over 1,000 miles — absorbed, priced at the higher rate', () => {
    const short = heavyAt(1000);
    const line = short.lines.find((l) => l.code === 'osow_overweight');
    expect(line?.amountUsd).toBe(312);
    expect(line?.lowUsd).toBeUndefined();
    // The arithmetic printed on the line is the ADOPTED rate's, so a dispatcher
    // can check $312 against $0.312 × 1,000 rather than against the rate we did
    // not use.
    expect(line?.note).toContain('$0.312 per mile');
    expect(short.subtotalUsd).toBe(312);
    expect(short.requiresManualReview).toBe(false);
    expect(short.absorbedConflicts[0]?.spreadUsd).toBe(12);
  });

  it('is $60 apart over 5,000 miles — escalated, unpriced, sent to review', () => {
    const long = heavyAt(5000);
    const line = long.lines.find((l) => l.code === 'osow_overweight');
    expect(line?.amountUsd).toBeNull();
    expect(line?.lowUsd).toBe(1500);
    expect(line?.highUsd).toBe(1560);
    expect(long.subtotalUsd).toBeNull();
    expect(long.requiresManualReview).toBe(true);
    expect(long.absorbedConflicts).toEqual([]);
  });

  it('flips at the distance where the disagreement reaches $50, not at a rate', () => {
    // 1.2¢ × 4,166 mi = $49.99 · × 4,167 mi = $50.00 · × 4,168 mi = $50.02.
    expect(heavyAt(4166).requiresManualReview).toBe(false);
    expect(heavyAt(4167).requiresManualReview).toBe(false);
    expect(heavyAt(4168).requiresManualReview).toBe(true);
    // The RATES never changed — only the load did. That is the deferral.
    expect(disputedRate.overweightPerMile.map((r) => r.value.ratePerMileUsd)).toEqual([
      0.3, 0.312,
    ]);
  });
});

// ── Rule 4: an absent candidate is not a zero ─────────────────────────────

describe('a candidate that cannot be priced is never read as $0', () => {
  it('refuses to absorb when one side of the disagreement has no amount', () => {
    const resolution = resolveSourced('ZZ fee', [src(10, DOC_A), src(12, DOC_B)], ASOF);
    const priced = priceSourced(
      resolution,
      (v) => (v === 10 ? null : v),
      { absorb: true },
    );
    // $2 apart on the face of it, and still refused: taking $12 would mean
    // treating "this source does not price this load" as agreement.
    expect(priced.absorbed).toBeNull();
    expect(priced.amountUsd).toBeNull();
    expect(priced.requiresManualReview).toBe(true);
    expect(priced.dataQuality.join(' ')).toContain('cannot be priced');
  });

  it('leaves Washington’s 999-pound band failing loudly, where NO source states a fee', () => {
    const wa = osowRulesFor('WA') as JurisdictionOsowRules;
    const r = calculateOsowForJurisdiction(
      wa,
      {
        widthIn: 102,
        heightIn: ftIn(13),
        overallLengthIn: ftIn(70),
        trailerLengthIn: ftIn(48),
        routeClass: 'divided',
        grossWeightLbs: 179500,
        milesInJurisdiction: 100,
      },
      ASOF,
    );
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('defines no fee whatever');
    // Nothing was absorbed: there is no higher figure, only an absence.
    expect(r.absorbedConflicts).toEqual([]);
    expect(r.absorbedConflictTotalUsd).toBe(0);
    // A pound either side is unambiguous and still prices, unchanged.
    const below = calculateOsowForJurisdiction(
      wa,
      {
        widthIn: 102, heightIn: ftIn(13), overallLengthIn: ftIn(70),
        trailerLengthIn: ftIn(48), routeClass: 'divided',
        grossWeightLbs: 179000, milesInJurisdiction: 100,
      },
      ASOF,
    );
    expect(below.subtotalUsd).toBe(387);
  });
});

// ── Rule 1: requirements are never settled by money ───────────────────────

describe('requirement conflicts are never auto-resolved, at any dollar value', () => {
  const legalSize = {
    widthIn: 102,
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  it('a legal-limit conflict switches absorption off even for a $2 fee', () => {
    const conflicted = testland({
      // The two documents disagree about the legal WIDTH: 102 in against 96 in.
      legalLimits: {
        ...testland().legalLimits,
        widthIn: [src(102, DOC_A), src(96, DOC_B)],
      },
      // …and, separately, about a $2 permit fee that would otherwise absorb.
      permitBaseFeeUsd: [src(20, DOC_A), src(22, DOC_B)],
    });
    // Over on HEIGHT, so a permit is genuinely owed whatever the width rule says.
    const r = priceZZ(conflicted, { ...legalSize, heightIn: ftIn(14), grossWeightLbs: 70000 });
    expect(r.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd).toBeNull();
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.absorbedConflicts).toEqual([]);
    // …and with the legal-limit quarrel removed, the same $2 absorbs.
    const clean = priceZZ(
      testland({ permitBaseFeeUsd: [src(20, DOC_A), src(22, DOC_B)] }),
      { ...legalSize, heightIn: ftIn(14), grossWeightLbs: 70000 },
    );
    expect(clean.subtotalUsd).toBe(22);
    expect(clean.requiresManualReview).toBe(false);
  });

  it('North Carolina’s 14 ft vs 13 ft 6 in height still refuses to price the disputed band', () => {
    const nc = osowRulesFor('NC') as JurisdictionOsowRules;
    const r = calculateOsowForJurisdiction(
      nc,
      { ...legalSize, widthIn: ftIn(11), heightIn: ftIn(13, 9), grossWeightLbs: 90000 },
      ASOF,
    );
    const os = r.lines.find((l) => l.code === 'osow_oversize');
    // $12 apart — comfortably inside the threshold, and deliberately not taken:
    // what is in dispute is whether the load is over height at all.
    expect(os?.amountUsd).toBeNull();
    expect(os?.lowUsd).toBe(12);
    expect(os?.highUsd).toBe(24);
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.absorbedConflicts).toEqual([]);
  });

  it('Colorado’s 80,000-vs-85,000 gross-weight quarrel still reviews inside the band', () => {
    const co = osowRulesFor('CO') as JurisdictionOsowRules;
    const r = calculateOsowForJurisdiction(
      co,
      { ...legalSize, grossWeightLbs: 82000, axleCount: 5 },
      ASOF,
    );
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain(
      'co-interstate-gross-80000-to-85000-conflict',
    );
    expect(r.requiresManualReview).toBe(true);
    expect(r.absorbedConflicts).toEqual([]);
  });

  /**
   * The brief named Georgia for the exactly-12-ft escort boundary; in the data
   * on file it is ALABAMA — ALDOT's presentation reads ">12' – 14'" and the
   * administrative code reads "Loads 12 – 14 feet", and one pilot car turns on
   * the difference. Georgia's own escort conflicts sit elsewhere (the two-lane
   * width band, the height-sensor threshold, the megaload boundary), so both
   * states are asserted here rather than swapping one for the other.
   */
  it('escort trigger boundaries still review — Alabama at exactly 12 ft', () => {
    const al = osowRulesFor('AL') as JurisdictionOsowRules;
    const at12 = calculateOsowForJurisdiction(
      al,
      { ...legalSize, widthIn: ftIn(12), grossWeightLbs: 70000, milesInJurisdiction: 150 },
      ASOF,
    );
    expect(at12.escorts.applied.map((a) => a.ruleId)).toContain(
      'al-escort-width-boundary-conflict',
    );
    expect(at12.requiresManualReview).toBe(true);
    expect(at12.absorbedConflicts).toEqual([]);
  });

  it('escort trigger boundaries still review — Georgia’s two-lane width band', () => {
    const ga = osowRulesFor('GA') as JurisdictionOsowRules;
    const twoLane = calculateOsowForJurisdiction(
      ga,
      { ...legalSize, widthIn: ftIn(13), routeClass: 'two-lane', grossWeightLbs: 70000 },
      ASOF,
    );
    expect(twoLane.escorts.applied.map((a) => a.ruleId)).toContain(
      'ga-width-two-lane-over-12-to-14-8',
    );
    expect(twoLane.requiresManualReview).toBe(true);
    expect(twoLane.absorbedConflicts).toEqual([]);
  });

  it('escort trigger boundaries still review — North Carolina front-and-rear at 150 ft', () => {
    const nc = osowRulesFor('NC') as JurisdictionOsowRules;
    const at150 = calculateOsowForJurisdiction(
      nc,
      { ...legalSize, widthIn: ftIn(11), overallLengthIn: ftIn(150), grossWeightLbs: 70000 },
      ASOF,
    );
    expect(at150.escorts.applied.map((a) => a.ruleId)).toContain(
      'nc-length-exactly-150-conflict',
    );
    expect(at150.requiresManualReview).toBe(true);
    expect(at150.absorbedConflicts).toEqual([]);
  });

  it('a superload still emits no price at all, and absorbs nothing', () => {
    const tx = osowRulesFor('TX') as JurisdictionOsowRules;
    const r = calculateOsowForJurisdiction(
      tx,
      { ...legalSize, widthIn: ftIn(12), grossWeightLbs: 300000, axleSpacingFt: 60 },
      ASOF,
    );
    expect(r.superload).toBe(true);
    expect(r.lines).toEqual([]);
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.absorbedConflicts).toEqual([]);
  });

  it('a route-survey requirement still reaches the customer channel', () => {
    // Florida's structural-evaluation trigger at 300,000 lb gross: a route
    // survey and an engineering review, with no published fee to weigh it
    // against. Nothing here is a number, so nothing here can be absorbed.
    const fl = osowRulesFor('FL') as JurisdictionOsowRules;
    const r = calculateOsowForJurisdiction(
      fl,
      {
        ...legalSize,
        widthIn: ftIn(12),
        grossWeightLbs: 300000,
        axleCount: 12,
        milesInJurisdiction: 100,
      },
      ASOF,
    );
    expect(r.escorts.routeSurvey).toBe(true);
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain(
      'fl-structural-evaluation-trigger',
    );
    expect(r.requiresManualReview).toBe(true);
    expect(r.subtotalUsd).toBeNull();
    expect(r.absorbedConflicts).toEqual([]);
  });
});

// ── The aggregate cap ─────────────────────────────────────────────────────

describe('the aggregate cap', () => {
  it('fires inside one jurisdiction when two small absorptions add up past $50', () => {
    const twoConflicts = testland({
      permitBaseFeeUsd: [src(100, DOC_A), src(140, DOC_B)],
      oversizeFeeBands: [
        src<OversizeFeeBand>({ label: 'wide, source A', feeUsd: 20 }, DOC_A),
        src<OversizeFeeBand>({ label: 'wide, source B', feeUsd: 45 }, DOC_B),
      ],
    });
    const r = priceZZ(twoConflicts);
    // Each conflict passed on its own: $40 and $25.
    expect(r.absorbedConflicts.map((a) => a.spreadUsd)).toEqual([40, 25]);
    expect(r.absorbedConflictTotalUsd).toBe(65);
    // The PRICES stand — they are the higher reading of each source, and
    // nothing about them became less true. What changes is that a human looks.
    expect(r.subtotalUsd).toBe(185);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('over the $50.00 materiality threshold');
    // …and one dollar less in total does not fire it.
    const under = priceZZ(
      testland({
        permitBaseFeeUsd: [src(100, DOC_A), src(140, DOC_B)],
        oversizeFeeBands: [
          src<OversizeFeeBand>({ label: 'wide, source A', feeUsd: 20 }, DOC_A),
          src<OversizeFeeBand>({ label: 'wide, source B', feeUsd: 30 }, DOC_B),
        ],
      }),
    );
    expect(under.absorbedConflictTotalUsd).toBe(50);
    expect(under.requiresManualReview).toBe(false);
  });

  it('fires across a LANE when no single state crosses the line on its own', () => {
    // Two states each absorbing $40: immaterial apiece, $80 on the quote.
    const registry = OSOW_JURISDICTIONS as Record<string, JurisdictionOsowRules>;
    const forty = (code: string, name: string): JurisdictionOsowRules =>
      testland({
        code,
        name,
        permitBaseFeeUsd: [src(100, DOC_A), src(140, DOC_B)],
      });
    try {
      registry.ZZ = forty('ZZ', 'Testland');
      registry.ZY = forty('ZY', 'Othertestland');
      const quote = calculateOsow(['ZZ', 'ZY'], OVERSIZE_LOAD, ASOF);
      // Each jurisdiction is individually clean and individually priced.
      for (const j of quote.jurisdictions) {
        expect(j.absorbedConflictTotalUsd, j.jurisdiction).toBe(40);
        expect(j.requiresManualReview, j.jurisdiction).toBe(false);
        expect(j.subtotalUsd, j.jurisdiction).toBe(140);
      }
      // The quote is not.
      expect(quote.absorbedConflictTotalUsd).toBe(80);
      expect(quote.totalPermitUsd).toBe(280);
      expect(quote.requiresManualReview).toBe(true);
      expect(quote.warnings.join(' ')).toContain('this lane');
      expect(quote.absorbedConflicts).toHaveLength(2);
      expect(quote.dataQuality).toHaveLength(2);
    } finally {
      delete registry.ZZ;
      delete registry.ZY;
    }
  });

  it('says it once, not twice, when a single state already crossed the line', () => {
    const registry = OSOW_JURISDICTIONS as Record<string, JurisdictionOsowRules>;
    try {
      registry.ZZ = testland({ permitBaseFeeUsd: [src(100, DOC_A), src(145, DOC_B)] });
      registry.ZY = testland({
        code: 'ZY',
        name: 'Othertestland',
        permitBaseFeeUsd: [src(100, DOC_A), src(140, DOC_B)],
        oversizeFeeBands: [
          src<OversizeFeeBand>({ label: 'a', feeUsd: 20 }, DOC_A),
          src<OversizeFeeBand>({ label: 'b', feeUsd: 45 }, DOC_B),
        ],
      });
      const quote = calculateOsow(['ZZ', 'ZY'], OVERSIZE_LOAD, ASOF);
      expect(quote.requiresManualReview).toBe(true);
      const capWarnings = quote.warnings.filter((w) =>
        w.includes('materiality threshold'),
      );
      // One from Othertestland's own cap; none added at lane level on top.
      expect(capWarnings).toHaveLength(1);
      expect(capWarnings[0]).toContain('Othertestland');
    } finally {
      delete registry.ZZ;
      delete registry.ZY;
    }
  });
});

// ── Where the delta is measured, relative to a percentage surcharge ───────

describe('the absorbed delta is measured BEFORE any percentage surcharge', () => {
  it('records the line’s own $45, not the $47.25 the card fee turns it into', () => {
    const carded = testland({
      permitBaseFeeUsd: [src(100, DOC_A), src(145, DOC_B)],
      transactionFee: [
        src<TransactionFee>({ perPermitUsd: 0, percentOfTotal: 5 }, DOC_A),
      ],
    });
    const r = priceZZ(carded);
    expect(r.absorbedConflicts[0]?.spreadUsd).toBe(45);
    expect(r.requiresManualReview).toBe(false);
    // The surcharge is levied on the adopted figure, as it must be: 5% of $145.
    expect(r.lines.find((l) => l.code === 'osow_service_fee')?.amountUsd).toBe(7.25);
    expect(r.subtotalUsd).toBe(152.25);
    // Had the delta been measured after the card fee it would read $47.25 —
    // still inside the threshold here, and a different basis in every state
    // that charges no percentage at all. One basis, stated: before.
    expect(r.absorbedConflictTotalUsd).toBe(45);
  });

  it('measures a conflict about the SURCHARGE ITSELF on the dollars it produces', () => {
    const disputedCard = testland({
      permitBaseFeeUsd: [src(20000, DOC_A)],
      transactionFee: [
        src<TransactionFee>({ perPermitUsd: 0, percentOfTotal: 2.25 }, DOC_A),
        src<TransactionFee>({ perPermitUsd: 0, percentOfTotal: 2.3 }, DOC_B),
      ],
    });
    // 0.05% of a $20,000 permit is $10 — computed on the finished subtotal,
    // which is the only place a percentage can be costed at all.
    const big = priceZZ(disputedCard);
    expect(big.absorbedConflicts[0]?.spreadUsd).toBe(10);
    expect(big.lines.find((l) => l.code === 'osow_service_fee')?.amountUsd).toBe(460);
    expect(big.requiresManualReview).toBe(false);
    // The same percentage quarrel on a $60 permit is three cents.
    const small = priceZZ(
      testland({
        permitBaseFeeUsd: [src(60, DOC_A)],
        transactionFee: disputedCard.transactionFee,
      }),
    );
    expect(small.absorbedConflicts[0]?.spreadUsd).toBe(0.03);
  });
});

// ── The date mechanism is upstream, and is not re-handled here ────────────

describe('effective dating still decides supersession on its own', () => {
  it('a date-superseded pair is one candidate, so nothing is absorbed', () => {
    // Louisiana's Acts 2019 No. 301 raised the Class II container fee to $375
    // from 2020-01-01; the administrative $500 starts only at our retrieval.
    const midway = resolveSourced(
      'LA Class II ocean container fee',
      LOUISIANA_CLASS_II_OCEAN_CONTAINER_FEE_USD,
      '2021-06-01',
    );
    expect(midway.conflict).toBe(false);
    const priced = priceSourced(midway, (v) => v, { absorb: true });
    expect(priced.absorbed).toBeNull();
    expect(priced.value).toBe(375);
    expect(priced.amountUsd).toBe(375);
    expect(priced.requiresManualReview).toBe(false);
    // And where BOTH are in effect, the $125 gap is over the threshold and the
    // conflict stands — the dates and the threshold do not fight over it.
    const today = resolveSourced(
      'LA Class II ocean container fee',
      LOUISIANA_CLASS_II_OCEAN_CONTAINER_FEE_USD,
      ASOF,
    );
    expect(today.conflict).toBe(true);
    const pricedToday = priceSourced(today, (v) => v, { absorb: true });
    expect(pricedToday.absorbed).toBeNull();
    expect(pricedToday.lowUsd).toBe(375);
    expect(pricedToday.highUsd).toBe(500);
    expect(pricedToday.requiresManualReview).toBe(true);
  });

  it('a field with nothing in effect is a GAP, and a gap is never absorbed', () => {
    const empty = resolveSourced<number>('ZZ nothing', [], ASOF);
    const priced = priceSourced(empty, (v) => v, { absorb: true });
    expect(priced.conflict).toBe(false);
    expect(priced.absorbed).toBeNull();
    expect(priced.amountUsd).toBeNull();
    expect(priced.requiresManualReview).toBe(true);
  });
});

// ── The states that changed ───────────────────────────────────────────────

describe('the eighteen-state sweep — quotes that now price where they used to review', () => {
  const legalSize = {
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
    grossWeightLbs: 70000,
    // Pennsylvania and Louisiana both price on in-state miles, and the engine
    // rightly refuses either without them — that refusal is unrelated to the
    // fee disagreement being tested and would mask it.
    milesInJurisdiction: 150,
  };

  it('Pennsylvania quotes §1942’s $35/$71 at PennDOT’s CPI-adjusted $46/$97', () => {
    const pa = osowRulesFor('PA') as JurisdictionOsowRules;
    const narrow = calculateOsowForJurisdiction(pa, { ...legalSize, widthIn: ftIn(12) }, ASOF);
    const narrowLine = narrow.lines.find((l) => l.code === 'osow_oversize');
    expect(narrowLine?.amountUsd).toBe(46);
    // The quote's own caption names the schedule the amount came from.
    expect(narrowLine?.note).toBe('under 14 ft wide — PennDOT current schedule');
    expect(narrow.subtotalUsd).toBe(47);
    expect(narrow.requiresManualReview).toBe(false);
    expect(narrow.absorbedConflicts[0]?.spreadUsd).toBe(11);

    const wide = calculateOsowForJurisdiction(pa, { ...legalSize, widthIn: ftIn(15) }, ASOF);
    const wideLine = wide.lines.find((l) => l.code === 'osow_oversize');
    expect(wideLine?.amountUsd).toBe(97);
    expect(wideLine?.note).toBe('over 14 ft wide — PennDOT current schedule');
    expect(wide.requiresManualReview).toBe(false);
    expect(wide.absorbedConflicts[0]?.spreadUsd).toBe(26);
  });

  it('New York quotes the $40/$60 base at $60 — and still reviews for the Thruway', () => {
    const ny = osowRulesFor('NY') as JurisdictionOsowRules;
    const r = calculateOsowForJurisdiction(ny, { ...legalSize, widthIn: ftIn(12) }, ASOF);
    expect(r.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd).toBe(60);
    expect(r.subtotalUsd).toBe(60);
    expect(r.absorbedConflicts[0]?.spreadUsd).toBe(20);
    // The fee stopped being a reason for review. The three OTHER permit
    // issuers inside New York are still a hole in the quote, and still are one.
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('not a single-issuer state');
    expect(r.warnings.join(' ')).not.toContain('Official sources disagree');
  });

  it('Louisiana prices an oversize-only move that used to have no number at all', () => {
    const la = osowRulesFor('LA') as JurisdictionOsowRules;
    const r = calculateOsowForJurisdiction(
      la,
      { ...legalSize, widthIn: ftIn(13), milesInJurisdiction: 100 },
      ASOF,
    );
    expect(r.subtotalUsd).toBe(10);
    expect(r.requiresManualReview).toBe(false);
  });

  it('leaves the other fifteen states’ absorption behaviour untouched', () => {
    // Nothing else in the shipped datasets holds an in-effect FEE disagreement,
    // so nothing else absorbs anything. If a future dataset adds one, this fails
    // and the state has to be looked at rather than silently changing.
    const load: OsowLoad = {
      widthIn: ftIn(12),
      heightIn: ftIn(13),
      overallLengthIn: ftIn(70),
      trailerLengthIn: ftIn(48),
      kingpinToRearAxleIn: ftIn(40),
      routeClass: 'divided',
      grossWeightLbs: 100000,
      axleCount: 6,
      milesInJurisdiction: 150,
    };
    const absorbing = Object.entries(OSOW_JURISDICTIONS)
      .filter(
        ([, rules]) =>
          calculateOsowForJurisdiction(rules, load, ASOF).absorbedConflicts.length > 0,
      )
      .map(([code]) => code)
      .sort();
    expect(absorbing).toEqual(['LA', 'NY', 'PA']);
  });
});

// ── The data-quality channel ──────────────────────────────────────────────

describe('the internal data-quality channel', () => {
  it('carries every absorbed conflict with candidates, documents and dollars', () => {
    const r = priceZZ(testland({ permitBaseFeeUsd: [src(100, DOC_A), src(140, DOC_B)] }));
    expect(r.dataQuality).toHaveLength(1);
    const note = r.dataQuality[0] as string;
    expect(note).toContain('ZZ single-trip permit base fee');
    expect(note).toContain('$40.00');
    expect(note).toContain('$100.00');
    expect(note).toContain('$140.00');
    expect(note).toContain('dot.testland.example/zz-a');
    expect(note).toContain('dot.testland.example/zz-b');
    // …and the customer channel says nothing about it.
    expect(r.warnings.join(' ')).not.toContain('materiality');
    expect(r.warnings.join(' ')).not.toContain('disagree');
  });

  it('is empty on a quote with nothing to absorb', () => {
    const tx = osowRulesFor('TX') as JurisdictionOsowRules;
    const r = calculateOsowForJurisdiction(
      tx,
      {
        widthIn: ftIn(12),
        heightIn: ftIn(13),
        overallLengthIn: ftIn(70),
        trailerLengthIn: ftIn(48),
        grossWeightLbs: 100000,
      },
      ASOF,
    );
    expect(r.dataQuality).toEqual([]);
    expect(r.absorbedConflicts).toEqual([]);
    expect(r.requiresManualReview).toBe(false);
  });
});
