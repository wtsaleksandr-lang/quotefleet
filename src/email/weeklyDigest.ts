/**
 * Weekly performance digest — per-tenant aggregation (v1).
 *
 * Computes, for one tenant over a 7-day window, the numbers a carrier cares
 * about: how many quotes/leads came in, how they converted, how many
 * auto-replies + callbacks + chats happened, and how visitors engaged with
 * their hosted quotes. Everything is derived from EXISTING tables — no new
 * tracking infra:
 *
 *   quotes/leads          leads.createdAt                (per tenantId)
 *   status breakdown      leads.status                   (new / won / …)
 *   conversion            won + booking_requested
 *   auto-replies          leads.autoReplySent / autoReplyAt
 *   callbacks             callback_requests.createdAt
 *   chat conversations    conversations (channel = lead_chat)
 *   on-page engagement    audit_log 'quote.activity' events
 *
 * True EMAIL opens / link clicks are OUT OF SCOPE for v1 — they require an
 * ESP (Resend/SES) open+click webhook we don't yet ingest. See
 * TODO(phase2) in the digest template; we never fabricate those numbers.
 *
 * The DB layer just fetches the rows in the window; all counting lives in the
 * pure `summarizeWeeklyActivity()` so it's unit-testable without a database.
 */
import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLog, callbackRequests, conversations, leads } from '../db/schema.js';
// Single source of truth for what counts as a conversion — shared with the
// dashboard KPI overview so the digest and the dashboard never disagree.
import { CONVERTED_STATUSES } from '../server/overviewStats.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** On-page engagement rollup pulled from the quote.activity audit events.
 *  Mirrors the event vocabulary in routes/quoteActivity.ts. */
export interface EngagementCounts {
  views: number;
  pdfSaves: number;
  chatOpens: number;
  copyLinks: number;
  prints: number;
  callbackOpens: number;
}

export interface WeeklyDigestStats {
  /** Inclusive-start / exclusive-end ISO strings of the 7-day window. */
  windowStart: string;
  windowEnd: string;

  /** Quotes/leads created inside the window (every calculator submission). */
  quotesThisWeek: number;
  /** Same count for the PRIOR 7-day window — powers the WoW delta. */
  quotesPrevWeek: number;
  /** quotesThisWeek − quotesPrevWeek (may be negative). */
  quotesDelta: number;

  /** Count of leads per status within the window (only non-zero keys). */
  byStatus: Record<string, number>;
  /** Leads that converted this week (won + booking_requested). */
  conversions: number;
  /** Rounded whole-percent conversions/quotesThisWeek (0 when no quotes). */
  conversionPct: number;

  /** Leads that got an AI auto-reply this week. */
  autoRepliesSent: number;
  /** Callback requests created this week. */
  callbacks: number;
  /** Distinct lead chat conversations touched this week (lead_chat channel). */
  chatConversations: number;

  /** On-page engagement from quote.activity events in the window. */
  engagement: EngagementCounts;

  /** True when there was NO meaningful activity — the caller uses this to
   *  suppress the "0 quotes this week" email to empty/inactive accounts. */
  isEmpty: boolean;
}

/** Row shapes the summarizer needs — narrowed so tests can seed plain objects
 *  without constructing full Drizzle rows. */
export interface WeeklyActivityInput {
  windowStart: Date;
  windowEnd: Date;
  /** Leads created since the PRIOR window start (windowStart − 7d); split into
   *  this-week vs prev-week inside the summarizer. */
  leadRows: Array<{ createdAt: Date; status: string; autoReplySent: boolean }>;
  /** Callback requests created in [windowStart, windowEnd). */
  callbackRows: Array<{ createdAt: Date }>;
  /** lead_chat conversation messages in the window; distinct leadId = a convo. */
  conversationRows: Array<{ createdAt: Date; leadId: number | null }>;
  /** quote.activity audit events in the window. */
  activityRows: Array<{ createdAt: Date; detailsJson: Record<string, unknown> | null }>;
}

function inWindow(at: Date, start: Date, end: Date): boolean {
  const t = at.getTime();
  return t >= start.getTime() && t < end.getTime();
}

/** Pure aggregation over already-fetched rows. No DB, no clock — fully
 *  deterministic and unit-testable. */
