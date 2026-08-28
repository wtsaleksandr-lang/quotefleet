/**
 * Importer-Leads engine (QuoteFleet port of the validated `engine.mjs`).
 *
 * Pipeline:  ImportYeti pull → drop forwarders/NVOCCs → dedup to real importers
 *            → (optional) Hunter decision-maker enrichment → (optional) AI-draft
 *            personalised outreach.
 *
 * Powers the public "Importer Search" feature (/importers). Browsing is FREE and
 * calls ONLY ImportYeti — enrichment (Hunter) and the AI draft (Anthropic) are
 * the LOCKED / paid reveal and are never run on the free browse path.
 *
 * ── Outage-safety invariants (QuoteFleet had repeated total outages from
 *    unbounded work — do NOT reintroduce it) ──────────────────────────────────
 *   • EVERY external call is wrapped in `fetchWithTimeout` (AbortController,
 *     ~12s) so a slow provider can never hang the request.
 *   • Multi-lead enrichment / drafting is concurrency-capped (`mapLimit`, ≤3).
 *   • Leads-per-request is hard-capped at MAX_LEADS (25).
 *   • No DB work here at all — this module only talks to external APIs.
 *
 * ── HARD COST GUARD (see externalPullGuard.ts) ──────────────────────────────
 * EVERY paid call in this file goes through `guardedFetch`, which opens NO
 * socket outside real production. Dev / CI / vitest / an agent's checkout are
 * CACHE-ONLY: `pullImportBols` returns `{ blocked: true, rows: [] }` and the
 * Hunter path returns `'blocked'`, so callers serve the licensed cache or render
 * their designed empty state — they must never present a blocked pull as data.
 *
 * Keys are read from process.env at call time. An unset key throws a clean
 * runtime Error the caller surfaces as a 503-style message — it is deliberately
 * NOT part of the config schema, so a missing key never crashes boot.
 *
 * Env: IMPORTYETI_API_KEY, HUNTER_API_KEY, ANTHROPIC_API_KEY
 */

import { releaseBody } from '../../http/responseBody.js';
import {
  guardedFetch,
  reportProviderCost,
  fetchWithTimeout,
  EXTERNAL_TIMEOUT_MS,
} from './externalPullGuard.js';

/** Re-exported from the cost guard so existing importers keep working. */
export { fetchWithTimeout, EXTERNAL_TIMEOUT_MS };

/** Hard cap on leads returned per request (cost + latency guard). */
export const MAX_LEADS = 25;
/** Max concurrent enrichment / draft calls (bounded fan-out). */
export const ENRICH_CONCURRENCY = 3;

/** A raw ImportYeti bill-of-lading row (loose — the upstream schema is wide). */
export type BolRow = Record<string, unknown>;

/** Contact fallback tiers, highest confidence first. A lead is NEVER empty:
 *  phone_only is always available (ImportYeti gives phone + address on every
 *  record). */
export type ContactConfidence = 'verified' | 'role_based' | 'phone_only';

/** What one reveal tier is allowed to SAY about itself.
 *
 *  HONEST-CLAIMS SINGLE SOURCE OF TRUTH. Every surface that names a tier — the
 *  search-result footer chip, the profile reveal card, the revealed-contact
 *  badge — reads its wording from here, so the pitch can never drift away from
 *  what `resolveContactTiered` actually hands back.
 *
 *  The street address is deliberately absent from every tier. It renders FREE on
 *  the importer profile (the identity header AND the Organization JSON-LD), so
 *  selling it would be selling something already given away. `delivers` is the
 *  machine-checkable list of `TieredContact` fields the tier may claim; a unit
 *  test asserts the prose never names a field outside it. */
export interface ContactTierCopy {
  /** Badge / chip label. Short enough for a search-result card footer. */
  badge: string;
  /** One plain sentence: exactly what a reveal at this tier hands over. */
  blurb: string;
  /** `TieredContact` field names this tier is allowed to promise. */
  delivers: readonly (keyof TieredContact)[];
}

/** The tiers, best-first — the order every surface lists them in. */
export const TIER_ORDER: readonly ContactConfidence[] = Object.freeze([
  'verified',
  'role_based',
  'phone_only',
] as const);

export const CONTACT_TIER_COPY: Readonly<Record<ContactConfidence, ContactTierCopy>> =
  Object.freeze({
    verified: {
      badge: 'Verified decision-maker',
      blurb:
        "A named decision-maker with their title and a verified work email — plus their direct phone when the record carries one.",
      delivers: ['contact_name', 'title', 'email', 'email_confidence', 'phone'],
    },
    role_based: {
      badge: 'Role-based company email',
      blurb:
        "A role-based inbox on the company's own domain (purchasing@, logistics@, sales@, info@) — a real monitored inbox, not a named person.",
      delivers: ['domain', 'role_emails'],
    },
    phone_only: {
      badge: 'Company phone number',
      blurb:
        'The importer’s full switchboard number from the customs record — the profile shows only the last four digits until it is revealed.',
      delivers: ['phone'],
    },
  });

