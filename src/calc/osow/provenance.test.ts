import { describe, it, expect } from 'vitest';
import {
  isInEffect,
  resolveSourced,
  spreadOf,
  citedSources,
  citeOf,
  todayIso,
  type SourceDoc,
  type Sourced,
} from './provenance.js';

const statute: SourceDoc = {
  id: 'pa-statute',
  title: '75 Pa.C.S. §4902 permit fees',
  url: 'https://www.legis.state.pa.us/example',
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2019-06-28',
  retrievedOn: '2026-08-31',
};

const form: SourceDoc = {
  id: 'pa-form',
  title: 'PennDOT Form M-936A oversize permit application',
  url: 'https://www.penndot.pa.gov/example',
  publisher: 'PennDOT',
  revisedOn: '2023-04-01',
  retrievedOn: '2026-08-31',
};

const undated: SourceDoc = {
  id: 'undated',
  title: 'Agency fee page',
  url: 'https://example.gov/fees',
  publisher: 'Agency',
  revisedOn: null,
  retrievedOn: '2026-08-31',
};

function sourced<T>(
  value: T,
  source: SourceDoc,
  effectiveFrom = '2020-01-01',
  effectiveTo: string | null = null,
): Sourced<T> {
  return { value, source, effectiveFrom, effectiveTo };
}

describe('effective dating', () => {
  it('includes a row on its exact start and end dates, excludes it outside', () => {
    const row = sourced(60, statute, '2021-02-01', '2024-12-31');
    expect(isInEffect(row, '2021-01-31')).toBe(false);
    expect(isInEffect(row, '2021-02-01')).toBe(true);
    expect(isInEffect(row, '2024-12-31')).toBe(true);
    expect(isInEffect(row, '2025-01-01')).toBe(false);
  });

  it('treats a null end date as open-ended', () => {
    const row = sourced(60, statute, '2021-02-01', null);
    expect(isInEffect(row, '2099-01-01')).toBe(true);
  });

  it('picks the row in effect on the as-of date, not the newest row', () => {
    const old = sourced(35, statute, '2019-01-01', '2023-12-31');
    const current = sourced(46, form, '2024-01-01', null);
    expect(resolveSourced('fee', [old, current], '2022-06-01').value).toBe(35);
    expect(resolveSourced('fee', [old, current], '2026-06-01').value).toBe(46);
  });
});

describe('resolution', () => {
  it('resolves cleanly when exactly one source is in effect', () => {
    const r = resolveSourced('oversize issuance fee', [sourced(60, statute)], '2026-08-31');
    expect(r.value).toBe(60);
    expect(r.conflict).toBe(false);
    expect(r.requiresManualReview).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('treats two agreeing sources as corroboration, not conflict', () => {
    const r = resolveSourced(
      'oversize issuance fee',
      [sourced(60, statute), sourced(60, form)],
      '2026-08-31',
    );
    expect(r.value).toBe(60);
    expect(r.conflict).toBe(false);
    expect(r.requiresManualReview).toBe(false);
    // Newest source revision is the one we cite.
    expect(r.chosen?.source.id).toBe('pa-form');
  });

  it('sorts undated documents last — they are the weakest evidence', () => {
    const r = resolveSourced(
      'fee',
      [sourced(60, undated), sourced(60, statute)],
      '2026-08-31',
    );
    expect(r.chosen?.source.id).toBe('pa-statute');
  });

  // The Pennsylvania case that forced this whole module to exist.
  it('REFUSES to pick when two official sources disagree', () => {
    const r = resolveSourced(
      'oversize permit issuance fee',
      [sourced(35, statute), sourced(46, form)],
      '2026-08-31',
    );
    expect(r.conflict).toBe(true);
    expect(r.requiresManualReview).toBe(true);
    // The critical assertion: no silent winner.
    expect(r.value).toBeNull();
    // Both candidates survive, so the discrepancy can be shown.
    expect(r.candidates).toHaveLength(2);
    expect(r.warnings[0]).toContain('35');
    expect(r.warnings[0]).toContain('46');
    expect(r.warnings[0]).toContain('legis.state.pa.us');
    expect(r.warnings[0]).toContain('penndot.pa.gov');
  });

  it('exposes a conflicted field as an honest range', () => {
    const r = resolveSourced(
      'fee',
      [sourced(35, statute), sourced(46, form)],
      '2026-08-31',
    );
    expect(spreadOf(r)).toEqual({ low: 35, high: 46 });
  });

  it('flags a field with no data at all for manual review', () => {
    const r = resolveSourced('escort fee', [], '2026-08-31');
    expect(r.value).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings[0]).toContain('we hold no data');
  });

  it('flags a field whose only rows have expired, and says what it holds', () => {
    const expired = sourced(35, statute, '2019-01-01', '2020-12-31');
    const r = resolveSourced('fee', [expired], '2026-08-31');
    expect(r.value).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings[0]).toContain('2019-01-01');
    expect(r.warnings[0]).toContain('2020-12-31');
  });

  it('supports a custom equality test for non-primitive values', () => {
    type Band = { min: number; fee: number };
    const eq = (a: Band, b: Band) => a.min === b.min && a.fee === b.fee;
    const r = resolveSourced<Band>(
      'band',
      [sourced({ min: 0, fee: 5 }, statute), sourced({ min: 0, fee: 5 }, form)],
      '2026-08-31',
      eq,
    );
    expect(r.conflict).toBe(false);
    expect(r.value).toEqual({ min: 0, fee: 5 });
  });
});

describe('citations', () => {
  it('states plainly when a document carries no revision date', () => {
    expect(citeOf(undated)).toContain('no revision date stated');
  });

  it('renders the revision date, not the retrieval date, as the document date', () => {
    const c = citeOf(statute);
    expect(c).toContain('rev. 2019-06-28');
    expect(c).not.toContain('2026-08-31');
  });

  it('includes a pinpoint cite when present', () => {
    expect(citeOf({ ...statute, cite: '§4902(b)' })).toContain('§4902(b)');
  });

  it('deduplicates sources across resolutions', () => {
    const a = resolveSourced('a', [sourced(1, statute)], '2026-08-31');
    const b = resolveSourced('b', [sourced(2, statute), sourced(3, form)], '2026-08-31');
    const sources = citedSources([a, b]);
    expect(sources.map((s) => s.id).sort()).toEqual(['pa-form', 'pa-statute']);
  });
});

describe('todayIso', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayIso(new Date('2026-08-31T18:04:00Z'))).toBe('2026-08-31');
  });
});
