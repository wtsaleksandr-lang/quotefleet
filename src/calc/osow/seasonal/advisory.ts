/**
 * SURFACING — turning a seasonal snapshot into something the OS/OW engine can
 * say, and the decision NOT to reprice on it.
 *
 * ── THE DECISION: FLAG, NEVER REPRICE. AND WHY THAT IS NOT TIMIDITY ───────
 * A live frost-law restriction genuinely lowers a legal limit this engine
 * models. The obvious move is to apply it — drop the axle limit 25% and let the
 * permit fall out. That would be wrong here, for three independent reasons, any
 * one of which is sufficient:
 *
 *   1. THE RESTRICTION IS SEGMENT-SCOPED AND WE ARE GIVEN STATES. North
 *      Dakota's feed restricts "ND 15 from MP 46.27 to MP 52.329"; Michigan
 *      restricts routes drawn "Seasonal" on the Truck Operators Map. This
 *      engine is handed a LIST OF STATE CODES, not a routed geometry —
 *      `stateMileage.ts` documents at length that QuoteFleet has no routed
 *      polyline and deliberately refuses to estimate one. So we cannot know
 *      whether the filed route touches a restricted segment. Repricing every
 *      North Dakota load because four segments out of 504 are posted would be a
 *      confident wrong number on the 500 that are clear — and the reverse
 *      error, quoting the unrestricted limit on the four that are posted, is
 *      the one that gets a truck impounded. Neither is improved by picking one.
 *
 *   2. THE REDUCTION DEPENDS ON THE PAVEMENT, NOT THE STATE. Michigan's own
 *      figure is "25% for rigid pavements and 35% for flexible". Which one
 *      applies is a property of each mile of road. A state code cannot answer it.
 *
 *   3. FRESHNESS IS NOT GUARANTEED AND WE SAY SO. These snapshots are polled,
 *      not pushed. A repriced number carries no visible age; a warning carries
 *      its own `retrievedOn`, the bulletin's own date, and the state's link. If
 *      the data is a day old, a warning is still true and a reprice is a
 *      silently stale price.
 *
 * So the contract is: **a seasonal restriction produces a cited WARNING with
 * its window and the state's own bulletin link — never a changed dollar figure
 * and never a changed weight limit.** This is the same shape as the escort
 * exclusion on `/tools/oversize-permits`: a real requirement stated in full
 * beside the price rather than folded into it as a guess.
 *
 * ── WHERE IT ESCALATES ────────────────────────────────────────────────────
 * `requiresManualReview` is set in exactly one case: the state has an ACTIVE
 * restriction AND the load already needs an overweight permit there. That is
 * the case where the state may refuse, reduce or re-route the permit during the
 * thaw, so a quote issued without a human is a quote that can be wrong by the
 * whole permit. A legal-weight load in the same state gets the warning and no
 * escalation — it is information, not a blocker.
 *
 * ── AND WHERE WE HOLD NOTHING ─────────────────────────────────────────────
 * A state we cover but hold no current data for produces a warning saying
 * exactly that, with the link. "We do not know" is the honest output and it is
 * never rendered as "no restrictions" — the same rule `resolveSourced` applies
 * when nothing is in effect for a fee.
 */
import { citeOf, isInEffect, type IsoDate, type SourceDoc } from '../provenance.js';
import { cadenceFor, stalenessBudgetDays } from './schedule.js';
import { seasonalSourceFor } from './sources.js';
import {
  ageInDays,
  type SeasonalContext,
  type SeasonalRestriction,
  type StateSeasonalSnapshot,
} from './types.js';

export interface SeasonalAdvisory {
  state: string;
  /** Restrictions in force on the as-of date. */
  active: SeasonalRestriction[];
  /** Customer-facing sentences. Cited, dated, and never a price change. */
  warnings: string[];
  /** Internal notes — staleness, an unreachable store. Not customer copy. */
  dataQuality: string[];
  requiresManualReview: boolean;
  sources: SourceDoc[];
  /** The state's own page, always present so a dispatcher can verify. */
  authorityUrl: string | null;
}

const EMPTY: Omit<SeasonalAdvisory, 'state'> = {
  active: [],
  warnings: [],
  dataQuality: [],
  requiresManualReview: false,
  sources: [],
  authorityUrl: null,
};

