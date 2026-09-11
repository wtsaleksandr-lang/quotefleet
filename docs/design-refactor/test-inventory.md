# Visual-identity test inventory

Contract for the QuoteFleet design refactor. Every test below asserts on class
names, CSS strings, hex colors, fonts or radii, so the redesign will touch it.

Target design system: white/slate surfaces, brand accent **blue-600 `#2563EB`**,
Inter + JetBrains Mono, radii **6 / 10 / 16 / 24 / 9999**, 1240px max container,
defined shadow ramp.

## Buckets

- **RULE** — encodes a durable design/product rule that must SURVIVE the
  redesign (no-gradient, contrast/a11y, widget style isolation, sticky header,
  no-home-address, IA/semantics, honesty copy). These tests **stay**; only their
  expected token values change if the token changes.
- **VALUE** — asserts a specific current hex / radius / font / class that the
  redesign intentionally changes. **Update** when the relevant wave lands.
- **STALE** — pins something already superseded, or a one-off migration check
  that no longer protects anything. **Candidate for deletion** (not deleted here).

**Counts: 45 RULE · 17 VALUE · 15 STALE (77 files).**

## RULE — must survive the redesign

| file | what it asserts | what must change when the redesign lands |
| --- | --- | --- |
| `src/server/directory/mobileFilterUx.test.ts` | Source order head→rail→results, `aria-pressed` toggles, partial-render contract, sticky action-bar collapse, scroll-to-toolbar | Only the literal CSS strings (grid gap, paddings, `.dir-rail` sticky decl) re-pin to the new spacing scale |
| `src/server/color/contrast.test.ts` | WCAG contrast math plus a design-token pair table (`#2563eb` CTA, `#0D3CFC`, `#161616`, `#6E8BFF`) meeting AA/AA-large | Swap the pair table's hexes for the new white/slate + blue-600 values; the pass/level rule is untouched |
| `src/server/directory/actionBar.test.ts` | `?dots=` link builder, per-card `cc-cb` checkbox is non-navigating, one results-toolbar holds sort+count+chips, RFQ cap copy | `qf-actionbar` / `applied-chip` class names only if renamed |
| `src/server/navInformationArchitecture.test.ts` | IA invariants: three dropdowns + Pricing, no duplicate href/label, no footer row with a single column 320–1600px, one 1024px collapse, nowrap triggers | Compaction-band pixel literals (gap/padding/`font-size: 13px`) and the container width → 1240px |
| `src/server/customizePanel.test.ts` | Brand PUT schema/migrations, control mounting, **token-only** styling (`var(--w-accent)`, `var(--radius-btn)`, `var(--accent-fill)`), carousel/sheet behaviour | A few literal CSS strings (`padding-top: 60px`, `border-bottom: 1px solid var(--border)`) |
| `src/server/directory/importerUiRound3.test.ts` | Importer search structure: in-field captions, sort orders, chips, keyboard chart nav, bar length = true share | Pinned CSS literals (`padding: 21px 12px 7px`, `.imp-foot` grid-template-columns) |
| `src/server/hostedPage.test.ts` | Hosted wrap always iframes the calculator, bare single-column unless ≥2 supporting blocks, escapes copy, badge row retired, normaliser caps | Nothing token-level; `qf-hp-*` class names only if markup is renamed |
| `src/server/directory/claimPage.test.ts` | Claim flow copy/structure: free-forever hero, left-aligned `hero dir-hero`, 3-step stepper, upsell twice, noindex, no emoji | Class names only if hero/stepper markup is restructured |
| `src/server/directory/carrierProfileTabs.test.ts` | Four-tab radio scaffold, all panels in HTML for SEO, cargo chips, ZIP + FMCSA freshness line, single gated block | `cp-tab-*` / `cp-badge--cargo` names only if renamed |
| `src/server/onboardingWizard.test.ts` | Wizard IA: 4 steps, **no brand-color step**, no `qf-ob-swatch`, **no-home-address** (`me.email`/`contactEmail`), outline+tint selection, left-aligned hints | Nothing structural; `.qf-ob-*` names only if renamed |
| `src/server/routes/osowPermits.test.ts` | **No raw hex** in page CSS (tokens only), no `overflow: hidden`, outline pills via `--accent-soft` not `--accent-fill`, even grids / no-orphan, 2px stacks, label-inside-field, canonical chrome | Only if `--accent-soft`/`--accent-fill` token names or the 2px gap scale change |
| `src/server/routes/heavyHaulQuote.test.ts` | Honesty + layout rules: token-only CSS, `overflow: clip` not hidden, outline pills `border-width: 2px` + `--accent-soft`, 2px stacks, even column grids, OOG CTA hidden below 1140px | The 1140px breakpoint and 2px gaps if the 1240px container shifts them |
| `src/server/directory/carrierProfileBadges.test.ts` | Badge semantics/a11y: `cp-badge--hazmat/safety-good/claim` tones, tooltips, `tabindex="0"`, `role="note"`, `aria-label`, no-orphan `data-n` groups (1–6), monogram initials | Only if `cp-badge--*` tone names are renamed; badge colors change without touching this file |
| `src/server/outreach/prospectDemo.test.ts` | Prospect brand-color confidence logic and widget config shape. Hexes (`#ff5a1f`, `#32373c`, `#0477b5`) are **tenant** brand fixtures, not QuoteFleet chrome | Nothing — tenant brand accents are independent of our design system |
| `src/server/directory/partialResponse.e2e.test.ts` | Wire contract for `X-QF-Partial`: body is only `<div class="dir-layout" data-qf-partial="1">`, no `<html>`/`dir-hero`/`<script>`, cache-control + `Vary` | Nothing, unless `.dir-layout`/`dir-hero`/`dir-rail` are renamed |
| `src/server/routes/seasonalRestrictions.test.ts` | Honesty copy plus house UI rules: token-only CSS in `.sr-shell`, left-aligned hero above H1, 760px single-column collapse, transparent outline `.sr-pill` | `.sr-hero h1 { font-size: 40px }` and the 48px hero padding under the new type/space scale |
| `src/server/directory/carrierProfileRfqButton.test.ts` | Profile has a primary RFQ CTA `href="/directory/rfq?dots=<usdot>"` inside `.cp-headcta` before `.qf-save`, and no broken link without USDOT | Only the literal `class="btn btn-primary btn-sm cp-rfq-btn"` string |
| `src/server/directory/carrierCredentialsProfile.test.ts` | Insurance-filing honesty copy, no "Not on file", outline `cp-badge--fact` chips, orphan-safe `cp-chiprow`/`cp-datagrid--auto`, 1600-byte crawl budget | Class names if renamed; the byte budget may need raising if new tokens inflate markup |
| `src/server/leadsExportAndTableReflow.test.ts` | Export CSV link to `/api/tenant/leads/export.csv`, leads-length guard, `data-label` cells, ≤480px `.qf-leads-table tbody td::before` card reflow | Class names only if the reflow hooks are renamed |
| `src/server/directory/importerUiRound4.test.ts` | Scope/honesty copy, URL-shareable search, `impp-tabswrap[data-scroll]` affordance, sortable `data-sort` headers, dayKey, `.imp-actions` no-orphan grid rules | Selector strings if actions/tabs markup is restructured; the `:has()` orphan rules need re-deriving |
| `src/server/directory/importerUiRound2.test.ts` | Port→facet CTA logic, alias counts, **audience switcher selects with `color-mix(var(--accent) 12%)` tint, not a bright fill**, 2×2 phone grid | The exact `color-mix(... 12%, transparent)` string if the selected-state recipe changes under blue-600 |
| `src/server/directory/importerProfile.test.ts` | Aggregation, quota gate, cache-hit $0 path, free phone/address vs paid email reveal, `impp-lockcard`/`impp-reveal-result` markup | Nothing visual; only if lockcard ids/classes are renamed |
| `src/server/widgetStructure.test.ts` | Balanced divs, CTA/error/result inside `#qf-step-quote`, footers inside `#qf-root`, modals kept body-level, `role="alert"` + `aria-live` on error slots | Nothing — pure structure/a11y invariants |
| `src/server/navAuthGating.test.ts` | Personal links ship `data-nav-auth="user" hidden`, capabilities ungated, server nav HTML auth-invariant for CDN cache, `a[hidden]{display:none!important}` | Only if nav markup is rebuilt; the `.nav-dd-panel a[hidden]` / `.site-mobile-menu a[hidden]` overrides must be carried forward |
| `src/server/leadsCallbacksPolish.test.ts` | Human status labels, **AA-safe `badge-progress` (never low-contrast `badge-warn`)**, aria-labels, polite toast region, `.qf-stack-cell` mobile stacking | The badge class set and the `html[data-theme="light"] .badge-progress` override if badges are retokenized |
| `src/server/directory/directoryJoin.test.ts` | Join-flow states (anon form, subscribe, manage), $19/mo copy, `esc()` escaping, `dir-upgrade-banner--ok/--info`, single "For Shippers" in header | Banner class names if restyled |
| `src/server/widgetTerminalSearch.test.ts` | Terminal selector stays searchable/accessible: `aria-autocomplete`, "No matching terminal found" empty state, asset mounted in `widget.html` | The "Phase BE" comment and `.qf-terminal-*` names if renamed |
| `src/server/quoteActivityCard.test.ts` | Quote activity shows next-action labels and a timeline (`qf-activity-timeline`), plus a `@media (max-width: 700px)` breakpoint | Breakpoint value and `.qf-activity-*` names if renamed |
| `src/server/premiumSaasPolish.test.ts` | Dashboard keeps toast/modal/skeleton primitives: `.qf-toast-stack`, `.qf-modal-backdrop`, `.qf-page-skeleton`, `window.qfToast`/`qfConfirm` | The "Phase AF" banner string; class names if renamed |
| `src/server/bookingWave2a.test.ts` | Booking/deposit wiring, Stripe destination charge, plus dark-safe theming: book text via `--w-text`, success pair `--w-success-bg #dcfce7`, **forbids bare `var(--w-fg)` on `.qf-book-*`** | Only the literal fallback hex `#dcfce7` and the exact `.qf-book-deposit` declaration string |
| `src/server/widgetMapInteraction.test.ts` | Map perf/a11y invariants: rAF-throttled transforms, passive pointer listeners, no `preloadNeighbors`, `<button class="qf-map-expand" id="qf-map-open">` with aria-label | Only `.qf-map-expand` if the expand control is renamed |
| `src/server/publicCalculatorUx.test.ts` | Widget loads the UX stylesheet; CTA copy ("Fast estimate", "Calculate estimate") and `.qf-result-actions`/`.qf-mini-stepper` exist | Class names and the "Phase AE" CSS comment if the stylesheet is renamed or folded in |
| `src/server/portalAudit.test.ts` | Security/robustness locks: session revoke, clamping, escaping, clipboard fallback, skip link + focusable `#page-content` | Only the skip-link markup if the shell is rebuilt |
| `src/server/guidedOnboarding.test.ts` | Onboarding question panel exists with per-area keys and AI-training actions | `.qf-onboarding-*` names and the "Phase BI" marker if restyled |
| `src/server/directory/carrierProfileOverrideRender.test.ts` | Override prose escaped, self-declared capability flips to a solid badge but still reads "Self-declared", hidden contact suppressed | Only `cp-badge--*` names if directory markup is renamed |
| `src/server/dashboardTrustGaps.test.ts` | Canonical widget URL everywhere, billing portal/checkout wiring, nav count badges, credible demo profile, **no-teal brand guard** | `.qf-nav-badge` background token expectation, and the teal heuristic vs the new blue-600 demo palette |
| `src/server/footerPayRow.test.ts` | Honest-claims footer: exact payment marks, no false claims, monochrome inline SVG on `var(--ink)`, nowrap, 5-track source grid, no-orphan rule | Token names (`--ink`) and `.qf-paymarks`/`.qf-ds-list` grid selectors if footer markup changes |
| `src/server/ingestProvenanceUi.test.ts` | Email-provenance surfaces: From-line, ✉ badge conditional on source, trusted-sender DELETE wiring, **badge uses tokens not raw hex** | `--accent-soft`/`--accent` token names if the token set is renamed |

