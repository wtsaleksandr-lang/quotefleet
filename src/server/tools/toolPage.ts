/**
 * THE SHARED TOOL-PAGE TEMPLATE — eight blocks, fixed order, one definition.
 *
 * We shipped eight tool pages (oversize permit calculator, bridge formula,
 * axle weight checker, heavy-haul quote, pilot cars, seasonal restrictions,
 * compliance lookup, glossary) as eight independent one-offs. Five of them own
 * a hand-rolled '<!doctype html>'; two sit on the OS/OW hub shell; one lives in
 * the directory. They answer related questions and look like eight products.
 * That is the single biggest structural gap a competitor teardown found, and
 * this file is the fix: page nine should cost nothing but its content.
 *
 * ── THE EIGHT BLOCKS, AND WHY THE ORDER IS FIXED ──────────────────────────
 *
 *   1  Tool header band   — flat '--accent-fill' + our raster, title LEFT,
 *                           breadcrumb above, embed affordance in-chrome
 *   2  The tool itself    — elevated card, radius 12
 *   3  Answer/limits strip— 2-3 facts: what this tool does and does NOT cover
 *   4  "How it works" 3-up— numbered steps
 *   5  Two alternating rows
 *   6  Related tools strip— cross-tool navigation
 *   7  FAQ                — two column, heading left / accordion right
 *   8  Footer             — the shell's ('hubPage')
 *
 * The order never varies. A reader who has used one of our tools should be
 * able to predict where the limits are on the next one without looking.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT OWN ──────────────────────────────
 * The document: head, meta, canonical, JSON-LD, site header, footer and the
 * theme boot script all stay in '../osow/hubShell.ts'. 'toolPage()' composes
 * blocks and hands them to 'hubPage()' with a 'heroHtml' override. Forking the
 * document to get a different hero would have duplicated ~40 lines of head for
 * one section, and the two copies would have drifted within a release.
 *
 * ── THE NUMERIC HIERARCHY IS THE POINT ────────────────────────────────────
 * Our tools ARE numbers. The reference system we measured renders the rate
 * LABEL at 800/16px above the VALUE at 500/14.4px — the word "MFN" is bigger
 * than "18%". We do the opposite, and it is stated here rather than left to
 * each page:
 *
 *   - the figure takes the largest step in the ramp at weight 700, in flat
 *     '--ink' (near-black on light, white on dark) — NEVER the accent, because
 *     the calculated answer is not a link and must not read as one;
 *   - 'font-variant-numeric: tabular-nums' on every figure, so digits do not
 *     change width as the tool recalculates. Measured on this page before the
 *     change: the gross-weight figure moved 74.88px -> 73.48px between two
 *     results, which is a visible twitch on every keystroke;
 *   - the label is subordinate — 12px, uppercase, positive tracking, '--muted';
 *   - units are INLINE and smaller than the figure, never stacked above it.
 *
 * ── DESIGN LAW THIS FILE IS HELD TO ───────────────────────────────────────
 * Single accent · radii 6/8/12 only · exactly three shadows ('--shadow-sm/md/
 * lg', no fourth) · two motion durations and one easing · ZERO CSS gradients
 * (the band is a raster over a flat token base) · no card hover lift ·
 * selection is a border-COLOUR swap with the border always 2px so nothing
 * reflows · dividers are gaps, not rules · spacing on the 8px ramp · tokens
 * only at call sites · headings and eyebrows left-aligned, never centred.
 */
import {
  esc,
  fold,
  hubPage,
  type Crumb,
  type HubPageOpts,
} from '../osow/hubShell.js';

// ── CSS ────────────────────────────────────────────────────────────────────
//
// Inlined by the shell after HUB_CSS, so `.qh-*` primitives (the fold, the
// table, the ink ladder) are available and are REUSED rather than restated.
// Every colour here is a token. The three local definitions at the top are
// definitions, not call sites: the band is theme-INVARIANT (see the band
// comment) so it cannot borrow `--hero-wash-*`, which flips in dark theme.

