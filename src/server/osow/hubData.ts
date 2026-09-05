/**
 * THE OS/OW REFERENCE HUB'S DATA LAYER — a READ over `src/calc/osow`, and
 * nothing else.
 *
 * Every page under `/oversize` is a rendering of a computation, not a written
 * document. The engine already holds hundreds of source documents and cited,
 * effective-dated value rows across 21 states; until this module the only
 * public consumers were two calculators. This file turns that corpus into
 * table rows, provenance bands and conflict entries — and it is deliberately a
 * pure, one-directional read: **nothing here writes to `src/calc/osow`, and no
 * value is invented, defaulted or interpolated on the way out.**
 *
 * THREE RULES IT ENFORCES, BECAUSE THE PAGES' ONLY ADVANTAGE IS BEING RIGHT
 * ------------------------------------------------------------------------
 *  1. **A cell is a `HubCell`, never a bare string.** It carries the value AND
 *     the document behind it, or it carries the reason there is no value —
 *     `no-data`, `not-published` or `conflict`. Three different kinds of blank
 *     that a `string | null` would flatten into one.
 *  2. **A conflict is never adjudicated here.** `resolveSourced` returns null
 *     with both candidates when two in-effect official documents disagree, and
 *     this module renders that as a conflict cell showing both figures. Picking
 *     one would destroy the single thing no competitor can reproduce.
 *  3. **`dateModified` is derived from `max(retrievedOn)` over the sources the
 *     page actually renders** — never from deploy time. `provenanceFor` is the
 *     only source of that date, so a page cannot claim a freshness it cannot
 *     substantiate per fact.
 */
import { OSOW_JURISDICTIONS, osowRulesFor } from '../../calc/osow/jurisdictions/index.js';
import type {
  AxleSpacingWeightTable,
  JurisdictionOsowRules,
  OverweightPricing,
  StateBridgeTable,
  Threshold,
} from '../../calc/osow/types.js';
import {
  axleSpacingWeightTablesEqual,
  stateBridgeTablesEqual,
} from '../../calc/osow/types.js';
import type { IsoDate, Resolution, SourceDoc, Sourced } from '../../calc/osow/provenance.js';
import { isInEffect, resolveSourced } from '../../calc/osow/provenance.js';
import type {
  EscortCondition,
  EscortOutcome,
  EscortRule,
  Measure,
} from '../../calc/osow/escortRules.js';
import { formatFtIn } from '../../calc/osow/escortRules.js';
import {
  NO_PUBLISHED_POLICE_ESCORT_RATE,
  POLICE_ESCORT_RATES,
  policeEscortFloorUsd,
} from '../../calc/osow/escortCost.js';
import type { NoPublishedPoliceRate, PoliceEscortRate } from '../../calc/osow/escortCost.js';
import { ARKANSAS_251_MILE_GAP } from '../../calc/osow/jurisdictions/arkansas.js';
import { WASHINGTON_999_POUND_GAP } from '../../calc/osow/jurisdictions/washington.js';
import {
  TENNESSEE_ESCORT_BOUNDARY_GAPS,
  TENNESSEE_HOUSEBOAT_CONFLICT_ANALYSIS,
  TENNESSEE_WIDTH_BAND_GAP,
} from '../../calc/osow/jurisdictions/tennessee.js';
import {
  MICHIGAN_164000_RECONSTRUCTION,
  MICHIGAN_NAME_LETTER_PRORATION,
  MICHIGAN_SUPERSEDED_EDITIONS,
} from '../../calc/osow/jurisdictions/michigan.js';
import {
  MISSISSIPPI_BLANKET_ENVELOPE_CONFLICT,
  MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT,
  MISSISSIPPI_POLE_BLANKET_CONFLICT,
  MISSISSIPPI_SPECIAL_HEAVY_HAUL_TABLE_CONFLICT,
} from '../../calc/osow/jurisdictions/mississippi.js';
import {
  SOUTH_CAROLINA_EXCESSIVE_WIDTH_STEPS,
  SOUTH_CAROLINA_SUPERLOAD_ENGINEERING_FEE_NOTE,
  SOUTH_CAROLINA_SUPERLOAD_IMPACT_FEE_CONFLICT,
  SOUTH_CAROLINA_SUPERSEDED_GUIDELINES,
} from '../../calc/osow/jurisdictions/southCarolina.js';
import { US_STATES } from '../directory/usStates.js';

export const OSOW_HUB_PATH = '/oversize';

/** Territories the hub does not describe — none is reachable by road. */
const TERRITORY_CODES: ReadonlySet<string> = new Set(['PR', 'VI', 'GU']);

export interface HubState {
  code: string;
  name: string;
  slug: string;
  covered: boolean;
}

