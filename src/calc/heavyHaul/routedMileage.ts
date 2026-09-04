/**
 * TIER 1 — per-state mileage measured from a routed path over TIGER-NET.
 *
 * ── THE TWO QUESTIONS, WHICH HAVE DIFFERENT SAFE ANSWERS ──────────────────
 * A permit quote asks two things at once and they must not share an answer:
 *
 *   WHICH PERMITS DOES THIS LOAD NEED?   → the UNION of every plausible
 *                                          corridor's states. Over-inclusive
 *                                          on purpose.
 *   WHAT WILL THEY COST?                 → the BEST corridor's measured miles,
 *                                          with the alternates offered by name.
 *
 * The asymmetry is the whole design. Measured on the evaluation lanes, a single
 * corridor invented 4 states (864 mi) and MISSED 3 (597 mi); the union missed
 * nothing at all. Those two errors are not worth the same: a permit we list and
 * the truck does not need costs the customer a phone call, and one we omit
 * costs them an illegal load and a stop at a scale house. Geodesic, for
 * comparison, missed six states including Ohio and Pennsylvania on a 361-mile
 * lane.
 *
 * ── WHAT A UNION-ONLY STATE IS WORTH ──────────────────────────────────────
 * A state that appears on an alternate but not on the best corridor is LISTED
 * and NOT PRICED. It is not quoted at zero (that reads as "free"), and it is
 * not quoted at the alternate's mileage (that would price a road we have no
 * reason to think the truck takes). It comes back in `unpricedStates`, it
 * forces manual review, and the corridor picker is how the dispatcher resolves
 * it — which is also how the product collects tier-0 figures.
 *
 * ── WHAT THIS TIER MAY NOT DO ─────────────────────────────────────────────
 * It never outranks tier 0. The dispatcher's filed PC*Miler miles are the miles
 * the state bills, because the state prices the route on the application; this
 * is a measurement of a road, which is a weaker claim however good it is.
 *
 * ── LICENCE ───────────────────────────────────────────────────────────────
 * Roads and state boundaries are both US Census Bureau TIGER/Line: works of the
 * US federal government, PUBLIC DOMAIN under 17 U.S.C. § 105. No attribution
 * clause, no share-alike, commercial use unrestricted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TIGER_LINE_STATE_BOUNDARIES_URL,
  parseTigerLineStateZip,
  prepareTigerStateBoundaries,
  splitRouteMileageByState,
  type PreparedTigerStateBoundaries,
  type StateMileageLeg,
  type StateMileageSplit,
} from '../osow/stateMileage.js';
import {
  coverageCheck,
  edgeRouteName,
  loadUsnet,
  routeCorridors,
  type CoverageResult,
  type NetPoint,
  type SnappedRoute,
  type UsNet,
} from './usnet.js';
import { scalarLaneDistance, corridorStates, type LatLng } from './corridor.js';

// ──────────────────────────────────────────────────────────────────────────
// State boundaries
// ──────────────────────────────────────────────────────────────────────────

/**
 * The Census state file, committed BYTE-IDENTICAL to what `sourceUrl` serves.
 *
 * It is the archive itself and not a re-encoding of it, which is the point:
 * `parseTigerLineStateZip` refuses any URL that is not the full-resolution
 * `tl_<year>_us_state.zip`, and that guard exists because generalized
 * cartographic (`cb_*`) boundaries move state lines by miles and would bill
 * mileage to the wrong state. Repacking the polygons into a smaller custom
 * format would leave that check comparing a constant with itself — exactly the
 * tautology the comment in `stateMileage.ts` records as a past bug. So the
 * 10 MB stays, and the provenance check stays real.
 */
export const STATE_BOUNDARY_ASSET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'assets',
  'tiger',
  'tl_2025_us_state.zip',
);

let boundaryCache: PreparedTigerStateBoundaries | null = null;

