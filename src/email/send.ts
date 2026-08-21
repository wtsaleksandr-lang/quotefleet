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

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content (no `data:` prefix). */
  contentBase64: string;
  contentType?: string;
  /** Content-ID for an INLINE (embedded) attachment, referenced from the HTML as
   *  `<img src="cid:<contentId>">`. Set (with `inline`) to embed a branded quote
   *  screenshot that renders in Outlook, which blocks external images. */
  contentId?: string;
  /** Mark this attachment `inline` (Content-Disposition: inline) rather than a
   *  downloadable `attachment`. Implied whenever `contentId` is set. */
  inline?: boolean;
}

export interface EmailIn {
  to: string;
  /** Optional CC recipients (e.g. a carrier CC'ing their team on a lead). */
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  from?: string;
  /** Optional file attachments (e.g. a customer's work order / delivery order
   *  relayed to the carrier). Relayed straight to the recipient's inbox — we
   *  store nothing. Keep the total small; providers cap attachment size. */
  attachments?: EmailAttachment[];
  /** MARKETING/LIFECYCLE ONLY: when set, sendEmail attaches RFC 2369 /
   *  RFC 8058 unsubscribe headers (`List-Unsubscribe` +
   *  `List-Unsubscribe-Post`) on both the Resend and SMTP paths. Transactional
   *  callers omit it — those emails are compliance-exempt and carry no
   *  unsubscribe header. The mailto fallback is fixed; only the tokenized HTTP
   *  URL varies per tenant. */
  listUnsubscribeUrl?: string;
  /** THREADED REPLY: RFC 5322 `In-Reply-To` — the Message-ID of the email this
   *  send is a reply to. Set (with `references`) by the reverse-outreach replier
   *  so the branded demo lands in the SAME thread as the broker's inbound
   *  marketing email. Omitted for standalone sends. */
  inReplyTo?: string;
  /** THREADED REPLY: RFC 5322 `References` — the space-joined Message-ID chain
   *  of the thread being replied to (usually the original's References + its
   *  Message-ID). Omitted for standalone sends. */
  references?: string;
  /** Arbitrary extra headers merged into the outgoing header map on BOTH the
   *  Resend and SMTP paths (after threading + unsubscribe headers). Escape hatch
   *  for future per-send headers; absent by default. */
  headers?: Record<string, string>;
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

/**
 * RFC 2606 / RFC 6761 reserved domains that can NEVER receive real mail:
 * example.com/.net/.org (and any subdomain), and the reserved TLDs .test,
 * .example, .invalid, .localhost. A placeholder/test tenant with such an
 * address (e.g. `qf-verify+abc@example.com`) is otherwise driven all the way
 * through Resend (→ HTTP 422 "use a testing address") and the SMTP fallback
 * (→ a bounce), producing an alarming `[email] all providers failed` stack that
 * reads like an outage even though real delivery is unaffected. A send to one
 * of these is a guaranteed non-delivery, so we treat it as a logged no-op.
 */
export function isUndeliverableReservedRecipient(to: string): boolean {
  const domain = String(to || '').trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  const tld = domain.split('.').pop() ?? '';
  if (tld === 'test' || tld === 'example' || tld === 'invalid' || tld === 'localhost') return true;
  // example.com / example.net / example.org and any subdomain of them.
  return /(^|\.)example\.(com|net|org)$/.test(domain);
}

export async function sendEmail(msg: EmailIn): Promise<EmailOut> {
  const env = loadEnv();

  // Skip reserved/test-domain recipients (RFC 2606/6761) BEFORE touching any
  // provider — they can never be delivered, so attempting a real send only
  // burns provider quota and emits misleading "all providers failed" errors.
  if (isUndeliverableReservedRecipient(msg.to)) {
    console.log(
      `[email] skipped reserved/test-domain recipient <${msg.to}> — RFC 2606/6761, never deliverable (no-op)`,
    );
    return { ok: true, logged: true, provider: 'stdout' };
  }

  // Present only for marketing/lifecycle sends; null for transactional email.
  const listHeaders = unsubscribeHeaders(msg.listUnsubscribeUrl);

  // THREADED REPLY headers — only the keys that were supplied (omit undefined),
  // so a standalone send adds nothing. Merged (with any caller-supplied
  // `msg.headers`) alongside the List-Unsubscribe headers into the ONE header
  // map handed to both providers, so threading works on Resend and SMTP alike.
  const threadHeaders: Record<string, string> = {};
  if (msg.inReplyTo) threadHeaders['In-Reply-To'] = msg.inReplyTo;
  if (msg.references) threadHeaders['References'] = msg.references;
  const mergedHeaders: Record<string, string> = {
    ...(listHeaders ?? {}),
    ...threadHeaders,
    ...(msg.headers ?? {}),
  };
  // Null when nothing to send, so behavior is unchanged when no header applies.
  const outHeaders = Object.keys(mergedHeaders).length ? mergedHeaders : null;

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
          ...(msg.cc?.length ? { cc: msg.cc } : {}),
          // RFC 2047-encode so non-Latin1 subjects (emoji/arrows) don't
          // throw a ByteString error in the header path downstream.
          subject: encodeEmailSubject(msg.subject),
          text: msg.text,
          html: msg.html,
          reply_to: msg.replyTo,
          // List-Unsubscribe (marketing) + In-Reply-To/References (threaded
          // reply) + any caller headers, merged; omitted when none apply.
          ...(outHeaders ? { headers: outHeaders } : {}),
          // Resend takes base64 in `content`. Inline images carry `content_id`
          // (referenced via `cid:` in the HTML) + `disposition:'inline'` so they
          // render embedded (Outlook-safe) rather than as a download.
          ...(msg.attachments?.length
            ? {
                attachments: msg.attachments.map((a) => {
                  const inline = a.inline || !!a.contentId;
                  return {
                    filename: a.filename,
                    content: a.contentBase64,
                    ...(a.contentType ? { content_type: a.contentType } : {}),
                    ...(a.contentId ? { content_id: a.contentId } : {}),
                    ...(inline ? { disposition: 'inline' as const } : {}),
                  };
                }),
              }
            : {}),
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
        ...(msg.cc?.length ? { cc: msg.cc } : {}),
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        replyTo: msg.replyTo,
        // List-Unsubscribe (marketing) + In-Reply-To/References (threaded
        // reply) + any caller headers, merged; omitted when none apply.
        ...(outHeaders ? { headers: outHeaders } : {}),
        // Nodemailer takes a Buffer. Passing `cid` makes the attachment inline
        // (Content-ID + inline disposition) so `<img src="cid:...">` resolves.
        ...(msg.attachments?.length
          ? {
              attachments: msg.attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.contentBase64, 'base64'),
                contentType: a.contentType,
                ...(a.contentId ? { cid: a.contentId } : {}),
              })),
            }
          : {}),
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
