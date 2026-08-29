/**
 * The very-bottom footer strip — accepted-payment marks + commercial trust
 * badges (siteChrome.ts#FOOTER_PAY_ROW).
 *
 * Two things this file exists to stop:
 *
 *  1. DRIFT. The strip ships on three surfaces that do NOT share a template:
 *     the injected/server-rendered marketing chrome (PREMIUM_FOOTER), the
 *     static homepage (landing.html), and the directory subsite footer
 *     (directory/pages.ts). The homepage carries a LITERAL copy — the same trap
 *     the footer link columns already fell into, where landing.html quietly
 *     lost /partners, /importers and /manifest-privacy. Pin the copies equal.
 *
 *  2. AN UNTRUTHFUL PAYMENT MARK. The marks are a claim about what a customer
 *     can actually pay with, verified against the live Stripe account: every
 *     real Checkout Session resolves to ["card","link"], and Apple Pay rides
 *     `card` via the account's Payment Method Configuration. Google Pay
 *     (available=false) and PayPal (off, and not integrated at all) would both
 *     be false — so they are asserted ABSENT, here and in the homepage copy.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOOTER_PAY_ROW, PREMIUM_FOOTER } from './siteChrome.js';

const publicDir = resolve(process.cwd(), 'src/server/public');
const srcDir = resolve(process.cwd(), 'src/server');

describe('footer accepted-payment + trust strip', () => {
  it('is the LAST child of the premium footer, below the copyright row', async () => {
    expect(PREMIUM_FOOTER).toContain(FOOTER_PAY_ROW);
    expect(PREMIUM_FOOTER.endsWith(`${FOOTER_PAY_ROW}</footer>`)).toBe(true);
    // The copyright row still precedes it — the strip is added, not a swap.
    expect(PREMIUM_FOOTER.indexOf('footer-bottom')).toBeLessThan(
      PREMIUM_FOOTER.indexOf('qf-footer-payrow'),
    );
  });

  it('ships BYTE-IDENTICAL on landing.html and the directory subsite footer', async () => {
    const landing = await readFile(resolve(publicDir, 'landing.html'), 'utf8');
    expect(landing).toContain(FOOTER_PAY_ROW);

    // The directory footer interpolates the constant rather than copying it, so
    // assert the wiring instead of the bytes — a copy-paste there would be the
    // regression, and this catches its removal.
    const dir = await readFile(resolve(srcDir, 'directory/pages.ts'), 'utf8');
    expect(dir).toContain('FOOTER_PAY_ROW');
    expect(dir).toContain('${FOOTER_PAY_ROW}');
  });

  it('shows exactly the five payment methods a customer can genuinely use', () => {
    const labels = [...FOOTER_PAY_ROW.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(['Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Link']);
  });

  it('never shows a payment method we do not actually accept', async () => {
    const landing = await readFile(resolve(publicDir, 'landing.html'), 'utf8');
    for (const absent of ['PayPal', 'Google Pay', 'Klarna', 'Afterpay', 'Discover']) {
      expect(FOOTER_PAY_ROW).not.toContain(absent);
    }
    // The homepage used to advertise "Integrated with Stripe & PayPal" in a hero
    // caption. There is no PayPal integration anywhere in this codebase — only
    // an affiliate PAYOUT enum and a "Coming soon" placeholder tile — so the
    // claim must not come back on the same page that now shows the real marks.
    expect(landing).not.toContain('Stripe &amp; PayPal');
    expect(landing).not.toContain('Stripe & PayPal');
  });

  it('claims only what the codebase can back, and no certification', () => {
    expect(FOOTER_PAY_ROW).toContain('Card details never touch our servers');
    expect(FOOTER_PAY_ROW).toContain('No credit card to start');
    expect(FOOTER_PAY_ROW).toContain('Cancel anytime');
    // Standing honest-claims bar: we hold none of these audits.
    for (const forbidden of ['SOC 2', 'SOC2', 'ISO 27001', 'PCI', 'BBB', 'certified', 'Certified']) {
      expect(FOOTER_PAY_ROW).not.toContain(forbidden);
    }
  });

  it('draws the marks monochrome from a theme token — no hardcoded colours, no external assets', async () => {
    // Every mark is inline SVG inheriting currentColor; nothing fetches an image.
    expect(FOOTER_PAY_ROW).not.toMatch(/<img/);
    expect(FOOTER_PAY_ROW).not.toMatch(/https?:\/\//);
    expect(FOOTER_PAY_ROW).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(FOOTER_PAY_ROW).not.toMatch(/fill="(?!currentColor|none)[^"]+"/);

    const css = await readFile(resolve(publicDir, 'style.css'), 'utf8');
    // The single declaration that makes the strip invert with the theme.
    expect(css).toMatch(/\.qf-paymark\s*\{[^}]*color:\s*var\(--ink\)/);
    expect(css).toMatch(/\.qf-paymark \.qf-pm\s*\{[^}]*fill:\s*currentColor/);
    // The marks must never wrap — a wrapped 5-up row orphans one mark alone.
    expect(css).toMatch(/\.qf-paymarks\s*\{[^}]*flex-wrap:\s*nowrap/);
  });
});
