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
import { US_STATES } from './usStates.js';
import {
  pullImportBols,
  normalizePortName,
  CONTACT_TIER_COPY,
  TIER_ORDER,
  type BolRow,
} from './importerLeads.js';
import { quoteLaneHref } from './entryPortFacets.js';
import { CACHE_ONLY_NOTE } from './externalPullGuard.js';
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
import { activeRedactionKeys, isKeyRedacted } from './manifestRedactions.js';
import { directoryIdentity } from './entitlement.js';
import {
  leadsIdentity,
  FREE_REVEAL_TASTE,
  LEADS_PRO_MONTHLY_ALLOWANCE,
  LEADS_PRO_PRICE_USD,
  leadsProPurchasable,
} from './leadsEntitlement.js';
import { dbLeadsRevealMeter, revealBucket, leadsAccountKey } from './leadsRevealUsage.js';

const SITE = 'https://quotefleet.net';

/** Read a positive integer from the environment, else fall back. */
const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
/** Rows per ImportYeti page for a profile pull. */
export const PROFILE_PAGE_SIZE = envInt('IMPORTER_PROFILE_PAGE_SIZE', 50);
/** Hard cap on pages pulled per profile (cost guard). ~5 credits/page. Cut from 6
 *  to 2 to bound cost: ~10 credits (~$0.90) per UNIQUE company on first open, then
 *  the pull is cached 14 days (every later open of that company is $0) and gated
 *  behind the 3-free-profile quota. Raise IMPORTER_PROFILE_MAX_PAGES for a longer
 *  shipments-over-time chart at higher per-company cost once credits allow. */
export const PROFILE_MAX_PAGES = envInt('IMPORTER_PROFILE_MAX_PAGES', 2);

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

/** Every valid 2-letter US-state + ISO-country code (uppercase). */
const CODE_TOKENS = new Set<string>([
  ...US_STATES.map((s) => s.code.toUpperCase()),
  ...ISO_COUNTRIES.map((c) => c.code.toUpperCase()),
]);
/**
 * ImportYeti returns title-cased addresses, which lower-cases 2-letter state /
 * country codes ("Lakewood Ny 14750 Us", "Newark, Nj"). Re-upper-case ONLY those
 * standalone 2-letter tokens that are real state/country codes, leaving ordinary
 * words untouched. Used for the displayed address + entry-port strings.
 */
function fixCodeCasing(s: string): string {
  return str(s).replace(/\b[A-Za-z]{2}\b/g, (m) => (CODE_TOKENS.has(m.toUpperCase()) ? m.toUpperCase() : m));
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
  /** Count of DISTINCT company-name spellings seen across the sampled bills
   *  (ImportYeti's signature de-dup: the same importer files under many name
   *  variants). 1 (or 0) means no alternate names were seen. */
  aliasesCount: number;
  /** Distinct alternate company-name spellings (excludes the primary display
   *  name), most-frequent first, capped for display. */
  otherNames: string[];
  /** Distinct alternate addresses seen on the sampled bills (excludes the primary
   *  displayed address), most-frequent first, capped for display. */
  otherAddresses: string[];
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
  /** Sampled bills carrying ANY hs_code / supplier country — the denominator the
   *  bar sections are captioned with. `hsBreakdown` / `origins` are capped to the
   *  top few, so summing the visible rows would understate the sample and
   *  overstate every share. */
  hsTotal: number;
  originsTotal: number;
  /** Distinct HS codes / origin countries seen, before the top-N display cap. */
  hsCodeCount: number;
  originCount: number;
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

/**
 * Numeric day key (YYYYMMDD) for an ImportYeti MM/DD/YYYY (or ISO) date, used as
 * the `data-v` sort value on the recent-shipments Date column. Returns '' for an
 * unparseable date so the client sinks that row instead of ranking it as 0 —
 * "no date" is missing data, not the oldest shipment.
 */
export function dayKey(raw: string): string {
  const s = str(raw);
  if (!s) return '';
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: number, m: number, d: number;
  if (us) { m = Number(us[1]); d = Number(us[2]); y = Number(us[3]); }
  else if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
  else return '';
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31) || !(y >= 1990 && y <= 2100)) return '';
  return String(y * 10000 + m * 100 + d);
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
  // Alias de-dup: distinct company-name spellings + distinct addresses seen on
  // the sampled bills (ImportYeti's signature "also known as / other addresses").
  const nameMap = new Map<string, { name: string; n: number }>();
  const addrMap = new Map<string, { addr: string; n: number }>();
  let entryPort: string | null = null;

  for (const r of rows) {
    const rawName = str(r.company_name) || str(r.company_basename);
    if (rawName) {
      const nk = rawName.toLowerCase().replace(/\s+/g, ' ').trim();
      const curN = nameMap.get(nk);
      if (curN) curN.n += 1;
      else nameMap.set(nk, { name: rawName, n: 1 });
    }
    const rawAddr = fixCodeCasing(str(r.company_address));
    if (rawAddr) {
      const ak = rawAddr.toLowerCase().replace(/\s+/g, ' ').trim();
      const curA = addrMap.get(ak);
      if (curA) curA.n += 1;
      else addrMap.set(ak, { addr: rawAddr, n: 1 });
    }
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
    // Round 5 normalised the port at the LEADS boundary so the search card's
    // RFQ deep link stopped carrying "Savannah, Ga."; the profile aggregates
    // raw rows on its own path and never got the same treatment, so its
    // identically-labelled "Quote this lane" still emitted origin=Savannah,+GA.
    // fixCodeCasing only re-upper-cases the code — it leaves the abbreviating
    // period on — so normalize after it, not instead of it.
    if (!entryPort && str(r.entry_port)) entryPort = normalizePortName(fixCodeCasing(str(r.entry_port)));
  }

  const months = [...monthMap.values()].sort((a, b) => a.sort - b.sort).slice(-18).map((m) => ({ key: m.key, label: m.label, count: m.count }));
  const suppliers = topBy(supMap, (s) => s.ships, 10).map(([, s]) => s);
  const hsBreakdown = topBy(hsMap, (h) => h.n, 6).map(([, h]) => h);
  const origins = topBy(originMap, (o) => o.ships, 8).map(([, o]) => o);
  // Denominators for the bar sections: every sampled bill that carried the field,
  // NOT just the top-N rows that survive the display cap.
  const hsTotal = [...hsMap.values()].reduce((s, h) => s + h.n, 0);
  const originsTotal = [...originMap.values()].reduce((s, o) => s + o.ships, 0);
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

  // Aliases: distinct name spellings + addresses. aliasesCount is the number of
  // distinct company-name spellings (incl. the primary). The "other" lists drop
  // the primary display name / address so the UI shows genuine alternates only.
  const primaryNameKey = company.toLowerCase().replace(/\s+/g, ' ').trim();
  const primaryAddrKey = fixCodeCasing(str(first.company_address)).toLowerCase().replace(/\s+/g, ' ').trim();
  const aliasesCount = nameMap.size;
  const otherNames = topBy(nameMap, (v) => v.n, 12)
    .map(([k, v]) => (k === primaryNameKey ? null : v.name))
    .filter((s): s is string => !!s)
    .slice(0, 8);
  const otherAddresses = topBy(addrMap, (v) => v.n, 12)
    .map(([k, v]) => (k === primaryAddrKey ? null : v.addr))
    .filter((s): s is string => !!s)
    .slice(0, 8);

  return {
    slug,
    company,
    address: fixCodeCasing(str(first.company_address)) || null,
    phoneMasked: maskPhone(str(first.company_main_phone_number)),
    website: str(first.company_website) || null,
    countryCode: str(first.company_country_code).toUpperCase() || 'US',
    entryPort,
    incumbent,
    aliasesCount,
    otherNames,
    otherAddresses,
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
    hsTotal,
    originsTotal,
    hsCodeCount: hsMap.size,
    originCount: originMap.size,
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
    countryCode: 'US', entryPort: null, incumbent: null, aliasesCount: 0, otherNames: [], otherAddresses: [],
    totalShipments: null, ships12m: null, teu12m: null, avgTeu: null, estSpend: null,
    firstShipment: null, months: [], suppliers: [], hsBreakdown: [], origins: [],
    hsTotal: 0, originsTotal: 0, hsCodeCount: 0, originCount: 0,
    carriers: [], containers: [], portsFrom: [], notifyParties: [], recent: [], sampleSize: 0,
  };
}

// ── data pull (multi-page, cache-first) ──────────────────────────────────────
/** Profile cache key — scoped so it never collides with a search-page key. */
export function profileCacheKey(slug: string): string {
  return searchKey({ importerProfile: slug, v: '1', ps: PROFILE_PAGE_SIZE, mp: PROFILE_MAX_PAGES });
}

/** Live multi-page pull of ONE company's history, bounded by PROFILE_MAX_PAGES;
 *  stops early when a page returns fewer than a full page (end of history).
 *  `blocked` is TRUE when the HARD COST GUARD refused the call — no socket was
 *  opened and no credit spent. */
async function pullCompanyHistory(
  slug: string,
): Promise<{ rows: BolRow[]; creditsRemaining: number | null; blocked: boolean }> {
  const all: BolRow[] = [];
  let creditsRemaining: number | null = null;
  for (let page = 1; page <= PROFILE_MAX_PAGES; page++) {
    const pulled = await pullImportBols({}, { companySlug: slug, pageSize: PROFILE_PAGE_SIZE, page, bolType: 'H' });
    // Guard refused on page 1 → nothing to serve. Refused mid-way is impossible
    // (the decision is per-process, not per-call), but stop safely either way.
    if (pulled.blocked) return { rows: all, creditsRemaining, blocked: all.length === 0 };
    const rows = pulled.rows || [];
    if (pulled.creditsRemaining != null) creditsRemaining = pulled.creditsRemaining;
    all.push(...rows);
    if (rows.length < PROFILE_PAGE_SIZE) break;
  }
  return { rows: all, creditsRemaining, blocked: false };
}

export interface ProfileFetch {
  rows: BolRow[] | null;
  cached: boolean;
  pulledLive: boolean;
  /** True when the cost guard refused the live pull on a cache MISS — the page
   *  must render its designed "unavailable" state, never a fabricated profile. */
  liveBlocked?: boolean;
}
/** Cache-first fetch. When `allowLivePull` is false a cache MISS returns rows:null
 *  (no credit spent) so a walled visitor never triggers a pull. The HARD COST
 *  GUARD produces the same rows:null shape (plus `liveBlocked`) outside prod. */
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
  // Blocked by the cost guard → cache MISS with nothing to show. Do NOT write the
  // empty result back: that would poison the licensed 14-day cache with a fake
  // "this company has no history".
  if (pulled.blocked) return { rows: null, cached: false, pulledLive: false, liveBlocked: true };
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
/* A dense customs-data profile needs a wider canvas than the shared 780px
   narrow container: tables, the chart and the 5-up stat strip all fight for
   room otherwise. */
.impp-wrap .container-narrow{max-width:1120px}
.impp-back{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;margin:8px 0 4px;text-decoration:none;border-radius:4px}
.impp-back:hover{color:var(--accent)}
.impp-back:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

