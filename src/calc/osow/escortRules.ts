/**
 * Escort (pilot car) requirements as a RULE GRAMMAR, not a column.
 *
 * WHY THIS IS NOT `escortsRequiredAtWidthIn: number`
 * -------------------------------------------------
 * Texas is a clean threshold table — over 14'0" wide, one escort; over 16'0",
 * two — and a single numeric column would hold it fine. Building for Texas
 * would be building the wrong thing. The states we add next do not fit a
 * column at all:
 *
 *   - COMPOUND CONDITIONALS. A width rule that only bites when a height
 *     escort is not already required, because the state will not make you pay
 *     two pilot cars to solve one problem. The rule references ANOTHER RULE'S
 *     OUTCOME, not a dimension.
 *   - RATIO RULES. "Rear overhang greater than one-third of trailer length."
 *     There is no threshold in inches; the threshold is a function of another
 *     measurement on the same load.
 *   - SUBJECTIVE RULES. "When the load obstructs the driver's view in the
 *     mirrors." No number decides this. A schema that forces it into a number
 *     will produce a confident wrong answer every time.
 *
 * So a rule is a small predicate AST over the load's measurements, plus an
 * outcome. Adding a state is adding data, never changing this file.
 *
 * THREE-VALUED LOGIC IS THE LOAD-BEARING DECISION
 * -----------------------------------------------
 * Conditions evaluate to true / false / **unknown**. A missing measurement is
 * `unknown`, NOT false. This matters more than it sounds: if we do not know
 * the rear overhang, "overhang > ⅓ trailer length" must not quietly answer
 * "no escort needed". It must answer "I cannot tell", which sets
 * `requiresManualReview` and keeps a wrong number off the quote. Subjective
 * conditions are permanently `unknown` unless a human has answered them.
 *
 * Same contract as LoadMode's customs calculator: degrade to a warning, never
 * to a guess.
 */
import type { IsoDate, SourceDoc } from './provenance.js';
import { citeOf, isInEffect } from './provenance.js';

/** Three-valued truth. `'unknown'` is a first-class answer, not an error. */
export type Tri = true | false | 'unknown';

/**
 * A measurement an escort rule can test. Units are baked into the name so a
 * rule can never silently compare inches to pounds.
 *
 * `kingpinToRearAxleIn` IS THE ONE MEASURE NO PERMIT APPLICATION ASKS FOR, AND
 * IT IS HERE BECAUSE SEVEN STATES REGULATE ON IT.
 * ------------------------------------------------------------------------
 * Kingpin-to-rearmost-axle distance — KPRA — is the distance from the fifth
 * wheel's kingpin back to the centre of the rearmost axle or the midpoint of
 * the rear tandem. It is not the trailer's length, it is not the combination's
 * length, and it cannot be derived from either: two 53 ft trailers with their
 * tandems slid to different positions have different KPRA and the same length.
 *
 * California is the state that forced it. CVC §35400(b)(4) does not cap a
 * semitrailer's LENGTH at all — it exempts the semitrailer from the 40 ft
 * single-vehicle cap whenever KPRA is within limits, which is exactly why a
 * California-legal 53 ft trailer exists and is ordinary. With no KPRA measure
 * there was no honest number to record for California's semitrailer, and every
 * California quote went to review over it. Florida, Illinois, New Jersey, New
 * York, Pennsylvania and Virginia all publish a KPRA limit too, and all of them
 * currently carry it as prose in a note because the engine had nowhere to put it.
 *
 * IT IS OPTIONAL, AND THAT IS THE POINT. A caller that does not supply KPRA
 * gets exactly the behaviour it got before this measure existed: a KPRA
 * condition evaluates to `unknown`, never to `false`, and a jurisdiction that
 * publishes no KPRA limit holds no row and is silent. Supplying KPRA is what
 * buys a cleaner answer; not supplying it never makes one worse.
 */
export type Measure =
  | 'widthIn'
  | 'heightIn'
  | 'overallLengthIn'
  | 'trailerLengthIn'
  /** Kingpin to the rearmost axle (or the rear tandem's midpoint), in inches. */
  | 'kingpinToRearAxleIn'
  | 'frontOverhangIn'
  | 'rearOverhangIn'
  | 'grossWeightLbs';

