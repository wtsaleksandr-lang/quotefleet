/**
 * Shared read queries for the public carrier directory.
 *
 * ONE source of truth for the directory's DB access, used by BOTH the JSON API
 * (src/server/routes/directory.ts) and the server-rendered public pages
 * (src/server/directory/pages.ts). Keeping the summary + list logic here avoids
 * the two surfaces drifting out of sync.
 *
 * Read-only + platform-level (no tenant scope). All bounds (page size, code
 * lengths) are clamped here so callers can pass raw query values safely.
 */
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  carrierDirectory,
  carrierOverrides,
  directoryAggregateCache,
  type CarrierCapabilities,
  type CarrierOperatingLocation,
  type CarrierOverrideRow,
} from '../../db/schema.js';
import { CONTAINER_PORTS, PORT_GROUPS, portFilterCodes, portGroupForMemberCode, isKnownPortCode } from './containerPorts.js';

export type { CarrierCapabilities, CarrierOperatingLocation } from '../../db/schema.js';

/**
 * Where a displayed card field came from. `'fmcsa'` = straight from the FMCSA
 * public record; `'admin'` = replaced by an admin edit in `carrier_overrides`;
 * `'carrier'` = reserved for the LATER carrier-self-edit phase (not written yet).
 */
export type FieldSource = 'fmcsa' | 'admin' | 'carrier';

/** Per-field provenance for a merged carrier card — lets the profile tell an
 *  FMCSA-sourced value from an admin/carrier-edited one. */
export interface CarrierProvenance {
  about: FieldSource;
  email: FieldSource;
  phone: FieldSource;
  hidden: FieldSource;
  capabilities: FieldSource;
}

const FMCSA_PROVENANCE: CarrierProvenance = {
  about: 'fmcsa',
  email: 'fmcsa',
  phone: 'fmcsa',
  hidden: 'fmcsa',
  capabilities: 'fmcsa',
};

export const DEFAULT_PER_PAGE = 24;
export const MAX_PER_PAGE = 50;

/** One carrier row shaped for public consumption (drops internal ids). */
export interface VisibleCarrier {
  slug: string;
  legalName: string;
  dbaName: string | null;
  usdot: string;
  mcNumber: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  /** Carrier opt-out: when true the profile hides BOTH phone and email. */
  contactHidden: boolean;
  powerUnits: number | null;
  drivers: number | null;
  safetyRating: string | null;
  authorityType: string | null;
  intermodal: boolean;
  /** FMCSA-verified hazmat carrier (census hm_ind === 'Y'). */
  hazmat: boolean;
  /** FMCSA equipment / cargo-type flags (crgo_* census columns). All default
   *  false until a re-ingest backfills them. */
  dryVan: boolean;
  reefer: boolean;
  tanker: boolean;
  flatbed: boolean;
  dryBulk: boolean;
  /** FMCSA cargo-CLASS specialties (crgo_* census columns). All default false
   *  until a re-ingest backfills them. */
  householdGoods: boolean;
  beverages: boolean;
  produce: boolean;
  motorVehicles: boolean;
  livestock: boolean;
  grainFeed: boolean;
  oilfield: boolean;
  meat: boolean;
  paper: boolean;
  construction: boolean;
  farmSupplies: boolean;
  coalCoke: boolean;
  buildingMaterials: boolean;
  nearestPortCode: string | null;
  /**
   * FMCSA record freshness — the directory row's `updated_at` (set on ingest /
   * re-ingest). Optional so the many hand-built `VisibleCarrier` fixtures stay
   * valid; the profile renders a "FMCSA data as of …" line only when present.
   */
  updatedAt?: Date | null;
  /**
   * Admin/carrier "About" override, applied ONLY on the profile (carrierBySlug).
   * `null` on list/card rows and whenever no override exists → the profile falls
   * back to the FMCSA-derived prose (carrierAbout).
   */
  aboutOverride: string | null;
  /**
   * Self-declared credential flags from `carrier_overrides.capabilities`. Empty
   * `{}` on list/card rows and when no override exists. A `true` flag flips the
   * matching profile credential badge to ACTIVE (still labeled "self-declared").
   */
  capabilities: CarrierCapabilities;
  /**
   * Carrier-DECLARED other operating cities/terminals from
   * `carrier_overrides.operating_locations`, applied ONLY on the profile
   * (carrierBySlug). Optional/`[]` on list/card rows and when no override
   * exists → the profile omits the "Also operating in" block. Never fabricated:
   * FMCSA gives one HQ; these are metros a claimed carrier declared it serves.
   */
  operatingLocations?: CarrierOperatingLocation[];
  /** Per-field source (FMCSA vs admin/carrier-edited). All `'fmcsa'` on list/card. */
  provenance: CarrierProvenance;
}

/** Shape one carrier row for the public list/profile (drops internal ids). */
export function visibleCarrier(r: typeof carrierDirectory.$inferSelect): VisibleCarrier {
  return {
    slug: r.publicSlug,
    legalName: r.legalName,
    dbaName: r.dbaName,
    usdot: r.usdot,
    mcNumber: r.mcNumber,
    city: r.city,
    state: r.state,
    zip: r.zip,
    phone: r.phone,
    email: r.email,
    contactHidden: r.contactHidden,
    powerUnits: r.powerUnits,
    drivers: r.drivers,
    safetyRating: r.safetyRating,
    authorityType: r.authorityType,
    intermodal: r.intermodal,
    hazmat: r.hazmat,
    dryVan: r.dryVan,
    reefer: r.reefer,
    tanker: r.tanker,
    flatbed: r.flatbed,
    dryBulk: r.dryBulk,
    householdGoods: r.householdGoods,
    beverages: r.beverages,
    produce: r.produce,
    motorVehicles: r.motorVehicles,
    livestock: r.livestock,
    grainFeed: r.grainFeed,
    oilfield: r.oilfield,
    meat: r.meat,
    paper: r.paper,
    construction: r.construction,
    farmSupplies: r.farmSupplies,
    coalCoke: r.coalCoke,
    buildingMaterials: r.buildingMaterials,
    nearestPortCode: r.nearestPortCode,
    updatedAt: r.updatedAt,
    // FMCSA-only base shape: no override applied. The profile read
    // (carrierBySlug) merges carrier_overrides on top via mergeCarrierOverride;
    // list/card rows keep these FMCSA defaults so those surfaces are unchanged.
    aboutOverride: null,
    capabilities: {},
    operatingLocations: [],
    provenance: FMCSA_PROVENANCE,
  };
}

/**
 * Apply a `carrier_overrides` row onto an FMCSA base card (PURE — unit-tested).
 *
 * Non-null overrides win over the FMCSA value and stamp that field's provenance;
 * a null/empty override leaves the FMCSA value + `'fmcsa'` provenance untouched.
 * `hidden` is OR'd with the FMCSA contact opt-out (an admin can hide, but can't
 * un-hide a carrier who opted out). Because overrides live in a separate table
 * the FMCSA re-ingest never touches, this merge is the ONLY place edits re-enter
 * the card — so edits survive every re-ingest by construction.
 */
export function mergeCarrierOverride(
  base: VisibleCarrier,
  ov: CarrierOverrideRow | null | undefined,
): VisibleCarrier {
  if (!ov) return base;
  // Foundation attributes every override write to 'admin' (the only write path
  // in this phase). The carrier-self-edit phase will distinguish 'carrier'.
  const src: FieldSource = 'admin';
  const provenance: CarrierProvenance = { ...FMCSA_PROVENANCE };
  const out: VisibleCarrier = { ...base, provenance };
  if (ov.aboutOverride != null && ov.aboutOverride.trim() !== '') {
    out.aboutOverride = ov.aboutOverride;
    provenance.about = src;
  }
  if (ov.emailOverride != null && ov.emailOverride.trim() !== '') {
    out.email = ov.emailOverride;
    provenance.email = src;
  }
  if (ov.phoneOverride != null && ov.phoneOverride.trim() !== '') {
    out.phone = ov.phoneOverride;
    provenance.phone = src;
  }
  if (ov.hidden === true) {
    out.contactHidden = true;
    provenance.hidden = src;
  }
  if (ov.capabilities && typeof ov.capabilities === 'object') {
    out.capabilities = { ...ov.capabilities };
    if (Object.values(ov.capabilities).some(Boolean)) provenance.capabilities = src;
  }
  // Carrier-declared other operating cities. Defensive-normalize (trim, upper-
  // case state) and drop malformed entries so a bad row can never render a
  // broken chip. Empty/absent → leave the base's [] (block omitted on render).
  if (Array.isArray(ov.operatingLocations)) {
    const cleaned = ov.operatingLocations
      .filter(
        (l): l is CarrierOperatingLocation =>
          !!l && typeof l.city === 'string' && typeof l.state === 'string' && l.city.trim() !== '' && l.state.trim() !== '',
      )
      .map((l) => ({ city: l.city.trim(), state: l.state.trim().toUpperCase() }));
    if (cleaned.length) out.operatingLocations = cleaned;
  }
  return out;
}

export interface DirectorySummary {
  total: number;
  intermodalTotal: number;
  states: number;
  byState: { state: string; count: number }[];
  byPort: { code: string; name: string; city: string; state: string; count: number }[];
}

/**
 * Empty-but-valid summary — every port listed with a 0 count, no states.
 *
 * Returned when the underlying `carrier_directory` read fails (e.g. the table
 * is missing on a prod DB that never received migration 0041). The public
 * /directory + /compliance pages MUST render a clean empty state, never 500, so
 * the query layer degrades to this instead of throwing. Boot self-heal
 * (ensureSelfHealTables) normally guarantees the table exists, so this is a
 * belt-and-suspenders fallback for any residual read failure.
 */
function emptyDirectorySummary(): DirectorySummary {
  return {
    total: 0,
    intermodalTotal: 0,
    states: 0,
    byState: [],
    byPort: (() => {
      const seen = new Map<string, { code: string; name: string; city: string; state: string; count: number }>();
      for (const p of CONTAINER_PORTS) {
        const g = portGroupForMemberCode(p.code);
        const code = g?.code ?? p.code;
        if (!seen.has(code)) {
          seen.set(code, { code, name: g?.label ?? p.name, city: g?.city ?? p.city, state: g?.state ?? p.state, count: 0 });
        }
      }
      return [...seen.values()];
    })(),
  };
}

/**
 * TTL for the cached global directory aggregates (summary + facet counts).
 * These values are IDENTICAL for every visitor and only change on the weekly
 * FMCSA ingest, so a short cache eliminates the per-request full-table scans
 * that were saturating the DB connection pool under crawler load.
 */
const DIRECTORY_AGG_TTL_MS = 5 * 60_000;

// ─── Aggregate hardening: per-statement timeout + bounded recompute concurrency
//
// TWO production outages (all QuoteFleet domains down, every request hanging
// ~20s → HTTP 000) traced to the heavy directory aggregate scans below
// (getDirectorySummaryUnsafe + getFacetCountsUnsafe) over the ~330k-row
// carrier_directory table. On a COLD cache (right after every deploy/restart) a
// burst of /directory requests with DIFFERENT filter keys each triggers a
// DISTINCT facet recompute; the per-key single-flight only dedupes IDENTICAL
// concurrent computes, so N distinct keys still stampede the small Neon compute
// at once. With no per-statement ceiling, one CPU-starved aggregate ran for
// ~31 MINUTES holding a pooled connection; six of those pinned the whole pool →
// the app couldn't get a connection → total outage. Two additive guards make
// that impossible:
//
//   1. Every aggregate scan runs under `SET LOCAL statement_timeout` so it can
//      NEVER hold a connection longer than AGG_STATEMENT_TIMEOUT_MS. A timed-out
//      scan aborts (Postgres 57014) and rejects, flowing through the SAME error
//      paths the SWR/single-flight layer already has (keep stale on error, serve
//      empty on a cold miss) — never a 500, never a minutes-long connection hold.
//   2. A single in-process semaphore caps how many aggregate recomputes may hit
//      the DB concurrently, so a cold-cache burst of distinct filter keys can use
//      at most AGG_MAX_CONCURRENCY connections at once (excess recomputes queue).
//
// ADDITIVE to the #406/#407 TTL + stale-while-revalidate + single-flight caching
// — that layer's semantics are UNCHANGED. NB: db/client.ts also sets a pool-wide
// statement_timeout; this per-aggregate SET LOCAL is defense-in-depth that is
// independent of the pool config and unit-testable in isolation.

/** Per-statement server-side timeout (ms) for the directory aggregate scans. */
const AGG_STATEMENT_TIMEOUT_MS = 8000;
/**
 * Max directory aggregate recomputes allowed to touch the DB concurrently.
 *
 * Raised from 2. That number was sized when a city-scoped facet compute meant
 * ~9 full-table bitmap scans — 0068 measured ONE of them at cost 8,748, so a
 * whole compute was on the order of 79,000 and holding two of those at once was
 * already generous. 0068's city-slug EXPRESSION index changed that: the same
 * scans are now index scans, measured on prod at cost 40–585 each, ~4,000 for
 * the compute — roughly a 20x drop, and the remaining wall-clock is dominated by
 * per-statement ROUND TRIPS to Neon rather than by work on the server.
 *
 * At 2 slots that latency is the throughput ceiling, and prod duly started
 * logging "aggregate limiter queue wait exceeded 2000ms" once the sitemap put
 * ~350k URLs in front of crawlers: the bound was doing its job, but it was
 * shedding work that the database could now comfortably absorb. 4 slots doubles
 * throughput while still leaving 6 of the 10-connection pool for everything
 * else (listCarriers runs outside this limiter, on its own connection).
 */
const AGG_MAX_CONCURRENCY = 4;

/**
 * TOTAL wall-clock budget (ms) for a REQUEST-PATH multi-scan aggregate (the
 * filtered facet-count transaction + the list count/select transaction). The
 * per-statement `statement_timeout` bounds ONE scan to 8s, but the filtered facet
 * compute issues ~9 sequential scans in a single transaction — so their SUM was
 * unbounded (up to ~72s). On a cold/contended Neon compute those stacked to the
 * ~25s hang that took the page to HTTP 000. This budget re-arms statement_timeout
 * to the REMAINING budget before each scan, so the WHOLE transaction can never
 * pin a connection longer than this; when it's exhausted the next scan aborts
 * (Postgres 57014) and the caller degrades (stale/empty facets, empty list) — the
 * page still renders. OFF-path recomputes (persisted base aggregates) pass no
 * budget and keep the per-statement-only ceiling so the full-table scan is free
 * to take the time it legitimately needs behind the limiter.
 */
const REQUEST_AGG_BUDGET_MS = 8000;

/**
 * Max time a REQUEST-PATH facet recompute may spend QUEUEING for one of the
 * AGG_MAX_CONCURRENCY limiter slots before it gives up and degrades to empty
 * counts.
 *
 * WHY THIS EXISTS: REQUEST_AGG_BUDGET_MS is armed INSIDE withAggregateTimeout —
 * i.e. AFTER the limiter slot has been acquired — so it bounds the scans but not
 * the wait for a slot. acquire() had no timeout and the waiter queue had no cap,
 * so queue time was entirely unbounded. That is survivable while cold misses are
 * rare, but the sitemap now advertises thousands of city hubs and facetCacheKey
 * includes citySlug, so EVERY city page is its own cache key against a
 * 200-entry cache: a sitemap-driven crawl cold-misses nearly every request. With
 * 2 slots the queue then grows without limit and each request hangs until the
 * 60s server requestTimeout — requests pile up instead of degrading, which is
 * the one failure mode the rest of this file is built to prevent.
 *
 * Bounding the ACQUIRE turns that back into graceful degradation: the rejection
 * flows through getFacetCounts' existing catch → emptyFacetCounts(). Only the
 * sidebar facet BADGES go blank; the page and its carrier list are unaffected,
 * because listCarriers runs on its own connection and never enters this limiter.
 * Sized well under REQUEST_AGG_BUDGET_MS: if two slots haven't freed in 2s, the
 * compute could not have finished inside its own budget anyway.
 */