## VALUE — update to the new tokens when the wave lands

| file | what it asserts | what must change when the redesign lands |
| --- | --- | --- |
| `src/server/widgetThemes.test.ts` | Byte-exact preset tokens: Midnight `--w-accent: #0D3CFC`, page-bg `#13181A`, radius-card `8px`/`5px`/`16px`/`20px`, 12 presets, 8 fonts, Satoshi default | Update every pinned hex/radius/font default. The WCAG contrast loops and the token-contract list are RULE-grade and survive — consider splitting the file |
| `src/server/publicSmoke.test.ts` | Landing/dashboard asset wiring plus premium palette `--accent: #26D0B2`, `--bg: #0B1117`, globe `#0d3cfc`, `--glass-radius: 18px`, `rgba(255,255,255,0.60)` | Retire the teal premium-palette assertions; re-pin glass radius (18 → 16) and globe hex to blue-600 |
| `src/server/quotefleetColorSystem.test.ts` | `--qf-color-accent: #0D3CFC`, dark `--qf-color-bg: #181D1F`, `#22282A`, `#E4EDF1`, `#B1C5CE`, warm/neutral cards, "Phase BZ" marker | Rewrite to white/slate surfaces + `#2563EB`; drop the Phase BZ marker; keep the load-order assertions |
| `src/server/authBlueAccent.test.ts` | `--accent: #6E8BFF` on auth + public CSS, `--qf-wft-blue: #0D3CFC`, absence of teal `#5EEAD4`, "Phase BW/BX" markers | Replace the on-dark accent and cobalt hexes with the blue-600 palette; keep the WCAG-contrast intent as a rule |
| `src/server/quotefleetFontSystem.test.ts` | Satoshi as global sans (`/fonts/satoshi-400.woff2`), `--font-sans: 'Satoshi','Inter',…`, `--font-mono: 'DM Mono','JetBrains Mono'`, calculator-on-Inter, "Phase CA" | **Swap to Inter primary + JetBrains Mono**; drop the Satoshi woff2 and DM Mono assertions. The widget font-isolation check survives |
| `src/server/maerskRadiusSystem.test.ts` | Radii `--qf-maersk-radius-card: 8px`, `control: 6px`, `button: 4px`, app shell/card 8px, and `not.toContain('border-radius: 17px')` | **Retarget to the 6/10/16/24/9999 scale**; rename the Maersk/Phase BY token set; drop the 17px regression line |
| `src/server/publicPagesWefixtrades.test.ts` | Public skin hexes `--qf-wft-blue: #0D3CFC`, `#181D1F`, `#22282A`, `#E4EDF1`, `#B1C5CE`, "Phase BQ", plus `.price-card.featured`/`.support-card`/`.sec-shell` | Replace the dark hex set with the new light surface tokens; keep the skin-mounted-on-pricing/support/security check |
| `src/server/verticalPagesWefixtrades.test.ts` | Pins `public-pages-wefixtrades.css`, `qf-public-wft qf-vertical-wft`, "Phase BR", dark hexes `#181D1F`, `#22282A`, `#E4EDF1`, `#B1C5CE` | Replace dark hexes with white/slate tokens; the WeFixTrades skin names are likely retired entirely |
| `src/server/calculatorNoGradients.test.ts` | The **no-gradient rule** plus current fallbacks `#13181A`, `#1E2528`, `#E6E3E0`, `#D4CFC9`, accent `#0D3CFC`, "Phase CB", Stripe-preset gradient exception | Update all five hex fallbacks to white/slate + `#2563EB`; decide whether the Stripe gradient exception survives. The no-gradient assertion itself is RULE-grade |
| `src/server/freightPremiumTheme.test.ts` | Pins `freight-premium-theme.css` loading, "Phase AT", `--w-primary: #3b22f4`, `--w-accent: #9ee8ff`, `qf-brand-mark` fallback | Replace both hexes with the blue-600 token set; the phase comment and theme filename are likely superseded |
| `src/server/calculatorBrandPreview.test.ts` | `.qf-demo-brand-card`, `.qf-demo-logo-slot em`, `.qf-acc-chip.active`, "Phase BO", `grid-template-columns: repeat(3, minmax(0,1fr))` | Update class/comment strings and the grid rule if brand-preview markup is restyled |
| `src/server/rateCardSearch.test.ts` | `.qf-rate-searchbar`, `.qf-rate-search-hidden`, `.qf-rate-search-count` and the "Phase BA" CSS banner | Update class names / banner when the rates page is restyled |
| `src/server/premiumCalculatorUi.test.ts` | **Requires** `radial-gradient`, `.qf-widget::before/::after`, `.qf-result::before` decorative layers and a "Phase BJ" banner | **Directly contradicts `calculatorNoGradients` under the new system** — the redesign bans calculator gradients, so these assertions must be removed or inverted |
| `src/server/accessorialSearch.test.ts` | `.qf-accessorial-searchbar`, `.qf-acc-tools`, `.qf-acc-filters` and the "Phase BB" banner | Update class names / banner when the accessorials UI is restyled |
| `src/server/quotePremium.test.ts` | `--qdoc-primary: #2563eb`, stylesheet load order (polish→premium→print), `.qdoc-actions::before`, "Phase AG" banner | The token value **already matches blue-600**; update the banner, `.qdoc-*` selectors and the decorative pseudo-element |
| `src/server/homepageFinalCleanup.test.ts` | Exact homepage override CSS: 880px/620px max-widths, 58px logo, **1440px container**, grid templates, brand-mark path | Most of the file — the new container is 1240px and this `!important` override layer likely disappears |
| `src/server/dashboardFreightShell.test.ts` | Light dashboard shell pins `--accent: #0D3CFC`, `html[data-theme="light"]` selectors, `content: attr(data-initials)` | Accent hex → `#2563EB`; possibly the whole light-shell override file |
| `src/server/dpaStyleSafe.test.ts` | DPA is skinned by injection and the legal HTML is untouched; pins `dpa-wefixtrades.css`, `.dpa-shell`, `var(--qf-wft-cream)` | Stylesheet/token names — the cream/WeFixTrades palette goes away. **Keep the "never rewrite legal HTML" rule** |

