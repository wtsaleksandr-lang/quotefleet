/**
 * Server-rendered Importer **Company Profile** page (Phase 2 of Importer Search).
 *
 *   GET /importers/company/:slug
 *
 * Opening a profile pulls that ONE company's bill-of-lading history from
 * ImportYeti. The `company` query param on the powerquery/us-import/bols endpoint
 * is the filter that actually scopes a pull to a single importer — and it takes
 * the company SLUG (from each row's `company_link`, e.g. "valbruna-stainless"),
 * NOT the display name or the basename (verified against the live API: only the
 * slug returns `distinctCompanies === 1`; name/basename/link are ignored). The
 * search-result cards carry that slug (see ImporterLead.slug) and link here.
 *
 * COST + CACHE: a profile pull is credit-heavy (~5 credits / 50-row page × up to
 * a few pages), so it is cache-first. The combined raw rows are cached in the
 * shared `importer_bol_cache` table under a profile-scoped key, TTL 14 days —
 * ImportYeti's ToS permits storing the data — so a repeat open is $0.
 *
 * FREEMIUM GATE: opening a detailed profile is the gated action. It calls the
 * REUSABLE Phase-1 gate `checkDetailQuota(req)`. Allowed → render the profile and
 * `recordDetailOpen(req,res)`. Over the free quota (default 3) → render a
 * "Subscribe to open more importer profiles" wall with the identity teaser
 * visible and the detail behind the wall. The decision-maker CONTACT stays
 * SEPARATELY locked (paid unlock) regardless of quota.
 *
 * The three owner-requested features live here:
 *   (2) shipments-over-time chart with a floating hover tooltip (inline SVG + JS);
 *   (3) a fixed left dot shortcut pane — scroll-spy highlights the in-view
 *       section, hover unfolds the labels, click scrolls to + unfolds a section;
 *   (4) section fold/unfold — only the first section is open on load.
 *
 * Styles + client JS are inlined in this TS module (exactly like importerPages /
 * DIRECTORY_CSS) so the public-dir spacing/color guards never scan them.
 */
import type { Express, Request, Response } from 'express';
import { layout, esc } from './pages.js';
import { ISO_COUNTRIES } from './isoCountries.js';
import { pullImportBols, type BolRow } from './importerLeads.js';
import {
  dbBolCacheStore,
  searchKey,
  companyKey,
  isFresh,
  type BolCacheStore,
} from './importerCache.js';
import {
  checkDetailQuota,
  recordDetailOpen,
  FREE_DETAIL_QUOTA,
  DETAIL_WALL_MESSAGE,
  type QuotaState,
} from './importerQuota.js';

const SITE = 'https://quotefleet.net';

/** Read a positive integer from the environment, else fall back. */
const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
/** Rows per ImportYeti page for a profile pull. */
export const PROFILE_PAGE_SIZE = envInt('IMPORTER_PROFILE_PAGE_SIZE', 50);
/** Hard cap on pages pulled per profile (cost guard). ~5 credits/page; the pull
 *  is cached 14 days + gated behind the 3-free-profile quota, so a deeper sample
 *  (a richer shipments-over-time chart) is a one-time cost per company. */
export const PROFILE_MAX_PAGES = envInt('IMPORTER_PROFILE_MAX_PAGES', 6);

// ── slug + small utils ───────────────────────────────────────────────────────
const SLUG_RX = /^[a-z0-9][a-z0-9-]{0,80}$/;
/** Sanitize a `:slug` route param to ImportYeti's slug charset (or ''). */
export function sanitizeSlug(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase().trim();
  return SLUG_RX.test(s) ? s : '';
}
/** Human title from a slug when we have no pulled data ("valbruna-stainless" →
 *  "Valbruna Stainless"). Teaser-only; the pulled data supplies the real name. */
export function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const N = (v: number | null | undefined): string => (v == null ? '—' : Number(v).toLocaleString('en-US'));

const COUNTRY_NAME = new Map(ISO_COUNTRIES.map((c) => [c.code.toUpperCase(), c.name] as const));
const countryName = (cc: string | null | undefined): string => {
  const k = str(cc).toUpperCase();
  return (k && COUNTRY_NAME.get(k)) || k || '—';
};
/** Regional-indicator flag emoji from a 2-letter ISO code (safe, no markup). */
function flag(cc: string | null | undefined): string {
  const k = str(cc).toUpperCase();
  if (!/^[A-Z]{2}$/.test(k)) return '';
  return String.fromCodePoint(...[...k].map((c) => 127397 + c.charCodeAt(0)));
}

/** Common HS-chapter labels (2-digit) so the product breakdown reads like the
 *  mockup ("82 · Tools"); unknown chapters fall back to "Chapter NN". */
const HS_CHAPTERS: Record<string, string> = {
  '25': 'Stone & minerals', '27': 'Mineral fuels', '28': 'Inorganic chemicals',
  '29': 'Organic chemicals', '30': 'Pharma', '32': 'Dyes & inks', '33': 'Cosmetics',
  '38': 'Chemical products', '39': 'Plastics', '40': 'Rubber', '42': 'Leather goods',
  '44': 'Wood', '48': 'Paper', '49': 'Printed matter', '52': 'Cotton', '54': 'Man-made filaments',
  '61': 'Apparel (knit)', '62': 'Apparel (woven)', '63': 'Textiles', '64': 'Footwear',
  '68': 'Stone/cement articles', '69': 'Ceramics', '70': 'Glass', '72': 'Iron & steel',
  '73': 'Iron/steel articles', '74': 'Copper', '76': 'Aluminium', '82': 'Tools & cutlery',
  '83': 'Base-metal articles', '84': 'Machinery', '85': 'Electrical machinery',
  '87': 'Vehicles', '90': 'Instruments', '94': 'Furniture & lighting', '95': 'Toys & sports',
  '96': 'Misc. manufactured',
};
const chapterLabel = (hs: string): string => {
  const ch = str(hs).slice(0, 2);
  if (!ch) return 'Uncategorised';
  return `${ch} · ${HS_CHAPTERS[ch] || 'Chapter ' + ch}`;
};

/** Mask a phone to a contact-unlock teaser: "***-***-6693". */
function maskPhone(raw: string | null | undefined): string | null {
  const digits = str(raw).replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `***-***-${digits.slice(-4)}`;
}

