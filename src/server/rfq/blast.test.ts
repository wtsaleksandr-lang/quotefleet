/**
 * RFQ fan-out — the outcome that used to be thrown away.
 *
 * THE BUG THIS PINS: the send route counted `sent`, `no_email` and `opted_out`
 * and NOT `failed`. A blast in which every delivery hard-failed rendered "0
 * Requests sent" and recorded nothing anywhere. With RFQ_LIVE_SEND now ON these
 * are real emails to real carriers, so a half-failed blast has to be loud.
 *
 * NO NETWORK, NO DB: the mailer is injected via SendRfqDeps.send and the store
 * is a two-method fake.
 */
import { describe, it, expect, vi } from 'vitest';
import { runRfqBlast, rfqBlastOutcome, runTrackedRfqBlast, type RfqBlastDeps } from './blast.js';
import type { RfqRequest, RfqRecipient, RfqRecipientStatus } from '../../db/schema.js';
import type { EmailOut } from '../../email/send.js';
import type { JobOutcome } from '../jobHealth.js';

// The live-send path calls brandedFrom() → loadEnv(), which requires
// DATABASE_URL; satisfy it with a dummy (same as routes/rfq.test.ts). Nothing
// here opens a connection — the mailer is injected.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';

const request = {
  id: 77,
  origin: 'Chicago, IL',
  destination: 'Dallas, TX',
  shipperName: 'Dana',
  shipperCompany: null,
  equipment: 'dry van',
  notes: null,
  containerType: null,
  commodity: null,
  weight: null,
  readyDate: null,
  targetRate: null,
} as unknown as RfqRequest;

function rec(id: number, status: RfqRecipientStatus, email: string | null = `c${id}@carrier.test`): RfqRecipient {
  return {
    id,
    rfqId: 77,
    carrierDot: String(id),
    carrierName: `Carrier ${id}`,
    carrierEmail: email,
    status,
    draftSubject: 'S',
    draftBody: 'B',
    quoteToken: `tok${id}`,
    sentAt: null,
    createdAt: new Date(),
  } as unknown as RfqRecipient;
}

interface Store {
  statuses: Array<{ id: number; status: RfqRecipientStatus }>;
  drafts: Array<{ id: number; subject: string; body: string }>;
}

function blastDeps(
  store: Store,
  send: (msg: unknown) => Promise<EmailOut>,
  over: Partial<RfqBlastDeps> = {},
): RfqBlastDeps {
  return {
    store: {
      markRecipientStatus: async (id, status) => {
        store.statuses.push({ id, status });
      },
      updateRecipientDraft: async (id, subject, body) => {
        store.drafts.push({ id, subject, body });
      },
    },
    edited: (r) => ({ subject: r.draftSubject ?? '', body: r.draftBody ?? '' }),
    sendDeps: { send: send as RfqBlastDeps['sendDeps']['send'], liveSend: true },
    liveSend: true,
    throttleMs: 0,
    sleep: async () => {},
    ...over,
  };
}

const fresh = (): Store => ({ statuses: [], drafts: [] });
const okSend = async (): Promise<EmailOut> => ({ ok: true, provider: 'resend', id: 'm1' });
const failSend = async (): Promise<EmailOut> => ({ ok: false, error: 'mailbox full' });
const stdoutSend = async (): Promise<EmailOut> => ({ ok: true, logged: true, provider: 'stdout' });

