/**
 * THE POLLING SCHEDULE — and why one fixed interval is the wrong answer.
 *
 * ── THE SHAPE OF THE PROBLEM ──────────────────────────────────────────────
 * Seasonal restrictions are not a feed that trickles. They are DORMANT for
 * seven or eight months and then move several times a week for six weeks. A
 * single global interval has to be wrong at one end or the other:
 *
 *   • Poll hourly all year and 92% of ~30,000 annual requests learn nothing,
 *     against state web servers we are a guest on.
 *   • Poll daily all year and, in the window that matters, we are up to 24
 *     hours behind a restriction that changes what is legal on a road today.
 *
 * So the cadence is DATA-DRIVEN PER STATE, from each source's own
 * `postingWindow` — a statute where one exists (South Dakota's SDCL 32-22-24
 * fixes the season at February 15 to April 30), otherwise that state's observed
 * bulletin history. The window is recorded WITH ITS BASIS in `sources.ts`, so
 * the schedule is auditable rather than folkloric.
 *
 * ── FOUR TIERS ────────────────────────────────────────────────────────────
 *
 *   IN-SEASON   inside the state's own window          → every 3 hours
 *   SHOULDER    within 14 days either side of it       → every 12 hours
 *   OFF-SEASON  the rest of the year                   → every 7 days
 *   DORMANT     no state programme to poll             → never
 *
 * WHY THREE HOURS IN SEASON, and not one and not twelve. The states themselves
 * set the bar, and they give more notice than a naive reading suggests:
 * MnDOT announces each zone change AT LEAST THREE CALENDAR DAYS in advance;
 * MDOT's numbered bulletins state a future effective moment (bulletin #8 of
 * 2026-05-15 lifted restrictions from a stated time); NDDOT's orders carry an
 * `LR_Order_Effective_DateTime` that in the observed 2026-20 order was ~20
 * hours after the order was created. Against a notice period measured in days,
 * a 3-hour worst-case latency is comfortably inside the margin, and it costs 8
 * requests per state per day — a rounding error to a state web server, and $0.
 * An hourly poll would triple the load to shave two hours off a lag that
 * already fits inside the notice period. That is not a better product.
 *
 * WHY A SHOULDER AT ALL. Because a window derived from history is a prediction,
 * and thaw is weather. Wisconsin's frozen-road law — which RAISES limits — ends
 * on the first sustained warm spell with no fixed date, and Class II
 * restrictions can follow within days. Fourteen days on each side is roughly
 * two standard deviations of the year-to-year drift in the observed start dates
 * and costs 2 polls a day for a month.
 *
 * WHY AN OFF-SEASON POLL AT ALL, given the season is over. Three reasons, and
 * the third is the one that matters:
 *   1. An unscheduled restriction is possible any month — a wet autumn, a
 *      flood embargo, a failed culvert.
 *   2. A season can run long. North Dakota's own feed, read on 2026-09-04, was
 *      still serving order 2026-20 with segments in effect from 2026-06-25 —
 *      three weeks past the window most summaries would give the state.
 *   3. IT KEEPS THE STALENESS SIGNAL ALIVE. If we stopped polling in July, then
 *      `retrievedOn` would age for months and we would have no way to tell "we
 *      chose not to poll" from "the source has been broken since June". A
 *      weekly poll means a source that breaks in the off-season is discovered
 *      in the off-season, not on the first cold morning in February.
 *
 * ── ONE TIMER, NOT FIFTY ──────────────────────────────────────────────────
 * There is a single cron ticking every 30 minutes. On each tick it asks each
 * state "are you due?" and fetches only those that are. Fifty independent
 * timers would defeat `cronSchedule.ts`'s whole reason for existing — the
 * thundering-herd fix — and would be un-inspectable. The tick is also where
 * politeness is enforced: at most `MAX_FETCHES_PER_TICK` states go out, spaced
 * by `POLITE_GAP_MS`, so even a cold start that finds every state due walks
 * through them over several ticks instead of hitting eleven state web servers
 * in the same second.
 *
 * Everything here is PURE and takes an injected `now`, so the whole calendar is
 * unit-testable without waiting for March.
 */
import type { PostingWindow, SeasonalSourceSpec } from './sources.js';

export type CadenceTier = 'in-season' | 'shoulder' | 'off-season' | 'dormant';

export const IN_SEASON_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
export const SHOULDER_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const OFF_SEASON_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Days either side of a state's own window that count as the shoulder. */
export const SHOULDER_DAYS = 14;

/** The cron's own tick. Must divide the shortest interval so no tier is starved. */
export const SEASONAL_TICK_MS = 30 * 60 * 1000; // 30 minutes

/** Most states contacted in ONE tick. Politeness, and a bound on a cold start. */
export const MAX_FETCHES_PER_TICK = 3;

/** Gap between two outbound fetches inside one tick. */
export const POLITE_GAP_MS = 2_000;

/**
 * How old a snapshot may get before it is presented as STALE, per tier.
 *
 * Deliberately ~4 polling intervals, not 1: a single missed poll is a blip and
 * must not flip a live page into a staleness warning, while four consecutive
 * misses is a source that is actually broken. In season that is half a day,
 * which is still well inside the states' own notice periods.
 */
