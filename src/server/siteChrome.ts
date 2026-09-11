/**
 * Canonical marketing/legal-page CHROME — single source of truth.
 *
 * Extracted from app.ts so both the static-page skinner (applyFullSiteHeader)
 * AND server-rendered marketing pages (e.g. /partners*, see
 * src/server/affiliate/pages.ts) share ONE header + footer, with no drift.
 *
 * Kept identical to the homepage (landing.html) header so every page shares the
 * same navigation. Styling lives in /nav-unify.css (token-first, theme-aware).
 */

// ── Audience-segmented navigation — ONE canonical structure ─────────────────
// The site serves two buying audiences plus a set of free, ungated surfaces, so
// the nav has exactly three menus and one direct link:
//
//   For Carriers & Brokers
//                — the people who SELL freight (carriers, brokers, forwarders).
//                  QuoteFleet's paying product plus their lead-generation tools.
//                  THE LABEL NAMES BROKERS EXPLICITLY, and — contrary to what
//                  this comment used to claim — it ALREADY DID before the
//                  rebuild: `git show <pre-rebuild main>:src/server/siteChrome.ts`
//                  renders the same "For Carriers &amp; Brokers" trigger, so no
//                  broker was ever left without an entry point. Two things
//                  actually changed on this menu, and both are worth keeping
//                  straight:
//                    • ORDER. It ran SECOND, behind For Shippers. The sell side
//                      is the side that pays for the product, so it leads now.
//                    • THE LABEL WAS BRIEFLY LOST AND RESTORED *inside* the
//                      rebuild — shortened to "For Carriers" mid-PR, then put
//                      back. That momentary regression, not any shipped state,
//                      is why the tests pin the full label character for
//                      character. This menu's own third column is "By business
//                      type → Freight Brokers / Freight Forwarders / LTL
//                      Carriers" and the homepage eyebrow under it reads "FOR
//                      CARRIERS, BROKERS & FORWARDERS"; dropping "& Brokers"
//                      would contradict both.
//   For Shippers — the people who BUY freight (shippers and importers). Finding
//                  and vetting carriers, getting rates, protecting manifest data.
//   Free Tools   — NEW in the rebuild, and it is what replaced the third menu
//                  slot: that slot used to be "For Importers", a dropdown
//                  holding exactly one link (/manifest-privacy, now filed under
//                  For Shippers). Free Tools holds the ungated UTILITIES: the
//                  rate calculator and the glossary lookup. Things you
//                  *operate*, not things you *read* — which is why /guides did
//                  not stay in it (see below).
//   Pricing      — a top-level one-click link (accessibility rule).
//
// TWO RULES KEEP IT LEGIBLE, and both were broken before this structure landed:
//
//   1. ONE DESTINATION, ONE HOME. Every href appears exactly ONCE inside
//      `.site-nav`, and no label is ever visible twice in the header. A link that
//      shows up under two audiences teaches the visitor that the grouping means
//      nothing. Cross-linking belongs on the pages and in the footer, not in the
//      menu. (The header previously rendered "For Shippers" twice on directory
//      pages — once as this menu, once as an action-cluster link — which is the
//      defect this rule exists to prevent.) The one deliberate exception is the
//      primary CTA button in `.site-actions`: it may point at a destination the
//      menu also lists (/w/demo on marketing pages, /signup on the directory),
//      because a button is a different affordance from a menu row — but its
//      LABEL must differ, which is why the menu says "Start Free" while the
//      directory's button says "Claim your listing — free".
//   2. GROUPED BY JOB, NOT BY TEAM. Each panel column is headed by the job the
//      visitor came to do. That is what moved /services (browse carriers by
//      capability — a SHIPPER task) out of the carrier menu, and /tools (the
//      free calculator, useful to both) out of it into Free Tools.
//   3. A MENU IS NAMED FOR WHAT IS IN IT. As first drafted, this rebuild's new
//      "Free Tools" menu held /guides — the
//      editorial market guides ("Trucking Companies in Houston, TX"), which are
//      reference ARTICLES, not tools, and whose own module comment says they
//      "deep-link into the directory pages [they] describe". The reader who
//      wants them is a shipper sizing up a market's carriers, so they now sit in
//      For Shippers → "Find & vet carriers", one row under /directory. Free
//      Tools keeps its name and keeps only what that name promises: the rate
//      calculator you operate and the glossary you look terms up in.
//      /pricing likewise left Free Tools in the FOOTER (it is not free, and not
//      a tool) and is filed once, under For Carriers & Brokers, in every footer.
//
// Shared VERBATIM by the homepage header (landing.html), this injected
// marketing/legal chrome, and the directory subsite header
// (src/server/directory/pages.ts) so crossing between them is one coherent site.
// Styling: /nav-unify.css (+ landing-*.css and /nav-ia.css on the homepage).
// Keep these three constants in sync with landing.html.
//
// AUTH GATING IS CLIENT-SIDE, AND THAT IS NOT A STYLE CHOICE.
// These constants take NO auth input and MUST NOT branch on one. The public
// directory HTML is CDN-cached (`public, s-maxage=86400` — see
// directory/httpCache.ts), so a server-rendered auth branch would let a shared
// cache hand one visitor's nav to every other visitor. Instead:
//
//   • PERSONAL WORKSPACES (a "my …" surface that is empty BY DEFINITION for a
//     logged-out visitor — Saved Importers) ship `data-nav-auth="user" hidden`
//     and /nav-auth.js reveals them once /api/directory/auth/me confirms a
//     session. A logged-out visitor never sees a link whose only destination is
//     a sign-in wall.
//   • CAPABILITIES (Importer Search, Rate Calculator, RFQ, Directory Pro,
//     Manifest Privacy) stay VISIBLE for everyone — each already lands on a page
//     that explains the value and carries its own upgrade path — and where a
//     tier boundary exists it is stated in the group's `.nav-dd-sub` line rather
//     than implied by a badge on a link that is in fact free.
//
// navAuthGating.test.ts pins both halves, including that the server HTML is
// byte-identical for anonymous and authenticated requests.

