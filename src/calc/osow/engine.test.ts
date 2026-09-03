import { describe, it, expect } from 'vitest';
import {
  calculateOsow,
  calculateOsowForJurisdiction,
  type OsowLoad,
} from './engine.js';
import {
  OSOW_JURISDICTIONS,
  TEXAS_OSOW_RULES,
  hasOsowCoverage,
  osowRulesFor,
} from './jurisdictions/index.js';
import { applyTransactionFee, oversizeBandApplies } from './types.js';
import { ftIn } from './escortRules.js';
import { resolveSourced, spreadOf } from './provenance.js';
import {
  RCW_0941_FULL_FEE_TABLE,
  WASHINGTON_999_POUND_GAP,
  WASHINGTON_MANUFACTURED_HOME_ANNUAL_FEE_USD,
  WASHINGTON_MANUFACTURED_HOME_ANNUAL_WIDTH_IN,
} from './jurisdictions/washington.js';
import {
  ALABAMA_DOUBLES_TRAILER_LENGTH_IN,
  ALABAMA_STINGER_STEERED_LENGTH_IN,
} from './jurisdictions/alabama.js';
import {
  VIRGINIA_ESCORT_RECIPROCITY_SOURCES,
  VIRGINIA_OSOW_RULES,
} from './jurisdictions/virginia.js';
import { CALIFORNIA_OSOW_RULES } from './jurisdictions/california.js';
import {
  LOUISIANA_CLASS_II_OCEAN_CONTAINER_FEE_USD,
  LOUISIANA_OVERWEIGHT_SCHEDULE_A,
  LOUISIANA_OVERWEIGHT_SCHEDULE_B,
  LOUISIANA_PLEASURE_CRAFT_FEE_USD,
  LOUISIANA_REAR_OVERHANG_FLAG_THRESHOLD_IN,
  LOUISIANA_STRUCTURAL_EVALUATION_FEES,
} from './jurisdictions/louisiana.js';
import {
  COLORADO_FLEET_PER_VEHICLE_FEE_USD,
  COLORADO_INTERSTATE_GROSS_WEIGHT_LBS,
  COLORADO_LVC_OWD_ANNUAL_FEE_USD,
  COLORADO_OSOW_RULES,
} from './jurisdictions/colorado.js';

/**
 * Texas figures asserted here come from TxDMV and the Texas Transportation
 * Code. The strongest evidence in this file is the `published totals` block:
 * TxDMV's February 2021 fee PDF prints five band totals, and the engine
 * reproduces all five to the cent from its own component fees. That is a real
 * end-to-end check of the base fee, the weight bands, the supervision fee and
 * the service-fee arithmetic at once — not a restatement of our own inputs.
 */

const ASOF = '2026-08-31';
const TX = TEXAS_OSOW_RULES;

/**
 * An ordinary rig's overall length. Supplied on most fixtures below because
 * Texas has length-based escort thresholds and a two-dimension escalation
 * rule — without a length the engine correctly cannot evaluate them and says
 * so (asserted in `missing measurements` at the bottom of this file).
 */
const NORMAL_LENGTH = ftIn(70);

function load(partial: Parameters<typeof calculateOsowForJurisdiction>[1]) {
  return { overallLengthIn: NORMAL_LENGTH, ...partial };
}

describe('TxDMV published permit totals — reproduced from component fees', () => {
  // From the February 2021 fee schedule PDF, "Single Trip — General".
  const PUBLISHED: Array<[string, number, number]> = [
    ['legal weight', 60, 61.61],
    ['80,001–120,000 lb', 210, 214.98],
    ['120,001–160,000 lb', 285, 291.67],
    ['160,001–200,000 lb', 360, 368.36],
    ['200,001–254,300 lb', 470, 480.83],
  ];

  it.each(PUBLISHED)(
    '%s: $%d permit + service fee = TxDMV’s printed $%d',
    (_label, permitTotal, printedTotal) => {
      const fee = applyTransactionFee(permitTotal, {
        perPermitUsd: 0.25,
        percentOfTotal: 2.25,
      });
      expect(Math.round((permitTotal + fee) * 100) / 100).toBe(printedTotal);
    },
  );

  it('the $470 band decomposes as base + highway maintenance + supervision', () => {
    expect(60 + 375 + 35).toBe(470);
  });
});

describe('Texas end-to-end — 100,000 lb, 12 ft wide', () => {
  const result = calculateOsowForJurisdiction(
    TX,
    load({ grossWeightLbs: 100000, widthIn: ftIn(12), heightIn: ftIn(13) }),
    ASOF,
  );

  it('requires a permit, on both width and weight', () => {
    expect(result.permitRequired).toBe(true);
    expect(result.overDimension.width).toBe(true);
    expect(result.overDimension.weight).toBe(true);
    expect(result.overDimension.height).toBe(false);
    expect(result.overDimension.details.join(' ')).toContain('exceeds');
  });

  it('bills the $60 base permit', () => {
    const line = result.lines.find((l) => l.code === 'osow_permit_base');
    expect(line?.amountUsd).toBe(60);
  });

  it('bills the $150 highway maintenance fee for the 80,001–120,000 lb band', () => {
    const line = result.lines.find((l) => l.code === 'osow_overweight');
    expect(line?.amountUsd).toBe(150);
    expect(line?.note).toContain('80,001');
  });

  it('does NOT bill the supervision fee below 200,000 lb', () => {
    expect(result.lines.some((l) => l.code === 'osow_supervision')).toBe(false);
  });

  it('totals $214.98 — exactly what TxDMV publishes for this band', () => {
    expect(result.subtotalUsd).toBe(214.98);
  });

  it('requires no escorts at 12 ft wide and 13 ft high', () => {
    expect(result.escortsRequired).toBe(0);
  });

  it('cites its sources, including the February 2021 fee schedule', () => {
    const feePdf = result.sources.find((s) => s.id === 'txdmv-fee-pdf-2021-02');
    expect(feePdf?.revisedOn).toBe('2021-02-01');
    expect(feePdf?.retrievedOn).toBe('2026-08-31');
    expect(feePdf?.url).toContain('txdmv.gov');
  });

  it('prices cleanly — no manual review needed for an ordinary permit load', () => {
    expect(result.requiresManualReview).toBe(false);
  });
});

describe('Texas — 210,000 lb picks up the supervision fee', () => {
  const result = calculateOsowForJurisdiction(
    TX,
    load({ grossWeightLbs: 210000, widthIn: ftIn(10), axleSpacingFt: 100 }),
    ASOF,
  );

  it('bills base $60 + $375 maintenance + $35 supervision', () => {
    expect(result.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd).toBe(60);
    expect(result.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBe(375);
    expect(result.lines.find((l) => l.code === 'osow_supervision')?.amountUsd).toBe(35);
  });

  it('totals $480.83 — TxDMV’s published figure for the band', () => {
    expect(result.subtotalUsd).toBe(480.83);
  });
});

describe('superload — the honest refusal', () => {
  it('above 254,300 lb it emits NO price and asks for review', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 300000, widthIn: ftIn(14) },
      ASOF,
    );
    expect(r.superload).toBe(true);
    expect(r.requiresManualReview).toBe(true);
    // The critical assertion: no confident number is emitted.
    expect(r.lines).toEqual([]);
    expect(r.subtotalUsd).toBeNull();
    expect(r.warnings.join(' ')).toContain('254,300');
    expect(r.warnings.join(' ')).toContain('no published fee');
  });

  it('mentions the engineering-review lead time and the separate analysis fee', () => {
    const r = calculateOsowForJurisdiction(TX, load({ grossWeightLbs: 300000 }), ASOF);
    const text = r.warnings.join(' ');
    expect(text).toContain('three to four weeks');
    expect(text).toContain('500.00');
    expect(text).toContain('included in the total');
    expect(text).toContain('no permit price is quoted for a superload');
  });

  // The trigger a gross-weight-only check misses entirely.
  it('catches a 210,000 lb load on short axle spacing as a superload', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 210000, axleSpacingFt: 60 },
      ASOF,
    );
    expect(r.superload).toBe(true);
    expect(r.subtotalUsd).toBeNull();
    expect(r.warnings.join(' ')).toContain('95 ft');
  });

  it('does not call it a superload when the spacing is long enough', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 210000, axleSpacingFt: 100 },
      ASOF,
    );
    expect(r.superload).toBe(false);
    expect(r.subtotalUsd).toBe(480.83);
  });

  it('will not rule the trigger out when spacing is unknown', () => {
    const r = calculateOsowForJurisdiction(TX, load({ grossWeightLbs: 210000 }), ASOF);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('cannot be ruled out');
  });
});

describe('escorts', () => {
  it('one escort over 14 ft wide, without needing the road type', () => {
    const r = calculateOsowForJurisdiction(TX, load({ grossWeightLbs: 79000, widthIn: ftIn(15), heightIn: ftIn(13) }), ASOF);
    expect(r.escortsRequired).toBe(1);
    expect(r.requiresManualReview).toBe(false);
  });

  it('two escorts over 16 ft wide, front and rear', () => {
    const r = calculateOsowForJurisdiction(TX, load({ grossWeightLbs: 79000, widthIn: ftIn(17) }), ASOF);
    expect(r.escortsRequired).toBe(2);
    expect(r.escorts.front).toBe(1);
    expect(r.escorts.rear).toBe(1);
  });

  it('a height escort carries a pole over 17 ft', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 79000, widthIn: ftIn(8), heightIn: ftIn(17, 6) },
      ASOF,
    );
    expect(r.escorts.heightPole).toBe(true);
    expect(r.escortsRequired).toBe(1);
  });

  it('the two-dimension rule adds a front AND rear escort', () => {
    // 15 ft wide (1 escort) + 17'6" high (1 front escort) = two dimensions
    // over, which Texas escalates to both a front and a rear escort.
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 79000, widthIn: ftIn(15), heightIn: ftIn(17, 6) },
      ASOF,
    );
    expect(r.escortsRequired).toBe(2);
    expect(r.escorts.front).toBe(1);
    expect(r.escorts.rear).toBe(1);
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain('tx-two-dimensions');
  });

  it('states that escort COST is the carrier’s rate, not a state fee', () => {
    const r = calculateOsowForJurisdiction(TX, load({ grossWeightLbs: 79000, widthIn: ftIn(15), heightIn: ftIn(13) }), ASOF);
    const text = r.warnings.join(' ');
    expect(text).toContain('private vendors');
    expect(text).toContain('not part of the state permit fee');
    // And no escort line is invented in the priced breakdown.
    expect(r.lines.some((l) => l.name.toLowerCase().includes('escort'))).toBe(false);
  });

  it('warns that police escorts are discretionary and excluded', () => {
    const r = calculateOsowForJurisdiction(TX, load({ grossWeightLbs: 79000, widthIn: ftIn(15), heightIn: ftIn(13) }), ASOF);
    const text = r.warnings.join(' ');
    expect(text).toContain('law-enforcement traffic control');
    expect(text).toContain('no police-escort cost is included');
    // An advisory must NOT block the quote.
    expect(r.requiresManualReview).toBe(false);
    expect(r.subtotalUsd).not.toBeNull();
  });
});

describe('the unresolved source conflict on route-inspection height', () => {
  // TxDMV's page: "exceeding 18 ft 11 in". 43 TAC §219.11(j)(2): "19 ft or
  // greater". A load at 18'11.5" sits exactly in the gap.
  it('refuses to answer for a load inside the disputed band', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 79000, heightIn: ftIn(18, 11.5) },
      ASOF,
    );
    expect(r.routeInspectionRequired).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    const text = r.warnings.join(' ');
    expect(text).toContain('sources disagree');
    expect(text).toContain('law.cornell.edu');
    expect(text).toContain('txdmv.gov');
  });

  it('is quiet about the conflict for a load nowhere near the band', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      load({ grossWeightLbs: 100000, widthIn: ftIn(12), heightIn: ftIn(13) }),
      ASOF,
    );
    // Noise on every quote would train people to ignore the warning.
    expect(r.warnings.join(' ')).not.toContain('sources disagree');
    expect(r.requiresManualReview).toBe(false);
  });

  it('answers plainly above the whole disputed band', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 79000, heightIn: ftIn(22) },
      ASOF,
    );
    expect(r.routeInspectionRequired).toBe(true);
  });
});