const AGG_ACQUIRE_WAIT_MS = 2000;

/**
 * OFF-PATH (boot / cron / ingest-end) recompute budgets. The persisted-aggregate
 * recompute runs the full 330k-row scans behind the limiter, so historically it
 * passed NO budget at all — a starved recompute could then wait UNBOUNDED on a
 * pooled connection / the 2-slot limiter and drag the whole run past the 15-min
 * cron slow-run watchdog (CRON_SLOW_RUN_MS in cronSafety.ts), firing the "cron
 * slow >15min" alerts. Two additive bounds fix that without raising the (correct)
 * watchdog:
 *   - OFFPATH_SCAN_BUDGET_MS: a per-transaction statement-timeout budget for each
 *     scan-set (summary + base facets). Generous vs the 8s request path because
 *     the off-path scan legitimately covers the whole table, but still finite so a
 *     starved scan aborts (Postgres 57014) and releases its connection.
 *   - OFFPATH_RECOMPUTE_BUDGET_MS: a TOTAL wall-clock cap over the entire
 *     recompute (limiter + connection acquire + both scan-sets + the upsert), so
 *     even an unbounded connection/limiter wait — which a statement_timeout can
 *     NOT bound — aborts well before the watchdog. Sized above the sum of the two
 *     scan budgets plus acquire slack, and far below CRON_SLOW_RUN_MS.
 */
const OFFPATH_SCAN_BUDGET_MS = 30_000;
const OFFPATH_RECOMPUTE_BUDGET_MS = 90_000;

/**
 * Reject if `p` has not settled within `ms`. The underlying work keeps running
 * (JS cannot cancel an in-flight promise), but its DB statements are independently
 * bounded by the statement_timeout armed via withAggregateTimeout, so the pooled
 * connection is released server-side regardless; this race only lets the CALLER
 * (the boot heal / the refresh cron) settle before the 15-min slow-run watchdog.
 * The timer is unref'd (never keeps the process alive) and always cleared on
 * settle so it can never leak. Exported for a deterministic unit test.
 */
export function withWallClockDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${ms}ms wall-clock budget`)),
      ms,
    );
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/** Transaction handle type for withAggregateTimeout's callback (drizzle tx). */
type AggregateTx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

/**
 * Re-arm the transaction's `statement_timeout` to the remaining wall-clock budget.
 * Called before each scan of a multi-scan request-path aggregate so the SUM of
 * its statements is bounded (not just each one). Once the budget is spent the
 * ceiling collapses to ~1ms, so the very next scan aborts immediately (57014) and
 * releases the pooled connection instead of the transaction dragging on. A no-op
 * of re-setting the constant 8s ceiling when there is no total budget (off-path
 * recomputes), which preserves the original per-statement-only semantics.
 */
type ArmTimeout = () => Promise<void>;

/**
 * Minimal in-process FIFO counting semaphore. Bounds how many `run()` callbacks
 * execute concurrently; excess callers wait (in arrival order) for a freed slot.
 * No timers, no external state — just enough to stop a cold-cache facet stampede
 * from opening more than AGG_MAX_CONCURRENCY aggregate transactions at once.
 * Exported for a deterministic concurrency unit test.
 */
export class AggregateLimiter {
  private active = 0;
  private readonly waiters: Array<AggregateLimiterWaiter> = [];
  constructor(private readonly max: number) {}
  /**
   * `maxWaitMs` bounds the time spent QUEUEING for a slot (not the work itself).
   * Omit it for off-path callers, which carry their own wall-clock budget and
   * should wait as long as it takes. See AGG_ACQUIRE_WAIT_MS for why the
   * request path must pass one.
   */
  async run<T>(fn: () => Promise<T>, maxWaitMs?: number): Promise<T> {
    await this.acquire(maxWaitMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  private acquire(maxWaitMs?: number): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: AggregateLimiterWaiter = { resolve, reject };
      if (maxWaitMs != null) {
        waiter.timer = setTimeout(() => {
          // Drop ourselves from the queue FIRST, so release() can never hand a
          // freed slot to an already-rejected waiter (which would leak the
          // conserved active count and shrink the limiter permanently).
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error(`aggregate limiter queue wait exceeded ${maxWaitMs}ms`));
        }, maxWaitMs);
        // Never keep the process alive just to fail a queued waiter.
        if (typeof (waiter.timer as { unref?: () => void }).unref === 'function') {
          (waiter.timer as { unref: () => void }).unref();
        }
      }
      this.waiters.push(waiter);
    });
  }
  private release(): void {
    const next = this.waiters.shift();
    // Hand the just-freed slot straight to the next waiter (the active count is
    // conserved); only when nobody is waiting does the active count drop.
    if (next) {
      if (next.timer) clearTimeout(next.timer);
      next.resolve();
    } else this.active -= 1;
  }
}

/** One queued acquire(). `timer` is present only for a bounded (request-path) wait. */
interface AggregateLimiterWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Shared limiter for ALL directory aggregate recomputes (summary + every facet
 *  key) so distinct-key computes can never stampede the DB pool together. */
const aggregateLimiter = new AggregateLimiter(AGG_MAX_CONCURRENCY);

/**
 * Run a directory aggregate read under a per-statement timeout. Opens a
 * transaction, applies `SET LOCAL statement_timeout`, then runs `fn` with the tx
 * handle. Any scan exceeding the timeout aborts server-side (Postgres error
 * 57014) and REJECTS this promise, releasing the pooled connection at once — the
 * caller's existing try/catch then keeps the stale cached value or serves the
 * empty/degraded result. `SET LOCAL` scopes the timeout to this transaction and
 * auto-resets on commit, so it never leaks onto other pooled work.
 */
async function withAggregateTimeout<T>(
  fn: (tx: AggregateTx, arm: ArmTimeout) => Promise<T>,
  totalBudgetMs?: number,
): Promise<T> {
  // A total budget bounds the WHOLE transaction (sum of its scans); without one
  // the original per-statement 8s ceiling applies to each statement unchanged.
  const deadline = totalBudgetMs != null ? Date.now() + totalBudgetMs : null;
  return db().transaction(async (tx) => {
    const arm: ArmTimeout = async () => {
      const ms = deadline != null ? Math.max(1, deadline - Date.now()) : AGG_STATEMENT_TIMEOUT_MS;
      // SET does not accept bind params; the value is our own integer constant.
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${Math.ceil(ms)}`));
    };
    await arm();
    return fn(tx, arm);
  });
}

/** Single-value TTL cache for the arg-less global summary. `at` is the staleness
 *  clock; a value older than DIRECTORY_AGG_TTL_MS is served STALE while one
 *  background refresh recomputes it (stale-while-revalidate). */
let directorySummaryCache: { at: number; val: DirectorySummary } | null = null;
/** In-flight refresh/cold-miss compute for the summary (single-flight). At most
 *  ONE recompute runs at a time: concurrent callers reuse this promise instead of
 *  each firing their own full-table scans. null when no refresh is running. */
let directorySummaryInflight: Promise<DirectorySummary> | null = null;

/**
 * Recompute the summary and (on success) refresh the cache. Rejects on DB error,
 * leaving the existing cache untouched (stale value preserved, never poisoned).
 * Always clears the in-flight slot in `finally` so no promise ever leaks and a
 * later request can retry. Never runs its `finally` synchronously — the awaited
 * `...Unsafe()` is async, so the caller has already stored this promise in
 * `directorySummaryInflight` before the slot is cleared.
 */
async function refreshDirectorySummary(): Promise<DirectorySummary> {
  try {
    // Gate the recompute through the shared limiter so a cold-cache burst can
    // never open more than AGG_MAX_CONCURRENCY aggregate transactions at once.
    const val = await aggregateLimiter.run(() => getDirectorySummaryUnsafe());
    directorySummaryCache = { at: Date.now(), val };
    return val;
  } finally {
    directorySummaryInflight = null;
  }
}

// ─── Persisted global aggregates: the durable outage fix ────────────────────
//
// ROOT CAUSE of the recurring all-domains-down outage: even with the TTL cache
// (#406), stale-while-revalidate + single-flight (#407), and the per-statement
// timeout + limiter (#409), the global directory SUMMARY and the UNFILTERED base
// FACET COUNTS were still COMPUTED on the request path over the ~330k-row
// carrier_directory table. After every deploy/restart the caches are COLD, so a
// burst of concurrent /directory hits each triggered a full-table aggregate scan
// on the small Neon compute → the pool saturated → every request hung → HTTP 000.
//
// THE DURABLE FIX: these two aggregates are IDENTICAL for every visitor and only
// change on the weekly FMCSA ingest, so we PRECOMPUTE + PERSIST them in a single
// row (directory_aggregate_cache) OFF the request path (at the end of an ingest,
// on the weekly refresh cron, and lazily on boot). The request path then serves
// them from a near-instant single-row PK lookup and NEVER runs the 330k-row scan
// itself. Only when the persisted row is MISSING (a cold DB that has never been
// ingested) does it fall back to the existing live-compute-with-cache path — so
// all of #406/#407/#409's semantics remain intact as the fallback.
//
// FILTERED facet combos (getFacetCounts with actual filters) are NOT precomputed
// (their space is combinatorial); they keep the live SWR path, now capped by
// #409's timeout + limiter. Only the UNFILTERED base case is served persisted.

/** The one and only row id in directory_aggregate_cache (a singleton table). */
export const AGG_SINGLETON_ID = 1;

/** Boot/cron staleness threshold: recompute the persisted aggregates when the
 *  row is missing or older than this. The weekly ingest is the real refresh; this
 *  is a safety net that keeps the row from ever being pathologically stale. */
export const AGG_PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The precomputed global aggregates as served to the request path. Mirrors the
 * two JSONB columns + freshness stamp of directory_aggregate_cache.
 */
export interface PersistedAggregates {
  summary: DirectorySummary;
  baseFacets: FacetCounts;
  computedAt: Date;
}

/** Short in-memory shield in FRONT of the persisted-row PK lookup so a warm
 *  request serves from memory (zero DB round-trips) and a cold/stale one does a
 *  SINGLE single-flighted PK read — never the 330k-row scan. */
let persistedAggCache: { at: number; val: PersistedAggregates | null } | null = null;
let persistedAggInflight: Promise<PersistedAggregates | null> | null = null;

/** Raw single-row PK read of the persisted aggregates. Returns null when the row
 *  is absent (cold DB / never populated) or on ANY read error (missing table,
 *  transient blip) so the caller degrades to the live path — never a throw. This
 *  is a PK lookup, NOT an aggregate scan, so it is safe on the request path. */
async function readPersistedAggregates(): Promise<PersistedAggregates | null> {
  try {
    const rows = await db()
      .select({
        summary: directoryAggregateCache.summary,
        baseFacets: directoryAggregateCache.baseFacets,
        computedAt: directoryAggregateCache.computedAt,
      })
      .from(directoryAggregateCache)
      .where(eq(directoryAggregateCache.id, AGG_SINGLETON_ID))
      .limit(1);
    const r = rows[0];
    if (!r || !r.summary || !r.baseFacets) return null;
    return { summary: r.summary, baseFacets: r.baseFacets, computedAt: r.computedAt };
  } catch (err) {
    console.warn('[directory] readPersistedAggregates failed; falling back to live path:', err);
    return null;
  }
}

/**
 * Load the persisted aggregates with the same stale-while-revalidate discipline
 * as the live caches: a cached value (fresh OR stale) returns IMMEDIATELY; a
 * stale one triggers ONE background PK re-read; only a COLD MISS awaits, and
 * concurrent callers share the single-flight promise. A `null` (row absent) is
 * cached too, so a truly cold DB doesn't hammer the PK read every request — it
 * falls through to the live path until boot/cron populates the row.
 */
async function loadPersistedAggregates(): Promise<PersistedAggregates | null> {
  const cached = persistedAggCache;
  if (cached) {
    if (Date.now() - cached.at >= DIRECTORY_AGG_TTL_MS && !persistedAggInflight) {
      const p = readPersistedAggregates().then((val) => {
        persistedAggCache = { at: Date.now(), val };
        return val;
      });
      persistedAggInflight = p;
      void p.catch(() => {}).finally(() => {
        persistedAggInflight = null;
      });
    }
    return cached.val;
  }
  let inflight = persistedAggInflight;
  if (!inflight) {
    inflight = readPersistedAggregates().then((val) => {
      persistedAggCache = { at: Date.now(), val };
      return val;
    });
    persistedAggInflight = inflight;
    void inflight.catch(() => {}).finally(() => {
      persistedAggInflight = null;
    });
  }
  try {
    return await inflight;
  } catch {
    return null;
  }
}

/** Test/ops seam: drop the in-memory persisted-aggregate shield so the next read
 *  re-hits the persisted row (used right after a recompute so a long-lived process
 *  picks up the fresh row without waiting out the TTL). */
export function invalidatePersistedAggregatesCache(): void {
  persistedAggCache = null;
}

/**
 * Recompute BOTH global aggregates and PERSIST them to the singleton row. Runs
 * OFF the request path (ingest end / refresh cron / boot). The computation reuses
 * the EXACT live `...Unsafe()` scans — still wrapped in withAggregateTimeout +
 * the shared limiter — but its result is written once to the table instead of per
 * request. On success the in-memory shield is invalidated so this process serves
 * the fresh row immediately. Throws on a compute/DB failure so the caller can log
 * it; it never partially writes (summary + base facets are written in one upsert).
 */
export async function recomputeAndPersistDirectoryAggregates(): Promise<PersistedAggregates> {
  // Bound the WHOLE off-path recompute with a total wall-clock cap so a starved
  // run (unbounded pooled-connection / limiter wait — which a statement_timeout
  // can NOT bound) aborts cleanly instead of dragging past the 15-min cron
  // slow-run watchdog (cronSafety.ts). The per-scan-set statement budgets below
  // release the DB connection server-side; this outer cap settles the caller.
  return withWallClockDeadline(
    recomputeAndPersistDirectoryAggregatesInner(),
    OFFPATH_RECOMPUTE_BUDGET_MS,
    'directory aggregate recompute',
  );
}

async function recomputeAndPersistDirectoryAggregatesInner(): Promise<PersistedAggregates> {
  // Both computes go through the shared limiter so an off-path recompute can
  // never open more than AGG_MAX_CONCURRENCY aggregate transactions at once —
  // identical back-pressure to the live refresh paths. Each scan-set now carries
  // a finite per-transaction statement budget (OFFPATH_SCAN_BUDGET_MS) so a
  // starved scan aborts (Postgres 57014) and frees its connection rather than
  // pinning it — the off-path used to pass no budget at all.
  const summary = await aggregateLimiter.run(() =>
    getDirectorySummaryUnsafe(OFFPATH_SCAN_BUDGET_MS),
  );
  const baseFacets = await aggregateLimiter.run(() =>
    getFacetCountsUnsafe(normalizeFilters({}), OFFPATH_SCAN_BUDGET_MS),
  );
  const computedAt = new Date();
  await db()
    .insert(directoryAggregateCache)
    .values({ id: AGG_SINGLETON_ID, summary, baseFacets, computedAt })
    .onConflictDoUpdate({
      target: directoryAggregateCache.id,
      set: { summary, baseFacets, computedAt },
    });
  invalidatePersistedAggregatesCache();
  return { summary, baseFacets, computedAt };
}

