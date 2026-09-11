/**
 * INDEX QUALITY FLOOR — the single rule that decides whether a GENERATED hub page
 * (city hub, port/intermodal hub) is allowed to compete in Google's index.
 *
 * ─── THE MEASURED PROBLEM ───────────────────────────────────────────────────
 * `sitemap-cities.xml` advertises 24,730 city hubs, one per distinct (state, city)
 * in carrier_directory. A 400-URL evenly-spread sample of the LIVE sitemap
 * (2026-09-11, 400/400 fetched, zero failures) measured this distribution:
 *
 *     carriers │ share  │ est. URLs of 24,730
 *     ─────────┼────────┼────────────────────
 *        1     │ 32.0%  │  7,914
 *        2     │ 12.8%  │  3,153
 *        3     │  9.3%  │  2,288
 *        4–5   │ 11.8%  │  2,906
 *        6–10  │ 13.5%  │  3,339
 *        11–25 │ 11.0%  │  2,720
 *        26+   │  9.8%  │  2,411
 *
 * So 54.0% of every city URL we submit to Google lists THREE OR FEWER carriers.
 *
 * ─── WHY A COUNT IS THE HONEST CONTENT MEASURE HERE ─────────────────────────
 * A count threshold is usually a hunch dressed up as a rule, so it was checked
 * against rendered content. Regressing visible words on carrier count over 52
 * live city pages gives an almost perfectly linear fit:
 *
 *     visible words ≈ 1,078 (boilerplate) + 27.4 × min(carriers, 24)
 *
 * The intercept is the template — nav, hero, facet rail, 23 sibling-city chips,
 * FAQ, footer, disclaimer — and it is BYTE-IDENTICAL across city hubs. The slope
 * is the only thing on the page that varies: one carrier row. A 6-gram shingle
 * diff of two 3-carrier hubs in different states put 82.3% of the visible text in
 * common; two large hubs shared 48.7%.
 *
 * That is the finding that settles the design: a city hub has NO editorial
 * content of its own. There is no intro essay, no local copy, no curated blurb —
 * nothing that could make a 2-carrier page substantive while a 4-carrier page is
 * thin. Unique content IS carrier rows. So a content-based rule and a count-based
 * rule are THE SAME RULE on this template, and the count is the cheaper, more
 * legible expression of it. (If city hubs ever gain real per-city prose, this is
 * the one place that has to learn about it.)
 *
 * ─── WHY FOUR ──────────────────────────────────────────────────────────────
 * At the measured 27.4 words/row, the floor buys:
 *
 *     1 carrier  →  2.5% of the page is unique   ← a duplicate of one carrier
 *                                                  profile, wearing hub chrome
 *     2 carriers →  4.8%
 *     3 carriers →  7.1%
 *     4 carriers →  9.2%   ← floor
 *
 * The decisive case is n=1 (32% of all city URLs, the single largest bucket):
 * that page says nothing the carrier's own profile does not already say, and it
 * competes with that profile for the same query while carrying 97.5% boilerplate.
 * n=2 and n=3 are the same page with one or two more rows. Four is where the page
 * starts doing the one job a directory listing exists to do — let someone COMPARE
 * options — rather than restating a single record.
 *
 * The threshold is deliberately NOT set higher. 6–10 carriers is only 13–20%
 * unique text, but those pages list six to ten real businesses and answer a real
 * "carriers in <town>" query; noindexing them would be trading a thin-content
 * problem for a coverage problem.
 *
 * ─── WHY noindex,follow AND NOT A CANONICAL TO THE STATE PAGE ───────────────
 * `follow` is load-bearing: a thin city hub is the ONLY internal link to the
 * carrier profiles beneath it (the state page links just its top 24 cities), and
 * those ~330k profiles are the genuinely good pages this whole change exists to
 * protect. `noindex,nofollow` would strand them.
 *
 * A cross-page rel=canonical to `/directory/{state}` is deliberately NOT emitted:
 *   • The state hub is not an equivalent page. "Carriers in Addison, AL" (3 rows)
 *     and "Carriers in Alabama" (21k rows) are different intents over different
 *     content; a canonical asserts duplication that does not exist, and Google
 *     ignores a misapplied canonical at best.
 *   • noindex + a canonical POINTING ELSEWHERE is a self-contradicting pair — one
 *     tag says "index the target instead", the other says "do not index this" —
 *     and the noindex can propagate to the canonical target. A wrong canonical is
 *     worse than none.
 * The page keeps its SELF-canonical, which is unambiguous next to noindex, and it
 * already carries a breadcrumb plus an "All {state} carriers →" link so both
 * users and crawlers have the sensible onward route.
 *
 * ─── DYNAMIC BY CONSTRUCTION ───────────────────────────────────────────────
 * There is no list of thin cities anywhere. Both consumers evaluate the SAME
 * predicate against the SAME live count out of carrier_directory:
 *   • the RENDERER (pages.ts) against the total it just queried, and
 *   • the SITEMAP (sitemapCache.ts) against the count in its off-path rebuild.
 * A city that gains a 4th carrier in the weekly FMCSA ingest starts being indexed
 * and re-enters the sitemap on the next rebuild with no code change; one that
 * loses its 4th leaves. Keeping the rule in ONE module is what stops the page and
 * the sitemap from ever disagreeing about which URLs are indexable.
 */

/**
 * Minimum carriers a generated hub must list to be indexable. See the module
 * header for the measurement behind the number — it is not a hunch.
 */
export const HUB_INDEX_MIN_CARRIERS = 4;

/** The robots directive for a hub below the floor. `follow` is mandatory: link
 *  equity has to keep flowing through to the carrier profiles underneath. */
export const THIN_HUB_ROBOTS = 'noindex, follow';

/** Does a hub listing `total` carriers earn a place in the index? */
export function isIndexableHub(total: number | null | undefined): boolean {
  return typeof total === 'number' && Number.isFinite(total) && total >= HUB_INDEX_MIN_CARRIERS;
}

/**
 * The `<meta name="robots">` value for a hub listing `total` carriers, or
 * `undefined` for the default (indexable) — `layout()` omits the tag entirely
 * when this is undefined, so a healthy hub's HTML is byte-identical to today's.
 */
export function hubRobotsDirective(total: number | null | undefined): string | undefined {
  return isIndexableHub(total) ? undefined : THIN_HUB_ROBOTS;
}
