/**
 * A COMPLETED INGEST THAT CHANGED NOTHING MUST BE VISIBLE.
 *
 * ─── THE FAILURE THIS FILE LOCKS DOWN ─────────────────────────────────────
 * On Sunday 2026-09-06 the weekly FMCSA re-ingest ran, wrote ~330,000 rows, and
 * moved ZERO `updated_at` timestamps — 49,702 of the first 50,000 sitemap URLs
 * still carried the `lastmod` of 2026-08-31 (the one-time backfill of the
 * safety/credential columns added in #461/#462). Nothing anywhere noticed,
 * because the only number the `job_runs` ledger recorded was `ingested`, and
 * the upsert writes every mutable column of every row UNCONDITIONALLY. A
 * 330k-row no-op and a 330k-row refresh produced the identical ledger line:
 *
 *     status=success processed=330218
 *
 * `changed` is the number that tells those two apart. It is measured for free
 * off the upsert's own RETURNING (CARRIER_UPDATED_AT_SQL writes the incoming
 * stamp ONLY on a genuine field change), surfaced on IngestSummary, and written
 * into the ledger detail in a shape the ledger can be queried for.
 *
 * This file asserts the three things that keep that visible:
 *   1. `changed` is measured, and is `null` — never a fabricated 0 — when the
 *      store cannot measure it.
 *   2. A zero-change run says so out loud under a greppable marker.
 *   3. Deliberately-swallowed non-fatal errors are COUNTED and marked, while
 *      still not failing the run ("visibility, not fragility").
 *
 * No network: vitest's global setup replaces `fetch` with a throwing sentinel.
 * Every fixture is frozen in-file.
 */
import { describe, expect, it, vi } from 'vitest';

// The end-of-run aggregate recompute is a best-effort DB write (already wrapped
// in try/catch by runIngest). Mocked so this unit never opens a connection.
vi.mock('./queries.js', () => ({
  recomputeAndPersistDirectoryAggregates: vi.fn(async () => {}),
}));

import {
  INGEST_NOOP_MARKER,
  INGEST_SWALLOWED_MARKER,
  runIngest,
  type CarrierStore,
  type CensusRow,
  type IngestOptions,
  type IngestSummary,
  type LiCarrierRow,
} from './carrierIngest.js';
import { formatIngestDetail } from './autoHeal.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

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
  };
}

function censusRow(n: number): CensusRow {
  return {
    dot_number: String(700000 + n),
    legal_name: `FIXTURE CARRIER ${n} INC`,
    power_units: '48',
    total_drivers: '52',
    status_code: 'A',
    phy_city: 'HOUSTON',
    phy_state: 'TX',
    phy_zip: '77002',
  };
}

const PAGE = Array.from({ length: PAGE_SIZE }, (_v, i) => liRow(i));
const CENSUS = new Map(PAGE.map((_r, i) => [String(700000 + i), censusRow(i)]));

const OPTS: IngestOptions = {
  limit: 0,
  offset: 0,
  pageSize: PAGE_SIZE,
  states: [],
  dryRun: false,
  includeCanada: true,
};

/** runIngest wired to frozen fixtures — one page, then end of data. */
function deps(over: Partial<Parameters<typeof runIngest>[2]> = {}) {
  let served = false;
  const lines: string[] = [];
  return {
    lines,
    deps: {
      fetchCarriers: async (): Promise<LiCarrierRow[]> => {
        if (served) return [];
        served = true;
        return PAGE;
      },
      fetchCensus: async () => CENSUS,
      fetchSafety: async () => new Map(),
      fetchCrashes: async () => new Map(),
      now: () => new Date('2026-09-06T09:00:00.000Z'),
      log: (m: string) => void lines.push(m),
      ...over,
    },
  };
}

/** A store that reports exactly `changed` of the rows it was handed as changed. */
function measuringStore(changedPerPage: number): CarrierStore {
  return {
    async upsertMany(records) {
      return { written: records.length, changed: Math.min(changedPerPage, records.length) };
    },
  };
}

/** A store from BEFORE this change: writes, reports nothing. */
const unmeasuringStore: CarrierStore = {
  async upsertMany() {
    /* returns void, exactly as every pre-existing test double does */
  },
};