/**
 * Safety-net populate for boot + the refresh cron: recompute+persist ONLY when
 * the persisted row is missing or older than `maxAgeMs`. Never throws (best-
 * effort). Returns what it did, for logging/tests.
 */
export async function ensureFreshDirectoryAggregates(
  maxAgeMs: number = AGG_PERSIST_MAX_AGE_MS,
): Promise<'fresh' | 'recomputed' | 'error'> {
  try {
    const existing = await readPersistedAggregates();
    if (existing && Date.now() - existing.computedAt.getTime() < maxAgeMs) {
      return 'fresh';
    }
    await recomputeAndPersistDirectoryAggregates();
    return 'recomputed';
  } catch (err) {
    console.warn('[directory] ensureFreshDirectoryAggregates failed (non-fatal):', err);
    return 'error';
  }
}

/**
 * Carrier counts per state + per port (+ intermodal total) for the index/facets.
 *
 * Stale-while-revalidate + single-flight: a cached value (fresh OR stale) is
 * returned IMMEDIATELY without ever awaiting a recompute. If it is stale and no
 * refresh is already running, ONE background refresh is kicked off (fire-and-
 * forget; its rejection is caught so it can never surface as an unhandled
 * rejection, and a failed refresh keeps the stale value). Only a COLD MISS (no
 * cached value at all, e.g. right after a deploy) awaits — and then all
 * concurrent callers await the SAME single-flight promise, so only one scan runs.
 */
export async function getDirectorySummary(): Promise<DirectorySummary> {
  // PERSISTED-FIRST: serve the precomputed global summary from the singleton row
  // (a near-instant PK lookup, memory-shielded) so the request path NEVER runs
  // the 330k-row scan. Only a MISSING row (cold DB / never populated) falls
  // through to the live in-memory-cache + SWR + single-flight path below.
  const persisted = await loadPersistedAggregates();
  if (persisted) return persisted.summary;

  const cached = directorySummaryCache;
  if (cached) {
    // Serve stale immediately; refresh in the background if expired.
    if (Date.now() - cached.at >= DIRECTORY_AGG_TTL_MS && !directorySummaryInflight) {
      const p = refreshDirectorySummary();
      directorySummaryInflight = p;
      // Fire-and-forget: swallow rejection so a failed refresh keeps the stale
      // value and never becomes an unhandled promise rejection.
      void p.catch((err) =>
        console.warn('[directory] getDirectorySummary background refresh failed; keeping stale summary:', err),
      );
    }
    return cached.val;
  }
  // Cold miss — single-flight: first caller starts the compute, concurrent
  // callers await the same promise. Only the cold path may await a recompute.
  let inflight = directorySummaryInflight;
  if (!inflight) {
    inflight = refreshDirectorySummary();
    directorySummaryInflight = inflight;
  }
  try {
    return await inflight;
  } catch (err) {
    // Missing table / read failure ⇒ serve an empty directory, never a 500.
    // The in-flight slot was already cleared in refreshDirectorySummary's
    // finally, so a later request retries.
    console.warn('[directory] getDirectorySummary failed; serving empty summary:', err);
    return emptyDirectorySummary();
  }
}

