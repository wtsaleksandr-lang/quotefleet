/**
 * THE OS/OW HUB'S SHARED CHROME — one page shell, one stylesheet, one set of
 * JSON-LD builders, for ~35 URLs.
 *
 * The pages under `/oversize` are almost entirely DATA TABLES, and that decides
 * most of what is in here:
 *
 *   - **No glass behind a number.** Glass is for chrome — the sticky "on this
 *     page" rail and nothing else on these pages. Every table, cell, citation
 *     and total sits on a solid surface at full contrast, in both themes.
 *   - **Wide tables scroll inside their own container**, never the document.
 *     `.qh-tablewrap` is the only horizontal scroller on any of these pages,
 *     and the first column is sticky inside it so a row stays identifiable at
 *     375 px.
 *   - **A conflict is an outline and a 4–6% tint, never a bright fill.** Two
 *     official documents disagreeing is the most valuable thing on the site and
 *     it must read as information, not as an error state.
 *   - **`overflow: clip`, not `hidden`,** on the rail's scroll container —
 *     `hidden` silently kills `position: sticky` in a descendant.
 *
 * Every colour is a token from style.css, so light and dark both work with no
 * `data-theme` block of our own and no raw hex anywhere in this file.
 */
import type { SourceDoc } from '../../calc/osow/provenance.js';
import { FULL_SITE_HEADER, PREMIUM_FOOTER, HEADER_SCRIPTS } from '../siteChrome.js';
import type { HubCell, Provenance } from './hubData.js';

export const SITE = 'https://quotefleet.net';

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string,
  );
}

// ── CSS ────────────────────────────────────────────────────────────────────