/**
 * Full-resolution state polygons, prepared once per process.
 *
 * MEASURED IN THIS REPO: 970,709 vertices across 56 features, ~250 ms to parse
 * and index, and about 107 MB retained. That is a real cost and it is why this
 * is LAZY — nothing pays it until a heavy-haul quote actually asks for a routed
 * split, and a container that never quotes an oversize load never allocates it.
 * The routing graph itself is a separate, much smaller ~25 MB.
 */
export function loadStateBoundaries(
  assetPath: string = STATE_BOUNDARY_ASSET_PATH,
): PreparedTigerStateBoundaries {
  if (boundaryCache) return boundaryCache;
  const bytes = new Uint8Array(fs.readFileSync(assetPath));
  boundaryCache = prepareTigerStateBoundaries(
    parseTigerLineStateZip(bytes, TIGER_LINE_STATE_BOUNDARIES_URL),
  );
  return boundaryCache;
}

/** Test seam. Never called by the server. */
export function resetStateBoundaryCacheForTests(): void {
  boundaryCache = null;
}

// ──────────────────────────────────────────────────────────────────────────
// Corridors
// ──────────────────────────────────────────────────────────────────────────

export interface RoutedCorridor {
  /** The roads that carry this corridor, most miles first — "I-40 · I-81". */
  label: string;
  /** Road miles for the whole lane on this corridor. */
  totalMiles: number;
  /** Per-state legs in traversal order. */
  legs: StateMileageLeg[];
  /** Distinct state codes, traversal order. */
  stateCodes: string[];
  /** States this corridor crosses that the BEST corridor does not. */
  divergentStates: string[];
  /** Miles the split could not attribute to any state. */
  unassignedMiles: number;
}

export type RoutedMileageRefusal =
  /** The graph asset is missing or unreadable. */
  | 'assetUnavailable'
  /** An endpoint is further from the network than the coverage guard allows. */
  | 'outsideCoverage'
  /** The graph could not connect the two endpoints at all. */
  | 'unroutable'
  /** Enough of the path landed outside every state that the split is untrustworthy. */
  | 'unassignedMileage'
  /** The network forced a detour, so the road the truck takes is not in the data. */
  | 'networkDetour';

export interface RoutedMileageRefused {
  ok: false;
  reason: RoutedMileageRefusal;
  coverage: CoverageResult | null;
  warnings: string[];
}

export interface RoutedMileageMeasured {
  ok: true;
  /** The corridor that prices the quote — lowest cost, and its real miles. */
  best: RoutedCorridor;
  /** Plausible other ways to run it, for the dispatcher to choose from. */
  alternates: RoutedCorridor[];
  /**
   * THE PERMIT LIST: every state on ANY corridor. Over-inclusive by design.
   */
  permitStates: string[];
  /**
   * States on the permit list that the best corridor does not cross, so no
   * mileage was measured for them. Listed, never priced, and they force review.
   */
  unpricedStates: string[];
  /** True when every corridor crossed exactly the same states. */
  corridorsAgree: boolean;
  /**
   * States the straight-line bounding-box scan names that NO routed corridor
   * crossed. Advisory only: it is the tier-4 list, it is deliberately generous,
   * and it does not force review — but it is free, and it is the cheapest way
   * for a dispatcher running an unusual route to notice a state we did not.
   */
  scanOnlyStates: string[];
  /** The best corridor's split, ready for `priceOsowWithStateMileage`. */
  split: StateMileageSplit;
  coverage: CoverageResult;
  warnings: string[];
  requiresManualReview: boolean;
}

export type RoutedMileageResult = RoutedMileageMeasured | RoutedMileageRefused;

/**
 * Unassigned miles above this fraction of the lane mean the polyline spent real
 * distance outside every state polygon, and the per-state split is then missing
 * mileage that a per-mile state would have billed. Below it, the leakage is
 * boundary noise on a causeway or a river crossing.
 *
 * MY JUDGEMENT, not a measurement: `stateMileage.ts` already forces review above
 * 1 absolute mile, which is the right trigger for a short lane and far too tight
 * for a 3,000-mile one. This is the proportional companion to it.
 */
