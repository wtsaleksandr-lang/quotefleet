/**
 * Lifecycle email cron — sends welcome / nudge / expiry-warning emails
 * based on trial state.
 *
 * Schedule: every 10 minutes from app boot. Each tick scans tenants on
 * the trial and decides which (if any) lifecycle email is due.
 *
 * One coherent card-after-trial sequence — no two touches within ~2 days:
 *
 *   welcome                   — day 0   (within 10 min of signup)
 *   day_7                     — day 7   (mid-trial check-in)
 *   trialReminderDay11SentAt  — day 11  (~3 days left: add a card)
 *   trialReminderDay14SentAt  — day 14  (last day, before expiry: ends today)
 *   day_14_expired            — day 15+ (post-expiry win-back)
 *
 * The two trialReminder* card-nudges complete the card-after-trial model
 * (signup is card-free → nudge the owner to add a card before the trial ends).
 * They go ONLY to still-trialing free tenants and never to a paying customer.
 * The old day_12 "ends in 2 days" email was RETIRED — it duplicated the day-11
 * nudge one day apart; day-11 is kept (cleaner threshold + card copy). The
 * expiry email is held to day 15+ so "ends today" and "ended" never collide.
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
import { sendEmail, wasSentByAProvider } from './send.js';
import {
  lifecycleWelcomeEmail,
  lifecycleDay7Email,
  lifecycleExpiredEmail,
  trialReminderDay11Email,
  trialReminderDay14Email,
} from './templates.js';
import { unsubscribeUrl } from './unsubscribe.js';
import { loadEnv } from '../config.js';
import { runTrackedJob, outcomeFromTick, type TickResult } from '../server/jobHealth.js';
import { startCronSchedule } from '../server/cronSchedule.js';
import { describeDbError, withDbRetry } from '../db/retry.js';

const TICK_MS = 10 * 60 * 1000; // 10 min

let started = false;

export function startLifecycleEmailCron(): void {
  if (started) return;
  if (process.env.LIFECYCLE_EMAIL_DISABLED === '1') {
    console.log('[email.cron] disabled via LIFECYCLE_EMAIL_DISABLED=1');
    return;
  }
  started = true;
  startCronSchedule({ cron: 'lifecycle-email', tickMs: TICK_MS, run: trackedRunOnce });
}

/** Scheduling site: records every tick to the job ledger and alerts on failure.
 *  The pass itself (runOnce) keeps its own logging and stays ledger-free so its
 *  unit tests need no DB. */
async function trackedRunOnce(reason: string): Promise<void> {
  await runTrackedJob('lifecycle-email', async () =>
    outcomeFromTick(await runOnce(reason), 'no trialing tenant was due an email'),
  );
}

/** One cron tick — scan trialing tenants and send any due lifecycle email,
 *  skipping tenants who opted out of marketing. Exported for tests (the cron
 *  itself drives it on a timer via startLifecycleEmailCron). */
export async function runOnce(reason: string): Promise<TickResult> {
  const t0 = Date.now();
  let sent = 0;
  try {
    // Fetch all free-plan tenants — only ones who could need a
    // lifecycle email. Paid tenants don't get trial emails.
    //
    // Retried on transient connection/wake failures ONLY, and only here: this
    // is a pure read with no side effects, so running it twice is free. The
    // retry deliberately does NOT wrap the send loop below — re-running that
    // after a mid-pass connection drop would re-send every email it had
    // already delivered.
    const rows = await withDbRetry(
      () =>
        db()
          .select()
          .from(tenants)
          .where(and(eq(tenants.plan, 'free'), isNotNull(tenants.trialEndsAt))),
      { label: 'lifecycle-email tenant scan' },
    );

    for (const t of rows) {
      // CAN-SPAM / CASL: a tenant who unsubscribed from product updates gets
      // NO further lifecycle/marketing email. (Transactional email — sign-in
      // links, lead alerts — bypasses this cron entirely and still sends.)
      if (t.marketingOptOut) continue;
      const next = decideNextEmail(t);
      if (!next) continue;
      const ok = await sendOne(t, next);
      if (ok) sent++;
    }
  } catch (err) {
    console.warn(`[email.cron] tick failed (${reason}):`, err);
    // Was a bare `return` — indistinguishable from a clean tick to the caller.
    // describeDbError unwraps drizzle's `Failed query: <entire SQL>` so the
    // alert names the cause instead of quoting the tenants column list.
    return { ok: false, processed: 0, detail: describeDbError(err) };
  }
  const ms = Date.now() - t0;
  if (sent > 0) console.log(`[email.cron] tick=${reason} sent=${sent} elapsed=${ms}ms`);
  return { ok: true, processed: sent, detail: sent > 0 ? `sent ${sent} lifecycle email(s)` : undefined };
}

