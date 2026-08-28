/**
 * Persisted spend ledger for PAID external provider calls (`external_api_spend`).
 *
 * Written ONLY from the cost-guard choke point (`externalPullGuard.guardedFetch`)
 * — one row per call that actually went out over the network — so any live pull
 * is auditable after the fact, across restarts, in admin. The in-process meter it
 * complements resets on every deploy; a $20 two-day burn was invisible because of
 * exactly that.
 *
 * SAFETY: every read here is bounded (LIMIT n over the `occurred_at` index, or a
 * small aggregate). QuoteFleet had repeated prod outages from unbounded scans —
 * this module must never reintroduce one. Every function is failure-tolerant:
 * observability must never break a request or a live pull that already happened.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { externalApiSpend } from '../../db/schema.js';
import type { ExternalProvider } from './externalPullGuard.js';

/** Rows returned by the admin "recent live calls" list. */
export const RECENT_SPEND_LIMIT = 25;

export interface SpendRow {
  provider: string;
  context: string | null;
  credits: number;
  creditsRemaining: number | null;
  estUsdCents: number;
  occurredAt: string;
}

export interface SpendTotals {
  provider: string;
  calls: number;
  credits: number;
  estUsdCents: number;
  lastAt: string | null;
}

/** Append ONE live-call row. Never throws — the call already happened. */
export async function recordLiveCall(row: {
  provider: ExternalProvider;
  context: string;
  credits: number;
  creditsRemaining: number | null;
  estUsdCents: number;
}): Promise<void> {
  try {
    await db().insert(externalApiSpend).values({
      provider: row.provider,
      context: row.context.slice(0, 200),
      credits: Math.max(0, Math.round(row.credits)),
      creditsRemaining: row.creditsRemaining,
      estUsdCents: Math.max(0, Math.round(row.estUsdCents)),
    });
  } catch (err) {
    console.warn('[importers.spend] ledger write failed (call still happened):', (err as Error)?.message);
  }
}

/**
 * Refine the NEWEST row for a provider with the numbers the provider itself
 * reported (ImportYeti returns `requestCost` + `creditsRemaining` in the response
 * body, which is only known once the call has been parsed).
 *
 * Bounded by construction: the sub-select is `ORDER BY id DESC LIMIT 1` on the
 * primary key, so the UPDATE touches exactly one row. Never throws.
 */
export async function noteReportedCost(
  provider: ExternalProvider,
  cost: number | null,
  creditsRemaining: number | null,
  centsPerCredit: number,
): Promise<void> {
  if (cost == null && creditsRemaining == null) return;
  try {
    const newest = await db()
      .select({ id: externalApiSpend.id })
      .from(externalApiSpend)
      .where(eq(externalApiSpend.provider, provider))
      .orderBy(desc(externalApiSpend.id))
      .limit(1);
    const id = newest[0]?.id;
    if (id == null) return;
    const patch: Record<string, number | null> = {};
    if (cost != null && Number.isFinite(cost)) {
      patch.credits = Math.max(0, Math.round(cost));
      patch.estUsdCents = Math.max(0, Math.round(cost * centsPerCredit));
    }
    if (creditsRemaining != null && Number.isFinite(creditsRemaining)) {
      patch.creditsRemaining = Math.round(creditsRemaining);
    }
    await db().update(externalApiSpend).set(patch).where(eq(externalApiSpend.id, id));
  } catch (err) {
    console.warn('[importers.spend] ledger refine failed:', (err as Error)?.message);
  }
}

/**
 * Admin view-model: per-provider totals + the most recent live calls. Bounded —
 * a grouped aggregate over a table that only grows by ONE row per real live call,
 * plus a LIMITed read down the `occurred_at` index. Degrades to empty on failure.
 */
export async function externalSpendSummary(): Promise<{
  totals: SpendTotals[];
  recent: SpendRow[];
  available: boolean;
}> {
  try {
    const totals = await db()
      .select({
        provider: externalApiSpend.provider,
        calls: sql<number>`count(*)::int`,
        credits: sql<number>`coalesce(sum(${externalApiSpend.credits}),0)::int`,
        estUsdCents: sql<number>`coalesce(sum(${externalApiSpend.estUsdCents}),0)::int`,
        lastAt: sql<Date | null>`max(${externalApiSpend.occurredAt})`,
      })
      .from(externalApiSpend)
      .groupBy(externalApiSpend.provider);

    const recent = await db()
      .select({
        provider: externalApiSpend.provider,
        context: externalApiSpend.context,
        credits: externalApiSpend.credits,
        creditsRemaining: externalApiSpend.creditsRemaining,
        estUsdCents: externalApiSpend.estUsdCents,
        occurredAt: externalApiSpend.occurredAt,
      })
      .from(externalApiSpend)
      .orderBy(desc(externalApiSpend.occurredAt))
      .limit(RECENT_SPEND_LIMIT);

    return {
      available: true,
      totals: totals.map((t) => ({
        provider: t.provider,
        calls: t.calls,
        credits: t.credits,
        estUsdCents: t.estUsdCents,
        lastAt: t.lastAt ? new Date(t.lastAt).toISOString() : null,
      })),
      recent: recent.map((r) => ({
        provider: r.provider,
        context: r.context,
        credits: r.credits,
        creditsRemaining: r.creditsRemaining,
        estUsdCents: r.estUsdCents,
        occurredAt: r.occurredAt.toISOString(),
      })),
    };
  } catch (err) {
    console.warn('[importers.spend] summary failed:', (err as Error)?.message);
    return { totals: [], recent: [], available: false };
  }
}
