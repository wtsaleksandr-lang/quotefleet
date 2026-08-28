import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DIRECTORY_FLAG_INDEX_COLUMNS, SELF_HEAL_TABLE_STATEMENTS } from './migrate.js';
import {
  CARGO_OPTIONS,
  EQUIPMENT_OPTIONS,
  buildConditions,
  normalizeFilters,
  orderForSort,
} from '../server/directory/queries.js';

/** Render a WHERE/ORDER SQL fragment to lowercase text (same helper as facets.test.ts). */
const dialect = new PgDialect();
const sqlText = (frag: unknown): string =>
  dialect.sqlToQuery((frag as { getSQL: () => import('drizzle-orm').SQL }).getSQL()).sql.toLowerCase();
const sqlTextAll = (frags: readonly unknown[]): string => frags.map(sqlText).join(' | ');

/**
 * /directory query indexes (0066_directory_query_indexes.sql).
 *
 * THE BUG: listCarriers → listCarriersUnsafe ran a filtered count(*) + an
 * ordered LIMIT page over the 330k-row carrier_directory with only
 * (state) and (nearest_port_code) single-column indexes. Those narrow to a
 * state/port but leave the ORDER BY keys and the ~20 cargo booleans in the heap,
 * so each request bitmap-fetched 4,600–12,000 heap pages and top-N sorted them.
 * On a cold Neon page cache that blew the 8s statement_timeout (57014) and the
 * route degraded to an empty list.
 *
 * These assertions are static (no live DB): they pin the index SET and keep the
 * three sources of truth — migrate.ts self-heal DDL, schema.ts, and the drizzle
 * SQL file — byte-for-byte in sync, and keep the index shapes matching what
 * orderForSort()/buildConditions() actually emit.
 */
const migrateSql = SELF_HEAL_TABLE_STATEMENTS.join('\n');
const schemaSrc = readFileSync(fileURLToPath(new URL('./schema.ts', import.meta.url)), 'utf8');
const migrationSql = readFileSync(
  fileURLToPath(new URL('../../drizzle/0066_directory_query_indexes.sql', import.meta.url)),
  'utf8',
);

/** The five composite indexes, as the exact self-heal statement each must be. */
const COMPOSITES: Array<[string, string]> = [
  [
    'carrier_directory_state_featured_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_state_featured_idx" ON "carrier_directory" ("state", "intermodal" DESC, "power_units" DESC NULLS LAST)`,
  ],
  [
    'carrier_directory_port_featured_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_port_featured_idx" ON "carrier_directory" ("nearest_port_code", "intermodal" DESC, "power_units" DESC NULLS LAST)`,
  ],
  [
    'carrier_directory_featured_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_featured_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST)`,
  ],
  [
    'carrier_directory_state_fleet_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_state_fleet_idx" ON "carrier_directory" ("state", "power_units" DESC NULLS LAST)`,
  ],
  [
    'carrier_directory_port_fleet_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_port_fleet_idx" ON "carrier_directory" ("nearest_port_code", "power_units" DESC NULLS LAST)`,
  ],
];

describe('carrier_directory /directory query indexes — self-heal DDL', () => {
  it.each(COMPOSITES)('creates %s idempotently on boot', (_name, stmt) => {
    expect(SELF_HEAL_TABLE_STATEMENTS).toContain(stmt);
  });

  it.each(DIRECTORY_FLAG_INDEX_COLUMNS.map((c) => [c] as [string]))(
    'creates the partial index for the %s facet',
    (col) => {
      expect(SELF_HEAL_TABLE_STATEMENTS).toContain(
        `CREATE INDEX IF NOT EXISTS "carrier_directory_flag_${col}_idx" ON "carrier_directory" ("intermodal" DESC, "power_units" DESC NULLS LAST) WHERE "${col}"`,
      );
    },
  );

  it('excludes dry_van — true for 78.6% of prod rows, so an index is never chosen', () => {
    expect(DIRECTORY_FLAG_INDEX_COLUMNS).not.toContain('dry_van');
    expect(migrateSql).not.toContain('carrier_directory_flag_dry_van_idx');
  });

  it('covers EVERY selectable equipment/cargo facet except dry_van (no facet left unindexed)', () => {
    // The sidebar facet ids map onto these FMCSA boolean columns. `drayage` is
    // the intermodal column; `dryvan` is the deliberate exclusion.
    const facetColumns = new Set([
      ...EQUIPMENT_OPTIONS.map((e) => e.id),
      ...CARGO_OPTIONS.map((c) => c.id),
    ]);
    expect(facetColumns.size).toBe(20);
    // 20 facet options - dry_van = 19 partial indexes.
    expect(DIRECTORY_FLAG_INDEX_COLUMNS).toHaveLength(19);
    expect(new Set(DIRECTORY_FLAG_INDEX_COLUMNS).size).toBe(19);
  });

  it('uses plain CREATE INDEX — CONCURRENTLY cannot run in the self-heal transaction', () => {
    expect(migrateSql).not.toContain('CREATE INDEX CONCURRENTLY');
    // Only the executable statements matter; the `--` rationale comments in the
    // migration file mention CONCURRENTLY to explain why it is NOT used.
    const ddl = migrationSql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(ddl).not.toContain('CONCURRENTLY');
  });

  it('every new index statement is idempotent and index-only (no table rewrite on boot)', () => {
    const added = SELF_HEAL_TABLE_STATEMENTS.filter((s) =>
      /carrier_directory_(state|port)?_?(featured|fleet)_idx|carrier_directory_flag_/.test(s),
    );
    expect(added).toHaveLength(COMPOSITES.length + DIRECTORY_FLAG_INDEX_COLUMNS.length);
    for (const s of added) expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS "carrier_directory_/);
  });
});