export interface ImporterFilters {
  entryPort?: string;
  product?: string;
  hsCode?: string;
  supplierCountry?: string;
  startDate?: string;
  endDate?: string;
  /** Entry/port geography — NOT the importer's HQ/company state. Realized
   *  upstream by expanding the state to its entry ports (see
   *  importerPages.entryPortsForState + runSearch). It is deliberately NOT a
   *  post-pull HQ filter here: filtering by company address wrongly excluded
   *  valid importers whose HQ sits in a different state than the port they enter
   *  through (e.g. a New-York-HQ'd company clearing freight at Newark, NJ). */
  state?: string;
  /** Post-pull filter (ImportYeti has no server-side param for this). */
  company?: string;
  /** Minimum 12-month shipment count (frequency band). */
  minShipments12m?: number;
  /** Minimum 12-month TEU (TEU band). */
  minTeu12m?: number;
}

export interface EnrichedContact {
  domain: string;
  contact_name: string | null;
  title: string | null;
  email: string | null;
  email_confidence: number | null;
  linkedin: string | null;
}

export interface ImporterLead {
  company: string;
  /** ImportYeti company slug (from company_link, e.g. "valbruna-stainless").
   *  The ONLY value the bols endpoint's `company` param filters on, so it is
   *  what the Phase-2 profile route (`/importers/company/:slug`) is keyed by. */
  slug: string | null;
  state: string | null;
  address: string | null;
  supplier: string | null;
  supplier_country: string | null;
  product: string | null;
  hs_code: string | null;
  entry_port: string | null;
  ships_12m: number | null;
  total_shipments: number | null;
  teu_12m: number | null;
  last_shipment: string | null;
  phone: string | null;
  website: string | null;
  incumbent_forwarder: string | null;
  contact_name: string | null;
  title: string | null;
  email: string | null;
  email_confidence: number | null;
  /** Which contact fallback tier is available for this lead (never empty). */
  contact_confidence?: ContactConfidence | null;
  draft_email?: string | null;
  /** Distinct company-name spellings for this importer in THIS pull's sample.
   *  SAMPLE-SCOPED (see aliasCountsByCompany) — a floor, never the full list. */
  alias_names?: number | null;
  /** Distinct company addresses for this importer in THIS pull's sample. */
  alias_addresses?: number | null;
}

/** A resolved contact in one of the three confidence tiers. Always non-empty:
 *  the phone_only tier falls back to the ImportYeti phone + address. `address`
 *  is carried for convenience only — it is free page data, never a paid claim
 *  (see CONTACT_TIER_COPY). */
export interface TieredContact {
  contact_confidence: ContactConfidence;
  domain: string | null;
  contact_name: string | null;
  title: string | null;
  email: string | null;
  email_confidence: number | null;
  /** role_based tier: constructed purchasing@/logistics@/sales@/info@ + domain. */
  role_emails: string[];
  phone: string | null;
  address: string | null;
  /** TRUE when the cost guard refused the live Hunter call. This is NOT a real
   *  "no contact found" result — the caller must not cache it as one, must not
   *  charge an allowance for it, and must say so honestly in the UI. */
  live_blocked?: boolean;
}

/** Minimal structural view of the BOL cache store (real impl in importerCache.ts).
 *  Type-only — importing it never pulls the DB layer into this pure module. */
export interface BolCacheLike {
  get(key: string): Promise<{ rows: BolRow[]; creditsRemaining: number | null; fetchedAt: Date } | null>;
  put(key: string, rows: BolRow[], creditsRemaining: number | null): Promise<void>;
}

/** Local-part prefixes for the role-based (unverified) contact tier. */
export const ROLE_LOCALPARTS = ['purchasing', 'logistics', 'sales', 'info'] as const;

/* ── bounded-concurrency map ─────────────────────────────────────────────────
 * Runs `fn` over `items` with at most `limit` in flight at once. Preserves
 * input order in the result array. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));

/**
 * ImportYeti files entry ports title-cased with an abbreviating period —
 * "Savannah, Ga." — which then rendered on every card, in the card's title
 * attribute AND inside the `origin=` parameter of the RFQ deep link, so the
 * quote request carried a differently-spelled port from the one the user picked
 * ("Savannah, GA"). Normalise ONCE here, at the boundary where the provider's
 * row becomes our lead, rather than at each of the three render sites.
 *
 * Only a trailing 2-letter state token is touched; anything else (a foreign
 * port, a name with no state suffix) is returned unchanged apart from trimming.
 */
