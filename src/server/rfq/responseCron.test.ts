/**
 * RFQ response watcher — replies to the shipper, silence to ops.
 *
 * The two things worth pinning:
 *   1. The high-water mark only moves when a REAL provider took the message. A
 *      stdout-only send that advanced the marker would permanently lose the
 *      notification (#465's bug, one layer up).
 *   2. Silence self-clears. A no-reply alert that a late quote resolves — and
 *      that ages out on its own — is one the reader keeps trusting; one that
 *      never clears is one they learn to skip.
 *
 * NO DB, NO NETWORK — the read, the alert store and the mailer are injected.
 */
import { describe, it, expect } from 'vitest';
import {
  decideRfqAction,
  runRfqResponsePassOnce,
  NO_REPLY_HOURS,
  NO_REPLY_EXPIRE_DAYS,
  type RfqResponseRow,
  type RfqResponseDeps,
} from './responseCron.js';
import type { OpsAlertRow, UpsertOpsAlertInput } from '../opsAlerts.js';
import type { EmailOut } from '../../email/send.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 3600_000;

function row(over: Partial<RfqResponseRow> = {}): RfqResponseRow {
  return {
    id: 5,
    viewToken: 'tok',
    shipperEmail: 'dana@acme.test',
    shipperName: 'Dana',
    origin: 'Chicago, IL',
    destination: 'Dallas, TX',
    equipment: 'dry van',
    delivered: 12,
    lastSentAt: new Date(NOW.getTime() - 1 * HOUR),
    quoteCount: 0,
    maxQuoteId: null,
    ...over,
  };
}

