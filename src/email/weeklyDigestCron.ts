/**
 * Weekly performance digest cron — sends each active tenant a recap of how
 * their calculator performed over the last 7 days (quotes, conversions,
 * callbacks, chats, on-page engagement). A retention/relationship email.
 *
 * Schedule: hourly tick from app boot. The tick fires the actual send pass
 * only on the weekly slot — Monday ~14:00 UTC. The per-tenant 6-day guard
 * (tenants.lastWeeklyDigestAt) is the real double-send protection: it makes
 * the pass idempotent across the hour the slot is open and across restarts.
 *
 * AUDIENCE (v1) — deliberately narrow:
 *   - Core access only (live paid Vital/Pro OR an active trial). 'free'
 *     tenants (never subscribed / cancelled) get no digest.
 *   - At least 1 quote/callback/chat/auto-reply in the window. We never send a
 *     "0 quotes this week" email to an empty/inactive account — that's
 *     demotivating and hurts deliverability.
 *   - NOT opted out of marketing (CAN-SPAM / CASL). marketingOptOut → skip.
 *
 * Kill-switch: WEEKLY_DIGEST_DISABLED=1 disables the cron entirely (tests,
 * second instance). Single-instance assumption (Reserved VM = one node) — same
 * as the lifecycle cron; multi-instance would need a distributed lock.
 *
 * Email opens / link clicks are OUT OF SCOPE for v1 (need an ESP webhook); the
 * template shows a "coming soon" placeholder — see TODO(phase2) there.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants, type Tenant } from '../db/schema.js';
import { sendEmail } from './send.js';
import { weeklyDigestEmail } from './templates.js';
import { unsubscribeUrl } from './unsubscribe.js';
import { computeWeeklyStats, type WeeklyDigestStats } from './weeklyDigest.js';
import { hasCoreAccess, isTrialing } from '../server/plans.js';
import { loadEnv } from '../config.js';
import { runTrackedJob, outcomeFromTick, jobSkipped, type TickResult } from '../server/jobHealth.js';

const TICK_MS = 60 * 60 * 1000; // hourly
const STARTUP_DELAY_MS = 90 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Primary send slot: Monday (UTC day 1), 14:00 UTC — ALL audiences. */
const PRIMARY_DOW = 1;
const SEND_HOUR = 14;
/** Second slot: Thursday (UTC day 4), 14:00 UTC — ACTIVE-TRIAL tenants only.
 *  Live-paid tenants keep the Monday-only weekly cadence. */
const TRIAL_DOW = 4;

/** Don't re-send within this many days — the double-send guard.
 *  Live-paid: weekly (6d). Active trial: more frequent (3d) so a trialing
 *  carrier gets both the Monday and the Thursday recap during their 14 days. */
const RESEND_COOLDOWN_MS = 6 * DAY_MS;
const TRIAL_RESEND_COOLDOWN_MS = 3 * DAY_MS;

/** The extra Thursday trial slot + shorter trial cooldown are ON by default;
 *  set WEEKLY_DIGEST_TRIAL_EXTRA=0 to disable (all tenants → Monday weekly). */
function trialExtraEnabled(): boolean {
  return process.env.WEEKLY_DIGEST_TRIAL_EXTRA !== '0';
}

let started = false;

export function startWeeklyDigestCron(): void {
  if (started) return;
  if (process.env.WEEKLY_DIGEST_DISABLED === '1') {
    console.log('[weeklyDigest.cron] disabled via WEEKLY_DIGEST_DISABLED=1');
    return;
  }
  started = true;
  setTimeout(() => void maybeRun('startup'), STARTUP_DELAY_MS);
  setInterval(() => void maybeRun('tick'), TICK_MS);
  console.log(
    `[weeklyDigest.cron] scheduled — hourly tick; slots Mon ${SEND_HOUR}:00 UTC (all)` +
      (trialExtraEnabled() ? ` + Thu ${SEND_HOUR}:00 UTC (trial only)` : '')
  );
}

