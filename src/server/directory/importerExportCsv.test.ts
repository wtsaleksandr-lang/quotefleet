/**
 * Importer-search CSV export shape (buildImporterSearchCsv). Verifies the header
 * row, the FREE card columns (never a locked contact), numeric cells, quoting of
 * commas, and the recomputed winnability — a pure, offline unit test.
 */
import { describe, it, expect } from 'vitest';
import { buildImporterSearchCsv } from './importerPages.js';

const CARD = {
  company: 'Robert Bosch Tool Corp',
  slug: 'robert-bosch-tool',
  state: 'NC',
  supplier: 'Scintilla AG',
  supplier_country: 'DE',
  product: 'Saw blades, & parts', // embedded comma → must be quoted
  hs_code: '820299',
  entry_port: 'Savannah, GA', // embedded comma → must be quoted
  ships_12m: 10761,
  total_shipments: 169818,
  teu_12m: 18910,
  last_shipment: '07/31/2026',
  incumbent_forwarder: 'Expeditors Intl',
  // A locked-contact field that must NEVER appear in the export:
  phone: '+1-555-867-5309',
  contactLocked: true,
};

describe('buildImporterSearchCsv', () => {
  it('emits a title, a header row and one data row per card', () => {
    const csv = buildImporterSearchCsv([CARD], new Date('2026-08-27T00:00:00Z'));
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('QuoteFleet — Importer search results');
    expect(lines[1]).toContain('Showing 1 importer');
    // lines[2] is blank, lines[3] is the header
    const header = lines[3];
    expect(header).toBe(
      'Company,State,Supplier,Supplier country,Entry port,Product,HS code,Shipments (12 mo),Total shipments,TEU (12 mo),Last shipment,Incumbent forwarder,Winnability score,Winnability',
    );
    expect(lines).toHaveLength(5); // title, meta, blank, header, 1 data row
  });

  it('quotes cells containing commas and includes the free lane/volume/HS fields', () => {
    const csv = buildImporterSearchCsv([CARD]);
    const row = csv.split('\r\n')[4];
    expect(row).toContain('"Savannah, GA"');
    expect(row).toContain('"Saw blades, & parts"');
    expect(row).toContain('10761'); // numeric, unquoted
    expect(row).toContain('820299');
    expect(row).toContain('Expeditors Intl');
  });

  it('never leaks a locked contact field (phone) into the CSV', () => {
    const csv = buildImporterSearchCsv([CARD]);
    expect(csv).not.toContain('867-5309');
    expect(csv.toLowerCase()).not.toContain('phone');
  });

  it('recomputes winnability from the free fields (score + High/Medium label)', () => {
    const csv = buildImporterSearchCsv([CARD]);
    const row = csv.split('\r\n')[4];
    // High volume + a named incumbent → a High winnability with a numeric score.
    expect(row).toMatch(/,(5[3-9]|[6-9]\d|9[0-4]),High$/);
  });

  it('handles an empty result set with just the header (no data rows)', () => {
    const csv = buildImporterSearchCsv([]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4); // title, meta, blank, header
    expect(lines[1]).toContain('Showing 0 importers');
  });
});
