/**
 * Hosted trust-wrap render tests.
 *
 * Prove the wrap (a) always keeps the calculator as an embedded iframe, (b)
 * surfaces trust content ONLY when the tenant supplied it (headline, badges,
 * testimonials, CTAs) and degrades to a bare centred calculator otherwise, (c)
 * shows USDOT/MC badges from already-collected data only when the toggle is on,
 * (d) escapes untrusted copy, and (e) round-trips the stored JSON shapes through
 * the defensive normalisers (caps + type-guards) that both the render and the
 * PUT sanitiser rely on.
 */
import { describe, it, expect } from 'vitest';
import {
  renderHostedPage,
  computeTrustBadges,
  normalizeTestimonials,
  normalizeCtas,
  normalizeBackground,
} from './hostedPage.js';
import type { BrandConfig, Tenant } from '../db/schema.js';

const TENANT = {
  name: 'Harbor Link Logistics',
  slug: 'harbor',
  dotNumber: '2914776',
  mcNumber: '748213',
} as Pick<Tenant, 'name' | 'slug' | 'dotNumber' | 'mcNumber'>;

// A brand with every hosted field populated. Cast through unknown because the
// render only reads the hosted-wrap + theme subset.
function brandWith(over: Partial<BrandConfig>): BrandConfig {
  return over as unknown as BrandConfig;
}

const CALC_SRC = '/w/harbor?embed=1';

describe('renderHostedPage — calculator centrepiece', () => {
  it('always embeds the bare calculator as an iframe (embed src)', () => {
    const html = renderHostedPage({ tenant: TENANT, brand: null, calcSrc: CALC_SRC });
    expect(html).toContain('id="qf-calc-frame"');
    expect(html).toContain('src="/w/harbor?embed=1"');
  });

  it('degrades to a bare, centred calculator when no trust content exists', () => {
    const html = renderHostedPage({ tenant: TENANT, brand: null, calcSrc: CALC_SRC });
    // The BODY element carries the bare modifier (CSS rule names always exist).
    expect(html).toContain('<body class="qf-hp--bare"');
    // Scope element assertions to the server-rendered DOM — the live-preview
    // script below it legitimately contains these fragments as JS templates.
    const dom = html.slice(0, html.indexOf('<script>'));
    expect(dom).toContain('qf-hp-head is-empty');
    expect(dom).not.toContain('<h1 class="qf-hp-headline"');
    expect(dom).not.toContain('<figure class="qf-hp-rev"');
    expect(dom).not.toContain('<a class="qf-hp-cta');
  });

  it('stays single-column centred when ONLY a headline is set (no rich hero)', () => {
    // A lone headline must NOT trigger the two-column hero — that leaves the
    // headline stranded beside an empty gutter. It stays bare (single centred
    // column) with the headline rendered centred above the widget.
    const html = renderHostedPage({
      tenant: TENANT,
      brand: brandWith({ hostedHeadline: 'Instant freight quotes' }),
      calcSrc: CALC_SRC,
    });
    expect(html).toContain('<body class="qf-hp--bare"');
    const dom = html.slice(0, html.indexOf('<script>'));
    // Headline IS rendered (not the is-empty header) …
    expect(dom).toContain('<h1 class="qf-hp-headline">Instant freight quotes</h1>');
    expect(dom).not.toContain('qf-hp-head is-empty');
    // … but no rich hero content exists to justify the side-by-side layout.
    expect(dom).not.toContain('<figure class="qf-hp-rev"');
    expect(dom).not.toContain('<a class="qf-hp-cta');
  });
});