export const HUB_CSS = `
  /* ── ONE INK, FOUR STEPS ──────────────────────────────────────────────────
     Hierarchy on these pages is a POSITION ON ONE LADDER, not a palette. Every
     piece of text picks one of four steps and nothing else, which is what stops
     a page of tables and citations reading as a page of competing colours.

       1  headings, answers, figures            --ink
       2  body copy                             --ink-soft
       3  metadata, citations, column heads      --muted
       4  absence placeholders ONLY              --muted-soft

     THE LADDER STOPS AT FOUR ON PURPOSE. The reference system this is drawn
     from runs to six (28% and 18% of the ink) and uses the bottom two for
     10px metadata. Measured against this codebase's own grounds, --muted-soft
     is already 3.86:1 on the dark canvas — under the 4.5:1 floor for text at
     this size — so step 4 carries placeholder words a reader never has to read
     ("Not yet covered") and NOTHING a reader has to act on. Steps 5 and 6 do
     not exist here. Citations, revision dates and micro-labels stop at step 3.
     ── */
  :root {
    --qh-ink-1: var(--ink);
    --qh-ink-2: var(--ink-soft);
    --qh-ink-3: var(--muted);
    --qh-ink-4: var(--muted-soft);
    --qh-ease: cubic-bezier(0.22, 1, 0.36, 1);
  }

  .qh-shell { max-width: 1180px; margin: 0 auto; padding: 8px 24px 48px; }
  /* Shared .hero centres its text. Left-align it and centre the same column the
     body uses, so the H1 starts on the body's left edge. */
  .qh-hero { padding: 48px 24px 16px; text-align: left; }
  .qh-hero .container-narrow { max-width: 1132px; margin: 0 auto; padding: 0; }
  .qh-eyebrow { color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px; text-align: left; }
  .qh-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 8px; text-align: left; text-wrap: balance; }
  .qh-hero p.lead { max-width: 820px; margin: 0; text-align: left; text-wrap: pretty; }

  /* Provenance band — COMPUTED, never typed. */
  .qh-prov { display: grid; grid-template-columns: repeat(2, minmax(0, max-content)); gap: 4px 8px; justify-content: start; margin: 16px 0 0; }
  .qh-prov span { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 8px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); color: var(--muted); white-space: nowrap; }

  /* Honesty banner. Solid, never glass — body text sits on it. */
  .qh-truth { background: var(--warn-bg); border: 1px solid var(--warn); border-radius: var(--radius-lg); padding: 16px; margin: 16px 0 0; }
  .qh-truth h2 { font-size: 16px; margin: 0 0 4px; color: var(--ink); text-align: left; }
  .qh-truth p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }
  .qh-truth strong { color: var(--ink); }

  /* Breadcrumb. */
  .qh-crumbs { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
  .qh-crumbs a { color: var(--muted); text-decoration: none; }
  .qh-crumbs a:hover, .qh-crumbs a:focus-visible { color: var(--accent); text-decoration: underline; }

  /* Two-column body: the sticky rail, then the content. */
  .qh-body { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 32px; align-items: start; margin-top: 24px; }
  .qh-body.qh-body--full { grid-template-columns: minmax(0, 1fr); }
  /* clip, NOT hidden: overflow:hidden on an ancestor kills position:sticky. */
  .qh-rail { position: sticky; top: 96px; overflow: clip; }
  .qh-rail h2 { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
  .qh-rail ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; counter-reset: qh; }
  .qh-rail a { display: block; font-size: 13px; line-height: 1.5; color: var(--ink-soft); text-decoration: none; padding: 4px 8px; border-left: 1px solid var(--border); }
  .qh-rail a:hover, .qh-rail a:focus-visible { color: var(--accent); border-left-color: var(--accent); }

  /* SECTIONS ARE SEPARATED BY A HAIRLINE, NOT BY WHITESPACE. A 32px gap
     between twelve sections is 384px of nothing on a state page; a 1px rule
     with 24px of lead-in says the same thing in a quarter of the height and
     satisfies the house rule against whitespace-as-separator. First section
     suppressed — a rule above the first heading has nothing to separate. */
  .qh-sec { margin: 0 0 24px; scroll-margin-top: 96px; }
  .qh-sec + .qh-sec { border-top: 1px solid var(--border); padding-top: 24px; }
  .qh-sec h2 { font-size: 22px; margin: 0 0 4px; color: var(--ink); text-align: left; text-wrap: balance; }
  .qh-sec h3 { font-size: 16px; margin: 16px 0 4px; color: var(--ink); text-align: left; }
  .qh-sec p { font-size: 14px; line-height: 1.55; color: var(--ink-soft); margin: 0 0 12px; max-width: 820px; }
  .qh-sec p.qh-sub { color: var(--muted); }
  .qh-sec ul, .qh-sec ol { margin: 0 0 12px; padding-left: 24px; display: grid; gap: 4px; }
  .qh-sec li { font-size: 14px; line-height: 1.55; color: var(--ink-soft); }
  .qh-sec a { color: var(--accent); }
  .qh-compare { font-size: 12px; font-family: var(--font-mono); margin: 0 0 12px; }

  /* Quoted public-domain federal text. Solid surface, clear attribution. */
  .qh-quote { border-left: 2px solid var(--accent); background: var(--surface); border-radius: 0 var(--radius) var(--radius) 0; padding: 12px 16px; margin: 0 0 12px; }
  .qh-quote p { margin: 0 0 8px; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }
  .qh-quote p:last-child { margin: 0; }
  .qh-quote cite { display: block; font-style: normal; font-size: 12px; font-family: var(--font-mono); color: var(--muted); }

  /* ── Tables. The wrapper is the ONLY horizontal scroller on the page. ── */
  .qh-tablewrap { overflow-x: auto; overflow-y: visible; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
  table.qh-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
  .qh-table th, .qh-table td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--ink-soft); }
  .qh-table thead th { position: sticky; top: 0; z-index: 2; background: var(--surface-2); font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 500; white-space: nowrap; }
  .qh-table tbody tr:last-child td { border-bottom: none; }
  /* Sticky first column so a row stays identifiable while the table scrolls. */
  .qh-table th.qh-st, .qh-table td.qh-st { position: sticky; left: 0; z-index: 1; background: var(--surface); border-right: 1px solid var(--border); min-width: 132px; }
  .qh-table thead th.qh-st { z-index: 3; background: var(--surface-2); }
  /* NO ZEBRA. A full 1px grid at the hairline weight does the row-tracking job
     that striping was doing, and it does it without a second surface colour
     fighting the conflict tint (.is-conflict) and the sticky first column for
     the same cell background. Vertical rules stop before the last column so the
     table has no outer border of its own — .qh-tablewrap already draws one. */
  .qh-table th, .qh-table td { border-right: 1px solid var(--border); }
  .qh-table th:last-child, .qh-table td:last-child { border-right: none; }
  .qh-table td.qh-st a { color: var(--ink); text-decoration: none; font-weight: 600; }
  .qh-table td.qh-st a:hover, .qh-table td.qh-st a:focus-visible { color: var(--accent); text-decoration: underline; }
  /* The VALUE never wraps — "13'6"" broken across two lines is unreadable —
     but everything under it does, and the cell is capped. Without the cap the
     citation lines drive the column width: a ten-measure table whose every cell
     carries two dates and a pinpoint cite renders over 5,000 px wide, and the
     conflict cells (which name two documents in one cell) are worse. Capped and
     wrapping, the same table is roughly a third of that and still says
     everything it said before. */
  .qh-table td { max-width: 264px; }
  .qh-table .qh-v { display: block; color: var(--ink); font-family: var(--font-mono); white-space: nowrap; }
  .qh-table .qh-v a { color: var(--ink); text-decoration: none; border-bottom: 1px dotted var(--border-strong); }
  .qh-table .qh-v a:hover, .qh-table .qh-v a:focus-visible { color: var(--accent); border-bottom-color: var(--accent); }
  .qh-table .qh-rev { display: block; font-size: 11px; font-family: var(--font-mono); color: var(--muted); margin-top: 4px; white-space: normal; overflow-wrap: anywhere; line-height: 1.5; }
  .qh-table .qh-none { color: var(--muted-soft); font-style: normal; }
  /* A conflict is an OUTLINE plus a faint tint, never a bright fill. */
  .qh-table td.is-conflict { box-shadow: inset 0 0 0 1px var(--warn); background: var(--warn-bg); }
  .qh-table tbody tr.is-uncovered td { color: var(--muted); }
  .qh-table tbody tr.is-uncovered td.qh-st { color: var(--ink-soft); font-weight: 400; }

  .qh-legend { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0 0; }
  .qh-legend div { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; font-size: 12px; line-height: 1.5; color: var(--muted); background: var(--surface); }
  .qh-legend strong { color: var(--ink); display: block; }

  /* ── Cards ── */
  .qh-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .qh-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .qh-card h3 { font-size: 16px; margin: 0; color: var(--ink); text-align: left; }
  .qh-card h3 a { color: inherit; text-decoration: none; }
  .qh-card h3 a:hover, .qh-card h3 a:focus-visible { text-decoration: underline; color: var(--accent); }
  .qh-card p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ink-soft); }
  .qh-card .qh-meta { color: var(--muted); font-size: 12px; font-family: var(--font-mono); margin: 0; }

  /* Conflict / gap entries — outline + tint, never a fill. */
  .qh-entry { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 16px; margin: 0 0 12px; }
  .qh-entry--conflict { border-color: var(--warn); background: var(--warn-bg); }
  .qh-entry h3 { font-size: 15px; margin: 0 0 8px; color: var(--ink); text-align: left; }
  .qh-entry p { font-size: 13px; line-height: 1.55; color: var(--ink-soft); margin: 0 0 8px; max-width: none; }
  .qh-entry p:last-child { margin: 0; }
  .qh-versus { display: grid; gap: 8px; margin: 0 0 8px; }
  .qh-versus > div { border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 12px; background: var(--surface); }
  .qh-versus .qh-fig { font-family: var(--font-mono); font-size: 16px; font-weight: 700; color: var(--ink); display: block; margin-bottom: 4px; }
  .qh-versus .qh-src { font-size: 12px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
  .qh-versus .qh-src a { color: var(--accent); overflow-wrap: anywhere; }

  /* The 51-state link grid. THREE columns so 51 = 17 x 3 exactly and no chip
     is ever left alone on a final row. */
  .qh-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: 12px 0 0; }
  .qh-grid a, .qh-grid span { font-size: 13px; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--border); text-decoration: none; display: block; min-height: 24px; }
  .qh-grid a { color: var(--ink-soft); }
  .qh-grid a:hover, .qh-grid a:focus-visible { border-color: var(--accent); color: var(--accent); }
  .qh-grid span { color: var(--muted-soft); }

  /* Source list. */
  .qh-sources { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .qh-sources li { font-size: 12px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .qh-sources li:last-child { border-bottom: none; padding-bottom: 0; }
  .qh-sources a { color: var(--accent); overflow-wrap: anywhere; }
  .qh-sources .qh-pub { color: var(--ink-soft); }

  /* ── MONO MICRO-LABEL — the section eyebrow that does the wayfinding. ─────
     Small, quiet, categorically loud: a reader scans the labels, not the prose.
     POSITIVE tracking on tiny uppercase mono is the whole trick (0.12em at 11px
     is ~1.3px). Held at step 3 of the ladder, never lower — step 4 would not
     clear 4.5:1 at this size in either theme. Left-aligned, always: the house
     rule puts an eyebrow top-left of the block it introduces, never centred. */
  .qh-label { display: block; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--qh-ink-3); margin: 0 0 8px; text-align: left; }

  /* ── "THE SHORT VERSION" — the answer, above the document. ────────────────
     Accent tint + a 3px accent left edge, with the radius flattened on that
     edge so the border reads as a tab rather than a stroke around a pill.
     Solid tint, never glass: this is body text and the house readability rule
     keeps glass off body text. */
  .qh-short { background: var(--accent-soft); border-left: 3px solid var(--accent); border-radius: 0 var(--radius) var(--radius) 0; padding: 16px; margin: 0 0 24px; }
  .qh-short p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--qh-ink-1); max-width: 820px; }
  .qh-short p + p { margin-top: 8px; }
  .qh-short strong { color: var(--qh-ink-1); }
  .qh-short a { color: var(--accent); }

  /* ── THE FOLD ─────────────────────────────────────────────────────────────
     Native <details>/<summary>. No JavaScript, no ARIA wiring, no height
     measuring — the element exposes its own expanded state to assistive tech
     and is keyboard-operable for free, which is the whole argument for not
     hand-rolling an accordion here.

     SUMMARY-FIRST IS THE RULE, not the styling. What folds is the EXPLANATION.
     The number, the citation link, the revision dates and the accuracy tier
     stay visible unconditionally — a reader must never have to open something
     to find out whether it is relevant.

     The panel carries no padding of its own; the summary owns 12px 16px so the
     whole header row is the hit target, edge to edge, at a 44px floor. */
  .qh-folds { display: grid; gap: 4px; margin: 0 0 12px; }
  /* Standing on its own in a section a fold owns its bottom rhythm; inside a
     group the group's 4px gap does it instead. */
  .qh-fold { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 0; margin: 0 0 12px; }
  .qh-folds > .qh-fold, .qh-faq > .qh-fold { margin: 0; }
  .qh-entry > .qh-fold:last-child { margin: 0; }
  .qh-fold > summary { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; padding: 12px 16px; min-height: 44px; box-sizing: border-box; font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--qh-ink-1); cursor: pointer; list-style: none; }
  .qh-fold > summary::-webkit-details-marker { display: none; }
  .qh-fold > summary::marker { content: ''; }
  .qh-fold > summary:hover { color: var(--accent); }
  .qh-fold > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--radius); }
  /* The count. A fold that holds a list says how long the list is, so nothing
     ever looks smaller closed than it is. */
  .qh-fold .qh-n { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--qh-ink-3); white-space: nowrap; }
  .qh-fold .chv { width: 16px; height: 16px; flex: 0 0 auto; color: var(--qh-ink-3); transition: transform 0.2s var(--qh-ease); }
  .qh-fold[open] > summary .chv, .qh-fold:target > summary .chv { transform: rotate(180deg); }
  /* Opened, the body reads as a DRAWER: a hairline separates it from the
     header instead of the text simply appearing where there was none. */
  .qh-fold-b { border-top: 1px solid var(--border); margin: 0 16px; padding: 12px 0 16px; min-height: 0; }
  .qh-fold-b > :last-child { margin-bottom: 0; }
  .qh-fold-b p { font-size: 13px; line-height: 1.55; color: var(--qh-ink-2); margin: 0 0 8px; max-width: 820px; }
  .qh-fold-b ul, .qh-fold-b ol { margin: 0 0 8px; padding-left: 24px; display: grid; gap: 4px; }
  .qh-fold-b li { font-size: 13px; line-height: 1.55; color: var(--qh-ink-2); }
  .qh-fold-b a { color: var(--accent); }
  /* A single expansion can never blow up the page's scroll length. */
  .qh-fold-b--capped { max-height: 320px; overflow-y: auto; }

  /* THE FOLD ANIMATION the reference system does not have. ::details-content
     is the only handle on the closed subtree, so the house 0fr → 1fr grid fold
     hangs off it; browsers without it drop the whole rule and the element
     snaps, which is the correct degradation. content-visibility rides along
     with allow-discrete so the body is still painted while it closes. */
  .qh-fold::details-content { display: grid; grid-template-rows: 0fr; overflow: clip; }
  .qh-fold[open]::details-content, .qh-fold:target::details-content { grid-template-rows: 1fr; content-visibility: visible; }
  @media (prefers-reduced-motion: no-preference) {
    .qh-fold::details-content { transition: grid-template-rows 0.2s var(--qh-ease), content-visibility 0.2s allow-discrete; }
  }

  /* DEEP LINKING WITH NO SCRIPT. /oversize/texas#tx-office opens that fold on
     arrival even with JavaScript off; the script below additionally sets the
     real open attribute so the next click toggles from the right state. */
  .qh-fold:target { border-color: var(--accent); }
  /* A verbatim public-domain passage keeps the accent edge it had as a
     blockquote — the citation is the summary, the passage is what folds. */
  .qh-fold--quote { border-left: 2px solid var(--accent); }
  .qh-fold--quote > summary { color: var(--qh-ink-2); font-weight: 400; }
  .qh-fold--quote .qh-fold-b p { color: var(--qh-ink-2); }
  /* Inside a fold the drawer already IS the surface — the blockquote drops its
     own border, fill and radius so the passage does not sit in a box in a box. */
  .qh-fold-b .qh-quote { border: none; background: none; border-radius: 0; padding: 0; margin: 0; }

  /* Expand-all. Ships hidden and is revealed by script, so a reader with no
     JavaScript is never shown a control that cannot work. */
  .qh-foldbar { display: flex; justify-content: flex-start; margin: 0 0 8px; }
  .qh-expand { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--qh-ink-3); background: transparent; border: 1px solid var(--border); border-radius: var(--radius-pill); padding: 8px 16px; min-height: 44px; cursor: pointer; }
  .qh-expand:hover, .qh-expand:focus-visible { border-color: var(--accent); color: var(--accent); }

  /* FAQ — literally the same component, so a page has ONE disclosure pattern
     rather than a question that opens one way and a note that opens another. */
  .qh-faq { display: grid; gap: 4px; }

  @media (max-width: 980px) {
    .qh-body { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    /* ── THE RAIL BECOMES AN ON-PAGE TOC BOX. ─────────────────────────────
       Un-sticky it and it is a bare list running the width of the page; give
       it a border, a mono heading and TWO CSS COLUMNS and it is a contents
       box that costs half the height.

       CSS COLUMNS, NOT A GRID — and that distinction is the reason the old
       comment here forbade two columns. A two-track GRID fills row by row, so
       thirteen sections leave the thirteenth alone on a row of its own. CSS
       multi-column BALANCES: thirteen items are 7 + 6, both columns full, and
       there is no last row to orphan. break-inside: avoid keeps an item from
       splitting across the gutter. */
    .qh-rail { position: static; top: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 16px; }
    .qh-rail ol { display: block; columns: 2; column-gap: 32px; }
    .qh-rail li { break-inside: avoid; margin: 0 0 4px; }
    .qh-rail a { border-left: none; padding: 4px 0; }
  }
  /* TWO COLUMNS ALL THE WAY DOWN — deliberately NOT the reference system's
     collapse-to-one at 560px. Its TOC entries are prose ("Rate limits and
     quotas"); ours are numbered stubs of two or three words, and at 375px two
     columns are still ~155px wide, which fits the longest of them ("4.
     Overweight pricing") with room over. Collapsing would put thirteen items
     in one 460px stack — the exact defect Alex raised about the footer, moved
     to the top of the page. The gutter tightens instead, and the e2e suite
     asserts the document still never scrolls sideways at 375px. */
  @media (max-width: 560px) {
    .qh-rail { padding: 12px; }
    .qh-rail ol { column-gap: 16px; }
    .qh-rail a { font-size: 12px; }
  }
  @media (max-width: 760px) {
    .qh-short { padding: 12px; }
    .qh-fold > summary { padding: 12px; }
    .qh-fold-b { margin: 0 12px; }
    .qh-hero h1 { font-size: 28px; }
    .qh-hero { padding: 32px 16px 12px; }
    .qh-shell { padding: 8px 16px 32px; }
    .qh-sec h2 { font-size: 19px; }
    .qh-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .qh-legend { grid-template-columns: minmax(0, 1fr); }
    .qh-cards { grid-template-columns: minmax(0, 1fr); }
    .qh-prov { grid-template-columns: minmax(0, 1fr); }
    .qh-table th, .qh-table td { padding: 8px; }
    .qh-table th.qh-st, .qh-table td.qh-st { min-width: 108px; }
  }
`;