describe('runRfqBlast — the breakdown', () => {
  it('counts sent, failed and suppressed separately', async () => {
    const store = fresh();
    const r = await runRfqBlast(
      request,
      [rec(1, 'pending'), rec(2, 'pending'), rec(3, 'no_email', null), rec(4, 'opted_out')],
      blastDeps(store, okSend),
    );
    expect(r.attempted).toBe(2);
    expect(r.sent).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.noEmail).toBe(1);
    expect(r.optedOutBefore).toBe(1);
  });

  it('captures WHY each delivery failed — the reason used to be discarded', async () => {
    const store = fresh();
    const r = await runRfqBlast(request, [rec(1, 'pending')], blastDeps(store, failSend));
    expect(r.failed).toBe(1);
    expect(r.errors).toEqual(['Carrier 1: mailbox full']);
    expect(store.statuses).toEqual([{ id: 1, status: 'failed' }]);
  });

  it('a stdout-only send is a FAILURE, not a delivery (#465)', async () => {
    // sendEmail returns ok:true with no provider when none is configured. Calling
    // that "sent" marks the carrier contacted for a message nobody ever received.
    const store = fresh();
    const r = await runRfqBlast(request, [rec(1, 'pending')], blastDeps(store, stdoutSend));
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toContain('logged only');
  });

  it('one dead mailbox does not abort the rest of the blast', async () => {
    const store = fresh();
    let n = 0;
    const flaky = async (): Promise<EmailOut> => {
      n++;
      return n === 1 ? { ok: false, error: 'bounce' } : { ok: true, provider: 'resend', id: 'x' };
    };
    const r = await runRfqBlast(
      request,
      [rec(1, 'pending'), rec(2, 'pending'), rec(3, 'pending')],
      blastDeps(store, flaky),
    );
    expect(r.attempted).toBe(3);
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(2);
  });

  it('a dry run PREPARES, it does not send', async () => {
    const store = fresh();
    const send = vi.fn(okSend);
    const r = await runRfqBlast(
      request,
      [rec(1, 'pending')],
      blastDeps(store, send, { liveSend: false, sendDeps: { send, liveSend: false } }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(r.prepared).toBe(1);
    expect(r.dryRun).toBe(true);
  });

  it('never re-sends a recipient that is already terminal', async () => {
    const store = fresh();
    const send = vi.fn(okSend);
    const r = await runRfqBlast(
      request,
      [rec(1, 'sent'), rec(2, 'quoted'), rec(3, 'opted_out')],
      blastDeps(store, send),
    );
    expect(send).not.toHaveBeenCalled();
    expect(r.attempted).toBe(0);
  });

  it('persists an edited draft before sending it', async () => {
    const store = fresh();
    await runRfqBlast(
      request,
      [rec(1, 'pending')],
      blastDeps(store, okSend, { edited: () => ({ subject: 'EDITED', body: 'NEW BODY' }) }),
    );
    expect(store.drafts).toEqual([{ id: 1, subject: 'EDITED', body: 'NEW BODY' }]);
  });
});

describe('rfqBlastOutcome — what the ledger records', () => {
  const base = {
    rfqId: 77,
    attempted: 3,
    sent: 3,
    prepared: 0,
    suppressed: 0,
    failed: 0,
    noEmail: 0,
    optedOutBefore: 0,
    errors: [] as string[],
    dryRun: false,
    finalStatus: new Map<number, RfqRecipientStatus>(),
  };

  it('a clean live blast is a success carrying the true count', () => {
    const o = rfqBlastOutcome(base);
    expect(o.status).toBe('success');
    expect(o.processed).toBe(3);
  });

  it('ANY hard failure makes the whole blast a failure — this is what alerts', () => {
    const o = rfqBlastOutcome({ ...base, sent: 2, failed: 1, errors: ['Carrier 3: bounce'] });
    expect(o.status).toBe('failure');
    expect(o.detail).toContain('1 of 3');
    expect(o.detail).toContain('Carrier 3: bounce');
  });

  it('caps the reported reasons but says how many were dropped', () => {
    const errors = ['a: 1', 'b: 2', 'c: 3', 'd: 4', 'e: 5'];
    const o = rfqBlastOutcome({ ...base, attempted: 5, sent: 0, failed: 5, errors });
    expect(o.detail).toContain('+2 more');
  });

  it('a DRY RUN is skipped, never success — nothing left the building (#465)', () => {
    const o = rfqBlastOutcome({ ...base, sent: 0, prepared: 3, dryRun: true });
    expect(o.status).toBe('skipped');
    expect(o.detail).toContain('RFQ_LIVE_SEND is off');
  });

  it('a re-post with nothing pending is skipped, not a zero-count success', () => {
    const o = rfqBlastOutcome({ ...base, attempted: 0, sent: 0 });
    expect(o.status).toBe('skipped');
    expect(o.detail).toContain('nothing pending');
  });
});

describe('runTrackedRfqBlast', () => {
  it('records the outcome through the ledger', async () => {
    const recorded: Array<{ job: string; outcome: JobOutcome }> = [];
    const track = (async (job: string, fn: () => Promise<JobOutcome>) => {
      const outcome = await fn();
      recorded.push({ job, outcome });
      return outcome;
    }) as unknown as typeof runTrackedRfqBlast extends never ? never : Parameters<typeof runTrackedRfqBlast>[3];
    const store = fresh();
    await runTrackedRfqBlast(request, [rec(1, 'pending')], blastDeps(store, failSend), track);
    expect(recorded[0].job).toBe('rfq-blast');
    expect(recorded[0].outcome.status).toBe('failure');
  });

  it('records AND rethrows a structural failure, so the route 500s instead of lying', async () => {
    const recorded: JobOutcome[] = [];
    const track = (async (_job: string, fn: () => Promise<JobOutcome>) => {
      const outcome = await fn();
      recorded.push(outcome);
      return outcome;
    }) as unknown as Parameters<typeof runTrackedRfqBlast>[3];
    const store = fresh();
    const deps = blastDeps(store, okSend, {
      store: {
        markRecipientStatus: async () => {
          throw new Error('store exploded');
        },
        updateRecipientDraft: async () => {},
      },
    });
    await expect(runTrackedRfqBlast(request, [rec(1, 'pending')], deps, track)).rejects.toThrow(
      'store exploded',
    );
    expect(recorded[0].status).toBe('failure');
    expect(recorded[0].detail).toContain('aborted');
  });
});