export const TOOL_TEMPLATE_CSS = `
  .qtt {
    /* Two durations, one easing. Nothing on this page animates on a third. */
    --qtt-dur-1: 0.15s;
    --qtt-dur-2: 0.3s;
    --qtt-ease: cubic-bezier(0.22, 1, 0.36, 1);
    /* The 6px step of the radius ramp has no token in style.css (which stops
       at --radius-btn / 8px); named once here so no call site writes a px. */
    --qtt-r-xs: 6px;
  }

  /* ── BLOCK 1 · THE TOOL HEADER BAND ──────────────────────────────────────
     A FLAT TOKEN BASE WITH A DECORATIVE RASTER OVER IT, never a CSS gradient.
     Same technique, same generator and the same file as the /directory search
     card (scripts/make-hero-wash.mjs, variant 'dir-hero-wash'), so there is
     one way of doing this in the codebase rather than two. If the image 404s
     or WebP is unsupported the band lands on the flat '--accent-fill' it
     shipped with; nothing ever renders as white-on-white.

     THE BAND IS THEME-INVARIANT, and that is a deliberate carve-out rather
     than an oversight: '--accent-fill' is #3356EE and '--accent-ink' is
     #FFFFFF in BOTH themes, so one raster is correct in both and there is no
     dark twin to build. It also means the band must NOT use the '--hero-wash-*'
     tokens — those flip to dark ink under html[data-theme="dark"] because the
     HOMEPAGE hero has a dark raster, and borrowing them here would put dark
     ink on a saturated blue band in dark theme. That is exactly the
     invisible-text failure this codebase has shipped before.

     THE BREADCRUMB SITS ABOVE THE BAND, ON THE PAGE GROUND — not inside it.
     On the raster the only honest muted step is a translucent white, and 0.82
     alpha over the band's brightest pixel measures 3.79:1, under the 4.5:1
     floor for a 13px link. On the page ground it is '--muted' over '--bg',
     which clears the floor in both themes and is machine-verifiable. */
  .qtt-band {
    background-color: var(--accent-fill);
    background-image: url("/brand/dir-hero-wash.webp");
    background-repeat: no-repeat;
    background-position: 50% 50%;
    background-size: cover;
  }
  .qtt-band-in { max-width: 1180px; margin: 0 auto; padding: 48px 24px; }
  /* Title left, embed chip right. They are a row until the chip would squeeze
     the H1, then the chip drops under the copy and stays left-aligned. */
  .qtt-band-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .qtt-band-copy { min-width: 0; }
  .qtt-band .qtt-eyebrow { color: var(--accent-ink); }
  .qtt-band h1 {
    margin: 0 0 8px;
    font-size: 40px;
    line-height: 1.1;
    text-align: left;
    text-wrap: balance;
    color: var(--accent-ink);
  }
  .qtt-band p.qtt-lead {
    margin: 0;
    max-width: 720px;
    font-size: 16px;
    line-height: 1.55;
    text-align: left;
    text-wrap: pretty;
    color: var(--accent-ink);
  }

  /* The breadcrumb. 13px — the reference ships 16px, which competes with the
     H1 for the same glance. Chevron separator, muted links, ink current. */
  .qtt-crumbs { max-width: 1180px; margin: 0 auto; padding: 12px 24px 0; font-size: 13px; line-height: 1.5; }
  .qtt-crumbs a { color: var(--muted); text-decoration: none; }
  .qtt-crumbs a:hover { color: var(--accent); text-decoration: underline; }
  .qtt-crumbs .qtt-sep { color: var(--muted); padding: 0 4px; }
  .qtt-crumbs [aria-current="page"] { color: var(--ink); }

  /* ── THE EMBED AFFORDANCE ────────────────────────────────────────────────
     In the tool's own chrome, small and secondary, never competing with the
     primary action inside the tool card. Every tool page carrying this turns
     the tool into a backlink engine and puts our mark on carrier and broker
     sites — it is a growth mechanic, which is why it is in the template rather
     than left to each page to remember. */
  .qtt-embed {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    box-sizing: border-box;
    padding: 8px 16px;
    border: 1px solid var(--qtt-band-line);
    border-radius: var(--radius-btn);
    background: var(--qtt-band-wipe);
    color: var(--accent-ink);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
    text-decoration: none;
    white-space: nowrap;
  }
  .qtt-embed .qtt-embed-ic { width: 16px; height: 16px; flex: 0 0 auto; }
  @media (prefers-reduced-motion: no-preference) {
    .qtt-embed { transition: background-color var(--qtt-dur-1) var(--qtt-ease), border-color var(--qtt-dur-1) var(--qtt-ease); }
  }
  /* THE HOVER COLOUR IS PINNED, AND THAT IS A CONTRAST FIX, NOT A PREFERENCE.
     style.css carries a global 'a:hover { color: var(--accent-strong); }' at
     specificity (0,1,1), which beats this component's own '.qtt-embed { color:
     var(--accent-ink) }' at (0,1,0). So hovering the chip turned its label from
     white to the accent — ON THE SATURATED ACCENT BAND. Measured per pixel
     against the brightest pixel under the label: 1.48:1 in light theme and
     3.12:1 in dark, against a 4.5:1 floor for 13px text. The label was
     effectively invisible for as long as the pointer was on it.
     Restating the colour here restores --accent-ink on hover, where it measures
     5.44:1. The hover AFFORDANCE is unchanged and is what it always was: the
     border going to full-strength ink. */
  .qtt-embed:hover { border-color: var(--accent-ink); color: var(--accent-ink); }

  /* ── THE SECTION-HEADER PRIMITIVE ────────────────────────────────────────
     ONE definition: eyebrow -> heading -> sub -> 24px gap -> body, eyebrow
     TOP-LEFT. The reference system has five different section headers across
     one site, which is what happens when nobody defines one. This is the one. */
  .qtt-sec { margin: 0 0 48px; scroll-margin-top: 96px; }
  .qtt-head { margin: 0 0 24px; }
  .qtt-eyebrow {
    display: block;
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-align: left;
    color: var(--muted);
  }
  .qtt-head h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.2;
    text-align: left;
    text-wrap: balance;
    color: var(--ink);
  }
  .qtt-head p.qtt-sub {
    margin: 8px 0 0;
    max-width: 720px;
    font-size: 15px;
    line-height: 1.55;
    color: var(--muted);
  }

  /* ── BLOCK 2 · THE TOOL CARD ─────────────────────────────────────────────
     Elevated, radius 12, one of the three shadows. No hover lift: the card is
     a surface, not a control. */
  .qtt-tool {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    padding: 24px;
    margin: 0 0 48px;
  }

  /* ── BLOCK 3 · THE ANSWER / LIMITS STRIP ─────────────────────────────────
     What the tool covers and — the half nobody ships — what it does not. A
     recessed tray with the items separated by GAPS, not rules: the house rule
     is that a divider is space. The reference uses a 957px prose block here;
     two or three facts convert better and are readable at a glance. */
  .qtt-strip {
    display: grid;
    grid-template-columns: repeat(var(--qtt-strip-cols, 3), minmax(0, 1fr));
    gap: 24px;
    background: var(--surface-2);
    border-radius: var(--radius-lg);
    padding: 24px;
  }
  .qtt-strip-k {
    display: block;
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .qtt-strip-v { margin: 0; font-size: 14px; line-height: 1.55; color: var(--ink-soft); }
  .qtt-strip-v strong { color: var(--ink); }

  /* ── BLOCK 4 · "HOW IT WORKS", NUMBERED, 3-UP ────────────────────────────
     Three steps, three columns, one column at 375. Three in a single stack
     cannot orphan, so no wrap rule is needed here. */
  .qtt-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
  .qtt-step-n {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    min-width: 32px;
    margin: 0 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-pill);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--ink);
  }
  .qtt-step h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; line-height: 1.4; text-align: left; color: var(--ink); }
  .qtt-step p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--ink-soft); }

  /* ── BLOCK 5 · TWO ALTERNATING ROWS ──────────────────────────────────────
     TWO, not the reference's three. Theirs are 574px tall with 150px of
     padding and a 150px gap — 2 022px of alternating rows on one page. Two
     rows on the 8px ramp say the same thing in half the scroll. */
  .qtt-rows { display: grid; gap: 48px; }
  .qtt-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; align-items: center; }
  .qtt-row:nth-child(even) .qtt-row-fig { order: -1; }
  .qtt-row-copy h3 { margin: 0 0 8px; font-size: 20px; font-weight: 600; line-height: 1.3; text-align: left; color: var(--ink); }
  .qtt-row-copy p { margin: 0 0 12px; font-size: 15px; line-height: 1.55; color: var(--ink-soft); }
  .qtt-row-copy p:last-child { margin: 0; }
  .qtt-row-copy a { color: var(--accent); }
  .qtt-row-fig {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 24px;
  }
  /* A figure is FACTS, not decoration: label above value, value dominant and
     tabular, so a row's illustration is still something you can read off. */
  .qtt-facts { display: grid; gap: 16px; margin: 0; }
  .qtt-fact dt {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .qtt-fact dd {
    margin: 4px 0 0;
    font-size: 24px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    color: var(--ink);
  }
  .qtt-fact dd .qtt-unit { font-size: 14px; font-weight: 500; color: var(--muted); }

  /* ── BLOCK 6 · RELATED TOOLS ─────────────────────────────────────────────
     The reference has NO cross-tool navigation on a tool page at all. Every
     one of ours ends by naming the next one, which is the cheapest suite
     signal there is.

     THE COLUMN COUNT IS EXPLICIT AT EVERY BREAKPOINT, never auto-fit: auto-fit
     is what leaves one card alone on a final row. Four cards go 4 -> 2x2 -> 4x1
     and are never 3+1. */
  .qtt-related { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
  .qtt-rel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .qtt-rel { transition: border-color var(--qtt-dur-1) var(--qtt-ease); }
  }
  /* Border tint on hover, NO lift. A 1px translate is imperceptible and costs
     a paint; the border change reads instantly and reflows nothing. */
  .qtt-rel:hover { border-color: var(--accent); }
  .qtt-rel-t { font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--ink); }
  .qtt-rel-d { font-size: 13px; line-height: 1.55; color: var(--muted); }

  /* ── BLOCK 7 · FAQ, TWO COLUMN ───────────────────────────────────────────
     Heading left, accordion right. A single column of questions becomes a
     900px wall of grey; split, it reads as a reference. The accordion is the
     shell's own '.qh-fold' so the page has ONE disclosure pattern rather than
     a question that opens one way and a note that opens another. */
  .qtt-faq { display: grid; grid-template-columns: minmax(0, 360px) minmax(0, 1fr); gap: 48px; align-items: start; }
  .qtt-faq .qtt-head { margin: 0; }

  /* ── FOCUS ───────────────────────────────────────────────────────────────
     A REAL ring on everything focusable, 2px accent at 2px offset, visibly
     different from hover (which only ever moves a border colour or a tint).
     The reference system resolves to 'outline: <colour> none 0px' on every
     marketing button and 'outline: 0' on every MUI one — i.e. nothing renders
     and focus is pixel-identical to hover, on both hosts. This is the straight
     win. ':focus-visible', not ':focus', so a mouse click does not paint it. */
  .qtt .qh-shell a:focus-visible,
  .qtt .qh-shell button:focus-visible,
  .qtt .qh-shell summary:focus-visible,
  .qtt .qh-shell input:focus-visible,
  .qtt .qh-shell select:focus-visible,
  .qtt .qh-shell [tabindex]:focus-visible,
  .qtt-crumbs a:focus-visible,
  .qtt-band a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--qtt-r-xs);
  }
  /* On the band the accent is nearly the ground. The ring goes white there —
     the same 2px/2px geometry, picked by GROUND rather than by theme. */
  .qtt-band a:focus-visible, .qtt-embed:focus-visible { outline-color: var(--accent-ink); }

  /* ── REDUCED MOTION ──────────────────────────────────────────────────────
     Belt and braces. Every transition above is already inside a
     'prefers-reduced-motion: no-preference' query; this catches anything the
     shell or a tool's own stylesheet brings with it. The reference ships zero
     reduced-motion rules across both hosts despite 32 keyframes. */
  @media (prefers-reduced-motion: reduce) {
    .qtt *, .qtt *::before, .qtt *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }

  /* The shell's own main element, re-spaced for a page whose first block is a
     full-bleed band rather than a hero with its own bottom padding. */
  .qtt .qh-shell { max-width: 1180px; padding: 48px 24px 80px; }
  .qtt .qtt-sec:last-child { margin-bottom: 0; }

  @media (max-width: 980px) {
    .qtt-related { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .qtt-faq { grid-template-columns: minmax(0, 1fr); gap: 24px; }
    .qtt-row { grid-template-columns: minmax(0, 1fr); gap: 24px; }
    /* Copy first in a single column — an illustration above its own
       explanation is a decoration with no caption. */
    .qtt-row:nth-child(even) .qtt-row-fig { order: 0; }
    .qtt-steps { grid-template-columns: minmax(0, 1fr); }
    .qtt-strip { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    .qtt-band-in { padding: 32px 16px; }
    .qtt-band-row { flex-direction: column; align-items: stretch; gap: 16px; }
    .qtt-embed { align-self: flex-start; }
    .qtt-band h1 { font-size: 28px; }
    .qtt-band p.qtt-lead { font-size: 15px; }
    .qtt-crumbs { padding: 12px 16px 0; }
    .qtt .qh-shell { padding: 32px 16px 48px; }
    .qtt-tool { padding: 16px; }
    .qtt-sec { margin: 0 0 32px; }
    .qtt-strip { padding: 16px; }
    .qtt-related { grid-template-columns: minmax(0, 1fr); }
    .qtt-rows { gap: 32px; }
  }
`;

