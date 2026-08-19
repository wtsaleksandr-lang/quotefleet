/**
 * FMCSA carrier-directory ingest CORE.
 *
 * Ingest ACTIVE US motor CARRIERS with operating authority from FMCSA's free
 * public data → the `carrier_directory` table (public, browsable directory).
 *
 * This module holds the reusable ingest engine (fetch → filter → normalize →
 * upsert) so BOTH callers can share it:
 *   - scripts/ingestFmcsaCarriers.ts — the CLI (arg parsing + summary print).
 *   - src/server/directory/autoHeal.ts — the boot-time auto-heal that re-runs the
 *     ingest in the background when Replit's publish phantom-drops the data.
 * It lives under src/ (not scripts/) so the COMPILED server (dist/) can import
 * runIngest at runtime — scripts/ is never compiled into dist.
 *
 * A fork of scripts/ingestFmcsaCensus.ts (which pulls active property BROKERS).
 * Same free sources (DOT Open Data / Socrata JSON API, no key needed):
 *   - L&I (Licensing & Insurance) Carrier file  — resource 6eyk-hxee
 *       Carries operating AUTHORITY. A row is an active property CARRIER when
 *       (common_stat='A' OR contract_stat='A') AND property_chk='Y' — i.e. it
 *       holds active common and/or contract carrier authority for property
 *       (general freight), excluding passenger / HHG-only. Supplies
 *       docket_number (MC), dot_number, legal/dba name, address, phone.
 *   - Company Census file                        — resource az4n-8mr2
 *       Supplies power_units, total_drivers, safety_rating, the physical
 *       address, a live status_code (A/I), and the cargo-classification flags —
 *       notably crgo_intermodal='X', which marks container / drayage carriers.
 *       Keyed by dot_number (L&I dot_number is zero-padded; strip leading zeros
 *       to join).
 *
 * Server-side $where filter (streaming, batched, resumable, dependency-free) —
 * we pull ONLY active property carriers rather than downloading the multi-
 * hundred-MB bulk snapshots.
 *
 * Per carrier we derive `nearestPortCode` (ZIP → nearest US container port) and
 * a unique `publicSlug`. Idempotent (upsert by USDOT), resumable (--offset N),
 * safe to re-run.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierDirectory, type CarrierDirectoryRow } from '../../db/schema.js';
import { nearestPortForZip, nearestCaPortForProvince } from './containerPorts.js';
import { US_STATE_CODES } from './usStates.js';
import { CA_PROVINCE_CODES } from './caProvinces.js';

// ─── Socrata sources ──────────────────────────────────────────────────────
const SOCRATA_BASE = 'https://data.transportation.gov/resource';
const LI_CARRIER_ID = '6eyk-hxee'; // Licensing & Insurance — Carrier / authority
const CENSUS_ID = 'az4n-8mr2'; // Company Census file
/** Active property carriers (common and/or contract authority), server-side. */
const CARRIER_WHERE = "(common_stat='A' OR contract_stat='A') AND property_chk='Y'";
const FETCH_UA = 'QuoteFleetDirectoryBot/1.0 (+https://quotefleet.net/bot)';

// ─── Raw row shapes (subset of the columns we use) ────────────────────────
export interface LiCarrierRow {
  docket_number?: string;
  dot_number?: string;
  common_stat?: string;
  contract_stat?: string;
  broker_stat?: string;
  property_chk?: string;
  passenger_chk?: string;
  hhg_chk?: string;
  legal_name?: string;
  dba_name?: string;
  bus_street_po?: string;
  bus_city?: string;
  bus_state_code?: string;
  bus_zip_code?: string;
  bus_telno?: string;
}

export interface CensusRow {
  dot_number?: string;
  legal_name?: string;
  dba_name?: string;
  email_address?: string;
  power_units?: string;
  total_drivers?: string;
  safety_rating?: string;
  status_code?: string;
  crgo_intermodal?: string;
  phone?: string;
  phy_street?: string;
  phy_city?: string;
  phy_state?: string;
  phy_zip?: string;
}

