/**
 * Server-rendered HTML for the PUBLIC carrier directory + Compliance Tools.
 *
 * These pages are unauthenticated and SEO-first: the carrier lists, port/state
 * grids and per-page <title>/description are rendered server-side (real data in
 * the initial HTML, no client fetch required to see content). They reuse the
 * QuoteFleet marketing shell (style.css, topnav, footer, fonts, favicons) so
 * they're visually consistent with /marketplace + /tools, and lean on CSS
 * design tokens (var(--surface) etc.) for light/dark theme parity.
 *
 * Routes that use these live in src/server/routes/directory.ts.
 *
 * HONEST DATA NOTE: FMCSA public data gives us authority, fleet, safety rating
 * and (derived) drayage/intermodal + nearest-port. It does NOT give UIIA / TWIC
 * / Hazmat / Reefer per-carrier flags — those are surfaced as external tools or
 * "coming soon", never faked.
 */
import type {
  DirectorySummary,
  CarrierListResult,
  VisibleCarrier,
  DirectoryFilters,
  FacetCounts,
  CityCount,
  FleetBucketId,
  SafetyId,
} from './queries.js';
import { FLEET_BUCKETS, SAFETY_OPTIONS, SORT_OPTIONS, citySlugify, titleCaseCity } from './queries.js';
import { US_STATES, stateByCode, type UsState } from './usStates.js';
import { CONTAINER_PORTS, portByCode, type ContainerPort } from './containerPorts.js';

const SITE = 'https://quotefleet.net';

/** Codes we recognize as US states/territories — used to keep the "browse by
 *  state" grid US-focused (FMCSA data also carries Canadian/Mexican codes). */
const US_STATE_CODES = new Set(US_STATES.map((s) => s.code));

// ─── Small HTML helpers ───────────────────────────────────────────────────
export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string),
  );
}

const fmtNum = (n: number | null | undefined): string =>
  n == null ? '—' : Number(n).toLocaleString('en-US');

function safetyLabel(code: string | null): { text: string; tone: 'good' | 'warn' | 'bad' | 'none' } {
  switch ((code || '').toUpperCase()) {
    case 'S':
      return { text: 'Satisfactory', tone: 'good' };
    case 'C':
      return { text: 'Conditional', tone: 'warn' };
    case 'U':
      return { text: 'Unsatisfactory', tone: 'bad' };
    default:
      return { text: 'Not rated', tone: 'none' };
  }
}

function authorityLabel(type: string | null): string {
  if (!type) return 'Authority on file';
  const parts = type.split(',').map((p) => p.trim()).filter(Boolean);
  const nice = parts.map((p) => (p === 'common' ? 'Common' : p === 'contract' ? 'Contract' : p));
  return nice.length ? nice.join(' + ') + ' authority' : 'Authority on file';
}

// ─── Shared page shell ────────────────────────────────────────────────────
const DIRECTORY_CSS = `
  .dir-shell { max-width: 1100px; margin: 0 auto; padding: 28px; }
  .dir-hero { padding: 40px 28px 22px; }
  .dir-hero .container-narrow { max-width: 1100px; margin: 0 auto; }
  .dir-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 10px; }
  .dir-hero .lead { max-width: 640px; }
  .dir-stats { display: flex; gap: 22px; flex-wrap: wrap; margin-top: 18px; }
  .dir-stat { display: flex; flex-direction: column; }
  .dir-stat b { font-size: 26px; font-family: var(--font-mono); color: var(--accent); }
  .dir-stat span { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-family: var(--font-mono); }
  .dir-section-h { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 34px 0 14px; }
  .dir-section-h h2 { font-size: 22px; margin: 0; }
  .dir-section-h .muted-small { white-space: nowrap; }
  .dir-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .dir-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; text-decoration: none; color: inherit; display: block; transition: border-color 0.15s ease, transform 0.15s ease; }
  .dir-card:hover { border-color: var(--border-strong); transform: translateY(-2px); }
  .dir-card h3 { margin: 0 0 4px; font-size: 17px; }
  .dir-card .sub { font-size: 12px; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.04em; }
  .dir-card .cnt { margin-top: 12px; font-size: 22px; font-family: var(--font-mono); color: var(--accent); }
  .dir-card .cnt small { font-size: 11px; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; margin-left: 4px; }
  .dir-chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 4px; }
  .dir-chip { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-soft); text-decoration: none; white-space: nowrap; }
  .dir-chip:hover { border-color: var(--border-strong); }
  .dir-chip.active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .carrier-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; text-decoration: none; color: inherit; display: block; transition: border-color 0.15s ease; }
  .carrier-card:hover { border-color: var(--border-strong); }
  .carrier-card .top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .carrier-card h3 { margin: 0 0 3px; font-size: 16px; line-height: 1.3; }
  .carrier-card .meta { font-size: 12px; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.04em; }
  .carrier-facts { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 12px; }
  .carrier-facts .f { display: flex; flex-direction: column; }
  .carrier-facts .f b { font-size: 15px; font-family: var(--font-mono); }
  .carrier-facts .f span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
  .pill { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 8px; border-radius: 4px; white-space: nowrap; }
  .pill-dray { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent); }
  .pill-good { background: rgba(46, 160, 87, 0.14); color: #57c274; border: 1px solid rgba(46, 160, 87, 0.4); }
  .pill-warn { background: rgba(214, 158, 46, 0.14); color: #e0b054; border: 1px solid rgba(214, 158, 46, 0.4); }
  .pill-bad { background: rgba(220, 76, 76, 0.14); color: #e88; border: 1px solid rgba(220, 76, 76, 0.4); }
  .pill-none { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
  .dir-pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 28px 0 8px; }
  .dir-pager .muted-small { font-family: var(--font-mono); }
  .dir-empty { padding: 60px 24px; text-align: center; color: var(--muted); }
  .src-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .src-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; text-decoration: none; color: inherit; display: block; }
  .src-card:hover { border-color: var(--border-strong); }
  .src-card h3 { margin: 0 0 6px; font-size: 16px; }
  .src-card p { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.5; }
  .src-card .go { display: inline-block; margin-top: 10px; font-size: 12px; font-family: var(--font-mono); color: var(--accent); }
  .lookup-box { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 22px; }
  .lookup-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; }
  .lookup-row .input { flex: 1 1 220px; }
  .lookup-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .lookup-toggle button { background: transparent; color: var(--muted); border: 0; padding: 0 16px; font-family: var(--font-mono); font-size: 13px; cursor: pointer; }
  .lookup-toggle button.on { background: var(--accent-soft); color: var(--accent); }
  .lookup-result { margin-top: 18px; }
  .lookup-result .row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
  .lookup-result .row:last-child { border-bottom: 0; }
  .lookup-result .row .k { color: var(--muted); }
  .lookup-result .row .v { font-family: var(--font-mono); text-align: right; }
  /* Breadcrumbs */
  .dir-crumbs { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.03em; color: var(--muted); margin: 0 0 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .dir-crumbs a { color: var(--muted); text-decoration: none; }
  .dir-crumbs a:hover { color: var(--accent); }
  .dir-crumbs .sep { opacity: 0.5; }
  .dir-crumbs .cur { color: var(--ink-soft); }
  /* Faceted two-column layout */
  .dir-layout { display: grid; grid-template-columns: 258px minmax(0, 1fr); gap: 24px; align-items: start; }
  .dir-rail { position: sticky; top: 16px; }
  .facet-group { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 14px 16px; margin-bottom: 12px; }
  .facet-group h3 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); font-family: var(--font-mono); }
  .facet-src { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); opacity: 0.8; display: block; margin: 0 0 8px; }
  .facet-opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 8px; text-decoration: none; color: var(--ink-soft); font-size: 13px; border: 1px solid transparent; }
  .facet-opt:hover { background: var(--surface-2); }
  .facet-opt .cb { font-family: var(--font-mono); font-size: 11px; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; min-width: 20px; text-align: center; }
  .facet-opt.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .facet-opt.active .cb { color: var(--accent); border-color: var(--accent); background: transparent; }
  .facet-opt.disabled { opacity: 0.5; cursor: not-allowed; }
  .facet-opt.disabled .cb { text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; }
  .facet-opt .lbl { display: flex; align-items: center; gap: 7px; }
  .facet-check { width: 14px; height: 14px; border: 1px solid var(--border-strong); border-radius: 4px; display: inline-block; flex: 0 0 auto; }
  .facet-opt.active .facet-check { background: var(--accent); border-color: var(--accent); }
  .rail-toggle { display: none; }
  .results-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 14px; }
  .results-head .rc { font-size: 15px; }
  .results-head .rc b { font-family: var(--font-mono); color: var(--accent); font-size: 20px; }
  .sort-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .sort-row .sl { font-size: 11px; color: var(--muted); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; }
  .applied-chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 14px; align-items: center; }
  .applied-chip { font-size: 12px; font-family: var(--font-mono); padding: 5px 10px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); background: var(--accent-soft); text-decoration: none; display: inline-flex; gap: 6px; align-items: center; }
  .applied-chip .x { opacity: 0.7; }
  .applied-chip:hover .x { opacity: 1; }
  .applied-clear { font-size: 12px; font-family: var(--font-mono); color: var(--muted); text-decoration: underline; }
  .dir-pagenums { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: center; margin: 26px 0 8px; }
  .dir-pagenums a, .dir-pagenums span { min-width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 8px; text-decoration: none; color: var(--ink-soft); font-family: var(--font-mono); font-size: 13px; padding: 0 8px; }
  .dir-pagenums a:hover { border-color: var(--border-strong); }
  .dir-pagenums .cur { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .dir-pagenums .gap { border: 0; min-width: 16px; color: var(--muted); }
  @media (max-width: 900px) {
    .dir-layout { grid-template-columns: 1fr; }
    .dir-rail { position: static; }
    .rail-toggle { display: block; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 16px; color: var(--ink); font-size: 14px; font-family: var(--font-mono); cursor: pointer; margin-bottom: 12px; }
    .dir-rail[data-collapsed="1"] .facet-group { display: none; }
  }
  @media (max-width: 640px) {
    .dir-hero h1 { font-size: 30px; }
    .dir-shell, .dir-hero { padding-left: 18px; padding-right: 18px; }
    .dir-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
    .carrier-facts { gap: 14px; }
  }
  @media (max-width: 420px) {
    .dir-grid { grid-template-columns: 1fr; }
  }
`;