/**
 * THE OOG (OUT-OF-GAUGE) CTA — one subtle affordance, in the header bar and in
 * the footer bar, pointing at the free heavy-haul delivered-cost estimator.
 *
 * SUBTLE MEANS SUBTLE. It is a quiet text link in the house style — the same
 * weight and colour as `.signin` in the header, and a muted line beside the
 * copyright in the footer. It is deliberately NOT a coloured banner, not a
 * second primary button, and not a badge: the header already carries one
 * primary CTA per surface (View demo / Claim your listing) and a second bright
 * one would compete with it.
 *
 * WHY IT IS NOT IN `SITE_NAV_HTML` OR `SITE_MOBILE_MENU_HTML`. Both of those
 * already list `/tools/heavy-haul-quote` once, under Free Tools, and the
 * "one destination, one home" rule (navInformationArchitecture.test.ts) forbids
 * a second copy of an href inside either. The action cluster is a different
 * surface — the same exception the primary button already relies on — so the
 * CTA lives there, with a label no menu row uses.
 *
 * WHY THE HEADER COPY HIDES BELOW 1141px, WHICH IS MEASURED RATHER THAN
 * CAUTIOUS. Below 1024px the bar is already brand + theme + burger — `.signin`
 * and the primary button are both gone — so there is nowhere to put it. And
 * #476/#477 left the 1024–1140px band running on roughly 50px of slack, while
 * this link is ~70px: measured at 1024px it put the homepage header 39px past
 * its content box and the directory header 25px past, which is precisely the
 * defect those PRs removed. So the header copy starts at 1141px (where the
 * compaction step in nav-unify.css was extended to cover it), and the FOOTER
 * copy carries every width, phones included.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { analyticsTags } from './analytics.js';

export const OOG_QUOTE_HREF = '/tools/heavy-haul-quote';
export const HEADER_OOG_CTA = `<a class="site-oog" href="${OOG_QUOTE_HREF}">OOG quote</a>`;
export const FOOTER_OOG_CTA = `<a class="qf-foot-oog" href="${OOG_QUOTE_HREF}">Oversize or out-of-gauge load? Get an OOG trucking quote <span class="arr" aria-hidden="true">→</span></a>`;

const NAV_CARET = `<svg class="nav-dd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

/** RFQ deep link. A BARE `/directory/rfq` 302s straight back to `/directory`
 *  (see directory/entryPortFacets.ts — the form needs a facet key to resolve a
 *  carrier set), so linking it unqualified put a dead end in the menu. `sort` is
 *  in FACET_QUERY_KEYS, so this is the same href the homepage RFQ CTA uses. */
const RFQ_HREF = '/directory/rfq?sort=featured';

/** The primary nav (desktop): three job-grouped dropdowns + a top-level Pricing
 *  link (kept one-click per the accessibility rule). */
export const SITE_NAV_HTML = `<nav class="site-nav" aria-label="Main navigation">`
  + `<div class="nav-dd nav-dd--wide" data-nav-dd>`
  + `<button type="button" class="nav-dd-trigger" id="nav-carriers-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="nav-carriers-menu">For Carriers &amp; Brokers${NAV_CARET}</button>`
  + `<div class="nav-dd-panel nav-dd-panel--cols3" id="nav-carriers-menu" hidden>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Your quote tool</p><a href="/w/demo">See a Live Demo</a><a href="/compare">Why QuoteFleet</a><a href="/signup">Start Free</a></div>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Find new customers</p><a href="/importers">Importers Directory</a><a href="/importers/saved" data-nav-auth="user" hidden>Saved Importers</a><span class="nav-dd-sub">Search, profiles and saving are free with an account. Decision-maker email reveals are Leads Pro.</span></div>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">By business type</p><a href="/for/brokers">Freight Brokers</a><a href="/for/forwarders">Freight Forwarders</a><a href="/for/ltl">LTL Carriers</a></div>`
  + `</div></div>`
  + `<div class="nav-dd nav-dd--wide" data-nav-dd>`
  + `<button type="button" class="nav-dd-trigger" id="nav-shippers-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="nav-shippers-menu">For Shippers${NAV_CARET}</button>`
  + `<div class="nav-dd-panel nav-dd-panel--cols3 nav-dd-panel--end" id="nav-shippers-menu" hidden>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Find &amp; vet carriers</p><a href="/directory">Carrier Directory</a><a href="/guides">Carrier Market Guides</a><a href="/compliance">Compliance Tools</a><a href="/services">Carriers by Capability</a><a href="/directory/join">Directory Pro</a><span class="nav-dd-sub">Browsing carriers is free. Directory Pro adds contact reveals and CSV export.</span></div>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Get rates &amp; quotes</p><a href="${RFQ_HREF}">Request Freight Quotes</a><a href="/drayage-rates">Port Drayage Rates</a></div>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Protect your shipment data</p><a href="/manifest-privacy">Manifest Privacy</a><span class="nav-dd-sub">Stop future shipments appearing in U.S. Customs public records.</span></div>`
  + `</div></div>`
  + `<div class="nav-dd" data-nav-dd>`
  + `<button type="button" class="nav-dd-trigger" id="nav-free-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="nav-free-menu">Free Tools${NAV_CARET}</button>`
  + `<div class="nav-dd-panel nav-dd-panel--end nav-dd-panel--cols1" id="nav-free-menu" hidden>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">No account needed</p><a href="/tools">Freight Rate Calculator</a><a href="/tools/oversize-permits">Oversize Permit Calculator</a><a href="/tools/bridge-formula">Bridge Formula Calculator</a><a href="/tools/axle-weights">Axle Weight Checker</a><a href="/tools/heavy-haul-quote">Heavy-Haul Quote Tool</a><a href="/tools/seasonal-weight-restrictions">Frost Law Restrictions</a><a href="/oversize">Oversize Permit Guide</a><a href="/pilot-cars">Pilot Car &amp; Escort Directory</a><a href="/glossary">Freight Glossary</a></div>`
  + `</div></div>`
  + `<a href="/pricing">Pricing</a>`
  + `</nav>`;

/** The same structure as a collapsible mobile drawer. Each menu is a <details>
 *  so it collapses cleanly at 375px, and each panel column becomes a `.mm-sub`
 *  sub-heading — the drawer used to be a flat 11-link dump under Carriers with
 *  no grouping at all, which is what made it unscannable on a phone. */
