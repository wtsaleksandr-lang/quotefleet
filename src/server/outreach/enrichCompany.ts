/**
 * Company enrichment — Phase 1 foundation of the AI Outreach Engine.
 *
 * Turns a freight company's domain into a structured `CompanyProfile`:
 *   - DETERMINISTIC  — parsed from fetched HTML (homepage + best-effort
 *                      /services, /about). Company name, tagline, phone,
 *                      email, mailing address, detected service modes,
 *                      stated markets/lanes.
 *   - BRAND (best-effort) — brandColors + logoUrl derived from meta tags /
 *                      inline CSS, each flagged high/low confidence. Full
 *                      screenshot+vision color extraction is a deliberate
 *                      v1.1 follow-up (see fetchNotes).
 *   - AI-INFERRED    — tone, businessSummary, painPoints, quoteFleetAngle,
 *                      suggestedCalculator. Calls the app's EXISTING Anthropic
 *                      wrapper (`../../ai/client.ts` → complete()). When the AI
 *                      key is absent the profile degrades gracefully: `ai` is
 *                      null, `aiAvailable` false, and a note is added.
 *   - FMCSA (optional) — when FMCSA_WEBKEY is configured, look up MC/DOT +
 *                      firmographics via the free QCMobile API. Never fails the
 *                      whole enrich if FMCSA is down or unconfigured.
 *
 * This is PROFILE GENERATION ONLY. No demo provisioning, no email, no sending —
 * those are later PRs. Super-admin internal tool; nothing here is public.
 *
 * Robustness (the PoC surfaced these):
 *   - Fetch never hangs (per-request AbortController timeout) and never crashes
 *     the caller — 403 / Cloudflare / JS-only sites return whatever partial
 *     profile we could parse plus `fetchNotes` explaining the gaps. We do NOT
 *     add a headless-browser dependency in this PR (noted as a follow-up for
 *     bot-walled sites).
 *   - Conflicting self-reported fleet numbers (the PoC saw "236 vs 250 vs
 *     10,000") are reconciled: prefer the most-repeated / most-specific, and
 *     flag the uncertainty in `fetchNotes`.
 */
import { complete } from '../../ai/client.js';

// ─── Types ──────────────────────────────────────────────────────────────
/** Freight service modes we detect from page text / nav. The matched subset is
 *  returned in `serviceModes`; it also seeds the AI's `suggestedCalculator`. */
export const SERVICE_MODES = [
  'FTL',
  'LTL',
  'drayage',
  'reefer',
  'flatbed',
  'hotshot',
  'expedited',
  'intermodal',
  'cross-border',
  'transload',
] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];

export interface BrandColors {
  primary: string | null;
  secondary: string | null;
  /** 'high' = an explicit brand signal (theme-color / clearly-branded token);
   *  'low' = a best-effort guess. */
  confidence: 'high' | 'low';
}

export interface AiInsights {
  tone: string;
  businessSummary: string;
  painPoints: string[];
  quoteFleetAngle: string;
  suggestedCalculator: {
    /** Which QuoteFleet calculator mode fits them, e.g. "drayage". */
    mode: string;
    /** Which fields that calculator should surface, e.g. ["port", "container", "chassis"]. */
    fields: string[];
  };
}

export interface FmcsaFirmographics {
  mcNumber: string | null;
  dotNumber: string | null;
  legalName: string | null;
  /** Power units, a common proxy for fleet size. */
  fleetSize: number | null;
  entityType: string | null;
}

export interface CompanyProfile {
  /** Normalized apex/host we enriched, e.g. "acme-freight.com". */
  domain: string;
  /** Canonical https URL we fetched. */
  website: string;

  // Deterministic (parsed from HTML)
  companyName: string | null;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  mailingAddress: string | null;
  serviceModes: ServiceMode[];
  regionsLanes: string[];

  // Brand (best-effort)
  brandColors: BrandColors;
  logoUrl: string | null;
  logoConfidence: 'high' | 'low';

  // AI-inferred (null on graceful degrade)
  ai: AiInsights | null;
  aiAvailable: boolean;

  // FMCSA (null when unconfigured / unavailable)
  fmcsa: FmcsaFirmographics | null;
  fmcsaAvailable: boolean;