interface LayoutOpts {
  title: string;
  description: string;
  canonicalPath: string;
  bodyHtml: string;
  /** JSON-LD blocks (already stringified objects) to inject into <head>. */
  jsonLd?: string[];
}

export function layout({ title, description, canonicalPath, bodyHtml, jsonLd }: LayoutOpts): string {
  const ld = (jsonLd ?? [])
    .filter(Boolean)
    .map((j) => `<script type="application/ld+json">${j}</script>`)
    .join('\n  ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${esc(canonicalPath)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <style>${DIRECTORY_CSS}</style>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#0b0f15">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/brand/og-image-1200x630.png">
  ${ld}
</head>
<body>
  <header class="topnav topnav--mobile-menu">
    <div class="topnav-inner">
      <a href="/" class="brand-mark">
        <span class="logo"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>
        QuoteFleet
      </a>
      <span class="topnav-spacer"></span>
      <a class="nav-link" href="/directory">Directory</a>
      <a class="nav-link" href="/compliance">Compliance</a>
      <a class="nav-link" href="/glossary">Glossary</a>
      <a class="btn btn-primary always-show" href="/signup">Claim your listing <span class="arr">→</span></a>
      <button type="button" class="topnav-burger" aria-label="Open menu" aria-expanded="false" aria-controls="topnav-mobile-menu">
        <svg class="ico-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
        <svg class="ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>
    </div>
    <nav class="topnav-mobile" id="topnav-mobile-menu" hidden aria-label="Site navigation">
      <a href="/directory">Directory</a>
      <a href="/compliance">Compliance</a>
      <a href="/glossary">Glossary</a>
      <a href="/services">Services</a>
      <a href="/tools">Rate calculator</a>
      <a href="/pricing">Pricing</a>
      <a href="/">Home</a>
      <a class="tn-cta" href="/signup">Claim your listing →</a>
    </nav>
  </header>
  ${bodyHtml}
  <footer class="site-footer">
    © <span id="year"></span> QuoteFleet · <a href="/directory">Directory</a> · <a href="/compliance">Compliance</a> · <a href="/glossary">Glossary</a> · <a href="/services">Services</a> · <a href="/marketplace/">Marketplace</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/">Home</a>
  </footer>
  <script>document.getElementById('year').textContent = new Date().getFullYear();</script>
  <script>(function(){var b=document.querySelector('.topnav-burger'),m=document.getElementById('topnav-mobile-menu');if(!b||!m)return;function set(o){b.setAttribute('aria-expanded',o?'true':'false');b.setAttribute('aria-label',o?'Close menu':'Open menu');if(o)m.removeAttribute('hidden');else m.setAttribute('hidden','');}b.addEventListener('click',function(e){e.stopPropagation();set(b.getAttribute('aria-expanded')!=='true');});document.addEventListener('click',function(e){if(b.getAttribute('aria-expanded')==='true'&&!m.contains(e.target)&&!b.contains(e.target))set(false);});document.addEventListener('keydown',function(e){if(e.key==='Escape')set(false);});})();</script>
  <script src="/marketing-chat.js" defer></script>
</body>
</html>`;
}

/**
 * Display name for a carrier: prefer the DBA / trade name, but fall back to the
 * legal name when the DBA is a bare single word too short to identify the
 * carrier on its own (e.g. FMCSA lists "SELECT" for "SELECT WATER SOLUTIONS LLC").
 */
export function carrierName(c: { dbaName?: string | null; legalName: string }): string {
  const dba = (c.dbaName ?? '').trim();
  if (dba && (dba.includes(' ') || dba.length >= 8)) return dba;
  return c.legalName;
}

// ─── Carrier card (shared by state + port pages) ──────────────────────────
export function carrierCard(c: VisibleCarrier): string {
  const sr = safetyLabel(c.safetyRating);
  const cityState = [c.city, c.state].filter(Boolean).join(', ');
  const idMeta = [c.usdot ? `USDOT ${esc(c.usdot)}` : '', c.mcNumber ? `MC ${esc(c.mcNumber)}` : '']
    .filter(Boolean)
    .join(' · ');
  return `<a class="carrier-card" href="/directory/carrier/${encodeURIComponent(c.slug)}">
    <div class="top">
      <div>
        <h3>${esc(carrierName(c))}</h3>
        <div class="meta">${esc(cityState)}${idMeta ? ' · ' + idMeta : ''}</div>
      </div>
      ${c.intermodal ? '<span class="pill pill-dray">Drayage</span>' : ''}
    </div>
    <div class="carrier-facts">
      <div class="f"><b>${fmtNum(c.powerUnits)}</b><span>Power units</span></div>
      <div class="f"><b>${fmtNum(c.drivers)}</b><span>Drivers</span></div>
      <div class="f"><b>${esc(authorityLabel(c.authorityType).replace(' authority', ''))}</b><span>Authority</span></div>
    </div>
    <div class="dir-chips" style="margin-top: 12px;">
      <span class="pill pill-${sr.tone}">${esc(sr.text)}</span>
    </div>
  </a>`;
}

// ─── JSON-LD helpers ──────────────────────────────────────────────────────
/** Serialize an object as a JSON-LD-safe string (guards against </script>). */
function ld(obj: unknown): string {
  // Escaping '<' is enough to prevent a </script> breakout inside the block.
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

export interface Crumb {
  name: string;
  path?: string; // omitted on the current (last) crumb
}

function jsonLdBreadcrumb(crumbs: Crumb[]): string {
  return ld({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: SITE + c.path } : {}),
    })),
  });
}

function jsonLdItemListAndCollection(opts: {
  name: string;
  description: string;
  path: string;
  carriers: VisibleCarrier[];
  total: number;
}): string {
  return ld({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: SITE + opts.path,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.total,
      itemListElement: opts.carriers.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/directory/carrier/${encodeURIComponent(c.slug)}`,
        name: carrierName(c),
      })),
    },
  });
}

