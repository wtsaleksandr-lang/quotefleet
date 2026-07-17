/**
 * Email helper.
 *
 * Provider precedence:
 *   1. Resend (if RESEND_API_KEY is set) — easiest path, JSON API,
 *      built-in domain-warming, generous free tier (3k/mo).
 *   2. SMTP (if SMTP_HOST/USER/PASS set) — works with any provider.
 *   3. Stdout-log fallback — for dev. Says clearly "would have sent".
 *
 * Returns { ok, logged?, provider? } so callers can detect a logged-only
 * send and retry once a real provider is configured.
 */
import { loadEnv } from '../config.js';
import nodemailer from 'nodemailer';

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (cachedTransport) return cachedTransport;
  const env = loadEnv();
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  cachedTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: false,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return cachedTransport;
}

/**
 * RFC 2047 "encoded-word" for email `Subject` headers.
 *
 * A subject with emoji/arrows (e.g. `New freight lead → Long Beach, CA ✓`,
 * `📞 Callback requested`) contains code points above U+00FF. Putting such
 * a string verbatim into an HTTP header — which the Resend JSON API turns
 * the subject into downstream — throws a `ByteString` conversion error, so
 * the best-effort notification is silently dropped and the carrier never
 * hears about the lead. The fix: pre-encode to the pure-ASCII
 * `=?UTF-8?B?<base64>?=` form, which every mail client decodes back to the
 * original.
 *
 * Chunked on whole-character boundaries so each encoded-word stays within
 * RFC 2047's 75-char limit and no multi-byte UTF-8 sequence is split
 * across words. Pure-ASCII subjects are returned untouched.
 *
 * NOTE: only the Resend path needs this — nodemailer (SMTP) auto-encodes
 * UTF-8 subjects itself, and feeding it a pre-encoded word is unnecessary.
 */
export function encodeEmailSubject(subject: string): string {
  // Pure ASCII → nothing to encode.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;

  const MAX_BYTES = 45; // 45 UTF-8 bytes → 60 base64 chars; +12 wrapper = 72 ≤ 75
  const words: string[] = [];
  let buf: number[] = [];
  const flush = () => {
    if (buf.length) {
      words.push('=?UTF-8?B?' + Buffer.from(buf).toString('base64') + '?=');
      buf = [];
    }
  };
  for (const ch of subject) {
    // Iterating a string yields whole code points, so a character is never
    // split across two encoded-words.
    const b = Buffer.from(ch, 'utf8');
    if (buf.length && buf.length + b.length > MAX_BYTES) flush();
    for (const x of b) buf.push(x);
  }
  flush();
  return words.join(' ');
}

/**
 * Build a branded `From` header value — `"<DisplayName> <addr>"` — reusing the
 * platform's own verified sending address so DKIM/SPF stay intact, while the
 * human-visible name becomes the carrier's. Used for customer-facing emails so
 * the carrier's END CUSTOMER sees e.g. `Harbor Link Logistics <hello@quotefleet.net>`.
 *
 * `addr` is the bare email parsed out of `RESEND_FROM_EMAIL` (which may be a
 * display-name form `"QuoteFleet <hello@quotefleet.net>"` or a bare address),
 * falling back to `SMTP_FROM`, then a hard default. `displayName` is stripped of
 * characters that would break the header (`"`, `<`, `>`) and defaults to
 * `QuoteFleet` when empty.
 */
