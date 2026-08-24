/**
 * Shared read queries for the public carrier directory.
 *
 * ONE source of truth for the directory's DB access, used by BOTH the JSON API
 * (src/server/routes/directory.ts) and the server-rendered public pages
 * (src/server/directory/pages.ts). Keeping the summary + list logic here avoids
 * the two surfaces drifting out of sync.
 *
 * Read-only + platform-level (no tenant scope). All bounds (page size, code
 * lengths) are clamped here so callers can pass raw query values safely.
 */
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  carrierDirectory,
  carrierOverrides,
  type CarrierCapabilities,
  type CarrierOperatingLocation,
  type CarrierOverrideRow,
} from '../../db/schema.js';
import { CONTAINER_PORTS, PORT_GROUPS, portFilterCodes, portGroupForMemberCode } from './containerPorts.js';

export type { CarrierCapabilities, CarrierOperatingLocation } from '../../db/schema.js';

/**
 * Where a displayed card field came from. `'fmcsa'` = straight from the FMCSA
 * public record; `'admin'` = replaced by an admin edit in `carrier_overrides`;
 * `'carrier'` = reserved for the LATER carrier-self-edit phase (not written yet).
 */
export type FieldSource = 'fmcsa' | 'admin' | 'carrier';

/** Per-field provenance for a merged carrier card — lets the profile tell an
 *  FMCSA-sourced value from an admin/carrier-edited one. */
export interface CarrierProvenance {
  about: FieldSource;
  email: FieldSource;
  phone: FieldSource;
  hidden: FieldSource;
  capabilities: FieldSource;
}

const FMCSA_PROVENANCE: CarrierProvenance = {
  about: 'fmcsa',
  email: 'fmcsa',
  phone: 'fmcsa',
  hidden: 'fmcsa',
  capabilities: 'fmcsa',
};

export const DEFAULT_PER_PAGE = 24;
export const MAX_PER_PAGE = 50;

/** One carrier row shaped for public consumption (drops internal ids). */
export interface VisibleCarrier {
  slug: string;
  legalName: string;
  dbaName: string | null;
  usdot: string;
  mcNumber: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  /** Carrier opt-out: when true the profile hides BOTH phone and email. */
  contactHidden: boolean;
  powerUnits: number | null;
  drivers: number | null;
  safetyRating: string | null;
  authorityType: string | null;
  intermodal: boolean;
  /** FMCSA-verified hazmat carrier (census hm_ind === 'Y'). */
  hazmat: boolean;
  /** FMCSA equipment / cargo-type flags (crgo_* census columns). All default
   *  false until a re-ingest backfills them. */
  dryVan: boolean;
  reefer: boolean;
  tanker: boolean;
  flatbed: boolean;
  dryBulk: boolean;
  /** FMCSA cargo-CLASS specialties (crgo_* census columns). All default false
   *  until a re-ingest backfills them. */
  householdGoods: boolean;
  beverages: boolean;
  produce: boolean;
  motorVehicles: boolean;
  livestock: boolean;
  grainFeed: boolean;
  oilfield: boolean;
  meat: boolean;
  paper: boolean;
  construction: boolean;
  farmSupplies: boolean;
  coalCoke: boolean;
  buildingMaterials: boolean;
  nearestPortCode: string | null;
  /**
   * FMCSA record freshness — the directory row's `updated_at` (set on ingest /
   * re-ingest). Optional so the many hand-built `VisibleCarrier` fixtures stay
   * valid; the profile renders a "FMCSA data as of …" line only when present.
   */
  updatedAt?: Date | null;
  /**
   * Admin/carrier "About" override, applied ONLY on the profile (carrierBySlug).
   * `null` on list/card rows and whenever no override exists → the profile falls
   * back to the FMCSA-derived prose (carrierAbout).
   */
  aboutOverride: string | null;
  /**
   * Self-declared credential flags from `carrier_overrides.capabilities`. Empty
   * `{}` on list/card rows and when no override exists. A `true` flag flips the
   * matching profile credential badge to ACTIVE (still labeled "self-declared").
   */
  capabilities: CarrierCapabilities;
  /**
   * Carrier-DECLARED other operating cities/terminals from
   * `carrier_overrides.operating_locations`, applied ONLY on the profile
   * (carrierBySlug). Optional/`[]` on list/card rows and when no override
   * exists → the profile omits the "Also operating in" block. Never fabricated:
   * FMCSA gives one HQ; these are metros a claimed carrier declared it serves.
   */
  operatingLocations?: CarrierOperatingLocation[];
  /** Per-field source (FMCSA vs admin/carrier-edited). All `'fmcsa'` on list/card. */
  provenance: CarrierProvenance;
}

/** Shape one carrier row for the public list/profile (drops internal ids). */
export function visibleCarrier(r: typeof carrierDirectory.$inferSelect): VisibleCarrier {
  return {
    slug: r.publicSlug,
    legalName: r.legalName,
    dbaName: r.dbaName,
    usdot: r.usdot,
    mcNumber: r.mcNumber,
    city: r.city,
    state: r.state,
    zip: r.zip,
    phone: r.phone,
    email: r.email,
    contactHidden: r.contactHidden,
    powerUnits: r.powerUnits,
    drivers: r.drivers,
    safetyRating: r.safetyRating,
    authorityType: r.authorityType,
    intermodal: r.intermodal,
    hazmat: r.hazmat,
    dryVan: r.dryVan,
    reefer: r.reefer,
    tanker: r.tanker,
    flatbed: r.flatbed,
    dryBulk: r.dryBulk,
    householdGoods: r.householdGoods,
    beverages: r.beverages,
    produce: r.produce,
    motorVehicles: r.motorVehicles,
    livestock: r.livestock,
    grainFeed: r.grainFeed,
    oilfield: r.oilfield,
    meat: r.meat,
    paper: r.paper,
    construction: r.construction,
    farmSupplies: r.farmSupplies,
    coalCoke: r.coalCoke,
    buildingMaterials: r.buildingMaterials,
    nearestPortCode: r.nearestPortCode,
    updatedAt: r.updatedAt,
    // FMCSA-only base shape: no override applied. The profile read
    // (carrierBySlug) merges carrier_overrides on top via mergeCarrierOverride;
    // list/card rows keep these FMCSA defaults so those surfaces are unchanged.
    aboutOverride: null,
    capabilities: {},
    operatingLocations: [],
    provenance: FMCSA_PROVENANCE,
  };
}

/**
 * Apply a `carrier_overrides` row onto an FMCSA base card (PURE — unit-tested).
 *
 * Non-null overrides win over the FMCSA value and stamp that field's provenance;
 * a null/empty override leaves the FMCSA value + `'fmcsa'` provenance untouched.
 * `hidden` is OR'd with the FMCSA contact opt-out (an admin can hide, but can't
 * un-hide a carrier who opted out). Because overrides live in a separate table
 * the FMCSA re-ingest never touches, this merge is the ONLY place edits re-enter
 * the card — so edits survive every re-ingest by construction.
 */
export function mergeCarrierOverride(
  base: VisibleCarrier,
  ov: CarrierOverrideRow | null | undefined,
): VisibleCarrier {
  if (!ov) return base;
  // Foundation attributes every override write to 'admin' (the only write path
  // in this phase). The carrier-self-edit phase will distinguish 'carrier'.
  const src: FieldSource = 'admin';
  const provenance: CarrierProvenance = { ...FMCSA_PROVENANCE };
  const out: VisibleCarrier = { ...base, provenance };
  if (ov.aboutOverride != null && ov.aboutOverride.trim() !== '') {
    out.aboutOverride = ov.aboutOverride;
    provenance.about = src;
  }
  if (ov.emailOverride != null && ov.emailOverride.trim() !== '') {
    out.email = ov.emailOverride;
    provenance.email = src;
  }
  if (ov.phoneOverride != null && ov.phoneOverride.trim() !== '') {
    out.phone = ov.phoneOverride;
    provenance.phone = src;
  }
  if (ov.hidden === true) {
    out.contactHidden = true;
    provenance.hidden = src;
  }
  if (ov.capabilities && typeof ov.capabilities === 'object') {
    out.capabilities = { ...ov.capabilities };
    if (Object.values(ov.capabilities).some(Boolean)) provenance.capabilities = src;
  }
  // Carrier-declared other operating cities. Defensive-normalize (trim, upper-
  // case state) and drop malformed entries so a bad row can never render a
  // broken chip. Empty/absent → leave the base's [] (block omitted on render).
  if (Array.isArray(ov.operatingLocations)) {
    const cleaned = ov.operatingLocations
      .filter(
        (l): l is CarrierOperatingLocation =>
          !!l && typeof l.city === 'string' && typeof l.state === 'string' && l.city.trim() !== '' && l.state.trim() !== '',
      )
      .map((l) => ({ city: l.city.trim(), state: l.state.trim().toUpperCase() }));
    if (cleaned.length) out.operatingLocations = cleaned;
  }
  return out;
}

