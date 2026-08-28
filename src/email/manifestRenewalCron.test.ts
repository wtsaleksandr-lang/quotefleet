/**
 * Manifest Privacy renewal cron — band selection, T-180/90/60/30/7 sends, and
 * the per-row double-send guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { poaApplications } from '../db/schema.js';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as { table: unknown; vals: Record<string, unknown> }[],
  inserts: [] as { table: unknown; vals: Record<string, unknown> }[],
  emails: [] as { to: string; subject: string }[],
}));

vi.mock('../config.js', () => ({
  loadEnv: () => ({ PUBLIC_BASE_URL: 'http://localhost:5000' }),
}));

vi.mock('./send.js', () => ({
  sendEmail: vi.fn(async (msg: { to: string; subject: string }) => {
    state.emails.push({ to: msg.to, subject: msg.subject });
    return { ok: true };
  }),
}));

vi.mock('../db/client.js', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(state.rows) }) }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          state.updates.push({ table, vals });
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        state.inserts.push({ table, vals });
        return Promise.resolve();
      },
    }),
  }),
}));

const { runManifestRenewalOnce, bandFor, RENEWAL_BANDS } = await import('./manifestRenewalCron.js');

const NOW = new Date('2026-08-20T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
function appExpiringInDays(days: number, extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    publicToken: 'tok_1',
    status: 'active',
    grantorLegalName: 'Acme Imports LLC',
    signerEmail: 'jane@acme.test',
    expiresAt: new Date(NOW.getTime() + days * DAY),
    lastReminderAt: null,
    ...extra,
  };
}

beforeEach(() => {
  state.rows = [];
  state.updates = [];
  state.inserts = [];
  state.emails = [];
});

describe('bandFor', () => {
  it('selects the tightest matching band', () => {
    expect(bandFor(85)).toBe(90);
    expect(bandFor(55)).toBe(60);
    expect(bandFor(20)).toBe(30);
    expect(bandFor(5)).toBe(7);
  });
  it('reminds at ~18 months into the 2-year term (the T-180 band)', () => {
    // CBP grants confidentiality for two years, never auto-renews, and sends no
    // expiry notice — so the customer hears from us six months out.
    expect(bandFor(170)).toBe(180);
    expect(bandFor(120)).toBe(180);
  });
  it('is null outside the widest window / after expiry', () => {
    expect(bandFor(200)).toBeNull();
    expect(bandFor(-1)).toBeNull();
  });
  it('exposes the five bands', () => {
    expect([...RENEWAL_BANDS]).toEqual([180, 90, 60, 30, 7]);
  });
});

describe('runManifestRenewalOnce', () => {
  it('sends a reminder, moves to renewal_due, stamps the guard + logs the event', async () => {
    state.rows = [appExpiringInDays(85)];
    await runManifestRenewalOnce('test', NOW);
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0].to).toBe('jane@acme.test');
    // status → renewal_due + lastReminderAt stamped
    const upd = state.updates.find((u) => u.table === poaApplications);
    expect(upd?.vals.status).toBe('renewal_due');
    expect(upd?.vals.lastReminderAt).toEqual(NOW);
    // audit event logged
    expect(state.inserts.some((i) => i.vals.event === 'renewal_reminded')).toBe(true);
  });

  it('does NOT re-send within the cooldown (double-send guard)', async () => {
    state.rows = [appExpiringInDays(85, { lastReminderAt: new Date(NOW.getTime() - 2 * DAY) })];
    await runManifestRenewalOnce('test', NOW);
    expect(state.emails).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it('fires again at a later band once the cooldown has passed', async () => {
    state.rows = [appExpiringInDays(7, { lastReminderAt: new Date(NOW.getTime() - 30 * DAY) })];
    await runManifestRenewalOnce('test', NOW);
    expect(state.emails).toHaveLength(1);
  });
});
