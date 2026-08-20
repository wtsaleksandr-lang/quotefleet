/**
 * Branded carrier-export generator — behaviour + guards.
 *
 * Everything here runs with an INJECTED fake store (or plain carrier arrays), so
 * no DB / network is touched. Properties asserted:
 *
 *   (a) filter → rows resolution + CAP: the store's carriers become rows, the
 *       result is capped at maxRows, and shown/total/capped reflect the cap,
 *   (b) contact OPT-OUT suppression: a contactHidden carrier's phone + email are
 *       "—" in the row and never leak into CSV / XLSX / HTML,
 *   (c) XLSX + CSV row SHAPE: three title rows, the exact column-header row, then
 *       a data row with the expected cells,
 *   (d) the branded HTML view renders the QuoteFleet badge + every column header
 *       + the filter summary + the generated date,
 *   (e) `?dots=` mode resolves via the store's byDots path.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { VisibleCarrier, CarrierProvenance } from './queries.js';
import {
  resolveExport,
  buildRows,
  buildExportCsv,
  buildExportXlsx,
  renderExportHtml,
  carrierToExportRow,
  describeFilters,
  EXPORT_COLUMNS,
  type ExportStore,
} from './exportSheet.js';
import { normalizeFilters } from './queries.js';

const PROV: CarrierProvenance = { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' };

function mkCarrier(p: Partial<VisibleCarrier> = {}): VisibleCarrier {
  return {
    slug: 'acme-trucking-123',
    legalName: 'ACME TRUCKING LLC',
    dbaName: null,
    usdot: '123456',
    mcNumber: 'MC-99887',
    city: 'HOUSTON',
    state: 'TX',
    zip: '77001',
    phone: '+1-713-555-0100',
    email: 'dispatch@acme.example',
    contactHidden: false,
    powerUnits: 42,
    drivers: 60,
    safetyRating: 'S',
    authorityType: 'common,contract',
    intermodal: true,
    hazmat: false,
    dryVan: false,
    reefer: true,
    tanker: false,
    flatbed: false,
    dryBulk: false,
    householdGoods: false,
    beverages: false,
    produce: true,
    motorVehicles: false,
    livestock: false,
    grainFeed: false,
    oilfield: false,
    meat: false,
    paper: false,
    construction: false,
    farmSupplies: false,
    coalCoke: false,
    buildingMaterials: false,
    nearestPortCode: 'USHOU',
    aboutOverride: null,
    capabilities: {},
    provenance: PROV,
    ...p,
  };
}

/** Fake store: returns a fixed pool, honouring the caller's limit. */
function fakeStore(pool: VisibleCarrier[]): ExportStore {
  return {
    async byFilters(_f, limit) {
      return { carriers: pool.slice(0, limit), total: pool.length };
    },
    async byDots(dots, limit) {
      const set = new Set(dots);
      const matched = pool.filter((c) => set.has(c.usdot)).slice(0, limit);
      return { carriers: matched, total: dots.length };
    },
  };
}

describe('resolveExport — resolution + cap', () => {
  it('turns store carriers into rows and caps at maxRows', async () => {
    const pool = Array.from({ length: 5 }, (_, i) => mkCarrier({ usdot: `10${i}`, slug: `c-${i}` }));
    const r = await resolveExport({ state: 'texas' }, { store: fakeStore(pool), maxRows: 3 });
    expect(r.mode).toBe('filters');
    expect(r.shown).toBe(3);
    expect(r.total).toBe(5);
    expect(r.capped).toBe(true);
    expect(r.rows).toHaveLength(3);
    // resolveExport coerces the "texas" slug → "TX" before summarizing.
    expect(r.summary).toBe(describeFilters(normalizeFilters({ state: 'TX' })));
    expect(r.summary).toContain('Texas');
  });

  it('is not capped when the pool fits', async () => {
    const pool = [mkCarrier()];
    const r = await resolveExport({ state: 'texas' }, { store: fakeStore(pool), maxRows: 500 });
    expect(r.capped).toBe(false);
    expect(r.shown).toBe(1);
    expect(r.total).toBe(1);
  });

  it('?dots= resolves via the byDots store path', async () => {
    const pool = [mkCarrier({ usdot: '111' }), mkCarrier({ usdot: '222' }), mkCarrier({ usdot: '333' })];
    const r = await resolveExport({ dots: '111,333' }, { store: fakeStore(pool), maxRows: 500 });
    expect(r.mode).toBe('dots');
    expect(r.carriers.map((c) => c.usdot).sort()).toEqual(['111', '333']);
    expect(r.summary).toContain('Selected carriers (2)');
  });
});

describe('contact opt-out suppression', () => {
  it('blanks phone + email for a contactHidden carrier in the row', () => {
    const row = carrierToExportRow(mkCarrier({ contactHidden: true }));
    expect(row.phone).toBe('—');
    expect(row.email).toBe('—');
  });

  it('never leaks a suppressed contact into CSV / XLSX / HTML', async () => {
    const secretPhone = '+1-713-555-0100';
    const secretEmail = 'dispatch@acme.example';
    const pool = [mkCarrier({ contactHidden: true, phone: secretPhone, email: secretEmail })];
    const r = await resolveExport({ state: 'texas' }, { store: fakeStore(pool), maxRows: 500 });

    const csv = buildExportCsv(r);
    expect(csv).not.toContain(secretPhone);
    expect(csv).not.toContain(secretEmail);

    const html = renderExportHtml(r);
    expect(html).not.toContain(secretPhone);
    expect(html).not.toContain(secretEmail);

    const wb = XLSX.read(buildExportXlsx(r), { type: 'buffer' });
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const flat = JSON.stringify(aoa);
    expect(flat).not.toContain(secretPhone);
    expect(flat).not.toContain(secretEmail);
  });

  it('keeps contacts for a normal (non-hidden) carrier', () => {
    const row = carrierToExportRow(mkCarrier());
    expect(row.phone).toBe('+1-713-555-0100');
    expect(row.email).toBe('dispatch@acme.example');
  });
});