/** Rough est. 12-mo ocean+port spend from TEU (deliberately labelled "est."). */
function estSpend(teu12m: number | null): string | null {
  if (!teu12m) return null;
  const d = teu12m * 2600;
  if (d >= 1e6) return `~$${(d / 1e6).toFixed(1)}M`;
  if (d >= 1e3) return `~$${Math.round(d / 1e3)}k`;
  return `~$${Math.round(d)}`;
}

// ── aggregation ──────────────────────────────────────────────────────────────
export interface ProfileMonth {
  key: string;
  label: string;
  count: number;
}
export interface ProfileData {
  slug: string;
  company: string;
  address: string | null;
  phoneMasked: string | null;
  website: string | null;
  countryCode: string | null;
  entryPort: string | null;
  incumbent: string | null;
  aliasesCount: number;
  totalShipments: number | null;
  ships12m: number | null;
  teu12m: number | null;
  avgTeu: number | null;
  estSpend: string | null;
  firstShipment: string | null;
  months: ProfileMonth[];
  suppliers: Array<{ name: string; country: string | null; ships: number; product: string | null; hs: string | null }>;
  hsBreakdown: Array<{ hs: string; chapter: string; desc: string; n: number }>;
  origins: Array<{ cc: string; name: string; ships: number }>;
  carriers: Array<{ scac: string; n: number }>;
  containers: Array<{ type: string; n: number }>;
  portsFrom: Array<{ port: string; cc: string | null; n: number }>;
  notifyParties: Array<{ name: string; n: number }>;
  recent: Array<{
    date: string; bol: string; supplier: string; country: string | null;
    weight: number | null; qty: number | null; unit: string | null;
    containers: number | null; product: string | null;
  }>;
  sampleSize: number;
}

/** Parse an ImportYeti MM/DD/YYYY (or ISO) date → {ym, label, sortable}. */
function monthOf(raw: string): { ym: string; label: string; sort: number } | null {
  const s = str(raw);
  if (!s) return null;
  let y: number, m: number;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (us) { m = Number(us[1]); y = Number(us[3]); }
  else if (iso) { y = Number(iso[1]); m = Number(iso[2]); }
  else return null;
  if (!(m >= 1 && m <= 12) || !(y >= 1990 && y <= 2100)) return null;
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return { ym: `${y}-${String(m).padStart(2, '0')}`, label: `${MO[m - 1]} ${y}`, sort: y * 12 + m };
}

function topBy<T>(map: Map<string, T>, count: (t: T) => number, limit: number): Array<[string, T]> {
  return [...map.entries()].sort((a, b) => count(b[1]) - count(a[1])).slice(0, limit);
}

/**
 * Fold a company's sampled BOL rows into the profile view-model. Headline totals
 * come from the per-row `company_*` aggregate fields (identical on every row, so
 * accurate for the WHOLE history); the monthly series, suppliers, HS mix, origins
 * and the carrier/port/container lists are derived from the sampled rows and are
 * labelled as "from the latest N bills" in the UI. Pure + deterministic.
 */
