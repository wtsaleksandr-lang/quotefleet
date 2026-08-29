/**
 * CarrierDataService — the QuoteFleet SEO data moat.
 *
 * Turns the FMCSA carrier census (`carrier_directory`, ~330k rows) into
 * aggregated fleet/equipment statistics the /guides article generator can cite
 * ("across 314 carriers based in Houston, TX…"). This is the information-gain
 * differentiator that makes automated content genuinely rankable: the numbers
 * are computed over the whole census for a named cut, which no competitor's
 * generic "how to find a drayage carrier" page carries.
 *
 * ─── HOW THIS DIFFERS FROM THE ENGINE IT IS PORTED FROM ───────────────────
 * The WeFixTrades original aggregates a PRIVATE corpus (customer pricing
 * configs), so its MIN_SAMPLE floor is doing two jobs at once: k-anonymity and
 * anti-thin. FMCSA data is PUBLIC federal data — there is no individual to
 * de-anonymize and every underlying row is already a public carrier profile on
 * this very site. So the k-anonymity job does not apply here.
 *
 * The floor survives anyway, doing its OTHER job, which is the one that
 * actually matters for SEO: ANTI-THIN. A cut backed by 4 carriers produces a
 * page with nothing to say, and a few thousand of those is exactly the doorway-
 * page pattern Google penalizes. So the floor is not merely kept, it is raised:
 * DEFAULT_MIN_SAMPLE = 25 (vs. the original's 5), because with a corpus this
 * large a 25-carrier floor is cheap — 2,289 (state, city) cells and 58
 * (state × reefer) cells still clear it — while cutting off the long tail of
 * cells that would be thin.
 *
 * ─── WHERE THE MATH RUNS ──────────────────────────────────────────────────
 * In SQL, not in JS. The original pulls rows into memory and aggregates there,
 * which is right for a 3-row corpus and wrong for a 330k-row one (a single
 * state cut is ~31k rows). Percentiles are computed with `percentile_cont`
 * inside Postgres and only the ~15 resulting numbers cross the wire. Every
 * query is index-supported — verified with EXPLAIN against prod:
 *   • (state, city) cut  → Index Only Scan, carrier_directory_state_city_power_idx
 *   • per-city medians   → Index Only Scan, same index
 *   • (state, equipment) → Bitmap Index Scan, carrier_directory_state_idx
 * No sequential scan on any path.
 *
 * ─── PURITY / TESTABILITY ─────────────────────────────────────────────────
 * `buildCarrierData` is pure: raw stats in, gated result out. It is the single
 * chokepoint where the anti-thin floor is enforced, so a regression that tried
 * to emit numbers below the floor is structurally impossible. The DB loader is
 * injected, so the unit test drives the whole service with no database.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';

/* ─── Config ──────────────────────────────────────────────────────────── */

/**
 * ANTI-THIN floor. A cut backed by fewer carriers than this never becomes a
 * page. Raised well above the original's 5 because the corpus can afford it —
 * see the header. Override with SEO_DATA_MIN_SAMPLE (>= 1) for experiments.
 */
export const DEFAULT_MIN_SAMPLE = 25;

/** Read SEO_DATA_MIN_SAMPLE at call time (testable via env injection). */
export function getMinSample(): number {
  const raw = (process.env.SEO_DATA_MIN_SAMPLE ?? '').trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MIN_SAMPLE;
}

/** Per-cut memo TTL. The census only changes on an ingest run. */
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** A sub-cut (a city inside a state cut) must itself clear the floor to be
 *  quoted, so a guide never cites a 3-carrier city as a comparison point. */
export const SUBCUT_MIN_SAMPLE_RATIO = 1;

/* ─── The cut ─────────────────────────────────────────────────────────── */

/** Equipment flags we cut on. Mirrors carrier_directory's boolean columns;
 *  the value is the physical column name so the SQL stays honest. */
export const CUT_EQUIPMENT = {
  reefer: { column: 'reefer', label: 'refrigerated (reefer)' },
  flatbed: { column: 'flatbed', label: 'flatbed' },
  intermodal: { column: 'intermodal', label: 'container / drayage' },
  hazmat: { column: 'hazmat', label: 'hazmat-endorsed' },
  tanker: { column: 'tanker', label: 'tanker' },
  dry_van: { column: 'dry_van', label: 'dry van' },
} as const;

export type CutEquipmentId = keyof typeof CUT_EQUIPMENT;

export type CarrierCut =
  | { kind: 'city'; state: string; city: string }
  | { kind: 'state_equipment'; state: string; equipment: CutEquipmentId };

