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
import type { DirectorySummary, CarrierListResult, VisibleCarrier } from './queries.js';
import { US_STATES, stateByCode, type UsState } from './usStates.js';
import { CONTAINER_PORTS, portByCode } from './containerPorts.js';

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
}

function layout({ title, description, canonicalPath, bodyHtml }: LayoutOpts): string {
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
</head>
<body>
  <header class="topnav">
    <div class="topnav-inner">
      <a href="/" class="brand-mark">
        <span class="logo"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>
        QuoteFleet
      </a>
      <span class="topnav-spacer"></span>
      <a class="nav-link" href="/directory">Directory</a>
      <a class="nav-link" href="/compliance">Compliance</a>
      <a class="nav-link" href="/pricing">Pricing</a>
      <a class="btn btn-primary always-show" href="/signup">List your company <span class="arr">→</span></a>
    </div>
  </header>
  ${bodyHtml}
  <footer class="site-footer">
    © <span id="year"></span> QuoteFleet · <a href="/directory">Directory</a> · <a href="/compliance">Compliance</a> · <a href="/marketplace/">Marketplace</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/">Home</a>
  </footer>
  <script>document.getElementById('year').textContent = new Date().getFullYear();</script>
  <script src="/marketing-chat.js" defer></script>
</body>
</html>`;
}

// ─── Carrier card (shared by state + port pages) ──────────────────────────
function carrierCard(c: VisibleCarrier): string {
  const sr = safetyLabel(c.safetyRating);
  const cityState = [c.city, c.state].filter(Boolean).join(', ');
  const idMeta = [c.usdot ? `USDOT ${esc(c.usdot)}` : '', c.mcNumber ? `MC ${esc(c.mcNumber)}` : '']
    .filter(Boolean)
    .join(' · ');
  return `<a class="carrier-card" href="/directory/carrier/${encodeURIComponent(c.slug)}">
    <div class="top">
      <div>
        <h3>${esc(c.dbaName || c.legalName)}</h3>
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
  });
}