// ── Disclosure ─────────────────────────────────────────────────────────────

/** The one chevron. `.chv` is the rotation hook, not a component. */
export const CHEVRON =
  '<svg class="chv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 9l-7 7-7-7"/></svg>';

export interface Fold {
  /** Anchor id, so a link can open this exact fold (`#id`), with or without JS. */
  id?: string;
  /** The summary. ALWAYS VISIBLE — never the number, the cite or the tier. */
  label: string;
  /** A right-aligned mono count, where the fold holds a list. */
  count?: string;
  /** The explanation. This — and only this — is what folds. */
  bodyHtml: string;
  /** Ship this one open, so a page never opens as a stack of closed bars. */
  open?: boolean;
  /** Cap the revealed block at 320px and let it scroll inside itself. */
  capped?: boolean;
  /** An extra modifier class on the `<details>` — e.g. `qh-fold--quote`. */
  variant?: string;
}

/** One compact disclosure. Native `<details>`; works with scripting disabled. */
export function fold(f: Fold): string {
  return `<details class="qh-fold${f.variant ? ` ${f.variant}` : ''}"${f.id ? ` id="${esc(f.id)}"` : ''}${f.open ? ' open' : ''}>`
    + `<summary><span>${esc(f.label)}</span>`
    + `${f.count ? `<span class="qh-n">${esc(f.count)}</span>` : '<span></span>'}`
    + `${CHEVRON}</summary>`
    + `<div class="qh-fold-b${f.capped ? ' qh-fold-b--capped' : ''}">${f.bodyHtml}</div>`
    + '</details>';
}