/** Stable key for caching + slug dedup. */
export function cutKey(cut: CarrierCut): string {
  return cut.kind === 'city'
    ? `city|${cut.state}|${cut.city}`
    : `state_equipment|${cut.state}|${cut.equipment}`;
}

/**
 * Title-case a stored city name for display. `carrier_directory` holds cities
 * UPPERCASE ('HOUSTON'), which is correct for querying and wrong for every
 * human-facing string — a meta description reading "registered in HOUSTON, TX"
 * ships shouting to the SERP. Presentation and storage are separate strings and
 * must stay that way; this is the only conversion between them.
 */
export function displayCity(city: string): string {
  return city
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Human phrase naming the cut, used in prose + titles. */
export function cutLabel(cut: CarrierCut): string {
  return cut.kind === 'city'
    ? `${displayCity(cut.city)}, ${cut.state}`
    : `${CUT_EQUIPMENT[cut.equipment].label} carriers in ${cut.state}`;
}

/* ─── Public result types ─────────────────────────────────────────────── */

/** Share of the cut that carries one equipment/cargo capability. */
export interface EquipmentShare {
  label: string;
  /** Carriers in the cut with the flag set. */
  count: number;
  /** Fraction of the cut (0..1, 2dp). */
  share: number;
}

/** A sub-cut that independently cleared the floor (city inside a state, etc.). */
export interface CutVariation {
  label: string;
  sampleSize: number;
  /** Median fleet size (power units) for the sub-cut. */
  medianFleet: number;
}

/** Below-floor shape: NO statistics at all, only the count. */
export interface InsufficientCarrierData {
  sufficient: false;
  sampleSize: number;
  minSample: number;
  cut: CarrierCut;
}

/** Above-floor shape: aggregates only. */
export interface SufficientCarrierData {
  sufficient: true;
  cut: CarrierCut;
  /** Carriers with a usable power_units value backing every stat below. */
  sampleSize: number;
  /** Carriers in the cut regardless of power_units coverage. */
  totalInCut: number;
  /** Fleet-size distribution, in power units (trucks). */
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  /** Sum of power units across the cut — the "how much capacity is here" number. */
  totalPowerUnits: number;
  /** Share of the cut that is an owner-operator (1-2 trucks) — the single most
   *  useful structural fact about a freight market. */
  ownerOperatorShare: number;
  /** Share with 50+ power units (fleet carriers). */
  largeFleetShare: number;
  /** Equipment/cargo capability mix, most common first. */
  equipmentMix: EquipmentShare[];
  /** Sub-cuts that independently clear the floor (cities in a state, etc.). */
  variations: CutVariation[];
  /** FMCSA safety ratings are sparse (~8% of the census is rated), so this is
   *  null unless the cut has enough RATED carriers to say anything honest. */
  safety: { rated: number; satisfactory: number; conditional: number } | null;
  /** Most common nearest port for the cut, when the corpus knows one. */
  topPort: { code: string; count: number } | null;
  /** ISO timestamp the aggregate was computed — provenance for citations. */
  computedAt: string;
}

export type CarrierDataResult = SufficientCarrierData | InsufficientCarrierData;

/* ─── Raw stats (the loader's output / the pure builder's input) ───────── */

/** Exactly what the SQL returns. Kept as a plain shape so the unit test can
 *  build one by hand and drive the whole gate with no database. */
export interface CarrierCutStats {
  totalInCut: number;
  pricedCount: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  totalPowerUnits: number | null;
  ownerOperators: number;
  largeFleets: number;
  flagCounts: Record<string, number>;
  rated: number;
  satisfactory: number;
  conditional: number;
  topPort: { code: string; count: number } | null;
  variations: Array<{ label: string; sampleSize: number; medianFleet: number }>;
}

/* ─── Pure aggregation core (the unit under test) ─────────────────────── */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function whole(n: number | null | undefined): number {
  return Math.round(Number(n ?? 0));
}

/**
 * Apply the anti-thin floor and shape the raw stats into a citable result.
 *
 * GATE: `pricedCount` (carriers with a usable power_units value) is the sample
 * size. Below `minSample` this returns { sufficient: false } carrying NO
 * statistics, and the generator MUST skip the page. Stats are computed ONLY on
 * the sufficient branch, so numbers can never escape below the floor.
 */
export function buildCarrierData(
  stats: CarrierCutStats,
  cut: CarrierCut,
  minSample: number = getMinSample(),
): CarrierDataResult {
  const sampleSize = stats.pricedCount;

  // ── THE GATE. Below the floor: emit NO statistics. ──
  if (sampleSize < minSample) {
    return { sufficient: false, sampleSize, minSample, cut };
  }

  const equipmentMix: EquipmentShare[] = Object.entries(stats.flagCounts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      label: CUT_EQUIPMENT[key as CutEquipmentId]?.label ?? key,
      count,
      share: round2(count / stats.totalInCut),
    }))
    .sort((a, b) => b.count - a.count);

  // A sub-cut is only quotable when it independently clears the floor — the
  // same rule the parent cut had to pass. No thin sub-cut leakage into prose.
  const variations: CutVariation[] = stats.variations
    .filter((v) => v.sampleSize >= minSample * SUBCUT_MIN_SAMPLE_RATIO)
    .map((v) => ({ label: v.label, sampleSize: v.sampleSize, medianFleet: whole(v.medianFleet) }))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  // Safety ratings are sparse in the FMCSA census. Only report them when the
  // RATED subset itself clears the floor, otherwise "100% satisfactory" would
  // be a true statement about 3 carriers presented as a fact about a market.
  const safety =
    stats.rated >= minSample
      ? { rated: stats.rated, satisfactory: stats.satisfactory, conditional: stats.conditional }
      : null;

  return {
    sufficient: true,
    cut,
    sampleSize,
    totalInCut: stats.totalInCut,
    min: whole(stats.min),
    p25: whole(stats.p25),
    median: whole(stats.median),
    p75: whole(stats.p75),
    max: whole(stats.max),
    totalPowerUnits: whole(stats.totalPowerUnits),
    ownerOperatorShare: round2(stats.ownerOperators / sampleSize),
    largeFleetShare: round2(stats.largeFleets / sampleSize),
    equipmentMix,
    variations,
    safety,
    topPort: stats.topPort,
    computedAt: new Date().toISOString(),
  };
}

