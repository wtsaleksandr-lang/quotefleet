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
import { and, asc, eq, sql } from 'drizzle-orm';
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
  powerUnits: number | null;
  drivers: number | null;
  safetyRating: string | null;
  authorityType: string | null;
  intermodal: boolean;
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
    powerUnits: r.powerUnits,
    drivers: r.drivers,
    safetyRating: r.safetyRating,
    authorityType: r.authorityType,
    intermodal: r.intermodal,
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

export interface ListCarriersOpts {
  state?: string | null;
  port?: string | null;
  intermodal?: boolean;
  page?: number;
  perPage?: number;
}

export interface CarrierListResult {
  carriers: VisibleCarrier[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  filters: { state: string | null; port: string | null; intermodal: boolean };
}

/** Paginated, filterable carrier list. All inputs are clamped/normalized here. */
export async function listCarriers(opts: ListCarriersOpts): Promise<CarrierListResult> {
  const state = opts.state ? String(opts.state).toUpperCase().slice(0, 2) : null;
  const port = opts.port ? String(opts.port).toUpperCase().slice(0, 8) : null;
  const intermodalOnly = !!opts.intermodal;
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(5, Math.floor(opts.perPage ?? DEFAULT_PER_PAGE) || DEFAULT_PER_PAGE));

  try {
    return await listCarriersUnsafe({ state, port, intermodalOnly, page, perPage });
  } catch (err) {
    // Missing table / read failure ⇒ empty result set, never a 500.
    console.warn('[directory] listCarriers failed; serving empty list:', err);
    return {
      carriers: [],
      total: 0,
      page,
      perPage,
      totalPages: 1,
      filters: { state, port, intermodal: intermodalOnly },
    };
  }
}

async function listCarriersUnsafe(args: {
  state: string | null;
  port: string | null;
  intermodalOnly: boolean;
  page: number;
  perPage: number;
}): Promise<CarrierListResult> {
  const { state, port, intermodalOnly, page, perPage } = args;

  const conditions = [];
  if (state) conditions.push(eq(carrierDirectory.state, state));
  if (port) conditions.push(eq(carrierDirectory.nearestPortCode, port));
  if (intermodalOnly) conditions.push(eq(carrierDirectory.intermodal, true));
  const where = conditions.length ? and(...conditions) : undefined;

  const totalRow = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(carrierDirectory)
    .where(where);
  const total = totalRow[0]?.n ?? 0;

  const rows = await db()
    .select()
    .from(carrierDirectory)
    .where(where)
    // Stable, name-ordered browse; id breaks ties for deterministic paging.
    .orderBy(asc(carrierDirectory.legalName), asc(carrierDirectory.id))
    .limit(perPage)
    .offset((page - 1) * perPage);

  return {
    carriers: rows.map(visibleCarrier),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    filters: { state, port, intermodal: intermodalOnly },
  };
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