export interface SeasonalAdvisoryInput {
  /** True when this state already requires an OS/OW permit for the load. */
  permitRequired: boolean;
  /** True when the load is over the state's legal WEIGHT specifically. */
  overweight: boolean;
}

/** Restrictions in force on `asOf`. */
export function activeRestrictions(
  snapshot: StateSeasonalSnapshot,
  asOf: IsoDate,
): SeasonalRestriction[] {
  return snapshot.rows.filter((r) => isInEffect(r, asOf));
}

/**
 * Is this snapshot older than its own tier's budget? Uses the state's cadence,
 * so an off-season snapshot is not scolded for being six days old when six days
 * is the schedule.
 */
export function isStale(snapshot: StateSeasonalSnapshot, asOf: IsoDate, now: Date): boolean {
  if (snapshot.retrievedOn === null) return true;
  const spec = seasonalSourceFor(snapshot.code);
  if (spec === null) return false;
  const budget = stalenessBudgetDays(cadenceFor(spec, now).tier);
  return ageInDays(snapshot.retrievedOn, asOf) > budget;
}

function windowText(r: SeasonalRestriction): string {
  return r.effectiveTo === null
    ? `in force from ${r.effectiveFrom}, with no lift date published yet`
    : `in force ${r.effectiveFrom} to ${r.effectiveTo}`;
}

/**
 * The whole surfacing decision for one state.
 *
 * PURE. Takes the snapshot the caller already loaded (or the absence of one),
 * plus `now` for the staleness tier. Never touches the database, never fetches.
 */
