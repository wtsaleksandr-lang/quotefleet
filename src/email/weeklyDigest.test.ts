/**
 * Weekly digest aggregation — pure `summarizeWeeklyActivity` correctness.
 *
 * Seeds leads / callbacks / conversations / activity events straddling the
 * window boundaries and asserts the rollup counts, conversion %, WoW delta,
 * and the `isEmpty` suppression flag. No DB, no clock.
 */
import { describe, it, expect } from 'vitest';
import { summarizeWeeklyActivity, WEEK_MS, type WeeklyActivityInput } from './weeklyDigest.js';

const windowEnd = new Date('2026-07-13T14:00:00.000Z'); // a Monday 14:00 UTC
const windowStart = new Date(windowEnd.getTime() - WEEK_MS);

/** N days before windowEnd. */
function daysAgo(n: number): Date {
  return new Date(windowEnd.getTime() - n * 24 * 60 * 60 * 1000);
}

function baseInput(over: Partial<WeeklyActivityInput> = {}): WeeklyActivityInput {
  return {
    windowStart,
    windowEnd,
    leadRows: [],
    callbackRows: [],
    conversationRows: [],
    activityRows: [],
    ...over,
  };
}

describe('summarizeWeeklyActivity', () => {
  it('counts quotes in-window, splits WoW, and computes conversion %', () => {
    const stats = summarizeWeeklyActivity(
      baseInput({
        leadRows: [
          // ── this week (4 quotes; 1 won + 1 booking_requested = 2 conversions) ──
          { createdAt: daysAgo(1), status: 'new', autoReplySent: true },
          { createdAt: daysAgo(2), status: 'won', autoReplySent: true },
          { createdAt: daysAgo(3), status: 'booking_requested', autoReplySent: false },
          { createdAt: daysAgo(6), status: 'lost', autoReplySent: false },
          // ── prior week (2 quotes) — feeds the delta only ──
          { createdAt: daysAgo(8), status: 'new', autoReplySent: false },
          { createdAt: daysAgo(13), status: 'won', autoReplySent: false },
          // ── outside both windows — ignored ──
          { createdAt: daysAgo(30), status: 'new', autoReplySent: true },
        ],
      })
    );

    expect(stats.quotesThisWeek).toBe(4);
    expect(stats.quotesPrevWeek).toBe(2);
    expect(stats.quotesDelta).toBe(2);
    expect(stats.byStatus).toEqual({ new: 1, won: 1, booking_requested: 1, lost: 1 });
    expect(stats.conversions).toBe(2);
    expect(stats.conversionPct).toBe(50); // 2 / 4
    expect(stats.autoRepliesSent).toBe(2);
    expect(stats.isEmpty).toBe(false);
  });

  it('counts callbacks + distinct chat conversations + engagement in-window only', () => {
    const stats = summarizeWeeklyActivity(
      baseInput({
        callbackRows: [
          { createdAt: daysAgo(1) },
          { createdAt: daysAgo(5) },
          { createdAt: daysAgo(9) }, // prior week — excluded
        ],
        conversationRows: [
          // two messages, same lead → ONE conversation
          { createdAt: daysAgo(1), leadId: 100 },
          { createdAt: daysAgo(1), leadId: 100 },
          { createdAt: daysAgo(2), leadId: 200 },
          { createdAt: daysAgo(2), leadId: null }, // no lead → not a lead convo
          { createdAt: daysAgo(10), leadId: 300 }, // out of window
        ],
        activityRows: [
          { createdAt: daysAgo(1), detailsJson: { event: 'view' } },
          { createdAt: daysAgo(1), detailsJson: { event: 'view' } },
          { createdAt: daysAgo(2), detailsJson: { event: 'save_pdf' } },
          { createdAt: daysAgo(2), detailsJson: { event: 'chat_open' } },
          { createdAt: daysAgo(3), detailsJson: { event: 'copy_link' } },
          { createdAt: daysAgo(9), detailsJson: { event: 'view' } }, // out of window
        ],
      })
    );

    expect(stats.callbacks).toBe(2);
    expect(stats.chatConversations).toBe(2); // leads 100 + 200
    expect(stats.engagement.views).toBe(2);
    expect(stats.engagement.pdfSaves).toBe(1);
    expect(stats.engagement.chatOpens).toBe(1);
    expect(stats.engagement.copyLinks).toBe(1);
    expect(stats.isEmpty).toBe(false);
  });

  it('flags isEmpty when there are no quotes/callbacks/chats/auto-replies (views alone do not count)', () => {
    const stats = summarizeWeeklyActivity(
      baseInput({
        activityRows: [{ createdAt: daysAgo(1), detailsJson: { event: 'view' } }],
      })
    );
    expect(stats.quotesThisWeek).toBe(0);
    expect(stats.conversionPct).toBe(0);
    expect(stats.engagement.views).toBe(1);
    expect(stats.isEmpty).toBe(true);
  });
});
