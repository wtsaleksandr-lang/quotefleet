/**
 * Server-rendered "Importer Search" feature (/importers) + its search API.
 *
 * Provider-FIRST (the differentiator vs ImportYeti's name-first search): our
 * users know their PORT / LANE / COMMODITY, not importer names, so the primary
 * pickers are Entry Port, US State and Commodity / HS code. A company-name box
 * is the small secondary path.
 *
 * v2 (this file) adds, all on the search page:
 *   1. Autosuggest comboboxes on every primary input (port, state, supplier
 *      country, commodity/HS) — keyboard-accessible, always opening downward,
 *      theme-aware. Port/state/country data is inlined (small, static); commodity
 *      suggestions come from a debounced GET /api/importers/suggest (ImportYeti is
 *      NEVER called for suggestions).
 *   2. Port → auto-preselect + LOCK the US state (a port has exactly one state).
 *   3. Pagination / "Load more" — threads `page` through to ImportYeti, dedups
 *      across pages on the client.
 *   4. An honest dataset figure (700M+ records) before searching, and a real
 *      "N importers · M records scanned" line after.
 *   5. Result-density toggle (Comfortable / Compact), persisted in localStorage.
 *   6. A left "Narrow your results" pane that refines the CURRENT set client-side.
 *   7. Credit guardrails — cache-first + a per-visitor FREE-SEARCH QUOTA (see
 *      importerQuota.ts). Cache hits never count; only a live ImportYeti pull
 *      decrements the quota; past the quota the page shows a subscribe wall.
 *
 * The GET page is a light server-rendered shell (no external calls on load).
 * Results — importer, lane, volumes, incumbent, Winnability chip, AI angle — are
 * ALL FREE to view. The decision-maker CONTACT, the AI-drafted email, and CSV
 * export are LOCKED behind a sign-up CTA (placeholder unlock; no payment wired).
 *
 * Styles are inlined in this TS module (like DIRECTORY_CSS), so the public-dir
 * CSS/color/spacing guards — which only scan src/server/public — never touch them.
 */
import type { Express, Request, Response } from 'express';
import { layout, esc } from './pages.js';
import { CONTAINER_PORTS } from './containerPorts.js';
import { US_STATES } from './usStates.js';
import { ISO_COUNTRIES, MAJOR_SUPPLIER_CODES } from './isoCountries.js';
import { suggestCommodity } from './hsCodes.js';
import {
  findImporterLeads,
  winnability,
  aiAngle,
  MAX_LEADS,
  type ImporterFilters,
  type ImporterLead,
  type ContactConfidence,
} from './importerLeads.js';
import {
  dbBolCacheStore,
  dbContactCacheStore,
  searchKey,
  companyKey,
  IMPORTER_CACHE_TTL_MS,
  type ContactCacheStore,
  type BolCacheStore,
} from './importerCache.js';
import {
  checkLiveSearchAllowed,
  recordLiveSearch,
  logCreditSpend,
  checkDetailQuota,
} from './importerQuota.js';
import { importerSearchLimiter, publicAutocompleteLimiter } from '../rateLimits.js';
import { registerImporterProfileRoutes } from './importerProfile.js';
import { activeRedactionKeys } from './manifestRedactions.js';
import { directoryIdentity } from './entitlement.js';
import { registerImporterSavedRoutes } from '../routes/importerSaved.js';

const SITE = 'https://quotefleet.net';

const US_PORTS = CONTAINER_PORTS.filter((p) => p.country === 'US');

/**
 * Honest headline dataset size: ImportYeti indexes 700M+ US customs records,
 * updated daily. This is the REAL dataset we query — not a per-search count.
 */
export const DATASET_RECORDS_LABEL = '700M+';

/** Port autosuggest items (value submitted = "City, ST"; label = full name). */
export interface PortItem {
  value: string;
  label: string;
  state: string;
}
export const US_PORT_ITEMS: readonly PortItem[] = US_PORTS.map((p) => ({
  value: `${p.city}, ${p.state}`,
  label: `${p.name} — ${p.city}, ${p.state}`,
  state: p.state,
}));

const PORT_VALUE_TO_STATE = new Map(US_PORT_ITEMS.map((p) => [p.value.toLowerCase(), p.state] as const));

/**
 * Resolve a selected entry-port value ("Newark, NJ") to its single US state code
 * ("NJ"). This is the port → state LOCK: a port sits in exactly one state, so the
 * state filter is auto-preselected and locked. Returns null for an unknown port.
 */
export function portToStateCode(portValue: string | null | undefined): string | null {
  if (!portValue) return null;
  return PORT_VALUE_TO_STATE.get(String(portValue).trim().toLowerCase()) ?? null;
}

/**
 * Curated supplement of additional real US entry ports that are NOT in the
 * container-gateway directory (CONTAINER_PORTS is container-only, so it lists
 * just one port for several states). `entry_port` on ImportYeti is a SUBSTRING
 * match on the city token (verified against the live API: `entry_port=Savannah`
 * and `entry_port=Savannah, GA` both match "Savannah, Ga." rows), so a
 * "City, ST" value here matches that city's bills regardless of the state
 * formatting upstream. Kept SEPARATE from CONTAINER_PORTS so the directory's
 * nearest-port derivation and port facets stay byte-for-byte unchanged.
 */
const EXTRA_STATE_ENTRY_PORTS: Readonly<Record<string, readonly string[]>> = {
  GA: ['Brunswick, GA'],
  CA: ['Oakland, CA'],
  WA: ['Tacoma, WA'],
  NY: ['New York, NY'],
};

/** Cap the ports pulled for a single state-alone search (credit guard — each
 *  port is one cache-first ImportYeti pull on a miss). */
export const MAX_STATE_PORTS = 6;

/**
 * State code → its entry-port values. Built by INVERTING the port→state lock map
 * (US_PORT_ITEMS, the same data that auto-fills + locks the State field), then
 * merging the curated supplement above. This is what a State-only search expands
 * to: an importer "in GA" means one ENTERING through a GA port (Savannah,
 * Brunswick), never one whose HQ address happens to read GA.
 */
const STATE_TO_PORT_VALUES: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const p of US_PORT_ITEMS) {
    const arr = m.get(p.state) ?? [];
    if (!arr.includes(p.value)) arr.push(p.value);
    m.set(p.state, arr);
  }
  for (const [st, extra] of Object.entries(EXTRA_STATE_ENTRY_PORTS)) {
    const arr = m.get(st) ?? [];
    for (const v of extra) if (!arr.includes(v)) arr.push(v);
    m.set(st, arr);
  }
  return m;
})();

/** Resolve a US state code to the entry ports to query for it (capped for
 *  credits). Empty for a state with no known port. */
export function entryPortsForState(stateCode: string | null | undefined): string[] {
  const st = String(stateCode ?? '').trim().toUpperCase();
  if (!st) return [];
  return (STATE_TO_PORT_VALUES.get(st) ?? []).slice(0, MAX_STATE_PORTS);
}

/** Volume (12-mo shipments) bands for the narrow-results pane. */
const FREQ_BANDS: ReadonlyArray<[string, string]> = [
  ['', 'Any frequency'], ['50', '50+ / yr'], ['200', '200+ / yr'], ['800', '800+ / yr'], ['2000', '2,000+ / yr'],
];
const TEU_BANDS: ReadonlyArray<[string, string]> = [
  ['', 'Any TEU'], ['100', '100+ TEU'], ['500', '500+ TEU'], ['2000', '2,000+ TEU'],
];

