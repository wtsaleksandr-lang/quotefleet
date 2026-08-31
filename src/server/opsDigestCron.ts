/**
 * Daily ops digest — the work that CANNOT be automated, delivered instead of
 * remembered.
 *
 * WHY THIS EXISTS
 * ───────────────
 * QuoteFleet pushes email to customers on five different schedules (lifecycle,
 * follow-up, dunning, weekly digest, manifest renewal). Until now it pushed
 * essentially NOTHING to the operator: every piece of work that genuinely needs
 * a human lived behind a page somebody had to remember to open.
 *
 * The sharpest case is Manifest Privacy. A customer pays, e-signs a POA, and is
 * emailed "we'll keep you posted as your status moves from Signed to Submitted
 * to Confirmed" — a promise backed entirely by someone remembering to open
 * /admin/privacy. Worse, the renewal cron scans `expiresAt >= now`, so the
 * moment a filing actually LAPSES it drops out of every automated path there is.
 * A lapsed CBP confidentiality filing silently re-exposes a paying customer's
 * shipment data, and nothing anywhere says so.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ──────────────────────────────────
 * It does not file anything with CBP, does not move money, and does not deploy.
 * Filing a legal instrument on a customer's behalf is a judgment call with a
 * regulator on the other end; the goal here is to remove the REMEMBERING, not
 * the deciding. Every item below is a prompt with the context needed to act,
 * and a link to the page where a human acts.
 *
 * NO-NOISE RULE
 * ─────────────
 * When there is nothing to do, this sends NOTHING and records `skipped`. A daily
 * "all clear" email trains the reader to ignore the sender, which would defeat
 * the entire point. Silence means "nothing needs you"; an email means "these
 * specific things do".
 *
 * COST: one email/day at most, on the existing provider, plus three small
 * indexed queries. $0.
 */
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { poaApplications, tenants } from '../db/schema.js';
import { loadEnv } from '../config.js';
import { sendEmail } from '../email/send.js';
import { runTrackedJob, jobSkipped, jobSuccess, jobFailure, type JobOutcome } from './jobHealth.js';
import { classifyJobs, readJobHealth, JOB_REGISTRY } from './jobHealthWatchdog.js';
import { BILLING_PAST_DUE_KEY } from './trialGating.js';

const TICK_MS = 60 * 60 * 1000; // hourly tick
const STARTUP_DELAY_MS = 3 * 60 * 1000;
/** One digest a day, at 13:00 UTC (morning in North America). */
const SEND_HOUR = 13;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that mean "a human owes this filing an action right now". */
const AWAITING_ACTION_STATUSES = ['signed', 'submitted'] as const;

/** A filing older than this in `signed` without being submitted is called out
 *  as ageing — the customer was promised progress. */
export const FILING_AGEING_DAYS = 3;

let started = false;

export function startOpsDigestCron(): void {
  if (started) return;
  if (process.env.OPS_DIGEST_DISABLED === '1') {
    console.log('[opsDigest.cron] disabled via OPS_DIGEST_DISABLED=1');
    return;
  }
  started = true;
  setTimeout(() => void maybeRun('startup'), STARTUP_DELAY_MS);
  setInterval(() => void maybeRun('tick'), TICK_MS);
  console.log(`[opsDigest.cron] scheduled — hourly tick; daily digest at ${SEND_HOUR}:00 UTC`);
}

/** Hourly tick; the 23 non-slot hours record as `skipped` so this job has an
 *  hourly heartbeat for the staleness watchdog. */