export const SITE_MOBILE_MENU_HTML = `<div class="site-mobile-menu" id="site-mobile-menu" hidden>`
  + `<details class="mm-group" open><summary class="mm-head">For Carriers &amp; Brokers</summary>`
  // `/claim` is the drawer's ONLY path to the free profile claim: the header's
  // "Claim your listing — free" button is hidden at the burger breakpoint, so
  // without this row a phone visitor has no route to it at all. Distinct href
  // from /signup (claiming is free forever; the trial is a separate product).
  + `<p class="mm-sub">Your quote tool</p><a href="/w/demo">See a Live Demo</a><a href="/compare">Why QuoteFleet</a><a href="/claim">Claim your listing — free</a><a href="/signup">Start Free</a>`
  + `<p class="mm-sub">Find new customers</p><a href="/importers">Importers Directory</a><a href="/importers/saved" data-nav-auth="user" hidden>Saved Importers</a>`
  + `<p class="mm-sub">By business type</p><a href="/for/brokers">Freight Brokers</a><a href="/for/forwarders">Freight Forwarders</a><a href="/for/ltl">LTL Carriers</a></details>`
  + `<details class="mm-group"><summary class="mm-head">For Shippers</summary>`
  + `<p class="mm-sub">Find &amp; vet carriers</p><a href="/directory">Carrier Directory</a><a href="/guides">Carrier Market Guides</a><a href="/compliance">Compliance Tools</a><a href="/services">Carriers by Capability</a><a href="/directory/join">Directory Pro</a>`
  + `<p class="mm-sub">Get rates &amp; quotes</p><a href="${RFQ_HREF}">Request Freight Quotes</a><a href="/drayage-rates">Port Drayage Rates</a>`
  + `<p class="mm-sub">Protect your shipment data</p><a href="/manifest-privacy">Manifest Privacy</a></details>`
  + `<details class="mm-group"><summary class="mm-head">Free Tools</summary>`
  + `<p class="mm-sub">No account needed</p><a href="/tools">Freight Rate Calculator</a><a href="/tools/oversize-permits">Oversize Permit Calculator</a><a href="/tools/bridge-formula">Bridge Formula Calculator</a><a href="/tools/axle-weights">Axle Weight Checker</a><a href="/tools/heavy-haul-quote">Heavy-Haul Quote Tool</a><a href="/tools/seasonal-weight-restrictions">Frost Law Restrictions</a><a href="/oversize">Oversize Permit Guide</a><a href="/pilot-cars">Pilot Car &amp; Escort Directory</a><a href="/glossary">Freight Glossary</a></details>`
  + `<a class="mm-flat" href="/pricing">Pricing</a>`
  + `<a class="mm-account" href="/login">Sign in</a>`
  + `</div>`;

/**
 * THE CHROME SLOTS — the single anchor every page hands the injector.
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO. Until this wave the injector found
 * its insertion point by REGEX over the page's own duplicated markup:
 *
 *     html.replace(/<header class="topnav">[\s\S]*?<\/header>/, FULL_SITE_HEADER)
 *
 * which means every static page had to keep a full, throwaway copy of a header
 * and a footer purely so the regex had something to match. Nineteen files
 * carried one. That is not a source of truth, it is nineteen chances to drift,
 * and it drifted: `landing.html` is served by a raw `res.sendFile`, so the
 * regex never ran on it at all and its embedded copy — the one real visitors
 * saw — was free to diverge from the constants below. It did.
 *
 * Worse, the failure is SILENT in both directions. Rename a class in a page and
 * the regex stops matching: the page renders its stale local copy and no error
 * is raised. Forget to strip a local copy and the page renders the local one
 * AND the injected one: two headers, still no error.
 *
 * So the anchor is now an EMPTY HTML COMMENT the page declares deliberately,
 * and the count is CHECKED rather than assumed — exactly one header slot, and
 * exactly one footer slot on the variants that take a footer. Anything else
 * throws `SiteChromeError`, at request time AND at boot (see
 * `verifySiteChromeSlots`, called from createApp), so "no chrome" and "double
 * chrome" are both loud, immediate failures instead of a visual regression
 * somebody notices a week later.
 */
export const SITE_HEADER_SLOT = '<!--qf:site-header-->';
export const SITE_FOOTER_SLOT = '<!--qf:site-footer-->';

/** Raised when a page's chrome slots do not match what the variant requires. */
export class SiteChromeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteChromeError';
  }
}

export const THEME_TOGGLE_BTN = `<button type="button" class="qf-theme-btn" aria-label="Toggle light/dark theme" aria-pressed="false" title="Toggle theme"><svg class="qf-ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="qf-ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`;

export const SITE_BURGER_BTN = `<button type="button" class="site-burger" id="site-burger" aria-label="Open menu" aria-expanded="false" aria-controls="site-mobile-menu"><svg class="ico-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg><svg class="ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>`;

// ── Canonical full site header + mobile menu ────────────────────────────────
export const FULL_SITE_HEADER = `<header class="site-header">
    <div class="site-header-inner">
      <a href="/" class="site-brand" aria-label="QuoteFleet home"><span class="site-logo" aria-hidden="true"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>QuoteFleet</a>
      ${SITE_NAV_HTML}
      <div class="site-actions">${HEADER_OOG_CTA}${THEME_TOGGLE_BTN}<a class="signin" href="/login">Sign in</a><a class="btn btn-secondary" href="/w/demo" data-aud-cta>View demo <span class="arr">→</span></a>${SITE_BURGER_BTN}</div>
    </div>
    ${SITE_MOBILE_MENU_HTML}
  </header>`;

/**
 * THE AUTH BAR — the second, deliberately smaller chrome variant.
 *
 * /login, /signup and /reset-password do NOT get the full navigation, and that
 * is a product decision rather than an oversight: a sign-in page that offers
 * three mega-menus and a footer with forty links is a page that invites the
 * visitor to leave before finishing the one job it exists for. They ship a
 * brand mark, the theme toggle and ONE contextual link ("New here?" on /login,
 * "Already have an account?" on /signup, "Back to sign in" on /reset-password),
 * and no footer at all.
 *
 * What was wrong was not the decision, it was that the same fourteen lines of
 * markup were pasted into three files, so the three bars had already started
 * differing in whitespace and would eventually differ in substance. The bar is
 * built here once; the only thing a page varies is the trailing link, which it
 * declares at its route.
 */
export interface AuthChromeLink {
  href: string;
  label: string;
}

export function authSiteHeader(link: AuthChromeLink): string {
  return `<header class="topnav">
    <div class="topnav-inner">
      <a href="/" class="brand-mark"><span class="logo"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>QuoteFleet</a>
      <span class="topnav-spacer"></span>
      ${THEME_TOGGLE_BTN}
      <a class="nav-link" href="${link.href}">${link.label}</a>
    </div>
  </header>`;
}