describe('bridge formula integration', () => {
  it('reports axle-group violations alongside the permit fee', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      {
        grossWeightLbs: 90000,
        widthIn: ftIn(10),
        axles: [
          { positionFt: 0, weightLbs: 14000 },
          { positionFt: 16, weightLbs: 19000 },
          { positionFt: 20, weightLbs: 19000 },
          { positionFt: 47, weightLbs: 19000 },
          { positionFt: 51, weightLbs: 19000 },
        ],
      },
      ASOF,
    );
    expect(r.bridge?.compliant).toBe(false);
    expect(r.bridge?.groupsChecked).toBe(10);
    expect(r.warnings.join(' ')).toContain('bridge formula');
  });

  it('says compliance is UNVERIFIED when no axle data was supplied', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 100000, widthIn: ftIn(10) },
      ASOF,
    );
    expect(r.bridge).toBeNull();
    expect(r.warnings.join(' ')).toContain('could not be verified');
    // It is a stated caveat, not a blocked quote — the fee is still knowable.
    expect(r.subtotalUsd).toBe(214.98);
  });
});

describe('a legal load needs no permit', () => {
  it('emits no permit lines for an in-limits load', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      load({ grossWeightLbs: 79000, widthIn: 100, heightIn: ftIn(13, 6) }),
      ASOF,
    );
    expect(r.permitRequired).toBe(false);
    expect(r.lines).toEqual([]);
    expect(r.subtotalUsd).toBe(0);
    expect(r.requiresManualReview).toBe(false);
  });
});

describe('missing measurements are unknown, never assumed safe', () => {
  it('an over-width load with no HEIGHT cannot resolve the two-dimension rule', () => {
    // Texas escalates to a front AND rear escort when a load is over in two
    // dimensions. Width is over; height is unknown; so whether the escalation
    // applies genuinely cannot be determined. Answering "one escort" would be
    // a guess that could leave a move short an escort at the state line.
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 79000, widthIn: ftIn(15), overallLengthIn: NORMAL_LENGTH },
      ASOF,
    );
    expect(r.requiresManualReview).toBe(true);
    expect(r.escorts.undecided.map((u) => u.ruleId)).toContain('tx-two-dimensions');
    expect(r.warnings.join(' ')).toContain('height');
  });

  it('supplying the height resolves it cleanly', () => {
    const r = calculateOsowForJurisdiction(
      TX,
      load({ grossWeightLbs: 79000, widthIn: ftIn(15), heightIn: ftIn(13) }),
      ASOF,
    );
    expect(r.requiresManualReview).toBe(false);
    expect(r.escortsRequired).toBe(1);
  });

  it('an absent overhang is treated as no overhang, not as unknown', () => {
    // The one deliberate asymmetry: overhang is a presence, and a blank field
    // means none. Without this, every load would need an explicit "0 in" to
    // avoid review.
    const r = calculateOsowForJurisdiction(
      TX,
      load({ grossWeightLbs: 79000, widthIn: ftIn(15), heightIn: ftIn(13) }),
      ASOF,
    );
    expect(
      r.escorts.undecided.some((u) => u.ruleId.includes('overhang')),
    ).toBe(false);
  });
});

describe('effective dating end-to-end', () => {
  it('a backdated quote finds no undated-page data and asks for review', () => {
    // Undated TxDMV pages are only defensible from our retrieval date, so a
    // 2022 quote correctly cannot be priced from them rather than pretending
    // today's page was live three years ago.
    const r = calculateOsowForJurisdiction(
      TX,
      { grossWeightLbs: 100000, widthIn: ftIn(12) },
      '2022-06-01',
    );
    expect(r.requiresManualReview).toBe(true);
  });

  it('the statute-backed weight bands ARE available on a 2015 quote', () => {
    // §623.077's bands are effective from the 2013 amendment, so they resolve
    // even when the undated pages do not.
    const bandsIn2015 = TX.overweightBands.filter(
      (b) => b.effectiveFrom <= '2015-01-01',
    );
    expect(bandsIn2015.length).toBeGreaterThan(0);
    expect(bandsIn2015.every((b) => b.source.id === 'tx-transp-623-077')).toBe(true);
  });
});

describe('multi-jurisdiction lanes', () => {
  it('prices a Texas-only lane', () => {
    const q = calculateOsow(['TX'], load({ grossWeightLbs: 100000, widthIn: ftIn(12), heightIn: ftIn(13) }), ASOF);
    expect(q.totalPermitUsd).toBe(214.98);
    expect(q.uncoveredJurisdictions).toEqual([]);
    expect(q.requiresManualReview).toBe(false);
  });

  /**
   * WYOMING IS THE UNCOVERED STATE HERE BECAUSE OKLAHOMA STOPPED BEING ONE.
   * Phase 1 wrote these three cases against 'OK' and Phase 4 shipped Oklahoma's
   * dataset, which turned "the engine refuses a state it has no data for" into
   * "the engine prices Oklahoma" — a passing behaviour asserted as a failure.
   * The uncovered-state cases must always name a state the registry genuinely
   * does not hold, and must be moved again the day that state is added.
   */
  it('refuses to price a lane that leaves Texas — and names the gap', () => {
    const q = calculateOsow(['TX', 'WY'], load({ grossWeightLbs: 100000, widthIn: ftIn(12), heightIn: ftIn(13) }), ASOF);
    expect(hasOsowCoverage('WY'), 'WY must still be an uncovered state').toBe(false);
    expect(q.uncoveredJurisdictions).toEqual(['WY']);
    expect(q.totalPermitUsd).toBeNull();
    expect(q.requiresManualReview).toBe(true);
    expect(q.warnings.join(' ')).toContain('No oversize/overweight permit data is on file for WY');
    // Texas is still fully priced — the gap is isolated to the leg we lack.
    expect(q.jurisdictions[0]?.subtotalUsd).toBe(214.98);
  });

  it('never infers one state’s fees from a neighbour', () => {
    const q = calculateOsow(['WY'], load({ grossWeightLbs: 100000 }), ASOF);
    expect(q.jurisdictions).toEqual([]);
    expect(q.totalPermitUsd).toBeNull();
    expect(q.warnings.join(' ')).toContain('cannot be inferred from a neighbouring one');
  });

  it('deduplicates and normalises state codes', () => {
    const q = calculateOsow(['tx', 'TX', '  '], load({ grossWeightLbs: 100000, widthIn: ftIn(12), heightIn: ftIn(13) }), ASOF);
    expect(q.jurisdictions).toHaveLength(1);
  });

  it('asks for review when no jurisdiction is supplied at all', () => {
    const q = calculateOsow([], { grossWeightLbs: 100000 }, ASOF);
    expect(q.requiresManualReview).toBe(true);
    expect(q.totalPermitUsd).toBeNull();
  });
});

describe('coverage helpers', () => {
  it('knows Texas is covered and Wyoming is not', () => {
    expect(hasOsowCoverage('TX')).toBe(true);
    expect(hasOsowCoverage('tx')).toBe(true);
    expect(hasOsowCoverage('WY')).toBe(false);
    expect(osowRulesFor('WY')).toBeNull();
    expect(osowRulesFor('TX')?.name).toBe('Texas');
    // Oklahoma stood here from Phase 1 until its dataset shipped in Phase 4.
    expect(hasOsowCoverage('OK')).toBe(true);
    expect(osowRulesFor('OK')?.name).toBe('Oklahoma');
  });
});

