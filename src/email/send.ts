/**
 * Email helper. Uses native fetch to talk to whatever SMTP relay the
 * tenant has configured — but for MVP, we just LOG TO STDOUT when SMTP
 * isn't set. That's deliberate: emails are critical-but-rare in the
 * first weeks, and a logged "would have sent" beats "silently lost".
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

export async function sendEmail(msg: EmailIn): Promise<{ ok: boolean; logged?: boolean }> {
  const env = loadEnv();
  const t = getTransport();
  if (!t) {
    console.log('────── EMAIL (SMTP not configured — logged only) ──────');
    console.log(`To:      ${msg.to}`);
    console.log(`Subject: ${msg.subject}`);
    console.log(`Body:`);
    console.log(msg.text);
    console.log('───────────────────────────────────────────────────────');
    return { ok: true, logged: true };
  }
  await t.sendMail({
    from: msg.from ?? env.SMTP_FROM ?? 'noreply@quotefleet.com',
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    replyTo: msg.replyTo,
  });
  return { ok: true };
}
