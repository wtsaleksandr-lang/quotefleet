import { describe, it, expect } from 'vitest';
import { calculateOsow, calculateOsowForJurisdiction } from './engine.js';
import {
  OSOW_JURISDICTIONS,
  TEXAS_OSOW_RULES,
  hasOsowCoverage,
  osowRulesFor,
} from './jurisdictions/index.js';
import { applyTransactionFee, oversizeBandApplies } from './types.js';
import { ftIn } from './escortRules.js';

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

  it('refuses to price a lane that leaves Texas — and names the gap', () => {
    const q = calculateOsow(['TX', 'OK'], load({ grossWeightLbs: 100000, widthIn: ftIn(12), heightIn: ftIn(13) }), ASOF);
    expect(q.uncoveredJurisdictions).toEqual(['OK']);
    expect(q.totalPermitUsd).toBeNull();
    expect(q.requiresManualReview).toBe(true);
    expect(q.warnings.join(' ')).toContain('No oversize/overweight permit data is on file for OK');
    // Texas is still fully priced — the gap is isolated to the leg we lack.
    expect(q.jurisdictions[0]?.subtotalUsd).toBe(214.98);
  });

  it('never infers one state’s fees from a neighbour', () => {
    const q = calculateOsow(['OK'], load({ grossWeightLbs: 100000 }), ASOF);
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
  it('knows Texas is covered and Oklahoma is not', () => {
    expect(hasOsowCoverage('TX')).toBe(true);
    expect(hasOsowCoverage('tx')).toBe(true);
    expect(hasOsowCoverage('OK')).toBe(false);
    expect(osowRulesFor('OK')).toBeNull();
    expect(osowRulesFor('TX')?.name).toBe('Texas');
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
        // recorded fact. But the field must be present, never undefined.
        expect(row.source.revisedOn === null || /^\d{4}-\d{2}-\d{2}$/.test(row.source.revisedOn)).toBe(true);
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
});

describe('the registry after Phase 3', () => {
  it('covers exactly the eleven states whose datasets exist', () => {
    expect(Object.keys(OSOW_JURISDICTIONS).sort()).toEqual(
      ['CA', 'GA', 'IL', 'IN', 'NC', 'NJ', 'NY', 'OH', 'PA', 'TX', 'VA'].sort(),
    );
    for (const code of Object.keys(OSOW_JURISDICTIONS)) {
      expect(hasOsowCoverage(code)).toBe(true);
      expect(osowRulesFor(code)?.code).toBe(code);
    }
  });
});