## STALE — candidates for deletion (not deleted in this PR)

| file | what it asserts | note |
| --- | --- | --- |
| `src/server/landingNoTeal.test.ts` | The retired WeFixTrades cleanup skin: `--qf-wft-blue: #0d3cfc`, `--qf-wft-bg: #1f2628`, `--qf-wft-cream: #e7e2dc`, a `display:none` hide-list | A one-off de-teal migration check, superseded by the new design system. Delete with the cleanup stylesheet |
| `src/server/directory/importerUiRound5.test.ts` | Round-5 cost-probe plus one-off polish CSS: `.imp-grid{gap:2px 8px}`, skeleton `color-mix(... --ink 16%)`, chevron `box-shadow: var(--shadow-sm)` | **Split, don't delete**: the cache/cost-probe half is durable; the pinned layout/polish literals are dead weight |
| `src/server/leadQueueSearch.test.ts` | That `lead-queue-search.js` is gone and app.js drives server pagination; also pins a "Phase AX" comment and a `.qf-leads-focus` light override | Keep only the server-pagination assertions; the phase-comment and removed-script pins protect nothing |
| `src/server/toolsMarketplaceSkin.test.ts` | Legacy WeFixTrades skin `var(--qf-wft-cream)`, `.qf-public-wft.qf-tools-marketplace` — on pages that now 301 to `/directory` | Drop the skin assertions; keep only the redirect-ordering test |
| `src/server/setupOnboarding.test.ts` | That `dashboard-setup.js` is NOT linked (retired) while still asserting its JS internals and "Phase BF" CSS classes | Self-contradictory leftover — delete |
| `src/server/rateBuilderActions.test.ts` | That `rate-builder.js` is retired from `app.html`, yet still asserts its `qf-rate-save-panel`/`qf-rate-duplicate-btn` internals and "Phase BG" CSS | Reduce to the live stylesheet-link check, or delete |
| `src/server/launchPanel.test.ts` | The retired launch panel is not re-injected, plus dead-source copy/classes | Delete — guards a retired file nothing renders |
| `src/server/embedLaunchStudio.test.ts` | Stylesheet still linked while the JS layer is retired; asserts retired JS strings | Delete or reduce; half of it protects a neutralised module |
| `src/server/drayageZonePolish.test.ts` | Retired zone panel not re-injected; asserts retired script copy and `.qf-zone-status.ready` | Delete — retired surface |
| `src/server/callbackQueuePolish.test.ts` | Callback command-center CSS/JS strings and that the activity layer loads them | Pure phase-era polish class pinning — delete or rewrite |
| `src/server/brandStudioPreview.test.ts` | Retired brand-studio preview not re-injected; asserts retired file copy/classes | Delete — retired surface |
| `src/server/auditLogPolish.test.ts` | Retired audit-log polish not re-injected; asserts retired scanner copy and `.qf-audit-tag.security` | Delete — retired surface |
| `src/server/accountReadiness.test.ts` | Retired account-readiness panel not re-injected; asserts retired checklist copy/classes | Delete — retired surface |
| `src/server/leadCrmPolish.test.ts` | Retired lead-CRM polish not re-injected; asserts retired workspace copy and `.qf-lead-crm-actions` | Delete — retired surface |

