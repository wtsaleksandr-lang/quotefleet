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
  DriversBucketId,
  EquipmentId,
  CargoId,
  SafetyId,
} from './queries.js';
import {
  FLEET_BUCKETS,
  DRIVERS_BUCKETS,
  EQUIPMENT_OPTIONS,
  CARGO_OPTIONS,
  SAFETY_OPTIONS,
  SORT_OPTIONS,
  citySlugify,
  titleCaseCity,
} from './queries.js';
import { US_STATES, stateByCode, type UsState } from './usStates.js';
import { CONTAINER_PORTS, portByCode, type ContainerPort } from './containerPorts.js';
import { CA_PROVINCE_CODES } from './caProvinces.js';

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

/**
 * One credential badge for the carrier profile.
 *
 * `held` (a credential the carrier ACTUALLY has) → a distinct SOLID colour keyed
 * by `tone`. `verified` (FMCSA-sourced) appends a "✓ FMCSA-verified." marker to
 * the tooltip so the honest verified-vs-self-declared line is never blurred.
 * A NOT-held self-declared credential → the muted "claim to add" affordance, its
 * tooltip flagged "Self-declared." Every badge is keyboard-focusable and carries
 * a pure-CSS hover/focus tooltip (data-tip) plus an aria-label combining the
 * label and the explanation for screen readers.
 */
function credBadge(opts: {
  tone: string;
  label: string;
  tip: string;
  held: boolean;
  verified?: boolean;
  /** A self-declared credential (e.g. from carrier_overrides.capabilities): even
   *  when `held` (solid badge), the tooltip stays "Self-declared." — it is NOT
   *  FMCSA-verified. */
  selfDeclared?: boolean;
}): string {
  const suffix = opts.verified
    ? ' ✓ FMCSA-verified.'
    : opts.held && !opts.selfDeclared
      ? ''
      : ' Self-declared.';
  const full = opts.tip + suffix;
  const aria = `${opts.label} — ${full}`;
  const common = `tabindex="0" role="note" aria-label="${esc(aria)}" data-tip="${esc(full)}"`;
  if (opts.held) {
    return `<span class="cp-badge cp-tip cp-badge--${opts.tone}" ${common}>${esc(opts.label)}</span>`;
  }
  return `<span class="cp-badge cp-tip cp-badge--claim" ${common}>${esc(opts.label)} <span class="tag" aria-hidden="true">claim to add</span></span>`;
}

/** Up to two uppercase initials for the company monogram avatar, derived from
 *  the display name: first letter of the first two words, or the first two
 *  letters of a single-word name (e.g. "CEVA FREIGHT LLC" → "CF", "MOVERS" →
 *  "MO"). Non-alphanumeric leading chars are skipped. */
function monogramInitials(name: string): string {
  const words = name.trim().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/gi, '')).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return (words[0].slice(0, 2) || '—').toUpperCase();
  return ((words[0][0] ?? '') + (words[1][0] ?? '')).toUpperCase() || '—';
}

/** Self-declared credentials NOT derivable from FMCSA public data — shown muted
 *  with a "claim to add" affordance, never asserted as fact. Order = display order. */
const SELF_DECLARED_CREDENTIALS: Array<{ tone: string; label: string; tip: string }> = [
  { tone: 'uiia', label: 'UIIA member', tip: 'Uniform Intermodal Interchange Agreement — permits interchange of containers/chassis with ocean carriers & railroads.' },
  { tone: 'twic', label: 'TWIC', tip: 'Drivers hold TSA Transportation Worker Identification Credentials for secure port access.' },
  { tone: 'bonded', label: 'Customs-bonded / C-TPAT', tip: 'Customs-bonded / C-TPAT for in-bond and secure cross-border moves.' },
  { tone: 'reefer', label: 'Reefer', tip: 'Refrigerated container capability.' },
  { tone: 'transload', label: 'Transload / warehouse', tip: 'Cross-docks and stores freight between the ocean move and the inland leg.' },
  { tone: 'yard', label: 'Yard / parking', tip: 'Container yard and chassis / trailer parking.' },
];

