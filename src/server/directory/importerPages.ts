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
 * ALL FREE to view — as are the company phone number and street address on each
 * importer's profile. The one LOCKED thing is the decision-maker EMAIL (plus the
 * AI-drafted outreach and CSV export), behind the metered profile reveal.
 *
 * Styles are inlined in this TS module (like DIRECTORY_CSS), so the public-dir
 * CSS/color/spacing guards — which only scan src/server/public — never touch them.
 */
import type { Express, Request, Response } from 'express';
import { layout, esc } from './pages.js';
import { CONTAINER_PORTS } from './containerPorts.js';
import { EXTRA_STATE_ENTRY_PORTS, quoteLaneHref } from './entryPortFacets.js';
import { US_STATES } from './usStates.js';
import { ISO_COUNTRIES, MAJOR_SUPPLIER_CODES } from './isoCountries.js';
import { suggestCommodity } from './hsCodes.js';
import {
  findImporterLeads,
  winnability,
  aiAngle,
  isForwarder,
  searchCompaniesByName,
  companySearchRowToLead,
  MAX_LEADS,
  CONTACT_TIER_COPY,
  type ImporterFilters,
  type ImporterLead,
  type ContactConfidence,
} from './importerLeads.js';
// The free-taste / Leads Pro allowance numbers the lock-note quotes. Read from
// the entitlement module rather than retyped, so the marketing line on the search
// page can never drift from the counts the reveal endpoint actually enforces.
import { FREE_REVEAL_TASTE, LEADS_PRO_MONTHLY_ALLOWANCE } from './leadsEntitlement.js';
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
import { CACHE_ONLY_NOTE } from './externalPullGuard.js';
import {
  indexLeads,
  searchNameIndex,
  suggestCompanies,
  isLeadRedacted,
  NAME_INDEX_MAX_RESULTS,
} from './importerNameIndex.js';
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
  /** UN/LOCODE from CONTAINER_PORTS — the `?port=` value the directory filters
   *  on, so a result card can deep-link an RFQ at this gateway. */
  code: string;
}
export const US_PORT_ITEMS: readonly PortItem[] = US_PORTS.map((p) => ({
  value: `${p.city}, ${p.state}`,
  label: `${p.name} — ${p.city}, ${p.state}`,
  state: p.state,
  code: p.code,
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

/**
 * Audience seats for the results switcher. QuoteFleet's own idea (NOT
 * ImportYeti's tab bar) and the one differentiator here: the same result set,
 * re-weighted for who is reading it. Lines up with the audience-segmented
 * navigation shipped in #428.
 *
 * Every seat renders the SAME projection — the switch is pure CSS/attribute, so
 * it costs nothing, hits no endpoint and can never advertise data we don't have.
 */
/**
 * Result sort orders (R3).
 *
 * Sorting is CLIENT-side over the set already fetched, so changing it costs no
 * ImportYeti credits and issues no request. `ships` is first because it is the
 * order the server already returns (runSearch re-ranks by 12-mo shipments), so
 * the default selection tells the truth about what you are looking at instead
 * of implying an ordering the list does not have.
 */
export const SORTS: ReadonlyArray<[string, string]> = [
  ['ships', 'Shipments · 12 mo'],
  ['total', 'Total shipments'],
  ['teu', 'TEU · 12 mo'],
  ['recent', 'Most recent shipment'],
  ['win', 'Winnability'],
  ['company', 'Company A–Z'],
];

export const AUDIENCES: ReadonlyArray<[string, string]> = [
  ['trucker', 'Trucker'],
  ['broker', 'Broker'],
  ['forwarder', 'Forwarder'],
  ['supplier', 'Supplier'],
];

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
/* Visible page header. Left-aligned, never centred (house rule) — the shared
   .hero centres, which is why this page gets its own. */
.imp-head{text-align:left;margin:0 0 16px}
.imp-head h1{font-size:30px;line-height:1.14;letter-spacing:-.02em;color:var(--ink);margin:0}
.imp-head .imp-sub{font-size:14px;line-height:1.6;color:var(--muted);margin:8px 0 0;max-width:70ch}
@media(max-width:620px){.imp-head{margin-bottom:12px}.imp-head h1{font-size:24px}.imp-head .imp-sub{font-size:13.5px}}
/* One-line trust / record strip (replaces the big floating datastat pill) —
   carries the 700M+ figure inline, mockup-style. */
.imp-datastat{color:var(--muted);font-size:13px;line-height:1.5;margin:0}
.imp-datastat .num{font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.imp-datastat #imp-recordline{color:var(--ink-soft);font-weight:600}
.imp-shell{padding:24px 0 56px}
/* A search/results workspace needs room: the shared 780px narrow container made
   the sidebar + cards fight for ~490px. Widen to a data-table-grade canvas. */
.imp-shell .container-narrow{max-width:1200px}

/* ── search bar — a grouped filter rail, not a loose row of inputs ── */
.imp-panel{margin:0;padding:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--shadow-sm)}
/* align-items:START, not center. The Entry-port field grows downward when the
   "set by port" lock pill appears under it; centring then re-centred that taller
   field, so picking a port pushed Port and Commodity 13px BELOW Entry state and
   the pill drifted into the button row's band. Top-aligning pins every box in
   the row to the same baseline and lets the pill simply extend its own field. */
/* FOUR filters now (Entry port · Entry state · Commodity/HS · Company name), so
   the rail is an explicit grid rather than a wrapping flex row. Flex-wrap would
   have dropped ONE control onto a line of its own at any width between three and
   four columns — the orphan-wrap the house rule forbids. Declared column counts
   step 4 → 2 → 1 and never pass through 3. */
.imp-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;align-items:start}
.imp-field{display:flex;flex-direction:column;gap:8px;min-width:0}
.imp-field label{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.imp-field input,.imp-field select{width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:14px;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:10px 12px;min-height:44px;appearance:none;-webkit-appearance:none}
.imp-field input::placeholder{color:var(--muted)}
/* ── title-in-field (hard input rule) ──
   R3: the three primary filters previously carried their name ONLY in the
   placeholder + aria-label, so the moment a value was typed the field went
   anonymous — you could not tell "Savannah, GA" was the ENTRY PORT and not the
   state. The caption now sits inside the field box, top-left, and never
   disappears; the value renders under it. Applied to the secondary select
   fields too so one panel speaks one language. */
.imp-capfield{position:relative}
.imp-cap{position:absolute;top:6px;left:13px;z-index:1;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);pointer-events:none;line-height:1;max-width:calc(100% - 26px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.imp-capfield input,.imp-capfield select{padding:21px 12px 7px;min-height:52px}
.imp-capfield:focus-within .imp-cap{color:var(--accent)}
/* The stacked <label> above the secondary fields is replaced by the in-field
   caption; it stays in the DOM for the accessible name only. */
.imp-field.imp-capfield>label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
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
/* The lock caption sizes to its text — as a stretched flex child it rendered as
   a full-width bar under the field. */
.imp-lockpill{display:none;align-self:flex-start;align-items:center;gap:6px;font-size:10.5px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:999px;padding:2px 9px;margin-top:-2px;text-transform:none;letter-spacing:0}
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
/* Three secondary filters (supplier country, frequency, TEU) — three columns, so
   all three sit on one line. A two-column grid left the third alone underneath,
   the same orphan the primary rail above now avoids by construction. */
.imp-more-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:4px}
/* Coverage note under the company-name field: what a name search actually
   searches. Top-left under its own field, never a floating aside. */
.imp-namehint{grid-column:1 / -1;font-size:12px;line-height:1.5;color:var(--muted);margin:2px 0 0}
.imp-namehint b{color:var(--ink-soft);font-weight:600}

/* Search + Export grouped adjacent (no margin-left:auto gap, I8); "More filters"
   disclosure follows inline. B4: force the primary a proper brand-blue fill (the
   importers page body has no qf-* class, so the shared .btn-primary otherwise
   renders as a cream CTA on the dark surface). This inline sheet is not
   guard-scanned, so #fff on the blue fill is fine here. */
.imp-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:12px}
.imp-actions .btn-primary{background:var(--accent-fill);border-color:var(--accent-fill);color:#fff;box-shadow:none}
/* Busy, not broken. The blanket opacity:.5 the shared button applies while
   disabled composited to ~2.2-3.0:1 in both themes — it read as an error state,
   and the label never changed, so nothing said the search was running. Keep the
   fill, dim it deliberately, and let the label swap to "Searching…". */
.imp-actions .btn-primary[disabled]{opacity:1;cursor:progress;
  background:color-mix(in srgb,var(--accent-fill) 62%,var(--surface-2));
  border-color:color-mix(in srgb,var(--accent-fill) 62%,var(--surface-2));color:#fff}
.imp-actions .btn-primary[disabled] .arr{opacity:.75}
.imp-actions .btn-primary .arr{color:#fff}
/* --accent-strong DARKENS in light (#0A30CC, 9.1:1 under #fff) but BRIGHTENS in
   dark (#93A9FF), where the same #fff label drops to 2.24:1 — the page's primary
   action, in the default theme. Deepening the fill instead of jumping straight
   to the strong token keeps a visible hover in both directions and clears AA:
   5.38:1 dark / 7.34:1 light. Light keeps the crisper token below. */
.imp-actions .btn-primary:hover{background:color-mix(in srgb,var(--accent-strong,var(--accent-fill)) 25%,var(--accent-fill));border-color:color-mix(in srgb,var(--accent-strong,var(--accent-fill)) 25%,var(--accent-fill))}
html[data-theme="light"] .imp-actions .btn-primary:hover{background:var(--accent-strong,var(--accent-fill));border-color:var(--accent-strong,var(--accent-fill))}

.imp-status{color:var(--muted);font-size:13px;margin:0}
.imp-status b{color:var(--ink)}
/* Trust strip: the 700M+ record line + the live search status share one calm
   band under the filter rail instead of stacking two loose paragraphs. */
.imp-trust{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;margin:12px 0 0;padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2)}
.imp-trust .imp-status:not([hidden])::before{content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:middle}

/* ── results toolbar (count + density toggle) ── */
/* Two DECLARED rows, both left-aligned. It used to be one wrapping row where
   .imp-countwrap took a flex-basis of 420px — enough to claim the whole first line at
   1440 — after which margin-left:auto shoved the entire control cluster to the
   far right of line two, leaving ~480px of dead space exactly where the eye
   starts scanning. Making the split explicit removes the accident. */
.imp-toolbar{display:none;align-items:center;gap:10px 12px;flex-wrap:wrap;margin:20px 0 12px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.imp-toolbar.on{display:flex}
.imp-countwrap{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 100%}
.imp-count{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.imp-count b{color:var(--ink);font-weight:700}
/* ── sample-scope disclosure (R4) ──
   Sort and the "Narrow your results" facets operate over the set ALREADY
   PULLED, not over the whole customs corpus — "Sort by TEU" ranks the loaded
   importers, not every importer on the lane. Nothing on the page said so, and a
   user reasonably reads a sort control as ranking everything. This line states
   the scope in the same place the count is read, and names "Load more" as the
   way to widen it. Same honest-claims discipline as the rest of the codebase. */
.imp-scope{display:flex;align-items:baseline;gap:6px 10px;flex-wrap:wrap;font-size:11.5px;line-height:1.5;color:var(--muted)}
.imp-scope .ico{flex:0 0 auto;font-size:11px;color:var(--accent);font-weight:700}
.imp-scope .txt{min-width:0}
/* Share the CURRENT search — the URL already carries the filters + sort (R4),
   but a silently-rewritten address bar is an invisible feature. */
.imp-copylink{flex:0 0 auto;font-family:var(--font-sans);font-size:11.5px;font-weight:600;color:var(--accent);
  background:none;border:0;padding:2px 0;cursor:pointer;text-decoration:none}
.imp-copylink:hover{color:var(--ink);text-decoration:underline;text-underline-offset:2px}
.imp-copylink:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.imp-copylink.done{color:color-mix(in srgb,var(--success) 62%,var(--ink));text-decoration:none}
/* Controls row: starts at the left edge (see .imp-toolbar), and every control in
   it stands 40px tall — they were 40 / 29 / 42, a ragged band. */
.imp-toolbar-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1 1 100%;margin-left:0}
.imp-toolbar-r .imp-aud button,.imp-toolbar-r .imp-density button,.imp-toolbar-r .imp-sortwrap select{min-height:40px}
.imp-toolbar-r .imp-profiles-left{min-height:40px;box-sizing:border-box}
/* Sort control (R3). Client-side reorder of the already-fetched set — no
   request, no credits. Sized down to sit level with the density segmented
   control rather than towering over it. */
.imp-sortwrap{flex:0 0 auto;width:auto;min-width:186px}
.imp-sortwrap select{min-height:38px;padding:17px 26px 4px 11px;font-size:12px;font-weight:600;border-radius:8px;
  background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);
  background-position:calc(100% - 14px) calc(50% + 3px),calc(100% - 9px) calc(50% + 3px);
  background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.imp-sortwrap .imp-cap{top:5px;left:12px;font-size:9.5px}

/* ── applied-filter chips (R3) ──
   The facet rail said WHAT was available but never what was APPLIED — the only
   feedback was a number on the rail header, itself hidden except when folded on
   a phone. Each chip names one active facet and removes exactly that one. */
.imp-chips{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;
  border:1px solid var(--border);border-radius:10px;background:var(--surface-2)}
.imp-chips[hidden]{display:none}
.imp-chips-cap{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);flex:0 0 auto}
.imp-chips-list{display:contents}
.imp-chip{display:inline-flex;align-items:center;gap:7px;font-family:var(--font-sans);font-size:12px;font-weight:600;
  /* Raw --accent on its own 11% tint measures 4.14:1 in DARK — the tint lifts the
     background while the text stays put. Mixed toward --ink it clears AA in both
     directions (ink is light in dark, dark in light), the same correction
     .imp-win carries. */
  color:color-mix(in srgb,var(--accent) 82%,var(--ink));background:color-mix(in srgb,var(--accent) 11%,transparent);
  border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);border-radius:999px;
  padding:5px 9px 5px 11px;min-height:30px;cursor:pointer;max-width:100%;transition:background .14s,border-color .14s}
.imp-chip:hover{background:color-mix(in srgb,var(--accent) 20%,transparent);border-color:var(--accent)}
.imp-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.imp-chip .lb{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.imp-chip .x{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;
  font-size:13px;line-height:1;background:color-mix(in srgb,var(--accent) 22%,transparent);flex:0 0 auto}
.imp-chips-clear{margin-left:auto;font-family:var(--font-sans);font-size:12px;font-weight:600;color:var(--muted);
  background:none;border:0;padding:6px 2px;min-height:30px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.imp-chips-clear:hover{color:var(--ink)}
.imp-chips-clear:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
/* The results region takes programmatic focus after a search (see CLIENT_JS).
   It is a scroll/landing target, not an interactive control, so it must not
   paint a ring when focused that way. */
.imp-results:focus{outline:none}
.imp-results:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:var(--radius-lg)}
.imp-density{display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;background:var(--surface-2)}
.imp-density button{font-family:var(--font-sans);font-size:12px;font-weight:600;color:var(--muted);background:none;border:0;padding:8px 13px;min-height:38px;cursor:pointer;transition:color .14s,background .14s}
.imp-density button+button{border-left:1px solid var(--border-strong)}
.imp-density button:hover{color:var(--ink)}
.imp-density button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
/* selected = tinted + outlined, never a bright fill (hard UI rule) */
/* Same accent-on-accent-tint trap as .imp-chip: 4.05:1 in DARK. */
.imp-density button[aria-pressed="true"]{background:color-mix(in srgb,var(--accent) 12%,transparent);color:color-mix(in srgb,var(--accent) 82%,var(--ink));box-shadow:inset 0 0 0 1px var(--accent)}

/* ── audience switcher (Trucker / Broker / Forwarder / Supplier) ──
   Same segmented-control idiom as .imp-density on purpose — ONE toggle pattern
   per surface. Switching re-weights the SAME projection via [data-aud] rules
   below: no re-query, no new data, no network. */
.imp-aud{display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;background:var(--surface-2)}
.imp-aud button{font-family:var(--font-sans);font-size:12px;font-weight:600;color:var(--muted);background:none;border:0;padding:8px 12px;min-height:38px;cursor:pointer;transition:color .14s,background .14s}
.imp-aud button+button{border-left:1px solid var(--border-strong)}
.imp-aud button:hover{color:var(--ink)}
.imp-aud button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.imp-aud button[aria-pressed="true"]{background:color-mix(in srgb,var(--accent) 12%,transparent);color:color-mix(in srgb,var(--accent) 82%,var(--ink));box-shadow:inset 0 0 0 1px var(--accent)}
/* The 1px divider between siblings painted straight over the pressed button's
   inset ring, so the selected outline was accent on three edges and grey on the
   fourth. Drop the divider on the pressed button and on the one after it. */
.imp-aud button[aria-pressed="true"],.imp-aud button[aria-pressed="true"]+button{border-left-color:transparent}
/* One-line explanation of the seat being shown. Full-width row of the toolbar
   (order:9 keeps it last however the controls wrap). Accent TINT, never an
   accent fill under text. */
.imp-audhint{order:9;width:100%;display:flex;gap:9px;align-items:flex-start;font-size:12px;line-height:1.5;
  color:var(--ink-soft);background:color-mix(in srgb,var(--accent) 7%,transparent);
  border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);border-radius:8px;padding:8px 12px}
.imp-audhint b{color:var(--accent);font-weight:700;flex:0 0 auto;white-space:nowrap}

/* ── two-column layout: narrow-results sidebar + results ──
   B3: the sidebar (.imp-side) is display:none until a search runs. With a fixed
   232px first column the results wrapper auto-placed INTO that 232px strip on
   first load. Default to a single column and only introduce the sidebar column
   once .imp-side.on is present, so the empty-state + results always render
   full-width-aligned. */
.imp-layout{display:grid;grid-template-columns:1fr;gap:24px;align-items:start}
.imp-layout:has(.imp-side.on){grid-template-columns:248px minmax(0,1fr)}
.imp-side{display:none;position:sticky;top:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:4px 16px 16px;box-shadow:var(--shadow-sm)}
.imp-side.on{display:block}
/* The pane header doubles as the mobile expand/collapse control. */
.imp-side-h{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;padding:14px 0 12px;margin:0;cursor:default;font-family:var(--font-sans);text-align:left;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.imp-side-h .imp-side-caret{margin-left:auto;display:none;font-size:10px;color:var(--muted);transition:transform .18s ease}
.imp-side-h .imp-side-n{display:none;font-size:11px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:999px;padding:2px 8px;letter-spacing:0}
.imp-side-h .imp-side-n.on{display:inline-flex}
.imp-facet{border-top:1px solid var(--border);padding:14px 0 6px}
.imp-facet:first-of-type{border-top:0;padding-top:2px}
.imp-facet .ft{font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px;letter-spacing:.005em}
.imp-facet label{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ink-soft);padding:6px 8px;margin:0 -8px;border-radius:7px;cursor:pointer;font-weight:400;text-transform:none;letter-spacing:0;transition:background .12s,color .12s}
.imp-facet label:hover{background:var(--surface-2);color:var(--ink)}
.imp-facet label:has(input:checked){color:var(--ink);font-weight:600}
.imp-facet label:focus-within{outline:2px solid var(--accent);outline-offset:-2px}
.imp-facet label .ct{margin-left:auto;font-size:11px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums;background:var(--surface-2);border-radius:999px;padding:1px 7px}
.imp-facet label:hover .ct{background:var(--surface-3,var(--surface))}
.imp-facet input[type=checkbox],.imp-facet input[type=radio]{width:auto;min-height:0;margin:0;accent-color:var(--accent);flex:0 0 auto}
.imp-side-reset{margin-top:14px;font-size:12px;font-weight:600;color:var(--accent);background:none;border:0;padding:8px 0;cursor:pointer}
.imp-side-reset:hover{text-decoration:underline}
.imp-side-reset:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

/* ── result cards (approved ImportYeti-style prototype) ── */
.imp-results{display:grid;gap:14px}
.imp-results.compact{grid-template-columns:repeat(2,minmax(0,1fr))}
/* The skeleton shares the card's BOX so their heights agree by construction —
   but deliberately NOT the .imp-card class itself, which is the results-only
   selector everything else (counts, tests, hover, density rules) keys off. */
.imp-card,.imp-skel{position:relative;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:16px 20px 0;box-shadow:var(--shadow-sm);overflow:hidden;transition:border-color .16s ease,box-shadow .16s ease}
/* accent rail drawn as a pseudo-element so the card's corner radius stays clean */
.imp-card::before,.imp-skel::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent)}
.imp-card:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));box-shadow:var(--shadow-md)}
.imp-card:focus-within{border-color:var(--accent)}
.imp-card-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px}
.imp-co{font-size:17px;font-weight:700;color:var(--ink);letter-spacing:-.012em;line-height:1.25}
a.imp-co-link{color:var(--accent);text-decoration:none;border-radius:4px}
a.imp-co-link:hover{text-decoration:underline;text-underline-offset:3px}
a.imp-co-link:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
/* Category badge reads as a quiet label, not a second brand-blue CTA. */
.imp-pill{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:4px;background:var(--surface-3,var(--surface-2));color:var(--ink-soft);border:1px solid var(--border-strong)}
.imp-win{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap;font-variant-numeric:tabular-nums}
/* The text is mixed toward --ink rather than used raw. On the 15% tint the raw
   tokens measured 3.14:1 (success) and 4.2:1 (warn) in LIGHT theme — both below
   AA on the flagship badge of every card. Mixing toward the foreground darkens
   in light and lightens in dark, so it gains contrast in both directions. */
