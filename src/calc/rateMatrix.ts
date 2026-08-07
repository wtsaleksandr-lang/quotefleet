/**
 * Rate-matrix native pricing — origin×dest / zone / drayage per-container.
 *
 * Tier 2 of rate ingestion. Where Tier 1 FLATTENED a matrix to lane_zones and
 * warned, this prices a shipment against a REAL matrix cell:
 *
 *   1. Resolve a shipment's origin + destination each to an ordered set of
 *      MATRIX KEYS (exact zip5 → zip3 → named zone → city/state), most-specific
 *      first, handling Excel's dropped leading zeros.
 *   2. Find the matrix cell whose (origin_key, dest_key) best matches — DIRECTIONAL
 *      (A→B ≠ B→A) — preferring the most specific origin+dest and an
 *      equipment-specific cell over a generic one.
 *   3. Price the cell per its `unit_basis` (flat / per_mile×miles / per_container),
 *      then apply the min-charge floor.
 *
 * PURE module — no DB, no side effects. Structural input types so the engine can
 * pass DB rows (RateMatrix / RateZone) OR the loose in-memory preview shapes.
 * (The only import is the static port-code alias table — pure data, no I/O.)
 *
 * See docs/RATE-INGESTION-RESEARCH.md patterns 1 (origin×dest matrix),
 * 3 (zone defs + zone×zone grid) and 5 (drayage port→zone per-container).
 */

import { expandPortAliases } from '../data/ports.js';

/** Unit the matrix cell's `rate` is expressed in. */
export type MatrixUnitBasis = 'flat' | 'per_mile' | 'per_container';

/** How a rate_zone maps a shipment location to a matrix key. */
export type ZoneMatchKind = 'zip5' | 'zip3' | 'city_state' | 'zip_range';

/** One priced matrix cell. Structural subset of the `rate_matrices` DB row. */
export interface MatrixCellInput {
  id?: number;
  /** Service mode this cell prices, e.g. 'ftl' | 'drayage'. */
  mode: string;
  /** Equipment/container this cell is scoped to; null/empty = any. */
  equipment?: string | null;
  originKey: string;
  destKey: string;
  rate: number;
  unitBasis: string;
  minCharge?: number | null;
  currency?: string | null;
  enabled?: boolean;
}

/** One zone definition. Structural subset of the `rate_zones` DB row. */
export interface ZoneDefInput {
  zoneId: string;
  matchKind: string;
  matchValue?: string | null;
  matchFrom?: string | null;
  matchTo?: string | null;
  enabled?: boolean;
}

/** A resolved location — only the fields matrix keying needs. */
export interface MatrixLocation {
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  /** Drayage anchor: a port / UN-LOCODE (e.g. "USLAX") used as a matrix key. */
  portCode?: string | null;
}

function digits(s?: string | null): string {
  return String(s ?? '').replace(/\D/g, '');
}

/**
 * Normalize a shipment ZIP to a 5-digit string, restoring the leading zero(s)
 * Excel drops (07001 → 7001). Returns null when there aren't enough digits to
 * be a full zip5 (≤3 digits is treated as a zip3 elsewhere).
 */
export function normalizeZip5(zip?: string | null): string | null {
  const d = digits(zip);
  if (!d) return null;
  if (d.length >= 5) return d.slice(0, 5);
  if (d.length === 4) return d.padStart(5, '0');
  return null;
}

/** The 3-digit ZIP prefix (zip3) for a shipment ZIP, dropped-zero aware. */
export function zip3Of(zip?: string | null): string | null {
  const d = digits(zip);
  if (!d) return null;
  if (d.length >= 5) return d.slice(0, 3);
  if (d.length === 4) return d.padStart(5, '0').slice(0, 3);
  if (d.length === 3) return d;
  return null;
}

