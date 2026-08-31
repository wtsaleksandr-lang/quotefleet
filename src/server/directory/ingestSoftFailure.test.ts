/**
 * SOFT FAILURE = FAILURE. The FMCSA ingest must never mistake an empty upstream
 * payload for authoritative emptiness.
 *
 * ─── THE HOLE THIS FILE CLOSES ────────────────────────────────────────────
 * `socrataJson` throws on a non-2xx, so a HARD census failure aborts the whole
 * run before a single row is written — that is the invariant
 * CARRIER_MUTABLE_COLUMNS documents when it explains why the census-derived
 * columns are written with a bare `excluded.` instead of the CASE-preservation
 * used for the safety block.
 *
 * A SOFT failure breaks that invariant. Socrata answering `200 OK` with `[]`
 * (or with a handful of rows out of the 200 asked for) does not throw: the
 * response parses, `fetchCensusByDots` returns an empty/near-empty Map, and
 * every carrier on the page normalizes with `census === undefined`. That is
 * indistinguishable, downstream, from "FMCSA has no census record for this
 * carrier" — `censusAllowsOperate(undefined)` returns TRUE, so the row is not
 * even dropped, it is KEPT and rewritten with every census-derived column null.
 *
 * Two consequences, the second worse than the first:
 *   1. Published data (fleet size, drivers, safety rating, registration date,
 *      13 cargo-class flags, …) is wiped across ~330k rows.
 *   2. Nulling flips `IS DISTINCT FROM` in CARRIER_CHANGED_SQL on EVERY row, so
 *      `updated_at` — which the sitemap publishes as `<lastmod>` — jumps on all
 *      330k carrier URLs. We would be telling Google that every page changed on
 *      the day our upstream had a bad minute.
 *
 * ─── HOW THIS FILE PROVES IT ──────────────────────────────────────────────
 * Part A REPRODUCES the damage by evaluating the REAL exported upsert SQL
 * (CARRIER_CHANGED_SQL / CARRIER_UPDATED_AT_SQL — the exact strings handed to
 * Postgres) against a week-1 row and a week-2 soft-failure row. There is no
 * Postgres in CI, so the SQL is run through a small, DELIBERATELY STRICT
 * interpreter that throws on any construct it does not model: if the production
 * SQL ever grows a shape this file does not understand, the test fails loudly
 * rather than quietly asserting nothing.
 *
 * Part B locks the GUARD: the same soft-failure payloads driven through the
 * real `runIngest`, asserting nothing is written at all.
 *
 * No network: vitest's global setup (src/test/setupNoExternalSpend.ts) replaces
 * `fetch` with a sentinel that throws on any off-box call. Every fixture here is
 * frozen in-file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// The end-of-run aggregate recompute is a best-effort DB write (already wrapped
// in try/catch by runIngest). Mocked so this unit never opens a connection.
vi.mock('./queries.js', () => ({
  recomputeAndPersistDirectoryAggregates: vi.fn(async () => {}),
}));

import {
  CARRIER_CHANGED_SQL,
  CARRIER_MUTABLE_COLUMNS,
  CARRIER_SAFETY_COLUMNS,
  CARRIER_UPDATED_AT_SQL,
  CENSUS_MIN_MATCH_RATE,
  CENSUS_MIN_SAMPLE,
  SOCRATA_MAX_ATTEMPTS,
  SocrataHttpError,
  SocrataPayloadError,
  censusPayloadPlausible,
  fetchCensusByDots,
  filterAndNormalizeCarriers,
  isRetryableSocrataStatus,
  runIngest,
  socrataBackoffMs,
  socrataFetchOnce,
  withSocrataRetry,
  type CarrierRecord,
  type CarrierStore,
  type CensusRow,
  type IngestOptions,
  type LiCarrierRow,
} from './carrierIngest.js';

// ─── A strict interpreter for the REAL upsert SQL ─────────────────────────
// Models exactly the four constructs carrierIngest emits and throws on anything
// else. `stored` is the row already in carrier_directory; `excluded` is the
// incoming row Postgres exposes as EXCLUDED.
type SqlRow = Record<string, unknown>;
interface UpsertCtx {
  stored: SqlRow;
  excluded: SqlRow;
}

const STORED_REF = /^"carrier_directory"\."([a-z_]+)"$/;
const EXCLUDED_REF = /^excluded\."([a-z_]+)"$/;
const DISTINCT_OP = ' IS DISTINCT FROM ';

/** Split a comma list at paren depth 0. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim());
}

/** Locate a token at paren depth 0; -1 when absent. */
function indexAtDepth0(s: string, token: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && s.startsWith(token, i)) return i;
  }
  return -1;
}