/**
 * Road type, for states that escalate escorts on undivided roads. Present in
 * the grammar from day one because retrofitting a route-conditioned rule into
 * a dimension-only evaluator means touching every rule already written.
 *
 * CALIFORNIA IS WHY THIS UNION IS NOT CLOSED AT FOUR VALUES.
 * ---------------------------------------------------------
 * Every other jurisdiction here conditions escorts on a property of the ROAD
 * that a dispatcher can name from the road itself — interstate, divided,
 * two-lane, urban. California does not. Caltrans classifies every state
 * highway SEGMENT by COLOUR on its Single Trip Pilot Car Maps — yellow, green,
 * blue, brown, red — and each colour carries its own width thresholds, its own
 * length threshold, and its own CHP trigger. A load 13 ft wide needs no pilot
 * car on a yellow segment, one on a green or blue segment, and two on a brown
 * one. The colour is a published property of the segment, read off the map or
 * off the permit face (item 36); it is not derivable from lane count, and the
 * 1990 definitions that tie the colours to lane and shoulder widths are the
 * only ones Caltrans has ever published.
 *
 * Flattening the five colours onto `divided`/`two-lane` would have destroyed
 * the distinction the state actually prices on — green, blue and brown are all
 * two-lane and they disagree with each other by two feet of width and 35 feet
 * of length. So the union is EXTENDED rather than reinterpreted. The colours
 * carry a `ca-` prefix because they are California's map legend and not a
 * general road taxonomy; a future state with its own scheme adds its own
 * prefixed members the same way, and no existing rule changes.
 *
 * A California quote that does not know the segment colour evaluates the width
 * rules to `unknown`, which is correct: without the colour, Caltrans's own
 * table cannot say how many pilot cars the move needs.
 *
 * PHASE 4 ADDED THREE MORE, AND ONLY THREE, FOR A DIFFERENT REASON.
 * ----------------------------------------------------------------
 * Washington, Missouri, Oklahoma, Alabama and Florida all classify by lane
 * count and median, which the four original members mostly cover. Three gaps
 * were real:
 *
 *   - `multilane-undivided` is GENERIC, not prefixed, because it is an ordinary
 *     road taxonomy term that three of the five states use in exactly the same
 *     sense: two or more lanes each way with NO physical median divider.
 *     `divided` cannot stand in for it — Washington requires two pilot cars
 *     over 20 ft wide on a multilane UNDIVIDED highway and none on a divided
 *     one at the same width, and RCW 46.44.092 caps a permit at 20 ft on a
 *     divided multilane and 32 ft on an undivided one. Missouri splits the same
 *     way and disagrees with itself about which side undivided falls on: over
 *     12 ft 6 in it behaves like a divided highway (one rear escort) and over
 *     14 ft it behaves like a two-lane one (front and rear). Folding undivided
 *     onto either neighbour would have thrown away a whole pilot car.
 *   - `ok-super-two-lane` IS prefixed, because "super two-lane highway" is
 *     Oklahoma's own term of art in OAC 730:50-5-18 and not a general road
 *     type. It matters: the >80 ft front-escort rule for a truck-tractor/
 *     semitrailer names only "two-lane highways", while the identical rule for
 *     any other combination names "two-lane highways OR super two-lane
 *     highways". One escort turns on that distinction.
 *   - `fl-limited-access` IS prefixed, because "limited access facility" is a
 *     Florida-defined class in FAC 14-26 that is wider than `interstate` — it
 *     includes Florida's Turnpike — and Florida prices on it hard: over 16 ft
 *     wide it is two QUALIFIED escorts on a limited-access facility by day and
 *     two LAW ENFORCEMENT escorts at all times on any other state road.
 *
 * Everything else in the five Phase 4 states fits the existing members, which
 * is the point of checking rather than reflexively prefixing: a member that is
 * really a general road type must stay general, or every state ends up with its
 * own private synonym for "two-lane" and a caller cannot pass a road type
 * without first knowing which state it is in.
 */