/**
 * VERY-BOTTOM footer strip — accepted-payment marks + commercial trust badges.
 *
 * TRUTHFULNESS IS THE WHOLE POINT OF THIS BLOCK. Everything here was verified
 * against the LIVE Stripe account and this codebase before it shipped; nothing
 * is aspirational, and nothing implies a certification we do not hold.
 *
 * PAYMENT MARKS — what a customer can genuinely pay with, not what the account
 * merely *could* do. All five Checkout Session sites (routes/billing.ts,
 * directoryBilling.ts, manifestBilling.ts, leadsBilling.ts, depositCharge.ts)
 * omit `payment_method_types` entirely, so Stripe expands the account's default
 * Payment Method Configuration against `mode` + `currency`. Every real live
 * Checkout Session on the account resolved to exactly ["card","link"] — the
 * account's other active capabilities (klarna, bancontact, blik, eps, mb_way,
 * pix, satispay) are EUR/PLN/BRL or non-recurring and are filtered out for our
 * USD subscriptions. So:
 *   • Visa / Mastercard / American Express — the `card` method on a Stripe CA
 *     account. (Discover is also supported but unconfirmable from the API and
 *     unproven by any charge, so it is deliberately OFF this conservative set.)
 *   • Apple Pay — PMC `apple_pay: available=true, value=on`. It rides `card`,
 *     which is why it never appears in `payment_method_types`. Checkout is
 *     Stripe-HOSTED (no Stripe.js/Elements anywhere in this repo), so it needs
 *     no Apple Pay domain registration.
 *   • Google Pay — PMC `google_pay: available=true, value=on` (ENABLED on the
 *     live account 2026-08; this mark was previously absent because the
 *     capability read available=false and would not have rendered). Like Apple
 *     Pay it rides `card`, so it never appears in `payment_method_types`, and
 *     Stripe-HOSTED Checkout needs no domain registration for it.
 *   • Link — present in `payment_method_types` on every real session.
 * DELIBERATELY ABSENT: PayPal. The `paypal_payments` capability does not exist
 * AT ALL on this Canadian Stripe account — it is not merely switched off, it is
 * unavailable — so PayPal genuinely cannot be offered, and there is no PayPal
 * integration in this codebase either. Discover stays off for the separate
 * reason above (supported but unconfirmable from the API).
 *
 * PROCESSOR ATTRIBUTION — "Powered by Stripe" sits directly under the marks
 * because every mark above IS Stripe (Link is Stripe's own wallet), and without
 * the line a reader reasonably asks where Stripe is. It is a statement of fact
 * about who processes the payment — checkout is Stripe-HOSTED — not a badge of
 * partnership or certification, and it is plain text in the same monochrome
 * treatment: no Stripe wordmark, no brand colour, no external asset.
 *
 * STYLING — monochrome by design: the marks inherit `currentColor` from
 * `--ink`, which is near-white on the dark theme and deep navy on light, so
 * they invert with the theme from ONE token. No brand colours, no hardcoded
 * hexes, no external image requests.
 *
 * TRUST BADGES — each is checkable in this repo:
 *   • "Card details never touch our servers" — zero `js.stripe.com`, `loadStripe`,
 *     Elements or PaymentElement usage; every billing route returns `session.url`
 *     and redirects to Stripe-hosted Checkout.
 *   • "No credit card to start" — routes/auth.ts creates NO Checkout session at
 *     signup (`const checkoutUrl: string | null = null`); a card is collected
 *     only at upgrade.
 *   • "Cancel anytime — no contracts" — public/refund.html, "no cancellation
 *     fees and no long-term contracts".
 * Nothing here claims SOC 2 / ISO / PCI-DSS certification, per the standing
 * honest-claims bar (see public/security.html: "We don't claim certifications
 * we don't yet hold").
 *
 * Shared VERBATIM by PREMIUM_FOOTER, landing.html and the directory subsite
 * footer; footerPayRow.test.ts pins those copies byte-identical.
 */
const APPLE_MARK = `M17.05 12.04c-.03-2.72 2.22-4.03 2.32-4.09-1.27-1.85-3.24-2.1-3.94-2.13-1.68-.17-3.28.99-4.13.99-.85 0-2.16-.97-3.55-.94-1.83.03-3.51 1.06-4.45 2.7-1.9 3.29-.48 8.16 1.36 10.83.9 1.31 1.97 2.77 3.38 2.72 1.36-.06 1.87-.88 3.51-.88 1.64 0 2.1.88 3.53.85 1.46-.02 2.38-1.33 3.27-2.64 1.03-1.51 1.46-2.98 1.48-3.06-.03-.01-2.84-1.09-2.87-4.33zM14.32 4.15c.75-.91 1.25-2.17 1.11-3.43-1.08.04-2.38.72-3.15 1.62-.69.8-1.3 2.08-1.14 3.31 1.2.09 2.43-.61 3.18-1.5z`;

export const FOOTER_PAY_ROW = `<div class="qf-footer-payrow">`
  + `<div class="qf-payrow-methods"><span class="qf-payrow-label">Accepted payments</span>`
  + `<ul class="qf-paymarks" role="list">`
  + `<li class="qf-paymark"><svg class="qf-pm" viewBox="0 0 32 16" role="img" aria-label="Visa"><text x="16" y="12.4" text-anchor="middle" font-size="11.5" font-weight="800" font-style="italic" letter-spacing=".2">VISA</text></svg></li>`
  + `<li class="qf-paymark"><svg class="qf-pm" viewBox="0 0 32 16" role="img" aria-label="Mastercard"><circle cx="12.8" cy="8" r="6.2" fill-opacity=".85"/><circle cx="19.2" cy="8" r="6.2" fill-opacity=".85"/></svg></li>`
  + `<li class="qf-paymark"><svg class="qf-pm" viewBox="0 0 32 16" role="img" aria-label="American Express"><text x="16" y="11.8" text-anchor="middle" font-size="9" font-weight="800" letter-spacing=".1">AMEX</text></svg></li>`
  + `<li class="qf-paymark"><svg class="qf-pm" viewBox="0 0 32 16" role="img" aria-label="Apple Pay"><path transform="translate(1.7 3.2) scale(.4)" d="${APPLE_MARK}"/><text x="12.5" y="11.7" font-size="9.5" font-weight="600" letter-spacing="-.1">Pay</text></svg></li>`
  + `<li class="qf-paymark"><svg class="qf-pm" viewBox="0 0 32 16" role="img" aria-label="Google Pay"><text x="7" y="12.2" text-anchor="middle" font-size="12.5" font-weight="700">G</text><text x="12.5" y="11.7" font-size="9.5" font-weight="600" letter-spacing="-.1">Pay</text></svg></li>`
  + `<li class="qf-paymark"><svg class="qf-pm" viewBox="0 0 32 16" role="img" aria-label="Link"><text x="16" y="12" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="-.2">link</text></svg></li>`
  + `</ul>`
  + `<span class="qf-payrow-proc">Powered by Stripe</span>`
  + `</div>`
  + `<ul class="qf-payrow-trust" role="list">`
  + `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v6c0 4.4 3.2 7.4 7.5 8.9 4.3-1.5 7.5-4.5 7.5-8.9V6z"/><rect x="9.2" y="10.6" width="5.6" height="4.6" rx="1"/><path d="M10.4 10.6V9.5a1.6 1.6 0 0 1 3.2 0v1.1"/></svg>Card details never touch our servers</li>`
  + `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19"/><line x1="4" y1="20" x2="20" y2="4"/></svg>No credit card to start</li>`
  + `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2.5 5 2.5 10.5 8 10.5"/><path d="M4.6 15.3a8.5 8.5 0 1 0 1.5-8.4L2.5 10.5"/></svg>Cancel anytime — no contracts</li>`
  + `</ul></div>`;

