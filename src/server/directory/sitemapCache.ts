/**
 * SEO DISCOVERY LAYER — the materialized XML sitemap for the ~334k-row public
 * carrier directory.
 *
 * THE PROBLEM THIS SOLVES: the per-carrier profile pages (/directory/carrier/:slug)
 * are individually SEO-strong (unique title/meta, LocalBusiness JSON-LD, CTAs) but
 * were STRUCTURALLY UNDISCOVERABLE — the old sitemap was a static ~50-URL file that
 * listed ZERO carriers, and carriers were only reachable via deep pagination. So
 * Google could not find, crawl, or index 334k high-intent pages. This module builds
 * the sitemap INDEX + chunked carrier children + the real city hubs so every profile
 * is one hop from the sitemap.
 *
 * THE ANTI-SCAN CONTRACT (critical): rendering these chunks per request would
 * re-scan the 334k-row carrier_directory on the hot path — the exact scan-stampede
 * that took every QuoteFleet domain down (see directory_aggregate_cache /
 * queries.ts). So we NEVER scan on the request path. Instead each fully-rendered
 * sitemap document is MATERIALIZED into one row of `sitemap_cache` OFF the request
 * path — by the hourly directoryRefreshCron (whose first tick lands ~2 min after
 * boot), or by a one-at-a-time background rebuild kicked on a cold cache miss — and
 * the /sitemap*.xml routes serve them with a single-row PK lookup — O(1),
 * memory-shielded, never a scan. Identical discipline to
 * recomputeAndPersistDirectoryAggregates().
 *
 * DOCUMENT KEYS (one row each in sitemap_cache):
 *   'index'        → <sitemapindex> referencing every child below.
 *   'pages'        → <urlset> of marketing + /directory + /compliance + all state
 *                    hubs + all port hubs (a small fixed set, no carrier scan).
 *   'cities'       → <urlset> of every REAL city hub (/directory/{state}/{city}).
 *   'carriers-<n>' → <urlset> of ≤SITEMAP_MAX_URLS carrier profiles (~7 for 334k).
 *   'guides'       → <urlset> of every PUBLISHED /guides article. Its own child
 *                    (not folded into 'pages') because it is the one DB-backed
 *                    set here whose membership changes on a human approve —
 *                    'pages' is built from static arrays and stays synchronous.
 */
import { sql } from 'drizzle-orm';
import { SEASONAL_SOURCES } from '../../calc/osow/seasonal/sources.js';
import { db } from '../../db/client.js';
import { carrierDirectory, sitemapCache } from '../../db/schema.js';
import { US_STATES } from './usStates.js';
import { PORT_GROUPS } from './containerPorts.js';
import { GLOSSARY_TERMS } from './glossary.js';
import { SERVICES } from './servicePages.js';
import { DRAYAGE_RATE_SLUGS } from './drayageRatePages.js';
import { citySlugify, getDirectorySummary, withWallClockDeadline } from './queries.js';
import { carrierChangefreq, carrierPriority, richnessScoreSql } from './carrierRichness.js';
import { runIndexNowSubmission, type IndexNowSmallFamilies } from './indexNow.js';

export const SITE = 'https://quotefleet.net';

/** Sitemaps.org hard cap: at most 50,000 <loc> per file. Carrier chunks respect
 *  this so ~334k carriers split into ~7 children. Exported for the boundary test. */
export const SITEMAP_MAX_URLS = 50_000;

/** Staleness threshold for the boot/cron safety-net recompute — mirrors the
 *  aggregate cache's AGG_PERSIST_MAX_AGE_MS. The weekly ingest is the real
 *  refresh; this keeps the docs from ever being pathologically stale. */
export const SITEMAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Per-statement server-side timeout for the OFF-PATH carrier/city scans. Generous
 *  (the scan legitimately covers the whole table) but finite, so a starved scan
 *  aborts (Postgres 57014) and releases its connection instead of pinning it. */
const OFFPATH_SCAN_BUDGET_MS = 30_000;
/** TOTAL wall-clock cap over the whole recompute (both scans + all upserts) so a
 *  starved run settles well before the 15-min cron slow-run watchdog. */
const OFFPATH_RECOMPUTE_BUDGET_MS = 120_000;
/** TOTAL wall-clock cap for the IndexNow announcement that follows a rebuild —
 *  its own budget, so a slow push to Bing cannot eat into (or fail) the sitemap
 *  materialization that has already succeeded. */
const INDEXNOW_RUN_BUDGET_MS = 90_000;