function jsonLdFaq(faqs: Array<{ q: string; a: string }>): string {
  return ld({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  });
}

function jsonLdCarrier(c: VisibleCarrier): string {
  const addr = {
    '@type': 'PostalAddress',
    addressCountry: 'US',
    ...(c.city ? { addressLocality: c.city } : {}),
    ...(c.state ? { addressRegion: c.state } : {}),
    ...(c.zip ? { postalCode: c.zip } : {}),
  };
  return ld({
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'Organization'],
    name: carrierName(c),
    legalName: c.legalName,
    url: `${SITE}/directory/carrier/${encodeURIComponent(c.slug)}`,
    identifier: [
      { '@type': 'PropertyValue', propertyID: 'USDOT', value: c.usdot },
      ...(c.mcNumber ? [{ '@type': 'PropertyValue', propertyID: 'MC', value: c.mcNumber }] : []),
    ],
    // Suppress contact fields entirely when the carrier has opted out.
    ...(!c.contactHidden && c.phone ? { telephone: c.phone } : {}),
    ...(!c.contactHidden && c.email ? { email: c.email } : {}),
    address: addr,
    ...(c.city || c.state ? { areaServed: [c.city, c.state].filter(Boolean).join(', ') } : {}),
    knowsAbout: c.intermodal ? ['Container drayage', 'Intermodal trucking'] : ['Freight trucking'],
  });
}

// ─── Faceted directory rendering ──────────────────────────────────────────
interface FacetScope {
  kind: 'all' | 'state' | 'port' | 'city';
  basePath: string;
  locked: Set<string>;
  state?: UsState;
  port?: ContainerPort;
  city?: { name: string; slug: string };
}

/** Active facet dims serialized as query params (respecting path-locked dims). */
function currentParams(f: DirectoryFilters, locked: Set<string>): Record<string, string> {
  const p: Record<string, string> = {};
  if (!locked.has('state') && f.state) p.state = f.state;
  if (!locked.has('city') && f.citySlug) p.city = f.citySlug;
  if (f.fleet) p.fleet = f.fleet;
  if (f.safety) p.safety = f.safety;
  if (f.authorityActive) p.authority = 'active';
  if (f.intermodal) p.intermodal = '1';
  if (f.recent) p.recent = '1';
  if (f.sort && f.sort !== 'featured') p.sort = f.sort;
  return p;
}

type FacetChange = Partial<Record<'state' | 'city' | 'fleet' | 'safety' | 'authority' | 'intermodal' | 'recent' | 'sort' | 'page', string | null>>;

/** Build an href for the current scope with one dimension changed. */
function hrefWith(scope: FacetScope, f: DirectoryFilters, change: FacetChange, opts?: { keepPage?: boolean }): string {
  const p = currentParams(f, scope.locked);
  if (opts?.keepPage && f.page > 1) p.page = String(f.page);
  for (const [k, v] of Object.entries(change)) {
    if (v == null || v === '') delete p[k];
    else p[k] = v;
  }
  const qs = new URLSearchParams(p).toString();
  return qs ? `${scope.basePath}?${qs}` : scope.basePath;
}

function facetOptionRow(active: boolean, href: string, label: string, count: number): string {
  return `<a class="facet-opt ${active ? 'active' : ''}" href="${href}">
    <span class="lbl"><span class="facet-check"></span>${esc(label)}</span>
    <span class="cb">${fmtNum(count)}</span>
  </a>`;
}

function disabledFacetRow(label: string): string {
  return `<span class="facet-opt disabled"><span class="lbl"><span class="facet-check"></span>${esc(label)}</span><span class="cb">claim</span></span>`;
}

function renderSidebar(scope: FacetScope, f: DirectoryFilters, counts: FacetCounts, summary?: DirectorySummary): string {
  // Tier 1 — Fleet size.
  const fleet = FLEET_BUCKETS.map((b) =>
    facetOptionRow(f.fleet === b.id, hrefWith(scope, f, { fleet: f.fleet === b.id ? null : b.id }), b.label, counts.fleet[b.id]),
  ).join('\n');

  // Tier 1 — Safety rating.
  const safety = SAFETY_OPTIONS.map((s) =>
    facetOptionRow(f.safety === s.id, hrefWith(scope, f, { safety: f.safety === s.id ? null : s.id }), s.label, counts.safety[s.id]),
  ).join('\n');

  // Tier 1 — Active authority (boolean).
  const authority = facetOptionRow(
    f.authorityActive,
    hrefWith(scope, f, { authority: f.authorityActive ? null : 'active' }),
    'Active authority only',
    counts.authorityActive,
  );

  // Tier 2 — proxies (source-tagged).
  const intermodal = facetOptionRow(
    f.intermodal,
    hrefWith(scope, f, { intermodal: f.intermodal ? null : '1' }),
    'Drayage / intermodal',
    counts.intermodal,
  );
  const recent = facetOptionRow(
    f.recent,
    hrefWith(scope, f, { recent: f.recent ? null : '1' }),
    'Updated in last 12 mo',
    counts.recent,
  );

  // 'all' scope only — quick state refine (links to canonical state pages / scope).
  let stateGroup = '';
  if (scope.kind === 'all' && summary) {
    const top = summary.byState.filter((s) => US_STATE_CODES.has(s.state)).slice(0, 12);
    if (top.length) {
      const links = top
        .map((s) => {
          const st = stateByCode(s.state)!;
          const active = f.state === s.state;
          return `<a class="facet-opt ${active ? 'active' : ''}" href="${hrefWith(scope, f, { state: active ? null : s.state })}">
            <span class="lbl"><span class="facet-check"></span>${esc(st.name)}</span>
            <span class="cb">${fmtNum(s.count)}</span>
          </a>`;
        })
        .join('\n');
      stateGroup = `<div class="facet-group"><h3>State</h3><span class="facet-src">FMCSA physical state · top 12</span>${links}
        <a class="facet-opt" href="/directory" style="justify-content:center;"><span class="lbl">All states &amp; ports →</span></a></div>`;
    }
  }

  const tier3 = ['Hazmat', 'Reefer', 'UIIA member', 'TWIC-ready', 'C-TPAT / bonded', 'Verified profile']
    .map(disabledFacetRow)
    .join('\n');

  return `<aside class="dir-rail" id="dir-rail">
    <button type="button" class="rail-toggle" id="rail-toggle" aria-expanded="true">Filters ▾</button>
    ${stateGroup}
    <div class="facet-group"><h3>Fleet size</h3><span class="facet-src">FMCSA power units</span>${fleet}</div>
    <div class="facet-group"><h3>Safety rating</h3><span class="facet-src">FMCSA safety rating</span>${safety}</div>
    <div class="facet-group"><h3>Authority</h3><span class="facet-src">FMCSA operating authority</span>${authority}</div>
    <div class="facet-group"><h3>Service type</h3><span class="facet-src">Proxy · FMCSA cargo &amp; MCS-150</span>${intermodal}${recent}</div>
    <div class="facet-group"><h3>Credentials</h3><span class="facet-src">Self-declared · verify via profile claim</span>${tier3}</div>
  </aside>
  <script>
    (function(){
      var t=document.getElementById('rail-toggle'),r=document.getElementById('dir-rail');
      if(!t||!r)return;
      function apply(){var c=window.matchMedia('(max-width:900px)').matches;if(c){r.setAttribute('data-collapsed','1');t.setAttribute('aria-expanded','false');}else{r.removeAttribute('data-collapsed');t.setAttribute('aria-expanded','true');}}
      apply();
      t.addEventListener('click',function(){var c=r.getAttribute('data-collapsed')==='1';if(c){r.removeAttribute('data-collapsed');t.setAttribute('aria-expanded','true');t.textContent='Filters ▴';}else{r.setAttribute('data-collapsed','1');t.setAttribute('aria-expanded','false');t.textContent='Filters ▾';}});
    })();
  </script>`;
}

