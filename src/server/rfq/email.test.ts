/**
 * RFQ email tests — template content + the LIVE-SEND gate + suppression-first,
 * all with an injected sender (no network). Proves the dry-run path NEVER calls
 * the network sender, live send does, and suppression short-circuits both.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildCarrierRfqEmail,
  buildDraftedRfqEmail,
  sendRfqToCarrier,
  quoteUrl,
  optOutUrl,
  FOOTER_LINKS,
} from './email.js';
import { SENDER_ADDRESS } from '../outreach/draftEmail.js';
import { esc } from '../directory/pages.js';
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

/**
 * The footer is the compliance surface AND the thing a carrier reads last, so it
 * is pinned here on BOTH builders — the static template and the AI-drafted
 * letter must never drift apart on any of it.
 */
describe.each([
  ['buildCarrierRfqEmail', () => buildCarrierRfqEmail(request(), recipient(), BASE)],
  [
    'buildDraftedRfqEmail',
    () => buildDraftedRfqEmail(request(), recipient(), BASE, { subject: 'S', body: 'Dear Acme,\n\nhi' }),
  ],
] as const)('%s footer', (_name, build) => {
  it('suppresses address auto-linkification: the address appears ONLY inside an anchor', () => {
    const { html } = build();
    // THE INVARIANT. Gmail/Outlook/Apple Mail linkifiers all skip text that is
    // already inside an <a> (a nested anchor is invalid HTML), so an
    // anchor-enclosed address can never be repainted as a blue Maps link. If a
    // future edit moves the address out of its anchor, this fails.
    // The address is HTML-escaped on the way in ("&" → "&amp;"), so match the
    // escaped form — the same transform the renderer applies.
    const addr = esc(SENDER_ADDRESS);
    const idx = html.indexOf(addr);
    expect(idx).toBeGreaterThan(-1);
    // Every occurrence must sit between an <a ...> and the next </a>.
    for (let i = idx; i !== -1; i = html.indexOf(addr, i + 1)) {
      const before = html.slice(0, i);
      const openA = before.lastIndexOf('<a ');
      const closeA = before.lastIndexOf('</a>');
      expect(openA).toBeGreaterThan(closeA); // inside an open anchor
      expect(html.indexOf('</a>', i)).toBeGreaterThan(i); // and it closes after
    }
    // Belt two, for Apple Mail / iOS data detectors, which honour the hint.
    expect(html).toContain('name="format-detection"');
    expect(html).toContain('address=no');
    // The address anchor must NOT be painted like a link (no blue, no underline).
    expect(html).toMatch(/<a href="[^"]*\/terms" style="color:#8a919e;text-decoration:none;">/);
  });

  it('keeps the address small and muted rather than loud', () => {
    const { html } = build();
    // 11px is the floor — smaller and mail clients bump it back up anyway.
    expect(html).toContain('font-size:11px');
    // The old 12px footer treatment is gone from the footer block.
    expect(html).not.toContain('color:#8a919e;font-size:12px');
  });

  it('carries the legal + promotional links, all as absolute URLs', () => {
    const { html, text } = build();
    for (const path of Object.values(FOOTER_LINKS)) {
      expect(html).toContain(`href="${BASE}${path}"`);
      expect(text).toContain(`${BASE}${path}`);
    }
    expect(html).toContain('freight rate calculator');
    expect(html).toContain('US importer directory');
  });

  it('never regresses the one-click opt-out or the physical address', () => {
    const { html, text } = build();
    expect(html).toContain(optOutUrl(BASE, 'quote-token-xyz'));
    expect(html).toContain('Opt out in one click');
    expect(text).toContain(optOutUrl(BASE, 'quote-token-xyz'));
    expect(html).toContain(esc(SENDER_ADDRESS));
    expect(text).toContain(SENDER_ADDRESS);
  });

  it('survives real mail clients: no external CSS, no web fonts, no <style>', () => {
    const { html } = build();
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(html).not.toMatch(/@import/);
    // Every http(s) URL in the email points at our own base — no trackers, no
    // remote images (a remote image would also be a privacy/blocking problem).
    for (const m of html.matchAll(/https?:\/\/[^"'\s>]+/g)) {
      expect(m[0].startsWith(BASE)).toBe(true);
    }
    expect(html).not.toMatch(/<img\b/i);
  });

  it('links only to routes that exist — no invented paths', () => {
    const { html } = build();
    const paths = [...html.matchAll(new RegExp(`href="${BASE}([^"]*)"`, 'g'))].map((m) => m[1]);
    const allowed = new Set<string>([
      ...Object.values(FOOTER_LINKS),
      `/directory/rfq/quote/quote-token-xyz`,
      `/directory/rfq/optout/quote-token-xyz`,
    ]);
    for (const p of paths) expect(allowed.has(p)).toBe(true);
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
