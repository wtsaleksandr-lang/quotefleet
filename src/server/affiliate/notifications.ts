/**
 * Referral + affiliate lifecycle email SENDERS (best-effort, never-throw).
 *
 * These make the two silent programs feel alive:
 *   1. notifyReferrerCreditEarned — the referrer's "you earned a free month"
 *      email, fired ONCE per real conversion (gated on a genuinely-new credit,
 *      so a retried signup never re-emails).
 *   2. notifyAffiliateApproved — the affiliate's "you're approved, here's your
 *      link + dashboard" email, fired once when the account becomes `active`
 *      (self-serve signup auto-activates; or an admin flips status → active —
 *      isTransitionToActive gates that path).
 *
 * The mailer is injectable (`opts.mailer`) purely so tests can assert the
 * recipient + one-call/no-duplicate behavior without a live transport. In
 * production it defaults to sendEmail (which already skips reserved/test
 * domains + logs on failure). Every send is wrapped so a mail failure can
 * never break the signup path or the admin PATCH.
 */
import { sendEmail, type EmailIn, type EmailOut } from '../../email/send.js';
import { referralCreditEarnedEmail, affiliateApprovedEmail } from '../../email/templates.js';
import { affiliateLink } from './dashboard.js';
import {
  REFERRER_FREE_MONTHS,
  AFFILIATE_BASE_RATE,
  AFFILIATE_PRO_RATE,
  AFFILIATE_PRO_THRESHOLD,
} from './programs.js';

/** Injectable mailer — matches sendEmail's shape. */
export type Mailer = (msg: EmailIn) => Promise<EmailOut>;

/** Canonical public base for the human-facing links (mirrors partners.ts). */
const APP_BASE = 'https://quotefleet.net';

/**
 * Email the referrer that they earned a free-month credit — but ONLY on a NEW
 * conversion. `creditAlreadyExisted` is the dedupe gate: the credit row is
 * idempotent (one per attribution), so a retried signup that finds it already
 * queued must NOT re-email. Returns the send result, or null when skipped.
 */
export async function notifyReferrerCreditEarned(opts: {
  /** True when the free-month credit already existed → this is a retry, skip. */
  creditAlreadyExisted: boolean;
  /** Referrer's account (contact) email. */
  to: string | null | undefined;
  referrerName?: string | null;
  freeMonths?: number;
  /** The referrer's own referral code, used to build the shareable link. */
  referralCode?: string | null;
  dashboardUrl?: string;
  mailer?: Mailer;
}): Promise<EmailOut | null> {
  if (opts.creditAlreadyExisted) return null;
  const to = String(opts.to ?? '').trim();
  if (!to) return null;
  const mailer = opts.mailer ?? sendEmail;
  const code = String(opts.referralCode ?? '').trim();
  const { subject, text, html } = referralCreditEarnedEmail({
    referrerName: opts.referrerName ?? null,
    freeMonths: opts.freeMonths ?? REFERRER_FREE_MONTHS,
    dashboardUrl: opts.dashboardUrl ?? `${APP_BASE}/app`,
    referralUrl: code ? affiliateLink(code, APP_BASE) : null,
  });
  try {
    return await mailer({ to, subject, text, html });
  } catch (err) {
    console.warn('[affiliate] referral-credit email failed (non-fatal):', err);
    return null;
  }
}

/**
 * True when an affiliate PATCH's before→after `changed` map represents a real
 * transition INTO the `active` state (status present in `changed`, new value
 * 'active', old value not already 'active'). Drives the once-per-affiliate
 * "you're approved" email so a no-op PATCH or a non-status edit never emails.
 */
export function isTransitionToActive(
  changed: Record<string, { before: unknown; after: unknown }> | null | undefined,
): boolean {
  const s = changed?.status;
  return !!s && s.after === 'active' && s.before !== 'active';
}

/**
 * Email an affiliate their approved/activated welcome (link + dashboard).
 * `commissionRate` is the affiliate's own fraction (defaults to the base rate);
 * the pro rung is sourced from programs.ts so the ladder copy stays accurate.
 * Best-effort + never throws. Returns the send result, or null when skipped.
 */
export async function notifyAffiliateApproved(opts: {
  to: string | null | undefined;
  affiliateName?: string | null;
  code: string | null | undefined;
  /** Affiliate's stored commission rate as a fraction (0.25 = 25%). */
  commissionRate?: number | null;
  mailer?: Mailer;
}): Promise<EmailOut | null> {
  const to = String(opts.to ?? '').trim();
  const code = String(opts.code ?? '').trim();
  if (!to || !code) return null;
  const mailer = opts.mailer ?? sendEmail;
  const rateFraction =
    typeof opts.commissionRate === 'number' && opts.commissionRate > 0
      ? opts.commissionRate
      : AFFILIATE_BASE_RATE;
  const { subject, text, html } = affiliateApprovedEmail({
    affiliateName: opts.affiliateName ?? null,
    code,
    link: affiliateLink(code, APP_BASE),
    dashboardUrl: `${APP_BASE}/partners/dashboard?code=${encodeURIComponent(code)}`,
    commissionRatePct: Math.round(rateFraction * 100),
    proRatePct: Math.round(AFFILIATE_PRO_RATE * 100),
    proThreshold: AFFILIATE_PRO_THRESHOLD,
  });
  try {
    return await mailer({ to, subject, text, html });
  } catch (err) {
    console.warn('[affiliate] affiliate-approved email failed (non-fatal):', err);
    return null;
  }
}
