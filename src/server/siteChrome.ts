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
import {
  countLiveOccurrences,
  injectBeforeClosingTag,
  liveInSectionProblem,
} from './htmlInject.js';

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

/**
 * THE DRAWER IS AN OVERLAY, AND THE TWO ELEMENTS IN FRONT OF IT SAY SO.
 *
 * `#site-menu-scrim` is the dimmed page behind the sheet and the click target
 * that closes it. It ships `hidden` alongside the panel and is painted by the
 * WAVE 6 block at the foot of nav-unify.css; the geometry (fixed, anchored at
 * the header's bottom edge) lives entirely there.
 *
 * THE <noscript> LINK IS THE NO-JS ANSWER, and it is a real one. Every path
 * into this drawer — and into the three desktop mega-panels — is a script:
 * both ship `hidden`, and `hidden` is not something CSS can undo on a click.
 * With scripting off the burger is therefore useless, so /nav-nojs.css hides
 * the burger outright and renders the drawer as a plain expanded list in the
 * flow of the header, which is the navigation a phone visitor without JS can
 * actually use (the groups are <details>, so they still open and close on
 * their own). The same sheet gives the desktop mega-panels a :hover /
 * :focus-within reveal. It is a <link rel="stylesheet"> rather than an inline
 * <style> because `rel=stylesheet` is body-ok in the HTML spec and a <style>
 * element inside a <body> <noscript> is not, and it costs a request ONLY for
 * the visitors who need it.
 *
 * The panel takes `role="navigation"` + an accessible name rather than
 * `role="dialog" aria-modal="true"`: its close control is the burger, which
 * lives OUTSIDE the panel, and `aria-modal` would hide exactly that control
 * from assistive tech. Focus is still trapped, by script, over the burger plus
 * the panel — see HEADER_SCRIPTS.
 *
 * Each menu is a <details> so it collapses cleanly at 375px, and each panel
 * column becomes a `.mm-sub` sub-heading — the drawer used to be a flat 11-link
 * dump under Carriers with no grouping at all, which made it unscannable on a
 * phone.
 *
 * ── WAVE 7: THE INTERIOR IS A ROW, NOT A LINE OF TEXT ──────────────────────
 *
 * Reported as "it's very basic ... I don't see any clear separation between
 * categories ... Icons for the tools. Tools have titles and subtitles.
 * Subtitles fit in a single line." Three structural changes answer it, and one
 * of them is content rather than markup.
 *
 * 1. THE SPACER. `.mm-barpad` is an opaque, `aria-hidden` block the height of
 *    the top bar, INSIDE the panel. It is what lets the panel start at y=0 and
 *    run to all four viewport edges while the bar's controls still float over
 *    it: the surface is full-bleed, the content is not under the burger. The
 *    panel used to be inset 16px left and right with an 8px gap under the bar,
 *    which is the "large gaps on the left and right sides and between menu
 *    container and the top bar" half of the report. Measured after: 0px on all
 *    four sides and 0px to the bar.
 *
 * 2. THE FOLD. Each group's body is wrapped in `.mm-fold > .mm-fold__in` so it
 *    can be animated with `grid-template-rows: 0fr -> 1fr`, which resolves to
 *    the content's INTRINSIC height — no `max-height` guess that clips a long
 *    group or coasts through empty space on a short one. The <details> stays
 *    the element, so a visitor with scripting off still gets a working
 *    disclosure; the script only holds `open` on for the length of the exit so
 *    the close can be seen (see FOLD CONTROLLER in HEADER_SCRIPTS).
 *
 * 3. THE ROW. Every destination is now an icon tile + title + subtitle. The
 *    glyphs are the SAME set the homepage tool bento draws (24px box, 1.3px
 *    stroke, no fill) so the menu and the page agree on what a tool looks
 *    like; the rows the bento has no card for are drawn in that same grammar.
 *
 * THE ONE-LINE SUBTITLE IS EDITORIAL, NOT CSS. Nothing here is clipped in the
 * normal case: every subtitle below is written to a <=28 character budget,
 * which is what keeps it on one line down to 320px. `nowrap` + `ellipsis` in
 * the sheet is a BACKSTOP for a future long string, not the mechanism — if it
 * ever fires, the copy is wrong, not the CSS.
 */

/** The row glyphs. Same grammar as `.qf-toolcard__ico` on the homepage — a
 *  24px box, `fill: none`, `stroke: currentColor`, 1.3px, round caps — so the
 *  eleven that have a bento card are the bento's own paths, verbatim, and the
 *  rest are drawn to match rather than borrowed from a second icon set. */
const MM_GLYPHS: Record<string, string> = {
  // ── Verbatim from the homepage tool bento (landing.html) ────────────────
  permits: `<path d="M3 7v10M21 7v10"/><rect x="7" y="9" width="10" height="6" rx="1"/><path d="M5.6 10.6 4.2 12l1.4 1.4M18.4 10.6 19.8 12l-1.4 1.4"/>`,
  scales: `<path d="M12 4.2v15.4M7.5 19.6h9"/><path d="M4 8.6h16"/><path d="M4 8.6 1.9 13.6a2.5 2.5 0 0 0 4.2 0z"/><path d="M20 8.6l2.1 5a2.5 2.5 0 0 1-4.2 0z"/>`,
  lowboy: `<path d="M2.5 15.5V9.5h9v6"/><path d="M11.5 11.5h4.2l3.8 3.4v.6h-8"/><path d="M5 9.5V5.5h5v4"/><circle cx="6.5" cy="17.6" r="1.8"/><circle cx="16.5" cy="17.6" r="1.8"/>`,
  frost: `<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.5 5 12 7.5 14.5 5M9.5 19 12 16.5l2.5 2.5"/>`,
  cone: `<path d="M12 3.6 6.8 18.4h10.4z"/><path d="M9.9 11.2h4.2M8.8 14.8h6.4"/><path d="M4 20.6h16"/>`,
  shield: `<path d="M12 3 4.8 5.8v5.6c0 4.3 3 7.2 7.2 8.8 4.2-1.6 7.2-4.5 7.2-8.8V5.8z"/><path d="m9 12 2.2 2.2L15.4 10"/>`,
  clipboard: `<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.2h6v1.3"/><path d="m9.2 12.4 2 2 3.6-3.8"/>`,
  cube: `<path d="M12 3.2 3.9 7.3v9.4L12 20.8l8.1-4.1V7.3z"/><path d="M3.9 7.3 12 11.4l8.1-4.1M12 11.4v9.4"/>`,
  container: `<rect x="3" y="8.5" width="12" height="7" rx="1"/><path d="M6 8.5v7M9 8.5v7M12 8.5v7"/><path d="M19 6.2v11M16.6 15.1 19 17.5l2.4-2.4"/>`,
  lock: `<rect x="4.5" y="10.4" width="15" height="9.6" rx="2"/><path d="M8 10.4V7.8a4 4 0 0 1 8 0v2.6"/><path d="M12 14.4v2"/>`,
  book: `<path d="M4 4.5h6a3 3 0 0 1 3 3v12a2.4 2.4 0 0 0-2.4-2.4H4z"/><path d="M20 4.5h-6a3 3 0 0 0-3 3v12a2.4 2.4 0 0 1 2.4-2.4H20z"/>`,
  // ── Drawn in the same grammar for the rows the bento has no card for ────
  demo: `<rect x="3" y="4.5" width="18" height="13" rx="2"/><path d="M8.5 20.5h7"/><path d="m10.5 8.6 4.4 2.4-4.4 2.4z"/>`,
  compare: `<path d="M2.5 20.5h19"/><path d="M5.5 20.5V13M12 20.5V5M18.5 20.5v-4.5"/>`,
  tag: `<path d="M3.5 11.2V4.5a1 1 0 0 1 1-1h6.7a1 1 0 0 1 .7.3l8.3 8.3a1 1 0 0 1 0 1.4l-6.7 6.7a1 1 0 0 1-1.4 0L3.8 11.9a1 1 0 0 1-.3-.7z"/><circle cx="7.8" cy="7.8" r="1.4"/>`,
  userplus: `<path d="M14.5 20.5v-1.7a4 4 0 0 0-4-4H6.4a4 4 0 0 0-4 4v1.7"/><circle cx="8.45" cy="7.4" r="3.4"/><path d="M18.5 6.5v6M21.5 9.5h-6"/>`,
  bookmark: `<path d="M6 4h12v16.5l-6-4.2-6 4.2z"/>`,
  briefcase: `<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M8.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 6v1.5"/><path d="M3 12.5h18"/>`,
  globe: `<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4c2.2 2.4 3.4 5.4 3.4 8.6S14.2 18.2 12 20.6c-2.2-2.4-3.4-5.4-3.4-8.6S9.8 5.8 12 3.4z"/>`,
  pallet: `<rect x="3" y="12.5" width="7.5" height="6.5" rx="1"/><rect x="13.5" y="12.5" width="7.5" height="6.5" rx="1"/><rect x="8.25" y="5" width="7.5" height="6.5" rx="1"/>`,
  sliders: `<path d="M4 6.5h16M4 12h16M4 17.5h16"/><circle cx="9" cy="6.5" r="1.9"/><circle cx="15" cy="12" r="1.9"/><circle cx="8" cy="17.5" r="1.9"/>`,
  star: `<path d="m12 3.6 2.7 5.5 6 .9-4.35 4.2 1.03 6L12 17.4l-5.38 2.8 1.03-6L3.3 10l6-.9z"/>`,
  send: `<path d="M21 3.5 3.3 10.1l6.7 2.9 2.9 6.7z"/><path d="m10 13 4.6-4.6"/>`,
  calculator: `<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 7.5h7"/><path d="M9 11.5h.01M12 11.5h.01M15 11.5h.01M9 15h.01M12 15h.01M15 15h.01M9 18h6"/>`,
  gauge: `<circle cx="12" cy="13.2" r="7.6"/><path d="m12 13.2 3.1-3.7"/><path d="M4.6 8.6 6.1 6.3M19.4 8.6 17.9 6.3"/>`,
  map: `<path d="m9 4.5-6 2.4v12.6l6-2.4 6 2.4 6-2.4V4.5l-6 2.4z"/><path d="M9 4.5v12.6M15 6.9v12.6"/>`,
  doc: `<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8.5h8M8 12h8M8 15.5h5"/>`,
  receipt: `<path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5z"/><path d="M9.5 8.5h5M9.5 12.5h5"/>`,
  signin: `<path d="M14.5 3.5h4a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-4"/><path d="m9.8 16 4-4-4-4"/><path d="M13.8 12h-10"/>`,
};