export function aggregateProfile(rawRows: readonly BolRow[], slug: string): ProfileData {
  // Dedup rows by bill-of-lading number (paging can echo a boundary row).
  const seen = new Set<string>();
  const rows: BolRow[] = [];
  for (const r of rawRows) {
    const id = str(r.bol_number) || `${str(r.arrival_date)}|${str(r.supplier_name)}|${str(r.hs_code)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(r);
  }
  const first = rows[0] || {};
  const company = str(first.company_basename) || str(first.company_name) || titleFromSlug(slug);
  // Self-identity keys (basename + full name) so a notify party that is really
  // the importer under a legal-suffix variant ("… Inc") is still excluded.
  const selfKeys = [companyKey(company), companyKey(str(first.company_name))].filter(Boolean);
  const isSelf = (name: string): boolean => {
    const k = companyKey(name);
    return selfKeys.some((sk) => k === sk || k.startsWith(sk + ' ') || sk.startsWith(k + ' '));
  };

  const totalShipments = first.company_total_shipments == null ? null : num(first.company_total_shipments);
  const ships12m = first.company_shipments_12m == null ? null : num(first.company_shipments_12m);
  const teu12m = first.company_teu_12m == null ? null : num(first.company_teu_12m);
  const avgTeu = ships12m && teu12m ? Number((teu12m / ships12m).toFixed(2)) : null;

  // monthly series
  const monthMap = new Map<string, ProfileMonth & { sort: number }>();
  // suppliers
  const supMap = new Map<string, { name: string; country: string | null; ships: number; product: string | null; hs: string | null }>();
  const hsMap = new Map<string, { hs: string; chapter: string; desc: string; n: number }>();
  const originMap = new Map<string, { cc: string; name: string; ships: number }>();
  const scacMap = new Map<string, { scac: string; n: number }>();
  const contMap = new Map<string, { type: string; n: number }>();
  const portFromMap = new Map<string, { port: string; cc: string | null; n: number }>();
  const notifyMap = new Map<string, { name: string; n: number }>();
  let entryPort: string | null = null;

  for (const r of rows) {
    const mo = monthOf(str(r.arrival_date));
    if (mo) {
      const cur = monthMap.get(mo.ym);
      if (cur) cur.count += 1;
      else monthMap.set(mo.ym, { key: mo.ym, label: mo.label, count: 1, sort: mo.sort });
    }
    const supName = str(r.supplier_basename) || str(r.supplier_name);
    if (supName) {
      const k = supName.toLowerCase();
      const cc = str(r.supplier_country_code).toUpperCase() || null;
      const cur = supMap.get(k);
      if (cur) cur.ships += 1;
      else supMap.set(k, { name: supName, country: cc, ships: 1, product: str(r.product_description) || str(r.hs_code_description) || null, hs: str(r.hs_code) || null });
    }
    const hs = str(r.hs_code);
    if (hs) {
      const k = hs.slice(0, 6) || hs;
      const cur = hsMap.get(k);
      if (cur) cur.n += 1;
      else hsMap.set(k, { hs: k, chapter: chapterLabel(hs), desc: str(r.hs_code_description) || str(r.product_description) || 'Goods', n: 1 });
    }
    const oc = str(r.supplier_country_code).toUpperCase();
    if (oc) {
      const cur = originMap.get(oc);
      if (cur) cur.ships += 1;
      else originMap.set(oc, { cc: oc, name: countryName(oc), ships: 1 });
    }
    const scac = str(r.carrier_scac_code).toUpperCase();
    if (scac) { const cur = scacMap.get(scac); if (cur) cur.n += 1; else scacMap.set(scac, { scac, n: 1 }); }
    const ct = typeof r.container_types === 'string' ? str(r.container_types) : '';
    if (ct) { const cur = contMap.get(ct); if (cur) cur.n += 1; else contMap.set(ct, { type: ct, n: 1 }); }
    const exitPort = str(r.exit_port);
    if (exitPort) {
      const cur = portFromMap.get(exitPort.toLowerCase());
      if (cur) cur.n += 1;
      else portFromMap.set(exitPort.toLowerCase(), { port: exitPort, cc: str(r.supplier_country_code).toUpperCase() || null, n: 1 });
    }
    // Notify party = the incumbent forwarder / consignee-agent on the bill. Count
    // every non-self notify party (a forwarder here is exactly the displaceable
    // incumbent we want to surface), so isForwarder is deliberately NOT excluded.
    const np = str(r.notify_party_name);
    if (np && !isSelf(np)) {
      const cur = notifyMap.get(np.toLowerCase());
      if (cur) cur.n += 1;
      else notifyMap.set(np.toLowerCase(), { name: np, n: 1 });
    }
    if (!entryPort && str(r.entry_port)) entryPort = str(r.entry_port);
  }

  const months = [...monthMap.values()].sort((a, b) => a.sort - b.sort).slice(-18).map((m) => ({ key: m.key, label: m.label, count: m.count }));
  const suppliers = topBy(supMap, (s) => s.ships, 10).map(([, s]) => s);
  const hsBreakdown = topBy(hsMap, (h) => h.n, 6).map(([, h]) => h);
  const origins = topBy(originMap, (o) => o.ships, 8).map(([, o]) => o);
  const carriers = topBy(scacMap, (s) => s.n, 6).map(([, s]) => s);
  const containers = topBy(contMap, (c) => c.n, 6).map(([, c]) => c);
  const portsFrom = topBy(portFromMap, (p) => p.n, 6).map(([, p]) => p);
  const notifyParties = topBy(notifyMap, (n2) => n2.n, 5).map(([, n2]) => n2);

  const recent = rows.slice(0, 12).map((r) => ({
    date: str(r.arrival_date) || '—',
    bol: str(r.bol_number) || '—',
    supplier: str(r.supplier_basename) || str(r.supplier_name) || '—',
    country: str(r.supplier_country_code).toUpperCase() || null,
    weight: r.weight == null ? null : num(r.weight),
    qty: r.quantity == null ? null : num(r.quantity),
    unit: str(r.quantity_unit) || null,
    containers: r.containers_count == null ? null : num(r.containers_count),
    product: str(r.product_description) || str(r.hs_code_description) || null,
  }));

  // The incumbent forwarder / notify party = the top non-self notify party.
  const incumbent = notifyParties.length ? notifyParties[0].name : null;

  return {
    slug,
    company,
    address: str(first.company_address) || null,
    phoneMasked: maskPhone(str(first.company_main_phone_number)),
    website: str(first.company_website) || null,
    countryCode: str(first.company_country_code).toUpperCase() || 'US',
    entryPort,
    incumbent,
    aliasesCount: 0,
    totalShipments,
    ships12m,
    teu12m,
    avgTeu,
    estSpend: estSpend(teu12m),
    firstShipment: str(first.company_first_shipment_date) || null,
    months,
    suppliers,
    hsBreakdown,
    origins,
    carriers,
    containers,
    portsFrom,
    notifyParties,
    recent,
    sampleSize: rows.length,
  };
}

/** Minimal teaser used for the subscribe wall when we have NO pulled data (an
 *  over-quota visitor whose profile isn't cached — we never spend a credit for
 *  a walled visitor). */
export function minimalTeaser(slug: string): ProfileData {
  return {
    slug, company: titleFromSlug(slug), address: null, phoneMasked: null, website: null,
    countryCode: 'US', entryPort: null, incumbent: null, aliasesCount: 0,
    totalShipments: null, ships12m: null, teu12m: null, avgTeu: null, estSpend: null,
    firstShipment: null, months: [], suppliers: [], hsBreakdown: [], origins: [],
    carriers: [], containers: [], portsFrom: [], notifyParties: [], recent: [], sampleSize: 0,
  };
}

// ── data pull (multi-page, cache-first) ──────────────────────────────────────
/** Profile cache key — scoped so it never collides with a search-page key. */
export function profileCacheKey(slug: string): string {
  return searchKey({ importerProfile: slug, v: '1', ps: PROFILE_PAGE_SIZE, mp: PROFILE_MAX_PAGES });
}

/** Live multi-page pull of ONE company's history, bounded by PROFILE_MAX_PAGES;
 *  stops early when a page returns fewer than a full page (end of history). */
async function pullCompanyHistory(slug: string): Promise<{ rows: BolRow[]; creditsRemaining: number | null }> {
  const all: BolRow[] = [];
  let creditsRemaining: number | null = null;
  for (let page = 1; page <= PROFILE_MAX_PAGES; page++) {
    const pulled = await pullImportBols({}, { companySlug: slug, pageSize: PROFILE_PAGE_SIZE, page, bolType: 'H' });
    const rows = pulled.rows || [];
    if (pulled.creditsRemaining != null) creditsRemaining = pulled.creditsRemaining;
    all.push(...rows);
    if (rows.length < PROFILE_PAGE_SIZE) break;
  }
  return { rows: all, creditsRemaining };
}

export interface ProfileFetch {
  rows: BolRow[] | null;
  cached: boolean;
  pulledLive: boolean;
}
/** Cache-first fetch. When `allowLivePull` is false a cache MISS returns rows:null
 *  (no credit spent) so a walled visitor never triggers a pull. */
export async function getProfileRows(
  slug: string,
  opts: { bolCache?: BolCacheStore; allowLivePull: boolean },
): Promise<ProfileFetch> {
  const bolCache = opts.bolCache ?? dbBolCacheStore;
  const key = profileCacheKey(slug);
  try {
    const hit = await bolCache.get(key);
    if (hit && isFresh(hit.fetchedAt)) return { rows: hit.rows ?? [], cached: true, pulledLive: false };
  } catch {
    /* cache down → fall through to a live pull (never break the page) */
  }
  if (!opts.allowLivePull) return { rows: null, cached: false, pulledLive: false };
  const pulled = await pullCompanyHistory(slug);
  try {
    await bolCache.put(key, pulled.rows, pulled.creditsRemaining);
  } catch {
    /* ignore cache-write failure */
  }
  return { rows: pulled.rows, cached: false, pulledLive: true };
}

// ── CSS (inline, guard-safe) ─────────────────────────────────────────────────
const PROFILE_CSS = `
.impp-wrap{padding:24px 0 64px;position:relative}
.impp-back{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;margin:8px 0 4px;text-decoration:none}
.impp-back:hover{color:var(--accent)}

/* identity header */
.impp-head{padding:10px 0 4px}
.impp-title{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.impp-title h1{font-size:28px;line-height:1.15;margin:0;color:var(--ink);letter-spacing:-.015em}
.impp-flag{font-size:22px;line-height:1}
.impp-pill{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 8px;border-radius:4px;background:var(--accent);color:var(--bg)}
.impp-head-act{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.impp-meta{display:flex;gap:8px 20px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin:12px 0 2px}
.impp-meta .mi{display:inline-flex;align-items:center;gap:6px}
.impp-samplenote{color:var(--muted);font-size:12px;margin:10px 0 0}
.impp-samplenote b{color:var(--ink-soft)}

/* stat strip */
.impp-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0 6px}
.impp-stat{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:14px 15px;box-shadow:var(--shadow-sm)}
.impp-stat .sl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;line-height:1.25}
.impp-stat .sv{font-size:20px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;margin-top:6px;letter-spacing:-.01em}
.impp-stat .sx{font-size:11px;color:var(--muted);margin-top:2px}
@media(max-width:860px){.impp-stats{grid-template-columns:repeat(3,1fr)}}
@media(max-width:520px){.impp-stats{grid-template-columns:repeat(2,1fr)}}

/* AI opportunity brief */
.impp-brief{border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--accent) 7%,transparent);padding:18px 20px;margin:18px 0 6px}
.impp-brief-h{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:800;color:var(--ink);margin-bottom:12px;flex-wrap:wrap}
.impp-brief-h .tag{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:var(--accent);color:var(--bg);padding:3px 9px;border-radius:5px}
.impp-brief ul{margin:0;padding:0;list-style:none;display:grid;gap:9px}
.impp-brief li{position:relative;padding-left:20px;font-size:13.5px;color:var(--ink-soft);line-height:1.5}
.impp-brief li::before{content:"";position:absolute;left:3px;top:8px;width:7px;height:7px;border-radius:50%;background:var(--accent)}
.impp-brief li b{color:var(--ink)}

