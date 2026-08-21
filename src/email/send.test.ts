/**
 * Regression test for lead/callback notification subjects that contain
 * non-Latin1 characters (emoji / arrows). These used to throw a
 * `ByteString` error in the Resend header path, silently dropping the
 * best-effort notification so the carrier never heard about the lead.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// Inject a fake SMTP transport so we can prove the Resend→SMTP fallthrough
// without a real network. `mockSendMail` is hoisted so the vi.mock factory
// (also hoisted) can close over it.
const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: mockSendMail }) },
}));

// send.ts imports config.js — give it the minimum env so the module loads
// cleanly in isolation.
beforeAll(() => {
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'x'.repeat(64);
  if (!process.env.DATABASE_URL)
    process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
});

/** Decode an RFC 2047 subject back to its original string. */
function decodeRfc2047(encoded: string): string {
  const parts = encoded.split(/\s+/).map((word) => {
    const m = /^=\?UTF-8\?B\?(.*)\?=$/.exec(word);
    if (!m) return Buffer.from(word, 'utf8'); // untouched ASCII segment
    return Buffer.from(m[1], 'base64');
  });
  return Buffer.concat(parts).toString('utf8');
}

/** Every char must fit in a byte (0-255) to survive an HTTP ByteString header. */
function isByteStringSafe(s: string): boolean {
  for (const ch of s) if (ch.codePointAt(0)! > 0xff) return false;
  return true;
}

describe('encodeEmailSubject', () => {
  it('leaves a pure-ASCII subject untouched', async () => {
    const { encodeEmailSubject } = await import('./send.js');
    const subject = 'Quote QF-1234 — no wait, plain ASCII only';
    // (em dash is non-ASCII, so this one WILL encode; use a clean ASCII case)
    const ascii = 'New lead QF-1234 ($1,250.00) - Acme Freight';
    expect(encodeEmailSubject(ascii)).toBe(ascii);
    // sanity: the non-ASCII one must differ
    expect(encodeEmailSubject(subject)).not.toBe(subject);
  });

  it('encodes an arrow + checkmark subject to ByteString-safe ASCII', async () => {
    const { encodeEmailSubject } = await import('./send.js');
    const subject = 'New freight lead → Long Beach, CA ✓';
    const out = encodeEmailSubject(subject);
    expect(out).toContain('=?UTF-8?B?');
    expect(isByteStringSafe(out)).toBe(true);
    expect(decodeRfc2047(out)).toBe(subject);
  });

  it('encodes an emoji callback subject and round-trips exactly', async () => {
    const { encodeEmailSubject } = await import('./send.js');
    const subject = '📞 Callback requested — Jane Doe (quote QF-9)';
    const out = encodeEmailSubject(subject);
    expect(isByteStringSafe(out)).toBe(true);
    expect(decodeRfc2047(out)).toBe(subject);
  });

  it('does not throw and keeps each encoded-word within the 75-char limit', async () => {
    const { encodeEmailSubject } = await import('./send.js');
    const subject = 'New freight lead → ' + '✓ '.repeat(40) + 'end';
    let out = '';
    expect(() => {
      out = encodeEmailSubject(subject);
    }).not.toThrow();
    for (const word of out.split(/\s+/)) {
      if (word.startsWith('=?')) expect(word.length).toBeLessThanOrEqual(75);
    }
    expect(decodeRfc2047(out)).toBe(subject);
  });
});

/**
 * Fail-fast hardening: a provider HTTP failure (bad/expired key) must FALL
 * THROUGH to the next provider instead of early-returning and skipping the
 * SMTP fallback — and sendEmail must return ok:false ONLY when every
 * configured transport fails. Paradigm: injectable/behavioral — global.fetch
 * is stubbed and nodemailer is mocked (see vi.mock above), so we assert real
 * runtime behavior rather than static content.
 */