/** One drawer row: 36px icon tile, 14px title, 12px subtitle. */
function mmRow(href: string, glyph: string, title: string, sub: string, attrs = ''): string {
  return `<a href="${href}"${attrs}>`
    + `<span class="mm-tile" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${MM_GLYPHS[glyph]}</svg></span>`
    + `<span class="mm-txt"><span class="mm-t">${title}</span><span class="mm-s">${sub}</span></span>`
    + `</a>`;
}

/** The group heading: 16px sentence-case label + a 16px chevron that rotates. */
function mmHead(label: string): string {
  return `<summary class="mm-head"><span class="mm-head__t">${label}</span>`
    + `<svg class="mm-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>`;
}

const mmFold = (rows: string): string => `<div class="mm-fold"><div class="mm-fold__in">${rows}</div></div>`;

export const SITE_MOBILE_MENU_HTML = `<noscript><link rel="stylesheet" href="/nav-nojs.css"></noscript>`
  + `<div class="site-menu-scrim" id="site-menu-scrim" hidden></div>`
  + `<div class="site-mobile-menu" id="site-mobile-menu" role="navigation" aria-label="Site menu" tabindex="-1" hidden>`
  + `<div class="mm-barpad" aria-hidden="true"></div>`
  + `<div class="mm-scroll">`
  + `<details class="mm-group">${mmHead('For Carriers &amp; Brokers')}`
  // `/claim` is the drawer's ONLY path to the free profile claim: the header's
  // "Claim your listing — free" button is hidden at the burger breakpoint, so
  // without this row a phone visitor has no route to it at all. Distinct href
  // from /signup (claiming is free forever; the trial is a separate product).
  + mmFold(`<p class="mm-sub">Your quote tool</p>`
    + mmRow('/w/demo', 'demo', 'See a Live Demo', 'See the quote widget')
    + mmRow('/compare', 'compare', 'Why QuoteFleet', 'How we compare to a TMS')
    + mmRow('/claim', 'tag', 'Claim your listing — free', 'Free carrier profile')
    + mmRow('/signup', 'userplus', 'Start Free', 'Open a trial account')
    + `<p class="mm-sub">Find new customers</p>`
    + mmRow('/importers', 'cube', 'Importers Directory', 'US customs import records')
    + mmRow('/importers/saved', 'bookmark', 'Saved Importers', 'Your saved companies', ' data-nav-auth="user" hidden')
    + `<p class="mm-sub">By business type</p>`
    + mmRow('/for/brokers', 'briefcase', 'Freight Brokers', 'QuoteFleet for brokers')
    + mmRow('/for/forwarders', 'globe', 'Freight Forwarders', 'QuoteFleet for forwarders')
    + mmRow('/for/ltl', 'pallet', 'LTL Carriers', 'QuoteFleet for LTL'))
  + `</details>`
  + `<details class="mm-group">${mmHead('For Shippers')}`
  + mmFold(`<p class="mm-sub">Find &amp; vet carriers</p>`
    + mmRow('/directory', 'shield', 'Carrier Directory', 'Search FMCSA carriers')
    + mmRow('/guides', 'map', 'Carrier Market Guides', 'Freight market guides')
    + mmRow('/compliance', 'clipboard', 'Compliance Tools', 'Look up a USDOT or MC')
    + mmRow('/services', 'sliders', 'Carriers by Capability', 'Browse by equipment')
    + mmRow('/directory/join', 'star', 'Directory Pro', 'Contact reveals and CSV')
    + `<p class="mm-sub">Get rates &amp; quotes</p>`
    + mmRow(RFQ_HREF, 'send', 'Request Freight Quotes', 'One RFQ to many carriers')
    + mmRow('/drayage-rates', 'container', 'Port Drayage Rates', 'Rate ranges by gateway')
    + `<p class="mm-sub">Protect your shipment data</p>`
    + mmRow('/manifest-privacy', 'lock', 'Manifest Privacy', 'File a CBP privacy request'))
  + `</details>`
  + `<details class="mm-group">${mmHead('Free Tools')}`
  + mmFold(`<p class="mm-sub">No account needed</p>`
    + mmRow('/tools', 'calculator', 'Freight Rate Calculator', 'Estimate a freight rate')
    + mmRow('/tools/oversize-permits', 'permits', 'Oversize Permit Calculator', 'OS/OW fees by state')
    + mmRow('/tools/bridge-formula', 'scales', 'Bridge Formula Calculator', 'Federal bridge formula')
    + mmRow('/tools/axle-weights', 'gauge', 'Axle Weight Checker', 'Check each axle group')
    + mmRow('/tools/heavy-haul-quote', 'lowboy', 'Heavy-Haul Quote Tool', 'Price an oversize move')
    + mmRow('/tools/seasonal-weight-restrictions', 'frost', 'Frost Law Restrictions', 'Spring thaw postings')
    + mmRow('/oversize', 'doc', 'Oversize Permit Guide', 'How OS/OW permits work')
    + mmRow('/pilot-cars', 'cone', 'Pilot Car &amp; Escort Directory', 'Escorts by state')
    + mmRow('/glossary', 'book', 'Freight Glossary', 'Plain-English definitions'))
  + `</details>`
  + `<a class="mm-flat" href="/pricing"><span class="mm-tile" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${MM_GLYPHS.receipt}</svg></span><span class="mm-txt"><span class="mm-t">Pricing</span><span class="mm-s">Plans and what they cost</span></span></a>`
  + `<a class="mm-account" href="/login"><span class="mm-tile" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${MM_GLYPHS.signin}</svg></span><span class="mm-txt"><span class="mm-t">Sign in</span><span class="mm-s">Access your account</span></span></a>`
  + `</div>`
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

/** The chrome's own stylesheet, injected into <head> by `applySiteChrome`.
 *  Named because both the injector and the boot audit assert on it. */
export const NAV_UNIFY_CSS = '/nav-unify.css';

/** Raised when a page's chrome slots do not match what the variant requires. */
export class SiteChromeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteChromeError';
  }
}

export const THEME_TOGGLE_BTN = `<button type="button" class="qf-theme-btn" aria-label="Toggle light/dark theme" aria-pressed="false" title="Toggle theme"><svg class="qf-ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="qf-ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`;

/**
 * THE BURGER MORPHS; IT DOES NOT SWAP GLYPHS. It used to ship TWO icons — a
 * three-line `.ico-open` and an X `.ico-close` — with CSS toggling `display`
 * between them on `aria-expanded`. `display` cannot be animated, so the change
 * was a hard cut: the bars vanished and an X appeared in the same frame, which
 * is the cheapest-looking part of a control the visitor taps every time.
 *
 * Three spans instead. They are the SAME three bars in both states, so opening
 * rotates the outer two onto each other and fades the middle one out — one
 * continuous movement the eye can follow, on the same emphasised curve as the
 * sheet it opens. Geometry and transforms live in the WAVE 6 block at the foot
 * of nav-unify.css; `pointer-events: none` on the box keeps every tap on the
 * <button> itself.
 */