/* identity header */
.impp-head{padding:10px 0 4px}
.impp-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.impp-title h1{font-size:30px;line-height:1.12;margin:0;color:var(--ink);letter-spacing:-.02em}
.impp-flag{font-size:20px;line-height:1}
.impp-pill{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:4px;background:var(--surface-3,var(--surface-2));color:var(--ink-soft);border:1px solid var(--border-strong)}
.impp-head-act{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
/* This page's body carries no qf-* class, so the shared .btn-primary fell back
   to the ink-filled treatment — a near-white slab in dark theme, sitting on a
   profile whose OTHER filled CTA (.impp-privacy-cta) is accent. Same override
   the search page already applies to its primary, so "Quote this lane" reads as
   the same control across both importer surfaces. */
.impp-head-act .btn-primary{background:var(--accent-fill);border-color:var(--accent-fill);color:#fff;box-shadow:none}
.impp-head-act .btn-primary .arr{color:#fff}
.impp-head-act .btn-primary:hover{background:var(--accent-strong,var(--accent-fill));border-color:var(--accent-strong,var(--accent-fill))}
.impp-save{display:inline-flex;align-items:center;gap:7px;font-family:var(--font-sans);font-size:13px;font-weight:600;color:var(--ink-soft);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:9px 14px;min-height:44px;cursor:pointer}
.impp-save:hover{border-color:var(--accent);color:var(--ink)}
.impp-save .star{font-size:15px;line-height:1;color:var(--muted)}
.impp-save.saved{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
.impp-save.saved .star{color:var(--accent)}
.impp-save[disabled]{opacity:.6;cursor:default}
/* honest "coming soon" contact reveal chip (no fulfillment wired yet) */
.impp-soon{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--ink-soft);border:1px dashed var(--border-strong);border-radius:8px;padding:9px 14px;background:var(--surface-2)}
.impp-soon .ico{opacity:.7}
.impp-soon .tag{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 7px}
.impp-meta{display:flex;gap:6px 8px;flex-wrap:wrap;color:var(--muted);font-size:12.5px;margin:14px 0 2px}
.impp-meta .mi{display:inline-flex;align-items:center;gap:7px;background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:5px 12px;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.impp-privacy{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;margin:14px 0 2px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.impp-privacy-t{font-size:13px;font-weight:700;color:var(--ink)}
.impp-privacy-d{font-size:12.5px;color:var(--muted);flex:1 1 260px;min-width:0}
.impp-privacy-cta{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;text-decoration:none;background:var(--accent);color:var(--bg);min-height:44px;box-sizing:border-box}
.impp-privacy-cta .arr{transition:transform .15s ease}
.impp-privacy-cta:hover .arr{transform:translateX(3px)}
.impp-samplenote{color:var(--muted);font-size:12px;margin:10px 0 0}
.impp-samplenote b{color:var(--ink-soft)}

/* stat strip — icon-left tiles. The label block is a fixed two-line height so
   every value sits on the SAME baseline across the strip (labels of different
   lengths used to shove the numbers up and down). */
.impp-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:20px 0 6px}
.impp-stat{display:flex;gap:11px;align-items:flex-start;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:14px 15px;box-shadow:var(--shadow-sm);min-width:0}
.impp-stat .si{flex:0 0 auto;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:9px;font-size:14px;line-height:1;background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 22%,transparent)}
.impp-stat .sb{min-width:0;flex:1 1 auto}
.impp-stat .sl{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;line-height:13px;height:26px;overflow:hidden}
.impp-stat .sv{font-size:21px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;margin-top:4px;letter-spacing:-.018em;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.impp-stat .sx{font-size:10.5px;color:var(--muted);margin-top:3px}
@media(max-width:1000px){.impp-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:620px){.impp-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .impp-stat{padding:12px 13px;gap:9px}.impp-stat .si{width:26px;height:26px;font-size:12px}.impp-stat .sv{font-size:18px}
  /* 5 tiles in a 2-up grid leaves the last one orphaned at half width — where
     "~$49.2M" also got clipped. Let it span the row instead. */
  .impp-stat:last-child{grid-column:1 / -1}}

/* AI opportunity brief */
.impp-brief{border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--accent) 7%,transparent);padding:18px 20px;margin:18px 0 6px}
.impp-brief-h{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:800;color:var(--ink);margin-bottom:12px;flex-wrap:wrap}
.impp-brief-h .tag{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:var(--accent);color:var(--bg);padding:3px 9px;border-radius:5px}
.impp-brief ul{margin:0;padding:0;list-style:none;display:grid;gap:9px}
.impp-brief li{position:relative;padding-left:20px;font-size:13.5px;color:var(--ink-soft);line-height:1.5}
.impp-brief li::before{content:"";position:absolute;left:3px;top:8px;width:7px;height:7px;border-radius:50%;background:var(--accent)}
.impp-brief li b{color:var(--ink)}

/* section fold/unfold */
.impp-sec{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);margin:12px 0;box-shadow:var(--shadow-sm);overflow:hidden;scroll-margin-top:72px;transition:border-color .16s ease}
.impp-sec:hover{border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}
.impp-sech{width:100%;display:flex;align-items:center;gap:10px;background:none;border:0;cursor:pointer;padding:15px 18px;text-align:left;font-family:var(--font-sans);color:var(--ink);min-height:54px;transition:background .14s}
.impp-sech:hover{background:var(--surface-2)}
.impp-sech:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.impp-sech .impp-sect{font-size:15.5px;font-weight:700;color:var(--ink);letter-spacing:-.012em}
.impp-sech .impp-secs{font-size:11.5px;font-weight:600;color:var(--muted);background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:2px 9px;font-variant-numeric:tabular-nums}
.impp-sech:hover .impp-secs{border-color:var(--border-strong)}
.impp-caret{margin-left:auto;flex:0 0 auto;width:16px;height:16px;color:var(--muted);transition:transform .18s ease}
.impp-sec.open .impp-caret{transform:rotate(180deg)}
.impp-sec.open .impp-sech{border-bottom:1px solid var(--border)}
.impp-secb{padding:0 18px 18px;display:none}
.impp-sec.open .impp-secb{display:block;padding-top:16px}
.impp-secb .lead{color:var(--muted);font-size:12.5px;margin:0 0 14px;line-height:1.55}

/* chart — gridlines + a real y-axis live in HTML (the SVG is stretched with
   preserveAspectRatio:none for full-bleed bars, which would distort any text or
   stroke drawn inside it). */
.impp-chartwrap{position:relative;border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:16px 18px 10px}
.impp-chart-grid{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 10px;align-items:stretch}
.impp-yaxis{display:flex;flex-direction:column;justify-content:space-between;font-size:10px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;height:200px;padding:0;line-height:1}
.impp-yaxis span{transform:translateY(-.35em)}
.impp-yaxis span:last-child{transform:translateY(.1em)}
.impp-plot{position:relative;height:200px}
/* horizontal gridlines at 0 / 25 / 50 / 75 / 100% of the max */
.impp-plot::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:repeating-linear-gradient(to bottom,var(--border) 0 1px,transparent 1px 25%)}
.impp-chart{display:block;width:100%;height:200px;overflow:visible;position:relative}
.impp-chart rect.bar{fill:color-mix(in srgb,var(--accent) 68%,transparent);transition:fill .12s}
.impp-chart rect.bar:hover,.impp-chart rect.bar.on{fill:var(--accent)}
/* The SVG is preserveAspectRatio="none", so a stroked outline would be scaled
   unevenly with the bar. Focus is shown by filling the bar and ringing it in
   the page background colour instead, which stays true at any width. */
.impp-chart rect.bar:focus{outline:none}
.impp-chart rect.bar:focus-visible{fill:var(--accent);stroke:var(--bg);stroke-width:2;paint-order:stroke}
.impp-chart-hint{font-size:11px;color:var(--muted);margin:6px 0 0;padding-left:34px}
/* the latest month is the one a broker acts on — call it out */
.impp-chart rect.bar.last{fill:var(--accent)}
.impp-chart .axis{stroke:var(--border-strong);stroke-width:1}
/* One slot per month, so a tick label is centred under its OWN bar (see the
   xLabels comment in chartSvg). Empty slots let a label overflow its neighbours
   rather than being clipped. */
.impp-xaxis{display:flex;color:var(--muted);font-size:10.5px;font-weight:600;margin:8px 0 0 0;padding-left:34px}
.impp-xaxis span{flex:1 1 0;min-width:0;text-align:center;white-space:nowrap}
/* A short series stretched to full bleed produced ~280px slabs at 1440, which
   said nothing about seasonality. Cap the PLOT (bars, gridlines and labels all
   shrink together, so nothing drifts out of alignment); --impp-plot-cap is set
   server-side only when the series is short. */
.impp-plot,.impp-xaxis{max-width:var(--impp-plot-cap,none)}
.impp-xaxis{max-width:calc(var(--impp-plot-cap,100%) + 34px)}
.impp-chart-cap{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
.impp-chart-cap b{color:var(--ink);font-variant-numeric:tabular-nums}
/* Trend chip — a tinted pill, not a filled one, so it reads as a caption fact
   rather than a fourth action. Token colours only; both pass AA in both themes. */
.impp-delta{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 9px;
  border:1px solid color-mix(in srgb,var(--muted) 34%,transparent);background:var(--surface-2)}
.impp-delta b{font-weight:700;color:inherit}
/* Raw --success as text is 3.77:1 on white in LIGHT theme — below AA before the
   12% tint is even applied. Mixed toward --ink, the same correction .imp-win
   carries. --warn already clears AA raw (5.02:1), so it is left alone. */
.impp-delta.up{color:color-mix(in srgb,var(--success) 62%,var(--ink));border-color:color-mix(in srgb,var(--success) 34%,transparent);background:color-mix(in srgb,var(--success) 12%,transparent)}
.impp-delta.down{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 34%,transparent);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.impp-delta.flat{color:var(--muted)}
.impp-tip{position:absolute;top:6px;left:0;transform:translateX(-50%);background:var(--ink);color:var(--bg);font-size:12px;font-weight:700;padding:7px 11px;border-radius:8px;pointer-events:none;white-space:nowrap;box-shadow:var(--shadow-md);z-index:5;line-height:1.35;text-align:center}
.impp-tip[hidden]{display:none}
.impp-tip .tv{display:block;font-size:10.5px;font-weight:600;opacity:.72;letter-spacing:.03em;text-transform:uppercase}
.impp-tip .tc{display:block;font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
@media(max-width:560px){.impp-chartwrap{padding:12px 12px 8px}.impp-yaxis,.impp-plot,.impp-chart{height:160px}.impp-xaxis{padding-left:28px}}

/* tables — scannable rows: subtle zebra, hover highlight, right-aligned
   tabular numerics, and a sticky header inside the horizontal scroll box. */
.impp-tbl-wrap{overflow-x:auto;overflow-y:auto;max-height:520px;border:1px solid var(--border);border-radius:12px;-webkit-overflow-scrolling:touch}
/* Scroll affordance: a wide table cut by the viewport needs to say so. */
.impp-scrollnote{display:none;font-size:11.5px;color:var(--muted);margin:8px 0 0}
@media(max-width:760px){.impp-scrollnote{display:block}}
.impp-tbl{border-collapse:separate;border-spacing:0;width:100%;min-width:560px;font-size:13px}
.impp-tbl thead th{position:sticky;top:0;z-index:2;background:var(--surface-2);text-align:left;padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border-strong);white-space:nowrap}
.impp-tbl thead th.impp-num,.impp-tbl tbody td.impp-num{text-align:right}
.impp-tbl tbody td{padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:middle;color:var(--ink-soft);max-width:340px;overflow:hidden;text-overflow:ellipsis}
.impp-tbl tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--surface-2) 45%,transparent)}
.impp-tbl tbody tr:hover td{background:color-mix(in srgb,var(--accent) 7%,transparent)}
.impp-tbl tbody tr:last-child td{border-bottom:0}
/* ── sortable columns (R4) ──
   The two real tables (suppliers, recent bills) arrived in ONE fixed order and
   could not be re-read any other way — you could not ask "which of these bills
   was the heaviest" without reading all twelve. A real <button> inside the <th>
   keeps the header keyboard-reachable and announced as a control; aria-sort on
   the <th> carries the state for assistive tech. The arrow is its own span so
   the label never shifts when the direction flips. */
.impp-tbl thead th[data-sort]{padding:0}
.impp-sortbtn{display:flex;align-items:center;gap:5px;width:100%;
  font-family:var(--font-sans);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  color:var(--muted);background:none;border:0;padding:10px 14px;min-height:38px;cursor:pointer;text-align:left;
  white-space:nowrap;transition:color .14s,background .14s}
.impp-tbl thead th.impp-num .impp-sortbtn{justify-content:flex-end}
.impp-sortbtn:hover{color:var(--ink);background:color-mix(in srgb,var(--accent) 8%,transparent)}
.impp-sortbtn:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.impp-sortar{font-size:8px;line-height:1;opacity:.35;flex:0 0 auto}
.impp-tbl thead th[aria-sort="ascending"] .impp-sortbtn,
.impp-tbl thead th[aria-sort="descending"] .impp-sortbtn{color:var(--accent)}
.impp-tbl thead th[aria-sort="ascending"] .impp-sortar,
.impp-tbl thead th[aria-sort="descending"] .impp-sortar{opacity:1}
/* Copy on the revealed contact (R4). The reveal is the paid payoff and copying
   the address is the literal next action — select-and-drag across a
   word-break:break-all email is a poor substitute. */
.impp-copy{font-family:var(--font-sans);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--muted);background:var(--surface);border:1px solid var(--border-strong);border-radius:5px;
  padding:3px 7px;cursor:pointer;flex:0 0 auto;transition:color .14s,border-color .14s}