/** In-memory SWR shield in FRONT of the single-row PK lookups so a warm crawler
 *  hit serves from memory (zero DB round-trips) and a cold/stale one does a single
 *  single-flighted PK read — never the 334k-row scan. */
const SITEMAP_MEM_TTL_MS = 5 * 60_000;

// ─── Pure XML builders (unit-tested) ───────────────────────────────────────

/** Escape the five XML metacharacters so a <loc> is always well-formed. Carrier
 *  slugs are `[a-z0-9-]` so this is defensive, but city slugs pass through it too. */
export function xmlEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m] as string),
  );
}

/** W3C sitemap <lastmod> date — YYYY-MM-DD in UTC. Falls back to `now` when the
 *  timestamp is missing/invalid so a row with a null updated_at still emits a valid
 *  (if approximate) lastmod rather than breaking the document. */
export function fmtLastmod(d: Date | null | undefined, now: Date = new Date()): string {
  const dt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : now;
  return dt.toISOString().slice(0, 10);
}

/** The canonical absolute URL for a carrier profile (matches the page's rel=canonical). */
export function carrierLoc(slug: string): string {
  return `${SITE}/directory/carrier/${xmlEscape(slug)}`;
}

export interface UrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

/** One <url> block. Only `loc` is required; optional hints are emitted when set. */
function urlXml(e: UrlEntry): string {
  const parts = [`    <loc>${e.loc}</loc>`];
  if (e.lastmod) parts.push(`    <lastmod>${e.lastmod}</lastmod>`);
  if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
  if (e.priority) parts.push(`    <priority>${e.priority}</priority>`);
  return `  <url>\n${parts.join('\n')}\n  </url>`;
}

/** Wrap URL entries in a <urlset> document. */
export function buildUrlset(entries: UrlEntry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(urlXml).join('\n')}
</urlset>
`;
}

/** Wrap child sitemap references in a <sitemapindex> document. */
export function buildSitemapIndex(children: Array<{ loc: string; lastmod?: string }>): string {
  const body = children
    .map((c) => {
      const lm = c.lastmod ? `\n    <lastmod>${c.lastmod}</lastmod>` : '';
      return `  <sitemap>\n    <loc>${c.loc}</loc>${lm}\n  </sitemap>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>