export const SITE_BURGER_BTN = `<button type="button" class="site-burger" id="site-burger" aria-label="Open menu" aria-expanded="false" aria-controls="site-mobile-menu"><span class="qf-burger-box" aria-hidden="true"><span class="qf-burger-bar"></span><span class="qf-burger-bar"></span><span class="qf-burger-bar"></span></span></button>`;

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
 * THIS STRIP IS NOW THE FOOTER'S ONLY TRUST BAND (2026-09, "the footer looks
 * too heavy and big"). The footer used to stack THREE bands: a four-item
 * `.qf-footer-trustbar`, then `.footer-bottom`, then this row — and the first
 * two of the trust bar's claims were already being made right here. "Payments
 * secured by Stripe" sat directly above "Powered by Stripe" AND "Card details
 * never touch our servers": one fact, three sentences, two strips. So the
 * duplicate was DELETED (not restyled) and the trust bar's remaining
 * non-overlapping claims moved into this strip, which is now the single place
 * a trust claim may live.
 *
 * THE PER-CLAIM ICONS WENT WITH IT. Six 15px glyphs bought nothing a reader
 * could not get from the words, and each one forced its claim to be an
 * inline-flex BLOCK that wrapped as a unit — which is what made three claims
 * need their own stacked line on phones. As plain list items with a CSS `·`
 * separator the claims reflow as ordinary text, so no claim can be orphaned
 * onto a line alone. NOTHING WAS ADDED: every claim below was already rendered
 * somewhere in the old footer, and each remains backed by the repo evidence
 * catalogued above.
 *
 * "SSL/TLS ENCRYPTED" WAS DROPPED (Alex, 2026-09). It was true, but transport
 * encryption is table stakes in 2026 — every site the reader has ever opened
 * has it — so it spent a line of the strip saying nothing that distinguishes
 * us. It is the only claim removed for weakness rather than duplication.
 *
 * TWO SHORT RUNS, NOT ONE LONG ONE. Five claims joined by middots read as an
 * undifferentiated crawl: the reader has to parse the whole line to find the
 * one fact they wanted. They are two DIFFERENT KINDS of promise, so they are
 * two lists:
 *   • `.qf-payrow-trust` — what happens when you pay. It belongs beside the
 *     marks and "Powered by Stripe" because it is the same subject.
 *   • `.qf-payrow-platform` — what the product does with your data once you
 *     are in. Nothing to do with checkout, so it sits apart.
 * Two runs of three and two scan in one glance at 375px; one run of five did
 * not. No claim was reworded to fit the grouping.
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

/**
 * THE PROCESSOR ATTRIBUTION, AS A MARK RATHER THAN A SENTENCE (Alex, 2026-09).
 *
 * It used to be `<span class="qf-payrow-proc">Powered by Stripe</span>` — plain
 * text sitting beside six drawn marks, which read as a caption that had been
 * left behind rather than as part of the row. The ask was for it to look like
 * the marks it stands next to. So it is now drawn the same way they are: one
 * inline SVG, `currentColor`, no external request, no brand colour, in the same
 * bordered tile at the same rendered HEIGHT as its six siblings.
 *
 * IT IS NOT A SEVENTH `.qf-paymark` LI, and that is the whole design decision.
 * Two independent reasons, both measured:
 *
 *   • ARITHMETIC. `.qf-paymarks` is `flex-wrap: nowrap` precisely so a mark can
 *     never be orphaned onto a line of its own, and the row is sized to the
 *     narrowest supported viewport: six tiles plus five gaps against the
 *     content box at 320px. A tile carrying a two-word phrase is roughly two
 *     and a half tiles wide; inside that list it overflows at 375 AND at 320,
 *     and the only ways out are wrapping the list (orphan) or shrinking the
 *     phrase below the legibility floor. Outside the list it costs nothing:
 *     `.qf-payrow-methods` is already a COLUMN below 720px, so the badge takes
 *     a line the old text span was taking anyway.
 *   • MEANING. The marks answer "what can I pay with"; this answers "who
 *     processes it". Stripe is not a payment method — dropping a bare `stripe`
 *     wordmark into the accepted-payments list would state something we do not
 *     mean. Keeping "Powered by" keeps the sentence true, which is why the
 *     phrase is drawn rather than abbreviated to the logo.
 *
 * WIDTH IS SPENT, HEIGHT IS NOT. The viewBox is wider than the 32x16 the other
 * marks use because the content is a phrase, but it is the same SIXTEEN units
 * tall and renders at the same CSS height, so every mark in the strip shares
 * one baseline and one optical weight. "Powered by" is the lighter, smaller
 * half and "stripe" the heavy one, in the proportion the supplied reference
 * badge uses; the outlined, rounded tile is the `.qf-paymark` tile the other
 * six already wear, which is the same idiom the reference draws by hand.
 *
 * `textLength` PINS EACH RUN. SVG `<text>` inherits the page font, so a font
 * stack that resolves wider on one platform would push a glyph past the
 * viewBox. Both runs declare the width they are allowed to occupy and the UA
 * fits the tracking to it, so the badge measures the same everywhere.
 */
const STRIPE_MARK = `<svg class="qf-pm qf-pm-proc" viewBox="0 0 82 16" role="img" aria-label="Powered by Stripe">`
  + `<text x="1" y="11.3" font-size="7.6" font-weight="600" textLength="36">Powered by</text>`
  + `<text x="44" y="12.4" font-size="11.5" font-weight="800" textLength="36">stripe</text>`
  + `</svg>`;

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
  /* THE PROCESSOR BADGE IS A LABELLED BAND, NOT A LOOSE SEVENTH TILE.
     Below 720px `.qf-payrow-methods` is a COLUMN, so this span took a line of
     its own — and because it wears the same 1px/6px/22px `.qf-paymark` tile as
     the six marks above it, that line read as a 6+1 orphan wrap rather than as
     the deliberate separation the STRIPE_MARK note above describes. Measured
     6 + 1 at 320/375/390 in both themes.

     The fix is NOT to fold it into `.qf-paymarks` for a 4+3 break: that list is
     the answer to "what can I pay with" and Stripe is not a payment method
     (see STRIPE_MARK). Instead the badge gets its own `.qf-payrow-label` — the
     exact idiom "Accepted payments" already uses — so the line carries TWO
     items and the separation is stated rather than inferred. One line, two
     elements, no orphan, and the six-tile row keeps `flex-wrap: nowrap`. */
  + `<span class="qf-proc-band"><span class="qf-payrow-label">Payment processor</span>`
  + `<span class="qf-paymark qf-paymark--proc">${STRIPE_MARK}</span></span>`
  + `</div>`
  + `<ul class="qf-payrow-trust" role="list">`
  + `<li>Card details never touch our servers</li>`
  + `<li>No credit card to start</li>`
  + `<li>Cancel anytime — no contracts</li>`
  + `</ul>`
  + `<ul class="qf-payrow-platform" role="list">`
  + `<li>GDPR &amp; CCPA-ready</li>`
  + `<li>Per-tenant data isolation</li>`
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
 *   • phone — two tracks ONLY IF TWO DIVIDE THE COLUMNS EVENLY; an odd count
 *             stacks instead.
 *
 * THE PHONE STEP CHANGED IN 2026-09, AND THE OLD ONE IS WHY. It used to be two
 * tracks unconditionally, and an odd N paid for that by pinning its LAST column
 * `grid-column: 1 / -1`. The arithmetic was sound — four columns wrapping into
 * two tracks leaves no remainder — but the RESULT was a footer that read 2 / 2
 * / 1, with the fifth heading sitting alone on a full-width final row. The rule
 * blesses a full-bleed row as "a row that holds one column because it was told
 * to", and against five open link LISTS that was fair: the spanned column was
 * visibly a two-up block of links, not a stranded item. Against five COLLAPSED
 * disclosures it is one lone summary bar under two tidy rows of two, which is
 * exactly the shape the no-orphan rule exists to prevent.
 *
 * So an odd count now takes T = 1, which the law above already blesses without
 * qualification — a deliberate full stack, never a wrap remainder. On a phone
 * that is also the better control: every <summary> becomes a full-width tap
 * target instead of a half-width one.
 *
 * ONE RULE, BOTH FOOTERS. This is arithmetic, not a special case for the
 * marketing footer: N=5 yields 5 → 3 → 1 (stack) and the directory's N=4 yields
 * 4 → 2 → 2, because four genuinely does divide into two tracks with nothing
 * left over. Neither footer needs a hand-written exception.
 *
 * Change `FOOTER_COLUMNS` and this function immediately reports different
 * numbers; siteChromeSingleSource.test.ts then fails naming the sheets that
 * still declare the old ones.
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
    phone: columns % 2 === 0 ? 2 : 1,
    // Nothing spans any more: two tracks are used only when they divide the
    // count evenly, so there is never a leftover column to pin full-bleed.
    phoneSpansLast: false,
  };
}

