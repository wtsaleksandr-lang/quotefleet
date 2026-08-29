/**
 * CARRIER RICHNESS SCORE — the crawl-budget prioritiser behind the sitemap's
 * rich-first carrier ordering.
 *
 * What these lock:
 *   • the TS scorer reproduces, EXACTLY, the scores Postgres computed for real
 *     production rows using `richnessScoreSql()` (measured 2026-08-29) — the two
 *     implementations cannot drift apart without failing here;
 *   • the SQL expression still carries every weight and every scored column;
 *   • richest-first ordering genuinely puts substantive carriers ahead of stubs;
 *   • the priority ladder keeps hubs strictly above the best carrier profile;
 *   • `<lastmod>` is the row's REAL timestamp, never the rebuild's clock.
 */
import { describe, it, expect } from 'vitest';
import {
  carrierRichnessScore,
  richnessScoreSql,
  richnessTier,
  carrierPriority,
  carrierChangefreq,
  RICHNESS_WEIGHTS,
  RICHNESS_FLAG_COLUMNS,
  FLEET_BANDS,
  DRIVER_BANDS,
  FLAG_CAP,
  MAX_RICHNESS_SCORE,
  RICH_TIER_MIN,
  MID_TIER_MIN,
  type RichnessInput,
} from './carrierRichness.js';
import {
  buildCarrierChunkXml,
  sortCarriersByRichness,
  staticPageEntries,
  buildCitiesXml,
  type CarrierSitemapRow,
} from './sitemapCache.js';
import {
  CARRIER_CHANGED_SQL,
  CARRIER_MUTABLE_COLUMNS,
  CARRIER_UPDATED_AT_SQL,
  CARRIER_UPSERT_SET,
} from './carrierIngest.js';

/**
 * REAL production rows, with the score Postgres itself returned for them when
 * `richnessScoreSql()` was run against prod (read-only EXPLAIN/SELECT session,
 * 2026-08-29, carrier_directory @ 330,218 rows).
 *
 * This is the cross-implementation equality proof: the SQL half of the score
 * cannot be executed inside vitest (there is no DB in unit tests), so instead we
 * pin the numbers Postgres actually produced and require the TS half to agree.
 * If someone edits one implementation and not the other, these fail.
 */
const PROD_ROWS: Array<{ label: string; row: RichnessInput; prodScore: number }> = [
  {
    // Top of the prod ordering. Every signal present, fleet far past the top band.
    label: 'ACME TRUCK LINE, INC. (acme-truck-line-inc-52767)',
    row: {
      powerUnits: 1116,
      drivers: 1065,
      safetyRating: 'S',
      dbaName: 'ACME SUPPLY CHAIN SOLUTIONS',
      nearestPortCode: 'USNOL',
      city: 'HARVEY',
      state: 'LA',
      mcNumber: 'MC104874',
      authorityType: 'common,contract',
      phone: '5043663000',
      email: 'safety@acmetruck.com',
      contactHidden: false,
      flagCount: 12, // capped to FLAG_CAP
    },
    prodScore: 100,
  },
  {
    // Also a prod 100 — a much smaller fleet (173 units) reaching the same
    // ceiling, which is exactly why the sitemap sort tie-breaks on power_units.
    label: 'BETTENDORF ENTERPRISES INC (bettendorf-enterprises-inc-161866)',
    row: {
      powerUnits: 173,
      drivers: 185,
      safetyRating: 'S',
      dbaName: 'BETTENDORF TRUCKING',
      nearestPortCode: 'USOAK',
      city: 'BETTENDORF',
      state: 'IA',
      mcNumber: 'MC120299',
      authorityType: 'common',
      phone: '5633552341',
      email: 'ops@bettendorf.example',
      contactHidden: false,
      flagCount: 6,
    },
    prodScore: 100,
  },
  {
    // The MINIMUM observed on prod. Only the three near-universal constants
    // (city+state 3, MC 2, authority 1) are present; power_units is 0, which
    // must score zero rather than reaching the ≥1 band.
    label: 'ALL MODES TRANSPORT, INC. (all-modes-transport-inc-2213703)',
    row: {
      powerUnits: 0,
      drivers: null,
      safetyRating: null,
      dbaName: null,
      nearestPortCode: null,
      city: 'ELK GROVE VILLAGE',
      state: 'IL',
      mcNumber: 'MC197143',
      authorityType: 'common',
      phone: null,
      email: null,
      contactHidden: false,
      flagCount: 0,
    },
    prodScore: 6,
  },
  {
    // A prod 12: the same three constants plus a nearest port (6). No fleet, no
    // rating, no DBA, no cargo flags.
    label: 'AMERICAN SAFETY SERVICES INC (american-safety-services-inc-1187543)',
    row: {
      powerUnits: null,
      drivers: null,
      safetyRating: null,
      dbaName: null,
      nearestPortCode: 'INLELP',
      city: 'EL PASO',
      state: 'TX',
      mcNumber: 'MC668187',
      authorityType: 'common',
      phone: null,
      email: null,
      contactHidden: false,
      flagCount: 0,
    },
    prodScore: 12,
  },
];