export interface DirectorySummary {
  total: number;
  intermodalTotal: number;
  states: number;
  byState: { state: string; count: number }[];
  byPort: { code: string; name: string; city: string; state: string; count: number }[];
}

/**
 * Empty-but-valid summary — every port listed with a 0 count, no states.
 *
 * Returned when the underlying `carrier_directory` read fails (e.g. the table
 * is missing on a prod DB that never received migration 0041). The public
 * /directory + /compliance pages MUST render a clean empty state, never 500, so
 * the query layer degrades to this instead of throwing. Boot self-heal
 * (ensureSelfHealTables) normally guarantees the table exists, so this is a
 * belt-and-suspenders fallback for any residual read failure.
 */
function emptyDirectorySummary(): DirectorySummary {
  return {
    total: 0,
    intermodalTotal: 0,
    states: 0,
    byState: [],
    byPort: (() => {
      const seen = new Map<string, { code: string; name: string; city: string; state: string; count: number }>();
      for (const p of CONTAINER_PORTS) {
        const g = portGroupForMemberCode(p.code);
        const code = g?.code ?? p.code;
        if (!seen.has(code)) {
          seen.set(code, { code, name: g?.label ?? p.name, city: g?.city ?? p.city, state: g?.state ?? p.state, count: 0 });
        }
      }
      return [...seen.values()];
    })(),
  };
}

/**
 * TTL for the cached global directory aggregates (summary + facet counts).
 * These values are IDENTICAL for every visitor and only change on the weekly
 * FMCSA ingest, so a short cache eliminates the per-request full-table scans
 * that were saturating the DB connection pool under crawler load.
 */
const DIRECTORY_AGG_TTL_MS = 5 * 60_000;

/** Single-value TTL cache for the arg-less global summary. */
let directorySummaryCache: { at: number; val: DirectorySummary } | null = null;

/** Carrier counts per state + per port (+ intermodal total) for the index/facets. */
export async function getDirectorySummary(): Promise<DirectorySummary> {
  const now = Date.now();
  if (directorySummaryCache && now - directorySummaryCache.at < DIRECTORY_AGG_TTL_MS) {
    return directorySummaryCache.val;
  }
  try {
    const val = await getDirectorySummaryUnsafe();
    // Cache only a successfully computed value; an error must NOT poison the cache.
    directorySummaryCache = { at: Date.now(), val };
    return val;
  } catch (err) {
    // Missing table / read failure ⇒ serve an empty directory, never a 500.
    console.warn('[directory] getDirectorySummary failed; serving empty summary:', err);
    return emptyDirectorySummary();
  }
}

async function getDirectorySummaryUnsafe(): Promise<DirectorySummary> {
  const byStateRows = await db()
    .select({ state: carrierDirectory.state, n: sql<number>`count(*)::int` })
    .from(carrierDirectory)
    .groupBy(carrierDirectory.state);

  const byPortRows = await db()
    .select({ port: carrierDirectory.nearestPortCode, n: sql<number>`count(*)::int` })
    .from(carrierDirectory)
    .groupBy(carrierDirectory.nearestPortCode);

  const intermodalRow = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(carrierDirectory)
    .where(eq(carrierDirectory.intermodal, true));

  const byState = byStateRows
    .filter((r) => r.state)
    .map((r) => ({ state: r.state as string, count: r.n }))
    .sort((a, b) => b.count - a.count);

  const portCountByCode = new Map(byPortRows.filter((r) => r.port).map((r) => [r.port as string, r.n]));
  // Fold the US seaport gateways into their DISPLAY groups (co-located ports like
  // LA + Long Beach collapse to one hub card) and sum member counts.
  const byPortGroup = new Map<string, { code: string; name: string; city: string; state: string; count: number }>();
  for (const p of CONTAINER_PORTS) {
    const g = portGroupForMemberCode(p.code);
    const code = g?.code ?? p.code;
    const entry =
      byPortGroup.get(code) ??
      { code, name: g?.label ?? p.name, city: g?.city ?? p.city, state: g?.state ?? p.state, count: 0 };
    entry.count += portCountByCode.get(p.code) ?? 0;
    byPortGroup.set(code, entry);
  }
  const byPort = [...byPortGroup.values()].sort((a, b) => b.count - a.count);

  const total = byState.reduce((s, r) => s + r.count, 0);

  return {
    total,
    intermodalTotal: intermodalRow[0]?.n ?? 0,
    states: byState.length,
    byState,
    byPort,
  };
}

// ─── Faceted filter model ─────────────────────────────────────────────────
//
// Every facet is a real GET query param (shareable + crawlable). Facets are
// tiered by DATA SOURCE, and the tier drives how honestly we can populate them:
//
//   Tier 1 — 100% FMCSA-native (backed by a real column):
//     state · city · fleet buckets (power_units) · safety (safety_rating) ·
//     active authority (authority_type present).
//   Tier 2 — FMCSA proxy (backed, source-tagged in the UI):
//     intermodal/drayage (crgo_intermodal) · recently updated (updated_at).
//   Tier 3 — self-declared / not in the current FMCSA ingest (NO column):
//     hazmat · reefer · UIIA · TWIC · C-TPAT/bonded · verified. These are
//     rendered DISABLED ("verify via claim") by the page layer and are never
//     applied as filters here — we will not assert data we don't have.

export type FleetBucketId = '1-25' | '26-100' | '101-500' | '500+';
export type DriversBucketId = '1-10' | '11-50' | '51-250' | '250+';
export type SafetyId = 'satisfactory' | 'conditional' | 'unsatisfactory' | 'unrated';
export type SortId = 'featured' | 'safety' | 'fleet' | 'drivers' | 'recent';
/** Sort direction — asc = Low→High (numeric) / best-first (safety) / oldest
 *  (recent); desc = the inverse. Ignored for the `featured` composite sort. */
export type SortDir = 'asc' | 'desc';

/**
 * Equipment / cargo-type filter — a SINGLE `equipment` GET param whose value is
 * one of these ids. Each is backed by a REAL FMCSA-derived boolean column on
 * carrier_directory (verified crgo_* census flags — see carrierIngest.ts), so
 * every option is an honest filter, not a proxy. `drayage` maps to the existing
 * `intermodal` column (kept for backward-compat with the legacy `intermodal=1`
 * param + the profile "Drayage / intermodal" badge).
 */
export type EquipmentId = 'drayage' | 'dryvan' | 'reefer' | 'hazmat' | 'tanker' | 'flatbed' | 'drybulk';

/** The carrier_directory boolean column each equipment id filters on. */
export const EQUIPMENT_OPTIONS: ReadonlyArray<{
  id: EquipmentId;
  label: string;
  column: 'intermodal' | 'hazmat' | 'dryVan' | 'reefer' | 'tanker' | 'flatbed' | 'dryBulk';
}> = [
  { id: 'drayage', label: 'Container / drayage', column: 'intermodal' },
  { id: 'dryvan', label: 'Dry van', column: 'dryVan' },
  { id: 'reefer', label: 'Reefer', column: 'reefer' },
  { id: 'hazmat', label: 'Hazmat', column: 'hazmat' },
  { id: 'tanker', label: 'Tanker / bulk', column: 'tanker' },
  { id: 'flatbed', label: 'Flatbed / oversized', column: 'flatbed' },
  { id: 'drybulk', label: 'Dry bulk', column: 'dryBulk' },
];

/**
 * Cargo-SPECIALTY filter — a SEPARATE `cargo` GET param (parallel to `equipment`,
 * so a shipper can combine a truck/equipment type with a cargo specialty). Each id
 * is backed by a REAL FMCSA-derived boolean column on carrier_directory (verified
 * crgo_* census flags — see carrierIngest.ts / migration 0050), so every option is
 * an honest filter with live counts, not a proxy. Single-select, mirroring the
 * equipment facet. "Household goods" + "Liquor / beverages" moved here from the
 * Tier-3 claim group now that they are real FMCSA columns.
 */
export type CargoId =
  | 'household'
  | 'beverages'
  | 'produce'
  | 'motorvehicles'
  | 'livestock'
  | 'grainfeed'
  | 'oilfield'
  | 'meat'
  | 'paper'
  | 'construction'
  | 'farmsupplies'
  | 'coalcoke'
  | 'buildingmaterials';