// ─── Shared page shell ────────────────────────────────────────────────────
const DIRECTORY_CSS = `
  .dir-shell { max-width: 1100px; margin: 0 auto; padding: 28px; }
  /* Left-align the hero — the shared marketing .hero centers text; directory
     pages must read as a left-aligned page/company card, never centered. */
  .dir-hero { padding: 40px 28px 22px; text-align: left; }
  .dir-hero .container-narrow { max-width: 1100px; margin: 0; }
  .dir-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 10px; }
  .dir-hero p.lead { max-width: 640px; margin-left: 0; margin-right: 0; }
  .dir-hero .hero-cta, .dir-hero .hero-meta { justify-content: flex-start; }
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
  .pill-eq { background: var(--surface-2); color: var(--ink-soft); border: 1px solid var(--border); }
  /* Carrier-card chip row — always narrow, so it always uses the count-aware
     grid partition (>=2 pills per line, never a stranded orphan). 1 pill keeps
     its natural width (left-aligned); 2+ fill equal columns. */
  .card-chips { display: grid; gap: 8px; margin-top: 12px; align-items: stretch; }
  .card-chips .pill { display: flex; align-items: center; justify-content: center; text-align: center; white-space: normal; }
  .card-chips[data-n="1"] { grid-template-columns: max-content; }
  .card-chips[data-n="2"], .card-chips[data-n="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-chips[data-n="3"], .card-chips[data-n="5"], .card-chips[data-n="6"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
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
  /* Carrier-capabilities (Tier-3, claim-driven) group — visually secondary to
     the working FMCSA facets: subdued surface, per-kind sub-labels, claim CTA. */
  .facet-group--claim { background: var(--surface-2); border-style: dashed; }
  .facet-group--claim .cap-sub { margin-top: 10px; }
  .facet-group--claim .cap-sub:first-of-type { margin-top: 6px; }
  .cap-sublabel { display: block; font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); opacity: 0.85; margin: 0 0 3px 8px; }
  .cap-claim-cta { display: inline-block; margin-top: 12px; font-size: 12px; font-family: var(--font-mono); color: var(--accent); text-decoration: none; }
  .cap-claim-cta:hover { text-decoration: underline; }
  .facet-opt .lbl { display: flex; align-items: center; gap: 7px; }
  .facet-check { width: 14px; height: 14px; border: 1px solid var(--border-strong); border-radius: 4px; display: inline-block; flex: 0 0 auto; }
  .facet-opt.active .facet-check { background: var(--accent); border-color: var(--accent); }
  .rail-toggle { display: none; }
  /* Slim breadcrumb bar for the hero-less results view. */
  .dir-crumbbar { padding-top: 22px; padding-bottom: 0; }
  .dir-shell--tight { padding-top: 14px; }
  /* Single tidy control bar: count on the left, compact sort <select> on the
     right. Wraps to two rows only at very narrow widths (never mid-control). */
  .results-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap; margin: 0 0 14px; }
  .results-bar .rc { font-size: 15px; min-width: 0; }
  .results-bar .rc b { font-family: var(--font-mono); color: var(--accent); font-size: 20px; }
  .sort-ctl { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
  .sort-lbl { font-size: 11px; color: var(--muted); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; }
  .sort-select { position: relative; display: inline-flex; align-items: center; }
  .sort-select::after { content: '▾'; position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 10px; color: var(--muted); pointer-events: none; }
  .sort-select select { appearance: none; -webkit-appearance: none; background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 8px; padding: 8px 30px 8px 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.2; cursor: pointer; min-width: 168px; }
  .sort-select select:hover { border-color: var(--border-strong); }
  .sort-select select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }
  .sort-noscript { display: inline-flex; gap: 8px; flex-wrap: wrap; }
  .sort-noscript a { font-size: 12px; font-family: var(--font-mono); color: var(--accent); text-decoration: none; }
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
  /* ── Carrier profile (rich, DrayLocator-structured card) ────────────────── */
  .cp-caps { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 12px 0 4px; }
  /* Each badge GROUP (credentials / equipment) lays out on its own row. Desktop:
     a simple flex row — 4 credential or 5 equipment badges fit one line, so no
     wrap + no orphan. Narrow widths switch to a count-aware grid below so every
     line keeps >=2 badges (never a stranded single). */
  .cp-badgegroup { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; overflow-x: clip; width: 100%; }
  .cp-eqwrap { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; }
  .cp-eqlabel { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  @media (max-width: 640px) {
    /* Count-aware partition: columns chosen so no line ends with exactly one
       badge — 2→2, 3→3, 4→2×2, 5→3+2, 6→3×2. Equal 1fr columns + wrapping text
       (white-space:normal) means long labels never overflow the clipped group. */
    .cp-badgegroup { display: grid; gap: 8px; align-items: stretch; }
    .cp-badgegroup .cp-badge { justify-content: center; text-align: center; white-space: normal; font-size: 10px; padding: 4px 8px; min-width: 0; }
    .cp-badgegroup[data-n="1"] { grid-template-columns: max-content; }
    .cp-badgegroup[data-n="2"], .cp-badgegroup[data-n="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cp-badgegroup[data-n="3"], .cp-badgegroup[data-n="5"], .cp-badgegroup[data-n="6"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  .cp-badge-active { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; padding: 5px 9px; border-radius: 4px; background: var(--success-bg); color: var(--success); border: 1px solid var(--success); display: inline-flex; align-items: center; gap: 6px; }
  .cp-badge-active::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--success); display: inline-block; }
  .cp-claimline { margin: 14px 0 0; font-size: 13px; color: var(--muted); }
  .cp-claimline a { color: var(--accent); text-decoration: none; }
  .cp-claimline a:hover { text-decoration: underline; }
  .cp-layout { display: grid; grid-template-columns: minmax(0, 1fr) 328px; gap: 24px; align-items: start; margin-top: 24px; }
  .cp-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .cp-side { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 16px; }
  .cp-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; }
  .cp-card > h2.cp-h { margin-top: 0; }
  .cp-h { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-family: var(--font-mono); margin: 0 0 16px; }
  .cp-about { margin: 0; line-height: 1.6; color: var(--ink-soft); font-size: 15px; }
  .cp-datagrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .cp-dt { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .cp-dt .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-family: var(--font-mono); }
  .cp-dt .v { font-size: 16px; color: var(--ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; word-break: break-word; }
  .cp-verify-link { display: inline-block; margin-top: 16px; font-size: 13px; font-family: var(--font-mono); color: var(--accent); text-decoration: none; }
  .cp-verify-link:hover { text-decoration: underline; }
  .cp-chiprow { display: flex; flex-wrap: wrap; gap: 8px; }
  .cp-chip { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.02em; padding: 8px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--ink-soft); display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
  .cp-chip.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .cp-chip.good { border-color: var(--success); color: var(--success); background: var(--success-bg); }
  .cp-chip.muted { opacity: 0.6; }
  .cp-chip .tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; }
  .cp-note { margin: 16px 0 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
  .cp-loc { margin: 0 0 8px; line-height: 1.6; color: var(--ink-soft); font-size: 14px; }
  .cp-loc:last-child { margin-bottom: 0; }
  .cp-loc .lk { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
  .cp-contact-row { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
  .cp-contact-row:last-of-type { border-bottom: 0; }
  .cp-contact-row .k { color: var(--muted); }
  .cp-contact-row .v { font-family: var(--font-mono); text-align: right; word-break: break-word; }
  .cp-contact-row .v a { color: var(--accent); text-decoration: none; }
  .cp-hidden { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .cp-gated { margin-top: 16px; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: var(--surface-2); padding: 16px; }
  .cp-gated h3 { margin: 0 0 4px; font-size: 13px; color: var(--ink-soft); }
  .cp-gated p { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
  .cp-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .cp-actions .btn { width: 100%; justify-content: center; }
  /* ── Credential badges — distinct solid colours + pure-CSS hover/focus tooltip ─
     Palette defined as tokens (bg + text colour chosen for AA contrast). Solid
     colour = a credential the carrier ACTUALLY has (FMCSA-verified ones render
     now); self-declared credentials the carrier hasn't verified stay muted with
     a "claim to add" affordance. Every badge is keyboard-focusable and carries a
     tooltip (data-tip → ::after on :hover/:focus). The badge rows clip horizontal
     overflow so a tooltip never triggers page horizontal scroll at 375px. */
  :root {
    --badge-dray-bg: #2563eb;        --badge-dray-fg: #ffffff;
    --badge-hazmat-bg: #ea580c;      --badge-hazmat-fg: #111827;
    --badge-reefer-bg: #14b8a6;      --badge-reefer-fg: #111827;
    --badge-dryvan-bg: #0f766e;      --badge-dryvan-fg: #ffffff;
    --badge-tanker-bg: #0369a1;      --badge-tanker-fg: #ffffff;
    --badge-flatbed-bg: #b45309;     --badge-flatbed-fg: #ffffff;
    --badge-drybulk-bg: #6d28d9;     --badge-drybulk-fg: #ffffff;
    --badge-authority-bg: #475569;   --badge-authority-fg: #ffffff;
    --badge-safety-good-bg: #15803d; --badge-safety-good-fg: #ffffff;
    --badge-safety-warn-bg: #d97706; --badge-safety-warn-fg: #111827;
    --badge-safety-bad-bg: #b91c1c;  --badge-safety-bad-fg: #ffffff;
    --badge-safety-none-bg: #6b7280; --badge-safety-none-fg: #ffffff;
    --badge-uiia-bg: #7c3aed;        --badge-uiia-fg: #ffffff;
    --badge-twic-bg: #4338ca;        --badge-twic-fg: #ffffff;
    --badge-bonded-bg: #166534;      --badge-bonded-fg: #ffffff;
    --badge-transload-bg: #92400e;   --badge-transload-fg: #ffffff;
    --badge-yard-bg: #334155;        --badge-yard-fg: #ffffff;
    --badge-tip-bg: #1f2937;         --badge-tip-fg: #f9fafb;
    --badge-tip-border: rgba(148, 163, 184, 0.28);
    --badge-focus: #2563eb;
  }
  .cp-chiprow, .cp-caps, .cp-nameline { overflow-x: clip; }
  .cp-badge { position: relative; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.05em; text-transform: uppercase; padding: 5px 9px; border-radius: 4px; border: 1px solid transparent; white-space: nowrap; cursor: help; }
  .cp-badge:focus-visible, .cp-fmcsa:focus-visible { outline: 2px solid var(--badge-focus); outline-offset: 2px; }
  .cp-badge--dray { background: var(--badge-dray-bg); color: var(--badge-dray-fg); }
  .cp-badge--hazmat { background: var(--badge-hazmat-bg); color: var(--badge-hazmat-fg); }
  .cp-badge--reefer { background: var(--badge-reefer-bg); color: var(--badge-reefer-fg); }
  .cp-badge--dryvan { background: var(--badge-dryvan-bg); color: var(--badge-dryvan-fg); }
  .cp-badge--tanker { background: var(--badge-tanker-bg); color: var(--badge-tanker-fg); }
  .cp-badge--flatbed { background: var(--badge-flatbed-bg); color: var(--badge-flatbed-fg); }
  .cp-badge--drybulk { background: var(--badge-drybulk-bg); color: var(--badge-drybulk-fg); }
  .cp-badge--authority { background: var(--badge-authority-bg); color: var(--badge-authority-fg); }
  .cp-badge--safety-good { background: var(--badge-safety-good-bg); color: var(--badge-safety-good-fg); }
  .cp-badge--safety-warn { background: var(--badge-safety-warn-bg); color: var(--badge-safety-warn-fg); }
  .cp-badge--safety-bad { background: var(--badge-safety-bad-bg); color: var(--badge-safety-bad-fg); }
  .cp-badge--safety-none { background: var(--badge-safety-none-bg); color: var(--badge-safety-none-fg); }
  .cp-badge--uiia { background: var(--badge-uiia-bg); color: var(--badge-uiia-fg); }
  .cp-badge--twic { background: var(--badge-twic-bg); color: var(--badge-twic-fg); }
  .cp-badge--bonded { background: var(--badge-bonded-bg); color: var(--badge-bonded-fg); }
  .cp-badge--transload { background: var(--badge-transload-bg); color: var(--badge-transload-fg); }
  .cp-badge--yard { background: var(--badge-yard-bg); color: var(--badge-yard-fg); }
  .cp-badge--claim { background: var(--surface-2); color: var(--muted); border-color: var(--border); }
  .cp-badge--claim .tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; }
  .cp-tip[data-tip]:hover::after,
  .cp-tip[data-tip]:focus::after,
  .cp-tip[data-tip]:focus-visible::after {
    content: attr(data-tip);
    position: absolute; top: calc(100% + 9px); left: 50%; transform: translateX(-50%);
    z-index: 30; width: max-content; max-width: min(240px, 72vw);
    white-space: normal; text-align: left; text-transform: none; letter-spacing: normal;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px; line-height: 1.45;
    padding: 9px 11px; border-radius: 8px;
    background: var(--badge-tip-bg); color: var(--badge-tip-fg); border: 1px solid var(--badge-tip-border);
    box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35); pointer-events: none;
  }
  .cp-tip[data-tip]:hover::before,
  .cp-tip[data-tip]:focus::before,
  .cp-tip[data-tip]:focus-visible::before {
    content: ''; position: absolute; top: calc(100% + 3px); left: 50%; transform: translateX(-50%);
    border: 6px solid transparent; border-bottom-color: var(--badge-tip-bg); z-index: 31; pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .cp-tip[data-tip]::after, .cp-tip[data-tip]::before { transition: none; }
  }
  /* ── JS-positioned tooltip (directory-tooltip.js) ──────────────────────────
     When the script runs it flags <html class="js-tips"> and disables the CSS
     ::after/::before tooltip above (avoids a double tooltip). The .qf-tip node
     lives on <body> so it escapes every overflow:clip badge-row ancestor, and
     the embedded "✓" renders in the green success token via .qf-tip-check.
     No-JS users keep the CSS tooltip; aria-label carries the name regardless. */
  html.js-tips .cp-tip[data-tip]:hover::after,
  html.js-tips .cp-tip[data-tip]:focus::after,
  html.js-tips .cp-tip[data-tip]:focus-visible::after,
  html.js-tips .cp-tip[data-tip]:hover::before,
  html.js-tips .cp-tip[data-tip]:focus::before,
  html.js-tips .cp-tip[data-tip]:focus-visible::before { display: none !important; }
  .qf-tip {
    position: fixed; left: 0; top: 0; z-index: 9999; visibility: hidden;
    width: max-content; max-width: min(240px, 72vw);
    white-space: normal; text-align: left; text-transform: none; letter-spacing: normal;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px; line-height: 1.45;
    padding: 8px 11px; border-radius: 8px;
    background: var(--badge-tip-bg); color: var(--badge-tip-fg); border: 1px solid var(--badge-tip-border);
    box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35); pointer-events: none;
    opacity: 0; transition: opacity 0.12s ease;
  }
  .qf-tip.is-open { opacity: 1; }
  .qf-tip::after {
    content: ''; position: absolute; left: var(--tip-arrow-x, 50%); transform: translateX(-50%);
    border: 6px solid transparent;
  }
  .qf-tip[data-pos="above"]::after { top: 100%; border-top-color: var(--badge-tip-bg); }
  .qf-tip[data-pos="below"]::after { bottom: 100%; border-bottom-color: var(--badge-tip-bg); }
  .qf-tip-check { color: var(--success); font-weight: 700; }
  @media (prefers-reduced-motion: reduce) {
    .qf-tip { transition: none; }
  }
  /* ── DrayLocator-structured header: [monogram] name · Active · FMCSA / claim
     on the right, subtitle, then the squared badge row — all left-aligned. ──── */
  .cp-headrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; text-align: left; margin: 14px 0 0; }
  .cp-idblock { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
  .cp-monogram { flex: 0 0 auto; width: 54px; height: 54px; border-radius: 8px; margin-top: 2px; background: var(--surface-2); border: 1px solid var(--border); color: var(--ink); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 21px; font-weight: 700; letter-spacing: 0.04em; }
  .cp-idtext { min-width: 0; }
  .cp-nameline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .cp-nameline h1 { font-size: 30px; line-height: 1.15; margin: 0; }
  .cp-fmcsa { position: relative; font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 7px; border-radius: 4px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); white-space: nowrap; cursor: help; }
  .cp-subtitle { margin: 8px 0 0; }
  .cp-headrow .cp-claimline { margin: 4px 0 0; }
  @media (max-width: 640px) {
    .cp-nameline h1 { font-size: 24px; }
    .cp-monogram { width: 46px; height: 46px; font-size: 18px; }
  }
  @media (max-width: 900px) {
    .cp-layout { grid-template-columns: 1fr; }
    .cp-side { position: static; }
  }
  @media (max-width: 640px) {
    .cp-card { padding: 16px; }
  }
  @media (max-width: 380px) {
    .cp-datagrid { grid-template-columns: 1fr; }
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
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
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
      <button type="button" class="qf-theme-btn" aria-label="Toggle light/dark theme" aria-pressed="false" title="Toggle theme"><svg class="qf-ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="qf-ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
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
  <script src="/theme-toggle.js" defer></script>
  <script src="/directory-tooltip.js" defer></script>
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

/**
 * Deterministic 2–3 sentence "About" summary built ONLY from the carrier's own
 * FMCSA facts — no external AI, no invented capabilities. Every clause is
 * omitted when its underlying data is missing, so a sparse record still yields
 * a clean, factual sentence. Plain text (the caller escapes it once).
 */
export function carrierAbout(c: VisibleCarrier): string {
  const name = carrierName(c);
  const isCa = !!(c.state && CA_PROVINCE_CODES.has(c.state));
  const typeWord = c.intermodal ? 'drayage and intermodal carrier' : 'motor carrier';
  // "active" only when FMCSA authority is on file; "an FMCSA" reads correctly.
  const lead = c.authorityType ? 'an active FMCSA-registered' : 'an FMCSA-registered';
  let s1 = `${name} is ${lead} ${typeWord}`;

  const cityDisp = c.city ? titleCaseCity(c.city) : '';
  const stName = (isCa ? null : stateByCode(c.state))?.name ?? c.state ?? '';
  if (cityDisp && c.state) s1 += ` based in ${cityDisp}, ${c.state}`;
  else if (stName) s1 += ` based in ${stName}`;
  else if (cityDisp) s1 += ` based in ${cityDisp}`;

  const puTxt =
    c.powerUnits != null ? `${c.powerUnits.toLocaleString('en-US')} power unit${c.powerUnits === 1 ? '' : 's'}` : '';
  const drTxt = c.drivers != null ? `${c.drivers.toLocaleString('en-US')} driver${c.drivers === 1 ? '' : 's'}` : '';
  const fleet = puTxt && drTxt ? `${puTxt} and ${drTxt}` : puTxt || drTxt;
  const authPhrase = c.authorityType
    ? authorityLabel(c.authorityType).replace(/ authority$/i, '').toLowerCase()
    : '';
  if (fleet) s1 += `, operating ${fleet}`;
  if (authPhrase) s1 += `${fleet ? ' under ' : ' operating under '}${authPhrase} authority`;
  s1 += '.';

  const sr = safetyLabel(c.safetyRating);
  const s2 = sr.tone !== 'none' ? ` Its FMCSA safety rating is ${sr.text}.` : '';

  let s3 = '';
  if (c.intermodal) {
    const p = portByCode(c.nearestPortCode);
    const ports = isCa ? 'North American container ports' : 'US container ports';
    s3 = ` It runs container drayage and intermodal moves, serving shippers at ${ports}${p ? ` such as ${p.name}` : ''}.`;
  }

  return `${s1}${s2}${s3}`.trim();
}

// ─── Carrier card (shared by state + port pages) ──────────────────────────
export function carrierCard(c: VisibleCarrier): string {
  const sr = safetyLabel(c.safetyRating);
  const cityState = [c.city, c.state].filter(Boolean).join(', ');
  const idMeta = [c.usdot ? `USDOT ${esc(c.usdot)}` : '', c.mcNumber ? `MC ${esc(c.mcNumber)}` : '']
    .filter(Boolean)
    .join(' · ');
  // Compliance + capability pills. Safety leads, then hazmat, then the FMCSA
  // equipment/cargo-type flags. Drayage stays the accent pill top-right (out of
  // this row + count). The row is capped so the count-aware grid always
  // partitions cleanly (>=2 per line, never an orphan); any overflow collapses
  // into a "+N more" pill and the full set stays on the profile.
  const cardPills: string[] = [`<span class="pill pill-${sr.tone}">${esc(sr.text)}</span>`];
  if (c.hazmat) cardPills.push('<span class="pill pill-warn">Hazmat</span>');
  const eqDefs: Array<[boolean, string]> = [
    [c.dryVan, 'Dry van'],
    [c.reefer, 'Reefer'],
    [c.tanker, 'Tanker / bulk'],
    [c.flatbed, 'Flatbed'],
    [c.dryBulk, 'Dry bulk'],
  ];
  for (const [on, label] of eqDefs) if (on) cardPills.push(`<span class="pill pill-eq">${esc(label)}</span>`);
  const CARD_MAX = 6; // 6 → clean 3×2 grid; higher counts would strand a pill
  let shown = cardPills;
  if (cardPills.length > CARD_MAX) {
    const hidden = cardPills.length - (CARD_MAX - 1);
    shown = [...cardPills.slice(0, CARD_MAX - 1), `<span class="pill pill-eq">+${hidden} more</span>`];
  }
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
    <div class="card-chips" data-n="${shown.length}">${shown.join('')}</div>
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
  if (f.drivers) p.drivers = f.drivers;
  if (f.safety) p.safety = f.safety;
  if (f.authorityActive) p.authority = 'active';
  // Equipment is the single source for the drayage/cargo dimension; drayage
  // round-trips as `equipment=drayage` (normalizeFilters still accepts the legacy
  // `intermodal=1` param on input, so old deep-links keep working).
  if (f.equipment) p.equipment = f.equipment;
  if (f.cargo) p.cargo = f.cargo;
  if (f.recent) p.recent = '1';
  if (f.sort && f.sort !== 'featured') p.sort = f.sort;
  return p;
}

type FacetChange = Partial<
  Record<
    'state' | 'city' | 'fleet' | 'drivers' | 'safety' | 'authority' | 'equipment' | 'cargo' | 'intermodal' | 'recent' | 'sort' | 'page',
    string | null
  >
>;

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

/** Carrier-declared (Tier-3) capabilities NOT in FMCSA public data. Rendered as
 *  disabled/"claim" rows, grouped by kind — they drive listing claims, they are
 *  never applied as working filters (we don't assert data we don't have). */
const CARRIER_CAPABILITY_GROUPS: ReadonlyArray<{ label: string; items: string[] }> = [
  // NOTE: "Household goods" + "Liquor" were MOVED OUT of this claim group into the
  // real FMCSA-backed "Cargo specialties" facet group (crgo_household / crgo_beverages,
  // migration 0050) — they are now working filters with live counts. ISO tank / open
  // top / flatrack stay claim-driven (FMCSA doesn't distinguish trailer subtypes).
  { label: 'Equipment specialties', items: ['ISO tank', 'Open top', 'Flatrack', 'Overweight', 'Tank-endorsed'] },
  { label: 'Services', items: ['Transload', 'Warehouse', 'Container storage'] },
  { label: 'Cargo', items: ['Customs-bonded'] },
  { label: 'Retail / partner programs', items: ['Menards-approved', 'Amazon warehouse delivery'] },
];

/** The full "Carrier capabilities" rail block — a visually-secondary Tier-3
 *  section of claim-driven options with per-kind sub-labels + a claim CTA. */
function capabilitiesGroup(): string {
  const blocks = CARRIER_CAPABILITY_GROUPS.map(
    (g) => `<div class="cap-sub"><span class="cap-sublabel">${esc(g.label)}</span>${g.items.map(disabledFacetRow).join('\n')}</div>`,
  ).join('\n');
  return `<div class="facet-group facet-group--claim">
    <h3>Carrier capabilities</h3>
    <span class="facet-src">Carrier-verified — shown as carriers claim their profiles.</span>
    ${blocks}
    <a class="cap-claim-cta" href="/signup">Claim a listing to verify these →</a>
  </div>`;
}

function renderSidebar(scope: FacetScope, f: DirectoryFilters, counts: FacetCounts, summary?: DirectorySummary): string {
  // Tier 1 — Equipment & cargo (FMCSA crgo_* columns; single-select toggle).
  const equipment = EQUIPMENT_OPTIONS.map((o) =>
    facetOptionRow(
      f.equipment === o.id,
      hrefWith(scope, f, { equipment: f.equipment === o.id ? null : o.id }),
      o.label,
      counts.equipment[o.id],
    ),
  ).join('\n');

  // Tier 1 — Cargo specialties (FMCSA crgo_* columns; single-select toggle,
  // orthogonal to the equipment facet via the separate `cargo` param).
  const cargo = CARGO_OPTIONS.map((o) =>
    facetOptionRow(
      f.cargo === o.id,
      hrefWith(scope, f, { cargo: f.cargo === o.id ? null : o.id }),
      o.label,
      counts.cargo[o.id],
    ),
  ).join('\n');

  // Tier 1 — Fleet size (trucks / power units).
  const fleet = FLEET_BUCKETS.map((b) =>
    facetOptionRow(f.fleet === b.id, hrefWith(scope, f, { fleet: f.fleet === b.id ? null : b.id }), b.label, counts.fleet[b.id]),
  ).join('\n');

  // Tier 1 — Drivers count.
  const drivers = DRIVERS_BUCKETS.map((b) =>
    facetOptionRow(
      f.drivers === b.id,
      hrefWith(scope, f, { drivers: f.drivers === b.id ? null : b.id }),
      b.label,
      counts.drivers[b.id],
    ),
  ).join('\n');

  // Tier 1 — Safety rating.
  const safety = SAFETY_OPTIONS.map((s) =>
    facetOptionRow(f.safety === s.id, hrefWith(scope, f, { safety: f.safety === s.id ? null : s.id }), s.label, counts.safety[s.id]),
  ).join('\n');

  // Tier 1/2 — Active authority + recently-updated (status/activity).
  const authority = facetOptionRow(
    f.authorityActive,
    hrefWith(scope, f, { authority: f.authorityActive ? null : 'active' }),
    'Active authority only',
    counts.authorityActive,
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

  return `<aside class="dir-rail" id="dir-rail">
    <button type="button" class="rail-toggle" id="rail-toggle" aria-expanded="true">Filters ▾</button>
    ${stateGroup}
    <div class="facet-group"><h3>Equipment &amp; cargo</h3><span class="facet-src">FMCSA cargo-type flags</span>${equipment}</div>
    <div class="facet-group"><h3>Cargo specialties</h3><span class="facet-src">FMCSA cargo-class flags</span>${cargo}</div>
    <div class="facet-group"><h3>Fleet size</h3><span class="facet-src">FMCSA power units (trucks)</span>${fleet}</div>
    <div class="facet-group"><h3>Drivers</h3><span class="facet-src">FMCSA total drivers</span>${drivers}</div>
    <div class="facet-group"><h3>Safety rating</h3><span class="facet-src">FMCSA safety rating</span>${safety}</div>
    <div class="facet-group"><h3>Authority &amp; activity</h3><span class="facet-src">FMCSA authority &amp; MCS-150</span>${authority}${recent}</div>
    ${capabilitiesGroup()}
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
  if (f.equipment) add(EQUIPMENT_OPTIONS.find((e) => e.id === f.equipment)?.label ?? f.equipment, { equipment: null });
  if (f.cargo) add(CARGO_OPTIONS.find((c) => c.id === f.cargo)?.label ?? f.cargo, { cargo: null });
  if (f.fleet) add(FLEET_BUCKETS.find((b) => b.id === f.fleet)?.label ?? f.fleet, { fleet: null });
  if (f.drivers) add(DRIVERS_BUCKETS.find((b) => b.id === f.drivers)?.label ?? f.drivers, { drivers: null });
  if (f.safety) add(SAFETY_OPTIONS.find((s) => s.id === f.safety)?.label ?? f.safety, { safety: null });
  if (f.authorityActive) add('Active authority', { authority: null });
  if (f.recent) add('Updated ≤12 mo', { recent: null });
  if (!chips.length) return '';
  return `<div class="applied-chips">${chips.join('\n')}<a class="applied-clear" href="${scope.basePath}">Clear all</a></div>`;
}