/** Human-readable one-liner for the failure message a ladder mismatch prints. */
export function footerColumnLadderReport(columns = FOOTER_COLUMNS.length): string {
  const l = footerTrackLadder(columns);
  return `${l.columns} columns → wide ${l.wide} / mid ${l.mid} / phone ${l.phone}`
    + `${l.phoneSpansLast ? ' with the last column spanning' : ''}`;
}

/**
 * CARRIER NAMES AND MARKS — the attribution + removal line.
 *
 * Two surfaces now render a carrier's REAL logo: the directory's listing and
 * profile tiles, and the homepage strip — both fed by directory/carrierLogos.ts.
 * Showing another company's mark in order to say "this is that company" is
 * nominative use and is fine, but only while the page is unambiguous about
 * three things, which is exactly what this line does: the marks are THEIRS,
 * they identify a carrier LISTED in the directory rather than signalling any
 * relationship with us, and there is a real address to ask for removal.
 *
 * IT LIVES IN THE SITE-WIDE FOOTER, not in the directory's data-source strip,
 * because that strip renders only on carrier-data pages (`rendersCarrierData`)
 * and the logo marquee is on the HOMEPAGE — the surface showing the most marks
 * is the one the strip would have missed. One copy, reachable from all of them.
 */
export const CARRIER_MARKS_NOTE =
  'Carrier names and logos are the property of their owners, shown to identify carriers listed in our directory — not as endorsement or affiliation. '
  + 'Removal requests: <a href="mailto:legal@quotefleet.net">legal@quotefleet.net</a>.';

/**
 * THE SAME DISCLAIMER FOR THE DIRECTORY SUBSITE, WITHOUT A `mailto:`.
 *
 * /directory is the surface that ACTUALLY renders third-party carrier names and
 * logos, so it is the one page where this nominative-use line does real work —
 * and until now it was the one page that did not carry it. It was left off
 * because of a genuine constraint, not an oversight: directoryContact policy
 * forbids ANY `mailto:` in the directory chrome (carrierProfileContact.test.ts
 * asserts a contact-hidden carrier profile contains no "mailto:" anywhere on
 * the page, across ~334k profiles — a site-wide footer address would defeat
 * that check on every one of them). Verified by reading that test, not assumed.
 *
 * So the CLAIM is byte-identical and only the ROUTE changes: the first
 * sentence — the part that does the legal work — is the same string as
 * CARRIER_MARKS_NOTE, and the removal contact is kept BOTH ways, as a working
 * link to /support (the directory's sanctioned contact route, already the
 * Company column's own destination for the same reason) and as the plain-text
 * address so nothing is lost to a reader who prefers to mail us directly.
 * Dropping the contact was never an option — a nominative-use disclaimer with
 * no removal route is not a disclaimer.
 */
export const CARRIER_MARKS_NOTE_SUPPORT =
  'Carrier names and logos are the property of their owners, shown to identify carriers listed in our directory — not as endorsement or affiliation. '
  + 'Removal requests: <a href="/support">contact us</a> or email legal@quotefleet.net.';


const FOOTER_LADDER = footerTrackLadder(FOOTER_COLUMNS.length);

/**
 * EVERY FOOTER LINK COLUMN IS A NATIVE DISCLOSURE — one renderer, both footers.
 *
 * Alex, 2026-09: the footer "looks too heavy and big". On a phone the honest
 * cause was arithmetic, not styling — PREMIUM_FOOTER stacks 42 links and the
 * directory footer 32, and at 375px that wall measured 1622px and 1248px of
 * footer under every page on the site.
 *
 * WHY `<details>`/`<summary>` AND NOT A JS ACCORDION:
 *   • The links STAY IN THE DOM when collapsed. These are internal SEO links
 *     into /tools, /directory, /guides and the audience pages; an accordion
 *     that built its panel on click would have removed ~40 internal links from
 *     every page on the site, which is a ranking change dressed up as a style
 *     change. A closed <details> is still parsed, still crawled, still found by
 *     in-page search — it is not rendered, which is a different thing.
 *   • Keyboard and AT behaviour is the browser's, not ours: <summary> is
 *     focusable, Enter/Space toggle it, and the expanded state is exposed
 *     without a single aria-* attribute for us to get wrong.
 *
 * OPEN BY DEFAULT IN THE MARKUP, closed on phones by the one-line sync in
 * HEADER_SCRIPTS. That direction is deliberate: with JS unavailable every
 * column renders exactly as it does today (open, all links visible), so the
 * no-JS floor is the CURRENT behaviour and the disclosure is pure enhancement.
 * Shipping them closed and opening with CSS would have inverted that — a
 * no-JS desktop visitor would meet five collapsed columns, and hiding
 * navigation behind a click on a wide screen is the thing we are told not to do.
 */
export const FDISC_CHEVRON = `<svg class="qf-fdisc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

export function footerDisclosureColumn(opts: {
  colClass: string;
  headTag: 'h2' | 'h4';
  headClass?: string;
  heading: string;
  linksHtml: string;
}): string {
  const head = `<${opts.headTag}${opts.headClass ? ` class="${opts.headClass}"` : ''}>`
    + `${opts.heading}</${opts.headTag}>`;
  return `<div class="${opts.colClass}"><details class="qf-fdisc" open>`
    + `<summary class="qf-fdisc-sum">${head}${FDISC_CHEVRON}</summary>`
    + `<div class="qf-fdisc-body">${opts.linksHtml}</div>`
    + `</details></div>`;
}

const FOOTER_COLUMNS_HTML = FOOTER_COLUMNS.map(
  (col) => footerDisclosureColumn({
    colClass: 'footer-col',
    headTag: 'h4',
    heading: col.heading,
    linksHtml: col.links.map((l) => `<a href="${l.href}">${l.label}</a>`).join(''),
  }),
).join('');

/**
 * THE BOTTOM HALF OF BOTH FOOTERS — one implementation, two consumers.
 *
 * PREMIUM_FOOTER and the directory subsite's `.dirfoot` are separate markup
 * (their COLUMN sets legitimately differ: the marketing footer carries a Legal
 * column and the audience pages, the directory one does not). Their bottom
 * halves did not differ for any such reason — they had simply been transcribed
 * twice and then drifted, which is the same trap that once cost landing.html
 * six destinations. Both now call this.
 *
 * WHAT IS ALWAYS VISIBLE, AND WHY IT IS NOT A DISCLOSURE. Everything this
 * function emits is compliance or attribution text: the copyright, the
 * operator attribution, the carrier names-and-marks note, the FMCSA
 * non-affiliation + self-declared labelling, and the payment facts. A
 * compliance statement that a reader has to click to reveal has not been made,
 * so none of it is wrapped in <details> and none of it is display:none at any
 * width. It is set smaller and tighter than it was — that is a type decision,
 * and both themes are measured at =>4.5:1 against the footer ground.
 *
 * THE MARKS NOTE IS LAST NOW, AND IT IS STILL UNCONDITIONALLY VISIBLE (Alex,
 * 2026-09: make it less prominent). It used to sit second, directly under the
 * copyright and ABOVE the payment strip, which put the quietest sentence in the
 * footer in the loudest position the block has. It now closes the footer, below
 * the GDPR/CCPA and per-tenant-isolation claims.
 *
 * "LESS PROMINENT" IS BOUGHT WITH POSITION AND WEIGHT, NOT WITH SIZE OR
 * CONCEALMENT. This is a trademark nominative-use disclaimer: it has to be
 * READ to do its job, so it stays a plain <p> in normal document flow — never
 * inside a <details>, never display:none, never a hover reveal, never behind a
 * "read more", at any width, in either theme. The type drops exactly one step
 * (11.5px -> 11px, the floor this block is allowed) and the mailto stops being
 * pure white — see `.qf-foot-marks` in style.css for the measured contrast. Not
 * one word of the sentence changed.
 *
 * TWO FLAGS, BOTH CONTENT DECISIONS THAT PREDATE THIS FUNCTION:
 *   • `marksNote` — `true` renders the mailto variant, `'support'` the
 *     no-mailto directory variant, and omitting it renders nothing.
 *
 *     IT USED TO BE MARKETING-ONLY, AND THAT WAS THE BUG. The directory chrome
 *     must contain NO mailto: anywhere (carrierProfileContact.test.ts asserts a
 *     contact-hidden carrier profile has none, on all ~334k profiles), so the
 *     first cut of this merge kept the whole note off `.dirfoot` rather than
 *     plant a mailto on every directory page. The cost of that was the exact
 *     inversion of what the line is for: /directory is the surface that
 *     actually RENDERS third-party carrier names and logos, so the one page
 *     where a nominative-use disclaimer does real work was the one page without
 *     it. The constraint was real; omitting the disclaimer was not the only way
 *     to honour it. `'support'` keeps the claim word-for-word and swaps only
 *     the removal ROUTE (see CARRIER_MARKS_NOTE_SUPPORT). Never regress this to
 *     a boolean that drops the note — footerCarrierMarks.test.ts pins it.
 *   • `legalLinks` — the directory footer's only route to /terms and /privacy
 *     is this line, because it has no Legal column. PREMIUM_FOOTER does have
 *     one, and repeating them here would be the duplicate-destination defect
 *     the footer was regrouped to remove.
 */
export function footerBottomHtml(opts: {
  marksNote?: boolean | 'support';
  legalLinks?: boolean;
  dataSources?: boolean;
} = {}): string {
  const marks = opts.marksNote === 'support'
    ? CARRIER_MARKS_NOTE_SUPPORT
    : opts.marksNote ? CARRIER_MARKS_NOTE : '';
  return `<div class="footer-bottom">`
    + `<p class="qf-foot-line"><span class="qf-foot-copy">© <span id="year"></span> QuoteFleet.</span> `
    + `<span class="qf-foot-operator">A product of MR Holdings &amp; Trade LLC.</span>`
    + (opts.legalLinks ? ` <span class="qf-foot-links"><a href="/">Home</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></span>` : '')
    + `</p>`
    + `${FOOTER_OOG_CTA}`
    + `</div>`
    + (opts.dataSources ? DIRECTORY_DATA_SOURCES : '')
    + FOOTER_PAY_ROW
    + (marks ? `<div class="qf-foot-marks"><p class="qf-foot-marks-line">${marks}</p></div>` : '');
}

/**
 * THE FOOTER LOCKUP KEEPS THE WHITE CUT IN BOTH THEMES — `data-logo-fixed`.
 *
 * Alex, 2026-09: "white on the dark site and black on the bright site". That is
 * a rule about the GROUND, and on this element the ground does not move: the
 * marketing footer is `--footer-bg` = `--surface-dark`, declared once at :root
 * and NOT re-declared per theme, so the band paints the same near-black under
 * data-theme="dark", under data-theme="light" and under the un-stamped default.
 * Every ink token in here (`--footer-ink`, `--footer-link`, `--footer-quiet`)
 * is near-white in both themes for exactly that reason.
 *
 * SO THE RULE WAS ALREADY BEING BROKEN, IN THE DIRECTION NOBODY EXPECTED.
 * theme-toggle.js#swapLogos rewrites any `/brand/*-ondark` src to its light cut
 * whenever the theme is light — correct for the header, which sits on a themed
 * page ground, and wrong here, because it swapped the white-outline truck for
 * the navy-outline one ON A NEAR-BLACK BAND. Measured in light mode this was a
 * dark mark on a dark ground: the hard contrast rule, inverted.
 *
 * `data-logo-fixed` opts this one image out of that global swap, which is both
 * the fix and the honest statement of intent: the cut follows the GROUND, and
 * this ground is dark. Doing it with an attribute rather than a CSS
 * `content: url()` override means the src NEVER changes after parse, so there
 * is no wrong-logo flash to avoid in the first place, and `width`/`height` stay
 * on the element so nothing reflows. If the footer band is ever themed, delete
 * the attribute and the existing swap does the right thing again.
 */
