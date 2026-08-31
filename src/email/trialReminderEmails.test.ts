/**
 * Trial-email sequence — the reconciled card-after-trial set.
 *
 * The full trial sequence (14-day trial, no two touches within ~2 days):
 *   welcome (day 0) → day_7 (day 7) → day-11 card nudge → day-14 "ends today"
 *   → day_14_expired win-back (day 15+).
 *
 * Covers:
 *   1. Window selection (decideNextEmail, deterministic `now`):
 *        - a tenant at day 11 is selected for the day-11 reminder
 *        - a tenant at day 14 (last day) is selected for the day-14 reminder
 *        - a tenant at day 5 is NOT selected for either
 *        - an already-paid tenant is NOT selected (never nudge a payer)
 *        - a long-expired tenant is NOT selected for a card reminder
 *   2. Sequence spacing: a never-upgrading tenant's trial emails never fire
 *      within ~2 days of each other, the retired day_12 never fires, and each
 *      touch fires exactly once.
 *   3. Idempotency (runOnce twice): each reminder sends AT MOST once.
 *   4. Graceful no-op when email is unconfigured (stdout-logged) — no throw.
 *   5. A tenant with no owner email is never emailed (runOnce).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const { sendMock, rowsRef } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  rowsRef: { current: [] as Record<string, unknown>[] },
}));

// Only `sendEmail` is stubbed — `wasSentByAProvider` stays REAL.
vi.mock('./send.js', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  sendEmail: sendMock,
}));

vi.mock('../db/client.js', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(rowsRef.current) }) }),
    update: () => ({
      // Mutable persistence: merge the write back onto every in-memory row so a
      // second runOnce sees what the first one stamped (real idempotency).
      set: (v: Record<string, unknown>) => {
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

/** A trialing tenant whose trial ends 3 days from NOW (→ day 11) by default. */
function tenant(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    slug: 'acme',
    hostDomain: 'quotefleet.net',
    name: 'Acme Freight',
    contactEmail: 'owner@acme.com',
    plan: 'free',
    trialEndsAt: new Date(NOW + 3 * DAY),
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
      lifecycleEmailsJson: { welcome: 'x', day_7: 'x', trialReminderDay11SentAt: 'x' },
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
        lifecycleEmailsJson: { welcome: 'x', day_7: 'x', day_14_expired: 'x' },
      }) as never,
      NOW,
    );
    // Past expiry → neither day-11 nor day-14 reminder; expiry email already sent.
    expect(email).toBeNull();
  });
});

describe('trial email sequence — coherent spacing', () => {
  // Fixed trial end so `now` can be dialed to any ageDays.
  const TRIAL_END = new Date('2026-08-01T00:00:00.000Z').getTime();
  const TRIAL_START = TRIAL_END - 14 * DAY;

  it('never fires two trial emails within ~2 days, and retires day_12', async () => {
    const { decideNextEmail } = await import('./lifecycleCron.js');

    // Walk a never-upgrading free tenant across the trial in 0.1-day steps,
    // accumulating sent-keys as each email first fires (mirrors the cron, which
    // stamps each key once). Record the ageDay at which each key first fires.
    const sent: Record<string, string> = {};
    const fireDay: Record<string, number> = {};
    for (let i = 0; i <= 200; i++) {
      const ageDays = i / 10;
      const now = TRIAL_START + ageDays * DAY;
      const t = tenant({ trialEndsAt: new Date(TRIAL_END), lifecycleEmailsJson: { ...sent } });
      const email = decideNextEmail(t as never, now);
      if (email && !(email.key in fireDay)) {
        fireDay[email.key] = ageDays;
        sent[email.key] = new Date(now).toISOString();
      }
    }

    // The full sequence fired, at the expected days, exactly once each.
    expect(fireDay.welcome).toBeCloseTo(0, 5);
    expect(fireDay.day_7).toBeCloseTo(7, 5);
    expect(fireDay.trialReminderDay11SentAt).toBeCloseTo(11, 5);
    expect(fireDay.trialReminderDay14SentAt).toBeCloseTo(13, 5);
    expect(fireDay.day_14_expired).toBeCloseTo(15, 5);

    // The retired "ends in 2 days" email must never fire.
    expect(fireDay.day_12).toBeUndefined();

    // No two trial-window touches (day_7 onward) land within ~2 days.
    const trialTouchDays = [
      fireDay.day_7,
      fireDay.trialReminderDay11SentAt,
      fireDay.trialReminderDay14SentAt,
      fireDay.day_14_expired,
    ].sort((a, b) => a - b);
    for (let k = 1; k < trialTouchDays.length; k++) {
      expect(trialTouchDays[k] - trialTouchDays[k - 1]).toBeGreaterThanOrEqual(1.9);
    }
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
    // runOnce now reports a TickResult instead of void, so the scheduling site
    // can tell a clean tick from a swallowed exception (see server/jobHealth.ts).
    // The assertion here is unchanged in spirit: it must RESOLVE, not throw.
    await expect(runOnce('test')).resolves.toMatchObject({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