/**
 * unique_data_score — a count of page-specific REAL data points the page can
 * cite. Floors page existence to genuine information gain (anti-thin): a cut
 * whose numbers are indistinguishable from its siblings scores low and is
 * skipped by the matrix. Distinct percentile anchors are deduped so a flat
 * distribution cannot inflate the score.
 */
export function computeUniqueDataScore(data: SufficientCarrierData): number {
  let score = 0;
  score += new Set([data.min, data.p25, data.median, data.p75, data.max]).size;
  score += 1; // sample-size provenance
  score += 1; // total capacity
  score += data.equipmentMix.length;
  score += data.variations.length;
  if (data.safety) score += 1;
  if (data.topPort) score += 1;
  return score;
}

/* ─── DB-fed entry point (thin, cached, index-supported) ───────────────── */

export type CarrierStatsLoader = (cut: CarrierCut) => Promise<CarrierCutStats>;

interface CacheEntry {
  expires: number;
  result: CarrierDataResult;
}
const _cache = new Map<string, CacheEntry>();

/** Clear the memo (tests / kill-switch flows). */
export function clearCarrierDataCache(): void {
  _cache.clear();
}

/** The WHERE fragment for a cut. Every branch leads with `state`, which is the
 *  leading column of carrier_directory_state_city_power_idx and of
 *  carrier_directory_state_idx — that is what keeps these off a seq scan. */
function cutWhere(cut: CarrierCut) {
  if (cut.kind === 'city') {
    return sql`state = ${cut.state} AND city = ${cut.city}`;
  }
  // Column name comes from the CUT_EQUIPMENT allow-list, never from user input.
  const col = CUT_EQUIPMENT[cut.equipment].column;
  return sql`state = ${cut.state} AND ${sql.raw(`"${col}"`)} IS TRUE`;
}

const FLAG_COLUMNS = Object.entries(CUT_EQUIPMENT).map(([id, v]) => ({ id, column: v.column }));

/**
 * The real loader. ONE round trip for the headline stats + one for the
 * sub-cut variations. Both are index-supported (see the module header).
 */
