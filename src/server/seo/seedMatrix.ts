/**
 * The seed matrix — the curated, deliberately tiny set of cuts the /guides
 * engine is allowed to generate from.
 *
 * ─── THE BUG THIS MODULE EXISTS TO NOT REPEAT ─────────────────────────────
 * The engine this is ported from shipped a seed matrix keyed on
 * `tradeType: "plumber"` while its database stored `"plumbing"`. Every cell
 * therefore matched zero rows, every cell fell below the data floor, and the
 * generator dutifully skipped all of them. The engine reported "0 pages
 * generated" — which is EXACTLY what a correctly-guardrailed engine with no
 * data reports — so the misconfiguration was indistinguishable from healthy
 * behaviour and sat undetected.
 *
 * Two structural fixes here, because "be more careful" is not a fix:
 *
 *   1. THE VALUES ARE REAL, AND SHAPED LIKE THE STORAGE. `carrier_directory`
 *      stores city names UPPERCASE ('HOUSTON', not 'Houston') — the same trap,
 *      one column over. Every seed cell below carries the literal stored value,
 *      and a separate `displayCity()` handles presentation. The two are never
 *      the same string.
 *
 *   2. ASSERT, LOUDLY. `assertSeedCells()` runs every cell against the live
 *      corpus and THROWS naming the offending cells if any matches zero rows.
 *      A zero-row cell is a configuration bug, not an empty market, and it must
 *      never again be silently absorbed by the anti-thin floor. The admin
 *      generate route calls this before it generates anything, so a drifted
 *      matrix fails visibly instead of quietly producing nothing.
 *
 * The matrix is a VALIDATION VEHICLE, not a firehose: a handful of cells, so
 * the guardrails can be proven on live SERPs before coverage is widened.
 * Widening means adding rows here (data-coverage-led), never an algorithmic
 * explosion across all 2,289 qualifying (state, city) cells.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { displayCity, type CarrierCut, CUT_EQUIPMENT } from './carrierDataService.js';

// Presentation vs storage lives with the cut itself; re-exported here because
// the matrix's keyword builders are its main consumer.
export { displayCity };

/** Hard ceiling on cells attempted per batch. Kept tiny so one run can never
 *  fire the firehose. A caller may pass less; more is clamped to this. */
export const DEFAULT_BATCH_LIMIT = 5;
export const MAX_BATCH_CELLS = 25;

/**
 * A generated page must clear this unique_data_score to be worth keeping. Below
 * it the cut's numbers are not meaningfully distinct from a sibling's. The
 * realistic minimum for a genuine cell is 5 percentile anchors + provenance +
 * capacity + a couple of equipment shares.
 */
export const MIN_UNIQUE_DATA_SCORE = 9;

/**
 * The curated seed cells. VALUES ARE THE LITERAL STORED VALUES — `state` is the
 * two-letter code, `city` is UPPERCASE exactly as `carrier_directory` holds it.
 * Verified against prod on 2026-08-29; carrier counts in the comments are the
 * live counts at that time, and assertSeedCells() re-verifies at runtime.
 */
export const SEED_CELLS: readonly CarrierCut[] = [
  // City cuts — the highest-volume real freight markets in the census.
  { kind: 'city', state: 'TX', city: 'HOUSTON' }, // 3,501 carriers
  { kind: 'city', state: 'CA', city: 'FRESNO' }, // 3,092
  { kind: 'city', state: 'IL', city: 'CHICAGO' }, // 1,945
  // Equipment cuts — a different page archetype (statewide capacity by trailer
  // type), so the guardrails get validated on both shapes, not just one.
  { kind: 'state_equipment', state: 'CA', equipment: 'reefer' }, // 7,065
  { kind: 'state_equipment', state: 'TX', equipment: 'intermodal' }, // 1,166
];

/** URL-safe slug from arbitrary text. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

/** The primary keyword a cell targets — also the slug source and the H1. */
export function cellKeyword(cut: CarrierCut): string {
  if (cut.kind === 'city') {
    return `trucking companies in ${displayCity(cut.city)}, ${cut.state}`;
  }
  return `${CUT_EQUIPMENT[cut.equipment].label} carriers in ${cut.state}`;
}

/** Stable slug for a cell — the dedup key shared with the generator. */
export function cellSlug(cut: CarrierCut): string {
  return slugify(cellKeyword(cut));
}

/* ─── The assertion (the fix for the ported bug) ──────────────────────── */

export interface SeedCellCount {
  cut: CarrierCut;
  keyword: string;
  count: number;
}

/** Count the live corpus rows a cell matches. Index-supported: every branch
 *  leads with `state` (carrier_directory_state_city_power_idx / _state_idx). */
export async function countSeedCell(cut: CarrierCut): Promise<number> {
  const where =
    cut.kind === 'city'
      ? sql`state = ${cut.state} AND city = ${cut.city}`
      : sql`state = ${cut.state} AND ${sql.raw(`"${CUT_EQUIPMENT[cut.equipment].column}"`)} IS TRUE`;
  const rows = (await db().execute(
    sql`SELECT count(*)::int AS n FROM carrier_directory WHERE ${where}`,
  )) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/** How a cell's live row count is obtained. Injected so the assertion below can
 *  be tested against the REAL function with no database. */
export type SeedCellCounter = (cut: CarrierCut) => Promise<number>;

/** Count every cell, without judging. Used by the admin screen to SHOW the
 *  matrix's health rather than only failing on it. */
export async function countSeedCells(
  cells: readonly CarrierCut[] = SEED_CELLS,
  counter: SeedCellCounter = countSeedCell,
): Promise<SeedCellCount[]> {
  const out: SeedCellCount[] = [];
  for (const cut of cells) {
    out.push({ cut, keyword: cellKeyword(cut), count: await counter(cut) });
  }
  return out;
}

/**
 * Verify every seed cell matches real rows, and THROW naming the bad ones if
 * not. This is the guard against the ported bug: a cell that matches zero rows
 * is a configuration error (wrong casing, renamed value, dropped column), and
 * must be distinguishable from "this market is genuinely small" — which the
 * anti-thin floor handles separately and silently.
 *
 * Returns the counts on success so the caller can log/display the matrix state.
 */
export async function assertSeedCells(
  cells: readonly CarrierCut[] = SEED_CELLS,
  counter: SeedCellCounter = countSeedCell,
): Promise<SeedCellCount[]> {
  const counts = await countSeedCells(cells, counter);
  const empty = counts.filter((c) => c.count === 0);
  if (empty.length > 0) {
    const detail = empty
      .map((c) =>
        c.cut.kind === 'city'
          ? `city(state=${c.cut.state}, city=${JSON.stringify(c.cut.city)})`
          : `equipment(state=${c.cut.state}, ${c.cut.equipment})`,
      )
      .join(', ');
    throw new Error(
      `SEO seed matrix is stale: ${empty.length} of ${counts.length} cells match ZERO carrier_directory rows — ${detail}. ` +
        'This is a configuration bug, not an empty market (check stored value casing: city is UPPERCASE in carrier_directory). ' +
        'Refusing to generate against a matrix that cannot produce data.',
    );
  }
  return counts;
}
