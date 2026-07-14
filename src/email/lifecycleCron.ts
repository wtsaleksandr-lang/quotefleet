/**
 * Lifecycle email cron — sends welcome / nudge / expiry-warning emails
 * based on trial state.
 *
 * Schedule: every 10 minutes from app boot. Each tick scans tenants on
 * the trial and decides which (if any) lifecycle email is due.
 *
 *   welcome         — sent within 10 min of signup
 *   day_7           — sent 7 days after signup if not yet upgraded
 *   day_12          — sent 12 days after signup (2 days before expiry)
 *   day_14_expired  — sent right after trial_ends_at passes
 *
 * Each tenant row has lifecycleEmailsJson = { welcome: '<iso>', ... }
 * to track what's been sent. We never re-send the same email twice.
 *
 * Caller controls when the cron runs:
 *   - Honors LIFECYCLE_EMAIL_DISABLED=1 (tests, second instance).
 *   - Single-instance assumption (Reserved VM = one node). Multi-
 *     instance would need a distributed lock or a dedicated worker.
 */
import { eq, isNotNull, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants, type Tenant } from '../db/schema.js';
import { sendEmail } from './send.js';
import {
  lifecycleWelcomeEmail,
  lifecycleDay7Email,
  lifecycleDay12Email,
  lifecycleExpiredEmail,
} from './templates.js';
import { loadEnv } from '../config.js';

const TICK_MS = 10 * 60 * 1000; // 10 min
const STARTUP_DELAY_MS = 60 * 1000;

let started = false;

export function startLifecycleEmailCron(): void {
  if (started) return;
  if (process.env.LIFECYCLE_EMAIL_DISABLED === '1') {
    console.log('[email.cron] disabled via LIFECYCLE_EMAIL_DISABLED=1');
    return;
  }
  started = true;
  setTimeout(() => void runOnce('startup'), STARTUP_DELAY_MS);
  setInterval(() => void runOnce('tick'), TICK_MS);
  console.log(
    `[email.cron] scheduled — first run in ${STARTUP_DELAY_MS / 1000}s, then every ${TICK_MS / 60_000} min`
  );
}

async function runOnce(reason: string): Promise<void> {
  const t0 = Date.now();
  let sent = 0;
  try {
    // Fetch all free-plan tenants — only ones who could need a
    // lifecycle email. Paid tenants don't get trial emails.
    const rows = await db()
      .select()
      .from(tenants)
      .where(and(eq(tenants.plan, 'free'), isNotNull(tenants.trialEndsAt)));

    for (const t of rows) {
      const next = decideNextEmail(t);
      if (!next) continue;
      const ok = await sendOne(t, next);
      if (ok) sent++;
    }
  } catch (err) {
    console.warn(`[email.cron] tick failed (${reason}):`, err);
    return;
  }
  const ms = Date.now() - t0;
  if (sent > 0) console.log(`[email.cron] tick=${reason} sent=${sent} elapsed=${ms}ms`);
}

interface LifecycleEmail {
  key: string;
  subject: string;
  body: string;
  html: string;
}

function decideNextEmail(t: Tenant): LifecycleEmail | null {
  if (!t.trialEndsAt) return null;
  const sent = t.lifecycleEmailsJson ?? {};
  const now = Date.now();
  const trialEnd = t.trialEndsAt.getTime();
  const trialStart = trialEnd - 14 * 24 * 60 * 60 * 1000;
  const ageDays = (now - trialStart) / (24 * 60 * 60 * 1000);

  // Welcome email — within first 10 minutes of signup.
  if (!sent.welcome) return makeWelcome(t);

  // Day 7 nudge.
  if (ageDays >= 7 && !sent.day_7) return makeDay7(t);

  // Day 12 — 2 days before trial expires.
  if (ageDays >= 12 && !sent.day_12) return makeDay12(t);

  // Trial-expired email — sent the first tick after the deadline passes.
  if (now >= trialEnd && !sent.day_14_expired) return makeExpired(t);

  return null;
}

function publicBaseUrl(): string {
  return loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
}