/**
 * THE FOOTER WORDMARK IS A BAKED OUTLINE, NOT TYPE.
 *
 * It used to be a text node in Inter Variable at weight 850 — Inter Black. At
 * 15px that weight closes the counters and reads as a heavy UI label rather
 * than a mark, and Inter is the most-used UI face on the web, so it carried no
 * distinction. Alex reviewed rendered candidates and chose Instrument Sans 600
 * at -0.02em tracking.
 *
 * WHY OUTLINES AND NOT A WEBFONT. The string is ten characters. An Instrument
 * Sans 600 latin-subset woff2 is ~17 KB plus a request to fonts.gstatic.com
 * plus a swap flash, on a site where Core Web Vitals have already cost us
 * work. These paths are ~1.0 KB brotli, inline, zero requests, no FOUT.
 * Nothing else on the site uses the face, so a webfont would buy one word.
 *
 * THE TRACKING AND THE KERNING ARE BAKED IN — never add letter-spacing back.
 * Each glyph is drawn at x=0 and placed by an SVG transform, and those x
 * positions came from the BROWSER's own layout of the live webfont, not from
 * opentype.js's advance maths: Instrument Sans ships GPOS kerning and NO
 * legacy 'kern' table, so opentype.js's getKerningValue() returns 0 for every
 * pair and the first cut of this asset was unkerned — it drifted -0.63% across
 * the string, 19.8% of ink pixels off against the live face at 100px. The
 * shipped paths differ from the webfont only in anti-aliasing (2.5% of ink,
 * edge hairlines only).
 *
 * IT MUST STAY INLINE. An `<img src>` would cut currentColor, and this mark
 * recolours with the footer's ink token in all three theme states. It is sized
 * in `em` off the anchor's font-size, which is why that font-size rule
 * survived the cleanup in nav-unify.css even though font-weight and
 * letter-spacing did not.
 *
 * THE ACCESSIBLE NAME LIVES ON THE ANCHOR. The graphic is aria-hidden and the
 * <a> carries aria-label="QuoteFleet", so the link has exactly one accessible
 * name and no <title> tooltip that the text node it replaced never had. Keep
 * the two halves together — aria-hidden art with no label on the link would
 * leave the link nameless.
 *
 * Design size is 1em = 100 units: viewBox `0 -97 517.3 122` is the face's own
 * ascender/descender box, so 1.22em tall is exactly the content box a 15px
 * text run in Instrument Sans would have occupied.
 */
