/**
 * THE MOVE CONTEXT — everything about a move that is NOT a measurement of the
 * load, and the per-jurisdiction vocabulary the states describe it in.
 *
 * WHY THIS MODULE EXISTS AT ALL
 * ════════════════════════════
 * Phases 1–9 could answer every published rule with a measurement and, at most,
 * one road type drawn from a SHARED enum. Nine more states break that in four
 * separate places, and each break is a wrong number rather than a missing one:
 *
 *   1. THE SHARED ROAD VOCABULARY IS NOT SHARED. A four-lane undivided road is
 *      "undivided" in Nebraska and "four lanes or more" in Kansas — the SAME
 *      ROAD, and the two states put the escort on opposite ends of the load.
 *      One enum cannot hold both readings, and flattening them picks a winner
 *      by accident. Kansas keys on lane count, Nebraska on a median test (plus
 *      a fifth term, "four-lane divided State Highways"), Utah publishes
 *      "Freeway"/"Secondary Highway" AND "two-lane"/"interstate" for what is
 *      evidently one rule, Minnesota needs paved/unpaved because the LEGAL
 *      single axle differs between them, Iowa has primary / nonprimary /
 *      noninterstate-CDL where the third is selected by the DRIVER'S
 *      CREDENTIAL rather than by the road, and Wisconsin's Class A / Class B
 *      is MULTIPLICATIVE — Class B is 60 percent of Class A's weights.
 *   2. TIME DECIDES THINGS. Arizona publishes no numeric escort threshold in
 *      the section titled "Escort Vehicles" at all; the only published numbers
 *      apply "from 3:00 a.m. until one-half hour before sunrise" or on named
 *      metropolitan segments during weekday curfew hours. Nevada conditions on
 *      darkness and on holiday hours — and its ANNUAL PERMIT ENVELOPE ITSELF
 *      shrinks from 14 ft to 12 ft at night, which is a permit limit moving
 *      with the clock rather than an escort rule.
 *   3. NAMED SEGMENTS DECIDE THINGS. Nevada's I-15 carve-out cuts the width
 *      ceiling 14 ft → 12 ft for Friday-afternoon northbound and
 *      Sunday-afternoon southbound between the California line and Exit 33.
 *      Arizona's Table 4 is route-and-milepost. Nebraska locks a 46,000 lb
 *      tandem product to specific I-80 / I-76 / N-71 / US-183 segments.
 *   4. FACTS ABOUT THE TRUCK AND ITS PAPERWORK DECIDE THINGS. Maryland's legal
 *      single axle is 22,400 lb or 20,000 lb according to the vehicle's
 *      REGISTERED gross weight, which is not a property of the load at all.
 *      Nevada's mechanically-steered rear axle moves both the permit ceiling
 *      and the escort trigger, 110 ft → 120 ft.
 *
 * All four are the same shape: a published rule that is true of SOME moves in a
 * jurisdiction and false of others, on an axis the load's dimensions do not
 * carry. So they are one mechanism — a small three-valued condition language
 * over a `MoveContext` — rather than four.
 *
 * THE CONTRACT, WHICH IS THE WHOLE POINT
 * ══════════════════════════════════════
 * **AN UNSUPPLIED CONTEXT FACT IS `unknown`, NEVER THE PERMISSIVE READING.**
 *
 * That sentence is the reason this file is written the way it is. A quote that
 * does not state the time of travel must not be priced as a daytime move, and a
 * quote that does not name the route class must not be given the class with the
 * fewest escorts. Both mistakes produce a confident number that is cheaper than
 * the truth, which is the single worst failure mode an OS/OW quote has — the
 * customer finds out at the scale house.
 *
 * The subtler half of that contract is the one a shared enum cannot keep at
 * all: a caller who passes the generic `two-lane` into a state whose rules are
 * written in ITS OWN vocabulary has not answered the state's question. Reading
 * that as "not four lanes" would silently decide a Kansas escort. So a
 * jurisdiction that declares a `RouteVocabulary` gets `unknown` for any class
 * it does not itself publish, and the quote says which classes it does.
 *
 * WHY IT IS ITS OWN MODULE
 * ════════════════════════
 * `provenance.ts` needs the condition type, so a single sourced row can be
 * confined to part of a jurisdiction — that is how Kansas's 80,000 lb
 * interstate ceiling and its heavier off-interstate table stop looking like two
 * sources contradicting each other. `escortRules.ts` needs the same language
 * for escort rules. Putting it in either would make the two import each other,
 * so it lives beneath both and imports nothing.
 *
 * NOTHING HERE IS RETROACTIVE. Every field is optional, every jurisdiction that
 * declares none of them behaves exactly as it did before this module existed,
 * and `scripts/osow-behaviour-snapshot.ts` is how that claim is checked rather
 * than asserted.
 */