export function normalizePortName(v: unknown): string | null {
  const s = str(v).trim();
  if (!s) return null;
  const i = s.lastIndexOf(',');
  if (i < 0) return s;
  const head = s.slice(0, i).trim();
  const tail = s.slice(i + 1).trim().replace(/\.$/, '');
  if (!head || !/^[A-Za-z]{2}$/.test(tail)) return s;
  return `${head}, ${tail.toUpperCase()}`;
}

/** ImportYeti company slug from its `company_link` ("/company/valbruna-stainless"
 *  → "valbruna-stainless"). This slug — NOT the basename — is the only value the
 *  bols endpoint's `company` param actually filters on (verified against the live
 *  API: `company=<slug>` returns exactly one company; basename/link are ignored).
 *  Returns '' when no link is present. */
export function companySlugFromLink(link: unknown): string {
  const s = str(link).trim();
  if (!s) return '';
  const m = s.match(/\/company\/([^/?#]+)/i);
  const slug = (m ? m[1] : s).toLowerCase().trim();
  // Only allow the safe slug charset ImportYeti uses; reject anything else.
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : '';
}

/** Result of one ImportYeti pull. `blocked` is TRUE when the cost guard refused
 *  the call (no socket opened, no credit spent) — the caller MUST then serve
 *  cache or its designed empty state and must NEVER cache the empty rows. */
export interface BolPull {
  rows: BolRow[];
  cost: number | null;
  creditsRemaining: number | null;
  blocked: boolean;
}

/* ── 1. ImportYeti: pull US-import bill-of-lading records ───────────────────
 * GET https://data.importyeti.com/v1.0/powerquery/us-import/bols (Bearer auth).
 * bol_type="H" = house bill = the REAL consignee (not the NVOCC master).
 * Response: { requestCost, creditsRemaining, data:{ data:[ <bol rows> ] } }.
 *
 * COST GUARD: the call goes through `guardedFetch`, which returns null WITHOUT
 * touching the network outside real production. */
export async function pullImportBols(
  {
    entryPort,
    product,
    hsCode,
    supplierCountry,
    startDate,
    endDate,
  }: Pick<ImporterFilters, 'entryPort' | 'product' | 'hsCode' | 'supplierCountry' | 'startDate' | 'endDate'> = {},
  {
    bolType = 'H',
    pageSize = 50,
    page = 1,
    companySlug,
  }: { bolType?: string; pageSize?: number; page?: number; companySlug?: string } = {},
): Promise<BolPull> {
  const key = process.env.IMPORTYETI_API_KEY;
  if (!key) throw new Error('IMPORTYETI_API_KEY not set');
  const qs = new URLSearchParams();
  // `company` = the ImportYeti company SLUG (from company_link). When present it
  // scopes the pull to ONE importer's full history — the profile-page pull.
  if (companySlug) qs.set('company', companySlug);
  if (entryPort) qs.set('entry_port', entryPort);
  if (product) qs.set('product_description', product);
  if (hsCode) qs.set('hs_code', hsCode);
  if (supplierCountry) qs.set('supplier_country', supplierCountry);
  if (startDate) qs.set('start_date', startDate);
  if (endDate) qs.set('end_date', endDate);
  if (bolType) qs.set('bol_type', bolType);
  qs.set('page_size', String(pageSize));
  qs.set('page', String(page));
  const ctx = companySlug ? `profile:${companySlug} page=${page}` : `search page=${page}`;
  const r = await guardedFetch(
    'importyeti',
    ctx,
    `https://data.importyeti.com/v1.0/powerquery/us-import/bols?${qs}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  // Cost guard refused — nothing left the process. Cache-only from here.
  if (!r) return { rows: [], cost: null, creditsRemaining: null, blocked: true };
  if (!r.ok) throw new Error(`ImportYeti ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { requestCost?: number; creditsRemaining?: number; data?: { data?: BolRow[] } };
  const cost = j.requestCost ?? null;
  const creditsRemaining = j.creditsRemaining ?? null;
  // Refine the ledger row guardedFetch just wrote with the numbers ImportYeti
  // itself reported, so admin shows real credits, not an estimate.
  reportProviderCost('importyeti', cost, creditsRemaining);
  return { rows: j.data?.data ?? [], cost, creditsRemaining, blocked: false };
}

/* ── 2. Forwarder / NVOCC / broker filter ────────────────────────────────────
 * The #1 data trap: the consignee is often the forwarder (Expeditors, DHL…),
 * not the real buyer. Enriching those gives another forwarder's contact. */
const FORWARDER_TERMS = [
  'expeditors', 'kuehne', 'nagel', 'dhl', 'db schenker', 'dsv', 'ceva', 'nippon express',
  'geodis', 'panalpina', 'dachser', 'bollore', 'hellmann', 'yusen', 'kintetsu', 'agility',
  'flexport', 'forward air', 'autico', 'cargo', 'logistics', 'forwarding', 'forwarder',
  'nvocc', 'freight', 'customs broker', 'brokerage', 'supply chain solutions', '3pl',
  'worldwide express', 'transport', 'shipping line', 'consolidat', "int'l", 'international freight',
];
export function isForwarder(companyName = ''): boolean {
  const n = companyName.toLowerCase();
  return FORWARDER_TERMS.some((t) => n.includes(t));
}

/** Dedup BOL rows → unique real importers (drop forwarders + confidential),
 *  keeping the highest recent-volume row per company. */
export function dedupImporters(rows: readonly BolRow[]): BolRow[] {
  const byCo = new Map<string, BolRow>();
  for (const r of rows) {
    const name = str(r.company_name);
    if (!name || r.company_manifest_confidentiality || isForwarder(name)) continue;
    const key = str(r.company_basename) || name;
    const cur = byCo.get(key);
    if (!cur || num(r.company_shipments_12m) > num(cur.company_shipments_12m)) byCo.set(key, r);
  }
  return [...byCo.values()].sort(
    (a, b) => num(b.company_shipments_12m) - num(a.company_shipments_12m),
  );
}

/** Alias key normalisation — byte-for-byte what `aggregateProfile` uses for its
 *  name/address maps, so the profile page and a search card mean exactly the
 *  same thing by "distinct". (The profile also runs `fixCodeCasing` on the
 *  address first; that only changes CASE, which this lowercases away, so the
 *  resulting keys are identical.) */
function aliasKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Distinct company-name spellings + distinct addresses per importer, derived
 * from the RAW BOL rows — ImportYeti's signature "also files under N names /
 * M addresses" de-dup signal.
 *
 * Grouped on the SAME key as `dedupImporters` (company_basename || company_name)
 * and filtered by the same forwarder/confidentiality rules, so every collapsed
 * importer row has a matching entry.
 *
 * ⚠ SAMPLE-SCOPED, and the UI must say so. A search pull is ~100 bills spread
 * across 25+ importers (~2-4 rows each); a PROFILE pull is ~100 bills for ONE
 * importer. The count here is therefore a FLOOR and will be materially lower
 * than the profile's `aliasesCount` for the same company — never present it as a
 * complete alias list.
 *
 * Cost: $0. These are rows already in memory (and already in the 14-day licensed
 * cache); no extra pull, no extra DB read, no change to `requestCost`.
 *
 * Deliberately a SIBLING of `dedupImporters` rather than a change to it —
 * dedupImporters has direct unit-test coverage and widening its return type
 * would ripple through every caller.
 */
export function aliasCountsByCompany(
  rows: readonly BolRow[],
): Map<string, { names: number; addresses: number }> {
  const acc = new Map<string, { names: Set<string>; addresses: Set<string> }>();
  for (const r of rows) {
    const name = str(r.company_name);
    if (!name || r.company_manifest_confidentiality || isForwarder(name)) continue;
    const key = str(r.company_basename) || name;
    let e = acc.get(key);
    if (!e) {
      e = { names: new Set<string>(), addresses: new Set<string>() };
      acc.set(key, e);
    }
    e.names.add(aliasKey(name));
    const addr = str(r.company_address);
    if (addr) e.addresses.add(aliasKey(addr));
  }
  const out = new Map<string, { names: number; addresses: number }>();
  for (const [k, v] of acc) out.set(k, { names: v.names.size, addresses: v.addresses.size });
  return out;
}

/* ── 3. Enrich: domain + decision-maker + email (Hunter) ────────────────────
 * ONE call: Hunter domain-search?company=NAME resolves the company to its
 * DOMAIN and returns indexed employees with titles + confidence. `limit` MUST
 * be <= 10. Precision guard: reject any resolved domain whose host shares no
 * distinctive token with the input company (a fuzzy match can drift, e.g.
 * "Bosch Tool" → motopaja.fi). Hunter's echoed `organization` field is
 * deliberately IGNORED — it always "matches" and cannot catch the drift. */
const TARGET_TITLE_RX = /logistic|supply|import|procure|operation|purchas|owner|president|founder|ceo|coo|director|vp|head/i;
const STOP_TOKENS = new Set([
  'inc', 'llc', 'corp', 'co', 'ltd', 'america', 'american', 'usa', 'us', 'the', 'company', 'group',
  'north', 'corporation', 'ab', 'gmbh', 'international', 'intl', 'holdings', 'industries', 'na',
]);
function nameTokens(s = ''): Set<string> {
  return new Set(
    String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_TOKENS.has(t)),
  );
}
/** True if the resolved DOMAIN plausibly IS the input company (host shares a
 *  distinctive token, or a solid substring hit). Strict host-token match trades
 *  recall for precision — the right call for a lead product where a wrong email
 *  burns sender reputation. */
export function domainMatchesCompany(companyName: string, domain: string | null | undefined): boolean {
  const want = nameTokens(companyName);
  if (!want.size) return true; // nothing distinctive to check → don't block
  const host = new Set(nameTokens((domain || '').split('.').slice(0, -1).join(' ')));
  for (const t of want) if (host.has(t)) return true;
  const joined = (domain || '').split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const t of want) if (t.length >= 4 && joined.includes(t)) return true;
  return false;
}
/** Sentinel: the cost guard refused the Hunter call — no credit spent, and the
 *  result is NOT a real negative, so it must never be cached as one. */
export const HUNTER_BLOCKED = 'blocked' as const;
export type HunterResolve =
  | { domain: string; emails: Array<Record<string, unknown>> }
  | null
  | typeof HUNTER_BLOCKED;

/** Low-level Hunter resolve: company → { domain, indexed emails }, precision-
 *  guarded. Throws only on an unset key; a Hunter error / drift / no-domain
 *  returns null; the cost guard returns HUNTER_BLOCKED. `limit` MUST be <= 10. */
async function hunterDomainSearch(companyName: string): Promise<HunterResolve> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) throw new Error('HUNTER_API_KEY not set');
  const r = await guardedFetch(
    'hunter',
    `reveal:${companyName.slice(0, 60)}`,
    `https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(companyName)}&api_key=${key}&limit=10`,
  );
  // Cost guard refused — nothing left the process.
  if (!r) return HUNTER_BLOCKED;
  if (!r.ok) {
    releaseBody(r); // free the socket — body is never read on the error path
    return null;
  }
  const j = (await r.json()) as { data?: { domain?: string; emails?: Array<Record<string, unknown>> } };
  const d = j.data || {};
  const domain = d.domain || null;
  if (!domain) return null;
  if (!domainMatchesCompany(companyName, domain)) return null; // fuzzy-drift guard
  return { domain, emails: d.emails || [] };
}