describe('CSV shape', () => {
  it('has three title rows, the header row, then data', () => {
    const rows = buildRows([mkCarrier()]);
    const r = {
      mode: 'filters' as const,
      filters: normalizeFilters({ state: 'texas' }),
      carriers: [mkCarrier()],
      rows,
      summary: 'Texas · Reefer',
      shown: 1,
      total: 1,
      capped: false,
      maxRows: 500,
      generatedAt: new Date('2026-08-20T12:00:00Z'),
      query: 'state=texas',
    };
    const lines = buildExportCsv(r).split('\r\n');
    expect(lines[0]).toContain('QuoteFleet — Carrier shortlist');
    expect(lines[1]).toContain('Texas · Reefer');
    expect(lines[2]).toContain('Showing 1 of 1');
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe(EXPORT_COLUMNS.map((c) => c.label).join(','));
    // Data row carries the company + numeric fields.
    expect(lines[5]).toContain('ACME TRUCKING LLC');
    expect(lines[5]).toContain('123456');
  });

  it('escapes cells that contain commas / quotes', () => {
    const csv = buildExportCsv({
      mode: 'filters',
      filters: normalizeFilters({}),
      carriers: [],
      rows: buildRows([mkCarrier({ legalName: 'SMITH, JONES & CO "FREIGHT"' })]),
      summary: 'All carriers',
      shown: 1,
      total: 1,
      capped: false,
      maxRows: 500,
      generatedAt: new Date(),
      query: '',
    });
    expect(csv).toContain('"SMITH, JONES & CO ""FREIGHT"""');
  });
});

describe('XLSX shape', () => {
  it('emits a workbook with title rows + exact header row + data', () => {
    const r = {
      mode: 'filters' as const,
      filters: normalizeFilters({ state: 'texas' }),
      carriers: [mkCarrier()],
      rows: buildRows([mkCarrier()]),
      summary: 'Texas · Reefer',
      shown: 1,
      total: 1,
      capped: false,
      maxRows: 500,
      generatedAt: new Date('2026-08-20T12:00:00Z'),
      query: 'state=texas',
    };
    const wb = XLSX.read(buildExportXlsx(r), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: true });
    expect(String(aoa[0][0])).toContain('QuoteFleet — Carrier shortlist');
    // Header row is row index 4 (after 3 title rows + 1 blank).
    expect(aoa[4]).toEqual(EXPORT_COLUMNS.map((c) => c.label));
    expect(aoa[5][0]).toBe('ACME TRUCKING LLC');
    // Power units column stays a real number.
    const puCol = EXPORT_COLUMNS.findIndex((c) => c.key === 'powerUnits');
    expect(aoa[5][puCol]).toBe(42);
  });
});

describe('branded HTML view', () => {
  it('renders the QuoteFleet badge, every column header, summary + date', () => {
    const r = {
      mode: 'filters' as const,
      filters: normalizeFilters({ state: 'texas', equipment: 'reefer' }),
      carriers: [mkCarrier()],
      rows: buildRows([mkCarrier()]),
      summary: 'Texas · Reefer',
      shown: 1,
      total: 1,
      capped: false,
      maxRows: 500,
      generatedAt: new Date('2026-08-20T12:00:00Z'),
      query: 'state=texas&equipment=reefer',
    };
    const html = renderExportHtml(r);
    // Badge (both theme variants of the QuoteFleet wordmark).
    expect(html).toContain('/brand/logo-full-ondark.png');
    expect(html).toContain('/brand/logo-full.png');
    expect(html).toContain('Carrier shortlist');
    expect(html).toContain('Texas · Reefer');
    expect(html).toContain('Generated August 20, 2026');
    // Every column header present.
    for (const c of EXPORT_COLUMNS) expect(html).toContain(`<th>${c.label}</th>`);
    // Download links carry the querystring.
    expect(html).toContain('/directory/export.xlsx?state=texas&amp;equipment=reefer');
    expect(html).toContain('/directory/export.csv?state=texas&amp;equipment=reefer');
  });

  it('shows a "first N of M" note when capped', () => {
    const r = {
      mode: 'filters' as const,
      filters: normalizeFilters({}),
      carriers: [mkCarrier()],
      rows: buildRows([mkCarrier()]),
      summary: 'All carriers',
      shown: 500,
      total: 1200,
      capped: true,
      maxRows: 500,
      generatedAt: new Date('2026-08-20T12:00:00Z'),
      query: '',
    };
    const html = renderExportHtml(r);
    expect(html).toContain('Showing the first 500 of 1,200');
  });
});

describe('describeFilters', () => {
  it('summarizes a multi-facet selection', () => {
    const s = describeFilters(normalizeFilters({ state: 'TX', equipment: 'reefer', standing: 'good' }));
    expect(s).toContain('Texas');
    expect(s).toContain('Reefer');
    expect(s).toContain('Good standing');
  });
  it('falls back to "All carriers" when empty', () => {
    expect(describeFilters(normalizeFilters({}))).toBe('All carriers');
  });
});
