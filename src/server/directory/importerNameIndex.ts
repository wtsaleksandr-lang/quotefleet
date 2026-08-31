/**
 * Company-NAME index for the US Importers Directory (/importers).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Users who already know the importer they want could not look it up. The three
 * filters were Entry port, Entry state and Commodity/HS — all LANE geography.
 *
 * ImportYeti cannot answer a name search. Its bills endpoint takes a `company`
 * parameter, but that parameter is the company SLUG and it returns exactly ONE
 * company (verified against the live API — see pullImportBols / importerProfile);
 * there is no consignee-name or fuzzy-company parameter at all. So a name query
 * has only two possible implementations:
 *
 *   (a) pull a broad, UNTARGETED page of bills and filter it locally — which is
 *       what a name-only search used to do. It spent a real ImportYeti credit on
 *       an arbitrary slice of the corpus and then almost always matched nothing.
 *       A pure cost leak with a "no results" page attached.
 *   (b) search what we ALREADY HOLD. Zero credits, always.
 *
 * This module is (b). It indexes every importer that a paid pull has already
 * surfaced, so a name lookup is answered entirely from licensed data we bought
 * once (ImportYeti's ToS §5.2 permits storing AND reselling it).
 *
 * ── HONEST COVERAGE (non-negotiable) ────────────────────────────────────────
 * This index covers the importers QuoteFleet has already pulled — NOT all 700M+
 * customs records. Every surface that exposes a name search must say so, and
 * must say it in terms of the real number (`total`), never by implication. The
 * page copy, the status line and the empty state all read from this module.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * ZERO ImportYeti credits, in both directions:
 *   • WRITE happens only from rows a search already paid for (or served from
 *     cache). It never triggers a pull.
 *   • READ never pulls. A name miss answers "not in the index yet" and tells the
 *     user how to bring the lane in — it does NOT quietly buy a page of bills.
 * A name search therefore also cannot be used to dodge the paid path: it can
 * only ever surface companies somebody already paid to pull, the profile page
 * (the metered surface) is unchanged, and contact reveals stay locked.
 *
 * ── Storage: no new table ───────────────────────────────────────────────────
 * The index lives as ONE row of the existing `importer_bol_cache`, under a
 * reserved key (`NAME_INDEX_KEY`) in the same hash space `searchKey()` already
 * mints for every other cached pull. Reads are the SAME indexed unique-key
 * lookup (`WHERE search_key = $1`) the BOL cache always does — never a scan,
 * never an aggregate, no DDL, no migration. QuoteFleet has had prod outages from
 * unbounded scans; this must never become one.
 *
 * Bounded by construction: at most NAME_INDEX_MAX_COMPANIES entries, evicted
 * least-recently-seen first, and the whole row is memoized in-process for
 * NAME_INDEX_TTL_MS so a burst of name searches is one DB read, not N.
 *
 * ── Redactions ──────────────────────────────────────────────────────────────
 * Manifest Privacy customers are filtered at READ time against the live
 * redaction set, not merely at write time. A company can be indexed today and
 * become a Manifest Privacy customer tomorrow; filtering on read is what makes
 * that retroactive. See `searchNameIndex`.
 */
import { searchKey, type BolCacheStore } from './importerCache.js';
import {
  companyMatchKey,
  companyNameMatchRank,
  MIN_NAME_QUERY,
  type ImporterLead,
} from './importerLeads.js';

/**
 * The reserved `importer_bol_cache.search_key` the whole index lives under.
 *
 * Minted by the same `searchKey()` every pull key uses, from a part name
 * (`importerNameIndex`) that is not a pull filter — so it can never collide with
 * a real lane's key, and it needs no schema change to coexist with them.
 * Versioned so a future shape change starts a fresh row instead of trying to
 * read an old one.
 */
export const NAME_INDEX_KEY = searchKey({ importerNameIndex: 'v1' });

/** Hard ceiling on indexed companies. Bounds the single row's size (~400 bytes
 *  per entry → well under 1 MB) so the one-row read stays cheap. */
export const NAME_INDEX_MAX_COMPANIES = 1500;

/** In-process memo TTL for the index row. Short: a company indexed by one
 *  request should be findable by the next one within a minute. */