/** The 50 states + DC, alphabetical, each flagged for engine coverage. */
export const HUB_STATES: readonly HubState[] = US_STATES.filter(
  (s) => !TERRITORY_CODES.has(s.code),
)
  .map((s) => ({
    code: s.code,
    name: s.name,
    slug: s.slug,
    covered: Object.hasOwn(OSOW_JURISDICTIONS, s.code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Only the states with a jurisdiction file — the only ones that get a page. */
export const HUB_COVERED_STATES: readonly HubState[] = HUB_STATES.filter((s) => s.covered);

export function hubStatePath(slugOrCode: string): string {
  const s =
    HUB_STATES.find((x) => x.slug === slugOrCode) ??
    HUB_STATES.find((x) => x.code === String(slugOrCode).toUpperCase());
  return `${OSOW_HUB_PATH}/${s ? s.slug : String(slugOrCode).toLowerCase()}`;
}

export function hubStateBySlug(slug: string): HubState | null {
  const want = String(slug ?? '').trim().toLowerCase();
  return HUB_STATES.find((s) => s.slug === want) ?? null;
}

export function rulesForSlug(slug: string): JurisdictionOsowRules | null {
  const s = hubStateBySlug(slug);
  return s === null ? null : osowRulesFor(s.code);
}

// ── Provenance ─────────────────────────────────────────────────────────────

export interface Provenance {
  /** Distinct `SourceDoc`s behind whatever was walked. */
  sources: SourceDoc[];
  count: number;
  /** Oldest `revisedOn` among them; null when none states a date. */
  oldestRevision: IsoDate | null;
  /** Newest `revisedOn`; null when none states a date. */
  newestRevision: IsoDate | null;
  /**
   * `max(retrievedOn)`. THE ONLY legitimate input to a page's `dateModified` —
   * see the module header.
   */
  lastRetrieved: IsoDate | null;
}

function looksLikeSourceDoc(v: unknown): v is SourceDoc {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.url === 'string' &&
    typeof o.title === 'string' &&
    typeof o.publisher === 'string' &&
    typeof o.retrievedOn === 'string'
  );
}

/**
 * Every distinct `SourceDoc` reachable from a value, by structural walk.
 *
 * A hand-written field list was the alternative and it would rot: the
 * jurisdiction model has grown optional fields in six of the eight phases, and
 * a provenance band that silently under-counts is worse than no band at all —
 * it is a freshness claim computed from a subset. The walk finds a `SourceDoc`
 * wherever it sits, including inside an `EscortRule`, so adding a field to
 * `types.ts` cannot make this count wrong.
 */
export function collectSources(
  value: unknown,
  into: Map<string, SourceDoc> = new Map(),
): Map<string, SourceDoc> {
  if (value === null || typeof value !== 'object') return into;
  if (looksLikeSourceDoc(value)) {
    if (!into.has(value.id)) into.set(value.id, value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, into);
    return into;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectSources(item, into);
  }
  return into;
}

export function provenanceFor(...values: unknown[]): Provenance {
  const map = new Map<string, SourceDoc>();
  for (const v of values) collectSources(v, map);
  const sources = [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  const revisions = sources
    .map((s) => s.revisedOn)
    .filter((d): d is IsoDate => typeof d === 'string' && d.length > 0)
    .sort();
  const retrieved = sources
    .map((s) => s.retrievedOn)
    .filter((d) => typeof d === 'string' && d.length > 0)
    .sort();
  return {
    sources,
    count: sources.length,
    oldestRevision: revisions[0] ?? null,
    newestRevision: revisions[revisions.length - 1] ?? null,
    lastRetrieved: retrieved[retrieved.length - 1] ?? null,
  };
}

/** Corpus-wide provenance — the number the hub quotes about itself. */
export function corpusProvenance(): Provenance {
  return provenanceFor(OSOW_JURISDICTIONS, POLICE_ESCORT_RATES);
}

// ── Cells ──────────────────────────────────────────────────────────────────

/**
 * WHY THERE IS NO VALUE, when there is no value. Three distinct facts that a
 * bare `null` would flatten into one, and they mean opposite things to a
 * dispatcher: `not-published` is a finding, `no-data` is our gap, and
 * `conflict` means two official documents disagree and we refuse to pick.
 */
export type CellAbsence = 'no-data' | 'not-published' | 'conflict';

export interface HubCell {
  /** The rendered value, or null when there is none. */
  text: string | null;
  absence?: CellAbsence;
  /** The document behind the value, when exactly one reading is in effect. */
  source?: SourceDoc;
  /** Both figures, when the sources disagree. */
  conflict?: Array<{ text: string; source: SourceDoc }>;
  /** Free-text qualifier rendered under the value. */
  note?: string;
}

const NOT_PUBLISHED: HubCell = { text: null, absence: 'not-published' };
const NO_DATA: HubCell = { text: null, absence: 'no-data' };

/**
 * A resolved cell from a `Sourced<T>[]`.
 *
 * The absent/empty distinction is the model's, not ours, and it is preserved
 * exactly: `undefined` means the jurisdiction publishes no such limit (a
 * positive finding), an EMPTY array means we hold nothing (our gap), and an
 * in-effect disagreement stays a disagreement.
 */
export function cellFrom<T>(
  field: string,
  rows: ReadonlyArray<Sourced<T>> | undefined,
  asOf: IsoDate,
  format: (v: T) => string,
  equals?: (a: T, b: T) => boolean,
): HubCell {
  if (rows === undefined) return NOT_PUBLISHED;
  if (rows.length === 0) return NO_DATA;
  const r: Resolution<T> = resolveSourced(field, [...rows], asOf, equals);
  if (r.conflict) {
    return {
      text: null,
      absence: 'conflict',
      conflict: r.candidates.map((c) => ({ text: format(c.value), source: c.source })),
    };
  }
  if (r.value === null || r.chosen === null) return NO_DATA;
  return {
    text: format(r.value),
    source: r.chosen.source,
    ...(r.chosen.note ? { note: r.chosen.note } : {}),
  };
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function fmtInches(totalInches: number): string {
  return formatFtIn(totalInches);
}

export function fmtLbs(lbs: number): string {
  return `${lbs.toLocaleString('en-US')} lb`;
}

export function fmtUsd(usd: number): string {
  return usd.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: usd % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function fmtThresholdIn(t: Threshold): string {
  return t.inclusive ? `${formatFtIn(t.value)} or more` : `over ${formatFtIn(t.value)}`;
}

export function fmtThresholdLbs(t: Threshold): string {
  return t.inclusive ? `${fmtLbs(t.value)} or more` : `over ${fmtLbs(t.value)}`;
}

// ── Topic table 1: legal limits ────────────────────────────────────────────

export interface LegalLimitRow {
  state: HubState;
  width: HubCell;
  height: HubCell;
  trailerLength: HubCell;
  overallLength: HubCell;
  kingpin: HubCell;
  frontOverhang: HubCell;
  rearOverhang: HubCell;
  gross: HubCell;
  singleAxle: HubCell;
  tandemAxle: HubCell;
}

export type LegalLimitColumn = Exclude<keyof LegalLimitRow, 'state'>;

export const LEGAL_LIMIT_COLUMNS: ReadonlyArray<{
  key: LegalLimitColumn;
  label: string;
  what: string;
}> = [
  { key: 'width', label: 'Width', what: 'Widest the load may be with no permit.' },
  { key: 'height', label: 'Height', what: 'Tallest the load may be with no permit.' },
  { key: 'trailerLength', label: 'Semitrailer', what: 'Semitrailer length in a tractor-semitrailer.' },
  { key: 'overallLength', label: 'Overall', what: 'The whole combination, where the state caps it.' },
  { key: 'kingpin', label: 'KPRA', what: 'Kingpin to the rearmost axle, where published.' },
  { key: 'frontOverhang', label: 'Front overhang', what: 'Load ahead of the front bumper.' },
  { key: 'rearOverhang', label: 'Rear overhang', what: 'Load behind the rear bumper.' },
  { key: 'gross', label: 'Gross', what: 'Gross combination weight.' },
  { key: 'singleAxle', label: 'Single axle', what: 'Heaviest single axle.' },
  { key: 'tandemAxle', label: 'Tandem', what: 'Heaviest tandem axle group.' },
];

export function legalLimitRows(asOf: IsoDate): LegalLimitRow[] {
  return HUB_STATES.map((state) => {
    const rules = state.covered ? osowRulesFor(state.code) : null;
    if (rules === null) {
      return {
        state,
        width: NO_DATA,
        height: NO_DATA,
        trailerLength: NO_DATA,
        overallLength: NO_DATA,
        kingpin: NO_DATA,
        frontOverhang: NO_DATA,
        rearOverhang: NO_DATA,
        gross: NO_DATA,
        singleAxle: NO_DATA,
        tandemAxle: NO_DATA,
      };
    }
    const l = rules.legalLimits;
    return {
      state,
      width: cellFrom('legal width', l.widthIn, asOf, fmtInches),
      height: cellFrom('legal height', l.heightIn, asOf, fmtInches),
      trailerLength: cellFrom('legal semitrailer length', l.trailerLengthIn, asOf, fmtInches),
      overallLength: cellFrom('legal overall length', l.overallLengthIn, asOf, fmtInches),
      kingpin: cellFrom('legal kingpin-to-rear-axle', l.kingpinToRearAxleIn, asOf, fmtInches),
      frontOverhang: cellFrom('legal front overhang', l.frontOverhangIn, asOf, fmtInches),
      rearOverhang: cellFrom('legal rear overhang', l.rearOverhangIn, asOf, fmtInches),
      gross: cellFrom('legal gross weight', l.grossWeightLbs, asOf, fmtLbs),
      singleAxle: cellFrom('legal single-axle weight', l.singleAxleLbs, asOf, fmtLbs),
      tandemAxle: cellFrom('legal tandem-axle weight', l.tandemAxleLbs, asOf, fmtLbs),
    };
  });
}

// ── Topic table 2: permit fees ─────────────────────────────────────────────

const OVERWEIGHT_MECHANISM: Record<OverweightPricing['kind'], string> = {
  bands: 'Stepped by weight',
  perMile: 'Per mile',
  includedInBaseFee: 'Included in the base fee',
  notPriceable: 'No published schedule',
};

export interface PermitFeeRow {
  state: HubState;
  base: HubCell;
  oversizeMechanism: HubCell;
  overweightMechanism: HubCell;
  transaction: HubCell;
  routeAnalysis: HubCell;
  /** Whether the state's fee depends on miles travelled inside it. */
  distanceBased: boolean;
}

export function permitFeeRows(asOf: IsoDate): PermitFeeRow[] {
  return HUB_STATES.map((state) => {
    const rules = state.covered ? osowRulesFor(state.code) : null;
    if (rules === null) {
      return {
        state,
        base: NO_DATA,
        oversizeMechanism: NO_DATA,
        overweightMechanism: NO_DATA,
        transaction: NO_DATA,
        routeAnalysis: NO_DATA,
        distanceBased: false,
      };
    }
    const bandCount = rules.oversizeFeeBands?.length ?? 0;
    return {
      state,
      base: cellFrom('single-trip base permit fee', rules.permitBaseFeeUsd, asOf, fmtUsd),
      oversizeMechanism: {
        text:
          bandCount > 0
            ? `${bandCount} dimension band${bandCount === 1 ? '' : 's'} above the base`
            : 'One flat charge, no dimension bands',
      },
      overweightMechanism: cellFrom(
        'overweight pricing mechanism',
        rules.overweightPricing,
        asOf,
        (v) => OVERWEIGHT_MECHANISM[v.kind],
        (a, b) => a.kind === b.kind,
      ),
      transaction: cellFrom(
        'transaction fee',
        rules.transactionFee,
        asOf,
        (v) => {
          const parts: string[] = [];
          if (v.perPermitUsd > 0) parts.push(fmtUsd(v.perPermitUsd));
          if (v.percentOfTotal > 0) parts.push(`${v.percentOfTotal}%`);
          return parts.length === 0 ? 'None published' : parts.join(' + ');
        },
        (a, b) => a.perPermitUsd === b.perPermitUsd && a.percentOfTotal === b.percentOfTotal,
      ),
      routeAnalysis: cellFrom('route analysis fee', rules.routeAnalysisFeeUsd, asOf, fmtUsd),
      distanceBased: rules.feesDependOnDistance,
    };
  });
}

// ── Topic table 3: escort requirements ─────────────────────────────────────

/** A lower bound one condition places on one measurement. */
interface Bound {
  measure: Measure;
  value: number;
  inclusive: boolean;
}

function conditionBounds(c: EscortCondition, out: Bound[] = []): Bound[] {
  switch (c.kind) {
    case 'gt':
      out.push({ measure: c.measure, value: c.value, inclusive: false });
      break;
    case 'gte':
      out.push({ measure: c.measure, value: c.value, inclusive: true });
      break;
    case 'between':
      out.push({ measure: c.measure, value: c.min, inclusive: c.minInclusive !== false });
      break;
    case 'all':
    case 'any':
    case 'atLeast':
      for (const sub of c.of) conditionBounds(sub, out);
      break;
    case 'not':
      conditionBounds(c.of, out);
      break;
    default:
      break;
  }
  return out;
}

function mentionsRouteClass(c: EscortCondition): boolean {
  switch (c.kind) {
    case 'routeClass':
      return true;
    case 'all':
    case 'any':
    case 'atLeast':
      return c.of.some((sub) => mentionsRouteClass(sub));
    case 'not':
      return mentionsRouteClass(c.of);
    default:
      return false;
  }
}

function requiresCivilianEscort(t: EscortOutcome): boolean {
  return (t.escorts ?? 0) > 0 || (t.front ?? 0) > 0 || (t.rear ?? 0) > 0;
}

function requiresPoliceEscort(t: EscortOutcome): boolean {
  return (t.policeFront ?? 0) > 0 || (t.policeRear ?? 0) > 0;
}

export interface FirstTrigger {
  value: number;
  inclusive: boolean;
  routeDependent: boolean;
  rule: EscortRule;
}

/**
 * THE FIRST DIMENSION AT WHICH AN ESCORT BECOMES REQUIRED — the one number a
 * dispatcher is looking for, as one column.
 *
 * It is the MINIMUM lower bound, across every in-effect rule in the state whose
 * outcome puts a pilot car on the load, of the conditions that rule places on
 * that measurement. `routeDependent` is set when the winning rule is also
 * conditioned on a road class, because the number is then the first trigger on
 * the WORST road and a divided highway may not trigger until higher — a
 * materially different answer that must not be printed as though it were flat.
 */
export function firstEscortTriggers(
  rules: Pick<JurisdictionOsowRules, 'escortRules'>,
  asOf: IsoDate,
  kind: 'civilian' | 'police' = 'civilian',
): Partial<Record<Measure, FirstTrigger>> {
  const want = kind === 'police' ? requiresPoliceEscort : requiresCivilianEscort;
  const out: Partial<Record<Measure, FirstTrigger>> = {};
  for (const rule of rules.escortRules) {
    if (!isInEffect(rule, asOf)) continue;
    if (!want(rule.then)) continue;
    const routeDependent = mentionsRouteClass(rule.when);
    for (const b of conditionBounds(rule.when)) {
      const cur = out[b.measure];
      const better =
        cur === undefined ||
        b.value < cur.value ||
        (b.value === cur.value && b.inclusive && !cur.inclusive);
      if (better) {
        out[b.measure] = { value: b.value, inclusive: b.inclusive, routeDependent, rule };
      }
    }
  }
  return out;
}

export const ESCORT_TRIGGER_MEASURES: ReadonlyArray<{ measure: Measure; label: string }> = [
  { measure: 'widthIn', label: 'Width' },
  { measure: 'heightIn', label: 'Height' },
  { measure: 'overallLengthIn', label: 'Length' },
  { measure: 'rearOverhangIn', label: 'Rear overhang' },
  { measure: 'grossWeightLbs', label: 'Gross weight' },
];

export interface EscortRow {
  state: HubState;
  triggers: Partial<Record<Measure, FirstTrigger>>;
  police: Partial<Record<Measure, FirstTrigger>>;
  ruleCount: number;
}

export function escortRows(asOf: IsoDate): EscortRow[] {
  return HUB_STATES.map((state) => {
    const rules = state.covered ? osowRulesFor(state.code) : null;
    if (rules === null) return { state, triggers: {}, police: {}, ruleCount: 0 };
    return {
      state,
      triggers: firstEscortTriggers(rules, asOf, 'civilian'),
      police: firstEscortTriggers(rules, asOf, 'police'),
      ruleCount: rules.escortRules.filter((r) => isInEffect(r, asOf)).length,
    };
  });
}

export function formatTrigger(t: FirstTrigger, measure: Measure): string {
  const v = measure === 'grossWeightLbs' ? fmtLbs(t.value) : fmtInches(t.value);
  return t.inclusive ? `${v} or more` : `over ${v}`;
}

// ── Topic table 4: superloads ──────────────────────────────────────────────

const thresholdsMatch = (a: Threshold, b: Threshold): boolean =>
  a.value === b.value && a.inclusive === b.inclusive;

export interface SuperloadRow {
  state: HubState;
  gross: HubCell;
  width: HubCell;
  height: HubCell;
  length: HubCell;
  shortSpacing: HubCell;
}

export function superloadRows(asOf: IsoDate): SuperloadRow[] {
  return HUB_STATES.map((state) => {
    const rules = state.covered ? osowRulesFor(state.code) : null;
    if (rules === null) {
      return {
        state,
        gross: NO_DATA,
        width: NO_DATA,
        height: NO_DATA,
        length: NO_DATA,
        shortSpacing: NO_DATA,
      };
    }
    const s = rules.superload;
    return {
      state,
      gross: cellFrom(
        'superload gross-weight threshold',
        s.grossWeight,
        asOf,
        fmtThresholdLbs,
        thresholdsMatch,
      ),
      width: cellFrom('superload width threshold', s.widthIn, asOf, fmtThresholdIn, thresholdsMatch),
      height: cellFrom('superload height threshold', s.heightIn, asOf, fmtThresholdIn, thresholdsMatch),
      length: cellFrom(
        'superload length threshold',
        s.overallLengthIn,
        asOf,
        fmtThresholdIn,
        thresholdsMatch,
      ),
      shortSpacing: cellFrom(
        'superload short-axle-spacing trigger',
        s.shortSpacing,
        asOf,
        (v) =>
          `${fmtLbs(v.minLbs)}–${fmtLbs(v.maxLbs)} on under ${v.minAxleSpacingFt} ft of axle spacing`,
        (a, b) =>
          a.minLbs === b.minLbs &&
          a.maxLbs === b.maxLbs &&
          a.minAxleSpacingFt === b.minAxleSpacingFt,
      ),
    };
  });
}

// ── Police escorts ─────────────────────────────────────────────────────────

export interface PoliceRow {
  state: HubState;
  rate: Sourced<PoliceEscortRate> | null;
  floorOneOfficerUsd: number | null;
  finding: NoPublishedPoliceRate | null;
}

export function policeRows(asOf: IsoDate): PoliceRow[] {
  return HUB_COVERED_STATES.map((state) => {
    const rate =
      POLICE_ESCORT_RATES.find(
        (r) => r.value.jurisdiction === state.code && isInEffect(r, asOf),
      ) ?? null;
    return {
      state,
      rate,
      floorOneOfficerUsd: rate === null ? null : policeEscortFloorUsd(rate.value, 1),
      finding: NO_PUBLISHED_POLICE_ESCORT_RATE.find((f) => f.jurisdiction === state.code) ?? null,
    };
  });
}

// ── Source notes: where two official documents disagree ────────────────────

export interface ConflictEntry {
  state: HubState;
  field: string;
  /** Each in-effect candidate, formatted, with its own document. */
  candidates: Array<{ text: string; source: SourceDoc; note?: string }>;
}

interface ConflictProbe {
  field: string;
  rows: ReadonlyArray<Sourced<unknown>> | undefined;
  format: (v: unknown) => string;
  equals?: (a: unknown, b: unknown) => boolean;
}

/** Every `Sourced<T>[]` on a jurisdiction that the hub resolves. */
function conflictProbes(rules: JurisdictionOsowRules): ConflictProbe[] {
  const l = rules.legalLimits;
  const inches = (v: unknown) => fmtInches(v as number);
  const lbs = (v: unknown) => fmtLbs(v as number);
  const usd = (v: unknown) => fmtUsd(v as number);
  const thrIn = (v: unknown) => fmtThresholdIn(v as Threshold);
  const thrLbs = (v: unknown) => fmtThresholdLbs(v as Threshold);
  const thrEq = (a: unknown, b: unknown) => thresholdsMatch(a as Threshold, b as Threshold);
  return [
    { field: 'legal width', rows: l.widthIn, format: inches },
    { field: 'legal height', rows: l.heightIn, format: inches },
    { field: 'legal semitrailer length', rows: l.trailerLengthIn, format: inches },
    { field: 'legal overall length', rows: l.overallLengthIn, format: inches },
    { field: 'legal kingpin-to-rear-axle distance', rows: l.kingpinToRearAxleIn, format: inches },
    { field: 'legal front overhang', rows: l.frontOverhangIn, format: inches },
    { field: 'legal rear overhang', rows: l.rearOverhangIn, format: inches },
    { field: 'legal gross weight', rows: l.grossWeightLbs, format: lbs },
    { field: 'legal single-axle weight', rows: l.singleAxleLbs, format: lbs },
    { field: 'legal tandem-axle weight', rows: l.tandemAxleLbs, format: lbs },
    { field: 'single-trip base permit fee', rows: rules.permitBaseFeeUsd, format: usd },
    { field: 'route analysis fee', rows: rules.routeAnalysisFeeUsd, format: usd },
    { field: 'no-bridge route fee', rows: rules.noBridgeRouteFeeUsd, format: usd },
    {
      field: 'superload gross-weight threshold',
      rows: rules.superload.grossWeight,
      format: thrLbs,
      equals: thrEq,
    },
    {
      field: 'superload width threshold',
      rows: rules.superload.widthIn,
      format: thrIn,
      equals: thrEq,
    },
    {
      field: 'superload height threshold',
      rows: rules.superload.heightIn,
      format: thrIn,
      equals: thrEq,
    },
    {
      field: 'superload length threshold',
      rows: rules.superload.overallLengthIn,
      format: thrIn,
      equals: thrEq,
    },
    /**
     * PHASE 9's two new `Sourced<T>[]` fields, probed here for the same reason
     * every other field is: a conflict the engine surfaces on a quote must also
     * be visible on the reference page, or the page quietly under-reports the
     * state's own disagreements. Michigan is the live case — its statute and
     * MDOT's T-1 print the same axle table with two different answers.
     */
    {
      field: 'axle-load table by axle spacing',
      rows: rules.axleSpacingWeightTables,
      format: (v: unknown) => {
        const t = v as AxleSpacingWeightTable;
        const rows = t.rows
          .map((r) => `${r.label} → ${fmtLbs(r.maxAxleLoadLbs)}`)
          .join('; ');
        const tandem =
          t.tandemAllowance === null
            ? ''
            : ` — one tandem assembly at ${fmtLbs(t.tandemAllowance.perAxleLbs)} per axle${
                t.tandemAllowance.routeClasses === null
                  ? ', with NO route condition stated'
                  : ` only on ${t.tandemAllowance.routeClasses.join(', ')} highways`
              }`;
        return `${t.name}: ${rows}${tandem}`;
      },
      equals: (a: unknown, b: unknown) =>
        axleSpacingWeightTablesEqual(a as AxleSpacingWeightTable, b as AxleSpacingWeightTable),
    },
    {
      field: "the state's own bridge table",
      rows: rules.stateBridgeTable,
      format: (v: unknown) => {
        const t = v as StateBridgeTable;
        return `${t.name}: single axle ${t.singleAxleLbs === null ? 'not stated' : fmtLbs(t.singleAxleLbs)}, tandem ${t.tandemAxleLbs === null ? 'not stated' : fmtLbs(t.tandemAxleLbs)}, gross ${t.grossLbs === null ? 'not stated' : fmtLbs(t.grossLbs)}`;
      },
      equals: (a: unknown, b: unknown) =>
        stateBridgeTablesEqual(a as StateBridgeTable, b as StateBridgeTable),
    },
    {
      field: 'route-inspection width trigger',
      rows: rules.routeInspection.widthIn,
      format: thrIn,
      equals: thrEq,
    },
    {
      field: 'route-inspection height trigger',
      rows: rules.routeInspection.heightIn,
      format: thrIn,
      equals: thrEq,
    },
    {
      field: 'route-inspection length trigger',
      rows: rules.routeInspection.lengthIn,
      format: thrIn,
      equals: thrEq,
    },
  ];
}

/**
 * The conflicts, COMPUTED. `resolveSourced` already returns `conflict: true`
 * with both candidates cited; this walks the fields the hub renders and keeps
 * every one that comes back conflicted. Nothing is written by hand, so the page
 * stays current for free and grows as jurisdictions are added.
 */
export function conflictEntriesFor(state: HubState, asOf: IsoDate): ConflictEntry[] {
  const rules = osowRulesFor(state.code);
  if (rules === null) return [];
  const out: ConflictEntry[] = [];
  for (const probe of conflictProbes(rules)) {
    if (probe.rows === undefined || probe.rows.length < 2) continue;
    const r = resolveSourced(probe.field, [...probe.rows], asOf, probe.equals);
    if (!r.conflict) continue;
    out.push({
      state,
      field: probe.field,
      candidates: r.candidates.map((c) => ({
        text: probe.format(c.value),
        source: c.source,
        ...(c.note ? { note: c.note } : {}),
      })),
    });
  }
  return out;
}

export function allConflictEntries(asOf: IsoDate): ConflictEntry[] {
  return HUB_COVERED_STATES.flatMap((s) => conflictEntriesFor(s, asOf));
}

// ── Source notes: the named gaps ───────────────────────────────────────────

export interface NamedGap {
  code: string;
  stateName: string;
  slug: string;
  title: string;
  detail: string;
  /** The constant in the repo that holds this finding — greppable, not prose. */
  constantName: string;
}

/**
 * The gaps that are NOT disagreements about a value but holes where nothing at
 * all is priced. They are named constants in the jurisdiction files rather than
 * free text, so this list is a read of the code and cannot drift from what the
 * engine actually does.
 */
export function namedGaps(): NamedGap[] {
  const at = (code: string) => {
    const s = HUB_STATES.find((x) => x.code === code);
    return { stateName: s?.name ?? code, slug: s?.slug ?? code.toLowerCase() };
  };
  return [
    {
      code: 'AR',
      ...at('AR'),
      constantName: 'ARKANSAS_251_MILE_GAP',
      title: `A move of exactly ${ARKANSAS_251_MILE_GAP.unpricedMiles} miles is priced by nothing`,
      detail: ARKANSAS_251_MILE_GAP.detail,
    },
    {
      code: 'WA',
      ...at('WA'),
      constantName: 'WASHINGTON_999_POUND_GAP',
      title: 'A 999-pound band where neither document sets a fee',
      detail: `The statute prices "${WASHINGTON_999_POUND_GAP.statuteText}" while WSDOT's own schedule bands the same step as "${WASHINGTON_999_POUND_GAP.wsdotText}". Between ${fmtLbs(WASHINGTON_999_POUND_GAP.minGrossLbs)} and ${fmtLbs(WASHINGTON_999_POUND_GAP.maxGrossLbs)} the two documents do not cover the same ground, so no fee is quoted. Reading the statute's figure into the schedule's gap would resolve, in favour of one document, a defect that consists precisely of the two not ending the band in the same place.`,
    },
    {
      code: 'TN',
      ...at('TN'),
      constantName: 'TENNESSEE_WIDTH_BAND_GAP',
      title: 'A width band that opens one inch apart in two documents',
      detail: TENNESSEE_WIDTH_BAND_GAP.detail,
    },
    {
      code: 'TN',
      ...at('TN'),
      constantName: 'TENNESSEE_ESCORT_BOUNDARY_GAPS',
      title: `${TENNESSEE_ESCORT_BOUNDARY_GAPS.length} escort boundaries that decide a requirement, not a price`,
      detail: TENNESSEE_ESCORT_BOUNDARY_GAPS.map(
        (g) =>
          `Between ${fmtInches(g.fromIn)} and ${fmtInches(g.toIn)}: the rule reads "${g.ruleText}" while the agency FAQ reads "${g.faqText}"${
            g.namedByResearch ? '' : ' (our own observation, following identically from the two texts)'
          }.`,
      ).join(' '),
    },
    {
      code: 'TN',
      ...at('TN'),
      constantName: 'TENNESSEE_HOUSEBOAT_CONFLICT_ANALYSIS',
      title: 'A houseboat priced eight times apart by two official schedules',
      detail: TENNESSEE_HOUSEBOAT_CONFLICT_ANALYSIS,
    },
    {
      code: 'MI',
      ...at('MI'),
      constantName: 'MICHIGAN_164000_RECONSTRUCTION',
      title: 'The 164,000 lb figure is published without the configuration that reaches it',
      detail: MICHIGAN_164000_RECONSTRUCTION,
    },
    {
      code: 'MI',
      ...at('MI'),
      constantName: 'MICHIGAN_NAME_LETTER_PRORATION',
      title: "An annual permit fee keyed to the first letter of the applicant's name",
      detail: MICHIGAN_NAME_LETTER_PRORATION,
    },
    {
      code: 'MI',
      ...at('MI'),
      constantName: 'MICHIGAN_SUPERSEDED_EDITIONS',
      title: 'michigan.gov serves superseded editions of MDOT’s own operational documents',
      detail: `Two official MDOT hosts serve different editions of the same two documents, and only one host is current. ${MICHIGAN_SUPERSEDED_EDITIONS.map(
        (e) => `${e.source.title} at ${e.source.url} is superseded by ${e.supersededBy}.`,
      ).join(' ')} These are different editions rather than reflows — the michigan.gov T-2 runs to eight pages against the permit host’s five. Every Michigan value on this site is taken from the permit host’s current copies, and no value is taken from the superseded ones, because their contents were not transcribed and writing down what they probably said would manufacture history.`,
    },
    {
      code: 'MS',
      ...at('MS'),
      constantName: 'MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT',
      title: 'An overweight rate printed in the wrong unit, 200 times apart',
      detail: MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT.detail,
    },
    {
      code: 'MS',
      ...at('MS'),
      constantName: 'MISSISSIPPI_SPECIAL_HEAVY_HAUL_TABLE_CONFLICT',
      title: 'A heavy-haul axle table rewritten wholesale between two live documents',
      detail: MISSISSIPPI_SPECIAL_HEAVY_HAUL_TABLE_CONFLICT.detail,
    },
    {
      code: 'MS',
      ...at('MS'),
      constantName: 'MISSISSIPPI_BLANKET_ENVELOPE_CONFLICT',
      title: 'An annual blanket envelope that gains a height limit in one document',
      detail: MISSISSIPPI_BLANKET_ENVELOPE_CONFLICT.detail,
    },
    {
      code: 'MS',
      ...at('MS'),
      constantName: 'MISSISSIPPI_POLE_BLANKET_CONFLICT',
      title: 'The same $200 permit lasts a year in one document and a month in the other',
      detail: MISSISSIPPI_POLE_BLANKET_CONFLICT.detail,
    },
    {
      code: 'SC',
      ...at('SC'),
      constantName: 'SOUTH_CAROLINA_SUPERLOAD_IMPACT_FEE_CONFLICT',
      title: 'A superload impact fee that states a rate and no basis',
      detail: SOUTH_CAROLINA_SUPERLOAD_IMPACT_FEE_CONFLICT.detail,
    },
    {
      code: 'SC',
      ...at('SC'),
      constantName: 'SOUTH_CAROLINA_EXCESSIVE_WIDTH_STEPS',
      title: 'Four width fee steps, and no published order of operations',
      detail: `§ 57-3-130(A) prints ${SOUTH_CAROLINA_EXCESSIVE_WIDTH_STEPS.map(
        (b) => `${fmtUsd(b.feeUsd)} over ${b.overWidthFt} ft`,
      ).join(', ')} as separate line items in the same table as the ${fmtUsd(
        30,
      )} single-trip permit, and neither the statute nor SCDOT’s Guidelines says whether a step REPLACES that fee or is ADDED to it — ${fmtUsd(
        35,
      )} or ${fmtUsd(
        65,
      )} on a 17-ft-wide load. Every band they could occupy also starts above South Carolina’s own 16 ft permit ceiling, where a load is no longer issued over the counter but goes through the Resident Maintenance Engineer as a frame building, capped at thirty miles with four escorts and per-county sign-off. Neither reading has been adopted and no width step is priced. ${SOUTH_CAROLINA_SUPERLOAD_ENGINEERING_FEE_NOTE}`,
    },
    {
      code: 'SC',
      ...at('SC'),
      constantName: 'SOUTH_CAROLINA_SUPERSEDED_GUIDELINES',
      title: 'A superseded copy of the Guidelines is still served by scdot.org',
      detail: SOUTH_CAROLINA_SUPERSEDED_GUIDELINES.detail,
    },
  ];
}

// ── Source notes: two fee schedules that price the same band differently ───

export interface BandConflict {
  state: HubState;
  /** The band's own label, as the schedule prints it. */
  label: string;
  candidates: Array<{ text: string; source: SourceDoc; label: string; note?: string }>;
}

/**
 * Bands whose BOUNDS are identical and whose FEES are not.
 *
 * These do not surface through `conflictEntriesFor`, and the reason is worth
 * writing down: `oversizeFeeBands` is a list of DIFFERENT bands, so resolving
 * the whole list would report every band as disagreeing with every other one.
 * The engine only sees the conflict once a load has selected a band. Grouping
 * by the bounds signature reproduces that selection without a load, which is
 * what makes Louisiana's $8-versus-$10 and Pennsylvania's $35-versus-$46
 * renderable on a reference page rather than only inside a quote.
 */
export function bandConflictsFor(state: HubState, asOf: IsoDate): BandConflict[] {
  const rules = osowRulesFor(state.code);
  if (rules === null || rules.oversizeFeeBands === undefined) return [];
  const thr = (t?: Threshold) => (t === undefined ? '-' : `${t.value}${t.inclusive ? 'i' : 'e'}`);
  const groups = new Map<string, Array<Sourced<{ label: string; feeUsd: number }>>>();
  for (const row of rules.oversizeFeeBands) {
    if (!isInEffect(row, asOf)) continue;
    const b = row.value;
    const key = [
      thr(b.overWidthIn),
      thr(b.overHeightIn),
      thr(b.overLengthIn),
      thr(b.upToWidthIn),
      thr(b.upToHeightIn),
      thr(b.upToLengthIn),
      String(b.minMiles ?? '-'),
      String(b.maxMiles ?? '-'),
    ].join('|');
    const list = groups.get(key) ?? [];
    list.push(row as unknown as Sourced<{ label: string; feeUsd: number }>);
    groups.set(key, list);
  }
  const out: BandConflict[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const fees = new Set(rows.map((r) => r.value.feeUsd));
    if (fees.size < 2) continue;
    out.push({
      state,
      label: rows[0]!.value.label,
      candidates: rows.map((r) => ({
        text: fmtUsd(r.value.feeUsd),
        label: r.value.label,
        source: r.source,
        ...(r.note ? { note: r.note } : {}),
      })),
    });
  }
  return out;
}

export function allBandConflicts(asOf: IsoDate): BandConflict[] {
  return HUB_COVERED_STATES.flatMap((s) => bandConflictsFor(s, asOf));
}
