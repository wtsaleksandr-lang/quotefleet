/**
 * RFQ monthly send meter — the ONLY place `directory_rfq_usage` is read/written.
 *
 * Injectable behind the `RfqUsageStore` interface (same seam pattern as
 * `RfqStore`) so the RFQ routes + tests share one contract: tests inject an
 * in-memory counter (no DB), production uses `dbRfqUsageStore`.
 *
 * The meter counts BLASTS, not carriers: one POST /directory/rfq = one
 * increment, however many carriers it fans out to. Gating reads `getSends` to
 * decide whether the account is under its monthly allowance; the route calls
 * `increment` exactly once, AFTER the blast is persisted.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { directoryRfqUsage } from '../../db/schema.js';

export interface RfqUsageStore {
  /** Blasts this account has started in `period` (0 when no row yet). */
  getSends(accountKey: string, period: string): Promise<number>;
  /** Atomically record one blast; returns the new running total for the period. */
  increment(accountKey: string, period: string): Promise<number>;
}

/** Current billing period as `YYYY-MM` in UTC (the meter's bucket key). */
export function currentRfqPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

// ─── DB-backed implementation ──────────────────────────────────────────────
export const dbRfqUsageStore: RfqUsageStore = {
  async getSends(accountKey, period) {
    try {
      const rows = await db()
        .select({ sends: directoryRfqUsage.sends })
        .from(directoryRfqUsage)
        .where(and(eq(directoryRfqUsage.accountKey, accountKey), eq(directoryRfqUsage.period, period)))
        .limit(1);
      return rows[0]?.sends ?? 0;
    } catch (err) {
      // A meter read must never 500 the RFQ form — degrade to "0 used". Worst
      // case a transient DB blip lets one extra request through, never a crash.
      console.warn('[rfqUsage] getSends failed; treating as 0 used:', err);
      return 0;
    }
  },

  async increment(accountKey, period) {
    // Atomic upsert-and-increment: INSERT … ON CONFLICT (account_key,period) DO
    // UPDATE SET sends = sends + 1. Concurrent blasts from the same account can't
    // lose a count — the increment happens in the DB, not read-modify-write here.
    const rows = await db()
      .insert(directoryRfqUsage)
      .values({ accountKey, period, sends: 1 })
      .onConflictDoUpdate({
        target: [directoryRfqUsage.accountKey, directoryRfqUsage.period],
        set: { sends: sql`${directoryRfqUsage.sends} + 1` },
      })
      .returning({ sends: directoryRfqUsage.sends });
    return rows[0]?.sends ?? 0;
  },
};