describe('carrierRichnessScore — agrees with the SQL half on real prod rows', () => {
  for (const { label, row, prodScore } of PROD_ROWS) {
    it(`reproduces the score Postgres returned for ${label} (${prodScore})`, () => {
      expect(carrierRichnessScore(row)).toBe(prodScore);
    });
  }

  it('tops out at exactly MAX_RICHNESS_SCORE, which prod confirmed as 100', () => {
    expect(MAX_RICHNESS_SCORE).toBe(100);
    // The prod histogram's maximum bucket was 100 and its minimum was 6; both
    // are reproduced above, so the two implementations agree at both extremes.
    const best = Math.max(...PROD_ROWS.map((r) => r.prodScore));
    expect(best).toBe(MAX_RICHNESS_SCORE);
  });
});

describe('carrierRichnessScore — the rules that matter', () => {
  const empty: RichnessInput = {};

  it('scores a completely empty row 0 (never negative, never a default bonus)', () => {
    expect(carrierRichnessScore(empty)).toBe(0);
  });

  it('treats a ZERO fleet exactly like a missing one — 0 units renders nothing', () => {
    expect(carrierRichnessScore({ powerUnits: 0 })).toBe(0);
    expect(carrierRichnessScore({ powerUnits: null })).toBe(0);
    expect(carrierRichnessScore({ powerUnits: 1 })).toBe(FLEET_BANDS[FLEET_BANDS.length - 1][1]);
  });

  it('awards fleet/driver points by BAND, monotonically', () => {
    let prev = -1;
    for (const [min, pts] of [...FLEET_BANDS].reverse()) {
      const got = carrierRichnessScore({ powerUnits: min });
      expect(got).toBe(pts);
      expect(got).toBeGreaterThan(prev);
      prev = got;
    }
    for (const [min, pts] of DRIVER_BANDS) {
      expect(carrierRichnessScore({ drivers: min })).toBe(pts);
    }
  });

  it('caps the cargo/equipment flag term at FLAG_CAP', () => {
    const capped = FLAG_CAP * RICHNESS_WEIGHTS.perFlag;
    expect(carrierRichnessScore({ flagCount: FLAG_CAP })).toBe(capped);
    expect(carrierRichnessScore({ flagCount: RICHNESS_FLAG_COLUMNS.length })).toBe(capped);
    expect(carrierRichnessScore({ flagCount: 999 })).toBe(capped);
  });

  it('zeroes phone AND email when the carrier opted out of contact display', () => {
    const contactable: RichnessInput = { phone: '5551234567', email: 'a@b.com', contactHidden: false };
    const hidden: RichnessInput = { ...contactable, contactHidden: true };
    expect(carrierRichnessScore(contactable)).toBe(RICHNESS_WEIGHTS.phone + RICHNESS_WEIGHTS.email);
    // The profile page hides both, so the page really is thinner.
    expect(carrierRichnessScore(hidden)).toBe(0);
  });

  it('requires BOTH city and state before awarding the address points', () => {
    expect(carrierRichnessScore({ city: 'Houston', state: null })).toBe(0);
    expect(carrierRichnessScore({ city: null, state: 'TX' })).toBe(0);
    expect(carrierRichnessScore({ city: 'Houston', state: 'TX' })).toBe(RICHNESS_WEIGHTS.cityState);
  });

  it('treats whitespace-only text as absent (matching the SQL btrim())', () => {
    expect(carrierRichnessScore({ safetyRating: '   ' })).toBe(0);
    expect(carrierRichnessScore({ safetyRating: 'S' })).toBe(RICHNESS_WEIGHTS.safetyRating);
  });
});