/** The three arms of `CASE WHEN <cond> THEN <a> ELSE <b> END`, at depth 0. */
function caseArms(body: string): { cond: string; a: string; b: string } {
  let depth = 0;
  let thenAt = -1;
  let elseAt = -1;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0) {
      if (thenAt === -1 && body.startsWith(' THEN ', i)) thenAt = i;
      else if (thenAt !== -1 && elseAt === -1 && body.startsWith(' ELSE ', i)) elseAt = i;
    }
  }
  if (thenAt === -1 || elseAt === -1) throw new Error(`unmodelled CASE body: ${body}`);
  return {
    cond: body.slice(0, thenAt),
    a: body.slice(thenAt + ' THEN '.length, elseAt),
    b: body.slice(elseAt + ' ELSE '.length),
  };
}

/** SQL `a IS DISTINCT FROM b` for one scalar (NULL-safe, Date-aware). */
function isDistinct(a: unknown, b: unknown): boolean {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an !== bn;
  if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
  return a !== b;
}

function evalSql(expr: string, ctx: UpsertCtx): unknown {
  const e = expr.trim();

  if (e.startsWith('CASE WHEN ') && e.endsWith(' END')) {
    const { cond, a, b } = caseArms(e.slice('CASE WHEN '.length, -' END'.length));
    return evalSql(cond, ctx) ? evalSql(a, ctx) : evalSql(b, ctx);
  }

  if (e.endsWith(' IS NOT NULL')) {
    const v = evalSql(e.slice(0, -' IS NOT NULL'.length), ctx);
    return v !== null && v !== undefined;
  }

  const dfAt = indexAtDepth0(e, DISTINCT_OP);
  if (dfAt !== -1) {
    const lhs = e.slice(0, dfAt).trim();
    const rhs = e.slice(dfAt + DISTINCT_OP.length).trim();
    if (!lhs.startsWith('(') || !rhs.startsWith('(')) {
      throw new Error(`unmodelled IS DISTINCT FROM operands: ${e}`);
    }
    const l = splitTopLevel(lhs.slice(1, -1)).map((p) => evalSql(p, ctx));
    const r = splitTopLevel(rhs.slice(1, -1)).map((p) => evalSql(p, ctx));
    if (l.length !== r.length) throw new Error('row comparison arity mismatch');
    return l.some((v, i) => isDistinct(v, r[i]));
  }

  const stored = STORED_REF.exec(e);
  if (stored) return ctx.stored[stored[1]] ?? null;
  const excluded = EXCLUDED_REF.exec(e);
  if (excluded) return ctx.excluded[excluded[1]] ?? null;

  throw new Error(`unmodelled SQL expression: ${e}`);
}

const carrierChanged = (ctx: UpsertCtx): boolean => evalSql(CARRIER_CHANGED_SQL, ctx) === true;
const nextUpdatedAt = (ctx: UpsertCtx): unknown => evalSql(CARRIER_UPDATED_AT_SQL, ctx);

/** DB column name → the camelCase key the flattened record uses. */
const camel = (col: string): string => col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * The row Postgres would see as EXCLUDED — built exactly the way
 * dbCarrierStore.upsertMany builds it (safety + credentials flattened onto the
 * record, plus a fresh updated_at), then keyed by DB column name.
 */
function toDbRow(rec: CarrierRecord, updatedAt: Date): SqlRow {
  const flat = { ...rec, ...rec.safety, ...rec.credentials } as unknown as SqlRow;
  const row: SqlRow = { updated_at: updatedAt };
  for (const col of CARRIER_MUTABLE_COLUMNS) row[col] = flat[camel(col)] ?? null;
  return row;
}

// ─── Frozen fixtures ──────────────────────────────────────────────────────
const WEEK_1 = new Date('2026-08-16T03:00:00Z');
const WEEK_2 = new Date('2026-08-23T03:00:00Z');

