/**
 * Shared follow-up logic — the due/sent DECISION and the custom-copy RENDER.
 *
 * Pure functions (no DB, no timers), so these are exhaustive and fast:
 *   - decideNextFollowUp: selects the right touch by cadence, never re-sends a
 *     recorded touch, and skips the discount when there's nothing to offer.
 *   - renderFollowUpTouch: interpolates the tenant's custom intro / contact
 *     block / signature into each touch, and falls back to template defaults.
 */
import { describe, it, expect } from 'vitest';
import {
  decideNextFollowUp,
  renderFollowUpTouch,
  samplePreviewLead,
  type FollowUpLead,
} from './followUp.js';
import { resolveFollowUpConfig, type FollowUpConfig } from '../server/features.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 30);

/** Build a resolved config from a raw followUp patch (mirrors what a tenant
 *  saves), so the tests exercise the real resolve path. */
function cfg(followUp: Record<string, unknown>): FollowUpConfig {
  return resolveFollowUpConfig({ featuresJson: { followUp } });
}

function lead(over: Partial<FollowUpLead> = {}): FollowUpLead {
  return {
    id: 42,
    refId: 'QF-2026-0042',
    customerName: 'Dana Ruiz',
    customerEmail: 'dana@shipper.com',
    pickupCity: 'Long Beach, CA',
    deliveryCity: 'Phoenix, AZ',
    quotedTotal: 2450,
    quotedCurrency: 'USD',
    status: 'new',
    followUpOptOut: false,
    followUpsSentJson: null,
    createdAt: new Date(NOW - 10 * DAY),
    ...over,
  };
}

describe('decideNextFollowUp — cadence selection', () => {
  const c = cfg({ enabled: true, preset: 'standard' }); // day 2 / 5 / 9, 8% off

  it('sends nothing before the first offset', () => {
    expect(decideNextFollowUp(lead({ createdAt: new Date(NOW - 1 * DAY) }), c, NOW)).toBeNull();
  });

  it('sends the nudge once day1 has passed', () => {
    expect(decideNextFollowUp(lead({ createdAt: new Date(NOW - 3 * DAY) }), c, NOW)).toBe('nudge');
  });

  it('sends the reminder once day2 has passed and the nudge is already sent', () => {
    const l = lead({ createdAt: new Date(NOW - 6 * DAY), followUpsSentJson: { nudge: 'x' } });
    expect(decideNextFollowUp(l, c, NOW)).toBe('reminder');
  });

  it('sends the discount once day3 has passed and nudge+reminder are sent', () => {
    const l = lead({
      createdAt: new Date(NOW - 12 * DAY),
      followUpsSentJson: { nudge: 'x', reminder: 'y' },
    });
    expect(decideNextFollowUp(l, c, NOW)).toBe('discount');
  });

  it('never re-sends a touch already recorded (idempotent)', () => {
    const l = lead({ createdAt: new Date(NOW - 3 * DAY), followUpsSentJson: { nudge: 'x' } });
    // Nudge is done and it's not yet day2 → nothing due.
    expect(decideNextFollowUp(l, c, NOW)).toBeNull();
  });

  it('catches up one touch per call when the cron fell behind', () => {
    // Old lead, nothing sent yet → nudge first (not reminder/discount).
    const l = lead({ createdAt: new Date(NOW - 20 * DAY), followUpsSentJson: null });
    expect(decideNextFollowUp(l, c, NOW)).toBe('nudge');
  });

  it('skips the discount touch entirely when discountPct is 0', () => {
    const c0 = cfg({ enabled: true, preset: 'custom', day1: 2, day2: 5, day3: 9, discountPct: 0 });
    const l = lead({
      createdAt: new Date(NOW - 20 * DAY),
      followUpsSentJson: { nudge: 'x', reminder: 'y' },
    });
    expect(decideNextFollowUp(l, c0, NOW)).toBeNull();
  });
});

describe('renderFollowUpTouch — custom copy interpolation', () => {
  const brand = { displayName: 'Harbor Link Logistics', logoUrl: null };
  const render = (touch: 'nudge' | 'reminder' | 'discount', c: FollowUpConfig) =>
    renderFollowUpTouch({
      touch,
      lead: lead(),
      cfg: c,
      brand,
      tenantName: 'Harbor Link',
      baseUrl: 'https://quotefleet.net',
      unsubscribeUrl: 'https://quotefleet.net/unsubscribe?token=L42.sig',
    });

  it('renders the template default intro when no custom copy is set', () => {
    const { html } = render('nudge', cfg({ enabled: true, preset: 'standard' }));
    expect(html).toContain('just circling back'); // default nudge copy
    expect(html).toContain('Harbor Link Logistics'); // carrier brand
  });

  it('interpolates a per-touch custom intro', () => {
    const c = cfg({ enabled: true, preset: 'standard', intro1: 'Custom nudge intro line.' });
    const { html } = render('nudge', c);
    expect(html).toContain('Custom nudge intro line.');
    expect(html).not.toContain('just circling back'); // default replaced
  });

  it('renders the contact block only when enabled with a channel', () => {
    const withContact = cfg({
      enabled: true, preset: 'standard',
      showContact: true, contactPhone: '+1 (562) 555-0100', contactEmail: 'ops@harborlink.com',
    });
    const on = render('reminder', withContact).html;
    expect(on).toContain('ops@harborlink.com');
    expect(on).toContain('tel:+15625550100'); // dial-safe href
    // Disabled → no contact block.
    const off = render('reminder', cfg({ enabled: true, preset: 'standard' })).html;
    expect(off).not.toContain('Questions? Reach us at');
  });

  it('appends the signature when set', () => {
    const c = cfg({ enabled: true, preset: 'standard', signature: 'Sam — Dispatch Desk' });
    expect(render('nudge', c).html).toContain('Sam — Dispatch Desk');
  });

  it('interpolates custom copy into the discount touch and carries the promo code', () => {
    const c = cfg({ enabled: true, preset: 'standard', intro3: 'Last chance, Dana!' });
    const { subject, html } = render('discount', c);
    expect(html).toContain('Last chance, Dana!');
    expect(html).toContain('SAVE8'); // synthesized promo code for 8% off
    expect(subject).toContain('SAVE8');
  });

  it('escapes HTML in custom copy (no injection)', () => {
    const c = cfg({ enabled: true, preset: 'standard', intro1: '<script>alert(1)</script>' });
    const { html } = render('nudge', c);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders every touch for the sample preview lead', () => {
    const c = cfg({ enabled: true, preset: 'standard' });
    for (const touch of ['nudge', 'reminder', 'discount'] as const) {
      const { html } = renderFollowUpTouch({
        touch,
        lead: samplePreviewLead(),
        cfg: c,
        brand,
        tenantName: 'Harbor Link',
        baseUrl: 'https://quotefleet.net',
        unsubscribeUrl: 'https://quotefleet.net/unsubscribe?token=L0.sig',
      });
      expect(html).toContain('Long Beach, CA');
    }
  });
});