describe('sendEmail provider fallthrough', () => {
  beforeAll(() => {
    // Both a Resend key and full SMTP creds are configured, so the precedence
    // is Resend → SMTP. loadEnv() caches on first call; set before any send.
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'unused-in-mock';
  });

  it('falls through Resend HTTP failure to SMTP (does not early-return on !ok)', async () => {
    // Resend returns a non-2xx (e.g. expired key). Pre-fix this early-returned
    // {ok:false} and never reached SMTP.
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    })) as unknown as typeof fetch;
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({});

    const { sendEmail } = await import('./send.js');
    const out = await sendEmail({ to: 'x@y.com', subject: 'hi', text: 'body' });

    // Proof of fallthrough: SMTP was attempted and succeeded.
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('smtp');
  });

  it('returns ok:false with an error only when ALL transports fail', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'server error',
    })) as unknown as typeof fetch;
    mockSendMail.mockReset();
    mockSendMail.mockRejectedValue(new Error('smtp down'));

    const { sendEmail } = await import('./send.js');
    const out = await sendEmail({ to: 'x@y.com', subject: 'hi', text: 'body' });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });
});

/**
 * CAN-SPAM / CASL: marketing/lifecycle sends must carry List-Unsubscribe +
 * List-Unsubscribe-Post (RFC 8058 one-click); transactional sends must NOT.
 * Behavioral — inspect the actual Resend JSON body / nodemailer args, not
 * static template content. Relies on the env set by the fallthrough describe
 * (RESEND_API_KEY + SMTP creds cached in loadEnv).
 */
describe('List-Unsubscribe header (marketing vs transactional)', () => {
  it('attaches both unsubscribe headers on the Resend body for a marketing send', async () => {
    const captured: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'e1' }) };
    }) as unknown as typeof fetch;

    const { sendEmail } = await import('./send.js');
    const out = await sendEmail({
      to: 'x@y.com',
      subject: 'lifecycle',
      text: 'body',
      listUnsubscribeUrl: 'https://quotefleet.net/unsubscribe?token=1.abc',
    });

    expect(out.ok).toBe(true);
    const headers = captured[0].headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toBe(
      '<https://quotefleet.net/unsubscribe?token=1.abc>, <mailto:unsubscribe@quotefleet.net>'
    );
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('does NOT attach any unsubscribe header for a transactional send', async () => {
    const captured: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'e2' }) };
    }) as unknown as typeof fetch;

    const { sendEmail } = await import('./send.js');
    await sendEmail({ to: 'x@y.com', subject: 'magic link', text: 'body' });

    expect(captured[0].headers).toBeUndefined();
  });

  it('carries the unsubscribe headers through to the SMTP path when Resend fails', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    })) as unknown as typeof fetch;
    mockSendMail.mockReset();
    let smtpArgs: { headers?: Record<string, string> } = {};
    mockSendMail.mockImplementation(async (a: { headers?: Record<string, string> }) => {
      smtpArgs = a;
      return {};
    });

    const { sendEmail } = await import('./send.js');
    const out = await sendEmail({
      to: 'x@y.com',
      subject: 'lifecycle',
      text: 'body',
      listUnsubscribeUrl: 'https://quotefleet.net/unsubscribe?token=2.def',
    });

    expect(out.provider).toBe('smtp');
    expect(smtpArgs.headers?.['List-Unsubscribe']).toContain(
      '<https://quotefleet.net/unsubscribe?token=2.def>'
    );
    expect(smtpArgs.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

/**
 * THREADED REPLY (reverse outreach): inReplyTo / references / headers must land
 * in the SAME header map on both providers, so a branded-demo reply threads
 * under the broker's original marketing email. Behavioral — inspect the actual
 * Resend JSON body and the nodemailer args. Reuses the env cached above
 * (RESEND_API_KEY + SMTP creds), so precedence is Resend → SMTP.
 */
describe('threaded-reply headers (In-Reply-To / References / custom)', () => {
  it('puts In-Reply-To + References + custom headers in the Resend headers map', async () => {
    const captured: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'e-thread' }) };
    }) as unknown as typeof fetch;

    const { sendEmail } = await import('./send.js');
    const out = await sendEmail({
      to: 'broker@acme.com',
      subject: 'Re: Your capacity this week',
      text: 'here is your branded quote',
      inReplyTo: '<orig-123@acme.com>',
      references: '<thread-a@acme.com> <orig-123@acme.com>',
      headers: { 'X-QF-Reverse-Outreach': 'demo_abc' },
    });

    expect(out.ok).toBe(true);
    const headers = captured[0].headers as Record<string, string>;
    expect(headers['In-Reply-To']).toBe('<orig-123@acme.com>');
    expect(headers['References']).toBe('<thread-a@acme.com> <orig-123@acme.com>');
    expect(headers['X-QF-Reverse-Outreach']).toBe('demo_abc');
  });

  it('merges threading headers ALONGSIDE List-Unsubscribe (both present)', async () => {
    const captured: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'e-both' }) };
    }) as unknown as typeof fetch;

    const { sendEmail } = await import('./send.js');
    await sendEmail({
      to: 'broker@acme.com',
      subject: 'Re: capacity',
      text: 'body',
      inReplyTo: '<orig-9@acme.com>',
      listUnsubscribeUrl: 'https://quotefleet.net/unsubscribe?token=9.xyz',
    });

    const headers = captured[0].headers as Record<string, string>;
    // Threading header did not clobber the unsubscribe pair, and vice-versa.
    expect(headers['In-Reply-To']).toBe('<orig-9@acme.com>');
    expect(headers['List-Unsubscribe']).toContain('token=9.xyz');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('carries threading headers through to the SMTP path when Resend fails', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    })) as unknown as typeof fetch;
    mockSendMail.mockReset();
    let smtpArgs: { headers?: Record<string, string> } = {};
    mockSendMail.mockImplementation(async (a: { headers?: Record<string, string> }) => {
      smtpArgs = a;
      return {};
    });

    const { sendEmail } = await import('./send.js');
    const out = await sendEmail({
      to: 'broker@acme.com',
      subject: 'Re: capacity',
      text: 'body',
      inReplyTo: '<orig-7@acme.com>',
      references: '<orig-7@acme.com>',
    });

    expect(out.provider).toBe('smtp');
    expect(smtpArgs.headers?.['In-Reply-To']).toBe('<orig-7@acme.com>');
    expect(smtpArgs.headers?.['References']).toBe('<orig-7@acme.com>');
  });

  it('adds NO headers map when no threading/unsubscribe/custom header is set', async () => {
    const captured: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'e-none' }) };
    }) as unknown as typeof fetch;

    const { sendEmail } = await import('./send.js');
    await sendEmail({ to: 'x@y.com', subject: 'plain', text: 'body' });

    // Unchanged behavior: transactional send with no headers → no headers key.
    expect(captured[0].headers).toBeUndefined();
  });
});