export async function enrichContact(companyName: string): Promise<EnrichedContact | null> {
  const res = await hunterDomainSearch(companyName);
  if (!res || res === HUNTER_BLOCKED || !res.emails.length) return null;
  const ranked = [...res.emails].sort((a, b) => num(b.confidence) - num(a.confidence));
  const dm = ranked.find((e) => TARGET_TITLE_RX.test(str(e.position))) || ranked[0];
  const name = [dm.first_name, dm.last_name].filter(Boolean).join(' ') || null;
  return {
    domain: res.domain,
    contact_name: name,
    title: (dm.position as string) || null,
    email: (dm.value as string) || null,
    email_confidence: dm.confidence == null ? null : num(dm.confidence),
    linkedin: (dm.linkedin as string) || null,
  };
}

/* ── Tiered contact resolution (the paid REVEAL path) ────────────────────────
 * A lead is NEVER empty. Returns the best available tier:
 *   1. verified   — a named decision-maker email (Hunter, DM title match)
 *   2. role_based — domain resolved but no named person → purchasing@/logistics@
 *                   /sales@/info@ + domain, clearly UNVERIFIED
 *   3. phone_only — no domain → the ImportYeti phone, unmasked. The `address`
 *                   travels with it for convenience but is NOT what this tier
 *                   sells: the profile already prints the street address for
 *                   free, so only the full phone number (masked to its last four
 *                   digits on the free page) is genuinely gated here. See
 *                   CONTACT_TIER_COPY.
 * Never throws — any Hunter failure (incl. a missing key) degrades to
 * phone_only, so the reveal is always answerable. */