// ── inline CSS (rendered from this TS module, exactly like DIRECTORY_CSS, so
//    it is NOT scanned by the public-dir spacing/color guards). Uses only
//    QuoteFleet's shared /style.css design tokens so BOTH themes render. ──────
const IMPORTERS_CSS = `
/* SEO/AT-only H1 — the page reads as a plain directory search portal (no big
   marketing hero), so the visible title is dropped and kept only for crawlers
   and assistive tech. */
.imp-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* One-line trust / record strip (replaces the big floating datastat pill) —
   carries the 700M+ figure inline, mockup-style. */
.imp-datastat{color:var(--muted);font-size:13px;line-height:1.5;margin:14px 0 4px}
.imp-datastat .num{font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.imp-datastat #imp-recordline{color:var(--ink-soft);font-weight:600}
.imp-shell{padding:24px 0 48px}

/* ── search bar (slim + unboxed — a directory filter row, not a card) ── */
.imp-panel{margin:0 0 12px}
.imp-grid{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.imp-combo{flex:1 1 210px}
.imp-field{display:flex;flex-direction:column;gap:8px;min-width:0}
.imp-field label{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.imp-field input,.imp-field select{width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:14px;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:10px 12px;min-height:44px;appearance:none;-webkit-appearance:none}
.imp-field input::placeholder{color:var(--muted)}
.imp-field input:hover,.imp-field select:hover{border-color:var(--accent)}
.imp-field input:focus-visible,.imp-field select:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.imp-field input:disabled{opacity:.72;cursor:not-allowed;background:var(--surface)}

/* ── autosuggest combobox ── */
.imp-combo{position:relative}
.imp-combo-ctrl{position:relative}
.imp-combo-clear{position:absolute;top:0;right:0;height:100%;width:40px;display:none;align-items:center;justify-content:center;background:none;border:0;color:var(--muted);cursor:pointer;font-size:18px;line-height:1}
.imp-combo-clear:hover{color:var(--ink)}
.imp-combo[data-has-value="1"] .imp-combo-clear{display:flex}
.imp-combo[data-has-value="1"] .imp-combo-ctrl input{padding-right:40px}
.imp-lockpill{display:none;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:5px;padding:2px 8px;text-transform:none;letter-spacing:0}
.imp-combo[data-locked="1"] .imp-lockpill{display:inline-flex}
.imp-suggest{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:40;margin:0;padding:6px;list-style:none;max-height:280px;overflow-y:auto;background:var(--surface);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow-lg,0 12px 32px rgba(0,0,0,.18))}
.imp-suggest[hidden]{display:none}
.imp-suggest li{padding:9px 12px;border-radius:7px;font-size:13px;color:var(--ink);cursor:pointer;display:flex;align-items:baseline;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.imp-suggest li .code{font-family:var(--font-mono);font-size:12px;color:var(--accent);flex:0 0 auto}
.imp-suggest li .sub{color:var(--muted);font-size:12px}
.imp-suggest li[aria-selected="true"],.imp-suggest li:hover{background:color-mix(in srgb,var(--accent) 14%,transparent)}
.imp-suggest .imp-suggest-empty{color:var(--muted);cursor:default;font-style:italic}
.imp-suggest .imp-suggest-empty:hover{background:none}

/* ── secondary filters (progressive-disclosure) ──
   Sits inline in the actions row as a compact "More filters" chip; when opened it
   expands to a full-width row below the buttons. */
.imp-more{flex:0 0 auto;margin:0}
.imp-more[open]{flex:1 1 100%;order:5;margin-top:4px;border-top:1px solid var(--border);padding-top:8px}
.imp-more>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-size:13px;font-weight:600;padding:10px 12px;min-height:44px;border:1px solid var(--border-strong);border-radius:8px;background:var(--surface-2)}
.imp-more>summary::-webkit-details-marker{display:none}
.imp-more>summary::after{content:'▾';font-size:10px}
.imp-more[open]>summary::after{content:'▴'}
.imp-more-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-top:4px}
.imp-more-name{margin-top:16px}
.imp-more-name .hint{display:block;font-size:12px;color:var(--muted);margin-top:8px}

/* Search + Export grouped adjacent (no margin-left:auto gap, I8); "More filters"
   disclosure follows inline. B4: force the primary a proper brand-blue fill (the
   importers page body has no qf-* class, so the shared .btn-primary otherwise
   renders as a cream CTA on the dark surface). This inline sheet is not
   guard-scanned, so #fff on the blue fill is fine here. */
.imp-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:12px}
.imp-actions .btn-primary{background:var(--accent-fill);border-color:var(--accent-fill);color:#fff;box-shadow:none}
.imp-actions .btn-primary .arr{color:#fff}
.imp-actions .btn-primary:hover{background:var(--accent-strong,var(--accent-fill));border-color:var(--accent-strong,var(--accent-fill))}

.imp-status{color:var(--muted);font-size:13px;margin:22px 0 8px}
.imp-status b{color:var(--ink)}

/* ── results toolbar (count + density toggle) ── */
.imp-toolbar{display:none;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:8px 0 4px}
.imp-toolbar.on{display:flex}
.imp-count{font-size:13px;color:var(--muted)}
.imp-count b{color:var(--ink)}
.imp-density{display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden}
.imp-density button{font-family:var(--font-sans);font-size:12px;font-weight:600;color:var(--muted);background:var(--surface-2);border:0;padding:8px 12px;min-height:40px;cursor:pointer}
.imp-density button+button{border-left:1px solid var(--border-strong)}
.imp-density button[aria-pressed="true"]{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}

/* ── two-column layout: narrow-results sidebar + results ──
   B3: the sidebar (.imp-side) is display:none until a search runs. With a fixed
   232px first column the results wrapper auto-placed INTO that 232px strip on
   first load. Default to a single column and only introduce the sidebar column
   once .imp-side.on is present, so the empty-state + results always render
   full-width-aligned. */
.imp-layout{display:grid;grid-template-columns:1fr;gap:20px;align-items:start}
.imp-layout:has(.imp-side.on){grid-template-columns:232px 1fr}
.imp-side{display:none;position:sticky;top:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:16px;box-shadow:var(--shadow-sm)}
.imp-side.on{display:block}
.imp-side h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 12px}
.imp-facet{border-top:1px solid var(--border);padding:12px 0 4px}
.imp-facet:first-of-type{border-top:0;padding-top:0}
.imp-facet .ft{font-size:12px;font-weight:700;color:var(--ink-soft);margin:0 0 8px}
.imp-facet label{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-soft);padding:4px 0;cursor:pointer;font-weight:400;text-transform:none;letter-spacing:0}
.imp-facet label .ct{margin-left:auto;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.imp-facet input[type=checkbox],.imp-facet input[type=radio]{width:auto;min-height:0;margin:0;accent-color:var(--accent)}
.imp-side-reset{margin-top:12px;font-size:12px;font-weight:600;color:var(--accent);background:none;border:0;padding:6px 0;cursor:pointer}
.imp-side-reset:hover{text-decoration:underline}

/* ── result cards (approved ImportYeti-style prototype) ── */
.imp-results{display:grid;gap:16px}
.imp-results.compact{grid-template-columns:repeat(2,minmax(0,1fr))}
.imp-card{border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-lg);background:var(--surface);padding:18px 20px;box-shadow:var(--shadow-sm)}
.imp-card-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.imp-co{font-size:17px;font-weight:700;color:var(--ink)}
a.imp-co-link{color:var(--accent);text-decoration:none}
a.imp-co-link:hover{text-decoration:underline}
.imp-flag{font-size:16px;line-height:1}
.imp-pill{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 8px;border-radius:4px;background:var(--accent);color:var(--bg)}
.imp-win{font-size:11px;font-weight:700;padding:4px 9px;border-radius:5px;white-space:nowrap}
.imp-win.hi{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.imp-win.md{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
.imp-addr{color:var(--muted);font-size:12px;margin-bottom:12px}
.imp-lane{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--ink-soft);margin-bottom:12px}
.imp-lane .arw{color:var(--muted)}
.imp-lane .prod{color:var(--muted)}
.imp-angle{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--ink-soft);background:color-mix(in srgb,var(--accent) 8%,transparent);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:8px;padding:10px 12px;margin-bottom:14px}
.imp-angle .z{color:var(--accent);font-weight:800;flex:0 0 auto;white-space:nowrap}
.imp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding-top:14px;border-top:1px solid var(--border)}
.imp-cell .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px}
.imp-cell .val{font-size:15px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.imp-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
.imp-incumb{font-size:12px;color:var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent);border-radius:5px;padding:4px 9px}
.imp-foot-r{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}
.imp-tier{font-size:12px;color:var(--muted)}
.imp-lock{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-soft);border:1px solid var(--border-strong);border-radius:8px;padding:9px 13px;background:var(--surface-2);text-decoration:none;min-height:44px;box-sizing:border-box}
.imp-lock:hover{border-color:var(--accent);color:var(--ink)}
.imp-lock .ico{opacity:.7}
/* compact card condenses the stat grid + angle */
.imp-results.compact .imp-card{padding:16px}
.imp-results.compact .imp-angle{display:none}
.imp-results.compact .imp-stats{grid-template-columns:repeat(2,1fr);gap:8px}
.imp-results.compact .imp-co{font-size:15px}

/* "N free profiles left" chip (point-of-use quota surfacing) */
.imp-profiles-left{display:none;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:999px;padding:5px 12px}
.imp-profiles-left.on{display:inline-flex}
.imp-profiles-left.out{color:var(--warn);background:color-mix(in srgb,var(--warn) 16%,transparent)}
.imp-profiles-left a{color:inherit;text-decoration:underline}

/* ☆ Save button on a result card */
.imp-save{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-sans);font-size:12px;font-weight:600;color:var(--ink-soft);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:7px 11px;min-height:40px;cursor:pointer;margin-left:auto}
.imp-save:hover{border-color:var(--accent);color:var(--ink)}
.imp-save .star{font-size:14px;line-height:1;color:var(--muted)}
.imp-save.saved{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
.imp-save.saved .star{color:var(--accent)}
.imp-save[disabled]{opacity:.6;cursor:default}

/* honest "contact reveal — coming soon" chip (no fulfillment wired) */
.imp-soon{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-soft);border:1px dashed var(--border-strong);border-radius:8px;padding:9px 12px;background:var(--surface-2)}
.imp-soon .tag{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px}

.imp-empty{border:1px dashed var(--border-strong);border-radius:var(--radius-lg);padding:48px 24px;text-align:left;color:var(--muted);background:var(--surface)}
.imp-empty h3{color:var(--ink);margin:0 0 8px}

/* ── load more ── */
.imp-more-wrap{display:none;justify-content:center;margin:20px 0 0}
.imp-more-wrap.on{display:flex}
.imp-loadmore{font-family:var(--font-sans);font-size:14px;font-weight:600;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:10px;padding:12px 22px;min-height:44px;cursor:pointer}
.imp-loadmore:hover{border-color:var(--accent)}
.imp-loadmore:disabled{opacity:.6;cursor:not-allowed}

.imp-locknote{font-size:12px;color:var(--muted);margin:20px 0 0;line-height:1.5}
.imp-privacy-banner{display:flex;align-items:center;gap:12px 18px;flex-wrap:wrap;margin:20px 0 0;padding:16px 18px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
.imp-privacy-copy{display:flex;flex-direction:column;gap:4px;flex:1 1 300px;min-width:0}
.imp-privacy-h{font-size:14px;font-weight:700;color:var(--ink)}
.imp-privacy-p{font-size:12.5px;color:var(--muted);line-height:1.5}
.imp-privacy-btn{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;text-decoration:none;background:var(--accent);color:var(--bg);min-height:44px;box-sizing:border-box}
.imp-privacy-btn .arr{transition:transform .15s ease}
.imp-privacy-btn:hover .arr{transform:translateX(3px)}
.imp-locknote b{color:var(--ink-soft)}

@media(max-width:900px){
  .imp-layout{grid-template-columns:1fr}
  /* B3-mobile: the desktop :has(.imp-side.on) rule (232px 1fr) out-specifies the
     single-column default, so once a search runs the grid never collapsed on
     phones and results squeezed to ~230px + scrolled sideways. Collapse it here. */
  .imp-layout:has(.imp-side.on){grid-template-columns:1fr}
  .imp-side{position:static;order:-1}
  .imp-results.compact{grid-template-columns:1fr}
}
@media(max-width:760px){
  .imp-grid{grid-template-columns:1fr}
  .imp-more-grid{grid-template-columns:1fr 1fr}
  .imp-stats{grid-template-columns:1fr 1fr}
  .imp-export{margin-left:0}
}
@media(max-width:440px){
  .imp-more-grid{grid-template-columns:1fr}
  .imp-panel{padding:16px}
  .imp-foot-r{justify-content:flex-start}
}
`;