function appliedChips(scope: FacetScope, f: DirectoryFilters): string {
  const chips: string[] = [];
  const add = (label: string, change: FacetChange) =>
    chips.push(`<a class="applied-chip" href="${hrefWith(scope, f, change)}">${esc(label)} <span class="x">✕</span></a>`);
  if (!scope.locked.has('state') && f.state) add(stateByCode(f.state)?.name ?? f.state, { state: null });
  if (!scope.locked.has('city') && f.citySlug) add(f.citySlug.replace(/-/g, ' '), { city: null });
  if (f.fleet) add(FLEET_BUCKETS.find((b) => b.id === f.fleet)?.label ?? f.fleet, { fleet: null });
  if (f.safety) add(SAFETY_OPTIONS.find((s) => s.id === f.safety)?.label ?? f.safety, { safety: null });
  if (f.authorityActive) add('Active authority', { authority: null });
  if (f.intermodal) add('Drayage / intermodal', { intermodal: null });
  if (f.recent) add('Updated ≤12 mo', { recent: null });
  if (!chips.length) return '';
  return `<div class="applied-chips">${chips.join('\n')}<a class="applied-clear" href="${scope.basePath}">Clear all</a></div>`;
}

function sortRow(scope: FacetScope, f: DirectoryFilters): string {
  const links = SORT_OPTIONS.map(
    (s) =>
      `<a class="dir-chip ${f.sort === s.id ? 'active' : ''}" href="${hrefWith(scope, f, { sort: s.id === 'featured' ? null : s.id })}">${esc(s.label)}</a>`,
  ).join('\n');
  return `<div class="sort-row"><span class="sl">Sort</span>${links}</div>`;
}

/** Windowed numbered pagination (1 … n-1 [n] n+1 … last). */
function numberedPager(scope: FacetScope, f: DirectoryFilters, list: CarrierListResult): string {
  if (list.totalPages <= 1) return '';
  const cur = list.page;
  const last = list.totalPages;
  const link = (p: number, label?: string, cls = '') =>
    `<a class="${cls}" href="${hrefWith(scope, f, { page: p > 1 ? String(p) : null }, { keepPage: false })}">${esc(label ?? String(p))}</a>`;
  const nums: Array<number | '…'> = [];
  const push = (p: number) => nums.push(p);
  push(1);
  const lo = Math.max(2, cur - 2);
  const hi = Math.min(last - 1, cur + 2);
  if (lo > 2) nums.push('…');
  for (let p = lo; p <= hi; p++) push(p);
  if (hi < last - 1) nums.push('…');
  if (last > 1) push(last);
  const body = nums
    .map((n) => (n === '…' ? '<span class="gap">…</span>' : n === cur ? `<span class="cur">${n}</span>` : link(n)))
    .join('\n');
  return `<nav class="dir-pagenums" aria-label="Pagination">
    ${cur > 1 ? link(cur - 1, '← Prev') : ''}
    ${body}
    ${cur < last ? link(cur + 1, 'Next →') : ''}
  </nav>`;
}

function crumbsHtml(crumbs: Crumb[]): string {
  return `<nav class="dir-crumbs" aria-label="Breadcrumb">${crumbs
    .map((c, i) =>
      i === crumbs.length - 1
        ? `<span class="cur">${esc(c.name)}</span>`
        : `<a href="${esc(c.path ?? '/directory')}">${esc(c.name)}</a><span class="sep">/</span>`,
    )
    .join('')}</nav>`;
}

interface FacetedCfg {
  scope: FacetScope;
  list: CarrierListResult;
  counts: FacetCounts;
  filters: DirectoryFilters;
  crumbs: Crumb[];
  h1: string;
  intro: string;
  title: string;
  description: string;
  canonicalPath: string;
  summary?: DirectorySummary;
  extraModulesHtml?: string;
  faqsHtml?: string;
  jsonLd: string[];
}

function renderFacetedResults(cfg: FacetedCfg): string {
  const { scope, list, counts, filters } = cfg;
  const cards = list.carriers.length
    ? `<div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">${list.carriers
        .map(carrierCard)
        .join('\n')}</div>`
    : `<div class="dir-empty">No carriers match these filters. <a href="${scope.basePath}" style="color:var(--accent);">Clear filters</a> to see all.</div>`;

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml(cfg.crumbs)}
      <h1 style="margin-top: 6px;">${esc(cfg.h1)}</h1>
      <p class="lead">${cfg.intro}</p>
    </div>
  </section>
  <main class="dir-shell">
    <div class="dir-layout">
      ${renderSidebar(scope, filters, counts, cfg.summary)}
      <div class="dir-results">
        <div class="results-head">
          <div class="rc"><b>${fmtNum(list.total)}</b> carrier${list.total === 1 ? '' : 's'} match${counts.intermodal ? ` · ${fmtNum(counts.intermodal)} run drayage` : ''}</div>
          ${sortRow(scope, filters)}
        </div>
        ${appliedChips(scope, filters)}
        ${cards}
        ${numberedPager(scope, filters, list)}
        ${cfg.extraModulesHtml ?? ''}
      </div>
    </div>
    ${cfg.faqsHtml ?? ''}
    <p class="muted-small" style="margin: 24px 0 0; max-width: 760px;">Carrier information is sourced from public FMCSA records and shown so shippers can contact carriers directly. Carriers: email us to update or hide your details.</p>
  </main>`;

  return layout({
    title: cfg.title,
    description: cfg.description,
    canonicalPath: cfg.canonicalPath,
    bodyHtml: body,
    jsonLd: cfg.jsonLd,
  });
}

/** Canonical query suffix for a faceted URL (stable key order, no page dup). */
function canonicalSuffix(f: DirectoryFilters, locked: Set<string>): string {
  const p = currentParams(f, locked);
  if (f.page > 1) p.page = String(f.page);
  const qs = new URLSearchParams(p).toString();
  return qs ? `?${qs}` : '';
}

// ─── 1. Directory landing ─────────────────────────────────────────────────
export function renderDirectoryLanding(summary: DirectorySummary): string {
  const portCards = summary.byPort
    .map(
      (p) => `<a class="dir-card" href="/directory/port/${encodeURIComponent(p.code)}">
        <h3>${esc(p.name)}</h3>
        <div class="sub">${esc([p.city, p.state].filter(Boolean).join(', '))} · ${esc(p.code)}</div>
        <div class="cnt">${fmtNum(p.count)}<small>carriers</small></div>
      </a>`,
    )
    .join('\n');

  const usStateRows = summary.byState.filter((s) => US_STATE_CODES.has(s.state));
  const stateCards = usStateRows
    .map((s) => {
      const st = stateByCode(s.state)!;
      return `<a class="dir-card" href="/directory/${st.slug}">
        <h3>${esc(st.name)}</h3>
        <div class="sub">${esc(s.state)}</div>
        <div class="cnt">${fmtNum(s.count)}<small>carriers</small></div>
      </a>`;
    })
    .join('\n');

  // When the directory has no carriers yet (fresh/empty table, e.g. a prod DB
  // still being ingested), show a clean "being set up" notice instead of empty
  // grids — the page must never look broken and must never 500.
  const isEmpty = summary.total === 0;
  const emptyNotice = isEmpty
    ? `<div class="dir-empty">The carrier directory is being set up — carriers are loading. Check back shortly.</div>`
    : '';

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      <div class="eyebrow" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;">US carrier directory</div>
      <h1>Find US freight &amp; drayage carriers</h1>
      <p class="lead">Browse ${fmtNum(summary.total)} active US motor carriers by port and by state — fleet size, authority, safety rating, and which run container drayage. Sourced from FMCSA public data.</p>
      <div class="dir-stats">
        <div class="dir-stat"><b>${fmtNum(summary.total)}</b><span>Carriers</span></div>
        <div class="dir-stat"><b>${fmtNum(summary.intermodalTotal)}</b><span>Drayage / intermodal</span></div>
        <div class="dir-stat"><b>${fmtNum(usStateRows.length)}</b><span>States</span></div>
      </div>
    </div>
  </section>
  <main class="dir-shell">
    ${emptyNotice}
    ${
      isEmpty
        ? ''
        : `<div class="dir-card" style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
        <div><h2 style="margin:0 0 4px; font-size:18px;">Search &amp; filter every carrier</h2>
        <p class="muted-small" style="margin:0;">Filter ${fmtNum(summary.total)} carriers by state, city, fleet size, safety rating and authority — every filter is a shareable link.</p></div>
        <a class="btn btn-primary" href="/directory?sort=featured">Open faceted search <span class="arr">→</span></a>
      </div>`
    }
    <div class="dir-section-h">
      <h2>Top US ports</h2>
      <a class="muted-small" href="/compliance">Compliance tools →</a>
    </div>
    <div class="dir-grid">${portCards}</div>

    <div class="dir-section-h">
      <h2>Browse by state</h2>
      <span class="muted-small">${fmtNum(usStateRows.length)} states</span>
    </div>
    <div class="dir-grid">${stateCards}</div>
  </main>`;

  return layout({
    title: `US Freight & Drayage Carrier Directory — ${summary.total.toLocaleString('en-US')} Carriers | QuoteFleet`,
    description: `Browse ${summary.total.toLocaleString('en-US')} US trucking and drayage carriers by port and state. Fleet size, operating authority, safety ratings and intermodal status from FMCSA data.`,
    canonicalPath: '/directory',
    bodyHtml: body,
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Directory', path: '/directory' }]),
      jsonLdItemListAndCollection({
        name: 'US Freight & Drayage Carrier Directory',
        description: `Browse ${summary.total} US motor carriers by port and state from FMCSA public data.`,
        path: '/directory',
        carriers: [],
        total: summary.total,
      }),
    ],
  });
}