/** The carrier_directory boolean column each cargo id filters on. */
export const CARGO_OPTIONS: ReadonlyArray<{
  id: CargoId;
  label: string;
  column:
    | 'householdGoods'
    | 'beverages'
    | 'produce'
    | 'motorVehicles'
    | 'livestock'
    | 'grainFeed'
    | 'oilfield'
    | 'meat'
    | 'paper'
    | 'construction'
    | 'farmSupplies'
    | 'coalCoke'
    | 'buildingMaterials';
}> = [
  { id: 'household', label: 'Household goods', column: 'householdGoods' },
  { id: 'beverages', label: 'Liquor / beverages', column: 'beverages' },
  { id: 'produce', label: 'Fresh produce', column: 'produce' },
  { id: 'motorvehicles', label: 'Motor vehicles', column: 'motorVehicles' },
  { id: 'livestock', label: 'Livestock', column: 'livestock' },
  { id: 'grainfeed', label: 'Grain & feed', column: 'grainFeed' },
  { id: 'oilfield', label: 'Oilfield', column: 'oilfield' },
  { id: 'meat', label: 'Meat / perishable', column: 'meat' },
  { id: 'paper', label: 'Paper products', column: 'paper' },
  { id: 'construction', label: 'Construction', column: 'construction' },
  { id: 'farmsupplies', label: 'Farm supplies', column: 'farmSupplies' },
  { id: 'coalcoke', label: 'Coal / coke', column: 'coalCoke' },
  { id: 'buildingmaterials', label: 'Building materials', column: 'buildingMaterials' },
];

export const FLEET_BUCKETS: ReadonlyArray<{ id: FleetBucketId; label: string; min: number; max: number | null }> = [
  { id: '1-25', label: '1–25 trucks', min: 1, max: 25 },
  { id: '26-100', label: '26–100 trucks', min: 26, max: 100 },
  { id: '101-500', label: '101–500 trucks', min: 101, max: 500 },
  { id: '500+', label: '500+ trucks', min: 501, max: null },
];

/** Drivers-count buckets — FMCSA census `total_drivers` (schema column `drivers`),
 *  the driver-headcount analog of FLEET_BUCKETS' power-unit (truck) buckets. */
export const DRIVERS_BUCKETS: ReadonlyArray<{ id: DriversBucketId; label: string; min: number; max: number | null }> = [
  { id: '1-10', label: '1–10 drivers', min: 1, max: 10 },
  { id: '11-50', label: '11–50 drivers', min: 11, max: 50 },
  { id: '51-250', label: '51–250 drivers', min: 51, max: 250 },
  { id: '250+', label: '250+ drivers', min: 251, max: null },
];

export const SAFETY_OPTIONS: ReadonlyArray<{ id: SafetyId; label: string; letter: string | null }> = [
  { id: 'satisfactory', label: 'Satisfactory', letter: 'S' },
  { id: 'conditional', label: 'Conditional', letter: 'C' },
  { id: 'unsatisfactory', label: 'Unsatisfactory', letter: 'U' },
  { id: 'unrated', label: 'Not rated', letter: null },
];

export const SORT_OPTIONS: ReadonlyArray<{ id: SortId; label: string }> = [
  { id: 'featured', label: 'Featured' },
  { id: 'safety', label: 'Safety rating' },
  { id: 'fleet', label: 'Fleet size' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'recent', label: 'Recently updated' },
];

/**
 * Default sort direction per sort id. Numeric sorts (fleet / drivers) default
 * High→Low (desc), `recent` defaults newest-first (desc), `safety` defaults
 * best-first (asc). `featured` is a fixed composite — direction never applies.
 * The URL only carries `dir` when it DIFFERS from this default, keeping the
 * canonical form stable + shareable.
 */
export const SORT_DIR_DEFAULTS: Readonly<Record<SortId, SortDir>> = {
  featured: 'desc',
  safety: 'asc',
  fleet: 'desc',
  drivers: 'desc',
  recent: 'desc',
};

/** Whether a sort id honors an asc/desc direction toggle (all but `featured`). */
export function sortIsDirectional(sort: SortId): boolean {
  return sort !== 'featured';
}

/** Resolve the effective direction for a sort, falling back to its default. */
export function resolveSortDir(sort: SortId, dir?: SortDir | null): SortDir {
  if (!sortIsDirectional(sort)) return SORT_DIR_DEFAULTS[sort];
  return dir === 'asc' || dir === 'desc' ? dir : SORT_DIR_DEFAULTS[sort];
}

/** MCS-150 "recently updated" proxy window. */
const RECENT_DAYS = 365;

/** Normalized, fully-clamped facet state — safe to hand straight to SQL. */
export interface DirectoryFilters {
  state: string | null;
  port: string | null;
  citySlug: string | null;
  fleet: FleetBucketId | null;
  /** Drivers-count bucket (FMCSA total_drivers). null = any. */
  drivers: DriversBucketId | null;
  /** Safety filter collapsed to ONE toggle: keep only carriers in "good standing"
   *  — i.e. EXCLUDE Conditional + Unsatisfactory, KEEP Satisfactory + Not-rated.
   *  (FMCSA rates only a minority, so the useful filter is dropping the known-bad,
   *  never a satisfactory-only filter that would wrongly hide most carriers.) */
  goodStandingOnly: boolean;
  authorityActive: boolean;
  /** Legacy drayage flag — true when equipment==='drayage' OR the legacy
   *  `intermodal=1` param is set. Kept so existing surfaces (featured sort,
   *  profile badge, `intermodal=1` deep-links) keep working unchanged. */
  intermodal: boolean;
  /** Selected equipment/cargo-type filters (see EQUIPMENT_OPTIONS). MULTI-select:
   *  OR within the facet. Empty array = any. Stable canonical order (matches
   *  EQUIPMENT_OPTIONS order) so the URL is shareable + crawlable. */
  equipment: EquipmentId[];
  /** Selected cargo-specialty filters (see CARGO_OPTIONS). MULTI-select: OR within
   *  the facet. Empty array = any. Stable canonical order (CARGO_OPTIONS order). */
  cargo: CargoId[];
  recent: boolean;
  /** Free-text carrier-name search (ILIKE over legal_name / dba_name). Trimmed
   *  and required ≥2 chars by normalizeFilters; null when absent/too short. ANDed
   *  with every other active facet. Shareable/crawlable via the `q` GET param. */
  q: string | null;
  sort: SortId;
  /** Sort direction (asc/desc). Meaningful only when `sort` is directional. */
  dir: SortDir;
  page: number;
  perPage: number;
}

/** Minimum accepted length for the `q` carrier-name search (after trim). */
export const NAME_SEARCH_MIN = 2;
/** Cap so a pathological `q` can never blow up the ILIKE pattern. */
const NAME_SEARCH_MAX = 100;

/**
 * Normalize a raw `q` value into the trimmed, length-bounded search term (or null
 * when absent / shorter than NAME_SEARCH_MIN). Pure + total. Interior whitespace
 * is collapsed so "  Harbor   Link " → "Harbor Link".
 */
export function normalizeNameQuery(raw: unknown): string | null {
  const term = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (term.length < NAME_SEARCH_MIN) return null;
  return term.slice(0, NAME_SEARCH_MAX);
}

/**
 * WHERE clause for a carrier-name search: case-insensitive substring match over
 * legal_name OR dba_name. LIKE metacharacters (% _ \) in user input are escaped
 * so they match literally (no wildcard injection). Returns null for a too-short
 * term. Exported for query-shape unit tests.
 */
export function nameSearchCondition(rawTerm: string): SQL | null {
  const term = normalizeNameQuery(rawTerm);
  if (!term) return null;
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;
  return or(ilike(carrierDirectory.legalName, pattern), ilike(carrierDirectory.dbaName, pattern)) as SQL;
}

const FLEET_IDS = new Set(FLEET_BUCKETS.map((b) => b.id));
const DRIVERS_IDS = new Set(DRIVERS_BUCKETS.map((b) => b.id));
const SORT_IDS = new Set(SORT_OPTIONS.map((s) => s.id));
const EQUIPMENT_IDS = new Set(EQUIPMENT_OPTIONS.map((e) => e.id));
const EQUIPMENT_COLUMN = new Map(EQUIPMENT_OPTIONS.map((e) => [e.id, e.column] as const));
const CARGO_IDS = new Set(CARGO_OPTIONS.map((c) => c.id));
const CARGO_COLUMN = new Map(CARGO_OPTIONS.map((c) => [c.id, c.column] as const));
const truthy = (v: unknown): boolean => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

/**
 * Parse a loosely-typed multi-select facet value into a clean, de-duplicated,
 * canonically-ordered id list. Accepts a single string, a comma-separated string
 * (`reefer,flatbed`), or a repeated-param array (Express `?equipment=a&equipment=b`).
 * Junk / unknown ids are dropped, dupes collapsed, and the surviving ids are
 * returned in `order` (the option-table order) so the URL is stable + shareable.
 * A single legacy value (`?equipment=reefer`) still parses to `['reefer']`.
 */
