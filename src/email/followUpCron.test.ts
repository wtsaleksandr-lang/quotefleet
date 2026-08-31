/**
 * Follow-up SENDER cron — the selection + idempotency + stop-condition behavior
 * of a real tick (runOnce), with the DB and email transport mocked.
 *
 * Proves:
 *   1. Sends only a DUE lead's touch, and passes a List-Unsubscribe URL.
 *   2. Never double-sends a touch already recorded in followUpsSentJson, and
 *      records the touch after a successful send.
 *   3. Skips leads that converted (status≠'new'), opted out, or have no email.
 *   4. Honors the tenant's follow-up ENABLE flag (disabled ⇒ no send).
 *   5. Honors the plan gate (free, no trial ⇒ no send).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { brandConfigs, tenants, leads } from '../db/schema.js';

const { sendMock, tableRows, updateMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  tableRows: new Map<unknown, unknown[]>(),
  updateMock: vi.fn(),
}));

// Only `sendEmail` is stubbed. `wasSentByAProvider` stays REAL so the test
// exercises the actual "ok is not sent" predicate rather than a copy of it.
vi.mock('./send.js', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  sendEmail: sendMock,
  // brandedFrom is called by the cron; keep the real-ish shape without env.
  brandedFrom: (name: string) => `${name} <hello@quotefleet.net>`,
}));

vi.mock('../db/client.js', () => ({
  db: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => Promise.resolve(tableRows.get(table) ?? []),
      }),
    }),
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

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 30);

/** A brand row with follow-up enabled (standard cadence: day 2/5/9). */
function brand(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: 1,
    displayName: 'Harbor Link Logistics',
    logoUrl: null,
    featuresJson: { followUp: { enabled: true, preset: 'standard' } },
    ...over,
  };
}

function tenant(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: 'Harbor Link',
    plan: 'pro', // pro ⇒ passes canUseProFeature
    trialEndsAt: null,
    ...over,
  };
}

function lead(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 100,
    tenantId: 1,
    refId: 'QF-2026-0100',
    customerName: 'Dana Ruiz',
    customerEmail: 'dana@shipper.com',
    pickupCity: 'Long Beach, CA',
    deliveryCity: 'Phoenix, AZ',
    quotedTotal: 2450,
    quotedCurrency: 'USD',
    status: 'new',
    followUpOptOut: false,
    followUpsSentJson: null,
    createdAt: new Date(NOW - 3 * DAY), // past day1 (2) ⇒ nudge due
    ...over,
  };
}

function setup(opts: { brands?: unknown[]; tenants?: unknown[]; leads?: unknown[] }) {
  tableRows.set(brandConfigs, opts.brands ?? [brand()]);
  tableRows.set(tenants, opts.tenants ?? [tenant()]);
  tableRows.set(leads, opts.leads ?? [lead()]);
}

describe('follow-up sender cron', () => {
  beforeEach(() => {
    sendMock.mockReset();
    updateMock.mockReset();
    sendMock.mockResolvedValue({ ok: true, provider: 'resend' });
    tableRows.clear();
  });

  it('sends a DUE lead its nudge with a List-Unsubscribe URL, then records it', async () => {
    setup({ leads: [lead()] });
    const { runOnce } = await import('./followUpCron.js');
    await runOnce('test', NOW);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.to).toBe('dana@shipper.com');
    expect(typeof arg.listUnsubscribeUrl).toBe('string');
    expect(arg.listUnsubscribeUrl).toContain('/unsubscribe?token=L100.');
    // The touch is recorded so it won't send again.
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0].followUpsSentJson).toHaveProperty('nudge');
  });

  it('never double-sends a touch already recorded', async () => {
    // Nudge already sent and it isn't yet day2 ⇒ nothing due.
    setup({ leads: [lead({ followUpsSentJson: { nudge: '2026-01-28T00:00:00Z' } })] });
    const { runOnce } = await import('./followUpCron.js');
    await runOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips a converted (booked) lead — status is not "new"', async () => {
    setup({ leads: [lead({ status: 'won' })] });
    const { runOnce } = await import('./followUpCron.js');
    await runOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips a lead that opted out of follow-ups', async () => {
    setup({ leads: [lead({ followUpOptOut: true })] });
    const { runOnce } = await import('./followUpCron.js');
    await runOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips a lead with no email', async () => {
    setup({ leads: [lead({ customerEmail: null })] });
    const { runOnce } = await import('./followUpCron.js');
    await runOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('honors the follow-up ENABLE flag (disabled ⇒ no send)', async () => {
    setup({ brands: [brand({ featuresJson: { followUp: { enabled: false, preset: 'standard' } } })] });
    const { runOnce } = await import('./followUpCron.js');
    await runOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('honors the plan gate — free tenant with no trial gets no follow-ups', async () => {
    setup({ tenants: [tenant({ plan: 'free', trialEndsAt: null })] });
    const { runOnce } = await import('./followUpCron.js');
    await runOnce('test', NOW);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not record the send if the transport fails', async () => {
    sendMock.mockResolvedValue({ ok: false, error: 'boom' });
    setup({ leads: [lead()] });
    const { runOnce } = await import('./followUpCron.js');
    await runOnce('test', NOW);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
