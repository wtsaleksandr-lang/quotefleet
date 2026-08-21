/**
 * Faceted directory — pure normalization/logic unit tests (no DB required).
 * Covers the GET-param facet scheme, city slugging and safe clamping so the
 * crawlable filter URLs stay stable and can never throw on junk input.
 */
import { describe, it, expect } from 'vitest';
import { and } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  normalizeFilters,
  normalizeNameQuery,
  nameSearchCondition,
  NAME_SEARCH_MIN,
  buildConditions,
  orderForSort,
  resolveSortDir,
  citySlugify,
  titleCaseCity,
  FLEET_BUCKETS,
  DRIVERS_BUCKETS,
  SAFETY_OPTIONS,
  SORT_OPTIONS,
  SORT_DIR_DEFAULTS,
  FACET_QUERY_KEYS,
  EQUIPMENT_OPTIONS,
  CARGO_OPTIONS,
} from './queries.js';
import { portFilterCodes, portGroupByCode, portGroupForMemberCode } from './containerPorts.js';

/** Render a WHERE/ORDER SQL fragment to a lowercase string for shape assertions. */
const dialect = new PgDialect();
const sqlText = (frag: { getSQL?: () => unknown } | unknown): string => {
  // buildConditions entries + orderForSort chunks are SQL objects.
  const q = dialect.sqlToQuery((frag as { getSQL: () => import('drizzle-orm').SQL }).getSQL());
  return q.sql.toLowerCase();
};