async function getDirectorySummaryUnsafe(budgetMs?: number): Promise<DirectorySummary> {
  // All three heavy scans run inside ONE transaction under a per-statement
  // timeout; a timed-out scan rejects and is absorbed by getDirectorySummary's
  // keep-stale / serve-empty error paths. Folding stays pure JS below. The
  // REQUEST path passes no budget (unchanged 8s-per-statement ceiling); the
  // OFF-path recompute passes a total budget so the whole transaction is bounded.
  const { byStateRows, byPortRows, intermodalRow } = await withAggregateTimeout(async (tx) => {
    const byStateRows = await tx
      .select({ state: carrierDirectory.state, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .groupBy(carrierDirectory.state);

    const byPortRows = await tx
      .select({ port: carrierDirectory.nearestPortCode, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .groupBy(carrierDirectory.nearestPortCode);

    const intermodalRow = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(eq(carrierDirectory.intermodal, true));

    return { byStateRows, byPortRows, intermodalRow };
  }, budgetMs);

  const byState = byStateRows
    .filter((r) => r.state)
    .map((r) => ({ state: r.state as string, count: r.n }))
    .sort((a, b) => b.count - a.count);

  const portCountByCode = new Map(byPortRows.filter((r) => r.port).map((r) => [r.port as string, r.n]));
  // Fold the US seaport gateways into their DISPLAY groups (co-located ports like
  // LA + Long Beach collapse to one hub card) and sum member counts.
  const byPortGroup = new Map<string, { code: string; name: string; city: string; state: string; count: number }>();
  for (const p of CONTAINER_PORTS) {
    const g = portGroupForMemberCode(p.code);
    const code = g?.code ?? p.code;
    const entry =
      byPortGroup.get(code) ??
      { code, name: g?.label ?? p.name, city: g?.city ?? p.city, state: g?.state ?? p.state, count: 0 };
    entry.count += portCountByCode.get(p.code) ?? 0;
    byPortGroup.set(code, entry);
  }
  const byPort = [...byPortGroup.values()].sort((a, b) => b.count - a.count);

  const total = byState.reduce((s, r) => s + r.count, 0);

  return {
    total,
    intermodalTotal: intermodalRow[0]?.n ?? 0,
    states: byState.length,
    byState,
    byPort,
  };
}

// ─── Faceted filter model ─────────────────────────────────────────────────
//
// Every facet is a real GET query param (shareable + crawlable). Facets are
// tiered by DATA SOURCE, and the tier drives how honestly we can populate them:
//
//   Tier 1 — 100% FMCSA-native (backed by a real column):
//     state · city · fleet buckets (power_units) · safety (safety_rating) ·
//     active authority (authority_type present).
//   Tier 2 — FMCSA proxy (backed, source-tagged in the UI):
//     intermodal/drayage (crgo_intermodal) · recently updated (updated_at).
//   Tier 3 — self-declared / not in the current FMCSA ingest (NO column):
//     hazmat · reefer · UIIA · TWIC · C-TPAT/bonded · verified. These are
//     rendered DISABLED ("verify via claim") by the page layer and are never
//     applied as filters here — we will not assert data we don't have.

export type FleetBucketId = '1-25' | '26-100' | '101-500' | '500+';
export type DriversBucketId = '1-10' | '11-50' | '51-250' | '250+';
export type SafetyId = 'satisfactory' | 'conditional' | 'unsatisfactory' | 'unrated';
export type SortId = 'featured' | 'safety' | 'fleet' | 'drivers' | 'recent';
/** Sort direction — asc = Low→High (numeric) / best-first (safety) / oldest
 *  (recent); desc = the inverse. Ignored for the `featured` composite sort. */
export type SortDir = 'asc' | 'desc';

/**
 * Equipment / cargo-type filter — a SINGLE `equipment` GET param whose value is
 * one of these ids. Each is backed by a REAL FMCSA-derived boolean column on
 * carrier_directory (verified crgo_* census flags — see carrierIngest.ts), so
 * every option is an honest filter, not a proxy. `drayage` maps to the existing
 * `intermodal` column (kept for backward-compat with the legacy `intermodal=1`
 * param + the profile "Drayage / intermodal" badge).
 */
export type EquipmentId = 'drayage' | 'dryvan' | 'reefer' | 'hazmat' | 'tanker' | 'flatbed' | 'drybulk';

/** The carrier_directory boolean column each equipment id filters on. */
export const EQUIPMENT_OPTIONS: ReadonlyArray<{
  id: EquipmentId;
  label: string;
  column: 'intermodal' | 'hazmat' | 'dryVan' | 'reefer' | 'tanker' | 'flatbed' | 'dryBulk';
}> = [
  { id: 'drayage', label: 'Container / drayage', column: 'intermodal' },
  { id: 'dryvan', label: 'Dry van', column: 'dryVan' },
  { id: 'reefer', label: 'Reefer', column: 'reefer' },
  { id: 'hazmat', label: 'Hazmat', column: 'hazmat' },
  { id: 'tanker', label: 'Tanker / bulk', column: 'tanker' },
  { id: 'flatbed', label: 'Flatbed / oversized', column: 'flatbed' },
  { id: 'drybulk', label: 'Dry bulk', column: 'dryBulk' },
];

/**
 * Cargo-SPECIALTY filter — a SEPARATE `cargo` GET param (parallel to `equipment`,
 * so a shipper can combine a truck/equipment type with a cargo specialty). Each id
 * is backed by a REAL FMCSA-derived boolean column on carrier_directory (verified
 * crgo_* census flags — see carrierIngest.ts / migration 0050), so every option is
 * an honest filter with live counts, not a proxy. Single-select, mirroring the
 * equipment facet. "Household goods" + "Liquor / beverages" moved here from the
 * Tier-3 claim group now that they are real FMCSA columns.
 */
export type CargoId =
  | 'household'
  | 'beverages'
  | 'produce'
  | 'motorvehicles'
  | 'livestock'
  | 'grainfeed'
  | 'oilfield'
  | 'meat'
  | 'paper'
  | 'construction'
  | 'farmsupplies'
  | 'coalcoke'
  | 'buildingmaterials';

/** The carrier_directory boolean column each cargo id filters on. */
export const CARGO_OPTIONS: ReadonlyArray<{
  id: CargoId;
  label: string;
  column:
    | 'householdGoods'
    | 'beverages'
    | 'produce'
    | 'motorVehicles'
    | 'livestock'
    | 'grainFeed'
    | 'oilfield'
    | 'meat'
    | 'paper'
    | 'construction'
    | 'farmSupplies'
    | 'coalCoke'
    | 'buildingMaterials';
}> = [
  { id: 'household', label: 'Household goods', column: 'householdGoods' },
  { id: 'beverages', label: 'Liquor / beverages', column: 'beverages' },
  { id: 'produce', label: 'Fresh produce', column: 'produce' },
  { id: 'motorvehicles', label: 'Motor vehicles', column: 'motorVehicles' },
  { id: 'livestock', label: 'Livestock', column: 'livestock' },
  { id: 'grainfeed', label: 'Grain & feed', column: 'grainFeed' },
  { id: 'oilfield', label: 'Oilfield', column: 'oilfield' },
  { id: 'meat', label: 'Meat / perishable', column: 'meat' },
  { id: 'paper', label: 'Paper products', column: 'paper' },
  { id: 'construction', label: 'Construction', column: 'construction' },
  { id: 'farmsupplies', label: 'Farm supplies', column: 'farmSupplies' },
  { id: 'coalcoke', label: 'Coal / coke', column: 'coalCoke' },
  { id: 'buildingmaterials', label: 'Building materials', column: 'buildingMaterials' },
];

export const FLEET_BUCKETS: ReadonlyArray<{ id: FleetBucketId; label: string; min: number; max: number | null }> = [
  { id: '1-25', label: '1–25 trucks', min: 1, max: 25 },
  { id: '26-100', label: '26–100 trucks', min: 26, max: 100 },
  { id: '101-500', label: '101–500 trucks', min: 101, max: 500 },
  { id: '500+', label: '500+ trucks', min: 501, max: null },
];

/** Drivers-count buckets — FMCSA census `total_drivers` (schema column `drivers`),
 *  the driver-headcount analog of FLEET_BUCKETS' power-unit (truck) buckets. */
export const DRIVERS_BUCKETS: ReadonlyArray<{ id: DriversBucketId; label: string; min: number; max: number | null }> = [
  { id: '1-10', label: '1–10 drivers', min: 1, max: 10 },
  { id: '11-50', label: '11–50 drivers', min: 11, max: 50 },
  { id: '51-250', label: '51–250 drivers', min: 51, max: 250 },
  { id: '250+', label: '250+ drivers', min: 251, max: null },
];

export const SAFETY_OPTIONS: ReadonlyArray<{ id: SafetyId; label: string; letter: string | null }> = [
  { id: 'satisfactory', label: 'Satisfactory', letter: 'S' },
  { id: 'conditional', label: 'Conditional', letter: 'C' },
  { id: 'unsatisfactory', label: 'Unsatisfactory', letter: 'U' },
  { id: 'unrated', label: 'Not rated', letter: null },
];

export const SORT_OPTIONS: ReadonlyArray<{ id: SortId; label: string }> = [
  { id: 'featured', label: 'Featured' },
  { id: 'safety', label: 'Safety rating' },
  { id: 'fleet', label: 'Fleet size' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'recent', label: 'Recently updated' },
];

/**
 * Default sort direction per sort id. Numeric sorts (fleet / drivers) default
 * High→Low (desc), `recent` defaults newest-first (desc), `safety` defaults
 * best-first (asc). `featured` is a fixed composite — direction never applies.
 * The URL only carries `dir` when it DIFFERS from this default, keeping the
 * canonical form stable + shareable.
 */
export const SORT_DIR_DEFAULTS: Readonly<Record<SortId, SortDir>> = {
  featured: 'desc',
  safety: 'asc',
  fleet: 'desc',
  drivers: 'desc',
  recent: 'desc',
};

/** Whether a sort id honors an asc/desc direction toggle (all but `featured`). */
export function sortIsDirectional(sort: SortId): boolean {
  return sort !== 'featured';
}

/** Resolve the effective direction for a sort, falling back to its default. */
export function resolveSortDir(sort: SortId, dir?: SortDir | null): SortDir {
  if (!sortIsDirectional(sort)) return SORT_DIR_DEFAULTS[sort];
  return dir === 'asc' || dir === 'desc' ? dir : SORT_DIR_DEFAULTS[sort];
}

/** MCS-150 "recently updated" proxy window. */
const RECENT_DAYS = 365;

/** Normalized, fully-clamped facet state — safe to hand straight to SQL. */
export interface DirectoryFilters {
  state: string | null;
  port: string | null;
  citySlug: string | null;
  fleet: FleetBucketId | null;
  /** Drivers-count bucket (FMCSA total_drivers). null = any. */
  drivers: DriversBucketId | null;
  /** Safety filter collapsed to ONE toggle: keep only carriers in "good standing"
   *  — i.e. EXCLUDE Conditional + Unsatisfactory, KEEP Satisfactory + Not-rated.
   *  (FMCSA rates only a minority, so the useful filter is dropping the known-bad,
   *  never a satisfactory-only filter that would wrongly hide most carriers.) */
  goodStandingOnly: boolean;
  authorityActive: boolean;
  /** Legacy drayage flag — true when equipment==='drayage' OR the legacy
   *  `intermodal=1` param is set. Kept so existing surfaces (featured sort,
   *  profile badge, `intermodal=1` deep-links) keep working unchanged. */
  intermodal: boolean;
  /** Selected equipment/cargo-type filters (see EQUIPMENT_OPTIONS). MULTI-select:
   *  OR within the facet. Empty array = any. Stable canonical order (matches
   *  EQUIPMENT_OPTIONS order) so the URL is shareable + crawlable. */
  equipment: EquipmentId[];
  /** Selected cargo-specialty filters (see CARGO_OPTIONS). MULTI-select: OR within
   *  the facet. Empty array = any. Stable canonical order (CARGO_OPTIONS order). */
  cargo: CargoId[];
  recent: boolean;
  /** Free-text carrier-name search (ILIKE over legal_name / dba_name). Trimmed
   *  and required ≥2 chars by normalizeFilters; null when absent/too short. ANDed
   *  with every other active facet. Shareable/crawlable via the `q` GET param. */
  q: string | null;
  sort: SortId;
  /** Sort direction (asc/desc). Meaningful only when `sort` is directional. */
  dir: SortDir;
  page: number;
  perPage: number;
}

/** Minimum accepted length for the `q` carrier-name search (after trim). */
export const NAME_SEARCH_MIN = 2;
/** Cap so a pathological `q` can never blow up the ILIKE pattern. */
const NAME_SEARCH_MAX = 100;

/**
 * Normalize a raw `q` value into the trimmed, length-bounded search term (or null
 * when absent / shorter than NAME_SEARCH_MIN). Pure + total. Interior whitespace
 * is collapsed so "  Harbor   Link " → "Harbor Link".
 */
export function normalizeNameQuery(raw: unknown): string | null {
  const term = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (term.length < NAME_SEARCH_MIN) return null;
  return term.slice(0, NAME_SEARCH_MAX);
}

/**
 * WHERE clause for a carrier-name search: case-insensitive substring match over
 * legal_name OR dba_name. LIKE metacharacters (% _ \) in user input are escaped
 * so they match literally (no wildcard injection). Returns null for a too-short
 * term. Exported for query-shape unit tests.
 */
export function nameSearchCondition(rawTerm: string): SQL | null {
  const term = normalizeNameQuery(rawTerm);
  if (!term) return null;
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;
  return or(ilike(carrierDirectory.legalName, pattern), ilike(carrierDirectory.dbaName, pattern)) as SQL;
}

const FLEET_IDS = new Set(FLEET_BUCKETS.map((b) => b.id));
const DRIVERS_IDS = new Set(DRIVERS_BUCKETS.map((b) => b.id));
const SORT_IDS = new Set(SORT_OPTIONS.map((s) => s.id));
const EQUIPMENT_IDS = new Set(EQUIPMENT_OPTIONS.map((e) => e.id));
const EQUIPMENT_COLUMN = new Map(EQUIPMENT_OPTIONS.map((e) => [e.id, e.column] as const));
const CARGO_IDS = new Set(CARGO_OPTIONS.map((c) => c.id));
const CARGO_COLUMN = new Map(CARGO_OPTIONS.map((c) => [c.id, c.column] as const));
const truthy = (v: unknown): boolean => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

/**
 * Parse a loosely-typed multi-select facet value into a clean, de-duplicated,
 * canonically-ordered id list. Accepts a single string, a comma-separated string
 * (`reefer,flatbed`), or a repeated-param array (Express `?equipment=a&equipment=b`).
 * Junk / unknown ids are dropped, dupes collapsed, and the surviving ids are
 * returned in `order` (the option-table order) so the URL is stable + shareable.
 * A single legacy value (`?equipment=reefer`) still parses to `['reefer']`.
 */
function parseMultiFacet<T extends string>(raw: unknown, valid: ReadonlySet<T>, order: ReadonlyArray<T>): T[] {
  const parts: string[] = [];
  const push = (v: unknown) => {
    for (const piece of String(v ?? '').split(',')) {
      const t = piece.trim().toLowerCase();
      if (t) parts.push(t);
    }
  };
  if (Array.isArray(raw)) for (const v of raw) push(v);
  else push(raw);
  const seen = new Set<T>();
  for (const p of parts) if (valid.has(p as T)) seen.add(p as T);
  return order.filter((id) => seen.has(id));
}

/** Turn a raw name/slug into the directory's canonical city slug form. */
export function citySlugify(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Hard ceiling on `?page=`.
 *
 * The list query's only OFFSET is `(page - 1) * perPage`, so an unbounded page
 * number is an unbounded OFFSET — and 0065's sitemap made that reachable at
 * scale, because numberedPager() links straight to the LAST page of every hub.
 * Measured on prod with EXPLAIN (featured sort, perPage 24):
 *
 *   page 13,905  (OFFSET 333,696)  →  total cost 57,014.96
 *   page 100     (OFFSET   2,376)  →  total cost    500.57
 *
 * The cost is LINEAR in the OFFSET, so the cap is a straight trade between query
 * cost and how much of the directory a crawler can walk to.
 *
 * WHY 200 AND NOT 100 (measured on prod, 2026-08-29): the cap is no longer only
 * an abuse ceiling. Hub pagination now has a crawlable PATH form
 * (`{hub}/page/N`, see routes/directory.ts withPathPage), because robots.txt
 * disallows `/*?*page=` and the query pager was therefore invisible to Google —
 * which froze every hub at its first 24 carriers and left ~91% of carrier
 * profiles unreachable from `/`. City hubs are the surface that has to enumerate
 * the whole directory, so the cap has to clear the largest city:
 *
 *   carriers past rank 2,400 in their own city (cap 100)  →   1,793  (0.54%)
 *   carriers past rank 4,800 in their own city (cap 200)  →       0  (0.00%)
 *
 * Only TWO city groups in 26,229 exceed 2,400 rows — Houston TX (3,501 carriers,
 * 146 pages) and Fresno CA (3,092, 129 pages) — so a cap of 100 stranded exactly
 * those 1,793 carriers and nothing else. 200 covers every city group in prod with
 * ~37% headroom for ingest growth, at an EXPLAIN cost of roughly 1,000 (double
 * the 500.57 above, still two orders of magnitude below the unbounded case).
 * Anything larger buys nothing: 500 and 1,000 strand the same zero carriers.
 *
 * STATE hubs deliberately still truncate — the largest is CA at 44,137 carriers
 * (1,840 pages) and sizing the cap for that would be pointless, because every
 * carrier is also in a city hub, and the city hub is the cheap query.
 */
export const MAX_PAGE = 200;

/**
 * Parse a `?page=` value into a clamped page number plus whether the request
 * asked for something outside the servable range. PURE — unit-tested.
 *
 * `outOfRange` lets a route answer 404 for `?page=13917` instead of silently
 * serving page 100 under a different URL, which would mint unlimited duplicate
 * (and self-canonicalizing) URLs for crawlers to chew through.
 */
export function parsePageParam(raw: unknown): { page: number; outOfRange: boolean } {
  const text = String(raw ?? '').trim();
  if (text === '') return { page: 1, outOfRange: false };
  const n = parseInt(text, 10);
  // Non-numeric junk (?page=abc) keeps the historical "fall back to 1" behaviour
  // rather than 404-ing a link someone mistyped.
  if (!Number.isFinite(n) || n === 0) return { page: 1, outOfRange: false };
  if (n < 1) return { page: 1, outOfRange: true };
  if (n > MAX_PAGE) return { page: MAX_PAGE, outOfRange: true };
  return { page: n, outOfRange: false };
}

/**
 * Normalize loosely-typed query values (e.g. req.query) into DirectoryFilters.
 * Pure + total: any unknown value collapses to the safe default. `overrides`
 * lets a scoped route lock a dimension (state/port/city) regardless of input.
 */
export function normalizeFilters(
  raw: Record<string, unknown>,
  overrides?: Partial<Pick<DirectoryFilters, 'state' | 'port' | 'citySlug'>>,
): DirectoryFilters {
  const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
  const stateRaw = str(raw.state).toUpperCase();
  // `?port=` is WHITELISTED against the real port codes. Without this any string
  // (`?port=ZZZZZZZZ`) rendered a real 200 page with zero results that
  // self-canonicalised — i.e. an unbounded supply of thin, indexable URLs that a
  // single inbound link could mint permanently, competing for the same crawl
  // budget as the 330,218 carrier profiles. The /directory/port/:port PATH route
  // has always validated (routes/directory.ts); only the query facet did not.
  // An unknown code collapses to null = the unfiltered hub, matching how every
  // other unrecognised facet value already degrades.
  const portRawUnchecked = str(raw.port).toUpperCase().slice(0, 8);
  const portRaw = portRawUnchecked && isKnownPortCode(portRawUnchecked) ? portRawUnchecked : '';
  const fleetRaw = str(raw.fleet) as FleetBucketId;
  const driversRaw = str(raw.drivers) as DriversBucketId;
  const sortRaw = str(raw.sort).toLowerCase() as SortId;
  const dirRaw = str(raw.dir).toLowerCase();
  const sort: SortId = SORT_IDS.has(sortRaw) ? sortRaw : 'featured';
  const dir: SortDir = resolveSortDir(sort, dirRaw === 'asc' || dirRaw === 'desc' ? (dirRaw as SortDir) : null);
  // Equipment: MULTI-select comma-list (OR within the facet). The legacy
  // `intermodal=1` param maps to an implicit 'drayage' selection so old
  // bookmarks/deep-links keep working. `intermodal` (boolean) stays true whenever
  // the resolved equipment set includes drayage OR the legacy flag was set.
  const legacyIntermodal = truthy(raw.intermodal);
  const equipmentIds = parseMultiFacet<EquipmentId>(raw.equipment, EQUIPMENT_IDS, EQUIPMENT_OPTIONS.map((e) => e.id));
  const equipment: EquipmentId[] =
    legacyIntermodal && !equipmentIds.includes('drayage')
      ? // Fold the legacy flag in at its canonical position (drayage is first).
        (EQUIPMENT_OPTIONS.map((e) => e.id).filter((id) => id === 'drayage' || equipmentIds.includes(id)) as EquipmentId[])
      : equipmentIds;
  // Cargo specialty: a separate MULTI-select comma-list, orthogonal to equipment.
  const cargo: CargoId[] = parseMultiFacet<CargoId>(raw.cargo, CARGO_IDS, CARGO_OPTIONS.map((c) => c.id));
  return {
    state: overrides && 'state' in overrides ? overrides.state ?? null : /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null,
    port: overrides && 'port' in overrides ? overrides.port ?? null : portRaw || null,
    citySlug:
      overrides && 'citySlug' in overrides ? overrides.citySlug ?? null : str(raw.city) ? citySlugify(str(raw.city)) : null,
    fleet: FLEET_IDS.has(fleetRaw) ? fleetRaw : null,
    drivers: DRIVERS_IDS.has(driversRaw) ? driversRaw : null,
    // Single "good standing" toggle (?standing=good). Default OFF.
    goodStandingOnly: truthy(raw.standing) || str(raw.standing).toLowerCase() === 'good',
    authorityActive: String(raw.authority ?? '').toLowerCase() === 'active' || truthy(raw.authority),
    intermodal: equipment.includes('drayage') || legacyIntermodal,
    equipment,
    cargo,
    recent: truthy(raw.recent),
    q: normalizeNameQuery(raw.q),
    sort,
    dir,
    // Clamped to MAX_PAGE here as the LAST line of defence, so no caller can
    // reach a deep OFFSET even if it forgets parsePageParam. Routes should use
    // parsePageParam and 404 instead of silently serving the capped page.
    page: parsePageParam(raw.page).page,
    perPage: DEFAULT_PER_PAGE,
  };
}

/** Which facet keys, if present on /directory, switch it from landing → results. */
export const FACET_QUERY_KEYS = [
  'state',
  'port',
  'city',
  'fleet',
  'drivers',
  // 'standing' is the current good-standing toggle; 'safety' stays listed so any
  // legacy ?safety= deep-link still switches /directory into the results view.
  'standing',
  'safety',
  'authority',
  'intermodal',
  'equipment',
  'cargo',
  'recent',
  'q',
  'sort',
  'dir',
  'page',
  'hazmat',
  'reefer',
] as const;

/** SQL predicate matching a URL city slug against the free-text city column. */
function cityCondition(slug: string): SQL {
  return sql`btrim(regexp_replace(lower(${carrierDirectory.city}), '[^a-z0-9]+', '-', 'g'), '-') = ${slug}`;
}

function fleetCondition(id: FleetBucketId): SQL | null {
  const b = FLEET_BUCKETS.find((x) => x.id === id);
  if (!b) return null;
  return b.max == null
    ? gt(carrierDirectory.powerUnits, b.min - 1)
    : (and(gte(carrierDirectory.powerUnits, b.min), sql`${carrierDirectory.powerUnits} <= ${b.max}`) as SQL);
}

function driversCondition(id: DriversBucketId): SQL | null {
  const b = DRIVERS_BUCKETS.find((x) => x.id === id);
  if (!b) return null;
  return b.max == null
    ? gt(carrierDirectory.drivers, b.min - 1)
    : (and(gte(carrierDirectory.drivers, b.min), sql`${carrierDirectory.drivers} <= ${b.max}`) as SQL);
}

/**
 * "Good standing" predicate for the single safety toggle: keep Satisfactory (S)
 * and Not-rated (NULL); EXCLUDE Conditional (C) + Unsatisfactory (U). Written as
 * "null OR not-in(C,U)" so unrated carriers (the majority) are never dropped.
 */
function goodStandingCondition(): SQL {
  return or(
    isNull(carrierDirectory.safetyRating),
    sql`upper(coalesce(${carrierDirectory.safetyRating}, '')) not in ('C', 'U')`,
  ) as SQL;
}

/** Resolve a port facet value to a WHERE clause over ALL its member codes. */
function portCondition(port: string): SQL | null {
  const codes = portFilterCodes(port);
  if (codes.length === 0) return null;
  return codes.length === 1 ? eq(carrierDirectory.nearestPortCode, codes[0]) : (inArray(carrierDirectory.nearestPortCode, codes) as SQL);
}

/**
 * One equipment id → an `eq(<column>, true)` on its FMCSA-derived boolean column.
 * `drayage` maps to the `intermodal` column (its data home), so — unlike the old
 * single-select path — it IS included here: with multi-select the drayage option
 * has to participate in the equipment OR-group, not sit in a separate predicate.
 */
function equipmentColCondition(id: EquipmentId): SQL | null {
  const column = EQUIPMENT_COLUMN.get(id);
  if (!column) return null;
  return eq(carrierDirectory[column], true);
}

/**
 * Multi-select equipment filter → OR of each selected column
 * (`reefer OR flatbed`). Empty selection → null (no clause). Single selection →
 * the bare `eq` (no redundant OR wrapper).
 */
function equipmentCondition(ids: EquipmentId[]): SQL | null {
  const cols = ids.map(equipmentColCondition).filter((x): x is SQL => x != null);
  if (cols.length === 0) return null;
  return cols.length === 1 ? cols[0] : (or(...cols) as SQL);
}

/** One cargo id → an `eq(<column>, true)` on its FMCSA-derived boolean column. */
function cargoColCondition(id: CargoId): SQL | null {
  const column = CARGO_COLUMN.get(id);
  if (!column) return null;
  return eq(carrierDirectory[column], true);
}

/** Multi-select cargo-specialty filter → OR of each selected column. */
function cargoCondition(ids: CargoId[]): SQL | null {
  const cols = ids.map(cargoColCondition).filter((x): x is SQL => x != null);
  if (cols.length === 0) return null;
  return cols.length === 1 ? cols[0] : (or(...cols) as SQL);
}

const recentCutoff = (): Date => new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

/**
 * Build the WHERE condition list from active filters — one entry per ACTIVE
 * facet, AND-ed together by the caller. Multi-select facets (equipment / cargo)
 * contribute a SINGLE OR-group entry, so the semantics are **OR within a facet,
 * AND across facets** (matches any selected equipment AND any selected cargo).
 * `exclude` drops one dimension so facet-count queries can show "how many if you
 * picked this". Exported for query-shape unit tests. `drayage` no longer has a
 * standalone `intermodal` predicate — it rides inside the equipment OR-group
 * (its column IS `intermodal`), which keeps OR-within-facet honest.
 */
export function buildConditions(f: DirectoryFilters, exclude: Set<string> = new Set()): SQL[] {
  const c: SQL[] = [];
  if (f.state && !exclude.has('state')) c.push(eq(carrierDirectory.state, f.state));
  if (f.port && !exclude.has('port')) {
    const pc = portCondition(f.port);
    if (pc) c.push(pc);
  }
  if (f.citySlug && !exclude.has('city')) c.push(cityCondition(f.citySlug));
  if (f.fleet && !exclude.has('fleet')) {
    const fc = fleetCondition(f.fleet);
    if (fc) c.push(fc);
  }
  if (f.drivers && !exclude.has('drivers')) {
    const dc = driversCondition(f.drivers);
    if (dc) c.push(dc);
  }
  if (f.goodStandingOnly && !exclude.has('standing')) c.push(goodStandingCondition());
  if (f.authorityActive && !exclude.has('authority')) {
    c.push(and(isNotNull(carrierDirectory.authorityType), ne(carrierDirectory.authorityType, '')) as SQL);
  }
  if (f.equipment.length && !exclude.has('equipment')) {
    const ec = equipmentCondition(f.equipment);
    if (ec) c.push(ec);
  }
  if (f.cargo.length && !exclude.has('cargo')) {
    const cc = cargoCondition(f.cargo);
    if (cc) c.push(cc);
  }
  if (f.recent && !exclude.has('recent')) c.push(gte(carrierDirectory.updatedAt, recentCutoff()));
  if (f.q && !exclude.has('q')) {
    const nc = nameSearchCondition(f.q);
    if (nc) c.push(nc);
  }
  return c;
}

/**
 * ORDER BY chunks for a sort + direction. Numeric sorts (fleet / drivers) flip
 * the column direction (`asc` = Low→High, `desc` = High→Low), always NULLs last
 * so blanks never lead. `safety` flips the quality ranking (asc = best-first
 * Satisfactory→…, desc = worst-first). `recent` flips the recency (desc =
 * newest-first). `featured` is a fixed composite and ignores direction.
 * Exported for unit tests. `dir` defaults per SORT_DIR_DEFAULTS.
 */
export function orderForSort(sort: SortId, dir?: SortDir | null) {
  const d = resolveSortDir(sort, dir);
  const numeric = (col: Parameters<typeof asc>[0]) =>
    d === 'asc' ? sql`${col} asc nulls last` : sql`${col} desc nulls last`;
  switch (sort) {
    case 'fleet':
      return [numeric(carrierDirectory.powerUnits), asc(carrierDirectory.legalName), asc(carrierDirectory.id)];
    case 'drivers':
      return [numeric(carrierDirectory.drivers), asc(carrierDirectory.legalName), asc(carrierDirectory.id)];
    case 'safety': {
      // Quality rank S=0 → C=1 → Unrated=2 → U=3. asc = best-first (default),
      // desc = worst-first. Name/id keep a stable secondary order either way.
      const rank = sql`case upper(coalesce(${carrierDirectory.safetyRating}, '')) when 'S' then 0 when 'C' then 1 when 'U' then 3 else 2 end`;
      return [
        d === 'asc' ? sql`${rank} asc` : sql`${rank} desc`,
        asc(carrierDirectory.legalName),
        asc(carrierDirectory.id),
      ];
    }
    case 'recent':
      return [
        d === 'asc' ? asc(carrierDirectory.updatedAt) : desc(carrierDirectory.updatedAt),
        asc(carrierDirectory.id),
      ];
    case 'featured':
    default:
      return [
        desc(carrierDirectory.intermodal),
        sql`${carrierDirectory.powerUnits} desc nulls last`,
        asc(carrierDirectory.legalName),
        asc(carrierDirectory.id),
      ];
  }
}

export interface ListCarriersOpts {
  state?: string | null;
  port?: string | null;
  intermodal?: boolean;
  page?: number;
  perPage?: number;
  /** Optional full facet state; takes precedence over the legacy scalar opts. */
  filters?: DirectoryFilters;
}

export interface CarrierListResult {
  carriers: VisibleCarrier[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  filters: DirectoryFilters;
}

/** Paginated, facet-filterable carrier list. All inputs are clamped here. */
export async function listCarriers(opts: ListCarriersOpts): Promise<CarrierListResult> {
  const filters: DirectoryFilters =
    opts.filters ??
    normalizeFilters(
      { intermodal: opts.intermodal ? '1' : '', page: String(opts.page ?? 1) },
      {
        state: opts.state ? String(opts.state).toUpperCase().slice(0, 2) : null,
        port: opts.port ? String(opts.port).toUpperCase().slice(0, 8) : null,
      },
    );
  const perPage = Math.min(MAX_PER_PAGE, Math.max(5, Math.floor(opts.perPage ?? filters.perPage) || DEFAULT_PER_PAGE));
  // MAX_PAGE bound applied here too: listCarriers is reachable from the JSON API
  // and from callers that build DirectoryFilters by hand, not only through
  // normalizeFilters. The OFFSET must be bounded on EVERY path into it.
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(filters.page) || 1));

  try {
    return await listCarriersUnsafe({ ...filters, perPage, page });
  } catch (err) {
    // Missing table / read failure ⇒ empty result set, never a 500.
    console.warn('[directory] listCarriers failed; serving empty list:', err);
    return { carriers: [], total: 0, page, perPage, totalPages: 1, filters: { ...filters, page, perPage } };
  }
}

async function listCarriersUnsafe(filters: DirectoryFilters): Promise<CarrierListResult> {
  const { page, perPage } = filters;
  const conditions = buildConditions(filters);
  const where = conditions.length ? and(...conditions) : undefined;

  // PERSISTED-FIRST for the UNFILTERED total — the same short-circuit
  // getFacetCounts already applies to the unfiltered base facets. With no active
  // facet the total is `count(*)` over the whole table: identical for every
  // visitor, only changing on the weekly FMCSA ingest, and (measured on prod) a
  // 12,090-buffer parallel seq scan of the 330k-row heap on EVERY /directory,
  // ?sort=, and ?page= request — i.e. the highest-traffic path paying the most.
  // The precomputed singleton already carries that number as summary.total, so
  // serve it from the memory-shielded PK lookup instead. This also makes the list
  // total and the sidebar counts come from the SAME snapshot (today they can
  // disagree: the facets are persisted while the total was live). No persisted
  // row (cold DB / never populated) ⇒ null ⇒ the live count below still runs, so
  // the graceful degradation is unchanged. Awaited OUTSIDE the transaction so it
  // never holds a pooled connection. `conditions.length === 0` IS
  // isUnfilteredFacets(filters) — same definition, without rebuilding them.
  const persistedTotal = conditions.length === 0 ? (await loadPersistedAggregates())?.summary.total ?? null : null;

  // Both the filtered count and the ordered page run in ONE transaction under a
  // shared wall-clock budget (re-armed before each), so the list path — like the
  // facet path — can never pin a connection past REQUEST_AGG_BUDGET_MS. Running
  // them on one connection (instead of two auto-commit reads) also halves this
  // request's pool footprint under crawler/state-click bursts. On a budget/scan
  // failure the transaction rejects and listCarriers' catch serves an empty list.
  const { total, rows } = await withAggregateTimeout(async (tx, arm) => {
    let count = persistedTotal;
    if (count == null) {
      await arm();
      const totalRow = await tx.select({ n: sql<number>`count(*)::int` }).from(carrierDirectory).where(where);
      count = totalRow[0]?.n ?? 0;
    }
    await arm();
    const rows = await tx
      .select()
      .from(carrierDirectory)
      .where(where)
      .orderBy(...orderForSort(filters.sort, filters.dir))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return { total: count, rows };
  }, REQUEST_AGG_BUDGET_MS);

  return {
    carriers: rows.map(visibleCarrier),
    // `total` stays the TRUE match count — it is the "31,668 carriers" headline,
    // the meta description and the ItemList JSON-LD numberOfItems, and capping it
    // would make those copy lines wrong.
    total,
    page,
    perPage,
    // totalPages, by contrast, is consumed ONLY by the two pagination renderers
    // (numberedPager + paginationRelLinks) and by the JSON API. Capping it here —
    // at the single point that derives it — is what stops the "last page" link
    // and the rel=next chain from advertising OFFSET ~334k URLs to crawlers, and
    // keeps it honest with the 404 that ?page=101 now returns.
    totalPages: Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / perPage))),
    filters,
  };
}

// ─── Facet counts ─────────────────────────────────────────────────────────
export interface FacetCounts {
  fleet: Record<FleetBucketId, number>;
  drivers: Record<DriversBucketId, number>;
  /** Per-equipment/cargo-type counts, keyed by EquipmentId (all FMCSA columns). */
  equipment: Record<EquipmentId, number>;
  /** Per-cargo-specialty counts, keyed by CargoId (all FMCSA crgo_* columns). */
  cargo: Record<CargoId, number>;
  /** Carriers in good standing (Satisfactory + Not-rated) — the toggle's badge. */
  goodStanding: number;
  /** Per-display-hub carrier counts, keyed by PortGroup code (member counts summed). */
  ports: Record<string, number>;
  authorityActive: number;
  intermodal: number;
  recent: number;
  /**
   * Set when the counts COULD NOT BE COMPUTED for this request (limiter queue
   * timeout, statement timeout, DB read failure) — the numeric fields are then
   * placeholders, NOT measurements.
   *
   * The degraded path used to return all-zero counts, which rendered a literal
   * "0" beside facets whose true count is non-zero — the UI asserting something
   * false. Serving the precomputed BASE counts instead would be wrong in the
   * other direction (they are the unfiltered global totals, far larger than a
   * city's). So consumers MUST omit the number entirely when this is set. See
   * facetOptionRow / portPickerRow in pages.ts.
   */
  unavailable?: true;
}

function emptyFacetCounts(): FacetCounts {
  return {
    fleet: { '1-25': 0, '26-100': 0, '101-500': 0, '500+': 0 },
    drivers: { '1-10': 0, '11-50': 0, '51-250': 0, '250+': 0 },
    equipment: { drayage: 0, dryvan: 0, reefer: 0, hazmat: 0, tanker: 0, flatbed: 0, drybulk: 0 },
    cargo: {
      household: 0,
      beverages: 0,
      produce: 0,
      motorvehicles: 0,
      livestock: 0,
      grainfeed: 0,
      oilfield: 0,
      meat: 0,
      paper: 0,
      construction: 0,
      farmsupplies: 0,
      coalcoke: 0,
      buildingmaterials: 0,
    },
    goodStanding: 0,
    ports: Object.fromEntries(PORT_GROUPS.map((g) => [g.code, 0])),
    authorityActive: 0,
    intermodal: 0,
    recent: 0,
  };
}

/** Bounded TTL cache for the global facet counts, keyed by the filter set.
 *  Filter combos are limited in practice, but a crafted query could vary them,
 *  so the Map is capped (oldest evicted) to prevent unbounded growth. */
const facetCountsCache = new Map<string, { at: number; val: FacetCounts }>();
/** In-flight refresh/cold-miss compute per filter key (single-flight). At most
 *  ONE recompute per key runs at a time; entries are always removed in a
 *  `finally` so nothing leaks. */
const facetCountsInflight = new Map<string, Promise<FacetCounts>>();

/**
 * Cache capacity, in distinct filter combinations.
 *
 * Raised from 200. The directory has ~54 state hubs, ~60 port hubs and a few
 * thousand real city hubs, all of which the sitemap advertises — so at 200 a
 * crawl pass evicted its own entries before they could ever be reused, and
 * nearly every request became a cold miss that had to take a limiter slot. That
 * cold-miss rate is what saturated the 2-slot semaphore in prod and produced the
 * "aggregate limiter queue wait exceeded 2000ms" degradations.
 *
 * A FacetCounts is ~110 small numbers in a handful of plain objects (the keys
 * are shared literals), so an entry costs single-digit KB; 1,500 entries is on
 * the order of 10 MB, which comfortably covers every state, every port and the
 * ~1,400 busiest cities. Eviction is unchanged (oldest insertion first).
 */
const FACET_COUNTS_CACHE_MAX = 1500;

/**
 * Stable key for a filter set — sorted keys so ordering can't produce distinct
 * strings for equivalent filters.
 *
 * Keyed on the CONDITION-CONTRIBUTING fields only. `sort`, `dir`, `page` and
 * `perPage` never add a WHERE condition (that is exactly what isUnfilteredFacets
 * relies on), so they cannot change a single count — yet including them in the
 * key made /directory/texas, ?page=2 and ?sort=fleet three separate entries with
 * identical values, tripling the cold-miss rate and the eviction pressure for
 * nothing. `equipment`/`cargo` are order-canonical arrays, so JSON.stringify
 * serializes them deterministically in place.
 */
export function facetCacheKey(filters: DirectoryFilters): string {
  const k: Omit<DirectoryFilters, 'sort' | 'dir' | 'page' | 'perPage'> = {
    state: filters.state,
    port: filters.port,
    citySlug: filters.citySlug,
    fleet: filters.fleet,
    drivers: filters.drivers,
    goodStandingOnly: filters.goodStandingOnly,
    authorityActive: filters.authorityActive,
    intermodal: filters.intermodal,
    equipment: filters.equipment,
    cargo: filters.cargo,
    recent: filters.recent,
    q: filters.q,
  };
  return JSON.stringify(k, Object.keys(k).sort());
}

/**
 * True when NO condition-contributing facet is active — i.e. the facet counts
 * equal the precomputed global BASE counts and can be served from the persisted
 * singleton row instead of scanning carrier_directory. Defined as "buildConditions
 * yields no WHERE clause" so it stays automatically in sync with the filter model
 * (sort / dir / page / perPage never add a condition, so a sort-only or paged
 * /directory URL is still the unfiltered base case). Exported for unit tests.
 */
export function isUnfilteredFacets(filters: DirectoryFilters): boolean {
  return buildConditions(filters).length === 0;
}

/**
 * Recompute the facet counts for one filter key and (on success) refresh + bound
 * the cache. Rejects on DB error, leaving any existing cache entry untouched
 * (stale value preserved, never poisoned). Always clears the in-flight slot for
 * this key in `finally` so no promise ever leaks and a later request can retry.
 * Never runs its `finally` synchronously — the awaited `...Unsafe()` is async, so
 * the caller has already registered this promise in `facetCountsInflight` before
 * the slot is cleared.
 */
async function refreshFacetCounts(filters: DirectoryFilters, key: string): Promise<FacetCounts> {
  try {
    // Gate the recompute through the shared limiter so a cold-cache burst of
    // DISTINCT filter keys can never open more than AGG_MAX_CONCURRENCY
    // aggregate transactions at once (the stampede that pinned the pool). The
    // REQUEST_AGG_BUDGET_MS total budget bounds the whole ~9-scan filtered facet
    // compute so it can never pin a connection for the ~25s that hung the page.
    // Request path: bound the QUEUE wait too, not just the scans — see
    // AGG_ACQUIRE_WAIT_MS. A rejection here is caught by getFacetCounts and
    // degrades to empty counts instead of holding the request open.
    const val = await aggregateLimiter.run(
      () => getFacetCountsUnsafe(filters, REQUEST_AGG_BUDGET_MS),
      AGG_ACQUIRE_WAIT_MS,
    );
    // Cache only a successfully computed value; an error must NOT poison the cache.
    // Evict the oldest entry (insertion order) once over the cap.
    facetCountsCache.set(key, { at: Date.now(), val });
    if (facetCountsCache.size > FACET_COUNTS_CACHE_MAX) {
      const oldest = facetCountsCache.keys().next().value;
      if (oldest !== undefined) facetCountsCache.delete(oldest);
    }
    return val;
  } finally {
    facetCountsInflight.delete(key);
  }
}

/**
 * Live per-value counts for the filter sidebar — cached per filter key with the
 * same stale-while-revalidate + single-flight discipline as getDirectorySummary.
 * A cached value (fresh OR stale) returns IMMEDIATELY; a stale one triggers ONE
 * background refresh per key (fire-and-forget, rejection caught, stale kept on
 * failure). Only a COLD MISS awaits, and concurrent callers for the same key
 * await the SAME single-flight promise, so only one set of scans runs.
 */
export async function getFacetCounts(filters: DirectoryFilters): Promise<FacetCounts> {
  // PERSISTED-FIRST for the UNFILTERED base case (the /directory index +
  // sort-only / page-only crawl URLs — the highest-traffic path and the stampede
  // source): when NO condition-contributing facet is active, buildConditions is
  // empty so the counts equal the precomputed global base facets. Serve them from
  // the singleton row (memory-shielded PK lookup) and skip the 330k-row scan
  // entirely. Any FILTERED combo keeps the live SWR path (capped by #409).
  if (isUnfilteredFacets(filters)) {
    const persisted = await loadPersistedAggregates();
    if (persisted) return persisted.baseFacets;
  }

  const key = facetCacheKey(filters);
  const cached = facetCountsCache.get(key);
  if (cached) {
    // Serve stale immediately; refresh in the background if expired.
    if (Date.now() - cached.at >= DIRECTORY_AGG_TTL_MS && !facetCountsInflight.has(key)) {
      const p = refreshFacetCounts(filters, key);
      facetCountsInflight.set(key, p);
      // Fire-and-forget: swallow rejection so a failed refresh keeps the stale
      // counts and never becomes an unhandled promise rejection.
      void p.catch((err) =>
        console.warn('[directory] getFacetCounts background refresh failed; keeping stale counts:', err),
      );
    }
    return cached.val;
  }
  // Cold miss — single-flight: first caller starts the compute, concurrent
  // callers for the same key await the same promise. Only the cold path awaits.
  let inflight = facetCountsInflight.get(key);
  if (!inflight) {
    inflight = refreshFacetCounts(filters, key);
    facetCountsInflight.set(key, inflight);
  }
  try {
    return await inflight;
  } catch (err) {
    // Read failure ⇒ degrade, never a 500. The in-flight slot was already cleared
    // in refreshFacetCounts's finally, so a later request retries.
    //
    // HONEST DEGRADATION: this returns counts FLAGGED `unavailable`, not zeros.
    // Zeros rendered as "0" next to facets whose real count is non-zero — the
    // page stating a falsehood. Flagged counts make the renderers omit the badge,
    // so the facet is still clickable and the filter still works; only the number
    // (which we genuinely do not have) is missing.
    console.warn('[directory] getFacetCounts failed; omitting counts (facets still usable):', err);
    return { ...emptyFacetCounts(), unavailable: true };
  }
}

/**
 * Pure recompute of the facet counts (no caching). Throws on any DB read failure
 * so the caller (refreshFacetCounts) can preserve the stale value / fall back to
 * empty counts and manage the single-flight slot. All the faceted-count query
 * logic is unchanged from #406 — only the cache-set + error swallowing moved out
 * to the SWR wrapper above.
 */
async function getFacetCountsUnsafe(filters: DirectoryFilters, budgetMs?: number): Promise<FacetCounts> {
  // Every scan runs inside ONE transaction. `arm()` re-arms statement_timeout to
  // the remaining budget before each scan, so on the REQUEST path (budgetMs set)
  // the SUM of these ~9 scans is bounded — not just each one — and the whole
  // compute can never pin a connection for the ~25s that took the page to 000.
  // A budget/scan timeout rejects and is absorbed by getFacetCounts' keep-stale /
  // serve-empty paths (the list still renders — the sidebar counts just degrade).
  // OFF-path (no budgetMs) keeps the per-statement-only 8s ceiling per scan.
  return withAggregateTimeout(async (tx, arm) => {
    const whereOf = (excl: string) => {
      const c = buildConditions(filters, new Set([excl]));
      return c.length ? and(...c) : undefined;
    };

    // Fleet buckets — one grouped scan.
    await arm();
    const fleetRows = await tx
      .select({
        bucket: sql<string>`case
          when ${carrierDirectory.powerUnits} between 1 and 25 then '1-25'
          when ${carrierDirectory.powerUnits} between 26 and 100 then '26-100'
          when ${carrierDirectory.powerUnits} between 101 and 500 then '101-500'
          when ${carrierDirectory.powerUnits} > 500 then '500+'
          else 'none' end`,
        n: sql<number>`count(*)::int`,
      })
      .from(carrierDirectory)
      .where(whereOf('fleet'))
      .groupBy(sql`1`);

    // Drivers buckets — one grouped scan (mirrors fleet).
    await arm();
    const driversRows = await tx
      .select({
        bucket: sql<string>`case
          when ${carrierDirectory.drivers} between 1 and 10 then '1-10'
          when ${carrierDirectory.drivers} between 11 and 50 then '11-50'
          when ${carrierDirectory.drivers} between 51 and 250 then '51-250'
          when ${carrierDirectory.drivers} > 250 then '250+'
          else 'none' end`,
        n: sql<number>`count(*)::int`,
      })
      .from(carrierDirectory)
      .where(whereOf('drivers'))
      .groupBy(sql`1`);

    // Equipment / cargo — one scan with a filtered count per FMCSA column. The
    // equipment dimension excludes ITSELF *and* the legacy intermodal predicate
    // (drayage maps onto the intermodal column) so each option's count is honest.
    const eqBase = buildConditions(filters, new Set(['equipment', 'intermodal']));
    const eqWhere = eqBase.length ? and(...eqBase) : undefined;
    await arm();
    const equipmentRows = await tx
      .select({
        drayage: sql<number>`count(*) filter (where ${carrierDirectory.intermodal})::int`,
        dryvan: sql<number>`count(*) filter (where ${carrierDirectory.dryVan})::int`,
        reefer: sql<number>`count(*) filter (where ${carrierDirectory.reefer})::int`,
        hazmat: sql<number>`count(*) filter (where ${carrierDirectory.hazmat})::int`,
        tanker: sql<number>`count(*) filter (where ${carrierDirectory.tanker})::int`,
        flatbed: sql<number>`count(*) filter (where ${carrierDirectory.flatbed})::int`,
        drybulk: sql<number>`count(*) filter (where ${carrierDirectory.dryBulk})::int`,
      })
      .from(carrierDirectory)
      .where(eqWhere);

    // Cargo specialties — one scan with a filtered count per FMCSA crgo_* column.
    // Excludes ITSELF so each option's count is honest faceted-search semantics.
    const cargoBase = buildConditions(filters, new Set(['cargo']));
    const cargoWhere = cargoBase.length ? and(...cargoBase) : undefined;
    await arm();
    const cargoRows = await tx
      .select({
        household: sql<number>`count(*) filter (where ${carrierDirectory.householdGoods})::int`,
        beverages: sql<number>`count(*) filter (where ${carrierDirectory.beverages})::int`,
        produce: sql<number>`count(*) filter (where ${carrierDirectory.produce})::int`,
        motorvehicles: sql<number>`count(*) filter (where ${carrierDirectory.motorVehicles})::int`,
        livestock: sql<number>`count(*) filter (where ${carrierDirectory.livestock})::int`,
        grainfeed: sql<number>`count(*) filter (where ${carrierDirectory.grainFeed})::int`,
        oilfield: sql<number>`count(*) filter (where ${carrierDirectory.oilfield})::int`,
        meat: sql<number>`count(*) filter (where ${carrierDirectory.meat})::int`,
        paper: sql<number>`count(*) filter (where ${carrierDirectory.paper})::int`,
        construction: sql<number>`count(*) filter (where ${carrierDirectory.construction})::int`,
        farmsupplies: sql<number>`count(*) filter (where ${carrierDirectory.farmSupplies})::int`,
        coalcoke: sql<number>`count(*) filter (where ${carrierDirectory.coalCoke})::int`,
        buildingmaterials: sql<number>`count(*) filter (where ${carrierDirectory.buildingMaterials})::int`,
      })
      .from(carrierDirectory)
      .where(cargoWhere);

    // Ports & terminals — one grouped scan on the stored nearest_port_code, with
    // the port dimension self-excluded. Member counts are folded into their
    // DISPLAY group below (co-located ports sum into one hub).
    await arm();
    const portRows = await tx
      .select({ code: carrierDirectory.nearestPortCode, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(whereOf('port'))
      .groupBy(carrierDirectory.nearestPortCode);

    // Good-standing count — self-excluded so the toggle badge reads honestly.
    await arm();
    const goodRow = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(and(...buildConditions(filters, new Set(['standing'])), goodStandingCondition()));

    await arm();
    const [authRow, imRow, recentRow] = await Promise.all([
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(carrierDirectory)
        .where(
          and(
            ...buildConditions(filters, new Set(['authority'])),
            isNotNull(carrierDirectory.authorityType),
            ne(carrierDirectory.authorityType, ''),
          ),
        ),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(carrierDirectory)
        .where(and(...buildConditions(filters, new Set(['equipment', 'intermodal'])), eq(carrierDirectory.intermodal, true))),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(carrierDirectory)
        .where(and(...buildConditions(filters, new Set(['recent'])), gte(carrierDirectory.updatedAt, recentCutoff()))),
    ]);

    const out = emptyFacetCounts();
    for (const r of fleetRows) if (r.bucket in out.fleet) out.fleet[r.bucket as FleetBucketId] = r.n;
    for (const r of driversRows) if (r.bucket in out.drivers) out.drivers[r.bucket as DriversBucketId] = r.n;
    const eqCounts = equipmentRows[0];
    if (eqCounts) {
      out.equipment = {
        drayage: eqCounts.drayage ?? 0,
        dryvan: eqCounts.dryvan ?? 0,
        reefer: eqCounts.reefer ?? 0,
        hazmat: eqCounts.hazmat ?? 0,
        tanker: eqCounts.tanker ?? 0,
        flatbed: eqCounts.flatbed ?? 0,
        drybulk: eqCounts.drybulk ?? 0,
      };
    }
    const cargoCounts = cargoRows[0];
    if (cargoCounts) {
      out.cargo = {
        household: cargoCounts.household ?? 0,
        beverages: cargoCounts.beverages ?? 0,
        produce: cargoCounts.produce ?? 0,
        motorvehicles: cargoCounts.motorvehicles ?? 0,
        livestock: cargoCounts.livestock ?? 0,
        grainfeed: cargoCounts.grainfeed ?? 0,
        oilfield: cargoCounts.oilfield ?? 0,
        meat: cargoCounts.meat ?? 0,
        paper: cargoCounts.paper ?? 0,
        construction: cargoCounts.construction ?? 0,
        farmsupplies: cargoCounts.farmsupplies ?? 0,
        coalcoke: cargoCounts.coalcoke ?? 0,
        buildingmaterials: cargoCounts.buildingmaterials ?? 0,
      };
    }
    // Fold per-member port counts into their DISPLAY group (LA + Long Beach → one).
    for (const r of portRows) {
      const g = r.code ? portGroupForMemberCode(r.code) : null;
      if (g) out.ports[g.code] = (out.ports[g.code] ?? 0) + r.n;
    }
    out.goodStanding = goodRow[0]?.n ?? 0;
    out.authorityActive = authRow[0]?.n ?? 0;
    out.intermodal = imRow[0]?.n ?? 0;
    out.recent = recentRow[0]?.n ?? 0;
    return out;
  });
}

// ─── City tier ────────────────────────────────────────────────────────────
export interface CityCount {
  city: string;
  slug: string;
  count: number;
}

/** Top cities in a state by carrier count (for the "cities in {state}" module). */
export async function citiesForState(stateCode: string, limit = 30): Promise<CityCount[]> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const rows = await db()
      .select({ city: carrierDirectory.city, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(and(eq(carrierDirectory.state, code), isNotNull(carrierDirectory.city), ne(carrierDirectory.city, '')))
      .groupBy(carrierDirectory.city)
      .orderBy(sql`count(*) desc`)
      .limit(Math.min(200, Math.max(1, limit)));
    // Collapse case/spacing variants of the same city onto one slug.
    const bySlug = new Map<string, CityCount>();
    for (const r of rows) {
      const name = (r.city ?? '').trim();
      if (!name) continue;
      const slug = citySlugify(name);
      if (!slug) continue;
      const cur = bySlug.get(slug);
      if (cur) cur.count += r.n;
      else bySlug.set(slug, { city: titleCaseCity(name), slug, count: r.n });
    }
    return [...bySlug.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  } catch (err) {
    console.warn('[directory] citiesForState failed; serving no cities:', err);
    return [];
  }
}

/**
 * EVERY city hub in a state, alphabetical — the data behind /directory/{state}/cities.
 *
 * WHY THIS EXISTS (measured, 2026-08-29): sitemap-cities.xml advertises all
 * 24,728 US city hubs, but the only internal links to city hubs came from
 * `citiesForState(state, 24)` on the state and city pages. That is 54 x 24 =
 * 1,296 linked hubs — so ~23,400 city hubs (95%) had ZERO internal inbound links
 * and existed only in an XML file. Because a city hub is the ONLY path to the 24
 * carriers on its first page, orphaning the hub orphaned its carriers too: the
 * transitive closure of the link graph from `/` reached just ~32,600 of 330,218
 * carrier profiles (9.2%). Google's answer was exactly what you would expect —
 * "Discovered – currently not indexed", lastCrawl NEVER, on the other 91%.
 *
 * `citiesForState` cannot serve this: it hard-caps at 200 rows, and it orders by
 * carrier count (right for a "top cities" module, wrong for a complete index).
 *
 * COST: one GROUP BY over a single state, served by the (state, city) prefix of
 * carrier_directory_state_city_power_idx as an index-only scan — the same access
 * path citiesForState already uses, without the LIMIT. The largest state returns
 * a few thousand short rows, and the route caches like every other public
 * directory page.
 */
export async function allCitiesForState(stateCode: string): Promise<CityCount[]> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const rows = await db()
      .select({ city: carrierDirectory.city, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(and(eq(carrierDirectory.state, code), isNotNull(carrierDirectory.city), ne(carrierDirectory.city, '')))
      .groupBy(carrierDirectory.city);
    // Collapse case/spacing variants of the same city onto one slug, exactly as
    // citiesForState does — the slug is what the hub URL is keyed on, so two
    // spellings of one city must not become two index entries.
    const bySlug = new Map<string, CityCount>();
    for (const r of rows) {
      const name = (r.city ?? '').trim();
      if (!name) continue;
      const slug = citySlugify(name);
      if (!slug) continue;
      const cur = bySlug.get(slug);
      if (cur) cur.count += r.n;
      else bySlug.set(slug, { city: titleCaseCity(name), slug, count: r.n });
    }
    // Alphabetical: an INDEX is for enumeration, so a stable A→Z order is what
    // makes it usable by a person and predictable for a crawler paging through it.
    return [...bySlug.values()].sort((a, b) => a.city.localeCompare(b.city));
  } catch (err) {
    console.warn('[directory] allCitiesForState failed; serving no cities:', err);
    return [];
  }
}

/** Resolve a city's display name (best-effort title case) from its rows. */
export async function cityDisplayName(stateCode: string, citySlug: string): Promise<string | null> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const rows = await db()
      .select({ city: carrierDirectory.city })
      .from(carrierDirectory)
      .where(and(eq(carrierDirectory.state, code), cityCondition(citySlug)))
      .limit(1);
    const raw = rows[0]?.city?.trim();
    return raw ? titleCaseCity(raw) : null;
  } catch {
    return null;
  }
}

/** Best-effort Title Case for an ALL-CAPS FMCSA city string. */
export function titleCaseCity(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Of|And|The)\b/g, (m) => m.toLowerCase())
    .replace(/^./, (m) => m.toUpperCase());
}