/**
 * INLINE CID ATTACHMENT (Outlook-safe branded screenshot): an attachment with
 * `contentId` + `inline` must reach the Resend payload as
 * { content_id, disposition:'inline' } and the nodemailer args as { cid }, on
 * their respective paths. Behavioral — inspect the actual Resend JSON body and
 * the nodemailer args. Reuses the env cached above (Resend → SMTP precedence).
 */
describe('inline CID attachment (embedded screenshot)', () => {
  const cidAttachment = {
    filename: 'quote.png',
    contentBase64: 'QUJD', // "ABC"
    contentType: 'image/png',
    contentId: 'quoteshot',
    inline: true,
  };

  it('maps the inline attachment to Resend content_id + inline disposition', async () => {
    const captured: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'e-img' }) };
    }) as unknown as typeof fetch;

    const { sendEmail } = await import('./send.js');
    const out = await sendEmail({
      to: 'x@y.com',
      subject: 'branded',
      text: 'body',
      html: '<img src="cid:quoteshot">',
      attachments: [cidAttachment],
    });

    expect(out.ok).toBe(true);
    const att = (captured[0].attachments as Array<Record<string, unknown>>)[0];
    expect(att.filename).toBe('quote.png');
    expect(att.content).toBe('QUJD');
    expect(att.content_id).toBe('quoteshot');
    expect(att.content_type).toBe('image/png');
    expect(att.disposition).toBe('inline');
  });

  it('maps the inline attachment to nodemailer { cid, Buffer } when Resend fails', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    })) as unknown as typeof fetch;
    mockSendMail.mockReset();
    let smtpArgs: { attachments?: Array<Record<string, unknown>> } = {};
    mockSendMail.mockImplementation(async (a: { attachments?: Array<Record<string, unknown>> }) => {
      smtpArgs = a;
      return {};
    });

    const { sendEmail } = await import('./send.js');
    const out = await sendEmail({
      to: 'x@y.com',
      subject: 'branded',
      text: 'body',
      html: '<img src="cid:quoteshot">',
      attachments: [cidAttachment],
    });

    expect(out.provider).toBe('smtp');
    const att = smtpArgs.attachments![0];
    expect(att.filename).toBe('quote.png');
    expect(att.cid).toBe('quoteshot');
    expect(Buffer.isBuffer(att.content)).toBe(true);
    expect((att.content as Buffer).toString('base64')).toBe('QUJD');
    expect(att.contentType).toBe('image/png');
  });
});