function makeWelcome(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  const hosted = `https://${t.slug}.${t.hostDomain}/`;
  return {
    key: 'welcome',
    subject: `Welcome to QuoteFleet, ${t.name}`,
    body:
      `Hi,\n\n` +
      `Welcome to QuoteFleet. Your account is ready.\n\n` +
      `→ Your hosted quote page: ${hosted}\n` +
      `→ Sign in to your dashboard:  ${base}/login\n\n` +
      `Three things to do in the next 10 minutes:\n` +
      `1. Sign in and tweak your default rate cards (or upload your existing rate sheet under "AI import").\n` +
      `2. Upload your logo + brand colors so the widget matches your site.\n` +
      `3. Drop the embed snippet on your website (in /app → Embed code) or just share your hosted page link.\n\n` +
      `You're on your 14-day all-inclusive trial — every Pro feature unlocked, unlimited quotes and leads. When it ends, you choose whether to continue on Vital ($14.80/mo) or Pro ($34.80/mo) — cancel anytime.\n\n` +
      `If you get stuck, reply to this email. I read everything.\n\n` +
      `— QuoteFleet\n`,
    html: lifecycleWelcomeEmail({ hostedUrl: hosted, loginUrl: `${base}/login` }),
  };
}

function makeDay7(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  return {
    key: 'day_7',
    subject: `${t.name} — your QuoteFleet halfway check`,
    body:
      `Hi,\n\n` +
      `You're 7 days into your QuoteFleet trial. Quick check-in:\n\n` +
      `• Have you embedded the widget on your site? It takes 30 seconds — paste one <script> tag from /app → Embed code.\n` +
      `• Have you tuned your rate cards yet? The defaults are within ~15% of market, but yours will be tighter.\n` +
      `• Want a hand? Reply to this email and I'll personally walk you through anything.\n\n` +
      `Dashboard:  ${base}/login\n\n` +
      `Trial ends in 7 days, then your plan starts — Vital $14.80/mo or Pro $34.80/mo (${base}/pricing). Manage or switch plans anytime from your dashboard.\n\n` +
      `— QuoteFleet\n`,
    html: lifecycleDay7Email({ loginUrl: `${base}/login`, pricingUrl: `${base}/pricing` }),
  };
}

function makeDay12(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  return {
    key: 'day_12',
    subject: `Your QuoteFleet trial ends in 2 days`,
    body:
      `Hi,\n\n` +
      `Your trial wraps up in 2 days. If you've added a card, your plan starts automatically with no interruption. If not, your hosted page stays live but new leads pause until you choose a plan.\n\n` +
      `Vital is $14.80/mo (hosted page, widget, unlimited quotes, lead inbox, branded quotes). Pro is $34.80/mo — everything in Vital plus AI auto-reply & 24/7 chat, branded PDF quotes, automation, custom domain, and analytics.\n\n` +
      `Choose or manage your plan: ${base}/app  →  Plan settings.\n\n` +
      `Compare plans: ${base}/pricing\n\n` +
      `Reply if you have questions — happy to extend the trial if you need a few extra days.\n\n` +
      `— QuoteFleet\n`,
    html: lifecycleDay12Email({ appUrl: `${base}/app`, pricingUrl: `${base}/pricing` }),
  };
}

function makeExpired(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  return {
    key: 'day_14_expired',
    subject: `Your QuoteFleet trial has ended`,
    body:
      `Hi,\n\n` +
      `Your 14-day trial just ended. Your hosted page is still live, but new leads return a "not accepting requests" message until you choose a plan.\n\n` +
      `Vital $14.80/mo or Pro $34.80/mo — pick one in one click: ${base}/app\n\n` +
      `Or, if QuoteFleet wasn't the right fit, just reply and let me know what missed — useful even if it's a no.\n\n` +
      `— QuoteFleet\n`,
    html: lifecycleExpiredEmail({ appUrl: `${base}/app` }),
  };
}

async function sendOne(t: Tenant, email: LifecycleEmail): Promise<boolean> {
  if (!t.contactEmail) return false;
  try {
    const out = await sendEmail({
      to: t.contactEmail,
      subject: email.subject,
      text: email.body,
      html: email.html,
    });
    if (!out.ok) {
      console.error(`[email] lifecycle ${email.key} send FAILED (tenant ${t.id}): ${out.error ?? 'unknown error'}`);
      return false;
    }
    const updated = { ...(t.lifecycleEmailsJson ?? {}), [email.key]: new Date().toISOString() };
    await db()
      .update(tenants)
      .set({ lifecycleEmailsJson: updated, updatedAt: new Date() })
      .where(eq(tenants.id, t.id));
    return true;
  } catch (err) {
    console.warn(`[email.cron] sending ${email.key} to tenant ${t.id} failed:`, err);
    return false;
  }
}
