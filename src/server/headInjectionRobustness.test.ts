/**
 * A STYLESHEET MUST LAND WHERE THE BROWSER CAN SEE IT.
 *
 * The defect this file exists to prevent, stated plainly: the chrome injected
 * its stylesheet with `html.replace('</head>', …)`, which replaces the first
 * TEXTUAL occurrence. The served pages carry long explanatory HTML comments
 * inside their own `<head>` — landing.html has one listing five unlinked
 * stylesheets. An agent wrote a comment that itself contained `</head>`, the
 * injection aimed at that, and the `<link>` was spliced in BETWEEN `<!--` and
 * `-->`. The homepage lost `/nav-unify.css` AND `/landing-logo-marquee.css`
 * and still returned 200. Document height went 3997 → 9194: an unstyled page.
 *
 * Nothing caught it. Not the type checker, not the test suite, and not the
 * boot-time `verifySiteChromeSlots` audit, which called the injector and
 * asserted only that it did not throw. It was found by measuring the render.
 *
 * WHY THIS FILE IS SHAPED THE WAY IT IS. A happy-path test — "the rendered page
 * contains /nav-unify.css" — passes on the BROKEN code, because the document
 * does contain the string; it is merely commented out. So every assertion here
 * strips comments, `<script>` bodies and `<style>` bodies FIRST and asks what
 * is left, and the important cases are negative: a page with `</head>` planted
 * in a comment, a `</body>` planted in a script, and a page with no closing tag
 * to aim at. Each of those fails against the pre-fix code.
 *
 * This file deliberately imports only long-standing production API — no helper
 * introduced alongside the fix — so it can be run against the previous commit
 * to confirm it goes red there. A test that passes both ways proves nothing.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  SITE_FOOTER_SLOT,
  SITE_HEADER_SLOT,
  applySiteChrome,
  renderStaticPage,
  verifySiteChromeSlots,
} from './siteChrome.js';
import { MARQUEE_STYLESHEET, applyHomeSections } from './home/homeSections.js';

const NAV_UNIFY_CSS = '/nav-unify.css';
const PUBLIC_DIR = resolve(process.cwd(), 'src/server/public');

/**
 * Everything a browser does NOT parse as markup, removed. Written out here
 * rather than imported from the implementation on purpose: a test that judges
 * an injector using that injector's own idea of "inside a comment" cannot
 * detect the injector being wrong about it.
 */
const stripInert = (html: string) =>
  html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');

/** The real `<head>`, with every commented-out and scripted line discarded. */
const liveHead = (html: string) => {
  const live = stripInert(html);
  const end = live.indexOf('</head>');
  expect(end, 'rendered page has no real </head>').toBeGreaterThan(-1);
  return live.slice(0, end);
};

/** The pages served with the full chrome, i.e. the ones that take nav-unify. */
const FULL_PAGES = [
  'landing.html', 'pricing.html', 'compare.html', 'support.html', 'security.html',
  'cookie.html', 'refund.html', 'terms.html', 'privacy.html', 'dpa.html',
  'tools.html', 'for-brokers.html', 'for-ltl.html', 'for-forwarders.html',
  'marketplace.html', 'marketplace-carrier.html',
];

describe('the real served pages carry their stylesheets in the real <head>', () => {
  it.each(FULL_PAGES)('%s links /nav-unify.css as live markup, not inside a comment', (file) => {
    const head = liveHead(renderStaticPage(file, { variant: 'full' }));
    expect(head, `${file} lost ${NAV_UNIFY_CSS} from its head`).toContain(NAV_UNIFY_CSS);
  });

  it('the homepage carries the marquee stylesheet too — the second sheet that was lost', () => {
    const raw = readFileSync(resolve(PUBLIC_DIR, 'landing.html'), 'utf8');
    // Exactly the order app.ts serves it in: home sections first, chrome second.
    const served = applySiteChrome(applyHomeSections(raw), { variant: 'full', label: 'landing.html' });
    const head = liveHead(served);
    expect(head).toContain(MARQUEE_STYLESHEET);
    expect(head).toContain(NAV_UNIFY_CSS);
  });
});