`;
}

/** Split an array into fixed-size chunks (last chunk may be shorter). Exported so
 *  the 50k boundary is unit-testable without a 334k-row DB. */
export function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** How many carrier child sitemaps a given carrier count produces. */
export function carrierChunkCount(total: number): number {
  return Math.max(0, Math.ceil(Math.max(0, total) / SITEMAP_MAX_URLS));
}

/** One carrier as the sitemap sees it: its URL slug, its REAL last-change
 *  timestamp, and its data-richness score (see carrierRichness.ts). */
export interface CarrierSitemapRow {
  slug: string;
  updatedAt: Date | null;
  /** 0..100. Absent is treated as 0 (the sparse tier) — never as "rich". */
  score?: number;
  /** Fleet size, carried ONLY as the tie-break below. */
  powerUnits?: number | null;
}

/**
 * Build one carrier child <urlset> from a slice of carrier rows.
 *
 * `<priority>` and `<changefreq>` are derived PER ROW from the richness score
 * rather than stamped flat, so the document itself says which profiles carry
 * real data — a crawler that reads priority gets the signal even if it ignores
 * document order. `<lastmod>` is the row's own `updated_at`, which since the
 * truthful-timestamp change in carrierIngest.ts advances only on a genuine
 * field change; it is never `now()`.
 */
export function buildCarrierChunkXml(rows: CarrierSitemapRow[], now = new Date()): string {
  return buildUrlset(
    rows.map((r) => {
      const score = r.score ?? 0;
      return {
        loc: carrierLoc(r.slug),
        lastmod: fmtLastmod(r.updatedAt, now),
        changefreq: carrierChangefreq(score),
        priority: carrierPriority(score),
      };
    }),
  );
}

/**
 * Order carriers RICHEST FIRST so the earliest chunks — the ones a crawler on a
 * tight budget actually samples — hold our most substantive profiles.
 *
 * Sorted in JS, not SQL, deliberately: the rebuild already pulls every row into
 * memory to chunk it, and a 330k-row `ORDER BY` in Postgres would risk an
 * external merge sort inside the off-path scan's statement_timeout for no gain.
 * The SCORE is still computed server-side (one int per row) so the result set
 * stays small — see richnessScoreSql().
 *
 * TIE-BREAKS, in order: score, then FLEET SIZE, then slug. Fleet size is there
 * because the score saturates at its 100-point ceiling — 176 prod carriers score
 * exactly 100, and among them power_units ranges from 100 to 1,628. Breaking
 * that tie alphabetically would put "2951291 CANADA INC." ahead of a
 * 1,628-truck carrier for no reason; breaking it on fleet size orders the very
 * top of the sitemap by something that actually means something. Slug is the
 * final tie-break so the output is DETERMINISTIC across recomputes.
 *
 * Note that chunk boundaries are no longer stable the way `ORDER BY id` made
 * them: when a carrier's data changes, its score can move it to a different
 * chunk. That is fine — the index's <lastmod> changes on every rebuild anyway,
 * so a crawler refetches the children as a set, and no URL is ever dropped, only
 * reordered.
 */
export function sortCarriersByRichness(rows: CarrierSitemapRow[]): CarrierSitemapRow[] {
  return rows.sort(
    (a, b) =>
      (b.score ?? 0) - (a.score ?? 0) ||
      (b.powerUnits ?? 0) - (a.powerUnits ?? 0) ||
      a.slug.localeCompare(b.slug),
  );
}

/** Build the city-hub <urlset> from resolved (stateSlug, citySlug) hubs. */
export function buildCitiesXml(hubs: Array<{ stateSlug: string; citySlug: string }>, now = new Date()): string {
  const lastmod = fmtLastmod(now, now);
  return buildUrlset(
    hubs.map((h) => ({
      loc: `${SITE}/directory/${xmlEscape(h.stateSlug)}/${xmlEscape(h.citySlug)}`,
      lastmod,
      changefreq: 'weekly',
      // A city hub outranks every carrier profile beneath it (max 0.5): it is
      // the page that aggregates them, and the one with a real head-term query
      // behind it ("drayage carriers in Long Beach"). See carrierPriority().
      priority: '0.6',
    })),
  );
}

/** The 'guides' child <urlset> — one entry per PUBLISHED editorial article.
 *  lastmod is the row's real updated_at (never now()), so a crawler is told the
 *  truth about when the analysis last changed. Rows are supplied by the caller,
 *  which reads them through the published-only store helper — a draft can never
 *  reach this function. */
export function buildGuidesXml(
  guides: Array<{ slug: string; lastmod: Date | null }>,
  now = new Date(),
): string {
  return buildUrlset(
    guides.map((g) => ({
      loc: `${SITE}/guides/${xmlEscape(g.slug)}`,
      lastmod: fmtLastmod(g.lastmod, now),
      changefreq: 'monthly',
      priority: '0.7',
    })),
  );
}

/** Marketing / legal / product routes that are NOT carrier or city pages. These
 *  mirror the retired static sitemap.xml so nothing already-indexed drops out. */
const MARKETING_ROUTES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/pricing', changefreq: 'monthly', priority: '0.9' },
  { path: '/for/brokers', changefreq: 'monthly', priority: '0.8' },
  { path: '/for/ltl', changefreq: 'monthly', priority: '0.8' },
  { path: '/for/forwarders', changefreq: 'monthly', priority: '0.8' },
  { path: '/tools', changefreq: 'monthly', priority: '0.7' },
  { path: '/tools/oversize-permits', changefreq: 'monthly', priority: '0.7' },
  { path: '/tools/heavy-haul-quote', changefreq: 'monthly', priority: '0.7' },
  // Seasonal (spring thaw) restrictions. `weekly` on the index because its
  // status pills genuinely change through the season; the per-state pages are
  // appended below from the registry so adding a state adds its URL here too,
  // with no second list to forget.
  { path: '/tools/seasonal-weight-restrictions', changefreq: 'weekly', priority: '0.7' },
  { path: '/support', changefreq: 'monthly', priority: '0.6' },
  { path: '/security', changefreq: 'yearly', priority: '0.5' },
  { path: '/terms', changefreq: 'yearly', priority: '0.4' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.4' },
  { path: '/cookie', changefreq: 'yearly', priority: '0.4' },
  { path: '/refund', changefreq: 'yearly', priority: '0.4' },
  { path: '/dpa', changefreq: 'yearly', priority: '0.4' },
  { path: '/directory', changefreq: 'weekly', priority: '0.8' },
  { path: '/compliance', changefreq: 'monthly', priority: '0.7' },
  // ── Content surfaces that were LIVE but never advertised ──────────────────
  // Each of these returns 200 with a unique title/description/canonical and its
  // own JSON-LD, but none of them appeared in any sitemap document, so Google
  // could only find them by crawling a nav link. They are our informational and
  // commercial-intent pages — exactly the ones worth discovering.
  { path: '/compare', changefreq: 'monthly', priority: '0.7' },
  { path: '/glossary', changefreq: 'monthly', priority: '0.7' },
  { path: '/services', changefreq: 'monthly', priority: '0.7' },
  { path: '/importers', changefreq: 'weekly', priority: '0.7' },
  { path: '/manifest-privacy', changefreq: 'monthly', priority: '0.7' },
  { path: '/partners', changefreq: 'monthly', priority: '0.5' },
  { path: '/partners/terms', changefreq: 'yearly', priority: '0.3' },
  { path: '/drayage-rates', changefreq: 'monthly', priority: '0.8' },
  // The editorial hub. Individual articles live in the 'guides' child document
  // (below) because they are DB-backed and this list is static.
  { path: '/guides', changefreq: 'weekly', priority: '0.7' },
];

/**
 * EVERY path in the 'pages' document, with its crawl hints. Built from static
 * arrays only — no carrier scan.
 *
 * Extracted as a single list so `buildPagesXml`, `pagesUrlCount` and the
 * IndexNow submission all read the SAME source. Previously the count was a
 * hand-maintained sum of six `.length`s that had to be kept in step with the
 * builder by eye; now it cannot drift.
 *
 * PRIORITY LADDER — hub pages sit strictly ABOVE every carrier profile (which
 * tops out at 0.5, see carrierPriority()), because a hub aggregates hundreds of
 * profiles and answers a real head-term query. State and port hubs are 0.7 for
 * exactly that reason.
 */
export function staticPageEntries(): Array<{ path: string; changefreq: string; priority: string }> {
  const out: Array<{ path: string; changefreq: string; priority: string }> = [...MARKETING_ROUTES];
  // One page per state in the seasonal-restriction registry, generated FROM the
  // registry rather than listed by hand: adding a state to `sources.ts` adds its
  // URL here, and there is no second list to fall out of step.
  for (const spec of SEASONAL_SOURCES) {
    out.push({
      path: `/tools/seasonal-weight-restrictions/${spec.name.toLowerCase().replace(/\s+/g, '-')}`,
      // The states that actually restrict change through the season; the ones
      // that do not are a stable reference answer.
      changefreq: spec.programme === 'statewide' ? 'weekly' : 'monthly',
      priority: '0.6',
    });
  }
  for (const g of PORT_GROUPS) {
    out.push({ path: `/directory/port/${g.code}`, changefreq: 'weekly', priority: '0.7' });
  }
  for (const s of US_STATES) {
    out.push({ path: `/directory/${s.slug}`, changefreq: 'weekly', priority: '0.7' });
    // The COMPLETE A–Z city index for the state. 54 URLs that between them link
    // to all 24,728 city hubs.
    //
    // WHY THESE 54 URLS EARN THEIR PLACE IN A CRAWL-BUDGET-CONSTRAINED SITEMAP:
    // sitemap-cities.xml already advertised every city hub, but only the top-24
    // cards on each state page ever LINKED to one — 1,296 linked, ~23,400
    // orphaned — and a city hub is the only route to the 24 carriers on its
    // first page. That orphaning is why the link graph from `/` reached just
    // ~32,600 of 330,218 carrier profiles (9.2%) while the rest sat at
    // "Discovered – currently not indexed", lastCrawl NEVER. These index pages
    // are the link surface that fixes it, so they are worth discovering early.
    //
    // Only page 1 of each index is listed: pages 2..N are reachable from the
    // numbered pager on page 1, which links every page of the series directly.
    out.push({ path: `/directory/${s.slug}/cities`, changefreq: 'weekly', priority: '0.6' });
  }
  // Every glossary term and service category has its OWN page (/glossary/:slug,
  // /services/:slug) with a unique title, canonical and DefinedTerm/FAQPage
  // JSON-LD. They are enumerated from the same static arrays the routes serve,
  // so the sitemap can never advertise a slug that would 302 back to the hub.
  for (const t of GLOSSARY_TERMS) {
    out.push({ path: `/glossary/${t.slug}`, changefreq: 'monthly', priority: '0.5' });
  }
  for (const s of SERVICES) {
    out.push({ path: `/services/${s.slug}`, changefreq: 'monthly', priority: '0.6' });
  }
  for (const slug of DRAYAGE_RATE_SLUGS) {
    out.push({ path: `/drayage-rates/${slug}`, changefreq: 'monthly', priority: '0.7' });
  }
  return out;
}

/** Build the 'pages' child <urlset>: marketing + directory landing + every state
 *  hub + every port hub. NO carrier scan. lastmod is the recompute time. */
export function buildPagesXml(now = new Date()): string {
  const lastmod = fmtLastmod(now, now);
  return buildUrlset(
    staticPageEntries().map((r) => ({
      loc: `${SITE}${xmlEscape(r.path)}`,
      lastmod,
      changefreq: r.changefreq,
      priority: r.priority,
    })),
  );
}

/** Total <url> count of the 'pages' document — read from the same list the
 *  builder uses, so the two can never drift (persisted as url_count). */
export function pagesUrlCount(): number {
  return staticPageEntries().length;
}

/** Build the <sitemapindex> from the set of child document keys that exist. */
export function buildIndexXml(childKeys: string[], now = new Date()): string {
  const lastmod = fmtLastmod(now, now);
  return buildSitemapIndex(
    childKeys.map((key) => ({ loc: `${SITE}/${childDocFilename(key)}`, lastmod })),
  );
}

/** Map a document key to its served filename. 'pages' → 'sitemap-pages.xml', etc. */
export function childDocFilename(key: string): string {
  return `sitemap-${key}.xml`;
}

// ─── Off-path data reads (bounded, behind statement_timeout) ───────────────

/** Run `fn` inside a transaction whose statements are bounded by a server-side
 *  statement_timeout — so an off-path scan can never pin a pooled connection. */
async function boundedScan<T>(budgetMs: number, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${Math.ceil(budgetMs)}`));
    return fn(tx);
  });
}

