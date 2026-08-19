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
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierDirectory } from '../../db/schema.js';
import { CONTAINER_PORTS } from './containerPorts.js';

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
  nearestPortCode: string | null;
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
    nearestPortCode: r.nearestPortCode,
  };
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
    byPort: CONTAINER_PORTS.map((p) => ({
      code: p.code,
      name: p.name,
      city: p.city,
      state: p.state,
      count: 0,
    })),
  };
}

/** Carrier counts per state + per port (+ intermodal total) for the index/facets. */
export async function getDirectorySummary(): Promise<DirectorySummary> {
  try {
    return await getDirectorySummaryUnsafe();
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
  const byPort = CONTAINER_PORTS.map((p) => ({
    code: p.code,
    name: p.name,
    city: p.city,
    state: p.state,
    count: portCountByCode.get(p.code) ?? 0,
  })).sort((a, b) => b.count - a.count);

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
export type SafetyId = 'satisfactory' | 'conditional' | 'unsatisfactory' | 'unrated';
export type SortId = 'featured' | 'safety' | 'fleet' | 'recent';

export const FLEET_BUCKETS: ReadonlyArray<{ id: FleetBucketId; label: string; min: number; max: number | null }> = [
  { id: '1-25', label: '1–25 trucks', min: 1, max: 25 },
  { id: '26-100', label: '26–100 trucks', min: 26, max: 100 },
  { id: '101-500', label: '101–500 trucks', min: 101, max: 500 },
  { id: '500+', label: '500+ trucks', min: 501, max: null },
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
  { id: 'recent', label: 'Recently updated' },
];

/** MCS-150 "recently updated" proxy window. */
const RECENT_DAYS = 365;

/** Normalized, fully-clamped facet state — safe to hand straight to SQL. */
export interface DirectoryFilters {
  state: string | null;
  port: string | null;
  citySlug: string | null;
  fleet: FleetBucketId | null;
  safety: SafetyId | null;
  authorityActive: boolean;
  intermodal: boolean;
  recent: boolean;
  sort: SortId;
  page: number;
  perPage: number;
}

const FLEET_IDS = new Set(FLEET_BUCKETS.map((b) => b.id));
const SAFETY_IDS = new Set(SAFETY_OPTIONS.map((s) => s.id));
const SORT_IDS = new Set(SORT_OPTIONS.map((s) => s.id));
const truthy = (v: unknown): boolean => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

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
  const safetyRaw = str(raw.safety).toLowerCase() as SafetyId;
  const sortRaw = str(raw.sort).toLowerCase() as SortId;
  return {
    state: overrides && 'state' in overrides ? overrides.state ?? null : /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null,
    port: overrides && 'port' in overrides ? overrides.port ?? null : portRaw || null,
    citySlug:
      overrides && 'citySlug' in overrides ? overrides.citySlug ?? null : str(raw.city) ? citySlugify(str(raw.city)) : null,
    fleet: FLEET_IDS.has(fleetRaw) ? fleetRaw : null,
    safety: SAFETY_IDS.has(safetyRaw) ? safetyRaw : null,
    authorityActive: String(raw.authority ?? '').toLowerCase() === 'active' || truthy(raw.authority),
    intermodal: truthy(raw.intermodal),
    recent: truthy(raw.recent),
    sort: SORT_IDS.has(sortRaw) ? sortRaw : 'featured',
    page: Math.max(1, parseInt(str(raw.page), 10) || 1),
    perPage: DEFAULT_PER_PAGE,
  };
}

/** Which facet keys, if present on /directory, switch it from landing → results. */
export const FACET_QUERY_KEYS = [
  'state',
  'city',
  'fleet',
  'safety',
  'authority',
  'intermodal',
  'recent',
  'sort',
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

function safetyCondition(id: SafetyId): SQL | null {
  const o = SAFETY_OPTIONS.find((x) => x.id === id);
  if (!o) return null;
  return o.letter == null ? isNull(carrierDirectory.safetyRating) : eq(carrierDirectory.safetyRating, o.letter);
}

const recentCutoff = (): Date => new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

/**
 * Build the WHERE condition list from active filters. `exclude` drops one
 * dimension so facet-count queries can show "how many if you picked this".
 */
function buildConditions(f: DirectoryFilters, exclude: Set<string> = new Set()): SQL[] {
  const c: SQL[] = [];
  if (f.state && !exclude.has('state')) c.push(eq(carrierDirectory.state, f.state));
  if (f.port && !exclude.has('port')) c.push(eq(carrierDirectory.nearestPortCode, f.port));
  if (f.citySlug && !exclude.has('city')) c.push(cityCondition(f.citySlug));
  if (f.fleet && !exclude.has('fleet')) {
    const fc = fleetCondition(f.fleet);
    if (fc) c.push(fc);
  }
  if (f.safety && !exclude.has('safety')) {
    const sc = safetyCondition(f.safety);
    if (sc) c.push(sc);
  }
  if (f.authorityActive && !exclude.has('authority')) {
    c.push(and(isNotNull(carrierDirectory.authorityType), ne(carrierDirectory.authorityType, '')) as SQL);
  }
  if (f.intermodal && !exclude.has('intermodal')) c.push(eq(carrierDirectory.intermodal, true));
  if (f.recent && !exclude.has('recent')) c.push(gte(carrierDirectory.updatedAt, recentCutoff()));
  return c;
}

function orderForSort(sort: SortId) {
  switch (sort) {
    case 'fleet':
      return [sql`${carrierDirectory.powerUnits} desc nulls last`, asc(carrierDirectory.legalName), asc(carrierDirectory.id)];
    case 'safety':
      // Satisfactory → Conditional → Unrated → Unsatisfactory, then name.
      return [
        sql`case upper(coalesce(${carrierDirectory.safetyRating}, '')) when 'S' then 0 when 'C' then 1 when 'U' then 3 else 2 end asc`,
        asc(carrierDirectory.legalName),
        asc(carrierDirectory.id),
      ];
    case 'recent':
      return [desc(carrierDirectory.updatedAt), asc(carrierDirectory.id)];
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
    .orderBy(...orderForSort(filters.sort))
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
  safety: Record<SafetyId, number>;
  authorityActive: number;
  intermodal: number;
  recent: number;
}

function emptyFacetCounts(): FacetCounts {
  return {
    fleet: { '1-25': 0, '26-100': 0, '101-500': 0, '500+': 0 },
    safety: { satisfactory: 0, conditional: 0, unsatisfactory: 0, unrated: 0 },
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
export async function getFacetCounts(filters: DirectoryFilters): Promise<FacetCounts> {
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

    // Safety — one grouped scan.
    const safetyRows = await db()
      .select({
        s: sql<string>`coalesce(upper(${carrierDirectory.safetyRating}), 'UNRATED')`,
        n: sql<number>`count(*)::int`,
      })
      .from(carrierDirectory)
      .where(whereOf('safety'))
      .groupBy(sql`1`);

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
        .where(and(...buildConditions(filters, new Set(['intermodal'])), eq(carrierDirectory.intermodal, true))),
      db()
        .select({ n: sql<number>`count(*)::int` })
        .from(carrierDirectory)
        .where(and(...buildConditions(filters, new Set(['recent'])), gte(carrierDirectory.updatedAt, recentCutoff()))),
    ]);

    const out = emptyFacetCounts();
    for (const r of fleetRows) if (r.bucket in out.fleet) out.fleet[r.bucket as FleetBucketId] = r.n;
    const sMap: Record<string, SafetyId> = { S: 'satisfactory', C: 'conditional', U: 'unsatisfactory', UNRATED: 'unrated' };
    for (const r of safetyRows) {
      const id = sMap[r.s];
      if (id) out.safety[id] = r.n;
    }
    out.authorityActive = authRow[0]?.n ?? 0;
    out.intermodal = imRow[0]?.n ?? 0;
    out.recent = recentRow[0]?.n ?? 0;
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

/** Look up a single carrier by its public slug (for the profile page). */
export async function carrierBySlug(slug: string): Promise<VisibleCarrier | null> {
  try {
    const rows = await db()
      .select()
      .from(carrierDirectory)
      .where(eq(carrierDirectory.publicSlug, slug))
      .limit(1);
    return rows[0] ? visibleCarrier(rows[0]) : null;
  } catch (err) {
    // Missing table / read failure ⇒ treated as "not found" (404), never a 500.
    console.warn('[directory] carrierBySlug failed; treating as not found:', err);
    return null;
  }
}