/**
 * A group of folds. `data-qh-folds` is what the expand-all script looks for;
 * a group of one gets no control, because "expand all" over one row is noise.
 */
export function folds(items: Fold[]): string {
  if (items.length === 0) return '';
  return `<div class="qh-folds" data-qh-folds>${items.map(fold).join('')}</div>`;
}

/** The gist of a dense page, above the dense page. */
export function shortVersion(html: string): string {
  return `<div class="qh-short"><p><strong>The short version:</strong> ${html}</p></div>`;
}

/** A mono section eyebrow. Left-aligned, always. */
export function microLabel(text: string): string {
  return `<span class="qh-label">${esc(text)}</span>`;
}

/**
 * PROGRESSIVE ENHANCEMENT ONLY. Every fold on these pages already opens,
 * closes, focuses and announces itself with this script absent — it is native
 * `<details>`. What the script adds is the two things the element has no
 * built-in answer for: an expand-all control (rendered only once it exists, so
 * a reader with no JavaScript is never offered a dead button) and setting the
 * real `open` attribute on a hash-targeted fold, so the CSS `:target` reveal
 * and the next click agree about the state.
 */
export const HUB_SCRIPTS = `<script>
(function(){
  var groups = document.querySelectorAll('[data-qh-folds]');
  Array.prototype.forEach.call(groups, function(g){
    var items = Array.prototype.filter.call(
      g.querySelectorAll('details'),
      function(d){ return d.closest('[data-qh-folds]') === g; }
    );
    if (items.length < 3) return;
    var bar = document.createElement('div');
    bar.className = 'qh-foldbar';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qh-expand';
    var sync = function(){
      var open = 0;
      Array.prototype.forEach.call(items, function(d){ if (d.open) open++; });
      var all = open === items.length;
      btn.textContent = all ? 'Collapse all' : 'Expand all (' + items.length + ')';
      btn.setAttribute('aria-expanded', all ? 'true' : 'false');
    };
    btn.addEventListener('click', function(){
      var open = 0;
      Array.prototype.forEach.call(items, function(d){ if (d.open) open++; });
      var next = open !== items.length;
      Array.prototype.forEach.call(items, function(d){ d.open = next; });
      sync();
    });
    Array.prototype.forEach.call(items, function(d){ d.addEventListener('toggle', sync); });
    sync();
    bar.appendChild(btn);
    g.parentNode.insertBefore(bar, g);
  });

  function openHash(){
    var h = location.hash;
    if (!h || h.length < 2) return;
    var el;
    try { el = document.querySelector(h); } catch (e) { return; }
    while (el) {
      if (el.tagName === 'DETAILS') el.open = true;
      el = el.parentElement;
    }
  }
  window.addEventListener('hashchange', openHash);
  openHash();
})();
</script>`;