export type RouteClass =
  | 'interstate'
  | 'divided'
  | 'two-lane'
  | 'urban'
  /** Two or more lanes each way with NO physical median divider. */
  | 'multilane-undivided'
  /** OAC 730:50-5-18's own class: a two-lane highway with paved shoulders. */
  | 'ok-super-two-lane'
  /** FAC 14-26's "limited access facility" — wider than `interstate`. */
  | 'fl-limited-access'
  /** Caltrans pilot-car map: multilane freeways and expressways. */
  | 'ca-yellow'
  /** Caltrans pilot-car map: two-lane, 12 ft lanes with a 4 ft or wider shoulder. */
  | 'ca-green'
  /** Caltrans: two-lane, 12 ft lanes with a 0–4 ft shoulder, or multilane with substandard lanes. */
  | 'ca-blue'
  /** Caltrans: two-lane with 11 ft or 10 ft lanes. */
  | 'ca-brown'
  /** Caltrans: restricted route — movement governed by the Red Route Summary Table. */
  | 'ca-red';

export type EscortCondition =
  /** measure > value */
  | { kind: 'gt'; measure: Measure; value: number }
  /** measure >= value */
  | { kind: 'gte'; measure: Measure; value: number }
  /** min <= measure <= max (bounds inclusive unless overridden) */
  | {
      kind: 'between';
      measure: Measure;
      min: number;
      max: number;
      minInclusive?: boolean;
      maxInclusive?: boolean;
    }
  /**
   * measure > (numerator/denominator) × ofMeasure — "rear overhang greater
   * than one-third of trailer length". Unknown if EITHER measure is missing.
   */
  | {
      kind: 'ratioGt';
      measure: Measure;
      ofMeasure: Measure;
      numerator: number;
      denominator: number;
    }
  /** The move is on one of these road types. */
  | { kind: 'routeClass'; anyOf: RouteClass[] }
  | { kind: 'all'; of: EscortCondition[] }
  | { kind: 'any'; of: EscortCondition[] }
  | { kind: 'not'; of: EscortCondition }
  /**
   * At least `count` of the branches hold. Texas needs this on day one: "if a
   * load exceeds escort thresholds in TWO dimensions, both a front and a rear
   * escort are required" is a 2-of-N over the other rules, and writing it as
   * an `any` of every pair is both unreadable and wrong the moment a fifth
   * dimension is added.
   */
  | { kind: 'atLeast'; count: number; of: EscortCondition[] }
  /** True when another rule fires — lets a rule be conditioned on an escort
   *  already being required for a different reason. */
  | { kind: 'ruleApplies'; ruleId: string }
  /**
   * True when another rule does NOT fire.
   *
   * PHASE 1 ANTICIPATED WASHINGTON HERE AND GOT THE POLARITY BACKWARDS. The
   * comment this replaces predicted "a width rule that only applies if no
   * height escort is already on the move". WAC 468-38-100(1)(i) as published
   * says the opposite: "The vehicle(s) or load exceeds 12 feet in width on a
   * multilane highway AND HAS A HEIGHT THAT REQUIRES A FRONT PILOT/ESCORT
   * VEHICLE: One rear pilot/escort vehicle is required." The width rule bites
   * BECAUSE a height escort is already leading — the lead car is watching
   * overhead clearance rather than the load's width, so the state wants a
   * second car behind. That is `ruleApplies`, and Washington is encoded with
   * `ruleApplies` for exactly that reason.
   *
   * The negative form is kept because it is cheap, because the evaluator
   * already implements it correctly, and because a rule of the predicted shape
   * is a normal thing for a state to write. It is currently unused by any
   * dataset, and it must not be reached for by inventing a condition a state
   * did not publish just to exercise it.
   */
  | { kind: 'ruleDoesNotApply'; ruleId: string }
  /**
   * Inherently a judgement call — mirror visibility, "if the load obscures
   * the vehicle's lighting". Always `unknown` unless a dispatcher has
   * answered it via `EscortContext.subjectiveAnswers[key]`.
   */
  | { kind: 'subjective'; key: string; question: string };

