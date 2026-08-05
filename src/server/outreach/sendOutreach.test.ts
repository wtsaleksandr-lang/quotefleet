/**
 * sendOutreachEmail — Phase 3 send unit tests (network-free, DB-free).
 *
 * A fake OutreachEmailStore + an injected email sender prove the contract:
 *   - success  → returns { ok, status:'sent', providerId }, records sent_at + id.
 *   - failure  → sender error (thrown OR ok:false) is caught, recorded 'failed',
 *                NEVER re-thrown.
 *   - unconfigured → a logged-only (stdout) send surfaces as 'unconfigured'.
 *   - suppression → a suppressed draft OR a suppressed recipient address returns
 *                   { skipped:'suppressed' } and NOTHING is sent.
 *   - the wire payload uses the persisted draft's EXACT subject/html/text.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { EmailIn, EmailOut } from '../../email/send.js';
import type { OutreachEmail } from '../../db/schema.js';
import type {
  OutreachEmailStore,
  RecordSendInput,
  SaveOutreachEmailInput,
} from './outreachEmailStore.js';
import { sendOutreachEmail } from './sendOutreach.js';

// ── Fake store ─────────────────────────────────────────────────────────────
interface FakeStore extends OutreachEmailStore {
  rows: Map<number, OutreachEmail>;
  suppressedAddresses: Set<string>;
  records: Array<{ id: number; input: RecordSendInput }>;
}

function makeRow(over: Partial<OutreachEmail> = {}): OutreachEmail {
  return {
    id: 1,
    demoToken: 'demo_1',
    domain: 'acme.com',
    recipientEmail: 'dispatch@acme.com',
    unsubscribeToken: 'unsub_1',
    subject: 'Instant quotes for Acme drayage',
    bodyHtml: '<p>hi acme</p>',
    bodyText: 'hi acme',
    aiGenerated: false,
    suppressed: false,
    suppressedAt: null,
    sentAt: null,
    status: null,
    providerId: null,
    sendError: null,
    step: 1,
    nextFollowupAt: null,
    clickedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeStore(rows: OutreachEmail[] = [makeRow()]): FakeStore {
  const map = new Map<number, OutreachEmail>(rows.map((r) => [r.id, r]));
  const records: Array<{ id: number; input: RecordSendInput }> = [];
  return {
    rows: map,
    suppressedAddresses: new Set<string>(),
    records,
    async saveDraft(input: SaveOutreachEmailInput) {
      const row = makeRow({ id: map.size + 1, ...input });
      map.set(row.id, row);
      return row;
    },
    async getByUnsubscribeToken() { return null; },
    async getById(id) { return map.get(id) ?? null; },
    async suppressByToken() { return true; },
    async isRecipientSuppressed(email) {
      return this.suppressedAddresses.has(String(email).trim().toLowerCase());
    },
    async recordSend(id, input) { records.push({ id, input }); },
    async markClickedByToken() { return null; },
  };
}

const okSend = (out: EmailOut) => vi.fn(async (_msg: EmailIn) => out);

beforeAll(() => {
  // brandedFrom() (the reused app sender) reads env via loadEnv(); satisfy the
  // required vars so the module doesn't throw on the `from` header build.
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';
  process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5000';
});

describe('sendOutreachEmail', () => {
  it('sends and records sent + provider id on success', async () => {
    const store = makeStore();
    const send = okSend({ ok: true, provider: 'resend', id: 'msg_abc' });
    const r = await sendOutreachEmail({ emailId: 1, to: 'lead@acme.com' }, { store, send });

    expect(r).toMatchObject({ ok: true, status: 'sent', providerId: 'msg_abc', emailId: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const rec = store.records.at(-1)!;
    expect(rec.input.status).toBe('sent');
    expect(rec.input.providerId).toBe('msg_abc');
    expect(rec.input.sentAt).toBeInstanceOf(Date);
  });

  it('uses the persisted draft EXACT subject/html/text on the wire', async () => {
    const row = makeRow({ subject: 'S-EXACT', bodyHtml: '<b>H-EXACT</b>', bodyText: 'T-EXACT' });
    const store = makeStore([row]);
    const send = okSend({ ok: true, provider: 'smtp' });
    await sendOutreachEmail({ emailId: 1, to: 'lead@acme.com' }, { store, send });

    const msg = send.mock.calls[0][0];
    expect(msg.subject).toBe('S-EXACT');
    expect(msg.html).toBe('<b>H-EXACT</b>');
    expect(msg.text).toBe('T-EXACT');
    expect(msg.to).toBe('lead@acme.com');
    // Marketing List-Unsubscribe URL built from the draft's token.
    expect(msg.listUnsubscribeUrl).toContain('/outreach/unsubscribe/unsub_1');
  });

  it('records failed (no throw) when the sender THROWS', async () => {
    const store = makeStore();
    const send = vi.fn(async () => { throw new Error('smtp exploded'); });
    const r = await sendOutreachEmail({ emailId: 1, to: 'lead@acme.com' }, { store, send });

    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('smtp exploded');
    expect(store.records.at(-1)!.input.status).toBe('failed');
  });

  it('records failed when the sender returns ok:false', async () => {
    const store = makeStore();
    const send = okSend({ ok: false, error: 'resend HTTP 422' });
    const r = await sendOutreachEmail({ emailId: 1, to: 'lead@acme.com' }, { store, send });

    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('resend HTTP 422');
    expect(store.records.at(-1)!.input.status).toBe('failed');
  });

  it('returns unconfigured when no provider is configured (logged only)', async () => {
    const store = makeStore();
    const send = okSend({ ok: true, logged: true, provider: 'stdout' });
    const r = await sendOutreachEmail({ emailId: 1, to: 'lead@acme.com' }, { store, send });

    expect(r).toMatchObject({ ok: false, status: 'unconfigured' });
    expect(store.records.at(-1)!.input.status).toBe('unconfigured');
  });

  it('SKIPS a draft flagged suppressed — nothing sent', async () => {
    const store = makeStore([makeRow({ suppressed: true })]);
    const send = okSend({ ok: true, provider: 'resend', id: 'x' });
    const r = await sendOutreachEmail({ emailId: 1, to: 'lead@acme.com' }, { store, send });

    expect(r).toMatchObject({ ok: false, status: 'skipped', skipped: 'suppressed' });
    expect(send).not.toHaveBeenCalled();
    expect(store.records.at(-1)!.input.status).toBe('skipped');
  });

  it('SKIPS a suppressed recipient ADDRESS (address-level opt-out) — nothing sent', async () => {
    const store = makeStore();
    store.suppressedAddresses.add('lead@acme.com');
    const send = okSend({ ok: true, provider: 'resend', id: 'x' });
    const r = await sendOutreachEmail({ emailId: 1, to: 'Lead@Acme.com' }, { store, send });

    expect(r.skipped).toBe('suppressed');
    expect(send).not.toHaveBeenCalled();
  });

  it('skips with no-recipient when neither `to` nor the draft has an address', async () => {
    const store = makeStore([makeRow({ recipientEmail: null })]);
    const send = okSend({ ok: true, provider: 'resend', id: 'x' });
    const r = await sendOutreachEmail({ emailId: 1 }, { store, send });

    expect(r).toMatchObject({ ok: false, status: 'skipped', skipped: 'no-recipient' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns failed when the draft id is unknown', async () => {
    const store = makeStore([]);
    const send = okSend({ ok: true, provider: 'resend', id: 'x' });
    const r = await sendOutreachEmail({ emailId: 999, to: 'x@y.com' }, { store, send });

    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
    expect(send).not.toHaveBeenCalled();
  });

  // ── CID-embedded branded screenshot (Outlook-safe) ────────────────────────
  it('attaches the quote shot INLINE (cid:quoteshot) when the draft HTML references it', async () => {
    const row = makeRow({
      demoToken: 'demo_cid',
      bodyHtml: '<p>hi</p><img src="cid:quoteshot" alt="Acme calc">',
    });
    const store = makeStore([row]);
    const demoStore = {
      getQuoteShot: vi.fn(async () => 'QUJDPUJBU0U2NA=='), // stand-in base64 PNG
    } as unknown as import('./prospectDemoStore.js').ProspectDemoStore;
    const send = okSend({ ok: true, provider: 'resend', id: 'm1' });

    const r = await sendOutreachEmail({ emailId: 1, to: 'lead@acme.com' }, { store, send, demoStore });

    expect(r.status).toBe('sent');
    expect((demoStore.getQuoteShot as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('demo_cid');
    const msg = send.mock.calls[0][0];
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0]).toMatchObject({
      filename: 'quote.png',
      contentBase64: 'QUJDPUJBU0U2NA==',
      contentType: 'image/png',
      contentId: 'quoteshot',
      inline: true,
    });
  });

  it('does NOT attach anything when the draft HTML has no cid:quoteshot reference', async () => {
    const store = makeStore([makeRow({ bodyHtml: '<p>plain remote-image email</p>' })]);
    const demoStore = {
      getQuoteShot: vi.fn(async () => 'shouldNotBeFetched'),
    } as unknown as import('./prospectDemoStore.js').ProspectDemoStore;
    const send = okSend({ ok: true, provider: 'resend', id: 'm2' });

    await sendOutreachEmail({ emailId: 1, to: 'lead@acme.com' }, { store, send, demoStore });

    expect((demoStore.getQuoteShot as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].attachments).toBeUndefined();
  });
});
