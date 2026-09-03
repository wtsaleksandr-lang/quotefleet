/**
 * Pilot-car (escort) COST — deliberately separate from the permit engine.
 *
 * `engine.ts` answers how many escorts a state REQUIRES. It refuses to answer
 * what they cost, and that refusal is correct: a state's escort rule is law,
 * its price is not. Pilot cars are independent operators on a market rate, so
 * there is no state document to cite and no figure that belongs in a fee
 * schedule beside `$60 single-trip permit`.
 *
 * Phase 2 needs a number anyway — a corridor quote with a blank escort line is
 * not usable — so this module supplies one under three hard constraints:
 *
 *   1. IT IS ALWAYS A RANGE. A single escort figure implies a precision the
 *      market does not have. Every estimate carries a low and a high, and the
 *      two are far enough apart to be honest about it.
 *   2. IT IS NEVER A `Sourced<T>` IN A JURISDICTION'S FEE SCHEDULE. Benchmarks
 *      live here, in their own type, so no future edit can slip a market rate
 *      into `permitBaseFeeUsd` and have it render as a cited state fee.
 *   3. IT LABELS ITSELF. `isMarketEstimate` is a literal `true` — not a
 *      boolean — so a caller cannot construct an `EscortCostEstimate` that
 *      claims to be anything else, and every estimate ships with a warning
 *      saying so in words.
 *
 * LAW-ENFORCEMENT escorts are the one exception and are modelled separately:
 * where a state police agency publishes an hourly trooper rate, that IS an
 * official figure with a URL and a date, and it is citable. It is still not
 * included in a permit subtotal, because the hours cannot be known in advance.
 */
import type { IsoDate, SourceDoc, Sourced } from './provenance.js';
import { citeOf, isInEffect, resolveSourced } from './provenance.js';

/**
 * A market rate range for one civilian pilot car in one jurisdiction.
 *
 * `minimumUsd` matters more than it looks. Pilot-car operators bill a floor
 * per engagement — a short state crossing does not cost 20 miles' worth of
 * anything, because the operator still spends a day on it. A pure per-mile
 * model underprices exactly the short legs a long corridor is full of.
 */
export interface EscortRateBenchmark {
  /** USPS state code, or `'*'` for the national fallback. */
  jurisdiction: string;
  lowUsdPerMile: number;
  highUsdPerMile: number;
  /** Floor per escort per state crossing; `null` when none is evidenced. */
  minimumUsd: number | null;
  /** What the range is drawn from — survey, operator rate card, association. */
  basis: string;
}

/** Official, citable law-enforcement escort rate (hourly). */
export interface PoliceEscortRate {
  jurisdiction: string;
  usdPerHour: number;
  note: string;
}

export interface EscortCostEstimate {
  jurisdiction: string;
  /** Civilian pilot cars the state requires. */
  escorts: number;
  milesInJurisdiction: number | null;
  /** `null` = required but not estimable. NOT the same as $0. */
  lowUsd: number | null;
  highUsd: number | null;
  /**
   * Literal `true`, not `boolean`. The type itself forbids an estimate that
   * claims to be a cited fee.
   */
  isMarketEstimate: true;
  warnings: string[];
  requiresManualReview: boolean;
  sources: SourceDoc[];
}

/**
 * The one sentence every escort estimate must carry. Kept as a constant so the
 * tests can assert it is present rather than matching on prose that drifts.
 */
export const ESCORT_ESTIMATE_DISCLAIMER =
  'Pilot-car cost is a MARKET ESTIMATE, not a state fee. The state sets whether an escort is required; independent operators set the price, and it moves with distance, notice, season and equipment. This range is benchmark guidance and must be confirmed against a booked operator rate before it is billed.';

/**
 * Estimate the civilian escort cost for one jurisdiction leg.
 *
 * Returns `lowUsd: null` — never `0` — when escorts are required but cannot be
 * estimated (no benchmark on file, or the in-state mileage is unknown). A zero
 * would read as "escorts are free"; the whole module exists to avoid that.
 */