/**
 * DATA-SOURCE ATTRIBUTION strip for the carrier-directory surfaces.
 *
 * ATTRIBUTION, NOT ACCREDITATION. Federal agencies restrict use of their seals
 * precisely because a seal reads as endorsement or certification, and we hold
 * neither. So: NO FMCSA/USDOT seal, no agency logo, no external image — plain
 * wordmark text plus a generic monochrome glyph, under a label that says these
 * are where the data comes FROM, closed by an explicit non-affiliation line.
 *
 * EVERY SOURCE NAMED HERE WAS TRACED TO INGEST CODE BEFORE IT SHIPPED. Padding
 * the row with impressive-sounding organisations we do not touch is the exact
 * failure this comment exists to prevent:
 *   • FMCSA Company Census (MCS-150) — data.transportation.gov Socrata resource
 *     `az4n-8mr2`, fetched in directory/carrierIngest.ts. Supplies fleet size,
 *     drivers, safety rating, hazmat flag, the crgo_* cargo-class flags and the
 *     public phone/email on every profile.
 *   • FMCSA Licensing & Insurance (L&I) Carrier file — Socrata `6eyk-hxee`,
 *     same ingester. Supplies MC/docket number and operating-authority status,
 *     and its (common_stat='A' OR contract_stat='A') filter is what defines the
 *     directory's "active US motor carrier" set.
 *   • FMCSA QCMobile — https://mobile.fmcsa.dot.gov/qc/services/carriers, called
 *     live by directory/fmcsaLookup.ts behind the carrier-profile and
 *     /compliance lookup buttons. Called "live carrier lookup", NOT "SAFER":
 *     safer.fmcsa.dot.gov appears in this codebase only as an outbound link a
 *     user clicks, never as a feed we read.
 *   • USDOT Open Data Portal — data.transportation.gov, the portal that
 *     publishes both Socrata datasets above.
 *   • U.S. Census Bureau 2020 Gazetteer — the ZCTA5 centroid table vendored at
 *     src/calc/zip5Centroids.ts, used by directory/containerPorts.ts to derive
 *     each carrier's nearest port, i.e. every /directory/port/* page.
 *
 * DELIBERATELY NOT NAMED, because we do not ingest them for the directory: any
 * state DOT (no such integration exists anywhere in this repo), FMCSA SAFER as
 * a feed, FMCSA SMS/BASIC scores, UIIA, TSA/TWIC (all outbound link cards or
 * carrier-self-declared badges), and CBP / bill-of-lading manifest data, which
 * belongs to the separate /importers surface and never renders on /directory.
 *
 * STYLING — monochrome from `--ink`/`--muted` exactly like FOOTER_PAY_ROW: no
 * brand colours, no hardcoded hexes, no external image requests.
 */
const DS_ICON_DATASET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg>`;
const DS_ICON_LIVE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.4"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M5 19a10 10 0 0 1 0-14"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`;
const DS_ICON_PORTAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12.5 9 4.5 9-4.5"/><path d="m3 17 9 4.5 9-4.5"/></svg>`;
const DS_ICON_GEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>`;

export const DIRECTORY_DATA_SOURCES = `<div class="qf-datasources">`
  + `<span class="qf-ds-label">Directory data sources</span>`
  + `<ul class="qf-ds-list" role="list">`
  + `<li>${DS_ICON_DATASET}FMCSA Company Census (MCS-150)</li>`
  + `<li>${DS_ICON_DATASET}FMCSA Licensing &amp; Insurance (L&amp;I)</li>`
  + `<li>${DS_ICON_LIVE}FMCSA QCMobile — live carrier lookup</li>`
  + `<li>${DS_ICON_PORTAL}USDOT Open Data Portal (data.transportation.gov)</li>`
  + `<li>${DS_ICON_GEO}U.S. Census Bureau 2020 Gazetteer</li>`
  + `</ul>`
  + `<p class="qf-ds-note">Public records, used as sources and credited as such. QuoteFleet is not affiliated with, endorsed by, or certified by the FMCSA, USDOT, or any other agency. Carrier-supplied details on a claimed listing are labelled self-declared.</p>`
  + `</div>`;

/**
 * Premium footer — the shared marketing footer.
 *
 * COLUMNS MIRROR THE HEADER MENUS, on purpose. The footer used to run a
 * "Product" column and a 12-link flat "Solutions" column that mixed shipper
 * tools, carrier tools, the importer product and SEO content in one alphabet
 * soup, so it taught the visitor a different site map than the nav did. Now the
 * first three columns are the three header menus (For Carriers & Brokers / For
 * Shippers / Free Tools) in the same order with the same labels, and Company +
 * Legal close it. Two straight duplicates went with the regroup: /partners
 * appeared twice ("Partners" and "Affiliate program") and /signup appeared twice
 * ("Start free" and "Claim your listing").
 *
 * THE COLUMN COUNT IS DATA, NOT A CONSTANT REPEATED IN TWO LANGUAGES. The
 * columns are the `FOOTER_COLUMNS` array below; the markup is generated from
 * it, the count is written into `data-cols` on `.premium-footer-inner`, and the
 * responsive track ladder is DERIVED from that count by `footerTrackLadder()`
 * rather than re-guessed per breakpoint. Before this the number five was
 * hard-coded in the markup here AND in a hand-written ladder in nav-unify.css
 * (and again in nav-ia.css for the homepage), so adding a sixth column left a
 * five-track grid with a permanently empty sixth column and removing one left a
 * five-track grid wrapping four. `footerColumnLadderReport()` states the tracks
 * the current count requires, and siteChromeSingleSource.test.ts fails with
 * those exact numbers if a sheet disagrees — so a column change cannot break
 * the grid quietly, it breaks the build.
 *
 * THIS CONSTANT IS ALSO THE HOMEPAGE'S FOOTER — now by INJECTION, not by
 * transcription. landing.html used to be served by a raw `res.sendFile`, so it
 * carried a literal copy of this string, and a literal copy is exactly how the
 * homepage came to render a stale four-column PRODUCT / SOLUTIONS / COMPANY /
 * LEGAL footer, missing /partners, /importers, /manifest-privacy, /guides,
 * /directory/join and the RFQ link, while every other page rendered these five.
 * The homepage now carries `SITE_FOOTER_SLOT` like every other static page and
 * this constant is substituted into it at request time, so there is nothing
 * left to transcribe. navInformationArchitecture.test.ts asserts against the
 * RENDERED homepage for that reason.
 *
 * THE ONE IN-PAGE ANCHOR, AND WHY IT IS ABSOLUTE. The homepage used to run a
 * bespoke footer whose single unique destination was `#faq`. Replacing that
 * footer with this shared one gained six destinations and dropped that one,
 * leaving the FAQ reachable only by scrolling, so it was restored HERE rather
 * than only on the homepage. A footer that is byte-identical everywhere cannot
 * carry a BARE `#faq`: on a page with no such element that fragment resolves
 * against the current page and the click does nothing. It is therefore always
 * written path-first, so it navigates from wherever it is clicked.
 *
 * IT POINTS AT /pricing#faq SINCE 2026-09-11. It was `/#faq` while the homepage
 * carried the "Simple answers before you start" block; that block came off the
 * live page with the rest of the below-the-bento-grid band (see
 * src/server/home/homeSections.ts) and a footer link to an id that no longer
 * renders is a dead link. /pricing carries the site's one VISIBLE FAQ — eight
 * <details> under `id="faq"`, with its own FAQPage graph — so the link, the
 * anchor and the structured data now all agree. Filed under Company beside
 * Support, which is the other "answer my question" destination.
 *
 * Closes with the FOOTER_PAY_ROW accepted-payment + trust strip as its very
 * last child.
 */