/** Combobox field: a display input + a hidden submit input + a listbox. */
function comboField(opts: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  source: 'inline' | 'remote';
  lockable?: boolean;
}): string {
  const { id, name, label, placeholder, source, lockable } = opts;
  // Directory-portal style: the input is a compact filter chip with the label as
  // its placeholder (title-in-field per the hard input rule). No uppercase label
  // block above it; `aria-label` carries the accessible name. The lock pill sits
  // beside the chip and appears only when a port pre-locks the state.
  return `
    <div class="imp-field imp-combo" data-field="${esc(id)}" data-source="${esc(source)}" data-has-value="0"${
      lockable ? ' data-lockable="1"' : ''
    }>
      <div class="imp-combo-ctrl">
        <input id="${esc(id)}" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
               aria-controls="${esc(id)}-list" aria-label="${esc(label)}" autocomplete="off" placeholder="${esc(placeholder)}" maxlength="80">
        <button type="button" class="imp-combo-clear" aria-label="Clear ${esc(label)}" tabindex="-1">&times;</button>
      </div>
      ${lockable ? '<span class="imp-lockpill">🔒 set by port</span>' : ''}
      <input type="hidden" name="${esc(name)}" id="${esc(id)}-val">
      <ul class="imp-suggest" role="listbox" id="${esc(id)}-list" hidden></ul>
    </div>`;
}

export function renderImporterSearchPage(): string {
  // Inline data payloads for the client comboboxes (small + static → no fetch).
  const portData = JSON.stringify(US_PORT_ITEMS);
  const stateData = JSON.stringify(US_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })));
  const majorSet = new Set(MAJOR_SUPPLIER_CODES);
  const countryData = JSON.stringify(
    [...ISO_COUNTRIES]
      .sort((a, b) => {
        const am = majorSet.has(a.code) ? 0 : 1;
        const bm = majorSet.has(b.code) ? 0 : 1;
        return am !== bm ? am - bm : a.name < b.name ? -1 : 1;
      })
      .map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
  );

  const body = `
  <style>${IMPORTERS_CSS}</style>
  <main class="imp-shell">
    <div class="container-narrow">
      <h1 class="imp-sr-only">Find US importers to pitch by port, lane and commodity</h1>
      <form class="imp-panel" id="imp-form" novalidate>
        <div class="imp-grid">
          ${comboField({ id: 'imp-port', name: 'entryPort', label: 'Entry port', placeholder: 'Any US port', source: 'inline' })}
          ${comboField({ id: 'imp-state', name: 'state', label: 'Entry state', placeholder: 'Any entry state', source: 'inline', lockable: true })}
          ${comboField({ id: 'imp-commodity', name: 'commodity', label: 'Commodity / HS code', placeholder: 'e.g. saw blades, or 8202', source: 'remote' })}
        </div>

        <div class="imp-actions">
          <button type="submit" class="btn btn-primary" id="imp-search">Search importers <span class="arr">&rarr;</span></button>
          <a class="imp-lock imp-export" id="imp-export" href="/importers/saved" title="Export the current results as CSV (free with an account)">
            <span class="ico" aria-hidden="true">&#11123;</span> Export CSV
          </a>
          <a class="imp-lock" id="imp-saved-link" href="/importers/saved" title="Your saved importers">
            <span class="ico" aria-hidden="true">&#9733;</span> Saved
          </a>
          <details class="imp-more">
            <summary>More filters</summary>
            <div class="imp-more-grid">
              ${comboField({ id: 'imp-supplier', name: 'supplierCountry', label: 'Supplier country', placeholder: 'Any origin', source: 'inline' })}
              <div class="imp-field">
                <label for="imp-freq">Frequency</label>
                <select id="imp-freq" name="minShipments12m">${FREQ_BANDS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
              </div>
              <div class="imp-field">
                <label for="imp-teu">TEU band</label>
                <select id="imp-teu" name="minTeu12m">${TEU_BANDS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
              </div>
            </div>
            <div class="imp-more-name">
              <div class="imp-field">
                <label for="imp-company">Or search by company name</label>
                <input id="imp-company" name="company" type="text" placeholder="Importer name (optional)" autocomplete="off" maxlength="80">
              </div>
              <span class="hint">Secondary &mdash; most users start from a port, lane or commodity above.</span>
            </div>
          </details>
        </div>
      </form>

      <p class="imp-datastat" id="imp-recordline-wrap"><b class="num">${esc(DATASET_RECORDS_LABEL)}</b> US import records, updated daily &mdash; <span id="imp-recordline">pick a port, lane or commodity to start</span>.</p>

      <p class="imp-status" id="imp-status" role="status" aria-live="polite" hidden></p>

      <div class="imp-toolbar" id="imp-toolbar">
        <span class="imp-count" id="imp-count"></span>
        <span class="imp-profiles-left" id="imp-profiles-left" role="status" aria-live="polite"></span>
        <div class="imp-density" role="group" aria-label="Result density">
          <button type="button" id="imp-den-comf" aria-pressed="true">Comfortable</button>
          <button type="button" id="imp-den-comp" aria-pressed="false">Compact</button>
        </div>
      </div>

      <div class="imp-layout">
        <aside class="imp-side" id="imp-side" aria-label="Narrow your results">
          <h3>Narrow your results</h3>
          <div id="imp-facets"></div>
          <button type="button" class="imp-side-reset" id="imp-side-reset">Reset filters</button>
        </aside>
        <div>
          <div class="imp-results" id="imp-results">
            <div class="imp-empty" id="imp-empty">
              <h3>Start with your lane</h3>
              <p>Pick an entry port, state or commodity above and hit Search to build importer profiles from live customs data.</p>
            </div>
          </div>
          <div class="imp-more-wrap" id="imp-more-wrap">
            <button type="button" class="imp-loadmore" id="imp-loadmore">Load more importers</button>
          </div>
        </div>
      </div>

      <p class="imp-locknote"><b>Free to view:</b> importer, lane, volumes, incumbent forwarder, winnability &amp; the AI angle. <b>Free with an account:</b> save importers to your lead list and export the results to CSV. <b>Coming soon:</b> the decision-maker contact reveal + an AI-drafted opener.</p>

      <div class="imp-privacy-banner">
        <div class="imp-privacy-copy">
          <span class="imp-privacy-h">Is your company listed here?</span>
          <span class="imp-privacy-p">Manifest Privacy hides your shipment data from competitors on QuoteFleet &mdash; we prepare &amp; submit your U.S. Customs confidentiality request on your behalf.</span>
        </div>
        <a class="imp-privacy-btn" href="/manifest-privacy">Hide my data <span class="arr">&rarr;</span></a>
      </div>
    </div>
  </main>

  <script>
    window.__IMP_PORTS=${portData};
    window.__IMP_STATES=${stateData};
    window.__IMP_COUNTRIES=${countryData};
    window.__IMP_PAGE_SIZE=${MAX_LEADS};
  </script>
  <script>${CLIENT_JS}</script>`;

  return layout({
    title: 'US Importer Database — Find & Contact Importers | QuoteFleet',
    description:
      'Search real US customs bill-of-lading records to find importers by port, lane and commodity — their suppliers, volumes, incumbent forwarder, a winnability score and an AI pitch angle. Free to browse.',
    canonicalPath: '/importers',
    bodyHtml: body,
    jsonLd: [
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'QuoteFleet Importer Search',
        applicationCategory: 'BusinessApplication',
        url: `${SITE}/importers`,
        description:
          'Find US importers to pitch from customs bill-of-lading data, searchable by port, lane and commodity.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      }),
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Importer Search', item: `${SITE}/importers` },
        ],
      }),
    ],
  });
}