/**
 * CITY indexes (0068_city_slug_indexes.sql).
 *
 * THE BUG: the same 57014 → empty list as 0066, one dimension later. 0066
 * indexed state/port/power_units/cargo-flags but nothing indexed `city`, and
 * 0065's sitemap started advertising thousands of city hubs + ~334k carrier
 * profiles, so crawlers hit city-scoped queries in volume for the first time.
 *
 * THE TRAP these tests exist to pin: the route never compares the `city` COLUMN.
 * cityCondition() matches the URL slug through an EXPRESSION, so a plain b-tree
 * on (city) — or on (state, city) — can NEVER serve it; Postgres can only apply
 * it as a post-heap-fetch Filter. The index therefore has to be on the
 * expression, and it has to be the SAME expression byte-for-byte. If anyone
 * edits cityCondition() without editing the index, the index silently stops
 * being used and prod quietly returns to timing out. `matches cityCondition
 * byte-for-byte` below is the test that catches that.
 */
const CITY_SLUG_EXPR = `btrim(regexp_replace(lower("city"), '[^a-z0-9]+', '-', 'g'), '-')`;
const CITY_INDEXES: Array<[string, string]> = [
  [
    'carrier_directory_cityslug_state_featured_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_cityslug_state_featured_idx" ON "carrier_directory" ((${CITY_SLUG_EXPR}), "state", "intermodal" DESC, "power_units" DESC NULLS LAST)`,
  ],
  [
    'carrier_directory_state_city_power_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_state_city_power_idx" ON "carrier_directory" ("state", "city", "power_units" DESC NULLS LAST)`,
  ],
];
const cityMigrationSql = readFileSync(
  fileURLToPath(new URL('../../drizzle/0068_city_slug_indexes.sql', import.meta.url)),
  'utf8',
);

describe('carrier_directory CITY indexes — self-heal DDL', () => {
  it.each(CITY_INDEXES)('creates %s idempotently on boot', (_name, stmt) => {
    expect(SELF_HEAL_TABLE_STATEMENTS).toContain(stmt);
  });

  it.each(CITY_INDEXES)('drizzle/0068 declares %s with the same column list', (_name, stmt) => {
    expect(cityMigrationSql).toContain(`${stmt};`);
  });

  it.each(CITY_INDEXES)('schema.ts declares %s', (name) => {
    expect(schemaSrc).toContain(`index('${name}')`);
  });

  it('uses plain CREATE INDEX — CONCURRENTLY cannot run in the self-heal transaction', () => {
    const ddl = cityMigrationSql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(ddl).not.toContain('CONCURRENTLY');
  });

  it('does NOT create a bare (city) index — the planner never picks one for the slug expression', () => {
    expect(migrateSql).not.toContain(`"carrier_directory_city_idx"`);
    const bareCity = SELF_HEAL_TABLE_STATEMENTS.filter((s) =>
      /ON "carrier_directory" \("city"\)/.test(s),
    );
    expect(bareCity).toHaveLength(0);
  });
});