.imp-win.hi{background:color-mix(in srgb,var(--success) 15%,transparent);color:color-mix(in srgb,var(--success) 62%,var(--ink));border:1px solid color-mix(in srgb,var(--success) 34%,transparent)}
.imp-win.md{background:color-mix(in srgb,var(--warn) 15%,transparent);color:color-mix(in srgb,var(--warn) 66%,var(--ink));border:1px solid color-mix(in srgb,var(--warn) 34%,transparent)}
.imp-addr{color:var(--muted);font-size:12px;margin-bottom:9px;line-height:1.45}
.imp-lane{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:13px;color:var(--ink-soft);margin-bottom:12px;line-height:1.5}
/* --muted-soft measured 3.63:1 (dark) / 3.02:1 (light) — below AA. The arrow is
   not decoration: it is what says supplier -> gateway, and the middot is what
   separates the lane from the commodity. --muted clears AA in both themes and
   is already the colour of .prod sitting beside it. */
.imp-lane .arw{color:var(--muted)}
.imp-lane .prod{color:var(--muted)}
.imp-lane .prodwrap{display:inline-flex;align-items:center;gap:7px;min-width:0}
.imp-lane .cc{font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--muted);background:var(--surface-2);border-radius:3px;padding:2px 5px}
.imp-angle{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;line-height:1.55;color:var(--ink-soft);background:color-mix(in srgb,var(--accent) 7%,transparent);border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);border-radius:8px;padding:9px 12px;margin-bottom:14px}
.imp-angle .z{color:var(--accent);font-weight:700;flex:0 0 auto;white-space:nowrap}
/* Stat strip: labels are locked to one line at a fixed block height so every
   value sits on the same baseline across all four columns (and across cards). */
