/**
 * Weekly digest cron — audience + compliance behavior of a real pass
 * (runWeeklyDigestOnce), with the DB, email transport, and stats aggregation
 * mocked. Asserts:
 *   1. A tenant with activity gets ONE send carrying a tokenized
 *      List-Unsubscribe url + a visible unsubscribe footer link, and its
 *      lastWeeklyDigestAt is stamped.
 *   2. A marketing opt-out tenant is skipped.
 *   3. A 'free' (no core access) tenant is skipped.
 *   4. A zero-activity tenant (stats.isEmpty) is skipped — no "0 quotes" email.
 *   5. A tenant sent within the 6-day cooldown is skipped.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const { sendMock, rowsRef, updateMock, statsMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  rowsRef: { current: [] as unknown[] },
  updateMock: vi.fn(),
  statsMock: vi.fn(),
}));

vi.mock('./send.js', () => ({ sendEmail: sendMock }));
vi.mock('./weeklyDigest.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, computeWeeklyStats: statsMock };
});

vi.mock('../db/client.js', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(rowsRef.current) }) }),
    update: () => ({
      set: (v: unknown) => {
        updateMock(v);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
}));

beforeAll(() => {
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'x'.repeat(64);
  if (!process.env.DATABASE_URL)
    process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
  process.env.PUBLIC_BASE_URL = 'https://quotefleet.net';
});

const NOW = new Date('2026-07-13T14:00:00.000Z');

function tenant(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    slug: 'acme',
    hostDomain: 'quotefleet.net',
    name: 'Acme Freight',
    contactEmail: 'owner@acme.com',
    plan: 'pro', // core access
    trialEndsAt: null,
    status: 'active',
    marketingOptOut: false,
    lastWeeklyDigestAt: null,
    ...over,
  };
}

function nonEmptyStats(over: Record<string, unknown> = {}) {
  return {
    windowStart: new Date(NOW.getTime() - 7 * 864e5).toISOString(),
    windowEnd: NOW.toISOString(),
    quotesThisWeek: 6,
    quotesPrevWeek: 4,
    quotesDelta: 2,
    byStatus: { new: 4, won: 2 },
    conversions: 2,
    conversionPct: 33,
    autoRepliesSent: 3,
    callbacks: 1,
    chatConversations: 2,
    engagement: { views: 20, pdfSaves: 3, chatOpens: 2, copyLinks: 1, prints: 0, callbackOpens: 1 },
    isEmpty: false,
    ...over,
  };
}

describe('weekly digest cron audience + compliance', () => {
  beforeEach(() => {
    sendMock.mockReset();
    updateMock.mockReset();
    statsMock.mockReset();
    sendMock.mockResolvedValue({ ok: true, provider: 'resend' });
    statsMock.mockResolvedValue(nonEmptyStats());
  });

  it('sends to an active tenant WITH List-Unsubscribe url + footer link, and stamps lastWeeklyDigestAt', async () => {
    rowsRef.current = [tenant({ id: 5 })];
    const { runWeeklyDigestOnce } = await import('./weeklyDigestCron.js');
    await runWeeklyDigestOnce('test', NOW);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0] as {
      listUnsubscribeUrl?: string;
      html?: string;
      text?: string;
    };
    expect(arg.listUnsubscribeUrl).toContain('https://quotefleet.net/unsubscribe?token=');
    const { verifyUnsubscribeToken } = await import('./unsubscribe.js');
    const token = decodeURIComponent(arg.listUnsubscribeUrl!.split('token=')[1]);
    expect(verifyUnsubscribeToken(token)).toBe(5);
    // Visible footer link + plain-text parity.
    expect(arg.html).toContain('Unsubscribe from product updates');
    expect(arg.html).toContain(arg.listUnsubscribeUrl!);
    expect(arg.text).toContain('Unsubscribe:');
    // Opens/clicks placeholder, never fabricated numbers.
    expect(arg.html).toContain('coming soon');
    // lastWeeklyDigestAt stamped for the double-send guard.
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect((updateMock.mock.calls[0][0] as { lastWeeklyDigestAt?: Date }).lastWeeklyDigestAt).toEqual(NOW);
  });

  it('skips a marketing opt-out tenant', async () => {
    rowsRef.current = [tenant({ id: 6, marketingOptOut: true })];
    const { runWeeklyDigestOnce } = await import('./weeklyDigestCron.js');
    await runWeeklyDigestOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips a free (no core access) tenant', async () => {
    rowsRef.current = [tenant({ id: 7, plan: 'free', trialEndsAt: null })];
    const { runWeeklyDigestOnce } = await import('./weeklyDigestCron.js');
    await runWeeklyDigestOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips a zero-activity tenant (no "0 quotes this week" email)', async () => {
    rowsRef.current = [tenant({ id: 8 })];
    statsMock.mockResolvedValue(
      nonEmptyStats({ quotesThisWeek: 0, conversions: 0, callbacks: 0, chatConversations: 0, autoRepliesSent: 0, isEmpty: true })
    );
    const { runWeeklyDigestOnce } = await import('./weeklyDigestCron.js');
    await runWeeklyDigestOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips a tenant already sent within the 6-day cooldown', async () => {
    rowsRef.current = [tenant({ id: 9, lastWeeklyDigestAt: new Date(NOW.getTime() - 2 * 864e5) })];
    const { runWeeklyDigestOnce } = await import('./weeklyDigestCron.js');
    await runWeeklyDigestOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