const MAX_UNASSIGNED_FRACTION = 0.02;

/**
 * GUARD FOUR — the class gate, and the one that decides whether this tier may
 * answer at all.
 *
 * ── WHAT IT CATCHES ───────────────────────────────────────────────────────
 * TIGER PRIMARYROADS carries interstates and major US routes and nothing else.
 * When the road a truck would really take is classified below S1100, the router
 * does not fail — it finds a legal path on the roads it does have and returns a
 * confident, well-formed, wrong answer. Colorado Springs -> Amarillo is the
 * clearest case: the real route runs US-87 and US-64 across north-eastern New
 * Mexico, which are absent, so the graph goes down I-25 to Albuquerque and back
 * east on I-40 — 663 miles against a real 359, and NEW MEXICO'S 100 MILES
 * VANISH from the permit list because no corridor crosses it.
 *
 * ── WHY THE RATIO IS THE SIGNAL ───────────────────────────────────────────
 * A detour of that kind shows up as circuity. Measured over 80 lanes against a
 * reference router, `routedMiles / scalarMiles` separates the two populations
 * cleanly — a lane routed on roads that exist sits near 1.0, and every lane
 * whose real route left the dataset sits well above it:
 *
 *   threshold   refused   kept: mean |error|   p95     max     lanes missing a state
 *      1.08      16/80          1.93%          8.66%  11.50%          3
 *      1.12      14/80          2.10%          8.93%  13.05%          3
 *      1.20       6/80          2.83%         11.50%  18.22%          5
 *      none        —            5.10%         13.42%  84.88%          5
 *
 * 1.12 is chosen over 1.08 because the two keep the same number of lanes with a
 * missed state while 1.12 answers two more lanes; and over 1.20 because 1.20
 * lets the Dallas–Denver pair through, and those are exactly the lanes that
 * silently drop New Mexico.
 *
 * ── WHY REFUSING IS THE RIGHT ANSWER, NOT A WORSE NUMBER ──────────────────
 * A refused lane falls back to what shipped before this tier existed: name the
 * corridor states from the bounding-box scan and ask the dispatcher for their
 * filed miles. That path is deliberately over-inclusive, so New Mexico gets
 * NAMED rather than dropped. Answering with a routed number here would replace
 * an honest question with a confident error.
 */
export const NETWORK_DETOUR_LIMIT = 1.12;

function toNetPoint(point: LatLng): NetPoint {
  return [point.longitude, point.latitude];
}

/**
 * Name a corridor by the roads carrying it.
 *
 * Ramps, welds and healed gaps have no name and are skipped; they are a few
 * miles of a thousand-mile lane and naming a corridor "(unnamed)" would be
 * worse than naming it by the interstates a dispatcher would actually say.
 */