.impp-copy:hover{color:var(--accent);border-color:var(--accent)}
.impp-copy:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.impp-copy.done{color:color-mix(in srgb,var(--success) 62%,var(--ink));border-color:var(--success)}
.impp-supn{font-weight:700;color:var(--ink)}
/* Accent on its own 12% tint is 4.38:1 in DARK — mixed toward --ink like .imp-chip. */
.impp-hschip{font-family:var(--font-mono);font-size:11px;color:color-mix(in srgb,var(--accent) 82%,var(--ink));background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:4px;padding:1px 6px;display:inline-block;white-space:nowrap}
.impp-num{font-variant-numeric:tabular-nums}

/* bars (volume / origin) */
.impp-bars{display:flex;flex-direction:column;gap:4px}
.impp-brow{display:grid;grid-template-columns:220px minmax(0,1fr) 76px;align-items:center;gap:14px;padding:6px 8px;margin:0 -8px;border-radius:8px;transition:background .12s}
.impp-brow:hover{background:var(--surface-2)}
.impp-brow .bl{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);font-size:13px;min-width:0}
.impp-brow .bl span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.impp-brow .bt{height:10px;background:var(--surface-2);border-radius:999px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--border)}
.impp-brow .bt i{display:block;height:100%;background:var(--accent);border-radius:999px;min-width:3px}
.impp-brow:first-child .bt i{background:var(--accent)}
.impp-brow .bv{text-align:right;font-size:12.5px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
/* The share sits under the count so the row keeps ONE numeric column instead of
   widening into two — the count stays the primary figure. */
.impp-brow .bv .bp{display:block;font-size:11px;font-weight:600;color:var(--muted);line-height:1.35}
@media(max-width:640px){.impp-brow{grid-template-columns:132px minmax(0,1fr) 56px;gap:10px}}

/* two-column lists */
.impp-two{display:grid;grid-template-columns:1fr 1fr;gap:16px 24px}
@media(max-width:700px){.impp-two{grid-template-columns:1fr}}
.impp-list h4{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px;padding-bottom:8px;border-bottom:1px solid var(--border-strong)}
.impp-lrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px;margin:0 -8px;border-bottom:1px solid var(--border);font-size:13px;color:var(--ink-soft);border-radius:7px;transition:background .12s}
.impp-lrow:hover{background:var(--surface-2)}
.impp-lrow>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.impp-lrow:last-child{border-bottom:0}
.impp-lrow .lc{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}

/* relationships */
.impp-rel{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:700px){.impp-rel{grid-template-columns:1fr}}
.impp-relc{border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:var(--surface-2)}
.impp-relc .rn{font-weight:700;color:var(--ink);font-size:13px;display:flex;align-items:center;gap:7px}
.impp-relc .rd{font-size:12px;color:var(--muted);margin-top:5px}

/* contact lock */
.impp-lockcard{border:1px dashed var(--border-strong);border-radius:12px;background:var(--surface-2);padding:18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.impp-lockcard>.ico{flex:0 0 auto;width:42px;height:42px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 24%,transparent)}
.impp-lockcard .blur{filter:blur(5px);user-select:none;font-weight:700;color:var(--ink)}
.impp-lockcard .lk{flex:1 1 240px;min-width:0}
.impp-lockcard .lk .lt{font-weight:700;color:var(--ink);font-size:14px}
.impp-lockcard .lk .ls{font-size:12.5px;color:var(--muted);margin-top:5px;line-height:1.55}
.impp-reveal-act{margin-left:auto;display:flex;align-items:center}
@media(max-width:560px){.impp-reveal-act{margin-left:0;width:100%}.impp-reveal-act>*{width:100%;justify-content:center}}
.impp-revchip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;letter-spacing:.02em;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:999px;padding:2px 9px;margin-left:8px;vertical-align:middle}
.impp-revchip.out{color:var(--warn);background:color-mix(in srgb,var(--warn) 16%,transparent)}
/* revealed-contact result */
.impp-reveal-result{margin:12px 0 0}
.impp-reveal-result[hidden]{display:none}
.impp-rvc{border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);border-radius:12px;background:color-mix(in srgb,var(--accent) 6%,transparent);padding:16px 18px}
.impp-rvc-badge{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:5px;margin-bottom:10px}
.impp-rvc-badge.verified{background:var(--accent);color:var(--bg)}
.impp-rvc-badge.role_based{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.impp-rvc-badge.phone_only{background:var(--surface-2);color:var(--muted);border:1px solid var(--border)}
.impp-rvc-name{font-size:15px;font-weight:800;color:var(--ink)}
.impp-rvc-title{font-size:12.5px;color:var(--muted);margin-top:2px}
/* One plain line saying what the tier above actually hands over — the badge on
   its own reads as a grade, not a promise. Kept left-aligned with the badge. */
.impp-rvc-what{font-size:12.5px;line-height:1.5;color:var(--muted);margin:2px 0 10px;text-align:left}
.impp-rvc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--ink-soft);margin-top:8px}
.impp-rvc-row a{color:var(--accent);text-decoration:none;font-weight:600;word-break:break-all}
.impp-rvc-row a:hover{text-decoration:underline}
.impp-rvc-conf{font-size:11px;color:var(--muted)}
.impp-rvc-none{font-size:13px;color:var(--muted)}
.impp-rvc-err{font-size:13px;color:var(--warn)}

/* left dot shortcut pane — a hover-expanding scroll-spy rail */
.impp-dots{position:fixed;left:18px;top:50%;transform:translateY(-50%);z-index:30}
.impp-dots ul{list-style:none;margin:0;padding:10px 8px;display:flex;flex-direction:column;gap:2px;border:1px solid transparent;border-radius:14px;transition:background .16s,box-shadow .16s,border-color .16s,padding .16s}
.impp-dots a{display:flex;align-items:center;gap:12px;text-decoration:none;padding:6px;border-radius:9px}
.impp-dots a:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.impp-dot{width:8px;height:8px;border-radius:50%;background:var(--border-strong);flex:0 0 auto;transition:background .16s,transform .16s;box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 30%,transparent)}
.impp-dotl{font-size:12.5px;color:var(--muted);white-space:nowrap;opacity:0;max-width:0;overflow:hidden;transition:opacity .16s,max-width .16s}
.impp-dots:hover ul,.impp-dots:focus-within ul{background:var(--surface);box-shadow:var(--shadow-lg);border-color:var(--border);padding:10px 14px 10px 10px}
.impp-dots:hover .impp-dotl,.impp-dots:focus-within .impp-dotl{opacity:1;max-width:230px}
.impp-dots a:hover .impp-dot{background:var(--accent)}
.impp-dots a:hover .impp-dotl{color:var(--ink)}
.impp-dots a.active .impp-dot{background:var(--accent);transform:scale(1.45);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)}
.impp-dots a.active .impp-dotl{color:var(--ink);font-weight:700}
@media(max-width:1320px){.impp-dots{display:none}}

/* ── section bar: horizontal jump nav + expand-all (R3) ──
   Sticky, so the section list stays reachable anywhere down the page. The links
   are the same set the dot rail uses and share its click handler + scroll-spy
   (the JS keys off [data-dot], not the rail's class), so exactly one of the two
   navs is on screen at any width. */
/* Above 1320px the dot rail already handles navigation, so the bar carries only
   the expand/collapse control and must not draw a full-width rule with a lone
   button hanging off it. It becomes a real sticky nav strip only once the tabs
   appear (see the 1320px query below). */
/* Sticky, so it must read as chrome that sits ABOVE the page rather than a hole
   cut through it: painted with --bg it punched a page-coloured band straight
   across the surface-coloured section cards it scrolled over. An elevated
   surface + a blur behind it (and its existing border-bottom) reads as a bar. */
.impp-secbar{display:flex;align-items:center;gap:12px;margin:0 0 12px;padding:8px 12px;
  background:color-mix(in srgb,var(--surface) 86%,transparent);backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);border-radius:10px}
/* ── scroll affordance for the section strip (R4) ──
   Eleven sections do not fit a phone, and the strip's only cue that more
   existed was a tab clipped mid-word at the edge — which reads as a layout bug,
   not as "scroll me". The fade is a MASK on the scroller rather than a gradient
   overlay: a mask needs no knowledge of what is behind the strip, so it works in
   both themes and over the sticky bar's background without the grey banding a
   fade-to-transparent gradient produces. The chevron pips sit on the wrapper
   above it. Both keyed to the direction that can ACTUALLY scroll, so a strip that
   already fits shows neither. */
.impp-tabswrap{display:none;position:relative;min-width:0;flex:1 1 auto}
/* The chevrons sit ON the strip, and the edge mask only fades the tabs to ~0 by
   42px — so at 375, where the strip is ~233px wide, a glyph landed on top of a
   still-half-visible tab label. Backing each chevron with a small surface chip
   makes it unambiguously chrome rather than a character mixed into the labels. */
.impp-tabswrap::before,.impp-tabswrap::after{position:absolute;top:50%;transform:translateY(-50%);z-index:2;
  pointer-events:none;font-size:15px;font-weight:700;line-height:1;color:var(--accent);opacity:0;transition:opacity .18s ease;
  width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:7px;
  background:var(--surface-2);border:1px solid var(--border-strong);box-shadow:var(--shadow-sm)}
.impp-tabswrap::before{content:'\\2039';left:0}
.impp-tabswrap::after{content:'\\203A';right:0}
.impp-tabswrap[data-scroll="left"]::before,.impp-tabswrap[data-scroll="both"]::before{opacity:1}
.impp-tabswrap[data-scroll="right"]::after,.impp-tabswrap[data-scroll="both"]::after{opacity:1}
/* Fade width is deliberately fixed and the scroller's padding is NOT touched per
   state: changing padding on a scroll-driven state would resize scrollWidth
   mid-gesture and make the strip jump under the finger. */
.impp-tabswrap[data-scroll="right"] .impp-tabs{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 42px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 42px),transparent)}
.impp-tabswrap[data-scroll="left"] .impp-tabs{-webkit-mask-image:linear-gradient(90deg,transparent,#000 42px);mask-image:linear-gradient(90deg,transparent,#000 42px)}
.impp-tabswrap[data-scroll="both"] .impp-tabs{-webkit-mask-image:linear-gradient(90deg,transparent,#000 42px,#000 calc(100% - 42px),transparent);mask-image:linear-gradient(90deg,transparent,#000 42px,#000 calc(100% - 42px),transparent)}
.impp-tabs{display:flex;align-items:center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:thin;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity}
.impp-tabs a{flex:0 0 auto;font-size:12.5px;font-weight:600;color:var(--muted);text-decoration:none;
  padding:7px 10px;min-height:36px;display:inline-flex;align-items:center;border-radius:8px;white-space:nowrap;
  scroll-snap-align:start;transition:color .14s,background .14s}
.impp-tabs a:hover{color:var(--ink);background:var(--surface-2)}
.impp-tabs a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
/* active = tinted + outlined, never a bright fill */
.impp-tabs a.active{color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent)}
.impp-expand{flex:0 0 auto;margin-left:auto;font-family:var(--font-sans);font-size:12px;font-weight:600;
  color:var(--muted);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;
  padding:8px 12px;min-height:36px;cursor:pointer;transition:color .14s,border-color .14s}
.impp-expand:hover{color:var(--ink);border-color:var(--accent)}
.impp-expand:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.impp-expand[aria-pressed="true"]{color:var(--accent);border-color:var(--accent);
  background:color-mix(in srgb,var(--accent) 12%,transparent)}
@media(max-width:1320px){
  .impp-tabswrap{display:block}
  .impp-secbar{position:sticky;top:0;z-index:20;border-bottom:1px solid var(--border)}
}
@media (prefers-reduced-motion: reduce){
  .impp-tabs{scroll-snap-type:none}
  .impp-tabswrap::before,.impp-tabswrap::after{transition:none}
}
@media(max-width:620px){
  /* "Expand all" was taking 132px of a 327px bar, crushing nine section tabs
     into the remainder. Drop the second word — the control keeps its full
     accessible name via aria-label. */
  .impp-expand-x{display:none}
  /* The action pair wraps onto its own line inside .impp-title, where the
     header's margin-left:auto then shoved it to the right edge and left a ~55px
     hole on the left of a left-aligned header. Give it the full row instead. */
  .impp-head-act{margin-left:0;width:100%}
  .impp-head-act>*{flex:1 1 0;min-width:0;justify-content:center}
  /* Uppercase + letter-spacing widened these enough to wrap with an orphan
     ("TEU · LAST 12 / MO", "AVG TEU / / SHIPMENT"). Sentence case fits on one. */
  .impp-stat .sl{text-transform:none;letter-spacing:0;font-size:11px}
}
@media(max-width:560px){
  .impp-secbar{gap:8px;padding:8px 10px}
  .impp-expand{padding:8px 10px;min-height:44px}
  .impp-tabs a{min-height:44px}
}

/* subscribe / unavailable wall — a designed state, since the quota + credit
   paths are the ones visitors actually land on most. */
.impp-wall{position:relative;border:1px solid color-mix(in srgb,var(--accent) 32%,transparent);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--accent) 7%,transparent);padding:30px 26px;margin:20px 0;text-align:center}
.impp-wall .wico{width:52px;height:52px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;border-radius:15px;font-size:24px;line-height:1;background:var(--surface);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);box-shadow:var(--shadow-sm)}
.impp-wall h2{font-size:21px;color:var(--ink);margin:0 0 8px;letter-spacing:-.018em}
.impp-wall p{color:var(--ink-soft);font-size:14px;margin:0 auto 18px;max-width:520px;line-height:1.6}
.impp-wall .sub{color:var(--muted);font-size:12.5px;margin:16px auto 0}
.impp-wall-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
/* what's behind the wall, listed honestly */
.impp-wall-list{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;list-style:none;margin:0 0 18px;padding:0}
.impp-wall-list li{font-size:12px;font-weight:600;color:var(--ink-soft);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:5px 12px}
.impp-teaserstats{filter:blur(4px);pointer-events:none;user-select:none}
@media(max-width:520px){.impp-wall{padding:24px 18px}.impp-wall-actions>*{width:100%;justify-content:center}}

