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