function alert(over: Partial<OpsAlertRow> = {}): OpsAlertRow {
  return {
    kind: 'rfq_no_replies',
    ref: 'rfq:5',
    status: 'open',
    title: 't',
    detail: null,
    amountCents: null,
    currency: null,
    dueAt: null,
    marker: null,
    openedAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('decideRfqAction', () => {
  it('new quotes beat everything — notify', () => {
    const a = decideRfqAction(row({ quoteCount: 2, maxQuoteId: 41 }), 30, null, NOW);
    expect(a.kind).toBe('notify_quotes');
  });

  it('quotes already reported produce no action', () => {
    expect(decideRfqAction(row({ quoteCount: 2, maxQuoteId: 41 }), 41, null, NOW).kind).toBe('none');
  });

  it('a late quote CLEARS a standing no-reply alert', () => {
    const a = decideRfqAction(row({ quoteCount: 1, maxQuoteId: 9 }), 9, alert(), NOW);
    expect(a).toEqual({ kind: 'clear', reason: 'a quote arrived' });
  });

  it('stays quiet before the no-reply window', () => {
    const justInside = row({ lastSentAt: new Date(NOW.getTime() - (NO_REPLY_HOURS - 1) * HOUR) });
    expect(decideRfqAction(justInside, null, null, NOW).kind).toBe('none');
  });

  it('flags silence past the window and asks to tell the shipper once', () => {
    const silent = row({ lastSentAt: new Date(NOW.getTime() - (NO_REPLY_HOURS + 1) * HOUR) });
    const a = decideRfqAction(silent, null, null, NOW);
    expect(a).toMatchObject({ kind: 'no_replies', tellShipper: true });
  });

  it('does not re-tell a shipper who was already told', () => {
    const silent = row({ lastSentAt: new Date(NOW.getTime() - (NO_REPLY_HOURS + 1) * HOUR) });
    const a = decideRfqAction(silent, null, alert({ marker: 'shipper_notified' }), NOW);
    expect(a).toMatchObject({ kind: 'no_replies', tellShipper: false });
  });

  it('AGES OUT rather than sitting in the digest forever', () => {
    const old = row({ lastSentAt: new Date(NOW.getTime() - (NO_REPLY_EXPIRE_DAYS * 24 + 1) * HOUR) });
    const a = decideRfqAction(old, null, alert(), NOW);
    expect(a.kind).toBe('clear');
  });

  it('a request that never reached anyone has nothing to wait for', () => {
    expect(decideRfqAction(row({ lastSentAt: null }), null, null, NOW).kind).toBe('none');
  });
});

// ─── the pass ───────────────────────────────────────────────────────────────

interface Captured {
  upserts: UpsertOpsAlertInput[];
  resolves: Array<{ kind: string; ref: string; outcome: string }>;
  mails: Array<{ to: string; subject: string }>;
}

function deps(
  cap: Captured,
  rows: RfqResponseRow[],
  alerts: Record<string, OpsAlertRow | null> = {},
  send: () => Promise<EmailOut> = async () => ({ ok: true, provider: 'resend', id: 'm1' }),
): Partial<RfqResponseDeps> {
  return {
    read: async () => rows,
    countNew: async () => 2,
    getAlert: async (kind, ref) => alerts[`${kind}|${ref}`] ?? null,
    upsert: async (input) => {
      cap.upserts.push(input);
    },
    resolve: async (kind, ref, outcome) => {
      cap.resolves.push({ kind, ref, outcome });
    },
    send: (async (msg: { to: string; subject: string }) => {
      cap.mails.push({ to: msg.to, subject: msg.subject });
      return send();
    }) as RfqResponseDeps['send'],
    baseUrl: () => 'https://quotefleet.net',
    log: () => {},
  };
}

const fresh = (): Captured => ({ upserts: [], resolves: [], mails: [] });

describe('runRfqResponsePassOnce', () => {
  it('skips when nothing recent reached a carrier', async () => {
    const cap = fresh();
    const out = await runRfqResponsePassOnce(NOW, deps(cap, []));
    expect(out.status).toBe('skipped');
  });

  it('emails the shipper about new quotes and advances the marker', async () => {
    const cap = fresh();
    const out = await runRfqResponsePassOnce(NOW, deps(cap, [row({ quoteCount: 2, maxQuoteId: 41 })]));
    expect(out.status).toBe('success');
    expect(cap.mails).toEqual([{ to: 'dana@acme.test', subject: '2 new quotes on Chicago, IL → Dallas, TX' }]);
    const marker = cap.upserts.find((u) => u.kind === 'rfq_quotes_notified');
    expect(marker?.marker).toBe('41');
    expect(marker?.status).toBe('tracking');
  });

  it('does NOT advance the marker when the send was only logged (#465)', async () => {
    // Stamping "notified" on a stdout-only send loses the notification for good:
    // the marker says the shipper was told, so it is never retried.
    const cap = fresh();
    const out = await runRfqResponsePassOnce(
      NOW,
      deps(cap, [row({ quoteCount: 2, maxQuoteId: 41 })], {}, async () => ({
        ok: true,
        logged: true,
        provider: 'stdout',
      })),
    );
    expect(cap.upserts.filter((u) => u.kind === 'rfq_quotes_notified')).toHaveLength(0);
    expect(out.status).toBe('failure');
    expect(out.detail).toContain('not sent');
  });

  it('a quote notification also clears a standing no-reply alert', async () => {
    const cap = fresh();
    await runRfqResponsePassOnce(
      NOW,
      deps(cap, [row({ quoteCount: 1, maxQuoteId: 41 })], { 'rfq_no_replies|rfq:5': alert() }),
    );
    expect(cap.resolves).toEqual([{ kind: 'rfq_no_replies', ref: 'rfq:5', outcome: 'a quote arrived' }]);
  });

  it('flags a silent blast to ops AND tells the shipper once', async () => {
    const cap = fresh();
    const silent = row({ lastSentAt: new Date(NOW.getTime() - (NO_REPLY_HOURS + 2) * HOUR) });
    const out = await runRfqResponsePassOnce(NOW, deps(cap, [silent]));
    expect(out.status).toBe('success');
    expect(cap.mails[0].subject).toContain('No quotes yet');
    const flag = cap.upserts.find((u) => u.kind === 'rfq_no_replies');
    expect(flag?.status).toBe('open');
    expect(flag?.marker).toBe('shipper_notified');
    expect(flag?.detail).toContain('reached 12 carrier(s)');
  });

  it('records the flag with "NOT yet told" when the shipper email failed', async () => {
    const cap = fresh();
    const silent = row({ lastSentAt: new Date(NOW.getTime() - (NO_REPLY_HOURS + 2) * HOUR) });
    const out = await runRfqResponsePassOnce(NOW, deps(cap, [silent], {}, async () => ({ ok: false, error: 'x' })));
    const flag = cap.upserts.find((u) => u.kind === 'rfq_no_replies');
    expect(flag?.marker).toBeNull();
    expect(flag?.detail).toContain('NOT yet told');
    expect(out.status).toBe('failure');
  });

  it('one broken request does not stop the others, but the pass still FAILS', async () => {
    const cap = fresh();
    let n = 0;
    const d = deps(cap, [row({ id: 1, quoteCount: 1, maxQuoteId: 10 }), row({ id: 2, quoteCount: 1, maxQuoteId: 20 })]);
    const out = await runRfqResponsePassOnce(NOW, {
      ...d,
      getAlert: async () => {
        n++;
        if (n <= 2) throw new Error('alert store down');
        return null;
      },
    });
    expect(out.status).toBe('failure');
    expect(cap.mails).toHaveLength(1); // the second request still went through
  });

  it('a read failure PROPAGATES — a pass that cannot see quotes must not report "none"', async () => {
    const cap = fresh();
    await expect(
      runRfqResponsePassOnce(NOW, {
        ...deps(cap, []),
        read: async () => {
          throw new Error('db down');
        },
      }),
    ).rejects.toThrow('db down');
  });
});
