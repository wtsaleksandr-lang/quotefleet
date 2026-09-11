/**
 * /api/ops/health — the surface that would have caught both incidents.
 *
 * WHAT WENT WRONG THAT THIS ANSWERS
 * ─────────────────────────────────
 * Two production failures ran for days without anyone noticing:
 *
 *   1. A branded carrier SUBDOMAIN served HTTP 429. Invisible because every
 *      probe we had pointed at the apex, and the apex was fine. A monitor that
 *      only checks the healthy path proves nothing about the broken one.
 *   2. The FMCSA ingest ran to completion and changed ZERO rows for a week. It
 *      reported `ingested: 330218` and went green, because the upsert rewrites
 *      every row whether or not the data differs. PR #537 added the honest
 *      `{written, changed}` accounting; until something READS it, a no-op still
 *      looks like a refresh.
 *
 * Both are the same bug in different clothes: **a signal existed and nothing
 * consumed it.** This endpoint is the consumer. It reads the ledgers the
 * codebase already keeps (`job_runs`, `ops_alerts`, `conversion_counters`) and
 * adds the one check no ledger can provide — an actual HTTP request to an
 * actual branded subdomain.
 *
 * `status` IS THE CONTRACT
 * ────────────────────────
 * `ok` / `degraded` / `down`, plus a `problems[]` of human sentences. A polling
 * monitor needs one field to alarm on; a human opening the URL needs to know
 * what to do. Both are served without either having to interpret the other's
 * data. Nothing in here is a canned success: a check that could not run reports
 * `unknown` with its reason, never a reassuring green.
 *
 * COST AND SAFETY
 * ───────────────
 * Cheap enough to poll every few minutes: four small indexed queries plus, at
 * most once per SYNTHETIC_TTL_MS, one HTTP GET. The synthetic probe is cached
 * process-wide and off by default in non-production, so polling the endpoint
 * hard cannot turn into hammering our own edge. $0 — no third-party service is
 * contacted by anything here.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { requireAuth, requireSuperAdmin } from '../middleware.js';
import { JOB_REGISTRY, classifyJobs, readJobHealth } from '../jobHealthWatchdog.js';
import { INGEST_NOOP_MARKER, INGEST_SWALLOWED_MARKER } from '../directory/carrierIngest.js';
import { readConversionSummary, recordConversion } from '../conversionCounters.js';
import { CONVERSION_EVENT_NAMES } from '../analytics.js';
import { errorMonitoringStatus } from '../errorMonitoring.js';

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

/** Shared secret that lets a HEADLESS monitor poll this endpoint. */
export const OPS_HEALTH_TOKEN_ENV = 'OPS_HEALTH_TOKEN';

/**
 * Two ways in, because there are two callers with incompatible needs.
 *
 * A human admin already has a session, and `requireAuth + requireSuperAdmin` is
 * how every other admin route in this codebase is protected — reusing it means
 * one place decides who is an admin. An external uptime pinger (UptimeRobot,
 * a GitHub Actions cron, `curl` from anywhere) cannot hold a session at all, so
 * a session-only endpoint would be unmonitorable by machines, which is the
 * entire point of building it. Hence a bearer token as the second door.
 *
 * The token is compared with `timingSafeEqual` over SHA-independent equal-length
 * buffers, and is only honoured when it is actually configured — an unset
 * OPS_HEALTH_TOKEN must never mean "everyone gets in".
 */