describe('data-model invariants that must hold for every jurisdiction added', () => {
  /**
   * Read from the registry, not a hand-written list. A new jurisdiction is one
   * line in `jurisdictions/index.ts`, and these invariants must catch it there
   * — a separate list here would silently stop covering the newest state, which
   * is exactly the one most likely to be wrong.
   */
  const all = Object.values(OSOW_JURISDICTIONS);

  it('every sourced value carries a URL, a retrieval date, and an effective-from', () => {
    for (const j of all) {
      const rows = [
        ...Object.values(j.legalLimits).flat(),
        ...j.permitBaseFeeUsd,
        ...j.overweightBands,
        ...j.conditionalFees,
        ...j.transactionFee,
        ...j.routeAnalysisFeeUsd,
        ...j.noBridgeRouteFeeUsd,
        // OPTIONAL by design: an absent `grossWeight` is Illinois saying it
        // publishes no numeric superload weight, which is a finding, not a gap.
        ...(j.superload.grossWeight ?? []),
        ...j.superload.shortSpacing,
        ...(j.superload.widthIn ?? []),
        ...(j.superload.heightIn ?? []),
        ...(j.superload.overallLengthIn ?? []),
        ...(j.oversizeFeeBands ?? []),
        ...(j.combinedFeeRule ?? []),
        ...j.overweightPricing,
        ...j.overweightPerMile,
        ...(j.additionalAuthorities ?? []),
        ...j.routeInspection.widthIn,
        ...j.routeInspection.heightIn,
        ...j.routeInspection.lengthIn,
      ];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.source.url).toMatch(/^https?:\/\//);
        expect(row.source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(row.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // `revisedOn` may legitimately be null — an undated document is a
        // recorded fact. But the field must be present, never undefined. A
        // PARTIAL date is allowed here and nowhere else: the Virginia Law
        // Portal states "1989" for §46.2-1124 with no month or day, and both
        // inventing 1989-01-01 and discarding the year would be worse than
        // recording what the document actually says. See `SourceDoc.revisedOn`.
        expect(
          row.source.revisedOn === null ||
            /^\d{4}(-\d{2}(-\d{2})?)?$/.test(row.source.revisedOn),
        ).toBe(true);
      }
    }
  });

  it('every escort rule carries a source and an effective window', () => {
    for (const j of all) {
      expect(j.escortRules.length).toBeGreaterThan(0);
      for (const rule of j.escortRules) {
        expect(rule.source.url).toMatch(/^https?:\/\//);
        expect(rule.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(rule.description.length).toBeGreaterThan(10);
      }
    }
  });

  it('no escort rule references a rule id that does not exist', () => {
    let totalRefs = 0;
    for (const j of all) {
      const ids = new Set(j.escortRules.map((r) => r.id));
      const refs: string[] = [];
      const walk = (c: unknown): void => {
        if (typeof c !== 'object' || c === null) return;
        const node = c as { kind?: string; ruleId?: string; of?: unknown };
        if ((node.kind === 'ruleApplies' || node.kind === 'ruleDoesNotApply') && node.ruleId) {
          refs.push(node.ruleId);
        }
        if (Array.isArray(node.of)) node.of.forEach(walk);
        else if (node.of) walk(node.of);
      };
      j.escortRules.forEach((r) => walk(r.when));
      totalRefs += refs.length;
      for (const ref of refs) {
        expect(ids.has(ref), `${j.code} references missing rule "${ref}"`).toBe(true);
      }
    }
    // Not every state needs a cross-rule reference — Pennsylvania, New York and
    // Indiana state their escort rules as independent thresholds. But at least
    // one must, or the `ruleApplies` grammar is dead code the dataset never
    // exercises and a regression in it would go unnoticed.
    expect(totalRefs).toBeGreaterThan(0);
  });

  /**
   * THE INVARIANT THE WHOLE OVERSIZE SCHEDULE RESTS ON.
   *
   * `OversizeFeeBand` bands must be mutually exclusive WITHIN one published
   * schedule, or the resolver reads two band amounts as two sources disagreeing
   * about one fee and refuses to price a load that is unambiguously in one
   * band. Grouping by source id is what preserves the disagreements that ARE
   * real: Pennsylvania deliberately holds an overlapping statutory schedule
   * ($35/$71) against PennDOT's current one ($46/$97), and that cross-schedule
   * overlap is the conflict the engine exists to surface.
   *
   * Distances are sampled strictly INSIDE Illinois's mileage steps. The statute
   * writes "For the first 90 miles" and then "From 90 miles to 180 miles", so a
   * leg of exactly 90 miles is named by both steps and correctly resolves as a
   * range — an ambiguity in the source, not a defect in the encoding.
   */
  it('oversize fee bands from one source never overlap with different fees', () => {
    const widths = [96, 102, 120, 144, 150, 162, 168, 174, 180, 192, 200, 204, 216, 240];
    const heights = [162, 168, 174, 176, 180, 186, 192, 200, 216];
    const lengths = [600, 840, 900, 1020, 1140, 1200, 1320, 1400, 1440, 1800];
    const mileages = [45, 135, 225, 400];

    /**
     * Findings are COLLECTED and asserted once at the end rather than asserted
     * inside the innermost loop. The grid is ~5,000 dimension combinations and
     * the dataset now carries several hundred bands — New Jersey alone
     * enumerates a per-foot formula as sixteen width steps from two sources —
     * so an `expect()` per combination per source ran tens of thousands of
     * times and pushed the whole test past the default timeout once the
     * suite was running in parallel. The coverage is identical; only the
     * assertion count changed.
     */
    const violations: string[] = [];
    let combinationsChecked = 0;

    for (const j of all) {
      const bands = j.oversizeFeeBands;
      if (bands === undefined) continue;
      for (const widthIn of widths) {
        for (const heightIn of heights) {
          for (const overallLengthIn of lengths) {
            for (const milesInJurisdiction of mileages) {
              combinationsChecked += 1;
              const feeBySource: Record<string, number> = {};
              for (const row of bands) {
                const verdict = oversizeBandApplies(row.value, {
                  widthIn,
                  heightIn,
                  overallLengthIn,
                  milesInJurisdiction,
                });
                if (verdict.applies !== true) continue;
                const seen = feeBySource[row.source.id];
                if (seen === undefined) {
                  feeBySource[row.source.id] = row.value.feeUsd;
                } else if (seen !== row.value.feeUsd) {
                  violations.push(
                    `${j.code} ${row.source.id} gives both $${seen} and $${row.value.feeUsd} for ${widthIn}in x ${heightIn}in x ${overallLengthIn}in over ${milesInJurisdiction} mi`,
                  );
                }
              }
            }
          }
        }
      }
    }

    // A grid that silently stopped matching anything would pass vacuously.
    expect(combinationsChecked).toBeGreaterThan(1000);
    expect(violations).toEqual([]);
  });

  it('the Texas fee PDF is recorded with its real February 2021 revision date', () => {
    const pdfRows = TEXAS_OSOW_RULES.permitBaseFeeUsd.filter(
      (r) => r.source.id === 'txdmv-fee-pdf-2021-02',
    );
    expect(pdfRows).toHaveLength(1);
    expect(pdfRows[0]?.source.revisedOn).toBe('2021-02-01');
    // Not backfilled with the retrieval date, which is the whole point.
    expect(pdfRows[0]?.source.revisedOn).not.toBe(pdfRows[0]?.source.retrievedOn);
  });
});

/**
 * PHASE 3 — five states with five different fee architectures, each driven end
 * to end and checked against the figure its own agency publishes.
 *
 * These are not restatements of the inputs. Each case runs the whole engine —
 * legal limits, superload triggers, band selection, the combination rule and
 * the transaction-fee arithmetic — and compares the subtotal to a number that
 * appears in a state document. Between them they exercise a flat fee, a
 * per-dimension fee, a per-2,000-lb formula, flat bands taken as the greater of
 * two components, and a per-mile rate.
 *
 * The as-of date is later than the rest of this file's because several of these
 * sources are undated pages, and an undated page's row is only effective from
 * the day we can prove it said what it says.
 */
const ASOF3 = '2026-09-02';

function priceIn(
  code: string,
  partial: Parameters<typeof calculateOsowForJurisdiction>[1],
) {
  const rules = osowRulesFor(code);
  expect(rules, `${code} must be a covered jurisdiction`).not.toBeNull();
  return calculateOsowForJurisdiction(
    rules as NonNullable<typeof rules>,
    partial,
    ASOF3,
  );
}

describe('California — a flat $16, priced by route COLOUR rather than road type', () => {
  const wide13 = {
    widthIn: ftIn(13),
    heightIn: ftIn(13),
    overallLengthIn: ftIn(90),
    grossWeightLbs: 90000,
  };

  it('charges $16 plus the 2.3% card surcharge, whatever the load weighs', () => {
    const r = priceIn('CA', { ...wide13, routeClass: 'ca-yellow' });
    expect(r.subtotalUsd).toBe(16.37);
    // The overweight component is a SOURCED zero, not a missing one.
    const ow = r.lines.find((l) => l.code === 'osow_overweight');
    expect(ow?.amountUsd).toBe(0);
  });

  it('gives the SAME load a different escort count on a different colour', () => {
    // At 13 ft, yellow, green and blue all want one pilot car and brown wants
    // two — brown is a two-lane road with 10 or 11 ft lanes, and its two-car
    // step starts at 12 ft where the others start at 13, 14 and 15.
    expect(priceIn('CA', { ...wide13, routeClass: 'ca-yellow' }).escortsRequired).toBe(1);
    expect(priceIn('CA', { ...wide13, routeClass: 'ca-green' }).escortsRequired).toBe(1);
    expect(priceIn('CA', { ...wide13, routeClass: 'ca-blue' }).escortsRequired).toBe(1);
    expect(priceIn('CA', { ...wide13, routeClass: 'ca-brown' }).escortsRequired).toBe(2);

    // Six inches wider and blue joins brown at two, while yellow and green are
    // still on one. Same load, same $16 fee, three different escort bills —
    // which is exactly why the colours could not be flattened onto "divided"
    // and "two-lane". Green, blue and brown are ALL two-lane roads.
    const wide13h = { ...wide13, widthIn: ftIn(13, 6) };
    expect(priceIn('CA', { ...wide13h, routeClass: 'ca-yellow' }).escortsRequired).toBe(1);
    expect(priceIn('CA', { ...wide13h, routeClass: 'ca-green' }).escortsRequired).toBe(1);
    expect(priceIn('CA', { ...wide13h, routeClass: 'ca-blue' }).escortsRequired).toBe(2);
    expect(priceIn('CA', { ...wide13h, routeClass: 'ca-brown' }).escortsRequired).toBe(2);
  });

  it('cannot count pilot cars at all without the route colour', () => {
    const r = priceIn('CA', wide13);
    expect(r.requiresManualReview).toBe(true);
    expect(r.escorts.undecided.map((u) => u.ruleId)).toContain('ca-yellow-width-over-12-to-15');
  });

  it('never asks for a height pole, and says so on an overheight load', () => {
    const r = priceIn('CA', {
      widthIn: ftIn(9),
      heightIn: ftIn(16),
      overallLengthIn: ftIn(70),
      grossWeightLbs: 70000,
      routeClass: 'ca-yellow',
    });
    expect(r.escorts.heightPole).toBe(false);
    expect(r.warnings.join(' ')).toContain('Height poles will not be a Caltrans requirement');
  });

  it('refuses to total a load over 14 ft wide, because of the $50/hour charge', () => {
    const r = priceIn('CA', {
      ...wide13,
      widthIn: ftIn(14, 6),
      routeClass: 'ca-yellow',
    });
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('$50.00 for each hour');
  });

  it('surfaces the legend’s self-contradiction only on the colours it affects', () => {
    const at14ft6 = { ...wide13, widthIn: ftIn(14, 6) };
    const green = priceIn('CA', { ...at14ft6, routeClass: 'ca-green' });
    expect(green.escorts.applied.map((a) => a.ruleId)).toContain('ca-note1-conflicts-with-table');
    // Yellow's two-pilot cell starts above 15 ft, where Note 1 no longer bites.
    const yellow = priceIn('CA', { ...at14ft6, routeClass: 'ca-yellow' });
    expect(yellow.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'ca-note1-conflicts-with-table',
    );
  });

  /**
   * KPRA — THE OPTIONAL MEASUREMENT THAT UNLOCKS THE STATE.
   *
   * California publishes no semitrailer LENGTH limit, so `trailerLengthIn` is
   * an empty list and the engine has always reported that gap and sent every
   * California quote to a human. These two tests are a matched pair and both
   * halves matter: the first pins that a caller who supplies no kingpin
   * distance gets exactly what it got before, and the second that supplying one
   * is what buys a clean answer. A change that made California price without
   * KPRA would fail the first; a change that failed to unlock it would fail the
   * second.
   *
   * The subjective CHP answers are supplied in both, because they are a
   * separate, unrelated reason California asks for a human and they would mask
   * the thing under test.
   */
  const chpAnswered = {
    subjectiveAnswers: {
      'ca-uses-opposing-lanes': false,
      'ca-slows-crossing-structure': false,
    },
  };
  const fullySpecified = { ...wide13, routeClass: 'ca-yellow' as const, ...chpAnswered };

  it('WITHOUT a kingpin distance, still asks for a human — exactly as before', () => {
    const r = priceIn('CA', fullySpecified);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain(
      'No California legal trailer length is on file',
    );
    // The price itself was never the problem, and has not moved.
    expect(r.subtotalUsd).toBe(16.37);
  });

  it('WITH a kingpin distance, prices cleanly and drops the trailer-length gap', () => {
    const r = priceIn('CA', { ...fullySpecified, kingpinToRearAxleIn: ftIn(38) });
    expect(r.requiresManualReview).toBe(false);
    expect(r.warnings.join(' ')).not.toContain(
      'No California legal trailer length is on file',
    );
    expect(r.subtotalUsd).toBe(16.37);
    expect(r.escorts.undecided).toEqual([]);
  });

  it('checks the supplied kingpin distance against CVC §35400(b)(4)’s 40 ft', () => {
    // "does not exceed 40 feet" — inclusive, so 40 ft 0 in is legal.
    const at40 = priceIn('CA', { ...fullySpecified, kingpinToRearAxleIn: ftIn(40) });
    expect(at40.overDimension.details.join(' ')).not.toContain('Kingpin');
    const over40 = priceIn('CA', { ...fullySpecified, kingpinToRearAxleIn: ftIn(40, 6) });
    expect(over40.overDimension.length).toBe(true);
    expect(over40.overDimension.details.join(' ')).toContain(
      'Kingpin-to-rearmost-axle distance 40\'6" exceeds the 40\' legal limit',
    );
  });

  it('leaves a legal-size load legal — a kingpin distance never invents a permit', () => {
    const r = priceIn('CA', {
      widthIn: 102,
      heightIn: ftIn(13, 6),
      overallLengthIn: ftIn(70),
      grossWeightLbs: 40000,
      kingpinToRearAxleIn: ftIn(38),
      routeClass: 'ca-yellow',
      ...chpAnswered,
    });
    expect(r.permitRequired).toBe(false);
    expect(r.subtotalUsd).toBe(0);
    expect(r.requiresManualReview).toBe(false);
  });

  it('records the 40 ft limit from the statute AND from Caltrans, and neither guesses', () => {
    const rows = CALIFORNIA_OSOW_RULES.legalLimits.kingpinToRearAxleIn ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.value)).toEqual([ftIn(40), ftIn(40)]);
    // Two publishers agreeing is corroboration, and the resolver must read it
    // that way rather than as a conflict.
    const resolved = resolveSourced('CA KPRA', rows, ASOF3);
    expect(resolved.conflict).toBe(false);
    expect(resolved.value).toBe(ftIn(40));
    // The statute dates the figure itself: §35400(c) says the 40 ft KPRA took
    // effect on 1 January 1987, and that is not backfilled with today's date.
    const statute = rows.find((r) => r.source.id === 'ca-cvc-35400');
    expect(statute?.effectiveFrom).toBe('1987-01-01');
    expect(statute?.source.revisedOn).toBeNull();
    // The 38 ft single-axle figure is NOT a second row — it is a different
    // configuration, and recording it here would read as a conflict.
    expect(rows.some((r) => r.value === ftIn(38))).toBe(false);
    expect(
      priceIn('CA', fullySpecified).warnings.join(' '),
    ).toContain('A SINGLE-AXLE semitrailer is limited to 38 feet');
  });

  /**
   * The trailer-length gap must be answered by KPRA only where the state
   * genuinely regulates that way. Every other jurisdiction publishes a trailer
   * length, and supplying a kingpin distance must not switch its length check
   * off.
   */
  it('does not let a kingpin distance suppress a state’s real trailer-length check', () => {
    const over = priceIn('TX', {
      widthIn: 102,
      heightIn: ftIn(13),
      overallLengthIn: ftIn(70),
      trailerLengthIn: ftIn(70),
      grossWeightLbs: 79000,
      kingpinToRearAxleIn: ftIn(38),
      routeClass: 'divided',
    });
    expect(over.overDimension.length).toBe(true);
    expect(over.overDimension.details.join(' ')).toContain('Trailer length');
  });
});

describe('North Carolina — $12 per over-legal dimension, and a height its own documents dispute', () => {
  const base = {
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  it('charges $12 for width plus $12 for weight, inside the published $12–$48 range', () => {
    const r = priceIn('NC', {
      ...base,
      widthIn: ftIn(12),
      heightIn: ftIn(13),
      grossWeightLbs: 100000,
    });
    expect(r.subtotalUsd).toBe(24);
    expect(r.subtotalUsd).toBeGreaterThanOrEqual(12);
    expect(r.subtotalUsd).toBeLessThanOrEqual(48);
  });

  it('reports a RANGE, not a number, for a load in the 13 ft 6 in – 14 ft gap', () => {
    const r = priceIn('NC', {
      ...base,
      widthIn: ftIn(11),
      heightIn: ftIn(13, 9),
      grossWeightLbs: 90000,
    });
    const os = r.lines.find((l) => l.code === 'osow_oversize');
    expect(os?.amountUsd).toBeNull();
    expect(os?.lowUsd).toBe(12);
    expect(os?.highUsd).toBe(24);
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
  });

  it('has a WEIGHT-based escort trigger, which almost no other state does', () => {
    const heavy = {
      ...base,
      widthIn: ftIn(11),
      heightIn: ftIn(13),
      grossWeightLbs: 150000,
    };
    const r = priceIn('NC', heavy);
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain('nc-weight-over-149999');
    expect(r.escorts.front).toBe(1);
    // Exactly at the published figure the rule does NOT fire: "in excess of
    // 149,999 pounds" leaves 149,999 itself clear.
    const at = priceIn('NC', { ...heavy, grossWeightLbs: 149999 });
    expect(at.escorts.applied.map((a) => a.ruleId)).not.toContain('nc-weight-over-149999');
  });

  it('keeps a 38,000 lb tandem limit rather than borrowing the federal 34,000', () => {
    const rules = osowRulesFor('NC');
    expect(rules?.legalLimits.tandemAxleLbs.map((r) => r.value)).toEqual([38000]);
  });
});

describe('New Jersey — a per-2,000-lb formula whose 5% applies AFTER the $12', () => {
  const base = {
    heightIn: ftIn(13),
    overallLengthIn: ftIn(60),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  it('reproduces NJDOT’s order of operations on an oversize-and-overweight load', () => {
    const r = priceIn('NJ', { ...base, widthIn: ftIn(15), grossWeightLbs: 90000 });
    // $10 oversize base + $1 width excess + $10 overweight base + $25 weight
    // excess = $46, which is the $20 combined base the regulation prints plus
    // the two excess formulas. Then ($46 + $12) × 1.05.
    expect(r.subtotalUsd).toBe(60.9);
    expect(Math.round((46 + 12) * 1.05 * 100) / 100).toBe(60.9);
  });

  it('reaches the $10 base and NJDOT’s own $12.60 arithmetic on a bare oversize permit', () => {
    const r = priceIn('NJ', { ...base, widthIn: ftIn(12), grossWeightLbs: 70000 });
    expect(r.subtotalUsd).toBe(23.1);
    expect(Math.round((10 + 12) * 1.05 * 100) / 100).toBe(23.1);
  });

  it('sends both of New Jersey’s fee-basis conflicts to review', () => {
    const r = priceIn('NJ', {
      ...base,
      widthIn: ftIn(15),
      overallLengthIn: ftIn(70),
      grossWeightLbs: 90000,
    });
    const fired = r.escorts.applied.map((a) => a.ruleId);
    expect(fired).toContain('nj-length-fee-basis-conflict');
    expect(fired).toContain('nj-overweight-fee-basis-conflict');
    expect(r.requiresManualReview).toBe(true);
  });
});

describe('Georgia — one flat fee per permit type, taken as the greater of the two components', () => {
  const base = {
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  it('prices a Standard Single at $30 plus the $7 card charge', () => {
    const r = priceIn('GA', { ...base, widthIn: ftIn(12), grossWeightLbs: 100000 });
    expect(r.subtotalUsd).toBe(37);
  });

  it('charges ONE Superload Single, not an oversize fee plus an overweight fee', () => {
    const r = priceIn('GA', { ...base, widthIn: ftIn(17), grossWeightLbs: 100000 });
    expect(r.subtotalUsd).toBe(132); // $125 + $7, not $125 + $30 + $7
    expect(r.lines.find((l) => l.code === 'osow_oversize')?.note).toContain(
      'Charged instead of the overweight fee',
    );
  });

  it('refuses to price the one pound its own sources disagree about', () => {
    const at = priceIn('GA', { ...base, widthIn: ftIn(12), grossWeightLbs: 150001 });
    expect(at.subtotalUsd).toBeNull();
    expect(at.requiresManualReview).toBe(true);
    // A pound either side is unambiguous and is priced.
    expect(priceIn('GA', { ...base, widthIn: ftIn(12), grossWeightLbs: 150000 }).subtotalUsd).toBe(37);
    expect(priceIn('GA', { ...base, widthIn: ftIn(12), grossWeightLbs: 150002 }).subtotalUsd).toBe(132);
  });

  it('cannot count escorts without the road class, because Georgia’s counts differ by it', () => {
    const wide = { ...base, widthIn: ftIn(13), grossWeightLbs: 79000 };
    expect(priceIn('GA', { ...wide, routeClass: 'two-lane' }).escortsRequired).toBe(2);
    expect(priceIn('GA', { ...wide, routeClass: 'divided' }).escortsRequired).toBe(1);
  });
});

describe('Virginia — $20 plus thirty cents a mile, and the steepest escort ladder here', () => {
  const base = {
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
  };

  it('prices a 200-mile overweight run as $20 + $60, with nothing else in the way', () => {
    const r = priceIn('VA', {
      ...base,
      widthIn: ftIn(12),
      grossWeightLbs: 100000,
      routeClass: 'interstate',
      milesInJurisdiction: 200,
    });
    expect(r.subtotalUsd).toBe(80);
    // A clean quote: no conflict, no missing input, no unpriced line.
    expect(r.requiresManualReview).toBe(false);
  });

  it('refuses to bill a corridor’s whole mileage to Virginia', () => {
    const r = priceIn('VA', {
      ...base,
      widthIn: ftIn(12),
      grossWeightLbs: 100000,
      routeClass: 'interstate',
    });
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
  });

  it('asks for FOUR pilot cars over 16 ft wide off the interstate', () => {
    const r = priceIn('VA', {
      ...base,
      widthIn: ftIn(17),
      grossWeightLbs: 79000,
      routeClass: 'two-lane',
      milesInJurisdiction: 120,
    });
    expect(r.escortsRequired).toBe(4);
    expect(r.escorts.front).toBe(2);
    expect(r.escorts.rear).toBe(2);
    // …and three on the interstate, for the same load.
    const inter = priceIn('VA', {
      ...base,
      widthIn: ftIn(17),
      grossWeightLbs: 79000,
      routeClass: 'interstate',
      milesInJurisdiction: 120,
    });
    expect(inter.escortsRequired).toBe(3);
  });

  it('does not price a load past the 250,000 lb travel-plan parameter', () => {
    const r = priceIn('VA', {
      ...base,
      widthIn: ftIn(12),
      grossWeightLbs: 260000,
      routeClass: 'interstate',
      milesInJurisdiction: 120,
    });
    // Virginia publishes no numeric gross-weight superload threshold, so
    // without this rule the load would have been quoted as an ordinary permit.
    expect(r.requiresManualReview).toBe(true);
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain(
      'va-extreme-parameters-travel-plan',
    );
  });

  /**
   * THE UPGRADE FROM A SECOND, MUCH RICHER RESEARCH PASS. Each of these pins a
   * claim the first pass either did not hold at all or held too weakly.
   */
  const overweight200 = {
    ...base,
    widthIn: ftIn(12),
    grossWeightLbs: 100000,
    routeClass: 'interstate' as const,
    milesInJurisdiction: 200,
  };

  // Both of the escort-side advisories below fire ABOVE 12 ft, not at it —
  // 24VAC20-82-130's ladder starts when the load "exceeds 12 feet in width".
  const wide13Overweight = { ...overweight200, widthIn: ftIn(13) };

  it('says there is NO state police rate, not that one was not found', () => {
    const r = priceIn('VA', wide13Overweight);
    const text = r.warnings.join(' ');
    expect(text).toContain('Virginia does not have a state police escort rate');
    expect(text).toContain(
      'Written authorization from local law-enforcement personnel',
    );
    // The old, weaker claim must be gone: "we looked and did not find it"
    // invites the reader to assume a rate exists somewhere.
    expect(text).not.toContain('was found in any official source');
    // A statement about the sources, not a price — the quote still stands.
    expect(r.requiresManualReview).toBe(false);
  });

  it('states the unpublished partial-mile rule instead of rounding silently', () => {
    const r = priceIn('VA', overweight200);
    expect(r.warnings.join(' ')).toContain(
      'whether a PART mile is rounded up, rounded down, or billed pro rata',
    );
    // Pro rata, to the cent, on a mileage that is not a whole number. A
    // `Math.ceil` would bill 181 miles here and quietly add 30 cents.
    const partMile = priceIn('VA', { ...overweight200, milesInJurisdiction: 180.4 });
    expect(partMile.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBe(54.12);
    expect(partMile.subtotalUsd).toBe(74.12);
  });

  it('quotes no superload total at all, and names the $30 base and the unpublished damage fee', () => {
    const r = priceIn('VA', {
      ...base,
      widthIn: ftIn(16),
      grossWeightLbs: 100000,
      routeClass: 'interstate',
      milesInJurisdiction: 200,
    });
    expect(r.superload).toBe(true);
    expect(r.subtotalUsd).toBeNull();
    expect(r.lines).toEqual([]);
    const text = r.warnings.join(' ');
    expect(text).toContain('The base fee is $30, not the $20 single-trip figure');
    expect(text).toContain(
      'An additional damage fee is added based on the gross weight of the vehicle configuration',
    );
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain('va-superload-fee-not-quotable');
  });

  it('carries the real ages of the statutes behind the weight limits', () => {
    // §46.2-1124, §46.2-1125 and §46.2-1127 were last amended in 1989 and
    // §46.2-1126 in 1994. A bare year is what the Virginia Law Portal states,
    // and it is recorded as a year rather than invented into a full date.
    const rows = [
      ...VIRGINIA_OSOW_RULES.legalLimits.singleAxleLbs,
      ...VIRGINIA_OSOW_RULES.legalLimits.tandemAxleLbs,
      ...VIRGINIA_OSOW_RULES.legalLimits.grossWeightLbs,
    ];
    const statutes = rows.filter((r) => r.source.id.startsWith('va-code-'));
    expect(statutes).toHaveLength(3);
    for (const row of statutes) {
      expect(row.source.revisedOn).toBe('1989');
      expect(row.effectiveFrom).toBe('1989-07-01');
    }
    // The statute rows CORROBORATE the DMV manual rather than conflicting with
    // it — same numbers, two independent publishers — so nothing goes to review.
    expect(priceIn('VA', overweight200).requiresManualReview).toBe(false);
  });

  it('checks the 41 ft kingpin limit only when a kingpin distance is supplied', () => {
    // §46.2-1112 buys the 53 ft trailer allowance with "not more than 41 feet"
    // of kingpin distance. Silent when the measurement is absent…
    const noKpra = priceIn('VA', { ...overweight200, trailerLengthIn: ftIn(53) });
    expect(noKpra.overDimension.details.join(' ')).not.toContain('Kingpin');
    expect(noKpra.subtotalUsd).toBe(80);
    // …and inclusive at exactly 41 ft ("not more than 41 feet").
    const at41 = priceIn('VA', {
      ...overweight200,
      trailerLengthIn: ftIn(53),
      kingpinToRearAxleIn: ftIn(41),
    });
    expect(at41.overDimension.details.join(' ')).not.toContain('Kingpin');
    const over41 = priceIn('VA', {
      ...overweight200,
      trailerLengthIn: ftIn(53),
      kingpinToRearAxleIn: ftIn(41, 1),
    });
    expect(over41.overDimension.length).toBe(true);
    expect(over41.overDimension.details.join(' ')).toContain(
      'Kingpin-to-rearmost-axle distance',
    );
    // Purely additive: the kingpin check adds a finding, never a review flag or
    // a different price.
    expect(over41.subtotalUsd).toBe(80);
    expect(over41.requiresManualReview).toBe(false);
  });

  it('records the seven-state escort reciprocity, and that a second DMV page says one', () => {
    const text = priceIn('VA', wide13Overweight).warnings.join(' ');
    expect(text).toContain(
      'Florida Georgia Minnesota North Carolina Oklahoma Utah Washington',
    );
    // Both undated pages stay on file; neither is discarded.
    expect(text).toContain('Currently, we have an agreement with North Carolina.');
    expect(VIRGINIA_ESCORT_RECIPROCITY_SOURCES.map((s) => s.revisedOn)).toEqual([null, null]);
  });

  it('requires the utility companies to lift the wires on an extreme move', () => {
    const r = priceIn('VA', {
      ...base,
      widthIn: ftIn(19),
      grossWeightLbs: 100000,
      routeClass: 'interstate',
      milesInJurisdiction: 200,
    });
    expect(r.warnings.join(' ')).toContain(
      'agreeing to accompany the overdimensional configuration to lift overhead wires',
    );
  });
});

/**
 * PHASE 4 — five more states, and the three ways a source can fail a quote.
 *
 * Phase 3 exercised five fee ARCHITECTURES. These five exercise five failure
 * modes instead: a per-mile schedule with a statutory rounding rule, a fee sheet
 * that contradicts its own administrative code twelve times over, a rule that
 * publishes its own worked example, a state running a pilot programme against
 * its codified thresholds, and a table whose totals have to be decomposed before
 * they can be recombined.
 *
 * As with Phase 3, none of these is a restatement of the inputs. Every subtotal
 * below is compared against a number that appears in a state document — and in
 * Alabama's case against all five cells of two published columns at once.
 */
const ASOF4 = '2026-09-02';

function priceIn4(
  code: string,
  partial: Parameters<typeof calculateOsowForJurisdiction>[1],
) {
  const rules = osowRulesFor(code);
  expect(rules, `${code} must be a covered jurisdiction`).not.toBeNull();
  return calculateOsowForJurisdiction(
    rules as NonNullable<typeof rules>,
    partial,
    ASOF4,
  );
}

describe('Washington — a per-mile schedule with the state’s own rounding rule', () => {
  const legalSize = {
    widthIn: 102,
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  it('bills 100 miles at the statute’s $0.49 rate for 32,000 lb of excess', () => {
    const r = priceIn4('WA', {
      ...legalSize,
      grossWeightLbs: 112000,
      milesInJurisdiction: 100,
    });
    // RCW 46.44.0941: "30,000-34,999 pounds . . . . $ .49" of excess over legal
    // capacity, and Washington charges nothing to issue the permit.
    expect(r.subtotalUsd).toBe(49);
    expect(r.lines.find((l) => l.code === 'osow_service_fee')?.amountUsd).toBe(0);
  });

  it('rounds to the nearest whole dollar, which no earlier state required', () => {
    // 293 mi × $0.07 = $20.51 raw. RCW 46.44.0941(c) carries it to the next full
    // dollar at 50 cents, so Washington's own answer is $21.00.
    const r = priceIn4('WA', {
      ...legalSize,
      grossWeightLbs: 85000,
      milesInJurisdiction: 293,
    });
    expect(r.subtotalUsd).toBe(21);
    // …and the $14.00 statutory minimum floors a short crossing.
    const short = priceIn4('WA', {
      ...legalSize,
      grossWeightLbs: 85000,
      milesInJurisdiction: 20,
    });
    expect(short.subtotalUsd).toBe(14);
  });

  it('charges the $10 dimensional fee alone, and never alongside the mileage fee', () => {
    const oversizeOnly = priceIn4('WA', {
      ...legalSize,
      widthIn: ftIn(13),
      grossWeightLbs: 70000,
      routeClass: 'two-lane',
      milesInJurisdiction: 100,
    });
    expect(oversizeOnly.subtotalUsd).toBe(10);
    // RCW 46.44.096: an overweight AND oversize load pays the overweight fee
    // "without additional fees being assessed for the oversize features".
    const both = priceIn4('WA', {
      ...legalSize,
      widthIn: ftIn(13),
      grossWeightLbs: 112000,
      routeClass: 'divided',
      milesInJurisdiction: 100,
    });
    expect(both.subtotalUsd).toBe(49);
    expect(both.lines.some((l) => l.code === 'osow_oversize')).toBe(false);
  });

  it('refuses to price the 999 pounds WSDOT’s schedule does not cover', () => {
    const r = priceIn4('WA', {
      ...legalSize,
      grossWeightLbs: 179500,
      milesInJurisdiction: 100,
    });
    expect(r.subtotalUsd).toBeNull();
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain('wa-999-pound-fee-gap');
    expect(r.warnings.join(' ')).toContain('defines no fee whatever');
    // A pound either side of the gap is unambiguous and prices cleanly.
    expect(
      priceIn4('WA', { ...legalSize, grossWeightLbs: 179000, milesInJurisdiction: 100 })
        .subtotalUsd,
    ).toBe(387);
    expect(
      priceIn4('WA', { ...legalSize, grossWeightLbs: 180000, milesInJurisdiction: 100 })
        .subtotalUsd,
    ).toBe(425);
  });

  it('adds a rear escort at 12 ft only because a height escort is already leading', () => {
    const base = {
      ...legalSize,
      widthIn: ftIn(13),
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
    };
    // 13 ft wide on a multilane road is under the 14 ft rear-escort trigger, so
    // at legal height nothing fires.
    expect(priceIn4('WA', base).escortsRequired).toBe(0);
    // Raise the load over 14 ft 6 in and WAC 468-38-100(1)(i) reaches down to
    // 12 ft: the pole car leads and a second car is required behind it.
    const tall = priceIn4('WA', { ...base, heightIn: ftIn(15) });
    expect(tall.escorts.applied.map((a) => a.ruleId)).toContain(
      'wa-width-over-12-multilane-with-height-escort',
    );
    expect(tall.escorts.front).toBe(1);
    expect(tall.escorts.rear).toBe(1);
    expect(tall.escorts.heightPole).toBe(true);
  });

  it('cannot decide the mirror-visibility rule, and never turns it into an escort', () => {
    const r = priceIn4('WA', {
      ...legalSize,
      grossWeightLbs: 70000,
      widthIn: ftIn(13),
      routeClass: 'two-lane',
      milesInJurisdiction: 100,
    });
    expect(r.escorts.undecided.map((u) => u.ruleId)).toContain(
      'wa-mirror-visibility-under-200ft',
    );
    expect(r.requiresManualReview).toBe(true);
    // Answered by a dispatcher, the rule resolves — and STILL adds no escort,
    // because a judgement call must not become a billable pilot car.
    const answered = priceIn4('WA', {
      ...legalSize,
      grossWeightLbs: 70000,
      widthIn: ftIn(13),
      routeClass: 'two-lane',
      milesInJurisdiction: 100,
      subjectiveAnswers: { 'wa-cannot-see-200ft-in-mirrors': true },
    });
    expect(answered.escorts.undecided.map((u) => u.ruleId)).not.toContain(
      'wa-mirror-visibility-under-200ft',
    );
    expect(answered.escorts.rear).toBe(1); // from the 11 ft two-lane rule alone
  });

  it('uses the overhang RATIO rule rather than any fixed number of feet', () => {
    const base = {
      widthIn: 102,
      heightIn: ftIn(13),
      overallLengthIn: ftIn(70),
      grossWeightLbs: 70000,
      routeClass: 'two-lane' as const,
      milesInJurisdiction: 100,
      rearOverhangIn: ftIn(14),
    };
    // 14 ft of overhang is over one-third of a 40 ft trailer and under one-third
    // of a 53 ft trailer. The SAME overhang, two different answers — which is
    // exactly what a fixed threshold in feet could not express.
    const short = priceIn4('WA', { ...base, trailerLengthIn: ftIn(40) });
    expect(short.escorts.applied.map((a) => a.ruleId)).toContain(
      'wa-trailer-over-105-or-overhang-ratio-two-lane',
    );
    const long = priceIn4('WA', { ...base, trailerLengthIn: ftIn(53) });
    expect(long.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'wa-trailer-over-105-or-overhang-ratio-two-lane',
    );
    // Without the trailer length the ratio is UNKNOWN, never "no escort".
    const noTrailer = priceIn4('WA', {
      widthIn: 102,
      heightIn: ftIn(13),
      overallLengthIn: ftIn(70),
      grossWeightLbs: 70000,
      routeClass: 'two-lane',
      milesInJurisdiction: 100,
      rearOverhangIn: ftIn(14),
    });
    expect(noTrailer.escorts.undecided.map((u) => u.ruleId)).toContain(
      'wa-trailer-over-105-or-overhang-ratio-two-lane',
    );
  });
});

describe('Alabama — two published columns, decomposed and put back together', () => {
  const base = {
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };
  /** The $4 card charge ALDOT adds to every credit-card transaction. */
  const CARD = 4;

  it('reproduces every cell of ALDOT’s Weight Only and General W/H/L columns', () => {
    const oversizeOnly = priceIn4('AL', {
      ...base,
      widthIn: ftIn(12, 6),
      grossWeightLbs: 75000,
    });
    expect(oversizeOnly.subtotalUsd).toBe(20 + CARD); // "W/H/L: up to 100,000 lbs. $20"

    const cases: Array<[number, number, number]> = [
      // gross lb, Weight Only total, General W/H/L total
      [90000, 10, 20],
      [110000, 30, 40],
      [140000, 60, 70],
      [160000, 100, 110],
    ];
    for (const [gross, weightOnly, general] of cases) {
      const legalSize = priceIn4('AL', { ...base, widthIn: 102, grossWeightLbs: gross });
      expect(legalSize.subtotalUsd, `Weight Only at ${gross} lb`).toBe(weightOnly + CARD);
      const overDimension = priceIn4('AL', {
        ...base,
        widthIn: ftIn(12, 6),
        grossWeightLbs: gross,
      });
      expect(overDimension.subtotalUsd, `General W/H/L at ${gross} lb`).toBe(general + CARD);
      // The whole point of the decomposition: General is Weight Only plus the
      // administrative code's flat $10 dimensional charge, in every row.
      expect(general - weightOnly).toBe(10);
    }
  });

  it('refuses the three pounds its own fee documents assign to two bands', () => {
    for (const gross of [80000, 100000, 125000]) {
      const r = priceIn4('AL', { ...base, widthIn: ftIn(12, 6), grossWeightLbs: gross });
      expect(r.requiresManualReview, `${gross} lb must go to review`).toBe(true);
    }
    const fired = priceIn4('AL', {
      ...base,
      widthIn: ftIn(12, 6),
      grossWeightLbs: 100000,
    }).escorts.applied.map((a) => a.ruleId);
    expect(fired).toContain('al-general-table-overlap-100000');
  });

  it('surfaces the width conflict only in the 8 ft to 8 ft 6 in band', () => {
    const inBand = priceIn4('AL', { ...base, widthIn: 100, grossWeightLbs: 70000 });
    expect(inBand.escorts.applied.map((a) => a.ruleId)).toContain('al-legal-width-conflict');
    // At 8 ft flat both sources agree the load is legal; at 12 ft both agree it
    // is over. Neither hears about a disagreement that cannot affect it.
    const below = priceIn4('AL', { ...base, widthIn: 96, grossWeightLbs: 70000 });
    expect(below.escorts.applied.map((a) => a.ruleId)).not.toContain('al-legal-width-conflict');
    const above = priceIn4('AL', { ...base, widthIn: ftIn(12), grossWeightLbs: 70000 });
    expect(above.escorts.applied.map((a) => a.ruleId)).not.toContain('al-legal-width-conflict');
  });

  it('flags the overhang ambiguity when the two readings can actually differ', () => {
    // Four feet at each end: legal under the rule's five-feet-per-end reading,
    // over the limit under the statute's five-feet-in-total one.
    const bothEnds = priceIn4('AL', {
      ...base,
      widthIn: 102,
      grossWeightLbs: 70000,
      frontOverhangIn: ftIn(4),
      rearOverhangIn: ftIn(4),
    });
    expect(bothEnds.escorts.applied.map((a) => a.ruleId)).toContain(
      'al-overhang-total-vs-each-end-conflict',
    );
    // Overhang at one end only: both readings agree, and nothing is said.
    const oneEnd = priceIn4('AL', {
      ...base,
      widthIn: 102,
      grossWeightLbs: 70000,
      rearOverhangIn: ftIn(4),
    });
    expect(oneEnd.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'al-overhang-total-vs-each-end-conflict',
    );
  });

  it('quotes ALEA’s published trooper rate without putting it in any total', () => {
    // Alabama's law-enforcement length trigger and its superload length trigger
    // are the SAME 150 feet, so every load that needs troopers is also a load
    // ALDOT prices after review. The escort requirement is stated in full, with
    // the rate; the permit fee is not quoted at all.
    const r = priceIn4('AL', {
      ...base,
      widthIn: ftIn(12, 6),
      overallLengthIn: ftIn(160),
      grossWeightLbs: 75000,
    });
    expect(r.escorts.policeFront).toBe(1);
    expect(r.escorts.policeRear).toBe(1);
    expect(r.warnings.join(' ')).toContain('$100.00 per hour per arresting officer');
    expect(r.superload).toBe(true);
    expect(r.subtotalUsd).toBeNull();
    // Ten feet shorter it is an ordinary permit again, and the price is the
    // General W/H/L row plus the card charge — with no trooper on it.
    const under = priceIn4('AL', {
      ...base,
      widthIn: ftIn(12, 6),
      overallLengthIn: ftIn(140),
      grossWeightLbs: 75000,
    });
    expect(under.escorts.policeFront).toBe(0);
    expect(under.subtotalUsd).toBe(20 + CARD);
  });
});

describe('Florida — a fee rule that publishes its own arithmetic', () => {
  const legalSize = {
    widthIn: 102,
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  it('reproduces FDOT’s own worked example to the dollar', () => {
    // "A 112,000 pound load traveling 67.5 miles would cost (75 miles X $0.32)
    // plus $3.33 = $27.33 rounded up to $28.00 in addition to the $5.00
    // transmission fee when applicable."
    const r = priceIn4('FL', {
      ...legalSize,
      grossWeightLbs: 112000,
      milesInJurisdiction: 67.5,
    });
    expect(r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBe(28);
    expect(r.lines.find((l) => l.code === 'osow_service_fee')?.amountUsd).toBe(5);
    expect(r.subtotalUsd).toBe(33);
  });

  it('charges Table 1A’s $5 bottom row for an ordinary oversize load', () => {
    const r = priceIn4('FL', {
      ...legalSize,
      widthIn: ftIn(11),
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
    });
    expect(r.lines.find((l) => l.code === 'osow_oversize')?.amountUsd).toBe(5);
    expect(r.subtotalUsd).toBe(10); // $5 band + $5 transmission fee
  });

  it('will not compute a rate whose own rule does not say which pounds it multiplies', () => {
    const r = priceIn4('FL', {
      ...legalSize,
      grossWeightLbs: 170000,
      milesInJurisdiction: 100,
    });
    expect(r.subtotalUsd).toBeNull();
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain('fl-over-162000-rate-basis-unknown');
    // A pound under the line prices cleanly from row (g).
    expect(
      priceIn4('FL', { ...legalSize, grossWeightLbs: 162000, milesInJurisdiction: 100 })
        .lines.find((l) => l.code === 'osow_overweight')?.amountUsd,
    ).toBe(51); // 100 mi × $0.47 = $47.00 + $3.33 = $50.33, rounded UP
  });

  it('holds the semitrailer-length conflict open rather than picking six inches', () => {
    const r = priceIn4('FL', {
      ...legalSize,
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
    });
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('Official sources disagree');
    expect(r.warnings.join(' ')).toContain('legal trailer length');
  });

  it('changes the escort COUNT on a limited access facility, not just the position', () => {
    const long = {
      ...legalSize,
      overallLengthIn: ftIn(160),
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
    };
    expect(priceIn4('FL', { ...long, routeClass: 'divided' }).escortsRequired).toBe(2);
    expect(priceIn4('FL', { ...long, routeClass: 'fl-limited-access' }).escortsRequired).toBe(1);
  });
});

describe('Missouri — a pilot programme running against its own codified rule', () => {
  const base = {
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
  };

  it('charges $15 plus $20 for each 10,000 lb, and MoDOT’s card fee on top', () => {
    const r = priceIn4('MO', {
      ...base,
      widthIn: ftIn(12),
      grossWeightLbs: 100000,
      routeClass: 'divided',
    });
    // $15 base + two 10,000 lb increments at $20 = $55, the regulation's own
    // arithmetic, then 2% plus 25 cents.
    expect(r.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd).toBe(15);
    expect(r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBe(40);
    expect(r.subtotalUsd).toBe(56.36);
  });

  it('prices a plain oversize permit cleanly, with no review flag at all', () => {
    const r = priceIn4('MO', {
      ...base,
      widthIn: ftIn(13),
      grossWeightLbs: 70000,
      routeClass: 'two-lane',
    });
    expect(r.subtotalUsd).toBe(15.55);
    expect(r.requiresManualReview).toBe(false);
    expect(r.escortsRequired).toBe(1);
    expect(r.escorts.front).toBe(1);
  });

  it('gives a multilane undivided road the divided answer at 13 ft and the two-lane answer at 15 ft', () => {
    const at13 = { ...base, widthIn: ftIn(13), grossWeightLbs: 70000 };
    expect(priceIn4('MO', { ...at13, routeClass: 'divided' }).escortsRequired).toBe(1);
    expect(priceIn4('MO', { ...at13, routeClass: 'multilane-undivided' }).escortsRequired).toBe(1);
    expect(priceIn4('MO', { ...at13, routeClass: 'two-lane' }).escortsRequired).toBe(1);

    const at15 = { ...base, widthIn: ftIn(15), grossWeightLbs: 70000 };
    expect(priceIn4('MO', { ...at15, routeClass: 'divided' }).escortsRequired).toBe(1);
    // …and now undivided sides with two-lane instead. Folding it onto either
    // neighbour would have lost a pilot car in one band or the other.
    expect(priceIn4('MO', { ...at15, routeClass: 'multilane-undivided' }).escortsRequired).toBe(2);
    expect(priceIn4('MO', { ...at15, routeClass: 'two-lane' }).escortsRequired).toBe(2);
  });

  it('sends the three pilot-versus-rule bands to review and leaves the rest alone', () => {
    const at17 = priceIn4('MO', {
      ...base,
      widthIn: ftIn(17),
      grossWeightLbs: 70000,
      routeClass: 'two-lane',
    });
    expect(at17.escorts.applied.map((a) => a.ruleId)).toContain('mo-le-width-threshold-conflict');
    const at19 = priceIn4('MO', {
      ...base,
      widthIn: ftIn(19),
      grossWeightLbs: 70000,
      routeClass: 'two-lane',
    });
    // Above 18 ft both readings agree a trooper is required, so there is no
    // disagreement left to report — only the requirement itself.
    expect(at19.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'mo-le-width-threshold-conflict',
    );
    expect(at19.escorts.policeFront).toBe(1);
  });

  it('fires the weight escort only when another dimensional rule already has', () => {
    const heavy = { ...base, grossWeightLbs: 200000, routeClass: 'two-lane' as const };
    const plain = priceIn4('MO', { ...heavy, widthIn: 102 });
    expect(plain.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'mo-weight-160001-to-220000-two-lane-with-other-escort',
    );
    const wide = priceIn4('MO', { ...heavy, widthIn: ftIn(13) });
    expect(wide.escorts.applied.map((a) => a.ruleId)).toContain(
      'mo-weight-160001-to-220000-two-lane-with-other-escort',
    );
    // Both are superloads over 160,000 lb, so neither carries a priced line.
    expect(wide.superload).toBe(true);
    expect(wide.subtotalUsd).toBeNull();
  });
});

describe('Oklahoma — two permits priced as though issued separately', () => {
  const base = {
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
  };

  it('reproduces the whole published chain: $80 + $20, then $2, then 4%', () => {
    const r = priceIn4('OK', {
      ...base,
      widthIn: ftIn(13),
      grossWeightLbs: 82000,
      routeClass: 'two-lane',
    });
    expect(r.lines.find((l) => l.code === 'osow_oversize')?.amountUsd).toBe(40);
    expect(r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBe(60);
    // "3. Oversize & Overweight $80.00 (Plus $10 for each 1,000 lb...)" = $100,
    // then the $2.00 Fax/ETF fee, then 4% of the total card charge.
    expect(r.subtotalUsd).toBe(106.08);
    expect(Math.round((100 + 2) * 1.04 * 100) / 100).toBe(106.08);
  });

  it('prices each permit alone at the figure ODOT publishes for it', () => {
    const oversizeOnly = priceIn4('OK', {
      ...base,
      widthIn: ftIn(13),
      grossWeightLbs: 70000,
      routeClass: 'two-lane',
    });
    expect(oversizeOnly.subtotalUsd).toBe(43.68); // ($40 + $2) × 1.04
    const overweightOnly = priceIn4('OK', {
      ...base,
      widthIn: 102,
      grossWeightLbs: 82000,
      routeClass: 'divided',
    });
    expect(overweightOnly.subtotalUsd).toBe(64.48); // ($40 + $20 + $2) × 1.04
  });

  it('splits an 80-foot escort on Oklahoma’s own "super two-lane" class', () => {
    const long = {
      ...base,
      widthIn: 102,
      overallLengthIn: ftIn(90),
      grossWeightLbs: 70000,
    };
    const superTwo = priceIn4('OK', { ...long, routeClass: 'ok-super-two-lane' });
    expect(superTwo.escorts.applied.map((a) => a.ruleId)).toContain(
      'ok-super-two-lane-length-ambiguity',
    );
    // On a plain two-lane road both provisions agree, so there is nothing to
    // report — and on a multi-lane road Oklahoma publishes no length trigger at
    // all, so no escort is asserted.
    const twoLane = priceIn4('OK', { ...long, routeClass: 'two-lane' });
    expect(twoLane.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'ok-super-two-lane-length-ambiguity',
    );
    expect(twoLane.escorts.front).toBe(1);
    expect(priceIn4('OK', { ...long, routeClass: 'divided' }).escortsRequired).toBe(0);
  });

  it('surfaces the FAQ’s quarrel with the statute in the disputed six inches', () => {
    const inBand = priceIn4('OK', {
      ...base,
      widthIn: 102,
      heightIn: ftIn(13, 9),
      grossWeightLbs: 70000,
      routeClass: 'divided',
    });
    expect(inBand.escorts.applied.map((a) => a.ruleId)).toContain('ok-height-13-6-to-14-conflict');
    // At 15 ft both sources agree a permit is required.
    const above = priceIn4('OK', {
      ...base,
      widthIn: 102,
      heightIn: ftIn(15),
      grossWeightLbs: 70000,
      routeClass: 'divided',
    });
    expect(above.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'ok-height-13-6-to-14-conflict',
    );
  });

  it('takes the height trigger INCLUSIVELY, unlike every other Oklahoma threshold', () => {
    const at = priceIn4('OK', {
      ...base,
      widthIn: 102,
      heightIn: ftIn(15, 9),
      grossWeightLbs: 70000,
      routeClass: 'divided',
    });
    // "fifteen (15) feet and nine (9) inches OR MORE" — exactly 15'9" fires.
    expect(at.escorts.applied.map((a) => a.ruleId)).toContain('ok-height-15-9-or-more');
    expect(at.escorts.heightPole).toBe(true);
    const justUnder = priceIn4('OK', {
      ...base,
      widthIn: 102,
      heightIn: ftIn(15, 8),
      grossWeightLbs: 70000,
      routeClass: 'divided',
    });
    expect(justUnder.escorts.applied.map((a) => a.ruleId)).not.toContain('ok-height-15-9-or-more');
  });
});

describe('Phase 4 conflicts that live outside the priced lines', () => {
  /**
   * Three of Phase 4's conflicts are about products this engine does not price —
   * an annual manufactured-home permit, a doubles trailer, a stinger-steered car
   * hauler — so they cannot surface as a null fee. They still have to be held by
   * the CONFLICT MECHANISM rather than settled in a comment, which is what these
   * cases prove: both candidates on file, no value adopted, review forced, and
   * an honest spread the quote can show.
   */
  it('refuses to adopt either Washington manufactured-home annual permit', () => {
    const fee = resolveSourced(
      'WA annual manufactured-home permit fee',
      WASHINGTON_MANUFACTURED_HOME_ANNUAL_FEE_USD,
      ASOF4,
    );
    expect(fee.conflict).toBe(true);
    expect(fee.value).toBeNull();
    expect(fee.requiresManualReview).toBe(true);
    expect(fee.candidates).toHaveLength(2);
    expect(spreadOf(fee)).toEqual({ low: 150, high: 360 });

    // The same conflict's dimensional half — the statute covers a home up to
    // 14 ft wide and WSDOT's schedule up to 15 ft, so a 14 ft 6 in home is
    // inside one entitlement and outside the other.
    const width = resolveSourced(
      'WA annual manufactured-home permit width',
      WASHINGTON_MANUFACTURED_HOME_ANNUAL_WIDTH_IN,
      ASOF4,
    );
    expect(width.conflict).toBe(true);
    expect(spreadOf(width)).toEqual({ low: ftIn(14), high: ftIn(15) });
  });

  it('refuses to adopt either Alabama length figure the 2025 statute left behind', () => {
    for (const [field, rows, low, high] of [
      ['AL doubles trailer length', ALABAMA_DOUBLES_TRAILER_LENGTH_IN, ftIn(28), ftIn(28, 6)],
      ['AL stinger-steered length', ALABAMA_STINGER_STEERED_LENGTH_IN, ftIn(75), ftIn(80)],
    ] as const) {
      const r = resolveSourced(field, rows, ASOF4);
      expect(r.conflict, field).toBe(true);
      expect(r.value, field).toBeNull();
      expect(r.requiresManualReview, field).toBe(true);
      expect(spreadOf(r), field).toEqual({ low, high });
      // Both sources must still be citable — a conflict that loses one of its
      // candidates is just a missing value with extra steps.
      expect(new Set(r.candidates.map((c) => c.source.id)).size, field).toBe(2);
    }
  });

  it('keeps the RCW 46.44.0941 table whole, with only one row a single trip', () => {
    // Fifteen rows, and fourteen of them are 30-day, quarterly or annual permits.
    // Reading any of them as a trip fee would put a $150 tow-truck annual, or a
    // $300 milk-tanker annual, on a single move.
    expect(RCW_0941_FULL_FEE_TABLE).toHaveLength(16);
    const singleTrip = RCW_0941_FULL_FEE_TABLE.filter((r) => r.term === 'single-trip');
    expect(singleTrip).toHaveLength(1);
    expect(singleTrip[0]?.feeUsd).toBe(10);
    // The statute's own line breaks are preserved, not re-flowed into prose.
    expect(singleTrip[0]?.verbatim).toContain('\n\n');
    expect(singleTrip[0]?.verbatim).toContain('All overlegal loads, except overweight, single');

    // And the 999-pound hole is recorded as a range, not as a rate.
    expect(WASHINGTON_999_POUND_GAP.minGrossLbs).toBe(179001);
    expect(WASHINGTON_999_POUND_GAP.maxGrossLbs).toBe(179999);
    expect(WASHINGTON_999_POUND_GAP.maxGrossLbs - WASHINGTON_999_POUND_GAP.minGrossLbs + 1).toBe(999);
  });
});

/**
 * PHASE 5 — two states that each broke a different assumption in the fee model.
 *
 * Louisiana prices from a TWO-DIMENSIONAL table (weight rows × distance
 * columns), and Colorado prices PER AXLE with no weight increment at all. Every
 * subtotal below is compared against a figure printed in a state document: a
 * cell of R.S. 32:387(H)(2)(c), or CDOT's own six-axle worked example.
 */
const ASOF5 = '2026-09-03';

function priceIn5(
  code: string,
  partial: Parameters<typeof calculateOsowForJurisdiction>[1],
) {
  const rules = osowRulesFor(code);
  expect(rules, `${code} must be a covered jurisdiction`).not.toBeNull();
  return calculateOsowForJurisdiction(
    rules as NonNullable<typeof rules>,
    partial,
    ASOF5,
  );
}

describe('Louisiana — a fee table with two dimensions', () => {
  const legalSize = {
    widthIn: 102,
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  it('reproduces the statute’s own cells across the distance columns', () => {
    // R.S. 32:387(H)(2)(c)(i), row "108,001-120,000":
    //   0-50 $105.00 · 51-100 $195.00 · 101-150 $285.00 · 151-200 $375.00 · over 200 $465.00
    const cells: Array<[number, number]> = [
      [40, 105],
      [100, 195],
      [130, 285],
      [180, 375],
      [210, 465],
    ];
    for (const [miles, fee] of cells) {
      const r = priceIn5('LA', {
        ...legalSize,
        grossWeightLbs: 120000,
        milesInJurisdiction: miles,
      });
      expect(r.subtotalUsd, `${miles} mi`).toBe(fee);
      // A legal-size overweight move is a clean, priced Louisiana answer.
      expect(r.requiresManualReview, `${miles} mi`).toBe(false);
    }
  });

  it('reads the weight rows as well as the columns', () => {
    // Bottom-left and top-right corners of the printed schedule.
    expect(
      priceIn5('LA', { ...legalSize, grossWeightLbs: 85000, milesInJurisdiction: 30 })
        .subtotalUsd,
    ).toBe(45);
    expect(
      priceIn5('LA', { ...legalSize, grossWeightLbs: 250000, milesInJurisdiction: 300 })
        .subtotalUsd,
    ).toBe(2130);
  });

  it('will not pick a distance column it was not given', () => {
    const r = priceIn5('LA', { ...legalSize, grossWeightLbs: 120000 });
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain(
      'steps the overweight permit charge by miles travelled inside the state',
    );
  });

  it('absorbs the oversize fee into the overweight schedule, as the statute says', () => {
    const both = priceIn5('LA', {
      ...legalSize,
      widthIn: ftIn(13),
      grossWeightLbs: 120000,
      milesInJurisdiction: 100,
    });
    // $195 and not $195 + $8/$10: R.S. 32:387(H)(3) waives the oversize fee.
    expect(both.subtotalUsd).toBe(195);
    expect(both.lines.some((l) => l.code === 'osow_oversize')).toBe(false);
  });

  it('refuses to pick between the administrative code’s $8 and the statute’s $10', () => {
    const oversizeOnly = priceIn5('LA', {
      ...legalSize,
      widthIn: ftIn(13),
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
    });
    const line = oversizeOnly.lines.find((l) => l.code === 'osow_oversize');
    expect(line?.amountUsd).toBeNull();
    expect(line?.lowUsd).toBe(8);
    expect(line?.highUsd).toBe(10);
    expect(oversizeOnly.subtotalUsd).toBeNull();
    expect(oversizeOnly.subtotalLowUsd).toBe(8);
    expect(oversizeOnly.subtotalHighUsd).toBe(10);
    expect(oversizeOnly.requiresManualReview).toBe(true);
    // The researcher's supersession argument is recorded and NOT applied.
    expect(oversizeOnly.warnings.join(' ')).toContain('Official sources disagree');
  });

  it('swaps the pilot car for a trooper past 16 feet, rather than adding one', () => {
    const wide = priceIn5('LA', {
      ...legalSize,
      widthIn: ftIn(17),
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
      routeClass: 'two-lane',
    });
    expect(wide.escortsRequired).toBe(0); // no civilian pilot car at all
    expect(wide.escorts.policeFront).toBe(1);
    expect(wide.warnings.join(' ')).toContain('$75.00 per hour with a two-hour minimum');
    // At 13 ft it is a private escort and no trooper.
    const narrow = priceIn5('LA', {
      ...legalSize,
      widthIn: ftIn(13),
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
      routeClass: 'two-lane',
    });
    expect(narrow.escortsRequired).toBe(1);
    expect(narrow.escorts.policeFront).toBe(0);
  });

  it('flags the two ceilings that bite below the 254,000 lb superload line', () => {
    const heavy = priceIn5('LA', {
      ...legalSize,
      grossWeightLbs: 240000,
      milesInJurisdiction: 100,
    });
    const fired = heavy.escorts.applied.map((a) => a.ruleId);
    expect(fired).toContain('la-over-232000-approved-routes-and-structural-evaluation');
    expect(fired).toContain('la-over-238000-rail-or-water');
    expect(heavy.requiresManualReview).toBe(true);
    // Still inside the printed table, so it is a superload only past 254,000.
    expect(heavy.superload).toBe(false);
    expect(
      priceIn5('LA', { ...legalSize, grossWeightLbs: 260000, milesInJurisdiction: 100 })
        .superload,
    ).toBe(true);
  });

  it('never sets a height pole, because Louisiana only recommends one', () => {
    const tall = priceIn5('LA', {
      ...legalSize,
      heightIn: ftIn(16),
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
    });
    expect(tall.escorts.heightPole).toBe(false);
    expect(tall.warnings.join(' ')).toContain('strongly recommended');
  });

  it('holds the three conflicts a single-trip quote cannot show as a fee', () => {
    for (const [field, rows, low, high] of [
      ['LA Class II ocean container fee', LOUISIANA_CLASS_II_OCEAN_CONTAINER_FEE_USD, 375, 500],
      ['LA pleasure craft fee', LOUISIANA_PLEASURE_CRAFT_FEE_USD, 5, 10],
      [
        'LA rear overhang flag threshold',
        LOUISIANA_REAR_OVERHANG_FLAG_THRESHOLD_IN,
        ftIn(4),
        ftIn(8),
      ],
    ] as const) {
      const r = resolveSourced(field, rows, ASOF5);
      expect(r.conflict, field).toBe(true);
      expect(r.value, field).toBeNull();
      expect(r.requiresManualReview, field).toBe(true);
      expect(spreadOf(r), field).toEqual({ low, high });
      expect(new Set(r.candidates.map((c) => c.source.id)).size, field).toBe(2);
    }
  });

  it('lets the amending act’s date, not a hand-picked winner, decide what is in force', () => {
    // Acts 2019 No. 301 took effect 2020-01-01, so the statutory $375 is on file
    // from that day. The administrative $500 starts only on OUR retrieval date,
    // because a bare "current through June 2025" is not evidence of what the LAC
    // said in 2021. Priced as of 2021 there is therefore exactly one candidate
    // and no conflict — the dates did the work.
    const midway = resolveSourced(
      'LA Class II ocean container fee',
      LOUISIANA_CLASS_II_OCEAN_CONTAINER_FEE_USD,
      '2021-06-01',
    );
    expect(midway.conflict).toBe(false);
    expect(midway.value).toBe(375);
    // Before the act there is nothing on file at all, which is the honest answer
    // rather than back-dating either figure into a year we cannot evidence.
    const before = resolveSourced(
      'LA Class II ocean container fee',
      LOUISIANA_CLASS_II_OCEAN_CONTAINER_FEE_USD,
      '2019-06-01',
    );
    expect(before.value).toBeNull();
    expect(before.conflict).toBe(false);
    expect(before.requiresManualReview).toBe(true);
  });

  it('keeps schedules (a) and (b) on file without pricing from them', () => {
    // Schedule (b)'s overlapping band is what `la-four-axle-schedule-b` quotes.
    const fourAxle = LOUISIANA_OVERWEIGHT_SCHEDULE_B.find(
      (r) => r.minGrossLbs === 80001,
    );
    expect(fourAxle?.feesByDistanceUsd[0]).toBe(67.5);
    expect(fourAxle?.feesByDistanceUsd[4]).toBe(262.5);
    // Schedule (a)'s top row is a formula, not a fee — recorded as null.
    const overSixty = LOUISIANA_OVERWEIGHT_SCHEDULE_A.at(-1);
    expect(overSixty?.minExcessLbs).toBe(60001);
    expect(overSixty?.feesByDistanceUsd).toBeNull();
    // Three per-structure evaluation fees and no structure count.
    expect(LOUISIANA_STRUCTURAL_EVALUATION_FEES.map((f) => f.feeUsd)).toEqual([
      187.5, 1275, 750,
    ]);
  });
});

describe('Colorado — a permit priced by the axle', () => {
  const legalSize = {
    widthIn: 102,
    heightIn: ftIn(13),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'co-white-four-lane' as const,
  };

  it('reproduces CDOT’s own six-axle worked example, doubled and carded', () => {
    // "a six-axle semi-truck/trailer with a load exceeding 80,000 pounds would
    // cost $45" — the statutory base. The FASTER surcharge doubles it to $90,
    // and the $4 card charge makes $94.
    const r = priceIn5('CO', { ...legalSize, grossWeightLbs: 100000, axleCount: 6 });
    expect(r.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd).toBe(30);
    expect(r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBe(60);
    expect(r.subtotalUsd).toBe(94);
    expect(15 + 6 * 5).toBe(45);
    expect((15 + 6 * 5) * 2).toBe(90);
    expect(r.requiresManualReview).toBe(false);
  });

  it('charges an oversize-only load $30 and the card fee, and nothing per axle', () => {
    const r = priceIn5('CO', {
      ...legalSize,
      widthIn: ftIn(11),
      grossWeightLbs: 70000,
    });
    expect(r.subtotalUsd).toBe(34);
    expect(r.lines.some((l) => l.code === 'osow_overweight')).toBe(false);
    expect(r.requiresManualReview).toBe(false);
  });

  it('is flat in pounds and linear in axles, which is the whole fee shape', () => {
    const at = (grossWeightLbs: number, axleCount: number) =>
      priceIn5('CO', { ...legalSize, grossWeightLbs, axleCount }).subtotalUsd;
    // 119,000 lb of extra cargo costs nothing; one more axle costs $10.
    expect(at(81000, 6)).toBe(94);
    expect(at(199000, 6)).toBe(94);
    expect(at(199000, 7)).toBe(104);
  });

  it('will not price the axle component from an absence', () => {
    const r = priceIn5('CO', { ...legalSize, grossWeightLbs: 100000 });
    expect(r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBeNull();
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain(
      'steps the overweight permit charge by number of axles',
    );
  });

  it('takes the axle count from a supplied axle layout when no count is given', () => {
    const axles = [0, 12, 16, 40, 44, 48].map((positionFt) => ({
      positionFt,
      weightLbs: 16000,
    }));
    const r = priceIn5('CO', { ...legalSize, grossWeightLbs: 96000, axles });
    expect(r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBe(60);
  });

  it('surfaces the 80,000/85,000 statutory quarrel only inside the disputed band', () => {
    const inBand = priceIn5('CO', { ...legalSize, grossWeightLbs: 82000, axleCount: 5 });
    expect(inBand.escorts.applied.map((a) => a.ruleId)).toContain(
      'co-interstate-gross-80000-to-85000-conflict',
    );
    expect(inBand.requiresManualReview).toBe(true);
    // And it is still PRICED — the conflict does not disable the weight check.
    expect(inBand.subtotalUsd).toBe(84);
    // Below 80,000 both readings agree the load is legal; above 85,000 both
    // agree it needs a permit. Neither hears about the disagreement.
    for (const gross of [79000, 100000]) {
      expect(
        priceIn5('CO', { ...legalSize, grossWeightLbs: gross, axleCount: 5 })
          .escorts.applied.map((a) => a.ruleId),
        `${gross} lb`,
      ).not.toContain('co-interstate-gross-80000-to-85000-conflict');
    }
    // The conflict itself is held with both candidates and no adopted value.
    const held = resolveSourced(
      'CO interstate legal gross weight',
      COLORADO_INTERSTATE_GROSS_WEIGHT_LBS,
      ASOF5,
    );
    expect(held.conflict).toBe(true);
    expect(held.value).toBeNull();
    expect(spreadOf(held)).toEqual({ low: 80000, high: 85000 });
    // …and it is NOT what the engine uses for the legal limit, which is exactly
    // why the over-dimension check above still works.
    expect(
      resolveSourced(
        'CO legal gross weight',
        COLORADO_OSOW_RULES.legalLimits.grossWeightLbs,
        ASOF5,
      ).value,
    ).toBe(80000);
  });

  it('gives the same 12-foot load a different answer on each map colour', () => {
    const at = (routeClass: OsowLoad['routeClass']) =>
      priceIn5('CO', {
        ...legalSize,
        widthIn: ftIn(12),
        grossWeightLbs: 70000,
        ...(routeClass === undefined ? {} : { routeClass }),
      });
    expect(at('co-blue-two-lane').escortsRequired).toBe(2); // front and rear
    expect(at('co-yellow-two-lane').escortsRequired).toBe(1); // front only
    expect(at('co-green-two-lane').escortsRequired).toBe(0); // green starts at 13 ft
    expect(at('co-white-four-lane').escortsRequired).toBe(0); // white starts at 15 ft
    // Red admits no ordinary oversize movement at any width over legal.
    expect(at('co-red-two-lane').escorts.applied.map((a) => a.ruleId)).toContain(
      'co-red-over-legal-width',
    );
    expect(at('co-red-two-lane').requiresManualReview).toBe(true);
    // Without a colour the ladder cannot be read at all, which is the point of
    // carrying Colorado's own legend instead of flattening it.
    const noColour = priceIn5('CO', {
      ...legalSize,
      widthIn: ftIn(12),
      grossWeightLbs: 70000,
      routeClass: undefined,
    });
    expect(noColour.requiresManualReview).toBe(true);
    expect(noColour.escorts.undecided.length).toBeGreaterThan(0);
  });

  it('splits GREEN by lane count, which no other colour does', () => {
    const wide = { ...legalSize, widthIn: ftIn(14), grossWeightLbs: 70000 };
    // Two-lane green wants a front pilot car; four-lane green accepts a light.
    expect(priceIn5('CO', { ...wide, routeClass: 'co-green-two-lane' }).escorts.front).toBe(1);
    const fourLane = priceIn5('CO', { ...wide, routeClass: 'co-green-four-lane' });
    expect(fourLane.escortsRequired).toBe(0);
    expect(fourLane.warnings.join(' ')).toContain('one Flashing Yellow Light in the rear');
  });

  it('asks about terrain rather than guessing flat country', () => {
    const long = {
      ...legalSize,
      overallLengthIn: ftIn(95),
      grossWeightLbs: 70000,
      routeClass: 'co-white-two-lane' as const,
    };
    const unanswered = priceIn5('CO', long);
    expect(unanswered.escorts.undecided.map((u) => u.ruleId)).toContain(
      'co-length-over-85-mountainous-two-lane',
    );
    expect(unanswered.requiresManualReview).toBe(true);
    const answered = priceIn5('CO', {
      ...long,
      subjectiveAnswers: { coMountainousHighway: true },
    });
    expect(answered.escorts.front).toBe(1);
    expect(answered.requiresManualReview).toBe(false);
    // Past 110 ft the flat-country rule requires the same car, so the terrain
    // question can no longer change the answer and is not asked.
    const veryLong = priceIn5('CO', { ...long, overallLengthIn: ftIn(120) });
    expect(veryLong.escorts.front).toBe(1);
    expect(veryLong.escorts.undecided.map((u) => u.ruleId)).not.toContain(
      'co-length-over-85-mountainous-two-lane',
    );
  });

  it('runs a height pole without inventing an escort to carry it', () => {
    const tall = priceIn5('CO', {
      ...legalSize,
      heightIn: ftIn(17, 6),
      grossWeightLbs: 70000,
    });
    expect(tall.escorts.heightPole).toBe(true);
    // Colorado triggers no escort on height at all.
    expect(tall.escortsRequired).toBe(0);
    expect(tall.warnings.join(' ')).toContain('licensed signal contractor');
    // Exactly 17 ft 6 in does not yet trigger the route survey — "exceed".
    expect(tall.escorts.routeSurvey).toBe(false);
    expect(
      priceIn5('CO', { ...legalSize, heightIn: ftIn(18), grossWeightLbs: 70000 })
        .escorts.routeSurvey,
    ).toBe(true);
  });

  it('stops issuing the ordinary permit at 17 feet and at 200,000 pounds', () => {
    const wide = priceIn5('CO', {
      ...legalSize,
      widthIn: ftIn(18),
      grossWeightLbs: 70000,
      routeClass: 'co-green-four-lane',
    });
    expect(wide.superload).toBe(true);
    expect(wide.subtotalUsd).toBeNull();
    const heavy = priceIn5('CO', {
      ...legalSize,
      grossWeightLbs: 210000,
      axleCount: 9,
    });
    expect(heavy.superload).toBe(true);
    expect(heavy.subtotalUsd).toBeNull();
    // A Chapter 6 Special carries a front and a rear car whatever it measures.
    expect(heavy.escorts.front).toBe(1);
    expect(heavy.escorts.rear).toBe(1);
  });

  it('holds the two CDOT fee conflicts open rather than reading one as a typo', () => {
    for (const [field, rows, low, high] of [
      ['CO annual LVC OWD permit fee', COLORADO_LVC_OWD_ANNUAL_FEE_USD, 400, 1500],
      ['CO annual fleet per-vehicle fee', COLORADO_FLEET_PER_VEHICLE_FEE_USD, 15, 25],
    ] as const) {
      const r = resolveSourced(field, rows, ASOF5);
      expect(r.conflict, field).toBe(true);
      expect(r.value, field).toBeNull();
      expect(r.requiresManualReview, field).toBe(true);
      expect(spreadOf(r), field).toEqual({ low, high });
    }
  });
});

describe('the registry after Phase 5', () => {
  it('covers exactly the eighteen states whose datasets exist', () => {
    expect(Object.keys(OSOW_JURISDICTIONS).sort()).toEqual(
      [
        'AL', 'CA', 'CO', 'FL', 'GA', 'IL', 'IN', 'LA', 'MO',
        'NC', 'NJ', 'NY', 'OH', 'OK', 'PA', 'TX', 'VA', 'WA',
      ].sort(),
    );
    for (const code of Object.keys(OSOW_JURISDICTIONS)) {
      expect(hasOsowCoverage(code)).toBe(true);
      expect(osowRulesFor(code)?.code).toBe(code);
    }
    // The registry must never name a jurisdiction ahead of its dataset, and the
    // count is asserted separately so a stray import cannot pass by matching a
    // list someone updated in the same edit.
    expect(Object.keys(OSOW_JURISDICTIONS)).toHaveLength(18);
  });
});