function cityStateKey(city?: string | null, state?: string | null): string | null {
  const c = String(city ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  const s = String(state ?? '').toLowerCase().trim();
  if (!c || !s) return null;
  return `${c},${s}`;
}

/**
 * Canonicalize a matrix key or a candidate key for comparison. Purely-numeric
 * (zip-like) keys drop leading zeros symmetrically (so a stored "7001" key and a
 * shipment "07001" match, and a zip3 "070" matches a "70"); everything else is
 * lowercased with whitespace collapsed (zone ids, "city,st").
 */
export function normMatrixKey(k?: string | null): string {
  const t = String(k ?? '').trim();
  if (!t) return '';
  if (/^\d+$/.test(t)) return String(parseInt(t, 10));
  return t.toLowerCase().replace(/\s+/g, ' ');
}

function zoneMatches(
  z: ZoneDefInput,
  z5: string | null,
  z3: string | null,
  loc: MatrixLocation,
): boolean {
  if (z.enabled === false) return false;
  const kind = String(z.matchKind);
  if (kind === 'zip5') return z5 != null && normMatrixKey(z.matchValue) === normMatrixKey(z5);
  if (kind === 'zip3') return z3 != null && normMatrixKey(z.matchValue) === normMatrixKey(z3);
  if (kind === 'city_state') {
    const ck = cityStateKey(loc.city, loc.state);
    return ck != null && normMatrixKey(z.matchValue) === normMatrixKey(ck);
  }
  if (kind === 'zip_range') {
    const boundLen = Math.max(digits(z.matchFrom).length, digits(z.matchTo).length);
    const cmp = boundLen > 0 && boundLen <= 3 ? z3 : z5;
    if (cmp == null) return false;
    const n = parseInt(digits(cmp), 10);
    const from = parseInt(digits(z.matchFrom), 10);
    const to = parseInt(digits(z.matchTo), 10);
    if (![n, from, to].every(Number.isFinite)) return false;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return n >= lo && n <= hi;
  }
  return false;
}

/**
 * Build a map of every matrix key this location can resolve to → its
 * specificity rank (0 = exact zip5, best … 3 = city/state, loosest). When a key
 * is reachable multiple ways the BEST (lowest) rank is kept.
 */
export function buildKeyRanks(
  loc: MatrixLocation,
  zones: ZoneDefInput[],
): Map<string, number> {
  const m = new Map<string, number>();
  const add = (k: string | null, rank: number) => {
    if (k == null || k === '') return;
    const nk = normMatrixKey(k);
    if (!nk) return;
    const cur = m.get(nk);
    if (cur === undefined || rank < cur) m.set(nk, rank);
  };
  const z5 = normalizeZip5(loc.zip);
  const z3 = zip3Of(loc.zip);
  // Drayage port anchor — an exact key. Expand through the port-code alias
  // groups so a matrix lane keyed on one code (e.g. sheet's USEWR, or a
  // combined USLAX/USLGB pool) matches a shipment resolved to any equivalent
  // code (e.g. autosuggest's USNYC). Every alias is an exact-specificity key.
  for (const pc of expandPortAliases(loc.portCode)) add(pc, 0);
  add(z5, 0); // exact zip5
  add(z3, 1); // zip3 prefix
  for (const z of zones) {
    if (zoneMatches(z, z5, z3, loc)) add(z.zoneId, 2); // named zone
  }
  add(cityStateKey(loc.city, loc.state), 3); // city/state
  return m;
}

export interface MatrixMatch {
  cell: MatrixCellInput;
  originRank: number;
  destRank: number;
}

/**
 * Find the best matrix cell for a shipment. DIRECTIONAL: origin resolves against
 * `originKey`, destination against `destKey` — never swapped. Precedence: lowest
 * combined origin+dest specificity rank wins; then an equipment-specific cell
 * over a generic one; then the higher id (newer row) as a deterministic tiebreak.
 */
export function findMatrixCell(
  cells: MatrixCellInput[],
  zones: ZoneDefInput[],
  loc: { origin: MatrixLocation; dest: MatrixLocation; service: string; equipment?: string },
): MatrixMatch | undefined {
  if (!cells.length) return undefined;
  const oRanks = buildKeyRanks(loc.origin, zones);
  const dRanks = buildKeyRanks(loc.dest, zones);
  if (oRanks.size === 0 || dRanks.size === 0) return undefined;

  let best:
    | { cell: MatrixCellInput; originRank: number; destRank: number; score: number; equipGeneric: number }
    | undefined;

  for (const c of cells) {
    if (c.enabled === false) continue;
    if (String(c.mode).toLowerCase() !== String(loc.service).toLowerCase()) continue;
    if (c.equipment && loc.equipment && String(c.equipment) !== String(loc.equipment)) continue;
    const originRank = oRanks.get(normMatrixKey(c.originKey));
    const destRank = dRanks.get(normMatrixKey(c.destKey));
    if (originRank === undefined || destRank === undefined) continue;
    const score = originRank + destRank;
    const equipGeneric = c.equipment ? 0 : 1; // prefer equipment-specific (0) over generic (1)
    const better =
      !best ||
      score < best.score ||
      (score === best.score && equipGeneric < best.equipGeneric) ||
      (score === best.score && equipGeneric === best.equipGeneric && (c.id ?? 0) > (best.cell.id ?? 0));
    if (better) best = { cell: c, originRank, destRank, score, equipGeneric };
  }

  return best ? { cell: best.cell, originRank: best.originRank, destRank: best.destRank } : undefined;
}

export interface MatrixPrice {
  /** Priced linehaul after the min-charge floor. */
  amount: number;
  /** Raw cell price before the floor (rate, or rate×miles). */
  base: number;
  /** True when the min-charge floor lifted the price above the raw base. */
  floored: boolean;
}

/**
 * Price one matrix cell per its unit basis, then apply the min-charge floor.
 *   - flat / per_container → the cell rate (one move / one container)
 *   - per_mile            → rate × miles
 * total linehaul = max(base, min_charge).
 */
export function matrixLinehaul(cell: MatrixCellInput, miles: number): MatrixPrice {
  const rate = Number(cell.rate) || 0;
  const basis = String(cell.unitBasis || 'flat');
  const base = basis === 'per_mile' ? rate * Math.max(0, Number(miles) || 0) : rate;
  const min = Number(cell.minCharge) || 0;
  const amount = Math.max(base, min);
  return { amount, base, floored: min > 0 && amount > base };
}