export function stalenessBudgetDays(tier: CadenceTier): number {
  switch (tier) {
    case 'in-season':
      return 1; // 8 polls a day; a full day with none is a real fault
    case 'shoulder':
      return 2;
    case 'off-season':
      return 28; // 4 weekly polls
    case 'dormant':
      return Number.POSITIVE_INFINITY;
  }
}

// ── Calendar arithmetic ────────────────────────────────────────────────────

/** Day-of-year style ordinal for an `MM-DD`, on a common (non-leap) calendar. */
const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function monthDayOrdinal(md: string): number {
  const m = /^(\d{2})-(\d{2})$/.exec(String(md ?? '').trim());
  if (!m) return Number.NaN;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN;
  return (CUMULATIVE_DAYS[month - 1] as number) + day;
}

/** The same ordinal for a Date, read in UTC. */
export function dateOrdinal(now: Date): number {
  const md = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  return monthDayOrdinal(md);
}

const YEAR_DAYS = 365;

/**
 * Signed distance in days from `ordinal` to the window, wrapping the year.
 * 0 when inside; positive when outside, measured to the nearer edge.
 *
 * A window whose `from` ordinal is AFTER its `to` ordinal wraps the new year —
 * no state in the registry does that today, but Alaska's break-up season drifts
 * late and a future northern source could, and a calendar helper that silently
 * inverts on a wrap is the kind of bug that only shows up in January.
 */
export function daysOutsideWindow(window: PostingWindow, ordinal: number): number {
  const from = monthDayOrdinal(window.from);
  const to = monthDayOrdinal(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(ordinal)) {
    // An unreadable window must not silently become "always in season".
    return Number.POSITIVE_INFINITY;
  }
  const inside = from <= to ? ordinal >= from && ordinal <= to : ordinal >= from || ordinal <= to;
  if (inside) return 0;
  const gapTo = (from - ordinal + YEAR_DAYS) % YEAR_DAYS; // days until it opens
  const gapFrom = (ordinal - to + YEAR_DAYS) % YEAR_DAYS; // days since it closed
  return Math.min(gapTo, gapFrom);
}

export interface Cadence {
  tier: CadenceTier;
  intervalMs: number;
  /** Sentence rendered on the reference page and in the admin view. */
  why: string;
}

/** This state's cadence right now. Pure; `now` is injected. */
export function cadenceFor(spec: SeasonalSourceSpec, now: Date): Cadence {
  if (spec.ingestion === 'none') {
    return {
      tier: 'dormant',
      intervalMs: Number.POSITIVE_INFINITY,
      why: `${spec.name} runs no state-system seasonal programme, so there is no source to poll.`,
    };
  }
  const outside = daysOutsideWindow(spec.postingWindow, dateOrdinal(now));
  if (outside === 0) {
    return {
      tier: 'in-season',
      intervalMs: IN_SEASON_INTERVAL_MS,
      why: `Inside ${spec.name}'s posting window (${spec.postingWindow.from} to ${spec.postingWindow.to}) — polled every 3 hours.`,
    };
  }
  if (outside <= SHOULDER_DAYS) {
    return {
      tier: 'shoulder',
      intervalMs: SHOULDER_INTERVAL_MS,
      why: `${outside} day(s) outside ${spec.name}'s posting window — polled every 12 hours in case the season starts early or runs late.`,
    };
  }
  return {
    tier: 'off-season',
    intervalMs: OFF_SEASON_INTERVAL_MS,
    why: `Outside ${spec.name}'s posting window by ${outside} days — polled weekly, so an unscheduled restriction and a broken source are both found before the season opens.`,
  };
}

/**
 * Is this state due?
 *
 * Keys on the LAST ATTEMPT, not the last success. Keying on success would turn
 * a source that is down into a source we hammer every 30 minutes forever — the
 * exact behaviour a rate-limited state web server would be right to block us
 * for. A failure therefore waits out the same interval as a success, and the
 * ledger (not the retry loop) is what makes the failure visible.
 */
export function isDue(
  spec: SeasonalSourceSpec,
  lastAttemptAtMs: number | null,
  now: Date,
): boolean {
  const cadence = cadenceFor(spec, now);
  if (!Number.isFinite(cadence.intervalMs)) return false;
  if (lastAttemptAtMs === null) return true; // never tried
  return now.getTime() - lastAttemptAtMs >= cadence.intervalMs;
}

/**
 * The states to contact on THIS tick, oldest attempt first and capped.
 *
 * Oldest-first matters on a cold start: without it the same first three states
 * in registry order would be refreshed on every tick while the rest starved.
 */
export function dueThisTick(
  specs: readonly SeasonalSourceSpec[],
  lastAttemptAtMs: ReadonlyMap<string, number>,
  now: Date,
  limit: number = MAX_FETCHES_PER_TICK,
): SeasonalSourceSpec[] {
  return specs
    .filter((s) => isDue(s, lastAttemptAtMs.get(s.code) ?? null, now))
    .sort((a, b) => (lastAttemptAtMs.get(a.code) ?? 0) - (lastAttemptAtMs.get(b.code) ?? 0))
    .slice(0, Math.max(0, limit));
}