/** Three-valued truth. `'unknown'` is a first-class answer, not an error. */
export type Tri = true | false | 'unknown';

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE CLASSES — THE SHARED VOCABULARY, AND THE PER-JURISDICTION ONE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Road classes that mean the same thing in every state that uses them, plus the
 * single-state legends minted in Phases 3–9 before there was a per-jurisdiction
 * vocabulary to put them in.
 *
 * The hyphen-prefixed members (`ca-`, `co-`, `ky-`, `ok-`, `fl-`, `tn-`, `mi-`)
 * are the SAME IDEA as `JurisdictionRouteClass` in an older spelling, and they
 * are deliberately left where they are: a caller, a stored quote and a public
 * page all pass these strings today, and renaming them would break every one of
 * those for no gain in what can be expressed. New jurisdictions declare their
 * classes through `RouteVocabulary` instead, which buys two things the old
 * spelling cannot — the state's own published NAME and QUOTE travel with the
 * class, and a class the state does not publish is rejected rather than read as
 * false.
 */
export type SharedRouteClass =
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
  | 'ca-red'
  /** CDOT map: RED segment, two lanes. Anything over 8'6" needs a Chapter 6 Special. */
  | 'co-red-two-lane'
  | 'co-red-four-lane'
  /** CDOT map: BLUE segment — the tightest colour that still takes a pilot car. */
  | 'co-blue-two-lane'
  | 'co-blue-four-lane'
  | 'co-yellow-two-lane'
  | 'co-yellow-four-lane'
  | 'co-green-two-lane'
  | 'co-green-four-lane'
  /** CDOT map: WHITE segment — the most permissive, no escort until 15 ft. */
  | 'co-white-two-lane'
  | 'co-white-four-lane'
  /** 603 KAR 5:066 classification: Class "AAA" — 80,000 lb, and the interstates. */
  | 'ky-class-aaa'
  /** 603 KAR 5:066 classification: Class "AA" — 62,000 lb. */
  | 'ky-class-aa'
  /** 603 KAR 5:066 classification: Class "A" — 44,000 lb, barely half of AAA. */
  | 'ky-class-a'
  /**
   * 1680-07-01-.06(2): a Tennessee two-lane highway whose minimum pavement width
   * EXCLUDING paved shoulders is under 24 ft. One front escort over 10 ft wide.
   */
  | 'tn-two-lane-under-24ft-pavement'
  /** The same road with 24 ft or more of pavement — no escort until 12 ft 6 in. */
  | 'tn-two-lane-24ft-pavement-or-more'
  /**
   * MCL 257.717(7) / 257.719(3): a Michigan highway the state transportation
   * department, a county road commission or a local authority HAS DESIGNATED.
   * 102 in wide, a 53 ft semitrailer, 65 ft truck-and-trailer, and the 16,000 lb
   * tandem allowance of MCL 257.722(2)-(3).
   */
  | 'mi-designated'
  /** The same road undesignated: 96 in wide, a 50 ft semitrailer, 59 ft combination. */
  | 'mi-non-designated';

/**
 * A class declared by ONE jurisdiction, in its own published words.
 *
 * The `CODE:name` shape is deliberate and is not decoration. It makes the
 * jurisdiction part of the VALUE, so `'KS:four-or-more-lanes'` and
 * `'NE:undivided'` cannot be confused for one another even though they can name
 * the same physical stretch of road, and so a class asserted for the wrong
 * state is visible on inspection rather than only at evaluation.
 *
 * The type is intentionally open — TypeScript cannot enumerate a vocabulary
 * that lives in data. Validity is a RUNTIME question answered against the
 * jurisdiction's declared `RouteVocabulary`, which is the stronger check
 * anyway: it can say "Kansas publishes these three classes and not that one",
 * which a compile error cannot.
 */
export type JurisdictionRouteClass = `${string}:${string}`;

export type RouteClass = SharedRouteClass | JurisdictionRouteClass;

/** Which published limits a class-wide multiplier reaches. */
export type ScalableLimit =
  | 'widthIn'
  | 'heightIn'
  | 'overallLengthIn'
  | 'trailerLengthIn'
  | 'grossWeightLbs'
  | 'singleAxleLbs'
  | 'tandemAxleLbs';