/** One L&I carrier row. `n` makes a whole synthetic page. */
function liRow(n: number): LiCarrierRow {
  return {
    dot_number: String(700000 + n).padStart(8, '0'),
    docket_number: `MC${String(100000 + n)}`,
    common_stat: 'A',
    contract_stat: 'A',
    property_chk: 'Y',
    legal_name: `FIXTURE CARRIER ${n} INC`,
    bus_city: 'HOUSTON',
    bus_state_code: 'TX',
    bus_zip_code: '77002',
    bus_telno: '7135550100',
    bipd_file: '00750',
    min_cov_amount: '00750',
    cargo_file: 'Y',
    bond_file: 'N',
  };
}

/** The census row FMCSA really returns for that carrier — a healthy payload. */
function censusRow(n: number): CensusRow {
  return {
    dot_number: String(700000 + n),
    legal_name: `FIXTURE CARRIER ${n} INC`,
    email_address: `dispatch${n}@fixturecarrier.test`,
    power_units: '48',
    total_drivers: '52',
    safety_rating: 'S',
    safety_rating_date: '20180914',
    add_date: '20051103',
    status_code: 'A',
    phy_city: 'HOUSTON',
    phy_state: 'TX',
    phy_zip: '77002',
    phone: '7135550100',
    crgo_intermodal: 'X',
    hm_ind: 'N',
    crgo_genfreight: 'X',
    crgo_coldfood: 'X',
    crgo_drybulk: 'X',
    crgo_produce: 'X',
    crgo_bldgmat: 'X',
  };
}

const censusMap = (rows: CensusRow[]): Map<string, CensusRow> =>
  new Map(rows.map((r) => [String(r.dot_number), r]));

/** A realistic page: 1000 carriers, the live ingest's page size. */
const PAGE_SIZE = 1000;
const PAGE = Array.from({ length: PAGE_SIZE }, (_v, i) => liRow(i));
const HEALTHY_CENSUS = censusMap(PAGE.map((_r, i) => censusRow(i)));

const normalizeOne = (li: LiCarrierRow, census: Map<string, CensusRow>): CarrierRecord => {
  const [rec] = filterAndNormalizeCarriers([li], census, true);
  return rec;
};