// ── Local band tokens ──────────────────────────────────────────────────────
//
// DEFINED ONCE, HERE, and referenced by token at every call site above. They
// exist because the band is theme-invariant and therefore cannot use
// `--hero-wash-line` / `--hero-wash-wipe`, which flip to dark-theme values.
// The alphas are the ones style.css already justified for a ghost control on a
// saturated ground: 0.70 measures 3.50:1 as a boundary (the 3:1 UI floor) and
// 0.14 is a wipe, not a fill.
//
// EXPORTED so a page that renders the band WITHOUT going through `toolPage()`
// can still get them. /compliance is that page: it stays on the directory
// shell — which carries the FMCSA data-source attribution, the directory site
// map and the shipper-account hydration that the marketing footer does not —
// and composes the same blocks from these primitives. Exporting the two alphas
// is what stops that page re-declaring them and drifting from this definition.
export const BAND_TOKENS = `
  .qtt-band { --qtt-band-line: rgba(255, 255, 255, 0.70); --qtt-band-wipe: rgba(255, 255, 255, 0.14); }
`;

// ── Block primitives ───────────────────────────────────────────────────────

export interface SectionHeader {
  /** Top-left, always. One eyebrow token for the whole product. */
  eyebrow: string;
  heading: string;
  /** Optional third line. Omitted rather than padded when there is nothing. */
  sub?: string;
}