/* buttons reuse .btn/.btn-primary from style.css; add an outline variant */
.impp-btn-o{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border-strong);background:var(--surface);color:var(--ink-soft);border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;min-height:44px;box-sizing:border-box}
.impp-btn-o:hover{border-color:var(--accent);color:var(--ink)}

@media (prefers-reduced-motion: reduce){
  .impp-caret,.impp-dots ul,.impp-dot,.impp-dotl,.impp-chart rect.bar{transition:none}
}
`;

// ── render helpers ───────────────────────────────────────────────────────────
const CARET = '<svg class="impp-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

interface SecDef { id: string; label: string; sub?: string; body: string; open?: boolean; }

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
  // The gridlines are hard-locked to four bands (.impp-plot::before repeats at
  // 25%), so the y-axis always prints five ticks. Scaling those against a raw
  // peak of, say, 2 produced "2, 2, 1, 1, 0" — Math.round collapsing 1.5 and 0.5
  // onto their neighbours. Rounding the DOMAIN up to a multiple of four instead
  // makes every tick a distinct integer for any peak (2→4: 4,3,2,1,0;
  // 31→32: 32,24,16,8,0) and keeps the bars honest against the printed axis.
  const axisMax = Math.max(4, Math.ceil(max / 4) * 4);
  const n = months.length;
  const gap = n > 1 ? Math.max(2, Math.min(10, 320 / n)) : 4;
  const bw = (W - gap * (n - 1)) / n;
  // R3: bars are keyboard-reachable. A roving tabindex (only one bar in the tab
  // order; arrows walk the series) keeps an 18-month chart from costing 18 tab
  // stops to pass. Each bar carries its own aria-label so focusing it announces
  // the month and the count — previously the series was mouse-only and a
  // screen reader got a single "Monthly shipment counts" summary and nothing else.
  const bars = months
    .map((m, i) => {
      const h = Math.max(2, Math.round((m.count / axisMax) * (H - padB)));
      const x = i * (bw + gap);
      const y = H - h;
      const lbl = `${m.label}: ${N(m.count)} shipment${m.count === 1 ? '' : 's'}`;
      return `<rect class="bar${i === n - 1 ? ' last' : ''}" data-bar data-idx="${i}" data-label="${esc(m.label)}" data-count="${m.count}" tabindex="${i === 0 ? '0' : '-1'}" role="img" aria-label="${esc(lbl)}" x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}"><title>${esc(m.label)}: ${N(m.count)}</title></rect>`;
    })
    .join('');
  const first = months[0].label, last = months[n - 1].label;
  // R3: an 18-month series labelled with only first / middle / last made it
  // impossible to place any bar in time. Up to six evenly spaced ticks (always
  // including both ends) stay readable at 375px while actually locating a bar.
  const tickCount = Math.min(6, n);
  // R5: the labels used to be their own `justify-content:space-between` row, so
  // they spread evenly across the plot regardless of WHICH months they named —
  // with 7 months and 6 ticks the indices are 0,1,2,4,5,6, and every label after
  // the third sat under the wrong bar. Emit one slot PER MONTH instead (empty
  // unless it is a tick) so a label is always centred under its own bar, at any
  // series length. A labelled slot may overflow into its empty neighbours; that
  // is why only the ticks carry text.
  const tickIdx = new Set(
    n === 1
      ? [0]
      : Array.from({ length: tickCount }, (_, t) => Math.round((t * (n - 1)) / (tickCount - 1))),
  );
  const xLabels = months.map((m, i) => (tickIdx.has(i) ? m.label : ''));
  // y-axis ticks at 100 / 75 / 50 / 25 / 0 % of the ROUNDED domain (see axisMax)
  const ticks = [1, 0.75, 0.5, 0.25, 0]
    .map((f) => `<span>${N(Math.round(axisMax * f))}</span>`)
    .join('');
  const total = months.reduce((s, m) => s + m.count, 0);
  const peak = months.reduce((b, m) => (m.count > b.count ? m : b), months[0]);
  const avg = Math.round(total / n);
  // Direction — the one thing the caption lacked, and free from `months`.
  // 6+6, deliberately NOT 12+12: the window is capped at 18 months and the
  // underlying sample at ~100 bills, so the OLDEST months are themselves
  // sample-truncated. Two equally-truncated halves are the only fair read; a
  // 12+12 split would compare a full window against a truncated one. Below 12
  // months there is nothing honest to compare, so the chip is suppressed
  // entirely rather than shown with a misleading number.
  const delta = deltaChip(months);
  return `
  <div class="impp-chartwrap"${n < 13 ? ` style="--impp-plot-cap:${n * 54}px"` : ''}>
    <div class="impp-chart-grid">
      <div class="impp-yaxis" aria-hidden="true">${ticks}</div>
      <div class="impp-plot">
        <div class="impp-tip" id="impp-chart-tip" hidden><span class="tv"></span><span class="tc"></span></div>
        <svg class="impp-chart" id="impp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="group" aria-label="Monthly shipment counts, ${esc(first)} to ${esc(last)}. Use the arrow keys to step through the months.">
          <line class="axis" x1="0" y1="${H}" x2="${W}" y2="${H}"/>
          ${bars}
        </svg>
      </div>
    </div>
    <div class="impp-xaxis">${xLabels.map((l) => `<span>${l ? esc(l) : ''}</span>`).join('')}</div>
    ${n > 1 ? '<p class="impp-chart-hint">Hover or focus a bar for its month and count &mdash; arrow keys step through the series.</p>' : ''}
    <div class="impp-chart-cap">
      <span>Peak <b>${N(peak.count)}</b> in ${esc(peak.label)}</span>
      <span>Average <b>${N(avg)}</b> / month</span>
      <span>${N(n)} month${n === 1 ? '' : 's'} on file</span>
      ${delta}
    </div>
  </div>`;
}

/**
 * "Last 6 mo ▲ 14% vs prior 6" — trend direction for the shipment chart.
 * Exported for unit tests: the SIGN has to be provably right on a rising and a
 * falling series, since a wrong arrow would misread an account's momentum.
 *
 * Returns '' when there are fewer than 12 months (nothing fair to compare) or
 * when the prior half is empty (a percentage against zero is meaningless).
 */
export function deltaChip(months: readonly ProfileMonth[]): string {
  if (months.length < 12) return '';
  const sum = (a: readonly ProfileMonth[]) => a.reduce((s, m) => s + m.count, 0);
  const recent = sum(months.slice(-6));
  const prior = sum(months.slice(-12, -6));
  if (prior <= 0) return '';
  const pct = Math.round(((recent - prior) / prior) * 100);
  // Token colours only, and both pass AA on --surface in either theme.
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const arrow = pct > 0 ? '&#9650;' : pct < 0 ? '&#9660;' : '&#8212;';
  const word = pct > 0 ? 'up' : pct < 0 ? 'down' : 'level';
  const tip = `${N(recent)} shipments in the last 6 months vs ${N(prior)} in the 6 before that — ${word}${
    pct === 0 ? '' : ` ${Math.abs(pct)}%`
  }. Both halves come from the same sampled bill history.`;
  return `<span class="impp-delta ${cls}" title="${esc(tip)}">Last 6 mo <b>${arrow}${
    pct === 0 ? '' : ` ${Math.abs(pct)}%`
  }</b> vs prior 6</span>`;
}

/**
 * Horizontal bar list for the Product-breakdown and Origin-country sections.
 *
 * Both sections are captioned "share of the sampled shipments", so BOTH the
 * printed figure and the bar LENGTH encode share of the sample TOTAL. Length,
 * label and caption therefore always answer the same question.
 *
 * They used to disagree: the figure was a share of the total while the bar was
 * scaled to the BIGGEST row, so the top bar rendered full-width while its own
 * label said e.g. "38%". Scaling to the max made rows easy to rank against each
 * other but made every chart look like it had one dominant slice. Real share
 * scaling means a fragmented supply base renders as a row of short bars — that
 * is the finding, not a rendering defect.
 *
 * BAR_MIN_PCT keeps a tiny-but-present slice visible (and hoverable) instead of
 * collapsing it to a hairline; it is the only place length may exceed share.
 *
 * The denominator is the SAMPLE population (`sampleTotal`), not the sum of the
 * rows drawn: both callers cap their list to a top-N, so summing what is visible
 * would silently renormalise every share to 100%.
 */
/** Floor for a rendered bar, in % of the track. Below this a real slice would
 *  vanish; above it, length is exactly the printed share. */
export const BAR_MIN_PCT = 2;

function barRows(
  items: Array<{ label: string; value: number; flag?: string }>,
  /** Sample population. Defaults to the visible rows, but callers whose list is
   *  capped to a top-N MUST pass the real total — otherwise every share is
   *  measured against a denominator the caption does not describe. */
  sampleTotal?: number,
): string {
  const visible = items.reduce((sum, i) => sum + (i.value || 0), 0);
  const total = sampleTotal != null && sampleTotal >= visible ? sampleTotal : visible;
  /** Whole-percent share of the sample total — the number printed on the row. */
  const sharePct = (v: number): number => (total <= 0 ? 0 : Math.round((v / total) * 100));
  const pct = (v: number): string => {
    if (total <= 0) return '';
    const share = (v / total) * 100;
    // Never round a present slice down to "0%" — sub-1% reads as "<1%".
    return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;
  };
  return `<div class="impp-bars">${items
    .map((i) => {
      const share = pct(i.value);
      // Length == the printed share, floored so a "<1%" row is still a bar.
      const width = Math.max(BAR_MIN_PCT, sharePct(i.value));
      const tip = `${esc(i.label)}: ${N(i.value)} of ${N(total)} sampled shipments${share ? ` (${share})` : ''}`;
      return `<div class="impp-brow" title="${tip}"><span class="bl">${i.flag ? i.flag + ' ' : ''}<span>${esc(i.label)}</span></span><span class="bt"><i style="width:${width}%"></i></span><span class="bv impp-num">${N(i.value)}${share ? `<span class="bp">${share}</span>` : ''}</span></div>`;
    })
    .join('')}</div>`;
}

function listBlock(title: string, rows: Array<{ label: string; n: number }>): string {
  if (!rows.length) return `<div class="impp-list"><h4>${esc(title)}</h4><p class="lead">No data in the sample.</p></div>`;
  return `<div class="impp-list"><h4>${esc(title)}</h4>${rows
    .map((r) => `<div class="impp-lrow" title="${esc(r.label)}"><span>${esc(r.label)}</span><span class="lc">${N(r.n)}</span></div>`)
    .join('')}</div>`;
}

function statCard(label: string, value: string, sub?: string, icon = '\u{1F4E6}'): string {
  return `<div class="impp-stat"><span class="si" aria-hidden="true">${icon}</span><div class="sb"><div class="sl" title="${esc(label)}">${esc(label)}</div><div class="sv" title="${esc(value)}">${esc(value)}</div>${sub ? `<div class="sx">${esc(sub)}</div>` : ''}</div></div>`;
}