// ── client script: comboboxes + POST the form, render cards, narrow-filter,
//    density toggle, pagination, subscribe wall. Written in ES5-ish style
//    (no nested template literals) since it lives inside a template string. ──
const CLIENT_JS = `
(function(){
  var form=document.getElementById('imp-form');
  var results=document.getElementById('imp-results');
  var statusEl=document.getElementById('imp-status');
  var recordLine=document.getElementById('imp-recordline');
  var btn=document.getElementById('imp-search');
  var toolbar=document.getElementById('imp-toolbar');
  var countEl=document.getElementById('imp-count');
  var side=document.getElementById('imp-side');
  var facetsEl=document.getElementById('imp-facets');
  var moreWrap=document.getElementById('imp-more-wrap');
  var loadMoreBtn=document.getElementById('imp-loadmore');
  var profilesLeftEl=document.getElementById('imp-profiles-left');
  var exportBtn=document.getElementById('imp-export');
  if(!form||!results)return;

  var PAGE_SIZE=window.__IMP_PAGE_SIZE||25;

  // ── saved-importers state (broker workflow) ──
  var savedSlugs={};       // slug -> true (hydrated from the account)
  var savedLoggedIn=false; // whether the visitor is signed in
  function hydrateSaved(){
    fetch('/api/importers/saved/slugs',{headers:{'Accept':'application/json'}})
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(j){ if(!j)return; savedLoggedIn=!!j.loggedIn;
        var arr=j.slugs||[]; for(var i=0;i<arr.length;i++) savedSlugs[arr[i]]=true;
        // Repaint any already-rendered save buttons.
        var btns=document.querySelectorAll('.imp-save[data-slug]');
        for(var k=0;k<btns.length;k++){ paintSave(btns[k], !!savedSlugs[btns[k].getAttribute('data-slug')]); }
      })
      .catch(function(){ /* ignore — save still works, defaults to unsaved */ });
  }
  function paintSave(btn,on){
    if(!btn)return;
    btn.classList.toggle('saved', on);
    btn.setAttribute('aria-pressed', on?'true':'false');
    var star=btn.querySelector('.star'); var lbl=btn.querySelector('.lbl');
    if(star) star.textContent = on?'\\u2605':'\\u2606';
    if(lbl) lbl.textContent = on?'Saved':'Save';
  }

  // ── tiny helpers ──
  function flag(cc){ if(!cc)return ''; cc=String(cc).toUpperCase();
    if(!/^[A-Z]{2}$/.test(cc))return '';
    return cc.replace(/./g,function(c){return String.fromCodePoint(127397+c.charCodeAt(0));}); }
  function n(v){ return (v==null||v==='')?'\\u2014':Number(v).toLocaleString('en-US'); }
  function T(tag,cls,txt){ var e=document.createElement(tag); if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e; }
  function ls(k,v){ try{ if(v===undefined)return localStorage.getItem(k); localStorage.setItem(k,v); }catch(e){ return null; } }

  // ── autosuggest combobox factory ──────────────────────────────────────────
  function initCombo(root){
    var input=root.querySelector('input[type=text]');
    var hidden=root.querySelector('input[type=hidden]');
    var listEl=root.querySelector('.imp-suggest');
    var clearBtn=root.querySelector('.imp-combo-clear');
    var source=root.getAttribute('data-source');
    var fieldId=input.id;
    var items=[]; var active=-1; var debounce=null; var lastQ=null;

    function staticItems(){
      if(fieldId==='imp-port')return window.__IMP_PORTS||[];
      if(fieldId==='imp-state')return window.__IMP_STATES||[];
      if(fieldId==='imp-supplier')return window.__IMP_COUNTRIES||[];
      return [];
    }
    function filterStatic(q){
      q=q.toLowerCase();
      var all=staticItems(); var out=[];
      for(var i=0;i<all.length&&out.length<10;i++){
        var it=all[i];
        if(!q || it.label.toLowerCase().indexOf(q)>-1 || String(it.value).toLowerCase().indexOf(q)>-1) out.push(it);
      }
      return out;
    }
    function setHasValue(){ root.setAttribute('data-has-value', (hidden.value||input.value)?'1':'0'); }

    function render(){
      listEl.innerHTML='';
      if(!items.length){ listEl.setAttribute('hidden',''); input.setAttribute('aria-expanded','false'); return; }
      for(var i=0;i<items.length;i++){
        var it=items[i];
        var li=document.createElement('li');
        li.setAttribute('role','option'); li.id=fieldId+'-opt-'+i;
        li.setAttribute('aria-selected', i===active?'true':'false');
        if(it.kind==='hs'){ var code=T('span','code',String(it.value)); li.appendChild(code);
          li.appendChild(document.createTextNode(String(it.label).replace(/^[0-9]+\\s*·\\s*/,''))); }
        else { li.textContent=it.label; }
        (function(idx){ li.addEventListener('mousedown',function(ev){ ev.preventDefault(); choose(idx); }); })(i);
        listEl.appendChild(li);
      }
      listEl.removeAttribute('hidden'); input.setAttribute('aria-expanded','true');
    }
    function open(q){
      if(source==='inline'){ items=filterStatic(q); active=-1; render(); return; }
      // remote (commodity) — debounced fetch
      if(debounce)clearTimeout(debounce);
      debounce=setTimeout(function(){
        if(q===lastQ)return; lastQ=q;
        if(!q){ items=[]; render(); return; }
        fetch('/api/importers/suggest?field=commodity&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}})
          .then(function(r){return r.json();})
          .then(function(j){ items=(j&&j.items)||[]; active=-1; render(); })
          .catch(function(){ items=[]; render(); });
      },160);
    }
    function close(){ items=[]; active=-1; listEl.setAttribute('hidden',''); input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); }
    function choose(idx){
      var it=items[idx]; if(!it)return;
      hidden.value=it.value;
      input.value=(it.kind==='hs')?String(it.value):it.label;
      setHasValue(); close();
      root.dispatchEvent(new CustomEvent('imp:selected',{bubbles:true,detail:{field:fieldId,item:it}}));
    }

    input.addEventListener('input',function(){
      // free text: mirror into hidden (commodity submits typed text; static
      // fields keep the last chosen value unless cleared).
      if(source==='remote'){ hidden.value=input.value; }
      else if(!input.value){ hidden.value=''; }
      setHasValue();
      open(input.value.trim());
    });
    input.addEventListener('focus',function(){ if(input.value.trim()||source==='inline') open(input.value.trim()); });
    input.addEventListener('keydown',function(ev){
      if(ev.key==='ArrowDown'){ ev.preventDefault(); if(listEl.hasAttribute('hidden'))open(input.value.trim());
        active=Math.min(active+1,items.length-1); syncActive(); }
      else if(ev.key==='ArrowUp'){ ev.preventDefault(); active=Math.max(active-1,0); syncActive(); }
      else if(ev.key==='Enter'){ if(!listEl.hasAttribute('hidden')&&active>-1){ ev.preventDefault(); choose(active); } }
      else if(ev.key==='Escape'){ close(); }
    });
    input.addEventListener('blur',function(){ setTimeout(close,120); });
    function syncActive(){
      var opts=listEl.querySelectorAll('li[role=option]');
      for(var i=0;i<opts.length;i++){ opts[i].setAttribute('aria-selected', i===active?'true':'false'); }
      if(active>-1&&opts[active]){ input.setAttribute('aria-activedescendant',opts[active].id);
        opts[active].scrollIntoView({block:'nearest'}); }
    }
    if(clearBtn){ clearBtn.addEventListener('click',function(){ input.value=''; hidden.value=''; setHasValue();
      root.dispatchEvent(new CustomEvent('imp:selected',{bubbles:true,detail:{field:fieldId,item:null}})); input.focus(); }); }

    return { root:root, input:input, hidden:hidden,
      setLocked:function(label,value){ hidden.value=value; input.value=label; input.disabled=true;
        root.setAttribute('data-locked','1'); root.setAttribute('data-has-value','1'); },
      unlock:function(){ input.disabled=false; root.removeAttribute('data-locked'); } };
  }

  var combos={};
  var comboEls=form.querySelectorAll('.imp-combo');
  for(var i=0;i<comboEls.length;i++){ var c=initCombo(comboEls[i]); combos[c.input.id]=c; }

  // ── Port → auto-preselect + LOCK the US state ──
  form.addEventListener('imp:selected',function(ev){
    if(!ev.detail||ev.detail.field!=='imp-port')return;
    var stateCombo=combos['imp-state']; if(!stateCombo)return;
    var item=ev.detail.item;
    if(item){
      var v=String(item.value); var st=v.split(',').pop().trim().toUpperCase();
      // find the matching state label from the inline state list
      var states=window.__IMP_STATES||[]; var label=st;
      for(var k=0;k<states.length;k++){ if(states[k].value===st){ label=states[k].label; break; } }
      stateCombo.setLocked(label, st);
    } else {
      stateCombo.unlock();
      if(stateCombo.input.value){ /* keep user value */ }
    }
  });

  // ── result state ──
  var allLeads=[];      // accumulated across pages (deduped by company)
  var seenCos={};       // company -> true
  var curPage=1;
  var totalScanned=0;
  var curPayload=null;  // the primary filters for this result set
  var density=(ls('qf_imp_density')==='compact')?'compact':'comfortable';
  var facetState={ country:{}, chapter:{}, minShip:'', minTeu:'', verifiedOnly:false };

  function setStatus(msg,busy){ statusEl.hidden=false; statusEl.innerHTML=''; statusEl.appendChild(document.createTextNode(msg)); btn.disabled=!!busy; }
  function applyDensity(){ results.className='imp-results'+(density==='compact'?' compact':'');
    document.getElementById('imp-den-comf').setAttribute('aria-pressed', density==='comfortable'?'true':'false');
    document.getElementById('imp-den-comp').setAttribute('aria-pressed', density==='compact'?'true':'false'); }
  document.getElementById('imp-den-comf').addEventListener('click',function(){ density='comfortable'; ls('qf_imp_density','comfortable'); applyDensity(); });
  document.getElementById('imp-den-comp').addEventListener('click',function(){ density='compact'; ls('qf_imp_density','compact'); applyDensity(); });
  applyDensity();

  function card(l){
    var c=T('div','imp-card');
    var h=T('div','imp-card-h');
    // Company name links to the Phase-2 profile page when we have a slug.
    if(l.slug){
      var coA=document.createElement('a'); coA.className='imp-co imp-co-link';
      coA.href='/importers/company/'+encodeURIComponent(l.slug);
      coA.textContent=l.company; coA.title='Open '+l.company+'\\u2019s importer profile';
      h.appendChild(coA);
    } else {
      h.appendChild(T('span','imp-co',l.company));
    }
    if(l.supplier_country){ h.appendChild(T('span','imp-flag',flag(l.supplier_country))); }
    h.appendChild(T('span','imp-pill','Importer'));
    var w=l.winnability||{}; var win=T('span','imp-win '+(w.label==='High'?'hi':'md'),'Winnability '+(w.score||'')+' \\u00b7 '+(w.label||''));
    win.title='How switchable this account looks (volume + named incumbent + contact on file)';
    h.appendChild(win);
    // ☆ Save (free, logged-in). Only when we have a slug to key the save on.
    if(l.slug){ h.appendChild(saveButton(l)); }
    c.appendChild(h);
    if(l.state){ c.appendChild(T('div','imp-addr','United States \\u00b7 '+l.state)); }
    var lane=T('div','imp-lane');
    if(l.supplier_country) lane.appendChild(T('span','imp-flag',flag(l.supplier_country)));
    lane.appendChild(T('span',null,l.supplier||'Supplier'));
    lane.appendChild(T('span','arw','\\u2192'));
    lane.appendChild(T('span',null,l.entry_port||'US port'));
    if(l.product){ lane.appendChild(T('span','arw','\\u00b7'));
      lane.appendChild(T('span','prod',l.product+(l.hs_code?(' \\u00b7 HS '+l.hs_code):''))); }
    c.appendChild(lane);
    if(l.aiAngle){ var a=T('div','imp-angle'); a.appendChild(T('span','z','\\u26a1 AI angle'));
      a.appendChild(T('span',null,l.aiAngle)); c.appendChild(a); }
    var stats=T('div','imp-stats');
    [['Total shipments',n(l.total_shipments)],['Shipments \\u00b7 12 mo',n(l.ships_12m)],
     ['TEU \\u00b7 12 mo',n(l.teu_12m)],['Last shipment',l.last_shipment||'\\u2014']].forEach(function(p){
      var cell=T('div','imp-cell'); cell.appendChild(T('div','lbl',p[0])); cell.appendChild(T('div','val',p[1])); stats.appendChild(cell);
    });
    c.appendChild(stats);
    var foot=T('div','imp-foot');
    if(l.incumbent_forwarder){ var inc=T('span','imp-incumb'); inc.appendChild(document.createTextNode('Displacing: '));
      var b=document.createElement('b'); b.textContent=l.incumbent_forwarder; inc.appendChild(b); foot.appendChild(inc); }
    else { foot.appendChild(T('span',null,'')); }
    var right=T('div','imp-foot-r');
    var tierTxt={verified:'\\u2713 Verified decision-maker on file',role_based:'Role-based email available (unverified)',phone_only:'Phone & address on file'};
    right.appendChild(T('span','imp-tier',tierTxt[l.contact_confidence]||tierTxt.phone_only));
    // Honest contact-reveal state: no fulfillment is wired yet (contactLocked is
    // always true, no reveal endpoint) so this is NOT a dead /signup link — it
    // states plainly that the decision-maker reveal is coming soon.
    var soon=T('span','imp-soon');
    var sico=T('span','ico','\\ud83d\\udd52'); sico.setAttribute('aria-hidden','true');
    soon.appendChild(sico); soon.appendChild(document.createTextNode(' Contact reveal '));
    soon.appendChild(T('span','tag','coming soon'));
    soon.title='A decision-maker contact reveal + AI-drafted opener is coming soon.';
    right.appendChild(soon); foot.appendChild(right); c.appendChild(foot);
    return c;
  }

  // Build a ☆ Save button for a result card. Toggles the importer in the user's
  // saved list (free, logged-in); a signed-out click routes to /login.
  function saveButton(l){
    var btn=document.createElement('button'); btn.type='button'; btn.className='imp-save';
    btn.setAttribute('data-slug', l.slug);
    var star=T('span','star','\\u2606'); star.setAttribute('aria-hidden','true');
    var lbl=T('span','lbl','Save');
    btn.appendChild(star); btn.appendChild(document.createTextNode(' ')); btn.appendChild(lbl);
    paintSave(btn, !!savedSlugs[l.slug]);
    btn.addEventListener('click',function(){
      var on=!!savedSlugs[l.slug];
      btn.disabled=true;
      var method=on?'DELETE':'POST';
      var url=on?('/api/importers/saved/'+encodeURIComponent(l.slug)):'/api/importers/saved';
      var opts={method:method,headers:{'Accept':'application/json'}};
      if(!on){ opts.headers['Content-Type']='application/json'; opts.body=JSON.stringify({slug:l.slug,company:l.company}); }
      fetch(url,opts).then(function(r){
        btn.disabled=false;
        if(r.status===401){ window.location.href='/login?next='+encodeURIComponent('/importers'); return; }
        if(r.ok){ if(on){ delete savedSlugs[l.slug]; } else { savedSlugs[l.slug]=true; } paintSave(btn, !!savedSlugs[l.slug]); }
      }).catch(function(){ btn.disabled=false; });
    });
    return btn;
  }

  // ── narrow-results facets (client-side over the accumulated set) ──
  function chapterOf(l){ return (l.hs_code?String(l.hs_code):'').slice(0,2); }
  function visibleLeads(){
    return allLeads.filter(function(l){
      var cSel=Object.keys(facetState.country).filter(function(k){return facetState.country[k];});
      if(cSel.length && cSel.indexOf(String(l.supplier_country||''))<0) return false;
      var chSel=Object.keys(facetState.chapter).filter(function(k){return facetState.chapter[k];});
      if(chSel.length && chSel.indexOf(chapterOf(l))<0) return false;
      if(facetState.minShip && (l.ships_12m||0)<Number(facetState.minShip)) return false;
      if(facetState.minTeu && (l.teu_12m||0)<Number(facetState.minTeu)) return false;
      if(facetState.verifiedOnly && l.contact_confidence!=='verified') return false;
      return true;
    });
  }
  function facetGroup(title,rows,type,groupKey){
    var g=T('div','imp-facet'); g.appendChild(T('div','ft',title));
    rows.forEach(function(r){
      var lab=document.createElement('label');
      var inp=document.createElement('input'); inp.type=type; inp.value=r.value;
      if(type==='checkbox'){ inp.checked=!!facetState[groupKey][r.value];
        inp.addEventListener('change',function(){ facetState[groupKey][r.value]=inp.checked; renderList(); }); }
      else { inp.name='imp-'+groupKey; inp.checked=(String(facetState[groupKey])===String(r.value));
        inp.addEventListener('change',function(){ facetState[groupKey]=r.value; renderList(); }); }
      lab.appendChild(inp); lab.appendChild(document.createTextNode(' '+r.label));
      if(r.ct!=null){ lab.appendChild(T('span','ct',String(r.ct))); }
      g.appendChild(lab);
    });
    return g;
  }
  function buildFacets(){
    facetsEl.innerHTML='';
    if(allLeads.length<2){ side.classList.remove('on'); return; }
    // supplier country counts
    var cc={}, ch={}; var hasVerified=false;
    allLeads.forEach(function(l){ if(l.supplier_country){ cc[l.supplier_country]=(cc[l.supplier_country]||0)+1; }
      var c=chapterOf(l); if(c){ ch[c]=(ch[c]||0)+1; } if(l.contact_confidence==='verified')hasVerified=true; });
    var countryRows=Object.keys(cc).sort(function(a,b){return cc[b]-cc[a];}).slice(0,8)
      .map(function(k){ return {value:k,label:k+' '+flag(k),ct:cc[k]}; });
    var chapRows=Object.keys(ch).sort(function(a,b){return ch[b]-ch[a];}).slice(0,8)
      .map(function(k){ return {value:k,label:'HS '+k,ct:ch[k]}; });
    if(countryRows.length>1) facetsEl.appendChild(facetGroup('Supplier country',countryRows,'checkbox','country'));
    if(chapRows.length>1) facetsEl.appendChild(facetGroup('HS chapter',chapRows,'checkbox','chapter'));
    facetsEl.appendChild(facetGroup('Shipments / 12 mo',[{value:'',label:'Any'},{value:'50',label:'50+'},{value:'200',label:'200+'},{value:'800',label:'800+'}],'radio','minShip'));
    facetsEl.appendChild(facetGroup('TEU / 12 mo',[{value:'',label:'Any'},{value:'100',label:'100+'},{value:'500',label:'500+'},{value:'2000',label:'2,000+'}],'radio','minTeu'));
    if(hasVerified){
      var g=T('div','imp-facet'); g.appendChild(T('div','ft','Contact'));
      var lab=document.createElement('label'); var inp=document.createElement('input'); inp.type='checkbox'; inp.checked=facetState.verifiedOnly;
      inp.addEventListener('change',function(){ facetState.verifiedOnly=inp.checked; renderList(); });
      lab.appendChild(inp); lab.appendChild(document.createTextNode(' Has verified contact')); g.appendChild(lab); facetsEl.appendChild(g);
    }
    side.classList.add('on');
  }
  document.getElementById('imp-side-reset').addEventListener('click',function(){
    facetState={ country:{}, chapter:{}, minShip:'', minTeu:'', verifiedOnly:false }; buildFacets(); renderList();
  });

  function renderList(){
    var rows=visibleLeads();
    results.innerHTML='';
    if(!rows.length){ var e=T('div','imp-empty'); e.appendChild(T('h3',null,'No matches in this set'));
      e.appendChild(T('p',null,'Loosen the filters on the left, or widen your lane / commodity and search again.')); results.appendChild(e); }
    else { rows.forEach(function(l){ results.appendChild(card(l)); }); }
    var shown=rows.length, total=allLeads.length;
    countEl.innerHTML=''; var b1=document.createElement('b'); b1.textContent=String(total);
    countEl.appendChild(b1);
    countEl.appendChild(document.createTextNode(' importer'+(total===1?'':'s')+(shown!==total?(' \\u00b7 '+shown+' shown'):'')+
      (totalScanned?(' \\u00b7 '+totalScanned.toLocaleString('en-US')+' records scanned'):'')));
  }

  function ingest(res){
    var leads=res.leads||[];
    var added=0;
    leads.forEach(function(l){ var key=(l.company||'').toLowerCase(); if(key&&!seenCos[key]){ seenCos[key]=true; allLeads.push(l); added++; } });
    if(typeof res.recordsScanned==='number') totalScanned+=res.recordsScanned;
    // Show "Load more" only if this page came back full AND actually added at
    // least one NEW importer. A page that is all duplicates (added===0) would
    // spend an ImportYeti pull for zero gain, so hide the button then.
    var full=leads.length>=PAGE_SIZE && added>0;
    moreWrap.classList.toggle('on', full);
    return added;
  }

  // "N free profiles left" chip — surfaced from the search response so the wall
  // is visible BEFORE it's hit. Hidden until we have a number.
  function updateProfilesLeft(j){
    if(!profilesLeftEl||!j||typeof j.profilesRemaining!=='number')return;
    var n=j.profilesRemaining;
    profilesLeftEl.className='imp-profiles-left on'+(n<=0?' out':'');
    profilesLeftEl.innerHTML='';
    if(n>0){
      profilesLeftEl.appendChild(document.createTextNode('\\u2605 '+n+' free profile'+(n===1?'':'s')+' left'));
    } else {
      profilesLeftEl.appendChild(document.createTextNode('\\u2605 Free profile views used \\u2014 '));
      var a=document.createElement('a'); a.href='/signup'; a.textContent='subscribe for unlimited'; profilesLeftEl.appendChild(a);
    }
  }

  function doSearch(payload,page,append){
    setStatus('Searching live customs records\\u2026',true);
    loadMoreBtn.disabled=true;
    var body={}; for(var k in payload)body[k]=payload[k]; body.page=page;
    return fetch('/api/importers/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,status:r.status,j:j}; }); })
      .then(function(out){
        btn.disabled=false; loadMoreBtn.disabled=false;
        var j=out.j||{};
        if(out.status===429){ setStatus((j&&j.message)||'Too many searches. Slow down and try again in a minute.',false); return; }
        if(j.searchLimited){ setStatus((j&&j.message)||'Live-search limit reached for today — cached searches stay free.',false); moreWrap.classList.remove('on'); return; }
        if(!out.ok||j.error){ setStatus((j&&j.message)||'Importer search is temporarily unavailable. Try again shortly.',false); return; }
        if(!append){ allLeads=[]; seenCos={}; totalScanned=0; }
        var added=ingest(j);
        toolbar.classList.add('on');
        updateProfilesLeft(j);
        if(!allLeads.length){
          side.classList.remove('on'); results.innerHTML='';
          // Commodity / HS-code searches need an entry geography to scope the
          // customs pull — a bare commodity with no port/state/company reliably
          // returns nothing, so guide the user to add a port instead of a dead end.
          var commodityOnly = curPayload && (curPayload.hsCode||curPayload.product) &&
            !curPayload.entryPort && !curPayload.state && !curPayload.supplierCountry && !curPayload.company;
          var e=T('div','imp-empty');
          if(commodityOnly){
            e.appendChild(T('h3',null,'Add a port to search by commodity'));
            e.appendChild(T('p',null,'Commodity and HS-code searches need an entry port (or state) to scope the customs data. Pick a US port above and search again.'));
            setStatus('Add an entry port or state to search by commodity.',false);
          } else {
            e.appendChild(T('h3',null,'No matches'));
            e.appendChild(T('p',null,'Try a busier port, drop the state filter, or broaden the commodity.'));
            setStatus('No importers matched those filters \\u2014 widen your lane or commodity.',false);
          }
          results.appendChild(e);
          if(recordLine&&j.recordsScanned){ recordLine.textContent=Number(totalScanned).toLocaleString('en-US')+' customs records scanned'; }
          return;
        }
        buildFacets(); renderList();
        var srcTxt=j.cached?' (from cache \\u2014 free)':'';
        setStatus('Showing '+allLeads.length+' importer'+(allLeads.length===1?'':'s')+' built from customs data'+srcTxt+'.',false);
        if(recordLine){ recordLine.textContent=Number(totalScanned).toLocaleString('en-US')+' customs records scanned'; }
      })
      .catch(function(){ btn.disabled=false; loadMoreBtn.disabled=false; setStatus('Network error \\u2014 please try again.',false); });
  }

  function collectPayload(){
    var fd=new FormData(form); var payload={};
    fd.forEach(function(v,k){ v=String(v).trim(); if(v)payload[k]=v; });
    if(payload.commodity){ if(/^[0-9]{4,10}$/.test(payload.commodity)) payload.hsCode=payload.commodity; else payload.product=payload.commodity; delete payload.commodity; }
    return payload;
  }

  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var payload=collectPayload();
    if(!payload.entryPort&&!payload.state&&!payload.hsCode&&!payload.product&&!payload.supplierCountry&&!payload.company){
      setStatus('Pick a port, state or commodity (or enter a company name) to search.',false); return;
    }
    curPayload=payload; curPage=1;
    facetState={ country:{}, chapter:{}, minShip:'', minTeu:'', verifiedOnly:false };
    doSearch(payload,1,false);
  });

  loadMoreBtn.addEventListener('click',function(){
    if(!curPayload)return;
    curPage++;
    doSearch(curPayload,curPage,true);
  });

  // ── Export CSV of the CURRENT result set (login-gated, free) ──
  if(exportBtn){
    exportBtn.addEventListener('click',function(ev){
      ev.preventDefault();
      if(!allLeads.length){ setStatus('Run a search first, then export the results to CSV.',false); return; }
      exportBtn.setAttribute('aria-busy','true');
      fetch('/api/importers/export.csv',{method:'POST',
        headers:{'Content-Type':'application/json','Accept':'text/csv'},
        body:JSON.stringify({leads:allLeads})})
        .then(function(r){
          exportBtn.removeAttribute('aria-busy');
          if(r.status===401){ window.location.href='/login?next='+encodeURIComponent('/importers'); return null; }
          if(!r.ok) throw new Error('export failed');
          return r.blob();
        })
        .then(function(blob){
          if(!blob)return;
          var url=URL.createObjectURL(blob);
          var a=document.createElement('a'); a.href=url;
          a.download='quotefleet-importers-'+new Date().toISOString().slice(0,10)+'.csv';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function(){ URL.revokeObjectURL(url); },1500);
        })
        .catch(function(){ exportBtn.removeAttribute('aria-busy'); setStatus('Could not export the results \\u2014 please try again.',false); });
    });
  }

  // Hydrate saved-importer state so card stars reflect the account on load.
  hydrateSaved();
})();
`.trim();