// ── Cell + citation rendering ──────────────────────────────────────────────

const ABSENCE_TEXT: Record<string, string> = {
  'no-data': 'Not yet covered',
  'not-published': 'None published',
  conflict: 'Sources disagree',
};

/** A short, safe pinpoint cite — the full text stays in the link's title. */
function shortCite(source: SourceDoc): string {
  const raw = source.cite ?? source.title;
  return raw.length > 46 ? `${raw.slice(0, 45)}…` : raw;
}

export function citeLink(source: SourceDoc, text: string): string {
  const title = `${source.title} — ${source.publisher}${source.cite ? ` — ${source.cite}` : ''}`;
  return `<a href="${esc(source.url)}" title="${esc(title)}" rel="noopener" target="_blank">${esc(text)}</a>`;
}

export function revisionLine(source: SourceDoc): string {
  const rev = source.revisedOn ? `rev. ${source.revisedOn}` : 'undated document';
  return `${rev} · read ${source.retrievedOn}`;
}

/**
 * One table cell. The value links to the document it came from, and the line
 * below it carries the document's OWN revision date and the date we read it —
 * two different dates that a single "last updated" stamp would conflate.
 */
export function renderCell(cell: HubCell): string {
  if (cell.absence === 'conflict' && cell.conflict) {
    const both = cell.conflict
      .map((c) => `${esc(c.text)} per ${citeLink(c.source, shortCite(c.source))}`)
      .join(' — versus — ');
    return `<td class="is-conflict"><span class="qh-v">Sources disagree</span><span class="qh-rev">${both}</span></td>`;
  }
  if (cell.text === null) {
    return `<td><span class="qh-v qh-none">${esc(ABSENCE_TEXT[cell.absence ?? 'no-data'] ?? 'Not yet covered')}</span></td>`;
  }
  const value = cell.source ? citeLink(cell.source, cell.text) : esc(cell.text);
  const rev = cell.source ? `<span class="qh-rev">${esc(revisionLine(cell.source))}</span>` : '';
  return `<td><span class="qh-v">${value}</span>${rev}</td>`;
}