  /** Human-readable notes about what we could/couldn't get + follow-ups. */
  fetchNotes: string[];
  /** Which URLs were successfully fetched. */
  fetchedPaths: string[];
}

/** Injectable dependencies — defaults hit the real network / env, but tests
 *  pass stubs so nothing touches the wire or the AI vendor. */
export interface EnrichDeps {
  fetchFn?: typeof fetch;
  aiComplete?: typeof complete;
  /** Presence of this is what gates the AI step. Defaults to the env key. */
  anthropicKey?: string;
  /** Presence of this is what gates the FMCSA step. Defaults to the env key. */
  fmcsaKey?: string;
  /** Per-request fetch timeout in ms. */
  timeoutMs?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 8_000;
/** Extra paths we try beyond the homepage — cheap signal, best-effort. */
const EXTRA_PATHS = ['/services', '/about'];
/** A polite desktop UA — some marketing sites 403 an empty UA. */
const FETCH_UA =
  'Mozilla/5.0 (compatible; QuoteFleetOutreachBot/1.0; +https://quotefleet.net/bot)';

/** Mode → the regexes that signal it in page text. Word-boundaried so "ltl"
 *  doesn't fire inside "healtl…". Longer phrases first. */
const MODE_PATTERNS: Record<ServiceMode, RegExp[]> = {
  FTL: [/\bF\.?T\.?L\.?\b/i, /\bfull[-\s]?truck[-\s]?load\b/i],
  LTL: [/\bL\.?T\.?L\.?\b/i, /\bless[-\s]?than[-\s]?truck[-\s]?load\b/i],
  drayage: [/\bdrayage\b/i, /\bport\s+(?:drayage|haul)/i, /\bcontainer\s+dray/i],
  reefer: [/\breefer\b/i, /\brefrigerated\b/i, /\btemperature[-\s]?controlled\b/i],
  flatbed: [/\bflat[-\s]?bed\b/i, /\bstep[-\s]?deck\b/i, /\bconestoga\b/i],
  hotshot: [/\bhot[-\s]?shot\b/i],
  expedited: [/\bexpedited\b/i, /\bexpedite\b/i, /\btime[-\s]?critical\b/i],
  intermodal: [/\bintermodal\b/i, /\brail\s+(?:ramp|intermodal)/i],
  'cross-border': [/\bcross[-\s]?border\b/i, /\bcustoms\s+broker/i, /\bmexico\s+freight\b/i],
  transload: [/\btrans[-\s]?load(?:ing)?\b/i],
};

// ─── Small HTML helpers (regex-based; no parser dependency) ──────────────
function metaContent(html: string, nameOrProp: string): string | null {
  // Match <meta name="x" content="y"> or property="x" in either attr order.
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escapeRe(nameOrProp)}["'][^>]*content=["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${escapeRe(nameOrProp)}["']`,
      'i',
    ),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1] != null) return decodeEntities(m[1].trim()) || null;
  }
  return null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].trim()) || null : null;
}

function firstHeading(html: string): string | null {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  return decodeEntities(stripTags(m[1]).trim()) || null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return _m; }
    });
}

/** Convert a possibly-relative asset URL to absolute against the site origin. */
function absolutize(url: string | null, origin: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, origin).href;
  } catch {
    return null;
  }
}

// ─── Domain / URL ────────────────────────────────────────────────────────
/** Strip protocol/path/whitespace, lowercase, drop a leading www. */
export function normalizeDomain(input: string): string {
  let d = (input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '');
  d = d.replace(/^www\./, '');
  return d;
}

// ─── Deterministic parsing ───────────────────────────────────────────────
function detectModes(text: string): ServiceMode[] {
  const found: ServiceMode[] = [];
  for (const mode of SERVICE_MODES) {
    if (MODE_PATTERNS[mode].some((re) => re.test(text))) found.push(mode);
  }
  return found;
}

/** First plausible North-American phone number. */
function extractPhone(html: string): string | null {
  // Prefer explicit tel: links.
  const tel = html.match(/href=["']tel:([^"']+)["']/i);
  if (tel && tel[1]) {
    const cleaned = tel[1].replace(/[^\d+]/g, '');
    if (cleaned.replace(/\D/g, '').length >= 10) return tel[1].trim();
  }
  const text = stripTags(html);
  const m = text.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return m ? m[0].trim() : null;
}

