/**
 * MATERIALITY — when a source disagreement is too small to be worth a human.
 *
 * `provenance.ts` refuses to pick between two in-effect sources, on purpose:
 * a confident number the documents do not support is the worst thing this
 * engine could emit. That rule is right about REQUIREMENTS and wrong about
 * small MONEY, and the wrongness is not theoretical. Louisiana publishes an $8
 * oversize permit fee in LAC 73:I.303(A) and a $10 one in R.S. 32:387(H)(1)(a).
 * Both are current. Under the unqualified rule the line comes back `null`, the
 * subtotal comes back `null`, and a human is asked to adjudicate **two
 * dollars** on an over-dimensional move worth several thousand.
 *
 * Alex's direction, verbatim:
 *
 *   "This is not a significant difference and such minor margins are ok to
 *    ignore; just round up to the bigger amount. I'd say anything that is under
 *    $50 difference is OK to ignore... with OOG haulage, the total sum for
 *    delivery could be in the multiple thousands of dollars; hence, a few-dollar
 *    difference in permit fee should not be a big deal."
 *
 * He is right, and the failure mode he is describing is worse than a $2 error:
 * a review flag that fires on two dollars trains dispatchers to click past it,
 * which destroys its value for the conflicts that genuinely matter — an
 * under-escorted load, a permit-vs-no-permit threshold, a superload trigger.
 *
 * FOUR RULES MAKE THIS SAFE.
 * -------------------------
 *
 * 1. ONLY FEES. Nothing in this module can resolve a requirement. Legal limits,
 *    escort counts and positions, escort trigger boundaries, superload
 *    triggers, route-survey requirements and permit-vs-no-permit thresholds are
 *    never routed through here at any dollar value — see `engine.ts`, where a
 *    live requirement conflict switches absorption off for the whole
 *    jurisdiction. One extra or missing pilot car on a 1,200-mile run is
 *    $2,400–3,600 and an under-escorted load gets stopped; neither is a
 *    rounding question.
 *
 * 2. HIGHER WINS. Absorbing a conflict adopts the LARGEST computed amount, so
 *    the customer is never under-quoted by this mechanism. Three or more
 *    candidates take the max; the spread is max − min.
 *
 * 3. THE THRESHOLD IS MEASURED ON THE COMPUTED TOTAL FOR THIS LOAD, NEVER ON
 *    THE PUBLISHED NUMBER. This is the whole reason the module takes an
 *    `amountOf` function instead of reading a field. Louisiana's $8-vs-$10 is a
 *    flat per-permit fee, so $2 is $2 on every move. Virginia charges $0.30 a
 *    mile and New Jersey $5.00 per 2,000 lb — a disagreement that looks trivial
 *    in the source multiplies by distance or by weight. A 1.2-cent per-mile
 *    disagreement is $12 on a 1,000-mile move and $60 on a 5,000-mile
 *    one, and those two must resolve DIFFERENTLY. So the comparison happens
 *    after the fee has been computed for this specific load, not at data-read
 *    time. `resolveSourced` still refuses to pick — it just no longer has the
 *    last word on a fee.
 *
 * 4. AN ABSENT CANDIDATE IS NOT A ZERO. If any in-effect candidate cannot be
 *    priced for this load, the conflict is NOT absorbed. Washington is the trap
 *    this guards: RCW 46.44.0941's table and WSDOT's own portal disagree about
 *    where the top band ends, leaving 179,001–179,999 lb gross with NO fee
 *    defined by either source. There is no higher value to take there, and
 *    reading the missing side as $0 would turn "nobody publishes a price" into
 *    "the price is the other one" — a confident wrong number of exactly the
 *    kind this engine exists to refuse. (That case does not even reach here:
 *    an empty candidate list is a gap, not a conflict. Rule 4 is the belt to
 *    that braces.)
 *
 * WHERE THE DELTA IS MEASURED RELATIVE TO PERCENTAGE SURCHARGES.
 * -------------------------------------------------------------
 * Consistently BEFORE. Each absorbed delta is measured on that fee line's own
 * computed amount, prior to any percentage transaction/card surcharge levied on
 * the permit subtotal. A surcharge of p% magnifies an absorbed delta by at most
 * p% of itself — the largest percentage in the eighteen-state dataset is 5%
 * (New Jersey), so a delta sitting exactly on the $50 threshold reaches at most
 * $52.50 once carded. That is inside the noise Alex is describing and it keeps
 * one basis for every jurisdiction, including the states that charge no
 * percentage at all. The transaction fee's OWN conflict, when a state has one,
 * is measured on the surcharge dollars it produces for this load, which is by
 * construction computed on the finished subtotal.
 *
 * EFFECTIVE DATING IS UPSTREAM AND IS NOT RE-HANDLED HERE. A conflict where one
 * candidate has been superseded by date — Louisiana's Acts 2019 No. 301 raising
 * the Class II container fee is the live case — has already collapsed to a
 * single in-effect candidate inside `resolveSourced`, so `conflict` is false and
 * nothing in this module runs. Absorption applies only to sources that are BOTH
 * in effect on the as-of date and still disagree.
 */