/** The identity header (shared by the full page and the wall). */
function identityHeader(p: ProfileData, opts: { showActions: boolean }): string {
  const meta = [
    p.address ? `<span class="mi">\u{1F4CD} ${esc(p.address)}</span>` : '',
    p.phoneMasked ? `<span class="mi">\u{1F4DE} ${esc(p.phoneMasked)}</span>` : '',
    p.entryPort ? `<span class="mi">\u{1F6A2} Enters via ${esc(p.entryPort)}</span>` : '',
    p.firstShipment ? `<span class="mi">\u{1F4C5} Importing since ${esc(p.firstShipment)}</span>` : '',
    p.aliasesCount > 1 ? `<span class="mi">\u{1F3F7}\u{FE0F} ${N(p.aliasesCount)} names on file</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  // "☆ Save" is a real, free logged-in action (see importerSaved routes); the
  // client wires it (PROFILE_JS) — a signed-out click routes to /login.
  const saveBtn = `<button type="button" class="impp-save" id="impp-save" data-slug="${esc(p.slug)}" data-company="${esc(p.company)}" aria-pressed="false"><span class="star" aria-hidden="true">☆</span> <span class="lbl">Save</span></button>`;
  // "Quote this lane" must mean the SAME thing here as on a search result card:
  // a /directory/rfq deep link seeded with this importer's drayage leg. It used
  // to point at /tools, a generic landing page — same words, dead end. When the
  // entry port resolves to no directory facet the button is dropped entirely
  // rather than rendered as a link that 302s back to /directory.
  const laneHref = quoteLaneHref({
    entryPort: p.entryPort,
    // Delivery state parsed from the displayed address. Only the STATE is
    // seeded into the RFQ — the recipients price a drayage leg to a region, and
    // a street address in a shareable query string is neither needed nor wanted.
    // The trailing [\s,] used to require a character AFTER the code, so an
    // address ending exactly in ", NC" (no ZIP) silently produced
    // destination= and a half-filled RFQ. A lookahead matches end-of-string too.
    destinationState: (String(p.address ?? '').match(/,\s*([A-Z]{2})(?=[\s,]|$)/) ?? [])[1] ?? null,
    // The importer's biggest commodity — same field the lane chip already shows.
    product: p.hsBreakdown[0]?.desc ?? p.suppliers[0]?.product ?? null,
    hsCode: p.hsBreakdown[0]?.hs ?? null,
  });
  const laneBtn = laneHref
    ? `<a class="btn btn-primary" href="${esc(laneHref)}" title="Request drayage rates from carriers at ${esc(
        p.entryPort ?? 'this port',
      )}">Quote this lane <span class="arr">&rarr;</span></a>`
    : '';
  return `
  <div class="impp-head">
    <div class="impp-title">
      <h1>${esc(p.company)}</h1>
      <span class="impp-flag" aria-hidden="true">${flag(p.countryCode)}</span>
      <span class="impp-pill">Importer</span>
      ${opts.showActions ? `<div class="impp-head-act">${saveBtn}${laneBtn}</div>` : ''}
    </div>
    ${meta ? `<div class="impp-meta">${meta}</div>` : ''}
  </div>`;
}

/** "Is this your company?" → Manifest Privacy onboarding CTA. Honest copy: we
 *  hide them on QuoteFleet and prepare/submit their CBP confidentiality request —
 *  no "remove from CBP" or "verified" claim. */
function privacyCta(p: ProfileData): string {
  const href = `/privacy/apply?slug=${encodeURIComponent(p.slug)}&name=${encodeURIComponent(p.company)}`;
  return `<div class="impp-privacy">
    <span class="impp-privacy-t">Is this your company?</span>
    <span class="impp-privacy-d">Hide your shipment data from competitors on QuoteFleet — we prepare &amp; submit your CBP confidentiality request on your behalf.</span>
    <a class="impp-privacy-cta" href="${href}">Hide my data <span class="arr">&rarr;</span></a>
  </div>`;
}

/** Full statistics strip (real headline aggregates). */
function statStrip(p: ProfileData): string {
  return `<div class="impp-stats">
    ${/* The non-breaking spaces are load-bearing: the label block is two fixed
          lines, and without them these broke as "TEU · last 12 / mo" and
          "Avg TEU / / shipment" — an orphaned word and a dangling slash. */ ''}
    ${statCard('Total sea shipments', N(p.totalShipments), undefined, '\u{1F4E6}')}
    ${statCard('Shipments · last 12 mo', N(p.ships12m), undefined, '\u{1F4C8}')}
    ${statCard('Avg TEU / shipment', p.avgTeu == null ? '—' : String(p.avgTeu), undefined, '\u{1F4CF}')}
    ${statCard('TEU · last 12 mo', N(p.teu12m), undefined, '\u{1F6A2}')}
    ${statCard('Est. shipping spend', p.estSpend || '—', 'est. · 12 mo', '\u{1F4B5}')}
  </div>`;
}

// ── contact-reveal render state ──────────────────────────────────────────────
/** Point-of-use state for the decision-maker reveal CTA. Computed by the profile
 *  handler from the Leads Pro identity + the per-account reveal allowance meter. */
export interface RevealState {
  loggedIn: boolean;
  isSubscriber: boolean;
  /** Reveals remaining (free-taste total, or monthly allowance). */
  remaining: number;
  /** The tier cap (FREE_REVEAL_TASTE or the monthly allowance). */
  cap: number;
  /** True when Leads Pro checkout is not enabled yet (price id unset). */
  comingSoon: boolean;
}

/** Whether Leads Pro checkout is NOT enabled yet — throw-proof (a config hiccup
 *  degrades to "coming soon" rather than 500-ing the page). */
function comingSoonSafe(): boolean {
  try {
    return !leadsProPurchasable();
  } catch {
    return true;
  }
}

/** Neutral default reveal state (treated as an anonymous free visitor). */
export function anonRevealState(): RevealState {
  return {
    loggedIn: false,
    isSubscriber: false,
    remaining: FREE_REVEAL_TASTE,
    cap: FREE_REVEAL_TASTE,
    comingSoon: comingSoonSafe(),
  };
}

/** Resolve the caller's point-of-use reveal state (Leads Pro identity + the
 *  per-account reveal allowance). Never throws — degrades to the anon state so a
 *  meter/DB/config hiccup can never 500 the profile page. */
export async function computeRevealState(req: Request): Promise<RevealState> {
  const comingSoon = comingSoonSafe();
  try {
    const id = await leadsIdentity(req);
    if (id.userId == null) {
      return { loggedIn: false, isSubscriber: false, remaining: FREE_REVEAL_TASTE, cap: FREE_REVEAL_TASTE, comingSoon };
    }
    const cap = id.isSubscriber ? id.revealAllowance || LEADS_PRO_MONTHLY_ALLOWANCE : FREE_REVEAL_TASTE;
    let used = 0;
    try {
      used = await dbLeadsRevealMeter.getReveals(leadsAccountKey(id.userId), revealBucket(id.isSubscriber));
    } catch {
      used = 0;
    }
    return { loggedIn: true, isSubscriber: id.isSubscriber, remaining: Math.max(0, cap - used), cap, comingSoon };
  } catch {
    return { loggedIn: false, isSubscriber: false, remaining: FREE_REVEAL_TASTE, cap: FREE_REVEAL_TASTE, comingSoon };
  }
}

