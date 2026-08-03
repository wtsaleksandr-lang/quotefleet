/**
 * Trial-banner view logic — visibility + CTA gating for the dashboard trial
 * countdown banner and the Account "Plan & billing" card.
 *
 * The single hard rule under test (audit H1): the subscribe / "add a card"
 * CTA appears ONLY when Stripe billing is configured. Unconfigured deployments
 * still get the countdown, but with no dead button. Paid tenants get no banner.
 */
import { describe, it, expect } from 'vitest';
import { computeTrialBannerView, daysLeftFrom, trialHeadline } from './public/trial-banner.js';

describe('computeTrialBannerView', () => {
  it('trialing + billing configured → countdown with subscribe CTA', () => {
    const v = computeTrialBannerView({ trialStatus: 'trial', daysLeft: 10, billingConfigured: true });
    expect(v.show).toBe(true);
    expect(v.variant).toBe('trial');
    expect(v.ctaShown).toBe(true);
    expect(v.ctaLabel).toBe('Keep your calculator live →');
    expect(v.headline).toBe('Trial · 10 days left');
    expect(v.urgent).toBe(false);
  });

  it('trialing + billing NOT configured → countdown but NO CTA (no dead button)', () => {
    const v = computeTrialBannerView({ trialStatus: 'trial', daysLeft: 10, billingConfigured: false });
    expect(v.show).toBe(true);
    expect(v.ctaShown).toBe(false);
    expect(v.ctaLabel).toBeNull();
  });

  it('trialing marks urgent within the final 3 days', () => {
    expect(computeTrialBannerView({ trialStatus: 'trial', daysLeft: 3, billingConfigured: true }).urgent).toBe(true);
    expect(computeTrialBannerView({ trialStatus: 'trial', daysLeft: 4, billingConfigured: true }).urgent).toBe(false);
  });

  it('expired + configured → "ended" headline with add-a-card CTA', () => {
    const v = computeTrialBannerView({ trialStatus: 'trial_expired', daysLeft: 0, billingConfigured: true });
    expect(v.show).toBe(true);
    expect(v.variant).toBe('expired');
    expect(v.urgent).toBe(true);
    expect(v.headline).toBe('Your free trial has ended');
    expect(v.ctaShown).toBe(true);
    expect(v.ctaLabel).toBe('Add a card to continue →');
  });

  it('expired + NOT configured → "ended" headline, no CTA', () => {
    const v = computeTrialBannerView({ trialStatus: 'trial_expired', daysLeft: 0, billingConfigured: false });
    expect(v.show).toBe(true);
    expect(v.variant).toBe('expired');
    expect(v.ctaShown).toBe(false);
    expect(v.ctaLabel).toBeNull();
  });

  it('paid tenant → no banner at all (even if configured)', () => {
    const v = computeTrialBannerView({ trialStatus: 'paid', daysLeft: 0, billingConfigured: true });
    expect(v.show).toBe(false);
    expect(v.ctaShown).toBe(false);
  });

  it('unknown / null trial state → no banner', () => {
    expect(computeTrialBannerView({ trialStatus: 'unknown', billingConfigured: true }).show).toBe(false);
    expect(computeTrialBannerView({ trialStatus: null, billingConfigured: true }).show).toBe(false);
    expect(computeTrialBannerView({}).show).toBe(false);
  });
});

describe('trialHeadline (day-count copy edges)', () => {
  it('pluralizes days, singularizes 1 day, and calls the final day "last day"', () => {
    expect(trialHeadline(10)).toBe('Trial · 10 days left');
    expect(trialHeadline(1)).toBe('Trial · 1 day left');
    expect(trialHeadline(0)).toBe('Trial · last day');
    expect(trialHeadline(-2)).toBe('Trial · last day');
  });
});

describe('daysLeftFrom', () => {
  const now = new Date('2026-05-01T00:00:00Z');

  it('computes whole days remaining (ceil of the gap), never negative', () => {
    expect(daysLeftFrom(new Date('2026-05-15T00:00:00Z'), now)).toBe(14);
    expect(daysLeftFrom(new Date('2026-05-01T12:00:00Z'), now)).toBe(1); // part of a day rounds up
    expect(daysLeftFrom(new Date('2026-04-20T00:00:00Z'), now)).toBe(0); // already past
  });

  it('accepts ISO strings and treats missing/invalid dates as 0', () => {
    expect(daysLeftFrom('2026-05-11T00:00:00Z', now)).toBe(10);
    expect(daysLeftFrom(null, now)).toBe(0);
    expect(daysLeftFrom('not-a-date', now)).toBe(0);
  });
});