/**
 * brandedFrom — carrier-branded `From` for customer-facing emails.
 *
 * Placed LAST on purpose: loadEnv() caches on first call, and the SMTP-path
 * tests above rely on establishing that cache with SMTP creds set. Calling
 * brandedFrom (→ loadEnv) earlier would poison that cache. By here the cache is
 * warm; neither RESEND_FROM_EMAIL nor SMTP_FROM is ever set in this file, so the
 * bare address falls back to the hard default hello@quotefleet.net.
 */
describe('brandedFrom', () => {
  it('wraps a carrier display name around the platform bare address', async () => {
    const { brandedFrom } = await import('./send.js');
    const out = brandedFrom('Harbor Link Logistics');
    expect(out).toContain('Harbor Link Logistics <');
    expect(out).toContain('hello@quotefleet.net');
    expect(out).toBe('Harbor Link Logistics <hello@quotefleet.net>');
  });

  it('strips header-breaking chars and defaults an empty name to QuoteFleet', async () => {
    const { brandedFrom } = await import('./send.js');
    expect(brandedFrom(' Evil <x> "y"')).toBe('Evil x y <hello@quotefleet.net>');
    expect(brandedFrom('')).toBe('QuoteFleet <hello@quotefleet.net>');
  });
});

describe('isUndeliverableReservedRecipient — RFC 2606/6761 guard', () => {
  it('flags reserved/test domains (never deliverable)', async () => {
    const { isUndeliverableReservedRecipient: r } = await import('./send.js');
    expect(r('qf-verify+gtwo17@example.com')).toBe(true);
    expect(r('user@example.net')).toBe(true);
    expect(r('user@example.org')).toBe(true);
    expect(r('user@rates.example.com')).toBe(true); // subdomain
    expect(r('user@foo.test')).toBe(true);
    expect(r('user@bar.invalid')).toBe(true);
    expect(r('root@localhost')).toBe(true);
    expect(r('user@anything.localhost')).toBe(true);
    expect(r('DEV@Example.COM')).toBe(true); // case-insensitive
  });

  it('passes real deliverable domains through', async () => {
    const { isUndeliverableReservedRecipient: r } = await import('./send.js');
    expect(r('owner@smithplumbing.com')).toBe(false);
    expect(r('dispatch@quotefleet.net')).toBe(false);
    expect(r('a@gmail.com')).toBe(false);
    expect(r('')).toBe(false);
    expect(r('not-an-email')).toBe(false);
  });

  it('sendEmail no-ops a reserved-domain recipient without touching any provider', async () => {
    const { sendEmail } = await import('./send.js');
    mockSendMail.mockClear();
    const out = await sendEmail({ to: 'qf-verify+abc@example.com', subject: 'Welcome', text: 'hi' });
    expect(out.ok).toBe(true);
    expect(out.logged).toBe(true);
    expect(mockSendMail).not.toHaveBeenCalled(); // SMTP fallback never attempted
  });
});