/**
 * THE CASES THAT ACTUALLY HAPPENED, OR ARE ONE KEYSTROKE AWAY.
 *
 * Each fixture below is a well-formed page that a person would reasonably
 * write. None of them is exotic; the first one is a transcription of the
 * comment that broke production.
 */
describe('a closing tag inside a comment or a script is NOT an injection target', () => {
  const page = (head: string, body = '') => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
${head}
</head>
<body>
  ${SITE_HEADER_SLOT}
  <main>${body}</main>
  ${SITE_FOOTER_SLOT}
</body>
</html>`;

  it('injects the chrome stylesheet past a head comment that mentions </head>', () => {
    const html = page(`  <!-- The chrome appends its stylesheet just before </head>, so anything
       added below this point is still picked up. -->
  <link rel="stylesheet" href="/style.css">`);

    const head = liveHead(applySiteChrome(html, { variant: 'full', label: 'commented.html' }));
    expect(head, 'the <link> was spliced into the comment, where it does nothing').toContain(NAV_UNIFY_CSS);
  });

  it('injects the marquee stylesheet past a head comment that mentions </head>', () => {
    // The real homepage, with the kind of comment that broke it planted in head.
    const raw = readFileSync(resolve(PUBLIC_DIR, 'landing.html'), 'utf8');
    const planted = raw.replace(
      '<meta charset="utf-8">',
      '<meta charset="utf-8">\n  <!-- NOTE: stylesheets are injected immediately before </head> by the server. -->',
    );
    const head = liveHead(applySiteChrome(applyHomeSections(planted), { variant: 'full', label: 'landing.html' }));
    expect(head, 'the marquee <link> was spliced into the comment').toContain(MARQUEE_STYLESHEET);
    expect(head, 'the chrome <link> was spliced into the comment').toContain(NAV_UNIFY_CSS);
  });

  it('does not skip the injection because a comment happens to name the stylesheet', () => {
    // The guard was `if (!out.includes('/nav-unify.css'))`. A page that merely
    // MENTIONS the sheet in prose satisfies that and gets no stylesheet at all.
    const html = page(`  <!-- Nav styling comes from /nav-unify.css, injected by siteChrome.ts. -->`);
    const head = liveHead(applySiteChrome(html, { variant: 'full', label: 'mentions.html' }));
    expect(head).toContain(NAV_UNIFY_CSS);
  });

  it('does not splice the header scripts into an inline script that contains </body>', () => {
    const marker = `var CLOSING = "</body>";`;
    const html = page('', `<script>${marker}</script>`);
    const out = applySiteChrome(html, { variant: 'full', label: 'scripted.html' });
    expect(out, 'the header scripts were spliced into the middle of a string literal').toContain(marker);
  });
});

describe('no valid target is a LOUD failure, not a quiet no-op', () => {
  const noHead = `<!doctype html><html><body>
  ${SITE_HEADER_SLOT}<main></main>${SITE_FOOTER_SLOT}
</body></html>`;

  it('throws when the document has no closing head tag to inject before', () => {
    // Previously: `.replace` matched nothing, returned the string unchanged and
    // the response went out with no stylesheet.
    expect(() => applySiteChrome(noHead, { variant: 'full', label: 'nohead.html' })).toThrow();
  });

  it('the BOOT audit throws too, so a broken page cannot reach a request', () => {
    // verifySiteChromeSlots runs inside createApp(); this is the difference
    // between failing in CI and failing for a visitor a week later.
    const dir = mkdtempSync(resolve(tmpdir(), 'qf-head-audit-'));
    writeFileSync(resolve(dir, 'broken.html'), noHead, 'utf8');
    expect(() => verifySiteChromeSlots(dir, [{ file: 'broken.html', variant: 'full' }])).toThrow();
  });

  it('the boot audit still passes every page that is actually fine', () => {
    const pages = FULL_PAGES.map((file) => ({ file, variant: 'full' as const }));
    expect(() => verifySiteChromeSlots(PUBLIC_DIR, pages)).not.toThrow();
  });
});