/** Carriers in one city of one state (faceted, paginated). */
export async function carriersByCity(
  stateCode: string,
  citySlug: string,
  filters: DirectoryFilters,
): Promise<CarrierListResult> {
  const scoped: DirectoryFilters = {
    ...filters,
    state: String(stateCode).toUpperCase().slice(0, 2),
    citySlug: citySlugify(citySlug),
    port: null,
  };
  return listCarriers({ filters: scoped, perPage: filters.perPage });
}

// ─── Related carriers — the RING MESH (profile cross-links) ───────────────
//
// WHAT THIS REPLACED, and why it had to change (measured on prod 2026-08-30).
//
// The previous implementation took the same deterministic `featured` TOP-6 of
// the carrier's city for every carrier in that city, topped up with the state's
// top-6. That is a STAR, not a mesh: the link target set does not depend on who
// is linking, so every one of Houston's 3,511 profiles linked to the same six
// carriers. Census over all 330,452 rows:
//
//   distinct carriers receiving ANY profile→profile link      97,287  (29.4%)
//   carriers receiving NONE                                  241,428  (73.1%)
//   most inbound links to a single carrier                     3,510
//   p99 / p99.9 inbound                                        89 / 467
//
// #455 already fixed REACHABILITY (a crawler can now walk to ~100% of carriers
// through /directory/{state}/cities + {hub}/page/N). This fixes EQUITY: 73% of
// profiles were terminal leaves that no other profile pointed at, so the link
// value the hubs pass down pooled on a 29% subset and never circulated.
//
// THE MESH. Put every carrier on a RING and hand each one the K carriers that
// follow it. Define one total order over the table:
//
//   intermodal DESC, coalesce(power_units, 0) DESC, usdot DESC
//
// and, for the carrier at ring position p, link to positions p+1 … p+K, wrapping
// past the end back to the start. Out-degree K, in-degree K, for EVERY member:
// the set that links to p is exactly p-1 … p-K. Nothing pools, because the
// window is a function of the linker, not a fixed top-N.
//
// WHY THAT ORDER IS ALSO GOOD FOR A HUMAN (the SEO value follows from this, not
// the other way round). Ring neighbours are near-identical on the two things a
// shipper compares carriers by: drayage capability (intermodal leads, so the
// 18,977 drayage carriers cluster and cross-link to each other) and fleet size
// (`power_units` is the second key). So "other carriers in Houston, TX" is a
// list of directly comparable alternatives at your scale, not the six biggest
// fleets in the city that a small shipper has no use for. `usdot` is only the
// tie-break that makes the order total; it is a public, already-rendered field,
// which is why it is used instead of the internal `id` (VisibleCarrier
// deliberately drops internal ids).
//
// TWO RINGS, NOT ONE. A city ring alone leaves the 8,251 carriers that are the
// ONLY carrier in their city with nobody to link to or be linked from, so every
// profile also joins a CORRIDOR ring — its `nearest_port_code` group (57 groups,
// covering 319,878 of 330,452 carriers), or, for the 10,574 with no port, the
// no-port carriers of its own state. Every member of a ring queries that ring,
// so both are DENSE: minimum in-degree is 2 (a node's two immediate predecessors
// always reach it, because the smallest window any carrier emits is 2).
// The corridor ring is also what keeps the profile graph from decomposing into
// 26,231 disconnected city cycles — it is the cross-city shortcut, and "carriers
// near the Port of Houston" is a real thing a drayage shipper searches for.
//
// MEASURED AFTER, modelled over the same 330,452 rows:
//
//   distinct carriers receiving a profile→profile link      330,451 (100.00%)
//   carriers receiving none                                       1  (the only
//     carrier in Guam — its city, its state and its no-port group each hold
//     exactly one row, so there is nothing for it to link to; irreducible)
//   most inbound links to a single carrier                         9  (was 3,510)
//   p50 / p99 / p99.9 inbound                                  6 / 7 / 8
//   out-degree exactly 6                                    330,447 of 330,452
//   share of rendered links that are same-city                  47.7%
//
// COST. The link COUNT is unchanged at 6, and #455's ~60% cut in directory crawl
// bytes is not given back: rendered through renderCarrierProfile over 120 real
// carriers, 44,826 bytes/page before → 44,713 after, i.e. -114 bytes (-0.25%).
// The extra section heading is more than paid for by the cards themselves — the
// star always pointed at the largest fleets in the city, which carry the longest
// names and the most equipment pills, while ring neighbours are same-scale peers.
// Raising the count would buy no coverage anyway: in a ring in-degree EQUALS
// out-degree, so 6 already reaches every carrier and more would only be bytes on
// ~330k crawled pages. Both ring queries are pure index seeks on the 0071
// indexes, and the city seek is CHEAPER than the star query it replaces (total
// cost 8.44 vs 32.39, 7 buffers vs 20 — see drizzle/0071_carrier_ring_indexes.sql).
// One round trip (2 statements) for 82.3% of profiles and two (4 statements) for
// the 17.7% that sit at the tail of a ring or in a city smaller than its slot
// count; the star was 1-2 statements over the same 14.9%/85.1% split.