async function maybeRun(reason: string): Promise<void> {
  await runTrackedJob('ops-digest', async () => {
    const now = new Date();
    if (now.getUTCHours() !== SEND_HOUR) return jobSkipped(`outside the ${SEND_HOUR}:00 UTC digest hour`);
    return runOpsDigestOnce(reason, now);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The action queue
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionItem {
  /** Short label, e.g. "CBP filing awaiting submission". */
  kind: string;
  /** One line per concrete thing needing action. */
  lines: string[];
  /** True for items with a legal / customer-promise deadline attached. */
  urgent: boolean;
}

function daysAgo(d: Date, now: Date): number {
  return Math.floor((now.getTime() - d.getTime()) / DAY_MS);
}

/**
 * Build the action queue. Exported and dependency-free apart from `db()` so the
 * digest's SHAPE can be asserted separately from its delivery.
 *
 * Any query failure PROPAGATES — a digest that cannot read the queue must not
 * be reported as "nothing to do". That distinction is the whole contract.
 */
export async function collectActionItems(now: Date): Promise<ActionItem[]> {
  const items: ActionItem[] = [];

  // 1. Filings a human must move: signed (needs filing) / submitted (awaiting
  //    CBP confirmation). These are what /admin/privacy exists to work through.
  const awaiting = await db()
    .select({
      id: poaApplications.id,
      status: poaApplications.status,
      grantor: poaApplications.grantorLegalName,
      signedAt: poaApplications.signedAt,
      createdAt: poaApplications.createdAt,
    })
    .from(poaApplications)
    .where(inArray(poaApplications.status, [...AWAITING_ACTION_STATUSES]));

  if (awaiting.length > 0) {
    const lines = awaiting.map((a) => {
      const since = a.signedAt ?? a.createdAt;
      const age = daysAgo(since, now);
      const flag = a.status === 'signed' && age >= FILING_AGEING_DAYS ? '  ← AGEING' : '';
      return `#${a.id} ${a.grantor ?? '(no legal name)'} — ${a.status} for ${age}d${flag}`;
    });
    items.push({
      kind: `${awaiting.length} CBP filing(s) awaiting your action`,
      lines,
      urgent: awaiting.some((a) => a.status === 'signed' && daysAgo(a.signedAt ?? a.createdAt, now) >= FILING_AGEING_DAYS),
    });
  }

  // 2. LAPSED filings. The renewal cron scans `expiresAt >= now`, so the instant
  //    a filing expires it falls out of every automated path in the product.
  //    This is the one place it is ever surfaced again. Protection has STOPPED
  //    for a customer who paid for it, so it is always urgent.
  const lapsed = await db()
    .select({
      id: poaApplications.id,
      grantor: poaApplications.grantorLegalName,
      expiresAt: poaApplications.expiresAt,
      status: poaApplications.status,
    })
    .from(poaApplications)
    .where(
      and(
        isNotNull(poaApplications.expiresAt),
        lt(poaApplications.expiresAt, now),
        inArray(poaApplications.status, ['active', 'renewal_due', 'expired']),
      ),
    );

  if (lapsed.length > 0) {
    items.push({
      kind: `${lapsed.length} CBP filing(s) have LAPSED — protection has stopped`,
      lines: lapsed.map(
        (a) =>
          `#${a.id} ${a.grantor ?? '(no legal name)'} — expired ${a.expiresAt ? daysAgo(a.expiresAt, now) : '?'}d ago (status ${a.status})`,
      ),
      urgent: true,
    });
  }

  // 3. Past-due subscriptions. The dunning sequence ends at day 6; after that
  //    nobody is told, and the tenant simply churns.
  const pastDue = await db()
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(sql`${tenants.lifecycleEmailsJson} ->> ${BILLING_PAST_DUE_KEY} is not null`);

  if (pastDue.length > 0) {
    items.push({
      kind: `${pastDue.length} tenant(s) past due on payment`,
      lines: pastDue.map((t) => `#${t.id} ${t.name}`),
      urgent: false,
    });
  }

  return items;
}

/** Stale / failing background jobs, as digest lines. Never throws — job health
 *  is a bonus section, and losing it must not suppress the action queue. */
async function collectJobHealthLines(now: Date): Promise<string[]> {
  try {
    const health = await readJobHealth();
    const reports = classifyJobs(JOB_REGISTRY, health, now, now, process.env as Record<string, string | undefined>);
    return reports
      .filter((r) => r.verdict === 'stale' || r.lastStatus === 'failure')
      .map((r) => `${r.job} — ${r.verdict}${r.lastStatus ? `, last run ${r.lastStatus}` : ''}${r.lastDetail ? `: ${r.lastDetail}` : ''}`);
  } catch (err) {
    return [`(job health unavailable: ${String(err)})`];
  }
}

export function buildDigestBody(items: readonly ActionItem[], jobLines: readonly string[], now: Date): string {
  const out: string[] = [`QuoteFleet ops digest — ${now.toISOString().slice(0, 10)}`, ''];
  for (const item of items) {
    out.push(`${item.urgent ? '[URGENT] ' : ''}${item.kind}`);
    for (const l of item.lines) out.push(`   ${l}`);
    out.push('');
  }
  if (jobLines.length > 0) {
    out.push('Background jobs needing attention');
    for (const l of jobLines) out.push(`   ${l}`);
    out.push('');
  }
  out.push('Act on filings at /admin/privacy · full job history at /api/admin/job-health');
  out.push('');
  out.push(
    'You only receive this email on days that something needs you. No email means nothing does.',
  );
  return out.join('\n');
}

/**
 * One digest pass. Exported for tests; the cron gates WHEN via maybeRun.
 *
 * A query failure propagates out to runTrackedJob, which records `failure` and
 * emails — an ops digest that silently reports an empty queue because it could
 * not read the database would be strictly worse than no digest at all.
 */
export async function runOpsDigestOnce(reason: string, now: Date = new Date()): Promise<JobOutcome> {
  const items = await collectActionItems(now);
  const jobLines = await collectJobHealthLines(now);

  if (items.length === 0 && jobLines.length === 0) {
    return jobSkipped('nothing needs a human today');
  }

  const to = loadEnv().SUPER_ADMIN_EMAIL;
  if (!to) {
    // Config gap, not an empty queue — say so loudly rather than reporting a
    // clean pass while the work piles up unseen.
    return jobFailure(
      `${items.length} action item(s) need a human but SUPER_ADMIN_EMAIL is not configured, so the ops digest cannot be delivered.`,
    );
  }

  const urgent = items.some((i) => i.urgent);
  const subject = `${urgent ? '[URGENT] ' : ''}QuoteFleet ops — ${items.length} item(s) need you`;
  const out = await sendEmail({ to, subject, text: buildDigestBody(items, jobLines, now) });
  if (!out.ok) {
    return jobFailure(`ops digest send failed: ${out.error ?? 'unknown error'}`);
  }
  console.log(`[opsDigest.cron] pass=${reason} sent digest with ${items.length} action item(s)`);
  return jobSuccess(items.length, `digest sent with ${items.length} action item(s)`);
}
