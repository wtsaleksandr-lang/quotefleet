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
//   For Carriers — the people who SELL freight (carriers, brokers, forwarders).
//                  QuoteFleet's paying product plus their lead-generation tools.
//   For Shippers — the people who BUY freight (shippers and importers). Finding
//                  and vetting carriers, getting rates, protecting manifest data.
//   Free Tools   — everything usable with no account, so a first-time visitor
//                  can answer "what can I do here right now?" in one hover.
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
  + `<button type="button" class="nav-dd-trigger" id="nav-carriers-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="nav-carriers-menu">For Carriers${NAV_CARET}</button>`
  + `<div class="nav-dd-panel nav-dd-panel--cols3" id="nav-carriers-menu" hidden>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Your quote tool</p><a href="/w/demo">See a Live Demo</a><a href="/compare">Why QuoteFleet</a><a href="/signup">Start Free</a></div>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Find new customers</p><a href="/importers">Importers Directory</a><a href="/importers/saved" data-nav-auth="user" hidden>Saved Importers</a><span class="nav-dd-sub">Search, profiles and saving are free with an account. Decision-maker email reveals are Leads Pro.</span></div>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">By business type</p><a href="/for/brokers">Freight Brokers</a><a href="/for/forwarders">Freight Forwarders</a><a href="/for/ltl">LTL Carriers</a></div>`
  + `</div></div>`
  + `<div class="nav-dd nav-dd--wide" data-nav-dd>`
  + `<button type="button" class="nav-dd-trigger" id="nav-shippers-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="nav-shippers-menu">For Shippers${NAV_CARET}</button>`
  + `<div class="nav-dd-panel nav-dd-panel--cols3 nav-dd-panel--end" id="nav-shippers-menu" hidden>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Find &amp; vet carriers</p><a href="/directory">Carrier Directory</a><a href="/compliance">Compliance Tools</a><a href="/services">Carriers by Capability</a><a href="/directory/join">Directory Pro</a><span class="nav-dd-sub">Browsing carriers is free. Directory Pro adds contact reveals and CSV export.</span></div>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Get rates &amp; quotes</p><a href="${RFQ_HREF}">Request Freight Quotes</a><a href="/drayage-rates">Port Drayage Rates</a></div>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">Protect your shipment data</p><a href="/manifest-privacy">Manifest Privacy</a><span class="nav-dd-sub">Stop future shipments appearing in U.S. Customs public records.</span></div>`
  + `</div></div>`
  + `<div class="nav-dd" data-nav-dd>`
  + `<button type="button" class="nav-dd-trigger" id="nav-free-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="nav-free-menu">Free Tools${NAV_CARET}</button>`
  + `<div class="nav-dd-panel nav-dd-panel--end nav-dd-panel--cols1" id="nav-free-menu" hidden>`
  + `<div class="nav-dd-group"><p class="nav-dd-head">No account needed</p><a href="/tools">Freight Rate Calculator</a><a href="/glossary">Freight Glossary</a><a href="/guides">Carrier Market Guides</a></div>`
  + `</div></div>`
  + `<a href="/pricing">Pricing</a>`
  + `</nav>`;

/** The same structure as a collapsible mobile drawer. Each menu is a <details>
 *  so it collapses cleanly at 375px, and each panel column becomes a `.mm-sub`
 *  sub-heading — the drawer used to be a flat 11-link dump under Carriers with
 *  no grouping at all, which is what made it unscannable on a phone. */
export const SITE_MOBILE_MENU_HTML = `<div class="site-mobile-menu" id="site-mobile-menu" hidden>`
  + `<details class="mm-group" open><summary class="mm-head">For Carriers</summary>`
  + `<p class="mm-sub">Your quote tool</p><a href="/w/demo">See a Live Demo</a><a href="/compare">Why QuoteFleet</a><a href="/signup">Start Free</a>`
  + `<p class="mm-sub">Find new customers</p><a href="/importers">Importers Directory</a><a href="/importers/saved" data-nav-auth="user" hidden>Saved Importers</a>`
  + `<p class="mm-sub">By business type</p><a href="/for/brokers">Freight Brokers</a><a href="/for/forwarders">Freight Forwarders</a><a href="/for/ltl">LTL Carriers</a></details>`
  + `<details class="mm-group"><summary class="mm-head">For Shippers</summary>`
  + `<p class="mm-sub">Find &amp; vet carriers</p><a href="/directory">Carrier Directory</a><a href="/compliance">Compliance Tools</a><a href="/services">Carriers by Capability</a><a href="/directory/join">Directory Pro</a>`
  + `<p class="mm-sub">Get rates &amp; quotes</p><a href="${RFQ_HREF}">Request Freight Quotes</a><a href="/drayage-rates">Port Drayage Rates</a>`
  + `<p class="mm-sub">Protect your shipment data</p><a href="/manifest-privacy">Manifest Privacy</a></details>`
  + `<details class="mm-group"><summary class="mm-head">Free Tools</summary>`
  + `<p class="mm-sub">No account needed</p><a href="/tools">Freight Rate Calculator</a><a href="/glossary">Freight Glossary</a><a href="/guides">Carrier Market Guides</a></details>`
  + `<a class="mm-flat" href="/pricing">Pricing</a>`
  + `<a class="mm-account" href="/login">Sign in</a>`
  + `</div>`;

export const THEME_TOGGLE_BTN = `<button type="button" class="qf-theme-btn" aria-label="Toggle light/dark theme" aria-pressed="false" title="Toggle theme"><svg class="qf-ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="qf-ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`;

