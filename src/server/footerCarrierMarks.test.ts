/**
 * THE CARRIER-MARKS DISCLAIMER MUST BE ON EVERY FOOTER, /directory INCLUDED.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT PART OF footerPayRow.test.ts.
 *
 * That file pins the disclaimer on PREMIUM_FOOTER, and it did so thoroughly —
 * in flow, out of any <details>, word for word, last element in the footer. It
 * was still possible for the line to be missing from the ONE surface where it
 * does real work, because every assertion it carries names PREMIUM_FOOTER and
 * the directory subsite renders different markup.
 *
 * The disclaimer is a trademark NOMINATIVE-USE statement: it says the carrier
 * names and logos on the page belong to their owners, that they identify a
 * listed carrier rather than signalling any relationship with us, and where to
 * write to have one removed. /directory, its state/port/service sub-pages and
 * the ~334k carrier profiles are the surfaces that ACTUALLY render third-party
 * carrier names and logos — so the page that most needs the line was the page
 * shipping without it, while /pricing and /tools/* carried it faithfully.
 * Measured before the fix: zero occurrences of `qf-foot-marks` in the rendered
 * directory footer at every width and in both themes.
 *
 * THE CONSTRAINT THAT CAUSED IT IS REAL, AND IS PINNED HERE TOO. The directory
 * chrome must contain NO `mailto:` anywhere — carrierProfileContact.test.ts
 * asserts a contact-hidden carrier profile contains none, and a site-wide
 * footer address would defeat that check on every one of those ~334k pages.
 * That is why the first cut of the shared footer bottom left the note off
 * rather than plant a mailto. Dropping the disclaimer was not the only way to
 * honour the constraint: `footerBottomHtml({ marksNote: 'support' })` keeps the
 * claim byte-for-byte and swaps only the removal ROUTE for the directory.
 *
 * So this file asserts BOTH halves at once, and each half is the thing that
 * would silently re-break the other:
 *   • the directory footer HAS the disclaimer, visible, in flow, last, with a
 *     working removal route;
 *   • and it still has no `mailto:`.
 * Reverting either — dropping the note to satisfy the mailto rule, or fixing
 * the note by planting a mailto — fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  CARRIER_MARKS_NOTE,
  CARRIER_MARKS_NOTE_SUPPORT,
  DIRECTORY_FOOTER_BRAND,
  footerBottomHtml,
  PREMIUM_FOOTER,
  renderStaticPage,
} from './siteChrome.js';

/** The sentence that does the legal work, shared verbatim by both variants. */
const CLAIM =
  'Carrier names and logos are the property of their owners, shown to identify carriers '
  + 'listed in our directory — not as endorsement or affiliation.';

/** Render one real directory page of each shape through the live shell. */
async function directoryPages(): Promise<Array<[string, string]>> {
  const pages = await import('./directory/pages.js');
  const summary = {
    total: 330452,
    intermodalTotal: 4211,
    states: 51,
    byState: [{ state: 'CA', count: 42000 }],
  };
  return [
    // The compliance page is the cheapest full render of the directory shell
    // that footerPayRow.test.ts already exercises, so it needs no DB fixture.
    ['/compliance', pages.renderCompliancePage(summary as never)],
  ];
}

