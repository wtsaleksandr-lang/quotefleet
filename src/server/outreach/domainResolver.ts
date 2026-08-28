/**
 * Domain resolution — Phase 2 of the FMCSA outreach pipeline.
 *
 * A branded demo is QuoteFleet's value prop, and building one needs the broker's
 * WEBSITE DOMAIN (enrichCompany fetches the site for brand colors/logo/modes).
 * This module turns one `broker_leads` row into a best-effort apex domain.
 *
 * Two sources, cheapest first:
 *   1. EMAIL (free)  — if the FMCSA `censusEmail` is on a real COMPANY domain
 *                      (NOT a freemail provider), that domain IS the site.
 *                      ~96% of leads have a censusEmail, so this covers a large
 *                      share for $0 with no external call.
 *   2. PLACES (paid) — else a Google Places Text Search on
 *                      "<dba|legal> <city> <state>" → the top result's website.
 *                      Directory/aggregator domains (yelp, facebook, …) are
 *                      rejected — they're not the broker's own site. Results are
 *                      cached by mcNumber so a re-run never double-bills Places.
 *
 * Everything external is injectable (the Places lookup fn, the freemail/aggregator
 * sets, the cache) so tests stay fully offline.
 */
import { exchangeTimeoutSignal } from '../../http/responseBody.js';
import { normalizeDomain } from './enrichCompany.js';

export type DomainSource = 'email' | 'places' | 'none';

export interface DomainResult {
  domain: string | null;
  source: DomainSource;
}

/** Minimal shape resolveDomain needs — a `BrokerLead` is structurally assignable. */
export interface ResolvableLead {
  mcNumber?: string | null;
  legalName: string;
  dbaName?: string | null;
  addrCity?: string | null;
  addrState?: string | null;
  censusEmail?: string | null;
}

/** Given a search query, return the top business's website URL (or null). */
export type PlacesLookup = (query: string) => Promise<string | null>;

export interface DomainResolverDeps {
  /** Explicit `null` disables Places; `undefined` builds a default from
   *  GOOGLE_MAPS_API_KEY (which itself yields null when the key is absent). */
  placesLookup?: PlacesLookup | null;
  /** Freemail apex set (lowercased, no `www.`). Overridable for tests. */
  freemail?: Set<string>;
  /** Directory/aggregator apexes to reject from Places results. */
  aggregators?: Set<string>;
  /** mcNumber → result cache, to avoid duplicate Places calls across a run. */
  cache?: Map<string, DomainResult>;
}

/** Personal-email providers — a domain here is NOT a company website. */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'aim.com',
  'icloud.com', 'me.com', 'mac.com', 'comcast.net', 'verizon.net', 'att.net',
  'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net',
  'juno.com', 'roadrunner.com', 'rr.com', 'protonmail.com', 'proton.me',
  'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'mailinator.com',
  'frontier.com', 'windstream.net', 'optonline.net', 'q.com', 'centurylink.net',
]);

/** Directory / social / marketplace hosts that are never a broker's own site. */
export const AGGREGATOR_DOMAINS: ReadonlySet<string> = new Set([
  'yelp.com', 'facebook.com', 'fb.com', 'instagram.com', 'linkedin.com',
  'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'pinterest.com',
  'google.com', 'business.google.com', 'sites.google.com', 'maps.google.com',
  'bbb.org', 'yellowpages.com', 'yellowpages.ca', 'manta.com',
  'bizapedia.com', 'dnb.com', 'indeed.com', 'glassdoor.com', 'angi.com',
  'thomasnet.com', 'crunchbase.com', 'zoominfo.com', 'apollo.io',
  'transportationbrokers.org', 'safer.fmcsa.dot.gov', 'fmcsa.dot.gov',
  'wixsite.com', 'godaddysites.com', 'squarespace.com', 'weebly.com',
  'wordpress.com', 'blogspot.com', 'amazonaws.com', 'shopify.com',
]);

const EMAIL_RE = /^[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})$/i;