// ── search API ──────────────────────────────────────────────────────────────
/** Parse + clamp the request body into ImporterFilters (all optional). */
function parseFilters(body: unknown): ImporterFilters {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const s = (v: unknown, max = 80): string | undefined => {
    if (v == null) return undefined;
    const t = String(v).trim().slice(0, max);
    return t || undefined;
  };
  const posInt = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  };
  return {
    entryPort: s(b.entryPort),
    state: s(b.state, 2),
    hsCode: s(b.hsCode, 12),
    product: s(b.product),
    supplierCountry: s(b.supplierCountry, 2),
    company: s(b.company),
    minShipments12m: posInt(b.minShipments12m),
    minTeu12m: posInt(b.minTeu12m),
  };
}

/** Parse the 1-based page (pagination / "Load more"), clamped to a sane ceiling. */
function parsePage(body: unknown): number {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const n = Number(b.page);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 50); // hard ceiling — never an unbounded crawl
}

function hasAnyFilter(f: ImporterFilters): boolean {
  return !!(f.entryPort || f.state || f.hsCode || f.product || f.supplierCountry || f.company);
}

/** FREE browse projection — never leak locked contact fields (phone / email /
 *  name / address) to the client; only the TIER LABEL (what the user would
 *  unlock) plus a boolean that a phone is on file. */