export const FOOTER_WORDMARK_SVG = `<svg class="qf-footer-wordmark-svg" viewBox="0 -97 517.3 122" width="5.173em" height="1.22em" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path transform="translate(0,0)" d="M52.90-5L40.30 1Q29.40 1 21.15-3.75Q12.90-8.50 8.30-16.90Q3.70-25.30 3.70-36.30Q3.70-47.20 8.30-55.45Q12.90-63.70 21.05-68.35Q29.20-73 39.60-73Q50.20-73 58.35-68.35Q66.50-63.70 71.10-55.40Q75.70-47.10 75.70-36.20Q75.70-28.90 73.30-22.45Q70.90-16 65.90-11.50Q60.90-7 52.90-5M39.60-9.10Q46.40-9.10 51.55-12.45Q56.70-15.80 59.60-22Q62.50-28.20 62.50-36.40Q62.50-44.20 59.65-50.05Q56.80-55.90 51.65-59.15Q46.50-62.40 39.60-62.40Q32.80-62.40 27.65-59.15Q22.50-55.90 19.70-50.10Q16.90-44.30 16.90-36.40Q16.90-28.10 19.75-21.95Q22.60-15.80 27.75-12.45Q32.90-9.10 39.60-9.10M40.30 1L39.70-8L79.10-10.30L79.10 0Q72.80 0 68.05 0.15Q63.30 0.30 59.15 0.50Q55 0.70 50.50 0.85Q46 1 40.30 1"/><path transform="translate(78.8,0)" d="M23.20 1Q17.90 1 14.05-1.25Q10.20-3.50 8.15-7.40Q6.10-11.30 6.10-16.20L6.10-51L18.70-51L18.70-18.80Q18.70-14.10 21.05-11.70Q23.40-9.30 27.70-9.30Q31.60-9.30 34.55-11.10Q37.50-12.90 39.25-16.15Q41-19.40 41-23.50L42.30-11.30Q39.80-5.70 34.85-2.35Q29.90 1 23.20 1M53.70 0L41.40 0L41.40-12L41-12L41-51L53.70-51"/><path transform="translate(136.9,0)" d="M29.90 1Q21.80 1 15.65-2.40Q9.50-5.80 6.10-11.85Q2.70-17.90 2.70-25.70Q2.70-33.50 6.10-39.40Q9.50-45.30 15.65-48.65Q21.80-52 29.90-52Q38.10-52 44.20-48.65Q50.30-45.30 53.70-39.40Q57.10-33.50 57.10-25.70Q57.10-17.90 53.65-11.85Q50.20-5.80 44.10-2.40Q38 1 29.90 1M29.90-9.10Q33.90-9.10 37.10-11.15Q40.30-13.20 42.10-16.95Q43.90-20.70 43.90-25.80Q43.90-33.30 39.95-37.60Q36-41.90 29.90-41.90Q23.80-41.90 19.80-37.60Q15.80-33.30 15.80-25.80Q15.80-20.70 17.65-16.95Q19.50-13.20 22.65-11.15Q25.80-9.10 29.90-9.10"/><path transform="translate(193.4,0)" d="M29.60 1Q20.20 1 15.75-3.45Q11.30-7.90 11.30-16.80L11.30-62.60L24-67.30L24-16.50Q24-12.80 26-11Q28-9.20 32.30-9.20Q34-9.20 35.35-9.45Q36.70-9.70 37.90-10.10L37.90-0.30Q36.70 0.30 34.50 0.65Q32.30 1 29.60 1M37.90-41.10L1.50-41.10L1.50-51L37.90-51"/><path transform="translate(230.4,0)" d="M29.60 1Q21.50 1 15.45-2.40Q9.40-5.80 6.05-11.80Q2.70-17.80 2.70-25.60Q2.70-33.40 6.05-39.35Q9.40-45.30 15.40-48.65Q21.40-52 29.40-52Q37-52 42.60-48.85Q48.20-45.70 51.30-40Q54.40-34.30 54.40-26.70Q54.40-25.30 54.30-24.10Q54.20-22.90 54-21.70L10.50-21.70L10.50-30.50L44.30-30.50L41.70-28.10Q41.70-35.30 38.40-38.90Q35.10-42.50 29.20-42.50Q22.80-42.50 19.05-38.10Q15.30-33.70 15.30-25.40Q15.30-17.20 19.05-12.85Q22.80-8.50 29.70-8.50Q33.70-8.50 36.70-10Q39.70-11.50 41.10-14.60L53-14.60Q50.50-7.40 44.55-3.20Q38.60 1 29.60 1"/><path transform="translate(285.5,0)" d="M19.20 0L6.20 0L6.20-72L19.20-72L19.20 0M52.90-28.90L12.40-28.90L12.40-39.20L52.90-39.20L52.90-28.90M55.30-61.70L12.40-61.70L12.40-72L55.30-72"/><path transform="translate(342.9,0)" d="M19.30 0L6.70 0L6.70-72L19.30-72"/><path transform="translate(366.9,0)" d="M29.60 1Q21.50 1 15.45-2.40Q9.40-5.80 6.05-11.80Q2.70-17.80 2.70-25.60Q2.70-33.40 6.05-39.35Q9.40-45.30 15.40-48.65Q21.40-52 29.40-52Q37-52 42.60-48.85Q48.20-45.70 51.30-40Q54.40-34.30 54.40-26.70Q54.40-25.30 54.30-24.10Q54.20-22.90 54-21.70L10.50-21.70L10.50-30.50L44.30-30.50L41.70-28.10Q41.70-35.30 38.40-38.90Q35.10-42.50 29.20-42.50Q22.80-42.50 19.05-38.10Q15.30-33.70 15.30-25.40Q15.30-17.20 19.05-12.85Q22.80-8.50 29.70-8.50Q33.70-8.50 36.70-10Q39.70-11.50 41.10-14.60L53-14.60Q50.50-7.40 44.55-3.20Q38.60 1 29.60 1"/><path transform="translate(422.7,0)" d="M29.60 1Q21.50 1 15.45-2.40Q9.40-5.80 6.05-11.80Q2.70-17.80 2.70-25.60Q2.70-33.40 6.05-39.35Q9.40-45.30 15.40-48.65Q21.40-52 29.40-52Q37-52 42.60-48.85Q48.20-45.70 51.30-40Q54.40-34.30 54.40-26.70Q54.40-25.30 54.30-24.10Q54.20-22.90 54-21.70L10.50-21.70L10.50-30.50L44.30-30.50L41.70-28.10Q41.70-35.30 38.40-38.90Q35.10-42.50 29.20-42.50Q22.80-42.50 19.05-38.10Q15.30-33.70 15.30-25.40Q15.30-17.20 19.05-12.85Q22.80-8.50 29.70-8.50Q33.70-8.50 36.70-10Q39.70-11.50 41.10-14.60L53-14.60Q50.50-7.40 44.55-3.20Q38.60 1 29.60 1"/><path transform="translate(476.7,0)" d="M29.60 1Q20.20 1 15.75-3.45Q11.30-7.90 11.30-16.80L11.30-62.60L24-67.30L24-16.50Q24-12.80 26-11Q28-9.20 32.30-9.20Q34-9.20 35.35-9.45Q36.70-9.70 37.90-10.10L37.90-0.30Q36.70 0.30 34.50 0.65Q32.30 1 29.60 1M37.90-41.10L1.50-41.10L1.50-51L37.90-51"/></g></svg>`;

