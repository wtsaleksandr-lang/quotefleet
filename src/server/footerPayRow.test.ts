/**
 * The very-bottom footer strip — accepted-payment marks + commercial trust
 * badges (siteChrome.ts#FOOTER_PAY_ROW).
 *
 * Two things this file exists to stop:
 *
 *  1. DRIFT. The strip ships on three surfaces that do NOT share a template:
 *     the injected/server-rendered marketing chrome (PREMIUM_FOOTER), the
 *     static homepage (landing.html), and the directory subsite footer
 *     (directory/pages.ts). The homepage used to carry a LITERAL copy — the
 *     same trap the footer link columns already fell into, where landing.html
 *     quietly lost /partners, /importers and /manifest-privacy. It now takes
 *     the strip by injection like everything else, so these assertions run
 *     against the RENDERED homepage (renderStaticPage) rather than the slot
 *     file on disk, which is what a visitor actually receives.
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
import { CARRIER_MARKS_NOTE, DIRECTORY_DATA_SOURCES, FOOTER_PAY_ROW, PREMIUM_FOOTER, renderStaticPage } from './siteChrome.js';

const publicDir = resolve(process.cwd(), 'src/server/public');
const srcDir = resolve(process.cwd(), 'src/server');

describe('footer accepted-payment + trust strip', () => {
  it('sits below the copyright row, above only the carrier-marks disclaimer', async () => {
    expect(PREMIUM_FOOTER).toContain(FOOTER_PAY_ROW);
    // The strip used to close the footer. As of the 2026-09 round-2 polish the
    // carrier names/marks disclaimer moved BELOW it — Alex asked for that line
    // to be the quietest thing in the block, and position is most of how that
    // was bought (siteChrome.ts#footerBottomHtml). Nothing else may follow it.
    expect(PREMIUM_FOOTER.endsWith(
      `${FOOTER_PAY_ROW}<div class="qf-foot-marks"><p class="qf-foot-marks-line">${CARRIER_MARKS_NOTE}</p></div></footer>`,
    )).toBe(true);
    // The copyright row still precedes it — the strip is added, not a swap.
    expect(PREMIUM_FOOTER.indexOf('footer-bottom')).toBeLessThan(
      PREMIUM_FOOTER.indexOf('qf-footer-payrow'),
    );
  });

  /**
   * THE DISCLAIMER IS NOT ALLOWED TO BECOME A DISCLOSURE.
   *
   * "Less prominent" has exactly one failure mode worth a test: someone reads
   * it as "get it out of the way" and tucks the line into a <details>, a
   * hover reveal or a display:none. It is a trademark nominative-use statement
   * — it has to be readable without interaction or it has not been made. So
   * this pins the two things that would defeat that in markup, and style.css
   * carries the type floor (11px, --footer-quiet, measured 7.17:1).
   */
  it('keeps the carrier-marks disclaimer in flow, out of any disclosure', () => {
    const at = PREMIUM_FOOTER.indexOf('qf-foot-marks');
    expect(at).toBeGreaterThan(-1);
    // Nothing between the last </details> and the note may open another one.
    expect(PREMIUM_FOOTER.slice(at)).not.toContain('<details');
    expect(PREMIUM_FOOTER.slice(at)).not.toContain('<summary');
    // The removal address is still a live mailto, not plain text.
    expect(PREMIUM_FOOTER).toContain('<a href="mailto:legal@quotefleet.net">legal@quotefleet.net</a>');
    // The sentence is unchanged, word for word.
    expect(PREMIUM_FOOTER).toContain(CARRIER_MARKS_NOTE);
  });

  it('ships BYTE-IDENTICAL on landing.html and the directory subsite footer', async () => {
    const landing = renderStaticPage('landing.html');
    expect(landing).toContain(FOOTER_PAY_ROW);

    // The directory footer no longer interpolates the strip DIRECTLY: as of the
    // 2026-09 "lighter footer" wave both footers take their whole bottom half
    // — legal line, optional FMCSA attribution, this strip — from the one
    // shared builder siteChrome.ts#footerBottomHtml, which is a stronger
    // version of the same anti-drift contract this assertion always encoded.
    // So assert the SHARED CALL rather than the old interpolation, and keep
    // the bytes pinned on the RENDERED directory page below (line ~235), which
    // is what a copy-paste regression would actually have to defeat.
    const dir = await readFile(resolve(srcDir, 'directory/pages.ts'), 'utf8');
    expect(dir).toContain('footerBottomHtml');
    expect(dir).toContain('${footerBottomHtml(');
    // And the strip must NOT be re-typed here: no literal payment markup.
    expect(dir).not.toContain('qf-payrow-methods');
    expect(dir).not.toContain('Powered by Stripe');
  });

  it('shows exactly the six payment methods a customer can genuinely use', () => {
    const labels = [...FOOTER_PAY_ROW.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    // Six METHODS, then the processor. "Powered by Stripe" is the last label
    // and is deliberately NOT one of the `.qf-paymarks` list items: Stripe is
    // who processes the payment, not something a customer can pay WITH, and
    // the list is the answer to "what can I pay with".
    expect(labels).toEqual([
      'Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay', 'Link',
      'Powered by Stripe',
    ]);
    const methods = FOOTER_PAY_ROW.slice(
      FOOTER_PAY_ROW.indexOf('<ul class="qf-paymarks"'),
      FOOTER_PAY_ROW.indexOf('</ul>'),
    );
    expect([...methods.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay', 'Link',
    ]);
  });

  it('never shows a payment method we do not actually accept', async () => {
    const landing = renderStaticPage('landing.html');
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
    // It is a MARK now, not a caption (Alex, 2026-09: make it look like the
    // marks beside it). Same contract as those marks and for the same reason:
    // inline SVG drawn from currentColor, no external asset, no brand colour,
    // no raster — a downloaded Stripe badge is white-on-dark and cannot theme.
    expect(FOOTER_PAY_ROW).toContain('class="qf-paymark qf-paymark--proc"');
    expect(FOOTER_PAY_ROW).toContain('aria-label="Powered by Stripe"');
    expect(FOOTER_PAY_ROW).not.toContain('qf-payrow-proc');
    expect(FOOTER_PAY_ROW).not.toMatch(/<img/);
    // Same sixteen viewBox units tall as the other marks, so one CSS height
    // gives the whole strip one baseline. Only the width differs.
    expect(FOOTER_PAY_ROW).toMatch(/class="qf-pm qf-pm-proc" viewBox="0 0 \d+ 16"/);
    const landing = renderStaticPage('landing.html');
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
    // The strip now reaches the page through the shared bottom-matter builder
    // (footerBottomHtml's `dataSources` flag) instead of being interpolated
    // here, so the GATE is what this file can assert in the source — and the
    // gate is the thing that must not be lost.
    expect(dir).toContain('dataSources: rendersCarrierData(');
    const { rendersCarrierDataForTest } = await import('./directory/pages.js');
    for (const p of ['/directory', '/directory/california', '/compliance', '/drayage-rates', '/services/reefer', '/guides']) {
      expect(rendersCarrierDataForTest(p)).toBe(true);
    }
    for (const p of ['/importers', '/importers/saved', '/manifest-privacy', '/glossary']) {
      expect(rendersCarrierDataForTest(p)).toBe(false);
    }
  });
});