export const TOOL_PROMO_CTA = `<section class="qf-tool-promo" aria-label="Get your own calculator">
  <div class="qf-tool-promo-inner">
    <p class="qf-tool-promo-text">Want this calculator on your own website?</p>
    <a href="/pricing" class="qf-tool-promo-btn">Get your branded version</a>
  </div>
</section>`;

/** One link column of the premium footer. Labels are pre-escaped HTML. */
export interface FooterColumn {
  heading: string;
  links: Array<{ href: string; label: string }>;
}

/**
 * THE FOOTER'S LINK COLUMNS — the one place the count lives.
 *
 * Order mirrors the header menus (For Carriers & Brokers → For Shippers → Free
 * Tools), then Company and Legal close it, so the footer teaches the same site
 * map as the nav. Add or remove a column HERE and nowhere else: the markup, the
 * `data-cols` hint and the required track ladder all derive from this array.
 */
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'For Carriers &amp; Brokers',
    links: [
      { href: '/w/demo', label: 'See a live demo' },
      { href: '/compare', label: 'Why QuoteFleet' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/signup', label: 'Start free' },
      { href: '/claim', label: 'Claim your listing — free' },
      { href: '/importers', label: 'Importers directory' },
      { href: '/for/brokers', label: 'Freight brokers' },
      { href: '/for/forwarders', label: 'Freight forwarders' },
      { href: '/for/ltl', label: 'LTL carriers' },
    ],
  },
  {
    heading: 'For Shippers',
    links: [
      { href: '/directory', label: 'Carrier directory' },
      { href: '/guides', label: 'Carrier market guides' },
      { href: '/compliance', label: 'Compliance tools' },
      { href: '/services', label: 'Carriers by capability' },
      { href: '/directory/join', label: 'Directory Pro' },
      { href: RFQ_HREF, label: 'Request freight quotes' },
      { href: '/drayage-rates', label: 'Port drayage rates' },
      { href: '/manifest-privacy', label: 'Manifest privacy' },
    ],
  },
  {
    heading: 'Free Tools',
    links: [
      { href: '/tools', label: 'Freight rate calculator' },
      { href: '/tools/oversize-permits', label: 'Oversize permit calculator' },
      { href: '/tools/bridge-formula', label: 'Bridge formula calculator' },
      { href: '/tools/axle-weights', label: 'Axle weight checker' },
      { href: '/tools/heavy-haul-quote', label: 'Heavy-haul quote tool' },
      { href: '/tools/seasonal-weight-restrictions', label: 'Frost law restrictions' },
      { href: '/oversize', label: 'Oversize permit guide' },
      { href: '/pilot-cars', label: 'Pilot car &amp; escort directory' },
      { href: '/glossary', label: 'Freight glossary' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: 'mailto:hello@quotefleet.net', label: 'Contact' },
      { href: '/support', label: 'Support' },
      { href: '/pricing#faq', label: 'FAQ' },
      { href: '/partners', label: 'Partners &amp; affiliates' },
      { href: '/security', label: 'Security' },
      { href: '/login', label: 'Sign in' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/refund', label: 'Refund &amp; Cancellation' },
      { href: '/dpa', label: 'Data Processing (DPA)' },
      { href: '/cookie', label: 'Cookie Policy' },
      { href: '/.well-known/security.txt', label: 'security.txt' },
    ],
  },
];

export interface FooterTrackLadder {
  /** Columns the markup actually emits. */
  columns: number;
  /** Track count above the mid breakpoint. */
  wide: number;
  /** Track count in the tablet band. */
  mid: number;
  /** Track count on phones. */
  phone: number;
  /** Whether the LAST link column must span every track on phones. */
  phoneSpansLast: boolean;
}

/**
 * THE LADDER IS ARITHMETIC, SO COMPUTE IT INSTEAD OF WRITING IT DOWN TWICE.
 *
 * Standing rule (DESIGN-SYSTEM.md §8): a group never wraps so that ONE item
 * sits alone on a line. With N columns laid out in T tracks the last row holds
 * `N mod T`, so every T where `N mod T === 1` is forbidden. T = 1 is a
 * deliberate full stack rather than a wrap remainder and is always legal, and
 * so is a column pinned `grid-column: 1 / -1` — it owns a row by instruction.
 *
 * Each band therefore takes the WIDEST legal track count it can afford:
 *   • wide  — one row, so T = N (N mod N is 0 for every N ≥ 1).
 *   • mid   — at most three tracks, stepping down until `N mod T !== 1`.
 *   • phone — two tracks (Alex, 2026-09: "make 2 columns"), which for an ODD N
 *             is only legal with the last column spanning both, leaving an even
 *             number to wrap.
 *
 * For today's N = 5 that yields 5 → 3 → 2-with-span, which is exactly what the
 * stylesheets declare. Change `FOOTER_COLUMNS` and this function immediately
 * reports different numbers; siteChromeSingleSource.test.ts then fails naming
 * the sheets that still declare the old ones.
 */
export function footerTrackLadder(columns: number): FooterTrackLadder {
  const widest = (max: number): number => {
    for (let t = Math.min(max, columns); t >= 2; t--) if (columns % t !== 1) return t;
    return 1;
  };
  return {
    columns,
    wide: widest(columns),
    mid: widest(3),
    phone: 2,
    phoneSpansLast: columns % 2 === 1,
  };
}

/** Human-readable one-liner for the failure message a ladder mismatch prints. */
export function footerColumnLadderReport(columns = FOOTER_COLUMNS.length): string {
  const l = footerTrackLadder(columns);
  return `${l.columns} columns → wide ${l.wide} / mid ${l.mid} / phone ${l.phone}`
    + `${l.phoneSpansLast ? ' with the last column spanning' : ''}`;
}

const FOOTER_LADDER = footerTrackLadder(FOOTER_COLUMNS.length);

const FOOTER_COLUMNS_HTML = FOOTER_COLUMNS.map(
  (col) => `<div class="footer-col"><h4>${col.heading}</h4>`
    + col.links.map((l) => `<a href="${l.href}">${l.label}</a>`).join('')
    + `</div>`,
).join('');

