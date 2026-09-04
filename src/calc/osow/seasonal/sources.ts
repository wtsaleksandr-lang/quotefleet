/**
 * THE SOURCE REGISTRY — one row per state, naming the state's OWN publication.
 *
 * ── THE RULE THAT SHAPES THIS FILE ────────────────────────────────────────
 * Every URL below is the ISSUING AGENCY's. Aggregator sites (oversize.io's
 * frost-laws-by-state, WCS's per-state spring bulletins) were used as a MAP to
 * find these pages and appear nowhere in the data: a commercial summary of a
 * state bulletin is not a citation, it is somebody else's reading of one, and
 * the whole point of `provenance.ts` is that a dispatcher can open our link and
 * land on the document that binds them.
 *
 * ── THREE HONEST CLASSES OF STATE, NOT ONE ────────────────────────────────
 * "Which states have frost laws" has a worse answer than the aggregators
 * suggest, and pretending otherwise is how a dispatcher gets a false clear:
 *
 *   1. STATE-SYSTEM PROGRAMME (`programme: 'statewide'`). The DOT itself posts
 *      and lifts restrictions on state-maintained highways. Twelve states here.
 *   2. LOCAL-ONLY (`programme: 'local-only'`). The state system carries no
 *      seasonal restriction, and counties/townships post their own under local
 *      authority. Ohio, Indiana, Illinois, Missouri and New York are all in
 *      this class — an aggregator that lists them as "frost law states" is not
 *      wrong about the roads, it is wrong about WHO to ask. We say so, and we
 *      do not poll a state feed that does not exist.
 *   3. NONE. No spring thaw programme we can cite at any level.
 *
 * A `local-only` row is DATA, not a gap. It answers "does my Ohio lane have a
 * state frost-law problem?" with a cited no, which is the answer, and points at
 * the county-level reality instead of inventing a state bulletin.
 *
 * ── AND THREE HONEST CLASSES OF FEED ──────────────────────────────────────
 * `ingestion` says what we can actually DO with the source, and it is a
 * property of the publication, not of our effort:
 *
 *   'parse'          — the source is structured enough to yield restriction
 *                      ROWS with dates. North Dakota publishes GeoJSON with an
 *                      `InEffect` flag and an `LR_Order_Effective_DateTime` per
 *                      segment; Minnesota prints a zone table with a start AND
 *                      an end date; Michigan numbers its bulletins and dates
 *                      each one. These become `Sourced<SeasonalRestrictionTerms>`.
 *   'change-detect'  — the source is a rendered map, a status page or a PDF. We
 *                      CANNOT produce a row from it without guessing, so we do
 *                      not. We fetch it on the same schedule, hash it, and
 *                      report WHEN IT CHANGED with the link. "South Dakota's
 *                      spring load restriction page changed this morning" is a
 *                      true, useful, checkable statement; a parsed restriction
 *                      we hallucinated out of a map tile is not.
 *   'none'           — nothing to fetch (a `local-only` or `none` state).
 *
 * This is the same discipline as `WeightBand`: encode what the source says,
 * record what it does not, and never fill a gap with a confident invention.
 */
import type {
  MachineReadability,
  SeasonalProgramme,
  SourceFormat,
  StaleFailureDirection,
} from './types.js';

/** What we can do with a source, in the sense set out in the module header. */
export type IngestionMode = 'parse' | 'change-detect' | 'none';

/** The parser to run. `null` for change-detect and non-programme states. */
export type SeasonalAdapter =
  | 'nd-geojson'
  | 'mn-zone-table'
  | 'mi-bulletin'
  | 'wa-cvrestrictions'
  | null;

/** `MM-DD`. A window whose start is after its end wraps the new year. */
export type MonthDay = string;

export interface PostingWindow {
  /** First day of the season we poll aggressively. `MM-DD`. */
  from: MonthDay;
  /** Last day of it. `MM-DD`. */
  to: MonthDay;
  /**
   * WHY THIS WINDOW. A statute where one exists, otherwise the state's own
   * observed bulletin history. Never "roughly spring" — the cadence is derived
   * from this field, so an unjustified window is an unjustified schedule.
   */
  basis: string;
}