/**
 * A limit multiplier a route class carries — Wisconsin's Class B.
 *
 * Wis. Stat. § 348.16(2) does not restate Class B's weights; it says a Class B
 * highway carries a fixed PERCENTAGE of the Class A figures. Encoding the
 * arithmetic result as a second set of numbers would present our multiplication
 * as the state's table, and would go stale the moment Class A moves. The factor
 * is the published fact, so the factor is what is stored.
 */
export interface RouteClassLimitScale {
  /** 0.6 for "60 percent". */
  factor: number;
  appliesTo: ScalableLimit[];
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

/** One class in a jurisdiction's own published road classification. */
export interface RouteClassDefinition {
  /** The value a caller passes, e.g. `'KS:four-or-more-lanes'`. */
  id: JurisdictionRouteClass;
  /** The jurisdiction's OWN name for it, verbatim: "four lanes or more". */
  publishedName: string;
  /** The source's own words defining the class. Required — the audit trail. */
  quote: string;
  /**
   * Shared classes this class is EQUIVALENT to, where the jurisdiction's own
   * definition says so.
   *
   * It is a convenience for the caller and never a licence to guess: a
   * dispatcher who can only say "interstate" gets the state's class when the
   * state itself equates the two, and `unknown` when it does not. Nebraska's
   * "undivided" and Kansas's "four lanes or more" both cover a four-lane
   * undivided road and NEITHER is listed against the generic
   * `multilane-undivided`, because equating them is exactly the flattening this
   * vocabulary exists to prevent.
   */
  generalEquivalents?: SharedRouteClass[];
  /** A multiplier this class applies to the jurisdiction's stated limits. */
  limitScale?: RouteClassLimitScale;
  /**
   * What SELECTS this class. Almost always the roadway itself — but Iowa's
   * third class is selected by the DRIVER'S CREDENTIAL, not by the road, and a
   * reader who assumes otherwise will look for a road property that does not
   * exist. IAC 761—511 distinguishes primary, nonprimary and "noninterstate
   * with a CDL": the same stretch of pavement is the second or the third
   * according to who is driving.
   */
  selectedBy?: 'roadway' | 'driverCredential';
}

/**
 * A jurisdiction's own road classification, as a closed published list.
 *
 * `classes` being the WHOLE published list is what makes the unknown-on-miss
 * rule safe. A class outside it is not "some other road", it is a term this
 * state does not use — so the honest answer to "is this move on a
 * `KS:four-or-more-lanes`?" when the caller said `two-lane` is that we do not
 * know, because Kansas's rules do not define themselves against `two-lane`.
 */
export interface RouteVocabulary {
  /** The jurisdiction's own name for the scheme, e.g. 'K.A.R. 36-1-36(f) road classes'. */
  name: string;
  classes: RouteClassDefinition[];
  /**
   * TRUE when the jurisdiction publishes NO road classification for the rules
   * on file, as a positive finding rather than a gap.
   *
   * Arizona is the case. A.A.C. R17-6 classifies nothing by lane count or
   * median anywhere in its escort or permit rules; it names ROUTES AND
   * MILEPOSTS. Holding an empty `classes` list without this flag would read as
   * "we have not sourced Arizona's road classes", which is a research gap and
   * would put a warning on every Arizona quote about a scheme the state does
   * not have. See `NamedRouteSegment`.
   */
  publishesNoClassification?: boolean;
  /** What the source actually says. Required — this is the audit trail. */
  explanation: string;
}

/** Look a class up in a jurisdiction's vocabulary. `null` = not declared here. */
export function routeClassDefinitionFor(
  vocabulary: RouteVocabulary,
  routeClass: RouteClass,
): RouteClassDefinition | null {
  for (const c of vocabulary.classes) {
    if (c.id === routeClass) return c;
    if (c.generalEquivalents?.includes(routeClass as SharedRouteClass) === true) return c;
  }
  return null;
}

/**
 * Is a class one this jurisdiction can be asked about?
 *
 * `true` — the vocabulary declares it (directly or as a stated equivalent).
 * `false` — the vocabulary is declared and this is not in it, so every rule
 * written in this state's own terms is UNDECIDABLE for this move, not false.
 *
 * A jurisdiction with no vocabulary at all answers `true`, which is Phase 1–9
 * behaviour exactly: the shared enum was the vocabulary, and membership in it
 * was the only check there was.
 */
export function vocabularyAdmits(
  vocabulary: RouteVocabulary | undefined,
  routeClass: RouteClass,
): boolean {
  if (vocabulary === undefined) return true;
  return routeClassDefinitionFor(vocabulary, routeClass) !== null;
}

/**
 * A published limit after this class's multiplier, or the limit unchanged.
 *
 * `null` when the class is not in the vocabulary — the caller must NOT read
 * that as "no scaling applies", which is why it is not `value`.
 */
export function scaledLimit(
  vocabulary: RouteVocabulary | undefined,
  routeClass: RouteClass | undefined,
  limit: ScalableLimit,
  value: number,
): number | null {
  if (vocabulary === undefined || routeClass === undefined) return value;
  const def = routeClassDefinitionFor(vocabulary, routeClass);
  if (def === null) return null;
  const scale = def.limitScale;
  if (scale === undefined || !scale.appliesTo.includes(limit)) return value;
  return value * scale.factor;
}

// ═══════════════════════════════════════════════════════════════════════════
// NAMED ROUTE SEGMENTS — WHERE A STATE'S VOCABULARY IS ROUTES, NOT CLASSES
// ═══════════════════════════════════════════════════════════════════════════

/** One published stretch of road a rule is confined to. */
export interface NamedRouteSegment {
  /** The value a caller passes in `MoveContext.routeSegments`, e.g. `'NV:i-15-ca-line-to-exit-33'`. */
  id: string;
  /** The jurisdiction's own designation: 'I-15', 'SR 202 Loop', 'US-183'. */
  route: string;
  /** The published endpoints, in the source's own words. */
  fromDescription: string;
  toDescription: string;
  /** Mileposts where the source gives them — Arizona's Table 4 does. */
  fromMilepost?: number;
  toMilepost?: number;
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

export function namedRouteSegmentsEqual(a: NamedRouteSegment, b: NamedRouteSegment): boolean {
  return (
    a.id === b.id &&
    a.route === b.route &&
    a.fromMilepost === b.fromMilepost &&
    a.toMilepost === b.toMilepost
  );
}

/**
 * A SEGMENT TABLE THE AGENCY SERVES LIVE, which we can cite but cannot hold.
 *
 * Arizona is the case, and it is the reason this type is not just a list of
 * segments. A.A.C. R17-6-412 Table 4 is a highway-specific table of
 * "restrictions, requirements, conditions, and allowances" that ten other
 * sections defer to — and R17-6-401(G) provides it from ADOT's real-time
 * permitting system rather than from the rule text. There is no version of it
 * that can be transcribed and still be true next week.
 *
 * Transcribing a snapshot and pricing from it would be the worst of both
 * worlds: a stale table presented as the state's current one, with nothing on
 * the quote to say so. So the model holds what we can genuinely cite in
 * `heldSegments`, records that the authoritative table is live, and sends a
 * move whose route the held segments do not cover to review NAMING THE TABLE.
 * "Arizona's Table 4 governs this route and is served live by ADOT" is a useful
 * answer; a confident fee derived from a copy of it is not.
 */
export interface LiveSegmentTable {
  /** The state's own name for it: 'A.A.C. R17-6-412 Table 4'. */
  name: string;
  /** Where the agency serves the authoritative version. */
  url: string;
  /** The segments we hold and can cite. NEVER presented as the whole table. */
  heldSegments: NamedRouteSegment[];
  /** The source's own words about how the table is provided. */
  quote: string;
  /** What a quote must do when the table governs a route we do not hold. */
  explanation: string;
}

export function liveSegmentTablesEqual(a: LiveSegmentTable, b: LiveSegmentTable): boolean {
  return a.name === b.name && a.url === b.url;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MOVE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export type TravelDirection = 'northbound' | 'southbound' | 'eastbound' | 'westbound';

/** Whether the state's seasonal load restrictions are posted for this move. */
export type SeasonalRestrictionState = 'in-effect' | 'not-in-effect';

/**
 * Facts about the VEHICLE, not the load.
 *
 * Every member is here because a published rule turns on it, and each is
 * OPTIONAL so that an unanswered one is `unknown`:
 *
 *   - `mechanicallySteeredRearAxle` — Nevada moves both the permit ceiling and
 *     the escort trigger from 110 ft to 120 ft for a combination with one.
 *   - `stingerSteered` — Nebraska's overhang figures live inside the
 *     stinger-steered definition and nowhere else.
 *   - `transportingBuilding` — Iowa's 5-cents-per-ton-per-mile charge applies
 *     ONLY to "vehicles transporting buildings other than mobile homes and
 *     factory-built structures", which is why distance-dependence there is a
 *     property of the fee component and not of the state.
 *   - `governmentVehicle` — Kansas issues these a permit at no fee, which is a
 *     $0 permit that is REQUIRED, not an absent permit. See `ZeroFeePermit`.
 *   - `implementOfHusbandry` — Nebraska's Highway 75 IOH permit is the other
 *     published $0-fee case in this corpus.
 */
export interface VehicleConfiguration {
  mechanicallySteeredRearAxle?: boolean;
  stingerSteered?: boolean;
  transportingBuilding?: boolean;
  governmentVehicle?: boolean;
  implementOfHusbandry?: boolean;
}

export type VehicleConfigurationProperty = keyof VehicleConfiguration;

/** Iowa selects one of its three route classes by the driver's credential. */
export type DriverCredential = 'cdl' | 'non-cdl';

/**
 * Everything about a move that is not a dimension or a weight.
 *
 * EVERY FIELD IS OPTIONAL AND ABSENCE IS NEVER A DEFAULT. There is no
 * "daytime", no "not a holiday", no "unrestricted season" hiding in an
 * undefined. A condition that needs a field it was not given returns `unknown`
 * and names the field, and the quote goes to review saying what it needs.
 */
export interface MoveContext {
  routeClass?: RouteClass;
  /**
   * Named segments the move runs on, by `NamedRouteSegment.id`. A move can
   * touch several; a segment condition holds when ANY of them matches.
   */
  routeSegments?: string[];
  /** Direction on those segments. Nevada's I-15 rule is directional. */
  travelDirection?: TravelDirection;
  /**
   * Local clock time of travel, `'HH:MM'` on a 24-hour clock.
   *
   * NOT derivable from anything else, and never defaulted. Arizona's only
   * published numeric escort thresholds apply between 3:00 a.m. and half an
   * hour before sunrise — so a quote that cannot state the departure time
   * genuinely does not know whether those rules bite, and saying "daytime"
   * would delete a real escort from a night departure.
   */
  timeOfDay?: string;
  /** 0 = Sunday … 6 = Saturday. Nevada's I-15 carve-out is Friday and Sunday. */
  dayOfWeek?: number;
  /**
   * Travel in hours of darkness.
   *
   * DELIBERATELY NOT DERIVED FROM `timeOfDay`. Sunrise and sunset move by date
   * and longitude, Arizona's own rule is written against "one-half hour before
   * sunrise" rather than a clock time, and a computed sunset would be OUR
   * number presented as the state's trigger. A caller that knows it is a night
   * move says so; one that does not gets `unknown`.
   */
  darkness?: boolean;
  /** A holiday the jurisdiction names. Nevada conditions on "holiday hours". */
  holiday?: boolean;
  /**
   * Whether seasonal (frost / spring-thaw) load restrictions are posted.
   *
   * THIS IS A PRICING INPUT, not only a legality one. Minn. Stat. § 169.86
   * subd. 5(g) adds $120 to a wide single-trip permit "when the permit is
   * issued while seasonal load restrictions pursuant to section 169.87 are in
   * effect", and MnDOT's allowable permit axle weights are published as three
   * columns keyed to the same state. The frost-law data we already hold in
   * `seasonal/` therefore has to reach the fee calculator, not just the
   * warnings — this field is that seam.
   */
  seasonalRestriction?: SeasonalRestrictionState;
  /**
   * REGISTERED gross weight of the vehicle, pounds — a fact about the
   * registration, not about the load, and one no quote form collects today.
   *
   * Maryland is why it exists: Transp. § 24-108(a)(1) sets the legal single
   * axle at 22,400 lb where the registered gross weight is 73,000 lb or less
   * and 20,000 lb where it is more. Without this the two figures look like two
   * sources disagreeing about one limit, which is a conflict that can never be
   * resolved because it is not a disagreement at all.
   */
  registeredGrossWeightLbs?: number;
  vehicleConfiguration?: VehicleConfiguration;
  driverCredential?: DriverCredential;
  /** Dispatcher answers to `subjective` conditions, keyed by the condition's key. */
  subjectiveAnswers?: Record<string, boolean>;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CONDITION LANGUAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A predicate over the move context.
 *
 * Deliberately SEPARATE from `EscortCondition`, which is a predicate over the
 * load's measurements. The two are composed rather than merged — an escort rule
 * reaches this language through one `{ kind: 'context' }` leaf — because they
 * have different homes: a context condition also confines a single SOURCED ROW
 * (`Sourced.appliesWhen`), where an escort condition has no meaning at all.
 */
export type ContextCondition =
  /** The move is on one of these route classes, in the jurisdiction's vocabulary. */
  | { kind: 'routeClassIn'; anyOf: RouteClass[] }
  /** The move runs on one of these named segments. */
  | { kind: 'onNamedSegment'; segmentIds: string[] }
  | { kind: 'travelDirectionIn'; anyOf: TravelDirection[] }
  /**
   * Local clock time falls in `[fromHhmm, toHhmm)`. A window that WRAPS
   * midnight is written with `from` after `to` — '22:00'→'06:00' — and is
   * evaluated as the union of the two pieces, which is how the states write
   * night rules.
   */
  | { kind: 'timeOfDayBetween'; fromHhmm: string; toHhmm: string }
  | { kind: 'dayOfWeekIn'; anyOf: number[] }
  | { kind: 'inDarkness' }
  | { kind: 'onHoliday' }
  | { kind: 'seasonalRestrictionsInEffect' }
  /** Registered gross weight comparison — see `MoveContext.registeredGrossWeightLbs`. */
  | { kind: 'registeredGrossWeight'; op: 'gt' | 'gte' | 'lt' | 'lte'; valueLbs: number }
  | { kind: 'vehicleConfiguration'; property: VehicleConfigurationProperty; is: boolean }
  | { kind: 'driverCredentialIn'; anyOf: DriverCredential[] }
  | { kind: 'allOf'; of: ContextCondition[] }
  | { kind: 'anyOf'; of: ContextCondition[] }
  | { kind: 'noneOf'; of: ContextCondition[] };

/** Why a context condition came back `unknown`. Collected for the warning text. */
export interface ContextTrace {
  missing: Set<string>;
}

export function newContextTrace(): ContextTrace {
  return { missing: new Set() };
}

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

/** `'HH:MM'` → minutes since midnight, or `null` when it is not a clock time. */
export function minutesOfDay(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Is `at` inside `[from, to)`, including windows that wrap midnight?
 *
 * `null` when any of the three is not a clock time — a malformed window is not
 * a window that excludes everything.
 */
export function withinTimeWindow(at: string, fromHhmm: string, toHhmm: string): boolean | null {
  const t = minutesOfDay(at);
  const from = minutesOfDay(fromHhmm);
  const to = minutesOfDay(toHhmm);
  if (t === null || from === null || to === null) return null;
  if (from === to) return false;
  return from < to ? t >= from && t < to : t >= from || t < to;
}

/** Human name for a missing context fact, for warning text. */
const CONTEXT_LABEL: Record<string, string> = {
  routeClass: 'the road class this move runs on',
  routeSegments: 'which named route segments this move runs on',
  travelDirection: 'the direction of travel',
  timeOfDay: 'the time of day the move travels',
  dayOfWeek: 'the day of the week the move travels',
  darkness: 'whether the move travels in hours of darkness',
  holiday: 'whether the move travels on a holiday',
  seasonalRestriction: 'whether seasonal load restrictions are in effect',
  registeredGrossWeightLbs: 'the vehicle’s registered gross weight',
  driverCredential: 'the driver’s credential',
};

function vehicleLabel(property: VehicleConfigurationProperty): string {
  switch (property) {
    case 'mechanicallySteeredRearAxle':
      return 'whether the combination has a mechanically steered rear axle';
    case 'stingerSteered':
      return 'whether the combination is stinger-steered';
    case 'transportingBuilding':
      return 'whether the vehicle is transporting a building';
    case 'governmentVehicle':
      return 'whether this is a government vehicle';
    case 'implementOfHusbandry':
      return 'whether this is an implement of husbandry';
    default:
      return 'a vehicle configuration detail';
  }
}

/**
 * Evaluate a context condition, three-valued.
 *
 * `vocabulary` is what turns "the caller named a class this state does not
 * publish" into `unknown` instead of `false`. Passing `undefined` for it is the
 * pre-vocabulary behaviour and is correct for every jurisdiction that declares
 * none.
 */
export function evaluateContextCondition(
  cond: ContextCondition,
  ctx: MoveContext,
  vocabulary: RouteVocabulary | undefined,
  trace: ContextTrace = newContextTrace(),
): Tri {
  switch (cond.kind) {
    case 'routeClassIn': {
      const rc = ctx.routeClass;
      if (rc === undefined) {
        trace.missing.add(CONTEXT_LABEL.routeClass as string);
        return 'unknown';
      }
      // THE UNKNOWN-ON-MISS RULE. A class this jurisdiction does not publish
      // has not answered this jurisdiction's question, and reading it as `false`
      // would silently choose the reading with the fewest escorts.
      if (!vocabularyAdmits(vocabulary, rc)) {
        trace.missing.add(
          vocabulary === undefined
            ? (CONTEXT_LABEL.routeClass as string)
            : `a road class this jurisdiction publishes (it classifies roads as ${vocabulary.classes
                .map((c) => c.publishedName)
                .join(', ')}); "${rc}" is not one of them`,
        );
        return 'unknown';
      }
      if (cond.anyOf.includes(rc)) return true;
      if (vocabulary !== undefined) {
        const def = routeClassDefinitionFor(vocabulary, rc);
        if (def !== null && cond.anyOf.includes(def.id)) return true;
      }
      return false;
    }
    case 'onNamedSegment': {
      const segs = ctx.routeSegments;
      if (segs === undefined) {
        trace.missing.add(CONTEXT_LABEL.routeSegments as string);
        return 'unknown';
      }
      return cond.segmentIds.some((id) => segs.includes(id));
    }
    case 'travelDirectionIn': {
      if (ctx.travelDirection === undefined) {
        trace.missing.add(CONTEXT_LABEL.travelDirection as string);
        return 'unknown';
      }
      return cond.anyOf.includes(ctx.travelDirection);
    }
    case 'timeOfDayBetween': {
      if (ctx.timeOfDay === undefined) {
        trace.missing.add(CONTEXT_LABEL.timeOfDay as string);
        return 'unknown';
      }
      const inside = withinTimeWindow(ctx.timeOfDay, cond.fromHhmm, cond.toHhmm);
      if (inside === null) {
        trace.missing.add(CONTEXT_LABEL.timeOfDay as string);
        return 'unknown';
      }
      return inside;
    }
    case 'dayOfWeekIn': {
      if (ctx.dayOfWeek === undefined) {
        trace.missing.add(CONTEXT_LABEL.dayOfWeek as string);
        return 'unknown';
      }
      return cond.anyOf.includes(ctx.dayOfWeek);
    }
    case 'inDarkness': {
      if (ctx.darkness === undefined) {
        trace.missing.add(CONTEXT_LABEL.darkness as string);
        return 'unknown';
      }
      return ctx.darkness;
    }
    case 'onHoliday': {
      if (ctx.holiday === undefined) {
        trace.missing.add(CONTEXT_LABEL.holiday as string);
        return 'unknown';
      }
      return ctx.holiday;
    }
    case 'seasonalRestrictionsInEffect': {
      if (ctx.seasonalRestriction === undefined) {
        trace.missing.add(CONTEXT_LABEL.seasonalRestriction as string);
        return 'unknown';
      }
      return ctx.seasonalRestriction === 'in-effect';
    }
    case 'registeredGrossWeight': {
      const w = ctx.registeredGrossWeightLbs;
      if (w === undefined) {
        trace.missing.add(CONTEXT_LABEL.registeredGrossWeightLbs as string);
        return 'unknown';
      }
      if (cond.op === 'gt') return w > cond.valueLbs;
      if (cond.op === 'gte') return w >= cond.valueLbs;
      if (cond.op === 'lt') return w < cond.valueLbs;
      return w <= cond.valueLbs;
    }
    case 'vehicleConfiguration': {
      const v = ctx.vehicleConfiguration?.[cond.property];
      if (v === undefined) {
        trace.missing.add(vehicleLabel(cond.property));
        return 'unknown';
      }
      return v === cond.is;
    }
    case 'driverCredentialIn': {
      if (ctx.driverCredential === undefined) {
        trace.missing.add(CONTEXT_LABEL.driverCredential as string);
        return 'unknown';
      }
      return cond.anyOf.includes(ctx.driverCredential);
    }
    case 'allOf':
      return triAll(cond.of.map((c) => evaluateContextCondition(c, ctx, vocabulary, trace)));
    case 'anyOf':
      return triAny(cond.of.map((c) => evaluateContextCondition(c, ctx, vocabulary, trace)));
    case 'noneOf': {
      const inner = triAny(cond.of.map((c) => evaluateContextCondition(c, ctx, vocabulary, trace)));
      return inner === 'unknown' ? 'unknown' : !inner;
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

// ═══════════════════════════════════════════════════════════════════════════
// WHAT WE DELIBERATELY DID NOT BUILD, AND WHY — read before extending
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PRIOR-PERMIT REUSE IS A RECORDED REQUIREMENT AND IS NOT BUILT.
 *
 * Three of the nine states let a carrier reuse work already done on an earlier
 * permit for the SAME move: Wisconsin allows a structural review to stand for
 * 90 days, Minnesota lets a route survey stand for 60, and Maryland lets a
 * bridge analysis stand for six months. Each one can remove a real charge from
 * a repeat lane, so it is worth money and it is not speculative.
 *
 * IT IS NOT BUILT BECAUSE IT NEEDS SOMETHING THE ENGINE HAS NEVER HAD: quote
 * STATE. Every other fact this engine prices from is a property of the load,
 * the route, or a published document — all of them knowable from the request in
 * front of it. "Has this carrier already paid for a bridge analysis on this
 * lane, and when?" is a property of OUR OWN HISTORY, and answering it means a
 * persisted, carrier-scoped record of issued permits, a definition of when two
 * moves are the same move, and an expiry sweep. That is a feature, not a field,
 * and bolting a `priorPermitDate?: IsoDate` onto the load would invite a caller
 * to assert reuse the state would not honour.
 *
 * It affects only REPEAT lanes, and only downward — a quote that ignores reuse
 * is never too cheap. So the cost of deferring it is a first-quote-accurate,
 * repeat-quote-conservative number, which is the safe direction.
 */
export const PRIOR_PERMIT_REUSE_NOTE =
  'Prior-permit reuse (Wisconsin: 90-day structural review; Minnesota: 60-day route survey; Maryland: six-month bridge analysis) is NOT modelled. It requires persisted quote state — a carrier-scoped history of issued permits and a definition of lane identity — which this engine does not have. Quotes therefore price a repeat lane as a first move, which over-states rather than under-states the cost.';

/**
 * INPUTS NO QUOTE COLLECTS, AND THE RULES THAT ARE DARK WITHOUT THEM.
 *
 * Each entry is a published rule we hold and CANNOT evaluate, because it turns
 * on a measurement or a fact that is nowhere on a quote form. They are recorded
 * rather than defaulted: every one of them evaluates `unknown` and sends the
 * move to review, and NONE of them is given an invented default.
 *
 * This list is the argument for collecting the inputs later. Nothing else in
 * this repository can say which fields would actually buy an answer.
 */
export const DARK_RULES_FOR_WANT_OF_INPUT: ReadonlyArray<{
  input: string;
  jurisdictions: string[];
  rule: string;
}> = [
  {
    input: 'tire count and tire width',
    jurisdictions: ['MI', 'MN'],
    rule: 'Michigan MCL 257.722(1)(a)-(b) conditions two axle-load rows on "high pressure pneumatic or balloon tires"; Minnesota Minn. Stat. § 169.823 states axle allowances against tire width. Neither is on a quote, so both rows are recorded and never applied.',
  },
  {
    input: 'pavement / lane width of the segment',
    jurisdictions: ['TN', 'WI'],
    rule: 'Tennessee 1680-07-01-.06(2) splits a two-lane escort on 24 ft of pavement excluding shoulders; Wisconsin Trans 254.15(3) is a lane-POSITION rule that depends on lane geometry. The Tennessee case is answerable through a route class; the Wisconsin one is not, and stays advisory.',
  },
  {
    input: 'registered gross weight of the vehicle',
    jurisdictions: ['MD'],
    rule: 'Maryland Transp. § 24-108(a)(1) sets the legal single axle at 22,400 lb at or under 73,000 lb registered and 20,000 lb above it. `MoveContext.registeredGrossWeightLbs` is the seam; no quote form collects it, so both rows stay in effect and the limit resolves to review.',
  },
  {
    input: 'departure time, day of week and direction of travel',
    jurisdictions: ['AZ', 'NV', 'KS'],
    rule: 'Arizona R17-6-402(D) publishes escort thresholds only between 3:00 a.m. and half an hour before sunrise; Nevada NAC 484D.655(1)(b)-(c) cuts the I-15 width ceiling for Friday-afternoon northbound and Sunday-afternoon southbound travel; the Kansas Turnpike publishes a Monday-to-Thursday window. All three are modelled and all three are `unknown` until a quote states when and which way the load moves.',
  },
  {
    input: 'the route as named segments and mileposts',
    jurisdictions: ['AZ', 'NE', 'NV'],
    rule: 'Arizona Table 4 is route-and-milepost and is served live by ADOT; Nebraska locks its 46,000 lb tandem product to named I-80 / I-76 / N-71 / US-183 segments; Nevada’s carve-out is one stretch of I-15. A routed polyline is not yet resolved to segment ids, so these evaluate `unknown` rather than statewide.',
  },
];
