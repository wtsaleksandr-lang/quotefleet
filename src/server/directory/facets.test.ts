/**
 * Faceted directory — pure normalization/logic unit tests (no DB required).
 * Covers the GET-param facet scheme, city slugging and safe clamping so the
 * crawlable filter URLs stay stable and can never throw on junk input.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeFilters,
  citySlugify,
  titleCaseCity,
  FLEET_BUCKETS,
  SAFETY_OPTIONS,
  SORT_OPTIONS,
  FACET_QUERY_KEYS,
} from './queries.js';

describe('normalizeFilters — GET-param facet parsing', () => {
  it('parses a full valid facet URL', () => {
    const f = normalizeFilters({
      state: 'tx',
      city: 'Houston',
      fleet: '26-100',
      safety: 'satisfactory',
      authority: 'active',
      intermodal: '1',
      recent: 'yes',
      sort: 'fleet',
      page: '3',
    });
    expect(f.state).toBe('TX');
    expect(f.citySlug).toBe('houston');
    expect(f.fleet).toBe('26-100');
    expect(f.safety).toBe('satisfactory');
    expect(f.authorityActive).toBe(true);
    expect(f.intermodal).toBe(true);
    expect(f.recent).toBe(true);
    expect(f.sort).toBe('fleet');
    expect(f.page).toBe(3);
  });

  it('collapses unknown / junk values to safe defaults (never throws)', () => {
    const f = normalizeFilters({
      state: 'texas', // too long → rejected (not 2 letters)
      fleet: 'huge',
      safety: 'green',
      sort: 'random',
      page: '-5',
    });
    expect(f.state).toBeNull();
    expect(f.fleet).toBeNull();
    expect(f.safety).toBeNull();
    expect(f.sort).toBe('featured');
    expect(f.page).toBe(1);
    expect(f.authorityActive).toBe(false);
  });

  it('honors scope overrides (path-locked dims win over query)', () => {
    const f = normalizeFilters({ state: 'ca', city: 'oakland' }, { state: 'TX', citySlug: 'dallas', port: null });
    expect(f.state).toBe('TX');
    expect(f.citySlug).toBe('dallas');
    expect(f.port).toBeNull();
  });
});

describe('citySlugify / titleCaseCity round-trip', () => {
  it('slugs multi-word + punctuated city names', () => {
    expect(citySlugify('SAN ANTONIO')).toBe('san-antonio');
    expect(citySlugify("Coeur d'Alene")).toBe('coeur-d-alene');
    expect(citySlugify('  Winston-Salem  ')).toBe('winston-salem');
  });
  it('title-cases ALL-CAPS FMCSA city strings', () => {
    expect(titleCaseCity('HOUSTON')).toBe('Houston');
    expect(titleCaseCity('SALT LAKE CITY')).toBe('Salt Lake City');
  });
});

describe('facet option tables', () => {
  it('fleet buckets are contiguous and cover 500+', () => {
    expect(FLEET_BUCKETS.map((b) => b.id)).toEqual(['1-25', '26-100', '101-500', '500+']);
    expect(FLEET_BUCKETS[3].max).toBeNull();
  });
  it('safety options include the unrated (null) case', () => {
    expect(SAFETY_OPTIONS.find((s) => s.id === 'unrated')?.letter).toBeNull();
  });
  it('featured is the default sort and is listed first', () => {
    expect(SORT_OPTIONS[0].id).toBe('featured');
  });
  it('every facet query key is a non-empty string', () => {
    expect(FACET_QUERY_KEYS.length).toBeGreaterThan(0);
    for (const k of FACET_QUERY_KEYS) expect(typeof k).toBe('string');
  });
});
