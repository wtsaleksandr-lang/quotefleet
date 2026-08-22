/**
 * Referral + affiliate lifecycle emails — composition, the affiliate
 * "only-on-transition-to-active" gate, and the referral per-conversion dedupe.
 *
 * The mailer is injected so we assert the recipient + one-call/no-duplicate
 * behavior without a live transport. Terms (free months, commission rates, pro
 * threshold) are pulled from programs.ts and asserted in the rendered copy so
 * the emails can never drift from the real program.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  notifyReferrerCreditEarned,
  notifyAffiliateApproved,
  isTransitionToActive,
  type Mailer,
} from './notifications.js';
import { referralCreditEarnedEmail, affiliateApprovedEmail } from '../../email/templates.js';
import {
  REFERRER_FREE_MONTHS,
  AFFILIATE_BASE_RATE,
  AFFILIATE_PRO_RATE,
  AFFILIATE_PRO_THRESHOLD,
} from './programs.js';

const okMailer = (): Mailer => vi.fn(async () => ({ ok: true, provider: 'resend' as const }));

describe('referralCreditEarnedEmail composition', () => {
  it('singular subject + terms for a 1-month credit', () => {
    const { subject, text, html } = referralCreditEarnedEmail({
      referrerName: 'Acme Freight',
      freeMonths: 1,
      dashboardUrl: 'https://quotefleet.net/app',
      referralUrl: 'https://quotefleet.net/?ref=ABCD2345',
    });
    expect(subject).toBe('You earned a free month of QuoteFleet');
    expect(text).toContain('1 free month');
    expect(text).toContain('https://quotefleet.net/app');
    expect(text).toContain('https://quotefleet.net/?ref=ABCD2345');
    expect(html).toContain('1 free month');
    // No accidental pluralization for a single month.
    expect(html).not.toContain('1 free months');
  });

  it('pluralizes for a multi-month credit', () => {
    const { subject, html } = referralCreditEarnedEmail({
      freeMonths: 3,
      dashboardUrl: 'https://quotefleet.net/app',
    });
    expect(subject).toBe('You earned 3 free months of QuoteFleet');
    expect(html).toContain('3 free months');
  });
});

describe('affiliateApprovedEmail composition', () => {
  it('interpolates the base rate + pro ladder from programs.ts', () => {
    const { subject, text, html } = affiliateApprovedEmail({
      affiliateName: 'Jordan',
      code: 'PARTNER99',
      link: 'https://quotefleet.net/?ref=PARTNER99',
      dashboardUrl: 'https://quotefleet.net/partners/dashboard?code=PARTNER99',
      commissionRatePct: Math.round(AFFILIATE_BASE_RATE * 100),
      proRatePct: Math.round(AFFILIATE_PRO_RATE * 100),
      proThreshold: AFFILIATE_PRO_THRESHOLD,
    });
    expect(subject).toBe("You're approved — your QuoteFleet affiliate link is live");
    // 25% base recurring, 30% pro at 10 customers (the real program terms).
    expect(html).toContain('25% recurring commission');
    expect(html).toContain('10+ active customers');
    expect(html).toContain('30%');
    expect(html).toContain('PARTNER99');
    expect(text).toContain('https://quotefleet.net/partners/dashboard?code=PARTNER99');
  });

  it('hides the pro ladder when the rate already meets/exceeds pro', () => {
    const { html } = affiliateApprovedEmail({
      code: 'TOP1',
      link: 'https://quotefleet.net/?ref=TOP1',
      dashboardUrl: 'https://quotefleet.net/partners/dashboard?code=TOP1',
      commissionRatePct: 35, // hand-set partner rate, above the 30% pro rung
      proRatePct: 30,
      proThreshold: 10,
    });
    expect(html).toContain('35% recurring commission');
    expect(html).not.toContain('rate rises to');
  });
});

describe('isTransitionToActive gate', () => {
  it('true only when status changes INTO active', () => {
    expect(isTransitionToActive({ status: { before: 'pending', after: 'active' } })).toBe(true);
    expect(isTransitionToActive({ status: { before: 'suspended', after: 'active' } })).toBe(true);
  });
  it('false for non-active targets, non-status edits, and no changes', () => {
    expect(isTransitionToActive({ status: { before: 'active', after: 'suspended' } })).toBe(false);
    expect(isTransitionToActive({ tier: { before: 'base', after: 'pro' } })).toBe(false);
    expect(isTransitionToActive({})).toBe(false);
    expect(isTransitionToActive(null)).toBe(false);
    expect(isTransitionToActive(undefined)).toBe(false);
  });
});

describe('notifyAffiliateApproved', () => {
  it('sends once to the affiliate email with the approved subject', async () => {
    const mailer = okMailer();
    const out = await notifyAffiliateApproved({
      to: 'jordan@example-affiliate.io',
      affiliateName: 'Jordan',
      code: 'ABCD2345',
      commissionRate: AFFILIATE_BASE_RATE,
      mailer,
    });
    expect(out).toEqual({ ok: true, provider: 'resend' });
    expect(mailer).toHaveBeenCalledTimes(1);
    const msg = (mailer as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.to).toBe('jordan@example-affiliate.io');
    expect(msg.subject).toBe("You're approved — your QuoteFleet affiliate link is live");
    expect(msg.html).toContain('25% recurring commission');
    expect(msg.text).toContain('ABCD2345');
  });

  it('skips (no send) when the recipient or code is missing', async () => {
    const mailer = okMailer();
    expect(await notifyAffiliateApproved({ to: '', code: 'ABCD2345', mailer })).toBeNull();
    expect(await notifyAffiliateApproved({ to: 'x@y.com', code: '', mailer })).toBeNull();
    expect(mailer).not.toHaveBeenCalled();
  });
});

describe('notifyReferrerCreditEarned — per-conversion dedupe', () => {
  it('emails the referrer once on a NEW conversion (creditAlreadyExisted=false)', async () => {
    const mailer = okMailer();
    const out = await notifyReferrerCreditEarned({
      creditAlreadyExisted: false,
      to: 'referrer@acme.co',
      referrerName: 'Acme',
      referralCode: 'REF12345',
      freeMonths: REFERRER_FREE_MONTHS,
      mailer,
    });
    expect(out).toEqual({ ok: true, provider: 'resend' });
    expect(mailer).toHaveBeenCalledTimes(1);
    const msg = (mailer as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.to).toBe('referrer@acme.co');
    expect(msg.subject).toContain('free month');
    // The shareable link is built from the referrer's own code.
    expect(msg.html).toContain('ref=REF12345');
  });

  it('does NOT re-email when the credit already existed (retried signup)', async () => {
    const mailer = okMailer();
    const out = await notifyReferrerCreditEarned({
      creditAlreadyExisted: true,
      to: 'referrer@acme.co',
      referralCode: 'REF12345',
      mailer,
    });
    expect(out).toBeNull();
    expect(mailer).not.toHaveBeenCalled();
  });

  it('skips when the referrer has no email on file', async () => {
    const mailer = okMailer();
    expect(
      await notifyReferrerCreditEarned({ creditAlreadyExisted: false, to: null, mailer }),
    ).toBeNull();
    expect(mailer).not.toHaveBeenCalled();
  });
});