interface LifecycleEmail {
  key: string;
  subject: string;
  body: string;
  html: string;
  /** Tokenized unsubscribe URL for this tenant — drives both the visible
   *  footer link (baked into `html`) and the List-Unsubscribe header. */
  listUnsubscribeUrl: string;
}

/** Decide the single lifecycle email (if any) due for tenant `t` at `now`.
 *  Priority-ordered — at most one email per tick; the 10-min cadence lets the
 *  sequence catch up smoothly. `now` is injectable for deterministic tests.
 *  Exported for tests; the cron drives it on a timer via runOnce. */
export function decideNextEmail(t: Tenant, now: number = Date.now()): LifecycleEmail | null {
  if (!t.trialEndsAt) return null;
  const sent = t.lifecycleEmailsJson ?? {};
  const trialEnd = t.trialEndsAt.getTime();
  const trialStart = trialEnd - 14 * 24 * 60 * 60 * 1000;
  const ageDays = (now - trialStart) / (24 * 60 * 60 * 1000);
  // Card reminders never go to a paying tenant. The cron query already filters
  // plan='free', but guard here too so decideNextEmail is correct on its own.
  const stillTrialing = t.plan === 'free' && now < trialEnd;

  // Welcome email — within first 10 minutes of signup.
  if (!sent.welcome) return makeWelcome(t);

  // Day 7 — mid-trial check-in.
  if (ageDays >= 7 && !sent.day_7) return makeDay7(t);

  // Day 11 — the single "few days left" card nudge (~3 days before the trial
  // ends). This replaces the retired day_12 email: two "add a card" nudges one
  // day apart was redundant, so we keep one, at the cleaner threshold, with the
  // card-after-trial copy.
  if (stillTrialing && ageDays >= 11 && !sent.trialReminderDay11SentAt) return makeDay11(t);

  // Day 14 — the last day (before expiry): "your trial ends today".
  if (stillTrialing && ageDays >= 13 && !sent.trialReminderDay14SentAt) return makeDay14(t);

  // Trial-expired win-back — deliberately held to day 15+ (≥1 day AFTER expiry)
  // so it never lands within a day of the day-14 "ends today" touch.
  if (ageDays >= 15 && !sent.day_14_expired) return makeExpired(t);

  return null;
}

function publicBaseUrl(): string {
  return loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
}

function makeWelcome(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  const unsub = unsubscribeUrl(base, t.id);
  const hosted = `https://${t.slug}.${t.hostDomain}/`;
  return {
    key: 'welcome',
    listUnsubscribeUrl: unsub,
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
    html: lifecycleWelcomeEmail({ hostedUrl: hosted, loginUrl: `${base}/login`, unsubscribeUrl: unsub }),
  };
}

function makeDay7(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  const unsub = unsubscribeUrl(base, t.id);
  return {
    key: 'day_7',
    listUnsubscribeUrl: unsub,
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
    html: lifecycleDay7Email({ loginUrl: `${base}/login`, pricingUrl: `${base}/pricing`, unsubscribeUrl: unsub }),
  };
}