/**
 * Compact sort control — a single native <select> instead of a wrapping row of
 * chips (Alex flagged the old chips as stacking/overflowing). Each option's value
 * is the destination href; a tiny bound script navigates on change. No-JS users
 * still get a labelled, focusable control (the current sort stays `selected`), and
 * the noscript links keep every sort crawlable.
 */
function sortRow(scope: FacetScope, f: DirectoryFilters): string {
  const opts = SORT_OPTIONS.map((s) => {
    const href = hrefWith(scope, f, { sort: s.id === 'featured' ? null : s.id });
    return `<option value="${esc(href)}"${f.sort === s.id ? ' selected' : ''}>${esc(s.label)}</option>`;
  }).join('');
  const crawlLinks = SORT_OPTIONS.map(
    (s) => `<a href="${hrefWith(scope, f, { sort: s.id === 'featured' ? null : s.id })}">${esc(s.label)}</a>`,
  ).join('');
  return `<div class="sort-ctl">
    <label class="sort-lbl" for="dir-sort">Sort</label>
    <span class="sort-select">
      <select id="dir-sort" aria-label="Sort carriers" data-sort-nav>${opts}</select>
    </span>
    <noscript><span class="sort-noscript">${crawlLinks}</span></noscript>
  </div>
  <script>(function(){var s=document.getElementById('dir-sort');if(s)s.addEventListener('change',function(){if(this.value)window.location.href=this.value;});})();</script>`;
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
  /** Faceted master-search view (/directory?…): drop the hero H1 + intro (the
   *  shipper already knows what the directory is) and keep only the breadcrumb +
   *  the result count. SEO pages (state/city/port) leave this false → keep their
   *  hero H1/intro, which they need for indexing. */
  hideHero?: boolean;
}