export function opsHealthAuth(env: NodeJS.ProcessEnv = process.env) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const expected = (env[OPS_HEALTH_TOKEN_ENV] ?? '').trim();
    if (expected) {
      const header = req.get('authorization') ?? '';
      const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
      const qp = typeof req.query.token === 'string' ? req.query.token.trim() : '';
      const presented = bearer || qp;
      if (presented) {
        const a = Buffer.from(presented);
        const b = Buffer.from(expected);
        if (a.length === b.length && timingSafeEqual(a, b)) {
          // Never let a token-authed health response be cached anywhere.
          res.setHeader('Cache-Control', 'no-store');
          next();
          return;
        }
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }
    // No token presented (or none configured) → fall through to the session
    // path, which answers 401/403 itself.
    //
    // The catch is load-bearing, not defensive dressing. `requireAuth` reads
    // `req.cookies[...]`, which THROWS a TypeError if cookie-parser has not run
    // on this request — and because it is an async function, that throw becomes
    // an unhandled rejection and the request HANGS with no response at all. A
    // health endpoint that hangs is worse than one that is down, because a
    // monitor waiting on a socket reports neither up nor down. Any failure in
    // the session path is a failure to authenticate; answer 401 and move on.
    res.setHeader('Cache-Control', 'no-store');
    const deny = (err: unknown): void => {
      console.warn(
        '[ops-health] session auth path failed:',
        err instanceof Error ? err.message : String(err),
      );
      if (!res.headersSent) res.status(401).json({ error: 'Unauthorized' });
    };
    try {
      void requireAuth(req, res, () => {
        void Promise.resolve(requireSuperAdmin(req, res, next)).catch(deny);
      }).catch(deny);
    } catch (err) {
      deny(err);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 1 — THE INGEST LEDGER (last success, and whether it CHANGED anything)
// ─────────────────────────────────────────────────────────────────────────────

/** How long the ~330k-row FMCSA directory may go without a run that actually
 *  changed rows before that is a problem. The job runs weekly (Sun 09:00 UTC);
 *  two missed cycles plus slack is the threshold where "quiet week" stops being
 *  a plausible explanation. */
export const INGEST_STALE_DAYS = 16;

export interface IngestHealth {
  /** Newest run of any status. */
  lastRunAt: string | null;
  lastStatus: string | null;
  /** Newest run that reported `changed=<n>` with n > 0 — a REAL refresh. */
  lastChangedAt: string | null;
  /** Rows that differed on that run. `null` when unmeasurable/never seen. */
  lastChangedCount: number | null;
  /** Days since the last real refresh. `null` when there has never been one. */
  staleDays: number | null;
  /** The run completed but changed nothing — PR #537's `[ingest.noop]`. */
  lastRunWasNoop: boolean;
  /** Non-fatal errors the ingest swallowed, summed over the recent window. */
  swallowedRecent: number;
  /** Runs in the window whose detail carried the swallowed marker. */
  degradedRuns: number;
}

/** `formatIngestDetail` writes a fixed `key=value` shape; read `changed=` and
 *  `warnings=` straight back out of it. `changed=n/a` is deliberately NOT a
 *  number — an unmeasured run must never be readable as a measured zero. */
export function parseIngestDetail(detail: string | null): { changed: number | null; warnings: number } {
  if (!detail) return { changed: null, warnings: 0 };
  const c = /\bchanged=(\d+|n\/a)\b/.exec(detail)?.[1];
  const w = /\bwarnings=(\d+)\b/.exec(detail)?.[1];
  return {
    changed: c === undefined || c === 'n/a' ? null : Number(c),
    warnings: w === undefined ? 0 : Number(w),
  };
}

/** Window over which swallowed-error counts are summed. Long enough to span
 *  more than one weekly ingest cycle. */
export const INGEST_WINDOW_DAYS = 30;

export async function readIngestHealth(now: Date = new Date()): Promise<IngestHealth> {
  const rows = (await db().execute(sql`
    select "started_at", "status", "detail"
      from "job_runs"
     where "job" = 'directory-reingest'
       and "started_at" > now() - ${`${INGEST_WINDOW_DAYS} days`}::interval
     order by "started_at" desc
     limit 200
  `)) as unknown as Array<{ started_at: string | Date; status: string; detail: string | null }>;

  const list = Array.isArray(rows) ? rows : [];
  const latest = list[0] ?? null;

  let lastChangedAt: string | null = null;
  let lastChangedCount: number | null = null;
  let swallowedRecent = 0;
  let degradedRuns = 0;

  for (const r of list) {
    const { changed, warnings } = parseIngestDetail(r.detail);
    if (warnings > 0) {
      swallowedRecent += warnings;
      degradedRuns++;
    } else if (r.detail?.includes(INGEST_SWALLOWED_MARKER)) {
      degradedRuns++;
    }
    if (lastChangedAt === null && changed !== null && changed > 0) {
      lastChangedAt = new Date(r.started_at).toISOString();
      lastChangedCount = changed;
    }
  }

  const staleDays =
    lastChangedAt === null
      ? null
      : Math.floor((now.getTime() - new Date(lastChangedAt).getTime()) / 86_400_000);

  return {
    lastRunAt: latest ? new Date(latest.started_at).toISOString() : null,
    lastStatus: latest?.status ?? null,
    lastChangedAt,
    lastChangedCount,
    staleDays,
    lastRunWasNoop: !!latest?.detail?.includes(INGEST_NOOP_MARKER),
    swallowedRecent,
    degradedRuns,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 2 — THE SYNTHETIC BRANDED-SUBDOMAIN PROBE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The check that the 429 outage needed and nobody had.
 *
 * Probing `quotefleet.net` proves the apex is up. It proves NOTHING about
 * `<slug>.quotefleet.net`, which is a different hostname, through a different
 * Cloudflare wildcard route, through the Worker that sets X-Original-Host,
 * through tenant lookup — and it was that path, not the apex, that returned 429
 * to real customers for days. So this check does what the apex check cannot: it
 * makes a real request to a real branded subdomain over the public internet and
 * reports the status code it actually got.
 *
 * 429 IS CALLED OUT BY NAME. A generic "not 200" would have been reported as
 * "down" and investigated as an outage; naming it `rateLimited` points straight
 * at the limiter, which is where the fix was.
 *
 * SAFETY: result cached process-wide for SYNTHETIC_TTL_MS, so polling this
 * endpoint every 10 seconds still produces at most one outbound request every
 * five minutes. 8-second timeout. Identifiable User-Agent so the request is
 * recognisable in logs and can be excepted from rate limits deliberately rather
 * than by accident.
 */
export const SYNTHETIC_TTL_MS = 5 * 60 * 1000;
export const SYNTHETIC_TIMEOUT_MS = 8000;

/** Tenant slug to probe. Pin one via env; otherwise the oldest active tenant is
 *  used, which is the most stable choice available without configuration. */
export const OPS_SYNTHETIC_SLUG_ENV = 'OPS_SYNTHETIC_SLUG';
/** Kill switch for the outbound probe alone (the rest of the report still runs). */
export const OPS_SYNTHETIC_DISABLED_ENV = 'OPS_SYNTHETIC_DISABLED';

export interface SyntheticResult {
  checkedAt: string;
  url: string | null;
  /** 'ok' | 'rate_limited' | 'error' | 'skipped' | 'unknown' */
  verdict: string;
  status: number | null;
  ms: number | null;
  detail: string | null;
}

let syntheticCache: { at: number; result: SyntheticResult } | null = null;

/**
 * The platform host domain to build the probe URL from.
 *
 * Deliberately NOT `defaultHostDomain()`. That helper calls `loadEnv()`, which
 * hard-fails when DATABASE_URL is absent — so the health check would throw for
 * a reason that has nothing to do with what it is checking, and a probe that
 * cannot run in a degraded environment is exactly the probe you needed in one.
 * This reads the single variable it actually needs, with the same default and
 * the same normalisation loadEnv() applies.
 */
export function probeHostDomain(env: NodeJS.ProcessEnv = process.env): string {
  const first = (env.HOST_DOMAINS ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  const cleaned = first.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return cleaned || 'quotefleet.net';
}

/** Test seam — clears the process-wide probe cache. */
export function resetSyntheticCacheForTest(): void {
  syntheticCache = null;
}

async function pickProbeSlug(env: NodeJS.ProcessEnv): Promise<string | null> {
  const pinned = (env[OPS_SYNTHETIC_SLUG_ENV] ?? '').trim();
  if (pinned) return pinned;
  try {
    const rows = (await db().execute(sql`
      select "slug" from "tenants" order by "id" asc limit 1
    `)) as unknown as Array<{ slug: string }>;
    return Array.isArray(rows) && rows[0] ? rows[0].slug : null;
  } catch {
    return null;
  }
}

export async function runSyntheticCheck(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<SyntheticResult> {
  if (syntheticCache && now.getTime() - syntheticCache.at < SYNTHETIC_TTL_MS) {
    return syntheticCache.result;
  }
  const skip = (verdict: string, detail: string): SyntheticResult => {
    const r: SyntheticResult = {
      checkedAt: now.toISOString(),
      url: null,
      verdict,
      status: null,
      ms: null,
      detail,
    };
    syntheticCache = { at: now.getTime(), result: r };
    return r;
  };

  if ((env[OPS_SYNTHETIC_DISABLED_ENV] ?? '') === '1') {
    return skip('skipped', `${OPS_SYNTHETIC_DISABLED_ENV}=1`);
  }
  const slug = await pickProbeSlug(env);
  if (!slug) return skip('skipped', 'no tenant to probe and no OPS_SYNTHETIC_SLUG pinned');

  const url = `https://${slug}.${probeHostDomain(env)}/`;
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SYNTHETIC_TIMEOUT_MS);
  let result: SyntheticResult;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: ac.signal,
      headers: { 'User-Agent': 'QuoteFleetOpsProbe/1 (+https://quotefleet.net)' },
    });
    const ms = Date.now() - started;
    const verdict =
      res.status === 429 ? 'rate_limited' : res.status < 400 ? 'ok' : 'error';
    result = {
      checkedAt: now.toISOString(),
      url,
      verdict,
      status: res.status,
      ms,
      detail:
        res.status === 429
          ? 'The branded subdomain is being RATE LIMITED. Customers on <slug>.<domain> are blocked while the apex looks healthy.'
          : verdict === 'error'
            ? `Branded subdomain returned HTTP ${res.status}.`
            : null,
    };
  } catch (err) {
    result = {
      checkedAt: now.toISOString(),
      url,
      verdict: 'error',
      status: null,
      ms: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
  syntheticCache = { at: now.getTime(), result };
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REPORT
// ─────────────────────────────────────────────────────────────────────────────

export type OpsStatus = 'ok' | 'degraded' | 'down';

/** Worst-wins. `down` means a customer-visible path is broken right now;
 *  `degraded` means something has stopped working correctly but pages still
 *  serve. Ordering them explicitly keeps a later check from downgrading an
 *  earlier one by assignment order. */
function worse(a: OpsStatus, b: OpsStatus): OpsStatus {
  const rank: Record<OpsStatus, number> = { ok: 0, degraded: 1, down: 2 };
  return rank[b] > rank[a] ? b : a;
}

export function registerOpsHealthRoutes(app: Express): void {
  // ── The public conversion-event sink ────────────────────────────────────
  // Necessarily unauthenticated: the events fire from a visitor's browser
  // before they have an account. Three things bound the damage: the allow-list
  // (an unknown name is rejected before the DB is touched, and the table's row
  // count is `events × days` regardless of traffic), the rate limit, and the
  // fact that the stored row contains no identifier of any kind. The worst an
  // abuser achieves is an inflated counter.
  const eventLimiter = rateLimit({
    windowMs: 60_000,
    limit: 40,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many events.' },
  });

  app.post('/api/analytics/event', eventLimiter, (req: Request, res: Response) => {
    const name = (req.body as { event?: unknown } | undefined)?.event;
    if (typeof name !== 'string' || !CONVERSION_EVENT_NAMES.includes(name)) {
      return res.status(204).end(); // Never tell a prober which names are real.
    }
    // Fire-and-forget: a counter must not make the caller wait, and a DB blip
    // must not surface as an error on a page the visitor is leaving anyway.
    void recordConversion(name).catch((err: unknown) => {
      console.warn('[analytics] conversion write failed:', err instanceof Error ? err.message : String(err));
    });
    return res.status(204).end();
  });

  // ── The report ──────────────────────────────────────────────────────────
  app.get('/api/ops/health', opsHealthAuth(), async (req: Request, res: Response) => {
    const now = new Date();
    const problems: string[] = [];
    let status: OpsStatus = 'ok';

    // Every check is independently fallible and independently reported. One
    // failing query must degrade its own section, not blank the whole report —
    // a health endpoint that 500s tells you nothing about what is wrong.
    const settled = await Promise.allSettled([
      readJobHealth(),
      readIngestHealth(now),
      readConversionSummary(),
      req.query.synthetic === '0' ? Promise.resolve(null) : runSyntheticCheck(now),
    ]);

    const [jobsR, ingestR, convR, synthR] = settled;

    // Jobs.
    let jobs: unknown = { error: 'unreadable' };
    if (jobsR.status === 'fulfilled') {
      const reports = classifyJobs(
        JOB_REGISTRY,
        jobsR.value,
        now,
        now,
        process.env as Record<string, string | undefined>,
      );
      const stale = reports.filter((r) => r.verdict === 'stale');
      for (const s of stale) problems.push(`Job '${s.job}' is STALE. ${s.impact}`);
      if (stale.length) status = worse(status, 'degraded');
      jobs = {
        total: reports.length,
        stale: stale.map((r) => r.job),
        disabled: reports.filter((r) => r.verdict === 'disabled').map((r) => r.job),
      };
    } else {
      problems.push('Job-health ledger could not be read.');
      status = worse(status, 'degraded');
    }

    // Ingest / FMCSA staleness.
    let ingest: unknown = { error: 'unreadable' };
    if (ingestR.status === 'fulfilled') {
      const i = ingestR.value;
      ingest = i;
      if (i.lastRunAt === null) {
        problems.push(`No directory-reingest run recorded in the last ${INGEST_WINDOW_DAYS} days.`);
        status = worse(status, 'degraded');
      } else if (i.staleDays === null) {
        problems.push('The FMCSA directory has no run on record that changed any rows — every run has been a no-op or unmeasured.');
        status = worse(status, 'degraded');
      } else if (i.staleDays > INGEST_STALE_DAYS) {
        problems.push(
          `The FMCSA carrier directory has not actually changed in ${i.staleDays} days `
          + `(threshold ${INGEST_STALE_DAYS}). Out-of-service and revoked-authority carriers are being shown as active.`,
        );
        status = worse(status, 'degraded');
      }
      if (i.lastRunWasNoop) {
        problems.push('The most recent ingest completed but changed ZERO rows — it went green while refreshing nothing.');
        status = worse(status, 'degraded');
      }
      if (i.swallowedRecent > 0) {
        problems.push(
          `${i.swallowedRecent} non-fatal error(s) were swallowed across ${i.degradedRuns} ingest run(s) `
          + `in the last ${INGEST_WINDOW_DAYS} days — those runs completed DEGRADED.`,
        );
        status = worse(status, 'degraded');
      }
    } else {
      problems.push('Ingest ledger could not be read.');
      status = worse(status, 'degraded');
    }

    // Synthetic branded-subdomain probe.
    let synthetic: unknown = { verdict: 'skipped', detail: 'not requested' };
    if (synthR.status === 'fulfilled' && synthR.value !== null) {
      const s = synthR.value;
      synthetic = s;
      if (s.verdict === 'rate_limited') {
        problems.push(`${s.url} is returning HTTP 429. ${s.detail}`);
        status = worse(status, 'down');
      } else if (s.verdict === 'error') {
        problems.push(`Branded subdomain check failed: ${s.detail ?? 'unknown error'}`);
        status = worse(status, 'down');
      }
    } else if (synthR.status === 'rejected') {
      synthetic = { verdict: 'unknown', detail: 'probe threw' };
      problems.push('The branded-subdomain probe could not run.');
      status = worse(status, 'degraded');
    }

    // Conversions. Reported, never alarmed on: a quiet weekend is not an
    // outage, and a false page at 3am trains people to ignore the real one.
    const conversions =
      convR.status === 'fulfilled' ? convR.value : { error: 'unreadable' };

    return res.json({
      ok: status === 'ok',
      status,
      checkedAt: now.toISOString(),
      problems,
      jobs,
      ingest,
      synthetic,
      conversions,
      errorMonitoring: errorMonitoringStatus(),
    });
  });
}