function makeDay11(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  const unsub = unsubscribeUrl(base, t.id);
  return {
    key: 'trialReminderDay11SentAt',
    listUnsubscribeUrl: unsub,
    subject: `3 days left on your QuoteFleet trial`,
    body:
      `Hi,\n\n` +
      `Your all-inclusive QuoteFleet trial ends in about 3 days.\n\n` +
      `Add a card now and your calculator, hosted page, and lead inbox keep running with zero interruption — nothing changes for you or your customers. You won't be charged until the trial ends, and you can cancel anytime.\n\n` +
      `Add a card: ${base}/app  →  Plan settings.\n\n` +
      `Vital is $14.80/mo or Pro is $34.80/mo — compare plans: ${base}/pricing\n\n` +
      `Reply if you have any questions.\n\n` +
      `— QuoteFleet\n`,
    html: trialReminderDay11Email({ appUrl: `${base}/app`, pricingUrl: `${base}/pricing`, unsubscribeUrl: unsub }),
  };
}

function makeDay14(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  const unsub = unsubscribeUrl(base, t.id);
  return {
    key: 'trialReminderDay14SentAt',
    listUnsubscribeUrl: unsub,
    subject: `Your QuoteFleet trial ends today`,
    body:
      `Hi,\n\n` +
      `Today is the last day of your QuoteFleet trial.\n\n` +
      `Add a card to keep your calculator running — your hosted page and widget stay live and no leads are missed. Add it before the day is out and the switch is seamless.\n\n` +
      `If you don't, your hosted page stays up but new leads pause until you choose a plan — you can pick one back up anytime.\n\n` +
      `Add a card: ${base}/app  →  Plan settings.\n\n` +
      `Vital $14.80/mo or Pro $34.80/mo — cancel anytime. Questions, or need a few more days? Just reply.\n\n` +
      `— QuoteFleet\n`,
    html: trialReminderDay14Email({ appUrl: `${base}/app`, unsubscribeUrl: unsub }),
  };
}

function makeExpired(t: Tenant): LifecycleEmail {
  const base = publicBaseUrl();
  const unsub = unsubscribeUrl(base, t.id);
  return {
    key: 'day_14_expired',
    listUnsubscribeUrl: unsub,
    subject: `Your QuoteFleet trial has ended`,
    body:
      `Hi,\n\n` +
      `Your 14-day trial just ended. Your hosted page is still live, but new leads return a "not accepting requests" message until you choose a plan.\n\n` +
      `Vital $14.80/mo or Pro $34.80/mo — pick one in one click: ${base}/app\n\n` +
      `Or, if QuoteFleet wasn't the right fit, just reply and let me know what missed — useful even if it's a no.\n\n` +
      `— QuoteFleet\n`,
    html: lifecycleExpiredEmail({ appUrl: `${base}/app`, unsubscribeUrl: unsub }),
  };
}

async function sendOne(t: Tenant, email: LifecycleEmail): Promise<boolean> {
  if (!t.contactEmail) return false;
  try {
    const out = await sendEmail({
      to: t.contactEmail,
      subject: email.subject,
      // Plain-text parity: the HTML footer and List-Unsubscribe header both
      // carry the opt-out; text-only clients need it spelled out too.
      text:
        email.body +
        `\n---\nYou're receiving QuoteFleet product updates because you started a trial. ` +
        `Unsubscribe: ${email.listUnsubscribeUrl}\n` +
        `You'll still receive essential account emails like sign-in links.\n`,
      html: email.html,
      // Marketing/lifecycle send → attach List-Unsubscribe headers.
      listUnsubscribeUrl: email.listUnsubscribeUrl,
    });
    if (!out.ok) {
      console.error(`[email] lifecycle ${email.key} send FAILED (tenant ${t.id}): ${out.error ?? 'unknown error'}`);
      return false;
    }
    // `ok` is not `sent` — a logged-only result never reached the wire, and the
    // stamp below permanently marks this lifecycle step done, so the tenant
    // would never receive it. See wasSentByAProvider.
    if (!wasSentByAProvider(out)) {
      console.warn(
        `[email] lifecycle ${email.key} was LOGGED ONLY (provider=${out.provider ?? 'none'}, tenant ${t.id}) — not marking it sent`,
      );
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