function labelCorridor(net: UsNet, route: SnappedRoute, limit = 3): string {
  const milesByRoad = new Map<string, number>();
  for (const edge of route.chain) {
    const name = edgeRouteName(net, edge);
    if (name === '') continue;
    milesByRoad.set(name, (milesByRoad.get(name) ?? 0) + (net.edgeMiles[edge] as number));
  }
  const roads = [...milesByRoad.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
  return roads.length > 0 ? `via ${roads.join(' · ')}` : 'via unnamed roads';
}

function distinctStates(legs: readonly StateMileageLeg[]): string[] {
  const seen: string[] = [];
  for (const leg of legs) if (!seen.includes(leg.stateCode)) seen.push(leg.stateCode);
  return seen;
}

export interface RoutedMileageOptions {
  /**
   * How many corridors to consider.
   *
   * FIVE, not three. Measured over the 66 lanes that pass the detour guard,
   * three corridors left a state off the permit list on 3 of them and five left
   * it off on 1 — for 0.5 extra states per lane, which is the cheap direction.
   */
  corridorCount?: number;
  /** Override the graph, for tests. */
  net?: UsNet;
  /** Override the boundaries, for tests. */
  boundaries?: PreparedTigerStateBoundaries;
}

/**
 * Measure a lane: total miles, per-state miles, and the permit list.
 *
 * REFUSES rather than guessing. Every failure path returns `ok: false` with a
 * reason, and the caller's job is to fall back to the corridor-list-and-ask
 * behaviour that shipped before this tier existed — never to a worse number
 * wearing this tier's label.
 */
export function routedStateMileage(
  origin: LatLng,
  destination: LatLng,
  options: RoutedMileageOptions = {},
): RoutedMileageResult {
  let net: UsNet;
  try {
    net = options.net ?? loadUsnet();
  } catch (error) {
    return {
      ok: false,
      reason: 'assetUnavailable',
      coverage: null,
      warnings: [
        `The routing network could not be loaded (${
          error instanceof Error ? error.message : String(error)
        }), so this lane was not measured.`,
      ],
    };
  }

  const from = toNetPoint(origin);
  const to = toNetPoint(destination);

  // GUARD ONE. Before anything is measured: is this lane even inside the data?
  // An endpoint far from the network must REFUSE, never route from the nearest
  // node — see `coverageCheck`, and Ely, Nevada, 111 miles from any mapped road.
  const coverage = coverageCheck(net, from, to);
  if (!coverage.ok) {
    return { ok: false, reason: 'outsideCoverage', coverage, warnings: coverage.warnings };
  }

  const routes = routeCorridors(net, from, to, { count: options.corridorCount ?? 5 });
  if (routes.length === 0) {
    return {
      ok: false,
      reason: 'unroutable',
      coverage,
      warnings: [
        'No road route could be found between these two points on the federal primary-road network.',
      ],
    };
  }

  const boundaries = options.boundaries ?? loadStateBoundaries();

  const measured = routes.map((route) => {
    const split = splitRouteMileageByState(
      route.path.map(([longitude, latitude]) => ({ longitude, latitude })),
      boundaries,
    );
    return { route, split };
  });

  const bestEntry = measured[0];
  if (!bestEntry) {
    return { ok: false, reason: 'unroutable', coverage, warnings: ['No corridor was measurable.'] };
  }
  const bestSplit = bestEntry.split;

  // GUARD TWO. Circuity says whether the road the truck takes is in the data.
  // Cheap, and it runs before anything is reported: a lane the network detoured
  // is not a lane with a slightly wrong number, it is a lane whose corridor is
  // fictional and whose permit list is missing states.
  const scalar = scalarLaneDistance(origin, destination);
  const detourRatio =
    scalar.totalMiles > 0 ? bestEntry.route.totalMiles / scalar.totalMiles : 1;
  if (detourRatio > NETWORK_DETOUR_LIMIT) {
    return {
      ok: false,
      reason: 'networkDetour',
      coverage,
      warnings: [
        `The shortest path over the federal primary-road network is ${Math.round(bestEntry.route.totalMiles).toLocaleString()} mi against a straight-line estimate of ${Math.round(scalar.totalMiles).toLocaleString()} mi (${detourRatio.toFixed(2)}x). A gap that size means the road this load would really take is not in the dataset — that network carries interstates and major US routes and nothing below them — so the route we can measure is not the route you would drive, and the states on it would be the wrong states. This lane is not measured.`,
      ],
    };
  }

  // GUARD FOUR. The split is only worth as much as the miles it could place.
  // `stateMileage.ts` reports what it could not attribute rather than dropping
  // it — dropping would silently under-bill every per-mile state on the lane.
  const laneMiles = bestSplit.totalMiles + bestSplit.unassignedMiles;
  if (
    laneMiles > 0 &&
    bestSplit.unassignedMiles / laneMiles > MAX_UNASSIGNED_FRACTION &&
    bestSplit.unassignedMiles > 1
  ) {
    return {
      ok: false,
      reason: 'unassignedMileage',
      coverage,
      warnings: [
        `${Math.round(bestSplit.unassignedMiles)} of ${Math.round(laneMiles)} route miles could not be placed inside any state, so the per-state split would be missing mileage a per-mile state would bill. This lane is not priced from a measured route.`,
        ...bestSplit.warnings,
      ],
    };
  }

  const bestStates = distinctStates(bestSplit.legs);

  const corridors: RoutedCorridor[] = measured.map(({ route, split }) => {
    const stateCodes = distinctStates(split.legs);
    return {
      label: labelCorridor(net, route),
      totalMiles: Math.round(route.totalMiles * 10) / 10,
      legs: split.legs,
      stateCodes,
      divergentStates: stateCodes.filter((code) => !bestStates.includes(code)),
      unassignedMiles: split.unassignedMiles,
    };
  });

  const best = corridors[0] as RoutedCorridor;
  const alternates = corridors.slice(1);

  // THE UNION. Traversal order of the best corridor first, then anything only an
  // alternate saw — so the list reads as a route and the extras are visible.
  const permitStates = [...bestStates];
  for (const corridor of alternates) {
    for (const code of corridor.stateCodes) {
      if (!permitStates.includes(code)) permitStates.push(code);
    }
  }
  const unpricedStates = permitStates.filter((code) => !bestStates.includes(code));
  const corridorsAgree = unpricedStates.length === 0 && alternates.every(
    (corridor) => corridor.stateCodes.length === bestStates.length,
  );

  const scanOnlyStates = corridorStates(origin, destination, () => true)
    .map((state) => state.stateCode)
    .filter((code) => !permitStates.includes(code));

  const warnings: string[] = [
    `Per-state mileage was MEASURED from a road route over the federal primary-road network (US Census TIGER/Line, public domain), not taken from your filed route sheet. It is a measurement of a road, and the permit is priced on the route you file — so if you hold PC*Miler or ProMiles figures, enter those and they will be used instead of these.`,
  ];

  if (alternates.length > 0) {
    warnings.push(
      `${alternates.length + 1} plausible corridor${alternates.length === 0 ? '' : 's'} were routed for this lane and the permit list below is the UNION of every state any of them crosses. The mileage is from ${best.label} (${best.totalMiles.toLocaleString()} mi). If you are running ${alternates
        .map((c) => `${c.label} (${c.totalMiles.toLocaleString()} mi)`)
        .join(' or ')}, pick it — the states and the miles change with the route.`,
    );
  }

  if (unpricedStates.length > 0) {
    warnings.push(
      `${unpricedStates.join(', ')} ${unpricedStates.length === 1 ? 'is' : 'are'} on an alternate corridor but NOT on the one these miles came from, so no mileage was measured there and no permit is priced for ${unpricedStates.length === 1 ? 'it' : 'them'}. ${unpricedStates.length === 1 ? 'It is' : 'They are'} listed rather than dropped because a permit we leave out is an illegal load, while one you turn out not to need is a phone call. Confirm your corridor, or enter the in-state miles.`,
    );
  }

  return {
    ok: true,
    best,
    alternates,
    permitStates,
    unpricedStates,
    corridorsAgree,
    scanOnlyStates,
    split: bestSplit,
    coverage,
    warnings: [...warnings, ...bestSplit.warnings],
    // GUARD FIVE, inherited: `splitRouteMileageByState` sets this on
    // unassigned mileage, and it stays load-bearing for the same reason it
    // always was — a route that leaves the boundary file is a route we cannot
    // fully price.
    requiresManualReview: bestSplit.requiresManualReview || unpricedStates.length > 0,
  };
}