export interface SeasonalSourceSpec {
  code: string;
  name: string;
  programme: SeasonalProgramme;
  /** The page a dispatcher opens. ALWAYS the issuing agency. */
  authorityUrl: string;
  authorityTitle: string;
  publisher: string;
  /** The URL we actually FETCH, when it differs from the human page. */
  fetchUrl?: string;
  format: SourceFormat;
  machineReadable: MachineReadability;
  ingestion: IngestionMode;
  adapter: SeasonalAdapter;
  /**
   * Set when the feed needs a free, no-cost access code. The ingest SKIPS the
   * state (recording `skipped`, never `failure`) when the variable is unset, so
   * an unprovisioned key can never look like a broken source — and it never
   * costs a cent either way.
   */
  freeApiKey?: { envVar: string; signupUrl: string };
  postingWindow: PostingWindow;
  staleFailureDirection: StaleFailureDirection;
  /** Stable `SourceDoc.id` prefix, so a row traces to its document in logs. */
  sourceId: string;
  /** What the state actually does, in plain words. Rendered on the page. */
  note: string;
}

/**
 * A posting window every non-programme state carries so the type stays total.
 * It is never read — `cadenceFor` short-circuits on `ingestion === 'none'`.
 */
const NO_SEASON: PostingWindow = {
  from: '01-01',
  to: '01-01',
  basis: 'no state-system seasonal programme; this window is never polled',
};

