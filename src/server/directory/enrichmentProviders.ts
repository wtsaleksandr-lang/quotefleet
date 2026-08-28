/**
 * CONTACT-ENRICHMENT PROVIDER CHAIN — the capacity fix for the Leads Pro reveal.
 *
 * WHY THIS EXISTS: the reveal resolved decision-maker contacts through Hunter and
 * ONLY Hunter, and Hunter sits on the Free plan (~25 searches/month). That single
 * quota — not demand, not the code — was the ceiling on how many reveals Leads Pro
 * could sell, and a 50-reveal/month plan cannot be honoured out of a 25-search
 * bucket. This module turns "the provider" into "the chain": several independent
 * free tiers tried in order, so one exhausted quota degrades to the next instead
 * of ending the feature for the month.
 *
 * ── The shape of the chain ──────────────────────────────────────────────────
 * Every provider is an ADAPTER that normalises its own wire format to the same
 * `ProviderHit` ({ domain, people[] }). `resolveViaChain` walks the configured
 * order and stops at the first provider that returns a usable contact. The tier
 * mapping (verified / role_based / phone_only) stays where it already was, in
 * `importerLeads.resolveContactTiered`, so the reveal's pricing semantics are
 * untouched: paid tiers are EMAIL tiers, `phone_only` is the free floor, and a
 * reveal that resolves no email is never charged.
 *
 * ── Order is CONFIG, not code ───────────────────────────────────────────────
 * `ENRICHMENT_PROVIDER_ORDER` (comma-separated) re-ranks the chain without a
 * deploy — the whole point being that "which free tier is cheapest today" is an
 * operational fact that changes when a plan changes or a quota empties. The
 * default puts the largest untouched free quota first.
 *
 * ── FREE DOMAIN HINT (why a domain-only provider can go first) ──────────────
 * Providers split into two kinds: ones that resolve a COMPANY NAME to a domain
 * themselves (Hunter), and ones that must be handed the DOMAIN (Prospeo).
 * ImportYeti's BOL rows already carry `company_website` for many importers — data
 * we have already paid for and are holding in the licensed cache — so the chain
 * seeds itself with that domain for FREE. A domain-only provider is skipped
 * (never called, never charged) while the domain is unknown, and any provider
 * that DOES resolve a domain publishes it forward, so a later provider in the
 * chain gets the upgrade from "name only" to "known domain" at no cost.
 *
 * ── HARD COST GUARD ─────────────────────────────────────────────────────────
 * Every provider call goes through `guardedFetch` under its OWN provider id, so
 * each one has its own kill switch (`HUNTER_LIVE`, `PROSPEO_LIVE`) and its own
 * rows in the `external_api_spend` ledger. Default-deny is unchanged: dev / CI /
 * vitest / an agent's checkout open no socket at all. A provider the guard
 * refuses does NOT end the chain — the next provider is still tried, and only if
 * EVERY eligible provider was refused does the caller learn it was blocked (which
 * is the "we did not look" outcome that must never be cached or charged).
 *
 * ── PRECISION over recall ───────────────────────────────────────────────────
 * `domainMatchesCompany` lives here because it now guards the whole chain, not
 * one provider. Every provider echoes the searched name back in its response, so
 * the echoed `organization`/`company` field always "matches" and can never catch
 * drift; the only trustworthy signal is whether the resolved DOMAIN's host shares
 * a distinctive token with the company we asked about. A wrong email burns sender
 * reputation, so this stays strict.
 *
 * ── APOLLO: DELIBERATELY NOT WIRED (verified 2026-08-28) ────────────────────
 * Apollo was evaluated as a third link and REJECTED on hard evidence, not
 * guesswork. `GET /api/v1/auth/health` answers `{healthy:true,is_logged_in:true}`
 * on the free key, which looks like working API access — but the only endpoint
 * that could actually serve this feature answers:
 *
 *   POST /api/v1/mixed_people/api_search → HTTP 403
 *   {"error":"The api/v1/mixed_people/api_search API is not included in your
 *     Free plan and is not accessible, even with a master key. All paid plans
 *     include full API access…","error_code":"API_INACCESSIBLE"}
 *
 * "not accessible, even with a master key" is unambiguous: there is no free path
 * to a work email at Apollo, so an adapter would be a dead integration that only
 * ever contributes latency and a 403. `apollo` is still registered in the cost
 * guard (kill switch + ledger slot pre-provisioned) so that upgrading the plan is
 * a config change plus an adapter, not a re-architecture — but it is NOT in this
 * chain and `ENRICHMENT_PROVIDER_ORDER` cannot name it.
 *
 * Env: HUNTER_API_KEY, PROSPEO_API_KEY, ENRICHMENT_PROVIDER_ORDER
 */

