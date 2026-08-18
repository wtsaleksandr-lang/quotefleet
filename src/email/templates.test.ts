/**
 * Follow-up email templates (Wave 1) — the 3-touch automated sequence.
 *
 * The load-bearing invariant under test: FU3 (the discount touch) can NEVER be
 * rendered without a real promo code + a positive percent — a missing code
 * means there is no discount, so it must refuse rather than send an empty
 * "here's your discount" email. Also locks the carrier-branded commercial
 * footer (unsubscribe + postal address) on every touch.
 */
import { describe, it, expect } from 'vitest';
import {
  followupNudgeEmail,
  followupReminderEmail,
  followupDiscountEmail,
  magicLinkEmail,
  lifecycleWelcomeEmail,
} from './templates.js';

const base = {
  refId: 'QF-10428',
  customerName: 'Jordan',
  brandName: 'Harbor Link Logistics',
  brandLogoUrl: null,
  quoteUrl: 'https://harborlink.quotefleet.net/q/QF-10428',
  laneFrom: 'Newark, NJ',
  laneTo: 'Columbus, OH',
  total: '$2,450.00',
  unsubscribeUrl: 'https://harborlink.quotefleet.net/unsub/abc123',
};

describe('QuoteFleet-branded shell — reliable live-text logo + single-line footer', () => {
  it('renders a live-text "QuoteFleet" wordmark + a CSS-driven light/dark logo swap (both marks hosted)', () => {
    const { html } = magicLinkEmail({ link: 'https://quotefleet.net/m/abc', email: 'a@b.com' });
    // Live-text wordmark ALWAYS renders — the reliable brand element.
    expect(html).toContain('class="qf-wordmark"');
    expect(html).toMatch(/qf-wordmark[^>]*>QuoteFleet</);
    // Both hosted marks are present: light (dark-outlined truck) shown by
    // default, dark (white-outlined truck) revealed under prefers-color-scheme:
    // dark. This is a display: swap driven by the <head> media query (NOT the
    // old broken dual-<src> that showed red-X in Outlook).
    expect(html).toContain('https://quotefleet.net/brand/logo-full.png');
    expect(html).toContain('https://quotefleet.net/brand/logo-full-ondark.png');
    expect(html).toContain('qf-logo-light');
    expect(html).toContain('qf-logo-dark');
    // The dark override is CSS-scoped: wordmark goes white, logos swap by display.
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*\.qf-wordmark \{ color: #FFFFFF/);
    expect(html).toMatch(/\.qf-logo-light \{ display: none/);
    expect(html).toMatch(/\.qf-logo-dark \{ display: inline-block/);
  });

  it('footer legal links are a single line: Privacy · Terms · Security · DPA (in order)', () => {
    const { html } = magicLinkEmail({ link: 'https://quotefleet.net/m/abc', email: 'a@b.com' });
    expect(html).toContain('quotefleet.net/privacy');
    expect(html).toContain('quotefleet.net/terms');
    expect(html).toContain('quotefleet.net/security');
    expect(html).toContain('quotefleet.net/dpa');
    // Order Privacy → Terms → Security → DPA on the one links line.
    expect(html).toMatch(/\/privacy[\s\S]*\/terms[\s\S]*\/security[\s\S]*\/dpa/);
  });

  it('drops the "The QuoteFleet Team" footer line entirely', () => {
    const { html } = magicLinkEmail({ link: 'https://quotefleet.net/m/abc', email: 'a@b.com' });
    expect(html).not.toContain('The QuoteFleet Team');
  });

  it('marketing (lifecycle) shell keeps the same logo/footer treatment', () => {
    const html = lifecycleWelcomeEmail({
      hostedUrl: 'https://demo.quotefleet.net',
      loginUrl: 'https://app.quotefleet.net',
      unsubscribeUrl: 'https://app.quotefleet.net/unsub/xyz',
    });
    expect(html).toContain('class="qf-wordmark"');
    // Marketing shell carries the same light/dark logo swap as transactional.
    expect(html).toContain('logo-full-ondark.png');
    expect(html).not.toContain('The QuoteFleet Team');
    expect(html).toContain('quotefleet.net/privacy');
    expect(html).toContain('quotefleet.net/terms');
    // CAN-SPAM legal footer still present on marketing sends.
    expect(html).toContain('Sheridan, WY');
    expect(html).toContain('unsub/xyz');
  });
});

describe('followupNudgeEmail (FU1)', () => {
  it('renders the customer name in the subject and never shows a discount', () => {
    const { subject, html } = followupNudgeEmail(base);
    expect(subject).toContain('Jordan');
    expect(html).toContain('Harbor Link Logistics');
    expect(html).toContain('$2,450.00');
    // FU1 is a gentle nudge — no discount language at all.
    expect(html).not.toMatch(/% off/i);
    expect(html).not.toMatch(/promo/i);
  });

  it('carries the CAN-SPAM footer (unsubscribe + postal address)', () => {
    const { html } = followupNudgeEmail(base);
    expect(html).toContain(base.unsubscribeUrl);
    expect(html).toContain('Sheridan, WY');
    expect(html).toContain('Powered by');
  });
});

describe('followupReminderEmail (FU2)', () => {
  it('references the ref id and holds the price, still no discount', () => {
    const { subject, html } = followupReminderEmail(base);
    expect(subject).toContain('QF-10428');
    expect(html).toContain('$2,450.00');
    expect(html).not.toMatch(/% off/i);
    expect(html).toContain(base.unsubscribeUrl);
  });
});

describe('followupDiscountEmail (FU3) — NEVER renders a discount without a code', () => {
  it('renders the code, percent, and a promo-pre-applied CTA when given a real code', () => {
    const { subject, html } = followupDiscountEmail({ ...base, promoCode: 'SAVE8', percentOff: 8 });
    expect(subject).toContain('SAVE8');
    expect(html).toContain('SAVE8');
    expect(html).toContain('8% off');
    // CTA link carries the promo param so it's pre-applied on arrival.
    expect(html).toContain('promo=SAVE8');
    expect(html).toContain(base.unsubscribeUrl);
  });

  it('THROWS rather than render with an empty promo code', () => {
    expect(() => followupDiscountEmail({ ...base, promoCode: '', percentOff: 8 })).toThrow();
    expect(() => followupDiscountEmail({ ...base, promoCode: '   ', percentOff: 8 })).toThrow();
  });

  it('THROWS rather than render with a non-positive percent', () => {
    expect(() => followupDiscountEmail({ ...base, promoCode: 'SAVE8', percentOff: 0 })).toThrow();
    expect(() => followupDiscountEmail({ ...base, promoCode: 'SAVE8', percentOff: -5 })).toThrow();
    expect(() =>
      followupDiscountEmail({ ...base, promoCode: 'SAVE8', percentOff: NaN as unknown as number }),
    ).toThrow();
  });
});