// ─── 2. State page ────────────────────────────────────────────────────────
export function renderStatePage(opts: {
  state: UsState;
  list: CarrierListResult;
  intermodalOnly: boolean;
}): string {
  const { state, list, intermodalOnly } = opts;
  const qsBase = intermodalOnly ? '?intermodal=1' : '';
  const cards = list.carriers.length
    ? `<div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">${list.carriers
        .map(carrierCard)
        .join('\n')}</div>`
    : `<div class="dir-empty">No ${intermodalOnly ? 'drayage ' : ''}carriers found in ${esc(state.name)} yet.</div>`;

  // Pagination links preserve the intermodal filter.
  const pageLink = (p: number): string => {
    const parts: string[] = [];
    if (intermodalOnly) parts.push('intermodal=1');
    if (p > 1) parts.push(`page=${p}`);
    return `/directory/${state.slug}${parts.length ? '?' + parts.join('&') : ''}`;
  };
  const pager =
    list.totalPages > 1
      ? `<div class="dir-pager">
          ${list.page > 1 ? `<a class="btn btn-secondary" href="${pageLink(list.page - 1)}">← Prev</a>` : ''}
          <span class="muted-small">Page ${list.page} of ${list.totalPages}</span>
          ${list.page < list.totalPages ? `<a class="btn btn-secondary" href="${pageLink(list.page + 1)}">Next →</a>` : ''}
        </div>`
      : '';

  // "Browse other states" chip row — top states by count, minus this one.
  const otherStates = US_STATES.filter((s) => s.code !== state.code).slice(0, 24);
  const stateChips = otherStates
    .map((s) => `<a class="dir-chip" href="/directory/${s.slug}">${esc(s.name)}</a>`)
    .join('\n');

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      <a class="muted-small" href="/directory">← All states &amp; ports</a>
      <h1 style="margin-top: 10px;">${esc(state.name)} freight carriers</h1>
      <p class="lead">${fmtNum(list.total)} ${intermodalOnly ? 'drayage / intermodal ' : ''}motor carriers based in ${esc(state.name)}, from FMCSA public data. Verify any carrier live on the <a href="/compliance">compliance tools</a> page.</p>
      <div class="dir-chips" style="margin-top: 16px;">
        <a class="dir-chip ${intermodalOnly ? '' : 'active'}" href="/directory/${state.slug}">All carriers</a>
        <a class="dir-chip ${intermodalOnly ? 'active' : ''}" href="/directory/${state.slug}?intermodal=1">Drayage / intermodal only</a>
      </div>
    </div>
  </section>
  <main class="dir-shell">
    ${cards}
    ${pager}
    <div class="dir-section-h"><h2 style="font-size: 18px;">Browse other states</h2></div>
    <div class="dir-chips">${stateChips}</div>
  </main>`;

  const titleQual = intermodalOnly ? 'Drayage & Intermodal Carriers' : 'Trucking Carriers';
  return layout({
    title: `${state.name} ${titleQual} Directory — ${list.total.toLocaleString('en-US')} Carriers | QuoteFleet`,
    description: `Directory of ${list.total.toLocaleString('en-US')} ${intermodalOnly ? 'drayage and intermodal' : 'freight'} carriers in ${state.name}. Fleet size, authority, and safety ratings from FMCSA data. Free to browse.`,
    canonicalPath: `/directory/${state.slug}${qsBase}`,
    bodyHtml: body,
  });
}

// ─── 4a. Port page ────────────────────────────────────────────────────────
export function renderPortPage(opts: {
  port: { code: string; name: string; city: string; state: string };
  list: CarrierListResult;
  intermodalOnly: boolean;
}): string {
  const { port, list, intermodalOnly } = opts;
  const cards = list.carriers.length
    ? `<div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">${list.carriers
        .map(carrierCard)
        .join('\n')}</div>`
    : `<div class="dir-empty">No ${intermodalOnly ? 'drayage ' : ''}carriers mapped to ${esc(port.name)} yet.</div>`;

  const pageLink = (p: number): string => {
    const parts: string[] = [];
    if (intermodalOnly) parts.push('intermodal=1');
    if (p > 1) parts.push(`page=${p}`);
    return `/directory/port/${port.code}${parts.length ? '?' + parts.join('&') : ''}`;
  };
  const pager =
    list.totalPages > 1
      ? `<div class="dir-pager">
          ${list.page > 1 ? `<a class="btn btn-secondary" href="${pageLink(list.page - 1)}">← Prev</a>` : ''}
          <span class="muted-small">Page ${list.page} of ${list.totalPages}</span>
          ${list.page < list.totalPages ? `<a class="btn btn-secondary" href="${pageLink(list.page + 1)}">Next →</a>` : ''}
        </div>`
      : '';

  const portChips = CONTAINER_PORTS.filter((p) => p.code !== port.code)
    .map((p) => `<a class="dir-chip" href="/directory/port/${p.code}">${esc(p.name)}</a>`)
    .join('\n');

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      <a class="muted-small" href="/directory">← All states &amp; ports</a>
      <h1 style="margin-top: 10px;">Carriers near ${esc(port.name)}</h1>
      <p class="lead">${fmtNum(list.total)} ${intermodalOnly ? 'drayage / intermodal ' : ''}carriers whose nearest US container gateway is ${esc(port.name)} (${esc(port.city)}, ${esc(port.state)}), by ZIP proximity from FMCSA data.</p>
      <div class="dir-chips" style="margin-top: 16px;">
        <a class="dir-chip ${intermodalOnly ? '' : 'active'}" href="/directory/port/${port.code}">All carriers</a>
        <a class="dir-chip ${intermodalOnly ? 'active' : ''}" href="/directory/port/${port.code}?intermodal=1">Drayage / intermodal only</a>
      </div>
    </div>
  </section>
  <main class="dir-shell">
    ${cards}
    ${pager}
    <div class="dir-section-h"><h2 style="font-size: 18px;">Other US ports</h2></div>
    <div class="dir-chips">${portChips}</div>
  </main>`;

  return layout({
    title: `${port.name} Drayage & Trucking Carriers — ${list.total.toLocaleString('en-US')} Near ${port.city} | QuoteFleet`,
    description: `Directory of ${list.total.toLocaleString('en-US')} carriers near ${port.name} in ${port.city}, ${port.state}. Drayage, intermodal and trucking companies with fleet and authority data from FMCSA.`,
    canonicalPath: `/directory/port/${port.code}`,
    bodyHtml: body,
  });
}