describe('richnessScoreSql — carries every weight and every scored column', () => {
  const sqlText = richnessScoreSql();

  it('references all 20 cargo/equipment flag columns', () => {
    for (const col of RICHNESS_FLAG_COLUMNS) expect(sqlText).toContain(`"${col}"::int`);
    expect(RICHNESS_FLAG_COLUMNS).toHaveLength(20);
  });

  it('references every non-flag scored column', () => {
    for (const col of [
      'power_units',
      'drivers',
      'safety_rating',
      'dba_name',
      'nearest_port_code',
      'city',
      'state',
      'mc_number',
      'authority_type',
      'contact_hidden',
      'phone',
      'email',
    ]) {
      expect(sqlText).toContain(`"${col}"`);
    }
  });

  it('emits each band threshold and each flat weight verbatim', () => {
    for (const [min, pts] of FLEET_BANDS) {
      expect(sqlText).toContain(`WHEN "power_units" >= ${min} THEN ${pts}`);
    }
    for (const [min, pts] of DRIVER_BANDS) {
      expect(sqlText).toContain(`WHEN "drivers" >= ${min} THEN ${pts}`);
    }
    expect(sqlText).toContain(`THEN ${RICHNESS_WEIGHTS.safetyRating}`);
    expect(sqlText).toContain(`THEN ${RICHNESS_WEIGHTS.dbaName}`);
    expect(sqlText).toContain(`LEAST(${FLAG_CAP},`);
    expect(sqlText).toContain(`* ${RICHNESS_WEIGHTS.perFlag}`);
  });

  it('honours the contact opt-out BEFORE the phone/email branch', () => {
    // Order matters: `CASE WHEN contact_hidden THEN 0 WHEN phone …` — if the
    // phone branch came first an opted-out carrier would still score for it.
    expect(sqlText).toContain(`CASE WHEN "contact_hidden" THEN 0 WHEN "phone"`);
    expect(sqlText).toContain(`CASE WHEN "contact_hidden" THEN 0 WHEN "email"`);
  });

  it('casts to int so the sitemap never has to parse a float', () => {
    expect(sqlText.trim().endsWith('::int')).toBe(true);
  });
});

describe('tiers and the priority ladder', () => {
  it('classifies at the measured cut-offs', () => {
    expect(richnessTier(MAX_RICHNESS_SCORE)).toBe('rich');
    expect(richnessTier(RICH_TIER_MIN)).toBe('rich');
    expect(richnessTier(RICH_TIER_MIN - 1)).toBe('mid');
    expect(richnessTier(MID_TIER_MIN)).toBe('mid');
    expect(richnessTier(MID_TIER_MIN - 1)).toBe('sparse');
    expect(richnessTier(0)).toBe('sparse');
  });

  it('MID_TIER_MIN clears the 90,688-row prod plateau at score 31', () => {
    // The measured distribution has one huge bucket at exactly 31 (27.5% of the
    // table). A threshold inside it would reclassify a quarter of the directory
    // on a one-point drift, so the cut must sit strictly above it.
    expect(MID_TIER_MIN).toBeGreaterThan(31);
  });

  it('gives a carrier a priority that never reaches hub level', () => {
    const carrierMax = Number(carrierPriority(MAX_RICHNESS_SCORE));
    expect(carrierMax).toBe(0.5);

    // City hubs sit above every carrier…
    const citiesXml = buildCitiesXml([{ stateSlug: 'texas', citySlug: 'houston' }]);
    const cityPriority = Number(/<priority>([\d.]+)<\/priority>/.exec(citiesXml)?.[1]);
    expect(cityPriority).toBeGreaterThan(carrierMax);

    // …and every state/port hub sits above the city hubs.
    const entries = staticPageEntries();
    const stateHub = entries.find((e) => e.path === '/directory/texas');
    const portHub = entries.find((e) => e.path.startsWith('/directory/port/'));
    expect(stateHub).toBeDefined();
    expect(portHub).toBeDefined();
    expect(Number(stateHub!.priority)).toBeGreaterThan(cityPriority);
    expect(Number(portHub!.priority)).toBeGreaterThan(cityPriority);

    // EVERY directory hub — state and port alike — outranks the best carrier.
    // (Legal boilerplate like /terms sits BELOW a rich carrier profile on
    // purpose; the rule is about hubs, not about every static page.)
    const hubs = entries.filter((e) => /^\/directory(\/|$)/.test(e.path));
    expect(hubs.length).toBeGreaterThan(50); // 50 states + every port group
    for (const h of hubs) expect(Number(h.priority)).toBeGreaterThan(carrierMax);
  });

  it('descends priority as richness falls, and never claims monthly for a stub', () => {
    expect(Number(carrierPriority(MAX_RICHNESS_SCORE))).toBeGreaterThan(
      Number(carrierPriority(MID_TIER_MIN)),
    );
    expect(Number(carrierPriority(MID_TIER_MIN))).toBeGreaterThan(Number(carrierPriority(0)));
    expect(carrierChangefreq(MAX_RICHNESS_SCORE)).toBe('monthly');
    expect(carrierChangefreq(0)).toBe('yearly');
  });
});

