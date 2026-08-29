/**
 * The seed matrix — and the bug it was written to not repeat.
 *
 * The source engine's matrix queried `tradeType:"plumber"` against a database
 * storing `"plumbing"`. Every cell matched zero rows, the anti-thin floor
 * skipped all of them, and the engine reported "0 generated" — which is also
 * what a healthy engine with no data reports. The misconfiguration was
 * invisible.
 *
 * So: a zero-row cell must be LOUD. These tests hold that line, and the casing
 * test holds the equivalent trap one column over (carrier_directory stores city
 * names UPPERCASE).
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_UNIQUE_DATA_SCORE,
  MAX_BATCH_CELLS,
  DEFAULT_BATCH_LIMIT,
  SEED_CELLS,
  assertSeedCells,
  countSeedCells,
  cellKeyword,
  cellSlug,
  displayCity,
  slugify,
} from './seedMatrix.js';
import type { CarrierCut } from './carrierDataService.js';

describe('assertSeedCells — the loud failure', () => {
  // The corpus counter is injected, so these drive the REAL assertSeedCells.
  // The fake matches exactly like the SQL does: exact string equality.
  const corpus = async (c: CarrierCut) =>
    c.kind === 'city' && c.state === 'TX' && c.city === 'HOUSTON' ? 3501 : 0;

  it('throws, naming the offending cells, when a cell matches zero rows', async () => {
    const cells: CarrierCut[] = [
      { kind: 'city', state: 'TX', city: 'HOUSTON' },
      { kind: 'city', state: 'TX', city: 'Houston' }, // wrong casing — the bug
    ];
    await expect(assertSeedCells(cells, corpus)).rejects.toThrow(/ZERO carrier_directory rows/);
    await expect(assertSeedCells(cells, corpus)).rejects.toThrow(/"Houston"/);
  });

  it('explains that a zero-row cell is a config bug, not an empty market', async () => {
    const cells: CarrierCut[] = [{ kind: 'city', state: 'ZZ', city: 'NOWHERE' }];
    await expect(assertSeedCells(cells, async () => 0)).rejects.toThrow(
      /configuration bug, not an empty market/,
    );
  });

  it('names the equipment cut shape too', async () => {
    const cells: CarrierCut[] = [{ kind: 'state_equipment', state: 'ZZ', equipment: 'reefer' }];
    await expect(assertSeedCells(cells, async () => 0)).rejects.toThrow(/equipment\(state=ZZ, reefer\)/);
  });

  it('passes and returns counts when every cell is real', async () => {
    const cells: CarrierCut[] = [{ kind: 'city', state: 'TX', city: 'HOUSTON' }];
    const counts = await assertSeedCells(cells, corpus);
    expect(counts).toHaveLength(1);
    expect(counts[0].count).toBe(3501);
  });

  it("does NOT throw on a small-but-real cell — that is the floor's job, silently", async () => {
    // 4 carriers is a real market that is too thin to write about. The floor
    // skips it quietly; only ZERO means misconfiguration.
    const cells: CarrierCut[] = [{ kind: 'city', state: 'MT', city: 'CIRCLE' }];
    await expect(assertSeedCells(cells, async () => 4)).resolves.toHaveLength(1);
  });

  it('countSeedCells reports health without judging it', async () => {
    const cells: CarrierCut[] = [
      { kind: 'city', state: 'TX', city: 'HOUSTON' },
      { kind: 'city', state: 'ZZ', city: 'NOWHERE' },
    ];
    const counts = await countSeedCells(cells, corpus);
    expect(counts.map((c) => c.count)).toEqual([3501, 0]);
  });
});

describe('the shipped seed cells', () => {
  it('stores city names in the corpus casing (UPPERCASE), not display casing', () => {
    // This is the exact shape of the ported bug. carrier_directory holds
    // 'HOUSTON'; a cell carrying 'Houston' would match nothing.
    for (const cell of SEED_CELLS) {
      if (cell.kind === 'city') expect(cell.city).toBe(cell.city.toUpperCase());
    }
  });

  it('uses two-letter state codes', () => {
    for (const cell of SEED_CELLS) expect(cell.state).toMatch(/^[A-Z]{2}$/);
  });

  it('stays a validation vehicle, not a firehose', () => {
    expect(SEED_CELLS.length).toBeLessThanOrEqual(MAX_BATCH_CELLS);
    expect(DEFAULT_BATCH_LIMIT).toBeLessThanOrEqual(MAX_BATCH_CELLS);
  });

  it('covers both page archetypes so the guardrails are proven on each', () => {
    expect(SEED_CELLS.some((c) => c.kind === 'city')).toBe(true);
    expect(SEED_CELLS.some((c) => c.kind === 'state_equipment')).toBe(true);
  });

  it('produces a unique slug per cell', () => {
    const slugs = SEED_CELLS.map(cellSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('display vs storage are separate strings', () => {
  it('title-cases for humans without touching the query value', () => {
    expect(displayCity('HOUSTON')).toBe('Houston');
    expect(displayCity('LOS ANGELES')).toBe('Los Angeles');
  });

  it('builds readable keywords and URL-safe slugs', () => {
    expect(cellKeyword({ kind: 'city', state: 'TX', city: 'HOUSTON' })).toBe(
      'trucking companies in Houston, TX',
    );
    expect(cellSlug({ kind: 'city', state: 'TX', city: 'HOUSTON' })).toBe(
      'trucking-companies-in-houston-tx',
    );
  });

  it('slugifies safely', () => {
    expect(slugify("O'Fallon / St. Louis")).toBe('ofallon-st-louis');
    expect(slugify('  --Trim Me--  ')).toBe('trim-me');
  });
});

describe('score floor', () => {
  it('demands more than the bare percentile anchors', () => {
    expect(MIN_UNIQUE_DATA_SCORE).toBeGreaterThan(6);
  });
});
