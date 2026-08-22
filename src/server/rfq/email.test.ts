/**
 * RFQ email tests — template content + the LIVE-SEND gate + suppression-first,
 * all with an injected sender (no network). Proves the dry-run path NEVER calls
 * the network sender, live send does, and suppression short-circuits both.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildCarrierRfqEmail, buildDraftedRfqEmail, sendRfqToCarrier, quoteUrl, optOutUrl } from './email.js';
import { SENDER_ADDRESS } from '../outreach/draftEmail.js';
import type { EmailOut } from '../../email/send.js';
import type { RfqRequest, RfqRecipient } from '../../db/schema.js';

// brandedFrom() (the reused app sender) reads env via loadEnv(), which requires
// DATABASE_URL. Satisfy it with a dummy so the live-send path doesn't throw.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5000';

const BASE = 'https://quotefleet.net';

const request = (over: Partial<RfqRequest> = {}): RfqRequest => ({
  id: 1,
  viewToken: 'view-token-abc',
  shipperName: 'Dana Shipper',
  shipperCompany: 'Dana Logistics',
  shipperEmail: 'dana@shipper.example',
  shipperPhone: null,
  origin: 'Los Angeles, CA',
  destination: 'Dallas, TX',
  equipment: 'Reefer',
  containerType: null,
  commodity: 'Produce',
  weight: '42,000 lbs',
  readyDate: '2026-09-01',
  targetRate: '$2,400',
  notes: 'Appointment required.',
  filterSnapshot: null,
  status: 'open',
  createdAt: new Date('2026-08-20T00:00:00Z'),
  ...over,
});

const recipient = (over: Partial<RfqRecipient> = {}): RfqRecipient => ({
  id: 10,
  rfqId: 1,
  carrierDot: '12345',
  carrierName: 'Acme Freight',
  carrierEmail: 'ops@acme.example',
  status: 'pending',
  draftSubject: null,
  draftBody: null,
  quoteToken: 'quote-token-xyz',
  sentAt: null,
  createdAt: new Date('2026-08-20T00:00:00Z'),
  ...over,
});

const okOut: EmailOut = { ok: true, provider: 'resend', id: 'msg_1' };

describe('buildCarrierRfqEmail', () => {
  it('renders the lane, quote link, opt-out link and physical address', () => {
    const built = buildCarrierRfqEmail(request(), recipient(), BASE);
    expect(built.subject).toContain('Los Angeles, CA → Dallas, TX');
    expect(built.subject).toContain('Reefer');
    // Body carries both the quote link and the one-click opt-out link.
    expect(built.text).toContain(quoteUrl(BASE, 'quote-token-xyz'));
    expect(built.text).toContain(optOutUrl(BASE, 'quote-token-xyz'));
    expect(built.html).toContain(quoteUrl(BASE, 'quote-token-xyz'));
    // Compliance: physical mailing address present.
    expect(built.text).toContain(SENDER_ADDRESS);
    // Detail lines present.
    expect(built.text).toContain('Produce');
    expect(built.text).toContain('42,000 lbs');
  });

  it('omits absent optional detail lines', () => {
    const built = buildCarrierRfqEmail(request({ commodity: null, weight: null, notes: null }), recipient(), BASE);
    expect(built.text).not.toContain('Commodity:');
    expect(built.text).not.toContain('Notes:');
  });
});

describe('buildDraftedRfqEmail', () => {
  it('renders the drafted letter body + quote link + opt-out + address', () => {
    const draft = {
      subject: 'Rate request: LA to Dallas, reefer',
      body: 'Dear Acme Freight,\n\nSaw your reefer freight. I have a load LA to Dallas.\n\nDana Shipper, Dana Logistics',
    };
    const built = buildDraftedRfqEmail(request(), recipient(), BASE, draft);
    expect(built.subject).toBe('Rate request: LA to Dallas, reefer');
    // The personalized greeting + body survive into both text and html.
    expect(built.text).toContain('Dear Acme Freight,');
    expect(built.html).toContain('Dear Acme Freight,');
    // Compliance chrome is still attached.
    expect(built.text).toContain(quoteUrl(BASE, 'quote-token-xyz'));
    expect(built.text).toContain(optOutUrl(BASE, 'quote-token-xyz'));
    expect(built.text).toContain(SENDER_ADDRESS);
  });

  it('falls back to a lane subject when the draft subject is blank', () => {
    const built = buildDraftedRfqEmail(request(), recipient(), BASE, { subject: '', body: 'Dear X,\n\nhi' });
    expect(built.subject).toContain('Los Angeles, CA → Dallas, TX');
  });
});

describe('sendRfqToCarrier — uses the persisted draft when present', () => {
  it('LIVE send renders the drafted body, not the static template', async () => {
    let captured: { text?: string; subject?: string } = {};
    const send = vi.fn(async (msg: { text?: string; subject?: string }) => {
      captured = msg;
      return okOut;
    });
    const res = await sendRfqToCarrier(
      request(),
      recipient({ draftSubject: 'Custom subject', draftBody: 'Dear Acme Freight,\n\nCustom personalized ask.\n\nDana' }),
      { send, liveSend: true, baseUrl: BASE },
    );
    expect(res.status).toBe('sent');
    expect(captured.subject).toBe('Custom subject');
    expect(captured.text).toContain('Custom personalized ask.');
    // The static template opener must NOT appear when a draft is used.
    expect(captured.text).not.toContain('A shipper is requesting a rate for the following shipment');
  });
});

describe('sendRfqToCarrier — LIVE-SEND gate', () => {
  it('DRY-RUN (gate off): reports sent + dryRun and NEVER calls the sender', async () => {
    const send = vi.fn(async () => okOut);
    const res = await sendRfqToCarrier(request(), recipient(), { send, liveSend: false });
    expect(res.status).toBe('sent');
    expect(res.dryRun).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('LIVE (gate on): actually calls the sender and returns the provider id', async () => {
    const send = vi.fn(async () => okOut);
    const res = await sendRfqToCarrier(request(), recipient(), { send, liveSend: true, baseUrl: BASE });
    expect(send).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('sent');
    expect(res.dryRun).toBe(false);
    expect(res.providerId).toBe('msg_1');
    // Compliance: honest From + one-click List-Unsubscribe = the opt-out link.
    const msg = (send.mock.calls[0] as unknown[])[0] as { to: string; listUnsubscribeUrl?: string };
    expect(msg.to).toBe('ops@acme.example');
    expect(msg.listUnsubscribeUrl).toBe(optOutUrl(BASE, 'quote-token-xyz'));
  });

  it('SUPPRESSION FIRST: never sends to a suppressed address, even live', async () => {
    const send = vi.fn(async () => okOut);
    const res = await sendRfqToCarrier(request(), recipient(), {
      send,
      liveSend: true,
      isEmailSuppressed: async () => true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(res.status).toBe('opted_out');
  });

  it('fails cleanly when the carrier has no email', async () => {
    const send = vi.fn(async () => okOut);
    const res = await sendRfqToCarrier(request(), recipient({ carrierEmail: null }), { send, liveSend: true });
    expect(send).not.toHaveBeenCalled();
    expect(res.status).toBe('failed');
  });

  it('treats a logged-only (no provider) live send as failed, not a false sent', async () => {
    const send = vi.fn(async (): Promise<EmailOut> => ({ ok: true, logged: true, provider: 'stdout' }));
    const res = await sendRfqToCarrier(request(), recipient(), { send, liveSend: true });
    expect(res.status).toBe('failed');
  });
});

describe('base URL helpers', () => {
  it('build the expected public paths', () => {
    expect(quoteUrl('https://x.test/', 'tok')).toBe('https://x.test/directory/rfq/quote/tok');
    expect(optOutUrl('https://x.test', 'tok')).toBe('https://x.test/directory/rfq/optout/tok');
  });
});