/* section fold/unfold */
.impp-sec{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);margin:14px 0;box-shadow:var(--shadow-sm);overflow:hidden;scroll-margin-top:16px}
.impp-sech{width:100%;display:flex;align-items:center;gap:12px;background:none;border:0;cursor:pointer;padding:16px 18px;text-align:left;font-family:var(--font-sans);color:var(--ink);min-height:56px}
.impp-sech:hover{background:var(--surface-2)}
.impp-sech .impp-sect{font-size:16px;font-weight:700;color:var(--ink)}
.impp-sech .impp-secs{font-size:12px;color:var(--muted);margin-left:2px}
.impp-caret{margin-left:auto;flex:0 0 auto;width:16px;height:16px;color:var(--muted);transition:transform .18s ease}
.impp-sec.open .impp-caret{transform:rotate(180deg)}
.impp-secb{padding:0 18px 18px;display:none}
.impp-sec.open .impp-secb{display:block}
.impp-secb .lead{color:var(--muted);font-size:12.5px;margin:0 0 14px}

/* chart */
.impp-chartwrap{position:relative;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);padding:16px 16px 8px}
.impp-chart{display:block;width:100%;height:200px;overflow:visible}
.impp-chart rect.bar{fill:var(--accent);transition:opacity .12s}
.impp-chart rect.bar:hover{opacity:.7}
.impp-chart .axis{stroke:var(--border-strong);stroke-width:1}
.impp-xaxis{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;margin-top:8px}
.impp-tip{position:absolute;top:8px;left:0;transform:translateX(-50%);background:var(--ink);color:var(--bg);font-size:12px;font-weight:600;padding:6px 10px;border-radius:7px;pointer-events:none;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.25);z-index:5}
.impp-tip[hidden]{display:none}
.impp-tip .tc{opacity:.8;font-weight:500}

/* tables */
.impp-tbl-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:12px}
.impp-tbl{border-collapse:collapse;width:100%;min-width:560px;font-size:13px}
.impp-tbl thead th{background:var(--surface-2);text-align:left;padding:10px 14px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)}
.impp-tbl tbody td{padding:11px 14px;border-bottom:1px solid var(--border);vertical-align:middle;color:var(--ink-soft)}
.impp-tbl tbody tr:last-child td{border-bottom:0}
.impp-supn{font-weight:700;color:var(--ink)}
.impp-hschip{font-family:var(--font-mono);font-size:11px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:4px;padding:1px 6px;display:inline-block}
.impp-num{font-variant-numeric:tabular-nums}

/* bars (volume / origin) */
.impp-bars{display:flex;flex-direction:column;gap:10px}
.impp-brow{display:grid;grid-template-columns:180px 1fr 70px;align-items:center;gap:12px}
.impp-brow .bl{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);font-size:13px;min-width:0}
.impp-brow .bl span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.impp-brow .bt{height:14px;background:var(--surface-2);border-radius:4px;overflow:hidden}
.impp-brow .bt i{display:block;height:100%;background:var(--accent);border-radius:4px}
.impp-brow .bv{text-align:right;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
@media(max-width:560px){.impp-brow{grid-template-columns:120px 1fr 56px}}

/* two-column lists */
.impp-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:700px){.impp-two{grid-template-columns:1fr}}
.impp-list h4{font-size:13px;font-weight:700;color:var(--ink);margin:0 0 10px}
.impp-lrow{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--ink-soft)}
.impp-lrow:last-child{border-bottom:0}
.impp-lrow .lc{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}

/* relationships */
.impp-rel{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:700px){.impp-rel{grid-template-columns:1fr}}
.impp-relc{border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:var(--surface-2)}
.impp-relc .rn{font-weight:700;color:var(--ink);font-size:13px;display:flex;align-items:center;gap:7px}
.impp-relc .rd{font-size:12px;color:var(--muted);margin-top:5px}