export const PREMIUM_FOOTER = `<footer class="premium-footer"><div class="premium-footer-inner" data-cols="${FOOTER_LADDER.columns}"${FOOTER_LADDER.phoneSpansLast ? ' data-cols-odd' : ''}><div class="footer-brand"><a href="/" class="qf-footer-brand" aria-label="QuoteFleet home"><img class="qf-footer-logo" src="/brand/logo-full-ondark.png" alt="QuoteFleet — freight rate calculator" width="168" height="113" decoding="async"></a><div class="qf-footer-brandtext"><a href="/" class="qf-footer-wordmark">QuoteFleet</a><p class="qf-footer-tagline">Branded rate calculator pages, PDF quotes, and optional AI chat for trucking service providers.</p></div></div>${FOOTER_COLUMNS_HTML}</div><ul class="qf-footer-trustbar" role="list"><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7.5a5 5 0 0 1 10 0V11"/></svg>Payments secured by Stripe</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v6c0 4.4 3.2 7.4 7.5 8.9 4.3-1.5 7.5-4.5 7.5-8.9V6z"/><path d="m9 12 2 2 4-4"/></svg>SSL/TLS encrypted</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 4 5.5v6c0 4.6 3.3 7.7 8 9.5 4.7-1.8 8-4.9 8-9.5v-6z"/><circle cx="12" cy="11" r="2.4"/><path d="M12 13.4V16"/></svg>GDPR &amp; CCPA-ready</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg>Per-tenant data isolation</li></ul><div class="footer-bottom"><span>© <span id="year"></span> QuoteFleet. All rights reserved.</span><span class="qf-foot-operator">QuoteFleet is a product of MR Holdings &amp; Trade LLC.</span>${FOOTER_OOG_CTA}</div>${FOOTER_PAY_ROW}</footer>`;

// Burger + Solutions-dropdown behaviour, mirrored from landing.html so the
// injected header is interactive. Idempotent #year setter included.
//
// ANALYTICS RIDES ALONG HERE, ON PURPOSE. This constant is the one thing every
// full-chrome surface interpolates at the end of <body>: the static
// marketing/legal pages via applySiteChrome, the dynamic ones via
// renderMarketingShell, and the entire directory / RFQ / claim / glossary /
// OS-OW tree via directory/pages.ts's `layout()` and the tool-page shells. One
// append therefore reaches every page a visitor can convert on, and no page
// template needed editing to get it.
//
// It also reaches the widget through NONE of those paths — /w/:slug and
// widget.html are served by res.sendFile with no chrome at all — which is the
// requirement, because the widget renders inside third-party carrier sites and
// must never carry our tracking into their pages. See analytics.ts.
//
// The value is resolved once at module load. Restarting the process (which is
// what changing a Replit Secret does) re-reads it, so the ANALYTICS_DISABLED
// kill switch still needs no deploy.
export const HEADER_SCRIPTS = `<script>
  (function () {
    var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
    var b = document.getElementById('site-burger');
    var m = document.getElementById('site-mobile-menu');
    if (b && m) {
      var set = function (open) {
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        if (open) m.removeAttribute('hidden'); else m.setAttribute('hidden', '');
      };
      b.addEventListener('click', function (e) { e.stopPropagation(); set(b.getAttribute('aria-expanded') !== 'true'); });
      m.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
      document.addEventListener('click', function (e) { if (!m.hasAttribute('hidden') && !m.contains(e.target) && !b.contains(e.target)) set(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
    }
    var dds = Array.prototype.slice.call(document.querySelectorAll('[data-nav-dd]'));
    if (dds.length) {
      var hoverable = window.matchMedia('(hover: hover) and (pointer: fine)');
      var controllers = [];
      dds.forEach(function (dd) {
        var trigger = dd.querySelector('.nav-dd-trigger');
        var panel = dd.querySelector('.nav-dd-panel');
        if (!trigger || !panel) return;
        var hoverTimer;
        var isOpen = function () { return trigger.getAttribute('aria-expanded') === 'true'; };
        var open = function (o) {
          if (o) closeOthers(dd);
          trigger.setAttribute('aria-expanded', o ? 'true' : 'false');
          dd.classList.toggle('is-open', o);
          if (o) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
        };
        controllers.push({ dd: dd, close: function () { open(false); } });
        trigger.addEventListener('click', function (e) { e.stopPropagation(); if (hoverable.matches) open(true); else open(!isOpen()); });
        trigger.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); open(true); var f = panel.querySelector('a'); if (f) f.focus(); } });
        dd.addEventListener('mouseenter', function () { if (!hoverable.matches) return; clearTimeout(hoverTimer); open(true); });
        dd.addEventListener('mouseleave', function () { if (!hoverable.matches) return; hoverTimer = setTimeout(function () { open(false); }, 140); });
        dd.addEventListener('focusout', function (e) { if (!dd.contains(e.relatedTarget)) open(false); });
        document.addEventListener('click', function (e) { if (isOpen() && !dd.contains(e.target)) open(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) { open(false); trigger.focus(); } });
      });
      function closeOthers(except) { controllers.forEach(function (c) { if (c.dd !== except) c.close(); }); }
    }
  })();
</script>
<script src="/nav-auth.js" defer></script>${analyticsTags()}`;

/** The two chrome variants a static page can ask for. */
export type SiteChromeVariant = 'full' | 'auth';

export interface SiteChromeOptions {
  /** 'full' = canonical header + premium footer. 'auth' = brand bar, no footer. */
  variant?: SiteChromeVariant;
  /** Trailing contextual link for the auth bar. Required when variant is 'auth'. */
  authLink?: AuthChromeLink;
  /** Name used in error messages — the filename, normally. */
  label?: string;
}

/** Non-overlapping occurrences of a literal needle. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Literal markup that means a page still carries its own chrome. Finding any of
 * it AFTER the slots have been substituted is the double-chrome case, which
 * used to render two headers with no error anywhere.
 */
const LEGACY_CHROME_MARKERS: Array<[string, RegExp]> = [
  ['a literal <header> element', /<header[\s>]/],
  ['a literal <footer> element', /<footer[\s>]/],
];

/**
 * Substitute the canonical chrome into a static page's slots.
 *
 * THE COUNTS ARE CHECKED, WHICH IS THE ENTIRE POINT. A page must declare
 * exactly one `SITE_HEADER_SLOT`, and exactly one `SITE_FOOTER_SLOT` when the
 * variant takes a footer. Zero slots means the page would render with NO chrome;
 * two means it would render it twice; leftover literal `<header>`/`<footer>`
 * markup means the page kept a stale copy alongside the injected one. All three
 * were previously silent — the regex this replaced simply did not match and the
 * response went out anyway — and all three now throw `SiteChromeError`, which
 * the route turns into a 500 rather than a quietly wrong page.
 */