// ─── Shared cross-link modules ────────────────────────────────────────────
/** "Cities in {state}" module — links to the city-tier pages with counts. */
function citiesModule(state: UsState, cities: CityCount[]): string {
  if (!cities.length) return '';
  const cards = cities
    .map(
      (c) => `<a class="dir-card" href="/directory/${state.slug}/${encodeURIComponent(c.slug)}">
        <h3>${esc(c.city)}</h3>
        <div class="cnt">${fmtNum(c.count)}<small>carriers</small></div>
      </a>`,
    )
    .join('\n');
  return `<div class="dir-section-h"><h2 style="font-size: 18px;">Cities in ${esc(state.name)}</h2><span class="muted-small">${cities.length} cities</span></div>
    <div class="dir-grid">${cards}</div>`;
}

/** "Browse by state" chip row (all US states except an optional current one). */
function statesChipRow(exceptCode?: string): string {
  const chips = US_STATES.filter((s) => s.code !== exceptCode)
    .map((s) => `<a class="dir-chip" href="/directory/${s.slug}">${esc(s.name)}</a>`)
    .join('\n');
  return `<div class="dir-section-h"><h2 style="font-size: 18px;">Browse by state</h2></div><div class="dir-chips">${chips}</div>`;
}

// ─── Faceted directory results (/directory?…) ─────────────────────────────
export function renderDirectoryResults(opts: {
  filters: DirectoryFilters;
  list: CarrierListResult;
  counts: FacetCounts;
  summary: DirectorySummary;
}): string {
  const { filters, list, counts, summary } = opts;
  const scope: FacetScope = { kind: 'all', basePath: '/directory', locked: new Set() };
  const st = filters.state ? stateByCode(filters.state) : null;
  const focus = st ? st.name : 'US';
  const h1 = st ? `${st.name} freight & drayage carriers` : 'Search US freight & drayage carriers';
  const canonicalPath = `/directory${canonicalSuffix(filters, scope.locked)}`;
  return renderFacetedResults({
    scope,
    list,
    counts,
    filters,
    summary,
    crumbs: [{ name: 'Directory', path: '/directory' }, { name: 'Search' }],
    h1,
    intro: `Filter ${fmtNum(list.total)} FMCSA-registered ${focus} motor carriers by state, city, fleet size, safety rating and authority. Every filter is a shareable, crawlable link.`,
    title: `${st ? st.name + ' ' : ''}Carrier Search — Filter by Fleet, Safety & Authority | QuoteFleet`,
    description: `Faceted search of ${list.total.toLocaleString('en-US')} ${st ? st.name + ' ' : 'US '}freight and drayage carriers — filter by fleet size, safety rating, active authority and drayage service. FMCSA data.`,
    canonicalPath,
    extraModulesHtml: statesChipRow(filters.state ?? undefined),
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Directory', path: '/directory' }, { name: 'Search' }]),
      jsonLdItemListAndCollection({
        name: h1,
        description: `Filtered directory of ${list.total} carriers.`,
        path: canonicalPath,
        carriers: list.carriers,
        total: list.total,
      }),
    ],
  });
}

// ─── 2. State page (faceted) ──────────────────────────────────────────────
export function renderStatePage(opts: {
  state: UsState;
  list: CarrierListResult;
  counts: FacetCounts;
  filters: DirectoryFilters;
  cities: CityCount[];
}): string {
  const { state, list, counts, filters, cities } = opts;
  const scope: FacetScope = {
    kind: 'state',
    basePath: `/directory/${state.slug}`,
    locked: new Set(['state']),
    state,
  };
  const canonicalPath = `${scope.basePath}${canonicalSuffix(filters, scope.locked)}`;
  return renderFacetedResults({
    scope,
    list,
    counts,
    filters,
    crumbs: [{ name: 'Directory', path: '/directory' }, { name: state.name }],
    h1: `${state.name} freight & drayage carriers`,
    intro: `${fmtNum(list.total)} FMCSA-registered motor carriers based in ${esc(state.name)}. Filter by city, fleet size, safety rating and authority, or <a href="/compliance">verify any carrier live</a>.`,
    title: `${state.name} Trucking & Drayage Carriers Directory — ${list.total.toLocaleString('en-US')} Carriers | QuoteFleet`,
    description: `Directory of ${list.total.toLocaleString('en-US')} freight and drayage carriers in ${state.name}. Filter by fleet size, safety rating and authority. FMCSA data, free to browse.`,
    canonicalPath,
    extraModulesHtml: `${citiesModule(state, cities)}${statesChipRow(state.code)}`,
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Directory', path: '/directory' }, { name: state.name, path: `/directory/${state.slug}` }]),
      jsonLdItemListAndCollection({
        name: `${state.name} freight & drayage carriers`,
        description: `Directory of ${list.total} carriers in ${state.name}.`,
        path: canonicalPath,
        carriers: list.carriers,
        total: list.total,
      }),
    ],
  });
}

