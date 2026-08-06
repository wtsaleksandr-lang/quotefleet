/**
 * Ingest-side tests for Tier 2: the parsed `rateMatrices` draft flows through
 * validation → draftToEngineConfig → calculate (priced to the correct cell), the
 * block-default normalization + zone de-dupe, and the large multi-tab workbook
 * reader (a full carrier tariff must ingest, not be rejected).
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { draftToEngineConfig } from './routes/ingest.js';
import { calculate, type CalcRequest } from '../calc/engine.js';
import {
  validateParsed,
  excelToText,
  RateMatrixDraftSchema,
  EXCEL_MAX_TOTAL,
} from '../ai/ingestFile.js';

const req = (o: Partial<CalcRequest> = {}): CalcRequest => ({ service: 'ftl', equipment: 'dryvan', miles: 500, ...o });

const MATRIX_DRAFT = {
  rateMatrices: [
    {
      mode: 'ftl',
      equipment: 'dryvan',
      unitBasis: 'flat',
      currency: 'USD',
      minCharge: null,
      cells: [
        { originKey: 'W', destKey: 'E', rate: 1900 },
        { originKey: 'E', destKey: 'W', rate: 1750 },
      ],
      zones: [
        { zoneId: 'W', matchKind: 'zip_range', matchFrom: '900', matchTo: '902', label: 'West' },
        { zoneId: 'E', matchKind: 'zip_range', matchFrom: '850', matchTo: '852', label: 'East' },
      ],
    },
  ],
};

describe('draftToEngineConfig → calculate prices the matrix cell', () => {
  it('a draft matrix lane prices to the correct cell, directionally', () => {
    const { cards, accs, zones, matrices, matrixZones } = draftToEngineConfig(MATRIX_DRAFT);
    expect(matrices.length).toBe(2);
    expect(matrixZones.length).toBe(2);
    const fwd = calculate(cards, accs, zones, req({ pickupZip: '90045', deliveryZip: '85003' }), [], undefined, matrices, matrixZones);
    const rev = calculate(cards, accs, zones, req({ pickupZip: '85003', deliveryZip: '90045' }), [], undefined, matrices, matrixZones);
    expect(fwd.subtotalLinehaul).toBe(1900);
    expect(rev.subtotalLinehaul).toBe(1750);
  });
});

describe('normalizeDraftMatrices (via draftToEngineConfig) — block defaults + dedupe', () => {
  it('cells inherit block unitBasis/minCharge; per-cell override wins', () => {
    const draft = {
      rateMatrices: [
        {
          mode: 'drayage', equipment: 'container_40', unitBasis: 'per_container', minCharge: 400,
          cells: [
            { originKey: 'USLAX', destKey: '900', rate: 610 }, // inherits per_container + min 400
            { originKey: 'USLAX', destKey: '926', rate: 1, unitBasis: 'per_mile', minCharge: 700 }, // overrides
          ],
          zones: null,
        },
      ],
    };
    const { matrices } = draftToEngineConfig(draft);
    expect(matrices[0]).toMatchObject({ unitBasis: 'per_container', minCharge: 400 });
    expect(matrices[1]).toMatchObject({ unitBasis: 'per_mile', minCharge: 700 });
  });

  it('drops cells with a missing origin/dest key and de-dupes identical zone rules', () => {
    const draft = {
      rateMatrices: [
        { mode: 'ftl', unitBasis: 'flat',
          cells: [{ originKey: 'W', destKey: 'E', rate: 1 }, { originKey: '', destKey: 'E', rate: 2 }],
          zones: [
            { zoneId: 'W', matchKind: 'zip3', matchValue: '900' },
            { zoneId: 'W', matchKind: 'zip3', matchValue: '900' }, // dup
          ],
        },
      ],
    };
    const { matrices, matrixZones } = draftToEngineConfig(draft);
    expect(matrices.length).toBe(1); // the keyless cell dropped
    expect(matrixZones.length).toBe(1); // dup zone collapsed
  });
});

describe('validateParsed — rateMatrices salvage', () => {
  it('keeps a well-formed matrix block and always returns a rateMatrices array', () => {
    const parsed = validateParsed(MATRIX_DRAFT);
    expect(Array.isArray(parsed.rateMatrices)).toBe(true);
    expect(parsed.rateMatrices!.length).toBe(1);
  });

  it('RateMatrixDraftSchema tolerates null optionals (nullish, not optional)', () => {
    const r = RateMatrixDraftSchema.safeParse({
      mode: 'ftl', equipment: null, unitBasis: 'flat', currency: null, effectiveDate: null,
      minCharge: null, sourceRef: null, originKeys: null, destKeys: null,
      cells: [{ originKey: 'W', destKey: 'E', rate: 100, unitBasis: null, minCharge: null }],
      zones: null,
    });
    expect(r.success).toBe(true);
  });

  it('legacy drafts with no rateMatrices still return an empty array', () => {
    const parsed = validateParsed({ summary: 'legacy', rateCards: [{ service: 'ftl', equipment: 'dryvan', ratePerMile: 2.5 }] });
    expect(parsed.rateMatrices).toEqual([]);
  });
});

describe('large multi-tab workbook reader — a full tariff must ingest, not be rejected', () => {
  function makeWorkbook(gridRows: number): string {
    const wb = XLSX.utils.book_new();
    // Zone legend tab.
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['zip3', 'zone'], ['900', 'W'], ['850', 'E']]),
      'Zone Legend',
    );
    // A big rate-grid tab.
    const grid: (string | number)[][] = [['origin', 'dest', 'rate']];
    for (let i = 0; i < gridRows; i++) grid.push([`9${String(i).padStart(4, '0')}`, `8${String(i).padStart(4, '0')}`, 1000 + i]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), 'Rate Grid');
    // FSC + accessorial tabs.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['diesel', 'cpm'], ['4.00', '0.45']]), 'FSC');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'amount'], ['Detention', 75]]), 'Accessorials');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return Buffer.from(buf).toString('base64');
  }

  it('reads every relevant tab from a modest multi-tab workbook (would have been >100KB rejected before)', () => {
    const text = excelToText(makeWorkbook(4000));
    expect(text).toContain('### Sheet: Zone Legend');
    expect(text).toContain('### Sheet: Rate Grid');
    expect(text).toContain('### Sheet: FSC');
    expect(text).toContain('### Sheet: Accessorials');
  });

  it('bounds a runaway workbook instead of throwing, annotating the truncation', () => {
    const text = excelToText(makeWorkbook(60000), { maxPerSheet: 40_000, maxTotal: 120_000 });
    expect(text.length).toBeLessThanOrEqual(120_000 + 2000); // bounded (+ small annotation slack)
    expect(/truncated|read budget/i.test(text)).toBe(true);
    // The legend tab (read first) survives so the join is still possible.
    expect(text).toContain('### Sheet: Zone Legend');
  });

  it('default whole-workbook cap is far above the old 100KB wall', () => {
    expect(EXCEL_MAX_TOTAL).toBeGreaterThan(100_000);
  });
});