/** First non-noreply contact email. */
function extractEmail(html: string): string | null {
  const mailto = html.match(/href=["']mailto:([^"'?]+)/i);
  if (mailto && mailto[1] && !/noreply|no-reply/i.test(mailto[1])) return mailto[1].trim();
  const text = stripTags(html);
  const all = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  const good = all.find((e) => !/noreply|no-reply|\.png$|\.jpg$/i.test(e));
  return good ? good.trim() : null;
}

/** Best-effort US/CA street address (street line + city/state/ZIP). */
function extractAddress(html: string): string | null {
  const text = stripTags(html);
  // "123 Main St, Springfield, IL 62704" or with province + postal.
  const us = text.match(
    /\d{1,6}\s+[A-Za-z0-9.\s]{2,40}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Pkwy|Parkway|Hwy|Highway|Ct|Court|Suite|Ste|Unit)\b[.,\s]*[A-Za-z.\s]{0,40},?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/,
  );
  if (us) return us[0].replace(/\s+/g, ' ').trim();
  const ca = text.match(
    /\d{1,6}\s+[A-Za-z0-9.\s]{2,40},?\s*[A-Za-z.\s]{0,40},?\s*[A-Z]{2}\s+[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/,
  );
  return ca ? ca[0].replace(/\s+/g, ' ').trim() : null;
}

/** Stated markets / lanes — "serving X", "X to Y" corridors, region words. */
function extractRegionsLanes(text: string): string[] {
  const out = new Set<string>();
  const serving = text.match(
    /\bserv(?:ing|es)\b[^.]{3,80}/gi,
  );
  serving?.slice(0, 3).forEach((s) => out.add(s.replace(/\s+/g, ' ').trim()));
  // "Los Angeles to Chicago" style lanes.
  const lanes = text.match(
    /\b[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?\s+to\s+[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?\b/g,
  );
  lanes?.slice(0, 5).forEach((l) => {
    // Filter obvious false positives ("Sign in to Continue").
    if (!/\b(sign|log|go|get|talk|how|click|learn)\b/i.test(l)) out.add(l.trim());
  });
  const regionWords = text.match(
    /\b(nationwide|coast[-\s]?to[-\s]?coast|48 states|lower 48|midwest|southeast|northeast|southwest|pacific northwest|west coast|east coast|gulf coast|north america|usa|canada|mexico)\b/gi,
  );
  regionWords?.slice(0, 6).forEach((r) => out.add(r.trim()));
  return [...out].slice(0, 8);
}

/** Brand colors from theme-color meta or a msapplication tile color. */
function extractBrandColors(html: string): BrandColors {
  const theme = metaContent(html, 'theme-color');
  const tile = metaContent(html, 'msapplication-TileColor');
  const hexInStyle = html.match(/(?:background(?:-color)?|color)\s*:\s*(#[0-9a-fA-F]{6}\b)/);
  if (theme && /^#[0-9a-fA-F]{3,8}$/.test(theme)) {
    return { primary: theme, secondary: tile && /^#/.test(tile) ? tile : null, confidence: 'high' };
  }
  if (tile && /^#[0-9a-fA-F]{3,8}$/.test(tile)) {
    return { primary: tile, secondary: null, confidence: 'high' };
  }
  if (hexInStyle && hexInStyle[1]) {
    return { primary: hexInStyle[1], secondary: null, confidence: 'low' };
  }
  return { primary: null, secondary: null, confidence: 'low' };
}

function extractLogo(html: string, origin: string): { url: string | null; confidence: 'high' | 'low' } {
  const og = metaContent(html, 'og:image');
  if (og) return { url: absolutize(og, origin), confidence: 'high' };
  // A header <img> whose src/alt/class hints "logo".
  const imgMatches = html.match(/<img[^>]+>/gi) ?? [];
  for (const tag of imgMatches.slice(0, 30)) {
    if (/logo/i.test(tag)) {
      const src = tag.match(/\bsrc=["']([^"']+)["']/i);
      if (src && src[1]) return { url: absolutize(src[1], origin), confidence: 'low' };
    }
  }
  return { url: null, confidence: 'low' };
}

/**
 * Reconcile self-reported fleet-size numbers. The PoC saw a single page claim
 * "236", "250", and "10,000" — the first two are the truck count, the last is
 * some vanity metric ("10,000 loads/year"). We collect numbers adjacent to
 * fleet nouns, prefer the value that repeats (or the smallest specific one when
 * all differ), and flag the disagreement so a human double-checks.
 */
export function reconcileFleetSize(text: string): { value: number | null; note: string | null } {
  const hits: number[] = [];
  const re = /([\d,]{1,7})\+?\s*(?:power\s+units|trucks|tractors|trailers|units|vehicles|drivers|owner[-\s]?operators)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) hits.push(n);
  }
  if (hits.length === 0) return { value: null, note: null };
  // Count repeats.
  const counts = new Map<number, number>();
  hits.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  const distinct = [...counts.keys()];
  if (distinct.length === 1) return { value: distinct[0], note: null };
  // Most-repeated wins; ties → smallest (fleet counts are usually the small,
  // specific number, not the vanity "loads delivered" figure).
  let best = distinct[0];
  let bestCount = counts.get(best) ?? 0;
  for (const n of distinct) {
    const c = counts.get(n) ?? 0;
    if (c > bestCount || (c === bestCount && n < best)) {
      best = n;
      bestCount = c;
    }
  }
  return {
    value: best,
    note: `Conflicting self-reported figures (${distinct.join(', ')}); chose ${best} — verify before use.`,
  };
}

// ─── Fetch (timeout-bounded, never throws) ───────────────────────────────
interface FetchResult {
  url: string;
  ok: boolean;
  status: number;
  html: string;
  note: string | null;
}

async function safeFetch(fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': FETCH_UA, Accept: 'text/html,application/xhtml+xml' },
    });
    const html = await res.text();
    if (!res.ok) {
      const wall = res.status === 403 || res.status === 429 || res.status === 503;
      return {
        url,
        ok: false,
        status: res.status,
        html,
        note: `${url} returned ${res.status}${wall ? ' (likely bot-wall / Cloudflare — headless fetch is a v1.1 follow-up)' : ''}.`,
      };
    }
    return { url, ok: true, status: res.status, html, note: null };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      url,
      ok: false,
      status: 0,
      html: '',
      note: aborted ? `${url} timed out after ${timeoutMs}ms.` : `${url} fetch failed: ${(err as Error).message}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── AI step ─────────────────────────────────────────────────────────────
function buildAiSystemPrompt(): string {
  return [
    'You are a B2B sales researcher for QuoteFleet, an embeddable instant-quote',
    'calculator + AI dispatcher for freight carriers (drayage & trucking) in the',
    'USA/Canada. Given scraped facts about ONE freight company, infer a concise',
    'sales profile. Be specific and freight-literate. NEVER invent facts not',
    'supported by the input; if unsure, keep it general.',
    '',
    'Return ONLY minified JSON (no markdown fences) with EXACTLY these keys:',
    '{"tone": string, "businessSummary": string (2-3 sentences),',
    ' "painPoints": string[] (2-3, freight-specific),',
    ' "quoteFleetAngle": string (one tailored pitch angle tied to their modes/lanes),',
    ' "suggestedCalculator": {"mode": string, "fields": string[]}}',
    '',
    'suggestedCalculator.mode is the single best-fit QuoteFleet calculator mode',
    'for them (e.g. "drayage", "FTL", "reefer") and fields lists the 3-6 inputs',
    'that calculator should surface (e.g. drayage → ["port","terminal","container","chassis"]).',
  ].join('\n');
}

function coerceAi(raw: unknown): AiInsights | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const sc = (o.suggestedCalculator ?? {}) as Record<string, unknown>;
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x as string) : [];
  const insights: AiInsights = {
    tone: asStr(o.tone),
    businessSummary: asStr(o.businessSummary),
    painPoints: asArr(o.painPoints),
    quoteFleetAngle: asStr(o.quoteFleetAngle),
    suggestedCalculator: {
      mode: asStr(sc.mode),
      fields: asArr(sc.fields),
    },
  };
  // Reject an all-empty object (model returned nothing useful).
  if (!insights.tone && !insights.businessSummary && !insights.quoteFleetAngle) return null;
  return insights;
}

/** Pull the first JSON object out of a model reply (tolerates stray prose/fences). */
function extractJson(text: string): unknown {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─── FMCSA step ──────────────────────────────────────────────────────────
/**
 * FMCSA QCMobile lookup by company name. Free key: register at
 * https://mobile.fmcsa.dot.gov/QCDevsite/docs/getStarted (a "WebKey" arrives by
 * email). Soft-skip when the key is unset; never throw — a flaky/absent FMCSA
 * must not sink the whole profile.
 */
async function lookupFmcsa(
  fetchFn: typeof fetch,
  companyName: string,
  webKey: string,
  timeoutMs: number,
): Promise<{ firmographics: FmcsaFirmographics | null; note: string | null }> {
  const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/name/${encodeURIComponent(
    companyName,
  )}?webKey=${encodeURIComponent(webKey)}`;
  const res = await safeFetch(fetchFn, url, timeoutMs);
  if (!res.ok || !res.html) {
    return { firmographics: null, note: res.note ?? 'FMCSA lookup returned no data.' };
  }
  try {
    const data = JSON.parse(res.html) as { content?: unknown };
    const content = Array.isArray(data.content) ? data.content : [];
    const first = (content[0] ?? null) as { carrier?: Record<string, unknown> } | null;
    const carrier = first?.carrier;
    if (!carrier) return { firmographics: null, note: 'FMCSA: no carrier match by name.' };
    const num = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const str = (v: unknown): string | null => (v == null ? null : String(v));
    return {
      firmographics: {
        mcNumber: str(carrier.docketNumber ?? null),
        dotNumber: str(carrier.dotNumber ?? null),
        legalName: str(carrier.legalName ?? carrier.dbaName ?? null),
        fleetSize: num(carrier.totalPowerUnits ?? null),
        entityType: str(carrier.carrierOperation ?? carrier.entityType ?? null),
      },
      note: null,
    };
  } catch {
    return { firmographics: null, note: 'FMCSA: could not parse response.' };
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────
export async function enrichCompany(domain: string, deps: EnrichDeps = {}): Promise<CompanyProfile> {
  const fetchFn = deps.fetchFn ?? fetch;
  const aiComplete = deps.aiComplete ?? complete;
  const anthropicKey = deps.anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const fmcsaKey = deps.fmcsaKey ?? process.env.FMCSA_WEBKEY ?? '';
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const norm = normalizeDomain(domain);
  const website = `https://${norm}`;
  const fetchNotes: string[] = [];
  const fetchedPaths: string[] = [];

  const profile: CompanyProfile = {
    domain: norm,
    website,
    companyName: null,
    tagline: null,
    phone: null,
    email: null,
    mailingAddress: null,
    serviceModes: [],
    regionsLanes: [],
    brandColors: { primary: null, secondary: null, confidence: 'low' },
    logoUrl: null,
    logoConfidence: 'low',
    ai: null,
    aiAvailable: false,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes,
    fetchedPaths,
  };

  if (!norm || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(norm)) {
    fetchNotes.push(`"${domain}" is not a valid domain — nothing fetched.`);
    return profile;
  }

  // ── Fetch homepage + best-effort extra paths ───────────────────────────
  const pages: FetchResult[] = [];
  const home = await safeFetch(fetchFn, website, timeoutMs);
  pages.push(home);
  if (home.ok) {
    fetchedPaths.push(website);
    // Only chase extra paths if the homepage worked (a bot-wall walls all).
    const extras = await Promise.all(
      EXTRA_PATHS.map((p) => safeFetch(fetchFn, `${website}${p}`, timeoutMs)),
    );
    for (const e of extras) {
      pages.push(e);
      if (e.ok) fetchedPaths.push(e.url);
      else if (e.note) fetchNotes.push(e.note);
    }
  } else if (home.note) {
    fetchNotes.push(home.note);
  }

  const okPages = pages.filter((p) => p.ok && p.html);
  const combinedHtml = okPages.map((p) => p.html).join('\n');
  const combinedText = stripTags(combinedHtml);
  const homeHtml = home.ok ? home.html : okPages[0]?.html ?? '';

  if (okPages.length === 0) {
    fetchNotes.push(
      'No page fetched successfully — profile is empty. If the site is JS-only or bot-walled, a headless-browser fetch (v1.1 follow-up) is needed.',
    );
  } else {
    // ── Deterministic extraction ─────────────────────────────────────────
    const ogSite = metaContent(homeHtml, 'og:site_name');
    const rawTitle = titleTag(homeHtml);
    // Title is often "Name | Tagline" — split on common separators.
    let nameFromTitle: string | null = null;
    let taglineFromTitle: string | null = null;
    if (rawTitle) {
      const parts = rawTitle.split(/\s+[|–—\-·]\s+/);
      nameFromTitle = parts[0]?.trim() || null;
      if (parts.length > 1) taglineFromTitle = parts.slice(1).join(' - ').trim() || null;
    }
    profile.companyName = ogSite || nameFromTitle;
    profile.tagline =
      metaContent(homeHtml, 'og:description') ||
      metaContent(homeHtml, 'description') ||
      taglineFromTitle ||
      firstHeading(homeHtml);
    profile.phone = extractPhone(combinedHtml);
    profile.email = extractEmail(combinedHtml);
    profile.mailingAddress = extractAddress(combinedHtml);
    profile.serviceModes = detectModes(combinedText);
    profile.regionsLanes = extractRegionsLanes(combinedText);
    profile.brandColors = extractBrandColors(homeHtml);
    const logo = extractLogo(homeHtml, website);
    profile.logoUrl = logo.url;
    profile.logoConfidence = logo.confidence;

    if (profile.brandColors.confidence === 'low') {
      fetchNotes.push(
        'Brand colors are low-confidence (no theme-color meta). Full screenshot + vision color extraction is a planned v1.1 follow-up.',
      );
    }

    // Reconcile conflicting fleet numbers (flag only — kept in notes).
    const fleet = reconcileFleetSize(combinedText);
    if (fleet.note) fetchNotes.push(fleet.note);
  }

  // ── AI-inferred (graceful degrade when key absent) ─────────────────────
  if (!anthropicKey) {
    profile.aiAvailable = false;
    fetchNotes.push('AI insights skipped: no Anthropic key configured (deterministic profile only).');
  } else if (okPages.length === 0) {
    profile.aiAvailable = false;
    fetchNotes.push('AI insights skipped: no page content to summarize.');
  } else {
    profile.aiAvailable = true;
    try {
      const facts = {
        domain: norm,
        companyName: profile.companyName,
        tagline: profile.tagline,
        serviceModes: profile.serviceModes,
        regionsLanes: profile.regionsLanes,
        mailingAddress: profile.mailingAddress,
        // Cap the text we hand the model — keeps token cost bounded.
        pageText: combinedText.slice(0, 6_000),
      };
      const out = await aiComplete({
        tenantId: null,
        system: buildAiSystemPrompt(),
        messages: [{ role: 'user', content: `Scraped facts (JSON):\n${JSON.stringify(facts)}` }],
        maxTokens: 900,
      });
      const parsed = coerceAi(extractJson(out.text));
      if (parsed) {
        profile.ai = parsed;
      } else {
        fetchNotes.push('AI returned an unparseable profile; deterministic fields are unaffected.');
      }
    } catch (err) {
      // Never let an AI failure sink the whole enrich.
      profile.aiAvailable = false;
      fetchNotes.push(`AI insights failed: ${(err as Error).message}.`);
    }
  }

  // ── FMCSA (optional, soft-skip, never fatal) ───────────────────────────
  if (!fmcsaKey) {
    profile.fmcsaAvailable = false;
    fetchNotes.push(
      'FMCSA enrichment skipped: FMCSA_WEBKEY not configured. Free key: register at https://mobile.fmcsa.dot.gov/QCDevsite/docs/getStarted.',
    );
  } else if (!profile.companyName) {
    profile.fmcsaAvailable = false;
    fetchNotes.push('FMCSA enrichment skipped: no company name to search by.');
  } else {
    profile.fmcsaAvailable = true;
    try {
      const { firmographics, note } = await lookupFmcsa(fetchFn, profile.companyName, fmcsaKey, timeoutMs);
      profile.fmcsa = firmographics;
      if (note) fetchNotes.push(note);
    } catch (err) {
      profile.fmcsaAvailable = false;
      fetchNotes.push(`FMCSA lookup errored (non-fatal): ${(err as Error).message}.`);
    }
  }

  return profile;
}
