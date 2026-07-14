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