export function brandedFrom(displayName: string): string {
  const env = loadEnv();
  const raw = env.RESEND_FROM_EMAIL || env.SMTP_FROM || 'hello@quotefleet.net';
  // Pull the bare address out of a possible `"Name <addr>"` form.
  const m = /<([^>]+)>/.exec(raw);
  const addr = (m ? m[1] : raw).trim();
  const name = String(displayName ?? '').replace(/["<>]/g, '').trim() || 'QuoteFleet';
  return `${name} <${addr}>`;
}

export interface EmailIn {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  from?: string;
  /** MARKETING/LIFECYCLE ONLY: when set, sendEmail attaches RFC 2369 /
   *  RFC 8058 unsubscribe headers (`List-Unsubscribe` +
   *  `List-Unsubscribe-Post`) on both the Resend and SMTP paths. Transactional
   *  callers omit it — those emails are compliance-exempt and carry no
   *  unsubscribe header. The mailto fallback is fixed; only the tokenized HTTP
   *  URL varies per tenant. */
  listUnsubscribeUrl?: string;
}

/** Fixed mailbox for the mailto: arm of List-Unsubscribe. */
const UNSUBSCRIBE_MAILTO = 'mailto:unsubscribe@quotefleet.net';

/** Build the List-Unsubscribe header pair for a marketing send, or null when
 *  no unsubscribe URL was supplied (transactional email → no headers). */
function unsubscribeHeaders(url: string | undefined): Record<string, string> | null {
  if (!url) return null;
  return {
    'List-Unsubscribe': `<${url}>, <${UNSUBSCRIBE_MAILTO}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export interface EmailOut {
  ok: boolean;
  logged?: boolean;
  provider?: 'resend' | 'smtp' | 'stdout';
  id?: string;
  /** Set only when ok:false — a human-readable summary of why every
   *  configured provider failed (never contains secret values). */
  error?: string;
}

export async function sendEmail(msg: EmailIn): Promise<EmailOut> {
  const env = loadEnv();

  // Present only for marketing/lifecycle sends; null for transactional email.
  const listHeaders = unsubscribeHeaders(msg.listUnsubscribeUrl);

  // Tracks whether a REAL provider (Resend/SMTP) was configured and attempted,
  // and the last failure reason. If a provider was configured but every attempt
  // failed we must FAIL LOUDLY (ok:false + error) rather than silently pretend
  // success via the stdout dev fallback. `errors` never holds a secret value.
  let providerAttempted = false;
  const errors: string[] = [];

  // 1. Resend
  if (env.RESEND_API_KEY) {
    providerAttempted = true;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: msg.from ?? env.RESEND_FROM_EMAIL ?? 'QuoteFleet <onboarding@resend.dev>',
          to: [msg.to],
          // RFC 2047-encode so non-Latin1 subjects (emoji/arrows) don't
          // throw a ByteString error in the header path downstream.
          subject: encodeEmailSubject(msg.subject),
          text: msg.text,
          html: msg.html,
          reply_to: msg.replyTo,
          // Marketing/lifecycle only — omitted (undefined) for transactional.
          ...(listHeaders ? { headers: listHeaders } : {}),
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        // A provider HTTP failure (bad/expired key, 4xx/5xx) must FALL THROUGH
        // to the next provider — mirror how a thrown exception falls through —
        // instead of returning immediately and skipping the SMTP fallback.
        console.error(`[email] resend failed ${r.status}: ${body.slice(0, 300)}`);
        errors.push(`resend HTTP ${r.status}`);
      } else {
        const j = (await r.json()) as { id?: string };
        return { ok: true, provider: 'resend', id: j.id };
      }
    } catch (err) {
      console.error('[email] resend failed (exception):', err);
      errors.push(`resend threw: ${err instanceof Error ? err.message : String(err)}`);
      // fall through to SMTP / stdout
    }
  }

  // 2. SMTP
  const t = getTransport();
  if (t) {
    providerAttempted = true;
    try {
      await t.sendMail({
        from: msg.from ?? env.SMTP_FROM ?? 'noreply@quotefleet.net',
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        replyTo: msg.replyTo,
        // Marketing/lifecycle only — omitted for transactional sends.
        ...(listHeaders ? { headers: listHeaders } : {}),
      });
      return { ok: true, provider: 'smtp' };
    } catch (err) {
      console.error('[email] smtp failed:', err);
      errors.push(`smtp threw: ${err instanceof Error ? err.message : String(err)}`);
      // fall through to stdout / final failure
    }
  }

  // 3a. A provider WAS configured but every attempt failed → fail loudly.
  if (providerAttempted) {
    const error = errors.join('; ') || 'all providers failed';
    console.error(`[email] all providers failed for send to <${msg.to}>: ${error}`);
    return { ok: false, error };
  }

  // 3b. Stdout fallback — only when NO real provider is configured (dev).
  console.log('────── EMAIL (no provider configured — logged only) ──────');
  console.log(`To:      ${msg.to}`);
  console.log(`Subject: ${msg.subject}`);
  console.log(`Body:`);
  console.log(msg.text);
  console.log('────────────────────────────────────────────────────────────');
  return { ok: true, logged: true, provider: 'stdout' };
}