export function applySiteChrome(html: string, opts: SiteChromeOptions = {}): string {
  const variant: SiteChromeVariant = opts.variant ?? 'full';
  const label = opts.label ?? 'page';
  const wantsFooter = variant === 'full';

  const headers = countOccurrences(html, SITE_HEADER_SLOT);
  if (headers !== 1) {
    throw new SiteChromeError(
      `${label}: expected exactly 1 ${SITE_HEADER_SLOT} but found ${headers}. `
      + `Every page served with site chrome declares the slot once; `
      + `${headers === 0 ? 'without it the page would render no header at all' : 'more than one would render the header twice'}.`,
    );
  }
  const footers = countOccurrences(html, SITE_FOOTER_SLOT);
  if (footers !== (wantsFooter ? 1 : 0)) {
    throw new SiteChromeError(
      `${label}: the '${variant}' chrome variant expects ${wantsFooter ? 1 : 0} ${SITE_FOOTER_SLOT}`
      + ` but found ${footers}.`,
    );
  }
  for (const [what, re] of LEGACY_CHROME_MARKERS) {
    if (re.test(html)) {
      throw new SiteChromeError(
        `${label}: still ships ${what}. Site chrome comes from siteChrome.ts — `
        + `replace the local copy with ${SITE_HEADER_SLOT} / ${SITE_FOOTER_SLOT}.`,
      );
    }
  }

  const header = variant === 'auth'
    ? authSiteHeader(opts.authLink ?? { href: '/login', label: 'Sign in' })
    : FULL_SITE_HEADER;

  // Function replacers: the chrome contains `$` sequences in no version today,
  // but a `$&` slipping into a label would silently splice the match back in.
  let out = html.replace(SITE_HEADER_SLOT, () => header);
  if (wantsFooter) out = out.replace(SITE_FOOTER_SLOT, () => PREMIUM_FOOTER);

  if (variant === 'full') {
    if (!out.includes('/nav-unify.css')) {
      out = out.replace('</head>', () => '  <link rel="stylesheet" href="/nav-unify.css">\n</head>');
    }
    out = out.replace('</body>', () => `${HEADER_SCRIPTS}\n</body>`);
  } else {
    // The 'auth' variant (/login, /signup, /reset-password) deliberately takes
    // no HEADER_SCRIPTS — its compact bar has no burger and no dropdowns to
    // bind. But SIGNUP IS A CONVERSION, and the whole point of this work is to
    // measure the funnel end to end; a funnel that stops one step short of the
    // step that produces revenue is not worth instrumenting. So the analytics
    // tags — and only those — are injected here too. Exactly once either way:
    // the full variant gets them inside HEADER_SCRIPTS, this variant gets them
    // on their own, and neither path runs for the other.
    const tags = analyticsTags();
    if (tags) out = out.replace('</body>', () => `${tags}\n</body>`);
  }
  return out;
}

/**
 * The canonical full header + premium footer, injected into a page's slots.
 * Kept under its historical name because every marketing/legal route calls it.
 */
export function applyFullSiteHeader(html: string, label?: string): string {
  return applySiteChrome(html, { variant: 'full', label });
}

/** The compact auth bar (no footer) for /login, /signup and /reset-password. */
export function applyAuthChrome(html: string, authLink: AuthChromeLink, label?: string): string {
  return applySiteChrome(html, { variant: 'auth', authLink, label });
}

/**
 * A static page rendered exactly as its route serves it — the raw file with the
 * canonical chrome substituted into its slots.
 *
 * This exists because the slot files on disk are deliberately INCOMPLETE now.
 * A test that reads `landing.html` straight off disk is reading a page with a
 * comment where its header should be, which is not what any visitor receives;
 * the thing worth asserting on is the rendered artifact. Using it also means a
 * chrome assertion covers the injection itself, not just the constant.
 */
export function renderStaticPage(file: string, opts: SiteChromeOptions = {}): string {
  const html = readFileSync(resolvePath(process.cwd(), 'src/server/public', file), 'utf8');
  return applySiteChrome(html, { label: file, ...opts });
}

export interface ChromedPageSpec {
  /** Filename under src/server/public. */
  file: string;
  variant: SiteChromeVariant;
}

/**
 * BOOT-TIME SLOT AUDIT — the loud half of "a mismatch must not be silent".
 *
 * `applySiteChrome` catches a bad page when someone requests it. That is late:
 * a legal page nobody visits for a week would sit broken for a week. This reads
 * every registered page once while the app is being constructed and throws a
 * single aggregated error naming every offender, so a page that lost its slots
 * fails the very first `createApp()` — in the test suite, in CI, and before a
 * deploy can serve it.
 */
export function verifySiteChromeSlots(publicDir: string, pages: ChromedPageSpec[]): void {
  const problems: string[] = [];
  for (const page of pages) {
    let html: string;
    try {
      html = readFileSync(resolvePath(publicDir, page.file), 'utf8');
    } catch {
      problems.push(`${page.file}: registered for site chrome but missing from ${publicDir}`);
      continue;
    }
    try {
      applySiteChrome(html, {
        variant: page.variant,
        label: page.file,
        authLink: { href: '/login', label: 'Sign in' },
      });
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (problems.length) {
    throw new SiteChromeError(
      `site chrome slots are wrong on ${problems.length} page(s):\n  - ${problems.join('\n  - ')}`,
    );
  }
}

export interface MarketingShellOpts {
  title: string;
  description: string;
  canonicalPath: string;
  /** Page body HTML placed between the header and footer. */
  bodyHtml: string;
  /** Optional page-scoped <style> block (already CSS text, no <style> tags). */
  headStyles?: string;
}

const SITE = 'https://quotefleet.net';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string
  );
}

/**
 * Full server-rendered marketing page with the canonical full header + premium
 * footer + qf-public-wft skin (style.css + public-pages-wefixtrades.css), theme
 * bootstrap, and the header/theme scripts. Mirrors the static marketing pages
 * (pricing.html etc.) so a dynamic page (e.g. the affiliate dashboard) is
 * visually identical to them. Runs the body through applyFullSiteHeader.
 */
export function renderMarketingShell(opts: MarketingShellOpts): string {
  const doc = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='dark'||(!t&&window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark');else document.documentElement.setAttribute('data-theme','light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}">
  <link rel="canonical" href="${SITE}${esc(opts.canonicalPath)}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/public-pages-wefixtrades.css">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <meta property="og:title" content="${esc(opts.title)}">
  <meta property="og:description" content="${esc(opts.description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  ${opts.headStyles ? `<style>${opts.headStyles}</style>` : ''}
</head>
<body class="qf-public-wft">
  ${SITE_HEADER_SLOT}
  ${opts.bodyHtml}
  ${SITE_FOOTER_SLOT}
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
</body>
</html>`;
  return applyFullSiteHeader(doc, `renderMarketingShell(${opts.canonicalPath})`);
}