export const SITE_BURGER_BTN = `<button type="button" class="site-burger" id="site-burger" aria-label="Open menu" aria-expanded="false" aria-controls="site-mobile-menu"><svg class="ico-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg><svg class="ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>`;

// ── Canonical full site header + mobile menu ────────────────────────────────
export const FULL_SITE_HEADER = `<header class="site-header">
    <div class="site-header-inner">
      <a href="/" class="site-brand" aria-label="QuoteFleet home"><span class="site-logo" aria-hidden="true"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>QuoteFleet</a>
      ${SITE_NAV_HTML}
      <div class="site-actions">${THEME_TOGGLE_BTN}<a class="signin" href="/login">Sign in</a><a class="btn btn-secondary" href="/w/demo">View demo <span class="arr">→</span></a>${SITE_BURGER_BTN}</div>
    </div>
    ${SITE_MOBILE_MENU_HTML}
  </header>`;

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
 * first three columns are the three header menus (For Carriers / For Shippers /
 * Free Tools) in the same order with the same labels, and Company + Legal close
 * it. Two straight duplicates went with the regroup: /partners appeared twice
 * ("Partners" and "Affiliate program") and /signup appeared twice ("Start free"
 * and "Claim your listing").
 *
 * Closes with the FOOTER_PAY_ROW accepted-payment + trust strip as its very
 * last child.
 */
export const PREMIUM_FOOTER = `<footer class="premium-footer"><div class="premium-footer-inner"><div class="footer-brand"><a href="/" class="qf-footer-brand" aria-label="QuoteFleet home"><img class="qf-footer-logo" src="/brand/logo-full-ondark.png" alt="QuoteFleet — freight rate calculator" width="168" height="113" decoding="async"></a><div class="qf-footer-brandtext"><a href="/" class="qf-footer-wordmark">QuoteFleet</a><p class="qf-footer-tagline">Branded rate calculator pages, PDF quotes, and optional AI chat for trucking service providers.</p></div></div><div class="footer-col"><h4>For Carriers</h4><a href="/w/demo">See a live demo</a><a href="/compare">Why QuoteFleet</a><a href="/signup">Start free</a><a href="/importers">Importers directory</a><a href="/for/brokers">Freight brokers</a><a href="/for/forwarders">Freight forwarders</a><a href="/for/ltl">LTL carriers</a></div><div class="footer-col"><h4>For Shippers</h4><a href="/directory">Carrier directory</a><a href="/compliance">Compliance tools</a><a href="/services">Carriers by capability</a><a href="/directory/join">Directory Pro</a><a href="${RFQ_HREF}">Request freight quotes</a><a href="/drayage-rates">Port drayage rates</a><a href="/manifest-privacy">Manifest privacy</a></div><div class="footer-col"><h4>Free Tools</h4><a href="/tools">Freight rate calculator</a><a href="/glossary">Freight glossary</a><a href="/guides">Carrier market guides</a><a href="/pricing">Pricing</a></div><div class="footer-col"><h4>Company</h4><a href="mailto:hello@quotefleet.net">Contact</a><a href="/support">Support</a><a href="/partners">Partners &amp; affiliates</a><a href="/security">Security</a><a href="/login">Sign in</a></div><div class="footer-col"><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/refund">Refund &amp; Cancellation</a><a href="/dpa">Data Processing (DPA)</a><a href="/cookie">Cookie Policy</a><a href="/.well-known/security.txt">security.txt</a></div></div><ul class="qf-footer-trustbar" role="list"><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7.5a5 5 0 0 1 10 0V11"/></svg>Payments secured by Stripe</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v6c0 4.4 3.2 7.4 7.5 8.9 4.3-1.5 7.5-4.5 7.5-8.9V6z"/><path d="m9 12 2 2 4-4"/></svg>SSL/TLS encrypted</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 4 5.5v6c0 4.6 3.3 7.7 8 9.5 4.7-1.8 8-4.9 8-9.5v-6z"/><circle cx="12" cy="11" r="2.4"/><path d="M12 13.4V16"/></svg>GDPR &amp; CCPA-ready</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg>Per-tenant data isolation</li></ul><div class="footer-bottom"><span>© <span id="year"></span> QuoteFleet. All rights reserved.</span><span class="qf-foot-operator">QuoteFleet is a product of MR Holdings &amp; Trade LLC.</span></div>${FOOTER_PAY_ROW}</footer>`;

// Burger + Solutions-dropdown behaviour, mirrored from landing.html so the
// injected header is interactive. Idempotent #year setter included.
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
<script src="/nav-auth.js" defer></script>`;

/**
 * Replace a static page's stripped `.topnav` header + reduced `.site-footer`
 * with the canonical full header + premium footer, and inject the header CSS +
 * interactivity. Safe to compose on top of other page skins.
 */
export function applyFullSiteHeader(html: string): string {
  let out = html;
  if (!out.includes('/nav-unify.css')) {
    out = out.replace('</head>', '  <link rel="stylesheet" href="/nav-unify.css">\n</head>');
  }
  out = out.replace(/<header class="topnav">[\s\S]*?<\/header>/, FULL_SITE_HEADER);
  out = out.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, PREMIUM_FOOTER);
  out = out.replace('</body>', `${HEADER_SCRIPTS}\n</body>`);
  return out;
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
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}">
  <link rel="canonical" href="${SITE}${esc(opts.canonicalPath)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
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
  <header class="topnav"><div class="topnav-inner"><a href="/" class="brand-mark">QuoteFleet</a></div></header>
  ${opts.bodyHtml}
  <footer class="site-footer">© QuoteFleet</footer>
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
</body>
</html>`;
  return applyFullSiteHeader(doc);
}
