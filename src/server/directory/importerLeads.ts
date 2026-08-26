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
 * Keys are read from process.env at call time. An unset key throws a clean
 * runtime Error the caller surfaces as a 503-style message — it is deliberately
 * NOT part of the config schema, so a missing key never crashes boot.
 *
 * Env: IMPORTYETI_API_KEY, HUNTER_API_KEY, ANTHROPIC_API_KEY
 */

/** Hard cap on leads returned per request (cost + latency guard). */
export const MAX_LEADS = 25;
/** Max concurrent enrichment / draft calls (bounded fan-out). */
export const ENRICH_CONCURRENCY = 3;
/** Per-external-call timeout in ms. */
export const EXTERNAL_TIMEOUT_MS = 12_000;

/** A raw ImportYeti bill-of-lading row (loose — the upstream schema is wide). */
export type BolRow = Record<string, unknown>;

export interface ImporterFilters {
  entryPort?: string;
  product?: string;
  hsCode?: string;
  supplierCountry?: string;
  startDate?: string;
  endDate?: string;
  /** Post-pull filters (ImportYeti has no server-side param for these). */
  state?: string;
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
  state: string | null;
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
  draft_email?: string | null;
}

/* ── timeout wrapper ─────────────────────────────────────────────────────────
 * Every external call goes through here so a hung provider trips an AbortError
 * at EXTERNAL_TIMEOUT_MS instead of holding the request open indefinitely. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = EXTERNAL_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

/* ── 1. ImportYeti: pull US-import bill-of-lading records ───────────────────
 * GET https://data.importyeti.com/v1.0/powerquery/us-import/bols (Bearer auth).
 * bol_type="H" = house bill = the REAL consignee (not the NVOCC master).
 * Response: { requestCost, creditsRemaining, data:{ data:[ <bol rows> ] } }. */
export async function pullImportBols(
  {
    entryPort,
    product,
    hsCode,
    supplierCountry,
    startDate,
    endDate,
  }: Pick<ImporterFilters, 'entryPort' | 'product' | 'hsCode' | 'supplierCountry' | 'startDate' | 'endDate'> = {},
  { bolType = 'H', pageSize = 50, page = 1 }: { bolType?: string; pageSize?: number; page?: number } = {},
): Promise<{ rows: BolRow[]; cost: number | null; creditsRemaining: number | null }> {
  const key = process.env.IMPORTYETI_API_KEY;
  if (!key) throw new Error('IMPORTYETI_API_KEY not set');
  const qs = new URLSearchParams();
  if (entryPort) qs.set('entry_port', entryPort);
  if (product) qs.set('product_description', product);
  if (hsCode) qs.set('hs_code', hsCode);
  if (supplierCountry) qs.set('supplier_country', supplierCountry);
  if (startDate) qs.set('start_date', startDate);
  if (endDate) qs.set('end_date', endDate);
  if (bolType) qs.set('bol_type', bolType);
  qs.set('page_size', String(pageSize));
  qs.set('page', String(page));
  const r = await fetchWithTimeout(
    `https://data.importyeti.com/v1.0/powerquery/us-import/bols?${qs}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) throw new Error(`ImportYeti ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { requestCost?: number; creditsRemaining?: number; data?: { data?: BolRow[] } };
  return {
    rows: j.data?.data ?? [],
    cost: j.requestCost ?? null,
    creditsRemaining: j.creditsRemaining ?? null,
  };
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
export async function enrichContact(companyName: string): Promise<EnrichedContact | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) throw new Error('HUNTER_API_KEY not set');
  // limit MUST be <= 10 (Hunter free/starter cap + our cost guard).
  const r = await fetchWithTimeout(
    `https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(companyName)}&api_key=${key}&limit=10`,
  );
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: { domain?: string; emails?: Array<Record<string, unknown>> } };
  const d = j.data || {};
  const domain = d.domain || null;
  const emails = d.emails || [];
  if (!domain || !emails.length) return null;
  if (!domainMatchesCompany(companyName, domain)) return null; // fuzzy-drift guard
  const ranked = [...emails].sort((a, b) => num(b.confidence) - num(a.confidence));
  const dm = ranked.find((e) => TARGET_TITLE_RX.test(str(e.position))) || ranked[0];
  const name = [dm.first_name, dm.last_name].filter(Boolean).join(' ') || null;
  return {
    domain,
    contact_name: name,
    title: (dm.position as string) || null,
    email: (dm.value as string) || null,
    email_confidence: dm.confidence == null ? null : num(dm.confidence),
    linkedin: (dm.linkedin as string) || null,
  };
}