export function provenanceBand(p: Provenance, extra: string[] = []): string {
  const bits: string[] = [
    `${p.count} source document${p.count === 1 ? '' : 's'} on file`,
    p.oldestRevision === null
      ? 'no document states a revision date'
      : `oldest revision ${p.oldestRevision}`,
    p.lastRetrieved === null ? 'never retrieved' : `last retrieved ${p.lastRetrieved}`,
    ...extra,
  ];
  // Padded to an even count so the two-column band never leaves one pill alone.
  if (bits.length % 2 === 1) bits.push('Free · no account needed');
  return `<div class="qh-prov">${bits.map((b) => `<span>${esc(b)}</span>`).join('')}</div>`;
}

export function sourceList(sources: SourceDoc[]): string {
  if (sources.length === 0) return '<p class="qh-sub">No source documents are on file for this page.</p>';
  return `<ul class="qh-sources">${sources
    .map(
      (s) =>
        `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title)}</a> — <span class="qh-pub">${esc(s.publisher)}</span>${
          s.cite ? ` — ${esc(s.cite)}` : ''
        }<br>${esc(revisionLine(s))}</li>`,
    )
    .join('')}</ul>`;
}

// ── JSON-LD ────────────────────────────────────────────────────────────────

export interface Crumb {
  name: string;
  path?: string;
}