/** The one section-header stack: eyebrow -> heading -> sub -> 24px -> body. */
export function sectionHeader(h: SectionHeader): string {
  return `<div class="qtt-head"><span class="qtt-eyebrow">${esc(h.eyebrow)}</span>`
    + `<h2>${esc(h.heading)}</h2>`
    + `${h.sub ? `<p class="qtt-sub">${esc(h.sub)}</p>` : ''}</div>`;
}

/** A block: section header + body, with the block's anchor id. */
function block(id: string, head: SectionHeader, bodyHtml: string): string {
  return `<section class="qtt-sec" id="${esc(id)}">${sectionHeader(head)}${bodyHtml}</section>`;
}

const EMBED_ICON =
  '<svg class="qtt-embed-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/></svg>';

export interface EmbedAffordance {
  /**
   * THE SINGLE INTEGRATION POINT for per-tool embedding.
   *
   * Today this points at the shipped "get this on your own site" surface, the
   * same destination 'TOOL_PROMO_CTA' already sends readers to. When a real
   * per-tool embed route exists (an '/embed/<tool>' iframe host, or a snippet
   * generator), THIS is the one line that changes and every tool page built on
   * the template picks it up. Building that route is out of scope for the PR
   * that introduces the template — it is a server surface, not presentation.
   */
  href: string;
  label: string;
}