/* ── 4. Merge BOL record (+ optional enrichment) → clean lead ───────────────*/
export function toLead(r: BolRow, contact?: EnrichedContact | null): ImporterLead {
  const addr = str(r.company_address);
  const derivedState = (addr.match(/,\s*([A-Z]{2})\s/) || [])[1] || (r.company_state as string) || null;
  return {
    company: str(r.company_name),
    state: derivedState,
    supplier: (r.supplier_name as string) || null,
    supplier_country: (r.supplier_country_code as string) || null,
    product: (r.product_description as string) || (r.hs_code_description as string) || null,
    hs_code: (r.hs_code as string) || null,
    entry_port: (r.entry_port as string) || null,
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
    const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body,
    });
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

/* ── post-pull filters (ImportYeti has no server-side param for these) ──────*/
function applyPostFilters(leads: ImporterLead[], f: ImporterFilters): ImporterLead[] {
  let out = leads;
  if (f.state) {
    const st = f.state.trim().toUpperCase();
    out = out.filter((l) => (l.state || '').toUpperCase() === st);
  }
  if (f.company) {
    const q = f.company.trim().toLowerCase();
    if (q) out = out.filter((l) => l.company.toLowerCase().includes(q));
  }
  if (f.minShipments12m) out = out.filter((l) => (l.ships_12m ?? 0) >= f.minShipments12m!);
  if (f.minTeu12m) out = out.filter((l) => (l.teu_12m ?? 0) >= f.minTeu12m!);
  return out;
}

/* ── Orchestration: one request → leads (+ optional enrichment / drafts) ────
 * Browse path calls this with enrichment + emails OFF (ImportYeti only). The
 * enrich/draft fan-out is concurrency-capped so a batch can't stampede the
 * providers. `maxLeads` is clamped to MAX_LEADS. */
export async function findImporterLeads({
  filters = {},
  maxLeads = MAX_LEADS,
  withEnrichment = false,
  withEmails = false,
  concurrency = ENRICH_CONCURRENCY,
}: {
  filters?: ImporterFilters;
  maxLeads?: number;
  withEnrichment?: boolean;
  withEmails?: boolean;
  concurrency?: number;
} = {}): Promise<{ leads: ImporterLead[]; creditsRemaining: number | null }> {
  const cap = Math.max(1, Math.min(maxLeads, MAX_LEADS));
  // Pull generously (dedup collapses many BOL rows per importer), then cap.
  const { rows, creditsRemaining } = await pullImportBols(filters, {
    pageSize: Math.max(50, cap * 4),
  });
  const importers = dedupImporters(rows);
  // Base leads (no enrichment) — cheap, so build all then post-filter, then cap.
  const base = applyPostFilters(importers.map((r) => toLead(r)), filters).slice(0, cap);

  if (!withEnrichment && !withEmails) {
    return { leads: base, creditsRemaining };
  }

  // Enrichment / drafting fan-out — bounded concurrency, never unbounded.
  const rowByCompany = new Map(importers.map((r) => [str(r.company_name), r]));
  const leads = await mapLimit(base, concurrency, async (lead) => {
    const row = rowByCompany.get(lead.company);
    const contact = withEnrichment ? await enrichContact(lead.company).catch(() => null) : null;
    const merged = row ? toLead(row, contact) : { ...lead, ...(contact ?? {}) };
    if (withEmails) merged.draft_email = await draftEmail(merged).catch(() => null);
    return merged;
  });
  return { leads, creditsRemaining };
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