export const NAME_INDEX_TTL_MS = 60_000;

/** Max name matches returned for one query. */
export const NAME_INDEX_MAX_RESULTS = 25;

/** One indexed importer: the free browse projection of a lead, plus its match
 *  key and the epoch ms it was last seen (the eviction clock). */
export interface IndexedCompany extends Record<string, unknown> {
  /** companyMatchKey(lead.company) — what a query is matched against. */
  k: string;
  /** Last time a pull surfaced this company (ms). Drives LRU eviction. */
  t: number;
  /** The free card projection. No contact fields — browse leads never carry them. */
  lead: ImporterLead;
}

/**
 * Is this importer hidden by Manifest Privacy?
 *
 * Checks the filed NAME **and** the ImportYeti SLUG, because they are two
 * different spellings of the same identity and a redaction may be enrolled under
 * either. "Premier Specialty Brands" is redacted; ImportYeti's directory answers
 * a name query with "Premier Specialty Brands **LLC**", whose name key does not
 * match — but its slug is `premier-specialty-brands`, which normalizes to the
 * redaction key exactly. Without the slug arm, a company hidden from every lane
 * search would reappear the moment someone typed its name, which would be a
 * total failure of the product people are paying for.
 *
 * This mirrors `handleImporterProfile`, which already tests the slug both as a
 * title and as spaced words before serving a profile.
 */
export function isLeadRedacted(
  redactKeys: Set<string> | undefined,
  lead: { company?: string | null; slug?: string | null },
): boolean {
  if (!redactKeys || !redactKeys.size) return false;
  const nameKey = companyMatchKey(lead.company ?? '');
  if (nameKey && redactKeys.has(nameKey)) return true;
  const slugKey = companyMatchKey(String(lead.slug ?? '').replace(/-/g, ' '));
  return !!slugKey && redactKeys.has(slugKey);
}

/** True when `v` is a usable index entry (defensive: the row is jsonb, so a
 *  half-written or legacy shape must degrade to "not indexed", never throw). */
function isEntry(v: unknown): v is IndexedCompany {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<IndexedCompany>;
  return typeof e.k === 'string' && !!e.k && !!e.lead && typeof e.lead === 'object'
    && typeof (e.lead as ImporterLead).company === 'string';
}

// ── in-process memo ──────────────────────────────────────────────────────────
let memo: { entries: IndexedCompany[]; at: number } | null = null;
let inflight: Promise<IndexedCompany[]> | null = null;

/** Drop the in-process memo. Exported for tests and for any caller that has
 *  just written the row and wants the next read to see it. */
export function invalidateNameIndexCache(): void {
  memo = null;
  inflight = null;
}

/**
 * Load the index row (memoized). One indexed unique-key lookup on a cache MISS
 * of the memo; nothing at all on a hit.
 *
 * Never throws: a DB hiccup degrades to an EMPTY index, which reads honestly as
 * "no importers indexed yet" rather than 500-ing the directory.
 */
export async function loadNameIndex(store: BolCacheStore): Promise<IndexedCompany[]> {
  const now = Date.now();
  if (memo && now - memo.at < NAME_INDEX_TTL_MS) return memo.entries;
  if (inflight) return inflight;
  inflight = (async () => {
    let entries: IndexedCompany[] = [];
    try {
      const hit = await store.get(NAME_INDEX_KEY);
      entries = (hit?.rows ?? []).filter(isEntry);
    } catch {
      /* index unavailable → empty, never an exception on the browse path */
    }
    memo = { entries, at: Date.now() };
    inflight = null;
    return entries;
  })();
  return inflight;
}

/**
 * Fold leads a pull already produced into the index. Costs NOTHING external —
 * these rows are already in memory and already paid for.
 *
 * Best-effort and never throws: indexing is a side benefit of a search, so a
 * failure here must never affect the search's own response. Writes only when
 * something actually changed, so the common case (a repeat search over already
 * indexed companies) touches the DB zero times.
 *
 * Returns the number of NEW companies added (0 when nothing was written).
 */