// ─── 4b. Carrier profile ──────────────────────────────────────────────────
export function renderCarrierProfile(opts: { carrier: VisibleCarrier }): string {
  const c = opts.carrier;
  const sr = safetyLabel(c.safetyRating);
  const cityState = [c.city, c.state].filter(Boolean).join(', ');
  const st = stateByCode(c.state);
  const port = portByCode(c.nearestPortCode);
  const saferUrl = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(
    c.usdot,
  )}`;

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

  const factRows = facts
    .map(
      ([k, v]) =>
        `<div class="lookup-result"><div class="row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div></div>`,
    )
    .join('');

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      <a class="muted-small" href="${st ? `/directory/${st.slug}` : '/directory'}">← ${st ? esc(st.name) + ' carriers' : 'Directory'}</a>
      <div class="dir-chips" style="margin: 12px 0 6px;">
        ${c.intermodal ? '<span class="pill pill-dray">Drayage</span>' : ''}
        <span class="pill pill-${sr.tone}">${esc(sr.text)}</span>
      </div>
      <h1 style="margin-top: 6px;">${esc(c.dbaName || c.legalName)}</h1>
      <p class="lead">${esc(cityState)}${c.usdot ? ` · USDOT ${esc(c.usdot)}` : ''}${c.mcNumber ? ` · MC ${esc(c.mcNumber)}` : ''}</p>
    </div>
  </section>
  <main class="dir-shell">
    <div class="lookup-box">
      <h2 style="font-size: 16px; margin: 0 0 12px;">Carrier snapshot</h2>
      ${c.dbaName && c.dbaName !== c.legalName ? `<p class="muted-small" style="margin: 0 0 12px;">Legal name: ${esc(c.legalName)}</p>` : ''}
      ${factRows}
      <div style="margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap;">
        <a class="btn btn-secondary" href="${saferUrl}" target="_blank" rel="noopener nofollow">Verify on FMCSA SAFER ↗</a>
        <button class="btn btn-primary" id="live-verify" data-usdot="${esc(c.usdot)}">Verify live now</button>
      </div>
      <div id="live-result" class="lookup-result" style="margin-top: 6px;"></div>
    </div>

    <div class="dir-card" style="margin-top: 20px; text-align: center; padding: 26px;">
      <h2 style="font-size: 18px; margin: 0 0 8px;">Is this your company?</h2>
      <p class="muted" style="margin: 0 auto 16px; max-width: 460px;">Claim your profile to publish live rates, take instant quotes, and get booked directly by shippers — free to list.</p>
      <a class="btn btn-primary" href="/signup">Claim this profile <span class="arr">→</span></a>
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
    title: `${c.dbaName || c.legalName} — USDOT ${c.usdot} Carrier Profile | QuoteFleet`,
    description: `${c.dbaName || c.legalName}${cityState ? ' of ' + cityState : ''}: USDOT ${c.usdot}, ${
      c.powerUnits ? c.powerUnits + ' power units, ' : ''
    }${authorityLabel(c.authorityType)}, ${sr.text} safety rating. Verify live with FMCSA.`,
    canonicalPath: `/directory/carrier/${encodeURIComponent(c.slug)}`,
    bodyHtml: body,
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