/** Lowercased apex-ish domain of an email address, or null if unparseable. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = email.trim().toLowerCase().match(EMAIL_RE);
  return m ? m[1] : null;
}

/**
 * The registrable-ish apex used for freemail/aggregator matching. We compare on
 * the last two labels so `mail.yahoo.com` still matches `yahoo.com`. This is a
 * heuristic (it doesn't parse the public-suffix list), which is fine here — the
 * sets are all two-label consumer/directory hosts.
 */
function apexOf(domain: string): string {
  const parts = domain.split('.').filter(Boolean);
  return parts.length <= 2 ? domain : parts.slice(-2).join('.');
}

export function isFreemail(domain: string, freemail: ReadonlySet<string> = FREEMAIL_DOMAINS): boolean {
  const d = domain.toLowerCase();
  return freemail.has(d) || freemail.has(apexOf(d));
}

export function isAggregator(domain: string, aggregators: ReadonlySet<string> = AGGREGATOR_DOMAINS): boolean {
  const d = domain.toLowerCase();
  return aggregators.has(d) || aggregators.has(apexOf(d));
}

/** How long a Places call may take, headers AND body. These run per-lead in
 *  enrichment batches; without a deadline a stalled Google response pins one
 *  socket per call for the process's lifetime. */
const PLACES_TIMEOUT_MS = 10_000;

/** A syntactically-plausible apex (has a dot + a 2+ char TLD). */
function looksLikeDomain(domain: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain);
}

// ─── Default Google Places (Text Search) ──────────────────────────────────
/** One `places:searchText` call (New Places API v1) → the top result's website. */
async function newPlacesSearch(query: string, apiKey: string, fetchFn: typeof fetch): Promise<string | null> {
  const res = await fetchFn('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.websiteUri,places.displayName,places.id',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, regionCode: 'US' }),
    signal: exchangeTimeoutSignal(PLACES_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new PlacesError(res.status, body);
  }
  const data = (await res.json()) as { places?: Array<{ websiteUri?: string }> };
  return data.places?.[0]?.websiteUri ?? null;
}

/**
 * Legacy Places lookup → the top match's website, in TWO calls:
 *   1. `findplacefromtext` (fields=place_id) — resolve the business to a place_id.
 *   2. `place/details` (fields=website)      — the website is a Contact-data
 *      field only exposed by Place Details, not by Find Place.
 * This is the SAME legacy Places surface the app's location autocomplete already
 * uses (`place/autocomplete/json`), so a `GOOGLE_MAPS_API_KEY` that lacks the
 * *new* Places API (a separate GCP enablement) still resolves domains here.
 */
async function legacyFindPlace(query: string, apiKey: string, fetchFn: typeof fetch): Promise<string | null> {
  const findUrl = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
  findUrl.searchParams.set('input', query);
  findUrl.searchParams.set('inputtype', 'textquery');
  findUrl.searchParams.set('fields', 'place_id');
  findUrl.searchParams.set('key', apiKey);
  const findRes = await fetchFn(findUrl, { signal: exchangeTimeoutSignal(PLACES_TIMEOUT_MS) });
  if (!findRes.ok) throw new PlacesError(findRes.status, await findRes.text().catch(() => ''));
  const findData = (await findRes.json()) as {
    status: string;
    error_message?: string;
    candidates?: Array<{ place_id?: string }>;
  };
  if (findData.status !== 'OK' && findData.status !== 'ZERO_RESULTS') {
    throw new PlacesError(0, `${findData.status}: ${findData.error_message ?? '(no message)'}`);
  }
  const placeId = findData.candidates?.[0]?.place_id;
  if (!placeId) return null;

  const detUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  detUrl.searchParams.set('place_id', placeId);
  detUrl.searchParams.set('fields', 'website');
  detUrl.searchParams.set('key', apiKey);
  const detRes = await fetchFn(detUrl, { signal: exchangeTimeoutSignal(PLACES_TIMEOUT_MS) });
  if (!detRes.ok) throw new PlacesError(detRes.status, await detRes.text().catch(() => ''));
  const detData = (await detRes.json()) as {
    status: string;
    error_message?: string;
    result?: { website?: string };
  };
  if (!['OK', 'ZERO_RESULTS', 'NOT_FOUND'].includes(detData.status)) {
    throw new PlacesError(0, `${detData.status}: ${detData.error_message ?? '(no message)'}`);
  }
  return detData.result?.website ?? null;
}

