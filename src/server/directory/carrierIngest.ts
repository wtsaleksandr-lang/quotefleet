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
 *       docket_number (MC), dot_number, legal/dba name, address, phone, AND the
 *       INSURANCE FILINGS (bipd_file / min_cov_amount / cargo_file / bond_file).
 *       NOTE: FMCSA froze this file on 14 May 2026 — see ./carrierCredentials.ts.
 *   - Company Census file                        — resource az4n-8mr2
 *       Supplies power_units, total_drivers, safety_rating + safety_rating_date,
 *       add_date (when FMCSA registered the carrier), the physical address, a
 *       live status_code (A/I), and the cargo-classification flags — notably
 *       crgo_intermodal='X', which marks container / drayage carriers.
 *       Keyed by dot_number (L&I dot_number is zero-padded; strip leading zeros
 *       to join — which also drops L&I's `00000000` sentinel, ~278 rows inside
 *       our filter, that would otherwise collapse into one bogus carrier).
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
import { exchangeTimeoutSignal } from '../../http/responseBody.js';
import {
  CRASH_ID,
  EMPTY_SAFETY,
  SMS_AB_ID,
  buildCarrierSafety,
  crashWindowStart,
  type CarrierSafety,
  type CrashAggRow,
  type SmsSafetyRow,
} from './safetyData.js';
import { buildCarrierCredentials, type CarrierCredentials } from './carrierCredentials.js';

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
  // ── Insurance filings. Same row, previously unread. Amounts are zero-padded
  //    THOUSANDS of dollars ("00750" = $750,000); see ./carrierCredentials.ts.
  /** BIPD liability ON FILE, thousands. "00000" ⇒ no filing on record. */
  bipd_file?: string;
  /** Minimum BIPD this authority REQUIRES, thousands. */
  min_cov_amount?: string;
  /** Cargo-insurance filing on record — 'Y'/'N'. */
  cargo_file?: string;
  /** Surety-bond filing on record — 'Y'/'N'. */
  bond_file?: string;
}