describe('renderHostedPage — trust content include vs exclude', () => {
  it('includes headline, subhead, testimonials and CTAs when supplied', () => {
    const html = renderHostedPage({
      tenant: TENANT,
      brand: brandWith({
        hostedHeadline: 'Instant drayage rates',
        hostedSubhead: 'Book a container move in minutes.',
        hostedTrustBadges: true,
        hostedTestimonialsJson: [
          { quote: 'Fast and the price held.', author: 'Dana R.', company: 'Pier 9', rating: 5 },
        ],
        hostedCtasJson: [
          { label: 'Call dispatch', type: 'call', value: '+1 555 123 4567' },
          { label: 'Visit site', type: 'url', value: 'harborlink.com' },
        ],
      }),
      calcSrc: CALC_SRC,
    });
    expect(html).not.toContain('<body class="qf-hp--bare"');
    expect(html).toContain('Instant drayage rates');
    expect(html).toContain('Book a container move in minutes.');
    expect(html).toContain('Fast and the price held.');
    expect(html).toContain('Dana R.');
    expect(html).toContain('Call dispatch');
    // call → tel:, url → https:// prefixed + opens in a new tab.
    expect(html).toContain('href="tel:+15551234567"');
    expect(html).toContain('href="https://harborlink.com"');
    expect(html).toContain('target="_blank"');
  });

  it('renders trust badges from USDOT/MC only when the toggle is ON', () => {
    const on = renderHostedPage({
      tenant: TENANT,
      brand: brandWith({ hostedTrustBadges: true }),
      calcSrc: CALC_SRC,
    });
    expect(on).toContain('USDOT 2914776');
    expect(on).toContain('MC 748213');
    expect(on).toContain('Insured');

    const off = renderHostedPage({
      tenant: TENANT,
      brand: brandWith({ hostedTrustBadges: false }),
      calcSrc: CALC_SRC,
    });
    expect(off).not.toContain('USDOT 2914776');
  });

  it('escapes untrusted headline / testimonial copy', () => {
    const html = renderHostedPage({
      tenant: TENANT,
      brand: brandWith({
        hostedHeadline: '<script>alert(1)</script>',
        hostedTestimonialsJson: [{ quote: '<img src=x onerror=alert(2)>', author: 'X' }],
      }),
      calcSrc: CALC_SRC,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
  });
});

describe('computeTrustBadges', () => {
  it('returns [] when disabled', () => {
    expect(computeTrustBadges(TENANT, false)).toEqual([]);
  });
  it('omits Insured when neither USDOT nor MC is on file', () => {
    expect(computeTrustBadges({ dotNumber: null, mcNumber: null }, true)).toEqual([]);
  });
  it('includes only the numbers present, plus Insured', () => {
    expect(computeTrustBadges({ dotNumber: '111', mcNumber: null }, true)).toEqual([
      'USDOT 111',
      'Insured',
    ]);
  });
});

describe('normalisers — stored-JSON round-trip + hardening', () => {
  it('keeps only valid testimonials and caps at 4', () => {
    const out = normalizeTestimonials([
      { quote: 'good', author: 'A', rating: 5 },
      { quote: '', author: 'skip-empty' },
      { nope: true },
      { quote: 'b', author: 'B', company: 'Co', rating: 9 /* out of range → dropped */ },
      { quote: 'c', author: 'C' },
      { quote: 'd', author: 'D' },
      { quote: 'e', author: 'E' }, // 5th valid → trimmed
    ]);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ quote: 'good', author: 'A', rating: 5 });
    expect(out[1].rating).toBeUndefined();
    expect(out[1].company).toBe('Co');
  });

  it('keeps only valid CTAs and caps at 3', () => {
    const out = normalizeCtas([
      { label: 'Call', type: 'call', value: '5551234' },
      { label: '', type: 'call', value: 'x' }, // no label → dropped
      { label: 'Bad', type: 'sms', value: 'x' }, // bad type → dropped
      { label: 'Mail', type: 'email', value: 'a@b.com' },
      { label: 'Web', type: 'url', value: 'b.com' },
      { label: 'Extra', type: 'call', value: '999' }, // 4th → trimmed
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.type)).toEqual(['call', 'email', 'url']);
  });

  it('validates background theme/preset/scrim and drops junk', () => {
    expect(normalizeBackground({ theme: 'light', preset: 'aurora', scrim: 40 })).toEqual({
      theme: 'light',
      preset: 'aurora',
      scrim: 40,
    });
    // unknown preset + out-of-range scrim + bad theme all dropped.
    expect(normalizeBackground({ theme: 'neon', preset: 'nope', scrim: 500 })).toEqual({});
    expect(normalizeBackground(null)).toEqual({});
  });
});