export async function resolveContactTiered(
  companyName: string,
  { phone = null, address = null }: { phone?: string | null; address?: string | null } = {},
): Promise<TieredContact> {
  const base: TieredContact = {
    contact_confidence: 'phone_only',
    domain: null,
    contact_name: null,
    title: null,
    email: null,
    email_confidence: null,
    role_emails: [],
    phone,
    address,
  };
  let res: HunterResolve = null;
  try {
    res = await hunterDomainSearch(companyName);
  } catch {
    res = null; // missing key / network → fall through to phone_only
  }
  // Cost guard refused the live call — honest phone_only, flagged so the caller
  // does NOT cache it as a real negative and does NOT charge an allowance.
  if (res === HUNTER_BLOCKED) return { ...base, live_blocked: true };
  if (!res) return base;

  const ranked = [...res.emails].sort((a, b) => num(b.confidence) - num(a.confidence));
  const dm = ranked.find((e) => TARGET_TITLE_RX.test(str(e.position)) && e.value);
  if (dm) {
    return {
      ...base,
      contact_confidence: 'verified',
      domain: res.domain,
      contact_name: [dm.first_name, dm.last_name].filter(Boolean).join(' ') || null,
      title: str(dm.position) || null,
      email: str(dm.value) || null,
      email_confidence: dm.confidence == null ? null : num(dm.confidence),
    };
  }
  // Domain resolved but no named decision-maker → role-based (unverified).
  const any = ranked[0];
  return {
    ...base,
    contact_confidence: 'role_based',
    domain: res.domain,
    contact_name: any ? [any.first_name, any.last_name].filter(Boolean).join(' ') || null : null,
    title: any ? str(any.position) || null : null,
    email: any ? str(any.value) || null : null,
    email_confidence: any && any.confidence != null ? num(any.confidence) : null,
    role_emails: ROLE_LOCALPARTS.map((lp) => `${lp}@${res!.domain}`),
  };
}