// ─── PART A — the damage, proven against the real upsert SQL ──────────────
describe('reproduction: a 200-with-an-empty-body wipes the directory', () => {
  it('is the SAME carrier, one week apart — only the census payload differs', () => {
    const healthy = normalizeOne(liRow(0), HEALTHY_CENSUS);
    // Week 2: Socrata answered 200 with `[]`, so the lookup is empty and the
    // carrier normalizes as if FMCSA had never heard of it.
    const soft = normalizeOne(liRow(0), new Map());
    expect(soft.usdot).toBe(healthy.usdot);
    expect(soft.legalName).toBe(healthy.legalName);
  });

  it('nulls every census-derived column', () => {
    const healthy = normalizeOne(liRow(0), HEALTHY_CENSUS);
    const soft = normalizeOne(liRow(0), new Map());

    // Published facts, gone.
    expect(healthy.powerUnits).toBe(48);
    expect(soft.powerUnits).toBeNull();
    expect(healthy.drivers).toBe(52);
    expect(soft.drivers).toBeNull();
    expect(healthy.safetyRating).toBe('S');
    expect(soft.safetyRating).toBeNull();
    expect(healthy.email).toBe('dispatch0@fixturecarrier.test');
    expect(soft.email).toBeNull();

    // Equipment + cargo-class facets, gone — these drive /directory filtering.
    expect(healthy.intermodal).toBe(true);
    expect(soft.intermodal).toBe(false);
    expect(healthy.dryVan).toBe(true);
    expect(soft.dryVan).toBe(false);
    expect(healthy.reefer).toBe(true);
    expect(soft.reefer).toBe(false);
    expect(healthy.produce).toBe(true);
    expect(soft.produce).toBe(false);

    // Credentials that ride the census row, gone.
    expect(healthy.credentials.fmcsaRegisteredSince).not.toBeNull();
    expect(soft.credentials.fmcsaRegisteredSince).toBeNull();
    expect(healthy.credentials.safetyRatingDate).not.toBeNull();
    expect(soft.credentials.safetyRatingDate).toBeNull();
  });

  it('the real CARRIER_CHANGED_SQL then reads the wipe as a genuine change', () => {
    const stored = toDbRow(normalizeOne(liRow(0), HEALTHY_CENSUS), WEEK_1);
    const excluded = toDbRow(normalizeOne(liRow(0), new Map()), WEEK_2);

    expect(carrierChanged({ stored, excluded })).toBe(true);
    // …so updated_at jumps to the run stamp: a fake <lastmod> for a page whose
    // content did not improve — it got worse.
    expect(nextUpdatedAt({ stored, excluded })).toEqual(WEEK_2);
  });

  it('does so on EVERY row of a realistic 1000-carrier page', () => {
    let bumped = 0;
    for (const li of PAGE) {
      const stored = toDbRow(normalizeOne(li, HEALTHY_CENSUS), WEEK_1);
      const excluded = toDbRow(normalizeOne(li, new Map()), WEEK_2);
      if (nextUpdatedAt({ stored, excluded }) !== stored.updated_at) bumped += 1;
    }
    // 1000/1000 at page scale ⇒ ~330k/330k across the full directory.
    expect(bumped).toBe(PAGE_SIZE);
  });

  it('a TRUNCATED payload damages exactly the carriers it omitted', () => {
    // Socrata returned 3 of the 200 dots asked for. The 3 survive; the rest are
    // wiped — a partial outage is not a smaller version of the same bug, it is
    // the same bug on a subset, and it still moves <lastmod> on that subset.
    const truncated = censusMap([censusRow(0), censusRow(1), censusRow(2)]);
    let wiped = 0;
    let intact = 0;
    for (const li of PAGE.slice(0, 200)) {
      const stored = toDbRow(normalizeOne(li, HEALTHY_CENSUS), WEEK_1);
      const excluded = toDbRow(normalizeOne(li, truncated), WEEK_2);
      if (carrierChanged({ stored, excluded })) wiped += 1;
      else intact += 1;
    }
    expect(intact).toBe(3);
    expect(wiped).toBe(197);
  });

  it('the interpreter really is reading the production SQL', () => {
    // Guard on the guard: an unchanged row must NOT move, or every assertion
    // above would pass for the wrong reason.
    const stored = toDbRow(normalizeOne(liRow(0), HEALTHY_CENSUS), WEEK_1);
    const excluded = toDbRow(normalizeOne(liRow(0), HEALTHY_CENSUS), WEEK_2);
    expect(carrierChanged({ stored, excluded })).toBe(false);
    expect(nextUpdatedAt({ stored, excluded })).toEqual(WEEK_1);
    // And it refuses anything it cannot model, rather than silently passing.
    expect(() => evalSql('coalesce(a, b)', { stored, excluded })).toThrow(/unmodelled/);
  });
});

// ─── PART B — the guard ───────────────────────────────────────────────────
function capturingStore(): CarrierStore & { written: CarrierRecord[] } {
  const written: CarrierRecord[] = [];
  return {
    written,
    async upsertMany(records) {
      written.push(...records);
    },
  };
}

const OPTS: IngestOptions = {
  limit: 0,
  offset: 0,
  pageSize: PAGE_SIZE,
  states: [],
  dryRun: false,
  includeCanada: true,
};

/** runIngest wired to frozen fixtures — one page, then end of data. */
function deps(census: (dots: string[]) => Promise<Map<string, CensusRow>>) {
  let served = false;
  return {
    fetchCarriers: async (): Promise<LiCarrierRow[]> => {
      if (served) return [];
      served = true;
      return PAGE;
    },
    fetchCensus: census,
    fetchSafety: async () => new Map(),
    fetchCrashes: async () => new Map(),
    now: () => WEEK_2,
    log: () => {},
  };
}

