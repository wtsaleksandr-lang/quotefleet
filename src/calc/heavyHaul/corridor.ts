/**
 * LANE GEOMETRY WITHOUT A ROUTER — total miles, and the states to ASK ABOUT.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────────────
 * Nothing here ever produces a PER-STATE MILEAGE. Not a pro-rated one, not an
 * intersected one, not a "roughly". Two bands, not one: a method can nail the
 * lane total and botch the split, and the two figures buy different things —
 * TOTAL miles price line haul, PER-STATE miles price permits.
 *
 * Measured, Houston → Buffalo, against a real routed path:
 *
 *   total     routed 1,484.0 mi   ·  straight-line × 1.18  1,517.5 mi   (+2.3%)
 *   per-state routed TX 293 AR 273 TN 248 KY 232 OH 318 PA 46 NY 73
 *             geodesic  TX 151 **LA 149** AR 77 **MS 111** TN 158 KY 215 …
 *
 * The geodesic split INVENTS Louisiana, Mississippi and Indiana, runs Texas
 * −48% and Arkansas −72%, and on one test lane reached Michigan by crossing
 * Lake Michigan. Louisiana alone is **+$285 of permit for a state the truck
 * never enters** at 120,000 lb. The lane total, meanwhile, is within a few
 * percent. So the total ships and the split does not.
 *
 * ── WHAT REPLACES THE SPLIT: A PROMPT, NOT A PRICE ────────────────────────
 * A dispatcher moving an OS/OW load already has per-state mileage out of
 * PC*Miler or ProMiles, because the permit application asks for it. Those are
 * the miles the state bills, so they beat anything computable here. The product
 * move is therefore to NAME the states the lane probably crosses and ask for
 * their miles, which turns a blunt refusal into the one question that collects
 * the authoritative figure from the person already holding it.
 *
 * `corridorStates` is that prompt. It scans the straight-line corridor against
 * state BOUNDING BOXES, which is coarser than intersecting polygons and is
 * chosen for that reason: boxes err toward naming a state the lane misses, and
 * polygons err toward missing one it crosses. For a list that is never priced
 * and only ever asked about, over-inclusion costs a row the user leaves blank
 * and under-inclusion costs an unbudgeted permit at a scale house. When a real
 * router lands, `splitRouteMileageByState` in `src/calc/osow/stateMileage.ts`
 * already does the polygon work properly and slots in behind this interface.
 *
 * NO NETWORK, NO DATABASE, NO KEY. Everything below is arithmetic over a table
 * compiled into the file, so it answers with the database down.
 */

/**
 * Straight-line → road-distance circuity factor.
 *
 * The same 1.18 `src/calc/distance.ts` has shipped since the first quote (it
 * holds a private twin of this constant; the two must move together). Measured
 * on the evaluation lanes it lands the LANE TOTAL between −2.3% and +6.1% of a
 * real routed distance, which is why the band below is ±15% and why this figure
 * is fit to price line haul and unfit to price a permit.
 */
export const STRAIGHT_TO_ROAD_FACTOR = 1.18;

/** IUGG mean Earth radius, in miles — same value as `stateMileage.ts`. */
const EARTH_RADIUS_MILES = 3_958.7613;

