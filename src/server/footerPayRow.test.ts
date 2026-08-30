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
 *     real Checkout Session resolves to ["card","link"], and Apple Pay AND
 *     Google Pay both ride `card` via the account's Payment Method
 *     Configuration (`apple_pay` and `google_pay` each read available=true,
 *     value=on — Google Pay was switched on 2026-08 and the mark added then).
 *     PayPal remains FALSE and asserted ABSENT: the `paypal_payments`
 *     capability does not exist at all on this Canadian account, so it cannot
 *     be offered even in principle, and nothing in this codebase integrates it.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIRECTORY_DATA_SOURCES, FOOTER_PAY_ROW, PREMIUM_FOOTER } from './siteChrome.js';

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

  it('shows exactly the six payment methods a customer can genuinely use', () => {
    const labels = [...FOOTER_PAY_ROW.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay', 'Link',
    ]);
  });

  it('never shows a payment method we do not actually accept', async () => {
    const landing = await readFile(resolve(publicDir, 'landing.html'), 'utf8');
    // PayPal: `paypal_payments` does not exist on this Canadian account at all.
    // Klarna/Afterpay: EUR/PLN/BRL or non-recurring, filtered out of our USD
    // subscription sessions. Discover: supported but unproven by any charge.
    for (const absent of ['PayPal', 'Klarna', 'Afterpay', 'Discover']) {
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

  it('names Stripe as the processor, since every mark shown IS Stripe', async () => {
    // Visa/MC/Amex ride `card`, Apple Pay rides `card` via the PMC, and Link is
    // Stripe's own wallet — without this line the processor is invisible and the
    // row reads as if Stripe were a missing option rather than the whole row.
    expect(FOOTER_PAY_ROW).toContain('Powered by Stripe');
    expect(FOOTER_PAY_ROW).toContain('class="qf-payrow-proc"');
    // Text only — a Stripe wordmark/logo would be a brand asset, and the strip
    // is specified as monochrome inline markup with no external requests.
    expect(FOOTER_PAY_ROW).not.toMatch(/<img/);
    const landing = await readFile(resolve(publicDir, 'landing.html'), 'utf8');
    expect(landing).toContain('Powered by Stripe');
  });
});

/**
 * DATA-SOURCE ATTRIBUTION strip (siteChrome.ts#DIRECTORY_DATA_SOURCES).
 *
 * This is an honest-claims surface twice over: it must not imply a federal
 * endorsement (no seals, an explicit non-affiliation line), and it must not name
 * an organisation whose data we do not actually ingest. Every source asserted
 * below was traced to ingest code; every name asserted ABSENT was traced to
 * either "outbound link only" or "different product surface".
 */
describe('directory data-source attribution strip', () => {
  it('names only sources the directory ingest code actually reads', async () => {
    for (const src of [
      'FMCSA Company Census (MCS-150)', // Socrata az4n-8mr2, carrierIngest.ts
      'FMCSA Licensing &amp; Insurance (L&amp;I)', // Socrata 6eyk-hxee, carrierIngest.ts
      'FMCSA QCMobile', // mobile.fmcsa.dot.gov, fmcsaLookup.ts
      'USDOT Open Data Portal (data.transportation.gov)',
      'U.S. Census Bureau 2020 Gazetteer', // zip5Centroids.ts → containerPorts.ts
    ]) {
      expect(DIRECTORY_DATA_SOURCES).toContain(src);
    }
    // The ingest is real: these resource ids must still be the ones we page.
    const ingest = await readFile(resolve(srcDir, 'directory/carrierIngest.ts'), 'utf8');
    expect(ingest).toContain('az4n-8mr2');
    expect(ingest).toContain('6eyk-hxee');
    expect(ingest).toContain('https://data.transportation.gov/resource');
    const lookup = await readFile(resolve(srcDir, 'directory/fmcsaLookup.ts'), 'utf8');
    expect(lookup).toContain('https://mobile.fmcsa.dot.gov/qc/services/carriers');
  });

  it('never names an organisation we do not ingest for the directory', () => {
    for (const absent of [
      'SAFER', // linked out for users; never read as a feed
      'SMS', // FMCSA BASIC scores — outbound link card only
      'UIIA', // carrier SELF-DECLARED badge, not a source
      'TWIC',
      'TSA',
      'MCDOT', // no state-DOT integration exists anywhere in this repo
      'Caltrans',
      'CBP', // ImportYeti manifest data — /importers only, never /directory
      'Customs',
      'ImportYeti',
      'Hunter',
      'Apollo',
      'Google',
    ]) {
      expect(DIRECTORY_DATA_SOURCES).not.toContain(absent);
    }
  });

  it('reads as attribution, not as accreditation', () => {
    expect(DIRECTORY_DATA_SOURCES).toContain('Directory data sources');
    expect(DIRECTORY_DATA_SOURCES).toContain('not affiliated with, endorsed by, or certified by');
    for (const forbidden of [
      'Approved', 'Accredited', 'Official', 'Partner', 'Verified by', 'Authorized',
    ]) {
      expect(DIRECTORY_DATA_SOURCES).not.toContain(forbidden);
    }
  });

  it('uses no agency seal, no brand colour and no external asset', async () => {
    // A federal seal implies endorsement, which is exactly what we must not
    // claim — so every glyph is a generic monochrome shape on currentColor.
    expect(DIRECTORY_DATA_SOURCES).not.toMatch(/<img/);
    expect(DIRECTORY_DATA_SOURCES).not.toMatch(/https?:\/\//);
    expect(DIRECTORY_DATA_SOURCES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(DIRECTORY_DATA_SOURCES).not.toMatch(/(?:fill|stroke)="(?!currentColor|none)[^"]+"/);
    expect(DIRECTORY_DATA_SOURCES).not.toMatch(/\bseal\b|\blogo\b/i);

    const css = await readFile(resolve(publicDir, 'style.css'), 'utf8');
    // FIVE badges: the column counts must be explicit, never auto-fit, or a
    // 4-track row would strand the fifth alone (the no-orphan rule).
    expect(css).toMatch(/\.qf-ds-list\s*\{[^}]*grid-template-columns:\s*repeat\(5,/);
    expect(css).not.toMatch(/\.qf-ds-list\s*\{[^}]*auto-fit/);
  });

  it('renders on FMCSA-backed surfaces and NOT on the importer/manifest ones', async () => {
    // Gated in directory/pages.ts#rendersCarrierData — /importers is served by
    // the same shell but its data comes from a licensed CBP-manifest provider,
    // so an FMCSA attribution there would be false.
    const dir = await readFile(resolve(srcDir, 'directory/pages.ts'), 'utf8');
    expect(dir).toContain('rendersCarrierData');
    expect(dir).toContain('DIRECTORY_DATA_SOURCES');
    const { rendersCarrierDataForTest } = await import('./directory/pages.js');
    for (const p of ['/directory', '/directory/california', '/compliance', '/drayage-rates', '/services/reefer', '/guides']) {
      expect(rendersCarrierDataForTest(p)).toBe(true);
    }
    for (const p of ['/importers', '/importers/saved', '/manifest-privacy', '/glossary']) {
      expect(rendersCarrierDataForTest(p)).toBe(false);
    }
  });
});
