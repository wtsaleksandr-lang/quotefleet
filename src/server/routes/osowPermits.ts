/**
 * PUBLIC OVERSIZE / OVERWEIGHT STATE-PERMIT CALCULATOR — the first consumer of
 * `src/calc/osow`.
 *
 * The engine has held cited, effective-dated permit-fee data for 21 states since
 * Phase 6 and, until this file, NOTHING outside `src/calc/osow/` called
 * `calculateOsow`. The one production reference was a ceiling constant in
 * `widget.js` (`OSOW_SUPERLOAD_LBS`). This route is what makes the data
 * reachable: a free, no-account tool at `/tools/oversize-permits` and a JSON API
 * at `POST /api/tools/osow-permits`.
 *
 * ── WHAT THIS PRICES, AND WHAT IT DOES NOT ────────────────────────────────
 * STATE PERMIT FEES ONLY. Not a delivered freight price. There is no line haul,
 * no fuel, no escort COST, no margin, no broker fee, and no second-issuer
 * permit where a state has one. A reader who takes the total for a shipping
 * quote has been misled, so the page says so beside the number rather than in a
 * footnote, and the API says so in `notIncluded`.
 *
 * The escort omission is the expensive one and it is stated in dollars, not in
 * adjectives: the engine can say a load NEEDS a pilot car (`escortRules.ts`) but
 * cannot price one (`escortCost.ts` holds no rate data and is imported by
 * nothing). On a 1,590-mile lane, ONE escort above $0.77 a mile costs more than
 * the entire permit total this page prints. So escorts render as a requirement
 * with an explicit "cost not included" — never as $0, never omitted.
 *
 * ── WHY MILEAGE IS ASKED FOR, NOT COMPUTED ────────────────────────────────
 * Several states price the overweight permit on miles travelled INSIDE that
 * state (Tennessee at 6¢ per ton-mile, Arkansas by mileage band, Pennsylvania
 * and Florida per mile). `stateMileage.ts` documents the two honest ways to get
 * those miles and the third that is deliberately absent: there is NO estimator,
 * because scaling a lane total by each state's share of a great-circle line
 * produces a confident number with no relationship to the filed route.
 *
 * A routed-polyline split needs a real routed geometry, which QuoteFleet only
 * gets from the billed Google Directions API. So this tool takes the
 * OPERATOR-SUPPLIED path: the dispatcher types the per-state miles their
 * PC*Miler/ProMiles run already produced — the same figures that go on the
 * permit application, which makes them the miles the state will actually bill.
 * The page says that plainly and never implies we routed the lane.
 *
 * `priceOsowWithStateMileage` is the ONLY sanctioned entry point for pricing off
 * a split. `calculateOsow(osowLegsFrom(split), …)` is arithmetically identical
 * and silently drops every caveat about where the miles came from, which is
 * exactly the failure `stateMileage.ts` exists to prevent.
 *
 * ── ROUTES ────────────────────────────────────────────────────────────────
 *   GET  /tools/oversize-permits   — the free public page (no account).
 *   GET  /api/tools/osow-permits/coverage — the 21 covered states + the form's
 *                                   option lists, so the page has no hardcoded
 *                                   copy of a list the engine owns.
 *   POST /api/tools/osow-permits   — price a lane. Rate-limited with
 *                                   `publicCalcLimiter`, the same limiter as
 *                                   the other free `/api/tools/*` endpoints.
 *
 * NO DATABASE. Every input is in the request and every fee is in the compiled
 * jurisdiction data, so the tool answers correctly with the database down —
 * which is the state the dev Neon branch is in.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  IMMATERIAL_CONFLICT_THRESHOLD_USD,
  type OsowLoad,
  type OsowQuote,
} from '../../calc/osow/engine.js';
import {
  operatorSuppliedStateMileage,
  priceOsowWithStateMileage,
} from '../../calc/osow/stateMileage.js';
import {
  estimateLaneEscortCost,
  type LaneEscortEstimate,
} from '../../calc/osow/escortCost.js';
import { OSOW_JURISDICTIONS, hasOsowCoverage } from '../../calc/osow/jurisdictions/index.js';
import { todayIso } from '../../calc/osow/provenance.js';
import { US_STATES, US_STATE_CODES, stateByCode } from '../directory/usStates.js';
import { escortDirectoryHref } from '../pilotCars/model.js';
import { publicCalcLimiter } from '../rateLimits.js';
import { setPublicDirectoryCache } from '../directory/httpCache.js';
import { FULL_SITE_HEADER, PREMIUM_FOOTER, HEADER_SCRIPTS } from '../siteChrome.js';

const SITE = 'https://quotefleet.net';
export const OSOW_TOOL_PATH = '/tools/oversize-permits';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string),
  );
}

// ── Coverage ───────────────────────────────────────────────────────────────

/** The states the engine holds permit data for, alphabetical by name. */
export function osowCoveredStates(): Array<{ code: string; name: string }> {
  return Object.values(OSOW_JURISDICTIONS)
    .map((j) => ({ code: j.code, name: j.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Territories in `US_STATES` that this tool does not offer.
 *
 * `US_STATE_CODES` is the directory's membership set and includes them, so
 * validating a leg against it let the API accept a state the FORM cannot
 * produce — a public endpoint answering for Puerto Rico while the page it
 * belongs to has no such option. They are excluded here for the same reason
 * they are excluded from the form: none is reachable by road from the mainland,
 * so an in-state mileage leg for one is not a lane this calculator describes.
 * `OSOW_SELECTABLE_STATE_CODES` is now the single list both surfaces read.
 */
const OSOW_TERRITORY_CODES: ReadonlySet<string> = new Set(['PR', 'VI', 'GU']);

const OSOW_SELECTABLE_STATES = US_STATES.filter(
  (s) => s.code.length === 2 && !OSOW_TERRITORY_CODES.has(s.code),
);

/** Exactly the codes the form offers — and the API's own membership set. */
export const OSOW_SELECTABLE_STATE_CODES: ReadonlySet<string> = new Set(
  OSOW_SELECTABLE_STATES.map((s) => s.code),
);

/**
 * Every US state, flagged for coverage — the form's own state list.
 *
 * An uncovered state is deliberately SELECTABLE. Hiding the other 29 would make
 * "we do not hold Mississippi's fee schedule" look like "Mississippi charges
 * nothing", and a lane quietly missing a state is the single most misleading
 * output this tool could produce. Picking one produces a named, first-class
 * "not covered" result instead.
 */
export function osowStateOptions(): Array<{ code: string; name: string; covered: boolean }> {
  return OSOW_SELECTABLE_STATES.map((s) => ({
    code: s.code,
    name: s.name,
    covered: hasOsowCoverage(s.code),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Route classes offered publicly.
 *
 * `RouteClass` in `escortRules.ts` has ~30 members, most of them a single
 * state's own map colour (`ca-green`, `co-blue-two-lane`, `ky-class-aa`). Those
 * cannot be answered for a seven-state corridor from one control, and offering
 * them would invite a dispatcher to assert a Colorado map colour across
 * Tennessee. The four generic classes are the ones every state's escort table
 * can be read against; a state whose rules key on its OWN classification simply
 * leaves those rules unresolved, and the engine says so in that state's notes.
 *
 * EXACTLY FOUR OPTIONS, on purpose: the page renders them as a 2-column grid so
 * they wrap 2×2 and never leave one pill alone on a line.
 */
export const OSOW_ROUTE_CLASSES: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: 'interstate', label: 'Interstate', hint: 'Divided, controlled-access interstate highway.' },
  { value: 'divided', label: 'Divided highway', hint: 'Four or more lanes with a physical median.' },
  { value: 'multilane-undivided', label: 'Multi-lane, no median', hint: 'Two or more lanes each way, no divider.' },
  { value: 'two-lane', label: 'Two-lane road', hint: 'One lane each way.' },
];

const ROUTE_CLASS_VALUES = OSOW_ROUTE_CLASSES.map((r) => r.value) as [string, ...string[]];

// ── Request validation ─────────────────────────────────────────────────────

/**
 * Ceilings that reject nonsense without capping a real move.
 *
 * These are INPUT SANITY bounds, not permit limits. The engine decides what is
 * a superload and what has no published fee; this only stops a typo (a width in
 * millimetres, a weight with an extra zero) from reaching it.
 */
const MAX_WEIGHT_LBS = 2_000_000;
const MAX_DIMENSION_IN = 12 * 400; // 400 ft
const MAX_MILES_PER_STATE = 3_000;
export const OSOW_MAX_LEGS = 20;

const positive = (max: number) => z.number().finite().positive().max(max);

/**
 * MILES MUST BE GREATER THAN ZERO, and this is a correctness bound rather than
 * a tidiness one.
 *
 * The form's own error copy already says "enter the in-state mileage as a
 * positive number", and zero is not one. Accepting it produced a confident
 * understatement in every per-mile state: Pennsylvania at 0 mi prices its base
 * fee and a $0.00 distance charge, and reports the lane as priced. A leg with
 * no miles is a leg that was not filled in, not a state the load crosses for
 * free — so it is refused with the same words the page uses.
 */
const LegSchema = z.object({
  state: z.string().trim().min(2).max(2),
  miles: z
    .number()
    .finite()
    .positive('In-state miles must be a positive number — a leg of 0 mi is not a state the load crosses.')
    .max(MAX_MILES_PER_STATE),
});

const OsowRequestSchema = z.object({
  load: z.object({
    grossWeightLbs: positive(MAX_WEIGHT_LBS),
    widthIn: positive(MAX_DIMENSION_IN).optional(),
    heightIn: positive(MAX_DIMENSION_IN).optional(),
    overallLengthIn: positive(MAX_DIMENSION_IN).optional(),
    trailerLengthIn: positive(MAX_DIMENSION_IN).optional(),
    kingpinToRearAxleIn: positive(MAX_DIMENSION_IN).optional(),
    frontOverhangIn: z.number().finite().min(0).max(MAX_DIMENSION_IN).optional(),
    rearOverhangIn: z.number().finite().min(0).max(MAX_DIMENSION_IN).optional(),
    axleCount: z.number().int().min(2).max(40).optional(),
    routeClass: z.enum(ROUTE_CLASS_VALUES).optional(),
  }),
  legs: z
    .array(LegSchema)
    .min(1)
    .max(
      OSOW_MAX_LEGS,
      `A lane can carry at most ${OSOW_MAX_LEGS} states here. Remove a state before adding another.`,
    ),
  /**
   * Which fee schedule to read. Defaults to today.
   *
   * BOUNDED, BECAUSE IT IS AN UNAUTHENTICATED LEVER ON THE ANSWER. Every fee
   * row in the corpus is effective-dated, so `asOf=1800-01-01` puts all of them
   * out of effect and the engine correctly reports "no permit required, $0" —
   * a true statement about 1800 that renders on this page as "this move is
   * free". That is the one place the "$0 is not null" discipline inverts, and
   * the page never sends the parameter at all.
   *
   * The window is the range the corpus can actually answer for: from
   * `OSOW_ASOF_MIN`, the day the newest schedule on file took effect and so the
   * first day on which every recorded row is simultaneously in force, through
   * today — a future date would be a schedule nobody has published.
   */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /**
   * Whether to compute the ESCORT section. Defaults to on.
   *
   * The flag exists so the separation can be PROVEN rather than asserted: the
   * tests price the reference lane with it on and off and compare the `quote`
   * object byte for byte. It changes nothing about the permit arithmetic — the
   * estimator is a post-processor that reads a finished `OsowQuote` and cannot
   * write to one — and the flag is the cheapest way to keep saying so.
   *
   * The public page never sends it. See `escortEstimate` on the response.
   */
  includeEscortEstimate: z.boolean().optional(),
  /**
   * THE CALLER'S OWN PILOT-CAR RATE — the primary way an escort line gets a
   * number here, and the reason this tool does not synthesise one.
   *
   * A dispatcher already knows what their pilot cars cost; it is a rate they
   * negotiate. Their figure beats any band we could invent, and every other
   * number on this page traces to a statute with a revision date — spending that
   * for a made-up market rate would be a bad trade. With nothing supplied the
   * answer stays "we hold no pilot-car rates", which is true and useful.
   *
   * `days` has NO DEFAULT alongside `usdPerDay`: a day rate without a day count
   * is not a price, and defaulting to one would bill a five-day crossing as one
   * day. The bounds are typo guards, not opinions about the market.
   */
  pilotCarRate: z
    .object({
      usdPerMile: z.number().finite().positive().max(1_000).optional(),
      usdPerDay: z.number().finite().positive().max(100_000).optional(),
      daysPerJurisdiction: z.number().finite().positive().max(60).optional(),
      minimumUsdPerJurisdiction: z.number().finite().positive().max(1_000_000).optional(),
    })
    .optional(),
  /**
   * Opt in to QuoteFleet's own fallback pilot-car band. OFF BY DEFAULT and
   * ignored whenever `pilotCarRate` is supplied. It is our estimate, not a
   * published figure, and it is mileage-only — see
   * `QUOTEFLEET_INTERNAL_PILOT_CAR_BAND`.
   */
  useInternalPilotCarBand: z.boolean().optional(),
});

export type OsowRequest = z.infer<typeof OsowRequestSchema>;

/**
 * The earliest date the recorded fee schedules can be read for: the latest
 * `effectiveFrom` in the whole corpus.
 *
 * Computed rather than hardcoded so it cannot go stale when a state's schedule
 * is re-sourced — the alternative is a constant that silently starts admitting
 * dates on which part of the corpus is out of effect, which is the exact bug
 * the bound exists to close. One pass over the compiled data at module load.
 */
export const OSOW_ASOF_MIN: string = (() => {
  let latest = '1900-01-01';
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object' || depth > 8) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const row = node as { effectiveFrom?: unknown };
    if (typeof row.effectiveFrom === 'string' && row.effectiveFrom > latest) {
      latest = row.effectiveFrom;
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };
  walk(OSOW_JURISDICTIONS, 0);
  return latest;
})();

// ── The honest "not included" list ─────────────────────────────────────────

/**
 * Everything the total leaves out, stated once and reused by the page, the API
 * and the tests so the three can never drift apart.
 */
export const OSOW_NOT_INCLUDED: ReadonlyArray<{ item: string; why: string }> = [
  {
    item: 'Line haul, fuel and margin',
    why: 'This is a permit-fee calculator, not a freight rate. Nothing here prices moving the load.',
  },
  {
    /**
     * REWORDED WHEN THE PAGE GAINED A RATE INPUT. The old sentence — "we hold no
     * pilot-car rates, so the cost is yours to add" — described a page that could
     * not do arithmetic on an escort. It can now, from the operator's OWN rate,
     * so the honest claim changed shape: we still hold no pilot-car rates and
     * still never invent one, and no escort money has ever been inside
     * `totalPermitUsd`. What is new is that a rate you supply is applied for you,
     * beside the permit total and never inside it.
     */
    item: 'Pilot car / escort cost',
    why: 'No escort money is ever inside the permit total. We hold no pilot-car rates of our own and will not invent one — enter YOUR pilot-car rate on this page and we apply it to the escort counts each state requires, as its own separate figure. On a long lane one escort can cost more than every permit on this page combined.',
  },
  {
    item: 'Police escorts, route surveys and bridge analysis',
    why: 'Several states impose these at the permitting office’s discretion with no published price.',
  },
  {
    item: 'Permits from a second issuing authority',
    why: 'A toll, bridge or city authority can require its own permit inside a state we do price. Where we know of one, the state’s notes name it.',
  },
  {
    item: 'Superload pricing',
    why: 'Above a state’s superload threshold there is no published fee — the agency prices it after an engineering review.',
  },
];

export const OSOW_HEADLINE_DISCLAIMER =
  'This total is STATE PERMIT FEES ONLY. It is not a freight quote: no line haul, no fuel, no escort cost, no margin.';

// ── Response shaping ───────────────────────────────────────────────────────

/**
 * Put the notes that describe an UNSETTLED fact ahead of the purely advisory
 * ones inside a state's list.
 *
 * This is ordering, not classification. Every note the engine recorded is still
 * shown, verbatim and in full — nothing is dropped and nothing is labelled as
 * "the" reason, because `calculateOsowForJurisdiction` raises
 * `requiresManualReview` from ~35 sites and does not tag which one fired. What
 * this does is stop a fourteen-note state burying the sentence a dispatcher
 * needs behind ten paragraphs of correctly-recorded background.
 */
const UNSETTLED_MARKERS = [
  'we hold no data for this field',
  'is not a single-issuer state',
  'never says',
  'is published nowhere',
  'not included in the',
  'could not be verified',
  'disagree',
  'cannot',
];

function unsettledFirst(warnings: readonly string[]): string[] {
  const rank = (w: string): number => {
    const lower = w.toLowerCase();
    return UNSETTLED_MARKERS.some((m) => lower.includes(m)) ? 0 : 1;
  };
  return [...warnings]
    .map((w, i) => ({ w, i, r: rank(w) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.w);
}

export interface OsowApiResponse {
  asOf: string;
  /** Verbatim engine output — fee lines, citations, escorts, data quality. */
  quote: OsowQuote;
  mileage: {
    basis: 'operatorSupplied';
    totalMiles: number;
    /** False: WE are not approximating. The operator's figures are still theirs. */
    approximate: boolean;
    note: string;
  };
  /** Named, first-class outcome for every state we hold no data for. */
  uncovered: Array<{ code: string; name: string }>;
  review: {
    required: boolean;
    /** Per-state notes, unsettled facts first. Nothing is dropped. */
    byState: Array<{ code: string; name: string; requiresManualReview: boolean; notes: string[] }>;
  };
  escorts: {
    /** Most any single state on the lane requires — the engine's own aggregate. */
    maxRequiredOnAnyState: number;
    byState: Array<{ code: string; name: string; required: number }>;
    /**
     * ALWAYS FALSE, AND IT STAYS FALSE NOW THAT AN ESTIMATE EXISTS. It means
     * "no escort money is inside `quote.totalPermitUsd`", which is still true:
     * `escortEstimate` is a parallel section computed after the quote and never
     * added to it.
     */
    costIncluded: false;
    note: string;
    /**
     * A DEEP LINK INTO THE ESCORT DIRECTORY, pre-filtered to this lane.
     *
     * The page cannot build this itself and must not try: "certified in KY" is
     * a filter for a certificate Kentucky does not issue, and it would return
     * zero operators forever. `escortDirectoryHref` intersects the lane with
     * the cited certification registry, so the `certin` half names only the
     * states that actually certify. `null` when no state on the lane requires
     * an escort — there is nothing to go and find.
     */
    directoryHref: string | null;
  };
  /**
   * THE ESCORT SECTION — deliberately its own top-level key, never folded into
   * `quote`.
   *
   * It carries figures that are never added together: a CIVILIAN pilot-car
   * amount, computed from the rate the CALLER supplied and labelled as theirs,
   * and a LAW-ENFORCEMENT floor, which is cited, effective-dated and resolved
   * through the same conflict machinery as a permit fee. With no rate supplied
   * the civilian side stays empty and says we hold no pilot-car rates, which is
   * the true answer rather than a failure. A consumer that wants permits only
   * reads `quote.totalPermitUsd` and is unaffected by anything here.
   */
  escortEstimate: {
    /** False when the caller passed `includeEscortEstimate: false`. */
    included: boolean;
    note: string;
    estimate: LaneEscortEstimate | null;
  };
  absorbedConflicts: {
    thresholdUsd: number;
    totalUsd: number;
    items: OsowQuote['absorbedConflicts'];
    note: string;
  };
  notIncluded: typeof OSOW_NOT_INCLUDED;
  disclaimer: string;
}

/**
 * Price a lane. Pure — no I/O, no database, no clock beyond `asOf`. Exported so
 * the tests exercise the same path the route does.
 */
export function priceOsowLane(input: OsowRequest): OsowApiResponse {
  const asOf = input.asOf ?? todayIso();

  const split = operatorSuppliedStateMileage(
    input.legs.map((leg) => {
      const code = leg.state.toUpperCase();
      return { stateCode: code, stateName: stateByCode(code)?.name ?? code, miles: leg.miles };
    }),
  );

  const load: OsowLoad = {
    grossWeightLbs: input.load.grossWeightLbs,
    ...(input.load.widthIn !== undefined ? { widthIn: input.load.widthIn } : {}),
    ...(input.load.heightIn !== undefined ? { heightIn: input.load.heightIn } : {}),
    ...(input.load.overallLengthIn !== undefined ? { overallLengthIn: input.load.overallLengthIn } : {}),
    ...(input.load.trailerLengthIn !== undefined ? { trailerLengthIn: input.load.trailerLengthIn } : {}),
    ...(input.load.kingpinToRearAxleIn !== undefined
      ? { kingpinToRearAxleIn: input.load.kingpinToRearAxleIn }
      : {}),
    ...(input.load.frontOverhangIn !== undefined ? { frontOverhangIn: input.load.frontOverhangIn } : {}),
    ...(input.load.rearOverhangIn !== undefined ? { rearOverhangIn: input.load.rearOverhangIn } : {}),
    ...(input.load.axleCount !== undefined ? { axleCount: input.load.axleCount } : {}),
    ...(input.load.routeClass !== undefined
      ? { routeClass: input.load.routeClass as OsowLoad['routeClass'] }
      : {}),
  };

  // The sanctioned entry point. See the module header for why the direct
  // `calculateOsow(osowLegsFrom(split), …)` call is not used here.
  const quote = priceOsowWithStateMileage(split, load, asOf);

  const uncovered = quote.uncoveredJurisdictions.map((code) => ({
    code,
    name: stateByCode(code)?.name ?? code,
  }));

  /**
   * COMPUTED AFTER THE QUOTE, FROM THE QUOTE. `estimateLaneEscortCost` takes a
   * finished `OsowQuote` and returns a new object; the quote above is already
   * final and is not passed by reference into anything that could write to it.
   * That is why turning this off cannot move a permit fee by a cent.
   */
  const includeEscortEstimate = input.includeEscortEstimate ?? true;
  const escortEstimate = includeEscortEstimate
    ? estimateLaneEscortCost(
        quote,
        Object.fromEntries(input.legs.map((l) => [l.state.toUpperCase(), l.miles])),
        {
          asOf,
          ...(input.pilotCarRate === undefined ? {} : { pilotCarRate: input.pilotCarRate }),
          ...(input.useInternalPilotCarBand === undefined
            ? {}
            : { useInternalBand: input.useInternalPilotCarBand }),
        },
      )
    : null;

  return {
    asOf,
    quote,
    mileage: {
      basis: 'operatorSupplied',
      totalMiles: Math.round(split.totalMiles * 100) / 100,
      approximate: split.approximate,
      note: 'Per-state miles are the figures you supplied, not a route we computed. Every per-mile and ton-mile fee below is calculated directly from them, so they must match the route you file with each state.',
    },
    uncovered,
    review: {
      required: quote.requiresManualReview,
      byState: quote.jurisdictions.map((j) => ({
        code: j.jurisdiction,
        name: j.jurisdictionName,
        requiresManualReview: j.requiresManualReview,
        notes: unsettledFirst(j.warnings),
      })),
    },
    escorts: {
      maxRequiredOnAnyState: quote.totalEscortsRequired,
      byState: quote.jurisdictions.map((j) => ({
        code: j.jurisdiction,
        name: j.jurisdictionName,
        required: j.escortsRequired,
      })),
      costIncluded: false,
      /**
       * REWORDED ALONGSIDE `OSOW_NOT_INCLUDED`. "Price them from your own vendor
       * rate" was an instruction to go and do the sum somewhere else, which went
       * stale the moment `pilotCarRate` existed. `costIncluded: false` above is
       * NOT stale and never will be: it means no escort money is inside
       * `quote.totalPermitUsd`, which stays true however this section is priced.
       */
      note: 'Escort COST is never inside the permit total, however it is priced. States set the requirement; pilot cars are private vendors and we hold no rates of our own — supply yours and it is applied to these counts as its own separate figure. Where a state publishes a LAW-ENFORCEMENT escort rate, that figure is cited and shown apart from anything derived from your rate.',
      // Built from the states that ACTUALLY require an escort on this load, not
      // from every state on the lane: a link that pre-filters on a state needing
      // no escort narrows the list for no reason.
      directoryHref:
        quote.jurisdictions.some((j) => j.escortsRequired > 0)
          ? escortDirectoryHref(
              quote.jurisdictions.filter((j) => j.escortsRequired > 0).map((j) => j.jurisdiction),
            )
          : null,
    },
    escortEstimate: {
      included: includeEscortEstimate,
      note: includeEscortEstimate
        ? 'Escort cost, in figures that are never added together. PILOT CARS are priced from the rate YOU supply in `pilotCarRate` — we hold no pilot-car rates, because no state publishes one and your negotiated rate beats any range we could invent. The LAW-ENFORCEMENT floor is cited and effective-dated, and it is the published minimum only, never a total: the hours are set by the agency on the day. Nothing here is inside the permit total above.'
        : 'Not computed for this request. The permit total is identical either way — the estimator reads the finished quote and cannot change it.',
      estimate: escortEstimate,
    },
    absorbedConflicts: {
      thresholdUsd: IMMATERIAL_CONFLICT_THRESHOLD_USD,
      totalUsd: quote.absorbedConflictTotalUsd,
      items: quote.absorbedConflicts,
      note: `Where two official sources disagreed by $${IMMATERIAL_CONFLICT_THRESHOLD_USD} or less on one fee, we quoted the HIGHER figure and priced the lane rather than stopping it. Each is listed so you can see which number moved and why.`,
    },
    notIncluded: OSOW_NOT_INCLUDED,
    disclaimer: OSOW_HEADLINE_DISCLAIMER,
  };
}

// ── Page CSS ───────────────────────────────────────────────────────────────
//
// Lives in this module rather than in `src/server/public/*.css` for the same
// reason `GLOSSARY_CSS` does: the page is server-rendered from one file and its
// styles travel with it. Every colour is a token from style.css, so light and
// dark both work with no `data-theme` block of our own and no raw hex.

const OSOW_CSS = `
  .ow-shell { max-width: 1080px; margin: 0 auto; padding: 24px; }
  /* Shared .hero centres its text. Left-align it, and centre the same 1032px
     column the body uses so the H1 starts on the body's left edge instead of
     overhanging the header card (the defect fixed on /glossary). */
  .ow-hero { padding: 48px 24px 16px; text-align: left; }
  .ow-hero .container-narrow { max-width: 1032px; margin: 0 auto; padding: 0; }
  .ow-eyebrow { color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px; text-align: left; }
  .ow-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 8px; text-align: left; text-wrap: balance; }
  .ow-hero p.lead { max-width: 780px; margin: 0; text-align: left; text-wrap: pretty; }

  /* ── The honesty banner. Solid, never glass: it sits behind body text. ── */
  .ow-truth { background: var(--warn-bg); border: 1px solid var(--warn); border-radius: var(--radius-lg); padding: 16px; margin: 16px 0 0; }
  .ow-truth h2 { font-size: 16px; margin: 0 0 4px; color: var(--ink); }
  .ow-truth p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }
  .ow-truth strong { color: var(--ink); }

  .ow-grid { display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 1fr); gap: 24px; align-items: start; margin-top: 24px; }

  .ow-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
  .ow-card + .ow-card { margin-top: 16px; }

  /* Section header: help cue TOP-LEFT, never inline with a label. */
  .ow-sec { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px; }
  .ow-cue { flex: 0 0 auto; width: 24px; height: 24px; min-width: 24px; min-height: 24px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; font-weight: 700; line-height: 1; cursor: pointer; padding: 0; }
  .ow-cue:hover, .ow-cue:focus-visible { border-color: var(--accent); color: var(--accent); }
  .ow-sec h2 { font-size: 15px; margin: 0; align-self: center; color: var(--ink); }
  .ow-cue-body { display: none; font-size: 13px; line-height: 1.55; color: var(--ink-soft); background: var(--surface-3); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin: 0 0 8px; }
  .ow-cue-body.is-open { display: block; }

  /* ── Inputs: label INSIDE the field, 2px between stacked components. ── */
  .ow-stack { display: grid; gap: 2px; }
  .ow-row2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; }
  .ow-row3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; }
  .ow-field { position: relative; display: block; }
  .ow-field input, .ow-field select { width: 100%; min-height: 48px; box-sizing: border-box; padding: 20px 12px 6px; font: inherit; font-size: 15px; color: var(--ink); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); appearance: none; }
  .ow-field select { padding-top: 20px; }
  .ow-field input:focus, .ow-field select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .ow-field .ow-lab { position: absolute; left: 12px; top: 6px; font-size: 11px; letter-spacing: 0.02em; color: var(--muted); pointer-events: none; transition: none; }
  .ow-field input:placeholder-shown:not(:focus) + .ow-lab { top: 16px; font-size: 14px; color: var(--muted); }
  .ow-field input:focus + .ow-lab, .ow-field select:focus + .ow-lab { color: var(--accent); }

  /* Route-class pills: 4 options in a 2-column grid, so they wrap 2x2 and a
     single pill can never sit alone on a line. Selected = outline + tint. */
  .ow-pills { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; }
  .ow-pill { min-height: 44px; padding: 8px 12px; font: inherit; font-size: 13px; text-align: left; color: var(--ink-soft); background: transparent; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
  .ow-pill:hover { border-color: var(--border-strong); }
  .ow-pill[aria-pressed="true"] { border-color: var(--accent); border-width: 2px; padding: 8px 12px; background: var(--accent-soft); color: var(--ink); }

  .ow-legs { display: grid; gap: 2px; }
  .ow-leg { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 116px) 44px; gap: 2px; }
  .ow-legdrop { min-height: 44px; min-width: 44px; border: 1px solid var(--border); border-radius: var(--radius); background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; }
  .ow-legdrop:hover { border-color: var(--error); color: var(--error); }

  .ow-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .ow-actions .btn { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; }
  /* The Add button STOPS at the cap the API enforces, rather than letting the
     user build a 21st row and meet a 400. A disabled control still has to read
     as disabled in both themes. */
  .ow-actions .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ow-hint { font-size: 12px; color: var(--muted); margin: 8px 0 0; line-height: 1.5; }
  .ow-hint[hidden] { display: none; }

  /* ── Results ── */
  .ow-results { scroll-margin-top: 96px; }
  .ow-total { scroll-margin-top: 96px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); padding: 16px; }
  .ow-total .ow-tl { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
  /* Flat ink, never the accent: the total must not collide with its surface. */
  .ow-total .ow-tv { font-size: 40px; font-weight: 700; line-height: 1.1; color: var(--ink); margin: 0; }
  .ow-total .ow-tsub { font-size: 13px; color: var(--ink-soft); margin: 4px 0 0; line-height: 1.55; }

  .ow-flags { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .ow-flag { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--bg); }
  .ow-flag .k { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 4px; }
  .ow-flag .v { font-size: 16px; font-weight: 600; color: var(--ink); }
  .ow-flag .n { font-size: 12px; color: var(--muted); line-height: 1.5; display: block; margin-top: 4px; }

  .ow-note { border-radius: var(--radius-lg); padding: 16px; margin-top: 16px; border: 1px solid var(--border); background: var(--surface); }
  .ow-note h3 { font-size: 15px; margin: 0 0 8px; color: var(--ink); }
  .ow-note p, .ow-note li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }
  .ow-note ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
  .ow-note--warn { border-color: var(--warn); background: var(--warn-bg); }
  .ow-note--error { border-color: var(--error); background: var(--error-bg); }

  .ow-state { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 16px; margin-top: 12px; }
  .ow-state--review { border-color: var(--warn); }
  .ow-sh { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .ow-sh h3 { font-size: 17px; margin: 0; color: var(--ink); }
  .ow-sh .amt { font-size: 17px; font-weight: 700; color: var(--ink); font-family: var(--font-mono); }
  /* TWO CONTENT-SIZED COLUMNS, not flex-wrap. A state carries 1-4 status badges
     depending on the load, and a wrapping flex row puts a lone badge on its own
     line at any width where three fit and four do not. A 2-column grid wraps
     into pairs by construction, and renderState pads an odd count with the
     as-of badge so the last row is never a single item. */
  .ow-badges { display: grid; grid-template-columns: repeat(2, minmax(0, max-content)); gap: 4px; justify-content: start; margin-top: 8px; }
  .ow-over { font-size: 12px; line-height: 1.5; color: var(--muted); margin: 8px 0 0; overflow-wrap: anywhere; }
  .ow-badge { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 8px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); color: var(--muted); white-space: nowrap; }
  .ow-badge--review { border-color: var(--warn); color: var(--warn); }
  .ow-badge--escort { border-color: var(--accent); color: var(--accent); }

  .ow-lines { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  .ow-lines th, .ow-lines td { text-align: left; padding: 8px 8px 8px 0; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--ink-soft); }
  .ow-lines th { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
  .ow-lines td.num, .ow-lines th.num { text-align: right; padding-right: 0; font-family: var(--font-mono); color: var(--ink); white-space: nowrap; }
  .ow-lines .sub td { font-weight: 700; color: var(--ink); border-bottom: none; }
  .ow-lines .ln { display: block; font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 4px; }
  .ow-tablewrap { overflow-x: auto; }

  .ow-why { margin-top: 12px; border: 1px solid var(--warn); border-radius: var(--radius); background: var(--warn-bg); padding: 12px; }
  .ow-why h4 { font-size: 13px; margin: 0 0 8px; color: var(--ink); }
  .ow-why ol { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
  .ow-why li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }

  .ow-cites { margin-top: 12px; }
  .ow-cites summary { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); cursor: pointer; }
  .ow-cites summary:hover { color: var(--accent); }
  .ow-cites ul { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 4px; }
  .ow-cites li { font-size: 12px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
  .ow-cites a { color: var(--accent); overflow-wrap: anywhere; }

  /* SEVEN COLUMNS BECAUSE THERE ARE 21 COVERED STATES, and 21 = 3 x 7 exactly.
     An auto-fill grid or a flex wrap lands on five columns at some width, where
     21 chips leave ONE alone on a fourth row. A fixed 7 cannot. */
  .ow-cov { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-top: 8px; }
  .ow-cov span { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; padding: 4px; text-align: center; border-radius: var(--radius-pill); border: 1px solid var(--border); color: var(--muted); }

  .ow-empty { color: var(--muted); font-size: 14px; line-height: 1.6; margin: 0; }
  .ow-busy { color: var(--muted); font-size: 14px; margin: 0; }

  /* ── THE ALL-STATES SUMMARY — every state on one screen. ──────────────────
     The single structural idea taken from the competitive review: a reader who
     wants to know what the lane costs per state should not have to scroll seven
     detail blocks to assemble it. The detail stays below, in full; this is a
     second view of the same numbers, not a replacement for them.

     It SCROLLS INSIDE ITS OWN BOX at narrow widths (.ow-sumwrap) and carries a
     min-width, because seven money columns cannot compress to 375px without
     becoming unreadable. The wrapper is what scrolls; document.scrollWidth
     never moves, which the e2e suite asserts rather than eyeballs. */
  .ow-summary { background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); padding: 16px; margin-top: 16px; }
  .ow-summary > h3 { font-size: 15px; margin: 0 0 4px; color: var(--ink); }
  .ow-summary > .ow-hint { margin: 0 0 8px; }
  .ow-sumwrap { overflow-x: auto; }
  /* 520px is the width at which seven columns are still readable, and it is
     under the ~556px the results column gets at 1080px — so the table fits with
     no inner scroll on desktop and scrolls inside its own box on a phone. The
     two text columns wrap; only the money columns are nowrap, because a
     mid-figure line break is a misread waiting to happen. */
  .ow-sum { width: 100%; min-width: 520px; border-collapse: collapse; font-size: 13px; }
  /* 4px of column gutter, not 8: seven columns of 8 cost 28px, and 28px was the
     difference between the table fitting the 554px results column and cutting
     the Status column off behind an inner scrollbar on a 1440px desktop. */
  .ow-sum th, .ow-sum td { text-align: left; padding: 8px 4px 8px 0; border-bottom: 1px solid var(--border); color: var(--ink-soft); white-space: normal; vertical-align: middle; }
  .ow-sum th { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
  .ow-sum td.num, .ow-sum th.num { text-align: right; font-family: var(--font-mono); color: var(--ink); white-space: nowrap; }
  .ow-sum td.nil { color: var(--muted); }
  /* The state name stays put while the money columns scroll under it at phone
     width — a row of figures with no state against it is unreadable. Sticky in
     the scroll axis of .ow-sumwrap, which is overflow-x: auto, never hidden. */
  .ow-sum th:first-child, .ow-sum td:first-child { position: sticky; left: 0; background: var(--surface); }
  .ow-sum .ow-sumtot td:first-child { background: var(--surface); }
  .ow-sum tbody tr:last-child td { border-bottom: none; }
  /* The totals row is the reason the table exists. Rule above it, never a fill. */
  .ow-sum .ow-sumtot td { font-weight: 700; color: var(--ink); border-top: 2px solid var(--border-strong); border-bottom: none; padding-top: 12px; }
  /* A PILL MUST NEVER WRAP. Broken across two lines an outlined chip reads as a
     rendering fault, so the chip is nowrap and the cell around it is what
     absorbs a narrow column. */
  .ow-sum .ow-st { display: inline-block; white-space: nowrap; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 8px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); color: var(--muted); }
  .ow-sum .ow-st--review { border-color: var(--warn); color: var(--warn); }
  .ow-sum .ow-st--none { border-color: var(--error); color: var(--error); }
  .ow-sum .ow-st--np { border-color: var(--warn); color: var(--warn); }
  /* USER-SOURCED money inside a table of cited money. Never the same treatment. */
  .ow-sum td.mine { font-style: italic; }

  /* THE "NOW FIND ONE" LINE. It sits inside the escort note rather than in a
     card of its own, because it is the second half of that note's sentence and
     a separate CTA block would read as an advert beside cited data. */
  .ow-find { margin: 8px 0 0; font-size: 13px; line-height: 1.55; }
  .ow-find a { color: var(--accent); }

  /* ── FOLDED PROSE. Every note and every citation is still here, one click
     away, and the count is on the summary so nothing looks smaller than it is. */
  .ow-fold { margin-top: 12px; }
  .ow-fold > summary { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); cursor: pointer; }
  .ow-fold > summary:hover, .ow-fold > summary:focus-visible { color: var(--accent); }
  .ow-fold ol, .ow-fold ul { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 8px; }
  .ow-fold li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }
  /* The reason that stays VISIBLE next to the MANUAL REVIEW badge.
     CLAMPED TO THREE LINES, and the clamp is what makes it a one-line reason
     rather than a second essay: Tennessee's most state-specific unsettled note
     is 1,782 characters, which is worth showing and is not worth 400px above a
     disclosure that holds it verbatim. The ellipsis is the affordance and the
     fold directly beneath is the answer. overflow: clip, never hidden. */
  .ow-reason { margin: 8px 0 0; padding: 0 0 0 12px; border-left: 2px solid var(--warn); font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: clip; }

  /* ── A PARTIAL FIGURE, drawn so it can never read as a lane total. ──────── */
  .ow-total--partial { border-color: var(--warn); }
  .ow-total .ow-tpart { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--warn); margin: 4px 0 0; }

  /* ── ESCORT MONEY. Two channels, drawn differently on purpose. ────────────
     A SOURCED police figure sits on a normal surface with its citations, like
     any permit fee. A figure derived from the USER'S OWN rate gets a dashed
     outline, no surface of its own and a literal YOUR RATE tag — it is their
     arithmetic, we did not source it, and the page must never let the two
     read as the same kind of claim. */
  .ow-yours { border: 1px dashed var(--accent); border-radius: var(--radius); background: transparent; padding: 12px; margin-top: 12px; }
  .ow-yourtag { display: inline-block; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); border: 1px dashed var(--accent); border-radius: var(--radius-pill); padding: 4px 8px; margin: 0 0 8px; }
  .ow-yourv { font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--ink); font-family: var(--font-mono); margin: 0; }
  .ow-yours p { font-size: 13px; line-height: 1.55; color: var(--ink-soft); margin: 4px 0 0; overflow-wrap: anywhere; }
  .ow-yours ul { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 4px; }
  .ow-yours li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); }

  /* ── EMPTY STATE. One disclaimer, and a lane you can actually load. ─────── */
  .ow-eg { margin-top: 12px; }
  .ow-eg .btn { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; }
  .ow-eglist { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 4px; }
  .ow-eglist li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); }

  /* ── OPTIONAL RATE CARD. Ours is the only page on the site that asks for a
     rate it will not supply a default for, so the copy says why, top-left. ── */
  .ow-rate-empty { font-size: 12px; color: var(--muted); margin: 8px 0 0; line-height: 1.5; }

  @media (min-width: 961px) {
    /* THE EMPTY RIGHT COLUMN used to stop around y=800 while the form ran on to
       y=1300, leaving 500px of nothing beside a live form. Sticking it keeps the
       worked example and the exclusions beside whatever the user is filling in.
       Dropped the moment a real result renders — a 3,500px result must scroll. */
    .ow-results.is-empty { position: sticky; top: 88px; }
  }
  @media (max-width: 960px) {
    .ow-grid { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 640px) {
    .ow-hero h1 { font-size: 28px; }
    .ow-hero { padding: 32px 16px 12px; }
    /* 80px of bottom clearance so the last line of the page never ends up under
       the fixed chat launcher, which sits bottom-right at phone widths. */
    .ow-shell { padding: 16px 16px 80px; }
    .ow-total .ow-tv { font-size: 32px; }
    .ow-row3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .ow-leg { grid-template-columns: minmax(0, 1fr) minmax(0, 92px) 44px; }
    .ow-field input, .ow-field select { font-size: 16px; }
  }
  @media (max-width: 520px) {
    /* ONE COLUMN, NOT A 2x2. Side by side at 375px the four tiles stretched to
       the tallest of the row, which left ~180px of dead space inside STATES
       PRICED and put the four values on four different baselines. Stacked, each
       tile is its own content height and the values line up by construction. */
    .ow-flags { grid-template-columns: minmax(0, 1fr); }
  }
`;

// ── Page markup ────────────────────────────────────────────────────────────

function field(id: string, label: string, opts: { step?: string; placeholder?: string } = {}): string {
  return `<label class="ow-field"><input id="${esc(id)}" type="number" inputmode="decimal" step="${esc(opts.step ?? 'any')}" min="0" placeholder=" " autocomplete="off"><span class="ow-lab">${esc(label)}</span></label>`;
}

/** The help cue. ALWAYS top-left of the section header, never inline with a
 *  label, and exactly one per section — the single cue pattern on this page. */
function cue(id: string): string {
  return `<button type="button" class="ow-cue" data-cue="${esc(id)}" aria-expanded="false" aria-controls="${esc(id)}" aria-label="What this section is for">?</button>`;
}

function cueBody(id: string, text: string): string {
  return `<p class="ow-cue-body" id="${esc(id)}">${esc(text)}</p>`;
}

export function renderOsowToolPage(): string {
  const covered = osowCoveredStates();
  const options = osowStateOptions();

  /**
   * A BLANK FIRST OPTION, and it is not cosmetic. A `<select>` with no empty
   * option pre-selects its first entry, so an untouched extra row reads as
   * "Alabama, miles missing" and the form refuses to price a lane the user
   * never asked about. Blank means the row is genuinely empty and is skipped.
   * Its label is a dash, not "State", because the field already carries the
   * word State in-field and a duplicated title is the rule this page follows.
   */
  const stateOptionsHtml = ['<option value="">—</option>']
    .concat(
      options.map(
        (s) =>
          `<option value="${esc(s.code)}">${esc(s.name)}${s.covered ? '' : ' — not covered'}</option>`,
      ),
    )
    .join('');

  const pills = OSOW_ROUTE_CLASSES.map(
    (r) =>
      `<button type="button" class="ow-pill" data-route="${esc(r.value)}" aria-pressed="false" title="${esc(r.hint)}">${esc(r.label)}</button>`,
  ).join('');

  const coveredPills = covered.map((s) => `<span>${esc(s.code)}</span>`).join('');

  const notIncludedHtml = OSOW_NOT_INCLUDED.map(
    (n) => `<li><strong>${esc(n.item)}.</strong> ${esc(n.why)}</li>`,
  ).join('');

  const body = `
  <section class="hero ow-hero">
    <div class="container-narrow">
      <p class="ow-eyebrow">Free tool · no account needed</p>
      <h1>Oversize &amp; Overweight State Permit Calculator</h1>
      <p class="lead">Add the states your load crosses and the miles inside each one, and get the single-trip OS/OW permit fee each state charges — every line traced to the statute or fee schedule it came from.</p>
      <!-- ONE STATEMENT OF THE CLAIM, NOT THREE. The heading made it, the
           paragraph repeated it verbatim through OSOW_HEADLINE_DISCLAIMER, and
           the results column restated it a third time in an always-open
           exclusions list. The heading keeps the sentence; the paragraph now
           only lists what is left out; the exclusions list is a disclosure. The
           disclaimer that matters most — the one 4px under the number — is
           unchanged and still renders beside every total this page prints. -->
      <div class="ow-truth">
        <h2>This prices state permit fees. It is not a freight quote.</h2>
        <p><strong>STATE PERMIT FEES ONLY: no line haul, no fuel, no margin.</strong> It also excludes the cost of any pilot car a state requires — we hold no pilot-car rates, so enter your own and we apply it as a separate figure, never inside the permit total. On a long lane one escort can cost more than every permit below combined.</p>
      </div>
    </div>
  </section>

  <main class="ow-shell">
    <div class="ow-grid">
      <form class="ow-form" id="ow-form" novalidate>
        <div class="ow-card">
          <div class="ow-sec">${cue('cue-load')}<h2>The load</h2></div>
          ${cueBody('cue-load', 'Gross weight is what every state prices the overweight permit from. Width, height and overall length decide the oversize fee band and the escort rules — leave one blank and the states that need it will say so instead of guessing.')}
          <div class="ow-stack">
            ${field('ow-weight', 'Gross weight (lb)', { step: '1' })}
            <div class="ow-row2">
              ${field('ow-width-ft', 'Width (ft)', { step: '1' })}
              ${field('ow-width-in', 'Width (in)', { step: '1' })}
            </div>
            <div class="ow-row2">
              ${field('ow-height-ft', 'Height (ft)', { step: '1' })}
              ${field('ow-height-in', 'Height (in)', { step: '1' })}
            </div>
            <div class="ow-row2">
              ${field('ow-length-ft', 'Overall length (ft)', { step: '1' })}
              ${field('ow-length-in', 'Overall length (in)', { step: '1' })}
            </div>
            <div class="ow-row2">
              ${field('ow-axles', 'Axles (incl. steer)', { step: '1' })}
              ${field('ow-kpra-ft', 'Kingpin to rear axle (ft)', { step: '1' })}
            </div>
          </div>
        </div>

        <div class="ow-card">
          <div class="ow-sec">${cue('cue-route')}<h2>Road type</h2></div>
          ${cueBody('cue-route', 'Escort rules are written per road class. Pick the class most of the move runs on. States that classify their own highways (Kentucky, Tennessee, California, Colorado) will leave those rules unresolved and say so in their notes rather than assume an answer.')}
          <div class="ow-pills" id="ow-routeclass">${pills}</div>
        </div>

        <div class="ow-card">
          <div class="ow-sec">${cue('cue-pilot')}<h2>Your pilot-car rate (optional)</h2></div>
          ${cueBody('cue-pilot', 'We hold no pilot-car rates and will not invent one — no state publishes a rate, and your negotiated figure beats any range we could make up. Enter YOUR rate and we apply it to the escort counts each state’s own rules require, as a separate line. It is never added to the permit total. A day rate needs a day count: a rate without one is not a price, and one day is not a safe default. Leave this blank and the escorts come back as a count with the cost stated as unknown, which is the true answer.')}
          <div class="ow-stack">
            <div class="ow-row2">
              ${field('ow-pc-mile', 'Pilot car $ / mile')}
              ${field('ow-pc-day', 'Pilot car $ / day')}
            </div>
            <div class="ow-row2">
              ${field('ow-pc-days', 'Days per state', { step: '1' })}
              ${field('ow-pc-min', 'Your minimum per state ($)')}
            </div>
          </div>
          <p class="ow-rate-empty">Blank is a valid answer. Police-escort rates are different — six states publish one, and those are cited for you either way.</p>
        </div>

        <div class="ow-card">
          <div class="ow-sec">${cue('cue-miles')}<h2>States and miles inside each</h2></div>
          ${cueBody('cue-miles', 'These are YOUR miles, not ours. We do not route the lane. Type the per-state mileage your PC*Miler or ProMiles run produced — the same figures that go on the permit application, which is why they are the miles the state will bill. Tennessee charges 6¢ per ton-mile, so fifty miles out on one leg is real money.')}
          <div class="ow-legs" id="ow-legs"></div>
          <div class="ow-actions">
            <button type="button" class="btn btn-secondary" id="ow-add">Add a state</button>
            <button type="submit" class="btn btn-primary" id="ow-go">Calculate permits</button>
          </div>
          <p class="ow-hint" id="ow-cap" hidden>${OSOW_MAX_LEGS} states is the most one lane can carry here. Remove a state to add another.</p>
          <p class="ow-hint">Covered states — the engine holds a cited fee schedule for these ${covered.length}:</p>
          <div class="ow-cov">${coveredPills}</div>
          <p class="ow-hint">Any other state can still be added. It will come back named and unpriced, never as $0.</p>
        </div>
      </form>

      <section class="ow-results is-empty" id="ow-results" aria-live="polite">
        <div class="ow-card">
          <p class="ow-empty">Fill in the load and at least one state, then press <strong>Calculate permits</strong>. Nothing is stored and no account is needed.</p>
          <div class="ow-eg">
            <button type="button" class="btn btn-secondary" id="ow-example">See a worked example — Houston to Buffalo</button>
          </div>
          <ul class="ow-eglist">
            <li>120,000 lb · 12'6" wide · 14'6" high · 85 ft · 8 axles, interstate.</li>
            <li>Seven states — TX, AR, TN, KY, OH, PA, NY — with the miles inside each.</li>
            <li>Fills the form and prices it, so you can see the output before typing anything.</li>
          </ul>
          <!-- WHAT THE RESULT ACTUALLY CONTAINS. The empty right column used to
               stop around y=740 beside a form running to y=1600, which read as a
               broken layout. This is the description of the output rather than
               filler, and the column is sticky on desktop so it stays beside
               whatever part of the form is being filled in. -->
          <div class="ow-sec">${cue('cue-output')}<h2>What comes back</h2></div>
          ${cueBody('cue-output', 'Every fee line is resolved from a statute or a published fee schedule as of today’s date, and each state’s sources are listed with their revision dates. Where two official sources disagree by more than the immaterial threshold, the state is flagged for manual review instead of a figure being picked; where they disagree by less, the higher figure is quoted and the disagreement is shown.')}
          <ul class="ow-eglist">
            <li><strong>One table with every state on the lane</strong> — oversize, overweight, base and fees, escorts, subtotal and status, with a totals row.</li>
            <li><strong>The statute behind each line</strong>, effective-dated, per state.</li>
            <li><strong>Named gaps.</strong> A state we hold no schedule for comes back named and unpriced, never as $0, and the lane total refuses rather than quietly excluding it.</li>
            <li><strong>Escort counts</strong> each state requires — priced from your own pilot-car rate if you give one, and never added to the permit total.</li>
          </ul>
        </div>
        <details class="ow-note ow-notincluded ow-fold">
          <summary>What this total never includes (${OSOW_NOT_INCLUDED.length})</summary>
          <ul>${notIncludedHtml}</ul>
        </details>
      </section>
    </div>
  </main>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Oversize & Overweight State Permit Calculator',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any',
      url: `${SITE}${OSOW_TOOL_PATH}`,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      description: `Single-trip OS/OW state permit fees across ${covered.length} US states, with the statute or fee schedule behind every line. State permit fees only — not a freight rate.`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Free Tools', item: `${SITE}/tools` },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Oversize Permit Calculator',
          item: `${SITE}${OSOW_TOOL_PATH}`,
        },
      ],
    },
  ];

  const title = `Oversize & Overweight Permit Calculator — ${covered.length} States | QuoteFleet`;
  const description = `Free OS/OW state permit fee calculator. Enter your load and per-state miles for a cited single-trip permit total across ${covered.length} states. State permit fees only — not a freight quote, and escort cost is not included.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${OSOW_TOOL_PATH}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/nav-unify.css">
  <style>${OSOW_CSS}</style>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#0b0f15">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/brand/og-image-1200x630.png">
  ${jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n  ')}
</head>
<body>
  ${FULL_SITE_HEADER}
  ${body}
  ${PREMIUM_FOOTER}
  ${HEADER_SCRIPTS}
  <template id="ow-leg-tpl"><div class="ow-leg">
    <label class="ow-field"><select class="ow-leg-state">${stateOptionsHtml}</select><span class="ow-lab">State</span></label>
    <label class="ow-field"><input class="ow-leg-miles" type="number" inputmode="decimal" step="any" min="0" placeholder=" " autocomplete="off"><span class="ow-lab">Miles in state</span></label>
    <button type="button" class="ow-legdrop" aria-label="Remove this state">&times;</button>
  </div></template>
  <script src="/osow-calculator.js" defer></script>
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
</body>
</html>`;
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function registerOsowPermitRoutes(app: Express) {
  /**
   * The page is byte-identical for every visitor — a static form over compiled
   * jurisdiction data, no DB read and no per-user branch — so it is exactly the
   * CDN-cacheable shape `setPublicDirectoryCache` exists for. Without it
   * Cloudflare treats the route as dynamic and every crawler hit reaches origin.
   */
  app.get([OSOW_TOOL_PATH, `${OSOW_TOOL_PATH}/`], (req: Request, res: Response, next) => {
    try {
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderOsowToolPage());
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/tools/osow-permits/coverage', (_req: Request, res: Response) => {
    return res.json({
      coveredStates: osowCoveredStates(),
      allStates: osowStateOptions(),
      routeClasses: OSOW_ROUTE_CLASSES,
      notIncluded: OSOW_NOT_INCLUDED,
      immaterialConflictThresholdUsd: IMMATERIAL_CONFLICT_THRESHOLD_USD,
      disclaimer: OSOW_HEADLINE_DISCLAIMER,
    });
  });

  app.post('/api/tools/osow-permits', publicCalcLimiter, (req: Request, res: Response) => {
    const parsed = OsowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // The zod message travels. A bare "Invalid input" for a 21-leg lane told
      // the user nothing about the cap they had just crossed, and the page has
      // no other way to name it.
      const first = parsed.error.issues[0];
      return res.status(400).json({
        error: first ? `Invalid input: ${first.message}` : 'Invalid input',
        details: parsed.error.flatten(),
      });
    }

    // The corpus is a snapshot of the schedules currently on file, so it can
    // only answer for the window in which all of them are in force. Outside it
    // the engine reports a truthful "$0, no permit required" about a year whose
    // fee schedules we do not hold — the one place a null would be the honest
    // answer and a zero comes out instead. See `OSOW_ASOF_MIN`.
    const asOf = parsed.data.asOf;
    if (asOf !== undefined && (asOf < OSOW_ASOF_MIN || asOf > todayIso())) {
      return res.status(400).json({
        error: `asOf must fall between ${OSOW_ASOF_MIN} and ${todayIso()} — the range the fee schedules on file are effective for. Outside it whole schedules are out of effect and the answer would be $0 for a date we hold no data for.`,
      });
    }

    const codes = parsed.data.legs.map((l) => l.state.toUpperCase());
    const duplicate = codes.find((c, i) => codes.indexOf(c) !== i);
    if (duplicate) {
      return res.status(400).json({
        error: `${duplicate} is listed twice. Put a state's total in-state miles on one row — a re-entered state is billed once by its issuing agency.`,
      });
    }
    // `stateByCode` SYNTHESIZES an entry for an unrecognised code so a directory
    // page still renders, so it can never report an unknown one. The membership
    // set is the real check — without it "ZZ" would sail through and come back
    // as a confident "not covered" state that does not exist.
    //
    // The set is the FORM'S list, not `US_STATE_CODES`: the wider directory set
    // carries PR, VI and GU, which this tool does not offer, and an API that
    // accepts a leg its own page cannot produce is two surfaces disagreeing
    // about what the product covers.
    const unknown = codes.find((c) => !OSOW_SELECTABLE_STATE_CODES.has(c));
    if (unknown) {
      return res.status(400).json({
        error: US_STATE_CODES.has(unknown)
          ? `"${unknown}" is a US territory, not one of the 50 states or DC this calculator covers. It is not reachable by road from the mainland, so it is not offered on the form either.`
          : `"${unknown}" is not a US state code.`,
      });
    }

    // Pure calculation over compiled jurisdiction data — no database, so this
    // answers correctly with the DB unavailable.
    return res.json(priceOsowLane(parsed.data));
  });
}