/** Profile slots filled from the carrier's own city ring.
 *  3 + 3 is a LAYOUT constraint as much as a graph one: the related grid resolves
 *  to three columns at desktop width, so each section renders as one full row and
 *  never strands a single card alone on a line (a 4 + 2 split wraps 3 + 1). It is
 *  also the same visual density as the single six-card grid this replaced. */
export const RELATED_CITY_SLOTS = 3;
/** Profile slots filled from the corridor (nearest-port, else no-port state) ring. */
export const RELATED_NEARBY_SLOTS = 3;
/** Related links rendered per profile. Unchanged from the pre-mesh star: in a
 *  ring, in-degree = out-degree, so every carrier is already covered at 6 and a
 *  higher count would only add bytes to ~330k crawled pages. */
export const RELATED_LIMIT = RELATED_CITY_SLOTS + RELATED_NEARBY_SLOTS;

/** The carrier's own position on the ring — the seek key, nothing more. */
interface RingAnchor {
  intermodal: boolean;
  powerUnits: number;
  usdot: string;
}

/**
 * The ring's total order. MUST stay identical to the trailing key columns of the
 * 0071 `*_ring_idx` indexes (`"intermodal" DESC, (COALESCE("power_units", 0))
 * DESC, "usdot" DESC`) or every ring query silently degrades to a full scan of
 * its group + a sort — the exact failure 0068 documents for the city slug.
 */