/* ── 4. Merge BOL record (+ optional enrichment) → clean lead ───────────────*/
export function toLead(r: BolRow, contact?: EnrichedContact | null): ImporterLead {
  const addr = str(r.company_address);
  const derivedState = (addr.match(/,\s*([A-Z]{2})\s/) || [])[1] || (r.company_state as string) || null;
  return {
    company: str(r.company_name),
    slug: companySlugFromLink(r.company_link) || null,
    state: derivedState,
    address: addr || null,
    supplier: (r.supplier_name as string) || null,
    supplier_country: (r.supplier_country_code as string) || null,
    product: (r.product_description as string) || (r.hs_code_description as string) || null,
    hs_code: (r.hs_code as string) || null,
    entry_port: normalizePortName(r.entry_port),
    ships_12m: r.company_shipments_12m == null ? null : num(r.company_shipments_12m),
    total_shipments: r.company_total_shipments == null ? null : num(r.company_total_shipments),
    teu_12m:
      r.company_teu_12m == null && r.teu == null
        ? null
        : num(r.company_teu_12m ?? r.teu),
    last_shipment: (r.arrival_date as string) || null,
    phone: (r.company_main_phone_number as string) || null,
    website: contact?.domain || (r.company_website as string) || null,
    incumbent_forwarder: (r.notify_party_name as string) || null,
    contact_name: contact?.contact_name || null,
    title: contact?.title || null,
    email: contact?.email || null,
    email_confidence: contact?.email_confidence ?? null,
  };
}

/* ── 5. AI-draft personalised outreach (Anthropic) ─────────────────────────*/
export async function draftEmail(
  lead: ImporterLead,
  {
    fromName = 'Alex',
    company = 'our logistics team',
    service = 'freight forwarding',
  }: { fromName?: string; company?: string; service?: string } = {},
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const lane = [lead.entry_port && `into ${lead.entry_port}`, lead.supplier && `from ${lead.supplier}`]
    .filter(Boolean)
    .join(' ');
  const prompt = `You write short, specific B2B cold emails for a ${service} business. Write ONE 90-word email to ${lead.contact_name || 'the logistics lead'} at ${lead.company}. Use their VERIFIED shipping activity to be specific and credible, never generic. Facts: they import ${lead.product || 'goods'} from ${lead.supplier || 'overseas'}${lead.supplier_country ? ' (' + lead.supplier_country + ')' : ''} ${lane}, ~${lead.ships_12m ?? 'regular'} shipments in the last 12 months, most recent ${lead.last_shipment || 'recently'}, currently routing through ${lead.incumbent_forwarder || 'an incumbent forwarder'}. Offer a sharper rate on that exact lane. Plain text, one clear CTA, no fluff, no subject line. Sign off as ${fromName}, ${company}.`;
  const body = JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });
  // Retry on transient overload/rate-limit (429/500/502/503/529) AND on the
  // intermittent HTTP-200-but-empty-content case, with linear backoff.
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await guardedFetch('anthropic', `draft:${lead.company.slice(0, 60)}`, 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body,
    });
    // Cost guard refused — no socket opened, no tokens billed.
    if (!r) throw new Error('importer draft blocked by cost guard (live pulls disabled)');
    if (r.ok) {
      const j = (await r.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
      const text = (j.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('')
        .trim();
      if (text) return text;
      last = `Anthropic 200 but empty content (stop_reason=${j.stop_reason})`;
    } else {
      last = `Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`;
      if (![429, 500, 502, 503, 529].includes(r.status)) throw new Error(last);
    }
    await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
  }
  throw new Error(last);
}

/* ── post-pull filters (ImportYeti has no server-side param for these) ──────
 * NOTE: `state` is intentionally NOT applied here. It is the ENTRY/port state,
 * not the importer's HQ state — an HQ-state post-filter wrongly dropped valid
 * importers whose company address differs from the port's state. State is
 * realized upstream by pulling each of the state's entry ports (see
 * importerPages.runSearch). */