export interface CensusRow {
  dot_number?: string;
  legal_name?: string;
  dba_name?: string;
  email_address?: string;
  power_units?: string;
  total_drivers?: string;
  safety_rating?: string;
  /** YYYYMMDD the rating was assigned. Present on 100% of rated carriers, and
   *  most published ratings are years old — so it always travels with the
   *  rating. See ./carrierCredentials.ts. */
  safety_rating_date?: string;
  /** YYYYMMDD FMCSA created the USDOT record. A FLOOR on tenure, not a founding
   *  date. 100% coverage; the 19740601 bulk-load sentinel is parsed to null. */
  add_date?: string;
  status_code?: string;
  crgo_intermodal?: string;
  /** Census hazmat indicator: 'Y' when FMCSA-registered to haul hazardous
   *  materials, else 'N'. Confirmed live on census az4n-8mr2. */
  hm_ind?: string;
  // ── FMCSA cargo-classification flags ('X' when set) — all confirmed live on
  //    az4n-8mr2 (probed 2026-08-20). NOTE: there is NO `crgo_reefer` column on
  //    this resource — refrigerated freight is `crgo_coldfood`. Tanker/liquids is
  //    `crgo_liqgas` (+ `crgo_chem`); flatbed/oversized has no single column so
  //    we OR the heavy/dimensional flags (metalsheet / machlrg / logpole).
  /** Dry van / general freight. */
  crgo_genfreight?: string;
  /** Reefer / temperature-controlled (refrigerated food). */
  crgo_coldfood?: string;
  /** Tanker — bulk liquids / gases. */
  crgo_liqgas?: string;
  /** Tanker — chemicals (OR'd into the tanker flag). */
  crgo_chem?: string;
  /** Flatbed — metal / coils / sheet. */
  crgo_metalsheet?: string;
  /** Flatbed — large machinery. */
  crgo_machlrg?: string;
  /** Flatbed — logs / poles / lumber. */
  crgo_logpole?: string;
  /** Dry bulk (aggregates, grain-in-bulk, etc.). */
  crgo_drybulk?: string;
  // ── Additional FMCSA cargo-CLASS specialties ('X' when set) — all confirmed
  //    live on az4n-8mr2 (probed 2026-08-20). Shipper-relevant specialties beyond
  //    the equipment flags above.
  /** Household goods / HHG. */
  crgo_household?: string;
  /** Liquor / beverages. */
  crgo_beverages?: string;
  /** Fresh produce. */
  crgo_produce?: string;
  /** Motor vehicles. */
  crgo_motoveh?: string;
  /** Livestock. */
  crgo_livestock?: string;
  /** Grain & feed. */
  crgo_grainfeed?: string;
  /** Oilfield equipment / supplies. */
  crgo_oilfield?: string;
  /** Meat / perishable. */
  crgo_meat?: string;
  /** Paper products. */
  crgo_paperprod?: string;
  /** Construction. */
  crgo_construct?: string;
  /** Farm supplies. */
  crgo_farmsupp?: string;
  /** Coal / coke. */
  crgo_coalcoke?: string;
  /** Building materials. */
  crgo_bldgmat?: string;
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
  /** FMCSA-verified hazmat carrier (census hm_ind === 'Y'). */
  hazmat: boolean;
  // ── Equipment / cargo-type flags derived from the FMCSA census crgo_* columns.
  //    Default false (no census match ⇒ all false), so a carrier is unchanged
  //    until a re-ingest populates the flags.
  /** Dry van / general freight (crgo_genfreight). */
  dryVan: boolean;
  /** Reefer / temperature-controlled (crgo_coldfood). */
  reefer: boolean;
  /** Tanker — bulk liquids / gas / chemicals (crgo_liqgas OR crgo_chem). */
  tanker: boolean;
  /** Flatbed / oversized (crgo_metalsheet OR crgo_machlrg OR crgo_logpole). */
  flatbed: boolean;
  /** Dry bulk (crgo_drybulk). */
  dryBulk: boolean;
  // ── Additional FMCSA cargo-CLASS specialties (crgo_* columns). Default false
  //    (no census match ⇒ all false), unchanged until a re-ingest populates them.
  /** Household goods / HHG (crgo_household). */
  householdGoods: boolean;
  /** Liquor / beverages (crgo_beverages). */
  beverages: boolean;
  /** Fresh produce (crgo_produce). */
  produce: boolean;
  /** Motor vehicles (crgo_motoveh). */
  motorVehicles: boolean;
  /** Livestock (crgo_livestock). */
  livestock: boolean;
  /** Grain & feed (crgo_grainfeed). */
  grainFeed: boolean;
  /** Oilfield equipment / supplies (crgo_oilfield). */
  oilfield: boolean;
  /** Meat / perishable (crgo_meat). */
  meat: boolean;
  /** Paper products (crgo_paperprod). */
  paper: boolean;
  /** Construction (crgo_construct). */
  construction: boolean;
  /** Farm supplies (crgo_farmsupp). */
  farmSupplies: boolean;
  /** Coal / coke (crgo_coalcoke). */
  coalCoke: boolean;
  /** Building materials (crgo_bldgmat). */
  buildingMaterials: boolean;
  nearestPortCode: string | null;
  publicSlug: string;
  /**
   * FMCSA safety record (roadside inspections / out-of-service orders / crashes)
   * over FMCSA's rolling 24-month window. Every field nullable — `null` means
   * "FMCSA published no record", never "zero". See ./safetyData.ts for the
   * sources, the rejected ones, and the honesty contract.
   */
  safety: CarrierSafety;
  /**
   * FMCSA insurance filings (L&I) + the registration and safety-rating dates
   * (census). Both source rows were already being fetched, so this costs no
   * extra request. Amounts are in DOLLARS; `null` means "no such filing on
   * record", never zero. See ./carrierCredentials.ts — in particular that a
   * filing is NOT proof of current coverage, and that FMCSA froze the L&I file
   * on 14 May 2026.
   */
  credentials: CarrierCredentials;
}

/**
 * Per-page safety lookups handed to the pure normalizer. Kept as ONE object so
 * adding safety didn't turn `normalizeCarrier` into a seven-positional-argument
 * function (and so every existing call site + fixture stays valid — the param is
 * optional and defaults to "no safety data").
 */