describe('guard: an implausibly empty census payload is a FAILURE, not emptiness', () => {
  it('refuses to write when Socrata answers 200 with an empty body', async () => {
    const store = capturingStore();
    await expect(runIngest(OPTS, store, deps(async () => new Map()))).rejects.toThrow(
      /census/i,
    );
    // The whole point: not one row reached the upsert, so not one updated_at moved.
    expect(store.written).toHaveLength(0);
  });

  it('refuses to write when Socrata answers 200 with a truncated body', async () => {
    const store = capturingStore();
    const truncated = censusMap([censusRow(0), censusRow(1), censusRow(2)]);
    await expect(runIngest(OPTS, store, deps(async () => truncated))).rejects.toThrow(
      /census/i,
    );
    expect(store.written).toHaveLength(0);
  });

  it('still ingests normally on a healthy payload', async () => {
    const store = capturingStore();
    const summary = await runIngest(OPTS, store, deps(async () => HEALTHY_CENSUS));
    expect(summary.ingested).toBe(PAGE_SIZE);
    expect(store.written).toHaveLength(PAGE_SIZE);
    expect(store.written[0].powerUnits).toBe(48);
  });

  it('tolerates the real, legitimate gaps in census coverage', async () => {
    // FMCSA coverage is high but not total: a run must not abort because a
    // normal minority of carriers genuinely have no census row. Only a
    // COLLAPSE is a failure.
    const store = capturingStore();
    const partial = censusMap(PAGE.map((_r, i) => censusRow(i)).slice(0, 940));
    const summary = await runIngest(OPTS, store, deps(async () => partial));
    expect(summary.ingested).toBe(PAGE_SIZE);
    expect(store.written).toHaveLength(PAGE_SIZE);
  });

  it('guards EVERY census fetch implementation, not just the live one', async () => {
    // The check lives in runIngest, on the Map the fetch returned — so a future
    // cached / bulk-file / mirrored census loader inherits the guard instead of
    // having to remember it. Proven by injecting a completely different fetch.
    const store = capturingStore();
    const someOtherImplementation = async (): Promise<Map<string, CensusRow>> =>
      censusMap([censusRow(7)]);
    await expect(runIngest(OPTS, store, deps(someOtherImplementation))).rejects.toThrow(/census/i);
    expect(store.written).toHaveLength(0);
  });
});

// ─── PART C — the policy, unit by unit ────────────────────────────────────
describe('censusPayloadPlausible — a smoke alarm, not a quality metric', () => {
  it('rejects a total collapse', () => {
    expect(censusPayloadPlausible(1000, 0)).toBe(false);
  });

  it('accepts the ~99.9% match rate measured on prod', () => {
    // 330,498 rows, power_units non-null on 99.86% (2026-08-31).
    expect(censusPayloadPlausible(1000, 999)).toBe(true);
    expect(censusPayloadPlausible(1000, 940)).toBe(true);
  });

  it('has an enormous margin below real coverage, so it cannot false-positive', () => {
    // A run must abort only when reality has broken, never when it wobbled.
    expect(CENSUS_MIN_MATCH_RATE).toBeLessThanOrEqual(0.5);
    expect(censusPayloadPlausible(1000, 501)).toBe(true);
    expect(censusPayloadPlausible(1000, 499)).toBe(false);
  });

  it('refuses to judge a sample too small to mean anything', () => {
    // A state-filtered run's last page can be a handful of carriers; zero
    // matches there is noise, and aborting on it would break good runs.
    expect(censusPayloadPlausible(CENSUS_MIN_SAMPLE - 1, 0)).toBe(true);
    expect(censusPayloadPlausible(CENSUS_MIN_SAMPLE, 0)).toBe(false);
    expect(censusPayloadPlausible(0, 0)).toBe(true);
  });
});

describe('socrataFetchOnce — a 200 is the start of the checks, not the end', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const stub = (body: unknown, status = 200): void => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
  };

  it('accepts a real array payload', async () => {
    stub([{ dot_number: '1' }]);
    await expect(socrataFetchOnce('az4n-8mr2', 'https://example.invalid/x')).resolves.toHaveLength(1);
  });

  it('rejects Socrata’s error envelope served with a 200', async () => {
    stub({ error: true, message: 'Invalid SoQL query' });
    await expect(socrataFetchOnce('az4n-8mr2', 'https://example.invalid/x')).rejects.toBeInstanceOf(
      SocrataPayloadError,
    );
  });

  it('rejects a bare null body', async () => {
    stub(null);
    await expect(socrataFetchOnce('az4n-8mr2', 'https://example.invalid/x')).rejects.toThrow(
      /expected a JSON array, got null/,
    );
  });

  it('surfaces a non-2xx as a typed error carrying the status', async () => {
    stub([], 503);
    await expect(socrataFetchOnce('az4n-8mr2', 'https://example.invalid/x')).rejects.toBeInstanceOf(
      SocrataHttpError,
    );
  });

  it('treats a chunk that matched NOTHING as a truncated body', async () => {
    // An EMPTY ARRAY is a legal transport payload, so this cannot be caught at
    // the socrataFetchOnce layer — it is caught per chunk, where the request
    // size is known. 0 of 200 at a 99.9% coverage rate is not a data condition.
    stub([]);
    const dots = Array.from({ length: 200 }, (_v, i) => String(900000 + i));
    await expect(fetchCensusByDots(dots)).rejects.toThrow(/0 of 200 requested USDOTs matched/);
  });

  it('does not let a page-level average dilute one dead chunk', async () => {
    // 200 of 1000 lost is 80% — over the floor, and a fifth of the page would
    // have been nulled if only the page rate were checked.
    expect(censusPayloadPlausible(1000, 800)).toBe(true);
  });
});