/** Normalized carrier record persisted to `carrier_directory`. */
export interface CarrierRecord {
  usdot: string;
  mcNumber: string | null;
  legalName: string;
  dbaName: string | null;
  city: string | null;
  state: string | null;
  /** Domicile country derived from state: 'US' or 'CA'. */
  country: string;
  zip: string | null;
  phone: string | null;
  /** Census email_address (normalized lower-case), or null when absent/implausible. */
  email: string | null;
  powerUnits: number | null;
  drivers: number | null;
  safetyRating: string | null;
  authorityType: string | null;
  intermodal: boolean;
  nearestPortCode: string | null;
  publicSlug: string;
}

// ─── Pure normalize / filter helpers (unit-tested) ────────────────────────
export function cleanStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** USDOT number with leading zeros stripped, so L&I ("00107080") joins census
 *  ("107080"). Returns null when empty / non-numeric. */
export function normalizeDot(v: unknown): string | null {
  const s = cleanStr(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length ? digits : null;
}

/** MC/docket number verbatim (e.g. "MC012892"), trimmed. */
export function normalizeMc(v: unknown): string | null {
  return cleanStr(v);
}

/** Keep a phone only if it has ≥10 digits; store the digit string. */
export function normalizePhone(v: unknown): string | null {
  const s = cleanStr(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

/** Trim + lower-case an email; keep only a plausible `x@y.z` shape (census
 *  email_address is dirty — spaces, "N/A", etc.). Returns null otherwise. */
export function normalizeEmail(v: unknown): string | null {
  const s = cleanStr(v);
  if (!s) return null;
  const e = s.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

function toInt(v: unknown): number | null {
  const s = cleanStr(v);
  if (!s) return null;
  const n = Number.parseInt(s.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** True iff the L&I row is an ACTIVE PROPERTY carrier (common and/or contract). */
export function isActivePropertyCarrier(li: LiCarrierRow): boolean {
  const hasAuthority = li.common_stat === 'A' || li.contract_stat === 'A';
  return hasAuthority && li.property_chk === 'Y';
}

/** 'common' | 'contract' | 'common,contract' from the L&I *_stat flags. */
export function authorityType(li: LiCarrierRow): string | null {
  const parts: string[] = [];
  if (li.common_stat === 'A') parts.push('common');
  if (li.contract_stat === 'A') parts.push('contract');
  return parts.length ? parts.join(',') : null;
}

/** Census status 'I' means not allowed to operate; missing census = keep. */
export function censusAllowsOperate(census: CensusRow | undefined): boolean {
  if (!census) return true;
  return census.status_code !== 'I';
}

/** Census crgo_intermodal is 'X' when the carrier hauls intermodal containers. */
export function isIntermodal(census: CensusRow | undefined): boolean {
  return census?.crgo_intermodal === 'X';
}

/**
 * Domicile country for a (already upper-cased) physical state/province code:
 * 'US' when it's a US state/territory, 'CA' when it's a Canadian province, else
 * null (Mexico / other / no state) — unplaceable in the North-America browse.
 */
export function carrierCountry(state: string | null): 'US' | 'CA' | null {
  if (!state) return null;
  if (US_STATE_CODES.has(state)) return 'US';
  if (CA_PROVINCE_CODES.has(state)) return 'CA';
  return null;
}

/** URL-safe slug from the display name, suffixed with USDOT for uniqueness. */
export function makeSlug(name: string, usdot: string): string {
  const base = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base || 'carrier'}-${usdot}`;
}

/**
 * Normalize one L&I carrier row (+ optional census match) into a directory
 * record. Returns null when the row is NOT an active property carrier, is not
 * allowed to operate, has no USDOT (the unique key), or has no usable name.
 */
export function normalizeCarrier(
  li: LiCarrierRow,
  census: CensusRow | undefined,
  includeCanada = false,
): CarrierRecord | null {
  if (!isActivePropertyCarrier(li)) return null;
  if (!censusAllowsOperate(census)) return null;

  const usdot = normalizeDot(li.dot_number ?? census?.dot_number);
  if (!usdot) return null; // usdot is NOT NULL + unique identity

  const legalName =
    cleanStr(li.legal_name) ?? cleanStr(census?.legal_name) ?? cleanStr(li.dba_name);
  if (!legalName) return null; // legal_name is NOT NULL

  const zip = cleanStr(census?.phy_zip) ?? cleanStr(li.bus_zip_code);
  const state = (cleanStr(census?.phy_state) ?? cleanStr(li.bus_state_code))?.toUpperCase() ?? null;
  // Country-aware domicile gate. The directory is organized by state/province +
  // port, so a carrier must be placeable in a North-America country:
  //   - US state / DC / PR-VI-GU  → country 'US' (kept, unchanged behavior).
  //   - Canadian province          → country 'CA' (kept ONLY when includeCanada;
  //     otherwise dropped — this preserves the EXACT current US-only output when
  //     the flag is off, since the ~9k Canada carriers hold US cross-border authority).
  //   - Mexico / other / no state  → country null (dropped — unchanged behavior).
  const country = carrierCountry(state);
  if (country === null) return null;
  if (country === 'CA' && !includeCanada) return null;

  return {
    usdot,
    mcNumber: normalizeMc(li.docket_number),
    legalName,
    dbaName: cleanStr(li.dba_name) ?? cleanStr(census?.dba_name),
    city: cleanStr(census?.phy_city) ?? cleanStr(li.bus_city),
    state,
    country,
    zip,
    phone: normalizePhone(census?.phone) ?? normalizePhone(li.bus_telno),
    email: normalizeEmail(census?.email_address),
    powerUnits: toInt(census?.power_units),
    drivers: toInt(census?.total_drivers),
    // Upper-case to match the exact 'S'/'C'/'U' the safety filter compares against
    // (the facet badge groups on upper(safety_rating), so an un-normalized value
    // would be counted in the badge but excluded by the filter).
    safetyRating: cleanStr(census?.safety_rating)?.toUpperCase() ?? null,
    authorityType: authorityType(li),
    intermodal: isIntermodal(census),
    // US carriers derive the port from the ZIP centroid; CA postal codes aren't in
    // the US ZCTA table, so CA carriers map by province → nearest Canadian gateway.
    nearestPortCode: country === 'CA' ? nearestCaPortForProvince(state) : nearestPortForZip(zip),
    publicSlug: makeSlug(legalName, usdot),
  };
}

/**
 * Filter + normalize a page of L&I rows against a census lookup (keyed by
 * NORMALIZED dot number). Pure — this is the unit under test. De-dupes within
 * the page by USDOT (a carrier can have >1 docket row).
 */
export function filterAndNormalizeCarriers(
  liRows: LiCarrierRow[],
  censusByDot: Map<string, CensusRow>,
  includeCanada = false,
): CarrierRecord[] {
  const out: CarrierRecord[] = [];
  const seen = new Set<string>();
  for (const li of liRows) {
    const dot = normalizeDot(li.dot_number);
    const census = dot ? censusByDot.get(dot) : undefined;
    const rec = normalizeCarrier(li, census, includeCanada);
    if (rec && !seen.has(rec.usdot)) {
      seen.add(rec.usdot);
      out.push(rec);
    }
  }
  return out;
}

// ─── Store (the only writer of carrier_directory in this module) ──────────
export interface CarrierStore {
  /** Idempotent bulk upsert by USDOT: one multi-row statement per chunk. */
  upsertMany(records: CarrierRecord[]): Promise<void>;
}

/** Rows per INSERT … ON CONFLICT statement. A whole L&I page (≤1000 filtered
 *  carriers) is written in ≤2 statements instead of ~2000 round-trips. */
export const UPSERT_BATCH = 500;

/**
 * The ON CONFLICT (usdot) DO UPDATE SET map — every MUTABLE column refreshed
 * from the incoming (EXCLUDED) row on a re-ingest.
 *
 * `contact_hidden` is DELIBERATELY ABSENT: it is the carrier opt-out flag and
 * must NEVER be overwritten by an ingest (it is also never inserted — the column
 * default false applies), so a carrier who emailed us to hide their contact
 * STAYS hidden across every future re-ingest. Exported so a unit test can assert
 * the opt-out is never in this SET.
 */
export const CARRIER_UPSERT_SET = {
  mcNumber: sql`excluded.mc_number`,
  legalName: sql`excluded.legal_name`,
  dbaName: sql`excluded.dba_name`,
  city: sql`excluded.city`,
  state: sql`excluded.state`,
  country: sql`excluded.country`,
  zip: sql`excluded.zip`,
  phone: sql`excluded.phone`,
  email: sql`excluded.email`,
  powerUnits: sql`excluded.power_units`,
  drivers: sql`excluded.drivers`,
  safetyRating: sql`excluded.safety_rating`,
  authorityType: sql`excluded.authority_type`,
  intermodal: sql`excluded.intermodal`,
  nearestPortCode: sql`excluded.nearest_port_code`,
  publicSlug: sql`excluded.public_slug`,
  updatedAt: sql`excluded.updated_at`,
} as const;

export const dbCarrierStore: CarrierStore = {
  async upsertMany(records) {
    if (records.length === 0) return;
    for (let i = 0; i < records.length; i += UPSERT_BATCH) {
      const chunk = records
        .slice(i, i + UPSERT_BATCH)
        .map((r) => ({ ...r, updatedAt: new Date() }));
      // Multi-row INSERT with ON CONFLICT (usdot) DO UPDATE — idempotent re-run
      // refreshes every mutable column from the incoming (EXCLUDED) row. The
      // page is already de-duped by USDOT so no row is affected twice in one
      // statement. Ordered paging means a carrier straddling a page boundary
      // simply lands as an UPDATE in the next statement.
      await db()
        .insert(carrierDirectory)
        .values(chunk)
        .onConflictDoUpdate({ target: carrierDirectory.usdot, set: CARRIER_UPSERT_SET });
    }
  },
};

// ─── Network (Socrata JSON API) ───────────────────────────────────────────
async function socrataJson<T>(resource: string, params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams(params).toString();
  const url = `${SOCRATA_BASE}/${resource}.json?${qs}`;
  const res = await fetch(url, { headers: { 'User-Agent': FETCH_UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Socrata ${resource} ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()) as T[];
}

/** Build the L&I $where, optionally restricted to physical state(s). */
export function buildCarrierWhere(states: string[]): string {
  if (states.length === 0) return CARRIER_WHERE;
  const inList = states.map((s) => `'${s.toUpperCase()}'`).join(',');
  return `${CARRIER_WHERE} AND bus_state_code in (${inList})`;
}

/** One page of active property carriers, ordered by dot_number for stable paging. */
export async function fetchCarrierPage(
  offset: number,
  limit: number,
  states: string[],
): Promise<LiCarrierRow[]> {
  return socrataJson<LiCarrierRow>(LI_CARRIER_ID, {
    $select:
      'docket_number,dot_number,common_stat,contract_stat,broker_stat,property_chk,passenger_chk,hhg_chk,legal_name,dba_name,bus_street_po,bus_city,bus_state_code,bus_zip_code,bus_telno',
    $where: buildCarrierWhere(states),
    $order: 'dot_number',
    $limit: String(limit),
    $offset: String(offset),
  });
}

/** Census rows for a batch of NORMALIZED dot numbers → Map keyed by normalized dot. */
export async function fetchCensusByDots(dots: string[]): Promise<Map<string, CensusRow>> {
  const map = new Map<string, CensusRow>();
  const unique = [...new Set(dots.filter(Boolean))];
  if (unique.length === 0) return map;
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const inList = chunk.map((d) => `'${d}'`).join(',');
    const rows = await socrataJson<CensusRow>(CENSUS_ID, {
      $select:
        'dot_number,legal_name,dba_name,email_address,power_units,total_drivers,safety_rating,status_code,crgo_intermodal,phone,phy_street,phy_city,phy_state,phy_zip',
      $where: `dot_number in (${inList})`,
      $limit: String(chunk.length),
    });
    for (const r of rows) {
      const dot = normalizeDot(r.dot_number);
      if (dot) map.set(dot, r);
    }
  }
  return map;
}

// ─── Ingest orchestrator ──────────────────────────────────────────────────
export interface IngestOptions {
  limit: number; // 0 = no cap
  offset: number;
  pageSize: number;
  states: string[];
  dryRun: boolean;
  /**
   * Include Canada-domiciled carriers (tagged country='CA'). DEFAULT false, so
   * the ingest output is byte-for-byte the current US-only set unless explicitly
   * enabled. When the field is omitted, runIngest falls back to the env switch
   * INGEST_INCLUDE_CANADA=1. Leaving both off keeps the live directory US-only.
   */
  includeCanada?: boolean;
}

export interface IngestSummary {
  carriersSeen: number;
  ingested: number;
  intermodal: number;
  stateCounts: Array<[string, number]>;
  portCounts: Array<[string, number]>;
}

export async function runIngest(
  opts: IngestOptions,
  store: CarrierStore = dbCarrierStore,
  deps: {
    fetchCarriers?: typeof fetchCarrierPage;
    fetchCensus?: typeof fetchCensusByDots;
    log?: (msg: string) => void;
  } = {},
): Promise<IngestSummary> {
  const fetchCarriers = deps.fetchCarriers ?? fetchCarrierPage;
  const fetchCensus = deps.fetchCensus ?? fetchCensusByDots;
  const log = deps.log ?? ((m: string) => console.log(m));
  // Effective Canada gate: explicit option wins; otherwise honor the env switch.
  // Default OFF → the ingest produces the exact current US-only set.
  const includeCanada = opts.includeCanada ?? process.env.INGEST_INCLUDE_CANADA === '1';

  let carriersSeen = 0;
  let ingested = 0;
  let intermodal = 0;
  const stateCounts = new Map<string, number>();
  const portCounts = new Map<string, number>();
  let offset = opts.offset;

  for (;;) {
    if (opts.limit > 0 && ingested >= opts.limit) break;
    const liRows = await fetchCarriers(offset, opts.pageSize, opts.states);
    if (liRows.length === 0) break;
    carriersSeen += liRows.length;

    const dots = liRows.map((r) => normalizeDot(r.dot_number)).filter((d): d is string => !!d);
    const censusByDot = await fetchCensus(dots);
    let records = filterAndNormalizeCarriers(liRows, censusByDot, includeCanada);

    // Honor --limit at the page boundary: trim this page's records so the total
    // never exceeds the cap, then bulk-upsert the (trimmed) page in one go.
    if (opts.limit > 0 && ingested + records.length > opts.limit) {
      records = records.slice(0, opts.limit - ingested);
    }

    for (const rec of records) {
      if (rec.intermodal) intermodal += 1;
      if (rec.state) stateCounts.set(rec.state, (stateCounts.get(rec.state) ?? 0) + 1);
      if (rec.nearestPortCode) portCounts.set(rec.nearestPortCode, (portCounts.get(rec.nearestPortCode) ?? 0) + 1);
    }
    if (!opts.dryRun) await store.upsertMany(records);
    ingested += records.length;

    log(`  …offset ${offset}: +${records.length} carriers (running total ${ingested}, intermodal ${intermodal})`);
    offset += liRows.length;
    if (liRows.length < opts.pageSize) break; // last page
  }

  const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    carriersSeen,
    ingested,
    intermodal,
    stateCounts: sortDesc(stateCounts),
    portCounts: sortDesc(portCounts),
  };
}

export type { CarrierDirectoryRow };