import { releaseBody } from '../../http/responseBody.js';
import { guardedFetch, reportProviderCost } from './externalPullGuard.js';

/** The enrichment providers, i.e. the subset of ExternalProvider that can answer
 *  "who do I email at this company?". Deliberately its own union so the chain
 *  cannot be pointed at ImportYeti, Anthropic, or plan-gated Apollo. */
export type EnrichmentProviderName = 'prospeo' | 'hunter';

/** One person candidate, normalised across every provider's wire format. */
export interface ProviderPerson {
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  email: string | null;
  /** 0-100. Null when the provider does not score its results. */
  confidence: number | null;
  linkedin: string | null;
}

/** A successful provider lookup: a company domain, plus whatever people it knows.
 *  `people` MAY be empty, and a person MAY have a null email — a resolved domain
 *  with no reachable person is still useful, because it is exactly what the
 *  role_based tier is built from. */
export interface ProviderHit {
  provider: EnrichmentProviderName;
  domain: string;
  people: ProviderPerson[];
}

/** Sentinel: the HARD COST GUARD refused this provider's call. NOT a negative
 *  result — no credit was spent and nothing was learned. */
export const PROVIDER_BLOCKED = 'blocked' as const;

export type ProviderOutcome = ProviderHit | null | typeof PROVIDER_BLOCKED;

/** One provider adapter. */
export interface EnrichmentProvider {
  name: EnrichmentProviderName;
  /** Env var holding this provider's API key. No key → the provider is skipped
   *  silently (never an error — a chain with one of two keys still works). */
  keyEnv: string;
  /** TRUE when the provider can turn a COMPANY NAME into a domain on its own.
   *  FALSE means the adapter is only callable once a domain is known, so the
   *  chain skips it — without opening a socket — until one is. */
  resolvesDomain: boolean;
  /** Perform ONE lookup. Returns null for "provider has nothing / errored", the
   *  PROVIDER_BLOCKED sentinel when the cost guard refused, else a hit. MUST NOT
   *  throw. */
  resolve(company: string, domain: string | null, context: string): Promise<ProviderOutcome>;
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ── who counts as a decision-maker ─────────────────────────────────────────*/

/**
 * Titles worth reaching at an importer — the person who actually books freight.
 * ONE source of truth for the whole chain: `TARGET_TITLE_RX` ranks candidates
 * locally (Hunter hands back an unfiltered employee list) and
 * `DECISION_MAKER_TITLES` is the same set expressed as the server-side filter
 * Prospeo takes, so both providers are asked for — and judged on — the same
 * notion of "decision maker".
 */
export const TARGET_TITLE_RX =
  /logistic|supply|import|procure|operation|purchas|owner|president|founder|ceo|coo|director|vp|head/i;

/** The `TARGET_TITLE_RX` alternatives as literal terms, for providers that filter
 *  server-side (Prospeo `person_job_title` + `match_mode: CONTAINS`). Keeping the
 *  two in the same file is what stops them drifting apart. */
export const DECISION_MAKER_TITLES: readonly string[] = Object.freeze([
  'logistics', 'supply chain', 'import', 'procurement', 'operations', 'purchasing',
  'owner', 'president', 'founder', 'ceo', 'coo', 'director', 'vp', 'head of',
]);

/* ── precision guard (shared by every provider) ─────────────────────────────*/

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

/**
 * True if the resolved DOMAIN plausibly IS the input company (its host shares a
 * distinctive token, or a solid substring hit).
 *
 * HOST TOKENS ONLY — never the provider's echoed `organization` / `company`
 * field. Every provider echoes the name it was searched with, so that field
 * always "matches" and cannot catch a fuzzy-match drift (Hunter once resolved
 * "Robert Bosch Tool Corp" to motopaja.fi while happily echoing "Robert Bosch
 * Tool Corp" back). Strict host matching trades recall for precision, which is
 * the right trade for a lead product: a wrong email burns sender reputation.
 */
export function domainMatchesCompany(
  companyName: string,
  domain: string | null | undefined,
): boolean {
  const want = nameTokens(companyName);
  if (!want.size) return true; // nothing distinctive to check → don't block
  const host = new Set(nameTokens((domain || '').split('.').slice(0, -1).join(' ')));
  for (const t of want) if (host.has(t)) return true;
  const joined = (domain || '').split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const t of want) if (t.length >= 4 && joined.includes(t)) return true;
  return false;
}