export function summarizeWeeklyActivity(input: WeeklyActivityInput): WeeklyDigestStats {
  const { windowStart, windowEnd, leadRows, callbackRows, conversationRows, activityRows } = input;
  const prevStart = new Date(windowStart.getTime() - WEEK_MS);

  let quotesThisWeek = 0;
  let quotesPrevWeek = 0;
  let autoRepliesSent = 0;
  let conversions = 0;
  const byStatus: Record<string, number> = {};

  for (const row of leadRows) {
    if (inWindow(row.createdAt, windowStart, windowEnd)) {
      quotesThisWeek++;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      if (row.autoReplySent) autoRepliesSent++;
      if (CONVERTED_STATUSES.has(row.status)) conversions++;
    } else if (inWindow(row.createdAt, prevStart, windowStart)) {
      quotesPrevWeek++;
    }
  }

  const callbacks = callbackRows.filter((r) => inWindow(r.createdAt, windowStart, windowEnd)).length;

  // A "conversation" = one distinct lead the visitor chatted about this week.
  const chatLeadIds = new Set<number>();
  for (const row of conversationRows) {
    if (row.leadId != null && inWindow(row.createdAt, windowStart, windowEnd)) {
      chatLeadIds.add(row.leadId);
    }
  }

  const engagement: EngagementCounts = {
    views: 0,
    pdfSaves: 0,
    chatOpens: 0,
    copyLinks: 0,
    prints: 0,
    callbackOpens: 0,
  };
  for (const row of activityRows) {
    if (!inWindow(row.createdAt, windowStart, windowEnd)) continue;
    const event = typeof row.detailsJson?.event === 'string' ? row.detailsJson.event : '';
    switch (event) {
      case 'view':
        engagement.views++;
        break;
      case 'save_pdf':
        engagement.pdfSaves++;
        break;
      case 'chat_open':
        engagement.chatOpens++;
        break;
      case 'copy_link':
        engagement.copyLinks++;
        break;
      case 'print':
        engagement.prints++;
        break;
      case 'callback_open':
        engagement.callbackOpens++;
        break;
      default:
        break;
    }
  }

  const conversionPct = quotesThisWeek > 0 ? Math.round((conversions / quotesThisWeek) * 100) : 0;
  const chatConversations = chatLeadIds.size;

  // "Empty" = nothing worth emailing about. Views alone don't count — a bounce
  // that never submitted isn't a reason to nudge the carrier.
  const isEmpty =
    quotesThisWeek === 0 && callbacks === 0 && chatConversations === 0 && autoRepliesSent === 0;

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    quotesThisWeek,
    quotesPrevWeek,
    quotesDelta: quotesThisWeek - quotesPrevWeek,
    byStatus,
    conversions,
    conversionPct,
    autoRepliesSent,
    callbacks,
    chatConversations,
    engagement,
    isEmpty,
  };
}

/**
 * Fetch the window's rows for one tenant and summarize them. `now` is
 * injectable for tests/backfill; defaults to the current time. The window is
 * the last 7 days [now−7d, now); the prior week [now−14d, now−7d) is fetched
 * in the same lead query to compute the WoW delta cheaply.
 */
export async function computeWeeklyStats(
  tenantId: number,
  now: Date = new Date()
): Promise<WeeklyDigestStats> {
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - WEEK_MS);
  const prevStart = new Date(now.getTime() - 2 * WEEK_MS);

  // Per-tenant weekly volume is small; fetching the window's rows and counting
  // in JS (same approach as summarizeEvents) keeps the aggregation pure and
  // testable, and the composite (tenant_id, created_at) indexes keep the reads
  // index-only. Leads reach back a full prior week for the delta.
  const [leadRows, callbackRows, conversationRows, activityRows] = await Promise.all([
    db()
      .select({ createdAt: leads.createdAt, status: leads.status, autoReplySent: leads.autoReplySent })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), gte(leads.createdAt, prevStart))),
    db()
      .select({ createdAt: callbackRequests.createdAt })
      .from(callbackRequests)
      .where(and(eq(callbackRequests.tenantId, tenantId), gte(callbackRequests.createdAt, windowStart))),
    db()
      .select({ createdAt: conversations.createdAt, leadId: conversations.leadId })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.channel, 'lead_chat'),
          gte(conversations.createdAt, windowStart)
        )
      ),
    db()
      .select({ createdAt: auditLog.createdAt, detailsJson: auditLog.detailsJson })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, tenantId),
          eq(auditLog.action, 'quote.activity'),
          gte(auditLog.createdAt, windowStart)
        )
      ),
  ]);

  return summarizeWeeklyActivity({
    windowStart,
    windowEnd,
    leadRows,
    callbackRows,
    conversationRows,
    activityRows,
  });
}