describe('withSocrataRetry — transient failures retry, our own bugs do not', () => {
  const noSleep = { sleep: async () => {}, random: () => 0.5, log: () => {} };

  it('retries a 5xx and succeeds on a later attempt', async () => {
    let calls = 0;
    const out = await withSocrataRetry(
      'census',
      async () => {
        calls += 1;
        if (calls < 3) throw new SocrataHttpError('az4n-8mr2', 503, 'busy');
        return ['ok'];
      },
      noSleep,
    );
    expect(out).toEqual(['ok']);
    expect(calls).toBe(3);
  });

  it('retries a 429 and a transport-level throw', async () => {
    expect(isRetryableSocrataStatus(429)).toBe(true);
    expect(isRetryableSocrataStatus(408)).toBe(true);
    let calls = 0;
    await withSocrataRetry(
      'census',
      async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return [];
      },
      noSleep,
    );
    expect(calls).toBe(2);
  });

  it('does NOT retry a 400 — a malformed SoQL is our bug, not the portal’s', async () => {
    expect(isRetryableSocrataStatus(400)).toBe(false);
    let calls = 0;
    await expect(
      withSocrataRetry(
        'census',
        async () => {
          calls += 1;
          throw new SocrataHttpError('az4n-8mr2', 400, 'bad SoQL');
        },
        noSleep,
      ),
    ).rejects.toBeInstanceOf(SocrataHttpError);
    expect(calls).toBe(1);
  });

  it('RETHROWS after exhausting the budget — never degrades to an empty result', async () => {
    // The whole lesson of this file: giving up must fail the run. A retry that
    // returned [] on exhaustion would rebuild the exact hole being closed.
    let calls = 0;
    await expect(
      withSocrataRetry(
        'census',
        async () => {
          calls += 1;
          throw new SocrataHttpError('az4n-8mr2', 500, 'down');
        },
        noSleep,
      ),
    ).rejects.toThrow(/500/);
    expect(calls).toBe(SOCRATA_MAX_ATTEMPTS);
  });

  it('backs off exponentially, with jitter, under a hard cap', async () => {
    // Full jitter: random(0, min(base*2^n, cap)). ~1,700 sequential calls means
    // a lockstep schedule would retry a rate-limited portal in phase for hours.
    const max = (n: number) => socrataBackoffMs(n, () => 1);
    expect(max(1)).toBe(500);
    expect(max(2)).toBe(1000);
    expect(max(3)).toBe(2000);
    expect(max(9)).toBe(8000); // capped
    expect(socrataBackoffMs(3, () => 0)).toBe(0);
    expect(socrataBackoffMs(3, () => 0.25)).toBe(500);
  });
});

describe('the safety block keeps its own, different contract', () => {
  it('still preserves stored values rather than aborting', () => {
    // Safety is OPTIONAL enrichment: a flaky SMS feed must degrade to "no new
    // safety this page", never stall a 330k refresh. Census is NOT optional —
    // it carries status_code, the out-of-service gate — so it fails closed.
    // Two different sources, two deliberately different contracts.
    for (const col of CARRIER_SAFETY_COLUMNS) {
      expect(CARRIER_CHANGED_SQL).toContain(`ELSE "carrier_directory"."${col}" END`);
    }
    expect(CARRIER_MUTABLE_COLUMNS).toContain('power_units');
    expect(CARRIER_CHANGED_SQL).toContain('excluded."power_units"');
  });
});
