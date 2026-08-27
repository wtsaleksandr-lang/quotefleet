/**
 * Manifest Privacy free-tier meter — how many POA applications an account has
 * started this month. Modeled on the RFQ send meter (rfqUsage.ts): injectable
 * behind a small interface so the routes + tests share one contract (tests
 * inject an in-memory counter; production counts `poa_applications` rows).
 *
 * WHY no new table: the count is derived directly from `poa_applications`
 * (createdAt within the period, scoped to the account) — the free-tier gate is a
 * soft cost guard, not billing state, so it reuses the retained POA rows rather
 * than adding a fifth table. The REAL cost gate (submitting to CBP) is enforced
 * separately by requiring a live subscription in the admin submit flow.
 *
 * Free tier: FREE_POA_PER_MONTH draft+e-sign POAs / month. A live subscriber is
 * never metered here (unlimited within their entity quota).
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { poaApplications } from '../../db/schema.js';

/** Free accounts may build + e-sign this many POAs per calendar month. */
export const FREE_POA_PER_MONTH = 1;

export interface ManifestUsageStore {
  /** POA applications this account has STARTED in `period` (YYYY-MM, UTC). */
  getStarted(accountKey: string, period: string): Promise<number>;
}

/** Current period as `YYYY-MM` (UTC) — the meter bucket. */
export function currentManifestPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** First instant of a `YYYY-MM` period (UTC) — the count lower bound. */
export function periodStart(period: string): Date {
  return new Date(`${period}-01T00:00:00.000Z`);
}

/** The account key for metering: `user:<id>` when logged in, else `ip:<addr>`. */
export function manifestAccountKey(userId: number | null, ip: string | null | undefined): string {
  if (userId != null) return `user:${userId}`;
  return `ip:${(ip || 'unknown').trim()}`;
}

// ─── DB-backed implementation ──────────────────────────────────────────────
export const dbManifestUsageStore: ManifestUsageStore = {
  async getStarted(accountKey, period) {
    try {
      // Only user-scoped keys are countable against a persisted column; an
      // anonymous ip:* key has no stored owner, so it degrades to 0 (the
      // public draft is cheap — no external credit — so this is safe).
      if (!accountKey.startsWith('user:')) return 0;
      const userId = Number(accountKey.slice('user:'.length));
      if (!Number.isInteger(userId) || userId <= 0) return 0;
      const rows = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(poaApplications)
        .where(
          and(eq(poaApplications.userId, userId), gte(poaApplications.createdAt, periodStart(period))),
        );
      return rows[0]?.n ?? 0;
    } catch (err) {
      // A meter read must never 500 the onboarding form — degrade to "0 used".
      console.warn('[manifestUsage] getStarted failed; treating as 0 used:', err);
      return 0;
    }
  },
};

/** Whether this account may start ANOTHER POA now. A live subscriber is never
 *  gated; a free account is capped at FREE_POA_PER_MONTH per month. */
export function canStartPoa(opts: { isSubscriber: boolean; startedThisPeriod: number }): boolean {
  if (opts.isSubscriber) return true;
  return opts.startedThisPeriod < FREE_POA_PER_MONTH;
}
