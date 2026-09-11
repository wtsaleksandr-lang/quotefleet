/**
 * Durable conversion counters — the funnel half of "nothing was watching".
 *
 * WHY THIS EXISTS RATHER THAN A THIRD-PARTY EVENT
 * ───────────────────────────────────────────────
 * Cloudflare Web Analytics, which is what QuoteFleet uses for pageviews because
 * it is free and stores nothing on a visitor's device, supports **no custom
 * events on any plan** — their FAQ answers "Does Web Analytics support custom
 * events?" with "Not yet, but we may add support for this in the future." So
 * the four flows that actually decide whether this business works — the
 * homepage company finder, signup, the free profile claim, and the RFQ — cannot
 * be measured by the beacon, and buying a tool that can measure them is off the
 * table at $0. They are counted here instead.
 *
 * THE SHAPE, AND WHY IT IS A ROLLUP AND NOT AN EVENT LOG
 * ─────────────────────────────────────────────────────
 * One row per (UTC day, event name), holding a count. Not one row per event.
 * That is the design, for three reasons and in this order:
 *
 *   1. **It bounds the table against an anonymous writer.** The ingest endpoint
 *      is necessarily public — the events fire from a visitor's browser before
 *      they have an account. An append-only event log behind a public endpoint
 *      is an unbounded write amplifier: rate limits slow an attacker down, they
 *      do not stop the table growing. A rollup's row count is
 *      `8 events × days`, FULL STOP — flooding the endpoint moves a number up
 *      and cannot add a single row. ~2,900 rows/year, all of them wanted.
 *   2. **It stores nothing about a person.** There is no column for an IP, a
 *      session, a user agent, an email, a company, a USDOT, or a query string,
 *      so there is nothing to leak, nothing to subject-access-request, and
 *      nothing to retain-policy. A count of `signup_submit` on a date is not
 *      personal data in any jurisdiction.
 *   3. **It answers the question that was actually being asked.** "Did the
 *      funnel stop working?" is a shape-over-time question. A daily count
 *      answers it; per-event rows would have to be aggregated into exactly this
 *      to answer it.
 *
 * The cost of the rollup is that it cannot answer per-visitor questions (which
 * visitor, in what order, from where). That is deliberate: those are the
 * questions that need personal data, and the pageview layer already covers the
 * path/referrer shape of them without it.
 *
 * TABLE CREATION FOLLOWS THE job_runs RULE
 * ────────────────────────────────────────
 * Created by self-heal ONLY, and deliberately NOT in src/db/schema.ts or
 * drizzle/ — exactly as `job_runs` and `ops_alerts` are. Replit's deploy skips
 * db:migrate and its publish tool has repeatedly proposed DROPping tables the
 * ORM does not know about; every at-risk object in this codebase is re-asserted
 * on each boot instead, so a phantom drop self-repairs. Statement shapes are
 * the ones `selfHealTarget()` recognises, so a healthy boot is a lock-free
 * no-op.
 *
 * COST: one tiny table, ~2.9k rows/year, no new service, no third-party call. $0.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { runSelfHealStatements } from '../db/migrate.js';
import { withDbRetry } from '../db/retry.js';
import { CONVERSION_EVENT_NAMES } from './analytics.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. STORAGE
// ─────────────────────────────────────────────────────────────────────────────

export const CONVERSION_COUNTERS_SELF_HEAL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "conversion_counters" (
     "id" bigserial PRIMARY KEY,
     "day" date NOT NULL,
     "event" text NOT NULL,
     "count" integer NOT NULL DEFAULT 0,
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  // The UPSERT's conflict target AND the health endpoint's only read ("the last
  // N days, newest first"). One index serves both.
  `CREATE UNIQUE INDEX IF NOT EXISTS "conversion_counters_day_event_idx" ON "conversion_counters" ("day", "event")`,
];

/** Boot hook. Non-blocking + never throws at the call site (see server/index.ts). */
export async function ensureConversionCountersTable(): Promise<void> {
  await runSelfHealStatements(
    'conversion_counters rollup',
    CONVERSION_COUNTERS_SELF_HEAL_STATEMENTS,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. WRITING
// ─────────────────────────────────────────────────────────────────────────────

/** UTC calendar day as `YYYY-MM-DD`. UTC, not local: the server's timezone is
 *  a deploy detail and a funnel chart must not shift when it changes. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Names this module will persist. Anything else is a bug or an attacker, and
 *  either way must not reach the database. */
export function isKnownConversionEvent(name: unknown): name is string {
  return typeof name === 'string' && CONVERSION_EVENT_NAMES.includes(name);
}

/**
 * Increment one event's counter for one day.
 *
 * Rejects unknown names BEFORE touching the database — the allow-list is what
 * keeps the table's row count bounded, so it has to be enforced here and not
 * only at the route, where a future second caller could bypass it.
 *
 * Returns false rather than throwing when the name is unknown; the caller is a
 * fire-and-forget beacon handler and there is no one to throw to.
 */
export async function recordConversion(event: string, at: Date = new Date()): Promise<boolean> {
  if (!isKnownConversionEvent(event)) return false;
  const day = utcDay(at);
  await withDbRetry(
    () =>
      db().execute(sql`
        insert into "conversion_counters" ("day", "event", "count", "updated_at")
        values (${day}, ${event}, 1, now())
        on conflict ("day", "event")
        do update set "count" = "conversion_counters"."count" + 1, "updated_at" = now()
      `),
    { label: `conversion_counters upsert (${event})` },
  );
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. READING
// ─────────────────────────────────────────────────────────────────────────────

export interface ConversionDayRow {
  day: string;
  event: string;
  count: number;
}

export interface ConversionSummary {
  /** Days covered by `totals`. */
  windowDays: number;
  /** Per-event totals across the window. EVERY known event appears, including
   *  the ones at zero — a missing key and a zero are the same fact, and the
   *  zero is the one worth seeing. */
  totals: Record<string, number>;
  /** Per-day, per-event rows, newest day first. Lets a reader see a funnel step
   *  that stopped on a particular date rather than only a depressed total. */
  daily: ConversionDayRow[];
  /** Most recent day with ANY conversion at all, or null. The single number
   *  that answers "has the funnel produced anything lately". */
  lastConversionDay: string | null;
}

/** Default read window. A week shows the weekly-cycle shape (weekends are
 *  genuinely quieter in freight) without returning a wall of rows. */
export const CONVERSION_WINDOW_DAYS = 7;

/**
 * Summarise the last `windowDays` of conversions.
 *
 * The zero-fill is the point: an endpoint that returned `{}` when the funnel
 * had produced nothing would look exactly like an endpoint whose query was
 * broken, which is the class of ambiguity this whole workstream exists to
 * remove. Every known event is always present with an explicit number.
 */
export async function readConversionSummary(
  windowDays = CONVERSION_WINDOW_DAYS,
): Promise<ConversionSummary> {
  const span = Math.max(1, Math.floor(windowDays));
  const rows = (await withDbRetry(
    () =>
      db().execute(sql`
        select to_char("day", 'YYYY-MM-DD') as "day", "event", "count"
          from "conversion_counters"
         where "day" > current_date - ${`${span} days`}::interval
         order by "day" desc, "event" asc
      `),
    { label: 'conversion_counters read' },
  )) as unknown as Array<{ day: string; event: string; count: number | string }>;

  const daily: ConversionDayRow[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    day: r.day,
    event: r.event,
    count: Number(r.count) || 0,
  }));

  const totals: Record<string, number> = {};
  for (const name of CONVERSION_EVENT_NAMES) totals[name] = 0;
  for (const r of daily) {
    if (r.event in totals) totals[r.event] = (totals[r.event] ?? 0) + r.count;
  }

  const withAny = daily.filter((r) => r.count > 0);
  return {
    windowDays,
    totals,
    daily,
    lastConversionDay: withAny.length > 0 ? (withAny[0]?.day ?? null) : null,
  };
}