/**
 * ALL carrier (slug, updatedAt, richness score) rows. OFF-PATH only (behind the
 * statement timeout).
 *
 * NO `ORDER BY`. The old query ordered by `id` purely to keep chunk boundaries
 * stable; the ordering that matters now is by richness, and that happens in JS
 * (`sortCarriersByRichness`) so Postgres never has to sort 330k rows. Dropping
 * the ORDER BY makes this a plain sequential scan — strictly cheaper than the
 * ordered scan it replaces.
 *
 * The SCORE is computed server-side so the wire payload stays three small
 * columns instead of the ~13 the scorer reads. A full scan is unavoidable here
 * by definition: the sitemap must enumerate every carrier. It is bounded by
 * `SET LOCAL statement_timeout` and runs only from the off-path rebuild.
 */
async function fetchAllCarrierRows(): Promise<CarrierSitemapRow[]> {
  return boundedScan(OFFPATH_SCAN_BUDGET_MS, async (tx) => {
    const rows = await tx
      .select({
        slug: carrierDirectory.publicSlug,
        updatedAt: carrierDirectory.updatedAt,
        score: sql<number>`${sql.raw(richnessScoreSql())}`.as('score'),
        powerUnits: carrierDirectory.powerUnits,
      })
      .from(carrierDirectory);
    return rows.map((r) => ({
      slug: r.slug,
      updatedAt: r.updatedAt,
      score: Number(r.score) || 0,
      powerUnits: r.powerUnits,
    }));
  });
}