function parseMultiFacet<T extends string>(raw: unknown, valid: ReadonlySet<T>, order: ReadonlyArray<T>): T[] {
  const parts: string[] = [];
  const push = (v: unknown) => {
    for (const piece of String(v ?? '').split(',')) {
      const t = piece.trim().toLowerCase();
      if (t) parts.push(t);
    }
  };
  if (Array.isArray(raw)) for (const v of raw) push(v);
  else push(raw);
  const seen = new Set<T>();
  for (const p of parts) if (valid.has(p as T)) seen.add(p as T);
  return order.filter((id) => seen.has(id));
}

/** Turn a raw name/slug into the directory's canonical city slug form. */
export function citySlugify(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Normalize loosely-typed query values (e.g. req.query) into DirectoryFilters.
 * Pure + total: any unknown value collapses to the safe default. `overrides`
 * lets a scoped route lock a dimension (state/port/city) regardless of input.
 */
export function normalizeFilters(
  raw: Record<string, unknown>,
  overrides?: Partial<Pick<DirectoryFilters, 'state' | 'port' | 'citySlug'>>,
): DirectoryFilters {
  const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
  const stateRaw = str(raw.state).toUpperCase();
  const portRaw = str(raw.port).toUpperCase().slice(0, 8);
  const fleetRaw = str(raw.fleet) as FleetBucketId;
  const driversRaw = str(raw.drivers) as DriversBucketId;
  const sortRaw = str(raw.sort).toLowerCase() as SortId;
  const dirRaw = str(raw.dir).toLowerCase();
  const sort: SortId = SORT_IDS.has(sortRaw) ? sortRaw : 'featured';
  const dir: SortDir = resolveSortDir(sort, dirRaw === 'asc' || dirRaw === 'desc' ? (dirRaw as SortDir) : null);
  // Equipment: MULTI-select comma-list (OR within the facet). The legacy
  // `intermodal=1` param maps to an implicit 'drayage' selection so old
  // bookmarks/deep-links keep working. `intermodal` (boolean) stays true whenever
  // the resolved equipment set includes drayage OR the legacy flag was set.
  const legacyIntermodal = truthy(raw.intermodal);
  const equipmentIds = parseMultiFacet<EquipmentId>(raw.equipment, EQUIPMENT_IDS, EQUIPMENT_OPTIONS.map((e) => e.id));
  const equipment: EquipmentId[] =
    legacyIntermodal && !equipmentIds.includes('drayage')
      ? // Fold the legacy flag in at its canonical position (drayage is first).
        (EQUIPMENT_OPTIONS.map((e) => e.id).filter((id) => id === 'drayage' || equipmentIds.includes(id)) as EquipmentId[])
      : equipmentIds;
  // Cargo specialty: a separate MULTI-select comma-list, orthogonal to equipment.
  const cargo: CargoId[] = parseMultiFacet<CargoId>(raw.cargo, CARGO_IDS, CARGO_OPTIONS.map((c) => c.id));
  return {
    state: overrides && 'state' in overrides ? overrides.state ?? null : /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null,
    port: overrides && 'port' in overrides ? overrides.port ?? null : portRaw || null,
    citySlug:
      overrides && 'citySlug' in overrides ? overrides.citySlug ?? null : str(raw.city) ? citySlugify(str(raw.city)) : null,
    fleet: FLEET_IDS.has(fleetRaw) ? fleetRaw : null,
    drivers: DRIVERS_IDS.has(driversRaw) ? driversRaw : null,
    // Single "good standing" toggle (?standing=good). Default OFF.
    goodStandingOnly: truthy(raw.standing) || str(raw.standing).toLowerCase() === 'good',
    authorityActive: String(raw.authority ?? '').toLowerCase() === 'active' || truthy(raw.authority),
    intermodal: equipment.includes('drayage') || legacyIntermodal,
    equipment,
    cargo,
    recent: truthy(raw.recent),
    q: normalizeNameQuery(raw.q),
    sort,
    dir,
    page: Math.max(1, parseInt(str(raw.page), 10) || 1),
    perPage: DEFAULT_PER_PAGE,
  };
}

/** Which facet keys, if present on /directory, switch it from landing → results. */
export const FACET_QUERY_KEYS = [
  'state',
  'port',
  'city',
  'fleet',
  'drivers',
  // 'standing' is the current good-standing toggle; 'safety' stays listed so any
  // legacy ?safety= deep-link still switches /directory into the results view.
  'standing',
  'safety',
  'authority',
  'intermodal',
  'equipment',
  'cargo',
  'recent',
  'q',
  'sort',
  'dir',
  'page',
  'hazmat',
  'reefer',
] as const;

/** SQL predicate matching a URL city slug against the free-text city column. */
function cityCondition(slug: string): SQL {
  return sql`btrim(regexp_replace(lower(${carrierDirectory.city}), '[^a-z0-9]+', '-', 'g'), '-') = ${slug}`;
}

function fleetCondition(id: FleetBucketId): SQL | null {
  const b = FLEET_BUCKETS.find((x) => x.id === id);
  if (!b) return null;
  return b.max == null
    ? gt(carrierDirectory.powerUnits, b.min - 1)
    : (and(gte(carrierDirectory.powerUnits, b.min), sql`${carrierDirectory.powerUnits} <= ${b.max}`) as SQL);
}

function driversCondition(id: DriversBucketId): SQL | null {
  const b = DRIVERS_BUCKETS.find((x) => x.id === id);
  if (!b) return null;
  return b.max == null
    ? gt(carrierDirectory.drivers, b.min - 1)
    : (and(gte(carrierDirectory.drivers, b.min), sql`${carrierDirectory.drivers} <= ${b.max}`) as SQL);
}

/**
 * "Good standing" predicate for the single safety toggle: keep Satisfactory (S)
 * and Not-rated (NULL); EXCLUDE Conditional (C) + Unsatisfactory (U). Written as
 * "null OR not-in(C,U)" so unrated carriers (the majority) are never dropped.
 */
function goodStandingCondition(): SQL {
  return or(
    isNull(carrierDirectory.safetyRating),
    sql`upper(coalesce(${carrierDirectory.safetyRating}, '')) not in ('C', 'U')`,
  ) as SQL;
}

/** Resolve a port facet value to a WHERE clause over ALL its member codes. */
function portCondition(port: string): SQL | null {
  const codes = portFilterCodes(port);
  if (codes.length === 0) return null;
  return codes.length === 1 ? eq(carrierDirectory.nearestPortCode, codes[0]) : (inArray(carrierDirectory.nearestPortCode, codes) as SQL);
}

/**
 * One equipment id → an `eq(<column>, true)` on its FMCSA-derived boolean column.
 * `drayage` maps to the `intermodal` column (its data home), so — unlike the old
 * single-select path — it IS included here: with multi-select the drayage option
 * has to participate in the equipment OR-group, not sit in a separate predicate.
 */
function equipmentColCondition(id: EquipmentId): SQL | null {
  const column = EQUIPMENT_COLUMN.get(id);
  if (!column) return null;
  return eq(carrierDirectory[column], true);
}

/**
 * Multi-select equipment filter → OR of each selected column
 * (`reefer OR flatbed`). Empty selection → null (no clause). Single selection →
 * the bare `eq` (no redundant OR wrapper).
 */
function equipmentCondition(ids: EquipmentId[]): SQL | null {
  const cols = ids.map(equipmentColCondition).filter((x): x is SQL => x != null);
  if (cols.length === 0) return null;
  return cols.length === 1 ? cols[0] : (or(...cols) as SQL);
}

/** One cargo id → an `eq(<column>, true)` on its FMCSA-derived boolean column. */
function cargoColCondition(id: CargoId): SQL | null {
  const column = CARGO_COLUMN.get(id);
  if (!column) return null;
  return eq(carrierDirectory[column], true);
}

/** Multi-select cargo-specialty filter → OR of each selected column. */
function cargoCondition(ids: CargoId[]): SQL | null {
  const cols = ids.map(cargoColCondition).filter((x): x is SQL => x != null);
  if (cols.length === 0) return null;
  return cols.length === 1 ? cols[0] : (or(...cols) as SQL);
}

const recentCutoff = (): Date => new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

/**
 * Build the WHERE condition list from active filters — one entry per ACTIVE
 * facet, AND-ed together by the caller. Multi-select facets (equipment / cargo)
 * contribute a SINGLE OR-group entry, so the semantics are **OR within a facet,
 * AND across facets** (matches any selected equipment AND any selected cargo).
 * `exclude` drops one dimension so facet-count queries can show "how many if you
 * picked this". Exported for query-shape unit tests. `drayage` no longer has a
 * standalone `intermodal` predicate — it rides inside the equipment OR-group
 * (its column IS `intermodal`), which keeps OR-within-facet honest.
 */
export function buildConditions(f: DirectoryFilters, exclude: Set<string> = new Set()): SQL[] {
  const c: SQL[] = [];
  if (f.state && !exclude.has('state')) c.push(eq(carrierDirectory.state, f.state));
  if (f.port && !exclude.has('port')) {
    const pc = portCondition(f.port);
    if (pc) c.push(pc);
  }
  if (f.citySlug && !exclude.has('city')) c.push(cityCondition(f.citySlug));
  if (f.fleet && !exclude.has('fleet')) {
    const fc = fleetCondition(f.fleet);
    if (fc) c.push(fc);
  }
  if (f.drivers && !exclude.has('drivers')) {
    const dc = driversCondition(f.drivers);
    if (dc) c.push(dc);
  }
  if (f.goodStandingOnly && !exclude.has('standing')) c.push(goodStandingCondition());
  if (f.authorityActive && !exclude.has('authority')) {
    c.push(and(isNotNull(carrierDirectory.authorityType), ne(carrierDirectory.authorityType, '')) as SQL);
  }
  if (f.equipment.length && !exclude.has('equipment')) {
    const ec = equipmentCondition(f.equipment);
    if (ec) c.push(ec);
  }
  if (f.cargo.length && !exclude.has('cargo')) {
    const cc = cargoCondition(f.cargo);
    if (cc) c.push(cc);
  }
  if (f.recent && !exclude.has('recent')) c.push(gte(carrierDirectory.updatedAt, recentCutoff()));
  if (f.q && !exclude.has('q')) {
    const nc = nameSearchCondition(f.q);
    if (nc) c.push(nc);
  }
  return c;
}

/**
 * ORDER BY chunks for a sort + direction. Numeric sorts (fleet / drivers) flip
 * the column direction (`asc` = Low→High, `desc` = High→Low), always NULLs last
 * so blanks never lead. `safety` flips the quality ranking (asc = best-first
 * Satisfactory→…, desc = worst-first). `recent` flips the recency (desc =
 * newest-first). `featured` is a fixed composite and ignores direction.
 * Exported for unit tests. `dir` defaults per SORT_DIR_DEFAULTS.
 */
export function orderForSort(sort: SortId, dir?: SortDir | null) {
  const d = resolveSortDir(sort, dir);
  const numeric = (col: Parameters<typeof asc>[0]) =>
    d === 'asc' ? sql`${col} asc nulls last` : sql`${col} desc nulls last`;
  switch (sort) {
    case 'fleet':
      return [numeric(carrierDirectory.powerUnits), asc(carrierDirectory.legalName), asc(carrierDirectory.id)];
    case 'drivers':
      return [numeric(carrierDirectory.drivers), asc(carrierDirectory.legalName), asc(carrierDirectory.id)];
    case 'safety': {
      // Quality rank S=0 → C=1 → Unrated=2 → U=3. asc = best-first (default),
      // desc = worst-first. Name/id keep a stable secondary order either way.
      const rank = sql`case upper(coalesce(${carrierDirectory.safetyRating}, '')) when 'S' then 0 when 'C' then 1 when 'U' then 3 else 2 end`;
      return [
        d === 'asc' ? sql`${rank} asc` : sql`${rank} desc`,
        asc(carrierDirectory.legalName),
        asc(carrierDirectory.id),
      ];
    }
    case 'recent':
      return [
        d === 'asc' ? asc(carrierDirectory.updatedAt) : desc(carrierDirectory.updatedAt),
        asc(carrierDirectory.id),
      ];
    case 'featured':
    default:
      return [
        desc(carrierDirectory.intermodal),
        sql`${carrierDirectory.powerUnits} desc nulls last`,
        asc(carrierDirectory.legalName),
        asc(carrierDirectory.id),
      ];
  }
}

export interface ListCarriersOpts {
  state?: string | null;
  port?: string | null;
  intermodal?: boolean;
  page?: number;
  perPage?: number;
  /** Optional full facet state; takes precedence over the legacy scalar opts. */
  filters?: DirectoryFilters;
}

export interface CarrierListResult {
  carriers: VisibleCarrier[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  filters: DirectoryFilters;
}

/** Paginated, facet-filterable carrier list. All inputs are clamped here. */
export async function listCarriers(opts: ListCarriersOpts): Promise<CarrierListResult> {
  const filters: DirectoryFilters =
    opts.filters ??
    normalizeFilters(
      { intermodal: opts.intermodal ? '1' : '', page: String(opts.page ?? 1) },
      {
        state: opts.state ? String(opts.state).toUpperCase().slice(0, 2) : null,
        port: opts.port ? String(opts.port).toUpperCase().slice(0, 8) : null,
      },
    );
  const perPage = Math.min(MAX_PER_PAGE, Math.max(5, Math.floor(opts.perPage ?? filters.perPage) || DEFAULT_PER_PAGE));
  const page = Math.max(1, Math.floor(filters.page) || 1);

  try {
    return await listCarriersUnsafe({ ...filters, perPage, page });
  } catch (err) {
    // Missing table / read failure ⇒ empty result set, never a 500.
    console.warn('[directory] listCarriers failed; serving empty list:', err);
    return { carriers: [], total: 0, page, perPage, totalPages: 1, filters: { ...filters, page, perPage } };
  }
}

async function listCarriersUnsafe(filters: DirectoryFilters): Promise<CarrierListResult> {
  const { page, perPage } = filters;
  const conditions = buildConditions(filters);
  const where = conditions.length ? and(...conditions) : undefined;

  const totalRow = await db().select({ n: sql<number>`count(*)::int` }).from(carrierDirectory).where(where);
  const total = totalRow[0]?.n ?? 0;

  const rows = await db()
    .select()
    .from(carrierDirectory)
    .where(where)
    .orderBy(...orderForSort(filters.sort, filters.dir))
    .limit(perPage)
    .offset((page - 1) * perPage);

  return {
    carriers: rows.map(visibleCarrier),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    filters,
  };
}

// ─── Facet counts ─────────────────────────────────────────────────────────
export interface FacetCounts {
  fleet: Record<FleetBucketId, number>;
  drivers: Record<DriversBucketId, number>;
  /** Per-equipment/cargo-type counts, keyed by EquipmentId (all FMCSA columns). */
  equipment: Record<EquipmentId, number>;
  /** Per-cargo-specialty counts, keyed by CargoId (all FMCSA crgo_* columns). */
  cargo: Record<CargoId, number>;
  /** Carriers in good standing (Satisfactory + Not-rated) — the toggle's badge. */
  goodStanding: number;
  /** Per-display-hub carrier counts, keyed by PortGroup code (member counts summed). */
  ports: Record<string, number>;
  authorityActive: number;
  intermodal: number;
  recent: number;
}

function emptyFacetCounts(): FacetCounts {
  return {
    fleet: { '1-25': 0, '26-100': 0, '101-500': 0, '500+': 0 },
    drivers: { '1-10': 0, '11-50': 0, '51-250': 0, '250+': 0 },
    equipment: { drayage: 0, dryvan: 0, reefer: 0, hazmat: 0, tanker: 0, flatbed: 0, drybulk: 0 },
    cargo: {
      household: 0,
      beverages: 0,
      produce: 0,
      motorvehicles: 0,
      livestock: 0,
      grainfeed: 0,
      oilfield: 0,
      meat: 0,
      paper: 0,
      construction: 0,
      farmsupplies: 0,
      coalcoke: 0,
      buildingmaterials: 0,
    },
    goodStanding: 0,
    ports: Object.fromEntries(PORT_GROUPS.map((g) => [g.code, 0])),
    authorityActive: 0,
    intermodal: 0,
    recent: 0,
  };
}

/**
 * Live per-value counts for the filter sidebar. Each dimension is counted with
 * ITSELF excluded from the WHERE, so a badge shows how many carriers you'd get
 * if you picked that value (standard faceted-search semantics). Degrades to
 * zeros on any read failure — never throws, never 500s the page.
 */
/** Bounded TTL cache for the global facet counts, keyed by the filter set.
 *  Filter combos are limited in practice, but a crafted query could vary them,
 *  so the Map is capped (oldest evicted) to prevent unbounded growth. */
const facetCountsCache = new Map<string, { at: number; val: FacetCounts }>();
const FACET_COUNTS_CACHE_MAX = 200;

/** Stable JSON key for a filter set — top-level keys sorted so key ordering can't
 *  produce distinct strings for equivalent filters. DirectoryFilters is a flat
 *  object whose only nested values (equipment, cargo) are order-canonical arrays,
 *  which JSON.stringify serializes in place. */
function facetCacheKey(filters: DirectoryFilters): string {
  return JSON.stringify(filters, Object.keys(filters).sort());
}

export async function getFacetCounts(filters: DirectoryFilters): Promise<FacetCounts> {
  const key = facetCacheKey(filters);
  const now = Date.now();
  const hit = facetCountsCache.get(key);
  if (hit && now - hit.at < DIRECTORY_AGG_TTL_MS) {
    return hit.val;
  }
  return getFacetCountsUnsafe(filters, key);
}

async function getFacetCountsUnsafe(filters: DirectoryFilters, cacheKey: string): Promise<FacetCounts> {
  try {
    const whereOf = (excl: string) => {
      const c = buildConditions(filters, new Set([excl]));
      return c.length ? and(...c) : undefined;
    };

    // Fleet buckets — one grouped scan.
    const fleetRows = await db()
      .select({
        bucket: sql<string>`case
          when ${carrierDirectory.powerUnits} between 1 and 25 then '1-25'
          when ${carrierDirectory.powerUnits} between 26 and 100 then '26-100'
          when ${carrierDirectory.powerUnits} between 101 and 500 then '101-500'
          when ${carrierDirectory.powerUnits} > 500 then '500+'
          else 'none' end`,
        n: sql<number>`count(*)::int`,
      })
      .from(carrierDirectory)
      .where(whereOf('fleet'))
      .groupBy(sql`1`);

    // Drivers buckets — one grouped scan (mirrors fleet).
    const driversRows = await db()
      .select({
        bucket: sql<string>`case
          when ${carrierDirectory.drivers} between 1 and 10 then '1-10'
          when ${carrierDirectory.drivers} between 11 and 50 then '11-50'
          when ${carrierDirectory.drivers} between 51 and 250 then '51-250'
          when ${carrierDirectory.drivers} > 250 then '250+'
          else 'none' end`,
        n: sql<number>`count(*)::int`,
      })
      .from(carrierDirectory)
      .where(whereOf('drivers'))
      .groupBy(sql`1`);

    // Equipment / cargo — one scan with a filtered count per FMCSA column. The
    // equipment dimension excludes ITSELF *and* the legacy intermodal predicate
    // (drayage maps onto the intermodal column) so each option's count is honest.
    const eqBase = buildConditions(filters, new Set(['equipment', 'intermodal']));
    const eqWhere = eqBase.length ? and(...eqBase) : undefined;
    const equipmentRows = await db()
      .select({
        drayage: sql<number>`count(*) filter (where ${carrierDirectory.intermodal})::int`,
        dryvan: sql<number>`count(*) filter (where ${carrierDirectory.dryVan})::int`,
        reefer: sql<number>`count(*) filter (where ${carrierDirectory.reefer})::int`,
        hazmat: sql<number>`count(*) filter (where ${carrierDirectory.hazmat})::int`,
        tanker: sql<number>`count(*) filter (where ${carrierDirectory.tanker})::int`,
        flatbed: sql<number>`count(*) filter (where ${carrierDirectory.flatbed})::int`,
        drybulk: sql<number>`count(*) filter (where ${carrierDirectory.dryBulk})::int`,
      })
      .from(carrierDirectory)
      .where(eqWhere);

    // Cargo specialties — one scan with a filtered count per FMCSA crgo_* column.
    // Excludes ITSELF so each option's count is honest faceted-search semantics.
    const cargoBase = buildConditions(filters, new Set(['cargo']));
    const cargoWhere = cargoBase.length ? and(...cargoBase) : undefined;
    const cargoRows = await db()
      .select({
        household: sql<number>`count(*) filter (where ${carrierDirectory.householdGoods})::int`,
        beverages: sql<number>`count(*) filter (where ${carrierDirectory.beverages})::int`,
        produce: sql<number>`count(*) filter (where ${carrierDirectory.produce})::int`,
        motorvehicles: sql<number>`count(*) filter (where ${carrierDirectory.motorVehicles})::int`,
        livestock: sql<number>`count(*) filter (where ${carrierDirectory.livestock})::int`,
        grainfeed: sql<number>`count(*) filter (where ${carrierDirectory.grainFeed})::int`,
        oilfield: sql<number>`count(*) filter (where ${carrierDirectory.oilfield})::int`,
        meat: sql<number>`count(*) filter (where ${carrierDirectory.meat})::int`,
        paper: sql<number>`count(*) filter (where ${carrierDirectory.paper})::int`,
        construction: sql<number>`count(*) filter (where ${carrierDirectory.construction})::int`,
        farmsupplies: sql<number>`count(*) filter (where ${carrierDirectory.farmSupplies})::int`,
        coalcoke: sql<number>`count(*) filter (where ${carrierDirectory.coalCoke})::int`,
        buildingmaterials: sql<number>`count(*) filter (where ${carrierDirectory.buildingMaterials})::int`,
      })
      .from(carrierDirectory)
      .where(cargoWhere);

    // Ports & terminals — one grouped scan on the stored nearest_port_code, with
    // the port dimension self-excluded. Member counts are folded into their
    // DISPLAY group below (co-located ports sum into one hub).
    const portRows = await db()
      .select({ code: carrierDirectory.nearestPortCode, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(whereOf('port'))
      .groupBy(carrierDirectory.nearestPortCode);

    // Good-standing count — self-excluded so the toggle badge reads honestly.
    const goodRow = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(and(...buildConditions(filters, new Set(['standing'])), goodStandingCondition()));

    const [authRow, imRow, recentRow] = await Promise.all([
      db()
        .select({ n: sql<number>`count(*)::int` })
        .from(carrierDirectory)
        .where(
          and(
            ...buildConditions(filters, new Set(['authority'])),
            isNotNull(carrierDirectory.authorityType),
            ne(carrierDirectory.authorityType, ''),
          ),
        ),
      db()
        .select({ n: sql<number>`count(*)::int` })
        .from(carrierDirectory)
        .where(and(...buildConditions(filters, new Set(['equipment', 'intermodal'])), eq(carrierDirectory.intermodal, true))),
      db()
        .select({ n: sql<number>`count(*)::int` })
        .from(carrierDirectory)
        .where(and(...buildConditions(filters, new Set(['recent'])), gte(carrierDirectory.updatedAt, recentCutoff()))),
    ]);

    const out = emptyFacetCounts();
    for (const r of fleetRows) if (r.bucket in out.fleet) out.fleet[r.bucket as FleetBucketId] = r.n;
    for (const r of driversRows) if (r.bucket in out.drivers) out.drivers[r.bucket as DriversBucketId] = r.n;
    const eqCounts = equipmentRows[0];
    if (eqCounts) {
      out.equipment = {
        drayage: eqCounts.drayage ?? 0,
        dryvan: eqCounts.dryvan ?? 0,
        reefer: eqCounts.reefer ?? 0,
        hazmat: eqCounts.hazmat ?? 0,
        tanker: eqCounts.tanker ?? 0,
        flatbed: eqCounts.flatbed ?? 0,
        drybulk: eqCounts.drybulk ?? 0,
      };
    }
    const cargoCounts = cargoRows[0];
    if (cargoCounts) {
      out.cargo = {
        household: cargoCounts.household ?? 0,
        beverages: cargoCounts.beverages ?? 0,
        produce: cargoCounts.produce ?? 0,
        motorvehicles: cargoCounts.motorvehicles ?? 0,
        livestock: cargoCounts.livestock ?? 0,
        grainfeed: cargoCounts.grainfeed ?? 0,
        oilfield: cargoCounts.oilfield ?? 0,
        meat: cargoCounts.meat ?? 0,
        paper: cargoCounts.paper ?? 0,
        construction: cargoCounts.construction ?? 0,
        farmsupplies: cargoCounts.farmsupplies ?? 0,
        coalcoke: cargoCounts.coalcoke ?? 0,
        buildingmaterials: cargoCounts.buildingmaterials ?? 0,
      };
    }
    // Fold per-member port counts into their DISPLAY group (LA + Long Beach → one).
    for (const r of portRows) {
      const g = r.code ? portGroupForMemberCode(r.code) : null;
      if (g) out.ports[g.code] = (out.ports[g.code] ?? 0) + r.n;
    }
    out.goodStanding = goodRow[0]?.n ?? 0;
    out.authorityActive = authRow[0]?.n ?? 0;
    out.intermodal = imRow[0]?.n ?? 0;
    out.recent = recentRow[0]?.n ?? 0;
    // Cache only a successfully computed value; an error must NOT poison the cache.
    // Evict the oldest entry (insertion order) once over the cap.
    facetCountsCache.set(cacheKey, { at: Date.now(), val: out });
    if (facetCountsCache.size > FACET_COUNTS_CACHE_MAX) {
      const oldest = facetCountsCache.keys().next().value;
      if (oldest !== undefined) facetCountsCache.delete(oldest);
    }
    return out;
  } catch (err) {
    console.warn('[directory] getFacetCounts failed; serving zero counts:', err);
    return emptyFacetCounts();
  }
}

// ─── City tier ────────────────────────────────────────────────────────────
export interface CityCount {
  city: string;
  slug: string;
  count: number;
}

/** Top cities in a state by carrier count (for the "cities in {state}" module). */
export async function citiesForState(stateCode: string, limit = 30): Promise<CityCount[]> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const rows = await db()
      .select({ city: carrierDirectory.city, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(and(eq(carrierDirectory.state, code), isNotNull(carrierDirectory.city), ne(carrierDirectory.city, '')))
      .groupBy(carrierDirectory.city)
      .orderBy(sql`count(*) desc`)
      .limit(Math.min(200, Math.max(1, limit)));
    // Collapse case/spacing variants of the same city onto one slug.
    const bySlug = new Map<string, CityCount>();
    for (const r of rows) {
      const name = (r.city ?? '').trim();
      if (!name) continue;
      const slug = citySlugify(name);
      if (!slug) continue;
      const cur = bySlug.get(slug);
      if (cur) cur.count += r.n;
      else bySlug.set(slug, { city: titleCaseCity(name), slug, count: r.n });
    }
    return [...bySlug.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  } catch (err) {
    console.warn('[directory] citiesForState failed; serving no cities:', err);
    return [];
  }
}

/** Resolve a city's display name (best-effort title case) from its rows. */
export async function cityDisplayName(stateCode: string, citySlug: string): Promise<string | null> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const rows = await db()
      .select({ city: carrierDirectory.city })
      .from(carrierDirectory)
      .where(and(eq(carrierDirectory.state, code), cityCondition(citySlug)))
      .limit(1);
    const raw = rows[0]?.city?.trim();
    return raw ? titleCaseCity(raw) : null;
  } catch {
    return null;
  }
}

/** Best-effort Title Case for an ALL-CAPS FMCSA city string. */
export function titleCaseCity(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Of|And|The)\b/g, (m) => m.toLowerCase())
    .replace(/^./, (m) => m.toUpperCase());
}

/** Carriers in one city of one state (faceted, paginated). */
export async function carriersByCity(
  stateCode: string,
  citySlug: string,
  filters: DirectoryFilters,
): Promise<CarrierListResult> {
  const scoped: DirectoryFilters = {
    ...filters,
    state: String(stateCode).toUpperCase().slice(0, 2),
    citySlug: citySlugify(citySlug),
    port: null,
  };
  return listCarriers({ filters: scoped, perPage: filters.perPage });
}

// ─── Related carriers (profile cross-links) ───────────────────────────────
/**
 * Other carriers to surface on a profile: same city first, topped up with
 * same-state, self excluded. Ordered featured-first. Never throws.
 */
export async function relatedCarriers(carrier: VisibleCarrier, limit = 6): Promise<VisibleCarrier[]> {
  if (!carrier.state) return [];
  const state = carrier.state.toUpperCase().slice(0, 2);
  try {
    const out: VisibleCarrier[] = [];
    const seen = new Set<string>([carrier.slug]);
    const push = (rows: (typeof carrierDirectory.$inferSelect)[]) => {
      for (const r of rows) {
        if (seen.has(r.publicSlug)) continue;
        seen.add(r.publicSlug);
        out.push(visibleCarrier(r));
        if (out.length >= limit) break;
      }
    };

    if (carrier.city) {
      const citySlug = citySlugify(carrier.city);
      if (citySlug) {
        const cityRows = await db()
          .select()
          .from(carrierDirectory)
          .where(and(eq(carrierDirectory.state, state), cityCondition(citySlug), ne(carrierDirectory.publicSlug, carrier.slug)))
          .orderBy(...orderForSort('featured'))
          .limit(limit + 1);
        push(cityRows);
      }
    }
    if (out.length < limit) {
      const stateRows = await db()
        .select()
        .from(carrierDirectory)
        .where(and(eq(carrierDirectory.state, state), ne(carrierDirectory.publicSlug, carrier.slug)))
        .orderBy(...orderForSort('featured'))
        .limit(limit + out.length + 1);
      push(stateRows);
    }
    return out.slice(0, limit);
  } catch (err) {
    console.warn('[directory] relatedCarriers failed; serving none:', err);
    return [];
  }
}

// ─── Hero social-proof carriers (homepage) ────────────────────────────────
//
// Feeds the homepage hero's directory-preview cards with REAL, varied carriers
// (live social proof + free advertising for listed carriers) instead of the
// hardcoded fictional demo cards. Every load re-queries with ORDER BY random()
// so the featured set rotates. The projection is deliberately tiny and
// contact-free (name / ids / equipment badges / location + the public slug) —
// no phone, email, or internal id ever leaves this layer.

/** One equipment/standing badge on a hero card. `muted` = the quiet grey chip. */
export interface HeroCarrierChip {
  label: string;
  muted?: boolean;
}

/** Safe, render-ready projection of one carrier for a hero preview card. */
export interface HeroCarrierCard {
  /** publicSlug → links to /directory/carrier/<slug>. */
  slug: string;
  /** Display name (DBA when meaningful, else legal name). */
  name: string;
  /** Public FMCSA identifiers, pre-formatted ("USDOT 123456 · MC 654321"). */
  ids: string;
  /** Up to ~2 equipment badges + an optional muted "Satisfactory" chip. */
  chips: HeroCarrierChip[];
  /** Location line label ("Nearest port" | "Based in") or null when unknown. */
  locLabel: string | null;
  /** Location line value (port city or "City, ST") or null when unknown. */
  locValue: string | null;
}

/** Default hero card count fetched (client renders the first few). */
export const HERO_CARRIER_LIMIT = 8;

/** Display name for a hero card — mirrors pages.ts `carrierName` (DBA-preferred,
 *  falling back to the legal name when the DBA is too short to identify). Kept
 *  local to avoid a queries→pages import cycle. */
function heroDisplayName(legalName: string, dbaName: string | null): string {
  const dba = (dbaName ?? '').trim();
  if (dba && (dba.includes(' ') || dba.length >= 8)) return dba;
  return legalName;
}

/**
 * carrier_directory WHERE predicates for a display-worthy hero carrier
 * (exported for query-shape unit tests). Good standing (keep Satisfactory +
 * unrated, drop Conditional/Unsatisfactory), contact NOT opted out, a real
 * city/state, an actual fleet (a headline stat), US domicile. AND-ed by the
 * caller. The `carrier_overrides.hidden` exclusion is applied in getHeroCarriers
 * (it needs the LEFT JOIN) so this stays a pure single-table predicate list.
 */
export function heroCarrierConditions(): SQL[] {
  return [
    goodStandingCondition(),
    eq(carrierDirectory.contactHidden, false),
    isNotNull(carrierDirectory.city),
    ne(carrierDirectory.city, ''),
    isNotNull(carrierDirectory.state),
    ne(carrierDirectory.state, ''),
    gt(carrierDirectory.powerUnits, 0),
    eq(carrierDirectory.country, 'US'),
  ];
}

/** ORDER BY for the hero set — random, so the featured carriers vary each load. */
export function heroCarrierOrder(): SQL[] {
  return [sql`random()`];
}

/** Equipment/standing badges for a hero card, derived from the FMCSA flags. */
function heroChips(r: typeof carrierDirectory.$inferSelect): HeroCarrierChip[] {
  const chips: HeroCarrierChip[] = [];
  const equip: ReadonlyArray<[boolean, string]> = [
    [r.intermodal, 'Drayage'],
    [r.reefer, 'Reefer'],
    [r.flatbed, 'Flatbed'],
    [r.tanker, 'Tanker'],
    [r.dryVan, 'Dry van'],
    [r.dryBulk, 'Dry bulk'],
    [r.hazmat, 'Hazmat'],
  ];
  for (const [on, label] of equip) {
    if (on && chips.length < 2) chips.push({ label });
  }
  // No FMCSA equipment flag set yet (rows pre-backfill) → one honest fallback.
  if (chips.length === 0) chips.push({ label: 'Motor carrier' });
  if (String(r.safetyRating ?? '').toUpperCase() === 'S') chips.push({ label: 'Satisfactory', muted: true });
  return chips;
}

/** Location line for a hero card: nearest port when known, else "City, ST". */
function heroLocation(r: typeof carrierDirectory.$inferSelect): { locLabel: string | null; locValue: string | null } {
  const g = r.nearestPortCode ? portGroupForMemberCode(r.nearestPortCode) : null;
  if (g) return { locLabel: 'Nearest port', locValue: g.city || g.label };
  if (r.city && r.state) return { locLabel: 'Based in', locValue: `${titleCaseCity(r.city)}, ${r.state}` };
  return { locLabel: null, locValue: null };
}

/**
 * Shape one carrier row into the safe hero-card projection (PURE — unit-tested).
 * Emits ONLY public, contact-free fields; internal ids, phone + email never
 * appear. USDOT/MC are public FMCSA identifiers already shown across the
 * directory, so they are safe to surface here.
 */
export function heroCarrierCard(r: typeof carrierDirectory.$inferSelect): HeroCarrierCard {
  // Mirror the directory's own id rendering (`MC ${mcNumber}`) — mcNumber is
  // stored as the bare docket number, prefixed with "MC " for display.
  const mc = String(r.mcNumber ?? '').trim();
  const ids = mc ? `USDOT ${r.usdot} · MC ${mc}` : `USDOT ${r.usdot}`;
  const { locLabel, locValue } = heroLocation(r);
  return {
    slug: r.publicSlug,
    name: heroDisplayName(r.legalName, r.dbaName),
    ids,
    chips: heroChips(r),
    locLabel,
    locValue,
  };
}

/**
 * Random set of display-worthy real carriers for the homepage hero preview.
 * Re-randomized on every call (variation-per-load is the whole point), so the
 * caller should serve it uncached. Degrades to an empty array on any read
 * failure — the client keeps the static fallback cards, never a broken hero.
 */
export async function getHeroCarriers(limit = HERO_CARRIER_LIMIT): Promise<HeroCarrierCard[]> {
  const n = Math.min(12, Math.max(1, Math.floor(limit) || HERO_CARRIER_LIMIT));
  try {
    const rows = await db()
      .select()
      .from(carrierDirectory)
      .leftJoin(carrierOverrides, eq(carrierOverrides.usdot, carrierDirectory.usdot))
      .where(
        and(
          ...heroCarrierConditions(),
          // Honor an admin "hidden" override (kept out even though the hero shows
          // no contact) — surviving-the-ingest hide flag on carrier_overrides.
          or(isNull(carrierOverrides.hidden), ne(carrierOverrides.hidden, true)) as SQL,
        ),
      )
      .orderBy(...heroCarrierOrder())
      .limit(n);
    return rows.map((row) => heroCarrierCard(row.carrier_directory));
  } catch (err) {
    console.warn('[directory] getHeroCarriers failed; serving none:', err);
    return [];
  }
}

/** Count carriers in the same city as a carrier (for a count-bearing link). */
export async function cityCarrierCount(stateCode: string, citySlug: string): Promise<number> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const row = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(and(eq(carrierDirectory.state, code), cityCondition(citySlug)));
    return row[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Count carriers in a state (for a count-bearing profile back-link). */
export async function stateCarrierCount(stateCode: string): Promise<number> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const row = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(eq(carrierDirectory.state, code));
    return row[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Look up a single carrier by its public slug (for the profile page), MERGING
 * any `carrier_overrides` row on top (LEFT JOIN by usdot). This is the only
 * query that applies overrides — the list/card queries stay FMCSA-only. A
 * missing `carrier_overrides` table (never migrated) still LEFT JOINs to NULL
 * overrides, so the profile degrades to the pure FMCSA card, never a 500.
 */
export async function carrierBySlug(slug: string): Promise<VisibleCarrier | null> {
  try {
    const rows = await db()
      .select()
      .from(carrierDirectory)
      .leftJoin(carrierOverrides, eq(carrierOverrides.usdot, carrierDirectory.usdot))
      .where(eq(carrierDirectory.publicSlug, slug))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mergeCarrierOverride(visibleCarrier(row.carrier_directory), row.carrier_overrides);
  } catch (err) {
    // Missing table / read failure ⇒ treated as "not found" (404), never a 500.
    console.warn('[directory] carrierBySlug failed; treating as not found:', err);
    return null;
  }
}

// ─── Carrier self-service lookup ("Find your company" autofill) ─────────────
//
// Backs the authed setup convenience where a carrier finds THEIR OWN FMCSA
// record (by USDOT, MC #, or company name) and prefills their calculator-widget
// company details. Deliberately SLIM: only the handful of fields those inputs
// need — no fleet/equipment/safety payload. Contact fields respect the carrier
// opt-out: this feature PULLS contact data, so it merges carrier_overrides on
// top (via mergeCarrierOverride, exactly like the carrierBySlug profile path)
// and nulls phone/email when EITHER the base contact_hidden column OR the
// carrier_overrides.hidden opt-out is set — not just the base column.

/** Slim projection returned by carrierLookup — one row per matched carrier. */
export interface CarrierLookupResult {
  usdot: string;
  mcNumber: string | null;
  legalName: string;
  dbaName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface CarrierLookupParams {
  q?: unknown;
  dot?: unknown;
  mc?: unknown;
}

/** Max name-search rows returned to the typeahead. */
export const CARRIER_LOOKUP_LIMIT = 8;

/**
 * Normalize a raw USDOT value to the stored form (digits only, leading zeros
 * stripped — same normalization carrier_directory.usdot is ingested with). Null
 * when there is no digit. Pure + total. Exported for unit tests.
 */
export function normalizeUsdotQuery(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits.length ? digits : null;
}

/**
 * Normalize a raw MC/docket value to bare digits with leading zeros stripped, so
 * a user typing "12892", "MC12892", "MC-012892" or "012892" all reduce to the
 * same key. The DB stores mc_number verbatim ("MC012892"), so the match strips
 * MC's non-digits + leading zeros on the column side too (see carrierLookup).
 * Null when there is no digit. Pure + total. Exported for unit tests.
 */
export function normalizeMcQuery(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits.length ? digits : null;
}

/** Shape a VisibleCarrier into the slim lookup result, enforcing the contact
 *  opt-out (contactHidden ⇒ phone + email nulled) so a hidden carrier's contact
 *  never leaks through the prefill. */
function toLookupResult(v: VisibleCarrier): CarrierLookupResult {
  return {
    usdot: v.usdot,
    mcNumber: v.mcNumber,
    legalName: v.legalName,
    dbaName: v.dbaName,
    phone: v.contactHidden ? null : v.phone,
    email: v.contactHidden ? null : v.email,
    city: v.city,
    state: v.state,
    zip: v.zip,
  };
}

/**
 * Look up carriers for the self-service prefill. Precedence: `dot` (exact,
 * single row) → `mc` (normalized match) → `q` (free-text name ILIKE, capped at
 * CARRIER_LOOKUP_LIMIT). Returns `[]` for an empty/too-short query and degrades
 * to `[]` on any read failure — never throws, never 500s the endpoint.
 */
export async function carrierLookup(params: CarrierLookupParams): Promise<CarrierLookupResult[]> {
  const dot = normalizeUsdotQuery(params.dot);
  const mc = normalizeMcQuery(params.mc);
  const nameTerm = normalizeNameQuery(params.q);

  let where: SQL | null = null;
  let limit = CARRIER_LOOKUP_LIMIT;
  if (dot) {
    where = eq(carrierDirectory.usdot, dot);
    limit = 1;
  } else if (mc) {
    // Column side: strip mc_number's non-digits then leading zeros, compare to
    // the equally-normalized user value. "MC012892" ⇒ "12892" = mc.
    where = sql`ltrim(regexp_replace(coalesce(${carrierDirectory.mcNumber}, ''), '[^0-9]', '', 'g'), '0') = ${mc}`;
    limit = CARRIER_LOOKUP_LIMIT;
  } else if (nameTerm) {
    where = nameSearchCondition(nameTerm);
  }
  if (!where) return [];

  try {
    // LEFT JOIN carrier_overrides so an admin/claim opt-out written to
    // carrier_overrides.hidden is honored, not just the base contact_hidden
    // column. mergeCarrierOverride ORs the two hidden flags (and applies any
    // admin email/phone edits) exactly like the carrierBySlug profile path;
    // toLookupResult then nulls phone/email when the merged carrier is hidden.
    // A missing carrier_overrides table still LEFT JOINs to NULL, so this
    // degrades to the pure FMCSA card — never a 500.
    const rows = await db()
      .select()
      .from(carrierDirectory)
      .leftJoin(carrierOverrides, eq(carrierOverrides.usdot, carrierDirectory.usdot))
      .where(where)
      .orderBy(...orderForSort('featured'))
      .limit(limit);
    return rows.map((r) => toLookupResult(mergeCarrierOverride(visibleCarrier(r.carrier_directory), r.carrier_overrides)));
  } catch (err) {
    console.warn('[directory] carrierLookup failed; serving no matches:', err);
    return [];
  }
}