export function estimateEscortCost(
  jurisdiction: string,
  escorts: number,
  milesInJurisdiction: number | undefined,
  benchmarks: Sourced<EscortRateBenchmark>[],
  asOf: IsoDate,
): EscortCostEstimate {
  const code = String(jurisdiction ?? '').trim().toUpperCase();
  const warnings: string[] = [];
  const sources: SourceDoc[] = [];

  if (escorts <= 0) {
    return {
      jurisdiction: code,
      escorts: 0,
      milesInJurisdiction: milesInJurisdiction ?? null,
      lowUsd: 0,
      highUsd: 0,
      isMarketEstimate: true,
      warnings: [],
      requiresManualReview: false,
      sources: [],
    };
  }

  // A state-specific benchmark beats the national fallback. Both are held so
  // a state with no local evidence still produces a range rather than silence.
  const forState = benchmarks.filter(
    (b) => b.value.jurisdiction === code && isInEffect(b, asOf),
  );
  const fallback = benchmarks.filter(
    (b) => b.value.jurisdiction === '*' && isInEffect(b, asOf),
  );
  const pool = forState.length > 0 ? forState : fallback;
  const usingFallback = forState.length === 0 && fallback.length > 0;

  if (pool.length === 0) {
    return {
      jurisdiction: code,
      escorts,
      milesInJurisdiction: milesInJurisdiction ?? null,
      lowUsd: null,
      highUsd: null,
      isMarketEstimate: true,
      warnings: [
        `${code} requires ${escorts} escort${escorts === 1 ? '' : 's'} on this move and no pilot-car rate benchmark is on file for it. The escort cost is NOT zero — it is unknown, and must be quoted from a booked operator rate.`,
      ],
      requiresManualReview: true,
      sources: [],
    };
  }

  for (const b of pool) {
    if (!sources.some((s) => s.id === b.source.id)) sources.push(b.source);
  }

  if (milesInJurisdiction === undefined) {
    return {
      jurisdiction: code,
      escorts,
      milesInJurisdiction: null,
      lowUsd: null,
      highUsd: null,
      isMarketEstimate: true,
      warnings: [
        `${code} requires ${escorts} escort${escorts === 1 ? '' : 's'}, and pilot cars bill by the mile — but the miles travelled inside ${code} are not known, so the cost cannot be estimated. ${ESCORT_ESTIMATE_DISCLAIMER}`,
      ],
      requiresManualReview: true,
      sources,
    };
  }

  // Widest defensible band across the rows in effect: the lowest low and the
  // highest high. Averaging them would narrow the range by hiding evidence.
  const low = Math.min(...pool.map((b) => b.value.lowUsdPerMile));
  const high = Math.max(...pool.map((b) => b.value.highUsdPerMile));
  const minimums = pool
    .map((b) => b.value.minimumUsd)
    .filter((m): m is number => m !== null);
  const minimum = minimums.length > 0 ? Math.min(...minimums) : 0;

  const rawLow = low * milesInJurisdiction * escorts;
  const rawHigh = high * milesInJurisdiction * escorts;
  const flooredLow = Math.max(rawLow, minimum * escorts);
  const flooredHigh = Math.max(rawHigh, minimum * escorts);

  if (minimum > 0 && rawLow < minimum * escorts) {
    warnings.push(
      `${code} is only ${milesInJurisdiction} mi of this route, which is under the per-engagement minimum pilot-car operators charge. The estimate below is the minimum (${escorts} × $${minimum.toFixed(2)}), not ${milesInJurisdiction} mi × the per-mile rate — a short crossing does not buy a short day.`,
    );
  }
  if (usingFallback) {
    warnings.push(
      `No ${code}-specific pilot-car rate benchmark is on file; the estimate uses the national range. Rates vary materially by state, so treat this leg's escort figure as the softest number in the quote.`,
    );
  }
  warnings.push(ESCORT_ESTIMATE_DISCLAIMER);

  return {
    jurisdiction: code,
    escorts,
    milesInJurisdiction,
    lowUsd: Math.round(flooredLow * 100) / 100,
    highUsd: Math.round(flooredHigh * 100) / 100,
    isMarketEstimate: true,
    warnings,
    requiresManualReview: false,
    sources,
  };
}

/**
 * Look up a published law-enforcement escort rate. Unlike a pilot car this IS
 * an official figure, so it goes through the normal resolver and can be cited.
 * It is still never added to a permit subtotal: the rate is hourly and the
 * hours are set on the day by the agency.
 */
export function policeEscortRate(
  jurisdiction: string,
  rates: Sourced<PoliceEscortRate>[],
  asOf: IsoDate,
): { usdPerHour: number | null; warnings: string[]; sources: SourceDoc[] } {
  const code = String(jurisdiction ?? '').trim().toUpperCase();
  const forState = rates.filter((r) => r.value.jurisdiction === code);
  if (forState.length === 0) {
    return { usdPerHour: null, warnings: [], sources: [] };
  }
  const resolved = resolveSourced(
    `${code} law-enforcement escort hourly rate`,
    forState,
    asOf,
    (a, b) => a.usdPerHour === b.usdPerHour,
  );
  const warnings = [...resolved.warnings];
  if (resolved.value !== null) {
    warnings.push(
      `${code} publishes a law-enforcement escort rate of $${resolved.value.usdPerHour.toFixed(2)} per hour. ${resolved.value.note} The hours are set by the agency on the day of the move, so no police-escort amount is included in the permit total. Source: ${citeOf((resolved.chosen as Sourced<PoliceEscortRate>).source)}.`,
    );
  }
  return {
    usdPerHour: resolved.value === null ? null : resolved.value.usdPerHour,
    warnings,
    sources: resolved.candidates.map((c) => c.source),
  };
}
