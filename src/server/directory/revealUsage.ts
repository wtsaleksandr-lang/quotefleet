/**
 * Directory Pro reveal DAILY meter — the ONLY place `directory_reveal_usage` is
 * read/written. The cost governor behind the "Reveal additional contacts"
 * button: each FRESH reveal costs 1 AI call + up to 3 HTTP fetches, so a paying
 * Pro account is capped at DIRECTORY_REVEAL_DAILY_CAP fresh reveals per UTC day.
 *
 * Injectable behind `RevealUsageStore` (same seam pattern as `RfqUsageStore`) so
 * routes + tests share one contract: tests inject an in-memory counter (no DB),
 * production uses `dbRevealUsageStore`.
 *
 * Only FRESH reveals are metered — a cached reveal (marker still within TTL) is
 * free and never calls `increment`.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { directoryRevealUsage } from '../../db/schema.js';

export interface RevealUsageStore {
  /** Fresh reveals this account has run in `period` (0 when no row yet). */
  getReveals(accountKey: string, period: string): Promise<number>;
  /** Atomically record one fresh reveal; returns the new running total. */
  increment(accountKey: string, period: string): Promise<number>;
}

/** Current daily bucket as `YYYY-MM-DD` in UTC (the meter's key). */
export function currentRevealPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** DIRECTORY_REVEAL_DAILY_CAP (default 50) — per-account fresh reveals per day. */
export function revealDailyCap(): number {
  const raw = process.env.DIRECTORY_REVEAL_DAILY_CAP;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

// ─── DB-backed implementation ──────────────────────────────────────────────
export const dbRevealUsageStore: RevealUsageStore = {
  async getReveals(accountKey, period) {
    try {
      const rows = await db()
        .select({ reveals: directoryRevealUsage.reveals })
        .from(directoryRevealUsage)
        .where(and(eq(directoryRevealUsage.accountKey, accountKey), eq(directoryRevealUsage.period, period)))
        .limit(1);
      return rows[0]?.reveals ?? 0;
    } catch (err) {
      // A meter read must never 500 the reveal — degrade to "0 used". Worst case
      // a transient DB blip lets one extra reveal through, never a crash.
      console.warn('[revealUsage] getReveals failed; treating as 0 used:', err);
      return 0;
    }
  },

  async increment(accountKey, period) {
    // Atomic upsert-and-increment — concurrent reveals from one account can't
    // lose a count (the increment happens in the DB, not read-modify-write here).
    const rows = await db()
      .insert(directoryRevealUsage)
      .values({ accountKey, period, reveals: 1 })
      .onConflictDoUpdate({
        target: [directoryRevealUsage.accountKey, directoryRevealUsage.period],
        set: { reveals: sql`${directoryRevealUsage.reveals} + 1` },
      })
      .returning({ reveals: directoryRevealUsage.reveals });
    return rows[0]?.reveals ?? 0;
  },
};