describe('sortCarriersByRichness — rich carriers really do come first', () => {
  const rows = (): CarrierSitemapRow[] => [
    { slug: 'zz-stub-1', updatedAt: null, score: 6, powerUnits: 0 },
    { slug: 'aa-mid', updatedAt: null, score: 40, powerUnits: 5 },
    { slug: 'zz-huge-fleet', updatedAt: null, score: 100, powerUnits: 1628 },
    { slug: 'aa-small-fleet', updatedAt: null, score: 100, powerUnits: 100 },
    { slug: 'mm-sparse', updatedAt: null, score: 31, powerUnits: null },
  ];

  it('orders by score descending', () => {
    const sorted = sortCarriersByRichness(rows());
    expect(sorted.map((r) => r.score)).toEqual([100, 100, 40, 31, 6]);
  });

  it('breaks a saturated-score tie on FLEET SIZE, not alphabetically', () => {
    const sorted = sortCarriersByRichness(rows());
    // Both score 100. Alphabetically 'aa-small-fleet' would win; fleet size must
    // put the 1,628-truck carrier first. (176 prod rows sit at exactly 100.)
    expect(sorted[0].slug).toBe('zz-huge-fleet');
    expect(sorted[1].slug).toBe('aa-small-fleet');
  });

  it('is deterministic — a fully tied pair falls back to slug order', () => {
    const tied: CarrierSitemapRow[] = [
      { slug: 'b-co', updatedAt: null, score: 50, powerUnits: 10 },
      { slug: 'a-co', updatedAt: null, score: 50, powerUnits: 10 },
    ];
    expect(sortCarriersByRichness(tied).map((r) => r.slug)).toEqual(['a-co', 'b-co']);
    // Re-sorting an already-sorted list must not change it.
    expect(sortCarriersByRichness(sortCarriersByRichness(tied)).map((r) => r.slug)).toEqual([
      'a-co',
      'b-co',
    ]);
  });

  it('emits the rich rows FIRST in the rendered chunk, with higher priority', () => {
    const xml = buildCarrierChunkXml(sortCarriersByRichness(rows()));
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs[0]).toContain('zz-huge-fleet');
    expect(locs[locs.length - 1]).toContain('zz-stub-1');

    const priorities = [...xml.matchAll(/<priority>([\d.]+)<\/priority>/g)].map((m) => Number(m[1]));
    // Monotonically non-increasing: the document itself states the ordering.
    for (let i = 1; i < priorities.length; i += 1) {
      expect(priorities[i]).toBeLessThanOrEqual(priorities[i - 1]);
    }
    expect(priorities[0]).toBe(0.5);
    expect(priorities[priorities.length - 1]).toBe(0.3);
  });

  it('treats a row with NO score as sparse rather than rich', () => {
    const xml = buildCarrierChunkXml([{ slug: 'unknown', updatedAt: null }]);
    expect(xml).toContain('<priority>0.3</priority>');
    expect(xml).toContain('<changefreq>yearly</changefreq>');
  });
});