/** Every REAL city hub — one (state, city) group per distinct city, resolved to a
 *  (stateSlug, citySlug) and deduped (case/spacing variants collapse to one slug).
 *  Only US states are emitted (matches the browse grid). OFF-PATH only. */
async function fetchAllCityHubs(): Promise<Array<{ stateSlug: string; citySlug: string }>> {
  const stateSlugByCode = new Map(US_STATES.map((s) => [s.code, s.slug]));
  const rows = await boundedScan(OFFPATH_SCAN_BUDGET_MS, async (tx) =>
    tx
      .select({ state: carrierDirectory.state, city: carrierDirectory.city })
      .from(carrierDirectory)
      .where(sql`${carrierDirectory.city} is not null and ${carrierDirectory.city} <> '' and ${carrierDirectory.state} is not null`)
      .groupBy(carrierDirectory.state, carrierDirectory.city),
  );
  const seen = new Set<string>();
  const hubs: Array<{ stateSlug: string; citySlug: string }> = [];
  for (const r of rows) {
    const code = (r.state ?? '').toUpperCase();
    const stateSlug = stateSlugByCode.get(code);
    if (!stateSlug) continue; // non-US (CA/MX) codes are not browsable hubs
    const citySlug = citySlugify(r.city ?? '');
    if (!citySlug) continue;
    const dedup = `${stateSlug}/${citySlug}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    hubs.push({ stateSlug, citySlug });
  }
  // Stable output order so the materialized doc is deterministic across recomputes.
  hubs.sort((a, b) => (a.stateSlug === b.stateSlug ? a.citySlug.localeCompare(b.citySlug) : a.stateSlug.localeCompare(b.stateSlug)));
  return hubs;
}

// ─── Materialize (off the request path) ────────────────────────────────────

interface SitemapDoc {
  key: string;
  xml: string;
  urlCount: number;
}

/** Upsert one sitemap document row. */
async function persistDoc(doc: SitemapDoc, computedAt: Date): Promise<void> {
  await db()
    .insert(sitemapCache)
    .values({ key: doc.key, xml: doc.xml, urlCount: doc.urlCount, computedAt })
    .onConflictDoUpdate({
      target: sitemapCache.key,
      set: { xml: doc.xml, urlCount: doc.urlCount, computedAt },
    });
}

/**
 * Recompute ALL sitemap documents and persist them to sitemap_cache. Runs OFF the
 * request path (ingest end / refresh cron / boot). Bounded by a total wall-clock
 * cap so a starved run aborts before the cron slow-run watchdog. Returns the
 * child-key set + carrier count for logging/tests.
 */
export async function recomputeAndPersistSitemap(): Promise<{ childKeys: string[]; carriers: number; cities: number }> {
  const result = await withWallClockDeadline(
    recomputeAndPersistSitemapInner(),
    OFFPATH_RECOMPUTE_BUDGET_MS,
    'sitemap recompute',
  );
  // ── IndexNow: announce what CHANGED, after the rebuild has already succeeded.
  // Deliberately OUTSIDE the rebuild's wall-clock budget: the sitemap is the
  // load-bearing artefact and must never fail because a best-effort push to
  // Bing was slow. `runIndexNowSubmission` is itself default-deny (inert
  // without INDEXNOW_ENABLED + INDEXNOW_KEY) and never throws.
  //
  // THIS IS THE TRIGGER POINT for every real change event: the weekly FMCSA
  // ingest reaches it via ensureFreshSitemap()'s carrier-count drift rebuild,
  // a new city hub reaches it the same way, and a /guides approval reaches it
  // because the approve route calls recomputeAndPersistSitemap() directly.
  await maybeAnnounceViaIndexNow(result.families);
  return { childKeys: result.childKeys, carriers: result.carriers, cities: result.cities };
}

/** Fire one IndexNow run against its own bounded transaction. Never throws —
 *  the sitemap rebuild that called it has already committed. */
async function maybeAnnounceViaIndexNow(families: IndexNowSmallFamilies): Promise<void> {
  try {
    await withWallClockDeadline(
      boundedScan(OFFPATH_SCAN_BUDGET_MS, (tx) => runIndexNowSubmission(SITE, families, tx)),
      INDEXNOW_RUN_BUDGET_MS,
      'indexnow submission',
    );
  } catch (err) {
    console.warn('[sitemap] IndexNow submission skipped (non-fatal):', (err as Error)?.message);
  }
}

interface SitemapRecomputeResult {
  childKeys: string[];
  carriers: number;
  cities: number;
  /** The non-carrier URL families, handed to IndexNow so it does not have to
   *  re-derive (or re-query) what the rebuild just computed. */
  families: IndexNowSmallFamilies;
}

async function recomputeAndPersistSitemapInner(): Promise<SitemapRecomputeResult> {
  const now = new Date();
  const carriers = sortCarriersByRichness(await fetchAllCarrierRows());
  const cityHubs = await fetchAllCityHubs();
  // Published guides only — the store helper applies the status filter, so this
  // caller cannot accidentally advertise a draft.
  const { listPublishedGuides } = await import('../seo/store.js');
  const guides = (await listPublishedGuides()).map((g) => ({
    slug: g.slug,
    lastmod: g.updatedAt ?? g.publishedAt,
  }));

  const carrierChunks = chunkArray(carriers, SITEMAP_MAX_URLS);
  const docs: SitemapDoc[] = [];

  // 'pages' + 'cities' children.
  docs.push({ key: 'pages', xml: buildPagesXml(now), urlCount: pagesUrlCount() });
  docs.push({ key: 'cities', xml: buildCitiesXml(cityHubs, now), urlCount: cityHubs.length });
  docs.push({ key: 'guides', xml: buildGuidesXml(guides, now), urlCount: guides.length });

  // Carrier children — carriers-1..N (1-indexed so /sitemap-carriers-1.xml reads
  // naturally). An empty directory still emits carriers-1 as a valid empty urlset.
  const chunkKeys: string[] = [];
  const chunkList = carrierChunks.length ? carrierChunks : [[]];
  chunkList.forEach((chunk, i) => {
    const key = `carriers-${i + 1}`;
    chunkKeys.push(key);
    docs.push({ key, xml: buildCarrierChunkXml(chunk, now), urlCount: chunk.length });
  });

  // Index references pages + cities + every carrier chunk.
  const childKeys = ['pages', 'cities', 'guides', ...chunkKeys];
  docs.push({ key: 'index', xml: buildIndexXml(childKeys, now), urlCount: childKeys.length });

  for (const doc of docs) await persistDoc(doc, now);

  // Drop orphaned carrier chunks from a previous, larger recompute (carrier count
  // shrank) so the index never references — and a crawler never fetches — a stale
  // chunk. Compare the numeric suffix against the chunk count we just wrote.
  const keep = new Set(docs.map((d) => d.key));
  const existing = await db().select({ key: sitemapCache.key }).from(sitemapCache);
  const orphans = existing.map((r) => r.key).filter((k) => k.startsWith('carriers-') && !keep.has(k));
  for (const key of orphans) {
    await db().delete(sitemapCache).where(sql`${sitemapCache.key} = ${key}`);
  }

  invalidateSitemapMemCache();
  return {
    childKeys,
    carriers: carriers.length,
    cities: cityHubs.length,
    families: {
      pagePaths: staticPageEntries().map((e) => e.path),
      cityHubs,
      guides,
    },
  };
}

/** How many carrier <loc>s the CURRENTLY-materialized chunks hold, summed over the
 *  handful of `carriers-%` rows (≈7 rows — effectively O(1), never a carrier scan).
 *  Returns null when it cannot be determined, which the caller treats as "no drift
 *  signal" so a read failure can never force a needless 334k recompute. */
async function materializedCarrierCount(): Promise<number | null> {
  try {
    const rows = await db()
      .select({ total: sql<number>`coalesce(sum(${sitemapCache.urlCount}), 0)::int` })
      .from(sitemapCache)
      .where(sql`${sitemapCache.key} like 'carriers-%'`);
    const total = rows[0]?.total;
    return typeof total === 'number' && Number.isFinite(total) ? total : null;
  } catch (err) {
    console.warn('[sitemap] materializedCarrierCount failed:', err);
    return null;
  }
}

/**
 * Safety-net populate for boot + the refresh cron: recompute+persist when the
 * 'index' row is missing, older than `maxAgeMs`, OR when the carrier count has
 * DRIFTED from what the chunks currently hold. Never throws (best-effort).
 *
 * The drift check is what makes new carriers discoverable promptly. The weekly
 * FMCSA re-ingest runs in the BACKGROUND (forceReingestCarrierDirectory returns as
 * soon as it is kicked), so the cron cannot rebuild the sitemap inline right after
 * it — the ingest has not finished writing. Instead, once the ingest lands, the
 * next hourly tick sees the persisted directory total no longer match the
 * materialized <loc> count and rebuilds. Both sides are O(1) reads (the persisted
 * aggregate summary + a sum over ~7 sitemap_cache rows), so the common no-drift
 * case stays cheap and NOTHING here ever scans carrier_directory on a request.
 */
export async function ensureFreshSitemap(maxAgeMs: number = SITEMAP_MAX_AGE_MS): Promise<'fresh' | 'recomputed' | 'error'> {
  try {
    const existing = await readSitemapRow('index');
    if (existing && Date.now() - existing.computedAt.getTime() < maxAgeMs) {
      // Still within max-age — rebuild early only on a real carrier-count drift.
      const [have, want] = await Promise.all([
        materializedCarrierCount(),
        getDirectorySummary()
          .then((s) => s.total)
          .catch(() => null),
      ]);
      if (have == null || want == null || have === want) return 'fresh';
      console.log(`[sitemap] carrier count drift (materialized=${have}, directory=${want}) — rebuilding`);
    }
    await recomputeAndPersistSitemap();
    return 'recomputed';
  } catch (err) {
    console.warn('[sitemap] ensureFreshSitemap failed (non-fatal):', err);
    return 'error';
  }
}

// ─── Request-path serving (O(1) PK lookup, memory-shielded) ────────────────

interface SitemapRow {
  xml: string;
  computedAt: Date;
}

/** Raw single-row PK read of one sitemap document. Returns null when absent or on
 *  ANY read error so the caller degrades gracefully — never a throw. PK lookup,
 *  NOT a scan, so it is safe on the request path. */
async function readSitemapRow(key: string): Promise<SitemapRow | null> {
  try {
    const rows = await db()
      .select({ xml: sitemapCache.xml, computedAt: sitemapCache.computedAt })
      .from(sitemapCache)
      .where(sql`${sitemapCache.key} = ${key}`)
      .limit(1);
    const r = rows[0];
    return r ? { xml: r.xml, computedAt: r.computedAt } : null;
  } catch (err) {
    console.warn(`[sitemap] readSitemapRow(${key}) failed:`, err);
    return null;
  }
}

const sitemapMem = new Map<string, { at: number; val: SitemapRow | null }>();
const sitemapInflight = new Map<string, Promise<SitemapRow | null>>();

/** Drop the in-memory shield so the next read re-hits the persisted rows (called
 *  right after a recompute so a long-lived process serves the fresh docs at once). */
export function invalidateSitemapMemCache(): void {
  sitemapMem.clear();
}

/** Read a sitemap document with stale-while-revalidate: a cached value (fresh or
 *  stale) returns immediately; a stale one triggers ONE background PK re-read; a
 *  cold miss awaits a single-flighted read. Mirrors loadPersistedAggregates(). */
async function loadSitemapDoc(key: string): Promise<SitemapRow | null> {
  const cached = sitemapMem.get(key);
  if (cached) {
    if (Date.now() - cached.at >= SITEMAP_MEM_TTL_MS && !sitemapInflight.has(key)) {
      const p = readSitemapRow(key).then((val) => {
        sitemapMem.set(key, { at: Date.now(), val });
        return val;
      });
      sitemapInflight.set(key, p);
      void p.catch(() => {}).finally(() => sitemapInflight.delete(key));
    }
    return cached.val;
  }
  let inflight = sitemapInflight.get(key);
  if (!inflight) {
    inflight = readSitemapRow(key).then((val) => {
      sitemapMem.set(key, { at: Date.now(), val });
      return val;
    });
    sitemapInflight.set(key, inflight);
    void inflight.catch(() => {}).finally(() => sitemapInflight.delete(key));
  }
  try {
    return await inflight;
  } catch {
    return null;
  }
}

/** Fire a background recompute at most once at a time (used on a cold cache miss
 *  so the docs get built without blocking — or scanning on — the crawler's request). */
let bgRecomputeInflight: Promise<unknown> | null = null;
function kickBackgroundRecompute(): void {
  if (bgRecomputeInflight) return;
  bgRecomputeInflight = ensureFreshSitemap()
    .catch((err) => console.warn('[sitemap] background recompute failed:', err))
    .finally(() => {
      bgRecomputeInflight = null;
    });
}

/** Result of a serve request: XML body + whether it came from the materialized
 *  cache (`cached`) or a cold-miss fallback (`fallback`). */
export interface ServeResult {
  xml: string;
  source: 'cache' | 'fallback';
}

/**
 * The <sitemapindex> for /sitemap.xml. Served from the materialized 'index' row
 * (O(1) PK lookup). On a cold miss it builds a fallback index from the persisted
 * directory summary's carrier total (ALSO an O(1) PK lookup — never a scan) so the
 * route always references the right number of carrier children, and kicks a
 * background recompute to materialize the real documents.
 */
export async function serveSitemapIndex(): Promise<ServeResult> {
  const row = await loadSitemapDoc('index');
  if (row) return { xml: row.xml, source: 'cache' };
  kickBackgroundRecompute();
  // Fallback: derive the child set from the persisted summary total (O(1)).
  let total = 0;
  try {
    total = (await getDirectorySummary()).total;
  } catch {
    total = 0;
  }
  const chunkCount = Math.max(1, carrierChunkCount(total));
  const chunkKeys = Array.from({ length: chunkCount }, (_v, i) => `carriers-${i + 1}`);
  return { xml: buildIndexXml(['pages', 'cities', 'guides', ...chunkKeys]), source: 'fallback' };
}

/** A child <urlset> by key ('pages' | 'cities' | 'carriers-N'). Cold miss → a valid
 *  empty urlset (or the freshly-buildable static 'pages') + a background recompute,
 *  never an error and never a scan on the request path. */
export async function serveSitemapChild(key: string): Promise<ServeResult> {
  const row = await loadSitemapDoc(key);
  if (row) return { xml: row.xml, source: 'cache' };
  kickBackgroundRecompute();
  // 'pages' is scan-free to build, so serve the real doc even on a cold miss.
  if (key === 'pages') return { xml: buildPagesXml(), source: 'fallback' };
  return { xml: buildUrlset([]), source: 'fallback' };
}

/** Validate + normalize a `carriers-:n` route param into a document key, or null
 *  when malformed (so the route can 404). n must be a positive integer with no
 *  leading zeros / junk. */
export function carrierChunkKey(nRaw: string): string | null {
  if (!/^[1-9][0-9]*$/.test(nRaw)) return null;
  return `carriers-${nRaw}`;
}