/* contact lock */
.impp-lockcard{border:1px dashed var(--border-strong);border-radius:12px;background:var(--surface-2);padding:18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.impp-lockcard .blur{filter:blur(5px);user-select:none;font-weight:700;color:var(--ink)}
.impp-lockcard .lk{flex:1 1 240px;min-width:0}
.impp-lockcard .lk .lt{font-weight:700;color:var(--ink);font-size:14px}
.impp-lockcard .lk .ls{font-size:12.5px;color:var(--muted);margin-top:4px}

/* left dot shortcut pane */
.impp-dots{position:fixed;left:14px;top:50%;transform:translateY(-50%);z-index:30}
.impp-dots ul{list-style:none;margin:0;padding:8px;display:flex;flex-direction:column;gap:4px;border:1px solid transparent;border-radius:14px;transition:background .16s,box-shadow .16s,border-color .16s}
.impp-dots a{display:flex;align-items:center;gap:11px;text-decoration:none;padding:5px 6px;border-radius:9px}
.impp-dot{width:9px;height:9px;border-radius:50%;background:var(--border-strong);flex:0 0 auto;transition:background .16s,transform .16s}
.impp-dotl{font-size:12.5px;color:var(--muted);white-space:nowrap;opacity:0;max-width:0;overflow:hidden;transition:opacity .16s,max-width .16s}
.impp-dots:hover ul,.impp-dots:focus-within ul{background:var(--surface);box-shadow:var(--shadow-lg,0 12px 32px rgba(0,0,0,.2));border-color:var(--border)}
.impp-dots:hover .impp-dotl,.impp-dots:focus-within .impp-dotl{opacity:1;max-width:230px}
.impp-dots a:hover .impp-dot{background:var(--accent)}
.impp-dots a.active .impp-dot{background:var(--accent);transform:scale(1.4)}
.impp-dots a.active .impp-dotl{color:var(--ink);font-weight:700}
@media(max-width:1180px){.impp-dots{display:none}}

/* subscribe wall */
.impp-wall{border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--accent) 8%,transparent);padding:28px 24px;margin:20px 0;text-align:center}
.impp-wall h2{font-size:20px;color:var(--ink);margin:0 0 8px}
.impp-wall p{color:var(--ink-soft);font-size:14px;margin:0 auto 16px;max-width:520px}
.impp-wall .sub{color:var(--muted);font-size:12.5px;margin-top:14px}
.impp-wall-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.impp-teaserstats{filter:blur(4px);pointer-events:none;user-select:none}

/* buttons reuse .btn/.btn-primary from style.css; add an outline variant */
.impp-btn-o{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border-strong);background:var(--surface);color:var(--ink-soft);border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;min-height:44px;box-sizing:border-box}
.impp-btn-o:hover{border-color:var(--accent);color:var(--ink)}

@media (prefers-reduced-motion: reduce){
  .impp-caret,.impp-dots ul,.impp-dot,.impp-dotl,.impp-chart rect.bar{transition:none}
}
`;

// ── render helpers ───────────────────────────────────────────────────────────
const CARET = '<svg class="impp-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

interface SecDef { id: string; label: string; sub?: string; body: string; }

function section(def: SecDef, open: boolean): string {
  return `
  <section class="impp-sec${open ? ' open' : ''}" id="sec-${esc(def.id)}" data-sec="${esc(def.id)}">
    <button class="impp-sech" type="button" aria-expanded="${open ? 'true' : 'false'}" aria-controls="secb-${esc(def.id)}">
      <span class="impp-sect">${esc(def.label)}</span>${def.sub ? `<span class="impp-secs">${esc(def.sub)}</span>` : ''}
      ${CARET}
    </button>
    <div class="impp-secb" id="secb-${esc(def.id)}">${def.body}</div>
  </section>`;
}

/** Inline SVG bar chart (server-rendered rects) with per-bar data-* for the JS
 *  hover tooltip. viewBox scales to the container width; height is fixed. */
function chartSvg(months: ProfileMonth[]): string {
  if (!months.length) return '<p class="lead">No dated shipments in the sampled history yet.</p>';
  const W = 720, H = 180, padB = 4;
  const max = Math.max(...months.map((m) => m.count), 1);
  const n = months.length;
  const gap = n > 1 ? Math.max(2, Math.min(10, 320 / n)) : 4;
  const bw = (W - gap * (n - 1)) / n;
  const bars = months
    .map((m, i) => {
      const h = Math.max(2, Math.round((m.count / max) * (H - padB)));
      const x = i * (bw + gap);
      const y = H - h;
      return `<rect class="bar" data-bar data-label="${esc(m.label)}" data-count="${m.count}" x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}" rx="1.5"><title>${esc(m.label)}: ${N(m.count)}</title></rect>`;
    })
    .join('');
  const first = months[0].label, last = months[n - 1].label;
  return `
  <div class="impp-chartwrap">
    <div class="impp-tip" id="impp-chart-tip" hidden><span class="tv"></span> <span class="tc"></span></div>
    <svg class="impp-chart" id="impp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Monthly shipment counts">
      <line class="axis" x1="0" y1="${H}" x2="${W}" y2="${H}"/>
      ${bars}
    </svg>
    <div class="impp-xaxis"><span>${esc(first)}</span><span>${esc(last)}</span></div>
  </div>`;
}

