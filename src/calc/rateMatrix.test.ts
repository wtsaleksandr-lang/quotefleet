/**
 * Unit tests for the pure rate-matrix module — zone/key resolution, directional
 * cell matching, precedence, and per-unit pricing. No DB, no network.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeZip5,
  zip3Of,
  normMatrixKey,
  buildKeyRanks,
  findMatrixCell,
  matrixLinehaul,
  type MatrixCellInput,
  type ZoneDefInput,
} from './rateMatrix.js';

describe('zip normalization — dropped leading zeros', () => {
  it('normalizeZip5 restores the leading zero Excel drops (7001 → 07001)', () => {
    expect(normalizeZip5('07001')).toBe('07001');
    expect(normalizeZip5('7001')).toBe('07001'); // 4-digit → pad
    expect(normalizeZip5('90802-1234')).toBe('90802');
    expect(normalizeZip5('902')).toBeNull(); // 3 digits = zip3, not a zip5
    expect(normalizeZip5('')).toBeNull();
  });
  it('zip3Of derives the 3-digit prefix, dropped-zero aware', () => {
    expect(zip3Of('90210')).toBe('902');
    expect(zip3Of('7001')).toBe('070'); // 07001 → 070
    expect(zip3Of('070')).toBe('070');
    expect(zip3Of('07')).toBeNull();
  });
  it('normMatrixKey drops leading zeros on numeric keys symmetrically', () => {
    expect(normMatrixKey('07001')).toBe(normMatrixKey('7001'));
    expect(normMatrixKey('070')).toBe(normMatrixKey('70'));
    expect(normMatrixKey(' Zone A ')).toBe('zone a');
    expect(normMatrixKey('Los Angeles,CA')).toBe('los angeles,ca');
  });
});

describe('buildKeyRanks — specificity ordering', () => {
  it('ranks exact zip5 (0) < zip3 (1) < named zone (2) < city/state (3)', () => {
    const zones: ZoneDefInput[] = [
      { zoneId: 'A', matchKind: 'zip3', matchValue: '902' },
    ];
    const ranks = buildKeyRanks({ zip: '90210', city: 'Beverly Hills', state: 'CA' }, zones);
    expect(ranks.get(normMatrixKey('90210'))).toBe(0);
    expect(ranks.get(normMatrixKey('902'))).toBe(1);
    expect(ranks.get(normMatrixKey('A'))).toBe(2);
    expect(ranks.get(normMatrixKey('beverly hills,ca'))).toBe(3);
  });

  it('zip_range legend resolves a zip into its zone', () => {
    const zones: ZoneDefInput[] = [
      { zoneId: 'W', matchKind: 'zip_range', matchFrom: '900', matchTo: '902' },
      { zoneId: 'E', matchKind: 'zip_range', matchFrom: '850', matchTo: '852' },
    ];
    expect(buildKeyRanks({ zip: '90185' }, zones).get(normMatrixKey('W'))).toBe(2);
    expect(buildKeyRanks({ zip: '85210' }, zones).get(normMatrixKey('E'))).toBe(2);
    expect(buildKeyRanks({ zip: '60007' }, zones).get(normMatrixKey('W'))).toBeUndefined();
  });
});

function cell(o: Partial<MatrixCellInput>): MatrixCellInput {
  return { mode: 'ftl', originKey: '900', destKey: '850', rate: 1000, unitBasis: 'flat', ...o };
}

describe('findMatrixCell — directional match + precedence', () => {
  const zones: ZoneDefInput[] = [
    { zoneId: 'W', matchKind: 'zip_range', matchFrom: '900', matchTo: '902', enabled: true },
    { zoneId: 'E', matchKind: 'zip_range', matchFrom: '850', matchTo: '852', enabled: true },
  ];

  it('prices the correct cell for a zip3 lane', () => {
    const cells = [cell({ id: 1, originKey: '900', destKey: '850', rate: 1900 })];
    const m = findMatrixCell(cells, [], {
      origin: { zip: '90045' }, dest: { zip: '85003' }, service: 'ftl', equipment: 'dryvan',
    });
    expect(m?.cell.rate).toBe(1900);
  });

  it('is DIRECTIONAL — A→B and B→A can differ; the reverse does not match the forward cell', () => {
    const cells = [
      cell({ id: 1, originKey: 'W', destKey: 'E', rate: 1900 }),
      cell({ id: 2, originKey: 'E', destKey: 'W', rate: 1750 }),
    ];
    const fwd = findMatrixCell(cells, zones, { origin: { zip: '90045' }, dest: { zip: '85003' }, service: 'ftl' });
    const rev = findMatrixCell(cells, zones, { origin: { zip: '85003' }, dest: { zip: '90045' }, service: 'ftl' });
    expect(fwd?.cell.rate).toBe(1900);
    expect(rev?.cell.rate).toBe(1750);
  });

  it('prefers the more specific (zip5 > zip3) origin+dest cell', () => {
    const cells = [
      cell({ id: 1, originKey: '900', destKey: '850', rate: 1000 }), // zip3/zip3
      cell({ id: 2, originKey: '90045', destKey: '85003', rate: 1234 }), // zip5/zip5 — wins
    ];
    const m = findMatrixCell(cells, [], { origin: { zip: '90045' }, dest: { zip: '85003' }, service: 'ftl' });
    expect(m?.cell.rate).toBe(1234);
  });

  it('prefers an equipment-specific cell over a generic one', () => {
    const cells = [
      cell({ id: 1, originKey: '900', destKey: '850', rate: 1000, equipment: null }),
      cell({ id: 2, originKey: '900', destKey: '850', rate: 1400, equipment: 'reefer' }),
    ];
    const m = findMatrixCell(cells, [], { origin: { zip: '90045' }, dest: { zip: '85003' }, service: 'ftl', equipment: 'reefer' });
    expect(m?.cell.rate).toBe(1400);
  });

  it('filters by mode and equipment; no match → undefined', () => {
    const cells = [cell({ id: 1, mode: 'drayage', originKey: '900', destKey: '850' })];
    expect(findMatrixCell(cells, [], { origin: { zip: '90045' }, dest: { zip: '85003' }, service: 'ftl' })).toBeUndefined();
    expect(findMatrixCell(cells, [], { origin: { zip: '60007' }, dest: { zip: '85003' }, service: 'drayage' })).toBeUndefined();
  });

  it('resolves a shipment zip through the zone legend to a named-zone cell', () => {
    const cells = [cell({ id: 1, originKey: 'W', destKey: 'E', rate: 1900 })];
    const m = findMatrixCell(cells, zones, { origin: { zip: '90185' }, dest: { zip: '85210' }, service: 'ftl' });
    expect(m?.cell.rate).toBe(1900);
  });

  it('matches a city/state cell when no zip is present', () => {
    const cells = [cell({ id: 1, originKey: 'los angeles,ca', destKey: 'phoenix,az', rate: 1850 })];
    const m = findMatrixCell(cells, [], {
      origin: { city: 'Los Angeles', state: 'CA' }, dest: { city: 'Phoenix', state: 'AZ' }, service: 'ftl',
    });
    expect(m?.cell.rate).toBe(1850);
  });
});

describe('matrixLinehaul — per unit_basis + min-charge floor', () => {
  it('flat: the cell rate is the linehaul', () => {
    expect(matrixLinehaul(cell({ rate: 1900, unitBasis: 'flat' }), 500).amount).toBe(1900);
  });
  it('per_mile: rate × miles', () => {
    const p = matrixLinehaul(cell({ rate: 2.5, unitBasis: 'per_mile' }), 400);
    expect(p.amount).toBe(1000);
    expect(p.floored).toBe(false);
  });
  it('per_container: the flat container rate (one move)', () => {
    expect(matrixLinehaul(cell({ rate: 425, unitBasis: 'per_container' }), 30).amount).toBe(425);
  });
  it('min-charge floor lifts a below-minimum computed rate', () => {
    const p = matrixLinehaul(cell({ rate: 1.0, unitBasis: 'per_mile', minCharge: 500 }), 100);
    expect(p.amount).toBe(500); // 100 mi × $1 = $100 < $500 floor
    expect(p.floored).toBe(true);
  });
});