.imp-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding-top:13px;border-top:1px solid var(--border)}
.imp-cell{min-width:0}
.imp-cell .lbl{font-size:9.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;line-height:14px;height:14px;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.imp-cell .val{font-size:16px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.01em;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Alias sub-line ("Also under N names · M addresses"), under the LAST stat value.
   Deliberately NOT nowrap — it clamps to two lines instead. The slot is rendered
   on that cell of EVERY card, empty when there is nothing to say, so the stat
   strip keeps a CONSTANT height: without it, cards with aliases would be taller
   than the ones without and the results column would ratchet into random card
   sizes. Two lines are reserved because at 4-across the cell is ~130px wide. */
.imp-cell .sub-slot{min-height:30px;margin-top:4px}
.imp-cell .sub-slot.sub{font-size:10.5px;line-height:1.35;color:var(--muted);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* Footer sits flush to the card edges as a tinted action bar (mockup-style). */
/* ── card footer: three FIXED zones (R3) ──
   It used to be a wrapping flex row where the whole right-hand group was pushed
   over with margin-left:auto and the contact-tier note rode INSIDE that group.
   The note therefore started at a different x on every card, because its
   position depended on how many buttons followed it (a lane with no mappable
   port has no "Quote this lane", a lead with no slug has no Save). Scanning a
   column of cards meant re-finding the note each row.
   Explicit grid columns pin each zone: incumbent chip | tier note | actions.
   Columns are addressed by number, so an absent chip leaves column 1 empty
   instead of shifting the note left. */
.imp-foot{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px 14px;margin:14px -20px 0;padding:11px 20px;border-top:1px solid var(--border);background:var(--surface-2);min-height:44px}
.imp-foot>.imp-incumb{grid-column:1}
.imp-foot>.imp-tier{grid-column:2;justify-self:start}
.imp-foot>.imp-foot-r{grid-column:3}
/* Same AA correction as .imp-win — raw --warn on its own tint was 4.2:1. */
.imp-incumb{font-size:11.5px;color:color-mix(in srgb,var(--warn) 72%,var(--ink));background:color-mix(in srgb,var(--warn) 13%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);border-radius:999px;padding:3px 10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.imp-foot-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.imp-tier{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
/* Raw --success as text measures 3.77:1 on white in LIGHT theme — below AA
   before any tint is involved. Same mix-toward---ink correction .imp-win
   already carries: darkens in light, lightens in dark. */
.imp-tier.ok{color:color-mix(in srgb,var(--success) 62%,var(--ink))}
.imp-lock{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-soft);border:1px solid var(--border-strong);border-radius:8px;padding:9px 13px;background:var(--surface-2);text-decoration:none;min-height:44px;box-sizing:border-box;transition:border-color .14s,color .14s}
/* display:inline-flex above beats the UA [hidden] rule (author > UA), which
   would leave the auth-gated "Saved" link visible to logged-out visitors. */
.imp-lock[hidden]{display:none !important}
.imp-lock:hover{border-color:var(--accent);color:var(--ink)}
.imp-lock:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.imp-lock .ico{opacity:.7}
/* Primary card action — the ONLY filled control on a card. Mirrors
   .imp-privacy-btn so the filled-accent treatment is identical page-wide;
   accent fill + --bg text is the sanctioned pair and is theme-aware (no hex). */
.imp-cta{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-decoration:none;
  font-size:12px;font-weight:700;border-radius:8px;padding:9px 14px;min-height:44px;box-sizing:border-box;
  background:var(--accent);color:var(--bg);border:1px solid var(--accent);
  transition:background .14s,border-color .14s}
.imp-cta:hover{background:var(--accent-strong,var(--accent));border-color:var(--accent-strong,var(--accent))}
.imp-cta:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.imp-cta .arr{transition:transform .15s ease}
.imp-cta:hover .arr{transform:translateX(3px)}
/* compact card condenses the stat grid + angle */
.imp-results.compact .imp-card,.imp-results.compact .imp-skel{padding:14px 15px 0}
/* The skeleton's stand-in must be hidden with it. It was not, so a compact
   search reserved a 39px block + 14px margin the real card never draws:
   measured 332px of skeleton against a 305.8px card (26.2px per card, x4
   skeletons in a 2-col grid), i.e. the very column-jump the card-shaped
   skeleton exists to prevent. */
.imp-results.compact .imp-angle,.imp-results.compact .sk-angle{display:none}
/* The other half of the same mismatch, in the opposite direction: a compact card
   is HALF width, so .imp-lane wraps to two rows (19.5 + 7 gap + 19.5 = 46px)
   while .sk-lane stayed at its one-row 20px. Compact only means two-up above
   1080px — below that it is a full-width single column and the lane fits on one
   row again, so this is undone in that breakpoint. */
.imp-results.compact .sk-lane{height:46px}
.imp-results.compact .imp-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px}
.imp-results.compact .imp-co{font-size:15px}
.imp-results.compact .imp-foot{margin:12px -15px 0;padding:10px 15px}
/* Compact = two cards per row, so the footer has roughly half the width. With
   the tier sentence AND the reveal chip AND the CTA it overflows and drops the
   CTA onto a line by itself — a textbook orphan. The tier sentence and the
   reveal chip are the droppable ones (the company NAME already links to the
   same profile), leaving exactly [☆ Save][Quote this lane →] on one line. */
.imp-results.compact .imp-cta{padding:8px 11px;font-size:11.5px}
.imp-results.compact .imp-tier{display:none}
.imp-results.compact .imp-foot-r a.imp-soon{display:none}
.imp-results.compact .imp-cell .sub-slot{display:none}
/* Cards in a compact ROW are stretched to the tallest by the grid; pin the
   action bar to the bottom so a shorter card ends in its footer instead of a
   band of empty surface. */
.imp-results.compact .imp-card{display:flex;flex-direction:column}
.imp-results.compact .imp-stats{margin-bottom:auto}

/* ── audience emphasis: pure CSS/attribute over the SAME rendered card ──
   Every node these rules touch is already in the DOM for every audience; the
   switch only changes ORDER and WEIGHT. Nothing here implies data we don't have. */
/* Trucker — it's a drayage move: TEU sizes the job, and the lane reduces to the
   gateway the container comes out of. */
.imp-results[data-aud="trucker"] .imp-cell:nth-child(3){order:-1}
.imp-results[data-aud="trucker"] .imp-lane .cc,
.imp-results[data-aud="trucker"] .imp-lane .sup,
.imp-results[data-aud="trucker"] .imp-lane .arw-o{display:none}
.imp-results[data-aud="trucker"] .imp-lane .port{font-weight:700;color:var(--ink)}
/* Broker — frequency is the qualifier and the commodity/HS is what gets matched
   to a carrier network. */
.imp-results[data-aud="broker"] .imp-cell:nth-child(2){order:-1}
.imp-results[data-aud="broker"] .imp-lane .prod{color:var(--ink-soft);font-weight:600}
/* Forwarder — the incumbent named on the bills is the whole pitch, so it moves
   out of the footer onto its own line under the lane. */
/* inline-BLOCK, not inline-flex: a flex container drops the whitespace-only text
   node between "Displacing:" and the <b>, which ran the two words together. */
.imp-results[data-aud="forwarder"] .imp-incumb-lead{display:inline-block}
.imp-results[data-aud="forwarder"] .imp-foot .imp-incumb{display:none}
/* Supplier — the overseas seller and its origin country lead. */
.imp-results[data-aud="supplier"] .imp-lane .sup{font-weight:700;color:var(--ink)}
.imp-results[data-aud="supplier"] .imp-lane .cc{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
/* The under-lane incumbent chip exists on every card and is revealed only in the
   forwarder seat (own line, so it can never orphan-wrap a badge row). */
.imp-incumb-lead{display:none;margin:-6px 0 12px}

/* "N free profiles left" chip (point-of-use quota surfacing) */
/* Neutral, deliberately. It carried the accent tint + accent text — byte for
   byte the pressed state of the audience buttons it sits beside — so a pure
   STATUS read as a selected control and invited a click that does nothing. */
.imp-profiles-left{display:none;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--ink-soft);background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:5px 12px}
.imp-profiles-left a{color:var(--accent)}
.imp-profiles-left.on{display:inline-flex}
.imp-profiles-left.out{color:var(--warn);background:color-mix(in srgb,var(--warn) 16%,transparent)}
.imp-profiles-left a{color:inherit;text-decoration:underline}

/* ☆ Save button — lives in the card footer action row, not floating on its own
   line above the content (that left a dead band under the title). */
.imp-save{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-sans);font-size:12px;font-weight:600;color:var(--ink-soft);background:var(--surface);border:1px solid var(--border-strong);border-radius:8px;padding:9px 12px;min-height:44px;box-sizing:border-box;cursor:pointer;transition:border-color .14s,color .14s}
.imp-save:hover{border-color:var(--accent);color:var(--ink)}
.imp-save:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.imp-save .star{font-size:14px;line-height:1;color:var(--muted)}
/* saved = outline + tint, never a bright fill */
.imp-save.saved{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
.imp-save.saved .star{color:var(--accent)}
.imp-save[disabled]{opacity:.6;cursor:default}

/* honest "contact reveal — coming soon" chip (no fulfillment wired) */
.imp-soon{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-soft);border:1px dashed var(--border-strong);border-radius:8px;padding:9px 12px;background:var(--surface);text-decoration:none;min-height:44px;box-sizing:border-box;transition:border-color .14s,color .14s}
/* The card's reveal chip is a real link, so it gets a solid border — a dashed
   one reads "unavailable". The dashed variant stays for the honest coming-soon
   chip that is genuinely not actionable. */
a.imp-soon{border-style:solid}
a.imp-soon:hover{border-color:var(--accent);color:var(--ink)}
a.imp-soon:hover .tag{border-color:color-mix(in srgb,var(--accent) 40%,transparent);color:var(--accent)}
a.imp-soon:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.imp-soon .tag{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:2px 6px}

/* ── designed empty / error states ───────────────────────────────────────────
   The credit-exhausted and no-result paths are the ones users hit most, so they
   get a real composed state: a glyph, a headline, a reason, and next steps. */
.imp-empty{display:flex;gap:16px;align-items:flex-start;border:1px dashed var(--border-strong);border-radius:var(--radius-lg);padding:32px 28px;text-align:left;color:var(--muted);background:var(--surface)}
.imp-empty .imp-empty-ico{flex:0 0 auto;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;font-size:20px;line-height:1;background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 26%,transparent)}
.imp-empty.warn .imp-empty-ico{background:color-mix(in srgb,var(--warn) 12%,transparent);border-color:color-mix(in srgb,var(--warn) 30%,transparent)}
.imp-empty .imp-empty-b{min-width:0;flex:1 1 auto}
.imp-empty h3{color:var(--ink);margin:0 0 6px;font-size:17px;letter-spacing:-.012em}
.imp-empty p{margin:0;font-size:13.5px;line-height:1.6;max-width:58ch}
.imp-empty-tips{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding:0;list-style:none}
.imp-empty-tips li{font-size:12px;font-weight:600;color:var(--ink-soft);background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:5px 12px}
/* Action row inside an empty state — the shared-link "Run search" affordance.
   The page body carries no qf-* class, so .btn-primary needs the same explicit
   accent fill the search button gets (see .imp-actions .btn-primary above). */
.imp-empty-act{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px}
.imp-empty-act .imp-empty-run{background:var(--accent-fill);border-color:var(--accent-fill);color:#fff;box-shadow:none;flex:0 0 auto}
/* Same #fff-on-brightening-accent trap as .imp-actions .btn-primary:hover. */
.imp-empty-act .imp-empty-run:hover{background:color-mix(in srgb,var(--accent-strong,var(--accent-fill)) 25%,var(--accent-fill));border-color:color-mix(in srgb,var(--accent-strong,var(--accent-fill)) 25%,var(--accent-fill))}
html[data-theme="light"] .imp-empty-act .imp-empty-run:hover{background:var(--accent-strong,var(--accent-fill));border-color:var(--accent-strong,var(--accent-fill))}
.imp-empty-act .imp-empty-hint{font-size:12px;font-weight:600;color:var(--muted)}

/* Skeleton card while a search is in flight.
   It reuses .imp-card / .imp-card-h / .imp-stats / .imp-cell / .imp-foot, so its
   height is the real card's height by construction rather than by a guessed
   number — the loading→loaded swap lands in place instead of jumping the column.
   Only the shimmer blocks are defined here. */
.imp-skel{pointer-events:none;box-shadow:none}
.imp-skel:hover{border-color:var(--border);box-shadow:none}
.imp-skel::before{opacity:.35}
/* Mixed against --ink, not left on the raw surface tokens: in dark theme
   --surface-2 over --surface measured 1.13:1, so the skeleton was effectively
   invisible and the loading state looked like an empty card. Mixing toward the
   foreground lifts it in BOTH themes (dark ink is light, light ink is dark). */
.imp-skel .sk{display:block;border-radius:5px;background-size:280% 100%;animation:imp-sheen 1.25s linear infinite;
  background-image:linear-gradient(90deg,
    color-mix(in srgb,var(--ink) 7%,var(--surface-2)) 25%,
    color-mix(in srgb,var(--ink) 16%,var(--surface-2)) 50%,
    color-mix(in srgb,var(--ink) 7%,var(--surface-2)) 75%)}
/* Each block matches the line box it stands in for (see .imp-co, .imp-pill,
   .imp-win, .imp-addr, .imp-lane, .imp-angle, .imp-cell .lbl/.val). */
.imp-skel .sk-co{width:38%;height:25px;border-radius:6px}
.imp-skel .sk-pill{width:62px;height:17px;border-radius:4px}
.imp-skel .sk-win{width:104px;height:19px;border-radius:999px}
.imp-skel .sk-addr{width:26%;height:17px;margin-bottom:9px}
.imp-skel .sk-lane{width:72%;height:20px;margin-bottom:12px}
.imp-skel .sk-angle{height:39px;border-radius:8px;margin-bottom:14px}
.imp-skel .sk-lbl{width:74%;height:14px;margin-bottom:5px}
.imp-skel .sk-val{width:56%;height:19px}
.imp-skel .sk-tier{width:150px;height:14px}
/* Button-shaped, at the real controls' 44px minimum — see skelCard(). */
.imp-skel .sk-btn{width:112px;height:44px;border-radius:8px}
.imp-skel .sk-btn-w{width:150px}
@keyframes imp-sheen{from{background-position:140% 0}to{background-position:-40% 0}}
@media (prefers-reduced-motion: reduce){
  .imp-skel .sk{animation:none}
  .imp-cta,.imp-cta .arr,.imp-privacy-btn .arr{transition:none}
  .imp-cta:hover .arr,.imp-privacy-btn:hover .arr{transform:none}
}

/* ── load more ── */
.imp-more-wrap{display:none;justify-content:center;margin:20px 0 0}
.imp-more-wrap.on{display:flex}
.imp-loadmore{font-family:var(--font-sans);font-size:14px;font-weight:600;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:10px;padding:12px 22px;min-height:44px;cursor:pointer;transition:border-color .14s}
.imp-loadmore:hover{border-color:var(--accent)}
.imp-loadmore:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.imp-loadmore:disabled{opacity:.6;cursor:not-allowed}

.imp-locknote{font-size:12px;color:var(--muted);margin:28px 0 0;line-height:1.6;padding-top:16px;border-top:1px solid var(--border)}
.imp-locknote b{color:var(--ink-soft)}
.imp-privacy-banner{display:flex;align-items:center;gap:12px 18px;flex-wrap:wrap;margin:16px 0 0;padding:16px 18px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
.imp-privacy-copy{display:flex;flex-direction:column;gap:4px;flex:1 1 300px;min-width:0}
.imp-privacy-h{font-size:14px;font-weight:700;color:var(--ink)}
.imp-privacy-p{font-size:12.5px;color:var(--muted);line-height:1.5}
.imp-privacy-btn{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;text-decoration:none;background:var(--accent);color:var(--bg);min-height:44px;box-sizing:border-box}
.imp-privacy-btn .arr{transition:transform .15s ease}
.imp-privacy-btn:hover .arr{transform:translateX(3px)}
.imp-locknote b{color:var(--ink-soft)}

@media(max-width:1080px){
  .imp-layout:has(.imp-side.on){grid-template-columns:224px minmax(0,1fr)}
  .imp-results.compact{grid-template-columns:1fr}
  /* Compact is a single full-width column from here down, so the lane stops
     wrapping and the skeleton's stand-in goes back to one row. */
  .imp-results.compact .sk-lane{height:20px}
}
@media(max-width:900px){
  /* Four filter boxes across a ~870px rail leave ~200px each, at which the
     Commodity placeholder and the in-field captions start clipping. Step to a
     2x2 here — the pair-preserving step, never 3+1. */
  .imp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .imp-more-grid{grid-template-columns:1fr}
  .imp-layout{grid-template-columns:1fr}
  /* B3-mobile: the desktop :has(.imp-side.on) rule out-specifies the single-column
     default, so once a search runs the grid never collapsed on phones and results
     squeezed sideways. Collapse it here. */
  .imp-layout:has(.imp-side.on){grid-template-columns:1fr}
  .imp-side{position:static;order:-1;padding:0 14px 0}
  /* On phones the facet pane became a wall of checkboxes ABOVE the results —
     several screens of scrolling before the first importer. Collapse it behind
     its own header; results come first. */
  .imp-side-h{cursor:pointer;min-height:48px;padding:14px 0}
  .imp-side-h .imp-side-caret{display:inline-block}
  .imp-side-h:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:8px}
  .imp-side.folded #imp-facets,.imp-side.folded .imp-side-reset{display:none}
  .imp-side:not(.folded){padding-bottom:14px}
  .imp-side:not(.folded) .imp-side-caret{transform:rotate(180deg)}
  .imp-results.compact{grid-template-columns:1fr}
}
@media(max-width:760px){
  /* Stacked input clusters use the 2px rhythm (hard input rule). The 8px /16px
     gaps are HORIZONTAL spacing that survived the collapse to fewer columns,
     where they read as loose, unrelated boxes rather than one control group. */
  .imp-grid{gap:2px 8px}
  .imp-more-grid{gap:2px 12px}
  .imp-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px}
  .imp-export{margin-left:0}
  .imp-toolbar-r{width:100%;margin-left:0}
  .imp-empty{padding:24px 20px;gap:14px}
  /* Narrow screens have no room for three side-by-side zones, so the footer
     falls back to the wrapping row it always was. The explicit grid-column
     assignments simply stop applying. */
  .imp-foot{display:flex;flex-wrap:wrap}
  .imp-foot>.imp-foot-r{margin-left:auto}
  .imp-sortwrap{flex:1 1 100%;min-width:0}
  /* Touch targets: both segmented controls reach 44px on phones. */
  .imp-aud button,.imp-density button{min-height:44px}
  .imp-sortwrap select{min-height:44px;padding-top:20px;padding-bottom:6px}
  .imp-aud{width:100%}
  .imp-aud button{flex:1 1 0;padding:8px 6px}
}
@media(max-width:560px){
  /* Phones: one filter per line. Two columns below this leaves ~200px per box —
     narrower than the in-field caption plus its value. */
  .imp-grid{grid-template-columns:1fr}
  /* No-orphan wrap: the four action buttons pair 2x2 instead of leaving
     "More filters" alone on its own line. */
  .imp-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch}
  .imp-actions>*{width:100%;justify-content:center;margin-left:0;white-space:nowrap;padding-left:10px;padding-right:10px;gap:6px}
  .imp-more{grid-column:auto}
  .imp-more[open]{grid-column:1 / -1}
  /* No-orphan wrap, open state (R4): with "More filters" expanded it spans the
     full row, leaving Search + Export + Saved — three chips in a two-column
     grid, so "Saved" sat alone on its own line. Promoting the PRIMARY action to
     the full row leaves exactly two secondary chips paired beside each other. */
  .imp-actions:has(.imp-more[open]) #imp-search{grid-column:1 / -1}
  .imp-more>summary{justify-content:center}
  /* Same rule for the card's badge group: the company name takes its own line so
     IMPORTER + winnability stay together instead of orphaning one pill. (The
     supplier flag that used to lead this group was removed in round 5 — it was
     the SUPPLIER's country sitting above the importer's own "United States".) */
  .imp-card-h{gap:7px}
  .imp-card-h .imp-co{flex:1 1 100%}
  /* The skeleton mirrors the card's LAYOUT classes, so every breakpoint rule
     that changes the card's shape needs its stand-in paired with it — the same
     omission as the compact .sk-angle/.sk-lane pair above. Unpaired, the phone
     skeleton kept a one-row header and a one-row lane while the real card takes
     two of each, so it under-reserved 53px per card on the viewport where a
     column jump is most expensive. */
  .imp-skel .sk-co{flex:1 1 100%}
  .imp-skel .sk-lane{height:46px}
  /* No-orphan wrap: four audience buttons pair 2x2, never 3+1. */
  .imp-aud{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-radius:8px}
  .imp-aud button{border-left:0;border-top:1px solid var(--border-strong)}
  .imp-aud button:nth-child(-n+2){border-top:0}
  .imp-aud button:nth-child(2n){border-left:1px solid var(--border-strong)}
  /* Same divider-vs-selected-ring conflict as the desktop row, but in a 2x2 the
     grey edge can land on the TOP as well as the left. Declared after the
     divider rules above so it wins on equal specificity. */
  .imp-aud button[aria-pressed="true"],
  .imp-aud button[aria-pressed="true"]+button,
  .imp-aud button[aria-pressed="true"]+button+button{border-left-color:transparent;border-top-color:transparent}
  /* Density sits directly under it — match the full-width 2-up so the two
     segmented controls read as one stacked pair, not a ragged edge. */
  .imp-density{width:100%}
  .imp-density button{flex:1 1 0}
}
@media(max-width:440px){
  .imp-more-grid{grid-template-columns:1fr}
  .imp-panel{padding:14px}
  /* Paired with .imp-skel, like the compact rule above. Unpaired, the phone
     skeleton kept 16px/20px padding against the card's 14px/15px and stopped
     reserving the right height on the viewport that needs it most. */
  .imp-card,.imp-skel{padding:14px 15px 0}
  .imp-foot{margin:12px -15px 0;padding:10px 15px}
  .imp-empty{flex-direction:column;gap:12px}
  /* Full-width so the button and its hint stack as two clean rows instead of a
     narrow button orphaned beside a wrapped fragment of hint text. */
  .imp-empty-act{gap:8px}
  .imp-empty-act .imp-empty-run{flex:1 1 100%;justify-content:center}
  .imp-co{font-size:16px}
  /* No-orphan wrap in the card footer. The action row would be three buttons in
     a two-column grid — one always left alone. The reveal chip is the redundant
     one (the company NAME above already links to the same profile), so it is
     hidden here and the row is exactly [☆ Save][Quote this lane →]. Hidden, not
     removed from the DOM, so nothing about the desktop markup changes. */
  /* auto-fit, not a fixed 2-up: a lead whose entry port maps to no facet has no
     "Quote this lane", which in a hard two-column grid left ☆ Save stranded at
     half width beside an empty cell. auto-fit collapses the empty track so a
     single remaining action stretches the full row (no-orphan rule). */
  .imp-foot-r{width:100%;justify-content:flex-start;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-left:0}
  .imp-foot-r a.imp-soon{display:none}
  .imp-foot>.imp-tier{width:100%;white-space:normal}
  .imp-save,.imp-cta{width:100%;justify-content:center;padding-left:10px;padding-right:10px;font-size:11.5px}
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
  /** `field=` value for a remote combobox's /api/importers/suggest call.
   *  Defaults to `commodity`, which is what the HS box has always sent. */
  remoteField?: string;
}): string {
  const { id, name, label, placeholder, source, lockable, remoteField } = opts;
  // TITLE-IN-FIELD (hard input rule): the field's name is a caption rendered
  // INSIDE the bordered box, top-left, above the value. Previously the label
  // lived only in the placeholder + aria-label, which meant a filled field lost
  // its identity entirely — "Savannah, GA" read the same in the port slot as in
  // the state slot. The caption is aria-hidden because `aria-label` already
  // carries the accessible name; it exists for sighted users.
  // The lock pill sits beside the chip and appears only when a port pre-locks
  // the state.
  return `
    <div class="imp-field imp-combo" data-field="${esc(id)}" data-source="${esc(source)}" data-has-value="0"${
      source === 'remote' ? ` data-remote-field="${esc(remoteField ?? 'commodity')}"` : ''
    }${lockable ? ' data-lockable="1"' : ''}>
      <div class="imp-combo-ctrl imp-capfield">
        <span class="imp-cap" aria-hidden="true">${esc(label)}</span>
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
      ${/* R5: the h1 used to be sr-only, so the most important surface on the
            page — the state a first-time visitor lands in — opened on a bare
            filter panel with no title, no promise and nothing saying what the
            tool does. A left-aligned heading and one line of orientation cost
            ~64px and are the difference between a product and a form. */ ''}
      <header class="imp-head">
        <h1>US Importers Directory</h1>
        <p class="imp-sub">Search live US customs records by company name, entry port, lane or commodity &mdash; then see who moves their freight today, and what it would take to win them.</p>
      </header>
      <form class="imp-panel" id="imp-form" novalidate>
        <div class="imp-grid">
          ${comboField({ id: 'imp-port', name: 'entryPort', label: 'Entry port', placeholder: 'Any US port', source: 'inline' })}
          ${comboField({ id: 'imp-state', name: 'state', label: 'Entry state', placeholder: 'Any entry state', source: 'inline', lockable: true })}
          ${comboField({ id: 'imp-commodity', name: 'commodity', label: 'Commodity / HS code', placeholder: 'e.g. saw blades, or 8202', source: 'remote' })}
          ${/* PROMOTED from behind "More filters" (Alex): someone who already knows
                the importer they want must be able to type it, not hunt for it
                behind a disclosure. Suggestions come from /api/importers/suggest
                ?field=company — the local index — which never costs a credit and
                shows exactly which names are findable. */ ''}
          ${comboField({ id: 'imp-company', name: 'company', label: 'Company name', placeholder: 'e.g. Robert Bosch Tool', source: 'remote', remoteField: 'company' })}
          ${/* HONEST COVERAGE. The 700M+ figure above is the BILL-OF-LADING corpus
                a port/lane/commodity search runs over. A name on its own is
                answered by ImportYeti's company directory plus the importers we
                have already pulled — company identity, not the whole bill
                history — so it is stated separately instead of being allowed to
                inherit the headline number. The live status line refines this to
                what actually happened on each search. */ ''}
          <p class="imp-namehint" id="imp-namehint"><b>Searching by name?</b> A name on its own looks the company up in the US importer directory and in the importers QuoteFleet has already pulled &mdash; open its profile for the full bill-of-lading history. Add a port, state or commodity to search the customs records themselves.</p>
        </div>

        <div class="imp-actions">
          <button type="submit" class="btn btn-primary" id="imp-search"><span id="imp-search-l">Search importers</span> <span class="arr">&rarr;</span></button>
          <a class="imp-lock imp-export" id="imp-export" href="/importers/saved" title="Export exactly what you are looking at — the filtered, sorted rows currently on screen (free with an account)">
            <span class="ico" aria-hidden="true">&#11123;</span> Export CSV
          </a>
          ${/* PERSONAL WORKSPACE — a logged-out visitor's saved list is empty by
                definition, so this ships `hidden` and /nav-auth.js reveals it once
                /api/directory/auth/me confirms a session. Server-side gating is
                forbidden here: this HTML is CDN-cached and must stay byte-identical
                for every visitor. "Export CSV" above is deliberately NOT gated — it
                is a capability whose page explains the value and the free account
                that unlocks it. */ ''}
          <a class="imp-lock" id="imp-saved-link" href="/importers/saved" title="Your saved importers" data-nav-auth="user" hidden>
            <span class="ico" aria-hidden="true">&#9733;</span> Saved
          </a>
          <details class="imp-more">
            <summary>More filters</summary>
            <div class="imp-more-grid">
              ${comboField({ id: 'imp-supplier', name: 'supplierCountry', label: 'Supplier country', placeholder: 'Any origin', source: 'inline' })}
              <div class="imp-field imp-capfield">
                <span class="imp-cap" aria-hidden="true">Frequency</span>
                <label for="imp-freq">Frequency</label>
                <select id="imp-freq" name="minShipments12m">${FREQ_BANDS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
              </div>
              <div class="imp-field imp-capfield">
                <span class="imp-cap" aria-hidden="true">TEU band</span>
                <label for="imp-teu">TEU band</label>
                <select id="imp-teu" name="minTeu12m">${TEU_BANDS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
              </div>
            </div>
          </details>
        </div>
      </form>

      <div class="imp-trust">
        <p class="imp-datastat" id="imp-recordline-wrap"><b class="num">${esc(DATASET_RECORDS_LABEL)}</b> US import records, updated daily &mdash; <span id="imp-recordline">search a company name, or pick a port, lane or commodity</span>.</p>
        <p class="imp-status" id="imp-status" role="status" aria-live="polite" hidden></p>
      </div>

      <div class="imp-toolbar" id="imp-toolbar">
        <div class="imp-countwrap">
          <span class="imp-count" id="imp-count"></span>
          <span class="imp-scope">
            <span class="ico" aria-hidden="true">&#9432;</span>
            <span class="txt" id="imp-scope-t"></span>
            <button type="button" class="imp-copylink" id="imp-copylink" title="Copy a link to this search — the URL carries your filters, facets and sort order">Copy link</button>
          </span>
        </div>
        <div class="imp-toolbar-r">
          <div class="imp-aud" role="group" aria-label="Show results for">
            ${AUDIENCES.map(
              ([id, label]) =>
                `<button type="button" id="imp-aud-${esc(id)}" data-aud="${esc(id)}" aria-pressed="false">${esc(label)}</button>`,
            ).join('')}
          </div>
          <span class="imp-profiles-left" id="imp-profiles-left" role="status" aria-live="polite"></span>
          <div class="imp-field imp-capfield imp-sortwrap">
            <span class="imp-cap" aria-hidden="true">Sort by</span>
            <label for="imp-sort">Sort results by</label>
            <select id="imp-sort" title="Reorders the importers already loaded — it does not re-rank the whole customs corpus. Load more to widen the set.">${SORTS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
          </div>
          <div class="imp-density" role="group" aria-label="Result density">
            <button type="button" id="imp-den-comf" aria-pressed="true">Comfortable</button>
            <button type="button" id="imp-den-comp" aria-pressed="false">Compact</button>
          </div>
        </div>
        <p class="imp-audhint" id="imp-audhint"><b id="imp-audhint-l"></b><span id="imp-audhint-t"></span></p>
      </div>

      <div class="imp-layout">
        <aside class="imp-side" id="imp-side" aria-label="Narrow your results">
          <button type="button" class="imp-side-h" id="imp-side-h" aria-expanded="true" aria-controls="imp-facets">
            Narrow your results
            <span class="imp-side-n" id="imp-side-n" aria-hidden="true"></span>
            <span class="imp-side-caret" aria-hidden="true">&#9662;</span>
          </button>
          <div id="imp-facets"></div>
          <button type="button" class="imp-side-reset" id="imp-side-reset">Reset filters</button>
        </aside>
        <div>
          <div class="imp-chips" id="imp-chips" hidden>
            <span class="imp-chips-cap" title="These filters narrow the importers already loaded. Load more to widen the set they run over.">Filtered by</span>
            <span class="imp-chips-list" id="imp-chips-list"></span>
            <button type="button" class="imp-chips-clear" id="imp-chips-clear">Clear all</button>
          </div>
          <div class="imp-results" id="imp-results" tabindex="-1" aria-label="Importer results">
            <div class="imp-empty" id="imp-empty">
              <span class="imp-empty-ico" aria-hidden="true">&#128506;</span>
              <div class="imp-empty-b">
                <h3>Start with a company or a lane</h3>
                <p>Know the importer? Type its name. Don&rsquo;t? Pick an entry port, state or commodity and hit Search to build importer profiles from live customs data.</p>
                <ul class="imp-empty-tips">
                  <li>Robert Bosch Tool</li><li>Port of Savannah</li><li>HS 8202 &mdash; saw blades</li><li>Furniture</li>
                </ul>
              </div>
            </div>
          </div>
          <div class="imp-more-wrap" id="imp-more-wrap">
            <button type="button" class="imp-loadmore" id="imp-loadmore" title="Pulls the next page of importers on this lane and widens the set that sort and filters run over.">Load more importers</button>
          </div>
        </div>
      </div>

      <p class="imp-locknote"><b>Free to view:</b> importer, lane, volumes, incumbent forwarder, winnability &amp; the AI angle &mdash; plus the company phone number and street address on every profile. <b>Free with an account:</b> save importers to your lead list, export the results to CSV, and ${FREE_REVEAL_TASTE} free decision-maker email reveals to start. <b>Leads Pro:</b> ${LEADS_PRO_MONTHLY_ALLOWANCE} email reveals every month &mdash; and a reveal that finds no email is never charged.</p>

      <div class="imp-privacy-banner">
        <div class="imp-privacy-copy">
          <span class="imp-privacy-h">Is your company listed here?</span>
          <span class="imp-privacy-p">We prepare &amp; submit your U.S. Customs confidentiality request on your behalf, so CBP suppresses your name and address on the public manifest records for your future shipments &mdash; not the ones already published. We hide you on QuoteFleet right away.</span>
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
    // Keeps the "US importer database/directory" keyword head the page already
    // ranked for, and adds the search axes — including the company NAME axis the
    // page now supports, which is what most name-intent queries actually look
    // like ("<company> importer records").
    title: 'US Importers Directory — Search by Company Name, Port & Commodity | QuoteFleet',
    description:
      'Search real US customs bill-of-lading records to find importers by company name, port, lane and commodity — their suppliers, volumes, incumbent forwarder, a winnability score and an AI angle. Free to browse.',
    canonicalPath: '/importers',
    bodyHtml: body,
    jsonLd: [
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'QuoteFleet US Importers Directory',
        applicationCategory: 'BusinessApplication',
        url: `${SITE}/importers`,
        description:
          'A directory of US importers built from customs bill-of-lading data, searchable by company name, port, lane and commodity.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      }),
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'US Importers Directory', item: `${SITE}/importers` },
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
  var sideH=document.getElementById('imp-side-h');
  var sideN=document.getElementById('imp-side-n');
  if(!form||!results)return;

  // Mobile: the facet pane folds so results are the first thing on screen.
  // Desktop CSS ignores the folded class, so this is phone-only behaviour.
  function isNarrow(){ return window.matchMedia&&window.matchMedia('(max-width:900px)').matches; }
  if(sideH){
    sideH.addEventListener('click',function(){
      if(!isNarrow())return;
      var folded=side.classList.toggle('folded');
      sideH.setAttribute('aria-expanded',folded?'false':'true');
    });
  }
  function syncSideFold(){
    if(!sideH)return;
    if(isNarrow()){ side.classList.add('folded'); sideH.setAttribute('aria-expanded','false'); }
    else { side.classList.remove('folded'); sideH.setAttribute('aria-expanded','true'); }
  }

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
    var remoteField=root.getAttribute('data-remote-field')||'commodity';
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
      // remote (commodity / company name) — debounced fetch. Both are served
      // from local data (the HS reference, the company index): a suggestion has
      // never cost, and must never cost, an ImportYeti credit.
      if(debounce)clearTimeout(debounce);
      debounce=setTimeout(function(){
        if(q===lastQ)return; lastQ=q;
        if(!q){ items=[]; render(); return; }
        fetch('/api/importers/suggest?field='+encodeURIComponent(remoteField)+'&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}})
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
    // The suggestion list is absolutely positioned and overhangs the button row,
    // so at desktop widths it covered "Search importers" — a user who typed a
    // port and reached for Search hit a suggestion instead. Blur alone was not
    // enough (a pointerdown on the button lands before blur fires), so close on
    // any pointerdown outside this combobox, BEFORE the click resolves.
    document.addEventListener('pointerdown',function(ev){
      if(listEl.hasAttribute('hidden'))return;
      var t=ev.target;
      if(t&&(root.contains(t)||listEl.contains(t)))return;
      close();
    },true);
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

  var btnLabel=document.getElementById('imp-search-l');
  function setStatus(msg,busy){
    statusEl.hidden=false; statusEl.innerHTML=''; statusEl.appendChild(document.createTextNode(msg));
    btn.disabled=!!busy;
    // Say what it is DOING. A greyed-out button whose label still reads "Search
    // importers" is indistinguishable from a broken one.
    if(busy) btn.setAttribute('aria-busy','true'); else btn.removeAttribute('aria-busy');
    if(btnLabel) btnLabel.textContent = busy ? 'Searching\\u2026' : 'Search importers';
  }
  function applyDensity(){ results.className='imp-results'+(density==='compact'?' compact':'');
    document.getElementById('imp-den-comf').setAttribute('aria-pressed', density==='comfortable'?'true':'false');
    document.getElementById('imp-den-comp').setAttribute('aria-pressed', density==='compact'?'true':'false'); }
  document.getElementById('imp-den-comf').addEventListener('click',function(){ density='comfortable'; ls('qf_imp_density','comfortable'); applyDensity(); });
  document.getElementById('imp-den-comp').addEventListener('click',function(){ density='compact'; ls('qf_imp_density','compact'); applyDensity(); });
  applyDensity();

  // ── audience switcher ──
  // Re-weights the SAME cards via a data-aud attribute + CSS. No re-render, no
  // re-query, no network — flipping seats is instant and costs zero credits.
  var AUD_HINT={
    trucker:['Trucker view','TEU leads the card and the lane collapses to the gateway \\u2014 this is the drayage move you would run.'],
    broker:['Broker view','Shipment frequency leads, with commodity and HS code promoted so you can match the lane to a carrier network.'],
    forwarder:['Forwarder view','The incumbent named on the bills is promoted \\u2014 that is the account you would be displacing.'],
    supplier:['Supplier view','The overseas seller and origin country lead. These are US buyers already active in your category.']
  };
  var audBtns=document.querySelectorAll('.imp-aud button');
  var audHintL=document.getElementById('imp-audhint-l');
  var audHintT=document.getElementById('imp-audhint-t');
  var aud=ls('qf_imp_aud'); if(!AUD_HINT[aud]) aud='broker';
  function applyAudience(){
    results.setAttribute('data-aud',aud);
    for(var i=0;i<audBtns.length;i++){ audBtns[i].setAttribute('aria-pressed', audBtns[i].getAttribute('data-aud')===aud?'true':'false'); }
    audHintL.textContent=AUD_HINT[aud][0];
    audHintT.textContent=AUD_HINT[aud][1];
  }
  for(var ai=0;ai<audBtns.length;ai++){
    audBtns[ai].addEventListener('click',function(){ aud=this.getAttribute('data-aud'); ls('qf_imp_aud',aud); applyAudience(); });
  }
  applyAudience();

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
    // NO flag here. It used to render flag(l.supplier_country) — the SUPPLIER's
    // country — immediately after a US importer's name, directly above a line
    // reading "United States · NC", so the card said two contradictory things
    // about who this company is. It was also redundant (the lane's .cc chip
    // already carries the origin) and, on any platform without regional-indicator
    // glyphs, degraded to the literal letters "DE" beside the company name.
    h.appendChild(T('span','imp-pill','Importer'));
    var w=l.winnability||{};
    var winTxt='Winnability'+(w.score?(' '+w.score):'')+(w.label?(' \\u00b7 '+w.label):'');
    var win=T('span','imp-win '+(w.label==='High'?'hi':'md'),winTxt);
    win.title='How switchable this account looks (volume + named incumbent + contact on file)';
    h.appendChild(win);
    c.appendChild(h);
    if(l.state){ c.appendChild(T('div','imp-addr','United States \\u00b7 '+l.state)); }
    var lane=T('div','imp-lane');
    if(l.supplier_country) lane.appendChild(T('span','cc',String(l.supplier_country).toUpperCase()));
    lane.appendChild(T('span','sup',l.supplier||'Supplier'));
    lane.appendChild(T('span','arw arw-o','\\u2192'));
    lane.appendChild(T('span','port',l.entry_port||'US port'));
    // Separator and product travel together. As loose siblings the interpunct
    // could end a line on its own once .prod wrapped — a dangling "·" at 375.
    if(l.product){ var pw=T('span','prodwrap');
      pw.appendChild(T('span','arw','\\u00b7'));
      pw.appendChild(T('span','prod',l.product+(l.hs_code?(' \\u00b7 HS '+l.hs_code):'')));
      lane.appendChild(pw); }
    lane.title=(l.supplier||'Supplier')+' \\u2192 '+(l.entry_port||'US port')+(l.product?(' \\u00b7 '+l.product):'');
    c.appendChild(lane);
    // Forwarder seat promotes the incumbent out of the footer onto its own line.
    // Same value as the footer chip; CSS shows exactly one of the two at a time.
    if(l.incumbent_forwarder){
      var incL=T('span','imp-incumb imp-incumb-lead'); incL.appendChild(document.createTextNode('Displacing: '));
      var bL=document.createElement('b'); bL.textContent=l.incumbent_forwarder; incL.appendChild(bL);
      incL.title='Incumbent forwarder named on the bills: '+l.incumbent_forwarder;
      c.appendChild(incL);
    }
    if(l.aiAngle){ var a=T('div','imp-angle'); a.appendChild(T('span','z','\\u26a1 AI angle'));
      a.appendChild(T('span',null,l.aiAngle)); c.appendChild(a); }
    var stats=T('div','imp-stats');
    var subTxt=aliasSub(l);
    var cells=[['Total shipments',n(l.total_shipments)],['Shipments \\u00b7 12 mo',n(l.ships_12m)],
     ['TEU \\u00b7 12 mo',n(l.teu_12m)],['Last shipment',l.last_shipment||'\\u2014']];
    cells.forEach(function(p,ci){
      var cell=T('div','imp-cell'); var lb=T('div','lbl',p[0]); lb.title=p[0];
      var vl=T('div','val',p[1]); vl.title=p[0]+': '+p[1];
      cell.appendChild(lb); cell.appendChild(vl);
      // The LAST cell always carries the slot — empty when there are no
      // alternates. Always-present is what keeps the stat strip the same height
      // on a card with aliases and one without; only this cell needs it, so the
      // other three stay tight (on a phone they sit in the row above).
      if(ci===cells.length-1){
        var sb=T('div','sub-slot'+(subTxt?' sub':''), subTxt||'');
        if(subTxt) sb.title=ALIAS_TIP;
        cell.appendChild(sb);
      }
      stats.appendChild(cell);
    });
    c.appendChild(stats);
    var foot=T('div','imp-foot');
    if(l.incumbent_forwarder){ var inc=T('span','imp-incumb'); inc.appendChild(document.createTextNode('Displacing: '));
      var b=document.createElement('b'); b.textContent=l.incumbent_forwarder; inc.appendChild(b);
      inc.title='Incumbent forwarder named on the bills: '+l.incumbent_forwarder;
      foot.appendChild(inc); }
    // The contact-tier note is its OWN footer zone (grid column 2), not a member
    // of the action group — otherwise its x-position drifts card to card with
    // however many buttons happen to follow it.
    // Chip label + its tooltip both read from the server's CONTACT_TIER_COPY —
    // one source of truth for what a tier is allowed to claim. A tier that is
    // NOT paid promises nothing, so its tooltip says the reveal is free rather
    // than pitching an unlock that would return only free page data.
    var TIER_COPY=${JSON.stringify(CONTACT_TIER_COPY)};
    var tc=TIER_COPY[l.contact_confidence]||TIER_COPY.phone_only;
    var tierEl=T('span','imp-tier'+(l.contact_confidence==='verified'?' ok':''),(l.contact_confidence==='verified'?'\\u2713 ':'')+tc.badge);
    tierEl.title=tc.blurb+(tc.paid?' Reveal it on the profile.':' A reveal that finds no email is never charged.');
    foot.appendChild(tierEl);
    var right=T('div','imp-foot-r');
    // ☆ Save (free, logged-in). Only when we have a slug to key the save on.
    if(l.slug){ right.appendChild(saveButton(l)); }
    // The decision-maker reveal is LIVE and lives on the importer profile (the
    // gated, allowance-metered point of use). The card links there rather than
    // revealing inline — honest, no fabricated contact on the card itself.
    if(l.slug){
      var reveal=document.createElement('a'); reveal.className='imp-soon'; reveal.href='/importers/company/'+encodeURIComponent(l.slug);
      // ONE label, not a label plus a nested pill — "Reveal contact [on profile]"
      // read as two separate controls sitting inside each other.
      reveal.appendChild(document.createTextNode('Reveal email on profile '));
      reveal.appendChild(T('span','tag','\\u2192'));
      reveal.title='Open '+(l.company||'this importer')+'\\u2019s profile to reveal the decision-maker email. The company phone and address are free there.';
      right.appendChild(reveal);
    }
    // Primary action: source drayage rates for this lane. Deep-links the metered
    // RFQ flow pre-seeded with the lane. port/state are FACET keys, so the RFQ
    // GET resolves a real carrier set; without one it would 302 back to
    // /directory — so a lead with neither gets NO CTA rather than a dead link.
    var cta=ctaFor(l);
    if(cta) right.appendChild(cta);
    foot.appendChild(right); c.appendChild(foot);
    return c;
  }

  // "Also under N names \\u00b7 M addresses" — distinct company-name spellings and
  // addresses this importer filed under IN THIS SEARCH SAMPLE. Gated on >1 so a
  // single spelling never renders a line saying "1 name".
  var ALIAS_TIP='Distinct company-name spellings and addresses seen on the bills in this search sample. Open the profile for the full alias list.';
  function aliasSub(l){
    var nm=Number(l.alias_names||0), ad=Number(l.alias_addresses||0);
    if(nm<2 && ad<2) return '';
    var parts=[];
    if(nm>1) parts.push(nm+' name'+(nm===1?'':'s'));
    if(ad>1) parts.push(ad+' address'+(ad===1?'':'es'));
    return 'Also under '+parts.join(' \\u00b7 ');
  }

  // Build the "Quote this lane" CTA. The href is resolved SERVER-side (see
  // quoteLaneHref) and arrives as l.quote_href; null means the entry port maps
  // to no directory facet, and the card must then show no CTA at all rather
  // than a link that 302s straight back to /directory.
  function ctaFor(l){
    if(!l.quote_href) return null;
    var a=document.createElement('a'); a.className='imp-cta'; a.href=l.quote_href;
    a.appendChild(document.createTextNode('Quote this lane '));
    a.appendChild(T('span','arr','\\u2192'));
    a.title='Request drayage rates from carriers at '+(l.entry_port||'this port');
    return a;
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
    syncSideFold();
    // supplier country counts
    var cc={}, ch={}, chProd={}; var hasVerified=false;
    allLeads.forEach(function(l){ if(l.supplier_country){ cc[l.supplier_country]=(cc[l.supplier_country]||0)+1; }
      var c=chapterOf(l);
      if(c){ ch[c]=(ch[c]||0)+1;
        // Name the chapter from the goods ACTUALLY in this result set — accurate
        // by construction, and no HTS chapter table to ship or keep correct.
        if(!chProd[c]) chProd[c]={};
        if(l.product){ chProd[c][l.product]=(chProd[c][l.product]||0)+1; } }
      if(l.contact_confidence==='verified')hasVerified=true; });
    function countryLabel(code){
      var arr=window.__IMP_COUNTRIES||[];
      for(var i=0;i<arr.length;i++){ if(String(arr[i].value)===String(code)) return arr[i].label; }
      return String(code);
    }
    function chapterName(c){
      var m=chProd[c]||{}; var best='', bn=0;
      for(var k in m){ if(m[k]>bn){ bn=m[k]; best=k; } }
      if(!best) return '';
      return best.length>26?(best.slice(0,25)+'\\u2026'):best;
    }
    // The label was code + flag ("DE " + flag('DE')). On any platform without
    // regional-indicator glyphs — Windows Chromium, i.e. most desktop users —
    // the flag degrades to the letters "DE", so the row read "DE de". The code
    // alone is unambiguous and renders identically everywhere.
    var countryRows=Object.keys(cc).sort(function(a,b){return cc[b]-cc[a];}).slice(0,8)
      .map(function(k){ return {value:k,label:countryLabel(k),ct:cc[k]}; });
    // Bare chapter numbers ("HS 82") mean nothing without the reference open;
    // chapterName() carries the same curated table the commodity box uses.
    var chapRows=Object.keys(ch).sort(function(a,b){return ch[b]-ch[a];}).slice(0,8)
      .map(function(k){ var d=chapterName(k); return {value:k,label:d?(k+' \\u00b7 '+d):('HS '+k),ct:ch[k]}; });
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

  // ── sort (R3) ──────────────────────────────────────────────────────────────
  // Reorders the set ALREADY in memory. No refetch, no ImportYeti credits. The
  // default is 'ships' because that is the order the server hands back, so a
  // freshly loaded list is labelled with the order it actually has.
  var sortEl=document.getElementById('imp-sort');
  var sortBy=ls('qf_imp_sort')||'ships';
  function sortLabel(){
    if(!sortEl)return 'shipments \\u00b7 12 mo';
    for(var i=0;i<sortEl.options.length;i++){ if(sortEl.options[i].value===sortBy) return sortEl.options[i].text; }
    return sortEl.options.length?sortEl.options[0].text:'';
  }
  // Dates arrive as MM/DD/YYYY. Parsed to a comparable number; anything
  // unparseable sorts last rather than jumping to the top as NaN.
  function recencyOf(l){
    var m=/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/.exec(String(l.last_shipment||''));
    if(!m)return -1;
    return Number(m[3])*10000+Number(m[1])*100+Number(m[2]);
  }
  function sortLeads(rows){
    var out=rows.slice();
    var num=function(k){ return function(a,b){ return (Number(b[k])||0)-(Number(a[k])||0); }; };
    if(sortBy==='total') out.sort(num('total_shipments'));
    else if(sortBy==='teu') out.sort(num('teu_12m'));
    else if(sortBy==='recent') out.sort(function(a,b){ return recencyOf(b)-recencyOf(a); });
    else if(sortBy==='win') out.sort(function(a,b){ return ((b.winnability&&b.winnability.score)||0)-((a.winnability&&a.winnability.score)||0); });
    else if(sortBy==='company') out.sort(function(a,b){ return String(a.company||'').localeCompare(String(b.company||'')); });
    else out.sort(num('ships_12m'));
    return out;
  }
  if(sortEl){
    sortEl.value=sortBy;
    // A select whose stored value is no longer an option falls back to the first.
    if(sortEl.selectedIndex<0){ sortEl.selectedIndex=0; sortBy=sortEl.value; }
    sortEl.addEventListener('change',function(){
      sortBy=sortEl.value; ls('qf_imp_sort',sortBy); renderList();
      setStatus('Sorted by '+sortLabel()+'.',false);
    });
  }

  // ── applied-filter chips (R3) ──────────────────────────────────────────────
  // One chip per ACTIVE facet, each removing only itself. The facet rail shows
  // what is available; this shows what is in force, at the top of the results
  // where the effect is visible.
  var chipsEl=document.getElementById('imp-chips');
  var chipsListEl=document.getElementById('imp-chips-list');
  var chipsClearEl=document.getElementById('imp-chips-clear');
  var SHIP_LBL={'50':'50+','200':'200+','800':'800+'};
  var TEU_LBL={'100':'100+','500':'500+','2000':'2,000+'};
  function addChip(label,onRemove){
    var b=document.createElement('button'); b.type='button'; b.className='imp-chip';
    b.appendChild(T('span','lb',label));
    var x=T('span','x','\\u00d7'); x.setAttribute('aria-hidden','true'); b.appendChild(x);
    b.setAttribute('aria-label','Remove filter: '+label);
    b.title='Remove filter: '+label;
    b.addEventListener('click',function(){ onRemove(); buildFacets(); renderList(); });
    chipsListEl.appendChild(b);
  }
  function renderChips(){
    if(!chipsEl||!chipsListEl)return;
    chipsListEl.innerHTML='';
    Object.keys(facetState.country).forEach(function(k){
      if(!facetState.country[k])return;
      addChip('Origin '+k,function(){ facetState.country[k]=false; });
    });
    Object.keys(facetState.chapter).forEach(function(k){
      if(!facetState.chapter[k])return;
      addChip('HS '+k,function(){ facetState.chapter[k]=false; });
    });
    if(facetState.minShip) addChip((SHIP_LBL[facetState.minShip]||facetState.minShip)+' shipments / 12 mo',function(){ facetState.minShip=''; });
    if(facetState.minTeu) addChip((TEU_LBL[facetState.minTeu]||facetState.minTeu)+' TEU / 12 mo',function(){ facetState.minTeu=''; });
    if(facetState.verifiedOnly) addChip('Has verified contact',function(){ facetState.verifiedOnly=false; });
    if(chipsListEl.children.length) chipsEl.removeAttribute('hidden');
    else chipsEl.setAttribute('hidden','');
  }
  if(chipsClearEl){
    chipsClearEl.addEventListener('click',function(){
      facetState={ country:{}, chapter:{}, minShip:'', minTeu:'', verifiedOnly:false };
      buildFacets(); renderList();
      setStatus('Filters cleared.',false);
    });
  }

  // ── sample-scope disclosure (R4) ────────────────────────────────────────────
  // Sort and the facets run over the ACCUMULATED set — the importers pulled so
  // far — not over the whole customs corpus. A sort control with no scope note
  // implies it is ranking everything on the lane, which it is not. State it once,
  // plainly, right under the count, and name the control that widens the set.
  //
  // The wording splits on whether there is genuinely more to load: when the last
  // page came back short there is nothing further on this lane, so the set IS
  // complete for these filters and hedging would be false modesty.
  var scopeEl=document.getElementById('imp-scope-t');
  function renderScope(total){
    if(!scopeEl)return;
    var more=moreWrap&&moreWrap.classList.contains('on');
    var noun=' importer'+(total===1?'':'s');
    scopeEl.textContent = more
      ? 'Sort and filters run over the '+total+noun+' loaded so far \\u2014 "Load more" widens the set.'
      : 'Sort and filters run over all '+total+noun+' this search returned.';
  }

  // ── shareable / bookmarkable search state (R4) ──────────────────────────────
  // A search was entirely ephemeral: no way to bookmark it, send it to a
  // colleague, or come back to it from an importer profile. The filters, the
  // sort and the active facets now live in the URL, so the address bar IS the
  // search. replaceState (not push) keeps one history entry per page rather than
  // one per facet click, and the stored copy lets a profile page offer a real
  // "back to your results".
  var curQs='';   // the form's raw pairs, snapshotted when the search RAN
  function formQs(){
    var qs=[]; var fd=new FormData(form);
    fd.forEach(function(v,k){ v=String(v).trim(); if(v) qs.push(encodeURIComponent(k)+'='+encodeURIComponent(v)); });
    return qs.join('&');
  }
  function writeUrl(){
    if(!curPayload)return;
    // Built from the SNAPSHOT, never from the live form: editing a field without
    // re-searching must not rewrite the URL to describe results it did not produce.
    var qs=curQs?curQs.split('&'):[];
    function add(k,v){ qs.push(encodeURIComponent(k)+'='+encodeURIComponent(v)); }
    if(sortBy&&sortBy!=='ships') add('sort',sortBy);
    var oc=Object.keys(facetState.country).filter(function(k){return facetState.country[k];});
    if(oc.length) add('oc',oc.join(','));
    var hs=Object.keys(facetState.chapter).filter(function(k){return facetState.chapter[k];});
    if(hs.length) add('hs',hs.join(','));
    if(facetState.minShip) add('ms',facetState.minShip);
    if(facetState.minTeu) add('mt',facetState.minTeu);
    if(facetState.verifiedOnly) add('vo','1');
    var url=location.pathname+(qs.length?('?'+qs.join('&')):'');
    try{ history.replaceState(null,'',url); }catch(e){}
    try{ sessionStorage.setItem('qf_imp_back',url); }catch(e){}
  }
  function readUrl(){
    var q=location.search.replace(/^\\?/,'');
    if(!q)return null;
    var out={}; var parts=q.split('&');
    for(var i=0;i<parts.length;i++){
      if(!parts[i])continue;
      var eq=parts[i].indexOf('=');
      var rk=eq<0?parts[i]:parts[i].slice(0,eq);
      var rv=eq<0?'':parts[i].slice(eq+1);
      try{ out[decodeURIComponent(rk.replace(/\\+/g,'%20'))]=decodeURIComponent(rv.replace(/\\+/g,'%20')); }
      catch(e){ /* malformed pair — ignore it rather than losing the whole URL */ }
    }
    return out;
  }
  function labelFor(list,val){
    var arr=list||[];
    for(var i=0;i<arr.length;i++){ if(String(arr[i].value)===String(val)) return arr[i].label; }
    return String(val);
  }
  // Rehydrate the form + sort + facets from the URL and run the search directly.
  // Deliberately NOT via form.submit(): the submit handler clears facetState,
  // which would drop exactly the facets the link was carrying.
  function restoreFromUrl(){
    var q=readUrl(); if(!q)return false;
    var any=false;
    function setCombo(id,val,list){
      if(!val)return;
      var c=combos[id]; if(!c)return;
      c.hidden.value=val;
      c.input.value=list?labelFor(list,val):val;
      c.root.setAttribute('data-has-value','1');
      any=true;
    }
    setCombo('imp-port',q.entryPort,window.__IMP_PORTS);
    setCombo('imp-commodity',q.commodity,null);
    // Company name is a PRIMARY combobox now, so it restores like the others —
    // it is no longer one of the "More filters" that force the disclosure open.
    setCombo('imp-company',q.company,null);
    setCombo('imp-supplier',q.supplierCountry,window.__IMP_COUNTRIES);
    // Port implies its state and LOCKS the field — mirror the live pairing so a
    // restored search looks exactly like one the user just built by hand.
    if(q.entryPort){
      var st=String(q.entryPort).split(',').pop().trim().toUpperCase();
      var sc=combos['imp-state'];
      if(sc&&st) sc.setLocked(labelFor(window.__IMP_STATES,st),st);
    } else { setCombo('imp-state',q.state,window.__IMP_STATES); }
    var freq=document.getElementById('imp-freq');
    var teuSel=document.getElementById('imp-teu');
    var secondary=false;
    if(freq&&q.minShipments12m){ freq.value=q.minShipments12m; if(freq.value===q.minShipments12m){secondary=true;any=true;} }
    if(teuSel&&q.minTeu12m){ teuSel.value=q.minTeu12m; if(teuSel.value===q.minTeu12m){secondary=true;any=true;} }
    if(q.supplierCountry) secondary=true;
    // Open "More filters" when the link carries any of them — a filter in force
    // behind a closed disclosure is an invisible filter.
    var moreEl=document.querySelector('.imp-more');
    if(secondary&&moreEl) moreEl.setAttribute('open','');
    if(!any)return false;
    if(q.sort&&sortEl){
      for(var s=0;s<sortEl.options.length;s++){
        if(sortEl.options[s].value===q.sort){ sortBy=q.sort; sortEl.value=sortBy; break; }
      }
    }
    facetState={ country:{}, chapter:{}, minShip:q.ms||'', minTeu:q.mt||'', verifiedOnly:q.vo==='1' };
    (q.oc?String(q.oc).split(','):[]).forEach(function(k){ if(k) facetState.country[k]=true; });
    (q.hs?String(q.hs).split(','):[]).forEach(function(k){ if(k) facetState.chapter[k]=true; });
    curQs=formQs();
    curPayload=collectPayload(); curPage=1;
    // CACHE PROBE, never a live pull. A shared link that is already cached opens
    // straight into its results for $0; one that is not stops at a "Run search"
    // button. See parseCacheOnly() on the server for why.
    doSearch(curPayload,1,false,true);
    return true;
  }

  // Copy the current search URL. The address bar already carries the state; this
  // makes that discoverable instead of a secret.
  var copyLinkEl=document.getElementById('imp-copylink');
  if(copyLinkEl){
    copyLinkEl.addEventListener('click',function(){
      var url=location.href;
      function done(){
        copyLinkEl.textContent='\\u2713 Copied'; copyLinkEl.classList.add('done');
        setTimeout(function(){ copyLinkEl.textContent='Copy link'; copyLinkEl.classList.remove('done'); },1800);
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(url).then(done).catch(function(){ legacyCopy(url,done); });
      } else { legacyCopy(url,done); }
    });
  }
  function legacyCopy(text,ok){
    try{
      var ta=document.createElement('textarea'); ta.value=text;
      ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      var good=document.execCommand&&document.execCommand('copy');
      document.body.removeChild(ta);
      if(good){ ok(); return; }
    }catch(e){ /* fall through to the honest failure below */ }
    setStatus('Could not copy automatically \\u2014 the address bar holds this search.',false);
  }

  // Composed empty / error state: glyph + headline + reason + next-step chips.
  // The optional 6th arg, action = {label,hint,onClick}, adds a real button —
  // used by the shared-link state, where the whole point is that the user must
  // press something before a paid pull happens.
  function emptyState(icon,title,body,tips,warn,action){
    var e=T('div','imp-empty'+(warn?' warn':''));
    var ic=T('span','imp-empty-ico',icon); ic.setAttribute('aria-hidden','true');
    var bx=T('div','imp-empty-b');
    bx.appendChild(T('h3',null,title));
    bx.appendChild(T('p',null,body));
    if(action){
      var row=T('div','imp-empty-act');
      var b=document.createElement('button');
      b.type='button'; b.className='btn btn-primary imp-empty-run'; b.textContent=action.label;
      b.addEventListener('click',action.onClick);
      row.appendChild(b);
      if(action.hint) row.appendChild(T('span','imp-empty-hint',action.hint));
      bx.appendChild(row);
    }
    if(tips&&tips.length){ var ul=T('ul','imp-empty-tips');
      tips.forEach(function(t){ ul.appendChild(T('li',null,t)); }); bx.appendChild(ul); }
    e.appendChild(ic); e.appendChild(bx);
    return e;
  }
  // Skeleton cards while a search is in flight.
  //
  // A skeleton exists to RESERVE the space the content will take. The first
  // version was four generic bars in a small box: 115px tall against a real card
  // of ~327px, so the results column snapped from 373px to 2029px the instant
  // the response landed — a 1,656px jump that threw away whatever the user was
  // looking at. So the skeleton is now built from the CARD'S OWN layout classes
  // (.imp-card / .imp-card-h / .imp-stats / .imp-cell / .imp-foot) with shimmer
  // blocks where the text goes: it inherits every padding, gap and min-height
  // the real card has, which is what makes the heights agree — and keeps them
  // agreeing if the card is restyled later.
  //
  // It also mirrors the density mode, so the compact (2-up) grid does not load
  // through a comfortable-width skeleton and then re-flow.
  function skelCard(){
    // NOT .imp-card — that class is the results-only selector the counts, the
    // density rules and the tests all key off. The box geometry is shared in CSS
    // instead (see the ".imp-card,.imp-skel" rules).
    var c=T('div','imp-skel');
    c.setAttribute('aria-hidden','true');
    var h=T('div','imp-card-h');
    ['sk-co','sk-pill','sk-win'].forEach(function(cl){ h.appendChild(T('span','sk '+cl)); });
    c.appendChild(h);
    c.appendChild(T('div','sk sk-addr'));
    c.appendChild(T('div','sk sk-lane'));
    c.appendChild(T('div','sk sk-angle'));
    var st=T('div','imp-stats');
    for(var k=0;k<4;k++){
      var cell=T('div','imp-cell');
      cell.appendChild(T('div','sk sk-lbl'));
      cell.appendChild(T('div','sk sk-val'));
      cell.appendChild(T('div','sub-slot'));
      st.appendChild(cell);
    }
    c.appendChild(st);
    // The footer is where the height used to run away: .imp-foot's min-height is
    // border-box (44px), but a REAL footer is taller because its controls are
    // themselves min-height:44. So the skeleton stands in button-shaped blocks,
    // which both matches the height and tells the user actions are coming.
    var f=T('div','imp-foot');
    f.appendChild(T('span','sk sk-tier'));
    var fr=T('div','imp-foot-r');
    fr.appendChild(T('span','sk sk-btn'));
    fr.appendChild(T('span','sk sk-btn sk-btn-w'));
    f.appendChild(fr);
    c.appendChild(f);
    return c;
  }
  function showSkeleton(){
    results.setAttribute('aria-busy','true');
    results.innerHTML='';
    // Compact packs two per row, so it needs four to cover the same vertical run.
    var n=results.classList.contains('compact')?4:3;
    for(var i=0;i<n;i++) results.appendChild(skelCard());
    moreWrap.classList.remove('on');
  }

  function renderList(){
    var rows=sortLeads(visibleLeads());
    results.removeAttribute('aria-busy');
    results.innerHTML='';
    if(!rows.length){
      results.appendChild(emptyState('\\u2298','No matches in this set',
        'Every importer we pulled was filtered out. Loosen the filters in "Narrow your results", or widen your lane / commodity and search again.',
        ['Clear the country filter','Drop the TEU band','Reset filters']));
    }
    else { rows.forEach(function(l){ results.appendChild(card(l)); }); }
    renderChips();
    var shown=rows.length, total=allLeads.length;
    // A full sentence, not a fragment: how many you are looking at, out of how
    // many were pulled, how many raw customs records that came from, and the
    // order they are in. The old line ("6 importers · 177,457 records scanned")
    // never said whether a filter was hiding anything or what the order was.
    countEl.innerHTML='';
    function frag(txt){ countEl.appendChild(document.createTextNode(txt)); }
    function strong(txt){ var b=document.createElement('b'); b.textContent=txt; countEl.appendChild(b); }
    if(shown===total){ frag('Showing all '); strong(String(total)); frag(' importer'+(total===1?'':'s')); }
    else { frag('Showing '); strong(String(shown)); frag(' of '); strong(String(total)); frag(' importers'); }
    if(totalScanned){ frag(' \\u00b7 built from '); strong(totalScanned.toLocaleString('en-US')); frag(' customs records'); }
    frag(' \\u00b7 sorted by '); strong(sortLabel());
    renderScope(total);
    writeUrl();
    // Active-filter count on the pane header (visible when it is folded on mobile).
    if(sideN){
      var active=Object.keys(facetState.country).filter(function(k){return facetState.country[k];}).length
        +Object.keys(facetState.chapter).filter(function(k){return facetState.chapter[k];}).length
        +(facetState.minShip?1:0)+(facetState.minTeu?1:0)+(facetState.verifiedOnly?1:0);
      sideN.textContent=active?String(active):'';
      sideN.className='imp-side-n'+(active?' on':'');
    }
  }

  function ingest(res){
    var leads=res.leads||[];
    var added=0;
    leads.forEach(function(l){ var key=(l.company||'').toLowerCase(); if(key&&!seenCos[key]){ seenCos[key]=true; allLeads.push(l); added++; } });
    if(typeof res.recordsScanned==='number') totalScanned+=res.recordsScanned;
    // Show "Load more" only if this page came back full AND actually added at
    // least one NEW importer. A page that is all duplicates (added===0) would
    // spend an ImportYeti pull for zero gain, so hide the button then.
    // A NAME search has no pages at all — both of its layers return their whole
    // match set in one go — so the button would promise more that does not exist.
    var full=!res.nameSearch && leads.length>=PAGE_SIZE && added>0;
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

  // The cacheOnly arg runs the search as a CACHE PROBE — see parseCacheOnly() on
  // the server. Used for a deep-linked (shared) arrival so following a link can
  // never spend an ImportYeti credit; the status copy stays honest about which
  // of the two it is doing.
  function doSearch(payload,page,append,cacheOnly){
    setStatus(cacheOnly?'Opening a shared search \\u2014 checking the cache\\u2026'
                       :'Searching live customs records\\u2026',true);
    if(!append) showSkeleton();
    loadMoreBtn.disabled=true;
    // The record strip only ever updated on SUCCESS, so while a search ran it
    // still told the user to "pick a port, lane or commodity to start" — which
    // they had just done — directly beside "Searching…".
    if(recordLine&&!append) recordLine.textContent=cacheOnly?'checking the cache for this lane':'searching this lane now';
    var body={}; for(var k in payload)body[k]=payload[k]; body.page=page;
    if(cacheOnly) body.cacheOnly=true;
    return fetch('/api/importers/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,status:r.status,j:j}; }); })
      .then(function(out){
        btn.disabled=false; loadMoreBtn.disabled=false;
        var j=out.j||{};
        if(out.status===429){
          setStatus((j&&j.message)||'Too many searches. Slow down and try again in a minute.',false);
          if(!append){ results.innerHTML=''; results.appendChild(emptyState('\\u23F1','Slow down a moment',
            (j&&j.message)||'You have run a lot of searches in a short window. Repeat and cached searches stay free — try again in a minute.',
            ['Wait ~60 seconds','Re-run a cached lane'],true)); }
          return;
        }
        if(j.searchLimited){
          setStatus((j&&j.message)||'Live-search limit reached for today — cached searches stay free.',false);
          moreWrap.classList.remove('on');
          if(!append){ results.innerHTML=''; results.appendChild(emptyState('\\u26A1','Daily live-pull limit reached',
            (j&&j.message)||'Live-search limit reached for today — repeat and cached searches are still free. Try again later or narrow your lane.',
            ['Try a port you searched before','Narrow the lane','Come back tomorrow'],true)); }
          return;
        }
        // Cost guard: this environment is cache-only and nothing is cached for
        // this lane. Render the designed no-data state — never "No matches",
        // which would claim we searched and found nothing.
        if(j.cacheOnly){
          if(!append){ allLeads=[]; seenCos={}; totalScanned=0; }
          side.classList.remove('on'); moreWrap.classList.remove('on');
          setStatus((j&&j.message)||'Live customs pulls are disabled in this environment.',false);
          results.innerHTML=''; results.appendChild(emptyState('\\u{1F512}','Live customs pulls are off here',
            'This environment only serves lanes that are already cached, so there is nothing to show for these filters. Nothing was charged.',
            ['Try a lane that has been searched before','Live pulls run in production only'],true));
          return;
        }
        // ── Shared link, not cached: STOP and ask (R5 cost safety) ────────────
        // The probe proved this lane would need a PAID live pull, so we render
        // the restored search rather than running it. The link still behaves
        // like a shared search — every filter, facet and sort is already in
        // place — it just makes the spend a deliberate click.
        if(j.needsLivePull){
          if(!append){ allLeads=[]; seenCos={}; totalScanned=0; }
          side.classList.remove('on'); moreWrap.classList.remove('on');
          toolbar.classList.remove('on');
          setStatus('Shared search restored \\u2014 nothing charged. Press Run search to pull it.',false);
          results.innerHTML='';
          results.appendChild(emptyState('\\u{1F517}','This shared search is ready to run',
            'Its filters are restored above, but this lane is not in our cache yet, so building it needs a live customs pull. We do not run one automatically just because a link was opened \\u2014 nothing has been charged.',
            ['Filters, sort and facets are already set','A cached lane would have opened instantly'],false,
            { label:'Run search', hint:'Pulls live customs records',
              onClick:function(){ doSearch(payload,page,false); } }));
          try{ results.focus({preventScroll:true}); }catch(e){ results.focus(); }
          return;
        }
        if(!out.ok||j.error){
          setStatus((j&&j.message)||'Importer search is temporarily unavailable. Try again shortly.',false);
          if(!append){ results.innerHTML=''; results.appendChild(emptyState('\\u26A0',
            j.error==='not_configured'?'Importer search is not switched on yet':'Importer search is temporarily unavailable',
            j.error==='not_configured'
              ? 'The customs-data provider is not configured in this environment yet. Everything else on QuoteFleet still works.'
              : 'The customs-data provider did not answer. Nothing was charged \\u2014 your filters are still set, so hit Search importers to retry.',
            j.error==='not_configured'?['Check back soon']:['Try again','Pick a different port'],true)); }
          return;
        }
        if(!append){ allLeads=[]; seenCos={}; totalScanned=0; }
        var added=ingest(j);
        toolbar.classList.add('on');
        updateProfilesLeft(j);
        if(!allLeads.length){
          side.classList.remove('on'); results.innerHTML='';
          // The toolbar is already visible at this point, so a previous search's
          // "Showing all 6 importers…" sentence would sit above an empty state
          // and describe results that are no longer on screen. Say the truth.
          countEl.textContent='No importers matched this search.';
          if(scopeEl) scopeEl.textContent='';
          renderChips(); writeUrl();
          // Commodity / HS-code searches need an entry geography to scope the
          // customs pull — a bare commodity with no port/state/company reliably
          // returns nothing, so guide the user to add a port instead of a dead end.
          var commodityOnly = curPayload && (curPayload.hsCode||curPayload.product) &&
            !curPayload.entryPort && !curPayload.state && !curPayload.supplierCountry && !curPayload.company;
          var e;
          if(j.nameSearch){
            // A name that matched nothing is NOT "this importer does not import".
            // Say exactly what was searched, and offer the lane path that can
            // pull records this search deliberately did not buy.
            var nameScope=j.nameLiveSearched
              ? 'No US importer on file matches that name. Check the spelling, try the legal entity name (Corp / LLC / Inc), or search by port and commodity instead.'
              : 'That name is not among the '+Number(j.nameIndexTotal||0).toLocaleString('en-US')+' importers QuoteFleet has already pulled, and the live company directory is unavailable right now. Search by entry port or commodity to pull the lane, then the name will be searchable.';
            e=emptyState('\\uD83D\\uDD0D','No importer found by that name',nameScope,
              ['Try the legal entity name','Search by entry port','Search by commodity']);
            setStatus('No importer matched that name.',false);
          } else if(commodityOnly){
            e=emptyState('\\u2693','Add a port to search by commodity',
              'Commodity and HS-code searches need an entry port (or state) to scope the customs data. Pick a US port above and search again.',
              ['Port of Savannah','Port of Long Beach','Port of Newark']);
            setStatus('Add an entry port or state to search by commodity.',false);
          } else {
            e=emptyState('\\u2298','No importers on this lane',
              'Nothing in the customs records matched that combination. Try a busier port, drop the state filter, or broaden the commodity.',
              ['Try a busier port','Drop the state filter','Broaden the commodity']);
            setStatus('No importers matched those filters \\u2014 widen your lane or commodity.',false);
          }
          results.appendChild(e);
          if(recordLine&&j.recordsScanned){ recordLine.textContent=Number(totalScanned).toLocaleString('en-US')+' customs records scanned'; }
          return;
        }
        buildFacets(); renderList();
        // The toolbar already carries the count — this line adds only provenance.
        // A NAME search says what it searched, because it did not search the
        // 700M+ bill corpus the headline figure refers to: it matched company
        // records. Overstating that would be the one dishonest thing this page
        // could say about itself.
        if(j.nameSearch){
          setStatus(j.nameLiveSearched
            ? 'Matched against the US importer directory \\u2014 free. Open a profile for its bill-of-lading history.'
            : 'Matched against the '+Number(j.nameIndexTotal||0).toLocaleString('en-US')+' importers QuoteFleet has already pulled \\u2014 free.',false);
        } else {
          setStatus(j.cached?'Served from cache \\u2014 free.':'Built from a live customs pull.',false);
        }
        // A name search scans no bills, so "0 customs records scanned" would be a
        // true number attached to a false impression. Say what it matched instead.
        if(recordLine){
          recordLine.textContent = totalScanned
            ? Number(totalScanned).toLocaleString('en-US')+' customs records scanned'
            : (j.nameSearch ? 'matched by company name \\u2014 no customs records pulled'
                            : 'pick a port, lane or commodity to start');
        }
        // Land the caret on the results after a FRESH search, so keyboard and
        // screen-reader users are not left at the top of the form with the page
        // silently rewritten below them. "Load more" appends, so it must not
        // yank focus back to the top of the list.
        if(!append){
          try{ results.focus({preventScroll:true}); }catch(e){ results.focus(); }
          // On a phone the form panel + toolbar stand ~1,080px tall, so a
          // successful search left ZERO results on screen — the user pressed
          // Search and saw only chrome. Desktop keeps preventScroll (results are
          // already in view there and yanking the page would be worse).
          if(window.innerWidth<=900){
            try{ results.scrollIntoView({block:'start',behavior:'smooth'}); }
            catch(e){ try{ results.scrollIntoView(); }catch(e2){} }
          }
        }
      })
      .catch(function(){ btn.disabled=false; loadMoreBtn.disabled=false;
        setStatus('Network error \\u2014 please try again.',false);
        results.innerHTML='';
        results.appendChild(emptyState('\\u26A0','Could not reach the search service',
          'The request did not complete. Your filters are still set \\u2014 hit Search importers to retry.',
          ['Retry the search','Check your connection'],true)); });
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
      setStatus('Enter a company name, or pick a port, state or commodity, to search.',false); return;
    }
    curPayload=payload; curPage=1;
    curQs=formQs();
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
      // Export exactly WHAT IS ON SCREEN (R4). It used to post the whole
      // accumulated set, so a user who filtered to 4 German suppliers and sorted
      // by TEU got a 25-row file in the server's order — a file that did not
      // match the screen it was exported from.
      var rows=sortLeads(visibleLeads());
      if(!rows.length){ setStatus('Every importer is filtered out \\u2014 loosen the filters, then export.',false); return; }
      exportBtn.setAttribute('aria-busy','true');
      fetch('/api/importers/export.csv',{method:'POST',
        headers:{'Content-Type':'application/json','Accept':'text/csv'},
        body:JSON.stringify({leads:rows})})
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
  // A link that carries a search opens it — but it can NEVER spend a credit on
  // its own (R5). The arrival runs as a cache probe: a cached lane renders its
  // results instantly and for free, exactly like the shared search it is; an
  // uncached lane stops at a restored form with a "Run search" button, because
  // "someone opened a link" is not a decision to buy customs data.
  restoreFromUrl();
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

/**
 * COST SAFETY (R5) — `cacheOnly` turns the search into a CACHE PROBE.
 *
 * Round 4 made a search shareable, and opening the link auto-ran it. That is
 * good UX and a real cost hole: a link circulated in a Slack channel, a
 * bookmark opened by a crawler, or a colleague re-opening it a week later each
 * triggered a PAID ImportYeti pull for any lane not already cached. Credits are
 * only ever to be spent DELIBERATELY, for a real user who asked.
 *
 * So a deep-linked arrival sends `cacheOnly: true`. The search then runs with
 * live pulls forced OFF: an already-cached lane is served in full for $0 (the
 * shared link works exactly as before), and an uncached lane answers
 * `needsLivePull` WITHOUT opening a socket — the client renders the restored
 * form plus an explicit "Run search" button, so the spend becomes a click the
 * user made rather than a side effect of following a link.
 *
 * This costs NO extra request: the auto-run POST *is* the probe. The cache read
 * it performs is the same indexed `importer_bol_cache` lookup a normal search
 * does first anyway.
 */
function parseCacheOnly(body: unknown): boolean {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const v = b.cacheOnly;
  return v === true || v === 1 || v === '1' || v === 'true';
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

/**
 * TRUE when the only thing the user gave us is a company NAME (volume/TEU bands
 * are post-filters, not pull parameters, so they do not count as a lane).
 *
 * This is the COST fork. ImportYeti's BILLS route has no consignee-name
 * parameter — its `company` param takes a slug and returns one company — so
 * there is nothing a name can be pulled BY there. The old behaviour pulled an
 * untargeted page of bills and name-filtered it locally: a real credit spent on
 * an arbitrary slice of the corpus, which then matched nothing.
 *
 * A name-only search is answered by `searchByName` instead — the local index
 * plus ImportYeti's ZERO-credit `company/search` directory. Zero credits, always.
 */
function isNameOnly(f: ImporterFilters): boolean {
  return !!f.company && !f.entryPort && !f.state && !f.hsCode && !f.product && !f.supplierCountry;
}

/** FREE browse projection — never leak the LOCKED contact fields (the email, the
 *  decision-maker's name/title) to the client; only the TIER LABEL, i.e. what a
 *  reveal on the profile would actually unlock. The phone and address are free
 *  page data but are still not repeated here: they belong on the profile, which
 *  is where the card links. `hasPhone` is kept as a card-density signal only. */
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
    // The card's "Quote this lane" href, built server-side by the SAME helper
    // the profile page uses so both surfaces mean the same thing. null when the
    // entry port resolves to no directory facet — the card then renders no CTA
    // at all rather than a link that 302s back to /directory.
    quote_href: quoteLaneHref({
      entryPort: l.entry_port,
      destinationState: l.state,
      product: l.product,
      hsCode: l.hs_code,
    }),
    ships_12m: l.ships_12m,
    total_shipments: l.total_shipments,
    teu_12m: l.teu_12m,
    last_shipment: l.last_shipment,
    // Sample-scoped alias counts (see aliasCountsByCompany) — the card labels
    // them as "in this search sample" and gates rendering on > 1.
    alias_names: l.alias_names ?? null,
    alias_addresses: l.alias_addresses ?? null,
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

/** Cheap contact tier for the free browse card. Everyone starts on the
 *  `phone_only` FLOOR, which now means "no email resolved (yet)" — it promises
 *  nothing and is never charged. A prior paid reveal cached in
 *  importer_contact_cache upgrades the label to a real email tier for free — via
 *  a single indexed IN() lookup (never a scan). Degrades to the floor on any
 *  cache failure, which is honest: an unknown company has no email on file here. */
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
 * Company-NAME search. Two layers, BOTH free — no bill-of-lading pull happens on
 * this path at all, so it can never spend an ImportYeti credit.
 *
 *   1. THE LOCAL INDEX (importerNameIndex.ts). Importers a paid pull already
 *      surfaced. Rich: full lane, volumes, incumbent, winnability. Works
 *      everywhere, including dev/CI where live calls are structurally off.
 *   2. IMPORTYETI'S FREE COMPANY DIRECTORY (`company/search`, documented at 0
 *      credits — see searchCompaniesByName). Covers every US importer on file,
 *      not just ours, but returns identity + headline volume only. Merged in for
 *      companies layer 1 does not already hold, so a richer local card is never
 *      replaced by a sparser remote one.
 *
 * Layer 2 degrades silently to nothing when the cost guard is off (dev, CI, an
 * agent's checkout), when the API key is unset, when ImportYeti errors, or when
 * the cost breaker has latched. The caller is told which layers actually ran
 * (`nameLiveSearched`) so the page can describe the coverage truthfully instead
 * of implying the whole corpus was searched when only the index was.
 *
 * REDACTIONS APPLY TO BOTH LAYERS, after the merge — a Manifest Privacy customer
 * must not be findable by typing their name, whichever layer knows about them.
 */
async function searchByName(
  filters: ImporterFilters,
  opts: { bolCache: BolCacheStore; redactKeys: Set<string> },
): Promise<{
  leads: ImporterLead[];
  creditsRemaining: number | null;
  cached: boolean;
  pulledLive: boolean;
  recordsScanned: number;
  liveBlocked: boolean;
  nameIndexTotal: number;
  nameLiveSearched: boolean;
}> {
  const query = filters.company ?? '';
  const limit = Math.min(MAX_LEADS, NAME_INDEX_MAX_RESULTS);
  const local = await searchNameIndex(opts.bolCache, query, {
    redactKeys: opts.redactKeys,
    limit,
    minShipments12m: filters.minShipments12m,
    minTeu12m: filters.minTeu12m,
  });

  // Copied, not aliased: `local.leads` is the index layer's own result array and
  // the merge below appends to this one.
  const leads = [...local.leads];
  let nameLiveSearched = false;
  if (leads.length < limit) {
    try {
      const remote = await searchCompaniesByName(query, { pageSize: limit });
      if (!remote.blocked) {
        nameLiveSearched = true;
        const seen = new Set(leads.map((l) => companyKey(l.company)));
        for (const row of remote.companies) {
          if (leads.length >= limit) break;
          const lead = companySearchRowToLead(row);
          if (!lead) continue;
          const k = companyKey(lead.company);
          // Redaction + de-dup against layer 1, and drop forwarders/NVOCCs for
          // the same reason the lane path does: their contact is another
          // forwarder's, not the buyer's.
          if (!k || seen.has(k) || isLeadRedacted(opts.redactKeys, lead) || isForwarder(lead.company)) continue;
          if (filters.minShipments12m && (lead.total_shipments ?? 0) < filters.minShipments12m) continue;
          seen.add(k);
          leads.push(lead);
        }
      }
    } catch (err) {
      // A name lookup must never take the page down, and must never fall through
      // to a paid path. Log and serve whatever layer 1 found.
      console.warn('[importers.nameSearch] free company lookup failed:', (err as Error)?.message);
    }
  }
  // Best name match first is already layer 1's order; keep remote hits after it.
  return {
    leads: leads.slice(0, limit),
    creditsRemaining: null,
    // Nothing was bought: report it as a free result, never as a live pull.
    cached: true,
    pulledLive: false,
    recordsScanned: 0,
    liveBlocked: false,
    nameIndexTotal: local.total,
    nameLiveSearched,
  };
}

/**
 * One search → one result set, resolving the State ⇄ Port ENTRY-geography pair:
 *
 *  • Company NAME alone → `searchByName`: the local index + ImportYeti's free
 *    company directory. No bills pull, no credit, ever (see isNameOnly).
 *  • Port selected (with or without the auto-locked State) → a single pull
 *    filtered by that PORT. The locked State is display-only and is NOT used to
 *    HQ-filter (that wrongly excluded importers HQ'd elsewhere).
 *  • State only (no Port) → expand the State to its entry ports
 *    (entryPortsForState) and pull each, deduping importers across them. This
 *    returns everyone ENTERING through the state, whatever their HQ state.
 *  • Commodity only → a single pull as before.
 *
 * A company name combined with a lane is unchanged: the lane is pulled and the
 * name narrows that pulled set (applyPostFilters), which costs nothing extra.
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
  liveBlocked: boolean;
  /** Set only on the name path: how many importers the LOCAL index holds (the
   *  honest coverage number the UI quotes when the live layer is unavailable).
   *  Undefined on every lane path. */
  nameIndexTotal?: number;
  /** Set only on the name path: TRUE when ImportYeti's free company directory
   *  was actually reachable for this query, i.e. the search covered every US
   *  importer on file rather than only the ones we have already pulled. */
  nameLiveSearched?: boolean;
}> {
  // Resolve the active Manifest Privacy redaction set once (cached) so every
  // per-port pull in the state-expansion loop shares it — a CBP-confirmed
  // confidentiality customer is dropped from the search results.
  const redactKeys = await activeRedactionKeys();

  // ── Name-only: two FREE layers, never a bills pull ────────────────────────
  // Page 2+ of a name search would be a second slice of the same match list;
  // both layers return their whole match set at once, so later pages are empty
  // by construction rather than by another lookup.
  if (isNameOnly(filters)) {
    if (page > 1) {
      return { leads: [], creditsRemaining: null, cached: true, pulledLive: false, recordsScanned: 0, liveBlocked: false, nameIndexTotal: 0, nameLiveSearched: false };
    }
    return searchByName(filters, { bolCache: opts.bolCache, redactKeys });
  }
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
      return { leads: [], creditsRemaining: null, cached: false, pulledLive: false, recordsScanned: 0, liveBlocked: false };
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
  let anyBlocked = false;
  for (const portValue of ports) {
    if (merged.length >= MAX_LEADS) break; // enough unique importers → stop (credits)
    const pf: ImporterFilters = { ...rest, entryPort: portValue };
    const r = await findImporterLeads({ ...common, filters: pf, cacheKey: bolCacheKey(pf, page) });
    recordsScanned += r.recordsScanned;
    if (r.creditsRemaining != null) creditsRemaining = r.creditsRemaining;
    if (r.pulledLive) anyLive = true;
    if (r.liveBlocked) anyBlocked = true;
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
    // Cache-only ONLY when the guard blocked pulls AND nothing came back cached.
    liveBlocked: anyBlocked && merged.length === 0,
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
        message: 'Enter a company name, or pick a port, state or commodity, to search.',
      });
      return;
    }
    const page = parsePage(req.body);
    const cacheProbe = parseCacheOnly(req.body);
    const bolCache = deps.bolCache ?? dbBolCacheStore;
    const contactCache = deps.contactCache ?? dbContactCacheStore;
    // A name-only search never reaches ImportYeti (see isNameOnly / runSearch),
    // so none of the credit machinery below applies to it.
    const nameSearch = isNameOnly(filters);

    // ── Credit guardrail #7 — searching is FREE + generous ────────────────────
    // Cache-first: a cache HIT costs nothing and is ALWAYS served (never counts).
    // The only search guard is a GENEROUS per-IP/day soft cap on LIVE (uncached)
    // pulls as pure anti-abuse — it vetoes the live pull, it is NOT a paywall.
    // (The FREE quota lives on opening detailed PROFILES — see importerQuota.ts.)
    // A cache PROBE never reaches the live path, so the anti-abuse counter is not
    // even read for it — following a shared link is not "a search you ran".
    const searchGate = cacheProbe
      ? { allowed: false, remaining: 0 }
      : checkLiveSearchAllowed(req);

    const result = await runSearch(filters, page, {
      bolCache,
      allowLivePull: !cacheProbe && searchGate.allowed,
    });

    // ── COST SAFETY: the probe found no complete cached copy of this search ───
    // Answer "not cached" instead of pulling. NOTHING was charged and no socket
    // was opened — `allowLivePull:false` returns before `pullImportBols`. The
    // client restores the form and shows an explicit "Run search" button, so the
    // credit is spent only when a human asks for it.
    //
    // Note `result.cached` is the FULL-COVERAGE flag: a state-only search fans
    // out over several entry ports, and it is true only when EVERY contributing
    // port was a hit. A partially cached fan-out therefore reports needsLivePull
    // rather than quietly serving a subset the user would read as the whole
    // answer — running it then still costs only the ports that were missing.
    if (cacheProbe && !result.cached) {
      res.json({
        leads: [],
        count: 0,
        page,
        pageSize: MAX_LEADS,
        cached: false,
        pulledLive: false,
        source: 'cache-probe',
        cacheProbe: true,
        needsLivePull: true,
        message:
          'This shared search is not cached yet — running it pulls live customs records. Nothing has been charged.',
      });
      return;
    }

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

    // HARD COST GUARD: the live pull was refused (dev / CI / agent checkout) and
    // nothing was cached for this lane. Answer honestly — cache-only, no data —
    // instead of returning an empty set the UI would read as "no matches".
    if (result.liveBlocked && result.leads.length === 0) {
      res.json({
        leads: [],
        count: 0,
        cached: false,
        pulledLive: false,
        source: 'cache-only',
        cacheOnly: true,
        message:
          'Live customs pulls are disabled in this environment — only lanes already cached can be searched here.',
        note: CACHE_ONLY_NOTE,
      });
      return;
    }

    // A live pull actually happened → count it for anti-abuse + meter the credit.
    if (result.pulledLive) {
      recordLiveSearch(req);
      logCreditSpend(result.creditsRemaining, `page=${page}`);
    }

    // Fold whatever this LANE search surfaced into the company-name index, so a
    // later name lookup can find it for $0. These leads are already in memory and
    // already paid for, so indexing costs nothing external and — because it runs
    // AFTER the redaction filter in runSearch — can never index a hidden importer.
    // Best-effort by contract: it cannot throw, and never blocks the answer.
    if (!nameSearch) await indexLeads(bolCache, result.leads);

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
      // HONEST SCOPE. A name-only search ran over the local index, not the 700M+
      // customs corpus, so it is labelled as its own source and carries the real
      // size of what it searched. The client states both, verbatim, rather than
      // letting a name result inherit the page's dataset headline.
      source: nameSearch ? 'name' : result.cached ? 'cache' : 'live',
      nameSearch,
      nameIndexTotal: result.nameIndexTotal ?? null,
      nameLiveSearched: result.nameLiveSearched ?? false,
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

/** GET /api/importers/suggest — autosuggest for the commodity/HS and the
 *  company-name comboboxes.
 *
 *  ImportYeti is NEVER called for suggestions, in either branch:
 *   • `field=commodity` (aliases: hs, product) is served from the curated
 *     in-memory HS reference.
 *   • `field=company` is served from the LOCAL company-name index — companies a
 *     paid pull already surfaced (see importerNameIndex.ts). That is deliberate
 *     as well as free: the suggestions ARE the honest coverage statement, since
 *     they show exactly which names this search can find.
 *  An unknown field returns an empty list. */
export async function handleImporterSuggest(
  req: Request,
  res: Response,
  deps: { bolCache?: BolCacheStore } = {},
): Promise<void> {
  const field = String((req.query.field ?? 'commodity') || 'commodity').toLowerCase();
  const q = String(req.query.q ?? '').slice(0, 80);
  if (field === 'commodity' || field === 'hs' || field === 'product') {
    res.json({ items: suggestCommodity(q, 10) });
    return;
  }
  if (field === 'company') {
    try {
      // Redactions apply to autosuggest exactly as they do to results — a hidden
      // importer must not be discoverable by typing the first letters of its name.
      const redactKeys = await activeRedactionKeys();
      res.json({ items: await suggestCompanies(deps.bolCache ?? dbBolCacheStore, q, { redactKeys }) });
    } catch {
      res.json({ items: [] });
    }
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