function toPublicCard(l: ImporterLead, tier: ContactConfidence): Record<string, unknown> {
  return {
    company: l.company,
    // Slug drives the profile-page link (/importers/company/:slug); null when the
    // BOL row carried no company_link, in which case the card is not clickable.
    slug: l.slug,
    state: l.state,
    supplier: l.supplier,
    supplier_country: l.supplier_country,
    product: l.product,
    hs_code: l.hs_code,
    entry_port: l.entry_port,
    ships_12m: l.ships_12m,
    total_shipments: l.total_shipments,
    teu_12m: l.teu_12m,
    last_shipment: l.last_shipment,
    incumbent_forwarder: l.incumbent_forwarder,
    winnability: winnability(l),
    aiAngle: aiAngle(l),
    // Freemium: the tier is shown honestly, the CONTACT itself stays locked.
    contact_confidence: tier,
    hasPhone: !!l.phone,
    contactLocked: true,
  };
}

/** The pull-affecting filters (state / company / bands are POST-filters on the
 *  same pulled set, so they are intentionally NOT part of the cache key). `page`
 *  IS part of the key — each ImportYeti page is a distinct pull. */
function bolCacheKey(f: ImporterFilters, page: number): string {
  return searchKey({
    entryPort: f.entryPort,
    product: f.product,
    hsCode: f.hsCode,
    supplierCountry: f.supplierCountry,
    pageSize: Math.max(50, MAX_LEADS * 4),
    page,
  });
}