function barRows(items: Array<{ label: string; value: number; flag?: string }>): string {
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<div class="impp-bars">${items
    .map(
      (i) => `<div class="impp-brow"><span class="bl">${i.flag ? i.flag + ' ' : ''}<span>${esc(i.label)}</span></span><span class="bt"><i style="width:${Math.round((i.value / max) * 100)}%"></i></span><span class="bv impp-num">${N(i.value)}</span></div>`,
    )
    .join('')}</div>`;
}

function listBlock(title: string, rows: Array<{ label: string; n: number }>): string {
  if (!rows.length) return `<div class="impp-list"><h4>${esc(title)}</h4><p class="lead">No data in the sample.</p></div>`;
  return `<div class="impp-list"><h4>${esc(title)}</h4>${rows
    .map((r) => `<div class="impp-lrow"><span>${esc(r.label)}</span><span class="lc">${N(r.n)}</span></div>`)
    .join('')}</div>`;
}

function statCard(label: string, value: string, sub?: string): string {
  return `<div class="impp-stat"><div class="sl">${esc(label)}</div><div class="sv">${esc(value)}</div>${sub ? `<div class="sx">${esc(sub)}</div>` : ''}</div>`;
}

/** The identity header (shared by the full page and the wall). */
function identityHeader(p: ProfileData, opts: { showActions: boolean }): string {
  const meta = [
    p.address ? `<span class="mi">\u{1F4CD} ${esc(p.address)}</span>` : '',
    p.phoneMasked ? `<span class="mi">\u{1F4DE} ${esc(p.phoneMasked)}</span>` : '',
    p.entryPort ? `<span class="mi">\u{1F6A2} Enters via ${esc(p.entryPort)}</span>` : '',
    p.firstShipment ? `<span class="mi">\u{1F4C5} Importing since ${esc(p.firstShipment)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  return `
  <div class="impp-head">
    <div class="impp-title">
      <h1>${esc(p.company)}</h1>
      <span class="impp-flag" aria-hidden="true">${flag(p.countryCode)}</span>
      <span class="impp-pill">Importer</span>
      ${opts.showActions ? '<div class="impp-head-act"><a class="btn btn-primary" href="/tools">Quote this lane <span class="arr">&rarr;</span></a></div>' : ''}
    </div>
    ${meta ? `<div class="impp-meta">${meta}</div>` : ''}
  </div>`;
}

/** Full statistics strip (real headline aggregates). */
function statStrip(p: ProfileData): string {
  return `<div class="impp-stats">
    ${statCard('Total sea shipments', N(p.totalShipments))}
    ${statCard('Shipments · last 12 mo', N(p.ships12m))}
    ${statCard('Avg TEU / shipment', p.avgTeu == null ? '—' : String(p.avgTeu))}
    ${statCard('TEU · last 12 mo', N(p.teu12m))}
    ${statCard('Est. shipping spend', p.estSpend || '—', 'est. · 12 mo')}
  </div>`;
}

// ── the full profile page ────────────────────────────────────────────────────
export function renderImporterProfilePage(p: ProfileData, quota: QuotaState): string {
  const port = (p.entryPort || 'their US port').split(',')[0];
  const originName = p.origins[0]?.name;
  const brief = `
  <div class="impp-brief">
    <div class="impp-brief-h"><span class="tag">AI opportunity brief</span> Why ${esc(p.company)} is winnable now</div>
    <ul>
      <li><b>Steady, sticky volume —</b> ${N(p.ships12m)} shipments (${N(p.teu12m)} TEU) in the last 12 months${p.entryPort ? ' into ' + esc(p.entryPort) : ''}; a consistent lane worth pursuing.</li>
      ${p.incumbent ? `<li><b>Displaceable incumbent —</b> notify party <b>${esc(p.incumbent)}</b> shows on the bills; a named target to undercut${originName ? ' on the ' + esc(originName) + '→' + esc(port) + ' lane' : ''}.</li>` : '<li><b>No forwarder named —</b> the bills show no dominant notify party; an open lane to win with a sharper rate.</li>'}
      <li><b>Best timing —</b> pitch ahead of their busiest months (see the shipments chart) to land the next booking cycle.</li>
      <li><b>Who to reach —</b> unlock the decision-maker contact below and send an AI-drafted opener on this exact lane.</li>
    </ul>
  </div>`;

  const sampleNote = `<p class="impp-samplenote">Headline totals are from the full ImportYeti record. The chart, suppliers, HS mix, origins and carrier lists are built from the <b>${N(p.sampleSize)}</b> most recent bills of lading on file.</p>`;

  // suppliers table
  const supBody = p.suppliers.length
    ? `<p class="lead">Who this importer buys from · top ${p.suppliers.length} in the sample</p>
    <div class="impp-tbl-wrap"><table class="impp-tbl">
      <thead><tr><th>Supplier</th><th>Shipments (sample)</th><th>Product &amp; HS</th></tr></thead>
      <tbody>${p.suppliers
        .map(
          (s) => `<tr><td><span class="impp-supn">${flag(s.country)} ${esc(s.name)}</span><div class="lead" style="margin:2px 0 0">${esc(countryName(s.country))}</div></td><td class="impp-num">${N(s.ships)}</td><td>${esc(s.product || '—')}${s.hs ? ` <span class="impp-hschip">${esc(s.hs)}</span>` : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p class="lead">No suppliers resolved in the sampled history.</p>';

  // HS breakdown as bars
  const hsBody = p.hsBreakdown.length
    ? `<p class="lead">By HS code · share of the sampled shipments</p>${barRows(
        p.hsBreakdown.map((h) => ({ label: `${h.hs} · ${h.chapter}`, value: h.n })),
      )}`
    : '<p class="lead">No HS codes on the sampled bills.</p>';

  // origins
  const originBody = p.origins.length
    ? barRows(p.origins.map((o) => ({ label: o.name, value: o.ships, flag: flag(o.cc) })))
    : '<p class="lead">No origin countries in the sample.</p>';

  // relationships
  const relBody = p.suppliers.length
    ? `<p class="lead">Every shared supplier is a look-alike lead — importers you can pitch the same route.</p>
       <div class="impp-rel">${p.suppliers
         .slice(0, 4)
         .map(
           (s) => `<div class="impp-relc"><div class="rn">${flag(s.country)} ${esc(s.name)}</div><div class="rd">Ships ${esc(s.product || 'goods')} from ${esc(countryName(s.country))} — a shared-supplier lane to prospect.</div></div>`,
         )
         .join('')}</div>`
    : '<p class="lead">No supplier relationships to show yet.</p>';

  // carriers + containers (two-col)
  const carrierBody = `<div class="impp-two">
    ${listBlock('Top carriers (SCAC)', p.carriers.map((c) => ({ label: c.scac, n: c.n })))}
    ${listBlock('Top container types', p.containers.map((c) => ({ label: c.type, n: c.n })))}
  </div>`;

  // ports + notify (two-col)
  const portsBody = `<div class="impp-two">
    ${listBlock('Top ports shipped from', p.portsFrom.map((pt) => ({ label: `${flag(pt.cc)} ${pt.port}`.trim(), n: pt.n })))}
    ${listBlock('Top notify parties', p.notifyParties.map((np) => ({ label: np.name, n: np.n })))}
  </div>`;

  // recent shipments
  const recentBody = p.recent.length
    ? `<div class="impp-tbl-wrap"><table class="impp-tbl">
      <thead><tr><th>Date</th><th>Bill of lading</th><th>Supplier</th><th>Weight</th><th>Qty</th><th>Cntrs</th><th>Description</th></tr></thead>
      <tbody>${p.recent
        .map(
          (r) => `<tr><td class="impp-num">${esc(r.date)}</td><td><span class="impp-hschip">${esc(r.bol)}</span></td><td><span class="impp-supn">${flag(r.country)} ${esc(r.supplier)}</span></td><td class="impp-num">${r.weight == null ? '—' : N(r.weight) + ' kg'}</td><td class="impp-num">${r.qty == null ? '—' : N(r.qty) + (r.unit ? ' ' + esc(r.unit) : '')}</td><td class="impp-num">${r.containers == null ? '—' : N(r.containers)}</td><td>${esc(r.product || '—')}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p class="lead">No recent shipments in the sample.</p>';

  // contact lock (separately locked, paid unlock — regardless of quota)
  const contactBody = `
    <p class="lead">Decision-maker contacts are a paid unlock — the importer, lane and volumes above stay free.</p>
    <div class="impp-lockcard">
      <span class="ico" aria-hidden="true" style="font-size:22px">\u{1F512}</span>
      <div class="lk">
        <div class="lt"><span class="blur">Jennifer&nbsp;Harmon</span> · Logistics Director</div>
        <div class="ls">Verified decision-maker email + an AI-drafted opener on this exact lane, hidden until unlocked.</div>
      </div>
      <a class="btn btn-primary" href="/signup">Unlock contact <span class="arr">&rarr;</span></a>
    </div>`;

  const secs: Array<SecDef> = [
    { id: 'overview', label: 'Overview', sub: 'headline stats + AI brief', body: statStrip(p) + brief + sampleNote },
    { id: 'chart', label: 'Shipments over time', sub: 'monthly bill-of-lading count', body: chartSvg(p.months) },
    { id: 'suppliers', label: 'Suppliers', body: supBody },
    { id: 'products', label: 'Product breakdown', body: hsBody },
    { id: 'origins', label: 'Imports by origin country', body: originBody },
    { id: 'relationships', label: 'Top supplier relationships', body: relBody },
    { id: 'carriers', label: 'Carriers & containers', body: carrierBody },
    { id: 'ports', label: 'Ports & notify parties', body: portsBody },
    { id: 'recent', label: 'Most recent sea shipments', body: recentBody },
    { id: 'contact', label: 'Decision-maker contacts', sub: 'paid unlock', body: contactBody },
  ];

  const dots = `
  <nav class="impp-dots" aria-label="Jump to section">
    <ul>${secs
      .map((s) => `<li><a href="#sec-${esc(s.id)}" data-dot="${esc(s.id)}"><span class="impp-dot"></span><span class="impp-dotl">${esc(s.label)}</span></a></li>`)
      .join('')}</ul>
  </nav>`;

  const remainingNote =
    quota.remaining > 0
      ? `<p class="impp-samplenote">You have <b>${quota.remaining}</b> free importer profile${quota.remaining === 1 ? '' : 's'} left. <a href="/signup">Subscribe</a> for unlimited opens.</p>`
      : `<p class="impp-samplenote">This was your last free importer profile. <a href="/signup">Subscribe</a> to keep opening more — searching stays free.</p>`;

  const body = `
  <style>${PROFILE_CSS}</style>
  ${dots}
  <main class="impp-wrap">
    <div class="container-narrow">
      <a class="impp-back" href="/importers">&larr; Back to importer search</a>
      ${identityHeader(p, { showActions: true })}
      ${remainingNote}
      ${secs.map((s, i) => section(s, i === 0)).join('')}
    </div>
  </main>
  <script>${PROFILE_JS}</script>`;

  return layout({
    title: `${p.company} — US Importer Profile | QuoteFleet`,
    description: `${p.company} import activity from US customs data: ${N(p.totalShipments)} total sea shipments, suppliers, HS codes, origin countries and recent bills of lading. Free to browse on QuoteFleet.`,
    canonicalPath: `/importers/company/${p.slug}`,
    bodyHtml: body,
    jsonLd: [
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: p.company,
        url: `${SITE}/importers/company/${p.slug}`,
        ...(p.address ? { address: p.address } : {}),
      }),
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Importer Search', item: `${SITE}/importers` },
          { '@type': 'ListItem', position: 3, name: p.company, item: `${SITE}/importers/company/${p.slug}` },
        ],
      }),
    ],
  });
}

