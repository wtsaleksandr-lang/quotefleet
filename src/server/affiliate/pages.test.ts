/**
 * Partner page RENDERS — shared chrome (full header + premium footer), the
 * program terms, and the dashboard view-model. Pure string assertions, no DB.
 */
import { describe, it, expect } from 'vitest';
import {
  renderPartnersLanding,
  renderPartnersTerms,
  renderAffiliateDashboard,
  renderDashboardGate,
} from './pages.js';
import type { AffiliateDashboard } from './dashboard.js';

function expectSharedChrome(html: string) {
  expect(html).toContain('<!doctype html>');
  // Full site header (upgraded from the topnav placeholder by applyFullSiteHeader).
  expect(html).toContain('class="site-header"');
  // Premium footer + the site-wide Partners link.
  expect(html).toContain('premium-footer');
  expect(html).toContain('href="/partners"');
  // Theme-aware skin + nav CSS.
  expect(html).toContain('qf-public-wft');
  expect(html).toContain('/nav-unify.css');
}

describe('/partners landing', () => {
  const html = renderPartnersLanding();
  it('uses the shared full header + premium footer', () => expectSharedChrome(html));
  it('explains BOTH programs with the decided terms', () => {
    expect(html).toContain('Referral program');
    expect(html).toContain('Affiliate program');
    expect(html).toContain('25%');
    expect(html).toContain('30%');
    expect(html).toContain('90-day');
    expect(html).toContain('30-day trial');
  });
  it('carries the self-serve affiliate signup form', () => {
    expect(html).toContain('id="pt-signup-form"');
    expect(html).toContain('/api/partners/signup');
    expect(html).toContain('id="pt-email"');
  });
});

describe('/partners/terms', () => {
  const html = renderPartnersTerms();
  it('uses the shared chrome', () => expectSharedChrome(html));
  it('states cookie window, payout cadence, minimum + prohibited methods', () => {
    expect(html).toContain('90-day');
    expect(html.toLowerCase()).toContain('monthly');
    expect(html).toContain('$50.00');
    expect(html).toContain('Prohibited methods');
    expect(html).toContain('Self-referrals');
  });
});

describe('/partners/dashboard', () => {
  const sample: AffiliateDashboard = {
    affiliate: {
      // NOTE: no email/name/payoutMethod — the by-code dashboard view-model is
      // PII-free (the code is public, shared in every ?ref= link).
      id: 1,
      code: 'ABCD2345',
      tier: 'base',
      status: 'active',
      commissionRate: 0.25,
      link: 'https://quotefleet.net/?ref=ABCD2345',
    },
    stats: { clicks: 120, signups: 8, convertedCustomers: 3, activeReferredCustomers: 8 },
    tier: { tier: 'base', activeReferredCustomers: 8, toNextTier: 2, nextTier: 'pro', rate: 0.25 },
    earnings: { estimatedMonthlyCents: 12345, pendingCents: 0, approvedCents: 0, paidCents: 0 },
  };
  const html = renderAffiliateDashboard(sample);
  it('uses the shared chrome', () => expectSharedChrome(html));
  it('shows the affiliate link, code and stats', () => {
    expect(html).toContain('https://quotefleet.net/?ref=ABCD2345');
    expect(html).toContain('ABCD2345');
    expect(html).toContain('Link clicks');
    expect(html).toContain('120');
    expect(html).toContain('$123.45'); // estimated monthly earnings
    expect(html).toContain('2 more active customer'); // progress to Pro
  });

  it('PRIVACY: the by-code dashboard renders NO PII (email, name, payout method)', () => {
    // The dashboard is gated only by the PUBLIC code, so it must never expose the
    // affiliate's email, personal/brand name, or payout method to anyone holding
    // a ?ref= link. Only aggregate stats + tier + rate + link are shown.
    expect(html).not.toContain('creator@example.com');
    expect(html).not.toContain('Creator Co');
    expect(html.toLowerCase()).not.toContain('payout method');
  });

  it('gate page renders for a missing code', () => {
    const gate = renderDashboardGate('Enter your affiliate code.');
    expectSharedChrome(gate);
    expect(gate).toContain('affiliate code');
  });
});