/** What a firing rule requires. Absent fields mean "this rule says nothing". */
export interface EscortOutcome {
  /**
   * Number of certified escorts required, WITHOUT committing to where they
   * ride. Texas needs this separately from front/rear: over 14 ft wide the
   * state requires one escort, positioned in FRONT on a two-lane road and in
   * the REAR on a multi-lane one. The count — the thing the money depends on
   * — is one either way. Modelling that as two position-specific rules would
   * force a manual review on every quote where the road type is unknown, for
   * a distinction that does not change the price by a dollar.
   */
  escorts?: number;
  /** Certified pilot cars ahead of / behind the load, when position is known. */
  front?: number;
  rear?: number;
  /** Law-enforcement escorts, billed separately and far more expensively. */
  policeFront?: number;
  policeRear?: number;
  /** Escort must run a height pole (a real, separately-priced service). */
  heightPole?: boolean;
  /** State requires a route survey / engineering review before issuing. */
  routeSurvey?: boolean;
  /** Load is a superload: no published fee, agency prices it. */
  superload?: boolean;
  /**
   * The rule is real but we cannot turn it into a number — set this and the
   * whole result goes to manual review with this reason attached.
   */
  manualReview?: string;
  /**
   * A known unknown that does NOT invalidate the quote. Texas police escorts
   * are the motivating case: TxDOT may require law-enforcement traffic
   * control, but the rule sets no threshold that would let us predict it, and
   * it is not required by default. Blocking every Texas quote on that
   * possibility would make the engine useless; hiding it would make the
   * number dishonest. So it surfaces as a warning and the price stands, with
   * the exclusion stated.
   */
  advisory?: string;
}

export interface EscortRule {
  id: string;
  /** Jurisdiction code, e.g. 'TX'. */
  jurisdiction: string;
  /** Plain restatement of the rule, shown to the dispatcher. */
  description: string;
  when: EscortCondition;
  then: EscortOutcome;
  source: SourceDoc;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
}

export interface EscortContext {
  widthIn?: number;
  heightIn?: number;
  overallLengthIn?: number;
  trailerLengthIn?: number;
  /**
   * OPTIONAL, and it must stay optional. Absent means "we were not told", which
   * makes every KPRA condition `unknown` — never `false`. See `Measure`.
   */
  kingpinToRearAxleIn?: number;
  frontOverhangIn?: number;
  rearOverhangIn?: number;
  grossWeightLbs?: number;
  routeClass?: RouteClass;
  /**
   * Dispatcher answers to `subjective` conditions, keyed by the condition's
   * `key`. This is how a judgement call becomes decidable WITHOUT the engine
   * pretending to make it: a human answers, we record it, the rule evaluates.
   */
  subjectiveAnswers?: Record<string, boolean>;
}

export interface AppliedRule {
  ruleId: string;
  description: string;
  outcome: EscortOutcome;
}

export interface UndecidedRule {
  ruleId: string;
  description: string;
  reason: string;
}

export interface EscortEvaluation {
  /**
   * Escorts to bill. `max(front + rear, largest bare escort count)` — see
   * `EscortOutcome.escorts` for why a bare count exists at all.
   */
  totalEscorts: number;
  front: number;
  rear: number;
  policeFront: number;
  policeRear: number;
  heightPole: boolean;
  routeSurvey: boolean;
  superload: boolean;
  applied: AppliedRule[];
  /** Rules whose condition could not be decided — the honesty channel. */
  undecided: UndecidedRule[];
  warnings: string[];
  requiresManualReview: boolean;
}

function measureOf(ctx: EscortContext, m: Measure): number | undefined {
  return ctx[m];
}

/** Human name for a measure, for warning text. */
const MEASURE_LABEL: Record<Measure, string> = {
  widthIn: 'width',
  heightIn: 'height',
  overallLengthIn: 'overall length',
  trailerLengthIn: 'trailer length',
  kingpinToRearAxleIn: 'kingpin-to-rearmost-axle distance',
  frontOverhangIn: 'front overhang',
  rearOverhangIn: 'rear overhang',
  grossWeightLbs: 'gross weight',
};

function triAll(values: Tri[]): Tri {
  if (values.some((v) => v === false)) return false;
  if (values.some((v) => v === 'unknown')) return 'unknown';
  return true;
}

function triAny(values: Tri[]): Tri {
  if (values.some((v) => v === true)) return true;
  if (values.some((v) => v === 'unknown')) return 'unknown';
  return false;
}

function triNot(v: Tri): Tri {
  if (v === 'unknown') return 'unknown';
  return !v;
}

/**
 * At least `count` branches true. The tri-valued generalisation: it is TRUE
 * once enough branches are definitely true (no need to resolve the rest), and
 * FALSE once even counting every unknown as true could not reach the count.
 * Only in between is it unknown — so "2 of 4 dimensions over" answers cleanly
 * whenever the answer is actually determined.
 */