describe('the city index matches the query it exists for', () => {
  it('indexes the EXPRESSION, not the bare city column', () => {
    const [, stmt] = CITY_INDEXES[0];
    // The expression must be wrapped in its own parens (Postgres requires it)
    // and must be the LEADING index column.
    expect(stmt).toContain(`((${CITY_SLUG_EXPR}), "state"`);
  });

  it('matches cityCondition() byte-for-byte — the whole index depends on this', () => {
    // Render the predicate the route actually emits and compare it to the
    // expression the index is built on. Both are lowercased and stripped of the
    // table qualifier / bind placeholder that only the query side carries.
    const rendered = sqlTextAll(buildConditions(normalizeFilters({ state: 'AL', city: 'frisco-city' })));
    const normalize = (s: string) => s.replace(/"carrier_directory"\./g, '').replace(/\s+/g, ' ');
    expect(normalize(rendered)).toContain(normalize(CITY_SLUG_EXPR.toLowerCase()));
  });

  it('a state + city filter emits exactly the two predicates the index leads with', () => {
    const conditions = buildConditions(normalizeFilters({ state: 'AL', city: 'frisco-city' }));
    expect(conditions).toHaveLength(2);
    const text = sqlTextAll(conditions);
    expect(text).toContain('"state"');
    expect(text).toContain('regexp_replace');
  });

  it('the sort prefix after the two equality columns is the `featured` sort', () => {
    // (slug, state, intermodal DESC, power_units DESC NULLS LAST): with both
    // leading columns pinned by equality the remaining two must be exactly the
    // default ORDER BY's leading pair, or the LIMIT cannot terminate in-index.
    const order = orderForSort(normalizeFilters({ state: 'AL', city: 'frisco-city' }).sort);
    expect(sqlText(order[0])).toContain('"intermodal" desc');
    expect(sqlText(order[1])).toContain('"power_units" desc nulls last');
  });
});

describe('carrier_directory query indexes — schema.ts + drizzle SQL stay in sync', () => {
  it.each(COMPOSITES)('drizzle/0066 declares %s with the same column list', (name, stmt) => {
    expect(migrationSql).toContain(`${stmt};`);
  });

  it.each(DIRECTORY_FLAG_INDEX_COLUMNS.map((c) => [c] as [string]))(
    'drizzle/0066 declares the %s partial index',
    (col) => {
      expect(migrationSql).toContain(`"carrier_directory_flag_${col}_idx"`);
      expect(migrationSql).toContain(`WHERE "${col}";`);
    },
  );

  it.each(COMPOSITES)('schema.ts declares %s', (name) => {
    expect(schemaSrc).toContain(`index('${name}')`);
  });

  it('schema.ts declares the partial flag indexes via the shared template', () => {
    expect(schemaSrc).toContain('index(`carrier_directory_flag_${name}_idx`)');
    for (const col of DIRECTORY_FLAG_INDEX_COLUMNS) expect(schemaSrc).toContain(`'${col}'`);
  });
});

describe('index shapes match the queries they exist for', () => {
  it('the DEFAULT sort really is intermodal DESC, power_units DESC NULLS LAST (the *_featured_idx shape)', () => {
    const filters = normalizeFilters({});
    expect(filters.sort).toBe('featured');
    const order = orderForSort(filters.sort, filters.dir);
    // 4 chunks: intermodal desc, power_units desc nulls last, legal_name, id.
    expect(order).toHaveLength(4);
    // The index's leading two columns must be exactly the ORDER BY's leading two.
    expect(sqlText(order[0])).toContain('"intermodal" desc');
    expect(sqlText(order[1])).toContain('"power_units" desc nulls last');
  });

  it('the `fleet` sort leads with power_units DESC NULLS LAST (the *_fleet_idx shape)', () => {
    const order = orderForSort('fleet', 'desc');
    expect(sqlText(order[0])).toContain('"power_units" desc nulls last');
  });

  it('a state + fleet-bucket + cargo filter still emits the 3 predicates the indexes serve', () => {
    const filters = normalizeFilters({ state: 'WI', fleet: '1-25', cargo: 'grainfeed' });
    const conditions = buildConditions(filters);
    expect(conditions).toHaveLength(3);
    const text = sqlTextAll(conditions);
    expect(text).toContain('"state"');
    expect(text).toContain('"power_units"');
    expect(text).toContain('"grain_feed"');
  });

  it('a port + cargo filter (the exact shape that timed out on prod) emits both predicates', () => {
    const filters = normalizeFilters({ port: 'INLCLT', cargo: 'oilfield', sort: 'fleet' });
    const conditions = buildConditions(filters);
    expect(conditions).toHaveLength(2);
    const text = sqlTextAll(conditions);
    expect(text).toContain('"nearest_port_code"');
    expect(text).toContain('"oilfield"');
  });
});
