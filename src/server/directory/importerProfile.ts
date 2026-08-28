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
import { pullImportBols, type BolRow } from './importerLeads.js';
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
    if (!entryPort && str(r.entry_port)) entryPort = fixCodeCasing(str(r.entry_port));
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
.impp-sec{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);margin:12px 0;box-shadow:var(--shadow-sm);overflow:hidden;scroll-margin-top:16px;transition:border-color .16s ease}
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
/* the latest month is the one a broker acts on — call it out */
.impp-chart rect.bar.last{fill:var(--accent)}
.impp-chart .axis{stroke:var(--border-strong);stroke-width:1}
.impp-xaxis{display:flex;justify-content:space-between;color:var(--muted);font-size:10.5px;font-weight:600;margin:8px 0 0 0;padding-left:34px}
.impp-chart-cap{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
.impp-chart-cap b{color:var(--ink);font-variant-numeric:tabular-nums}
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
.impp-supn{font-weight:700;color:var(--ink)}
.impp-hschip{font-family:var(--font-mono);font-size:11px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:4px;padding:1px 6px;display:inline-block;white-space:nowrap}
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
  const n = months.length;
  const gap = n > 1 ? Math.max(2, Math.min(10, 320 / n)) : 4;
  const bw = (W - gap * (n - 1)) / n;
  const bars = months
    .map((m, i) => {
      const h = Math.max(2, Math.round((m.count / max) * (H - padB)));
      const x = i * (bw + gap);
      const y = H - h;
      return `<rect class="bar${i === n - 1 ? ' last' : ''}" data-bar data-label="${esc(m.label)}" data-count="${m.count}" x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}"><title>${esc(m.label)}: ${N(m.count)}</title></rect>`;
    })
    .join('');
  const first = months[0].label, last = months[n - 1].label;
  const mid = n > 2 ? months[Math.floor((n - 1) / 2)].label : '';
  // y-axis ticks at 100 / 75 / 50 / 25 / 0 % of the peak, matching the gridlines
  const ticks = [1, 0.75, 0.5, 0.25, 0]
    .map((f) => `<span>${N(Math.round(max * f))}</span>`)
    .join('');
  const total = months.reduce((s, m) => s + m.count, 0);
  const peak = months.reduce((b, m) => (m.count > b.count ? m : b), months[0]);
  const avg = Math.round(total / n);
  return `
  <div class="impp-chartwrap">
    <div class="impp-chart-grid">
      <div class="impp-yaxis" aria-hidden="true">${ticks}</div>
      <div class="impp-plot">
        <div class="impp-tip" id="impp-chart-tip" hidden><span class="tv"></span><span class="tc"></span></div>
        <svg class="impp-chart" id="impp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Monthly shipment counts, ${esc(first)} to ${esc(last)}">
          <line class="axis" x1="0" y1="${H}" x2="${W}" y2="${H}"/>
          ${bars}
        </svg>
      </div>
    </div>
    <div class="impp-xaxis"><span>${esc(first)}</span>${mid ? `<span>${esc(mid)}</span>` : ''}<span>${esc(last)}</span></div>
    <div class="impp-chart-cap">
      <span>Peak <b>${N(peak.count)}</b> in ${esc(peak.label)}</span>
      <span>Average <b>${N(avg)}</b> / month</span>
      <span>${N(n)} month${n === 1 ? '' : 's'} on file</span>
    </div>
  </div>`;
}