/** Gate the hourly tick to a send slot, then run the pass. Monday fires for all
 *  audiences; Thursday (when enabled) fires the trial-only second slot. */
async function maybeRun(reason: string): Promise<void> {
  // Every hourly tick records to the ledger, including the 23 hours a day that
  // are outside the send slot. Those are `skipped` — healthy — and they are what
  // give this job an hourly heartbeat instead of a weekly one, so a dead
  // scheduler is caught in hours rather than a week. See jobHealthWatchdog.ts.
  await runTrackedJob('weekly-digest', async () => {
    const now = new Date();
    if (now.getUTCHours() !== SEND_HOUR) return jobSkipped('outside the 14:00 UTC send hour');
    const dow = now.getUTCDay();
    if (dow === PRIMARY_DOW || (dow === TRIAL_DOW && trialExtraEnabled())) {
      return outcomeFromTick(await runWeeklyDigestOnce(reason, now), 'no tenant was due a digest');
    }
    return jobSkipped('not a digest send day');
  });
}

/**
 * One digest pass — scan active tenants, and for each that qualifies (core
 * access, opted-in, not sent in the cooldown, and had activity in the window)
 * compute the week's stats and send the digest. Exported for tests (the cron
 * gates WHEN via maybeRun; this does the actual work). `now` is injectable.
 */
export async function runWeeklyDigestOnce(reason: string, now: Date = new Date()): Promise<TickResult> {
  const t0 = Date.now();
  let sent = 0;
  let skippedEmpty = 0;
  try {
    // Fetch all active tenants and filter for core access in JS — access is
    // computed from (plan + trialEndsAt) via hasCoreAccess, not a single
    // column. Tenant count is small; this is a once-a-week scan.
    // Thursday is the trial-only second slot; Monday serves all audiences.
    // When the trial-extra cadence is disabled there is nothing to send on the
    // Thursday slot (it exists ONLY for trials), so bail before the tenant scan.
    const isTrialSlot = now.getUTCDay() === TRIAL_DOW;
    if (isTrialSlot && !trialExtraEnabled()) {
      return { ok: true, processed: 0, detail: 'Thursday trial slot is disabled' };
    }

    const rows = await db().select().from(tenants).where(eq(tenants.status, 'active'));

    for (const t of rows) {
      // Audience gate 1: core access (paid live or active trial). 'free' → skip.
      if (!hasCoreAccess(t)) continue;
      // Audience gate 2: marketing opt-out (CAN-SPAM / CASL) → skip.
      if (t.marketingOptOut) continue;

      const trialing = isTrialing(t);
      // Audience gate 3: the Thursday slot is trial-only — live-paid tenants
      // keep the Monday weekly and are skipped here.
      if (isTrialSlot && !trialing) continue;

      // Audience gate 4: double-send cooldown — shorter for active trials so
      // they can receive both the Monday and the Thursday recap.
      const cooldown = trialing && trialExtraEnabled() ? TRIAL_RESEND_COOLDOWN_MS : RESEND_COOLDOWN_MS;
      if (t.lastWeeklyDigestAt && now.getTime() - t.lastWeeklyDigestAt.getTime() < cooldown) {
        continue;
      }

      const stats = await computeWeeklyStats(t.id, now);
      // Audience gate 5: don't email empty/inactive accounts a "0 quotes" recap
      // (applies to BOTH slots — trialing tenants are never sent an empty one).
      if (stats.isEmpty) {
        skippedEmpty++;
        continue;
      }

      const ok = await sendOne(t, stats, now);
      if (ok) sent++;
    }
  } catch (err) {
    console.warn(`[weeklyDigest.cron] pass failed (${reason}):`, err);
    // Was a bare `return` — indistinguishable from a clean pass to the caller.
    return { ok: false, processed: 0, detail: err instanceof Error ? err.message : String(err) };
  }
  const ms = Date.now() - t0;
  if (sent > 0 || skippedEmpty > 0) {
    console.log(
      `[weeklyDigest.cron] pass=${reason} sent=${sent} skippedEmpty=${skippedEmpty} elapsed=${ms}ms`
    );
  }
  return {
    ok: true,
    processed: sent,
    detail: sent > 0 ? `sent ${sent} digest(s), skipped ${skippedEmpty} empty account(s)` : undefined,
  };
}