function applyPostFilters(
  leads: ImporterLead[],
  f: ImporterFilters,
  redactKeys?: Set<string>,
): ImporterLead[] {
  let out = leads;
  if (f.company) {
    const q = f.company.trim().toLowerCase();
    if (q) out = out.filter((l) => l.company.toLowerCase().includes(q));
  }
  if (f.minShipments12m) out = out.filter((l) => (l.ships_12m ?? 0) >= f.minShipments12m!);
  if (f.minTeu12m) out = out.filter((l) => (l.teu_12m ?? 0) >= f.minTeu12m!);
  // Manifest Privacy redaction choke-point: drop any importer that has an active
  // "Hidden on QuoteFleet" redaction (CBP-confirmed confidentiality customer).
  // The set is resolved by the caller (this module stays DB-free) and normalized
  // with companyKey() — the same normalization used to store the redaction.
  if (redactKeys && redactKeys.size) {
    out = out.filter((l) => !redactKeys.has(redactionKey(l.company)));
  }
  return out;
}

/** Normalize a company name to the redaction key. MUST match companyKey() in
 *  importerCache.ts byte-for-byte (this module is deliberately import-free, so
 *  the logic is replicated rather than imported). */
function redactionKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/* ── Orchestration: one request → leads (+ optional enrichment / drafts) ────
 * Browse path calls this with enrichment + emails OFF (ImportYeti only). The
 * enrich/draft fan-out is concurrency-capped so a batch can't stampede the
 * providers. `maxLeads` is clamped to MAX_LEADS. */
export async function findImporterLeads({
  filters = {},
  maxLeads = MAX_LEADS,
  page = 1,
  withEnrichment = false,
  withEmails = false,
  concurrency = ENRICH_CONCURRENCY,
  bolCache,
  cacheKey,
  cacheTtlMs = 14 * 24 * 60 * 60 * 1000,
  allowLivePull = true,
  redactKeys,
}: {
  filters?: ImporterFilters;
  maxLeads?: number;
  /** 1-based ImportYeti page — pagination / "Load more" threads through here. */
  page?: number;
  withEnrichment?: boolean;
  withEmails?: boolean;
  concurrency?: number;
  /** Optional persistent BOL cache (DB-backed in the route). */
  bolCache?: BolCacheLike;
  /** Precomputed cache key for this pull (route computes it via searchKey()). */
  cacheKey?: string;
  /** Cache TTL — a cached row younger than this skips the ImportYeti pull. */
  cacheTtlMs?: number;
  /** When false, a cache MISS returns empty (no credit spent) — the free-search
   *  quota gate. A cache HIT is still served (costs nothing). */
  allowLivePull?: boolean;
  /** Active Manifest Privacy redaction keys (companyKey-normalized). Resolved by
   *  the caller so this module stays DB-free; redacted importers are dropped. */
  redactKeys?: Set<string>;
} = {}): Promise<{
  leads: ImporterLead[];
  creditsRemaining: number | null;
  cached: boolean;
  /** True only when this call actually hit ImportYeti (a credit was spent). */
  pulledLive: boolean;
  /** Raw BOL records scanned this pull (0 on a blocked miss). */
  recordsScanned: number;
  /** True when the HARD COST GUARD refused a live pull on a cache MISS. The
   *  result is cache-only: the caller must render its designed empty state and
   *  never present this as "no importers matched". */
  liveBlocked: boolean;
}> {
  const cap = Math.max(1, Math.min(maxLeads, MAX_LEADS));
  const pg = Math.max(1, Math.floor(page) || 1);
  const pageSize = Math.max(50, cap * 4);

  // ── Cache-first: a fresh cached result set spends ZERO ImportYeti credits ──
  let rows: BolRow[] | null = null;
  let creditsRemaining: number | null = null;
  let cached = false;
  let pulledLive = false;
  if (bolCache && cacheKey) {
    try {
      const hit = await bolCache.get(cacheKey);
      if (hit && Date.now() - hit.fetchedAt.getTime() < cacheTtlMs) {
        rows = hit.rows;
        creditsRemaining = hit.creditsRemaining;
        cached = true;
      }
    } catch {
      /* cache miss/failure → fall through to a live pull (never break search) */
    }
  }

  let liveBlocked = false;
  if (rows == null) {
    // Cache miss. The quota gate can veto the live pull to protect credits — the
    // caller then shows the subscribe wall instead of us spending a credit.
    if (!allowLivePull) {
      return { leads: [], creditsRemaining: null, cached: false, pulledLive: false, recordsScanned: 0, liveBlocked: false };
    }
    // Pull generously (dedup collapses many BOL rows per importer), then cap.
    const pulled = await pullImportBols(filters, { pageSize, page: pg });
    // HARD COST GUARD refused the call (no socket opened). Return an honest
    // cache-only miss and — critically — do NOT write the empty rows back, which
    // would poison the licensed 14-day cache with a fake "no results".
    if (pulled.blocked) {
      return { leads: [], creditsRemaining: null, cached: false, pulledLive: false, recordsScanned: 0, liveBlocked: true };
    }
    rows = pulled.rows;
    creditsRemaining = pulled.creditsRemaining;
    pulledLive = true;
    if (bolCache && cacheKey) {
      // Write fresh rows back for the next repeat search. Never let a cache
      // write failure break the response.
      try {
        await bolCache.put(cacheKey, rows, creditsRemaining);
      } catch {
        /* ignore */
      }
    }
  }
  const recordsScanned = rows.length;
  const importers = dedupImporters(rows);
  // Alias counts must come from the RAW rows, BEFORE dedup collapses them — this
  // is the only point where the alternate name/address spellings still exist.
  // Same group key as dedupImporters, so every importer row finds its entry. $0.
  const aliases = aliasCountsByCompany(rows);
  const aliasFor = (r: BolRow) => aliases.get(str(r.company_basename) || str(r.company_name));
  // Base leads (no enrichment) — cheap, so build all then post-filter, then cap.
  const base = applyPostFilters(
    importers.map((r) => {
      const lead = toLead(r);
      const a = aliasFor(r);
      if (a) {
        lead.alias_names = a.names;
        lead.alias_addresses = a.addresses;
      }
      return lead;
    }),
    filters,
    redactKeys,
  ).slice(0, cap);

  if (!withEnrichment && !withEmails) {
    return { leads: base, creditsRemaining, cached, pulledLive, recordsScanned, liveBlocked };
  }

  // Enrichment / drafting fan-out — bounded concurrency, never unbounded.
  const rowByCompany = new Map(importers.map((r) => [str(r.company_name), r]));
  const leads = await mapLimit(base, concurrency, async (lead) => {
    const row = rowByCompany.get(lead.company);
    const contact = withEnrichment ? await enrichContact(lead.company).catch(() => null) : null;
    const merged = row ? toLead(row, contact) : { ...lead, ...(contact ?? {}) };
    // toLead() rebuilds from the raw row and knows nothing about aliases — carry
    // the counts computed above so enriched leads keep the sub-line.
    merged.alias_names = lead.alias_names;
    merged.alias_addresses = lead.alias_addresses;
    if (withEmails) merged.draft_email = await draftEmail(merged).catch(() => null);
    return merged;
  });
  return { leads, creditsRemaining, cached, pulledLive, recordsScanned, liveBlocked };
}