export function ringOrder(): SQL[] {
  return [
    sql`${carrierDirectory.intermodal} desc`,
    sql`coalesce(${carrierDirectory.powerUnits}, 0) desc`,
    sql`${carrierDirectory.usdot} desc`,
  ];
}

/**
 * "Strictly after `anchor` on the ring", as a ROW-WISE comparison.
 *
 * Row-wise (rather than the equivalent OR-chain) is deliberate: Postgres turns
 * `ROW(a,b,c) < ROW(x,y,z)` into a single multi-column btree Index Cond, so the
 * whole window is one seek. Verified on a byte-identical 330,452-row copy of
 * prod — `Index Cond: (... AND (ROW(intermodal, COALESCE(power_units, 0), usdot)
 * < ROW(...)))`, no Filter, no Sort.
 *
 * Every key is NULL-free by construction (`intermodal` and `usdot` are NOT NULL;
 * `power_units` is coalesced), which is what makes the row comparison total —
 * a NULL operand would make it return NULL and drop the row from the ring.
 */
function ringAfter(anchor: RingAnchor): SQL {
  return sql`(${carrierDirectory.intermodal}, coalesce(${carrierDirectory.powerUnits}, 0), ${carrierDirectory.usdot}) < (${anchor.intermodal}, ${anchor.powerUnits}, ${anchor.usdot})`;
}

/** The K carriers following `anchor` inside `scope`. */
function ringWindow(scope: SQL, anchor: RingAnchor, n: number) {
  return db()
    .select()
    .from(carrierDirectory)
    .where(and(scope, ringAfter(anchor)))
    .orderBy(...ringOrder())
    .limit(n);
}

/** The head of `scope`'s ring — what the window wraps around to. */
function ringHead(scope: SQL, n: number) {
  return db().select().from(carrierDirectory).where(scope).orderBy(...ringOrder()).limit(n);
}

/**
 * Other carriers to surface on a profile — the city ring first, then the
 * corridor ring. Self excluded, deduped, deterministic (so the ~330k profile
 * pages stay byte-identical per URL and shared-cacheable). Never throws.
 */
export async function relatedCarriers(carrier: VisibleCarrier, limit = RELATED_LIMIT): Promise<VisibleCarrier[]> {
  if (!carrier.state || limit < 1) return [];
  const state = carrier.state.toUpperCase().slice(0, 2);
  const citySlug = carrier.city ? citySlugify(carrier.city) : '';
  const anchor: RingAnchor = {
    intermodal: carrier.intermodal,
    powerUnits: carrier.powerUnits ?? 0,
    usdot: carrier.usdot,
  };
  // The city ring: same state + same city slug. Null when the FMCSA row has no
  // usable city, in which case the corridor ring takes every slot.
  const cityScope: SQL | null = citySlug
    ? (and(eq(carrierDirectory.state, state), cityCondition(citySlug)) as SQL)
    : null;
  // The corridor ring: the nearest-port group, or — for the carriers FMCSA
  // places nowhere near a port — the no-port carriers of the same state. The
  // `IS NULL` arm is a scope, not a fallback filter: it makes the ring's members
  // exactly the carriers that QUERY it, which is what keeps it dense.
  const nearbyScope: SQL = carrier.nearestPortCode
    ? (eq(carrierDirectory.nearestPortCode, carrier.nearestPortCode) as SQL)
    : (and(eq(carrierDirectory.state, state), isNull(carrierDirectory.nearestPortCode)) as SQL);

  const citySlots = Math.min(RELATED_CITY_SLOTS, limit);

  type Row = typeof carrierDirectory.$inferSelect;
  /**
   * Deterministically pick the profile's list from whatever ring rows we hold.
   * Pure, and re-run from scratch after the wrap fetch so the result never
   * depends on how many round trips it took to get the rows.
   */
  const assemble = (cityPool: Row[], nearbyPool: Row[]) => {
    const seen = new Set<string>([carrier.slug]);
    const city: VisibleCarrier[] = [];
    const nearby: VisibleCarrier[] = [];
    const fill = (into: VisibleCarrier[], rows: Row[], want: number) => {
      for (const r of rows) {
        if (into.length >= want) break;
        if (seen.has(r.publicSlug)) continue;
        seen.add(r.publicSlug);
        into.push(visibleCarrier(r));
      }
    };
    fill(city, cityPool, citySlots);
    fill(nearby, nearbyPool, limit - city.length);
    // A corridor ring too small to fill its slots hands them back to the city,
    // so a profile is never rendered with fewer links than the data allows.
    fill(city, cityPool, limit - nearby.length);
    return { city, nearby };
  };

  try {
    // ONE round trip for the common case. Both legs over-fetch to `limit + 1` —
    // the same index seek either way — so whichever ring is short (a one-carrier
    // city, a state with no other no-port carriers) the other can cover the
    // whole profile instead of leaving a stub.
    const [cityFwd, nearbyFwd] = await Promise.all([
      cityScope ? ringWindow(cityScope, anchor, limit + 1) : Promise.resolve([] as Row[]),
      ringWindow(nearbyScope, anchor, limit + 1),
    ]);
    let picked = assemble(cityFwd, nearbyFwd);

    // Second round trip ONLY for the 17.7% of profiles sitting at the tail of a
    // ring (or in a city smaller than its slot count): wrap past the end back to
    // the head. The wrap is what makes in-degree equal out-degree — without it,
    // the carriers at the HEAD of each ring would receive nothing.
    const cityShort = cityScope != null && picked.city.length < citySlots;
    const nearbyShort = picked.city.length + picked.nearby.length < limit;
    if (cityShort || nearbyShort) {
      const [cityWrap, nearbyWrap] = await Promise.all([
        cityShort && cityScope ? ringHead(cityScope, limit + 1) : Promise.resolve([] as Row[]),
        nearbyShort ? ringHead(nearbyScope, limit + 1) : Promise.resolve([] as Row[]),
      ]);
      picked = assemble([...cityFwd, ...cityWrap], [...nearbyFwd, ...nearbyWrap]);
    }
    return [...picked.city, ...picked.nearby].slice(0, limit);
  } catch (err) {
    console.warn('[directory] relatedCarriers failed; serving none:', err);
    return [];
  }
}

// ─── Hero social-proof carriers (homepage) ────────────────────────────────
//
// Feeds the homepage hero's directory-preview cards with REAL, varied carriers
// (live social proof + free advertising for listed carriers) instead of the
// hardcoded fictional demo cards. Every load re-queries with ORDER BY random()
// so the featured set rotates. The projection is deliberately tiny and
// contact-free (name / ids / equipment badges / location + the public slug) —
// no phone, email, or internal id ever leaves this layer.

/** One equipment/standing badge on a hero card. `muted` = the quiet grey chip. */
export interface HeroCarrierChip {
  label: string;
  muted?: boolean;
}

/** Safe, render-ready projection of one carrier for a hero preview card. */
export interface HeroCarrierCard {
  /** publicSlug → links to /directory/carrier/<slug>. */
  slug: string;
  /** Display name (DBA when meaningful, else legal name). */
  name: string;
  /** Public FMCSA identifiers, pre-formatted ("USDOT 123456 · MC 654321"). */
  ids: string;
  /** Up to ~2 equipment badges + an optional muted "Satisfactory" chip. */
  chips: HeroCarrierChip[];
  /** Location line label ("Nearest port" | "Based in") or null when unknown. */
  locLabel: string | null;
  /** Location line value (port city or "City, ST") or null when unknown. */
  locValue: string | null;
}

/** Default hero card count fetched (client renders the first few). */
export const HERO_CARRIER_LIMIT = 8;

/** Display name for a hero card — mirrors pages.ts `carrierName` (DBA-preferred,
 *  falling back to the legal name when the DBA is too short to identify). Kept
 *  local to avoid a queries→pages import cycle. */
function heroDisplayName(legalName: string, dbaName: string | null): string {
  const dba = (dbaName ?? '').trim();
  if (dba && (dba.includes(' ') || dba.length >= 8)) return dba;
  return legalName;
}

/**
 * carrier_directory WHERE predicates for a display-worthy hero carrier
 * (exported for query-shape unit tests). Good standing (keep Satisfactory +
 * unrated, drop Conditional/Unsatisfactory), contact NOT opted out, a real
 * city/state, an actual fleet (a headline stat), US domicile. AND-ed by the
 * caller. The `carrier_overrides.hidden` exclusion is applied in getHeroCarriers
 * (it needs the LEFT JOIN) so this stays a pure single-table predicate list.
 */
