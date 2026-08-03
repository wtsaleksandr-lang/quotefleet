/**
 * Trial-end card reminders (day 11 + day 14) — the card-after-trial nudges.
 *
 * Covers:
 *   1. Window selection (decideNextEmail, deterministic `now`):
 *        - a tenant at day 11 is selected for the day-11 reminder
 *        - a tenant at day 14 (last day) is selected for the day-14 reminder
 *        - a tenant at day 5 is NOT selected for either
 *        - an already-paid tenant is NOT selected (never nudge a payer)
 *        - a long-expired tenant is NOT selected for a card reminder
 *   2. Idempotency (runOnce twice): each reminder sends AT MOST once — the
 *      second pass, with the sent-stamp persisted, sends nothing.
 *   3. Graceful no-op when email is unconfigured (stdout-logged) — no throw.
 *   4. A tenant with no owner email is never emailed (runOnce).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const { sendMock, rowsRef, storeRef } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  rowsRef: { current: [] as Record<string, unknown>[] },
  // Mutable persistence: update().set() merges back into every row in rowsRef,
  // so a second runOnce sees what the first one stamped (real idempotency).
  storeRef: { current: [] as Record<string, unknown>[] },
}));

vi.mock('./send.js', () => ({ sendEmail: sendMock }));

vi.mock('../db/client.js', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(rowsRef.current) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        // Persist the write back onto the in-memory rows (single-tenant tests).
        for (const row of rowsRef.current) Object.assign(row, v);
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

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-20T12:00:00.000Z').getTime();

/** A trialing tenant whose trial ends `daysLeft` from NOW (14-day trial). */
function tenant(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    slug: 'acme',
    hostDomain: 'quotefleet.net',
    name: 'Acme Freight',
    contactEmail: 'owner@acme.com',
    plan: 'free',
    trialEndsAt: new Date(NOW + 3 * DAY), // day 11 by default (14 - 3)
    lifecycleEmailsJson: { welcome: '2026-07-09T00:00:00.000Z', day_7: '2026-07-16T00:00:00.000Z' },
    marketingOptOut: false,
    ...over,
  };
}

describe('trial-end card reminders — window selection', () => {
  it('selects the day-11 reminder for a tenant ~3 days from trial end', async () => {
    const { decideNextEmail } = await import('./lifecycleCron.js');
    const email = decideNextEmail(tenant({ trialEndsAt: new Date(NOW + 3 * DAY) }) as never, NOW);
    expect(email?.key).toBe('trialReminderDay11SentAt');
    expect(email?.subject).toContain('3 days left');
  });

  it('selects the day-14 reminder on the last day of the trial', async () => {
    const { decideNextEmail } = await import('./lifecycleCron.js');
    // ~12h before trial end → day 14 (ageDays ≈ 13.5), with day-11 already sent.
    const t = tenant({
      trialEndsAt: new Date(NOW + 0.5 * DAY),
      lifecycleEmailsJson: {
        welcome: 'x',
        day_7: 'x',
        trialReminderDay11SentAt: 'x',
        day_12: 'x',
      },
    });
    const email = decideNextEmail(t as never, NOW);
    expect(email?.key).toBe('trialReminderDay14SentAt');
    expect(email?.subject).toContain('ends today');
  });

  it('does NOT select a card reminder for a tenant at day 5', async () => {
    const { decideNextEmail } = await import('./lifecycleCron.js');
    const email = decideNextEmail(tenant({ trialEndsAt: new Date(NOW + 9 * DAY) }) as never, NOW);
    // Welcome + day_7 already sent, ageDays ≈ 5 → nothing due.
    expect(email).toBeNull();
  });

  it('does NOT nudge an already-paid tenant to add a card', async () => {
    const { decideNextEmail } = await import('./lifecycleCron.js');
    const email = decideNextEmail(
      tenant({ plan: 'vital', trialEndsAt: new Date(NOW + 3 * DAY) }) as never,
      NOW,
    );
    expect(email).toBeNull();
  });

  it('does NOT send a card reminder to a long-expired tenant', async () => {
    const { decideNextEmail } = await import('./lifecycleCron.js');
    const email = decideNextEmail(
      tenant({
        trialEndsAt: new Date(NOW - 40 * DAY),
        lifecycleEmailsJson: { welcome: 'x', day_7: 'x', day_12: 'x', day_14_expired: 'x' },
      }) as never,
      NOW,
    );
    // Past expiry → neither day-11 nor day-14 reminder; expiry email already sent.
    expect(email).toBeNull();
  });
});

describe('trial-end card reminders — runOnce (idempotency + graceful)', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ ok: true, provider: 'resend' });
    rowsRef.current = [];
  });

  it('sends the day-11 reminder AT MOST once across two passes', async () => {
    rowsRef.current = [tenant({ id: 42, trialEndsAt: new Date(Date.now() + 3 * DAY) })];
    const { runOnce } = await import('./lifecycleCron.js');

    await runOnce('test-1');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0] as { subject?: string; listUnsubscribeUrl?: string };
    expect(arg.subject).toContain('3 days left');
    expect(arg.listUnsubscribeUrl).toContain('https://quotefleet.net/unsubscribe?token=');
    // The stamp was persisted onto the row.
    expect(
      (rowsRef.current[0].lifecycleEmailsJson as Record<string, string>).trialReminderDay11SentAt,
    ).toBeTruthy();

    // Second pass — nothing new is due.
    await runOnce('test-2');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('never emails a tenant with no owner email', async () => {
    rowsRef.current = [
      tenant({ id: 7, contactEmail: null, trialEndsAt: new Date(Date.now() + 3 * DAY) }),
    ];
    const { runOnce } = await import('./lifecycleCron.js');
    await runOnce('test');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not throw when email is unconfigured (stdout-logged send)', async () => {
    // Unconfigured provider → send.js returns ok:true, logged:true (no throw).
    sendMock.mockResolvedValue({ ok: true, logged: true, provider: 'stdout' });
    rowsRef.current = [tenant({ id: 9, trialEndsAt: new Date(Date.now() + 3 * DAY) })];
    const { runOnce } = await import('./lifecycleCron.js');
    await expect(runOnce('test')).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
