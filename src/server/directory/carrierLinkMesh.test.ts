/**
 * INTERNAL-LINK MESH CONTRACT — the equity half of the crawl work.
 *
 * #455 fixed carrier REACHABILITY (9.2% → ~100% of 330,218 profiles walkable
 * from `/`) and explicitly deferred EQUITY. This file pins the deferred half.
 *
 * THE MEASURED PROBLEM (census over all 330,452 prod rows, 2026-08-30). The old
 * relatedCarriers() asked for the same thing on every page — the `featured`
 * top-6 of the carrier's city — so the target set did not depend on who was
 * linking and all 3,511 Houston profiles pointed at the same six carriers:
 *
 *   distinct carriers receiving ANY profile→profile link      97,287  (29.4%)
 *   carriers receiving NONE                                  241,428  (73.1%)
 *   most inbound links to a single carrier                     3,510
 *   p99 / p99.9 inbound                                        89 / 467
 *
 * THE FIX is a RING: one total order over the table, and each carrier links to
 * the K carriers that FOLLOW it, wrapping past the end. Out-degree and in-degree
 * are then both K for every member, because the set pointing at position p is
 * exactly p-1 … p-K. Modelled over the same 330,452 rows:
 *
 *   distinct carriers receiving a link                       330,451 (100.00%)
 *   carriers receiving none                                        1  (the only
 *                                                        carrier in Guam — its
 *                                                        city, its state and its
 *                                                        no-port group all hold
 *                                                        exactly one row)
 *   most inbound links to a single carrier                         9
 *   p50 / p99 / p99.9 inbound                                  6 / 7 / 8
 *
 * What these tests actually protect, none of which is visible in the diff:
 *   • the ring order and the index key columns are ONE thing — if they drift the
 *     seek silently degrades to a full scan of the city (0068's trap, one
 *     dimension in);
 *   • the seek stays a ROW-wise comparison over a COALESCE'd, NULL-free key —
 *     an OR-chain or a NULLS LAST spelling would not fold into an Index Cond;
 *   • the window is a function of the LINKER (that is the whole difference
 *     between a mesh and a star);
 *   • the link BUDGET stays at 6, so ~330k crawled pages do not get heavier.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { SELF_HEAL_TABLE_STATEMENTS } from '../../db/migrate.js';
import { carrierDirectory } from '../../db/schema.js';

// ── a fake `db()` that records every ring query and answers from a script ──
interface Recorded {
  where: string;
  order: string;
  limit: number;
}
const calls: Recorded[] = [];
/** Rows the next matching query resolves to, keyed by scope + forward/head. */
let script: Record<string, (typeof carrierDirectory.$inferSelect)[]> = {};

const dialect = new PgDialect();
const render = (frag: unknown): string =>
  dialect.sqlToQuery((frag as { getSQL: () => SQL }).getSQL()).sql.toLowerCase();

/** Which ring a rendered WHERE clause belongs to, and whether it is the seek. */
function classify(where: string): string {
  const scope = where.includes('regexp_replace')
    ? 'city'
    : where.includes('"nearest_port_code" is null')
      ? 'noport'
      : 'port';
  return `${scope}:${where.includes('coalesce') && where.includes(') < (') ? 'forward' : 'head'}`;
}

vi.mock('../../db/client.js', () => ({
  db: () => ({
    select: () => ({
      from: () => {
        const rec: Recorded = { where: '', order: '', limit: 0 };
        const chain = {
          where(w: unknown) {
            rec.where = render(w);
            return chain;
          },
          orderBy(...o: unknown[]) {
            rec.order = o.map(render).join(', ');
            return chain;
          },
          limit(n: number) {
            rec.limit = n;
            calls.push(rec);
            return Promise.resolve(script[classify(rec.where)] ?? []);
          },
        };
        return chain;
      },
    }),
  }),
}));

const { relatedCarriers, ringOrder, visibleCarrier, RELATED_CITY_SLOTS, RELATED_NEARBY_SLOTS, RELATED_LIMIT } =
  await import('./queries.js');

