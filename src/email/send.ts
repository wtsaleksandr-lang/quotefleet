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

export interface EmailIn {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  from?: string;
}

export interface EmailOut {
  ok: boolean;
  logged?: boolean;
  provider?: 'resend' | 'smtp' | 'stdout';
  id?: string;
}

export async function sendEmail(msg: EmailIn): Promise<EmailOut> {
  const env = loadEnv();

  // 1. Resend
  if (env.RESEND_API_KEY) {
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
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          reply_to: msg.replyTo,
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        console.warn(`[email] resend HTTP ${r.status}: ${body.slice(0, 200)}`);
        return { ok: false, provider: 'resend' };
      }
      const j = (await r.json()) as { id?: string };
      return { ok: true, provider: 'resend', id: j.id };
    } catch (err) {
      console.warn('[email] resend failed:', err);
      // fall through to SMTP / stdout
    }
  }

  // 2. SMTP
  const t = getTransport();
  if (t) {
    await t.sendMail({
      from: msg.from ?? env.SMTP_FROM ?? 'noreply@quotefleet.com',
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      replyTo: msg.replyTo,
    });
    return { ok: true, provider: 'smtp' };
  }

  // 3. Stdout fallback
  console.log('────── EMAIL (no provider configured — logged only) ──────');
  console.log(`To:      ${msg.to}`);
  console.log(`Subject: ${msg.subject}`);
  console.log(`Body:`);
  console.log(msg.text);
  console.log('────────────────────────────────────────────────────────────');
  return { ok: true, logged: true, provider: 'stdout' };
}