export const PREMIUM_FOOTER = `<footer class="premium-footer"><div class="premium-footer-inner" data-cols="${FOOTER_LADDER.columns}"${FOOTER_LADDER.phoneSpansLast ? ' data-cols-odd' : ''}><div class="footer-brand"><a href="/" class="qf-footer-brand" aria-label="QuoteFleet home"><img class="qf-footer-logo" src="/brand/logo-full-ondark.png" data-logo-fixed alt="QuoteFleet — freight rate calculator" width="168" height="113" decoding="async"></a><div class="qf-footer-brandtext"><a href="/" class="qf-footer-wordmark" aria-label="QuoteFleet">${FOOTER_WORDMARK_SVG}</a><p class="qf-footer-tagline">Branded rate calculator pages, PDF quotes, and optional AI chat for trucking service providers.</p></div></div>${FOOTER_COLUMNS_HTML}</div>${footerBottomHtml({ marksNote: true })}</footer>`;

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
//
// ── FOOTER_DISCLOSURE_SYNC ──────────────────────────────────────────────────
// The last IIFE in the script below collapses the footer's link columns on
// phones, and only there.
//
// DIRECTION MATTERS. The columns ship `open` in the markup
// (footerDisclosureColumn), so a visitor with no JS gets exactly the footer the
// site has always had — every column expanded, every internal link visible.
// The script closes them below the 640px step, where the stacked link wall was
// measuring taller than the viewport (1686px of footer at 375px on a marketing
// page), and re-opens them on the way back up.
//
// ONLY UNTOUCHED COLUMNS ARE SYNCED. Once a visitor has opened or closed a
// column themselves, `data-qf-user` pins it and a resize stops overruling them:
// rotating a phone must not slam shut the column someone just opened.
//
// THE OVERRIDE IS DETECTED BY COMPARISON, NOT BY A FLAG. `toggle` fires for our
// OWN writes as well, and asynchronously — a "we are syncing" boolean would
// already be false by the time the event arrived. So a state that DIFFERS from
// the breakpoint default is an override and a state that MATCHES it is not,
// which also means closing and reopening a column hands control back.
//
// THE RATIONALE LIVES HERE, NOT IN THE SCRIPT. This constant is interpolated
// into every full-chrome page on the site, so a comment inside the template
// literal ships on every request — and a carrier profile asserts its tenant id
// never appears anywhere in the page, which an explanatory number in a shipped
// comment can trip by coincidence. It did: "42-link stack" against
// claimed_tenant_id 42 (carrierProfileCard.test.ts).
//
// ── THE DRAWER CONTROLLER, AND THE FOUR THINGS IT HAS TO GET RIGHT ─────────
//
// 1. THE SCROLL LOCK PINS THE BODY, AND THE HEADER WITH IT. Neither cheap
//    lock survives this document — `html,body{height:100%}` is site-wide and
//    the homepage additionally puts `overflow-y:auto` on body, so `overflow:
//    hidden` on either one clamps scrollY to 0 on / (measured: 900 -> 0 on
//    open) and does not lock /directory at all (measured: 328 -> 728 on a
//    wheel). The body is therefore taken out of the scrollport at its current
//    offset, which is the only version that keeps an identical picture; see
//    the WAVE 6 note in nav-unify.css for the numbers. A pinned body renders
//    the sticky header at `-lockY`, i.e. off screen with the burger on it, so
//    the header is pinned too — by INLINE `!important` properties rather than
//    a rule, because nav-ia.css restates the homepage header at (0,4,2) with
//    `position: sticky !important` and is injected last; an inline important
//    is the one thing that outranks it without an id this element cannot
//    carry. --qf-lock-pad (the body's own top padding plus the header's
//    height) puts back the flow the pinned header takes away, and --qf-sbw
//    (measured before the lock, while documentElement.clientWidth still
//    excludes it) puts back the scrollbar's width. `scrollTo(0, lockY)` on
//    release is the half iOS needs.
//
// 2. THE ENTRANCE NEEDS A REFLOW, NOT TWO FRAMES. `hidden` comes off first so
//    the panel resolves in its "from" state, and `data-state="open"` is set
//    immediately after one forced reflow: set in the same tick with nothing
//    between them, the browser coalesces both into a single style resolution
//    and the transition never runs. This used to be two chained
//    requestAnimationFrames, and those two frames of nothing were the largest
//    part of the gap between the tap and the first painted change.
//
//    THE CLICK FRAME IS FOR WRITES ONLY, which is the other half. open() read
//    the bar's height AFTER writing two custom properties onto the root, and a
//    custom property on the root invalidates style for the whole inheriting
//    tree — so that read was a full style recalculation plus a layout of a
//    6,367px document, in front of the first frame. It also called stops(),
//    which runs getClientRects() over every focusable in the panel, and then
//    .focus(). The reads are now batched ahead of the first write and the
//    focus is deferred by one frame.
//
//    MEASURED, /tools/oversize-permits at 375px, 8 runs, median. Tap to first
//    painted change: 46.0ms -> 23.8ms unthrottled, 234.2ms -> 155.3ms at 6x
//    CPU. Tap to fully open: 321.1ms -> 302.9ms unthrottled against a declared
//    300ms, 509.2ms -> 422.0ms at 6x. The close path was already clean and is
//    unchanged within noise: 204.5ms -> 203.7ms against a declared 200ms. What
//    is left unthrottled is under two frames — one to commit the style change,
//    and a transition's first interpolated value does not differ from its
//    start value until the frame after that — so it is the floor, not slack.
//
//    The exit is the mirror — the attribute comes off immediately and `hidden`
//    goes back on only after the exit duration, which is also when the lock is
//    released, so nothing can scroll underneath a panel still on screen.
//
// 3. REDUCED MOTION SHORTENS THE TIMER, NOT JUST THE CSS. The CSS kills the
//    transition; if the script still waited 200ms for it, the panel would sit
//    invisible-but-present for a fifth of a second after every close. Same
//    media query, read here.
//
// 4. THE TRAP INCLUDES THE BUTTON. Focus moves to the first item on open and
//    cycles burger -> first ... last -> burger, because the burger IS the
//    close control and it lives outside the panel; a trap that excluded it
//    would strand a keyboard visitor with no way to close what they opened.
//    Escape and a scrim click both close and hand focus back; following a link
//    closes WITHOUT taking focus, since the page is navigating away.
export const HEADER_SCRIPTS = `<script>
  (function () {
    var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
    var b = document.getElementById('site-burger');
    var m = document.getElementById('site-mobile-menu');
    var sc = document.getElementById('site-menu-scrim');
    if (b && m) {
      var root = document.documentElement;
      var bar = document.querySelector('.site-header');
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
      var wide = window.matchMedia('(min-width: 1024px)');
      var lockY = 0, basePad = 0, closeTimer = null, isOpen = false;
      var EXIT_MS = 200;
      var can = function (el) { return el.getClientRects().length > 0 && !el.closest('[inert]'); };
      var stops = function () {
        return Array.prototype.filter.call(
          m.querySelectorAll('a[href], summary, button:not([disabled])'), can);
      };
      var PIN = [['position', 'fixed'], ['top', '0px'], ['left', '0px'], ['z-index', '2147483004']];
      var pinBar = function (on) {
        if (!bar) return;
        if (on) {
          for (var i = 0; i < PIN.length; i++) bar.style.setProperty(PIN[i][0], PIN[i][1], 'important');
          bar.style.setProperty('right', root.style.getPropertyValue('--qf-sbw') || '0px', 'important');
        } else {
          for (var j = 0; j < PIN.length; j++) bar.style.removeProperty(PIN[j][0]);
          bar.style.removeProperty('right');
        }
      };
      /* Takes the bar's height as an ARGUMENT so open() can read it inside its
         own read batch; falls back to reading it for the resize handler, where
         nothing has been written yet either. */
      var measure = function (h) {
        if (h == null) h = bar ? bar.offsetHeight : 0;
        root.style.setProperty('--qf-menu-top', Math.max(0, Math.round(h)) + 'px');
        root.style.setProperty('--qf-lock-pad', Math.round(basePad + h) + 'px');
      };
      var open = function () {
        if (isOpen) return;
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        /* READ BATCH — every measurement this function needs, taken before the
           first write. --qf-lock-y and --qf-sbw are custom properties on the
           ROOT, and a custom property on the root invalidates style for every
           element that could inherit it: the whole document. A read after one
           of those writes is therefore not a cheap read, it is a full style
           recalculation plus layout of a page that runs to 6,367px. That is
           what measure() used to do one line later. (No backticks in here:
           this whole controller is a template literal.) */
        lockY = window.scrollY || window.pageYOffset || 0;
        basePad = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
        var sbw = window.innerWidth - root.clientWidth;
        var barH = bar ? bar.offsetHeight : 0;
        /* WRITE BATCH — no reads from here to the end of the frame. */
        root.style.setProperty('--qf-sbw', sbw + 'px');
        root.style.setProperty('--qf-lock-y', Math.round(lockY) + 'px');
        measure(barH);
        isOpen = true;
        if (sc) sc.removeAttribute('hidden');
        m.removeAttribute('hidden');
        pinBar(true);
        root.setAttribute('data-qf-menu', 'open');
        b.setAttribute('aria-expanded', 'true');
        b.setAttribute('aria-label', 'Close menu');
        /* ONE FLUSH, NOT TWO FRAMES. The entrance still needs the panel's
           "from" style resolved before the "to" style is set, or the browser
           coalesces both into one style resolution and the transition never
           runs. That used to be bought with a double requestAnimationFrame —
           two frames in which nothing at all happens, and the largest single
           slice of the gap between the tap and the first painted change. One
           forced reflow buys the same guarantee in the same frame.

           IT IS A LAYOUT READ, NOT A STYLE READ, AND THAT WAS MEASURED.
           getComputedStyle(m).opacity is cheaper and resolves style, but the
           panel was display:none one statement earlier and Chrome would not
           start the transition off it until the box had actually been laid
           out — the animation began a frame late. Over 8 runs on
           /tools/oversize-permits at 375px: offsetWidth 28.4ms dead / 298.6ms
           open, getComputedStyle 30.3 / 306.1, against a declared 300ms (both
           measured on the same build, one after the other). The
           layout is not extra work either; it is the layout the browser has to
           do before it can paint the panel at all, pulled forward. */
        void m.offsetWidth;
        m.setAttribute('data-state', 'open');
        if (sc) sc.setAttribute('data-state', 'open');
        /* FOCUS IS THE EXPENSIVE PART, AND IT IS NOT URGENT. stops() calls
           getClientRects() on every candidate in the panel — a forced layout
           of the document that has just been re-laid-out by the lock — and
           .focus() can add a scroll-into-view on top. On the click frame that
           lands entirely in front of the first painted frame; one frame later
           it is free, and no keyboard visitor can perceive 16ms. */
        var giveFocus = function () {
          if (!isOpen) return;
          var f = stops();
          if (f.length) f[0].focus(); else m.focus();
        };
        if (window.requestAnimationFrame) requestAnimationFrame(giveFocus); else giveFocus();
      };
      var close = function (giveBackFocus) {
        if (!isOpen) return;
        isOpen = false;
        m.removeAttribute('data-state');
        if (sc) sc.removeAttribute('data-state');
        b.setAttribute('aria-expanded', 'false');
        b.setAttribute('aria-label', 'Open menu');
        if (giveBackFocus !== false) b.focus();
        var settle = function () {
          closeTimer = null;
          if (isOpen) return;
          m.setAttribute('hidden', '');
          if (sc) sc.setAttribute('hidden', '');
          pinBar(false);
          root.removeAttribute('data-qf-menu');
          root.style.removeProperty('--qf-sbw');
          root.style.removeProperty('--qf-menu-top');
          root.style.removeProperty('--qf-lock-y');
          root.style.removeProperty('--qf-lock-pad');
          /* Same synchronous block as the unpin, so the frame the browser
             paints already has the page back at its old offset. */
          if ((window.scrollY || window.pageYOffset || 0) !== lockY) window.scrollTo(0, lockY);
        };
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(settle, reduce.matches ? 0 : EXIT_MS);
      };
      b.addEventListener('click', function (e) { e.stopPropagation(); if (isOpen) close(); else open(); });
      m.addEventListener('click', function (e) { if (e.target.closest('a')) close(false); });
      if (sc) sc.addEventListener('click', function () { close(); });
      document.addEventListener('click', function (e) {
        if (isOpen && !m.contains(e.target) && !b.contains(e.target)) close(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen) { e.preventDefault(); close(); }
      });
      m.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        var f = stops();
        if (!f.length) return;
        var at = document.activeElement;
        if (e.shiftKey ? at === f[0] : at === f[f.length - 1]) { e.preventDefault(); b.focus(); }
      });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab' || !isOpen) return;
        var f = stops();
        if (!f.length) return;
        e.preventDefault();
        (e.shiftKey ? f[f.length - 1] : f[0]).focus();
      });
      window.addEventListener('resize', function () {
        if (!isOpen) return;
        if (wide.matches) close(false); else measure();
      });

      /* ── THE FOLD CONTROLLER ────────────────────────────────────────────
         A <details> cannot be animated on its own: with the attribute off the
         browser does not render the content at all, so there is nothing to
         transition FROM. The element stays a <details> — that is the whole
         no-JS story, and nav-nojs.css depends on it — and the script simply
         holds the open attribute on for the length of the exit so the
         collapse can be seen. The movement itself is CSS: .mm-fold animates
         grid-template-rows 0fr -> 1fr, which resolves to the content's
         intrinsic height, so a group of two rows and a group of nine both
         land exactly on their own height with no max-height guess.

         inert goes on while it collapses. For those 200ms the rows are
         zero-height but still laid out (they are clipped, not removed), so
         without it Tab would stop on a link nobody can see — and can()
         above skips anything inside an inert subtree for the same reason.

         ── IF YOU ARE HERE TO MEASURE THIS MENU, READ THIS FIRST ──────────
         SETTING details.open = true FROM SCRIPT DOES NOT OPEN THE FOLD. The
         <details> element is only the no-JS shell; the animated body is
         .mm-fold, and its open state is the data-fold attribute, which
         NOTHING but the summary click handler below ever writes. Set .open
         and the fold stays at literally 0px for ever — with its rows present,
         laid out and clipped to nothing. That is the trap, because the links
         are all still in the DOM with boxes, so a script that walks them gets
         numbers rather than an error: a contrast audit driven this way read a
         perfect ~1.0 on every row in the menu, because it was sampling a
         zero-height strip of the panel's own background against itself.
         Drive a REAL click on the <summary> and wait out --qf-menu-dur-out.
         The same warning, with the line-box version of it, is at the top of
         tests/e2e/mobile-drawer.spec.ts. */
      var folds = Array.prototype.slice.call(m.querySelectorAll('.mm-group'));
      /* The flag the collapsed state is gated on. Set HERE, by the controller
         that owns data-fold, so a group can never be collapsed by CSS that
         nothing is able to expand again. */
      if (folds.length) m.setAttribute('data-fold-js', '');
      folds.forEach(function (g) {
        var sum = g.querySelector('summary');
        var fold = g.querySelector('.mm-fold');
        if (!sum || !fold) return;
        var timer = null;
        sum.addEventListener('click', function (e) {
          e.preventDefault();
          if (timer) { clearTimeout(timer); timer = null; }
          if (g.open && fold.getAttribute('data-fold') === 'open') {
            fold.removeAttribute('data-fold');
            fold.setAttribute('inert', '');
            timer = setTimeout(function () {
              timer = null;
              g.open = false;
              fold.removeAttribute('inert');
            }, reduce.matches ? 0 : EXIT_MS);
          } else {
            g.open = true;
            fold.removeAttribute('inert');
            var show = function () { fold.setAttribute('data-fold', 'open'); };
            if (reduce.matches || !window.requestAnimationFrame) show();
            else requestAnimationFrame(function () { requestAnimationFrame(show); });
          }
        });
      });
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
  /* Footer disclosures — see FOOTER_DISCLOSURE_SYNC note in siteChrome.ts. */
  (function () {
    var cols = Array.prototype.slice.call(document.querySelectorAll('.qf-fdisc'));
    if (!cols.length) return;
    var root = document.documentElement;
    var phone = window.matchMedia('(max-width: 640px)');
    cols.forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (d.open === !phone.matches) d.removeAttribute('data-qf-user');
        else d.setAttribute('data-qf-user', '1');
      });
    });
    function sync() {
      cols.forEach(function (d) {
        if (d.hasAttribute('data-qf-user')) return;
        d.open = !phone.matches;
      });
    }
    /* THE FIRST SYNC MUST NOT ANIMATE. The columns ship open and this closes
       them on phones, so with the open/close transition live the footer would
       play a collapse the moment the page finished parsing and shove the legal
       block up behind it. The flag suppresses the transition for that one pass
       and is dropped on the frame after, so every LATER toggle — a tap, a
       keypress, a rotation — animates. With JS off the flag is never set, so
       the CSS animates on its own and the disclosures still work. */
    root.setAttribute('data-fdisc-boot', '');
    sync();
    function unboot() { root.removeAttribute('data-fdisc-boot'); }
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(unboot); });
    else unboot();
    if (phone.addEventListener) phone.addEventListener('change', sync);
    else if (phone.addListener) phone.addListener(sync);
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
  // (The slots are counted exactly above, so these two are already aimed.)
  let out = html.replace(SITE_HEADER_SLOT, () => header);
  if (wantsFooter) out = out.replace(SITE_FOOTER_SLOT, () => PREMIUM_FOOTER);

  if (variant === 'full') {
    // `countLiveOccurrences`, not `.includes`: a nav-unify.css mentioned inside
    // one of these pages' long explanatory head comments is not a loaded
    // stylesheet, and treating it as one would skip the injection and ship the
    // page unstyled. Same reason `injectBeforeClosingTag` replaces the old
    // `.replace('</head>', …)` — see htmlInject.ts for the measured defect.
    if (countLiveOccurrences(out, NAV_UNIFY_CSS) === 0) {
      out = injectBeforeClosingTag(
        out, 'head', `  <link rel="stylesheet" href="${NAV_UNIFY_CSS}">\n`,
        { label, expect: NAV_UNIFY_CSS },
      );
    }
    out = injectBeforeClosingTag(out, 'body', `${HEADER_SCRIPTS}\n`, { label });
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
    if (tags) out = injectBeforeClosingTag(out, 'body', `${tags}\n`, { label });
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
    let rendered: string;
    try {
      rendered = applySiteChrome(html, {
        variant: page.variant,
        label: page.file,
        authLink: { href: '/login', label: 'Sign in' },
      });
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    // POST-CONDITION, not just "it did not throw".
    //
    // This audit used to call applySiteChrome and check nothing about what came
    // back, which is how both of the page's stylesheets went missing without a
    // single failure: the injection had landed inside an HTML comment, so the
    // document still CONTAINED the link and a `.includes` check would have
    // passed too. `liveInSectionProblem` asks the two questions that matter —
    // is it real markup, and is it in the right section — over the artifact a
    // visitor actually receives. See htmlInject.ts for the full defect.
    if (page.variant === 'full') {
      const bad = liveInSectionProblem(rendered, NAV_UNIFY_CSS, 'head', page.file);
      if (bad) problems.push(bad);
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

/**
 * THE DIRECTORY FOOTER'S BRAND LOCKUP.
 *
 * PREMIUM_FOOTER opens with a logo + wordmark + tagline; `.dirfoot` opened with
 * nothing at all, so the directory subsite — the ~334k-page half of the site —
 * shipped a footer with ZERO images and no mark of ours anywhere in it. This is
 * the same lockup on one row, without the tagline: the directory footer is the
 * SHORT one, and a marketing sentence is not what it was missing.
 *
 * NO `data-logo-fixed` HERE, and that is the whole difference from the
 * marketing copy. The marketing band is `--footer-bg` = `--surface-dark`,
 * declared once at :root and never re-declared per theme, so its ground is
 * theme-invariant and its logo must NOT follow the theme. `.site-footer` paints
 * `--surface-2`, which IS themed — near-white in light mode — so the
 * white-outline `-ondark` truck would be a light mark on a light ground there.
 * Leaving the attribute off lets theme-toggle.js#swapLogos do exactly what it
 * was written for, the same way the directory's own header mark already does.
 *
 * THE WORD IS A TEXT NODE, NOT FOOTER_WORDMARK_SVG, and that is a directory
 * decision rather than a shortcut. Three reasons, in order of weight:
 *
 *   • IT IS THE PATTERN THIS SUBSITE ALREADY USES. The directory HEADER sets
 *     "QuoteFleet" as a text node beside `mark-keys-ondark.png` (see the
 *     `.site-brand` anchor in directory/pages.ts#layout). A footer lockup that
 *     drew the word as baked outlines would put two different renderings of the
 *     same word on the same page.
 *   • BYTES, ON THE ONE SURFACE WHERE BYTES ARE THE BINDING CONSTRAINT. The
 *     outline set is ~1.0 KB of path data per page. DIRECTORY_CSS was pulled
 *     out into a hashed external file specifically because per-page boilerplate
 *     was costing ~22 GB of Googlebot's crawl of the ~330k carrier profiles;
 *     adding a kilobyte of un-cacheable inline markup back to every one of them
 *     would spend a slice of exactly the budget that change bought.
 *   • IT DOES NOT COLLIDE WITH A PROFILE-PAGE SAFETY TEST.
 *     carrierProfileCard.test.ts asserts a claimed profile's tenant id (42 in
 *     the fixture) appears NOWHERE in the rendered page. The wordmark's glyph
 *     transforms include `translate(422.7,0)`, so shipping it in directory
 *     chrome makes a real leak check unfalsifiable on every profile. Keep the
 *     text node; do not "upgrade" this to the outline asset.
 */
export const DIRECTORY_FOOTER_BRAND =
  `<div class="dirfoot-brandrow">`
  + `<a class="dirfoot-brand" href="/" aria-label="QuoteFleet home">`
  + `<img class="dirfoot-logo" src="/brand/logo-full-ondark.png" alt="QuoteFleet — freight rate calculator" width="168" height="113" decoding="async">`
  + `<span class="dirfoot-wordmark">QuoteFleet</span></a></div>`;