describe('normalizeFilters — GET-param facet parsing', () => {
  it('parses a full valid facet URL', () => {
    const f = normalizeFilters({
      state: 'tx',
      city: 'Houston',
      fleet: '26-100',
      standing: 'good',
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
    expect(f.goodStandingOnly).toBe(true);
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
      standing: 'maybe', // junk → toggle stays off
      sort: 'random',
      page: '-5',
    });
    expect(f.state).toBeNull();
    expect(f.fleet).toBeNull();
    expect(f.goodStandingOnly).toBe(false);
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

describe('equipment facet — MULTI-select `equipment` param + legacy `intermodal` compat', () => {
  it('parses every valid equipment id (single value → 1-element list)', () => {
    for (const opt of EQUIPMENT_OPTIONS) {
      expect(normalizeFilters({ equipment: opt.id }).equipment).toEqual([opt.id]);
    }
  });
  it('collapses an unknown equipment value to an empty list (never throws)', () => {
    expect(normalizeFilters({ equipment: 'spaceship' }).equipment).toEqual([]);
    expect(normalizeFilters({}).equipment).toEqual([]);
  });
  it('drayage sets the legacy intermodal boolean true (keeps featured sort / badge working)', () => {
    const f = normalizeFilters({ equipment: 'drayage' });
    expect(f.equipment).toEqual(['drayage']);
    expect(f.intermodal).toBe(true);
  });
  it('a non-drayage equipment leaves the intermodal boolean false', () => {
    const f = normalizeFilters({ equipment: 'reefer' });
    expect(f.equipment).toEqual(['reefer']);
    expect(f.intermodal).toBe(false);
  });
  it('the legacy `intermodal=1` param still maps to drayage', () => {
    const f = normalizeFilters({ intermodal: '1' });
    expect(f.equipment).toEqual(['drayage']);
    expect(f.intermodal).toBe(true);
  });
  it('an explicit equipment value combines with the legacy intermodal param (drayage folded in, canonical order)', () => {
    const f = normalizeFilters({ equipment: 'flatbed', intermodal: '1' });
    // drayage is first in EQUIPMENT_OPTIONS, so it leads the canonical list.
    expect(f.equipment).toEqual(['drayage', 'flatbed']);
    expect(f.intermodal).toBe(true);
  });
  it('every equipment option is backed by a real carrier_directory column', () => {
    const cols = new Set(['intermodal', 'hazmat', 'dryVan', 'reefer', 'tanker', 'flatbed', 'dryBulk']);
    for (const opt of EQUIPMENT_OPTIONS) expect(cols.has(opt.column)).toBe(true);
  });
});

describe('cargo-specialty facet — separate `cargo` param, all real FMCSA columns', () => {
  it('parses every valid cargo id (single value → 1-element list)', () => {
    for (const opt of CARGO_OPTIONS) {
      expect(normalizeFilters({ cargo: opt.id }).cargo).toEqual([opt.id]);
    }
  });
  it('collapses an unknown cargo value to an empty list (never throws)', () => {
    expect(normalizeFilters({ cargo: 'unobtanium' }).cargo).toEqual([]);
    expect(normalizeFilters({}).cargo).toEqual([]);
  });
  it('cargo is orthogonal to equipment (both can be set at once)', () => {
    const f = normalizeFilters({ equipment: 'reefer', cargo: 'produce' });
    expect(f.equipment).toEqual(['reefer']);
    expect(f.cargo).toEqual(['produce']);
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

describe('multi-select parsing — comma-list, junk, dedupe, canonical order', () => {
  it('parses a comma-separated equipment list', () => {
    expect(normalizeFilters({ equipment: 'reefer,flatbed' }).equipment).toEqual(['reefer', 'flatbed']);
  });
  it('parses a comma-separated cargo list', () => {
    expect(normalizeFilters({ cargo: 'household,beverages' }).cargo).toEqual(['household', 'beverages']);
  });
  it('accepts a repeated-param array (Express ?equipment=a&equipment=b)', () => {
    expect(normalizeFilters({ equipment: ['reefer', 'flatbed'] }).equipment).toEqual(['reefer', 'flatbed']);
  });
  it('drops junk ids but keeps the valid ones (never throws)', () => {
    expect(normalizeFilters({ equipment: 'reefer,spaceship,flatbed' }).equipment).toEqual(['reefer', 'flatbed']);
    expect(normalizeFilters({ cargo: 'produce,unobtanium' }).cargo).toEqual(['produce']);
  });
  it('de-duplicates repeated ids', () => {
    expect(normalizeFilters({ equipment: 'reefer,reefer,flatbed,reefer' }).equipment).toEqual(['reefer', 'flatbed']);
  });
  it('normalizes to canonical (option-table) order regardless of input order', () => {
    // Input reversed vs EQUIPMENT_OPTIONS order → output still canonical.
    expect(normalizeFilters({ equipment: 'flatbed,reefer,dryvan' }).equipment).toEqual(['dryvan', 'reefer', 'flatbed']);
    expect(normalizeFilters({ cargo: 'produce,household' }).cargo).toEqual(['household', 'produce']);
  });
  it('trims whitespace and lower-cases ids', () => {
    expect(normalizeFilters({ equipment: ' Reefer , FLATBED ' }).equipment).toEqual(['reefer', 'flatbed']);
  });
  it('a drayage member in a multi-list still flips the intermodal boolean', () => {
    expect(normalizeFilters({ equipment: 'reefer,drayage' }).intermodal).toBe(true);
    expect(normalizeFilters({ equipment: 'reefer,flatbed' }).intermodal).toBe(false);
  });
});

describe('sort direction — dir param parse + per-sort defaults', () => {
  it('defaults: fleet/drivers/recent = desc, safety = asc, featured = desc (unused)', () => {
    expect(SORT_DIR_DEFAULTS).toEqual({ featured: 'desc', safety: 'asc', fleet: 'desc', drivers: 'desc', recent: 'desc' });
  });
  it('uses the sort default direction when no dir param is given', () => {
    expect(normalizeFilters({ sort: 'fleet' }).dir).toBe('desc');
    expect(normalizeFilters({ sort: 'drivers' }).dir).toBe('desc');
    expect(normalizeFilters({ sort: 'safety' }).dir).toBe('asc');
    expect(normalizeFilters({ sort: 'recent' }).dir).toBe('desc');
  });
  it('honors an explicit asc/desc dir param', () => {
    expect(normalizeFilters({ sort: 'fleet', dir: 'asc' }).dir).toBe('asc');
    expect(normalizeFilters({ sort: 'safety', dir: 'desc' }).dir).toBe('desc');
  });
  it('collapses a junk dir to the sort default (never throws)', () => {
    expect(normalizeFilters({ sort: 'fleet', dir: 'sideways' }).dir).toBe('desc');
  });
  it('featured always resolves to its (unused) default direction', () => {
    expect(normalizeFilters({ sort: 'featured', dir: 'asc' }).dir).toBe('desc');
    expect(resolveSortDir('featured', 'asc')).toBe('desc');
  });
  it('drivers is a selectable sort option', () => {
    expect(SORT_OPTIONS.map((s) => s.id)).toContain('drivers');
  });
});

describe('query shape — OR within a facet, AND across facets', () => {
  const base = normalizeFilters({});

  it('multi-select equipment collapses to ONE OR-group condition', () => {
    const conds = buildConditions({ ...base, equipment: ['reefer', 'flatbed'] });
    expect(conds).toHaveLength(1);
    const s = sqlText(conds[0]);
    expect(s).toContain(' or ');
    expect(s).toContain('reefer');
    expect(s).toContain('flatbed');
  });

  it('a single equipment value is a bare eq (no redundant OR wrapper)', () => {
    const conds = buildConditions({ ...base, equipment: ['reefer'] });
    expect(conds).toHaveLength(1);
    expect(sqlText(conds[0])).not.toContain(' or ');
  });

  it('equipment + cargo → TWO conditions (AND across facets), each an OR within', () => {
    const conds = buildConditions({ ...base, equipment: ['reefer', 'flatbed'], cargo: ['produce', 'household'] });
    expect(conds).toHaveLength(2);
    // Combined WHERE ANDs the two facet groups together.
    const whole = sqlText(and(...conds));
    expect(whole).toContain(' and ');
    expect(whole).toContain(' or ');
  });

  it('drayage rides inside the equipment OR-group (maps to the intermodal column)', () => {
    const conds = buildConditions({ ...base, equipment: ['drayage', 'reefer'], intermodal: true });
    expect(conds).toHaveLength(1);
    const s = sqlText(conds[0]);
    expect(s).toContain(' or ');
    expect(s).toContain('intermodal');
    expect(s).toContain('reefer');
  });

  it('excluding a facet drops its condition (facet-count self-exclude)', () => {
    const conds = buildConditions({ ...base, equipment: ['reefer'], cargo: ['produce'] }, new Set(['equipment']));
    expect(conds).toHaveLength(1); // only cargo survives
    expect(sqlText(conds[0])).toContain('produce');
  });
});

describe('carrier-name search — q parse / normalize', () => {
  it('trims and keeps a valid term', () => {
    expect(normalizeNameQuery('  Harbor Link  ')).toBe('Harbor Link');
  });
  it('collapses interior whitespace', () => {
    expect(normalizeNameQuery('Harbor    Link   Logistics')).toBe('Harbor Link Logistics');
  });
  it('rejects sub-minimum-length terms (→ null)', () => {
    expect(normalizeNameQuery('a')).toBeNull();
    expect(normalizeNameQuery(' x ')).toBeNull();
    expect(NAME_SEARCH_MIN).toBe(2);
  });
  it('treats blank / junk / nullish as null (never throws)', () => {
    expect(normalizeNameQuery('')).toBeNull();
    expect(normalizeNameQuery('   ')).toBeNull();
    expect(normalizeNameQuery(undefined)).toBeNull();
    expect(normalizeNameQuery(null)).toBeNull();
  });
  it('caps an over-long term at 100 chars', () => {
    const long = 'x'.repeat(250);
    expect(normalizeNameQuery(long)!.length).toBe(100);
  });
  it('normalizeFilters exposes the parsed term on f.q (and nulls junk)', () => {
    expect(normalizeFilters({ q: '  acme  ' }).q).toBe('acme');
    expect(normalizeFilters({ q: 'a' }).q).toBeNull();
    expect(normalizeFilters({}).q).toBeNull();
  });
});

describe('carrier-name search — SQL clause', () => {
  const base = normalizeFilters({});

  it('produces an ILIKE OR over legal_name + dba_name', () => {
    const cond = nameSearchCondition('harbor');
    expect(cond).not.toBeNull();
    const s = sqlText(cond);
    expect(s).toContain('ilike');
    expect(s).toContain(' or ');
    expect(s).toContain('legal_name');
    expect(s).toContain('dba_name');
  });

  it('escapes LIKE metacharacters so wildcards match literally', () => {
    const q = dialect.sqlToQuery(
      (nameSearchCondition('50%_off\\deal') as { getSQL: () => import('drizzle-orm').SQL }).getSQL(),
    );
    // The bound param carries the escaped, wrapped pattern.
    expect(q.params.some((p) => p === '%50\\%\\_off\\\\deal%')).toBe(true);
  });

  it('returns null for a too-short term', () => {
    expect(nameSearchCondition('a')).toBeNull();
  });

  it('buildConditions adds the q clause and AND-combines it with other facets', () => {
    const conds = buildConditions({ ...base, q: 'harbor', equipment: ['reefer'] });
    expect(conds).toHaveLength(2);
    const whole = sqlText(and(...conds));
    expect(whole).toContain(' and ');
    expect(whole).toContain('ilike');
    expect(whole).toContain('reefer');
  });

  it('excluding q drops only the name clause (facet-count self-exclude)', () => {
    const conds = buildConditions({ ...base, q: 'harbor', equipment: ['reefer'] }, new Set(['q']));
    expect(conds).toHaveLength(1);
    expect(sqlText(conds[0])).not.toContain('ilike');
  });

  it('no q → no name clause', () => {
    expect(buildConditions({ ...base, q: null })).toHaveLength(0);
  });
});

describe('port groups — facet matches ANY co-located member code', () => {
  const base = normalizeFilters({});

  it('normalizeFilters passes a port group code straight through (upper-cased)', () => {
    expect(normalizeFilters({ port: 'uslalb' }).port).toBe('USLALB');
  });

  it('the LA / Long Beach group resolves to BOTH member codes', () => {
    expect(portFilterCodes('USLALB').sort()).toEqual(['USLAX', 'USLGB']);
  });

  it('a bare legacy member code consolidates to the whole hub (USLAX → LA/LB pair)', () => {
    expect(portFilterCodes('USLAX').sort()).toEqual(['USLAX', 'USLGB']);
    expect(portFilterCodes('USLGB').sort()).toEqual(['USLAX', 'USLGB']);
  });

  it('a standalone port resolves to just itself', () => {
    expect(portFilterCodes('USMIA')).toEqual(['USMIA']);
  });

  it('an unknown port value filters literally (never throws / empties)', () => {
    expect(portFilterCodes('ZZZZ')).toEqual(['ZZZZ']);
    expect(portFilterCodes('')).toEqual([]);
  });

  it('a group port contributes exactly ONE WHERE condition (the member OR-set)', () => {
    const conds = buildConditions({ ...base, port: 'USLALB' });
    expect(conds).toHaveLength(1);
    // (member codes are bound params, so we assert the count + the members via the helper)
    expect(portFilterCodes('USLALB')).toHaveLength(2);
  });

  it('excluding the port dimension drops its condition (facet-count self-exclude)', () => {
    const conds = buildConditions({ ...base, port: 'USLALB' }, new Set(['port']));
    expect(conds).toHaveLength(0);
  });

  it('port is a recognized facet query key (shareable/crawlable results view)', () => {
    expect(FACET_QUERY_KEYS).toContain('port');
  });

  it('a merged member code maps to a DIFFERENT group code (drives the 301 redirect)', () => {
    const g = portGroupForMemberCode('USLAX');
    expect(g?.code).toBe('USLALB');
    expect(g?.code).not.toBe('USLAX'); // route sees code !== group.code → 301
    // A standalone code is its own group code → no redirect.
    expect(portGroupByCode('USMIA')?.code).toBe('USMIA');
  });
});

describe('safety → single "good standing" toggle', () => {
  const base = normalizeFilters({});

  it('the toggle is OFF by default', () => {
    expect(normalizeFilters({}).goodStandingOnly).toBe(false);
  });

  it('?standing=good turns it on; a truthy 1 also works', () => {
    expect(normalizeFilters({ standing: 'good' }).goodStandingOnly).toBe(true);
    expect(normalizeFilters({ standing: '1' }).goodStandingOnly).toBe(true);
  });

  it('emits ONE condition that excludes Conditional + Unsatisfactory but keeps unrated', () => {
    const conds = buildConditions({ ...base, goodStandingOnly: true });
    expect(conds).toHaveLength(1);
    const s = sqlText(conds[0]);
    expect(s).toContain('safety_rating');
    expect(s).toContain('is null'); // not-rated (null) is KEPT
    expect(s).toContain("not in ('c', 'u')"); // conditional + unsatisfactory dropped
  });

  it('off → no safety condition at all', () => {
    expect(buildConditions({ ...base, goodStandingOnly: false })).toHaveLength(0);
  });

  it('standing is a recognized facet query key', () => {
    expect(FACET_QUERY_KEYS).toContain('standing');
  });
});

describe('orderForSort — direction is reflected in the ORDER BY', () => {
  it('fleet asc vs desc flips the power_units direction', () => {
    expect(sqlText(orderForSort('fleet', 'asc')[0])).toContain('asc');
    expect(sqlText(orderForSort('fleet', 'desc')[0])).toContain('desc');
  });
  it('drivers sort orders by the drivers column', () => {
    expect(sqlText(orderForSort('drivers', 'desc')[0])).toContain('drivers');
  });
  it('recent asc vs desc flips the updated_at direction', () => {
    expect(sqlText(orderForSort('recent', 'asc')[0])).toContain('asc');
    expect(sqlText(orderForSort('recent', 'desc')[0])).toContain('desc');
  });
});