// ─── 1. `changed` is measured, and never fabricated ───────────────────────
describe('the ingest measures rows CHANGED, not just rows written', () => {
  it('reports the real change count alongside the write count', async () => {
    const { deps: d } = deps();
    const summary = await runIngest(OPTS, measuringStore(7), d);
    // Rows written is the whole page — it always is, and that is exactly why it
    // could never have detected the no-op on its own.
    expect(summary.ingested).toBe(PAGE_SIZE);
    expect(summary.changed).toBe(7);
  });

  it('reports changed=null — NOT 0 — when the store cannot measure it', async () => {
    // The distinction is the whole point: an unmeasured run must never be
    // readable as a measured zero, or the no-op alarm becomes a false alarm.
    const { deps: d } = deps();
    const summary = await runIngest(OPTS, unmeasuringStore, d);
    expect(summary.ingested).toBe(PAGE_SIZE);
    expect(summary.changed).toBeNull();
  });

  it('carries a completion timestamp and duration for the detached caller', async () => {
    // forceReingestCarrierDirectory is fire-and-forget, so the summary is the
    // ONLY place the run's own wall-clock survives.
    const { deps: d } = deps();
    const summary = await runIngest(OPTS, measuringStore(1), d);
    expect(summary.startedAt).toBeInstanceOf(Date);
    expect(summary.finishedAt).toBeInstanceOf(Date);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── 2. A zero-change run is loud ─────────────────────────────────────────
describe('a completed run that changed nothing announces itself', () => {
  it('logs the greppable no-op marker when it wrote rows but changed none', async () => {
    const { deps: d, lines } = deps();
    const summary = await runIngest(OPTS, measuringStore(0), d);
    expect(summary.changed).toBe(0);
    expect(lines.join('\n')).toContain(INGEST_NOOP_MARKER);
  });

  it('does NOT cry no-op when rows actually changed', async () => {
    const { deps: d, lines } = deps();
    await runIngest(OPTS, measuringStore(PAGE_SIZE), d);
    expect(lines.join('\n')).not.toContain(INGEST_NOOP_MARKER);
  });

  it('does NOT cry no-op when the change count was never measured', async () => {
    const { deps: d, lines } = deps();
    await runIngest(OPTS, unmeasuringStore, d);
    expect(lines.join('\n')).not.toContain(INGEST_NOOP_MARKER);
  });
});

// ─── 3. Swallowed failures are counted and marked, and still swallowed ────
describe('deliberately-swallowed failures become visible without becoming fatal', () => {
  it('counts a failed safety fetch and marks it, and the run still succeeds', async () => {
    const { deps: d, lines } = deps({
      fetchSafety: async () => {
        throw new Error('SMS portal 503');
      },
    });
    const summary = await runIngest(OPTS, measuringStore(3), d);
    // FRAGILITY CHECK: the "NEVER fail the ingest" contract is unchanged.
    expect(summary.ingested).toBe(PAGE_SIZE);
    expect(summary.warnings).toBe(1);
    expect(lines.join('\n')).toContain(INGEST_SWALLOWED_MARKER);
    expect(lines.join('\n')).toContain('SMS portal 503');
  });

  it('counts EVERY swallowed failure, not just the first', async () => {
    const { deps: d } = deps({
      fetchSafety: async () => {
        throw new Error('SMS portal 503');
      },
      fetchCrashes: async () => {
        throw new Error('crash portal 503');
      },
    });
    const summary = await runIngest(OPTS, measuringStore(3), d);
    expect(summary.warnings).toBe(2);
  });

  it('reports zero warnings on a clean run', async () => {
    const { deps: d } = deps();
    const summary = await runIngest(OPTS, measuringStore(3), d);
    expect(summary.warnings).toBe(0);
  });
});

// ─── 4. The ledger detail is queryable ────────────────────────────────────
describe('the job_runs detail line is greppable and queryable', () => {
  const base: IngestSummary = {
    carriersSeen: 330218,
    ingested: 330218,
    changed: 0,
    warnings: 0,
    startedAt: new Date('2026-09-06T09:00:00.000Z'),
    finishedAt: new Date('2026-09-06T09:28:00.000Z'),
    durationMs: 1_680_000,
    intermodal: 0,
    stateCounts: [],
    portCounts: [],
    countryCounts: [],
    unplaceable: 0,
    unplaceableCodes: [],
  };

  it('renders the 2026-09-06 no-op in a shape a SQL LIKE can find', () => {
    const detail = formatIngestDetail(base, 're-ingest:');
    // `detail like '%changed=0 %'` is the query that would have caught it.
    expect(detail).toContain('changed=0 ');
    expect(detail).toContain('written=330218');
    expect(detail).toContain(INGEST_NOOP_MARKER);
    expect(detail).toContain('finished_at=2026-09-06T09:28:00.000Z');
  });

  it('renders a healthy refresh WITHOUT the no-op marker', () => {
    const detail = formatIngestDetail({ ...base, changed: 4_112 }, 're-ingest:');
    expect(detail).toContain('changed=4112');
    expect(detail).not.toContain(INGEST_NOOP_MARKER);
  });

  it('renders an unmeasured run as n/a, never as a zero', () => {
    const detail = formatIngestDetail({ ...base, changed: null }, 're-ingest:');
    expect(detail).toContain('changed=n/a');
    expect(detail).not.toContain(INGEST_NOOP_MARKER);
  });

  it('flags a degraded run so swallowed errors reach the ledger, not just stdout', () => {
    const detail = formatIngestDetail({ ...base, changed: 12, warnings: 3 }, 're-ingest:');
    expect(detail).toContain('warnings=3');
    expect(detail).toContain('DEGRADED');
  });
});