export function jsonLdBreadcrumb(crumbs: Crumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...crumbs].map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: `${SITE}${c.path}` } : {}),
    })),
  };
}

export function jsonLdFaq(faqs: Array<{ q: string; a: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/**
 * `Dataset`, and only where one genuinely applies: a page that publishes a
 * table of measured values with a stated temporal coverage and a list of the
 * documents it is based on. A prose explainer gets `WebPage`, not this.
 */
export function jsonLdDataset(opts: {
  name: string;
  description: string;
  path: string;
  variableMeasured: string[];
  isBasedOn: string[];
  temporalCoverageFrom: string | null;
  dateModified: string | null;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: opts.name,
    description: opts.description,
    url: `${SITE}${opts.path}`,
    license: 'https://quotefleet.net/terms',
    creator: { '@type': 'Organization', name: 'QuoteFleet', url: SITE },
    isAccessibleForFree: true,
    variableMeasured: opts.variableMeasured,
    ...(opts.isBasedOn.length > 0 ? { isBasedOn: opts.isBasedOn.slice(0, 60) } : {}),
    ...(opts.temporalCoverageFrom ? { temporalCoverage: `${opts.temporalCoverageFrom}/..` } : {}),
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
  };
}

export function jsonLdWebApplication(opts: {
  name: string;
  description: string;
  path: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: opts.name,
    description: opts.description,
    url: `${SITE}${opts.path}`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}

export function jsonLdCollection(opts: {
  name: string;
  description: string;
  path: string;
  items: Array<{ name: string; path: string }>;
  dateModified: string | null;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: `${SITE}${opts.path}`,
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.items.length,
      itemListElement: opts.items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        url: `${SITE}${it.path}`,
      })),
    },
  };
}

