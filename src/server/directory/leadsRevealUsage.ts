/**
 * Leads Pro reveal allowance meter — the cost + value governor behind the
 * decision-maker CONTACT REVEAL. Two concerns behind one injectable seam:
 *
 *   1. ALLOWANCE COUNT (durable) — how many distinct-company reveals an account
 *      has recorded in a bucket, persisted in `leads_reveal_usage`
 *      (account_key, period, reveals). Free accounts accumulate in the fixed
 *      `free` bucket (all-time taste); Leads Pro subscribers get a fresh
 *      `YYYY-MM` bucket each month. Modeled on directory_reveal_usage / rfqUsage.
 *
 *   2. RE-REVEAL DEDUP (soft) — which companies an account has ALREADY revealed,
 *      so re-opening one never decrements the allowance or re-hits Hunter. Kept
 *      per-account IN MEMORY (same soft posture as importerQuota's account-keyed
 *      profile-open dedup): resets on redeploy, which is acceptable — the global
 *      `importer_contact_cache` still guarantees no double Hunter spend across
 *      users, and the allowance is only ever a spend ceiling, not billing state.
 *
 * Injectable behind `LeadsRevealMeter` so routes + tests share one contract:
 * tests inject a fully in-memory meter (no DB); production uses `dbLeadsRevealMeter`.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { leadsRevealUsage } from '../../db/schema.js';

/** The fixed bucket free (non-subscriber) reveals accumulate in — all-time. */
export const FREE_BUCKET = 'free';

export interface LeadsRevealMeter {
  /** Distinct-company reveals recorded for this account in `period` (0 when none). */
  getReveals(accountKey: string, period: string): Promise<number>;
  /** Whether this account has ALREADY revealed `slug` (→ a free re-reveal). */
  hasRevealed(accountKey: string, slug: string): Promise<boolean>;
  /** Record ONE new distinct-company reveal: mark the slug + increment the
   *  bucket count. Returns the new running total for the period. */
  record(accountKey: string, period: string, slug: string): Promise<number>;
}

/** The bucket key for an account: `YYYY-MM` (UTC) for a subscriber, else `free`. */
export function revealBucket(isSubscriber: boolean, now: Date = new Date()): string {
  return isSubscriber ? now.toISOString().slice(0, 7) : FREE_BUCKET;
}

/** The metering account key: `user:<id>` (reveals require a logged-in account). */
export function leadsAccountKey(userId: number): string {
  return `user:${userId}`;
}

// ─── in-memory re-reveal dedup (per-account revealed-slug sets) ──────────────
const revealedByAccount = new Map<string, Set<string>>();
function revealedSet(accountKey: string): Set<string> {
  let s = revealedByAccount.get(accountKey);
  if (!s) {
    s = new Set<string>();
    revealedByAccount.set(accountKey, s);
  }
  return s;
}

// ─── DB-backed implementation ──────────────────────────────────────────────
export const dbLeadsRevealMeter: LeadsRevealMeter = {
  async getReveals(accountKey, period) {
    try {
      const rows = await db()
        .select({ reveals: leadsRevealUsage.reveals })
        .from(leadsRevealUsage)
        .where(and(eq(leadsRevealUsage.accountKey, accountKey), eq(leadsRevealUsage.period, period)))
        .limit(1);
      return rows[0]?.reveals ?? 0;
    } catch (err) {
      // A meter read must never 500 the reveal — degrade to "0 used". Worst case
      // a transient DB blip lets one extra reveal through, never a crash.
      console.warn('[leadsRevealUsage] getReveals failed; treating as 0 used:', err);
      return 0;
    }
  },

  async hasRevealed(accountKey, slug) {
    return revealedSet(accountKey).has(slug.toLowerCase());
  },

  async record(accountKey, period, slug) {
    revealedSet(accountKey).add(slug.toLowerCase());
    // Atomic upsert-and-increment — concurrent reveals from one account can't
    // lose a count (the increment happens in the DB, not read-modify-write here).
    const rows = await db()
      .insert(leadsRevealUsage)
      .values({ accountKey, period, reveals: 1 })
      .onConflictDoUpdate({
        target: [leadsRevealUsage.accountKey, leadsRevealUsage.period],
        set: { reveals: sql`${leadsRevealUsage.reveals} + 1` },
      })
      .returning({ reveals: leadsRevealUsage.reveals });
    return rows[0]?.reveals ?? 0;
  },
};

/** Test-only reset of the in-memory dedup sets. */
export function __resetLeadsRevealDedupForTests(): void {
  revealedByAccount.clear();
}
