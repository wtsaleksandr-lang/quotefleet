/**
 * Trial-banner view logic — the single source of truth for WHAT the trial
 * countdown banner (and the Account "Plan & billing" card) should show, given
 * the tenant's trial state and whether Stripe billing is actually configured.
 *
 * Pure + framework-free so it can run in the dashboard browser bundle
 * (window.QFTrialBanner) AND be unit-tested under vitest (module.exports).
 * No DOM, no fetch — callers pass in the already-fetched state.
 *
 * Honesty rule (audit H1): the subscribe / "add a card" CTA is shown ONLY
 * when billing is configured. When Stripe is unconfigured we still show the
 * countdown, but with NO button — a dead button that 503s is worse than none.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (root) root.QFTrialBanner = mod;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /**
   * Whole days remaining until `trialEndsAt`, never negative. Mirrors the
   * server's daysBetween (ceil of the ms gap) so the client and server agree.
   * `now` is injectable for tests; defaults to the current time.
   */
  function daysLeftFrom(trialEndsAt, now) {
    if (trialEndsAt == null) return 0;
    var end = trialEndsAt instanceof Date ? trialEndsAt.getTime() : new Date(trialEndsAt).getTime();
    if (isNaN(end)) return 0;
    var ref = now == null ? Date.now() : (now instanceof Date ? now.getTime() : new Date(now).getTime());
    return Math.max(0, Math.ceil((end - ref) / 86400000));
  }

  /** Countdown headline copy, handling the 1-day / last-day edge cases. */
  function trialHeadline(daysLeft) {
    var d = typeof daysLeft === 'number' && daysLeft > 0 ? daysLeft : 0;
    if (d <= 0) return 'Trial · last day';
    if (d === 1) return 'Trial · 1 day left';
    return 'Trial · ' + d + ' days left';
  }

  /**
   * Compute the banner view-model.
   *
   *   opts.trialStatus      — 'trial' | 'trial_expired' | 'paid' | 'unknown' | null
   *   opts.daysLeft         — whole days left (from the server trial state)
   *   opts.billingConfigured — Stripe configured? (gates the CTA)
   *   opts.paymentPastDue   — paid tenant whose last charge failed (grace window)
   *
   * Returns { show, variant, urgent, headline, ctaShown, ctaLabel }.
   *   - payment_issue → "We couldn't process your payment…"; CTA "Update card →"
   *       only if configured. TAKES PRECEDENCE over every trial state: a paying
   *       but past_due tenant must see the card warning, not a trial countdown.
   *   - paid / unknown / null → { show:false } (no banner at all)
   *   - trial   → countdown; CTA "Keep your calculator live →" only if configured
   *   - expired → "Your free trial has ended"; CTA "Add a card to continue →" only if configured
   */
  function computeTrialBannerView(opts) {
    opts = opts || {};
    var status = opts.trialStatus;
    var daysLeft = typeof opts.daysLeft === 'number' ? opts.daysLeft : 0;
    var configured = !!opts.billingConfigured;

    // Precedence: a failed payment outranks any trial state. Shown for a paying
    // tenant in the dunning grace window until the card is fixed (marker clears).
    if (opts.paymentPastDue) {
      return {
        show: true,
        variant: 'payment_issue',
        urgent: true,
        headline: "We couldn't process your payment — update your card to keep your service.",
        ctaShown: configured,
        ctaLabel: configured ? 'Update card →' : null,
      };
    }

    if (status === 'trial') {
      return {
        show: true,
        variant: 'trial',
        urgent: daysLeft <= 3,
        headline: trialHeadline(daysLeft),
        ctaShown: configured,
        ctaLabel: configured ? 'Keep your calculator live →' : null,
      };
    }
    if (status === 'trial_expired') {
      return {
        show: true,
        variant: 'expired',
        urgent: true,
        headline: 'Your free trial has ended',
        ctaShown: configured,
        ctaLabel: configured ? 'Add a card to continue →' : null,
      };
    }
    // 'paid', 'unknown', null, or anything else → the tenant is on a real plan
    // (or has no trial state) so the banner does not apply.
    return { show: false, variant: null, urgent: false, headline: null, ctaShown: false, ctaLabel: null };
  }

  return {
    daysLeftFrom: daysLeftFrom,
    trialHeadline: trialHeadline,
    computeTrialBannerView: computeTrialBannerView,
  };
});
