/**
 * SEASONAL (SPRING THAW / "FROST LAW") WEIGHT RESTRICTIONS — the data model.
 *
 * WHAT THESE ARE
 * ──────────────
 * Northern states cut allowable axle or gross weight on designated roads while
 * the subgrade is saturated during the spring thaw. A load that is legal on a
 * road in July is ILLEGAL on the same road in March. The restriction is posted
 * and lifted with a few days' notice, is usually zone- or route-segment
 * specific, and is published as a BULLETIN or an ORDER rather than as statute.
 *
 * WHY THIS FITS `provenance.ts` WITH NO NEW MECHANISM
 * ──────────────────────────────────────────────────
 * A seasonal restriction is time-windowed BY DEFINITION. North Dakota's own
 * feed carries `LR_Order_Effective_DateTime`; Minnesota publishes a start and
 * an end date per zone before the season begins; Michigan numbers its bulletins
 * and each one states the moment it takes effect. That is exactly
 * `Sourced<T>.effectiveFrom` / `effectiveTo`, and `isInEffect(row, asOf)` is
 * already the right predicate. A restriction in force today and one that lapsed
 * last May are THE SAME RECORD with different dates — which is what makes a
 * backdated quote answerable and what stops a lifted restriction from silently
 * becoming permanent.
 *
 * So nothing here re-implements effective-dating. Every restriction row is a
 * `Sourced<SeasonalRestrictionTerms>` and resolves through the same code the
 * permit fees do.
 *
 * THE ONE THING THAT IS GENUINELY DIFFERENT
 * ─────────────────────────────────────────
 * A permit fee is a fact about a document we already hold. A seasonal
 * restriction is a fact about the WORLD RIGHT NOW, and our copy of it goes
 * wrong in two opposite directions depending on how the state publishes:
 *
 *   • A PRESENCE feed (North Dakota's GeoJSON, Wisconsin's current-status page)
 *     lists only what is in force and clears a row when it lifts. Our copy
 *     going stale therefore OVER-RESTRICTS: we keep showing a restriction the
 *     state lifted. A missed lift is a FALSE RESTRICTION.
 *   • A WINDOW feed (Minnesota's zone table, South Dakota's dated orders)
 *     states a start AND an end date up front. Our copy going stale
 *     self-expires at its own printed end date, so it UNDER-RESTRICTS: we miss
 *     a newly posted, extended or unscheduled window. A missed posting is a
 *     FALSE CLEAR.
 *
 * `staleFailureDirection` records which way each source fails, and the warning
 * text says it out loud. A stale snapshot is never silently rendered as truth.
 */
import type { IsoDate, SourceDoc, Sourced } from '../provenance.js';

/** How narrowly a restriction is drawn. Never inferred — taken from the source. */
export type RestrictionScope =
  /** The whole state system, e.g. Wisconsin's Class II declaration. */
  | 'statewide'
  /** A named zone/region/district the state publishes, e.g. MnDOT "North-Central". */
  | 'zone'
  /** A numbered route between mileposts, e.g. NDDOT "ND 15 MP 46.27-52.329". */
  | 'route-segment'
  /** A class of road on the state's own map, e.g. MDOT's "Seasonal" (red) routes. */
  | 'route-class';

/**
 * What one posted restriction actually says.
 *
 * `limit` is the state's OWN WORDS, kept verbatim ("7 Ton", "25% rigid / 35%
 * flexible", "6 tons single axle / 10 tons tandem"). The parsed numeric fields
 * below are OPTIONAL and are populated only where the source states a figure we
 * can read without interpretation. A restriction we can quote but not parse is
 * still worth publishing; a number we invented is not.
 */
export interface SeasonalRestrictionTerms {
  scope: RestrictionScope;
  /** The state's own name for the area: "Zone 1", "Devils Lake", "ND 15 MP 46.3". */
  area: string;
  /** The state's own statement of the limit, verbatim. Never paraphrased. */
  limit: string;
  /** Reduction as a percent of normal legal axle weight, when the state states one. */
  reductionPct?: number;
  /** Absolute per-axle limit in POUNDS, when the state states one. */
  axleLimitLbs?: number;
  /** Absolute gross limit in POUNDS, when the state states one. */
  grossLimitLbs?: number;
  /** The order/bulletin identifier, verbatim: "2026-20", "Bulletin #8". */
  orderRef?: string;
}

/** One posted restriction, effective-dated and cited like every other OS/OW row. */
export type SeasonalRestriction = Sourced<SeasonalRestrictionTerms>;

/**
 * Which way a stale copy of THIS source is wrong. See the module header.
 *
 *   'over-restricts'  — presence feed; a missed lift leaves a false restriction.
 *   'under-restricts' — window feed; a missed posting leaves a false clear.
 */
export type StaleFailureDirection = 'over-restricts' | 'under-restricts';

