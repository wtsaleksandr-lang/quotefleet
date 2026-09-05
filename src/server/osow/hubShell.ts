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

  .qh-sec { margin: 0 0 32px; scroll-margin-top: 96px; }
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
  .qh-table tbody tr:nth-child(even) td { background: var(--surface-2); }
  .qh-table tbody tr:nth-child(even) td.qh-st { background: var(--surface-2); }
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

  /* FAQ. */
  .qh-faq { display: grid; gap: 8px; }
  .qh-faq details { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 12px; }
  .qh-faq summary { font-size: 14px; color: var(--ink); cursor: pointer; line-height: 1.5; }
  .qh-faq p { margin: 8px 0 0; font-size: 13px; line-height: 1.55; color: var(--ink-soft); }

  @media (max-width: 980px) {
    .qh-body { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .qh-rail { position: static; top: auto; }
    /* ONE column, deliberately. A two-column rail leaves the last item alone
       on its own row whenever the section count is odd — three sections on a
       topic table, thirteen on a state page — which is the orphaned-group
       defect this codebase keeps fixing. One column cannot orphan anything. */
    .qh-rail ol { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
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
  ${opts.extraScripts ?? ''}
</body>
</html>`;
}