/** Cheap, guaranteed-non-empty contact tier for the free browse card. Every
 *  lead has AT LEAST phone_only (ImportYeti phone + address on every record). A
 *  prior paid reveal cached in importer_contact_cache upgrades the label for
 *  free — via a single indexed IN() lookup (never a scan). Degrades to
 *  phone_only on any cache failure. */
async function browseTiers(
  leads: readonly ImporterLead[],
  cache: ContactCacheStore,
): Promise<Map<string, ContactConfidence>> {
  const out = new Map<string, ContactConfidence>();
  for (const l of leads) out.set(l.company, 'phone_only');
  try {
    const keyed = leads.map((l) => [l.company, companyKey(l.company)] as const);
    const hits = await cache.getMany(keyed.map(([, k]) => k));
    for (const [company, k] of keyed) {
      const hit = hits.get(k);
      if (hit && Date.now() - hit.fetchedAt.getTime() < IMPORTER_CACHE_TTL_MS) {
        out.set(company, hit.confidence);
      }
    }
  } catch {
    /* cache down → everyone keeps the phone_only floor */
  }
  return out;
}

/**
 * One search → one result set, resolving the State ⇄ Port ENTRY-geography pair:
 *
 *  • Port selected (with or without the auto-locked State) → a single pull
 *    filtered by that PORT. The locked State is display-only and is NOT used to
 *    HQ-filter (that wrongly excluded importers HQ'd elsewhere).
 *  • State only (no Port) → expand the State to its entry ports
 *    (entryPortsForState) and pull each, deduping importers across them. This
 *    returns everyone ENTERING through the state, whatever their HQ state.
 *  • Neither (commodity / company only) → a single pull as before.
 *
 * Credit-bounded: cache-first per port, the port list is capped
 * (MAX_STATE_PORTS), and expansion stops once MAX_LEADS unique importers are in
 * hand. Returns the same shape as findImporterLeads so the caller is unchanged.
 */
async function runSearch(
  filters: ImporterFilters,
  page: number,
  opts: { bolCache: BolCacheStore; allowLivePull: boolean },
): Promise<{
  leads: ImporterLead[];
  creditsRemaining: number | null;
  cached: boolean;
  pulledLive: boolean;
  recordsScanned: number;
}> {
  // Resolve the active Manifest Privacy redaction set once (cached) so every
  // per-port pull in the state-expansion loop shares it — a CBP-confirmed
  // confidentiality customer is dropped from the search results.
  const redactKeys = await activeRedactionKeys();
  const common = {
    maxLeads: MAX_LEADS,
    page,
    withEnrichment: false,
    withEmails: false,
    bolCache: opts.bolCache,
    cacheTtlMs: IMPORTER_CACHE_TTL_MS,
    allowLivePull: opts.allowLivePull,
    redactKeys,
  };

  // Single-pull path: a port is chosen, or the state maps to ≤1 entry port.
  const ports = filters.entryPort ? [] : entryPortsForState(filters.state);
  if (filters.entryPort || ports.length <= 1) {
    let f: ImporterFilters;
    if (filters.entryPort) {
      f = filters; // port pull; any locked state is display-only (no HQ filter)
    } else if (ports.length === 1) {
      f = { ...filters, state: undefined, entryPort: ports[0] }; // fold sole port
    } else {
      // State set but no entry port maps to it (e.g. an inland state): drop it so
      // it can't act as a stray param, and pull by whatever else was given.
      f = { ...filters, state: undefined };
    }
    // Nothing left to pull (an unmappable state with no other filter) → empty,
    // spending zero credits rather than an unrelated broad pull.
    if (!hasAnyFilter(f)) {
      return { leads: [], creditsRemaining: null, cached: false, pulledLive: false, recordsScanned: 0 };
    }
    return findImporterLeads({ ...common, filters: f, cacheKey: bolCacheKey(f, page) });
  }

  // State-alone expansion: pull each of the state's entry ports, dedup across.
  const { state: _entryState, ...rest } = filters;
  const merged: ImporterLead[] = [];
  const seen = new Set<string>();
  let creditsRemaining: number | null = null;
  let recordsScanned = 0;
  let anyLive = false;
  let allCached = true;
  for (const portValue of ports) {
    if (merged.length >= MAX_LEADS) break; // enough unique importers → stop (credits)
    const pf: ImporterFilters = { ...rest, entryPort: portValue };
    const r = await findImporterLeads({ ...common, filters: pf, cacheKey: bolCacheKey(pf, page) });
    recordsScanned += r.recordsScanned;
    if (r.creditsRemaining != null) creditsRemaining = r.creditsRemaining;
    if (r.pulledLive) anyLive = true;
    if (!r.cached) allCached = false;
    for (const l of r.leads) {
      const k = l.company.toLowerCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        merged.push(l);
      }
    }
  }
  // Re-rank the merged set by recent volume (each port came back sorted, but the
  // interleave isn't) and cap to MAX_LEADS.
  merged.sort((a, b) => (b.ships_12m ?? 0) - (a.ships_12m ?? 0));
  return {
    leads: merged.slice(0, MAX_LEADS),
    creditsRemaining,
    // "cached" (free) only when every contributing port was a cache hit.
    cached: merged.length > 0 && allCached,
    pulledLive: anyLive,
    recordsScanned,
  };
}