export interface SafetyLookup {
  /** SMS AB PassProperty rows, keyed by NORMALIZED dot number. */
  sms: Map<string, SmsSafetyRow>;
  /** Crash-file aggregates for the window, keyed by NORMALIZED dot number. */
  crashes: Map<string, CrashAggRow>;
  /** One consistent as-of stamp for the whole run. Null ⇒ no safety data. */
  asOf: Date | null;
  /** True only when the crash query actually SUCCEEDED for this page — which is
   *  what makes "absent from the group-by result" mean a real zero crashes
   *  rather than an unknown. */
  crashQueried: boolean;
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

/** Census hm_ind marks an FMCSA-registered hazmat carrier. The census file
 *  reports it as 'Y'/'N'; sibling cargo flags elsewhere use 'X', so accept
 *  both truthy conventions and treat anything else (incl. missing census) as
 *  not-hazmat. */
export function isHazmat(census: CensusRow | undefined): boolean {
  const v = census?.hm_ind?.trim().toUpperCase();
  return v === 'Y' || v === 'X';
}

/** True when a census crgo_* flag is set. FMCSA marks these with 'X'. */
function cargoFlag(v: string | undefined): boolean {
  return v?.trim().toUpperCase() === 'X';
}

/** Dry van / general freight — census crgo_genfreight === 'X'. */
export function isDryVan(census: CensusRow | undefined): boolean {
  return cargoFlag(census?.crgo_genfreight);
}

/** Reefer / temperature-controlled — census crgo_coldfood === 'X'.
 *  (There is NO crgo_reefer column on az4n-8mr2; crgo_coldfood is the
 *  refrigerated-freight classification.) */
export function isReefer(census: CensusRow | undefined): boolean {
  return cargoFlag(census?.crgo_coldfood);
}

/** Tanker — bulk liquids/gas OR chemicals (crgo_liqgas OR crgo_chem === 'X'). */
export function isTanker(census: CensusRow | undefined): boolean {
  return cargoFlag(census?.crgo_liqgas) || cargoFlag(census?.crgo_chem);
}

/** Flatbed / oversized — heavy/dimensional freight. Best-effort OR of the
 *  metal-sheet, large-machinery and log/pole flags (no single flatbed column). */
export function isFlatbed(census: CensusRow | undefined): boolean {
  return (
    cargoFlag(census?.crgo_metalsheet) ||
    cargoFlag(census?.crgo_machlrg) ||
    cargoFlag(census?.crgo_logpole)
  );
}

/** Dry bulk — census crgo_drybulk === 'X'. */
export function isDryBulk(census: CensusRow | undefined): boolean {
  return cargoFlag(census?.crgo_drybulk);
}

/**
 * Additional FMCSA cargo-CLASS specialties, each a straight census crgo_* === 'X'
 * flag (no OR-combining like the equipment helpers above — every one maps to a
 * single verified column). Returns all-false for a missing census row. Exported
 * so the ingest + unit tests share the exact mapping.
 */
export function cargoClassFlags(census: CensusRow | undefined): {
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
} {
  return {
    householdGoods: cargoFlag(census?.crgo_household),
    beverages: cargoFlag(census?.crgo_beverages),
    produce: cargoFlag(census?.crgo_produce),
    motorVehicles: cargoFlag(census?.crgo_motoveh),
    livestock: cargoFlag(census?.crgo_livestock),
    grainFeed: cargoFlag(census?.crgo_grainfeed),
    oilfield: cargoFlag(census?.crgo_oilfield),
    meat: cargoFlag(census?.crgo_meat),
    paper: cargoFlag(census?.crgo_paperprod),
    construction: cargoFlag(census?.crgo_construct),
    farmSupplies: cargoFlag(census?.crgo_farmsupp),
    coalCoke: cargoFlag(census?.crgo_coalcoke),
    buildingMaterials: cargoFlag(census?.crgo_bldgmat),
  };
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

/**
 * Derive a carrier's nearest hub code from its domicile — the SINGLE source of
 * truth for the ZIP/province → port mapping. US carriers resolve via the ZIP
 * centroid (nearestPortForZip); CA postal codes aren't in the US ZCTA table, so
 * CA carriers map by province → nearest Canadian gateway (nearestCaPortForProvince).
 *
 * Both the ingest (normalizeCarrier, below) AND the boot-time re-derivation
 * backfill (src/server/directory/backfillNearestPort.ts) call THIS function, so
 * the two can never disagree: a change to the derivation (a new hub, a radius
 * tweak) flows into both at once. `country`/`state` are expected upper-cased.
 */
export function deriveNearestPortCode(
  country: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): string | null {
  return country === 'CA' ? nearestCaPortForProvince(state) : nearestPortForZip(zip);
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
  safety: CarrierSafety = EMPTY_SAFETY,
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
    hazmat: isHazmat(census),
    dryVan: isDryVan(census),
    reefer: isReefer(census),
    tanker: isTanker(census),
    flatbed: isFlatbed(census),
    dryBulk: isDryBulk(census),
    ...cargoClassFlags(census),
    // US carriers derive the port from the ZIP centroid; CA postal codes aren't in
    // the US ZCTA table, so CA carriers map by province → nearest Canadian gateway.
    // Shared with the re-derivation backfill via deriveNearestPortCode().
    nearestPortCode: deriveNearestPortCode(country, state, zip),
    publicSlug: makeSlug(legalName, usdot),
    safety,
    // Insurance filings off the SAME L&I row, dates off the SAME census row —
    // both already in hand here, so this is free.
    credentials: buildCarrierCredentials(li, census),
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
  safetyLookup?: SafetyLookup,
): CarrierRecord[] {
  const out: CarrierRecord[] = [];
  const seen = new Set<string>();
  for (const li of liRows) {
    const dot = normalizeDot(li.dot_number);
    const census = dot ? censusByDot.get(dot) : undefined;
    const safety = safetyLookup
      ? buildCarrierSafety(
          dot ? safetyLookup.sms.get(dot) : undefined,
          dot ? safetyLookup.crashes.get(dot) : undefined,
          safetyLookup.asOf,
          safetyLookup.crashQueried,
        )
      : EMPTY_SAFETY;
    const rec = normalizeCarrier(li, census, includeCanada, safety);
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
 * Every column the re-ingest overwrites, as its DATABASE name, in the order the
 * SET below lists them. This is the tuple compared to decide whether a carrier
 * ACTUALLY changed (see CARRIER_CHANGED_SQL) — `updated_at` is excluded because
 * it is the thing being decided, and `contact_hidden` because the ingest never
 * touches it.
 *
 * Derived by hand rather than from the drizzle table so a NEW column cannot be
 * silently omitted: `cargoClasses.test.ts` asserts this list and the SET map
 * cover exactly the same columns, so adding one to either without the other
 * fails CI.
 */
export const CARRIER_MUTABLE_COLUMNS: readonly string[] = [
  'mc_number',
  'legal_name',
  'dba_name',
  'city',
  'state',
  'country',
  'zip',
  'phone',
  'email',
  'power_units',
  'drivers',
  'safety_rating',
  'authority_type',
  'intermodal',
  'hazmat',
  'dry_van',
  'reefer',
  'tanker',
  'flatbed',
  'dry_bulk',
  'household_goods',
  'beverages',
  'produce',
  'motor_vehicles',
  'livestock',
  'grain_feed',
  'oilfield',
  'meat',
  'paper',
  'construction',
  'farm_supplies',
  'coal_coke',
  'building_materials',
  'nearest_port_code',
  'public_slug',
  // ── FMCSA safety block. Listed here so the change-detection tuple (and the
  //    parity test in carrierRichness.test.ts) covers them, but written through
  //    the CONDITIONAL expression below rather than a bare `excluded.` — see
  //    CARRIER_SAFETY_COLUMNS.
  ...['insp_total',
    'driver_insp_total',
    'driver_oos_total',
    'vehicle_insp_total',
    'vehicle_oos_total',
    'crashes_total',
    'crashes_fatal',
    'crashes_injury',
    'crashes_tow',
    'safety_data_as_of'],
  // ── FMCSA credentials. Ordinary UNCONDITIONAL columns, unlike the safety
  //    block above, and deliberately so: they ride the two fetches the ingest
  //    cannot proceed without (a failed L&I page throws out of the loop, a
  //    failed census fetch aborts the run), so there is no "partial success"
  //    state to protect against — the conditional keep-or-replace expression
  //    would be dead code here.
  //
  //    They are also all STABLE facts (a filed coverage amount, a registration
  //    date, a rating date), never a per-run timestamp. That is what keeps them
  //    out of the fake-freshness trap: an unchanged carrier compares equal in
  //    CARRIER_CHANGED_SQL week after week, so `updated_at` does not move and
  //    the sitemap's <lastmod> stays truthful across all ~330k rows.
  'bipd_on_file',
  'bipd_required',
  'cargo_insurance_on_file',
  'bond_on_file',
  'fmcsa_registered_since',
  'safety_rating_date',
];

/**
 * The safety columns, which are the ONE exception to "every data column is
 * written unconditionally".
 *
 * WHY: the safety block comes from two extra Socrata calls per page. If one of
 * them fails (timeout, 5xx, portal maintenance) the page still ingests — we do
 * not want a flaky safety feed to stall the whole 330k-carrier directory
 * refresh. But a bare `excluded.insp_total` would then write NULL over a
 * perfectly good stored safety record, and the profile would silently lose its
 * safety block until the next weekly run got lucky.
 *
 * So the whole block is written ATOMICALLY, gated on the incoming as-of stamp:
 *   - incoming `safety_data_as_of` IS NOT NULL  → the fetch succeeded; take ALL
 *     incoming values, INCLUDING nulls (a null there is meaningful: it means
 *     FMCSA has no SMS row for this carrier).
 *   - incoming `safety_data_as_of` IS NULL      → the fetch did not happen or
 *     failed; KEEP the stored block untouched.
 *
 * Because the same expression feeds CARRIER_CHANGED_SQL, a failed fetch also
 * compares equal to what is stored — so it does NOT bump `updated_at`, does NOT
 * produce a fake `<lastmod>`, and does NOT enqueue a pointless IndexNow ping.
 */
export const CARRIER_SAFETY_COLUMNS: readonly string[] = [
  'insp_total',
  'driver_insp_total',
  'driver_oos_total',
  'vehicle_insp_total',
  'vehicle_oos_total',
  'crashes_total',
  'crashes_fatal',
  'crashes_injury',
  'crashes_tow',
  'safety_data_as_of',
];

/** The atomic keep-or-replace expression for one safety column. */
export function safetyColumnSql(col: string): string {
  return `CASE WHEN excluded."safety_data_as_of" IS NOT NULL THEN excluded."${col}" ELSE "carrier_directory"."${col}" END`;
}

/** True for a column governed by the conditional safety expression above. */
const isSafetyColumn = (c: string): boolean => CARRIER_SAFETY_COLUMNS.includes(c);

/**
 * TRUTHFUL `updated_at`: advance it ONLY when the incoming census row actually
 * differs from the stored one.
 *
 * WHY THIS MATTERS (measured on prod 2026-08-29): the weekly re-ingest rewrites
 * all ~330k rows and used to stamp `updated_at = now()` on every one of them,
 * changed or not. `updated_at` is what the sitemap publishes as `<lastmod>` — so
 * every Sunday we were telling every crawler that all 330,218 carrier pages had
 * just changed, when in reality almost none had. That is fake freshness, and it
 * is actively harmful: a crawler that refetches on a `<lastmod>` promise, finds
 * a byte-identical page, and repeats that 330k times learns to STOP TRUSTING our
 * lastmod entirely — which is the opposite of what a site fighting for crawl
 * budget needs. (The measurement: min(updated_at) 2026-08-20, max 2026-08-23,
 * spread across 3 calendar days — a stamp of when the ingest ran, carrying zero
 * information about the carrier.)
 *
 * It is also what makes IndexNow possible at all: with a per-row change signal,
 * `indexnow_submissions` can announce a carrier exactly once and then only when
 * it genuinely changes. Without it, every weekly ingest would look like 330k
 * changed URLs — the unchanged-resubmission the protocol punishes.
 *
 * A ROW-WISE `IS DISTINCT FROM` (not `<>`) so a NULL→NULL column reads as "same"
 * instead of poisoning the comparison to NULL.
 *
 * DELIBERATELY CONSERVATIVE: only the TIMESTAMP is made conditional. Every data
 * column is still written unconditionally, exactly as before. `ON CONFLICT …
 * WHERE` would additionally skip the write for unchanged rows (fewer dead
 * tuples, less WAL) — but then a column accidentally missing from the comparison
 * tuple would mean REAL DATA silently failing to update. With the CASE, the
 * worst case of an omission is a slightly stale `lastmod`. That asymmetry is
 * worth the dead tuples on a weekly job.
 */
export const CARRIER_CHANGED_SQL = `(${CARRIER_MUTABLE_COLUMNS.map(
  (c) => `"carrier_directory"."${c}"`,
).join(', ')}) IS DISTINCT FROM (${CARRIER_MUTABLE_COLUMNS.map((c) =>
  // Safety columns compare their EFFECTIVE (post-CASE) value, not the raw
  // incoming one — otherwise a failed safety fetch would read as "everything
  // went null", mark all 330k rows changed, and reintroduce exactly the fake
  // weekly freshness this comparison exists to prevent.
  isSafetyColumn(c) ? safetyColumnSql(c) : `excluded."${c}"`,
).join(', ')})`;

/** The conditional `updated_at` assignment itself. Exported as TEXT (rather than
 *  only as the drizzle `sql` object below) so a unit test can assert the ELSE
 *  branch really does preserve the stored timestamp — a bare
 *  `excluded.updated_at` is what produced the fake weekly freshness. */
export const CARRIER_UPDATED_AT_SQL = `CASE WHEN ${CARRIER_CHANGED_SQL} THEN excluded."updated_at" ELSE "carrier_directory"."updated_at" END`;

/**
 * The ON CONFLICT (usdot) DO UPDATE SET map — every MUTABLE column refreshed
 * from the incoming (EXCLUDED) row on a re-ingest.
 *
 * `contact_hidden` is DELIBERATELY ABSENT: it is the carrier opt-out flag and
 * must NEVER be overwritten by an ingest (it is also never inserted — the column
 * default false applies), so a carrier who emailed us to hide their contact
 * STAYS hidden across every future re-ingest. Exported so a unit test can assert
 * the opt-out is never in this SET.
 *
 * `updated_at` is the one CONDITIONAL entry — see CARRIER_CHANGED_SQL above.
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
  hazmat: sql`excluded.hazmat`,
  dryVan: sql`excluded.dry_van`,
  reefer: sql`excluded.reefer`,
  tanker: sql`excluded.tanker`,
  flatbed: sql`excluded.flatbed`,
  dryBulk: sql`excluded.dry_bulk`,
  householdGoods: sql`excluded.household_goods`,
  beverages: sql`excluded.beverages`,
  produce: sql`excluded.produce`,
  motorVehicles: sql`excluded.motor_vehicles`,
  livestock: sql`excluded.livestock`,
  grainFeed: sql`excluded.grain_feed`,
  oilfield: sql`excluded.oilfield`,
  meat: sql`excluded.meat`,
  paper: sql`excluded.paper`,
  construction: sql`excluded.construction`,
  farmSupplies: sql`excluded.farm_supplies`,
  coalCoke: sql`excluded.coal_coke`,
  buildingMaterials: sql`excluded.building_materials`,
  nearestPortCode: sql`excluded.nearest_port_code`,
  publicSlug: sql`excluded.public_slug`,
  // FMCSA safety block — atomic keep-or-replace, gated on the incoming as-of
  // stamp so a failed safety fetch preserves the stored record instead of
  // nulling it. See CARRIER_SAFETY_COLUMNS.
  inspTotal: sql.raw(safetyColumnSql('insp_total')),
  driverInspTotal: sql.raw(safetyColumnSql('driver_insp_total')),
  driverOosTotal: sql.raw(safetyColumnSql('driver_oos_total')),
  vehicleInspTotal: sql.raw(safetyColumnSql('vehicle_insp_total')),
  vehicleOosTotal: sql.raw(safetyColumnSql('vehicle_oos_total')),
  crashesTotal: sql.raw(safetyColumnSql('crashes_total')),
  crashesFatal: sql.raw(safetyColumnSql('crashes_fatal')),
  crashesInjury: sql.raw(safetyColumnSql('crashes_injury')),
  crashesTow: sql.raw(safetyColumnSql('crashes_tow')),
  safetyDataAsOf: sql.raw(safetyColumnSql('safety_data_as_of')),
  // FMCSA credentials — plain unconditional refresh (see CARRIER_MUTABLE_COLUMNS).
  bipdOnFile: sql`excluded.bipd_on_file`,
  bipdRequired: sql`excluded.bipd_required`,
  cargoInsuranceOnFile: sql`excluded.cargo_insurance_on_file`,
  bondOnFile: sql`excluded.bond_on_file`,
  fmcsaRegisteredSince: sql`excluded.fmcsa_registered_since`,
  safetyRatingDate: sql`excluded.safety_rating_date`,
  // Advances ONLY on a real field change, so <lastmod> stays truthful and the
  // IndexNow change feed stays honest. See CARRIER_CHANGED_SQL.
  updatedAt: sql.raw(CARRIER_UPDATED_AT_SQL),
} as const;

export const dbCarrierStore: CarrierStore = {
  async upsertMany(records) {
    if (records.length === 0) return;
    for (let i = 0; i < records.length; i += UPSERT_BATCH) {
      const chunk = records.slice(i, i + UPSERT_BATCH).map(({ safety, credentials, ...r }) => ({
        ...r,
        // Flatten the nested safety + credential blocks onto the row — the
        // drizzle table has one column per field, and a nested object would be
        // dropped silently.
        ...safety,
        ...credentials,
        updatedAt: new Date(),
      }));
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
/** Per-Socrata-call deadline, covering headers AND the body read. */
const SOCRATA_TIMEOUT_MS = 60_000;

async function socrataJson<T>(resource: string, params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams(params).toString();
  const url = `${SOCRATA_BASE}/${resource}.json?${qs}`;
  // Whole-exchange deadline. This is the ONLY network primitive behind the
  // ~1,700-call full-directory ingest loop; without it a hung Socrata pins one
  // socket per call, permanently.
  const res = await fetch(url, {
    headers: { 'User-Agent': FETCH_UA, Accept: 'application/json' },
    signal: exchangeTimeoutSignal(SOCRATA_TIMEOUT_MS),
  });
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
      'docket_number,dot_number,common_stat,contract_stat,broker_stat,property_chk,passenger_chk,hhg_chk,legal_name,dba_name,bus_street_po,bus_city,bus_state_code,bus_zip_code,bus_telno,bipd_file,min_cov_amount,cargo_file,bond_file',
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
        'dot_number,legal_name,dba_name,email_address,power_units,total_drivers,safety_rating,safety_rating_date,add_date,status_code,crgo_intermodal,hm_ind,crgo_genfreight,crgo_coldfood,crgo_liqgas,crgo_chem,crgo_metalsheet,crgo_machlrg,crgo_logpole,crgo_drybulk,crgo_household,crgo_beverages,crgo_produce,crgo_motoveh,crgo_livestock,crgo_grainfeed,crgo_oilfield,crgo_meat,crgo_paperprod,crgo_construct,crgo_farmsupp,crgo_coalcoke,crgo_bldgmat,phone,phy_street,phy_city,phy_state,phy_zip',
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

/**
 * Dots per safety request. 1000 (a whole L&I page in ONE call) — measured
 * against the live portal: a 1000-item `IN` list is a ~15KB URL and both
 * resources answer it in ~0.5s. That keeps the safety enrichment at +2 calls
 * per 1000-carrier page instead of the +10 the census's 200-dot chunking would
 * have cost, which is what keeps the full ingest inside its existing runtime
 * envelope rather than adding hours.
 */
export const SAFETY_CHUNK = 1000;

/**
 * SMS AB PassProperty rows for a batch of NORMALIZED dot numbers → Map keyed by
 * normalized dot. One row per carrier, already aggregated by FMCSA over its
 * rolling 24-month measurement period.
 */
export async function fetchSafetyByDots(dots: string[]): Promise<Map<string, SmsSafetyRow>> {
  const map = new Map<string, SmsSafetyRow>();
  const unique = [...new Set(dots.filter(Boolean))];
  if (unique.length === 0) return map;
  for (let i = 0; i < unique.length; i += SAFETY_CHUNK) {
    const chunk = unique.slice(i, i + SAFETY_CHUNK);
    const inList = chunk.map((d) => `'${d}'`).join(',');
    const rows = await socrataJson<SmsSafetyRow>(SMS_AB_ID, {
      $select:
        'dot_number,insp_total,driver_insp_total,driver_oos_insp_total,vehicle_insp_total,vehicle_oos_insp_total',
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

/**
 * Crash counts for a batch of NORMALIZED dot numbers over the rolling window →
 * Map keyed by normalized dot.
 *
 * The Crash File is 4.98M rows (one per vehicle per state-reported crash), so
 * this AGGREGATES SERVER-SIDE with SoQL `$group=dot_number`: we transfer at most
 * one row per carrier instead of every crash report. Note every numeric column
 * on that resource is TEXT — `sum(fatalities)` is a hard type-mismatch error, so
 * the `::number` casts below are load-bearing, not decoration.
 *
 * A carrier ABSENT from the result had zero crashes in the window (a real zero,
 * which is why the caller passes crashQueried=true only when this SUCCEEDED).
 */
export async function fetchCrashesByDots(
  dots: string[],
  windowStart: string = crashWindowStart(),
): Promise<Map<string, CrashAggRow>> {
  const map = new Map<string, CrashAggRow>();
  const unique = [...new Set(dots.filter(Boolean))];
  if (unique.length === 0) return map;
  for (let i = 0; i < unique.length; i += SAFETY_CHUNK) {
    const chunk = unique.slice(i, i + SAFETY_CHUNK);
    const inList = chunk.map((d) => `'${d}'`).join(',');
    const rows = await socrataJson<CrashAggRow>(CRASH_ID, {
      $select:
        "dot_number,count(*) as crashes,sum(fatalities::number) as fatalities,sum(injuries::number) as injuries,sum(case(tow_away='Y',1,true,0)) as tow_aways",
      $where: `report_date>'${windowStart}' AND dot_number in (${inList})`,
      $group: 'dot_number',
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
   * Include Canada-domiciled carriers (tagged country='CA'). When the field is
   * omitted, runIngest DEFAULTS this ON (the directory is North-America-wide);
   * set INGEST_INCLUDE_CANADA=0 to force the legacy US-only ingest. The pure
   * normalize helpers (normalizeCarrier / filterAndNormalizeCarriers) still
   * default their own param to false, so only runIngest changes the live default.
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
    fetchSafety?: typeof fetchSafetyByDots;
    fetchCrashes?: typeof fetchCrashesByDots;
    now?: () => Date;
    log?: (msg: string) => void;
  } = {},
): Promise<IngestSummary> {
  const fetchCarriers = deps.fetchCarriers ?? fetchCarrierPage;
  const fetchCensus = deps.fetchCensus ?? fetchCensusByDots;
  const fetchSafety = deps.fetchSafety ?? fetchSafetyByDots;
  const fetchCrashes = deps.fetchCrashes ?? fetchCrashesByDots;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.log(m));
  // ONE as-of stamp + ONE crash window for the whole run, so every carrier in a
  // single ingest reports the same "safety data as of" date and the crash
  // windows can't drift across a multi-hour job.
  const runAsOf = now();
  const windowStart = crashWindowStart(runAsOf);
  // Effective Canada gate: explicit option wins; otherwise DEFAULT ON so the
  // ingest produces the full North-America set. INGEST_INCLUDE_CANADA=0 forces
  // the legacy US-only ingest.
  const includeCanada = opts.includeCanada ?? process.env.INGEST_INCLUDE_CANADA !== '0';

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

    // ── FMCSA safety enrichment (2 extra calls per page). DELIBERATELY
    //    NON-FATAL and independently isolated: the directory's core value is the
    //    carrier list, so a flaky or down safety feed must degrade to "no safety
    //    block on this page" rather than abort a 330k-row refresh. When a fetch
    //    fails, asOf/crashQueried stay off for that half and the conditional
    //    upsert (CARRIER_SAFETY_COLUMNS) PRESERVES whatever is already stored.
    let smsByDot = new Map<string, SmsSafetyRow>();
    let smsOk = false;
    try {
      smsByDot = await fetchSafety(dots);
      smsOk = true;
    } catch (err) {
      log(`  …WARN: safety (SMS) fetch failed at offset ${offset} (non-fatal): ${String(err)}`);
    }
    let crashByDot = new Map<string, CrashAggRow>();
    let crashOk = false;
    try {
      crashByDot = await fetchCrashes(dots, windowStart);
      crashOk = true;
    } catch (err) {
      log(`  …WARN: safety (crash) fetch failed at offset ${offset} (non-fatal): ${String(err)}`);
    }
    const safetyLookup: SafetyLookup = {
      sms: smsByDot,
      crashes: crashByDot,
      // Only stamp an as-of when at least ONE half genuinely succeeded —
      // otherwise the row would claim a safety reading it never took.
      asOf: smsOk || crashOk ? runAsOf : null,
      crashQueried: crashOk,
    };

    let records = filterAndNormalizeCarriers(liRows, censusByDot, includeCanada, safetyLookup);

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

  // The FMCSA data just changed → PRECOMPUTE + PERSIST the global directory
  // aggregates (summary + unfiltered base facet counts) OFF the request path so
  // the /directory index serves them from a single-row lookup and never runs a
  // 330k-row scan on a user request (the recurring all-domains-down outage). Only
  // on a real write run (never a dry run). Best-effort: a recompute failure must
  // NEVER fail the ingest — the boot/cron safety nets will retry. Imported lazily
  // so the pure normalize/filter helpers (unit-tested without a DB) don't pull in
  // the query layer.
  if (!opts.dryRun) {
    try {
      const { recomputeAndPersistDirectoryAggregates } = await import('./queries.js');
      await recomputeAndPersistDirectoryAggregates();
      log('  …precomputed + persisted global directory aggregates');
    } catch (err) {
      log(`  …WARN: failed to persist directory aggregates (non-fatal): ${String(err)}`);
    }
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