export function seasonalAdvisoryFor(
  code: string,
  ctx: SeasonalContext | undefined,
  asOf: IsoDate,
  input: SeasonalAdvisoryInput,
  now: Date = new Date(),
): SeasonalAdvisory {
  const state = String(code ?? '').trim().toUpperCase();
  const spec = seasonalSourceFor(state);

  // A state outside the registry entirely. We say nothing rather than implying
  // an absence we have not checked — the OS/OW engine already warns loudly
  // about states it holds no data for at all.
  if (spec === null) return { state, ...EMPTY };

  // A state with no seasonal programme is a POSITIVE answer, not a gap, and it
  // is worth one quiet line because the aggregator sites say otherwise.
  if (spec.programme !== 'statewide') {
    const who =
      spec.programme === 'local-only'
        ? `${spec.name} posts no seasonal weight restriction on the state highway system; local road agencies post their own on local roads. ${spec.note}`
        : `${spec.name} runs no spring-thaw weight restriction programme. ${spec.note}`;
    return {
      state,
      ...EMPTY,
      authorityUrl: spec.authorityUrl,
      dataQuality: [`Seasonal restrictions — ${who} (${spec.authorityUrl})`],
    };
  }

  const snapshot = ctx?.snapshots.get(state) ?? null;

  // The store itself was unreachable, or we simply hold nothing for a state
  // that DOES restrict. Both are "we do not know", and both must say so.
  if (snapshot === null || snapshot.retrievedOn === null) {
    const reason = ctx?.storeUnavailable
      ? 'our seasonal-restriction store was unreachable when this quote was priced'
      : 'we hold no current seasonal-restriction data for this state';
    return {
      state,
      ...EMPTY,
      authorityUrl: spec.authorityUrl,
      requiresManualReview: input.overweight,
      warnings: [
        `${spec.name} imposes spring-thaw weight restrictions on state highways, and ${reason}. A load that is legal here in summer can be illegal on the same road during the thaw. Check ${spec.authorityTitle} before dispatch: ${spec.authorityUrl}`,
      ],
      dataQuality: [
        `Seasonal restrictions ${state}: no usable snapshot (${snapshot === null ? 'none held' : 'never fetched'}); source ${spec.authorityUrl}`,
      ],
    };
  }

  const active = activeRestrictions(snapshot, asOf);
  const stale = isStale(snapshot, asOf, now);
  const age = ageInDays(snapshot.retrievedOn, asOf);
  const warnings: string[] = [];
  const dataQuality: string[] = [];
  const sources: SourceDoc[] = [];

  for (const r of active) {
    if (!sources.some((s) => s.id === r.source.id)) sources.push(r.source);
  }

  if (active.length > 0) {
    const detail = active
      .slice(0, 6)
      .map((r) => `${r.value.area} — ${r.value.limit} (${windowText(r)})`)
      .join('; ');
    const more = active.length > 6 ? ` …and ${active.length - 6} more` : '';
    warnings.push(
      `${spec.name} has a SEASONAL WEIGHT RESTRICTION in force on ${asOf}: ${detail}${more}. ` +
        `These restrictions apply to specific roads, and this quote is priced from state codes rather than a routed lane, so we CANNOT tell you whether your route touches a restricted segment — and we have deliberately NOT changed any weight limit or fee on the strength of it. Confirm your route against ${spec.authorityTitle}: ${spec.authorityUrl}` +
        (sources.length > 0 ? ` — ${citeOf(sources[0] as SourceDoc)}` : ''),
    );
    if (input.permitRequired && input.overweight) {
      warnings.push(
        `This ${spec.name} leg already needs an OVERWEIGHT permit while a seasonal restriction is in force. During the thaw a state can reduce, re-route or refuse an overweight permit it would issue in July, so this leg is sent for manual review rather than quoted from the published fee schedule alone.`,
      );
    }
  } else if (snapshot.verifiedClear && snapshot.fetchStatus === 'ok' && !stale) {
    // A VERIFIED clear. Worth stating: it is the difference between "we read
    // the state's own status this morning and nothing is posted" and "we have
    // no idea", and only one of those is a reason to dispatch.
    dataQuality.push(
      `Seasonal restrictions ${state}: none in force on ${asOf}; read from ${spec.authorityTitle} on ${snapshot.retrievedOn}.`,
    );
  } else if (!stale) {
    // Fetched, but the source did not positively say "clear" — a page we watch
    // for change rather than parse, or a bulletin whose prose we declined to
    // interpret. NO ROWS IS NOT A GREEN LIGHT HERE, and saying nothing at all
    // would let the reader supply the green light themselves.
    warnings.push(
      `We have not been able to confirm ${spec.name}'s current seasonal-restriction status from its own publication (last read ${snapshot.retrievedOn}). ${spec.name} does impose spring-thaw restrictions, and no restriction is listed above only because none could be read — not because the state has posted none. Check ${spec.authorityTitle} before dispatch: ${spec.authorityUrl}`,
    );
    dataQuality.push(
      `Seasonal restrictions ${state}: fetched ${snapshot.retrievedOn} but not positively cleared (${spec.ingestion}); no rows produced.`,
    );
  }

  if (stale) {
    const direction =
      snapshot.staleFailureDirection === 'over-restricts'
        ? `${spec.name} publishes only what is currently in force, so a stale copy points the WRONG WAY SAFE: it can keep showing a restriction the state has already lifted. Treat any restriction above as needing confirmation, not as a reason to stand down.`
        : `${spec.name} publishes a start and an end date per restriction, so a stale copy points the WRONG WAY DANGEROUS: a restriction posted or extended since we last read the source will NOT appear above. Absence of a restriction here is not evidence of one.`;
    warnings.push(
      `Our copy of ${spec.name}'s seasonal restrictions is ${age} day(s) old${snapshot.lastError ? ` (last attempt failed: ${snapshot.lastError})` : ''}. ${direction} The state's own page is authoritative: ${spec.authorityUrl}`,
    );
    dataQuality.push(
      `Seasonal restrictions ${state}: STALE — retrieved ${snapshot.retrievedOn}, ${age} day(s) ago, budget ${stalenessBudgetDays(cadenceFor(spec, now).tier)} day(s).`,
    );
  }

  if (spec.ingestion === 'change-detect') {
    dataQuality.push(
      `Seasonal restrictions ${state}: ${spec.name} publishes as ${spec.format}, which cannot be parsed into restriction rows without guessing. We monitor the page for change and link to it; we never synthesise a limit from it.`,
    );
  }

  return {
    state,
    active,
    warnings,
    dataQuality,
    // Escalate ONLY when a live restriction meets a load that is already
    // overweight there. See the module header.
    requiresManualReview: active.length > 0 && input.permitRequired && input.overweight,
    sources,
    authorityUrl: spec.authorityUrl,
  };
}