/** Does the STATE ITSELF run a seasonal programme on the roads it maintains? */
export type SeasonalProgramme =
  /** The state DOT posts and lifts restrictions on the state system. */
  | 'statewide'
  /** Only counties/townships post; the state system is not seasonally restricted.
   *  Recorded as a FACT about the state, not as missing coverage. */
  | 'local-only'
  /** No spring thaw programme at any level we can cite. */
  | 'none';

/** How the state publishes, and whether a machine can read it without guessing. */
export type SourceFormat =
  | 'geojson'
  | 'json-api'
  | 'html-bulletin'
  | 'html-table'
  | 'pdf-bulletin'
  | 'map-viewer'
  | 'email-list'
  | 'phone-recording'
  | 'none';

/** How much of the restriction can be read programmatically. */
export type MachineReadability =
  /** Structured, typed, dated — parse it and you have the row. */
  | 'full'
  /** Structured enough to parse reliably (a dated HTML table or bulletin list). */
  | 'partial'
  /** A rendered map, a PDF, or a phone line. A human must read it. */
  | 'none';

/** Result of one attempt to refresh one state. */
export type FetchStatus =
  /** We have a snapshot from a successful, plausible fetch. */
  | 'ok'
  /** We have a snapshot but it is older than this state's freshness budget. */
  | 'stale'
  /** We have never successfully fetched this state. */
  | 'never'
  /** The state runs no programme we ingest — nothing to fetch, not a failure. */
  | 'not-applicable';

/**
 * Everything we hold for one state at one moment.
 *
 * `rows` may legitimately be EMPTY with `fetchStatus: 'ok'` — in July North
 * Dakota's feed is a full 504-segment collection with zero segments in effect,
 * and that is a real, verified "nothing is restricted". It is NOT the same as
 * a failed fetch, and `ingest.ts` is where that distinction is enforced (an
 * empty COLLECTION is a failure; an empty IN-EFFECT SUBSET of a full collection
 * is an answer).
 */
export interface StateSeasonalSnapshot {
  code: string;
  name: string;
  programme: SeasonalProgramme;
  rows: SeasonalRestriction[];
  /** The date WE read the source. Always known when a snapshot exists. */
  retrievedOn: IsoDate | null;
  /** The date the BULLETIN/ORDER itself carries. `null` when it states none —
   *  a recorded fact, never backfilled with today's date. */
  bulletinDate: IsoDate | null;
  fetchStatus: FetchStatus;
  /**
   * TRUE only when the source POSITIVELY ESTABLISHED that nothing is
   * restricted — North Dakota returning a full 504-segment collection with no
   * segment flagged `InEffect=Y`, or Minnesota's zone table parsed with no
   * window covering today.
   *
   * It exists because `rows: []` is ambiguous and the two readings are
   * opposites. "We read the state's own status and it says clear" is a green
   * light. "We fetched a page whose prose we cannot classify, so we produced no
   * rows" is NOT — and rendering the second as the first is a FALSE CLEAR, the
   * failure that puts a truck on a posted road. Michigan's bulletins are the
   * live case: MDOT writes them in prose, so the adapter sets this flag only
   * when the bulletin explicitly lifts the restrictions, and never when it
   * simply failed to recognise what the bulletin said.
   */
  verifiedClear: boolean;
  staleFailureDirection: StaleFailureDirection;
  /** The state's own page a dispatcher can always open. Present even when we
   *  hold nothing at all — an unreachable source must still be reachable. */
  authorityUrl: string;
  authorityTitle: string;
  /** Last failure text, when the most recent attempt failed. Operator-facing. */
  lastError: string | null;
  /** Days since `retrievedOn`, for the staleness sentence. `null` when never. */
  ageDays: number | null;
}

/**
 * The seasonal data handed to the engine. Deliberately a plain map of
 * already-fetched snapshots: the engine stays PURE and does no I/O, exactly as
 * it does for jurisdiction fee data. A caller with no seasonal data at all
 * passes nothing and every existing result is byte-identical.
 */
export interface SeasonalContext {
  snapshots: ReadonlyMap<string, StateSeasonalSnapshot>;
  /** Set when the snapshot store itself was unreachable (dev Neon 500s, a cold
   *  compute). Distinct from "no restrictions": it means WE DO NOT KNOW. */
  storeUnavailable?: boolean;
}

/** An empty context — what the caller passes when the database is down. */
export function emptySeasonalContext(storeUnavailable = false): SeasonalContext {
  return { snapshots: new Map(), storeUnavailable };
}

/** Every distinct source behind a snapshot's rows, first-seen order. */
export function snapshotSources(snapshot: StateSeasonalSnapshot): SourceDoc[] {
  const seen = new Map<string, SourceDoc>();
  for (const r of snapshot.rows) if (!seen.has(r.source.id)) seen.set(r.source.id, r.source);
  return [...seen.values()];
}

/** Whole days between two ISO dates. Negative is clamped to 0. */
export function ageInDays(retrievedOn: IsoDate, asOf: IsoDate): number {
  const a = Date.parse(`${retrievedOn}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Re-exported so consumers do not have to reach into `provenance.js` too. */
export type { IsoDate, SourceDoc, Sourced };