// ─── 2b. City page (faceted) ──────────────────────────────────────────────
export function renderCityPage(opts: {
  state: UsState;
  city: { name: string; slug: string };
  list: CarrierListResult;
  counts: FacetCounts;
  filters: DirectoryFilters;
  cities: CityCount[];
}): string {
  const { state, city, list, counts, filters, cities } = opts;
  const scope: FacetScope = {
    kind: 'city',
    basePath: `/directory/${state.slug}/${city.slug}`,
    locked: new Set(['state', 'city']),
    state,
    city,
  };
  const canonicalPath = `${scope.basePath}${canonicalSuffix(filters, scope.locked)}`;
  const otherCities = cities.filter((c) => c.slug !== city.slug).slice(0, 23);
  return renderFacetedResults({
    scope,
    list,
    counts,
    filters,
    crumbs: [
      { name: 'Directory', path: '/directory' },
      { name: state.name, path: `/directory/${state.slug}` },
      { name: city.name },
    ],
    h1: `Top Drayage Carriers in ${city.name}, ${state.name}`,
    intro: `${fmtNum(list.total)} FMCSA-registered motor carriers based in ${esc(city.name)}, ${esc(state.name)}. Filter by fleet size, safety rating and authority, or <a href="/compliance">verify any carrier live</a>.`,
    title: `${city.name}, ${state.code} Trucking & Drayage Carriers — ${list.total.toLocaleString('en-US')} Carriers | QuoteFleet`,
    description: `Directory of ${list.total.toLocaleString('en-US')} freight and drayage carriers in ${city.name}, ${state.name}. Fleet size, safety rating and authority from FMCSA data.`,
    canonicalPath,
    extraModulesHtml: `${otherCities.length ? citiesModule(state, otherCities) : ''}
      <div class="dir-section-h"><h2 style="font-size: 18px;">More in ${esc(state.name)}</h2></div>
      <div class="dir-chips"><a class="dir-chip" href="/directory/${state.slug}">All ${esc(state.name)} carriers →</a></div>`,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Directory', path: '/directory' },
        { name: state.name, path: `/directory/${state.slug}` },
        { name: city.name, path: `/directory/${state.slug}/${city.slug}` },
      ]),
      jsonLdItemListAndCollection({
        name: `Drayage carriers in ${city.name}, ${state.name}`,
        description: `Directory of ${list.total} carriers in ${city.name}, ${state.name}.`,
        path: canonicalPath,
        carriers: list.carriers,
        total: list.total,
      }),
    ],
  });
}

// ─── 4a. Port page (faceted, + FAQ schema) ────────────────────────────────
function portFaqs(port: { name: string; city: string; state: string }): Array<{ q: string; a: string }> {
  return [
    {
      q: `How many carriers serve ${port.name}?`,
      a: `This directory maps every FMCSA-registered motor carrier whose physical location is nearest to ${port.name} in ${port.city}, ${port.state}, using ZIP-centroid proximity. Use the filters to narrow by fleet size, safety rating or drayage service.`,
    },
    {
      q: `What is drayage at ${port.city}?`,
      a: `Drayage is the short-haul trucking of ocean containers between ${port.name}'s marine terminals and nearby warehouses, rail ramps or transload facilities. Carriers flagged "Drayage / intermodal" here report intermodal container operations to FMCSA.`,
    },
    {
      q: `How do I verify a carrier's authority and insurance?`,
      a: `Every profile links to the official FMCSA SAFER Company Snapshot, and the on-page "Verify live now" button pulls a real-time authority, insurance and safety snapshot from FMCSA's QCMobile system. You can also use the free lookup on our compliance tools page.`,
    },
    {
      q: `Is this directory free to use?`,
      a: `Yes. Browsing, filtering and verifying carriers is free. Carrier data is sourced from FMCSA public records; carriers can claim their profile to publish live rates and take instant quotes.`,
    },
  ];
}