import { citeOf, type Resolution, type SourceDoc, type Sourced } from './provenance.js';

/**
 * The largest source disagreement, in dollars ON THIS LOAD, that resolves
 * itself instead of asking a human.
 *
 * FIFTY DOLLARS IS ALEX'S NUMBER, and the reasoning is his: an over-dimensional
 * move runs into the thousands, so a permit-fee disagreement smaller than this
 * is not a decision anybody needs to make — take the larger figure and quote.
 * It is deliberately a single tunable constant rather than a per-state or
 * per-fee table: one number is auditable, and a threshold nobody can state from
 * memory is a threshold nobody can defend to a customer.
 *
 * Retuning it is a data decision, not a logic change — nothing below reads the
 * literal, and the aggregate cap in `engine.ts` uses this same value.
 */
export const IMMATERIAL_CONFLICT_THRESHOLD_USD = 50;

/** One candidate's computed cost for the load being priced. */
export interface AbsorbedCandidate {
  amountUsd: number;
  source: SourceDoc;
  /** The candidate row's own qualifier note, when it carries one. */
  note?: string;
}

/**
 * The internal record of a conflict that was absorbed rather than escalated.
 *
 * This is the data-quality channel's payload: what was absorbed, which
 * candidates, from which documents, and how much money the decision moved. It
 * exists so that suppressing the customer-facing flag never means losing the
 * finding — every absorbed conflict stays countable, attributable and
 * re-auditable when a state's sources are next refreshed.
 */
export interface AbsorbedFeeConflict {
  /** The resolver's field name, e.g. 'LA oversize fee band'. */
  field: string;
  /** The amount actually quoted — always the largest candidate. */
  adoptedUsd: number;
  lowUsd: number;
  highUsd: number;
  /** `highUsd - lowUsd`: the money this decision moved on THIS load. */
  spreadUsd: number;
  candidates: AbsorbedCandidate[];
  /** Ready-to-log sentence naming the sources and the amounts. */
  detail: string;
}

/**
 * A resolution that has been priced for one load, and adjudicated on
 * materiality if it needed adjudicating.
 *
 * Mirrors `Resolution<T>` so a caller can drop it in where the resolution used
 * to go, plus the two things the resolution could not know: the dollar amount
 * for this load, and whether the disagreement was worth a human.
 */