class PlacesError extends Error {
  constructor(public readonly httpStatus: number, public readonly body: string) {
    super(`Google Places HTTP ${httpStatus}: ${body.slice(0, 200)}`);
    this.name = 'PlacesError';
  }
}

/** A "this key can't use this API" signal (403 / PERMISSION_DENIED / blocked). */
function isBlocked(err: unknown): boolean {
  if (err instanceof PlacesError) {
    if (err.httpStatus === 403) return true;
    return /PERMISSION_DENIED|are blocked|not authorized|REQUEST_DENIED|API_KEY/i.test(err.body);
  }
  return false;
}

/**
 * Build a `PlacesLookup` bound to a key. Prefers the new Places API; if this key
 * isn't authorized for it (403 / PERMISSION_DENIED — a separate GCP enablement),
 * it transparently switches to the legacy `findplacefromtext` endpoint for the
 * rest of the run and never retries the blocked path. A genuine "no match"
 * resolves to null.
 */
export function makeGooglePlacesLookup(apiKey: string, fetchFn: typeof fetch = fetch): PlacesLookup {
  let mode: 'new' | 'legacy' = 'new';
  return async (query: string): Promise<string | null> => {
    if (mode === 'new') {
      try {
        return await newPlacesSearch(query, apiKey, fetchFn);
      } catch (err) {
        if (!isBlocked(err)) throw err;
        mode = 'legacy'; // new API not enabled on this key — fall back for good.
      }
    }
    return legacyFindPlace(query, apiKey, fetchFn);
  };
}

/** Default lookup from env — null (Places disabled) when no key is configured. */
function defaultPlacesLookupFromEnv(): PlacesLookup | null {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return key ? makeGooglePlacesLookup(key) : null;
}

// ─── Resolver ──────────────────────────────────────────────────────────────
export async function resolveDomain(lead: ResolvableLead, deps: DomainResolverDeps = {}): Promise<DomainResult> {
  const freemail = deps.freemail ?? new Set(FREEMAIL_DOMAINS);
  const aggregators = deps.aggregators ?? new Set(AGGREGATOR_DOMAINS);
  // `undefined` → build the env default; `null` → Places explicitly disabled.
  const placesLookup = deps.placesLookup === undefined ? defaultPlacesLookupFromEnv() : deps.placesLookup;

  // 1. FREE: a company-domain census email is the site itself.
  const ceDomain = emailDomain(lead.censusEmail);
  if (ceDomain && !isFreemail(ceDomain, freemail)) {
    const norm = normalizeDomain(ceDomain);
    if (looksLikeDomain(norm)) return { domain: norm, source: 'email' };
  }

  // 2. PAID: Google Places Text Search.
  if (!placesLookup) return { domain: null, source: 'none' };

  const mc = lead.mcNumber ?? undefined;
  if (mc && deps.cache?.has(mc)) return deps.cache.get(mc)!;

  const name = (lead.dbaName?.trim() || lead.legalName || '').trim();
  const query = [name, lead.addrCity, lead.addrState].filter((p) => p && String(p).trim()).join(' ').trim();

  let result: DomainResult = { domain: null, source: 'none' };
  if (name && query) {
    const website = await placesLookup(query);
    const norm = website ? normalizeDomain(website) : '';
    if (norm && looksLikeDomain(norm) && !isAggregator(norm, aggregators) && !isFreemail(norm, freemail)) {
      result = { domain: norm, source: 'places' };
    }
  }

  if (mc) deps.cache?.set(mc, result);
  return result;
}