export interface Fact {
  label: string;
  bodyHtml: string;
}

export interface Step {
  title: string;
  bodyHtml: string;
}

export interface AltRow {
  heading: string;
  bodyHtml: string;
  /** The right-hand figure. Real facts, never decoration — see 'factList'. */
  figureHtml: string;
}

export interface RelatedTool {
  href: string;
  title: string;
  blurb: string;
}

/** A figure for an alternating row: label over a dominant, tabular value. */
export function factList(items: Array<{ label: string; value: string; unit?: string }>): string {
  return `<dl class="qtt-facts">${items
    .map(
      (f) =>
        `<div class="qtt-fact"><dt>${esc(f.label)}</dt>`
        + `<dd>${esc(f.value)}${f.unit ? ` <span class="qtt-unit">${esc(f.unit)}</span>` : ''}</dd></div>`,
    )
    .join('')}</dl>`;
}

// ── The page ───────────────────────────────────────────────────────────────

export interface ToolPageOpts {
  /** Head + canonical + JSON-LD, straight through to the shell. */
  title: string;
  description: string;
  path: string;
  jsonLd: Array<Record<string, unknown>>;

  /** Block 1. */
  crumbs: Crumb[];
  eyebrow: string;
  h1: string;
  /** Pre-escaped HTML — a lead may carry a link. */
  lead: string;
  embed: EmbedAffordance;