// ── The shell ──────────────────────────────────────────────────────────────

export interface HubPageOpts {
  title: string;
  description: string;
  path: string;
  crumbs: Crumb[];
  eyebrow: string;
  h1: string;
  lead: string;
  /** Rendered under the lead — the computed provenance band, where one applies. */
  bandHtml?: string;
  truthHtml?: string;
  /** `{ id, label }` per H2, which IS the sticky rail AND the anchor set. */
  rail?: Array<{ id: string; label: string }>;
  bodyHtml: string;
  jsonLd: Array<Record<string, unknown>>;
  /** `max(retrievedOn)` over the sources rendered. NEVER the deploy time. */
  dateModified?: string | null;
  extraCss?: string;
  extraScripts?: string;
}

export function hubPage(opts: HubPageOpts): string {
  const crumbHtml = `<nav class="qh-crumbs" aria-label="Breadcrumb">${[
    { name: 'Home', path: '/' },
    ...opts.crumbs,
  ]
    .map((c, i, arr) =>
      i === arr.length - 1 || !c.path
        ? `<span aria-current="page">${esc(c.name)}</span>`
        : `<a href="${esc(c.path)}">${esc(c.name)}</a> <span aria-hidden="true">›</span> `,
    )
    .join('')}</nav>`;

  const railHtml =
    opts.rail && opts.rail.length > 0
      ? `<aside class="qh-rail"><h2>On this page</h2><ol>${opts.rail
          .map((r) => `<li><a href="#${esc(r.id)}">${esc(r.label)}</a></li>`)
          .join('')}</ol></aside>`
      : '';

  const body = `
  <section class="hero qh-hero">
    <div class="container-narrow">
      ${crumbHtml}
      <p class="qh-eyebrow">${esc(opts.eyebrow)}</p>
      <h1>${esc(opts.h1)}</h1>
      <p class="lead">${opts.lead}</p>
      ${opts.bandHtml ?? ''}
      ${opts.truthHtml ?? ''}
    </div>
  </section>

  <main class="qh-shell">
    <div class="qh-body${railHtml === '' ? ' qh-body--full' : ''}">
      ${railHtml}
      <div class="qh-content">${opts.bodyHtml}</div>
    </div>
  </main>`;

  const ld = opts.jsonLd
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
    .join('\n  ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}">
  <link rel="canonical" href="${SITE}${esc(opts.path)}">
  ${opts.dateModified ? `<meta name="last-modified" content="${esc(opts.dateModified)}">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/nav-unify.css">
  <style>${HUB_CSS}${opts.extraCss ?? ''}</style>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#0b0f15">
  <meta property="og:title" content="${esc(opts.title)}">
  <meta property="og:description" content="${esc(opts.description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/brand/og-image-1200x630.png">
  ${ld}
</head>
<body>
  ${FULL_SITE_HEADER}
  ${body}
  ${PREMIUM_FOOTER}
  ${HEADER_SCRIPTS}
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
  ${HUB_SCRIPTS}
  ${opts.extraScripts ?? ''}
</body>
</html>`;
}