// ── the full profile page ────────────────────────────────────────────────────
export function renderImporterProfilePage(p: ProfileData, quota: QuotaState, reveal: RevealState = anonRevealState()): string {
  const port = (p.entryPort || 'their US port').split(',')[0];
  const originName = p.origins[0]?.name;
  const brief = `
  <div class="impp-brief">
    <div class="impp-brief-h"><span class="tag">AI opportunity brief</span> Why ${esc(p.company)} is winnable now</div>
    <ul>
      <li><b>Steady, sticky volume —</b> ${N(p.ships12m)} shipments (${N(p.teu12m)} TEU) in the last 12 months${p.entryPort ? ' into ' + esc(p.entryPort) : ''}; a consistent lane worth pursuing.</li>
      ${p.incumbent ? `<li><b>Displaceable incumbent —</b> notify party <b>${esc(p.incumbent)}</b> shows on the bills; a named target to undercut${originName ? ' on the ' + esc(originName) + '→' + esc(port) + ' lane' : ''}.</li>` : '<li><b>No forwarder named —</b> the bills show no dominant notify party; an open lane to win with a sharper rate.</li>'}
      <li><b>Best timing —</b> pitch ahead of their busiest months (see the shipments chart) to land the next booking cycle.</li>
      <li><b>Who to reach —</b> reveal the decision-maker contact (verified work email, role-based inbox or the full phone number) below — ${reveal.isSubscriber ? 'included with your Leads Pro plan' : `${reveal.remaining} free reveal${reveal.remaining === 1 ? '' : 's'} to start`}.</li>
    </ul>
  </div>`;

  const sampleNote = `<p class="impp-samplenote">Headline totals are from the full ImportYeti record. The chart, suppliers, HS mix, origins and carrier lists are built from the <b>${N(p.sampleSize)}</b> most recent bills of lading on file.</p>`;

  // suppliers table
  const supBody = p.suppliers.length
    ? `<p class="lead">Who this importer buys from · top ${p.suppliers.length} in the sample</p>
    <div class="impp-tbl-wrap"><table class="impp-tbl">
      <thead><tr><th data-sort="t">Supplier</th><th class="impp-num" data-sort="n">Shipments (sample)</th><th data-sort="t">Product &amp; HS</th></tr></thead>
      <tbody>${p.suppliers
        .map(
          (s) => `<tr><td data-v="${esc(s.name)}" title="${esc(s.name)}"><span class="impp-supn">${flag(s.country)} ${esc(s.name)}</span><div class="lead" style="margin:2px 0 0">${esc(countryName(s.country))}</div></td><td class="impp-num" data-v="${s.ships}">${N(s.ships)}</td><td data-v="${esc(s.product || '')}" title="${esc(s.product || '')}">${esc(s.product || '—')}${s.hs ? ` <span class="impp-hschip">${esc(s.hs)}</span>` : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div><p class="impp-scrollnote">Swipe the table sideways to see every column &middot; click a column heading to sort.</p>`
    : '<p class="lead">No suppliers resolved in the sampled history.</p>';

  // HS breakdown as bars
  const hsBody = p.hsBreakdown.length
    ? `<p class="lead">By HS code · bar length = share of the sampled shipments</p>${barRows(
        p.hsBreakdown.map((h) => ({ label: `${h.hs} · ${h.chapter}`, value: h.n })),
        p.hsTotal,
      )}`
    : '<p class="lead">No HS codes on the sampled bills.</p>';

  // origins
  const originBody = p.origins.length
    ? `<p class="lead">By origin country · bar length = share of the sampled shipments</p>${barRows(
        p.origins.map((o) => ({ label: o.name, value: o.ships, flag: flag(o.cc) })),
        p.originsTotal,
      )}`
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
      <thead><tr><th data-sort="n">Date</th><th data-sort="t">Bill of lading</th><th data-sort="t">Supplier</th><th class="impp-num" data-sort="n">Weight</th><th class="impp-num" data-sort="n">Qty</th><th class="impp-num" data-sort="n">Cntrs</th><th data-sort="t">Description</th></tr></thead>
      <tbody>${p.recent
        .map(
          (r) => `<tr><td data-v="${dayKey(r.date)}">${esc(r.date)}</td><td data-v="${esc(r.bol)}"><span class="impp-hschip">${esc(r.bol)}</span></td><td data-v="${esc(r.supplier)}" title="${esc(r.supplier)}"><span class="impp-supn">${flag(r.country)} ${esc(r.supplier)}</span></td><td class="impp-num" data-v="${r.weight == null ? '' : r.weight}">${r.weight == null ? '—' : N(r.weight) + ' kg'}</td><td class="impp-num" data-v="${r.qty == null ? '' : r.qty}">${r.qty == null ? '—' : N(r.qty) + (r.unit ? ' ' + esc(r.unit) : '')}</td><td class="impp-num" data-v="${r.containers == null ? '' : r.containers}">${r.containers == null ? '—' : N(r.containers)}</td><td data-v="${esc(r.product || '')}" title="${esc(r.product || '')}">${esc(r.product || '—')}</td></tr>`,
        )
        .join('')}</tbody></table></div><p class="impp-scrollnote">Swipe the table sideways to see every column &middot; click a column heading to sort.</p>`
    : '<p class="lead">No recent shipments in the sample.</p>';

  // Contact reveal — the REAL gated reveal (Leads Pro). The CTA adapts to the
  // caller's state: signed-out → sign-in prompt; free with taste → "Reveal
  // contact (N free)"; free out of taste → upgrade (or "coming soon" until the
  // price is set); subscriber → reveal against the monthly allowance. The reveal
  // itself POSTs to /api/importers/company/:slug/reveal, which calls
  // resolveContactTiered() (cache-first, allowance-metered) and returns the real
  // verified / role_based / phone_only tier — NEVER a fabricated contact.
  const revealChip = reveal.loggedIn
    ? `<span class="impp-revchip${reveal.remaining <= 0 ? ' out' : ''}" id="impp-rev-left">${
        reveal.isSubscriber
          ? `${reveal.remaining} reveal${reveal.remaining === 1 ? '' : 's'} left this month`
          : `${reveal.remaining} free reveal${reveal.remaining === 1 ? '' : 's'} left`
      }</span>`
    : '';

  let revealAction: string;
  if (!reveal.loggedIn) {
    revealAction = `<a class="btn btn-primary" href="/login?next=${encodeURIComponent('/importers/company/' + p.slug)}">Sign in to reveal contact <span class="arr">&rarr;</span></a>`;
  } else if (reveal.remaining > 0) {
    const label = reveal.isSubscriber
      ? `Reveal contact (${reveal.remaining} left)`
      : `Reveal contact (${reveal.remaining} free)`;
    revealAction = `<button type="button" class="btn btn-primary" id="impp-reveal-btn" data-slug="${esc(p.slug)}">${esc(label)}</button>`;
  } else if (reveal.comingSoon) {
    revealAction = `<span class="impp-soon"><span class="ico" aria-hidden="true">\u{1F552}</span> Leads Pro <span class="tag">coming soon</span></span>`;
  } else {
    revealAction = `<button type="button" class="btn btn-primary" id="impp-upgrade-btn">Upgrade to Leads Pro to reveal contacts <span class="arr">&rarr;</span></button>`;
  }

  const revealLead = reveal.isSubscriber
    ? `Reveal the decision-maker on this lane — included with Leads Pro. <b>${reveal.remaining}</b> of ${reveal.cap} reveals left this month.`
    : reveal.remaining > 0
      ? `Reveal the decision-maker on this lane — a named contact with a verified work email, a role-based company inbox, or the importer's full phone number. You have <b>${reveal.remaining}</b> free reveal${reveal.remaining === 1 ? '' : 's'} to start; Leads Pro includes ${LEADS_PRO_MONTHLY_ALLOWANCE} reveals every month.`
      : `You've used your ${FREE_REVEAL_TASTE} free contact reveals. Leads Pro includes <b>${LEADS_PRO_MONTHLY_ALLOWANCE}</b> decision-maker reveals every month${reveal.comingSoon ? ' — coming soon.' : ` for $${LEADS_PRO_PRICE_USD}/mo.`}`;

  // The pitch is assembled from CONTACT_TIER_COPY so the card can never promise
  // something a tier does not hand over. The street address is called out as
  // FREE on purpose: it renders in the identity header and the Organization
  // JSON-LD above, so selling it back would be selling what we already gave.
  const tierPitch = TIER_ORDER.map((t) => CONTACT_TIER_COPY[t].badge.toLowerCase());
  const contactBody = `
    <p class="lead">${revealLead}</p>
    <div class="impp-lockcard" id="impp-reveal-card">
      <span class="ico" aria-hidden="true">\u{1F513}</span>
      <div class="lk">
        <div class="lt">Decision-maker contact ${revealChip}</div>
        <div class="ls">We resolve the best available tier — ${esc(tierPitch.slice(0, -1).join(', '))} or ${esc(tierPitch[tierPitch.length - 1])}. The company&rsquo;s street address stays free on this page either way, and we never show a fabricated contact.</div>
      </div>
      <div class="impp-reveal-act">${revealAction}</div>
    </div>
    <div class="impp-reveal-result" id="impp-reveal-result" hidden></div>`;

  // Aliases / other names + addresses (ImportYeti's signature de-dup): the same
  // importer files under many name spellings and addresses across their bills.
  const otherNamesHtml = p.otherNames.length
    ? `<div class="impp-list"><h4>Other names on the bills</h4>${p.otherNames
        .map((n2) => `<div class="impp-lrow"><span>${esc(n2)}</span></div>`)
        .join('')}</div>`
    : '<div class="impp-list"><h4>Other names on the bills</h4><p class="lead">No alternate name spellings in the sample.</p></div>';
  const otherAddrHtml = p.otherAddresses.length
    ? `<div class="impp-list"><h4>Other addresses</h4>${p.otherAddresses
        .map((a) => `<div class="impp-lrow"><span>${esc(a)}</span></div>`)
        .join('')}</div>`
    : '<div class="impp-list"><h4>Other addresses</h4><p class="lead">No alternate addresses in the sample.</p></div>';
  const aliasesBody = `
    <p class="lead">${
      p.aliasesCount > 1
        ? `This importer appears under <b>${N(p.aliasesCount)}</b> name spelling${p.aliasesCount === 1 ? '' : 's'}${p.otherAddresses.length ? ` and <b>${N(p.otherAddresses.length + 1)}</b> addresses` : ''} across the sampled customs bills — a single account behind several variants.`
        : 'Only one company-name spelling appears on the sampled bills.'
    }</p>
    <div class="impp-two">${otherNamesHtml}${otherAddrHtml}</div>`;

  // Every collapsed header carries a count so a folded row still tells you what
  // is behind it (ImportYeti's headers do the same).
  const secs: Array<SecDef> = [
    { id: 'overview', label: 'Overview', sub: 'headline stats + AI brief', body: statStrip(p) + brief + sampleNote, open: true },
    {
      id: 'aliases',
      label: 'Also known as / other addresses',
      sub: p.aliasesCount > 1 ? `${p.aliasesCount} names · ${p.otherAddresses.length + 1} addresses` : '1 name on file',
      body: aliasesBody,
    },
    {
      id: 'chart',
      label: 'Shipments over time',
      sub: p.months.length ? `${p.months.length} months` : 'no dated bills',
      body: chartSvg(p.months),
      open: true,
    },
    { id: 'suppliers', label: 'Suppliers', sub: `${p.suppliers.length} in sample`, body: supBody, open: true },
    {
      id: 'products',
      label: 'Product breakdown',
      // A capped list says so, so a folded header never implies the sample only
      // held the codes we happen to draw.
      sub: p.hsCodeCount > p.hsBreakdown.length ? `top ${p.hsBreakdown.length} of ${p.hsCodeCount} HS codes` : `${p.hsBreakdown.length} HS codes`,
      body: hsBody,
      open: true,
    },
    {
      id: 'origins',
      label: 'Imports by origin country',
      sub: p.originCount > p.origins.length ? `top ${p.origins.length} of ${p.originCount} countries` : `${p.origins.length} countries`,
      body: originBody,
      open: true,
    },
    { id: 'relationships', label: 'Top supplier relationships', sub: `${Math.min(p.suppliers.length, 4)} look-alike lanes`, body: relBody },
    { id: 'carriers', label: 'Carriers & containers', sub: `${p.carriers.length} carriers`, body: carrierBody },
    { id: 'ports', label: 'Ports & notify parties', sub: `${p.portsFrom.length} ports`, body: portsBody },
    { id: 'recent', label: 'Most recent sea shipments', sub: `${N(p.recent.length)} bills`, body: recentBody },
    { id: 'contact', label: 'Decision-maker contacts', sub: 'paid unlock', body: contactBody, open: true },
  ];

  const dots = `
  <nav class="impp-dots" aria-label="Jump to section">
    <ul>${secs
      .map((s) => `<li><a href="#sec-${esc(s.id)}" data-dot="${esc(s.id)}"><span class="impp-dot"></span><span class="impp-dotl">${esc(s.label)}</span></a></li>`)
      .join('')}</ul>
  </nav>`;

  // R3: the dot rail is fixed to the viewport gutter and disappears below
  // 1320px, which left every laptop, tablet and phone with NO way to move
  // around a ~3,400px page except scrolling. This bar carries the same section
  // list horizontally and takes over exactly where the rail drops out. The
  // expand/collapse control rides in it at ALL widths — five of the eleven
  // sections load folded, and there was previously no way to open them in one
  // go.
  const secBar = `
  <div class="impp-secbar">
    <div class="impp-tabswrap" id="impp-tabswrap" data-scroll="none">
      <nav class="impp-tabs" aria-label="Jump to section">
        ${secs.map((s) => `<a href="#sec-${esc(s.id)}" data-dot="${esc(s.id)}">${esc(s.label)}</a>`).join('')}
      </nav>
    </div>
    <button type="button" class="impp-expand" id="impp-expand" aria-pressed="false" aria-label="Expand all sections">Expand<span class="impp-expand-x"> all</span></button>
  </div>`;

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
      ${secBar}
      ${secs.map((s, i) => section(s, s.open ?? i === 0)).join('')}
      ${/* R5: this used to sit inside the identity header, where it spent ~70px
            of the FIRST screen on a pitch aimed at the importer being profiled —
            not at the freight seller who is actually visiting. A quarter of the
            fold went to chrome before a single lead fact. It belongs after the
            data, where the one visitor in a thousand who IS that importer will
            still find it. */ ''}
      ${privacyCta(p)}
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
        <div class="wico" aria-hidden="true">&#128274;</div>
        <h2>Subscribe to open more importer profiles</h2>
        <p>${esc(DETAIL_WALL_MESSAGE)}</p>
        <ul class="impp-wall-list">
          <li>Full supplier table</li><li>Monthly shipment history</li><li>HS &amp; origin breakdown</li><li>Carriers &amp; notify parties</li><li>Recent bills of lading</li>
        </ul>
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
type UnavailableReason = 'error' | 'not_configured' | 'cache_only';

function renderProfileUnavailable(slug: string, reason: UnavailableReason): string {
  const name = titleFromSlug(slug);
  const ICON: Record<UnavailableReason, string> = {
    error: '&#9888;',
    not_configured: '&#128338;',
    cache_only: '&#128274;',
  };
  const TITLE: Record<UnavailableReason, string> = {
    error: 'Profile temporarily unavailable',
    not_configured: 'Importer profiles are coming soon',
    cache_only: 'Profile temporarily unavailable',
  };
  const COPY: Record<UnavailableReason, string> = {
    error:
      'We could not load this importer&rsquo;s customs history right now. Nothing was charged &mdash; please try again shortly.',
    not_configured:
      'Importer profiles are not switched on in this environment yet. Searching importers still works.',
    // HONEST: this environment is cache-only by design (cost guard). We show
    // nothing rather than pretending the company has no shipment history.
    cache_only:
      'This importer&rsquo;s customs history has not been pulled into this environment yet, so there is nothing cached to show. Nothing was charged.',
  };
  // Dev-visible only: a plain HTML comment naming the cost guard, so a developer
  // or agent immediately understands WHY the page is empty. Never user-facing copy.
  const devNote = reason === 'cache_only' ? `\n  <!-- ${CACHE_ONLY_NOTE} (cost guard) -->` : '';
  const body = `${devNote}
  <style>${PROFILE_CSS}</style>
  <main class="impp-wrap"><div class="container-narrow">
    <a class="impp-back" href="/importers">&larr; Back to importer search</a>
    <div class="impp-head"><div class="impp-title"><h1>${esc(name)}</h1></div></div>
    <div class="impp-wall">
      <div class="wico" aria-hidden="true">${ICON[reason]}</div>
      <h2>${TITLE[reason]}</h2>
      <p>${COPY[reason]}</p>
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

/**
 * Neutral "not available" page for a redacted (Manifest Privacy) importer. It
 * deliberately reveals NOTHING — not the company name, not that the profile was
 * hidden by a confidentiality customer — and spends no ImportYeti credit. Honest
 * and neutral: a plain "isn't available", not an error the visitor should retry.
 */
function renderProfileRedacted(): string {
  const body = `
  <style>${PROFILE_CSS}</style>
  <main class="impp-wrap"><div class="container-narrow">
    <a class="impp-back" href="/importers">&larr; Back to importer search</a>
    <div class="impp-wall">
      <h2>This importer profile isn&rsquo;t available</h2>
      <p>This company&rsquo;s profile can&rsquo;t be shown on QuoteFleet. Searching importers still works.</p>
      <div class="impp-wall-actions"><a class="impp-btn-o" href="/importers">Back to importer search</a></div>
    </div>
  </div></main>`;
  return layout({
    title: 'Importer profile | QuoteFleet',
    description: 'Importer profile on QuoteFleet.',
    canonicalPath: '/importers',
    bodyHtml: body,
  });
}

// ── client JS (fold/unfold + dot scroll-spy + chart tooltip) ─────────────────
const PROFILE_JS = `
(function(){
  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){}

  // (4) fold / unfold — six sections render open, five folded (see the secs
  // array in renderImporterProfilePage).
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
      btn.addEventListener('click', function(){ toggleSection(btn.parentNode); syncExpand(); });
    })(sechs[i]);
  }

  // (3) section navs — scroll-spy + click-to-open. Keyed off [data-dot] so the
  // fixed dot rail (>1320px) and the horizontal section bar (<=1320px) share
  // one handler; only one of the two is ever visible.
  var secs = [].slice.call(document.querySelectorAll('.impp-sec'));
  var dots = [].slice.call(document.querySelectorAll('[data-dot]'));
  function setActive(id){ for(var j=0;j<dots.length;j++){ dots[j].classList.toggle('active', dots[j].getAttribute('data-dot')===id); } }

  for(var d=0; d<dots.length; d++){
    (function(a){
      a.addEventListener('click', function(ev){
        ev.preventDefault();
        var id = a.getAttribute('data-dot');
        var sec = document.getElementById('sec-'+id);
        if(!sec) return;
        toggleSection(sec, true);            // auto-unfold the target section
        syncExpand();
        setActive(id);
        try { sec.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block:'start'}); }
        catch(e){ sec.scrollIntoView(); }
      });
    })(dots[d]);
  }

  // Keep the active tab in view on the horizontal bar — the scroll-spy is
  // useless if the highlighted tab has scrolled out of the strip.
  var tabsEl = document.querySelector('.impp-tabs');
  var tabsWrap = document.getElementById('impp-tabswrap');
  function revealActiveTab(){
    if(!tabsEl || !tabsWrap || !tabsWrap.offsetParent) return;
    var a = tabsEl.querySelector('a.active');
    if(!a) return;
    var lo = a.offsetLeft, hi = lo + a.offsetWidth;
    if(lo < tabsEl.scrollLeft) tabsEl.scrollLeft = lo - 8;
    else if(hi > tabsEl.scrollLeft + tabsEl.clientWidth) tabsEl.scrollLeft = hi - tabsEl.clientWidth + 8;
    syncTabScroll();
  }
  // (3a) Which way can the strip still scroll? Drives the edge fade + chevrons.
  // "none" when it already fits, so a short strip carries no false cue.
  function syncTabScroll(){
    if(!tabsEl || !tabsWrap) return;
    if(!tabsWrap.offsetParent){ tabsWrap.setAttribute('data-scroll','none'); return; }
    var max = tabsEl.scrollWidth - tabsEl.clientWidth;
    if(max <= 2){ tabsWrap.setAttribute('data-scroll','none'); return; }
    var canL = tabsEl.scrollLeft > 2, canR = tabsEl.scrollLeft < max - 2;
    tabsWrap.setAttribute('data-scroll', canL && canR ? 'both' : (canL ? 'left' : 'right'));
  }
  if(tabsEl){ tabsEl.addEventListener('scroll', syncTabScroll, {passive:true}); }
  window.addEventListener('resize', syncTabScroll);
  syncTabScroll();

  // (3b) expand all / collapse all. Five sections load folded; opening them one
  // by one to scan the whole record was the only option before.
  var expandBtn = document.getElementById('impp-expand');
  function allOpen(){
    for(var q=0;q<secs.length;q++){ if(!secs[q].classList.contains('open')) return false; }
    return secs.length > 0;
  }
  function syncExpand(){
    if(!expandBtn) return;
    var on = allOpen();
    expandBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    expandBtn.setAttribute('aria-label', (on ? 'Collapse' : 'Expand') + ' all sections');
    // Rewrite only the verb. Setting textContent here used to wipe the
    // .impp-expand-x span, which is what CSS drops at <=620px to stop this
    // control eating a third of the sticky section bar on a phone.
    var verb = expandBtn.firstChild;
    if(verb && verb.nodeType === 3) verb.nodeValue = on ? 'Collapse' : 'Expand';
    else expandBtn.textContent = on ? 'Collapse all' : 'Expand all';
  }
  if(expandBtn){
    expandBtn.addEventListener('click', function(){
      var open = !allOpen();
      for(var q=0;q<secs.length;q++) toggleSection(secs[q], open);
      syncExpand();
    });
    syncExpand();
  }

  if('IntersectionObserver' in window && secs.length){
    var vis = {};
    var io = new IntersectionObserver(function(entries){
      for(var k=0;k<entries.length;k++){
        var e=entries[k]; vis[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0;
      }
      var best=null, bestV=-1;
      for(var s=0;s<secs.length;s++){ var v=vis[secs[s].id]||0; if(v>bestV){ bestV=v; best=secs[s]; } }
      if(best && bestV>0){ setActive(best.getAttribute('data-sec')); revealActiveTab(); }
    }, {threshold:[0,0.15,0.4,0.75,1], rootMargin:'-8% 0px -55% 0px'});
    for(var o=0;o<secs.length;o++) io.observe(secs[o]);
    if(secs[0]) setActive(secs[0].getAttribute('data-sec'));
  }

  // (2) shipments-over-time hover tooltip.
  var chart = document.getElementById('impp-chart');
  // The tip is positioned inside .impp-plot (the bars' own box), so measure that
  // — not the outer card — or it drifts by the y-axis gutter width.
  var wrap = chart && chart.closest('.impp-plot');
  var tip = document.getElementById('impp-chart-tip');
  if(chart && wrap && tip){
    var tv = tip.querySelector('.tv'), tc = tip.querySelector('.tc');
    var lit = null;
    function place(clientX){
      var r = wrap.getBoundingClientRect();
      var x = clientX - r.left;
      x = Math.max(52, Math.min(r.width-52, x));
      tip.style.left = x + 'px';
    }
    function lightBar(b){
      if(lit === b) return;
      if(lit) lit.classList.remove('on');
      lit = b;
      if(lit) lit.classList.add('on');
    }
    chart.addEventListener('mouseover', function(ev){
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-bar]') : null;
      if(!b) return;
      // .tv = the month caption, .tc = the emphasised shipment count.
      var c = Number(b.getAttribute('data-count')||0);
      if(tv) tv.textContent = b.getAttribute('data-label');
      if(tc) tc.textContent = c.toLocaleString('en-US') + (c===1?' shipment':' shipments');
      lightBar(b);
      tip.hidden = false;
    });
    chart.addEventListener('mousemove', function(ev){
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-bar]') : null;
      if(!b){ return; }
      place(ev.clientX);
    });
    chart.addEventListener('mouseout', function(ev){
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-bar]') : null;
      if(b){ tip.hidden = true; lightBar(null); }
    });
    chart.addEventListener('mouseleave', function(){ tip.hidden = true; lightBar(null); });

    // ── keyboard: arrows walk the series (R3) ────────────────────────────────
    // Roving tabindex — exactly one bar sits in the tab order, so an 18-month
    // chart costs one tab stop to reach and one to leave. Focus shows the same
    // tooltip the mouse does; each bar's aria-label announces month + count.
    var barList = [].slice.call(chart.querySelectorAll('[data-bar]'));
    function showFor(b){
      if(!b) return;
      var c = Number(b.getAttribute('data-count')||0);
      if(tv) tv.textContent = b.getAttribute('data-label');
      if(tc) tc.textContent = c.toLocaleString('en-US') + (c===1?' shipment':' shipments');
      lightBar(b);
      tip.hidden = false;
      // Bars are laid out on a 0..720 viewBox that stretches to the box width,
      // so map the bar's centre through the CURRENT rendered width.
      try {
        var r = wrap.getBoundingClientRect();
        // A collapsed section renders the plot at zero width, where the clamp
        // below (max 52, min width-52) resolves to 52 and translateX(-50%) then
        // pushes the tooltip off the left edge. Nothing sensible to place
        // against, so leave it where it is.
        if(!r.width) return;
        var cx = (Number(b.getAttribute('x')) + Number(b.getAttribute('width'))/2) / 720;
        var x = Math.max(52, Math.min(Math.max(52, r.width-52), cx * r.width));
        tip.style.left = x + 'px';
      } catch(e){}
    }
    function focusBar(idx){
      if(idx < 0 || idx >= barList.length) return;
      for(var z=0; z<barList.length; z++) barList[z].setAttribute('tabindex', z===idx ? '0' : '-1');
      barList[idx].focus();
    }
    for(var bi=0; bi<barList.length; bi++){
      (function(b, idx){
        b.addEventListener('focus', function(){ showFor(b); });
        b.addEventListener('blur', function(){ tip.hidden = true; lightBar(null); });
        b.addEventListener('keydown', function(ev){
          var k = ev.key, to = -1;
          if(k==='ArrowRight' || k==='ArrowDown') to = Math.min(barList.length-1, idx+1);
          else if(k==='ArrowLeft' || k==='ArrowUp') to = Math.max(0, idx-1);
          else if(k==='Home') to = 0;
          else if(k==='End') to = barList.length-1;
          else if(k==='Escape'){ tip.hidden = true; lightBar(null); return; }
          else return;
          ev.preventDefault();
          focusBar(to);
        });
      })(barList[bi], bi);
    }
  }

  // ── ☆ Save this importer (free, logged-in). Reflects saved state on load. ──
  var saveBtn = document.getElementById('impp-save');
  if(saveBtn){
    var slug = saveBtn.getAttribute('data-slug');
    var company = saveBtn.getAttribute('data-company');
    var saved = false;
    function paint(){
      saveBtn.classList.toggle('saved', saved);
      saveBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      var star = saveBtn.querySelector('.star'); var lbl = saveBtn.querySelector('.lbl');
      if(star) star.textContent = saved ? '\\u2605' : '\\u2606';
      if(lbl) lbl.textContent = saved ? 'Saved' : 'Save';
    }
    // Hydrate current saved state (anonymous → loggedIn:false, empty slugs).
    fetch('/api/importers/saved/slugs',{headers:{'Accept':'application/json'}})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && j.slugs && j.slugs.indexOf(slug) > -1){ saved = true; paint(); } })
      .catch(function(){ /* ignore — button still works, defaults to unsaved */ });
    saveBtn.addEventListener('click', function(){
      saveBtn.disabled = true;
      var method = saved ? 'DELETE' : 'POST';
      var url = saved ? ('/api/importers/saved/'+encodeURIComponent(slug)) : '/api/importers/saved';
      var opts = { method: method, headers: { 'Accept':'application/json' } };
      if(!saved){ opts.headers['Content-Type']='application/json'; opts.body=JSON.stringify({slug:slug,company:company}); }
      fetch(url, opts).then(function(r){
        saveBtn.disabled = false;
        if(r.status === 401){ window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); return; }
        if(r.ok){ saved = !saved; paint(); }
      }).catch(function(){ saveBtn.disabled = false; });
    });
  }

  // ── Decision-maker contact reveal (Leads Pro) ──────────────────────────────
  var revBtn = document.getElementById('impp-reveal-btn');
  var revBtnLabel = revBtn ? revBtn.textContent : '';
  var upBtn = document.getElementById('impp-upgrade-btn');
  var revResult = document.getElementById('impp-reveal-result');
  var revLeft = document.getElementById('impp-rev-left');
  function e2(s){ var d=document.createElement('div'); d.textContent = (s==null?'':String(s)); return d.innerHTML; }
  function showMsg(cls, txt){ if(revResult){ revResult.innerHTML = '<div class="'+cls+'">'+e2(txt)+'</div>'; revResult.hidden=false; } }
  function setLeft(n, isSub){
    if(!revLeft) return;
    revLeft.textContent = isSub ? (n+' reveal'+(n===1?'':'s')+' left this month') : (n+' free reveal'+(n===1?'':'s')+' left');
    revLeft.className = 'impp-revchip' + (n<=0 ? ' out' : '');
  }
  function renderContact(c){
    if(!revResult||!c) return;
    // Cost guard: no live Hunter lookup was made and nothing was cached. Say so
    // honestly — never render this as "no contact found", and leave the reveal
    // button usable (the user's allowance was not charged).
    if(c.unavailable==='cache-only'){
      showMsg('impp-rvc-none','Contact lookup is disabled in this environment \\u2014 nothing cached for this importer yet.');
      if(revBtn){ revBtn.disabled=false; revBtn.textContent=revBtnLabel; }
      return;
    }
    var conf = c.confidence || 'phone_only';
    // Badge + one-line "what this actually is" both come from the server's
    // CONTACT_TIER_COPY, so the revealed card can never over-claim its tier.
    var TIER_COPY = ${JSON.stringify(CONTACT_TIER_COPY)};
    var tc = TIER_COPY[conf] || TIER_COPY.phone_only;
    var out = ['<div class="impp-rvc">','<span class="impp-rvc-badge '+conf+'">'+e2(tc.badge)+'</span>','<div class="impp-rvc-what">'+e2(tc.blurb)+'</div>'];
    if(c.contact_name){ out.push('<div class="impp-rvc-name">'+e2(c.contact_name)+'</div>'); }
    if(c.title){ out.push('<div class="impp-rvc-title">'+e2(c.title)+'</div>'); }
    // Copy buttons carry NO value in an attribute: e2() escapes markup but not
    // quotes, and these strings come from an external provider. The handler reads
    // the rendered text instead, so nothing provider-supplied is ever parsed as
    // an attribute value.
    function cbtn(label,all){ return '<button type="button" class="impp-copy"'+(all?' data-all="1"':'')+' aria-label="Copy '+label+'">Copy</button>'; }
    if(c.email){
      var cf = (c.email_confidence!=null) ? ' <span class="impp-rvc-conf">('+e2(c.email_confidence)+'% confidence)</span>' : '';
      out.push('<div class="impp-rvc-row">Email: <a href="mailto:'+e2(c.email)+'">'+e2(c.email)+'</a>'+cbtn('email address')+cf+'</div>');
    }
    if(c.role_emails && c.role_emails.length){
      out.push('<div class="impp-rvc-row">Role inboxes: '+c.role_emails.map(function(x){return '<a href="mailto:'+e2(x)+'">'+e2(x)+'</a>';}).join(' &middot; ')+cbtn('all role inboxes',true)+'</div>');
    }
    if(c.phone){ out.push('<div class="impp-rvc-row">Phone: <a href="tel:'+e2(c.phone)+'">'+e2(c.phone)+'</a>'+cbtn('phone number')+'</div>'); }
    if(c.address){ out.push('<div class="impp-rvc-row">Address: <span>'+e2(c.address)+'</span>'+cbtn('address')+'</div>'); }
    if(!c.email && (!c.role_emails||!c.role_emails.length) && !c.phone){
      out.push('<div class="impp-rvc-none">No verified contact found for this importer — no email or phone resolved. Their supplier lanes above are still your strongest outreach angle.</div>');
    }
    out.push('</div>');
    revResult.innerHTML = out.join('');
    revResult.hidden = false;
    var card = document.getElementById('impp-reveal-card');
    if(card){ var act = card.querySelector('.impp-reveal-act'); if(act) act.style.display='none'; }
  }
  function startUpgrade(){
    fetch('/api/importers/billing/checkout',{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},body:'{}'})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status,j:j}; }); })
      .then(function(o){
        if(o.s===401){ window.location.href='/login?next='+encodeURIComponent(window.location.pathname); return; }
        if(o.j && o.j.url){ window.location.href=o.j.url; return; }
        showMsg('impp-rvc-none', (o.j && o.j.error) || 'Leads Pro is coming soon.');
      }).catch(function(){ showMsg('impp-rvc-err','Could not start checkout. Try again.'); });
  }
  if(upBtn){ upBtn.addEventListener('click', startUpgrade); }
  if(revBtn){
    revBtn.addEventListener('click', function(){
      var slug = revBtn.getAttribute('data-slug');
      var orig = revBtn.textContent;
      revBtn.disabled = true; revBtn.textContent = 'Revealing\\u2026';
      fetch('/api/importers/company/'+encodeURIComponent(slug)+'/reveal',{method:'POST',headers:{'Accept':'application/json'}})
        .then(function(r){ return r.json().then(function(j){ return {s:r.status,j:j}; }); })
        .then(function(o){
          revBtn.disabled = false;
          if(o.s===401){ window.location.href='/login?next='+encodeURIComponent(window.location.pathname); return; }
          var j = o.j || {};
          if(j.ok){ renderContact(j.contact); setLeft(j.remaining, j.tier==='pro'); return; }
          revBtn.textContent = orig;
          if(j.reason==='upgrade'){ if(j.comingSoon){ showMsg('impp-rvc-none','You\\u2019ve used your free reveals. Leads Pro is coming soon.'); } else { startUpgrade(); } }
          else if(j.reason==='allowance_exhausted'){ showMsg('impp-rvc-none','You\\u2019ve used all your reveals this month. More unlock next month.'); }
          else { showMsg('impp-rvc-err','Could not reveal the contact. Try again.'); }
        }).catch(function(){ revBtn.disabled=false; revBtn.textContent=orig; showMsg('impp-rvc-err','Could not reveal the contact. Try again.'); });
    });
  }

  // ── copy the revealed contact (R4) ─────────────────────────────────────────
  // Delegated, because the reveal markup does not exist until the reveal lands.
  // Values are read from the RENDERED text, never from an attribute.
  function copyText(text, btn){
    function done(){
      var orig2 = btn.textContent;
      btn.textContent = 'Copied'; btn.classList.add('done');
      setTimeout(function(){ btn.textContent = orig2; btn.classList.remove('done'); }, 1600);
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(function(){ legacyCopy(text, done); });
    } else { legacyCopy(text, done); }
  }
  function legacyCopy(text, ok){
    try{
      var ta = document.createElement('textarea'); ta.value = text;
      ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      var good = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if(good) ok();
    }catch(e){ /* clipboard unavailable — the value stays selectable on screen */ }
  }
  if(revResult){
    revResult.addEventListener('click', function(ev){
      var btn = ev.target && ev.target.closest ? ev.target.closest('.impp-copy') : null;
      if(!btn) return;
      var text = '';
      if(btn.getAttribute('data-all')){
        var as = btn.parentNode.querySelectorAll('a');
        var vals = [];
        for(var i=0;i<as.length;i++) vals.push(as[i].textContent.trim());
        text = vals.join(', ');
      } else if(btn.previousElementSibling){
        text = btn.previousElementSibling.textContent.trim();
      }
      if(text) copyText(text, btn);
    });
  }

  // ── sortable table columns (R4) ────────────────────────────────────────────
  // Client-side reorder of rows already on the page — no request, no credits.
  // Sort values come from each cell's data-v (the raw number / name), so
  // "1,240 kg" and "03/14/2026" sort as a number rather than as a string. A cell
  // with an EMPTY data-v is missing data, not zero, so it always sinks to the
  // bottom whichever direction is active.
  var tables = document.querySelectorAll('table.impp-tbl');
  for(var t=0; t<tables.length; t++){
    (function(table){
      var head = table.querySelector('thead tr');
      var body = table.querySelector('tbody');
      if(!head || !body) return;
      var ths = [].slice.call(head.querySelectorAll('th'));
      var sortable = [];
      for(var c=0;c<ths.length;c++){ if(ths[c].getAttribute('data-sort')) sortable.push(c); }
      if(!sortable.length) return;

      function apply(col, dir){
        var numeric = ths[col].getAttribute('data-sort')==='n';
        var rows = [].slice.call(body.querySelectorAll('tr'));
        rows.sort(function(a,b){
          var ca=a.children[col], cb=b.children[col];
          var va=ca?(ca.getAttribute('data-v')!=null?ca.getAttribute('data-v'):ca.textContent):'';
          var vb=cb?(cb.getAttribute('data-v')!=null?cb.getAttribute('data-v'):cb.textContent):'';
          va=String(va).trim(); vb=String(vb).trim();
          if(!va && !vb) return 0;
          if(!va) return 1;          // missing data sinks, both directions
          if(!vb) return -1;
          if(numeric){ var d=(Number(va)||0)-(Number(vb)||0); return dir==='asc'?d:-d; }
          var s=String(va).toLowerCase().localeCompare(String(vb).toLowerCase());
          return dir==='asc'?s:-s;
        });
        for(var r=0;r<rows.length;r++) body.appendChild(rows[r]);
        for(var k=0;k<ths.length;k++){
          if(!ths[k].getAttribute('data-sort')) continue;
          ths[k].setAttribute('aria-sort', k===col ? (dir==='asc'?'ascending':'descending') : 'none');
          var ar=ths[k].querySelector('.impp-sortar');
          if(ar) ar.textContent = k===col ? (dir==='asc'?'\\u25B2':'\\u25BC') : '\\u25BC';
        }
      }

      sortable.forEach(function(col){
        var th=ths[col];
        var label=th.textContent.trim();
        var numeric=th.getAttribute('data-sort')==='n';
        th.setAttribute('aria-sort','none');
        th.innerHTML='';
        var b=document.createElement('button');
        b.type='button'; b.className='impp-sortbtn';
        b.title='Sort by '+label;
        b.appendChild(document.createTextNode(label));
        var ar=document.createElement('span');
        ar.className='impp-sortar'; ar.setAttribute('aria-hidden','true'); ar.textContent='\\u25BC';
        b.appendChild(ar);
        th.appendChild(b);
        // First click on a MEASURE sorts biggest-first (the question is always
        // "which is the largest"); on a NAME it sorts A-Z.
        var dir = numeric ? 'desc' : 'asc';
        var armed = false;
        b.addEventListener('click', function(){
          if(armed) dir = dir==='asc' ? 'desc' : 'asc';
          armed = true;
          apply(col, dir);
        });
      });
    })(tables[t]);
  }

  // ── back to YOUR results (R4) ──────────────────────────────────────────────
  // The search page now keeps its filters + sort in the URL and stores that URL,
  // so this link can return to the exact result set the visitor came from
  // instead of an empty search form. Same-origin relative paths under
  // /importers only — never a value that could redirect off-site.
  try{
    var back = sessionStorage.getItem('qf_imp_back');
    if(back && back.indexOf('/importers')===0 && back.charAt(1)!=='/' && back.indexOf('?')>0){
      var backs = document.querySelectorAll('.impp-back');
      for(var bi=0; bi<backs.length; bi++){
        backs[bi].setAttribute('href', back);
        backs[bi].textContent = '\\u2190 Back to your results';
      }
    }
  }catch(e){ /* no sessionStorage — the plain link still works */ }
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
  // Manifest Privacy redaction choke-point: if this importer is a CBP-confirmed
  // confidentiality customer, short-circuit to a neutral "not available" page
  // BEFORE any ImportYeti pull — a redacted profile must NEVER spend a credit.
  try {
    const redactSet = await activeRedactionKeys();
    if (
      isKeyRedacted(redactSet, titleFromSlug(slug)) ||
      isKeyRedacted(redactSet, slug.replace(/-/g, ' '))
    ) {
      res.status(404).type('html').send(renderProfileRedacted());
      return;
    }
  } catch (err) {
    // Fail-open on the redaction check (never block a normal profile because the
    // redaction lookup hiccuped) — the set load itself already degrades to empty.
    console.warn('[importers.profile] redaction check failed (continuing):', err);
  }

  const bolCache = deps.bolCache ?? dbBolCacheStore;
  // For a logged-in user the free-profile quota is keyed to their ACCOUNT (see
  // importerQuota); anonymous visitors fall back to the cookie/IP gate.
  const userId = (await directoryIdentity(req).catch(() => null))?.userId ?? null;
  const quota = checkDetailQuota(req, slug, userId);

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
      // Cache miss with no live pull. Either the cost guard blocked it (dev / CI)
      // or the feature is not switched on here — both render the designed
      // "unavailable" state, and NEITHER counts as a profile open.
      res
        .status(503)
        .type('html')
        .send(renderProfileUnavailable(slug, fetched.liveBlocked ? 'cache_only' : 'not_configured'));
      return;
    }
    const profile = aggregateProfile(fetched.rows, slug);
    // Count this detailed open (bumps the visitor cookie + per-IP backstop).
    // Passing the slug dedups re-opens of the SAME company (no double-charge).
    const after = recordDetailOpen(req, res, slug, userId);
    const reveal = await computeRevealState(req);
    res.type('html').send(renderImporterProfilePage(profile, after, reveal));
  } catch (err) {
    const msg = (err as Error)?.message || 'unknown error';
    const missingKey = /API_KEY not set/i.test(msg);
    console.warn('[importers.profile] failed:', msg);
    res
      .status(missingKey ? 503 : 502)
      .type('html')
      .send(renderProfileUnavailable(slug, missingKey ? 'not_configured' : 'error'));
  }
}

export function registerImporterProfileRoutes(app: Express): void {
  app.get('/importers/company/:slug', (req: Request, res: Response) => handleImporterProfile(req, res));
}