function publicBaseUrl(): string {
  return loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jul 7 – Jul 14" for the window ending at `now` (UTC). */
function formatDateRange(now: Date): string {
  const end = now;
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

async function sendOne(t: Tenant, stats: WeeklyDigestStats, now: Date): Promise<boolean> {
  if (!t.contactEmail) return false;
  const base = publicBaseUrl();
  const unsub = unsubscribeUrl(base, t.id);
  const dashboardUrl = `${base}/app/overview`;
  // Trial tenants get a light "N days left" reinforcement band (momentum, not a
  // card-nudge); live-paid tenants get no band.
  const trialDaysLeft =
    isTrialing(t) && t.trialEndsAt
      ? Math.max(0, Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
      : undefined;
  const html = weeklyDigestEmail({
    companyName: t.name,
    dateRange: formatDateRange(now),
    quotes: stats.quotesThisWeek,
    quotesDelta: stats.quotesPrevWeek > 0 || stats.quotesThisWeek > 0 ? stats.quotesDelta : undefined,
    conversions: stats.conversions,
    conversionPct: stats.conversionPct,
    callbacks: stats.callbacks,
    autoReplies: stats.autoRepliesSent,
    chatConversations: stats.chatConversations,
    views: stats.engagement.views,
    pdfSaves: stats.engagement.pdfSaves,
    copyLinks: stats.engagement.copyLinks,
    prints: stats.engagement.prints,
    trialDaysLeft,
    dashboardUrl,
    unsubscribeUrl: unsub,
  });

  const text =
    `Your QuoteFleet week (${formatDateRange(now)})\n\n` +
    `• Quotes requested: ${stats.quotesThisWeek}` +
    (stats.quotesDelta !== 0 ? ` (${stats.quotesDelta > 0 ? '+' : ''}${stats.quotesDelta} vs last week)` : '') +
    `\n` +
    `• Booked / won: ${stats.conversions} (${stats.conversionPct}%)\n` +
    `• Callbacks requested: ${stats.callbacks}\n` +
    `• Auto-replies sent: ${stats.autoRepliesSent}\n` +
    `• Chat conversations: ${stats.chatConversations}\n` +
    `• Quote page views: ${stats.engagement.views}\n` +
    `• PDF quotes saved: ${stats.engagement.pdfSaves}\n\n` +
    `See the full breakdown: ${dashboardUrl}\n\n` +
    `---\nYou're receiving QuoteFleet performance recaps because you have an active account. ` +
    `Unsubscribe: ${unsub}\n` +
    `You'll still receive essential account emails like sign-in links.\n`;

  try {
    const out = await sendEmail({
      to: t.contactEmail,
      subject: `Your QuoteFleet week — ${stats.quotesThisWeek} quote${stats.quotesThisWeek === 1 ? '' : 's'}`,
      text,
      html,
      // Marketing/relationship send → attach List-Unsubscribe headers.
      listUnsubscribeUrl: unsub,
    });
    if (!out.ok) {
      console.error(`[weeklyDigest] send FAILED (tenant ${t.id}): ${out.error ?? 'unknown error'}`);
      return false;
    }
    await db()
      .update(tenants)
      .set({ lastWeeklyDigestAt: now, updatedAt: new Date() })
      .where(eq(tenants.id, t.id));
    return true;
  } catch (err) {
    console.warn(`[weeklyDigest.cron] sending to tenant ${t.id} failed:`, err);
    return false;
  }
}