function triAtLeast(values: Tri[], count: number): Tri {
  const trues = values.filter((v) => v === true).length;
  if (trues >= count) return true;
  const unknowns = values.filter((v) => v === 'unknown').length;
  if (trues + unknowns < count) return false;
  return 'unknown';
}

/** Why a condition came back `unknown`, for the warning text. */
interface EvalTrace {
  missing: Set<string>;
}

function evaluateCondition(
  cond: EscortCondition,
  ctx: EscortContext,
  ruleFires: (ruleId: string) => Tri,
  trace: EvalTrace,
): Tri {
  switch (cond.kind) {
    case 'gt':
    case 'gte': {
      const v = measureOf(ctx, cond.measure);
      if (v === undefined) {
        trace.missing.add(MEASURE_LABEL[cond.measure]);
        return 'unknown';
      }
      return cond.kind === 'gt' ? v > cond.value : v >= cond.value;
    }
    case 'between': {
      const v = measureOf(ctx, cond.measure);
      if (v === undefined) {
        trace.missing.add(MEASURE_LABEL[cond.measure]);
        return 'unknown';
      }
      const lowOk = cond.minInclusive === false ? v > cond.min : v >= cond.min;
      const highOk = cond.maxInclusive === false ? v < cond.max : v <= cond.max;
      return lowOk && highOk;
    }
    case 'ratioGt': {
      const v = measureOf(ctx, cond.measure);
      const base = measureOf(ctx, cond.ofMeasure);
      if (v === undefined) trace.missing.add(MEASURE_LABEL[cond.measure]);
      if (base === undefined) trace.missing.add(MEASURE_LABEL[cond.ofMeasure]);
      if (v === undefined || base === undefined) return 'unknown';
      if (cond.denominator === 0) return 'unknown';
      return v > (cond.numerator / cond.denominator) * base;
    }
    case 'routeClass': {
      if (ctx.routeClass === undefined) {
        trace.missing.add('road type');
        return 'unknown';
      }
      return cond.anyOf.includes(ctx.routeClass);
    }
    case 'all':
      return triAll(
        cond.of.map((c) => evaluateCondition(c, ctx, ruleFires, trace)),
      );
    case 'any':
      return triAny(
        cond.of.map((c) => evaluateCondition(c, ctx, ruleFires, trace)),
      );
    case 'atLeast':
      return triAtLeast(
        cond.of.map((c) => evaluateCondition(c, ctx, ruleFires, trace)),
        cond.count,
      );
    case 'not':
      return triNot(evaluateCondition(cond.of, ctx, ruleFires, trace));
    case 'ruleApplies':
      return ruleFires(cond.ruleId);
    case 'ruleDoesNotApply':
      return triNot(ruleFires(cond.ruleId));
    case 'subjective': {
      const answer = ctx.subjectiveAnswers?.[cond.key];
      if (answer === undefined) {
        trace.missing.add(cond.question);
        return 'unknown';
      }
      return answer;
    }
    default: {
      // Exhaustiveness: a new condition kind must be handled explicitly, not
      // silently treated as false.
      const never: never = cond;
      void never;
      return 'unknown';
    }
  }
}

/**
 * Evaluate a jurisdiction's escort rules against a load.
 *
 * HOW REQUIREMENTS COMBINE: escort counts are combined with MAX, not SUM. If
 * a load is both over-width (1 front escort) and over-height (1 front escort
 * with a height pole), the state wants one front escort carrying a pole — not
 * two trucks. Summing would roughly double the escort line on any load that
 * is over in more than one dimension, which is the most common heavy-haul
 * case there is. Booleans (`routeSurvey`, `heightPole`, `superload`) OR
 * together.
 *
 * Rules that cannot be decided do not silently drop out. They land in
 * `undecided`, raise a warning that names the missing input, and set
 * `requiresManualReview`.
 */