export function renderPortPage(opts: {
  port: ContainerPort;
  list: CarrierListResult;
  counts: FacetCounts;
  filters: DirectoryFilters;
}): string {
  const { port, list, counts, filters } = opts;
  const scope: FacetScope = {
    kind: 'port',
    basePath: `/directory/port/${port.code}`,
    locked: new Set(['port']),
    port,
  };
  const canonicalPath = `${scope.basePath}${canonicalSuffix(filters, scope.locked)}`;
  const faqs = portFaqs(port);
  const portChips = CONTAINER_PORTS.filter((p) => p.code !== port.code)
    .map((p) => `<a class="dir-chip" href="/directory/port/${p.code}">${esc(p.name)}</a>`)
    .join('\n');
  const faqsHtml = `<div class="dir-section-h"><h2>Frequently asked questions</h2></div>
    ${faqs
      .map(
        (f) => `<div class="dir-card" style="margin-bottom:12px;"><h3 style="margin:0 0 6px; font-size:16px;">${esc(f.q)}</h3><p class="muted" style="margin:0; line-height:1.55;">${esc(f.a)}</p></div>`,
      )
      .join('\n')}`;
  return renderFacetedResults({
    scope,
    list,
    counts,
    filters,
    crumbs: [{ name: 'Directory', path: '/directory' }, { name: port.name }],
    h1: `Drayage & trucking carriers near ${port.name}`,
    intro: `${fmtNum(list.total)} carriers whose nearest US container gateway is ${esc(port.name)} (${esc(port.city)}, ${esc(port.state)}), by ZIP proximity from FMCSA data.`,
    title: `${port.name} Drayage & Trucking Carriers — ${list.total.toLocaleString('en-US')} Near ${port.city} | QuoteFleet`,
    description: `Directory of ${list.total.toLocaleString('en-US')} carriers near ${port.name} in ${port.city}, ${port.state}. Filter by fleet size, safety rating and drayage service. FMCSA data.`,
    canonicalPath,
    extraModulesHtml: `<div class="dir-section-h"><h2 style="font-size: 18px;">Other US ports</h2></div><div class="dir-chips">${portChips}</div>`,
    faqsHtml,
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Directory', path: '/directory' }, { name: port.name, path: `/directory/port/${port.code}` }]),
      jsonLdItemListAndCollection({
        name: `Carriers near ${port.name}`,
        description: `Directory of ${list.total} carriers near ${port.name}.`,
        path: canonicalPath,
        carriers: list.carriers,
        total: list.total,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ─── 4b. Carrier profile ──────────────────────────────────────────────────
export function renderCarrierProfile(opts: {
  carrier: VisibleCarrier;
  related?: VisibleCarrier[];
  cityCount?: number;
  stateCount?: number;
}): string {
  const c = opts.carrier;
  const related = opts.related ?? [];
  const sr = safetyLabel(c.safetyRating);
  const cityState = [c.city, c.state].filter(Boolean).join(', ');
  const st = stateByCode(c.state);
  const port = portByCode(c.nearestPortCode);
  const citySlug = c.city ? citySlugify(c.city) : '';
  const cityName = c.city ? titleCaseCity(c.city) : '';
  const saferUrl = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(
    c.usdot,
  )}`;

  // Breadcrumb: Directory / State / City / Carrier.
  const crumbs: Crumb[] = [{ name: 'Directory', path: '/directory' }];
  if (st) crumbs.push({ name: st.name, path: `/directory/${st.slug}` });
  if (st && citySlug && cityName) crumbs.push({ name: cityName, path: `/directory/${st.slug}/${citySlug}` });
  crumbs.push({ name: carrierName(c) });

  const facts: Array<[string, string]> = [
    ['USDOT', c.usdot ? esc(c.usdot) : '—'],
    ['MC / Docket', c.mcNumber ? esc(c.mcNumber) : '—'],
    ['Location', cityState ? esc(cityState) : '—'],
    ['Power units', fmtNum(c.powerUnits)],
    ['Drivers', fmtNum(c.drivers)],
    ['Authority', esc(authorityLabel(c.authorityType))],
    ['Safety rating', esc(sr.text)],
    ['Container drayage', c.intermodal ? 'Yes — intermodal' : 'Not flagged'],
  ];
  if (port) facts.push(['Nearest port', `${esc(port.name)}`]);

  // Contact rows (phone + email). Displayed for shipper→carrier connection only —
  // QuoteFleet does not do outreach. Values are public FMCSA data; escape the text
  // and encode the href. When the carrier has opted out, hide BOTH and show a
  // single muted line instead (the rest of the profile still renders normally).
  const contactRows = c.contactHidden
    ? `<div class="lookup-result"><div class="row"><span class="k">Contact</span><span class="v muted-small">Contact details hidden at the carrier's request.</span></div></div>`
    : [
        c.phone
          ? `<div class="lookup-result"><div class="row"><span class="k">Phone</span><span class="v"><a href="tel:${encodeURIComponent(
              c.phone,
            )}" style="color:var(--accent);">${esc(c.phone)}</a></span></div></div>`
          : '',
        c.email
          ? `<div class="lookup-result"><div class="row"><span class="k">Email</span><span class="v"><a href="mailto:${encodeURIComponent(
              c.email,
            )}" style="color:var(--accent);">${esc(c.email)}</a></span></div></div>`
          : '',
      ].join('');

  const factRows =
    facts
      .map(
        ([k, v]) =>
          `<div class="lookup-result"><div class="row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div></div>`,
      )
      .join('') +
    contactRows +
    // Verify-on-SAFER link surfaced as a data-table row too.
    `<div class="lookup-result"><div class="row"><span class="k">FMCSA record</span><span class="v"><a href="${saferUrl}" target="_blank" rel="noopener nofollow" style="color:var(--accent);">Verify on SAFER ↗</a></span></div></div>`;

  // Count-bearing cross-links (city + state).
  const crossLinks: string[] = [];
  if (st && citySlug && cityName && (opts.cityCount ?? 0) > 1) {
    crossLinks.push(
      `<a class="dir-chip" href="/directory/${st.slug}/${citySlug}">${esc(cityName)} carriers (${fmtNum(opts.cityCount)})</a>`,
    );
  }
  if (st && (opts.stateCount ?? 0) > 1) {
    crossLinks.push(`<a class="dir-chip" href="/directory/${st.slug}">${esc(st.name)} carriers (${fmtNum(opts.stateCount)})</a>`);
  }
  if (port) crossLinks.push(`<a class="dir-chip" href="/directory/port/${port.code}">Near ${esc(port.name)}</a>`);

  const relatedModule = related.length
    ? `<div class="dir-section-h"><h2 style="font-size: 18px;">Other carriers in ${esc(cityName || st?.name || 'the area')}</h2></div>
       <div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">${related
         .map(carrierCard)
         .join('\n')}</div>`
    : '';

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml(crumbs)}
      <div class="dir-chips" style="margin: 12px 0 6px;">
        ${c.intermodal ? '<span class="pill pill-dray">Drayage</span>' : ''}
        <span class="pill pill-${sr.tone}">${esc(sr.text)}</span>
      </div>
      <h1 style="margin-top: 6px;">${esc(carrierName(c))}</h1>
      <p class="lead">${esc(cityState)}${c.usdot ? ` · USDOT ${esc(c.usdot)}` : ''}${c.mcNumber ? ` · MC ${esc(c.mcNumber)}` : ''}</p>
    </div>
  </section>
  <main class="dir-shell">
    <div class="lookup-box">
      <h2 style="font-size: 16px; margin: 0 0 12px;">Carrier snapshot</h2>
      ${carrierName(c) !== c.legalName ? `<p class="muted-small" style="margin: 0 0 12px;">Legal name: ${esc(c.legalName)}</p>` : ''}
      ${factRows}
      <div style="margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap;">
        <a class="btn btn-secondary" href="${saferUrl}" target="_blank" rel="noopener nofollow">Verify on FMCSA SAFER ↗</a>
        <button class="btn btn-primary" id="live-verify" data-usdot="${esc(c.usdot)}">Verify live now</button>
      </div>
      <div id="live-result" class="lookup-result" style="margin-top: 6px;"></div>
    </div>

    ${crossLinks.length ? `<div class="dir-chips" style="margin-top: 18px;">${crossLinks.join('\n')}</div>` : ''}

    ${relatedModule}

    <div class="dir-card" style="margin-top: 20px; text-align: center; padding: 26px;">
      <h2 style="font-size: 18px; margin: 0 0 8px;">Is this your company?</h2>
      <p class="muted" style="margin: 0 auto 16px; max-width: 460px;">Claim your profile to publish live rates, take instant quotes, and get booked directly by shippers — free to list.</p>
      <a class="btn btn-primary" href="/signup?claim=${encodeURIComponent(c.usdot)}&amp;name=${encodeURIComponent(carrierName(c))}">Claim this profile <span class="arr">→</span></a>
      <p class="muted-small" style="margin: 16px auto 0; max-width: 460px;">Carrier data is sourced from public FMCSA records. To correct or hide your contact details, email support@quotefleet.net with your USDOT number.</p>
    </div>
  </main>
  <script>
    (function () {
      var btn = document.getElementById('live-verify');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var dot = btn.getAttribute('data-usdot');
        var box = document.getElementById('live-result');
        btn.disabled = true; btn.textContent = 'Checking FMCSA…';
        fetch('/api/public/directory/lookup?dot=' + encodeURIComponent(dot))
          .then(function (r) { return r.json(); })
          .then(function (j) { box.innerHTML = renderLive(j); })
          .catch(function () { box.innerHTML = '<p class="muted-small" style="margin-top:12px;">Live check unavailable right now — use SAFER above.</p>'; })
          .finally(function () { btn.disabled = false; btn.textContent = 'Verify live now'; });
      });
      function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);});}
      function renderLive(j){
        if(!j||!j.found){return '<p class="muted-small" style="margin-top:12px;">'+esc((j&&j.note)||'No live FMCSA record found.')+'</p>';}
        function yn(v){return v==='Y'?'Yes':v==='N'?'No':(v||'—');}
        function auth(v){return v==='A'?'Active':v==='I'?'Inactive':v==='N'?'None':(v||'—');}
        var rows=[
          ['Allowed to operate', j.allowedToOperate==='Y'?'Yes':j.allowedToOperate==='N'?'No':'—'],
          ['Common authority', auth(j.authority&&j.authority.common)],
          ['Contract authority', auth(j.authority&&j.authority.contract)],
          ['BIPD insurance on file', j.insurance&&j.insurance.bipdOnFile?('$'+esc(j.insurance.bipdOnFile)+'k'):'—'],
          ['Out of service', j.outOfService?('Yes'+(j.outOfServiceDate?' ('+esc(j.outOfServiceDate)+')':'')):'No'],
          ['Power units', j.powerUnits==null?'—':esc(String(j.powerUnits))]
        ];
        return '<p class="muted-small" style="margin:14px 0 6px;">Live FMCSA QCMobile result:</p>'+rows.map(function(r){
          return '<div class="row"><span class="k">'+esc(r[0])+'</span><span class="v">'+r[1]+'</span></div>';
        }).join('');
      }
    })();
  </script>`;

  return layout({
    title: `${carrierName(c)} — USDOT ${c.usdot} Carrier Profile | QuoteFleet`,
    description: `${carrierName(c)}${cityState ? ' of ' + cityState : ''}: USDOT ${c.usdot}, ${
      c.powerUnits ? c.powerUnits + ' power units, ' : ''
    }${authorityLabel(c.authorityType)}, ${sr.text} safety rating. Verify live with FMCSA.`,
    canonicalPath: `/directory/carrier/${encodeURIComponent(c.slug)}`,
    bodyHtml: body,
    jsonLd: [jsonLdBreadcrumb(crumbs), jsonLdCarrier(c)],
  });
}

export function renderCarrierNotFound(): string {
  const body = `<main class="dir-shell"><div class="dir-card" style="margin-top: 40px; text-align: center; padding: 40px;">
    <h1 style="font-size: 24px;">Carrier not found</h1>
    <p class="muted">This carrier isn't in the directory, or the link is wrong.</p>
    <a class="btn btn-secondary" href="/directory">Browse the directory</a>
  </div></main>`;
  return layout({
    title: 'Carrier not found | QuoteFleet',
    description: 'This carrier is not in the QuoteFleet directory.',
    canonicalPath: '/directory',
    bodyHtml: body,
  });
}

// ─── 3. Compliance Tools ──────────────────────────────────────────────────
const COMPLIANCE_SOURCES: Array<{ name: string; href: string; desc: string }> = [
  {
    name: 'FMCSA SAFER',
    href: 'https://safer.fmcsa.dot.gov/CompanySnapshot.aspx',
    desc: 'The official Company Snapshot — operating authority, insurance status, out-of-service orders and crash/inspection history by USDOT or MC number.',
  },
  {
    name: 'FMCSA SMS (BASIC scores)',
    href: 'https://ai.fmcsa.dot.gov/SMS/',
    desc: 'Safety Measurement System percentile scores across the BASIC categories (unsafe driving, HOS, vehicle maintenance, and more).',
  },
  {
    name: 'FMCSA License & Insurance',
    href: 'https://li-public.fmcsa.dot.gov/LIVIEW/pkg_menu.prc_menu',
    desc: 'Authoritative L&I system: authority history, active/pending/revoked status, and the insurance forms (BMC-91, BOC-3) on file.',
  },
  {
    name: 'UIIA Member Search',
    href: 'https://www.uiia.org/',
    desc: 'The Uniform Intermodal Interchange Agreement registry — confirm whether a drayage carrier is a UIIA member eligible to interchange containers.',
  },
  {
    name: 'TSA TWIC',
    href: 'https://www.tsa.gov/for-industry/twic',
    desc: 'Transportation Worker Identification Credential — the port-access credential drivers need for secure maritime facilities.',
  },
];

export function renderCompliancePage(summary: DirectorySummary): string {
  const sourceCards = COMPLIANCE_SOURCES.map(
    (s) => `<a class="src-card" href="${s.href}" target="_blank" rel="noopener nofollow">
      <h3>${esc(s.name)}</h3>
      <p>${esc(s.desc)}</p>
      <span class="go">Open ↗</span>
    </a>`,
  ).join('\n');

  // Compliance filter chips. Only flags we truly have (drayage/intermodal) deep-link;
  // the rest are honestly marked "coming soon".
  const availableChips = `
    <a class="dir-chip active" href="/directory?intermodal=1">Drayage / intermodal (${fmtNum(summary.intermodalTotal)})</a>
    <a class="dir-chip" href="/directory">All carriers (${fmtNum(summary.total)})</a>`;
  const comingSoon = ['UIIA member', 'TWIC-ready', 'Hazmat', 'Reefer']
    .map((n) => `<span class="dir-chip" style="opacity: 0.55; cursor: default;">${esc(n)} · soon</span>`)
    .join('\n');

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      <div class="eyebrow" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;">Compliance tools</div>
      <h1>Verify a carrier before you book</h1>
      <p class="lead">Check any US carrier's operating authority, insurance and safety status straight from FMCSA — and jump to the official government sources for a deeper look.</p>
    </div>
  </section>
  <main class="dir-shell">
    <div class="lookup-box">
      <h2 style="font-size: 18px; margin: 0 0 4px;">Live USDOT / MC lookup</h2>
      <p class="muted-small" style="margin: 0 0 16px;">Pulls a live snapshot from FMCSA's QCMobile system. Data is FMCSA's, updated on their schedule.</p>
      <div class="lookup-row">
        <div class="lookup-toggle" id="lk-toggle">
          <button type="button" class="on" data-kind="dot">USDOT</button>
          <button type="button" data-kind="mc">MC</button>
        </div>
        <input class="input" id="lk-input" inputmode="numeric" placeholder="e.g. 3733285" autocomplete="off">
        <button class="btn btn-primary" id="lk-go">Verify <span class="arr">→</span></button>
      </div>
      <div id="lk-result" class="lookup-result"></div>
    </div>

    <div class="dir-section-h"><h2>Official verification sources</h2></div>
    <div class="src-grid">${sourceCards}</div>

    <div class="dir-section-h"><h2>Filter carriers by compliance</h2></div>
    <p class="muted-small" style="margin: -6px 0 12px;">FMCSA public data reliably gives us drayage/intermodal today. UIIA, TWIC, Hazmat and Reefer are self-declared credentials we're adding next — we won't fake them.</p>
    <div class="dir-chips">${availableChips}</div>
    <div class="dir-chips" style="margin-top: 8px;">${comingSoon}</div>
  </main>
  <script>
    (function () {
      var kind = 'dot';
      var toggle = document.getElementById('lk-toggle');
      var input = document.getElementById('lk-input');
      var go = document.getElementById('lk-go');
      var box = document.getElementById('lk-result');
      toggle.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        kind = b.getAttribute('data-kind');
        Array.prototype.forEach.call(toggle.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
        input.placeholder = kind === 'dot' ? 'e.g. 3733285' : 'e.g. 1515';
      });
      function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);});}
      function run() {
        var v = (input.value || '').trim();
        if (!v) { box.innerHTML = '<p class="muted-small" style="margin-top:12px;">Enter a number first.</p>'; return; }
        go.disabled = true; go.textContent = 'Checking…';
        fetch('/api/public/directory/lookup?' + kind + '=' + encodeURIComponent(v))
          .then(function (r) { return r.json(); })
          .then(function (j) { box.innerHTML = render(j); })
          .catch(function () { box.innerHTML = '<p class="muted-small" style="margin-top:12px;">Lookup failed. Try SAFER directly.</p>'; })
          .finally(function () { go.disabled = false; go.innerHTML = 'Verify <span class="arr">→</span>'; });
      }
      go.addEventListener('click', run);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
      function auth(v){return v==='A'?'Active':v==='I'?'Inactive':v==='N'?'None':(v||'—');}
      function render(j) {
        if (!j || !j.found) { return '<p class="muted-small" style="margin-top:14px;">' + esc((j && j.note) || 'No FMCSA record found.') + '</p>'; }
        var rows = [
          ['Legal name', esc(j.legalName || '—')],
          ['DBA', j.dbaName ? esc(j.dbaName) : '—'],
          ['Location', esc([j.city, j.state].filter(Boolean).join(', ') || '—')],
          ['USDOT', esc(j.usdot || '—')],
          ['MC / Docket', j.mcNumber ? esc(j.mcNumber) : '—'],
          ['Allowed to operate', j.allowedToOperate === 'Y' ? '✓ Yes' : j.allowedToOperate === 'N' ? '✗ No' : '—'],
          ['Common authority', auth(j.authority && j.authority.common)],
          ['Contract authority', auth(j.authority && j.authority.contract)],
          ['BIPD insurance on file', j.insurance && j.insurance.bipdOnFile ? ('$' + esc(j.insurance.bipdOnFile) + 'k') : '—'],
          ['Safety rating', esc(j.safetyRating || 'Not rated')],
          ['Out of service', j.outOfService ? ('Yes' + (j.outOfServiceDate ? ' (' + esc(j.outOfServiceDate) + ')' : '')) : 'No'],
          ['Power units', j.powerUnits == null ? '—' : esc(String(j.powerUnits))],
          ['Drivers', j.drivers == null ? '—' : esc(String(j.drivers))]
        ];
        return '<p class="muted-small" style="margin:16px 0 6px;">Live FMCSA snapshot:</p>' + rows.map(function (r) {
          return '<div class="row"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
        }).join('');
      }
    })();
  </script>`;

  return layout({
    title: 'Carrier Compliance Tools — Verify USDOT, MC, Authority & Insurance | QuoteFleet',
    description: 'Free tools to verify a US freight carrier: live USDOT/MC lookup of authority, insurance and safety status from FMCSA, plus links to SAFER, SMS BASIC scores, L&I, UIIA and TWIC.',
    canonicalPath: '/compliance',
    bodyHtml: body,
  });
}