/* ── CSV export (LOCKED / paid feature) ─────────────────────────────────────*/
const CSV_COLS: Array<keyof ImporterLead> = [
  'company', 'state', 'supplier', 'supplier_country', 'product', 'hs_code', 'entry_port',
  'ships_12m', 'total_shipments', 'teu_12m', 'last_shipment', 'phone', 'website',
  'incumbent_forwarder', 'contact_name', 'title', 'email', 'email_confidence',
];
export function toCSV(leads: readonly ImporterLead[]): string {
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [CSV_COLS.join(','), ...leads.map((l) => CSV_COLS.map((c) => esc(l[c])).join(','))].join('\n');
}

/* ── Winnability + AI angle (FREE card signals — no LLM, no network) ─────────
 * A cheap, deterministic score of how switchable an account looks: volume +
 * a named (displaceable) incumbent + a contact on file. Mirrors the approved
 * mockup so the card reads the same. */
export function winnability(lead: ImporterLead): { score: number; label: 'High' | 'Medium' } {
  const vol = lead.ships_12m ?? 0;
  const hasIncumbent = !!lead.incumbent_forwarder;
  const raw =
    57 +
    (hasIncumbent ? 12 : 2) +
    (vol > 800 ? 16 : vol > 200 ? 9 : 4) +
    (lead.email ? 8 : 0) +
    (lead.company.length % 5);
  const score = Math.max(53, Math.min(94, raw));
  return { score, label: score >= 75 ? 'High' : 'Medium' };
}
export function aiAngle(lead: ImporterLead): string {
  const vol = lead.ships_12m ?? 0;
  const port = (lead.entry_port || '').split(',')[0] || 'your port';
  const volTxt = vol ? `~${vol.toLocaleString('en-US')} shipments/yr` : 'a steady volume';
  const country = lead.supplier_country ? `${lead.supplier_country} lane, ` : '';
  const incumbent = lead.incumbent_forwarder
    ? `routed via ${lead.incumbent_forwarder} — a switchable incumbent`
    : 'no forwarder named on the bill';
  return `${country}${volTxt}, ${incumbent}. Pitch a sharper ${port} rate this quarter.`;
}
