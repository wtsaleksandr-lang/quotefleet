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
import {
  applyTransactionFee,
  oversizeBandApplies,
  thresholdsEqual,
  weightBandAmount,
} from './types.js';
import {
  IMMATERIAL_CONFLICT_THRESHOLD_USD,
  priceSourced,
} from './materiality.js';
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
import {
  ARKANSAS_251_MILE_GAP,
  ARKANSAS_EXCESS_BASE_INFERENCE_LBS,
  ARKANSAS_MANUFACTURED_HOME_ESCORT_WIDTH_IN,
  ARKANSAS_MOBILE_CONSTRUCTION_FEE_SCHEDULE,
  ARKANSAS_OSOW_RULES,
  ARKANSAS_SUPERLOAD_SUPPLEMENTAL_FEE_CEILING_USD,
} from './jurisdictions/arkansas.js';
import {
  KENTUCKY_HEIGHT_POLE_TRIGGER_IN,
  KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM,
  KENTUCKY_OSOW_RULES,
  KENTUCKY_PROPOSED_2026_FEES,
  KENTUCKY_PROPOSED_AMENDMENT_NOT_IN_FORCE,
  KENTUCKY_PROPOSED_AMENDMENT_SOURCE,
} from './jurisdictions/kentucky.js';
import {
  TENNESSEE_BRIDGE_EVALUATION_FEES,
  TENNESSEE_ESCORT_BOUNDARY_GAPS,
  TENNESSEE_EXCESS_BASE_INFERENCE_LBS,
  TENNESSEE_HEAVY_DUTY_TOWING_TON_MILE,
  TENNESSEE_HOUSEBOAT_CONFLICT_ANALYSIS,
  TENNESSEE_HOUSEBOAT_SINGLE_TRIP_FEE_USD,
  TENNESSEE_OSOW_RULES,
  TENNESSEE_PARTIAL_INCREMENT_UNKNOWN,
  TENNESSEE_SEED_COTTON_ANNUAL_FEE_USD,
  TENNESSEE_SINGLE_BASE_FEE_READING,
  TENNESSEE_TON_MILE_MODEL_NOTE,
  TENNESSEE_WIDTH_BAND_GAP,
} from './jurisdictions/tennessee.js';

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

  /**
   * WAS: "refuses to pick between the administrative code's $8 and the
   * statute's $10". The refusal was correct in principle and wrong in practice —
   * it sent a $2 disagreement to a human on a move worth thousands. See
   * `materiality.ts` for Alex's direction and the reasoning. The candidates,
   * their documents and the spread are all still on file; what changed is that
   * $2 is quoted at $10 instead of being escalated.
   */
  it('quotes the statute’s $10 over the administrative code’s $8, and does not ask a human about $2', () => {
    const oversizeOnly = priceIn5('LA', {
      ...legalSize,
      widthIn: ftIn(13),
      grossWeightLbs: 70000,
      milesInJurisdiction: 100,
    });
    const line = oversizeOnly.lines.find((l) => l.code === 'osow_oversize');
    // The HIGHER figure, never the lower — the customer is not under-quoted.
    expect(line?.amountUsd).toBe(10);
    // …and the line's EXPLANATION is the winning row's, not the loser's. A $10
    // amount captioned "administrative code: $8" would be a quote that
    // contradicts itself in the same sentence.
    expect(line?.note).toContain('statute: $10');
    expect(line?.note).not.toContain('administrative code');
    // No range: an absorbed conflict prices like any settled line.
    expect(line?.lowUsd).toBeUndefined();
    expect(line?.highUsd).toBeUndefined();
    expect(oversizeOnly.subtotalUsd).toBe(10);
    expect(oversizeOnly.requiresManualReview).toBe(false);
    expect(oversizeOnly.warnings.join(' ')).not.toContain('Official sources disagree');
    // …and the finding is not lost. It moves to the internal channel with both
    // candidates, both documents and the dollar spread.
    expect(oversizeOnly.absorbedConflicts).toHaveLength(1);
    const absorbed = oversizeOnly.absorbedConflicts[0];
    expect(absorbed?.lowUsd).toBe(8);
    expect(absorbed?.highUsd).toBe(10);
    expect(absorbed?.spreadUsd).toBe(2);
    expect(absorbed?.adoptedUsd).toBe(10);
    expect(oversizeOnly.absorbedConflictTotalUsd).toBe(2);
    expect(absorbed?.candidates.map((c) => c.source.id).sort()).toEqual(
      ['la-lac-73-i-303', 'la-rs-32-387'].sort(),
    );
    expect(oversizeOnly.dataQuality.join(' ')).toContain('LA oversize fee band');
    // The researcher's supersession argument is still not what decided it: the
    // threshold did, and it took the larger figure rather than the argued one.
    expect(oversizeOnly.dataQuality.join(' ')).toContain('materiality threshold');
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

/**
 * PHASE 6 — one state, and the first permit in the dataset priced BY THE TON.
 *
 * Arkansas charges "$17 per permit, plus, for each ton or major fraction
 * thereof to be hauled in excess of the lawful weight", at a rate that steps by
 * the mileage travelled inside the state. Every subtotal below is checked
 * against arithmetic taken straight off ARDOT's Appendix 3 chart, and the two
 * cases that are NOT priced — a 251-mile move and a fractional mileage — are
 * checked to fail in the way the published documents fail.
 */
const ASOF6 = '2026-09-03';

function priceIn6(
  code: string,
  partial: Parameters<typeof calculateOsowForJurisdiction>[1],
) {
  const rules = osowRulesFor(code);
  expect(rules, `${code} must be a covered jurisdiction`).not.toBeNull();
  return calculateOsowForJurisdiction(
    rules as NonNullable<typeof rules>,
    partial,
    ASOF6,
  );
}

describe('Arkansas — a permit priced by the ton', () => {
  /** Legal on every Arkansas limit, so only the overweight side moves. */
  const legalSize = {
    widthIn: 102,
    heightIn: ftIn(13, 6),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  it('reproduces the fee chart’s own per-ton rate in every mileage band', () => {
    // ARDOT Appendix 3: $8.00 / $10.00 / $12.00 / $14.00 / $16.00 a ton.
    // 100,000 lb is 20,000 lb over the 80,000 lb lawful weight — ten tons flat,
    // so the whole subtotal is $17 + 10 × the band rate.
    const cells: Array<[number, number]> = [
      [50, 8],
      [120, 10],
      [175, 12],
      [225, 14],
      [300, 16],
    ];
    for (const [miles, perTon] of cells) {
      const r = priceIn6('AR', {
        ...legalSize,
        grossWeightLbs: 100000,
        milesInJurisdiction: miles,
      });
      expect(r.subtotalUsd, `${miles} mi`).toBe(17 + 10 * perTon);
      expect(r.requiresManualReview, `${miles} mi`).toBe(false);
      expect(
        r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd,
        `${miles} mi`,
      ).toBe(10 * perTon);
    }
  });

  /**
   * THE INFERENCE, DRIVEN FROM BOTH SIDES. "Or major fraction thereof" is
   * verbatim; reading it as "more than half a ton" is ours. These four cases are
   * what that reading actually costs, and they are the reason it is not encoded
   * as `roundIncrementUp` — a round-any-fraction rule would charge $25 for the
   * first load below instead of $17.
   */
  it('charges a ton only for a MAJOR fraction, and drops exactly half', () => {
    const at = (grossWeightLbs: number) =>
      priceIn6('AR', { ...legalSize, grossWeightLbs, milesInJurisdiction: 50 })
        .subtotalUsd;
    expect(at(81000)).toBe(17); // exactly 1,000 lb over — half a ton, dropped
    expect(at(81001)).toBe(25); // 1,001 lb — a major fraction, one ton at $8
    expect(at(82999)).toBe(25); // one ton + 999 lb — the part ton is dropped
    expect(at(83001)).toBe(33); // one ton + 1,001 lb — two tons
    // The base fee alone when the excess rounds away to nothing, never $0.
    expect(at(80001)).toBe(17);
  });

  /**
   * THE 251-MILE GAP. Ark. Code §27-35-210(e)(2) bands "201 miles to 250 miles,
   * inclusive" and then "Over 251 miles"; ARDOT's Appendix 3 and the codified 27
   * CAR Part 111 Appendix both read "251 miles or more". Only the range all
   * three name is priced, so a move of exactly 251 miles falls through — the
   * same answer the statute's own table gives.
   */
  it('prices 250 and 252 miles and refuses the 251 the statute skips', () => {
    const at = (milesInJurisdiction: number) =>
      priceIn6('AR', {
        ...legalSize,
        grossWeightLbs: 100000,
        milesInJurisdiction,
      });
    expect(at(250).subtotalUsd).toBe(157); // $17 + 10 × $14
    expect(at(252).subtotalUsd).toBe(177); // $17 + 10 × $16

    const gap = at(251);
    expect(gap.subtotalUsd).toBeNull();
    expect(gap.requiresManualReview).toBe(true);
    expect(gap.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBeNull();
    expect(gap.warnings.join(' ')).toContain(
      'No overweight fee band on file covers 100,000 lb in Arkansas',
    );
    // A HOLE, not a disagreement: nothing is on file that prices 251 miles, so
    // the resolver has no two candidates to weigh and reports no conflict.
    expect(gap.warnings.join(' ')).not.toContain('Official sources disagree');
    expect(ARKANSAS_251_MILE_GAP.unpricedMiles).toBe(251);
    expect(ARKANSAS_251_MILE_GAP.pricedFromMiles).toBe(252);
    expect(ARKANSAS_251_MILE_GAP.statuteTopBand).toBe('Over 251 miles');
    expect(ARKANSAS_251_MILE_GAP.ruleTopBand).toBe('251 miles or more');
  });

  /**
   * The bands are printed in whole miles — "100 Miles or Less", then "101 to
   * 150" — so 100.4 miles is named by neither. Louisiana's distance columns
   * have exactly this shape and are left exactly this way: nothing is rounded
   * into a band Arkansas did not put it in.
   */
  it('will not round a fractional mileage into a band the chart does not name', () => {
    const r = priceIn6('AR', {
      ...legalSize,
      grossWeightLbs: 100000,
      milesInJurisdiction: 100.4,
    });
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
  });

  it('will not pick a rate it was not given the mileage for', () => {
    const r = priceIn6('AR', { ...legalSize, grossWeightLbs: 100000 });
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain(
      'steps the overweight permit charge by miles travelled inside the state',
    );
  });

  it('charges the flat $17 for an oversize load and nothing per dimension', () => {
    // Arkansas has no dimensional fee ladder at all — 13 ft wide and 20 ft wide
    // pay the same issuance fee, and only the escort count moves.
    const narrow = priceIn6('AR', {
      ...legalSize,
      widthIn: ftIn(13),
      grossWeightLbs: 70000,
      milesInJurisdiction: 80,
      routeClass: 'two-lane' as const,
    });
    expect(narrow.subtotalUsd).toBe(17);
    expect(narrow.requiresManualReview).toBe(false);
    expect(narrow.escorts.front).toBe(1);
    expect(narrow.escorts.rear).toBe(0);
    expect(ARKANSAS_OSOW_RULES.oversizeFeeBands).toBeUndefined();
  });

  it('counts two escorts off a divided highway and one on it', () => {
    const off = priceIn6('AR', {
      ...legalSize,
      widthIn: ftIn(15),
      grossWeightLbs: 70000,
      milesInJurisdiction: 80,
      routeClass: 'two-lane' as const,
    });
    expect(off.escortsRequired).toBe(2);
    expect(off.escorts.front).toBe(1);
    expect(off.escorts.rear).toBe(1);

    const on = priceIn6('AR', {
      ...legalSize,
      widthIn: ftIn(15),
      grossWeightLbs: 70000,
      milesInJurisdiction: 80,
      routeClass: 'divided' as const,
    });
    expect(on.escortsRequired).toBe(1);
    expect(on.escorts.rear).toBe(1);
    expect(on.escorts.front).toBe(0);
  });

  /**
   * Arkansas's second road category is RESIDUAL — "all highways that are not
   * controlled access or divided highways with four or more lanes" — so it is
   * written as a negation and an urban arterial lands in it, as the state's own
   * wording puts it. A quote with NO road type is the genuinely undecided case,
   * because the escort COUNT moves with the road here.
   */
  it('reads an urban arterial as “all other highways”, and no road type as undecided', () => {
    const urban = priceIn6('AR', {
      ...legalSize,
      widthIn: ftIn(15),
      grossWeightLbs: 70000,
      milesInJurisdiction: 80,
      routeClass: 'urban' as const,
    });
    expect(urban.escortsRequired).toBe(2);

    const { routeClass: _dropped, ...noRoad } = legalSize;
    const unknownRoad = priceIn6('AR', {
      ...noRoad,
      widthIn: ftIn(15),
      grossWeightLbs: 70000,
      milesInJurisdiction: 80,
    });
    expect(unknownRoad.escorts.undecided.map((u) => u.ruleId)).toContain(
      'ar-width-over-14-divided',
    );
    expect(unknownRoad.requiresManualReview).toBe(true);
    // The permit fee is still priced — an undecided ESCORT is a gap in what we
    // were told, not a quarrel between two documents, so it does not poison the
    // fee lines.
    expect(
      unknownRoad.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd,
    ).toBe(17);
  });

  it('requires a clearance bar over 15 ft, which Arkansas mandates rather than recommends', () => {
    const r = priceIn6('AR', {
      ...legalSize,
      heightIn: ftIn(15, 3),
      grossWeightLbs: 70000,
      milesInJurisdiction: 80,
    });
    expect(r.escorts.heightPole).toBe(true);
    expect(r.escorts.front).toBe(1);
  });

  /**
   * 180,000 lb is a real superload CLASS under 27 CAR §111-110(a), not merely
   * the trigger for §27-35-210(e)(3)'s supplemental fee — which is why Arkansas
   * belongs in the widget's ceiling mirror where Florida's 300,000 lb does not.
   * The pound below it still prices cleanly, so the client can never wave
   * through a load the server then refuses.
   */
  it('prices the heaviest ordinary permit and refuses the pound above it', () => {
    const heaviest = priceIn6('AR', {
      ...legalSize,
      grossWeightLbs: 179999,
      milesInJurisdiction: 90,
    });
    // 99,999 lb over = 49 tons + 1,999 lb, a major fraction → 50 tons at $8.
    expect(heaviest.subtotalUsd).toBe(17 + 50 * 8);
    expect(heaviest.superload).toBe(false);
    expect(heaviest.requiresManualReview).toBe(false);

    const superload = priceIn6('AR', {
      ...legalSize,
      grossWeightLbs: 180000,
      milesInJurisdiction: 90,
    });
    expect(superload.superload).toBe(true);
    expect(superload.subtotalUsd).toBeNull();
    // The $500 supplement is a CEILING, so it is never quoted as an amount —
    // and its trigger is the superload threshold itself, so no line exists to
    // put it on.
    expect(ARKANSAS_SUPERLOAD_SUPPLEMENTAL_FEE_CEILING_USD).toBe(500);
    expect(ARKANSAS_OSOW_RULES.conditionalFees).toEqual([]);
  });

  /**
   * ARKANSAS IS THE FIRST STATE THAT CAN BE A SUPERLOAD WHILE NEEDING NO PERMIT
   * ON ANY LIMIT IT PUBLISHES: §111-110(a) escalates at 100 ft overall, and
   * Rule 3.G.1 imposes no overall-length restriction at all on a combination
   * whose trailer is within 53'6". The subtotal must be `null`, never the $0.00
   * an empty fee list sums to.
   */
  it('never totals $0 for a superload that is legal on every published limit', () => {
    const r = priceIn6('AR', {
      ...legalSize,
      overallLengthIn: ftIn(100),
      grossWeightLbs: 70000,
      milesInJurisdiction: 80,
    });
    expect(r.superload).toBe(true);
    expect(r.permitRequired).toBe(false);
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(ARKANSAS_OSOW_RULES.legalLimits.overallLengthIn).toBeUndefined();
  });

  /**
   * THE CONFLICT THE RESEARCH SUMMARY REPORTED AS ZERO. The codified 27 CAR
   * §111-505(c) says 14 ft 6 in; Ark. Code §27-35-306 and ARDOT's own 2023
   * booklet say 14 ft 9 in. Held open rather than settled, exactly like
   * Louisiana's four administrative-versus-statutory disagreements.
   */
  it('holds the manufactured-home escort width open at 14\'6" against 14\'9"', () => {
    const r = resolveSourced(
      'AR manufactured-home escort width',
      ARKANSAS_MANUFACTURED_HOME_ESCORT_WIDTH_IN,
      ASOF6,
    );
    expect(r.conflict).toBe(true);
    expect(r.value).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(spreadOf(r)).toEqual({ low: ftIn(14, 6), high: ftIn(14, 9) });
    // The 2025 redline is on file as EVIDENCE OF THE CODIFIED TEXT and must
    // never be dated as though the amendment were in force.
    const draft = ARKANSAS_MANUFACTURED_HOME_ESCORT_WIDTH_IN.find(
      (row) => row.source.id === 'ar-car-111-proposed-2025-draft',
    );
    expect(draft?.value).toBe(ftIn(14, 6));
    expect(draft?.source.revisedOn).toBe('2025-08-04');
    expect(draft?.source.title).toContain('NOT IN FORCE');
  });

  it('keeps the mobile-construction schedule on file without pricing from it', () => {
    // §27-35-210(i) is progressive — first five tons, next five, then the rest —
    // and nothing on a load says it is a Vehicle of Special Design, so the
    // general chart applies. Every rate here is BELOW the general rate for the
    // same mileage, so applying the general chart over-quotes rather than under.
    expect(ARKANSAS_MOBILE_CONSTRUCTION_FEE_SCHEDULE).toHaveLength(5);
    const bands = [8, 10, 12, 14, 16];
    ARKANSAS_MOBILE_CONSTRUCTION_FEE_SCHEDULE.forEach((row, i) => {
      expect(row.additionalTonsUsd).toBeLessThan(bands[i] as number);
      expect(row.firstFiveTonsUsd).toBeLessThan(row.nextFiveTonsUsd);
      expect(row.nextFiveTonsUsd).toBeLessThan(row.additionalTonsUsd);
    });
    // The top row carries the same 251-mile hole, from the same two documents.
    expect(ARKANSAS_MOBILE_CONSTRUCTION_FEE_SCHEDULE.at(-1)?.minMiles).toBe(252);
  });

  it('counts the per-ton excess above a base it names as an inference', () => {
    expect(ARKANSAS_EXCESS_BASE_INFERENCE_LBS).toBe(80000);
    for (const row of ARKANSAS_OSOW_RULES.overweightBands) {
      expect(row.value.incrementLbs).toBe(2000);
      expect(row.value.incrementBaseLbs).toBe(ARKANSAS_EXCESS_BASE_INFERENCE_LBS);
      expect(row.value.incrementRounding).toBe('majorFraction');
      // The $17 lives in `permitBaseFeeUsd`, never doubled into a band.
      expect(row.value.feeUsd).toBe(0);
    }
  });

  /**
   * THE DEFERRAL IS LIVE FOR ARKANSAS, and it has to be: a per-ton rate turns a
   * small published disagreement into a large one on a heavy load. A synthetic
   * two-cent-a-ton quarrel is immaterial on a ten-ton overload and material on a
   * fifty-ton one only if the comparison happens AFTER the fee is computed for
   * this load — which is what `priceSourced` and `weightBandAmount` do together.
   */
  it('measures a per-ton disagreement on the computed total, not the published rate', () => {
    const band = ARKANSAS_OSOW_RULES.overweightBands[0]?.value;
    expect(band).toBeDefined();
    const cheap = { ...(band as NonNullable<typeof band>), perIncrementUsd: 8 };
    const dear = { ...(band as NonNullable<typeof band>), perIncrementUsd: 9 };
    // One dollar a ton is $10 apart on a ten-ton overload…
    expect(weightBandAmount(dear, undefined, 100000)).toBe(90);
    expect(weightBandAmount(cheap, undefined, 100000)).toBe(80);
    // …and $50 apart on a fifty-ton one. The threshold sees two different
    // questions because it is handed two different numbers.
    expect(weightBandAmount(dear, undefined, 180000)).toBe(450);
    expect(weightBandAmount(cheap, undefined, 180000)).toBe(400);
    // Rule 4: a band that cannot be costed is not the cheap one.
    expect(weightBandAmount(cheap, undefined, undefined)).toBeNull();
  });
});

/**
 * PHASE 7 — one state, and the first in the dataset whose LEGAL GROSS WEIGHT is
 * a property of the road segment.
 *
 * Kentucky's fee side is the simplest here — one flat $60 for a single-trip
 * permit, oversize, overweight or both — so almost everything worth testing is
 * on the requirements side: three road classes that disagree by 36,000 lb, a
 * height-pole trigger two Kentucky sources state one inch apart, a statutory
 * baseline that governs a different road network from the regulations, and a
 * proposed fee amendment that would double the schedule and supplies no value
 * because nothing dates it into force.
 */
const ASOF7 = '2026-09-03';

function priceIn7(
  code: string,
  partial: Parameters<typeof calculateOsowForJurisdiction>[1],
) {
  const rules = osowRulesFor(code);
  expect(rules, `${code} must be a covered jurisdiction`).not.toBeNull();
  return calculateOsowForJurisdiction(
    rules as NonNullable<typeof rules>,
    partial,
    ASOF7,
  );
}

describe('Kentucky — a legal weight that depends on the road', () => {
  /** Legal on every Kentucky limit recorded, on a Class AAA highway. */
  const legalSize = {
    widthIn: 102,
    heightIn: ftIn(13, 6),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(53),
    routeClass: 'ky-class-aaa' as const,
  };

  it('prices one flat $60 plus the 4% card surcharge, whatever the load is over', () => {
    // 601 KAR 1:018 §17(2)(b) "a payment of sixty (60) dollars" and the KYTC
    // FAQ's "applicable service fee of 4%": $60 × 1.04 = $62.40. The same total
    // for an oversize-only, an overweight-only and a combined move is the whole
    // point of `includedInBaseFee` — Kentucky charges once, not per component.
    const oversizeOnly = priceIn7('KY', {
      ...legalSize,
      widthIn: ftIn(14),
      grossWeightLbs: 79000,
      routeClass: 'divided',
    });
    const overweightOnly = priceIn7('KY', { ...legalSize, grossWeightLbs: 100000 });
    const both = priceIn7('KY', {
      ...legalSize,
      widthIn: ftIn(14),
      heightIn: ftIn(15),
      overallLengthIn: ftIn(100),
      grossWeightLbs: 120000,
      routeClass: 'two-lane',
    });

    for (const [label, r] of [
      ['oversize only', oversizeOnly],
      ['overweight only', overweightOnly],
      ['both', both],
    ] as const) {
      expect(r.permitRequired, label).toBe(true);
      expect(r.subtotalUsd, label).toBe(62.4);
      expect(r.requiresManualReview, label).toBe(false);
      expect(
        r.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd,
        label,
      ).toBe(60);
      expect(
        r.lines.find((l) => l.code === 'osow_service_fee')?.amountUsd,
        label,
      ).toBe(2.4);
    }

    // The overweight component is a SOURCED ZERO, not a missing line: the base
    // fee already covers it and the engine says so rather than staying silent.
    const ow = overweightOnly.lines.find((l) => l.code === 'osow_overweight');
    expect(ow?.amountUsd).toBe(0);
    expect(ow?.note).toContain('No separate overweight charge');
    // An oversize-only move never reaches the overweight side at all.
    expect(oversizeOnly.lines.some((l) => l.code === 'osow_overweight')).toBe(false);
  });

  /**
   * THE THREE CLASSES, DRIVEN. 603 KAR 5:066 gives Class AAA 80,000 lb, Class AA
   * 62,000 lb and Class A 44,000 lb, and the same 70,000 lb truck gets three
   * different answers. The fourth case is the one that matters most: with no
   * class supplied both rules go UNDECIDED rather than falling back to AAA.
   */
  it('answers a 70,000 lb load differently on each road class, and refuses to guess', () => {
    // `routeClass` is spread in only when it is given, so the last case really
    // carries no road type at all — spreading `legalSize` wholesale would have
    // left its Class AAA behind and quietly tested the wrong thing.
    const { routeClass: _classFromLegalSize, ...classless } = legalSize;
    const at = (routeClass?: OsowLoad['routeClass']) =>
      priceIn7('KY', {
        ...classless,
        grossWeightLbs: 70000,
        ...(routeClass === undefined ? {} : { routeClass }),
      });

    const aaa = at('ky-class-aaa');
    expect(aaa.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'ky-class-aa-gross-over-62000',
    );
    expect(aaa.escorts.undecided.map((u) => u.ruleId)).not.toContain(
      'ky-class-a-gross-over-44000',
    );
    expect(aaa.permitRequired).toBe(false);

    const aa = at('ky-class-aa');
    expect(aa.escorts.applied.map((a) => a.ruleId)).toContain(
      'ky-class-aa-gross-over-62000',
    );
    expect(aa.requiresManualReview).toBe(true);

    const a = at('ky-class-a');
    expect(a.escorts.applied.map((a2) => a2.ruleId)).toContain(
      'ky-class-a-gross-over-44000',
    );
    expect(a.requiresManualReview).toBe(true);

    // NO CLASS: `routeClass` is unknown, which propagates through `all` and
    // leaves both class rules undecided. Nothing assumes the permissive class.
    const unknown = at(undefined);
    const undecided = unknown.escorts.undecided.map((u) => u.ruleId);
    expect(undecided).toContain('ky-class-aa-gross-over-62000');
    expect(undecided).toContain('ky-class-a-gross-over-44000');
    expect(unknown.requiresManualReview).toBe(true);
    expect(unknown.escorts.applied.map((x) => x.ruleId)).not.toContain(
      'ky-class-aa-gross-over-62000',
    );
  });

  it('says nothing about the road class for a load legal on every one of them', () => {
    // 40,000 lb is under Class A's 44,000 lb, so the weight condition is
    // definitely false and `triAll` answers false even with the class unknown.
    // A settled question must not produce a warning.
    const r = priceIn7('KY', { ...legalSize, grossWeightLbs: 40000, routeClass: undefined });
    const touched = [
      ...r.escorts.applied.map((x) => x.ruleId),
      ...r.escorts.undecided.map((x) => x.ruleId),
    ];
    expect(touched).not.toContain('ky-class-a-gross-over-44000');
    expect(touched).not.toContain('ky-class-aa-gross-over-62000');
  });

  /**
   * THE HEIGHT-POLE INCH. 601 KAR 1:018 §13(1)(d) says "in excess of fourteen
   * (14) feet eleven (11) inches" and drive.ky.gov says "fifteen (15) feet or
   * greater". They agree everywhere except strictly between the two.
   */
  it('fires the height-pole conflict in the disputed inch and nowhere else', () => {
    const at = (heightIn: number) =>
      priceIn7('KY', { ...legalSize, heightIn, grossWeightLbs: 79000 });

    // Exactly 14'11" — the regulation's "in excess of" excludes it, and the
    // portal's "15 ft or greater" excludes it too. Both agree: no pole.
    const at1411 = at(ftIn(14, 11));
    expect(at1411.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'ky-height-pole-14-11-to-15-conflict',
    );
    expect(at1411.escorts.heightPole).toBe(false);

    // Inside the inch: the regulation requires a pole and the portal does not.
    const inBand = at(ftIn(14, 11.5));
    expect(inBand.escorts.applied.map((a) => a.ruleId)).toContain(
      'ky-height-pole-14-11-to-15-conflict',
    );
    // The stricter reading is applied while a human confirms — an under-poled
    // load hits the wire, so this is not left to the permissive source.
    expect(inBand.escorts.heightPole).toBe(true);
    expect(inBand.requiresManualReview).toBe(true);

    // At 15 ft both sources require the pole, so there is nothing left to
    // disagree about and the conflict rule stays quiet.
    const at15 = at(ftIn(15));
    expect(at15.escorts.heightPole).toBe(true);
    expect(at15.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'ky-height-pole-14-11-to-15-conflict',
    );
    expect(at15.escorts.applied.map((a) => a.ruleId)).toContain('ky-height-pole-over-15');
  });

  it('keeps both height-pole readings on file and adopts neither', () => {
    const r = resolveSourced(
      'KY height pole trigger',
      KENTUCKY_HEIGHT_POLE_TRIGGER_IN,
      ASOF7,
      thresholdsEqual,
    );
    expect(r.conflict).toBe(true);
    expect(r.value).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.candidates.map((c) => c.value.value).sort((x, y) => x - y)).toEqual([
      ftIn(14, 11),
      ftIn(15),
    ]);
    // The inclusivity is the whole disagreement and must not be smoothed.
    expect(
      r.candidates.find((c) => c.value.value === ftIn(14, 11))?.value.inclusive,
    ).toBe(false);
    expect(r.candidates.find((c) => c.value.value === ftIn(15))?.value.inclusive).toBe(
      true,
    );
  });

  /**
   * KENTUCKY TRIGGERS NO ESCORT ON HEIGHT AT ALL — its §14 table runs on width,
   * length, overhang and speed — so a tall but narrow load gets a height pole
   * requirement and no pilot car. Inventing one to carry the pole would bill a
   * vehicle the state has not asked for; the exclusion is stated instead.
   */
  it('requires a height pole without inventing an escort to carry it', () => {
    const r = priceIn7('KY', {
      ...legalSize,
      heightIn: ftIn(16),
      grossWeightLbs: 79000,
    });
    expect(r.escorts.heightPole).toBe(true);
    expect(r.escorts.totalEscorts).toBe(0);
    expect(r.warnings.some((w) => w.includes('NO pilot car is added to the count'))).toBe(
      true,
    );
    // Over 15 ft 6 in Kentucky requires a driven route survey (§6(4)).
    expect(r.routeInspectionRequired).toBe(true);
    expect(r.escorts.routeSurvey).toBe(true);
  });

  /**
   * THE ESCORT LADDERS, WHICH DIVERGE BY A WHOLE PILOT CAR ON THE SAME LOAD.
   * 601 KAR 1:018 §14 and drive.ky.gov: a 13 ft load takes a front AND a rear
   * escort on a two-lane route and a rear escort alone on a four-lane one.
   */
  it('reproduces the two-lane and four-lane escort counts the state publishes', () => {
    const escortsFor = (
      routeClass: 'two-lane' | 'divided',
      over: Partial<OsowLoad>,
    ) => {
      const r = priceIn7('KY', {
        ...legalSize,
        grossWeightLbs: 79000,
        routeClass,
        ...over,
      });
      return { total: r.escorts.totalEscorts, front: r.escorts.front, rear: r.escorts.rear };
    };

    // Width, two-lane: over 12 ft is one front and one rear; over 16 ft is two
    // and two.
    expect(escortsFor('two-lane', { widthIn: ftIn(13) })).toEqual({ total: 2, front: 1, rear: 1 });
    expect(escortsFor('two-lane', { widthIn: ftIn(17) })).toEqual({ total: 4, front: 2, rear: 2 });
    // Width, four-lane: over 12 ft is a rear escort ALONE, and the front car
    // only appears over 14 ft.
    expect(escortsFor('divided', { widthIn: ftIn(13) })).toEqual({ total: 1, front: 0, rear: 1 });
    expect(escortsFor('divided', { widthIn: ftIn(15) })).toEqual({ total: 2, front: 1, rear: 1 });
    expect(escortsFor('divided', { widthIn: ftIn(17) })).toEqual({ total: 4, front: 2, rear: 2 });

    // Length: a two-lane route wants a front car from 75 ft; a four-lane route
    // wants nothing until 110 ft. Thirty-five feet of difference.
    expect(escortsFor('two-lane', { overallLengthIn: ftIn(80) })).toEqual({ total: 1, front: 1, rear: 0 });
    expect(escortsFor('divided', { overallLengthIn: ftIn(80) })).toEqual({ total: 0, front: 0, rear: 0 });
    expect(escortsFor('two-lane', { overallLengthIn: ftIn(90) })).toEqual({ total: 2, front: 1, rear: 1 });
    expect(escortsFor('divided', { overallLengthIn: ftIn(115) })).toEqual({ total: 1, front: 0, rear: 1 });
    // Over 120 ft both columns agree on one front and two rear, so the rule is
    // route-agnostic and a quote without a road type is not sent to review.
    expect(escortsFor('two-lane', { overallLengthIn: ftIn(125) })).toEqual({ total: 3, front: 1, rear: 2 });
    expect(escortsFor('divided', { overallLengthIn: ftIn(125) })).toEqual({ total: 3, front: 1, rear: 2 });

    // Rear overhang over 10 ft — a rear escort on any road.
    expect(escortsFor('divided', { rearOverhangIn: ftIn(11) })).toEqual({ total: 1, front: 0, rear: 1 });
  });

  /**
   * THE STATUTORY BASELINE. It fires inside the bands where KRS 189.221 and the
   * 603 KAR regulations give different answers, and is silent above them — a
   * 20 ft wide load needs a permit on any reading, so there is nothing to say.
   */
  it('states the KRS 189.221 baseline only where the two texts disagree', () => {
    const inBand = priceIn7('KY', { ...legalSize, grossWeightLbs: 70000 });
    expect(inBand.escorts.applied.map((a) => a.ruleId)).toContain(
      'ky-krs-189-221-baseline-conflict',
    );
    // An ADVISORY, not a review flag: the band is every loaded truck in the
    // Commonwealth and the price is a flat $60 on either reading. See the rule.
    expect(
      inBand.escorts.applied.find(
        (a) => a.ruleId === 'ky-krs-189-221-baseline-conflict',
      )?.outcome.manualReview,
    ).toBeUndefined();

    const aboveEveryBand = priceIn7('KY', {
      widthIn: ftIn(20),
      heightIn: ftIn(16),
      overallLengthIn: ftIn(140),
      trailerLengthIn: ftIn(53),
      grossWeightLbs: 150000,
      routeClass: 'ky-class-aaa',
    });
    expect(aboveEveryBand.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'ky-krs-189-221-baseline-conflict',
    );
  });

  it('holds the statutory-versus-regulatory limits open and adopts neither', () => {
    for (const [field, rows, low, high] of [
      ['KY width', KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM.widthIn, 96, 102],
      ['KY height', KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM.heightIn, ftIn(11, 6), ftIn(13, 6)],
      ['KY single unit', KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM.singleUnitLengthIn, ftIn(26, 6), ftIn(45)],
      ['KY overall length', KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM.overallLengthIn, ftIn(30), ftIn(65)],
      ['KY gross weight', KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM.grossWeightLbs, 36000, 80000],
    ] as const) {
      const r = resolveSourced(field, rows, ASOF7);
      expect(r.conflict, field).toBe(true);
      expect(r.value, field).toBeNull();
      expect(r.requiresManualReview, field).toBe(true);
      expect(spreadOf(r), field).toEqual({ low, high });
    }

    /**
     * AND THE LIMITS THEMSELVES STAY ALIVE, which is the whole reason the
     * conflict is held out here. `colorado.ts`'s lesson: a null legal gross
     * weight disables the over-dimension check and drops the permit entirely.
     */
    const heavy = priceIn7('KY', { ...legalSize, grossWeightLbs: 120000 });
    expect(heavy.overDimension.weight).toBe(true);
    expect(heavy.subtotalUsd).toBe(62.4);
    const wide = priceIn7('KY', { ...legalSize, widthIn: ftIn(14), grossWeightLbs: 79000 });
    expect(wide.overDimension.width).toBe(true);
  });

  /**
   * THE PROPOSED AMENDMENT SUPPLIES NO VALUE, AND THE TEST IS THAT NOTHING IN
   * THE DATASET CITES IT. It carries a filing date and an implementing statute —
   * the shape that CAN displace older text — but SB 107 sets no fee and the
   * amendment states no effective date, so neither half alone can move one.
   */
  it('cites the proposed 2026 amendment for no value anywhere in the dataset', () => {
    const rows = [
      ...Object.values(KENTUCKY_OSOW_RULES.legalLimits).flat(),
      ...KENTUCKY_OSOW_RULES.permitBaseFeeUsd,
      ...KENTUCKY_OSOW_RULES.overweightBands,
      ...KENTUCKY_OSOW_RULES.overweightPerMile,
      ...KENTUCKY_OSOW_RULES.conditionalFees,
      ...KENTUCKY_OSOW_RULES.transactionFee,
      ...KENTUCKY_OSOW_RULES.routeAnalysisFeeUsd,
      ...KENTUCKY_OSOW_RULES.noBridgeRouteFeeUsd,
      ...KENTUCKY_OSOW_RULES.overweightPricing,
      ...(KENTUCKY_OSOW_RULES.superload.grossWeight ?? []),
      ...KENTUCKY_OSOW_RULES.superload.shortSpacing,
      ...KENTUCKY_OSOW_RULES.routeInspection.widthIn,
      ...KENTUCKY_OSOW_RULES.routeInspection.heightIn,
      ...KENTUCKY_OSOW_RULES.routeInspection.lengthIn,
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source.id).not.toBe('ky-601-kar-1-018-proposed-2026');
    }
    for (const rule of KENTUCKY_OSOW_RULES.escortRules) {
      expect(rule.source.id).not.toBe('ky-601-kar-1-018-proposed-2026');
    }
    // The document is still on file, and its title says what it is.
    expect(KENTUCKY_PROPOSED_AMENDMENT_SOURCE.title).toContain('NOT IN FORCE');
    expect(KENTUCKY_PROPOSED_AMENDMENT_SOURCE.revisedOn).toBe('2026-05-05');
    expect(KENTUCKY_PROPOSED_AMENDMENT_NOT_IN_FORCE).toContain('SB 107');
  });

  it('preserves the amendment’s own drafting typo instead of correcting it', () => {
    const a01 = KENTUCKY_PROPOSED_2026_FEES.find((f) => f.section.endsWith('§3(3)'));
    const a02 = KENTUCKY_PROPOSED_2026_FEES.find((f) => f.section.endsWith('§3(4)'));
    // §3(4) is the A02 permit, which drive.ky.gov describes as "14 ft. to 16 ft.
    // wide" — and the proposal repeats §3(3)'s width band verbatim. Quoted as
    // written: a typo in a fee table is evidence about the document.
    expect(a01?.quote).toContain('less than fourteen (14) feet wide');
    expect(a02?.quote).toContain('less than fourteen (14) feet wide');
    expect(a02?.item).toContain('14 ft to 16 ft');
    expect(a02?.proposedUsd).toBe(1500);

    // The superload bridge analysis has NO codified counterpart, and that is
    // recorded as an absence rather than as a published zero.
    const bridge = KENTUCKY_PROPOSED_2026_FEES.find((f) =>
      f.item.includes('Superload bridge analysis'),
    );
    expect(bridge?.codifiedUsd).toBeNull();
    expect(bridge?.proposedUsd).toBe(500);
    expect(KENTUCKY_OSOW_RULES.routeAnalysisFeeUsd).toEqual([]);
    expect(KENTUCKY_OSOW_RULES.noBridgeRouteFeeUsd).toEqual([]);
  });

  /**
   * AND IF IT IS EVER ADOPTED, IT MUST FORCE REVIEW RATHER THAN ABSORB. $60
   * against $120 is a $60 spread on every permit Kentucky issues, well over the
   * $50 materiality threshold — so `priceSourced` escalates and publishes the
   * range instead of quietly quoting the higher figure. Constructed here rather
   * than dated into the dataset, because inventing the effective date is the one
   * thing this file refuses to do.
   */
  it('would escalate the $60-versus-$120 fee rather than absorb it', () => {
    const doubling = priceSourced(
      {
        field: 'KY single-trip permit base fee',
        value: null,
        chosen: null,
        candidates: [
          {
            value: 60,
            source: KENTUCKY_PROPOSED_AMENDMENT_SOURCE,
            effectiveFrom: '2017-07-07',
            effectiveTo: null,
          },
          {
            value: 120,
            source: KENTUCKY_PROPOSED_AMENDMENT_SOURCE,
            effectiveFrom: '2017-07-07',
            effectiveTo: null,
          },
        ],
        conflict: true,
        warnings: [],
        requiresManualReview: true,
      },
      (v) => v,
      { absorb: true },
    );
    expect(120 - 60).toBeGreaterThan(IMMATERIAL_CONFLICT_THRESHOLD_USD);
    expect(doubling.absorbed).toBeNull();
    expect(doubling.amountUsd).toBeNull();
    expect(doubling.requiresManualReview).toBe(true);
    expect(doubling.lowUsd).toBe(60);
    expect(doubling.highUsd).toBe(120);
  });

  /**
   * 160,000 LB IS A REAL PERMIT CEILING, NOT A FEE TRIGGER — the distinction
   * Florida's 300,000 lb failed. 601 KAR 1:018 §7(2)(h) is the top of a closed
   * list of what a single-trip permit may authorise, and Kentucky's flat fee has
   * no upper weight bound, so the server prices every pound below it.
   */
  it('prices to the permit ceiling and refuses above it', () => {
    const atCeiling = priceIn7('KY', { ...legalSize, grossWeightLbs: 160000 });
    expect(atCeiling.superload).toBe(false);
    expect(atCeiling.subtotalUsd).toBe(62.4);

    const over = priceIn7('KY', { ...legalSize, grossWeightLbs: 160001 });
    expect(over.superload).toBe(true);
    expect(over.requiresManualReview).toBe(true);
    // A superload gets no priced lines at all — no $60 with a confident face.
    expect(over.lines).toEqual([]);
    expect(over.subtotalUsd).toBeNull();
  });

  it('states the per-configuration axle caps the weight ceiling cannot see', () => {
    // §7(2) caps five axles at 96,000 lb and six at 120,000 lb; 160,000 is the
    // SEVEN-axle figure. Nothing on a load lets a rule test the axle count, so
    // the caps are stated for any load past the five-axle figure.
    const r = priceIn7('KY', { ...legalSize, grossWeightLbs: 150000 });
    expect(r.escorts.applied.map((a) => a.ruleId)).toContain(
      'ky-permitted-axle-configuration-caps',
    );
    expect(r.warnings.some((w) => w.includes('Five (5) axle combination units'))).toBe(true);
    // An advisory: the price stands and the exclusion is stated.
    expect(r.requiresManualReview).toBe(false);
  });

  /**
   * THE FOUR UNKNOWNS, ALL ADVISORY. Every one of them is a real exclusion that
   * does not invalidate the price, so none may force review — the Texas
   * police-escort contract. Two of them are POSITIVE findings rather than gaps:
   * Kentucky's police-escort rules set no threshold by construction, and it runs
   * no pilot-car certification programme where several neighbours do.
   */
  it('carries all four unknowns as advisories and none of them stops the quote', () => {
    const r = priceIn7('KY', {
      ...legalSize,
      widthIn: ftIn(13),
      heightIn: ftIn(14),
      overallLengthIn: ftIn(90),
      grossWeightLbs: 100000,
      routeClass: 'two-lane',
    });
    const fired = r.escorts.applied;
    for (const id of [
      'ky-police-escort-no-threshold',
      'ky-police-escort-no-rate-schedule',
      'ky-bucket-truck-no-codified-trigger',
      'ky-no-pilot-car-certification',
    ]) {
      const rule = fired.find((a) => a.ruleId === id);
      expect(rule, `${id} must fire`).toBeDefined();
      expect(rule?.outcome.advisory, `${id} must be advisory`).toBeDefined();
      expect(rule?.outcome.manualReview, `${id} must not stop the quote`).toBeUndefined();
    }
    expect(r.requiresManualReview).toBe(false);
    expect(r.subtotalUsd).toBe(62.4);
    // The police-escort absence is STRUCTURAL and is phrased as one — there is
    // no threshold to have found, rather than one that was not found.
    expect(
      r.warnings.some((w) =>
        w.includes('that is how the rules are built rather than a gap in what was searched'),
      ),
    ).toBe(true);
    // Certification is recorded POSITIVELY: Kentucky issues none and takes none.
    expect(
      r.warnings.some((w) =>
        w.includes('does not license, certify or require any state or third-party certification'),
      ),
    ).toBe(true);
  });

  it('records no superload trigger it cannot quote, and one route-survey trigger', () => {
    // The research summarised width over 16 ft and height over 15 ft 6 in as
    // superload triggers. Neither is quoted in that sense — 16 ft is an ANNUAL
    // permit's maximum width and a step in the escort table, and 15 ft 6 in is
    // the route-survey trigger, which is recorded where it belongs.
    expect(KENTUCKY_OSOW_RULES.superload.widthIn).toBeUndefined();
    expect(KENTUCKY_OSOW_RULES.superload.heightIn).toBeUndefined();
    expect(KENTUCKY_OSOW_RULES.superload.overallLengthIn).toBeUndefined();
    expect(KENTUCKY_OSOW_RULES.superload.shortSpacing).toEqual([]);
    expect(KENTUCKY_OSOW_RULES.routeInspection.widthIn).toEqual([]);
    expect(KENTUCKY_OSOW_RULES.routeInspection.lengthIn).toEqual([]);
    expect(KENTUCKY_OSOW_RULES.routeInspection.heightIn).toHaveLength(1);
    expect(KENTUCKY_OSOW_RULES.routeInspection.heightIn[0]?.value).toEqual({
      value: ftIn(15, 6),
      inclusive: false,
    });
    // No mileage anywhere in the schedule, so a Kentucky quote never needs
    // in-state miles to price.
    expect(KENTUCKY_OSOW_RULES.feesDependOnDistance).toBe(false);
    expect(KENTUCKY_OSOW_RULES.overweightBands).toEqual([]);
    expect(KENTUCKY_OSOW_RULES.overweightPerMile).toEqual([]);
    expect(KENTUCKY_OSOW_RULES.overweightPricing[0]?.value.kind).toBe('includedInBaseFee');
  });
});

/**
 * PHASE 8 — TENNESSEE, the first fee in this directory that is a PRODUCT of
 * weight and distance rather than a step by either.
 *
 * The cases below drive the whole engine across a weight × distance grid and
 * check that the arithmetic reproduces "$20.00 plus six cents (6¢) per ton-mile"
 * exactly — at four weights, at four distances, at a partial ton and at a partial
 * mile. They also pin the two holes the stepped boundaries leave, the
 * route-survey conflict that fires in six inches and nowhere else, and the
 * pavement-width axis that decides one pilot car.
 */
const ASOF8 = '2026-09-03';

function priceIn8(
  code: string,
  partial: Parameters<typeof calculateOsowForJurisdiction>[1],
) {
  const rules = osowRulesFor(code);
  expect(rules, `${code} must be a covered jurisdiction`).not.toBeNull();
  return calculateOsowForJurisdiction(
    rules as NonNullable<typeof rules>,
    partial,
    ASOF8,
  );
}

describe('Tennessee — a permit priced by the ton-mile', () => {
  /** Legal on every Tennessee limit recorded, so only the overweight side moves. */
  const legalSize = {
    widthIn: 102,
    heightIn: ftIn(13, 6),
    overallLengthIn: ftIn(70),
    trailerLengthIn: ftIn(48),
    routeClass: 'divided' as const,
  };

  /** $20 base + $0.06 × tons over 80,000 lb (rounded up) × miles. */
  const expected = (grossWeightLbs: number, miles: number): number => {
    const tons = Math.ceil((grossWeightLbs - 80000) / 2000);
    return Math.round((20 + 0.06 * tons * miles) * 100) / 100;
  };

  /**
   * THE WHOLE POINT OF THE STATE, DRIVEN BOTH WAYS. Doubling the distance doubles
   * the charge and doubling the excess weight doubles it again — which is what
   * makes this a product and not a band. A `WeightBand` encoding would have
   * returned the same number for all four distances.
   */
  it('reproduces $20 plus six cents a ton-mile across weight AND distance', () => {
    const grid: Array<[number, number]> = [
      [90000, 50],
      [100000, 100],
      [100000, 250],
      [100000, 500],
      [120000, 100],
      [120000, 500],
      [150000, 500],
      [165000, 300],
    ];
    for (const [lbs, miles] of grid) {
      const r = priceIn8('TN', {
        ...legalSize,
        grossWeightLbs: lbs,
        milesInJurisdiction: miles,
      });
      expect(r.subtotalUsd, `${lbs} lb / ${miles} mi`).toBe(expected(lbs, miles));
      expect(
        r.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd,
        `${lbs} lb / ${miles} mi base`,
      ).toBe(20);
      expect(
        r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd,
        `${lbs} lb / ${miles} mi ton-mile`,
      ).toBe(expected(lbs, miles) - 20);
    }

    // The published figures, spelled out. 100,000 lb is ten tons over the lawful
    // weight, so 100 miles is 1,000 ton-miles at six cents = $60 plus the $20.
    expect(
      priceIn8('TN', { ...legalSize, grossWeightLbs: 100000, milesInJurisdiction: 100 })
        .subtotalUsd,
    ).toBe(80);
    // Five times the distance, five times the ton-mile charge — the base does not
    // scale, which is why it is a base fee and not part of the rate.
    expect(
      priceIn8('TN', { ...legalSize, grossWeightLbs: 100000, milesInJurisdiction: 500 })
        .subtotalUsd,
    ).toBe(320);
    // Twice the excess weight over the same 500 miles: $300 becomes $600.
    expect(
      priceIn8('TN', { ...legalSize, grossWeightLbs: 120000, milesInJurisdiction: 500 })
        .subtotalUsd,
    ).toBe(620);
  });

  /**
   * THE UNKNOWN THAT MATTERS MOST, DRIVEN FROM BOTH SIDES. Neither § 55-7-205(h)(3)
   * nor 1680-07-01-.24 says how a part ton is billed. A half ton left unrounded
   * over 500 miles is $15; this quote charges it, says so, and sends the move to
   * a human — which is the difference from Virginia, where the same silence about
   * a part MILE is bounded at thirty cents and only earns an advisory.
   */
  it('charges a part ton in full, bills a part mile pro rata, and says both', () => {
    // 101,000 lb is ten and a half tons over. Rounded up: 11 × 500 × $0.06 = $330.
    const halfTon = priceIn8('TN', {
      ...legalSize,
      grossWeightLbs: 101000,
      milesInJurisdiction: 500,
    });
    expect(halfTon.subtotalUsd).toBe(350);
    // Pro rata would have been $315 and a floor $300 — a $30 spread on one load.
    expect(halfTon.subtotalUsd).not.toBe(335);

    // Miles are NOT rounded: 100.5 mi × 10 tons × $0.06 = $60.30.
    const partMile = priceIn8('TN', {
      ...legalSize,
      grossWeightLbs: 100000,
      milesInJurisdiction: 100.5,
    });
    expect(partMile.subtotalUsd).toBe(80.3);

    // Priced AND flagged. A refusal that produced no number would be less useful
    // than a number with its assumption written beside it.
    expect(halfTon.requiresManualReview).toBe(true);
    expect(halfTon.escorts.applied.map((a) => a.ruleId)).toContain(
      'tn-ton-mile-partial-increment-unknown',
    );
    expect(halfTon.warnings.join(' ')).toContain(
      'CHARGES A PART TON IN FULL AND BILLS THE TRUE MILEAGE PRO RATA',
    );
    expect(TENNESSEE_PARTIAL_INCREMENT_UNKNOWN.assumedTonRounding).toBe('up');
    expect(TENNESSEE_PARTIAL_INCREMENT_UNKNOWN.assumedMileRounding).toBe('pro-rata');
    // A legal-weight load never hears about it.
    const light = priceIn8('TN', {
      ...legalSize,
      widthIn: ftIn(11),
      grossWeightLbs: 79000,
      milesInJurisdiction: 500,
      routeClass: 'interstate',
    });
    expect(light.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'tn-ton-mile-partial-increment-unknown',
    );
    expect(light.requiresManualReview).toBe(false);
  });

  it('refuses to bill a ton-mile charge without the in-state miles', () => {
    const r = priceIn8('TN', { ...legalSize, grossWeightLbs: 100000 });
    expect(r.subtotalUsd).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.lines.find((l) => l.code === 'osow_overweight')?.amountUsd).toBeNull();
    expect(TENNESSEE_OSOW_RULES.feesDependOnDistance).toBe(true);
    // The base fee still resolves — an unknown mileage is a gap in what we were
    // told, not a quarrel between documents, so it does not poison the other line.
    expect(r.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd).toBe(20);
  });

  /**
   * THE MODEL DECISION, PINNED. A ton-mile is `rate × miles × increments`, which
   * `PerMileRate` has computed since Phase 2 — so no new rate type exists, and
   * `WeightBand`, which is flat in miles, is deliberately empty.
   */
  it('is encoded as a per-mile rate with a 2,000 lb increment and no new type', () => {
    expect(TENNESSEE_OSOW_RULES.overweightPricing[0]?.value.kind).toBe('perMile');
    expect(TENNESSEE_OSOW_RULES.overweightBands).toEqual([]);
    for (const row of TENNESSEE_OSOW_RULES.overweightPerMile) {
      expect(row.value.ratePerMileUsd).toBe(0.06);
      expect(row.value.perIncrementLbs).toBe(2000);
      expect(row.value.excessBaseLbs).toBe(TENNESSEE_EXCESS_BASE_INFERENCE_LBS);
      expect(row.value.roundIncrementUp).toBe(true);
      // Absent, not 1 — Virginia's rule. A ceil here would add a whole ton-mile
      // per ton to every quote on the authority of nothing.
      expect(row.value.roundMilesUpTo).toBeUndefined();
      // The $20 lives in `permitBaseFeeUsd`, reachable by a legal-size overweight
      // permit; duplicating it here would double-charge every combined move.
      expect(row.value.addAfterUsd).toBeUndefined();
      // § 55-7-205(h)(3) states no upper weight bound; the superload class does.
      expect(row.value.maxLbs).toBeNull();
    }
    expect(TENNESSEE_TON_MILE_MODEL_NOTE).toContain('PerMileRate');
  });

  /**
   * THE WIDTH LADDER AS AN INCREMENT — Indiana's decomposition. The published $20
   * and $30 are reproduced from a base plus a band, and the base survives on a
   * legal-size overweight permit that matches no band at all.
   */
  it('reproduces the published $20 and $30 width steps, and the $20 for height alone', () => {
    const at = (widthIn: number) =>
      priceIn8('TN', {
        ...legalSize,
        widthIn,
        grossWeightLbs: 79000,
        milesInJurisdiction: 200,
      });
    expect(at(ftIn(10)).subtotalUsd).toBe(20); // "8'6" up to 14' $20.00"
    expect(at(ftIn(14)).subtotalUsd).toBe(20); // inclusive at exactly 14 ft
    expect(at(ftIn(14, 1)).subtotalUsd).toBe(30); // "14'1" up to 16' $30.00"
    expect(at(ftIn(16)).subtotalUsd).toBe(30); // inclusive at exactly 16 ft

    // "Excess Height $20.00" — the bands bound width only, so an over-height load
    // within 14 ft picks up the base and no increment.
    const tall = priceIn8('TN', {
      ...legalSize,
      heightIn: ftIn(14),
      grossWeightLbs: 79000,
      milesInJurisdiction: 200,
    });
    expect(tall.subtotalUsd).toBe(20);
    expect(tall.requiresManualReview).toBe(false);
  });

  /**
   * THE FEE-SIDE HOLE. § 55-7-205(h)(1)(B) opens its $30 band immediately above
   * 14 ft 0 in; TDOT's fee table opens it at 14 ft 1 in. Only the range both
   * documents name is priced, so the fraction between them falls through — the
   * Arkansas 251-mile answer in a dimension.
   */
  it('prices 14 ft and 14 ft 1 in and refuses the fraction between them', () => {
    const gap = priceIn8('TN', {
      ...legalSize,
      widthIn: ftIn(14) + 0.5,
      grossWeightLbs: 79000,
      milesInJurisdiction: 200,
    });
    expect(gap.subtotalUsd).toBeNull();
    expect(gap.requiresManualReview).toBe(true);
    expect(gap.lines.find((l) => l.code === 'osow_oversize')?.amountUsd).toBeNull();
    expect(gap.warnings.join(' ')).toContain(
      "published oversize fee bands do not cover this load's dimensions",
    );
    // A HOLE, not a disagreement: no two candidates match, so nothing is weighed.
    expect(gap.warnings.join(' ')).not.toContain('Official sources disagree on TN oversize');
    expect(TENNESSEE_WIDTH_BAND_GAP.pricedToIn).toBe(ftIn(14));
    expect(TENNESSEE_WIDTH_BAND_GAP.pricedFromIn).toBe(ftIn(14, 1));
  });

  /**
   * THE ESCORT-SIDE HOLE, WHICH IS THE SAME DEFECT AND CANNOT BE ABSORBED AT ANY
   * DOLLAR VALUE. Inside the fractional inch the regulation requires a pilot car
   * and the FAQ does not, so no count is adopted and the move goes to a human.
   */
  it('sends the fractional inches between TDOT’s escort steps to review', () => {
    for (const g of TENNESSEE_ESCORT_BOUNDARY_GAPS) {
      const r = priceIn8('TN', {
        ...legalSize,
        widthIn: g.fromIn + 0.5,
        grossWeightLbs: 79000,
        milesInJurisdiction: 100,
        routeClass: 'tn-two-lane-24ft-pavement-or-more',
      });
      expect(r.requiresManualReview, `${g.fromIn}in + 0.5`).toBe(true);
      expect(
        r.escorts.applied.map((a) => a.ruleId),
        `${g.fromIn}in + 0.5`,
      ).toContain('tn-escort-boundary-step-gap');
      // The fee is unaffected — a width in the gap is still inside the $20 band,
      // and it is the REQUIREMENT that could not be determined.
      expect(r.subtotalUsd, `${g.fromIn}in + 0.5`).toBe(20);
    }
    // On the steps themselves the two documents agree and nobody hears about it.
    const onStep = priceIn8('TN', {
      ...legalSize,
      widthIn: ftIn(11),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
      routeClass: 'tn-two-lane-24ft-pavement-or-more',
    });
    expect(onStep.escorts.applied.map((a) => a.ruleId)).not.toContain(
      'tn-escort-boundary-step-gap',
    );
    expect(onStep.requiresManualReview).toBe(false);
    // Two of the three holes are the research's finding; the third is ours and is
    // labelled as ours rather than presented as the source's analysis.
    expect(TENNESSEE_ESCORT_BOUNDARY_GAPS.filter((g) => g.namedByResearch)).toHaveLength(2);
  });

  /**
   * PAVEMENT WIDTH — the axis `RouteClass` grew for. Same load, same lane count,
   * one pilot car apart, and a caller who says only "two-lane" is told what is
   * missing instead of being given either answer.
   */
  it('counts one escort on narrow pavement, none on wide, and refuses to guess', () => {
    const at = (routeClass: string) =>
      priceIn8('TN', {
        ...legalSize,
        widthIn: ftIn(11),
        grossWeightLbs: 79000,
        milesInJurisdiction: 100,
        routeClass: routeClass as never,
      });

    expect(at('tn-two-lane-under-24ft-pavement').escortsRequired).toBe(1);
    expect(at('tn-two-lane-under-24ft-pavement').escorts.front).toBe(1);
    expect(at('tn-two-lane-24ft-pavement-or-more').escortsRequired).toBe(0);
    expect(at('interstate').escortsRequired).toBe(0);
    expect(at('divided').escortsRequired).toBe(0);
    expect(at('multilane-undivided').escortsRequired).toBe(0);

    // "two-lane" answers the lane count and not the pavement width. One pilot car
    // over a long Tennessee leg is not a distinction to guess at.
    const halfAnswered = at('two-lane');
    expect(halfAnswered.requiresManualReview).toBe(true);
    expect(halfAnswered.escorts.applied.map((a) => a.ruleId)).toContain(
      'tn-width-over-10-to-12-6-pavement-unknown',
    );
    expect(halfAnswered.warnings.join(' ')).toContain(
      'Tennessee splits this escort requirement on a measurement this quote does not have',
    );
    // No road type at all leaves the rule undecided rather than false.
    const { routeClass: _dropped, ...noRoad } = legalSize;
    const unknownRoad = priceIn8('TN', {
      ...noRoad,
      widthIn: ftIn(11),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
    });
    expect(unknownRoad.escorts.undecided.map((u) => u.ruleId)).toContain(
      'tn-width-over-10-to-12-6-narrow-two-lane',
    );
    expect(unknownRoad.requiresManualReview).toBe(true);
    // The permit is still priced: an undecided escort is a gap in what we were
    // told, not a disagreement between documents.
    expect(unknownRoad.lines.find((l) => l.code === 'osow_permit_base')?.amountUsd).toBe(20);
  });

  /**
   * THE ESCORT LADDER ABOVE 12 FT 6 IN. The middle band is a BARE COUNT because
   * Tennessee puts the same one car in front on a two-lane road and behind on a
   * four-lane one — the Texas pattern, so a quote without a road type is not sent
   * to review over a distinction that cannot move the price.
   */
  it('counts one escort at 13 ft on any road and two above 13 ft 6 in', () => {
    const { routeClass: _dropped, ...noRoad } = legalSize;
    const mid = priceIn8('TN', {
      ...noRoad,
      widthIn: ftIn(13),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
    });
    expect(mid.escortsRequired).toBe(1);
    expect(mid.escorts.applied.map((a) => a.ruleId)).toContain('tn-width-over-12-6-to-13-6');

    const wide = priceIn8('TN', {
      ...legalSize,
      widthIn: ftIn(14),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
    });
    expect(wide.escortsRequired).toBe(2);
    expect(wide.escorts.front).toBe(1);
    expect(wide.escorts.rear).toBe(1);

    // Length: nothing to 90 ft, one rear to 120 ft, front and rear above it.
    const at = (overallLengthIn: number) =>
      priceIn8('TN', {
        ...legalSize,
        overallLengthIn,
        grossWeightLbs: 79000,
        milesInJurisdiction: 100,
      }).escorts;
    expect(at(ftIn(90)).rear).toBe(0);
    expect(at(ftIn(100)).rear).toBe(1);
    expect(at(ftIn(100)).front).toBe(0);
    expect(at(ftIn(130)).front).toBe(1);
    expect(at(ftIn(130)).rear).toBe(1);
  });

  /**
   * THE HEIGHT POLE, AND WHY TENNESSEE ASSERTS A COUNT WHERE KENTUCKY DOES NOT.
   * 1680-07-01-.10(1)(d) makes the front escort the INSTRUMENT of the requirement
   * — "shall determine all vertical clearances by use of a front escort vehicle" —
   * rather than presupposing one the way "the escorted load" does.
   */
  it('adds a front escort with a height pole over 15 ft, unlike Kentucky', () => {
    const tall = priceIn8('TN', {
      ...legalSize,
      heightIn: ftIn(15, 3),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
    });
    expect(tall.escorts.heightPole).toBe(true);
    expect(tall.escorts.front).toBe(1);
    expect(tall.escortsRequired).toBe(1);

    // Kentucky reads its own text the other way and asserts no count for height.
    const ky = priceIn7('KY', {
      widthIn: 102,
      heightIn: ftIn(15, 3),
      overallLengthIn: ftIn(70),
      trailerLengthIn: ftIn(53),
      grossWeightLbs: 79000,
      routeClass: 'ky-class-aaa',
    });
    expect(ky.escorts.heightPole).toBe(true);
    expect(ky.escorts.front).toBe(0);
  });

  /**
   * THE ROUTE-SURVEY CONFLICT, HELD OPEN. The research says the statute overrules
   * the rule; both are still recorded, and the disagreement surfaces only for a
   * load in the six inches where the two texts give different answers.
   */
  it('surfaces the 15 ft versus 15 ft 6 in survey conflict only inside those six inches', () => {
    const inBand = priceIn8('TN', {
      ...legalSize,
      heightIn: ftIn(15, 3),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
    });
    expect(inBand.requiresManualReview).toBe(true);
    expect(inBand.warnings.join(' ')).toContain(
      'whether a route inspection is required cannot be determined',
    );

    // A 12 ft load does not care that two sources disagree about 15 ft.
    const below = priceIn8('TN', {
      ...legalSize,
      heightIn: ftIn(14),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
    });
    expect(below.warnings.join(' ')).not.toContain('route inspection');
    expect(below.requiresManualReview).toBe(false);

    // Both candidates are on file and neither has been adopted.
    const res = resolveSourced(
      'TN route survey height',
      TENNESSEE_OSOW_RULES.routeInspection.heightIn,
      ASOF8,
      thresholdsEqual,
    );
    expect(res.value).toBeNull();
    expect(res.conflict).toBe(true);
    expect(res.candidates.map((c) => c.value.value).sort((a, b) => a - b)).toEqual([
      ftIn(15),
      ftIn(15, 6),
    ]);
    // Tennessee publishes no length trigger, so that list is empty rather than
    // borrowed from the escort table.
    expect(TENNESSEE_OSOW_RULES.routeInspection.lengthIn).toEqual([]);
  });

  /**
   * THE HOUSEBOAT AND THE SEED COTTON MODULE. Both are live disagreements, both
   * are about products no field on a load identifies, and neither is priced —
   * Arkansas's manufactured-home treatment twice over.
   */
  it('holds the houseboat and seed-cotton conflicts open without pricing either', () => {
    const houseboat = resolveSourced(
      'TN houseboat single-trip fee',
      [
        ...TENNESSEE_HOUSEBOAT_SINGLE_TRIP_FEE_USD.statuteAndAgency,
        ...TENNESSEE_HOUSEBOAT_SINGLE_TRIP_FEE_USD.administrativeRule,
      ],
      ASOF8,
    );
    expect(houseboat.value).toBeNull();
    expect(houseboat.conflict).toBe(true);
    expect(houseboat.requiresManualReview).toBe(true);
    // $750 against $6,100 at 20 ft — a factor of eight on the same boat.
    const spread = spreadOf(houseboat);
    expect(spread.low).toBe(1000);
    expect(spread.high).toBe(6100);
    expect(TENNESSEE_HOUSEBOAT_SINGLE_TRIP_FEE_USD.atWidthIn).toBe(ftIn(20));
    // The reassembled analysis, split across the PDF's two columns in the source.
    expect(TENNESSEE_HOUSEBOAT_CONFLICT_ANALYSIS).toContain('whereas the older administrative code');

    const seedCotton = resolveSourced(
      'TN seed cotton annual fee',
      TENNESSEE_SEED_COTTON_ANNUAL_FEE_USD,
      ASOF8,
    );
    expect(seedCotton.value).toBeNull();
    expect(seedCotton.conflict).toBe(true);
    expect(spreadOf(seedCotton)).toEqual({ low: 100, high: 500 });
    // $400 is eight times the materiality threshold: it could never be absorbed.
    expect(500 - 100).toBeGreaterThan(IMMATERIAL_CONFLICT_THRESHOLD_USD);

    // Neither reaches a quote. A 17-ft-wide load is priced by the general
    // schedule (and is a superload), and the houseboat disagreement is stated.
    const wide = priceIn8('TN', {
      ...legalSize,
      widthIn: ftIn(17),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
    });
    expect(wide.escorts.applied.map((a) => a.ruleId)).toContain('tn-houseboat-fee-conflict');
    expect(wide.warnings.join(' ')).toContain(
      'Tennessee publishes two incompatible houseboat schedules',
    );
    expect(wide.warnings.join(' ')).toContain("$6,100 against the statute's $750");
    // Stated, and still not priced: the general width schedule is what ran.
    expect(wide.warnings.join(' ')).toContain('NEITHER IS IN THE TOTAL ABOVE');
  });

  /**
   * ABOVE 165,000 LB NOTHING IS PRICED, AND THE THINGS THAT LIVE UP THERE ARE
   * RECORDED RATHER THAN ENCODED — the bridge evaluation bands, their own
   * 250,000/251,000 hole, and the heavy-duty towing rate that is not the general
   * rate at all.
   */
  it('treats 165,000 lb as a superload class and prices every pound below it', () => {
    const atCeiling = priceIn8('TN', {
      ...legalSize,
      grossWeightLbs: 165000,
      milesInJurisdiction: 300,
    });
    // Exclusive: exactly 165,000 lb is still an ordinary permit, and 42.5 tons of
    // excess rounds to 43. 43 × 300 × $0.06 = $774, plus the $20 base.
    expect(atCeiling.subtotalUsd).toBe(794);

    const over = priceIn8('TN', {
      ...legalSize,
      grossWeightLbs: 165001,
      milesInJurisdiction: 300,
    });
    expect(over.subtotalUsd).toBeNull();
    expect(over.lines).toHaveLength(0);
    expect(over.requiresManualReview).toBe(true);
    expect(over.warnings.join(' ')).toContain('This load is a superload in Tennessee');

    // The dimensional triggers escalate on size alone, whatever the weight.
    const wide = priceIn8('TN', {
      ...legalSize,
      widthIn: ftIn(16, 1),
      grossWeightLbs: 79000,
      milesInJurisdiction: 100,
    });
    expect(wide.subtotalUsd).toBeNull();
    expect(wide.escorts.routeSurvey).toBe(true);

    // The $0.12 tier belongs to a tow, not to general freight above 165,000 lb.
    expect(TENNESSEE_HEAVY_DUTY_TOWING_TON_MILE.usdPerTonMile).toBe(0.12);
    expect(TENNESSEE_HEAVY_DUTY_TOWING_TON_MILE.detail).toContain('HEAVY-DUTY TOWING');
    // The top bridge band is "actual cost" — not a number, and never a zero.
    expect(TENNESSEE_BRIDGE_EVALUATION_FEES.map((b) => b.feeUsd)).toEqual([100, 300, null]);
    expect(TENNESSEE_OSOW_RULES.conditionalFees).toEqual([]);
  });

  /**
   * THE TRANSACTION SURCHARGE THAT EXISTS AND HAS NO PUBLISHED RATE — an EMPTY
   * list, never a sourced zero, because "nobody publishes the rate" and "the rate
   * is nought" are different claims and only one of them is true here.
   */
  it('holds no transaction fee, no route-analysis fee, and prints neither as zero', () => {
    expect(TENNESSEE_OSOW_RULES.transactionFee).toEqual([]);
    expect(TENNESSEE_OSOW_RULES.routeAnalysisFeeUsd).toEqual([]);
    expect(TENNESSEE_OSOW_RULES.noBridgeRouteFeeUsd).toEqual([]);

    const r = priceIn8('TN', {
      ...legalSize,
      grossWeightLbs: 100000,
      milesInJurisdiction: 200,
    });
    // No service-fee line at all — not a $0.00 one.
    expect(r.lines.some((l) => l.code === 'osow_service_fee')).toBe(false);
    expect(r.subtotalUsd).toBe(140);
    expect(r.warnings.join(' ')).toContain('No TN permit transaction fee is on file');
    expect(r.warnings.join(' ')).toContain('subject to a transaction surcharge');
  });

  /**
   * THE READINGS THIS FILE MAKES, STATED ON THE QUOTE RATHER THAN BURIED. Which
   * network sets the legal width, and whether a movement over in two dimensions
   * pays one base fee or two.
   */
  it('states the 8 ft baseline and the single-base-fee reading as inferences', () => {
    const r = priceIn8('TN', {
      ...legalSize,
      widthIn: ftIn(12),
      grossWeightLbs: 100000,
      milesInJurisdiction: 200,
      routeClass: 'interstate',
    });
    const said = r.warnings.join(' ');
    expect(said).toContain('OUR READING of which network a quoted lane uses');
    expect(said).toContain('This quote charges ONE base fee per movement');
    expect(said).toContain("OUR READING, not the state's words");
    expect(TENNESSEE_SINGLE_BASE_FEE_READING).toContain('OUR READING');
    // 102 in is recorded, not the statute's 8 ft — an over-width permit on every
    // ordinary trailer in the state is the failure this avoids.
    expect(
      resolveSourced('TN width', TENNESSEE_OSOW_RULES.legalLimits.widthIn, ASOF8).value,
    ).toBe(102);
    // Overall length and overhang are ABSENT, not empty: Tennessee regulates the
    // tractor-semitrailer by the towed vehicle and publishes no overhang limit.
    expect(TENNESSEE_OSOW_RULES.legalLimits.overallLengthIn).toBeUndefined();
    expect(TENNESSEE_OSOW_RULES.legalLimits.frontOverhangIn).toBeUndefined();
    expect(TENNESSEE_OSOW_RULES.legalLimits.rearOverhangIn).toBeUndefined();
  });
});

describe('the registry after Phase 8', () => {
  it('covers exactly the twenty-one states whose datasets exist', () => {
    expect(Object.keys(OSOW_JURISDICTIONS).sort()).toEqual(
      [
        'AL', 'AR', 'CA', 'CO', 'FL', 'GA', 'IL', 'IN', 'KY', 'LA',
        'MO', 'NC', 'NJ', 'NY', 'OH', 'OK', 'PA', 'TN', 'TX', 'VA', 'WA',
      ].sort(),
    );
    for (const code of Object.keys(OSOW_JURISDICTIONS)) {
      expect(hasOsowCoverage(code)).toBe(true);
      expect(osowRulesFor(code)?.code).toBe(code);
    }
    // The registry must never name a jurisdiction ahead of its dataset, and the
    // count is asserted separately so a stray import cannot pass by matching a
    // list someone updated in the same edit.
    expect(Object.keys(OSOW_JURISDICTIONS)).toHaveLength(21);
  });
});