function barRows(items: Array<{ label: string; value: number; flag?: string }>): string {
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<div class="impp-bars">${items
    .map(
      (i) => `<div class="impp-brow" title="${esc(i.label)}: ${N(i.value)}"><span class="bl">${i.flag ? i.flag + ' ' : ''}<span>${esc(i.label)}</span></span><span class="bt"><i style="width:${Math.round((i.value / max) * 100)}%"></i></span><span class="bv impp-num">${N(i.value)}</span></div>`,
    )
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
  return `
  <div class="impp-head">
    <div class="impp-title">
      <h1>${esc(p.company)}</h1>
      <span class="impp-flag" aria-hidden="true">${flag(p.countryCode)}</span>
      <span class="impp-pill">Importer</span>
      ${opts.showActions ? `<div class="impp-head-act">${saveBtn}<a class="btn btn-primary" href="/tools">Quote this lane <span class="arr">&rarr;</span></a></div>` : ''}
    </div>
    ${meta ? `<div class="impp-meta">${meta}</div>` : ''}
    ${opts.showActions ? privacyCta(p) : ''}
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
    ${statCard('Total sea shipments', N(p.totalShipments), undefined, '\u{1F4E6}')}
    ${statCard('Shipments · last 12 mo', N(p.ships12m), undefined, '\u{1F4C8}')}
    ${statCard('Avg TEU / shipment', p.avgTeu == null ? '—' : String(p.avgTeu), undefined, '\u{1F4CF}')}
    ${statCard('TEU · last 12 mo', N(p.teu12m), undefined, '\u{1F6A2}')}
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
      <li><b>Who to reach —</b> reveal the decision-maker contact (verified email, role or phone tier) below — ${reveal.isSubscriber ? 'included with your Leads Pro plan' : `${reveal.remaining} free reveal${reveal.remaining === 1 ? '' : 's'} to start`}.</li>
    </ul>
  </div>`;

  const sampleNote = `<p class="impp-samplenote">Headline totals are from the full ImportYeti record. The chart, suppliers, HS mix, origins and carrier lists are built from the <b>${N(p.sampleSize)}</b> most recent bills of lading on file.</p>`;

  // suppliers table
  const supBody = p.suppliers.length
    ? `<p class="lead">Who this importer buys from · top ${p.suppliers.length} in the sample</p>
    <div class="impp-tbl-wrap"><table class="impp-tbl">
      <thead><tr><th>Supplier</th><th class="impp-num">Shipments (sample)</th><th>Product &amp; HS</th></tr></thead>
      <tbody>${p.suppliers
        .map(
          (s) => `<tr><td title="${esc(s.name)}"><span class="impp-supn">${flag(s.country)} ${esc(s.name)}</span><div class="lead" style="margin:2px 0 0">${esc(countryName(s.country))}</div></td><td class="impp-num">${N(s.ships)}</td><td title="${esc(s.product || '')}">${esc(s.product || '—')}${s.hs ? ` <span class="impp-hschip">${esc(s.hs)}</span>` : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div><p class="impp-scrollnote">Swipe the table sideways to see every column.</p>`
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
      <thead><tr><th>Date</th><th>Bill of lading</th><th>Supplier</th><th class="impp-num">Weight</th><th class="impp-num">Qty</th><th class="impp-num">Cntrs</th><th>Description</th></tr></thead>
      <tbody>${p.recent
        .map(
          (r) => `<tr><td>${esc(r.date)}</td><td><span class="impp-hschip">${esc(r.bol)}</span></td><td title="${esc(r.supplier)}"><span class="impp-supn">${flag(r.country)} ${esc(r.supplier)}</span></td><td class="impp-num">${r.weight == null ? '—' : N(r.weight) + ' kg'}</td><td class="impp-num">${r.qty == null ? '—' : N(r.qty) + (r.unit ? ' ' + esc(r.unit) : '')}</td><td class="impp-num">${r.containers == null ? '—' : N(r.containers)}</td><td title="${esc(r.product || '')}">${esc(r.product || '—')}</td></tr>`,
        )
        .join('')}</tbody></table></div><p class="impp-scrollnote">Swipe the table sideways to see every column.</p>`
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
      ? `Reveal the decision-maker on this lane — a verified email, a role-based email, or the phone &amp; address on file. You have <b>${reveal.remaining}</b> free reveal${reveal.remaining === 1 ? '' : 's'} to start; Leads Pro includes ${LEADS_PRO_MONTHLY_ALLOWANCE} reveals every month.`
      : `You've used your ${FREE_REVEAL_TASTE} free contact reveals. Leads Pro includes <b>${LEADS_PRO_MONTHLY_ALLOWANCE}</b> decision-maker reveals every month${reveal.comingSoon ? ' — coming soon.' : ` for $${LEADS_PRO_PRICE_USD}/mo.`}`;

  const contactBody = `
    <p class="lead">${revealLead}</p>
    <div class="impp-lockcard" id="impp-reveal-card">
      <span class="ico" aria-hidden="true">\u{1F513}</span>
      <div class="lk">
        <div class="lt">Decision-maker contact ${revealChip}</div>
        <div class="ls">We resolve the best available tier — a verified decision-maker email, a role-based email, or the phone &amp; address on file. We never show a fabricated contact.</div>
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
    { id: 'products', label: 'Product breakdown', sub: `${p.hsBreakdown.length} HS codes`, body: hsBody, open: true },
    { id: 'origins', label: 'Imports by origin country', sub: `${p.origins.length} countries`, body: originBody, open: true },
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
      ${secs.map((s, i) => section(s, s.open ?? i === 0)).join('')}
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
    var badge = conf==='verified' ? 'Verified decision-maker' : (conf==='role_based' ? 'Role-based email (unverified)' : 'Phone & address on file');
    var out = ['<div class="impp-rvc">','<span class="impp-rvc-badge '+conf+'">'+e2(badge)+'</span>'];
    if(c.contact_name){ out.push('<div class="impp-rvc-name">'+e2(c.contact_name)+'</div>'); }
    if(c.title){ out.push('<div class="impp-rvc-title">'+e2(c.title)+'</div>'); }
    if(c.email){
      var cf = (c.email_confidence!=null) ? ' <span class="impp-rvc-conf">('+e2(c.email_confidence)+'% confidence)</span>' : '';
      out.push('<div class="impp-rvc-row">Email: <a href="mailto:'+e2(c.email)+'">'+e2(c.email)+'</a>'+cf+'</div>');
    }
    if(c.role_emails && c.role_emails.length){
      out.push('<div class="impp-rvc-row">Role inboxes: '+c.role_emails.map(function(x){return '<a href="mailto:'+e2(x)+'">'+e2(x)+'</a>';}).join(' &middot; ')+'</div>');
    }
    if(c.phone){ out.push('<div class="impp-rvc-row">Phone: <a href="tel:'+e2(c.phone)+'">'+e2(c.phone)+'</a></div>'); }
    if(c.address){ out.push('<div class="impp-rvc-row">Address: '+e2(c.address)+'</div>'); }
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