type Row = typeof carrierDirectory.$inferSelect;
function row(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    usdot: '1000001',
    mcNumber: null,
    legalName: 'RING CARRIER LLC',
    dbaName: null,
    city: 'HOUSTON',
    state: 'TX',
    country: 'US',
    zip: '77002',
    phone: null,
    email: null,
    contactHidden: false,
    powerUnits: 10,
    drivers: 12,
    safetyRating: 'S',
    authorityType: 'common',
    intermodal: false,
    hazmat: false,
    dryVan: false,
    reefer: false,
    tanker: false,
    flatbed: false,
    dryBulk: false,
    householdGoods: false,
    beverages: false,
    produce: false,
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
    publicSlug: 'ring-carrier-1000001',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  } as Row;
}
/** n rows that differ only in the fields the mesh keys and dedupes on. */
const rows = (n: number, prefix: string, over: Partial<Row> = {}): Row[] =>
  Array.from({ length: n }, (_, i) =>
    row({ usdot: `${prefix}${i}`, publicSlug: `${prefix}-${i}`, legalName: `${prefix.toUpperCase()} ${i}`, ...over }),
  );

beforeEach(() => {
  calls.length = 0;
  script = {};
});

// ─── the ring order ⇄ index key columns ───────────────────────────────────
describe('the ring order is the index key, or the seek silently full-scans', () => {
  it('orders by intermodal DESC, COALESCE(power_units, 0) DESC, usdot DESC', () => {
    const text = ringOrder().map(render).join(', ').replace(/"carrier_directory"\./g, '');
    expect(text).toBe('"intermodal" desc, coalesce("power_units", 0) desc, "usdot" desc');
  });

  it('does NOT reuse 0068’s `power_units DESC NULLS LAST` — it is not the same key', () => {
    // 0068's index ends in `power_units DESC NULLS LAST`. A row-wise comparison
    // has no NULLS LAST spelling and a NULL operand makes it return NULL, which
    // would drop the 449 NULL-power_units carriers off the ring entirely.
    expect(ringOrder().map(render).join(' ')).not.toContain('nulls last');
  });

  it('carries a UNIQUE tie-break, so a tie group cannot collapse back into a star', async () => {
    // Most carriers in a big city report the same power_units, so an order that
    // stopped there would let every tied carrier seek past the whole tie group
    // to the SAME next target — the concentration bug, rebuilt.
    expect(render(ringOrder()[2])).toContain('usdot');
    // …and `usdot` is only a valid tie-break because it is UNIQUE and NOT NULL.
    expect(SELF_HEAL_TABLE_STATEMENTS).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS "carrier_directory_usdot_idx" ON "carrier_directory" ("usdot")`,
    );
  });
});

// ─── the seek shape ───────────────────────────────────────────────────────
describe('the seek is a row-wise comparison over a NULL-free key', () => {
  it('emits ROW(intermodal, coalesce(power_units,0), usdot) < ROW($…)', async () => {
    script['city:forward'] = rows(7, 'c');
    script['port:forward'] = rows(7, 'p', { city: 'PASADENA', publicSlug: 'x' });
    await relatedCarriers(visibleCarrier(row({ usdot: '999', publicSlug: 'me' })));
    const seek = calls.find((c) => c.where.includes('regexp_replace'))!.where.replace(/"carrier_directory"\./g, '');
    expect(seek).toContain('("intermodal", coalesce("power_units", 0), "usdot") < (');
  });

  it('scopes the city ring to state + the city SLUG EXPRESSION, never the raw column', () => {
    // Same trap as 0068: a predicate on `city` cannot use an index on the slug.
    return relatedCarriers(visibleCarrier(row())).then(() => {
      const city = calls.find((c) => c.where.includes('regexp_replace'))!.where;
      expect(city).toContain(`btrim(regexp_replace(lower("carrier_directory"."city"), '[^a-z0-9]+', '-', 'g'), '-')`);
      expect(city).toContain('"carrier_directory"."state" = ');
    });
  });

  it('uses the no-port STATE ring only when the carrier has no port code', async () => {
    await relatedCarriers(visibleCarrier(row({ nearestPortCode: null })));
    expect(calls.some((c) => c.where.includes('"nearest_port_code" is null'))).toBe(true);
    calls.length = 0;
    await relatedCarriers(visibleCarrier(row({ nearestPortCode: 'USHOU' })));
    expect(calls.some((c) => c.where.includes('"nearest_port_code" is null'))).toBe(false);
    expect(calls.some((c) => c.where.includes('"nearest_port_code" = '))).toBe(true);
  });
});

// ─── the mesh property ────────────────────────────────────────────────────
describe('the window is a function of the LINKER (mesh, not star)', () => {
  it('fills the city slots from the seek and the rest from the corridor ring', async () => {
    script['city:forward'] = rows(7, 'city');
    script['port:forward'] = rows(7, 'port', { city: 'PASADENA' });
    const out = await relatedCarriers(visibleCarrier(row({ usdot: '999', publicSlug: 'me' })));
    expect(out).toHaveLength(RELATED_LIMIT);
    expect(out.slice(0, RELATED_CITY_SLOTS).map((c) => c.slug)).toEqual(['city-0', 'city-1', 'city-2']);
    expect(out.slice(RELATED_CITY_SLOTS).map((c) => c.slug)).toEqual(['port-0', 'port-1', 'port-2']);
    expect(RELATED_CITY_SLOTS + RELATED_NEARBY_SLOTS).toBe(RELATED_LIMIT);
  });

  it('costs ONE round trip when both rings are long enough', async () => {
    script['city:forward'] = rows(7, 'city');
    script['port:forward'] = rows(7, 'port', { city: 'PASADENA' });
    await relatedCarriers(visibleCarrier(row({ usdot: '999', publicSlug: 'me' })));
    expect(calls.map((c) => classify(c.where)).sort()).toEqual(['city:forward', 'port:forward']);
  });

  it('wraps to the ring head for the carriers at the tail — this is what gives the HEAD its inbound links', async () => {
    script['city:forward'] = []; // last carrier on the city ring
    script['city:head'] = rows(7, 'head');
    script['port:forward'] = rows(7, 'port', { city: 'PASADENA' });
    const out = await relatedCarriers(visibleCarrier(row({ usdot: '000', publicSlug: 'me' })));
    expect(out.slice(0, RELATED_CITY_SLOTS).map((c) => c.slug)).toEqual(['head-0', 'head-1', 'head-2']);
    expect(out).toHaveLength(RELATED_LIMIT);
    expect(calls.map((c) => classify(c.where))).toContain('city:head');
  });

  it('never links a carrier to itself and never repeats a target', async () => {
    const me = row({ usdot: '999', publicSlug: 'me' });
    script['city:forward'] = [me, ...rows(3, 'city')];
    script['port:forward'] = [me, ...rows(3, 'city'), ...rows(4, 'port', { city: 'PASADENA' })];
    const out = await relatedCarriers(visibleCarrier(me));
    expect(out.map((c) => c.slug)).not.toContain('me');
    expect(new Set(out.map((c) => c.slug)).size).toBe(out.length);
  });

  it('gives the city ring its slots back when the corridor ring is tiny', async () => {
    // A carrier whose port group holds nobody else must still render a full list.
    script['city:forward'] = rows(7, 'city');
    script['port:forward'] = [];
    script['port:head'] = [];
    const out = await relatedCarriers(visibleCarrier(row({ usdot: '999', publicSlug: 'me' })));
    expect(out).toHaveLength(RELATED_LIMIT);
    expect(out.every((c) => c.slug.startsWith('city-'))).toBe(true);
  });

  it('gives the corridor ring every slot for the only carrier in its city', async () => {
    // 8,251 carriers are alone in their city. Without the corridor ring they
    // would have nobody to link to and nobody linking to them.
    script['city:forward'] = [];
    script['city:head'] = [];
    script['port:forward'] = rows(7, 'port', { city: 'PASADENA' });
    const out = await relatedCarriers(visibleCarrier(row({ usdot: '999', publicSlug: 'me' })));
    expect(out).toHaveLength(RELATED_LIMIT);
    expect(out.every((c) => c.slug.startsWith('port-'))).toBe(true);
  });

  it('is deterministic — the ~330k profile URLs must stay byte-identical per visitor', async () => {
    script['city:forward'] = rows(7, 'city');
    script['port:forward'] = rows(7, 'port', { city: 'PASADENA' });
    const me = visibleCarrier(row({ usdot: '999', publicSlug: 'me' }));
    const a = (await relatedCarriers(me)).map((c) => c.slug);
    const b = (await relatedCarriers(me)).map((c) => c.slug);
    expect(a).toEqual(b);
  });

  it('serves none rather than throwing when the ring query fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = () => {
      throw new Error('57014');
    };
    script = new Proxy({}, { get: boom }) as never;
    await expect(relatedCarriers(visibleCarrier(row()))).resolves.toEqual([]);
    warn.mockRestore();
  });
});

// ─── crawl cost ───────────────────────────────────────────────────────────
describe('crawl cost does not regress', () => {
  it('keeps the per-profile link budget at 6', async () => {
    // #455 cut directory crawl bytes ~60%; the mesh must not give that back. In
    // a ring, in-degree EQUALS out-degree, so 6 already reaches every carrier —
    // a bigger number would add bytes to ~330k crawled pages and buy no coverage.
    expect(RELATED_LIMIT).toBe(6);
    script['city:forward'] = rows(50, 'city');
    script['port:forward'] = rows(50, 'port', { city: 'PASADENA' });
    const out = await relatedCarriers(visibleCarrier(row({ usdot: '999', publicSlug: 'me' })));
    expect(out).toHaveLength(6);
  });

  it('never asks for an unbounded window', async () => {
    script['city:forward'] = rows(7, 'city');
    script['port:forward'] = rows(7, 'port', { city: 'PASADENA' });
    await relatedCarriers(visibleCarrier(row({ usdot: '999', publicSlug: 'me' })));
    for (const c of calls) expect(c.limit).toBeLessThanOrEqual(RELATED_LIMIT + 1);
  });

  it('costs at most two round trips (4 statements) for any carrier', async () => {
    script['city:forward'] = [];
    script['city:head'] = [];
    script['port:forward'] = [];
    script['port:head'] = [];
    await relatedCarriers(visibleCarrier(row()));
    expect(calls.length).toBeLessThanOrEqual(4);
  });
});

// ─── the rendered module ──────────────────────────────────────────────────
describe('the profile splits the ring into two honestly-labelled sections', () => {
  const profile = async (related: ReturnType<typeof visibleCarrier>[]) => {
    const { renderCarrierProfile } = await import('./pages.js');
    return renderCarrierProfile({
      carrier: visibleCarrier(row({ usdot: '999', publicSlug: 'me', nearestPortCode: 'USHOU' })),
      related,
      cityCount: 3511,
      stateCount: 31668,
    });
  };
  const mixed = () => [
    ...rows(3, 'city').map(visibleCarrier),
    ...rows(3, 'port', { city: 'PASADENA' }).map(visibleCarrier),
  ];

  it('names the city ring and the corridor ring separately', async () => {
    const html = await profile(mixed());
    expect(html).toContain('Other carriers in Houston');
    expect(html).toContain('More carriers near');
    // Both sections reuse the SAME heading component as every other directory
    // section, which is what keeps them left-aligned (see DESIGN-SYSTEM).
    expect(html.match(/dir-section-h/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('renders EVERY related link — the split is a partition, not a filter', async () => {
    const html = await profile(mixed());
    for (const slug of ['city-0', 'city-1', 'city-2', 'port-0', 'port-1', 'port-2']) {
      expect(html).toContain(`/directory/carrier/${slug}`);
    }
  });

  it('shows one section when the whole list is same-city (no empty heading)', async () => {
    const html = await profile(rows(6, 'city').map(visibleCarrier));
    expect(html).toContain('Other carriers in Houston');
    expect(html).not.toContain('More carriers near');
  });

  it('shows only the corridor section for the only carrier in its city', async () => {
    const html = await profile(rows(6, 'port', { city: 'PASADENA' }).map(visibleCarrier));
    expect(html).not.toContain('Other carriers in Houston');
    expect(html).toContain('More carriers near');
  });
});

// ─── the indexes that make it a seek (0071) ───────────────────────────────
const RING_KEY = `"intermodal" DESC, (COALESCE("power_units", 0)) DESC, "usdot" DESC`;
const CITY_SLUG_EXPR = `btrim(regexp_replace(lower("city"), '[^a-z0-9]+', '-', 'g'), '-')`;
const RING_INDEXES: Array<[string, string]> = [
  [
    'carrier_directory_cityslug_ring_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_cityslug_ring_idx" ON "carrier_directory" ((${CITY_SLUG_EXPR}), "state", ${RING_KEY})`,
  ],
  [
    'carrier_directory_port_ring_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_port_ring_idx" ON "carrier_directory" ("nearest_port_code", ${RING_KEY})`,
  ],
  [
    'carrier_directory_state_noport_ring_idx',
    `CREATE INDEX IF NOT EXISTS "carrier_directory_state_noport_ring_idx" ON "carrier_directory" ("state", ${RING_KEY}) WHERE "nearest_port_code" IS NULL`,
  ],
];
const ringMigrationSql = readFileSync(
  fileURLToPath(new URL('../../../drizzle/0071_carrier_ring_indexes.sql', import.meta.url)),
  'utf8',
);
const schemaSrc = readFileSync(fileURLToPath(new URL('../../db/schema.ts', import.meta.url)), 'utf8');

describe('carrier_directory RING indexes — self-heal DDL (0071)', () => {
  it.each(RING_INDEXES)('creates %s idempotently on boot', (_name, stmt) => {
    expect(SELF_HEAL_TABLE_STATEMENTS).toContain(stmt);
  });

  it.each(RING_INDEXES)('drizzle/0071 declares %s with the same column list', (_name, stmt) => {
    expect(ringMigrationSql).toContain(`${stmt};`);
  });

  it.each(RING_INDEXES)('schema.ts declares %s', (name) => {
    expect(schemaSrc).toContain(`index('${name}')`);
  });

  it('every ring index ends in the EXACT key ringOrder() emits', () => {
    // The one assertion that stops the seek quietly degrading to a Filter over
    // the whole city: index key columns and ORDER BY are the same sentence.
    const orderText = ringOrder().map(render).join(', ').replace(/"carrier_directory"\./g, '');
    const keyText = RING_KEY.toLowerCase().replace(/\(coalesce/g, 'coalesce').replace(/, 0\)\) desc/g, ', 0) desc');
    expect(keyText).toBe(orderText);
    for (const [, stmt] of RING_INDEXES) expect(stmt).toContain(RING_KEY);
  });

  it('the no-port ring index is PARTIAL — a ring only spreads if its members are its queriers', () => {
    const [, stmt] = RING_INDEXES[2];
    expect(stmt).toContain(`WHERE "nearest_port_code" IS NULL`);
  });

  it('uses plain CREATE INDEX — a failed CONCURRENTLY build would look "present" to the catalog pre-check', () => {
    const ddl = ringMigrationSql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(ddl).not.toContain('CONCURRENTLY');
  });

  it('is purely additive — no index is dropped or reshaped', () => {
    expect(ringMigrationSql).not.toMatch(/^\s*DROP\s+INDEX/im);
    expect(ringMigrationSql).not.toMatch(/^\s*ALTER\s+TABLE/im);
  });

  it('every ring statement is an idempotent CREATE INDEX (no table rewrite on boot)', () => {
    const added = SELF_HEAL_TABLE_STATEMENTS.filter((s) => s.includes('_ring_idx'));
    expect(added).toHaveLength(RING_INDEXES.length);
    for (const s of added) expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS "carrier_directory_/);
  });
});