export async function indexLeads(
  store: BolCacheStore,
  leads: readonly ImporterLead[],
  now = Date.now(),
): Promise<number> {
  try {
    const fresh = leads.filter((l) => l && l.company && companyMatchKey(l.company));
    if (!fresh.length) return 0;
    const entries = await loadNameIndex(store);
    const byKey = new Map(entries.map((e) => [e.k, e] as const));
    let added = 0;
    let touched = false;
    for (const lead of fresh) {
      const k = companyMatchKey(lead.company);
      const prev = byKey.get(k);
      if (!prev) added++;
      // Always refresh the stored projection: the newest pull is the freshest
      // volume/lane data we have for this importer.
      byKey.set(k, { k, t: now, lead });
      touched = true;
    }
    if (!touched) return 0;
    // Least-recently-seen eviction keeps the row bounded and keeps the companies
    // people actually search for.
    const next = [...byKey.values()]
      .sort((a, b) => b.t - a.t)
      .slice(0, NAME_INDEX_MAX_COMPANIES);
    await store.put(NAME_INDEX_KEY, next, null);
    memo = { entries: next, at: Date.now() };
    return added;
  } catch {
    // A concurrent writer can lose this update (the row is a read-modify-write).
    // That is acceptable for a cache: the company is re-indexed the next time a
    // pull surfaces it. Nothing here may propagate to the caller.
    return 0;
  }
}

/** What a name search found, and over what. */
export interface NameSearchResult {
  /** Matching importers, best match first, then by recent volume. */
  leads: ImporterLead[];
  /** How many importers the index holds AFTER redaction — the honest coverage
   *  number the UI quotes. Never the 700M+ corpus figure. */
  total: number;
}

/**
 * Search the index by company name. ZERO credits, no network, no pull.
 *
 * `redactKeys` is the LIVE Manifest Privacy redaction set, applied here on read
 * so a customer who becomes hidden after being indexed disappears retroactively
 * — from the results AND from the `total` we quote. It is the same choke point,
 * and the same companyKey-normalized set, that `applyPostFilters` uses on the
 * lane path.
 */
export async function searchNameIndex(
  store: BolCacheStore,
  query: string,
  {
    redactKeys,
    limit = NAME_INDEX_MAX_RESULTS,
    minShipments12m,
    minTeu12m,
  }: {
    redactKeys?: Set<string>;
    limit?: number;
    minShipments12m?: number;
    minTeu12m?: number;
  } = {},
): Promise<NameSearchResult> {
  const entries = await loadNameIndex(store);
  // Redaction FIRST, so a hidden importer is excluded from the coverage count as
  // well as from the results — quoting a total that silently includes companies
  // we refuse to show would be a (small) leak of their presence.
  const visible =
    redactKeys && redactKeys.size ? entries.filter((e) => !isLeadRedacted(redactKeys, e.lead)) : entries;
  const total = visible.length;
  const q = companyMatchKey(query);
  if (q.replace(/ /g, '').length < MIN_NAME_QUERY) return { leads: [], total };

  const scored: Array<{ rank: number; lead: ImporterLead }> = [];
  for (const e of visible) {
    const rank = companyNameMatchRank(e.lead.company, q);
    if (rank == null) continue;
    if (minShipments12m && (e.lead.ships_12m ?? 0) < minShipments12m) continue;
    if (minTeu12m && (e.lead.teu_12m ?? 0) < minTeu12m) continue;
    scored.push({ rank, lead: e.lead });
  }
  scored.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : (b.lead.ships_12m ?? 0) - (a.lead.ships_12m ?? 0)));
  return { leads: scored.slice(0, Math.max(1, limit)).map((s) => s.lead), total };
}

/**
 * Company-name AUTOSUGGEST for the search box. Serves ONLY from this index, so
 * it is free, instant, and — the point — it shows the user exactly which names
 * are actually searchable instead of letting them type into a void.
 */
export async function suggestCompanies(
  store: BolCacheStore,
  query: string,
  { redactKeys, limit = 10 }: { redactKeys?: Set<string>; limit?: number } = {},
): Promise<Array<{ value: string; label: string }>> {
  const { leads } = await searchNameIndex(store, query, { redactKeys, limit });
  return leads.map((l) => ({
    value: l.company,
    label: l.state ? `${l.company} — ${l.state}` : l.company,
  }));
}