> **Pattern worth noting:** most STALE entries share one shape — a "the retired
> module is no longer injected" assertion sitting next to assertions about that
> same retired module's internals. They can be retired as a single batch.

## Playwright e2e specs (`tests/e2e/`)

| spec | visual/DOM coupling | what it depends on |
| --- | --- | --- |
| `heavy-haul-quote.spec.ts` | **high** | `#hh-*` ids, `.hh-*` classes, computed border/background/textAlign, pill outline-not-fill, 2px row gap, height budgets, WCAG contrast on `.hh-kpilabel`/`.hh-tier--*`, header `.site-actions`/`.site-burger` breakpoints |
| `osow-hub.spec.ts` | **high** | `.qh-tablewrap`/`.qh-fold`/`.qh-rail`/`.qh-label`, footer `.premium-footer-inner`/`.footer-col`/`.dirfoot` two-track grid, column counts, AA contrast in both themes, no-overflow |
| `osow-permit-calculator.spec.ts` | **high** | `#ow-*` ids and `.ow-*` classes, sticky positions, dashed border for user rates, grid track counts, 4px disclaimer gap, tile stacking, overflow measurements |
| `pilot-car-directory.spec.ts` | medium | `.pc-table`/`.pc-tablewrap`/`.pc-filters`/`.pc-pill`/`.pc-statebox`, 2-column grid at 375px, 44px tap targets, no chip wrapping; much of it is URL/text behaviour |
| `smoke.spec.ts` | **none** | Status codes, no 5xx, `/healthz` JSON, admin URL redirect only |

Three of the five e2e specs assert computed styles and grid track counts, so any
wave touching the OS/OW or heavy-haul surfaces must re-run and re-pin them. Their
**contrast and no-overflow assertions are RULE-grade** and should be preserved
verbatim through the redesign.