export interface PricedResolution<T> {
  field: string;
  /** The adopted value; `null` when the field is genuinely unresolved. */
  value: T | null;
  chosen: Sourced<T> | null;
  candidates: Sourced<T>[];
  /** The dollar amount for this load; `null` when unresolved or unpriceable. */
  amountUsd: number | null;
  /** The honest range, set ONLY when the conflict was escalated, not absorbed. */
  lowUsd: number | null;
  highUsd: number | null;
  /** True when in-effect sources disagreed, whether or not it was absorbed. */
  conflict: boolean;
  /** Set when the disagreement was absorbed; `null` otherwise. */
  absorbed: AbsorbedFeeConflict | null;
  /** CUSTOMER-facing text. Empty for an absorbed conflict. */
  warnings: string[];
  /** INTERNAL text. Carries the absorbed conflict; never shown as a defect. */
  dataQuality: string[];
  requiresManualReview: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Price one resolved field for one load, and decide whether a disagreement
 * about it is material.
 *
 * `amountOf` is the deferral: it turns a candidate ROW into the dollars that
 * row costs THIS load. A flat fee ignores its arguments; a per-mile rate
 * multiplies by the miles; a per-axle band multiplies by the axle count and
 * answers `null` when the count is unknown. That is what makes the same
 * 1.2-cent-per-mile disagreement immaterial over 1,000 miles and material over
 * 5,000 — see rule 3 in the module header.
 *
 * `absorb: false` reproduces the pre-materiality behaviour exactly, and the
 * engine passes it whenever a REQUIREMENT conflict is live in the jurisdiction.
 */
export function priceSourced<T>(
  resolution: Resolution<T>,
  amountOf: (value: T) => number | null,
  options: { absorb: boolean; thresholdUsd?: number },
): PricedResolution<T> {
  const threshold = options.thresholdUsd ?? IMMATERIAL_CONFLICT_THRESHOLD_USD;

  const untouched = (extraDataQuality: string[] = []): PricedResolution<T> => ({
    field: resolution.field,
    value: resolution.value,
    chosen: resolution.chosen,
    candidates: resolution.candidates,
    amountUsd: resolution.value === null ? null : amountOf(resolution.value),
    lowUsd: null,
    highUsd: null,
    conflict: resolution.conflict,
    absorbed: null,
    warnings: [...resolution.warnings],
    dataQuality: extraDataQuality,
    requiresManualReview: resolution.requiresManualReview,
  });

  // Not a disagreement: nothing to adjudicate. Covers the settled case, the
  // corroborated case, and the "no in-effect candidate" GAP — a gap has no
  // higher value to take and must keep failing loudly.
  if (!resolution.conflict) return untouched();

  const priced = resolution.candidates.map((candidate) => ({
    candidate,
    amountUsd: amountOf(candidate.value),
  }));
  const amounts = priced
    .map((p) => p.amountUsd)
    .filter((a): a is number => a !== null);

  const escalate = (dataQuality: string[] = []): PricedResolution<T> => ({
    ...untouched(dataQuality),
    value: null,
    chosen: null,
    amountUsd: null,
    lowUsd: amounts.length > 0 ? Math.min(...amounts) : null,
    highUsd: amounts.length > 0 ? Math.max(...amounts) : null,
    requiresManualReview: true,
  });

  if (!options.absorb) return escalate();

  // RULE 4. A candidate we cannot cost is not a candidate worth zero. Refusing
  // here rather than dropping it keeps "one of the two sources does not price
  // this load" from silently becoming "the other source is right".
  if (amounts.length !== priced.length || amounts.length < 2) {
    return escalate([
      `${resolution.field}: sources disagree and at least one candidate cannot be priced for this load, so the disagreement was NOT absorbed — there is no higher figure to adopt.`,
    ]);
  }

  const lowUsd = round2(Math.min(...amounts));
  const highUsd = round2(Math.max(...amounts));
  const spreadUsd = round2(highUsd - lowUsd);

  if (spreadUsd > threshold) return escalate();

  // RULE 2. Take the largest computed amount. Ties keep `resolveSourced`'s own
  // ranking — newest source revision first — so the winner is deterministic.
  const winner = priced.reduce((best, p) =>
    (p.amountUsd as number) > (best.amountUsd as number) ? p : best,
  );

  const candidates: AbsorbedCandidate[] = priced.map((p) => ({
    amountUsd: p.amountUsd as number,
    source: p.candidate.source,
    ...(p.candidate.note === undefined ? {} : { note: p.candidate.note }),
  }));

  const detail = `${resolution.field}: official sources disagree by ${usd(spreadUsd)} on this load (${usd(lowUsd)}–${usd(highUsd)}), which is at or under the ${usd(threshold)} materiality threshold, so the HIGHER figure ${usd(highUsd)} was quoted and no review was raised. Candidates: ${priced
    .map((p) => `${usd(p.amountUsd as number)} per ${citeOf(p.candidate.source)}`)
    .join(' — versus — ')}`;

  const absorbed: AbsorbedFeeConflict = {
    field: resolution.field,
    adoptedUsd: highUsd,
    lowUsd,
    highUsd,
    spreadUsd,
    candidates,
    detail,
  };

  return {
    field: resolution.field,
    value: winner.candidate.value,
    chosen: winner.candidate,
    candidates: resolution.candidates,
    amountUsd: highUsd,
    lowUsd: null,
    highUsd: null,
    conflict: true,
    absorbed,
    // The customer sees a priced line and no defect. The resolver's
    // "sources disagree" sentence is deliberately dropped from this channel and
    // carried on the internal one instead.
    warnings: [],
    dataQuality: [detail],
    requiresManualReview: false,
  };
}

/** Total money absorbed across a set of conflicts, rounded to cents. */
export function absorbedTotalUsd(records: AbsorbedFeeConflict[]): number {
  return round2(records.reduce((sum, r) => sum + r.spreadUsd, 0));
}

/**
 * THE AGGREGATE CAP. Five states each papering over $40 is $200 on one quote,
 * and nobody would call that immaterial just because no single line crossed the
 * bar. So the threshold applies to the SUM as well as to each conflict, and a
 * quote whose absorbed total crosses it goes to review — keeping the adopted
 * (higher, conservative) prices, because the numbers are still the best reading
 * of the sources; what changes is that a human is told to look.
 */
export function aggregateExceedsThreshold(
  totalUsd: number,
  thresholdUsd: number = IMMATERIAL_CONFLICT_THRESHOLD_USD,
): boolean {
  return totalUsd > thresholdUsd;
}

/** The customer-facing sentence raised when the aggregate cap fires. */
export function aggregateReviewWarning(
  totalUsd: number,
  count: number,
  scope: string,
  thresholdUsd: number = IMMATERIAL_CONFLICT_THRESHOLD_USD,
): string {
  return `${count} permit-fee disagreement${count === 1 ? '' : 's'} in ${scope} were individually small enough to quote at the higher published figure, but together they move ${usd(totalUsd)} — over the ${usd(thresholdUsd)} materiality threshold. The amounts above are the higher reading of each source and are not under-quoted, and the permit fees should be confirmed with the issuing agencies before this quote is committed.`;
}