  /** Block 2 — the tool. Rendered inside the elevated card. */
  toolHtml: string;

  /**
   * ── BLOCKS 3, 4, 5 AND 7 ARE OPTIONAL, AND THE BAR FOR OMITTING ONE IS HIGH
   *
   * The ORDER is still fixed and a supplied block still renders in its fixed
   * slot — omitting one never reorders the rest. What is optional is whether
   * the page has something true to put there.
   *
   * This exists because the suite is not eight calculators. The glossary is a
   * 37-term reference index: it has no three-step process to number and no two
   * explanatory rows that are not already the word list, and a compliance page
   * has no genuine recurring question we can answer without stating somebody
   * else's regulation. Forcing eight blocks onto those pages produces filler,
   * and filler in a FAQ is worse than filler in a layout because it ships
   * `FAQPage` schema over a question nobody asked.
   *
   * SO: omit a block ONLY when filling it would mean inventing content. Never
   * to save effort — a tool page that skips its limits strip because writing
   * one was awkward has hidden the boundary its reader most needs. A page that
   * drops a block must be able to say WHY in one sentence.
   *
   * `related` has no opt-out on purpose: cross-tool navigation is the cheapest
   * suite signal there is and every page can always name the next tool.
   */

  /** Block 3 — 2 or 3 facts. Fewer than 2 reads as an afterthought; more than
   *  3 stops being a strip and becomes a list, which is what block 5 is for. */
  limits?: { head: SectionHeader; facts: Fact[] };

  /** Block 4 — exactly three. */
  steps?: { head: SectionHeader; items: [Step, Step, Step] };

  /** Block 5 — exactly two. */
  rows?: { head: SectionHeader; items: [AltRow, AltRow] };

  /** Block 6. Always present — see the note above. */
  related: { head: SectionHeader; items: RelatedTool[] };

  /** Block 7. Omit rather than manufacture questions; the schema is a promise. */
  faq?: { head: SectionHeader; items: Array<{ q: string; a: string }> };

  /** Per-tool CSS and scripts, appended after the template's. */
  extraCss?: string;
  extraScripts?: string;
  /** Anything that must sit between the tool card and block 3 — a JSON seed. */
  afterToolHtml?: string;
  /**
   * EXTRA CLASSES ON `<body>`, appended after `qtt` — never instead of it.
   *
   * Additive and optional: omitted, the body is exactly `class="qtt"`, which is
   * what every page built on this template got before this option existed and
   * what the bridge-formula page still gets.
   *
   * It exists because two of the migrated tools carry a behavioural body class
   * of their own that has nothing to do with the template: `qf-mc-hide-sm`,
   * which `marketing-chat.js` reads to keep the chat launcher off a page whose
   * primary action is a submit button at phone width. Dropping it in the
   * migration would have put the floating launcher back over the calculate
   * button on a 375px screen — a real regression, invisible in a diff.
   */
  bodyClassExtra?: string;
}

/**
 * Render one tool page from the eight blocks.
 *
 * Page nine costs its content and nothing else: no shell, no stylesheet, no
 * breadcrumb component, no FAQ markup, no focus ring to remember.
 */