/**
 * Reduce anything domain-shaped (a full URL, a `www.` host, a bare host) to the
 * bare host a provider API expects. Returns null for junk, so a malformed
 * `company_website` never becomes a wasted provider call.
 */
export function normalizeDomain(raw: unknown): string | null {
  let s = str(raw).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip scheme
  s = s.split(/[/?#]/)[0]; // strip path / query / hash
  s = s.replace(/^www\./, '');
  s = s.replace(/:\d+$/, ''); // strip port
  if (s.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

/** Cheap real-address shape check. Providers occasionally hand back masked or
 *  placeholder values; those are rejected here rather than persisted. */
function isEmailish(v: unknown): boolean {
  const s = str(v).trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return false;
  if (s.includes('*')) return false; // Prospeo masks unrevealed addresses: i****@x.com
  if (/email_not_unlocked/i.test(s)) return false; // Apollo's locked placeholder
  return true;
}

function person(o: {
  first?: unknown;
  last?: unknown;
  position?: unknown;
  email?: unknown;
  confidence?: unknown;
  linkedin?: unknown;
}): ProviderPerson {
  const email = str(o.email).trim();
  return {
    first_name: str(o.first).trim() || null,
    last_name: str(o.last).trim() || null,
    position: str(o.position).trim() || null,
    email: isEmailish(email) ? email : null,
    confidence: o.confidence == null ? null : num(o.confidence),
    linkedin: str(o.linkedin).trim() || null,
  };
}

/* ── adapter: Hunter (api.hunter.io) ────────────────────────────────────────
 * GET /v2/domain-search — resolves a company to its domain AND returns indexed
 * employees with titles + a 0-100 confidence, in ONE billed request. `limit`
 * MUST be <= 10.
 *
 * The only provider in the chain that resolves a NAME to a domain, which is why
 * it stays even though its free quota is the smallest: it is the fallback that
 * rescues an importer whose ImportYeti row carries no website. */
export const hunterProvider: EnrichmentProvider = {
  name: 'hunter',
  keyEnv: 'HUNTER_API_KEY',
  resolvesDomain: true,
  async resolve(company, domain, context) {
    const key = process.env.HUNTER_API_KEY;
    if (!key) return null;
    const qs = new URLSearchParams({ api_key: key, limit: '10' });
    // A domain the chain already knows is both cheaper to match and more precise
    // than re-resolving the name; Hunter accepts either parameter.
    if (domain) qs.set('domain', domain);
    else qs.set('company', company);
    const r = await guardedFetch('hunter', context, `https://api.hunter.io/v2/domain-search?${qs}`);
    if (!r) return PROVIDER_BLOCKED;
    if (!r.ok) {
      releaseBody(r); // free the socket — the body is never read on the error path
      return null;
    }
    const j = (await r.json()) as {
      data?: { domain?: string; emails?: Array<Record<string, unknown>> };
    };
    const d = j.data || {};
    const resolved = normalizeDomain(d.domain) || domain;
    if (!resolved) return null;
    if (!domainMatchesCompany(company, resolved)) return null; // fuzzy-drift guard
    return {
      provider: 'hunter',
      domain: resolved,
      people: (d.emails || []).map((e) =>
        person({
          first: e.first_name,
          last: e.last_name,
          position: e.position,
          email: e.value,
          confidence: e.confidence,
          linkedin: e.linkedin,
        }),
      ),
    };
  },
};

/* ── adapter: Prospeo (api.prospeo.io) ──────────────────────────────────────
 * Verified live 2026-08-28 on the FREE plan (100 credits/month, unused):
 *
 *   POST /search-person   1 credit per page that returns ≥1 person, 0 otherwise.
 *                         Returns up to 25 people for a company domain, each with
 *                         `person_id`, title, and — crucially — the email's
 *                         VERIFICATION STATUS, while masking the address itself
 *                         ("i*********@us.bosch.com", `revealed:false`).
 *   POST /enrich-person   1 credit per email actually found, 0 when none is.
 *                         Turns ONE `person_id` into the real address.
 *
 * The masked-but-status-bearing search response is what makes this cheap: the
 * adapter can pick the single best candidate (verified address + best-matching
 * decision-maker title) from the free-of-extra-charge page and then spend exactly
 * ONE enrich credit on that one person. Two credits per reveal → 50 reveals a
 * month out of the free tier, which is precisely the Leads Pro allowance.
 *
 * STRICTLY TWO CALLS, NEVER A LOOP: one search, one enrich, no pagination, no
 * per-person fan-out. This runs inside a user-facing reveal, so the call count is
 * a latency budget as much as a credit budget.
 *
 * Prospeo cannot resolve a company NAME to a domain (its filters are
 * domain-based), hence `resolvesDomain: false` — the chain skips it entirely
 * until a domain is known, so it never burns a credit on a question it cannot
 * answer.
 *
 * Wire notes that cost real debugging time:
 *   • Auth header is `X-KEY`, not Bearer.
 *   • Errors come back HTTP 400 with `{error:true, error_code:"NO_MATCH"}` —
 *     `error_code`, not `message` — so a 200 is not sufficient proof of success;
 *     the top-level `error` boolean has to be checked too.
 *   • `/account-information` wraps its payload in `response`; `/search-person`
 *     and `/enrich-person` do NOT. Never write one generic unwrapper.
 *   • The job title is `current_job_title` in the Person schema but `job_title`
 *     in some documented examples — read both.
 */
const PROSPEO_BASE = 'https://api.prospeo.io';

function prospeoHeaders(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-KEY': key };
}

/** Prospeo signals failure in the BODY (`error:true`) as well as by status. */
function prospeoFailed(j: unknown): boolean {
  return !!(j && typeof j === 'object' && (j as { error?: unknown }).error === true);
}

interface ProspeoSearchPerson {
  person_id?: string;
  first_name?: string;
  last_name?: string;
  current_job_title?: string;
  job_title?: string;
  linkedin_url?: string;
  email?: { status?: string; revealed?: boolean; email?: string };
}

/** Rank one search-result person: a VERIFIED address beats an unverified one,
 *  and a decision-maker title beats an unrelated one. Highest score is enriched. */
function prospeoScore(p: ProspeoSearchPerson): number {
  const title = str(p.current_job_title ?? p.job_title);
  let score = 0;
  if (String(p.email?.status ?? '').toUpperCase() === 'VERIFIED') score += 2;
  if (TARGET_TITLE_RX.test(title)) score += 1;
  return score;
}

export const prospeoProvider: EnrichmentProvider = {
  name: 'prospeo',
  keyEnv: 'PROSPEO_API_KEY',
  resolvesDomain: false,
  async resolve(company, domain, context) {
    const key = process.env.PROSPEO_API_KEY;
    if (!key || !domain) return null;

    // ── call 1: domain → up to 25 decision-maker candidates ──────────────
    const searchRes = await guardedFetch(
      'prospeo',
      `${context} search`,
      `${PROSPEO_BASE}/search-person`,
      {
        method: 'POST',
        headers: prospeoHeaders(key),
        body: JSON.stringify({
          page: 1,
          filters: {
            company: { websites: { include: [domain] } },
            person_job_title: { include: [...DECISION_MAKER_TITLES], match_mode: 'CONTAINS' },
          },
        }),
      },
    );
    if (!searchRes) return PROVIDER_BLOCKED;
    if (!searchRes.ok) {
      releaseBody(searchRes);
      return null;
    }
    const search = (await searchRes.json()) as {
      error?: boolean;
      results?: Array<{ person?: ProspeoSearchPerson }>;
      remaining_credits?: number;
    };
    if (prospeoFailed(search)) return null; // NO_RESULTS / INSUFFICIENT_CREDITS / …
    const candidates = (search.results || [])
      .map((r) => r.person)
      .filter((p): p is ProspeoSearchPerson => !!p && !!p.person_id);
    if (!candidates.length) return null;

    // Everything below is free — the page is already paid for.
    const people = candidates.map((p) =>
      person({
        first: p.first_name,
        last: p.last_name,
        position: p.current_job_title ?? p.job_title,
        email: p.email?.email, // masked here; isEmailish rejects it → null
        confidence: null,
        linkedin: p.linkedin_url,
      }),
    );
    const hit: ProviderHit = { provider: 'prospeo', domain, people };

    // ── call 2: reveal exactly ONE address, for the best candidate ────────
    const best = [...candidates].sort((a, b) => prospeoScore(b) - prospeoScore(a))[0];
    const enrichRes = await guardedFetch(
      'prospeo',
      `${context} enrich`,
      `${PROSPEO_BASE}/enrich-person`,
      {
        method: 'POST',
        headers: prospeoHeaders(key),
        body: JSON.stringify({
          only_verified_email: true,
          data: { person_id: best.person_id },
        }),
      },
    );
    // A blocked / failed reveal still leaves a resolved domain + named people,
    // which is a legitimate role_based result — never throw that away.
    if (!enrichRes) return hit;
    if (!enrichRes.ok) {
      releaseBody(enrichRes);
      return hit;
    }
    const enriched = (await enrichRes.json()) as {
      error?: boolean;
      person?: {
        first_name?: string;
        last_name?: string;
        current_job_title?: string;
        linkedin_url?: string;
        email?: { status?: string; revealed?: boolean; email?: string };
      } | null;
    };
    if (prospeoFailed(enriched) || !enriched.person) return hit;
    const e = enriched.person;
    if (!e.email?.revealed || !isEmailish(e.email.email)) return hit;
    const revealed = person({
      first: e.first_name ?? best.first_name,
      last: e.last_name ?? best.last_name,
      position: e.current_job_title ?? best.current_job_title ?? best.job_title,
      email: e.email.email,
      // Prospeo grades an address rather than scoring it; map its one positive
      // grade onto the 0-100 scale the rest of the pipeline already speaks.
      confidence: String(e.email.status ?? '').toUpperCase() === 'VERIFIED' ? 95 : null,
      linkedin: e.linkedin_url ?? best.linkedin_url,
    });
    // The revealed person leads; the rest of the page stays as context.
    return {
      ...hit,
      people: [revealed, ...people.filter((p) => p.email !== revealed.email)],
    };
  },
};

/* ── chain ──────────────────────────────────────────────────────────────────*/

/** Registry of every wired adapter, keyed by name. */
export const ENRICHMENT_PROVIDERS: Readonly<Record<EnrichmentProviderName, EnrichmentProvider>> =
  Object.freeze({
    prospeo: prospeoProvider,
    hunter: hunterProvider,
  });

/** Default chain order — cheapest usable quota first.
 *
 *  Prospeo leads: 100 free credits/month, entirely unused, ~2 credits per reveal
 *  → ~50 reveals, which is the whole Leads Pro allowance on its own. Hunter is
 *  the fallback, both because its free tier is only ~25 searches/month and
 *  because it is the one adapter that can work from a company NAME when
 *  ImportYeti gave us no website. Override with ENRICHMENT_PROVIDER_ORDER. */
export const DEFAULT_PROVIDER_ORDER: readonly EnrichmentProviderName[] = Object.freeze([
  'prospeo',
  'hunter',
] as const);

export const PROVIDER_ORDER_ENV = 'ENRICHMENT_PROVIDER_ORDER';

/**
 * The chain order for this process. Reads `ENRICHMENT_PROVIDER_ORDER` at CALL
 * TIME (never cached at import) so a Doppler change takes effect on restart with
 * no code change — and so a test can set it per-case.
 *
 * Unknown / duplicate names are dropped rather than throwing: a typo in an env
 * var must degrade to a working chain, never take the reveal down. An order that
 * names NO valid provider falls back to the default, for the same reason. Naming
 * a subset is legitimate and is how a provider gets switched off for a while
 * without touching its key.
 */
export function providerOrder(): EnrichmentProviderName[] {
  const raw = process.env[PROVIDER_ORDER_ENV];
  if (!raw || !String(raw).trim()) return [...DEFAULT_PROVIDER_ORDER];
  const seen = new Set<string>();
  const out: EnrichmentProviderName[] = [];
  for (const part of String(raw).split(',')) {
    const n = part.trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(ENRICHMENT_PROVIDERS, n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n as EnrichmentProviderName);
  }
  return out.length ? out : [...DEFAULT_PROVIDER_ORDER];
}

/** Outcome of one full walk of the chain. */
export interface ChainResult {
  /** The best hit found, or null when no provider had anything. */
  hit: ProviderHit | null;
  /** Providers actually called (a socket was opened), in chain order — so the
   *  LAST entry is the one that served the result, because the walk stops at the
   *  first usable hit. Mirrors the `external_api_spend` rows this walk wrote. */
  called: EnrichmentProviderName[];
  /** Providers the cost guard refused. */
  blocked: EnrichmentProviderName[];
  /** TRUE when EVERY eligible provider was refused by the cost guard and nothing
   *  was learned. This is the "we did not look" outcome: the caller must not cache
   *  it as a negative and must not charge for it. */
  allBlocked: boolean;
}

/** Does this hit carry a sendable address? The chain stops here. */
function hasEmail(hit: ProviderHit): boolean {
  return hit.people.some((p) => !!p.email);
}

/**
 * Walk the provider chain and return the first usable contact.
 *
 * Rules, in the order they matter:
 *   1. A provider with no API key is SKIPPED — no socket, no error. A chain with
 *      one key configured is a perfectly valid chain.
 *   2. A domain-only provider is SKIPPED while the domain is unknown. It is never
 *      called speculatively, so it never burns a credit on a question it cannot
 *      answer.
 *   3. A provider the COST GUARD refuses does not end the walk. A per-provider
 *      kill switch is meant to route around that provider, not to take the reveal
 *      down.
 *   4. The first hit WITH AN EMAIL wins and the walk stops — that is the whole
 *      point of a chain: the cheapest quota that can answer, answers.
 *   5. A hit with a domain but NO email is remembered (it still feeds the
 *      role_based tier) and its domain is published forward, so the next provider
 *      gets the free upgrade from "name only" to "known domain". The walk
 *      continues, in case a later provider can name a real person.
 *
 * NEVER throws: any adapter failure is caught and treated as "this provider had
 * nothing", because the reveal above it must always be answerable.
 */
export async function resolveViaChain(
  company: string,
  { domainHint = null }: { domainHint?: string | null } = {},
): Promise<ChainResult> {
  const order = providerOrder();
  const called: EnrichmentProviderName[] = [];
  const blocked: EnrichmentProviderName[] = [];
  let best: ProviderHit | null = null;
  // Seed from the FREE ImportYeti website, but only if it actually looks like
  // this company's domain — an unrelated hint would silently poison every
  // domain-only provider in the chain.
  let domain = normalizeDomain(domainHint);
  if (domain && !domainMatchesCompany(company, domain)) domain = null;

  let eligible = 0;
  for (let i = 0; i < order.length; i++) {
    const provider = ENRICHMENT_PROVIDERS[order[i]];
    if (!provider) continue;
    if (!process.env[provider.keyEnv]) continue; // rule 1
    if (!provider.resolvesDomain && !domain) continue; // rule 2
    eligible++;
    const context = `reveal#${i + 1}:${company.slice(0, 40)}`;
    let outcome: ProviderOutcome = null;
    try {
      outcome = await provider.resolve(company, domain, context);
    } catch {
      outcome = null; // an adapter can never break the reveal
    }
    if (outcome === PROVIDER_BLOCKED) {
      blocked.push(provider.name); // rule 3 — route around it, keep walking
      continue;
    }
    called.push(provider.name);
    if (!outcome) continue;
    if (hasEmail(outcome)) return { hit: outcome, called, blocked, allBlocked: false }; // rule 4
    // rule 5 — domain-only hit: keep it, and hand the domain to the next provider.
    if (!best) best = outcome;
    domain = outcome.domain;
  }
  return {
    hit: best,
    called,
    blocked,
    // "We did not look" only when the guard refused every provider that was
    // actually eligible — not when the chain simply had no keys configured.
    allBlocked: eligible > 0 && called.length === 0 && blocked.length > 0,
  };
}

/* ── quota introspection (admin) ────────────────────────────────────────────*/

/** What one provider reports about its own remaining quota. */
export interface ProviderQuota {
  provider: EnrichmentProviderName;
  /** FALSE when no API key is configured for this provider. */
  configured: boolean;
  /** Plan name as the provider reports it ("FREE", "starter", …). */
  plan: string | null;
  remaining: number | null;
  used: number | null;
  /** Days until the quota resets, when the provider reports it. */
  renewsInDays: number | null;
  /** Why there is no number: 'blocked' (cost guard), 'no-key', 'unsupported'
   *  (the provider exposes no quota endpoint), or 'error'. */
  unavailable?: 'blocked' | 'no-key' | 'unsupported' | 'error';
}

/**
 * Live per-provider quota for the admin usage view. "How much free quota is left"
 * is the number that decides whether Leads Pro can be sold this month, and it is
 * NOT derivable from our own ledger: each provider's month resets on its own
 * schedule, and the same keys are shared with other tools.
 *
 * Every call here is a provider's own FREE account endpoint and is recorded as
 * costing 0 credits — but it still goes through `guardedFetch`, so a quota check
 * can never happen invisibly and never happens outside production. Never throws:
 * a provider that cannot answer reports `unavailable` and the others still render.
 */
export async function providerQuotas(): Promise<ProviderQuota[]> {
  return Promise.all(providerOrder().map((name) => quotaFor(name)));
}

type QuotaRead = Pick<ProviderQuota, 'plan' | 'remaining' | 'used' | 'renewsInDays'>;

async function quotaFor(name: EnrichmentProviderName): Promise<ProviderQuota> {
  const provider = ENRICHMENT_PROVIDERS[name];
  const base: ProviderQuota = {
    provider: name,
    configured: !!process.env[provider.keyEnv],
    plan: null,
    remaining: null,
    used: null,
    renewsInDays: null,
  };
  if (!base.configured) return { ...base, unavailable: 'no-key' };
  try {
    const q = name === 'prospeo' ? await prospeoQuota() : await hunterQuota();
    if (q === PROVIDER_BLOCKED) return { ...base, unavailable: 'blocked' };
    if (!q) return { ...base, unavailable: 'error' };
    // Publish the freshest remaining balance to the in-process meter + the newest
    // ledger row, so the admin spend table and this table agree.
    reportProviderCost(name, null, q.remaining);
    return { ...base, ...q };
  } catch {
    return { ...base, unavailable: 'error' };
  }
}

/** GET /account-information — free, and the payload IS wrapped in `response`. */
async function prospeoQuota(): Promise<QuotaRead | null | typeof PROVIDER_BLOCKED> {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) return null;
  const r = await guardedFetch(
    'prospeo',
    'quota',
    `${PROSPEO_BASE}/account-information`,
    { method: 'GET', headers: prospeoHeaders(key) },
    undefined,
    { credits: 0 },
  );
  if (!r) return PROVIDER_BLOCKED;
  if (!r.ok) {
    releaseBody(r);
    return null;
  }
  const j = (await r.json()) as {
    error?: boolean;
    response?: {
      current_plan?: string;
      remaining_credits?: number;
      used_credits?: number;
      next_quota_renewal_days?: number;
    };
  };
  if (prospeoFailed(j) || !j.response) return null;
  const d = j.response;
  return {
    plan: d.current_plan ?? null,
    remaining: d.remaining_credits == null ? null : num(d.remaining_credits),
    used: d.used_credits == null ? null : num(d.used_credits),
    renewsInDays: d.next_quota_renewal_days == null ? null : num(d.next_quota_renewal_days),
  };
}

/** GET /v2/account — free. Hunter reports a used/available pair, not a balance. */
async function hunterQuota(): Promise<QuotaRead | null | typeof PROVIDER_BLOCKED> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  const r = await guardedFetch(
    'hunter',
    'quota',
    `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`,
    {},
    undefined,
    { credits: 0 },
  );
  if (!r) return PROVIDER_BLOCKED;
  if (!r.ok) {
    releaseBody(r);
    return null;
  }
  const j = (await r.json()) as {
    data?: {
      plan_name?: string;
      reset_date?: string;
      requests?: { searches?: { used?: number; available?: number } };
    };
  };
  const s = j.data?.requests?.searches;
  const available = s?.available == null ? null : num(s.available);
  const used = s?.used == null ? null : num(s.used);
  return {
    plan: j.data?.plan_name ?? null,
    remaining: available != null && used != null ? Math.max(0, available - used) : null,
    used,
    renewsInDays: daysUntil(j.data?.reset_date),
  };
}

/** Whole days from now until a date string, or null. Never negative. */
function daysUntil(iso: unknown): number | null {
  const s = str(iso).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
}