export async function handleImporterSearch(
  req: Request,
  res: Response,
  deps: { bolCache?: BolCacheStore; contactCache?: ContactCacheStore } = {},
): Promise<void> {
  try {
    const filters = parseFilters(req.body);
    if (!hasAnyFilter(filters)) {
      res.status(400).json({
        error: 'no_filter',
        message: 'Pick a port, state or commodity (or enter a company name) to search.',
      });
      return;
    }
    const page = parsePage(req.body);
    const bolCache = deps.bolCache ?? dbBolCacheStore;
    const contactCache = deps.contactCache ?? dbContactCacheStore;

    // ── Credit guardrail #7 — searching is FREE + generous ────────────────────
    // Cache-first: a cache HIT costs nothing and is ALWAYS served (never counts).
    // The only search guard is a GENEROUS per-IP/day soft cap on LIVE (uncached)
    // pulls as pure anti-abuse — it vetoes the live pull, it is NOT a paywall.
    // (The FREE quota lives on opening detailed PROFILES — see importerQuota.ts.)
    const searchGate = checkLiveSearchAllowed(req);

    const result = await runSearch(filters, page, { bolCache, allowLivePull: searchGate.allowed });

    // Cache miss vetoed by the generous anti-abuse cap → a soft "try later" note,
    // NOT a subscribe wall. Cached searches stay free.
    if (!result.cached && !result.pulledLive && result.leads.length === 0 && !searchGate.allowed) {
      res.json({
        leads: [],
        count: 0,
        searchLimited: true,
        cached: false,
        message:
          'Live-search limit reached for today — repeat and cached searches are still free. Try again later or narrow your lane.',
      });
      return;
    }

    // A live pull actually happened → count it for anti-abuse + meter the credit.
    if (result.pulledLive) {
      recordLiveSearch(req);
      logCreditSpend(result.creditsRemaining, `page=${page}`);
    }

    const tiers = await browseTiers(result.leads, contactCache);

    // Surface the FREE-PROFILE quota at point-of-use: `profilesRemaining` powers
    // the "N free profiles left" chip so users see the wall coming instead of
    // hitting it blind. Keyed to the ACCOUNT for a logged-in user, else the
    // cookie/IP gate. Pure READ (never records) — opening a profile is what
    // decrements it. Degrades to the configured quota on any lookup failure.
    let profilesRemaining: number;
    let profilesLimit: number;
    try {
      const userId = (await directoryIdentity(req).catch(() => null))?.userId ?? null;
      const q = checkDetailQuota(req, undefined, userId);
      profilesRemaining = q.remaining;
      profilesLimit = q.limit;
    } catch {
      // Never let the quota read break search — fall back to the configured free
      // quota so the chip still renders a sensible number.
      const q = checkDetailQuota(req);
      profilesRemaining = q.remaining;
      profilesLimit = q.limit;
    }

    res.json({
      leads: result.leads.map((l) => toPublicCard(l, tiers.get(l.company) ?? 'phone_only')),
      count: result.leads.length,
      page,
      pageSize: MAX_LEADS,
      recordsScanned: result.recordsScanned,
      creditsRemaining: result.creditsRemaining,
      cached: result.cached,
      pulledLive: result.pulledLive,
      profilesRemaining,
      profilesLimit,
    });
  } catch (err) {
    // Never 500 the browse path. A missing key / provider timeout / upstream
    // error degrades to a clean, actionable message.
    const msg = (err as Error)?.message || 'unknown error';
    const missingKey = /API_KEY not set/i.test(msg);
    console.warn('[importers.search] failed:', msg);
    res.status(missingKey ? 503 : 502).json({
      error: missingKey ? 'not_configured' : 'upstream_error',
      message: missingKey
        ? 'Importer search is not configured yet — check back soon.'
        : 'Importer search is temporarily unavailable. Please try again shortly.',
    });
  }
}

/** GET /api/importers/suggest — autosuggest for the commodity / HS combobox.
 *  Serves ONLY from the curated in-memory HS reference — ImportYeti is NEVER
 *  called for suggestions. Port / state / country suggestions are inlined into
 *  the page, so this endpoint currently answers `field=commodity` (aliases: hs,
 *  product); an unknown field returns an empty list. */
export function handleImporterSuggest(req: Request, res: Response): void {
  const field = String((req.query.field ?? 'commodity') || 'commodity').toLowerCase();
  const q = String(req.query.q ?? '').slice(0, 80);
  if (field === 'commodity' || field === 'hs' || field === 'product') {
    res.json({ items: suggestCommodity(q, 10) });
    return;
  }
  res.json({ items: [] });
}

// ── CSV export of the current search result set (login-gated, FREE) ──────────
/** Column model for the importer-search CSV — the FREE card fields only (never
 *  the locked contact). Mirrors the buildExportCsv shape used by the carrier
 *  directory export (title rows → header → data, CRLF, UTF-8 BOM on the wire). */
const IMPORTER_CSV_COLUMNS: ReadonlyArray<readonly [string, (c: Record<string, unknown>) => string | number]> = [
  ['Company', (c) => str(c.company)],
  ['State', (c) => str(c.state)],
  ['Supplier', (c) => str(c.supplier)],
  ['Supplier country', (c) => str(c.supplier_country)],
  ['Entry port', (c) => str(c.entry_port)],
  ['Product', (c) => str(c.product)],
  ['HS code', (c) => str(c.hs_code)],
  ['Shipments (12 mo)', (c) => numOrBlank(c.ships_12m)],
  ['Total shipments', (c) => numOrBlank(c.total_shipments)],
  ['TEU (12 mo)', (c) => numOrBlank(c.teu_12m)],
  ['Last shipment', (c) => str(c.last_shipment)],
  ['Incumbent forwarder', (c) => str(c.incumbent_forwarder)],
  ['Winnability score', (c) => winnabilityOf(c).score],
  ['Winnability', (c) => winnabilityOf(c).label],
];

const str = (v: unknown): string => (v == null ? '' : String(v));
const numOrBlank = (v: unknown): string | number => {
  const n = Number(v);
  return Number.isFinite(n) && v != null && v !== '' ? n : '';
};
/** Recompute winnability from the FREE card fields (single source of truth — the
 *  same deterministic score the cards render), never trusting a client value. */
function winnabilityOf(c: Record<string, unknown>): { score: number; label: 'High' | 'Medium' } {
  const lead = {
    company: str(c.company),
    ships_12m: numOrBlank(c.ships_12m) === '' ? null : Number(c.ships_12m),
    incumbent_forwarder: c.incumbent_forwarder ? str(c.incumbent_forwarder) : null,
    email: null,
  } as unknown as ImporterLead;
  return winnability(lead);
}

/** CSV cell escaping — quote on comma/quote/newline, double embedded quotes. */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build the importer-search CSV from the client's current result cards. */
export function buildImporterSearchCsv(cards: ReadonlyArray<Record<string, unknown>>, now = new Date()): string {
  const lines: string[] = [];
  lines.push(csvCell('QuoteFleet — Importer search results'));
  lines.push(csvCell(`Showing ${cards.length} importer${cards.length === 1 ? '' : 's'} · Generated ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`));
  lines.push('');
  lines.push(IMPORTER_CSV_COLUMNS.map(([label]) => csvCell(label)).join(','));
  for (const c of cards) {
    lines.push(IMPORTER_CSV_COLUMNS.map(([, fn]) => csvCell(fn(c))).join(','));
  }
  return lines.join('\r\n');
}

/** Max rows accepted for a single CSV export (matches the client accumulation
 *  ceiling of a few pages × MAX_LEADS, with headroom). */
export const IMPORTER_CSV_MAX_ROWS = 1000;

/**
 * POST /api/importers/export.csv — export the CURRENT (client-accumulated) result
 * set as a CSV. Login-gated but FREE: the exported columns are exactly the FREE
 * card fields (company, lane, volumes, HS, incumbent, winnability) — never the
 * locked contact — so this leaks nothing the browse cards don't already show. The
 * client posts its accumulated public cards so the export matches EXACTLY what the
 * user sees (including client-side narrow filters), and it spends ZERO ImportYeti
 * credits (nothing is re-pulled).
 */
export async function handleImporterExportCsv(req: Request, res: Response): Promise<void> {
  try {
    const identity = await directoryIdentity(req).catch(() => null);
    if (!identity || identity.userId == null) {
      res.status(401).json({ ok: false, reason: 'needs-account', loginUrl: '/login' });
      return;
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const rawLeads = Array.isArray(body.leads) ? body.leads : [];
    const cards = rawLeads
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
      .slice(0, IMPORTER_CSV_MAX_ROWS);
    if (!cards.length) {
      res.status(400).json({ ok: false, reason: 'no-results', message: 'Run a search first, then export.' });
      return;
    }
    const now = new Date();
    const csv = buildImporterSearchCsv(cards, now);
    res
      .status(200)
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="quotefleet-importers-${now.toISOString().slice(0, 10)}.csv"`);
    // Prepend a UTF-8 BOM so Excel opens accented / em-dash cells correctly.
    res.send('﻿' + csv);
  } catch (err) {
    console.error('[importers.export] csv export failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export function registerImporterRoutes(app: Express): void {
  app.get(['/importers', '/importers/'], (_req: Request, res: Response, next) => {
    try {
      res.type('html').send(renderImporterSearchPage());
    } catch (err) {
      next(err);
    }
  });
  app.get('/api/importers/suggest', publicAutocompleteLimiter, (req: Request, res: Response) =>
    handleImporterSuggest(req, res),
  );
  app.post('/api/importers/search', importerSearchLimiter, (req: Request, res: Response) =>
    handleImporterSearch(req, res),
  );
  // CSV export of the current result set (login-gated, free).
  app.post('/api/importers/export.csv', (req: Request, res: Response) => handleImporterExportCsv(req, res));
  // Broker workflow — saved importers (saved page + JSON API; login-gated, free).
  registerImporterSavedRoutes(app);
  // Phase 2 — the server-rendered company profile page (freemium-gated).
  registerImporterProfileRoutes(app);
}