export function toolPage(opts: ToolPageOpts): string {
  const crumbs: Crumb[] = [{ name: 'Home', path: '/' }, ...opts.crumbs];
  const crumbHtml = `<nav class="qtt-crumbs" aria-label="Breadcrumb">${crumbs
    .map((c, i, arr) =>
      i === arr.length - 1 || !c.path
        ? `<span aria-current="page">${esc(c.name)}</span>`
        : `<a href="${esc(c.path)}">${esc(c.name)}</a><span class="qtt-sep" aria-hidden="true">›</span>`,
    )
    .join('')}</nav>`;

  // ── 1 ──
  const band = `${crumbHtml}
  <section class="qtt-band">
    <div class="qtt-band-in">
      <div class="qtt-band-row">
        <div class="qtt-band-copy">
          <span class="qtt-eyebrow">${esc(opts.eyebrow)}</span>
          <h1>${esc(opts.h1)}</h1>
          <p class="qtt-lead">${opts.lead}</p>
        </div>
        <a class="qtt-embed" href="${esc(opts.embed.href)}">${EMBED_ICON}<span>${esc(opts.embed.label)}</span></a>
      </div>
    </div>
  </section>`;

  // ── 2 ──
  const tool = `<div class="qtt-tool">${opts.toolHtml}</div>${opts.afterToolHtml ?? ''}`;

  // ── 3 ── The column count is stated, never inferred, so 2 facts are 2 full
  // columns rather than 2 of 3 with a hole where the third would be.
  const limits = opts.limits
    ? block(
        'limits',
        opts.limits.head,
        `<div class="qtt-strip" style="--qtt-strip-cols:${opts.limits.facts.length}">${opts.limits.facts
          .map((f) => `<div><span class="qtt-strip-k">${esc(f.label)}</span><p class="qtt-strip-v">${f.bodyHtml}</p></div>`)
          .join('')}</div>`,
      )
    : '';

  // ── 4 ──
  const steps = opts.steps
    ? block(
        'how',
        opts.steps.head,
        `<div class="qtt-steps">${opts.steps.items
          .map(
            (s, i) =>
              `<div class="qtt-step"><span class="qtt-step-n" aria-hidden="true">${i + 1}</span>`
              + `<h3>${esc(s.title)}</h3><p>${s.bodyHtml}</p></div>`,
          )
          .join('')}</div>`,
      )
    : '';

  // ── 5 ──
  const rows = opts.rows
    ? block(
        'detail',
        opts.rows.head,
        `<div class="qtt-rows">${opts.rows.items
          .map(
            (r) =>
              `<div class="qtt-row"><div class="qtt-row-copy"><h3>${esc(r.heading)}</h3>${r.bodyHtml}</div>`
              + `<div class="qtt-row-fig">${r.figureHtml}</div></div>`,
          )
          .join('')}</div>`,
      )
    : '';

  // ── 6 ──
  const related = block(
    'related',
    opts.related.head,
    `<div class="qtt-related">${opts.related.items
      .map(
        (t) =>
          `<a class="qtt-rel" href="${esc(t.href)}"><span class="qtt-rel-t">${esc(t.title)}</span>`
          + `<span class="qtt-rel-d">${esc(t.blurb)}</span></a>`,
      )
      .join('')}</div>`,
  );

  // ── 7 ── The shell's own fold, so the page has one disclosure pattern.
  const faq = opts.faq
    ? `<section class="qtt-sec" id="faq"><div class="qtt-faq">${sectionHeader(opts.faq.head)}`
      + `<div class="qh-faq">${opts.faq.items
        .map((f) => fold({ label: f.q, bodyHtml: `<p>${esc(f.a)}</p>` }))
        .join('')}</div></div></section>`
    : '';

  const shellOpts: HubPageOpts = {
    title: opts.title,
    description: opts.description,
    path: opts.path,
    crumbs: opts.crumbs,
    eyebrow: opts.eyebrow,
    h1: opts.h1,
    lead: opts.lead,
    heroHtml: band,
    // `.qtt` scopes the template's focus-ring and reduced-motion rules to this
    // page, so they cannot leak onto the ~35 hub pages sharing the shell. It is
    // always FIRST and always present; `bodyClassExtra` only ever appends.
    bodyClass: opts.bodyClassExtra ? `qtt ${opts.bodyClassExtra}` : 'qtt',
    bodyHtml: `${tool}${limits}${steps}${rows}${related}${faq}`,
    jsonLd: opts.jsonLd,
    extraCss: `${TOOL_TEMPLATE_CSS}${BAND_TOKENS}${opts.extraCss ?? ''}`,
    ...(opts.extraScripts ? { extraScripts: opts.extraScripts } : {}),
    // Block 8 is the shell's footer. The generic tool promo is suppressed:
    // the header band already carries the embed affordance and block 6 carries
    // the cross-tool links, so the promo would be a third ask for the same
    // click at the bottom of a page that has already made it twice.
    showPromoCta: false,
  };

  return hubPage(shellOpts);
}