describe('the carrier-marks disclaimer reaches EVERY footer', () => {
  it('renders on the directory footer — the surface that shows the marks', async () => {
    for (const [path, html] of await directoryPages()) {
      expect(html, `${path} has no .qf-foot-marks block`).toContain('qf-foot-marks');
      expect(html, `${path} lost the disclaimer sentence`).toContain(CLAIM);
    }
  });

  it('renders on the marketing footer too — one claim, two surfaces', () => {
    expect(PREMIUM_FOOTER).toContain('qf-foot-marks');
    expect(PREMIUM_FOOTER).toContain(CLAIM);
    expect(renderStaticPage('landing.html')).toContain(CLAIM);
  });

  /**
   * NOT A DISCLOSURE, ON EITHER SURFACE. A statement a reader has to click to
   * reveal has not been made. footerPayRow.test.ts pins this for PREMIUM_FOOTER;
   * the directory footer now has to earn it independently, because its columns
   * ARE <details> and the note sits a few hundred bytes after the last one.
   */
  it('is in flow, outside every disclosure, and closes the footer', async () => {
    for (const [path, html] of [...(await directoryPages()), ['PREMIUM_FOOTER', PREMIUM_FOOTER] as [string, string]]) {
      const at = html.indexOf('qf-foot-marks');
      expect(at, `${path}: no disclaimer`).toBeGreaterThan(-1);
      // Scoped to the FOOTER, not the rest of the document: a full page render
      // carries inline scripts below the footer whose source legitimately
      // mentions `details`, and matching those would make this assertion noise.
      const block = html.slice(at, html.indexOf('</footer>', at)).trim();
      expect(block, `${path}: a disclosure opens after the disclaimer`).not.toContain('<details');
      expect(block, `${path}: a summary opens after the disclaimer`).not.toContain('<summary');
      // Nothing at all may follow it inside the footer — it closes the block.
      expect(block, `${path}: content follows the disclaimer inside the footer`)
        .toMatch(/^qf-foot-marks"><p class="qf-foot-marks-line">[\s\S]*<\/p><\/div>$/);
    }
  });

  it('is never hidden: no hidden attribute, no display:none, no sr-only wrapper', async () => {
    for (const [path, html] of [...(await directoryPages()), ['PREMIUM_FOOTER', PREMIUM_FOOTER] as [string, string]]) {
      const at = html.indexOf('<div class="qf-foot-marks">');
      expect(at, `${path}: the note is not a plain visible div`).toBeGreaterThan(-1);
      const block = html.slice(at, html.indexOf('</div>', at));
      for (const bad of ['hidden', 'display:none', 'display: none', 'sr-only', 'visually-hidden', 'aria-hidden']) {
        expect(block, `${path}: disclaimer carries "${bad}"`).not.toContain(bad);
      }
    }
  });
});

describe('the directory variant honours the no-mailto rule without dropping the contact', () => {
  /**
   * The rule this protects lives in carrierProfileContact.test.ts: a
   * contact-hidden carrier profile must contain no `mailto:` ANYWHERE on the
   * page. Chrome is part of the page, so a footer address would break it on
   * every profile that opted out.
   */
  it('puts no mailto: anywhere in the directory chrome', async () => {
    expect(CARRIER_MARKS_NOTE_SUPPORT).not.toContain('mailto:');
    expect(footerBottomHtml({ legalLinks: true, marksNote: 'support' })).not.toContain('mailto:');
    expect(DIRECTORY_FOOTER_BRAND).not.toContain('mailto:');
    for (const [path, html] of await directoryPages()) {
      expect(html, `${path} planted a mailto in directory chrome`).not.toContain('mailto:');
    }
  });

  it('still gives a working removal route, and still names the address', () => {
    // A nominative-use disclaimer with no removal route is not a disclaimer.
    expect(CARRIER_MARKS_NOTE_SUPPORT).toContain('<a href="/support">');
    expect(CARRIER_MARKS_NOTE_SUPPORT).toContain('legal@quotefleet.net');
    expect(CARRIER_MARKS_NOTE_SUPPORT).not.toContain('<strong');
    expect(CARRIER_MARKS_NOTE_SUPPORT).not.toContain('<b>');
  });

  it('keeps the marketing mailto — only the ROUTE differs, never the claim', () => {
    expect(CARRIER_MARKS_NOTE).toContain('<a href="mailto:legal@quotefleet.net">legal@quotefleet.net</a>');
    // Byte-identical first sentence. This is what stops the two variants from
    // drifting into two different legal statements.
    expect(CARRIER_MARKS_NOTE.startsWith(`${CLAIM} `)).toBe(true);
    expect(CARRIER_MARKS_NOTE_SUPPORT.startsWith(`${CLAIM} `)).toBe(true);
  });

  it('emits nothing when marksNote is omitted, and the right variant otherwise', () => {
    expect(footerBottomHtml({})).not.toContain('qf-foot-marks');
    expect(footerBottomHtml({ marksNote: true })).toContain('mailto:legal@quotefleet.net');
    expect(footerBottomHtml({ marksNote: 'support' })).toContain('href="/support"');
  });
});

describe('the directory footer carries the brand lockup', () => {
  it('renders a real, visible logo image on directory pages', async () => {
    for (const [path, html] of await directoryPages()) {
      expect(html, `${path}: no footer brand lockup`).toContain('dirfoot-brand');
      expect(html, `${path}: no footer logo image`).toContain('class="dirfoot-logo"');
    }
    expect(DIRECTORY_FOOTER_BRAND).toContain('<img class="dirfoot-logo" src="/brand/logo-full-ondark.png"');
    // Width/height on the element so the band never reflows around it.
    expect(DIRECTORY_FOOTER_BRAND).toMatch(/width="\d+" height="\d+"/);
    // An accessible name on the link, and art that does not duplicate it.
    expect(DIRECTORY_FOOTER_BRAND).toContain('aria-label="QuoteFleet home"');
  });

  /**
   * The marketing band is --surface-dark in BOTH themes, so its lockup declares
   * `data-logo-fixed` to opt out of theme-toggle.js#swapLogos. `.site-footer`
   * paints --surface-2, which IS themed, so this one must NOT opt out or the
   * white-outline cut lands on a near-white band in light mode.
   */
  it('does NOT opt out of the light-mode logo swap — its band is themed', () => {
    expect(DIRECTORY_FOOTER_BRAND).not.toContain('data-logo-fixed');
    expect(PREMIUM_FOOTER).toContain('data-logo-fixed'); // and the marketing one still does
  });
});