export const SEASONAL_SOURCES: readonly SeasonalSourceSpec[] = [
  // ── PARSEABLE FEEDS ─────────────────────────────────────────────────────
  {
    code: 'ND',
    name: 'North Dakota',
    programme: 'statewide',
    authorityUrl: 'https://www.dot.nd.gov/driver/commercial/north-dakota-load-restrictions',
    authorityTitle: 'NDDOT — North Dakota Load Restrictions',
    publisher: 'North Dakota Department of Transportation',
    // The single best source in the country for this data. A public GeoJSON
    // FeatureCollection, one feature per published highway segment, carrying
    // `InEffect` ('Y'/'N'), `Restriction_Code_Desc` ('7 Ton'), the segment's
    // milepost range, and `LR_Order_Effective_DateTime` — the ORDER's own
    // effective moment, which is exactly `effectiveFrom`. It serves ETag and
    // Last-Modified, so a poll that finds no change costs one 304.
    fetchUrl: 'https://travelfiles.dot.nd.gov/geojson_nc/loadrestrict-current.json',
    format: 'geojson',
    machineReadable: 'full',
    ingestion: 'parse',
    adapter: 'nd-geojson',
    postingWindow: {
      from: '02-01',
      to: '07-15',
      basis:
        'NDDOT issues numbered load-restriction orders under NDCC 39-12-03. Observed 2026-09-04: order 2026-20, effective 2026-06-25, still carried segments with InEffect=Y — so the season demonstrably runs past midsummer and the window is set from the feed, not from folklore.',
    },
    // Segments are cleared from the in-effect set when an order lifts them, so
    // a snapshot we stop refreshing keeps showing lifted restrictions.
    staleFailureDirection: 'over-restricts',
    sourceId: 'nd-loadrestrict-geojson',
    note: 'NDDOT publishes every restricted segment as GeoJSON with the order number, its effective time and the ton limit. This is the one state where we hold segment-level detail.',
  },
  {
    code: 'MN',
    name: 'Minnesota',
    programme: 'statewide',
    authorityUrl: 'https://www.dot.state.mn.us/loadlimits/',
    authorityTitle: 'MnDOT — Seasonal Load Limits: start and end dates',
    publisher: 'Minnesota Department of Transportation',
    format: 'html-table',
    machineReadable: 'partial',
    ingestion: 'parse',
    adapter: 'mn-zone-table',
    postingWindow: {
      from: '02-15',
      to: '06-01',
      basis:
        "MnDOT publishes both a start and an end date per frost zone before the season opens, and announces each at least three calendar days in advance. 2026's table ran Mar 3 (Metro/South/Southeast) to May 15 (North).",
    },
    // The published table carries an END date, so a stale copy expires itself
    // and we lose a newly posted or EXTENDED window rather than inventing one.
    staleFailureDirection: 'under-restricts',
    sourceId: 'mn-loadlimits-zone-table',
    note: 'Six frost zones, each with a published start and end date. MnDOT announces changes at least three days ahead, which is what makes a several-hour poll comfortably fast enough.',
  },
  {
    code: 'MI',
    name: 'Michigan',
    programme: 'statewide',
    authorityUrl: 'https://mdotjboss.state.mi.us/APSWB/SWBHome.htm?bulletin=weight',
    authorityTitle: 'MDOT — Spring Weight Restriction Bulletins',
    publisher: 'Michigan Department of Transportation',
    format: 'html-bulletin',
    machineReadable: 'partial',
    ingestion: 'parse',
    adapter: 'mi-bulletin',
    postingWindow: {
      from: '02-01',
      to: '06-01',
      basis:
        "MDOT issues numbered Spring Weight Restriction Bulletins, each stating the moment it takes effect. The 2026 season ran bulletin #1 on Feb 17 to bulletin #8 on May 15, which lifted the last restriction statewide.",
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'mi-spring-weight-bulletins',
    note: 'Restrictions apply to routes marked "Seasonal" on the MDOT Truck Operators Map — a 25% axle-weight reduction on rigid pavement and 35% on flexible. Which pavement a given mile is, is a property of the road, not of the state, so we never compute the reduction ourselves.',
  },
  {
    code: 'WA',
    name: 'Washington',
    programme: 'statewide',
    authorityUrl: 'https://wsdot.com/travel/real-time/truck-restrictions',
    authorityTitle: 'WSDOT — Commercial vehicle route restrictions',
    publisher: 'Washington State Department of Transportation',
    fetchUrl:
      'https://wsdot.wa.gov/Traffic/api/CVRestrictions/CVRestrictionsREST.svc/GetCommercialVehicleRestrictionsAsJson',
    format: 'json-api',
    machineReadable: 'full',
    ingestion: 'parse',
    adapter: 'wa-cvrestrictions',
    // FREE. WSDOT issues a Traveler Information API access code to any email
    // address at no charge; there is no metering and no bill. Absent the code
    // the state is SKIPPED, not failed — see the field's doc comment.
    freeApiKey: { envVar: 'WSDOT_TRAVELER_API_KEY', signupUrl: 'https://wsdot.wa.gov/traffic/api/' },
    postingWindow: {
      from: '02-01',
      to: '05-15',
      basis:
        'WSDOT posts seasonal load restrictions on state highways during the spring thaw and publishes them alongside its other commercial-vehicle restrictions in the Traveler Information API.',
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'wa-cvrestrictions-api',
    note: 'Washington is one of the 21 states this engine already prices permits for, so a restriction here can change a quote we issue. The feed is a typed JSON API and carries a start and end date per restriction.',
  },

  // ── CHANGE-DETECTED SOURCES ─────────────────────────────────────────────
  // Real state programmes whose publication is a status page, a map viewer or a
  // PDF. We poll them on the same cadence, report when they change, and link
  // out. We do NOT manufacture restriction rows from them.
  {
    code: 'WI',
    name: 'Wisconsin',
    programme: 'statewide',
    authorityUrl:
      'https://wisconsindot.gov/Pages/dmv/com-drv-vehs/mtr-car-trkr/ssnl-wt-rsrctns/default.aspx',
    authorityTitle: 'WisDOT — Seasonal weight restriction programs',
    publisher: 'Wisconsin Department of Transportation',
    format: 'html-table',
    machineReadable: 'partial',
    ingestion: 'change-detect',
    adapter: null,
    postingWindow: {
      from: '01-15',
      to: '05-15',
      basis:
        "Wisconsin runs TWO opposed seasonal programmes on the same page. The frozen-road law RAISES limits in deep winter and can end at any thaw; Class II spring thaw restrictions then LOWER them on ~1,400 miles of state highway. 2026: Class II began Mar 6 (Zones 2-5) and Mar 10 (Zone 1), and ended Apr 30. Polling opens in mid-January because the frozen-road declaration ends, without notice, on the first warm spell.",
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'wi-seasonal-weight-restrictions',
    note: 'Zone-based Class II restrictions of 6 tons single / 10 tons tandem, 24 tons gross. Announced by zone, and the same page also carries the frozen-road law, which moves in the opposite direction.',
  },
  {
    code: 'SD',
    name: 'South Dakota',
    programme: 'statewide',
    authorityUrl:
      'https://sdtruckinfo.sd.gov/rules-regulations/size-weight-regulations/spring-load-restrictions/',
    authorityTitle: 'South Dakota Truck Info — Spring Load Restrictions',
    publisher: 'South Dakota Department of Transportation',
    format: 'html-bulletin',
    machineReadable: 'partial',
    ingestion: 'change-detect',
    adapter: null,
    postingWindow: {
      from: '02-15',
      to: '04-30',
      basis:
        'SDCL 32-22-24 authorises a highway maintaining authority to restrict loads at any time BETWEEN FEBRUARY 15 AND APRIL 30. This is the only state in the registry whose season is fixed by statute rather than by observation, so the window is the statute verbatim.',
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'sd-spring-load-restrictions',
    note: 'SDDOT sets and lifts restrictions from accumulated freeze/thaw indices and field observation, and announces each change by press release and on this page.',
  },
  {
    code: 'MT',
    name: 'Montana',
    programme: 'statewide',
    authorityUrl: 'https://www.mdt.mt.gov/travinfo/restrictions.aspx',
    authorityTitle: 'MDT — Travel Information: restrictions',
    publisher: 'Montana Department of Transportation',
    format: 'map-viewer',
    machineReadable: 'none',
    ingestion: 'change-detect',
    adapter: null,
    postingWindow: {
      from: '02-01',
      to: '05-31',
      basis:
        'MDT posts spring break-up restrictions through its travel-information system as districts thaw; no fixed statutory season is published, so the window is the observed spread of MDT restriction notices.',
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'mt-travinfo-restrictions',
    note: 'Published through the statewide travel-information map rather than as a bulletin, so we link to it and watch it for change rather than claiming a parsed limit.',
  },
  {
    code: 'ME',
    name: 'Maine',
    programme: 'statewide',
    authorityUrl: 'https://www.maine.gov/dot/postedroads/',
    authorityTitle: 'MaineDOT — Posted Roads',
    publisher: 'Maine Department of Transportation',
    format: 'html-table',
    machineReadable: 'partial',
    ingestion: 'change-detect',
    adapter: null,
    postingWindow: {
      from: '02-15',
      to: '05-31',
      basis:
        'MaineDOT publishes the posted-road list for the spring thaw and lifts it as roads recover; the observed season runs from late February postings to a May lift.',
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'me-posted-roads',
    note: 'Maine calls these posted roads rather than frost laws. The list covers state and state-aid highways and is republished as roads are added and released.',
  },
  {
    code: 'AK',
    name: 'Alaska',
    programme: 'statewide',
    authorityUrl: 'https://dot.alaska.gov/mscvc/',
    authorityTitle: 'Alaska DOT&PF — Measurement Standards & Commercial Vehicle Compliance',
    publisher: 'Alaska Department of Transportation & Public Facilities',
    format: 'html-bulletin',
    machineReadable: 'none',
    ingestion: 'change-detect',
    adapter: null,
    postingWindow: {
      from: '03-01',
      to: '06-30',
      basis:
        'Alaska thaws later and over a longer span than the lower 48, and DOT&PF issues break-up restrictions region by region from early spring into midsummer.',
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'ak-mscvc-restrictions',
    note: 'Break-up restrictions are issued regionally by DOT&PF. The season is later and longer than any lower-48 state, which is why this row has its own window rather than sharing the northern-tier default.',
  },
  {
    code: 'ID',
    name: 'Idaho',
    programme: 'statewide',
    authorityUrl: 'https://511.idaho.gov/',
    authorityTitle: 'Idaho 511 — travel restrictions',
    publisher: 'Idaho Transportation Department',
    format: 'map-viewer',
    machineReadable: 'none',
    ingestion: 'change-detect',
    adapter: null,
    postingWindow: {
      from: '02-01',
      to: '05-15',
      basis:
        'ITD posts spring break-up restrictions through Idaho 511 as districts thaw; no statutory season is published.',
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'id-511-restrictions',
    note: 'Idaho publishes restrictions through the 511 traveller map. There is no bulletin document to cite, so we watch the page and link to it.',
  },
  {
    code: 'NE',
    name: 'Nebraska',
    programme: 'statewide',
    authorityUrl: 'https://dot.nebraska.gov/business-center/permits/truck/',
    authorityTitle: 'NDOT — Truck permits and restrictions',
    publisher: 'Nebraska Department of Transportation',
    format: 'html-bulletin',
    machineReadable: 'none',
    ingestion: 'change-detect',
    adapter: null,
    postingWindow: {
      from: '02-01',
      to: '04-30',
      basis:
        'Nebraska thaws earlier than the northern tier; NDOT posts and lifts frost restrictions across late winter and early spring.',
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'ne-truck-restrictions',
    note: 'Restrictions are announced through the NDOT truck-permit pages rather than as a numbered bulletin series.',
  },
  {
    code: 'WY',
    name: 'Wyoming',
    programme: 'statewide',
    authorityUrl: 'https://www.wyoroad.info/',
    authorityTitle: 'WYDOT — Wyoming Road Conditions',
    publisher: 'Wyoming Department of Transportation',
    format: 'map-viewer',
    machineReadable: 'none',
    ingestion: 'change-detect',
    adapter: null,
    postingWindow: {
      from: '02-01',
      to: '05-15',
      basis:
        'WYDOT posts seasonal load restrictions through its road-conditions system as districts thaw.',
    },
    staleFailureDirection: 'over-restricts',
    sourceId: 'wy-wyoroad-restrictions',
    note: 'Published on the statewide road-conditions map. Wyoming restricts fewer miles than its neighbours because much of the state system is built on free-draining base.',
  },

  // ── LOCAL-ONLY STATES ───────────────────────────────────────────────────
  // Every one of these is a state THIS ENGINE ALREADY PRICES PERMITS FOR, and
  // every one is routinely listed as a "frost law state" by aggregators. The
  // correction matters: the STATE SYSTEM is not seasonally restricted, and the
  // restriction a truck actually meets is posted by a county or township. There
  // is no state feed to poll, and pretending there is would be worse than the
  // gap it papers over.
  {
    code: 'OH',
    name: 'Ohio',
    programme: 'local-only',
    authorityUrl: 'https://codes.ohio.gov/ohio-administrative-code/rule-5501%3A2-1-05',
    authorityTitle: 'OAC 5501:2-1-05 — ODOT special hauling permits',
    publisher: 'Ohio Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'oh-no-state-seasonal',
    note: 'ODOT does not impose spring weight restrictions on the state highway system. Ohio frost laws are posted by county engineers and township trustees on local roads, road by road, with no statewide list. Check the county engineer for the specific local roads on your route.',
  },
  {
    code: 'IN',
    name: 'Indiana',
    programme: 'local-only',
    authorityUrl: 'https://www.in.gov/indot/',
    authorityTitle: 'INDOT',
    publisher: 'Indiana Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'in-no-state-seasonal',
    note: 'INDOT does not seasonally restrict the state highway system. Indiana frost laws are posted by county highway departments on county roads.',
  },
  {
    code: 'IL',
    name: 'Illinois',
    programme: 'local-only',
    authorityUrl:
      'https://idot.illinois.gov/doing-business/permit-and-sales-marketplace/oversize-and-overweight-permits/apply.html',
    authorityTitle: 'IDOT — Oversize and overweight permits',
    publisher: 'Illinois Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'il-no-state-seasonal',
    note: 'IDOT does not post spring weight restrictions on state highways. Illinois seasonal limits are set by county and township highway commissioners on local roads.',
  },
  {
    code: 'MO',
    name: 'Missouri',
    programme: 'local-only',
    authorityUrl: 'https://www.modot.org/important-notices-motor-carriers',
    authorityTitle: 'MoDOT — Important notices for motor carriers',
    publisher: 'Missouri Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'mo-no-state-seasonal',
    note: 'MoDOT runs no annual spring thaw programme. Missouri restrictions are local and episodic; MoDOT publishes any exceptional embargo on its motor-carrier notices page, which is the page linked here.',
  },
  {
    code: 'NY',
    name: 'New York',
    programme: 'local-only',
    authorityUrl: 'https://www.dot.ny.gov/nypermits',
    authorityTitle: 'NYSDOT — Oversize/overweight permits',
    publisher: 'New York State Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'ny-no-state-seasonal',
    note: 'NYSDOT does not seasonally restrict the touring routes. New York frost laws are posted by towns and counties on local roads, typically for a few weeks in March and April.',
  },
  {
    code: 'PA',
    name: 'Pennsylvania',
    programme: 'local-only',
    authorityUrl: 'https://www.pa.gov/agencies/penndot',
    authorityTitle: 'PennDOT',
    publisher: 'Pennsylvania Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'pa-no-state-seasonal',
    note: 'Pennsylvania regulates weak roads through YEAR-ROUND posting and bonding, not through a spring thaw season. A posted-and-bonded road is restricted in July as well as in March, so it is a routing question rather than a seasonal one.',
  },
  {
    code: 'CO',
    name: 'Colorado',
    programme: 'none',
    authorityUrl: 'https://www.codot.gov/',
    authorityTitle: 'CDOT',
    publisher: 'Colorado Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'co-no-seasonal',
    note: 'CDOT runs no spring thaw weight programme. Colorado closes and chain-controls mountain routes in winter, which is a traction and closure question, not an axle-weight one.',
  },
  {
    code: 'NJ',
    name: 'New Jersey',
    programme: 'none',
    authorityUrl: 'https://www.nj.gov/transportation/freight/trucking/oversize.shtm',
    authorityTitle: 'NJDOT — Oversize/overweight trucking',
    publisher: 'New Jersey Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'nj-no-seasonal',
    note: 'No spring thaw weight programme. New Jersey does not reach the sustained frost depth the northern tier restricts for.',
  },
  {
    code: 'VA',
    name: 'Virginia',
    programme: 'none',
    authorityUrl: 'https://www.vdot.virginia.gov/',
    authorityTitle: 'VDOT',
    publisher: 'Virginia Department of Transportation',
    format: 'none',
    machineReadable: 'none',
    ingestion: 'none',
    adapter: null,
    postingWindow: NO_SEASON,
    staleFailureDirection: 'under-restricts',
    sourceId: 'va-no-seasonal',
    note: 'No spring thaw weight programme on the state system.',
  },
];

const BY_CODE = new Map(SEASONAL_SOURCES.map((s) => [s.code, s]));

export function seasonalSourceFor(code: string): SeasonalSourceSpec | null {
  return BY_CODE.get(String(code ?? '').trim().toUpperCase()) ?? null;
}

/** Every state we actually poll — `parse` and `change-detect` alike. */
export function pollableSources(): SeasonalSourceSpec[] {
  return SEASONAL_SOURCES.filter((s) => s.ingestion !== 'none');
}

/** True when a state's restrictions can change a load's legality at all. */
export function hasSeasonalProgramme(code: string): boolean {
  return seasonalSourceFor(code)?.programme === 'statewide';
}