// ── the subscribe wall (over quota) ──────────────────────────────────────────
export function renderProfileWall(p: ProfileData, quota: QuotaState): string {
  const teaser = p.sampleSize
    ? `<div class="impp-teaserstats">${statStrip(p)}</div>`
    : '';
  const body = `
  <style>${PROFILE_CSS}</style>
  <main class="impp-wrap">
    <div class="container-narrow">
      <a class="impp-back" href="/importers">&larr; Back to importer search</a>
      ${identityHeader(p, { showActions: false })}
      ${teaser}
      <div class="impp-wall">
        <h2>Subscribe to open more importer profiles</h2>
        <p>${esc(DETAIL_WALL_MESSAGE)}</p>
        <div class="impp-wall-actions">
          <a class="btn btn-primary" href="/signup">Subscribe to unlock <span class="arr">&rarr;</span></a>
          <a class="impp-btn-o" href="/importers">Keep searching — free</a>
        </div>
        <p class="sub">You've opened your ${FREE_DETAIL_QUOTA} free importer profiles. Searching importers stays free and unlimited.</p>
      </div>
    </div>
  </main>`;
  return layout({
    title: `${p.company} — US Importer Profile | QuoteFleet`,
    description: `Open ${p.company}'s full importer profile on QuoteFleet — suppliers, volumes, HS codes and recent bills of lading from US customs data.`,
    canonicalPath: `/importers/company/${p.slug}`,
    bodyHtml: body,
  });
}