export function evaluateEscortRules(
  rules: EscortRule[],
  ctx: EscortContext,
  asOf: IsoDate,
): EscortEvaluation {
  const active = rules.filter((r) => isInEffect(r, asOf));
  const byId = new Map(active.map((r) => [r.id, r]));

  const memo = new Map<string, Tri>();
  const visiting = new Set<string>();
  const traces = new Map<string, EvalTrace>();
  const cycleIds = new Set<string>();
  const missingRefs = new Set<string>();

  const ruleFires = (ruleId: string): Tri => {
    const cached = memo.get(ruleId);
    if (cached !== undefined) return cached;

    const rule = byId.get(ruleId);
    if (rule === undefined) {
      // A rule referenced a sibling that is not in effect (or is misspelled).
      // Unknown, never false — we cannot claim the referenced rule is quiet.
      missingRefs.add(ruleId);
      return 'unknown';
    }
    if (visiting.has(ruleId)) {
      // Circular reference between rules. Undecidable by construction.
      cycleIds.add(ruleId);
      return 'unknown';
    }

    visiting.add(ruleId);
    const trace: EvalTrace = { missing: new Set() };
    const result = evaluateCondition(rule.when, ctx, ruleFires, trace);
    visiting.delete(ruleId);

    traces.set(ruleId, trace);
    memo.set(ruleId, result);
    return result;
  };

  const applied: AppliedRule[] = [];
  const undecided: UndecidedRule[] = [];
  const warnings: string[] = [];

  let bareEscorts = 0;

  const out: EscortEvaluation = {
    totalEscorts: 0,
    front: 0,
    rear: 0,
    policeFront: 0,
    policeRear: 0,
    heightPole: false,
    routeSurvey: false,
    superload: false,
    applied,
    undecided,
    warnings,
    requiresManualReview: false,
  };

  for (const rule of active) {
    const fires = ruleFires(rule.id);

    if (fires === 'unknown') {
      const trace = traces.get(rule.id);
      const missing = trace ? [...trace.missing] : [];
      const reason =
        cycleIds.has(rule.id)
          ? 'this rule and another reference each other, so neither can be resolved automatically'
          : missing.length > 0
            ? `needs ${missing.join(' and ')}`
            : 'depends on a rule that could not be resolved';
      undecided.push({ ruleId: rule.id, description: rule.description, reason });
      warnings.push(
        `Escort rule not resolved — ${rule.description} (${reason}). Source: ${citeOf(rule.source)}. Escort requirements for this move must be confirmed with the permitting office.`,
      );
      out.requiresManualReview = true;
      continue;
    }

    if (fires === false) continue;

    applied.push({
      ruleId: rule.id,
      description: rule.description,
      outcome: rule.then,
    });

    const t = rule.then;
    if (t.escorts !== undefined) bareEscorts = Math.max(bareEscorts, t.escorts);
    if (t.front !== undefined) out.front = Math.max(out.front, t.front);
    if (t.rear !== undefined) out.rear = Math.max(out.rear, t.rear);
    if (t.policeFront !== undefined) {
      out.policeFront = Math.max(out.policeFront, t.policeFront);
    }
    if (t.policeRear !== undefined) {
      out.policeRear = Math.max(out.policeRear, t.policeRear);
    }
    if (t.heightPole) out.heightPole = true;
    if (t.routeSurvey) out.routeSurvey = true;
    if (t.superload) out.superload = true;
    if (t.manualReview !== undefined) {
      out.requiresManualReview = true;
      warnings.push(
        `${rule.description}: ${t.manualReview} Source: ${citeOf(rule.source)}.`,
      );
    }
    // An advisory states a real exclusion WITHOUT invalidating the price.
    if (t.advisory !== undefined) warnings.push(t.advisory);
  }

  out.totalEscorts = Math.max(bareEscorts, out.front + out.rear);

  for (const id of missingRefs) {
    warnings.push(
      `An escort rule references rule "${id}", which is not in effect on ${asOf}. The dependent rule could not be evaluated.`,
    );
    out.requiresManualReview = true;
  }

  return out;
}

/** Feet+inches → inches. Keeps rule data readable: `ftIn(8, 6)` = 8'6". */
export function ftIn(feet: number, inches = 0): number {
  return feet * 12 + inches;
}

/** Inches → a readable 8'6" string for quote copy. */
export function formatFtIn(totalInches: number): string {
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round((totalInches - feet * 12) * 100) / 100;
  return inches === 0 ? `${feet}'` : `${feet}'${inches}"`;
}