export interface LatLng {
  latitude: number;
  longitude: number;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle miles between two points. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ──────────────────────────────────────────────────────────────────────────
// Mileage tiers
// ──────────────────────────────────────────────────────────────────────────

/**
 * WHERE THE MILES CAME FROM, and therefore what may be priced from them.
 *
 * The ranks match the evaluation's tier numbering so the two can be read
 * against each other. Tier 3 is DECLARED AND NOT REACHABLE: naming it here is
 * how the type says what was rejected rather than leaving a silent gap.
 */
export type MileageTier =
  /** 0 — the dispatcher's filed PC*Miler / ProMiles figures. Authoritative. */
  | 'filed'
  /** 1 — a routed path over the federal primary-road network, in process. */
  | 'routedPrimaryNetwork'
  /** 3 — straight line intersected with state polygons. Never a price. */
  | 'geodesicSplit'
  /** 4 — straight line × circuity. A lane total only; no per-state figure exists. */
  | 'scalar';

export interface MileageTierSpec {
  tier: MileageTier;
  rank: 0 | 1 | 3 | 4;
  label: string;
  /** ± band on the LANE TOTAL, as a percentage. Measured, not asserted. */
  totalBandPct: number;
  /** ± band on the PER-STATE split. `null` where no per-state figure exists. */
  stateBandPct: number | null;
  /** May a distance-priced state be quoted from these miles? */
  mayPriceStates: boolean;
  /** Is this tier reachable in the shipped product today? */
  available: boolean;
  basis: string;
}

export const MILEAGE_TIERS: Readonly<Record<MileageTier, MileageTierSpec>> = {
  filed: {
    tier: 'filed',
    rank: 0,
    label: 'Your filed per-state miles',
    totalBandPct: 0,
    stateBandPct: 0,
    mayPriceStates: true,
    available: true,
    basis:
      'The per-state mileage from the routing software the permit application is filled in from (PC*Miler, ProMiles). These are not an estimate of the billed miles — they ARE the billed miles, because the state prices the route on the application. Zero band by definition; the remaining risk is transcription, not measurement.',
  },
  routedPrimaryNetwork: {
    tier: 'routedPrimaryNetwork',
    rank: 1,
    label: 'Routed over the federal primary-road network',
    totalBandPct: 10,
    stateBandPct: 15,
    mayPriceStates: true,
    available: true,
    basis:
      'A road route computed in this process over TIGER/Line PRIMARYROADS (US Census Bureau, public domain), intersected with full-resolution TIGER/Line state polygons. Against published route logs it measures a state to +0.11% (I-40 through Tennessee) and +0.42% (I-81 through Virginia). MEASURED OVER 80 REAL LANES against a reference router, on the 66 that pass the guards: lane totals mean 2.1%, p90 6.1%, p95 8.9%, worst 13.1% — against 4.8% mean for the straight-line scalar and 12.2% for a bare geodesic. Per-state legs of 25 mi or more, where the corridors agree: mean 2.7%, p90 9.3%, p95 14.4%, worst 57.6%. THE BANDS ABOVE ARE THOSE p95 FIGURES ROUNDED UP, not a hoped-for number. Legs UNDER 25 miles are much worse (worst measured 646%) and are named in the quote rather than covered by this band. 14 lanes in 80 were REFUSED by the guards rather than answered.',
  },
  geodesicSplit: {
    tier: 'geodesicSplit',
    rank: 3,
    label: 'Straight line, states measured',
    totalBandPct: 20,
    stateBandPct: 60,
    mayPriceStates: false,
    available: false,
    basis:
      'A great-circle path intersected with state polygons. Deliberately not built as a pricing input: measured per-state error runs from −100% (a state missed entirely) to +780%, and it invented a Louisiana permit worth $285 on a lane that never enters Louisiana. The 60% is a central figure, not a ceiling.',
  },
  scalar: {
    tier: 'scalar',
    rank: 4,
    label: 'Straight line × 1.18',
    totalBandPct: 15,
    stateBandPct: null,
    mayPriceStates: false,
    available: true,
    basis:
      'Great-circle distance between the two geocoded endpoints × 1.18, the circuity factor QuoteFleet already prices line haul from. Measured lane totals land between −2.3% and +6.1% of a routed distance. There is NO per-state figure — not a small one, none — because pro-rating a scalar across states would be inventing evidence.',
  },
};

export interface LaneDistance {
  tier: MileageTier;
  /** Road miles for the whole lane. */
  totalMiles: number;
  /** Straight-line miles before circuity, when this tier computed one. */
  straightLineMiles: number | null;
  /** ± miles implied by the tier's measured band. */
  totalPlusMinusMiles: number;
  mayPriceStates: boolean;
  notes: string[];
}

/** Lane total from two geocoded endpoints — tier 4, and it says so. */
export function scalarLaneDistance(origin: LatLng, destination: LatLng): LaneDistance {
  const straight = haversineMiles(origin, destination);
  const totalMiles = Math.round(straight * STRAIGHT_TO_ROAD_FACTOR * 10) / 10;
  const spec = MILEAGE_TIERS.scalar;
  return {
    tier: 'scalar',
    totalMiles,
    straightLineMiles: Math.round(straight * 10) / 10,
    totalPlusMinusMiles: Math.round((totalMiles * spec.totalBandPct) / 100),
    mayPriceStates: false,
    notes: [
      `Lane distance is ESTIMATED, not routed: ${Math.round(straight)} straight-line miles between the two addresses × ${STRAIGHT_TO_ROAD_FACTOR} for road circuity = about ${Math.round(totalMiles)} mi (±${spec.totalBandPct}%). It is a lane total and nothing else — no per-state mileage exists at this tier, so no distance-priced permit is computed from it.`,
    ],
  };
}

/** Lane total from filed per-state figures — tier 0. */
export function filedLaneDistance(
  legs: ReadonlyArray<{ stateCode: string; miles: number }>,
): LaneDistance {
  const totalMiles = Math.round(legs.reduce((sum, l) => sum + l.miles, 0) * 100) / 100;
  return {
    tier: 'filed',
    totalMiles,
    straightLineMiles: null,
    totalPlusMinusMiles: 0,
    mayPriceStates: true,
    notes: [
      `Lane distance is the sum of the per-state miles YOU supplied (${Math.round(totalMiles).toLocaleString()} mi across ${legs.length} state${legs.length === 1 ? '' : 's'}). They are treated as the filed figures, so every distance-priced permit is computed directly from them and they must match the route you file with each state.`,
    ],
  };
}

/**
 * Lane total from a routed path over the primary-road network — tier 1.
 *
 * The miles come from `routedStateMileage` in `routedMileage.ts`, which owns
 * the graph, the corridors and the guards. This function only dresses them as a
 * `LaneDistance` so the rest of the quote cannot tell one tier from another
 * except through `tier` and the band — which is the point of the ladder.
 */
export function routedLaneDistance(
  totalMiles: number,
  options: { corridorLabel: string; alternateCount: number; unpricedStates: readonly string[] },
): LaneDistance {
  const spec = MILEAGE_TIERS.routedPrimaryNetwork;
  const rounded = Math.round(totalMiles * 10) / 10;
  const notes = [
    `Lane distance was MEASURED on a road route ${options.corridorLabel} — ${Math.round(rounded).toLocaleString()} mi (±${spec.totalBandPct}%) over the federal primary-road network (US Census TIGER/Line, public domain). It is a measurement of a road, not the figure on your permit application: if you hold PC*Miler or ProMiles per-state miles, enter them and they replace this entirely, because those are the miles each state actually bills.`,
  ];
  if (options.alternateCount > 0) {
    notes.push(
      `${options.alternateCount} other plausible corridor${options.alternateCount === 1 ? '' : 's'} were routed for this lane. The permit list is the UNION of every state any of them crosses, so it errs toward naming a permit you do not need rather than omitting one you do; the MILES above are from the best corridor only.`,
    );
  }
  if (options.unpricedStates.length > 0) {
    notes.push(
      `${options.unpricedStates.join(', ')} appear only on an alternate corridor, so no mileage was measured there and no permit is priced for ${options.unpricedStates.length === 1 ? 'it' : 'them'}. ${options.unpricedStates.length === 1 ? 'It is' : 'They are'} listed rather than dropped — confirm which way you are running, or enter the in-state miles.`,
    );
  }
  return {
    tier: 'routedPrimaryNetwork',
    totalMiles: rounded,
    straightLineMiles: null,
    totalPlusMinusMiles: Math.round((rounded * spec.totalBandPct) / 100),
    mayPriceStates: true,
    notes,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// The corridor scan: which states to ASK about
// ──────────────────────────────────────────────────────────────────────────

type BBox = readonly [
  minLongitude: number,
  minLatitude: number,
  maxLongitude: number,
  maxLatitude: number,
];

/**
 * State extents — 50 states plus DC.
 *
 * BOUNDING BOXES, NOT POLYGONS, and the imprecision is the design. A box
 * over-covers: a lane passing near a state's corner is named, and the user
 * leaves the row blank. A polygon under-covers when the straight line misses a
 * road's real detour, and a state that goes unnamed is a permit nobody budgeted
 * for. Since nothing here is ever priced, the over-inclusive error is the
 * cheap one and is chosen on purpose.
 *
 * Alaska and Hawaii are present for completeness and unreachable by any
 * mainland corridor, which is correct: neither is reachable by road either.
 */
const STATE_BBOX: ReadonlyArray<readonly [string, BBox]> = [
  ['AL', [-88.47, 30.14, -84.89, 35.01]],
  ['AK', [-179.15, 51.21, -129.98, 71.44]],
  ['AZ', [-114.82, 31.33, -109.04, 37.01]],
  ['AR', [-94.62, 33.0, -89.64, 36.5]],
  ['CA', [-124.41, 32.53, -114.13, 42.01]],
  ['CO', [-109.06, 36.99, -102.04, 41.01]],
  ['CT', [-73.73, 40.95, -71.79, 42.05]],
  ['DE', [-75.79, 38.45, -74.98, 39.84]],
  ['DC', [-77.12, 38.79, -76.91, 39.0]],
  ['FL', [-87.63, 24.52, -79.97, 31.01]],
  ['GA', [-85.61, 30.36, -80.84, 35.01]],
  ['HI', [-160.25, 18.91, -154.81, 22.24]],
  ['ID', [-117.24, 41.99, -111.04, 49.01]],
  ['IL', [-91.51, 36.97, -87.02, 42.51]],
  ['IN', [-88.1, 37.77, -84.78, 41.76]],
  ['IA', [-96.64, 40.38, -90.14, 43.51]],
  ['KS', [-102.05, 36.99, -94.59, 40.01]],
  ['KY', [-89.57, 36.5, -81.96, 39.15]],
  ['LA', [-94.04, 28.93, -88.76, 33.02]],
  ['ME', [-71.08, 42.98, -66.95, 47.46]],
  ['MD', [-79.49, 37.89, -75.05, 39.72]],
  ['MA', [-73.51, 41.24, -69.93, 42.89]],
  ['MI', [-90.42, 41.7, -82.41, 48.31]],
  ['MN', [-97.24, 43.5, -89.49, 49.38]],
  ['MS', [-91.66, 30.17, -88.1, 35.01]],
  ['MO', [-95.77, 35.99, -89.1, 40.61]],
  ['MT', [-116.05, 44.36, -104.04, 49.01]],
  ['NE', [-104.05, 39.99, -95.31, 43.01]],
  ['NV', [-120.01, 35.0, -114.04, 42.01]],
  ['NH', [-72.56, 42.7, -70.7, 45.31]],
  ['NJ', [-75.56, 38.93, -73.89, 41.36]],
  ['NM', [-109.05, 31.33, -103.0, 37.01]],
  ['NY', [-79.76, 40.5, -71.86, 45.02]],
  ['NC', [-84.32, 33.84, -75.46, 36.59]],
  ['ND', [-104.05, 45.94, -96.55, 49.01]],
  ['OH', [-84.82, 38.4, -80.52, 42.32]],
  ['OK', [-103.0, 33.62, -94.43, 37.01]],
  ['OR', [-124.57, 41.99, -116.46, 46.29]],
  ['PA', [-80.52, 39.72, -74.69, 42.27]],
  ['RI', [-71.91, 41.15, -71.12, 42.02]],
  ['SC', [-83.35, 32.03, -78.54, 35.22]],
  ['SD', [-104.06, 42.48, -96.44, 45.95]],
  ['TN', [-90.31, 34.98, -81.65, 36.68]],
  ['TX', [-106.65, 25.84, -93.51, 36.5]],
  ['UT', [-114.05, 36.99, -109.04, 42.01]],
  ['VT', [-73.44, 42.73, -71.47, 45.02]],
  ['VA', [-83.68, 36.54, -75.24, 39.47]],
  ['WA', [-124.76, 45.54, -116.92, 49.01]],
  ['WV', [-82.64, 37.2, -77.72, 40.64]],
  ['WI', [-92.89, 42.49, -86.76, 47.31]],
  ['WY', [-111.06, 40.99, -104.05, 45.01]],
];

/**
 * WHAT THE SCAN ACTUALLY OBSERVED — deliberately not a probability.
 *
 * Naming these 'likely' and 'possible' would have been an over-claim the method
 * cannot support: a box is not a border, and the Houston→Buffalo corridor runs
 * a couple of hundred miles through LOUISIANA'S BOUNDING BOX on a lane whose
 * real route never enters Louisiana. Calling that "likely" would be the same
 * confident wrongness that disqualified the geodesic split from pricing. So
 * each value states the geometric fact and nothing more, and the user — who
 * knows their own route — decides.
 *
 * NONE OF THESE IS A MILEAGE and none may be priced.
 */
export type CorridorLikelihood =
  /** The geocoder placed one end of the lane in this state. Certain. */
  | 'endpoint'
  /** The straight line runs at least `LIKELY_RUN_MILES` inside the state's box. */
  | 'crosses'
  /** The straight line only clips the box. Often a neighbour, sometimes real. */
  | 'clips';

export interface CorridorState {
  stateCode: string;
  likelihood: CorridorLikelihood;
  /** True when the OS/OW engine holds a cited fee schedule for this state. */
  covered: boolean;
}

/**
 * Sample spacing along the straight line, in miles.
 *
 * Fine enough that a state 25 miles across cannot be stepped over, coarse
 * enough that a 3,000-mile lane is ~600 samples of pure arithmetic.
 */
const SAMPLE_SPACING_MILES = 5;
const MAX_SAMPLES = 800;

/**
 * The run inside a state's box, in miles, above which it is called `crosses`
 * rather than `clips`.
 *
 * MY JUDGEMENT, NOT A MEASUREMENT. It is a display threshold on a list that is
 * never priced, so being wrong about it changes a chip's colour and no dollar
 * figure anywhere. Chosen as roughly the shortest crossing of a real state on
 * an interstate corridor.
 */
export const LIKELY_RUN_MILES = 25;

function inBox(point: LatLng, box: BBox): boolean {
  return (
    point.longitude >= box[0] &&
    point.longitude <= box[2] &&
    point.latitude >= box[1] &&
    point.latitude <= box[3]
  );
}

/**
 * Linear interpolation in lat/lng, not a true great-circle interpolation.
 *
 * Over a continental lane the two differ by a few miles laterally, which is
 * immaterial against boxes that already over-cover by tens of miles — and it
 * would be actively misleading to compute the sampling to a precision the
 * output does not have.
 */
function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/**
 * States the lane probably crosses, in traversal order.
 *
 * `hasCoverage` is injected rather than imported so this module stays free of
 * the OS/OW jurisdiction corpus and can be unit-tested on geometry alone.
 */
export function corridorStates(
  origin: LatLng,
  destination: LatLng,
  hasCoverage: (code: string) => boolean,
  endpointStates: { originState?: string | null; destinationState?: string | null } = {},
): CorridorState[] {
  const straight = haversineMiles(origin, destination);
  const samples = Math.max(
    2,
    Math.min(MAX_SAMPLES, Math.ceil(straight / SAMPLE_SPACING_MILES) + 1),
  );
  const perSampleMiles = straight / Math.max(1, samples - 1);

  /** First sample index at which a state's box was touched — the traversal order. */
  const firstSeen = new Map<string, number>();
  const runMiles = new Map<string, number>();

  for (let i = 0; i < samples; i += 1) {
    const point = lerp(origin, destination, i / Math.max(1, samples - 1));
    for (const [code, box] of STATE_BBOX) {
      if (!inBox(point, box)) continue;
      if (!firstSeen.has(code)) firstSeen.set(code, i);
      runMiles.set(code, (runMiles.get(code) ?? 0) + perSampleMiles);
    }
  }

  const endpoints = new Set(
    [endpointStates.originState, endpointStates.destinationState]
      .map((s) => String(s ?? '').trim().toUpperCase())
      .filter((s) => s.length === 2),
  );
  // An endpoint state is certain regardless of what the box scan saw — the
  // geocoder placed a real address there.
  for (const code of endpoints) {
    if (!firstSeen.has(code)) {
      firstSeen.set(code, code === String(endpointStates.originState ?? '').toUpperCase() ? -1 : samples + 1);
    }
  }

  return [...firstSeen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([code]) => ({
      stateCode: code,
      likelihood: endpoints.has(code)
        ? ('endpoint' as const)
        : (runMiles.get(code) ?? 0) >= LIKELY_RUN_MILES
          ? ('crosses' as const)
          : ('clips' as const),
      covered: hasCoverage(code),
    }));
}

/** The sentence that must accompany any corridor list shown to a user. */
export const CORRIDOR_DISCLAIMER =
  'These are the states a STRAIGHT LINE between your two addresses passes through or near — we did NOT route this lane, and not one permit is priced from this list. It is deliberately generous, and it will name states you do not cross: a state listed here that you skip costs you a blank row, while one left out would cost you an unbudgeted permit at a scale house. You know your route; we do not. Enter the in-state miles from your own PC*Miler or ProMiles run for the states you actually cross, and every distance-priced permit is computed from those figures and cited.';