export function heroCarrierConditions(): SQL[] {
  return [
    goodStandingCondition(),
    eq(carrierDirectory.contactHidden, false),
    isNotNull(carrierDirectory.city),
    ne(carrierDirectory.city, ''),
    isNotNull(carrierDirectory.state),
    ne(carrierDirectory.state, ''),
    gt(carrierDirectory.powerUnits, 0),
    eq(carrierDirectory.country, 'US'),
  ];
}

/**
 * ORDER BY for the hero POOL fetch — the primary key, so Postgres walks
 * carrier_directory_pkey and stops at LIMIT.
 *
 * This deliberately replaced `ORDER BY random()`. That sorted the ENTIRE
 * qualifying set to take 8 rows, on EVERY homepage load (hero-carriers.js
 * fetches /api/directory/hero-carriers on DOMContentLoaded, and the route sets
 * `no-store`). Measured on prod with EXPLAIN:
 *
 *   ORDER BY random() LIMIT 8      Seq Scan 314,554 rows + Sort → cost 24,727.62
 *   id >= $rand ORDER BY id LIMIT 240   Index Scan, no sort     → cost    146.09
 *
 * The "varied" feel is preserved WITHOUT the sort, in two layers: the pool
 * starts at a RANDOM id offset (so the window moves), and getHeroCarriers
 * shuffles n cards out of the pool per call (so two loads inside one TTL still
 * differ). See getHeroCarriers.
 */
export function heroCarrierOrder(): SQL[] {
  return [asc(carrierDirectory.id)];
}

/** Equipment/standing badges for a hero card, derived from the FMCSA flags. */
function heroChips(r: typeof carrierDirectory.$inferSelect): HeroCarrierChip[] {
  const chips: HeroCarrierChip[] = [];
  const equip: ReadonlyArray<[boolean, string]> = [
    [r.intermodal, 'Drayage'],
    [r.reefer, 'Reefer'],
    [r.flatbed, 'Flatbed'],
    [r.tanker, 'Tanker'],
    [r.dryVan, 'Dry van'],
    [r.dryBulk, 'Dry bulk'],
    [r.hazmat, 'Hazmat'],
  ];
  for (const [on, label] of equip) {
    if (on && chips.length < 2) chips.push({ label });
  }
  // No FMCSA equipment flag set yet (rows pre-backfill) → one honest fallback.
  if (chips.length === 0) chips.push({ label: 'Motor carrier' });
  if (String(r.safetyRating ?? '').toUpperCase() === 'S') chips.push({ label: 'Satisfactory', muted: true });
  return chips;
}

/** Location line for a hero card: nearest port when known, else "City, ST". */
function heroLocation(r: typeof carrierDirectory.$inferSelect): { locLabel: string | null; locValue: string | null } {
  const g = r.nearestPortCode ? portGroupForMemberCode(r.nearestPortCode) : null;
  if (g) return { locLabel: 'Nearest port', locValue: g.city || g.label };
  if (r.city && r.state) return { locLabel: 'Based in', locValue: `${titleCaseCity(r.city)}, ${r.state}` };
  return { locLabel: null, locValue: null };
}

/**
 * Shape one carrier row into the safe hero-card projection (PURE — unit-tested).
 * Emits ONLY public, contact-free fields; internal ids, phone + email never
 * appear. USDOT/MC are public FMCSA identifiers already shown across the
 * directory, so they are safe to surface here.
 */
export function heroCarrierCard(r: typeof carrierDirectory.$inferSelect): HeroCarrierCard {
  // Mirror the directory's own id rendering (`MC ${mcNumber}`) — mcNumber is
  // stored as the bare docket number, prefixed with "MC " for display.
  const mc = String(r.mcNumber ?? '').trim();
  const ids = mc ? `USDOT ${r.usdot} · MC ${mc}` : `USDOT ${r.usdot}`;
  const { locLabel, locValue } = heroLocation(r);
  return {
    slug: r.publicSlug,
    name: heroDisplayName(r.legalName, r.dbaName),
    ids,
    chips: heroChips(r),
    locLabel,
    locValue,
  };
}

/** How many rows one pool fetch pulls. Big enough that shuffling n=8 out of it
 *  looks different every load, small enough that the fetch stays an index walk. */
export const HERO_POOL_SIZE = 240;

/** How long one pool is reused. The pool re-fetches from a NEW random id offset
 *  after this, so the visible set drifts across the whole table over time. */
export const HERO_POOL_TTL_MS = 5 * 60_000;

/** max(id) is an index-only scan (cost 0.47) but there is no reason to pay it
 *  per pool refresh — ids only grow, and a slightly stale ceiling just biases
 *  the random offset a hair low, which is harmless. */
const HERO_MAX_ID_TTL_MS = 60 * 60_000;

let heroPoolCache: { cards: HeroCarrierCard[]; at: number } | null = null;
let heroPoolInFlight: Promise<HeroCarrierCard[]> | null = null;
let heroMaxIdCache: { value: number; at: number } | null = null;

/** Drop the memoized hero pool + id ceiling. Test seam only. */
export function resetHeroCarrierCache(): void {
  heroPoolCache = null;
  heroPoolInFlight = null;
  heroMaxIdCache = null;
}

/**
 * Pick `n` distinct items uniformly at random. Partial Fisher–Yates on a COPY,
 * so it is O(n) and never mutates the cached pool. PURE — unit-tested.
 */
export function sampleCards<T>(pool: readonly T[], n: number): T[] {
  const take = Math.min(n, pool.length);
  const copy = pool.slice();
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, take);
}

/** Largest carrier_directory id, memoized. `max(id)` on the PK is an Index Only
 *  Scan Backward (prod cost 0.47), never a scan. 0 when the table is empty. */
async function heroMaxId(): Promise<number> {
  const now = Date.now();
  if (heroMaxIdCache && now - heroMaxIdCache.at < HERO_MAX_ID_TTL_MS) return heroMaxIdCache.value;
  const row = await db().select({ n: sql<number | null>`max(${carrierDirectory.id})` }).from(carrierDirectory);
  const value = Math.max(0, Number(row[0]?.n ?? 0) || 0);
  heroMaxIdCache = { value, at: now };
  return value;
}

/** One pool fetch: an index walk from a random id offset. */
async function heroPoolFrom(fromId: number): Promise<HeroCarrierCard[]> {
  const rows = await db()
    .select()
    .from(carrierDirectory)
    .leftJoin(carrierOverrides, eq(carrierOverrides.usdot, carrierDirectory.usdot))
    .where(
      and(
        ...heroCarrierConditions(),
        // Honor an admin "hidden" override (kept out even though the hero shows
        // no contact) — surviving-the-ingest hide flag on carrier_overrides.
        or(isNull(carrierOverrides.hidden), ne(carrierOverrides.hidden, true)) as SQL,
        gte(carrierDirectory.id, fromId),
      ),
    )
    .orderBy(...heroCarrierOrder())
    .limit(HERO_POOL_SIZE);
  return rows.map((row) => heroCarrierCard(row.carrier_directory));
}

/** Fetch a fresh pool, wrapping to the start of the table when the random
 *  offset landed too close to the end to fill it. `serial` ids are NOT dense
 *  (the ingest upserts on usdot, so conflicts burn sequence values), which is
 *  exactly why this samples a WINDOW rather than probing for a single id. */
async function fetchHeroPool(): Promise<HeroCarrierCard[]> {
  const maxId = await heroMaxId();
  const fromId = maxId > 0 ? Math.floor(Math.random() * maxId) : 0;
  const cards = await heroPoolFrom(fromId);
  if (cards.length >= HERO_POOL_SIZE || fromId === 0) return cards;
  return heroPoolFrom(0);
}

/**
 * Varied set of display-worthy real carriers for the homepage hero preview.
 *
 * Served from a memoized POOL (single-flighted, so a homepage traffic burst on a
 * cold cache makes ONE DB round-trip, not N) and shuffled per call, so the cards
 * still change between loads without the old full-table `ORDER BY random()` sort
 * on the hot path. Degrades to an empty array on any read failure — the client
 * keeps its static fallback cards, never a broken hero.
 */
export async function getHeroCarriers(limit = HERO_CARRIER_LIMIT): Promise<HeroCarrierCard[]> {
  const n = Math.min(12, Math.max(1, Math.floor(limit) || HERO_CARRIER_LIMIT));
  try {
    const now = Date.now();
    if (!heroPoolCache || now - heroPoolCache.at >= HERO_POOL_TTL_MS) {
      if (!heroPoolInFlight) {
        // The catch lives INSIDE the shared promise: a background refresh that
        // nobody awaits must never surface as an unhandled rejection (that is a
        // process-killer on this server — see crashProofBoot).
        heroPoolInFlight = fetchHeroPool()
          .then((cards) => {
            heroPoolCache = { cards, at: Date.now() };
            return cards;
          })
          .catch((err) => {
            console.warn('[directory] hero pool refresh failed; keeping previous pool:', err);
            return heroPoolCache?.cards ?? [];
          })
          .finally(() => {
            heroPoolInFlight = null;
          });
      }
      // A stale pool is better than a stalled homepage: only WAIT on the refetch
      // when there is nothing at all to serve.
      if (!heroPoolCache) await heroPoolInFlight;
    }
    return sampleCards(heroPoolCache?.cards ?? [], n);
  } catch (err) {
    console.warn('[directory] getHeroCarriers failed; serving none:', err);
    return [];
  }
}

/** Count carriers in the same city as a carrier (for a count-bearing link). */
export async function cityCarrierCount(stateCode: string, citySlug: string): Promise<number> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const row = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(and(eq(carrierDirectory.state, code), cityCondition(citySlug)));
    return row[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Count carriers in a state (for a count-bearing profile back-link). */
export async function stateCarrierCount(stateCode: string): Promise<number> {
  const code = String(stateCode).toUpperCase().slice(0, 2);
  try {
    const row = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(eq(carrierDirectory.state, code));
    return row[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Look up a single carrier by its public slug (for the profile page), MERGING
 * any `carrier_overrides` row on top (LEFT JOIN by usdot). This is the only
 * query that applies overrides — the list/card queries stay FMCSA-only. A
 * missing `carrier_overrides` table (never migrated) still LEFT JOINs to NULL
 * overrides, so the profile degrades to the pure FMCSA card, never a 500.
 */
export async function carrierBySlug(slug: string): Promise<VisibleCarrier | null> {
  try {
    const rows = await db()
      .select()
      .from(carrierDirectory)
      .leftJoin(carrierOverrides, eq(carrierOverrides.usdot, carrierDirectory.usdot))
      .where(eq(carrierDirectory.publicSlug, slug))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mergeCarrierOverride(visibleCarrier(row.carrier_directory), row.carrier_overrides);
  } catch (err) {
    // Missing table / read failure ⇒ treated as "not found" (404), never a 500.
    console.warn('[directory] carrierBySlug failed; treating as not found:', err);
    return null;
  }
}

// ─── Carrier self-service lookup ("Find your company" autofill) ─────────────
//
// Backs the authed setup convenience where a carrier finds THEIR OWN FMCSA
// record (by USDOT, MC #, or company name) and prefills their calculator-widget
// company details. Deliberately SLIM: only the handful of fields those inputs
// need — no fleet/equipment/safety payload. Contact fields respect the carrier
// opt-out: this feature PULLS contact data, so it merges carrier_overrides on
// top (via mergeCarrierOverride, exactly like the carrierBySlug profile path)
// and nulls phone/email when EITHER the base contact_hidden column OR the
// carrier_overrides.hidden opt-out is set — not just the base column.

/** Slim projection returned by carrierLookup — one row per matched carrier. */
export interface CarrierLookupResult {
  usdot: string;
  mcNumber: string | null;
  legalName: string;
  dbaName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface CarrierLookupParams {
  q?: unknown;
  dot?: unknown;
  mc?: unknown;
}

/** Max name-search rows returned to the typeahead. */
export const CARRIER_LOOKUP_LIMIT = 8;

/**
 * Normalize a raw USDOT value to the stored form (digits only, leading zeros
 * stripped — same normalization carrier_directory.usdot is ingested with). Null
 * when there is no digit. Pure + total. Exported for unit tests.
 */
export function normalizeUsdotQuery(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits.length ? digits : null;
}

/**
 * Normalize a raw MC/docket value to bare digits with leading zeros stripped, so
 * a user typing "12892", "MC12892", "MC-012892" or "012892" all reduce to the
 * same key. The DB stores mc_number verbatim ("MC012892"), so the match strips
 * MC's non-digits + leading zeros on the column side too (see carrierLookup).
 * Null when there is no digit. Pure + total. Exported for unit tests.
 */
export function normalizeMcQuery(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits.length ? digits : null;
}

/** Shape a VisibleCarrier into the slim lookup result, enforcing the contact
 *  opt-out (contactHidden ⇒ phone + email nulled) so a hidden carrier's contact
 *  never leaks through the prefill. */
function toLookupResult(v: VisibleCarrier): CarrierLookupResult {
  return {
    usdot: v.usdot,
    mcNumber: v.mcNumber,
    legalName: v.legalName,
    dbaName: v.dbaName,
    phone: v.contactHidden ? null : v.phone,
    email: v.contactHidden ? null : v.email,
    city: v.city,
    state: v.state,
    zip: v.zip,
  };
}

/**
 * Look up carriers for the self-service prefill. Precedence: `dot` (exact,
 * single row) → `mc` (normalized match) → `q` (free-text name ILIKE, capped at
 * CARRIER_LOOKUP_LIMIT). Returns `[]` for an empty/too-short query and degrades
 * to `[]` on any read failure — never throws, never 500s the endpoint.
 */
export async function carrierLookup(params: CarrierLookupParams): Promise<CarrierLookupResult[]> {
  const dot = normalizeUsdotQuery(params.dot);
  const mc = normalizeMcQuery(params.mc);
  const nameTerm = normalizeNameQuery(params.q);

  let where: SQL | null = null;
  let limit = CARRIER_LOOKUP_LIMIT;
  if (dot) {
    where = eq(carrierDirectory.usdot, dot);
    limit = 1;
  } else if (mc) {
    // Column side: strip mc_number's non-digits then leading zeros, compare to
    // the equally-normalized user value. "MC012892" ⇒ "12892" = mc.
    where = sql`ltrim(regexp_replace(coalesce(${carrierDirectory.mcNumber}, ''), '[^0-9]', '', 'g'), '0') = ${mc}`;
    limit = CARRIER_LOOKUP_LIMIT;
  } else if (nameTerm) {
    where = nameSearchCondition(nameTerm);
  }
  if (!where) return [];

  try {
    // LEFT JOIN carrier_overrides so an admin/claim opt-out written to
    // carrier_overrides.hidden is honored, not just the base contact_hidden
    // column. mergeCarrierOverride ORs the two hidden flags (and applies any
    // admin email/phone edits) exactly like the carrierBySlug profile path;
    // toLookupResult then nulls phone/email when the merged carrier is hidden.
    // A missing carrier_overrides table still LEFT JOINs to NULL, so this
    // degrades to the pure FMCSA card — never a 500.
    const rows = await db()
      .select()
      .from(carrierDirectory)
      .leftJoin(carrierOverrides, eq(carrierOverrides.usdot, carrierDirectory.usdot))
      .where(where)
      .orderBy(...orderForSort('featured'))
      .limit(limit);
    return rows.map((r) => toLookupResult(mergeCarrierOverride(visibleCarrier(r.carrier_directory), r.carrier_overrides)));
  } catch (err) {
    console.warn('[directory] carrierLookup failed; serving no matches:', err);
    return [];
  }
}