function renderFacetedResults(cfg: FacetedCfg): string {
  const { scope, list, counts, filters } = cfg;
  const cards = list.carriers.length
    ? `<div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">${list.carriers
        .map(carrierCard)
        .join('\n')}</div>`
    : `<div class="dir-empty">No carriers match these filters. <a href="${scope.basePath}" style="color:var(--accent);">Clear filters</a> to see all.</div>`;

  // Results view: breadcrumb-only slim header, no hero. SEO pages: full hero.
  const heroHtml = cfg.hideHero
    ? `<div class="dir-shell dir-crumbbar">${crumbsHtml(cfg.crumbs)}</div>`
    : `<section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml(cfg.crumbs)}
      <h1 style="margin-top: 6px;">${esc(cfg.h1)}</h1>
      <p class="lead">${cfg.intro}</p>
    </div>
  </section>`;

  const body = `
  ${heroHtml}
  <main class="dir-shell${cfg.hideHero ? ' dir-shell--tight' : ''}">
    <div class="dir-layout">
      ${renderSidebar(scope, filters, counts, cfg.summary)}
      <div class="dir-results">
        <div class="results-bar">
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
    hideHero: true,
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

  const isCa = !!(c.state && CA_PROVINCE_CODES.has(c.state));
  const isActive = !!c.authorityType;
  const claimHref = `/signup?claim=${encodeURIComponent(c.usdot)}&amp;name=${encodeURIComponent(carrierName(c))}`;

  // ── §3 FMCSA DATA — clean labeled grid (numbers tabular via CSS). ──────────
  const dataItems: Array<[string, string]> = [
    ['USDOT', c.usdot ? esc(c.usdot) : '—'],
    ['MC / Docket', c.mcNumber ? esc(c.mcNumber) : '—'],
    ['Power units', fmtNum(c.powerUnits)],
    ['Drivers', fmtNum(c.drivers)],
    ['Authority', esc(authorityLabel(c.authorityType))],
    ['Safety rating', esc(sr.text)],
    ['Status', isActive ? 'Active' : 'On file'],
  ];
  // Data-as-of date is not carried on VisibleCarrier today — omit rather than fake.
  const dataGrid = dataItems
    .map(([k, v]) => `<div class="cp-dt"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`)
    .join('');

  // ── §Capabilities — credentials we can DERIVE from FMCSA (authority, drayage,
  // HAZMAT, safety) render as distinct SOLID-colour badges tagged ✓ FMCSA in
  // their tooltip; self-declared credentials the carrier hasn't verified stay
  // muted with a "claim to add" affordance. Every badge is focusable and carries
  // a pure-CSS hover/focus tooltip (see credBadge). ────────────────────────────
  // Two SEPARATE badge groups so neither wraps a single badge onto a line of its
  // own (the global no-orphan rule): credential/compliance badges (authority,
  // drayage, hazmat, safety) render on their own row; the FMCSA equipment/
  // cargo-type badges render on their own row below. Each group is laid out with
  // a count-aware grid on narrow widths (see .cp-badgegroup CSS) so every line
  // keeps >=2 badges — never a stranded orphan — at desktop AND 390px.
  const credentialBadges: string[] = [];
  const equipmentBadges: string[] = [];
  if (isActive)
    credentialBadges.push(
      credBadge({
        tone: 'authority',
        label: authorityLabel(c.authorityType),
        tip: 'Active FMCSA operating authority.',
        held: true,
        verified: true,
      }),
    );
  if (c.intermodal)
    credentialBadges.push(
      credBadge({
        tone: 'dray',
        label: 'Drayage / intermodal',
        tip: 'Hauls containers to/from ports and rail ramps (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  // Equipment / cargo-type flags from the FMCSA census crgo_* columns — verified
  // facts, so they render as solid ✓ FMCSA badges (not "self-declared").
  if (c.dryVan)
    equipmentBadges.push(
      credBadge({
        tone: 'dryvan',
        label: 'Dry van',
        tip: 'Hauls dry van / general freight (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.reefer)
    equipmentBadges.push(
      credBadge({
        tone: 'reefer',
        label: 'Reefer',
        tip: 'Temperature-controlled / refrigerated freight (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.tanker)
    equipmentBadges.push(
      credBadge({
        tone: 'tanker',
        label: 'Tanker / bulk',
        tip: 'Hauls bulk liquids, gases or chemicals in tank equipment (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.flatbed)
    equipmentBadges.push(
      credBadge({
        tone: 'flatbed',
        label: 'Flatbed / oversized',
        tip: 'Hauls heavy or dimensional freight on flatbed / open-deck equipment (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.dryBulk)
    equipmentBadges.push(
      credBadge({
        tone: 'drybulk',
        label: 'Dry bulk',
        tip: 'Hauls dry bulk commodities (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.hazmat)
    credentialBadges.push(
      credBadge({
        tone: 'hazmat',
        label: 'Hazmat',
        tip: 'FMCSA-registered to transport hazardous materials.',
        held: true,
        verified: true,
      }),
    );
  if (sr.tone !== 'none')
    credentialBadges.push(
      credBadge({
        tone: `safety-${sr.tone}`,
        label: `${sr.text} safety`,
        tip: 'FMCSA safety rating.',
        held: true,
        verified: true,
      }),
    );
  // Self-declared credentials: a carrier_overrides.capabilities flag flips the
  // matching badge from the muted "claim to add" affordance to an ACTIVE solid
  // badge — still tooltip-labeled "Self-declared." (never FMCSA-verified). The
  // credential `tone` ids match the CarrierCapabilities keys 1:1.
  const caps = c.capabilities ?? {};
  const claimBadges = SELF_DECLARED_CREDENTIALS
    // The self-declared "Reefer" claim is redundant once the carrier's FMCSA
    // reefer flag is verified above — drop it to avoid a duplicate Reefer badge.
    .filter((b) => !(b.tone === 'reefer' && c.reefer))
    .map((b) => credBadge({ ...b, held: !!caps[b.tone as keyof typeof caps], selfDeclared: true }))
    .join('');
  // The "Compliance & capabilities" section lists EVERYTHING (both verified
  // groups + the self-declared claim badges) as the full enumeration.
  const capBadges = credentialBadges.join('') + equipmentBadges.join('') + claimBadges;
  // Header badge groups, each wrapped with a data-n count so the count-aware grid
  // (mobile) partitions them without ever stranding a lone badge.
  const credentialGroup = credentialBadges.length
    ? `<div class="cp-badgegroup" data-n="${credentialBadges.length}">${credentialBadges.join('')}</div>`
    : '';
  const equipmentGroup = equipmentBadges.length
    ? `<div class="cp-eqwrap"><span class="cp-eqlabel">Equipment</span><div class="cp-badgegroup cp-badgegroup--equip" data-n="${equipmentBadges.length}">${equipmentBadges.join('')}</div></div>`
    : '';

  // ── §6 Contact — TIERED. Public block = FMCSA-sourced phone/email (encoded
  // href, escaped text), respecting the contactHidden opt-out. Gated block is
  // structure-only for now; Phase 2 will gate it behind real auth and render
  // additional dispatch contacts to signed-in users.
  const publicContact = c.contactHidden
    ? `<p class="cp-hidden">Contact details hidden at the carrier's request.</p>`
    : [
        c.phone
          ? `<div class="cp-contact-row"><span class="k">Phone</span><span class="v"><a href="tel:${encodeURIComponent(
              c.phone,
            )}">${esc(c.phone)}</a></span></div>`
          : '',
        c.email
          ? `<div class="cp-contact-row"><span class="k">Email</span><span class="v"><a href="mailto:${encodeURIComponent(
              c.email,
            )}">${esc(c.email)}</a></span></div>`
          : '',
        !c.phone && !c.email
          ? `<p class="cp-hidden">No public contact details on the FMCSA record.</p>`
          : '',
      ].join('');
  // Phase 2: gate this panel behind auth and render real additional contacts.
  const gatedContact = `<div class="cp-gated">
        <h3>More dispatch contacts</h3>
        <p>Additional dispatch contacts are available to registered users — create a free QuoteFleet account to view.</p>
      </div>`;

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

  const locBased = cityState ? esc(cityState) : isCa ? 'Canada' : 'the United States';
  // Subtitle line — DrayLocator order: USDOT · MC · City, State (each dropped when absent).
  const headerSubtitle = [
    c.usdot ? `USDOT ${esc(c.usdot)}` : '',
    c.mcNumber ? `MC ${esc(c.mcNumber)}` : '',
    cityState ? esc(cityState) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml(crumbs)}
      <div class="cp-headrow">
        <div class="cp-idblock">
          <div class="cp-monogram" aria-hidden="true">${esc(monogramInitials(carrierName(c)))}</div>
          <div class="cp-idtext">
            <div class="cp-nameline">
              <h1>${esc(carrierName(c))}</h1>
              ${isActive ? '<span class="cp-badge-active">Active</span>' : ''}
              <span class="cp-fmcsa cp-tip" tabindex="0" role="note" aria-label="FMCSA — Profile built from FMCSA public records." data-tip="Profile built from FMCSA public records.">FMCSA</span>
            </div>
            <p class="lead cp-subtitle">${headerSubtitle}</p>
            ${carrierName(c) !== c.legalName ? `<p class="muted-small" style="margin: 6px 0 0;">Legal name: ${esc(c.legalName)}</p>` : ''}
          </div>
        </div>
        <p class="cp-claimline">Own this company? <a href="${claimHref}">Claim this profile →</a></p>
      </div>
      <div class="cp-caps">
        ${credentialGroup}
        ${equipmentGroup}
      </div>
    </div>
  </section>
  <main class="dir-shell">
    <div class="cp-layout">
      <div class="cp-main">
        <section class="cp-card">
          <h2 class="cp-h">About</h2>
          <p class="cp-about">${esc(c.aboutOverride ?? carrierAbout(c))}</p>
        </section>

        <section class="cp-card">
          <h2 class="cp-h">FMCSA data</h2>
          <div class="cp-datagrid">${dataGrid}</div>
          <a class="cp-verify-link" href="${saferUrl}" target="_blank" rel="noopener nofollow">Verify on FMCSA SAFER ↗</a>
        </section>

        <section class="cp-card">
          <h2 class="cp-h">Compliance &amp; capabilities</h2>
          <div class="cp-chiprow">${capBadges}</div>
          <p class="cp-note">Solid-colour badges are confirmed from FMCSA public data (hover any badge for what it means and its source). Muted credentials (UIIA, TWIC, bonded / C-TPAT, reefer, transload, yard) are self-declared — claim this profile to verify and add them.</p>
        </section>

        <section class="cp-card">
          <h2 class="cp-h">Location &amp; service area</h2>
          <p class="cp-loc">Based in ${locBased}.</p>
          <p class="cp-loc">Serving shippers, brokers and forwarders ${isCa ? 'across Canadian trade lanes' : 'at US container ports'}.</p>
          ${port ? `<p class="cp-loc"><span class="lk">Nearest port</span> ${esc(port.name)}${port.city || port.state ? ` · ${esc([port.city, port.state].filter(Boolean).join(', '))}` : ''}</p>` : ''}
        </section>
      </div>

      <aside class="cp-side">
        <section class="cp-card">
          <h2 class="cp-h">Contact</h2>
          ${publicContact}
          ${gatedContact}
          <div class="cp-actions">
            <a class="btn btn-secondary" href="${saferUrl}" target="_blank" rel="noopener nofollow">Verify on FMCSA SAFER ↗</a>
            <button class="btn btn-primary" id="live-verify" data-usdot="${esc(c.usdot)}">Verify live now</button>
          </div>
          <div id="live-result" class="lookup-result" style="margin-top: 8px;"></div>
          <p class="cp-note">Carrier information is sourced from public FMCSA records. To correct or hide your details, email support@quotefleet.net with your USDOT number.</p>
        </section>
      </aside>
    </div>

    ${crossLinks.length ? `<div class="dir-chips" style="margin-top: 24px;">${crossLinks.join('\n')}</div>` : ''}

    ${relatedModule}

    <div class="dir-card" style="margin-top: 24px; text-align: center; padding: 24px;">
      <h2 style="font-size: 18px; margin: 0 0 8px;">Is this your company?</h2>
      <p class="muted" style="margin: 0 auto 16px; max-width: 460px;">Claim your profile to publish live rates, take instant quotes, and get booked directly by shippers — free to list.</p>
      <a class="btn btn-primary" href="${claimHref}">Claim this profile <span class="arr">→</span></a>
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