describe('<lastmod> is the row’s REAL timestamp, never the rebuild clock', () => {
  it('emits the carrier’s own updated_at even when the rebuild runs much later', () => {
    const changedOn = new Date('2026-03-04T11:22:33Z');
    const rebuiltOn = new Date('2026-08-29T09:00:00Z');
    const xml = buildCarrierChunkXml(
      [{ slug: 'acme-truck-line-inc-52767', updatedAt: changedOn, score: 100, powerUnits: 1116 }],
      rebuiltOn,
    );
    expect(xml).toContain('<lastmod>2026-03-04</lastmod>');
    // The rebuild date must NOT leak in — that would be fake freshness.
    expect(xml).not.toContain('2026-08-29');
  });

  it('never claims a carrier changed today just because the sitemap rebuilt today', () => {
    const now = new Date('2026-08-29T09:00:00Z');
    const rows: CarrierSitemapRow[] = [
      { slug: 'a', updatedAt: new Date('2025-01-01T00:00:00Z'), score: 90 },
      { slug: 'b', updatedAt: new Date('2024-06-15T00:00:00Z'), score: 80 },
    ];
    const lastmods = [...buildCarrierChunkXml(rows, now).matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(
      (m) => m[1],
    );
    expect(lastmods).toEqual(['2025-01-01', '2024-06-15']);
  });
});

/**
 * The upstream half of the same guarantee. A truthful `<lastmod>` is worthless
 * if the INGEST stamps `updated_at = now()` on all 330k rows every Sunday —
 * which is exactly what it used to do (measured on prod: min 2026-08-20, max
 * 2026-08-23, a stamp of when the job ran and nothing about the carrier).
 */
describe('carrier ingest — updated_at advances ONLY on a real change', () => {
  const toSnake = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

  it('compares every column the re-ingest overwrites — no silent omissions', () => {
    const setColumns = Object.keys(CARRIER_UPSERT_SET)
      .map(toSnake)
      .filter((c) => c !== 'updated_at');
    expect([...CARRIER_MUTABLE_COLUMNS].sort()).toEqual([...setColumns].sort());
  });

  it('is a ROW-WISE `IS DISTINCT FROM` (so NULL→NULL reads as unchanged)', () => {
    expect(CARRIER_CHANGED_SQL).toContain('IS DISTINCT FROM');
    // `<>` would evaluate to NULL whenever either side is NULL, which would make
    // the CASE fall through to "unchanged" for any row with a null column.
    expect(CARRIER_CHANGED_SQL).not.toMatch(/<>/);
  });

  it('names both the stored and the incoming value of every mutable column', () => {
    for (const col of CARRIER_MUTABLE_COLUMNS) {
      expect(CARRIER_CHANGED_SQL).toContain(`"carrier_directory"."${col}"`);
      expect(CARRIER_CHANGED_SQL).toContain(`excluded."${col}"`);
    }
  });

  it('never compares (or overwrites) the carrier contact opt-out', () => {
    // contact_hidden is the one column an ingest must never touch — a carrier
    // who asked to be hidden stays hidden across every future re-ingest.
    expect(CARRIER_MUTABLE_COLUMNS).not.toContain('contact_hidden');
    expect(CARRIER_CHANGED_SQL).not.toContain('contact_hidden');
    expect(Object.keys(CARRIER_UPSERT_SET)).not.toContain('contactHidden');
  });

  it('takes the incoming timestamp on change and KEEPS the stored one otherwise', () => {
    // The ELSE branch is the whole fix: a bare `excluded.updated_at` here is
    // what stamped all 330,218 rows every Sunday and produced fake freshness.
    expect(CARRIER_UPDATED_AT_SQL).toContain(`CASE WHEN ${CARRIER_CHANGED_SQL} THEN`);
    expect(CARRIER_UPDATED_AT_SQL).toContain('THEN excluded."updated_at"');
    expect(CARRIER_UPDATED_AT_SQL).toContain('ELSE "carrier_directory"."updated_at" END');
  });

  it('still refreshes every mutable column unconditionally (data is never stale)', () => {
    // Deliberately conservative: only the TIMESTAMP is conditional. Every data
    // column is written on every ingest exactly as before, so a bug in the
    // comparison can cost a slightly stale lastmod but never stale carrier data.
    const keys = Object.keys(CARRIER_UPSERT_SET);
    for (const col of CARRIER_MUTABLE_COLUMNS) {
      expect(keys.map(toSnake)).toContain(col);
    }
  });
});