describe('/compliance keeps the chrome its content depends on', () => {
  /**
   * /compliance moved onto the shared tool-page template. It did NOT move off
   * the directory shell, and this is what pins that: the template's document
   * has no FMCSA data-source strip, no directory site map and no shipper
   * hydration, so rendering the page through it would have silently dropped an
   * attribution that is TRUE and load-bearing on a page whose every field is
   * FMCSA's. `rendersCarrierData` gates the strip on the path — but the gate
   * only fires if the page still goes through `layout()`, which is precisely
   * the thing a future refactor could change without noticing.
   */
  const summary = {
    total: 330452,
    intermodalTotal: 4211,
    states: 51,
    byState: [{ state: 'CA', count: 42000 }],
  };

  it('renders the FMCSA attribution strip, the directory footer and the shipper slot', async () => {
    const { renderCompliancePage } = await import('./directory/pages.js');
    const html = renderCompliancePage(summary as never);
    expect(html).toContain(DIRECTORY_DATA_SOURCES);
    expect((html.match(/dirfoot-col/g) ?? []).length).toBe(4);
    expect(html).toContain('id="nav-shipper"');
    expect(html).toContain(FOOTER_PAY_ROW);
  });

  it('renders the tool template around the UNCHANGED lookup widget', async () => {
    const { renderCompliancePage } = await import('./directory/pages.js');
    const html = renderCompliancePage(summary as never);
    // The template: band, breadcrumb above it, body scope, fixed block order.
    expect(html).toContain('<body class="qtt">');
    expect(html.indexOf('qtt-crumbs')).toBeLessThan(html.indexOf('class="qtt-band"'));
    let cursor = -1;
    for (const marker of ['class="qtt-band"', 'id="lk-go"', 'id="limits"', 'id="how"', 'id="detail"', 'id="related"', 'id="faq"']) {
      const at = html.indexOf(marker);
      expect(at, `${marker} is missing`).toBeGreaterThan(-1);
      expect(at, `${marker} is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // The money path is untouched: same endpoint, same toggle, same fields.
    expect(html).toContain("fetch('/api/public/directory/lookup?'");
    expect(html).toContain('data-kind="dot"');
    expect(html).toContain('data-kind="mc"');
    expect(html).toContain('Allowed to operate');
    expect(html).toContain('BIPD insurance on file');
  });

  it('only claims FAQ schema for questions that are actually on the page', async () => {
    const { renderCompliancePage } = await import('./directory/pages.js');
    const html = renderCompliancePage(summary as never);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]!))
      .find((o) => o['@type'] === 'FAQPage');
    expect(ld).toBeDefined();
    // The rendered question is HTML-escaped; the schema's is not. Compare the
    // escaped form, or a question quoting a field value ("allowed to operate")
    // looks absent purely because its quotes became &quot;.
    const escHtml = (s: string) =>
      s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string);
    for (const q of ld.mainEntity) {
      expect(html, `${q.name} is in schema but not rendered`).toContain(escHtml(q.name));
      expect(html, `answer for "${q.name}" is not rendered`).toContain(escHtml(q.acceptedAnswer.text));
      expect(q.acceptedAnswer.text.length).toBeGreaterThan(40);
    }
  });
});