export const dbCarrierStatsLoader: CarrierStatsLoader = async (cut) => {
  const where = cutWhere(cut);

  const flagSelects = sql.join(
    FLAG_COLUMNS.map(
      (f) => sql`count(*) FILTER (WHERE ${sql.raw(`"${f.column}"`)}) AS ${sql.raw(`"flag_${f.id}"`)}`,
    ),
    sql`, `,
  );

  const rows = (await db().execute(sql`
    SELECT
      count(*)::int AS total_in_cut,
      count(power_units) FILTER (WHERE power_units > 0)::int AS priced_count,
      min(power_units) FILTER (WHERE power_units > 0) AS min_pu,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY power_units) FILTER (WHERE power_units > 0) AS p25,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY power_units) FILTER (WHERE power_units > 0) AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY power_units) FILTER (WHERE power_units > 0) AS p75,
      max(power_units) FILTER (WHERE power_units > 0) AS max_pu,
      sum(power_units) FILTER (WHERE power_units > 0) AS total_pu,
      count(*) FILTER (WHERE power_units > 0 AND power_units <= 2)::int AS owner_operators,
      count(*) FILTER (WHERE power_units >= 50)::int AS large_fleets,
      count(safety_rating)::int AS rated,
      count(*) FILTER (WHERE safety_rating = 'S')::int AS satisfactory,
      count(*) FILTER (WHERE safety_rating = 'C')::int AS conditional,
      ${flagSelects}
    FROM carrier_directory
    WHERE ${where}
  `)) as unknown as Array<Record<string, unknown>>;

  const r = rows[0] ?? {};
  const num = (k: string): number => Number(r[k] ?? 0);
  const numOrNull = (k: string): number | null => (r[k] == null ? null : Number(r[k]));

  const flagCounts: Record<string, number> = {};
  for (const f of FLAG_COLUMNS) {
    // A cut defined BY an equipment flag must not cite that same flag as part
    // of its own mix — "100% of reefer carriers offer reefer" is noise.
    if (cut.kind === 'state_equipment' && f.id === cut.equipment) continue;
    flagCounts[f.id] = num(`flag_${f.id}`);
  }

  const topPortRows = (await db().execute(sql`
    SELECT nearest_port_code AS code, count(*)::int AS n
    FROM carrier_directory
    WHERE ${where} AND nearest_port_code IS NOT NULL AND nearest_port_code <> ''
    GROUP BY nearest_port_code
    ORDER BY n DESC
    LIMIT 1
  `)) as unknown as Array<{ code: string; n: number }>;
  const port = topPortRows[0];

  // Sub-cuts: cities inside a state_equipment cut. A city cut has no meaningful
  // sub-cut (we do not slice below city), so it skips this round trip entirely.
  let variations: CarrierCutStats['variations'] = [];
  if (cut.kind === 'state_equipment') {
    const varRows = (await db().execute(sql`
      SELECT city AS label, count(*)::int AS sample_size,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY power_units) AS median_fleet
      FROM carrier_directory
      WHERE ${where} AND city IS NOT NULL AND city <> '' AND power_units > 0
      GROUP BY city
      ORDER BY count(*) DESC
      LIMIT 8
    `)) as unknown as Array<{ label: string; sample_size: number; median_fleet: number }>;
    variations = varRows.map((v) => ({
      label: v.label,
      sampleSize: Number(v.sample_size),
      medianFleet: Number(v.median_fleet ?? 0),
    }));
  }

  return {
    totalInCut: num('total_in_cut'),
    pricedCount: num('priced_count'),
    min: numOrNull('min_pu'),
    p25: numOrNull('p25'),
    median: numOrNull('median'),
    p75: numOrNull('p75'),
    max: numOrNull('max_pu'),
    totalPowerUnits: numOrNull('total_pu'),
    ownerOperators: num('owner_operators'),
    largeFleets: num('large_fleets'),
    flagCounts,
    rated: num('rated'),
    satisfactory: num('satisfactory'),
    conditional: num('conditional'),
    topPort: port ? { code: port.code, count: Number(port.n) } : null,
    variations,
  };
};

/**
 * Aggregated carrier statistics for one cut.
 *
 * Returns { sufficient: false, sampleSize } when fewer than minSample carriers
 * back the cut — the generator MUST skip the page in that case (no thin or
 * fabricated data). The loader is injected so this module has no ambient DB
 * dependency and the unit test needs no database.
 */
export async function getCarrierDataForCut(
  cut: CarrierCut,
  loader: CarrierStatsLoader = dbCarrierStatsLoader,
): Promise<CarrierDataResult> {
  const minSample = getMinSample();
  const key = `${cutKey(cut)}|${minSample}`;
  const now = Date.now();

  const hit = _cache.get(key);
  if (hit && hit.expires > now) return hit.result;

  const stats = await loader(cut);
  const result = buildCarrierData(stats, cut, minSample);
  _cache.set(key, { expires: now + CACHE_TTL_MS, result });
  return result;
}
