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
  DRIVERS_BUCKETS,
  SAFETY_OPTIONS,
  SORT_OPTIONS,
  FACET_QUERY_KEYS,
  EQUIPMENT_OPTIONS,
  CARGO_OPTIONS,
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
    expect(f.drivers).toBeNull();
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

describe('equipment facet — single `equipment` param + legacy `intermodal` compat', () => {
  it('parses every valid equipment id', () => {
    for (const opt of EQUIPMENT_OPTIONS) {
      expect(normalizeFilters({ equipment: opt.id }).equipment).toBe(opt.id);
    }
  });
  it('collapses an unknown equipment value to null (never throws)', () => {
    expect(normalizeFilters({ equipment: 'spaceship' }).equipment).toBeNull();
    expect(normalizeFilters({}).equipment).toBeNull();
  });
  it('drayage sets the legacy intermodal boolean true (keeps featured sort / badge working)', () => {
    const f = normalizeFilters({ equipment: 'drayage' });
    expect(f.equipment).toBe('drayage');
    expect(f.intermodal).toBe(true);
  });
  it('a non-drayage equipment leaves the intermodal boolean false', () => {
    const f = normalizeFilters({ equipment: 'reefer' });
    expect(f.equipment).toBe('reefer');
    expect(f.intermodal).toBe(false);
  });
  it('the legacy `intermodal=1` param still maps to drayage', () => {
    const f = normalizeFilters({ intermodal: '1' });
    expect(f.equipment).toBe('drayage');
    expect(f.intermodal).toBe(true);
  });
  it('an explicit equipment value wins over the legacy intermodal param', () => {
    const f = normalizeFilters({ equipment: 'flatbed', intermodal: '1' });
    expect(f.equipment).toBe('flatbed');
    // legacyIntermodal is still honored for the boolean (old deep-link semantics)
    expect(f.intermodal).toBe(true);
  });
  it('every equipment option is backed by a real carrier_directory column', () => {
    const cols = new Set(['intermodal', 'hazmat', 'dryVan', 'reefer', 'tanker', 'flatbed', 'dryBulk']);
    for (const opt of EQUIPMENT_OPTIONS) expect(cols.has(opt.column)).toBe(true);
  });
});

describe('cargo-specialty facet — separate `cargo` param, all real FMCSA columns', () => {
  it('parses every valid cargo id', () => {
    for (const opt of CARGO_OPTIONS) {
      expect(normalizeFilters({ cargo: opt.id }).cargo).toBe(opt.id);
    }
  });
  it('collapses an unknown cargo value to null (never throws)', () => {
    expect(normalizeFilters({ cargo: 'unobtanium' }).cargo).toBeNull();
    expect(normalizeFilters({}).cargo).toBeNull();
  });
  it('cargo is orthogonal to equipment (both can be set at once)', () => {
    const f = normalizeFilters({ equipment: 'reefer', cargo: 'produce' });
    expect(f.equipment).toBe('reefer');
    expect(f.cargo).toBe('produce');
  });
  it('cargo does not touch the legacy intermodal boolean', () => {
    expect(normalizeFilters({ cargo: 'household' }).intermodal).toBe(false);
  });
  it('cargo is a recognized facet query key (shareable/crawlable)', () => {
    expect(FACET_QUERY_KEYS).toContain('cargo');
  });
  it('exposes all thirteen FMCSA cargo-class specialties in order', () => {
    expect(CARGO_OPTIONS.map((o) => o.id)).toEqual([
      'household',
      'beverages',
      'produce',
      'motorvehicles',
      'livestock',
      'grainfeed',
      'oilfield',
      'meat',
      'paper',
      'construction',
      'farmsupplies',
      'coalcoke',
      'buildingmaterials',
    ]);
  });
  it('every cargo option has a non-empty label and a real carrier_directory column', () => {
    const cols = new Set([
      'householdGoods',
      'beverages',
      'produce',
      'motorVehicles',
      'livestock',
      'grainFeed',
      'oilfield',
      'meat',
      'paper',
      'construction',
      'farmSupplies',
      'coalCoke',
      'buildingMaterials',
    ]);
    for (const o of CARGO_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(cols.has(o.column)).toBe(true);
    }
  });
  it('household + beverages are real cargo columns (moved out of the claim group)', () => {
    expect(CARGO_OPTIONS.find((o) => o.id === 'household')?.column).toBe('householdGoods');
    expect(CARGO_OPTIONS.find((o) => o.id === 'beverages')?.column).toBe('beverages');
  });
});

describe('drivers-count facet — FMCSA total_drivers buckets', () => {
  it('parses every valid drivers bucket id', () => {
    for (const b of DRIVERS_BUCKETS) {
      expect(normalizeFilters({ drivers: b.id }).drivers).toBe(b.id);
    }
  });
  it('collapses an unknown drivers value to null (never throws)', () => {
    expect(normalizeFilters({ drivers: 'lots' }).drivers).toBeNull();
    expect(normalizeFilters({}).drivers).toBeNull();
  });
  it('drivers is independent of the fleet (power-units) facet', () => {
    const f = normalizeFilters({ fleet: '26-100', drivers: '11-50' });
    expect(f.fleet).toBe('26-100');
    expect(f.drivers).toBe('11-50');
  });
  it('drivers buckets are contiguous and cover the open-ended top', () => {
    expect(DRIVERS_BUCKETS.map((b) => b.id)).toEqual(['1-10', '11-50', '51-250', '250+']);
    expect(DRIVERS_BUCKETS[3].max).toBeNull();
    // No gaps between adjacent buckets.
    for (let i = 1; i < DRIVERS_BUCKETS.length; i++) {
      expect(DRIVERS_BUCKETS[i].min).toBe((DRIVERS_BUCKETS[i - 1].max ?? 0) + 1);
    }
  });
  it('drivers is a recognized facet query key (shareable/crawlable)', () => {
    expect(FACET_QUERY_KEYS).toContain('drivers');
  });
});

describe('equipment facet surfacing — every option is a real FMCSA column', () => {
  it('exposes all seven cargo/equipment options', () => {
    expect(EQUIPMENT_OPTIONS.map((o) => o.id)).toEqual([
      'drayage',
      'dryvan',
      'reefer',
      'hazmat',
      'tanker',
      'flatbed',
      'drybulk',
    ]);
  });
  it('every equipment option has a non-empty display label', () => {
    for (const o of EQUIPMENT_OPTIONS) expect(o.label.length).toBeGreaterThan(0);
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