/** A clean "temporarily unavailable / not configured" page (never a 500). */
function renderProfileUnavailable(slug: string, configured: boolean): string {
  const name = titleFromSlug(slug);
  const body = `
  <style>${PROFILE_CSS}</style>
  <main class="impp-wrap"><div class="container-narrow">
    <a class="impp-back" href="/importers">&larr; Back to importer search</a>
    <div class="impp-head"><div class="impp-title"><h1>${esc(name)}</h1></div></div>
    <div class="impp-wall">
      <h2>${configured ? 'Profile temporarily unavailable' : 'Importer profiles are coming soon'}</h2>
      <p>${configured
        ? 'We could not load this importer&rsquo;s customs history right now. Please try again shortly.'
        : 'Importer profiles are not switched on in this environment yet. Searching importers still works.'}</p>
      <div class="impp-wall-actions"><a class="impp-btn-o" href="/importers">Back to importer search</a></div>
    </div>
  </div></main>`;
  return layout({
    title: `${name} — Importer Profile | QuoteFleet`,
    description: 'Importer profile on QuoteFleet.',
    canonicalPath: `/importers/company/${slug}`,
    bodyHtml: body,
  });
}

// ── client JS (fold/unfold + dot scroll-spy + chart tooltip) ─────────────────
const PROFILE_JS = `
(function(){
  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){}

  // (4) fold / unfold — only the first section is open on load.
  function toggleSection(sec, open){
    var want = (open===undefined) ? !sec.classList.contains('open') : open;
    sec.classList.toggle('open', want);
    var btn = sec.querySelector('.impp-sech');
    if(btn) btn.setAttribute('aria-expanded', want ? 'true' : 'false');
    return want;
  }
  var sechs = document.querySelectorAll('.impp-sech');
  for(var i=0;i<sechs.length;i++){
    (function(btn){
      btn.addEventListener('click', function(){ toggleSection(btn.parentNode); });
    })(sechs[i]);
  }

  // (3) left dot pane — scroll-spy + click-to-open.
  var secs = [].slice.call(document.querySelectorAll('.impp-sec'));
  var dots = [].slice.call(document.querySelectorAll('.impp-dots a'));
  function setActive(id){ for(var j=0;j<dots.length;j++){ dots[j].classList.toggle('active', dots[j].getAttribute('data-dot')===id); } }

  for(var d=0; d<dots.length; d++){
    (function(a){
      a.addEventListener('click', function(ev){
        ev.preventDefault();
        var id = a.getAttribute('data-dot');
        var sec = document.getElementById('sec-'+id);
        if(!sec) return;
        toggleSection(sec, true);            // auto-unfold the target section
        setActive(id);
        try { sec.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block:'start'}); }
        catch(e){ sec.scrollIntoView(); }
      });
    })(dots[d]);
  }

  if('IntersectionObserver' in window && secs.length){
    var vis = {};
    var io = new IntersectionObserver(function(entries){
      for(var k=0;k<entries.length;k++){
        var e=entries[k]; vis[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0;
      }
      var best=null, bestV=-1;
      for(var s=0;s<secs.length;s++){ var v=vis[secs[s].id]||0; if(v>bestV){ bestV=v; best=secs[s]; } }
      if(best && bestV>0) setActive(best.getAttribute('data-sec'));
    }, {threshold:[0,0.15,0.4,0.75,1], rootMargin:'-8% 0px -55% 0px'});
    for(var o=0;o<secs.length;o++) io.observe(secs[o]);
    if(secs[0]) setActive(secs[0].getAttribute('data-sec'));
  }

  // (2) shipments-over-time hover tooltip.
  var chart = document.getElementById('impp-chart');
  var wrap = chart && chart.closest('.impp-chartwrap');
  var tip = document.getElementById('impp-chart-tip');
  if(chart && wrap && tip){
    var tv = tip.querySelector('.tv'), tc = tip.querySelector('.tc');
    function place(clientX){
      var r = wrap.getBoundingClientRect();
      var x = clientX - r.left;
      x = Math.max(46, Math.min(r.width-46, x));
      tip.style.left = x + 'px';
    }
    chart.addEventListener('mouseover', function(ev){
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-bar]') : null;
      if(!b) return;
      if(tv) tv.textContent = b.getAttribute('data-count');
      if(tc) tc.textContent = b.getAttribute('data-label');
      tip.hidden = false;
    });
    chart.addEventListener('mousemove', function(ev){
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-bar]') : null;
      if(!b){ return; }
      place(ev.clientX);
    });
    chart.addEventListener('mouseout', function(ev){
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-bar]') : null;
      if(b) tip.hidden = true;
    });
  }
})();
`.trim();

// ── route handler ────────────────────────────────────────────────────────────
export async function handleImporterProfile(
  req: Request,
  res: Response,
  deps: { bolCache?: BolCacheStore } = {},
): Promise<void> {
  const slug = sanitizeSlug((req.params as Record<string, unknown>)?.slug);
  if (!slug) {
    res.redirect(302, '/importers');
    return;
  }
  const bolCache = deps.bolCache ?? dbBolCacheStore;
  const quota = checkDetailQuota(req);

  try {
    // Over quota → NEVER spend a credit. Use a cached teaser if we already have
    // one (free), else a name-only teaser. The detail stays behind the wall.
    if (!quota.allowed) {
      const fetched = await getProfileRows(slug, { bolCache, allowLivePull: false });
      const teaser = fetched.rows && fetched.rows.length ? aggregateProfile(fetched.rows, slug) : minimalTeaser(slug);
      res.type('html').send(renderProfileWall(teaser, quota));
      return;
    }

    // Allowed → serve the full detail (cache-first; live pull only on a miss).
    const fetched = await getProfileRows(slug, { bolCache, allowLivePull: true });
    if (!fetched.rows) {
      res.status(503).type('html').send(renderProfileUnavailable(slug, false));
      return;
    }
    const profile = aggregateProfile(fetched.rows, slug);
    // Count this detailed open (bumps the visitor cookie + per-IP backstop).
    const after = recordDetailOpen(req, res);
    res.type('html').send(renderImporterProfilePage(profile, after));
  } catch (err) {
    const msg = (err as Error)?.message || 'unknown error';
    const missingKey = /API_KEY not set/i.test(msg);
    console.warn('[importers.profile] failed:', msg);
    res.status(missingKey ? 503 : 502).type('html').send(renderProfileUnavailable(slug, !missingKey));
  }
}

export function registerImporterProfileRoutes(app: Express): void {
  app.get('/importers/company/:slug', (req: Request, res: Response) => handleImporterProfile(req, res));
}
