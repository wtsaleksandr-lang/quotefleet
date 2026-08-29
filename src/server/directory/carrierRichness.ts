/**
 * CARRIER DATA-RICHNESS SCORE — the crawl-budget prioritiser for the sitemap.
 *
 * THE PROBLEM THIS SOLVES (measured in Search Console, 2026-08-29): the dynamic
 * sitemap successfully submitted 355,075 URLs and Google read all of them — a
 * sampled carrier page moved from "URL is unknown to Google" to "Discovered –
 * currently not indexed" with lastCrawl: NEVER. Discovery is DONE; the binding
 * constraint is now CRAWL BUDGET on a young, low-authority domain. Google will
 * fetch a small fraction of 330k URLs, and it samples heavily from what it meets
 * FIRST in each document.
 *
 * Until now carrier <loc>s were emitted in `id` order — i.e. FMCSA USDOT
 * issuance order, which is random with respect to page quality. So the first
 * chunk Google sampled was a random draw, and a one-truck carrier with a single
 * cargo flag was as likely to be crawled as a 400-truck fleet carrying a safety
 * rating, a DBA name and eight equipment specialities. Thin pages that get
 * crawled and not indexed spend budget AND teach the crawler that this URL
 * pattern is low-value.
 *
 * So: score every carrier on how much REAL data its profile page renders, and
 * emit richest-first. Same URLs, same count — better order.
 *
 * ── THE WEIGHTS ARE MEASURED, NOT GUESSED ───────────────────────────────────
 * A first cut of this score weighted the "obvious" completeness fields (MC
 * number present, authority present, city/state present, phone present…). A
 * read-only census against PROD (330,218 rows, 2026-08-29) showed that scoring
 * PRESENCE is almost useless here, because the FMCSA census is almost complete:
 *
 *     mc_number      100.00%      drivers        99.41%
 *     authority_type 100.00%      phone          99.32%
 *     city + state   100.00%      power_units    97.85%
 *     email           97.57%      nearest_port   96.80%
 *     dba_name        18.66%      safety_rating   7.73%
 *
 * Eight of eleven signals are ≥96.8% populated, so they were handing every row
 * the same constant and ordering nothing: scores collapsed into 28–100 with a
 * single 124,106-row plateau (37.6% of the table) at exactly 74. A threshold
 * anywhere near it swung the "rich" set between 55% and 96% of the directory on
 * a ONE-POINT move. That is not a ranking, it is a coin flip with extra steps.
 *
 * This version therefore spends its weight where the data actually VARIES:
 *   • fleet MAGNITUDE (power_units, drivers) — not "is it present" but "how big",
 *     because a 400-truck operator's page renders a materially richer record
 *     than a one-truck operator's;
 *   • safety_rating (7.73% — the rarest and highest-trust datum we render);
 *   • equipment/cargo BREADTH (how many census specialities, 0–20);
 *   • dba_name (18.66%).
 * The near-universal presence fields keep small weights: they are still real
 * page content, and the day a re-ingest leaves them null the score should
 * notice — they just no longer pretend to rank anything.
 *
 * ── ORDERING, NOT EXCLUSION (deliberate) ────────────────────────────────────
 * Sparse carriers stay IN the sitemap, just later. Three reasons:
 *   1. Even a thin profile is a unique, legitimate page with its own title,
 *      canonical and LocalBusiness JSON-LD, and it is the only surface that can
 *      ever rank for the long-tail "USDOT 1234567" / "<exact legal name>" query.
 *      Those queries are low-volume but perfectly qualified.
 *   2. Dropping a URL a crawler has ALREADY discovered is a negative signal — it
 *      reads as abandonment, not curation, and a sitemap has no way to say
 *      "deprioritise" by omission.
 *   3. Ordering is free and reversible; exclusion is a permanent decision made
 *      on data that gets richer with every re-ingest. A carrier that is sparse
 *      today may be complete after the next Sunday pass.
 * `<priority>` carries the same signal declaratively, so a crawler that reads
 * priority gets it without depending on document order.
 *
 * ── KNOWN LIMITATION (accepted, measured) ───────────────────────────────────
 * The low end of this score is NOT junk data. It contains real, well-known
 * asset-light operators — FEDEX CUSTOM CRITICAL, BNSF LOGISTICS, SPAN-ALASKA —
 * which are brokers/forwarders (several carry `FF…` docket numbers, not `MC…`)
 * and report no power units or drivers. They rank low because OUR PAGE ABOUT
 * THEM is genuinely thin, which is the right answer for a crawl-budget
 * question: we are not going to outrank fedex.com for "FedEx", so spending an
 * early crawl slot on a near-empty FedEx profile is a worse trade than spending
 * it on a 400-truck regional carrier nobody else has a page for. Flagged here so
 * the behaviour is a decision on the record rather than a surprise. If we later
 * render broker-specific content (authority history, brokered-lane data), those
 * pages get richer and the score follows automatically.
 *
 * ── ONE SCORE, TWO IMPLEMENTATIONS, PROVEN EQUAL ────────────────────────────
 * The score exists as a SQL expression (so the 330k-row scan returns one tiny
 * `int` per row instead of ~35 columns of payload) and as a pure TS function (so
 * it is unit-testable and reusable in memory). `carrierRichness.test.ts` drives
 * the same fixture matrix through both and asserts identical results, so they
 * cannot drift.
 *
 * NOTE ON WHAT IS *NOT* SCORED: the brief for this work listed "insurance on
 * file" as a signal. `carrier_directory` has NO insurance column — the FMCSA
 * L&I / census ingest never pulled one (see carrierIngest.ts). Rather than
 * invent a proxy and call it insurance, it is absent. Likewise "active
 * authority": the ingest filters to ACTIVE carriers at the source, so presence
 * in the table IS that signal, and `authority_type` (common/contract) is the
 * only extra granularity available.
 */

/**
 * Fleet-size bands for `power_units`. Step functions rather than a raw number so
 * the score stays bounded and a 5,000-truck outlier cannot dominate the whole
 * ordering. Read as: [minimum power units, points].
 */
export const FLEET_BANDS: ReadonlyArray<readonly [number, number]> = [
  [100, 20],
  [25, 16],
  [10, 12],
  [3, 8],
  [1, 4],
];

/** Driver-count bands, same shape as FLEET_BANDS. */
export const DRIVER_BANDS: ReadonlyArray<readonly [number, number]> = [
  [100, 12],
  [25, 10],
  [10, 7],
  [3, 4],
  [1, 2],
];

/** Flat weights for the remaining signals. */
export const RICHNESS_WEIGHTS = {
  /** A safety rating (S/C/U). Present on just 7.73% of prod rows — the rarest
   *  and most trust-bearing thing the profile renders, so the biggest weight. */
  safetyRating: 20,
  /** Points PER equipment/cargo speciality, up to FLAG_CAP of them. */
  perFlag: 3,
  /** Doing-business-as name — 18.66% of rows, and real name completeness. */
  dbaName: 8,
  /** Nearest container/rail hub — powers the port-hub internal link. */
  nearestPort: 6,
  /** Contactable by phone. Zeroed on a contact opt-out (the page hides it). */
  phone: 6,
  /** A contact email. Zeroed on a contact opt-out. */
  email: 4,
  /** City AND state — unlocks the LocalBusiness address block and the city-hub
   *  link. Half an address is not an address, hence AND. */
  cityState: 3,
  /** Docket/MC number — broker-facing credibility + a second search key. */
  mcNumber: 2,
  /** Operating-authority type (common / contract). */
  authorityType: 1,
} as const;

/** At most this many equipment/cargo flags count. Caps a carrier that ticks
 *  fifteen census boxes so breadth cannot outweigh fleet size + safety rating. */
export const FLAG_CAP = 6;

/** Theoretical maximum — the top fleet band + the top driver band + every flat
 *  weight + a full flag cap. Exactly 100, so the score reads as a percentage of
 *  a known ceiling. */
export const MAX_RICHNESS_SCORE =
  FLEET_BANDS[0][1] + // 20
  DRIVER_BANDS[0][1] + // 12
  RICHNESS_WEIGHTS.safetyRating + // 20
  RICHNESS_WEIGHTS.perFlag * FLAG_CAP + // 18
  RICHNESS_WEIGHTS.dbaName + // 8
  RICHNESS_WEIGHTS.nearestPort + // 6
  RICHNESS_WEIGHTS.phone + // 6
  RICHNESS_WEIGHTS.email + // 4
  RICHNESS_WEIGHTS.cityState + // 3
  RICHNESS_WEIGHTS.mcNumber + // 2
  RICHNESS_WEIGHTS.authorityType; // 1  → 100

/** The equipment/cargo boolean COLUMNS counted by the flag term. Snake_case
 *  because this list is spliced straight into the SQL expression; the TS scorer
 *  takes the already-counted number so it never has to mirror the names. */
export const RICHNESS_FLAG_COLUMNS: readonly string[] = [
  'intermodal',
  'hazmat',
  'dry_van',
  'reefer',
  'tanker',
  'flatbed',
  'dry_bulk',
  'household_goods',
  'beverages',
  'produce',
  'motor_vehicles',
  'livestock',
  'grain_feed',
  'oilfield',
  'meat',
  'paper',
  'construction',
  'farm_supplies',
  'coal_coke',
  'building_materials',
];

/** The subset of a carrier row the score reads. Deliberately structural (not the
 *  drizzle row type) so the pure scorer stays DB-free and trivially testable. */
export interface RichnessInput {
  mcNumber?: string | null;
  authorityType?: string | null;
  powerUnits?: number | null;
  drivers?: number | null;
  safetyRating?: string | null;
  nearestPortCode?: string | null;
  dbaName?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  contactHidden?: boolean | null;
  /** How many of RICHNESS_FLAG_COLUMNS are true on this row. */
  flagCount?: number | null;
}

/** Non-empty text test, matching the SQL `x IS NOT NULL AND btrim(x) <> ''`. */
function hasText(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/** Points for a magnitude, using the first band whose minimum it reaches.
 *  A null / zero / negative count scores 0 — a carrier reporting ZERO power
 *  units renders exactly as little as one reporting none. */
function bandPoints(v: number | null | undefined, bands: ReadonlyArray<readonly [number, number]>): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  for (const [min, pts] of bands) if (v >= min) return pts;
  return 0;
}

/**
 * The data-richness score, 0..MAX_RICHNESS_SCORE. Pure. Must stay behaviourally
 * identical to `richnessScoreSql()` — carrierRichness.test.ts enforces it.
 */
export function carrierRichnessScore(row: RichnessInput): number {
  const w = RICHNESS_WEIGHTS;
  let score = bandPoints(row.powerUnits, FLEET_BANDS) + bandPoints(row.drivers, DRIVER_BANDS);
  if (hasText(row.safetyRating)) score += w.safetyRating;
  if (hasText(row.dbaName)) score += w.dbaName;
  if (hasText(row.nearestPortCode)) score += w.nearestPort;
  if (hasText(row.city) && hasText(row.state)) score += w.cityState;
  if (hasText(row.mcNumber)) score += w.mcNumber;
  if (hasText(row.authorityType)) score += w.authorityType;
  // A carrier who asked us to hide their contact details renders neither, so
  // neither counts — the page genuinely IS thinner.
  if (!row.contactHidden) {
    if (hasText(row.phone)) score += w.phone;
    if (hasText(row.email)) score += w.email;
  }
  const flags = Math.max(0, Math.min(FLAG_CAP, Math.trunc(row.flagCount ?? 0)));
  return score + flags * w.perFlag;
}

/** Render a band list as a nested SQL CASE over one column. */
function bandSql(column: string, bands: ReadonlyArray<readonly [number, number]>): string {
  const whens = bands.map(([min, pts]) => `WHEN "${column}" >= ${min} THEN ${pts}`).join(' ');
  return `(CASE WHEN "${column}" IS NULL THEN 0 ${whens} ELSE 0 END)`;
}

/**
 * The SAME score as a SQL scalar expression over an unqualified
 * `carrier_directory` row. Returned as raw SQL text (not a drizzle `sql`
 * template) so it can be embedded with `sql.raw()` by the two callers that need
 * it AND pasted verbatim into an EXPLAIN during review.
 *
 * WHY IN SQL AT ALL: the sitemap rebuild enumerates all ~330k carriers. Pulling
 * the ~13 scoring columns over the wire to score them in JS would multiply the
 * result-set payload several-fold for no benefit; computing the score
 * server-side returns ONE extra int per row. The sitemap's sort still happens in
 * JS (see sitemapCache.ts) so Postgres never has to spill a 330k-row sort.
 */
export function richnessScoreSql(): string {
  const w = RICHNESS_WEIGHTS;
  const flagSum = RICHNESS_FLAG_COLUMNS.map((c) => `"${c}"::int`).join(' + ');
  return `(
    ${bandSql('power_units', FLEET_BANDS)} +
    ${bandSql('drivers', DRIVER_BANDS)} +
    (CASE WHEN "safety_rating" IS NOT NULL AND btrim("safety_rating") <> '' THEN ${w.safetyRating} ELSE 0 END) +
    (CASE WHEN "dba_name" IS NOT NULL AND btrim("dba_name") <> '' THEN ${w.dbaName} ELSE 0 END) +
    (CASE WHEN "nearest_port_code" IS NOT NULL AND btrim("nearest_port_code") <> '' THEN ${w.nearestPort} ELSE 0 END) +
    (CASE WHEN "city" IS NOT NULL AND btrim("city") <> '' AND "state" IS NOT NULL AND btrim("state") <> '' THEN ${w.cityState} ELSE 0 END) +
    (CASE WHEN "mc_number" IS NOT NULL AND btrim("mc_number") <> '' THEN ${w.mcNumber} ELSE 0 END) +
    (CASE WHEN "authority_type" IS NOT NULL AND btrim("authority_type") <> '' THEN ${w.authorityType} ELSE 0 END) +
    (CASE WHEN "contact_hidden" THEN 0 WHEN "phone" IS NOT NULL AND btrim("phone") <> '' THEN ${w.phone} ELSE 0 END) +
    (CASE WHEN "contact_hidden" THEN 0 WHEN "email" IS NOT NULL AND btrim("email") <> '' THEN ${w.email} ELSE 0 END) +
    (LEAST(${FLAG_CAP}, (${flagSum})) * ${w.perFlag})
  )::int`;
}

// ─── Tiers → <priority> / <changefreq> ──────────────────────────────────────

/**
 * Tier cut-offs, chosen against the MEASURED prod distribution of THIS score
 * (330,218 rows, 2026-08-29 — min 6, max 100, median 37, 87 distinct buckets):
 *
 *   rich   (≥55)     33,213 rows   10.1%
 *   mid    (35–54)  155,689 rows   47.1%
 *   sparse (<35)    141,316 rows   42.8%
 *
 * Both cuts land on FLAT parts of the curve, which is the whole point of
 * measuring rather than picking round numbers. The distribution has one large
 * plateau — 90,688 rows (27.5%) at exactly score 31 — and 35 clears it entirely,
 * so the plateau falls wholly into `sparse` and no threshold slices it. The
 * buckets adjacent to 55 are small (1,256 at 55; 1,450 at 56), so a point of
 * drift there moves well under 1% of the table.
 *
 * For comparison, the first version of this score — which weighted mere
 * PRESENCE of near-universal fields — put 124,106 rows (37.6%) in a single
 * bucket straddling the natural cut, where moving the threshold one point swung
 * the "rich" set between 55% and 96% of the directory.
 */
export const RICH_TIER_MIN = 55;
export const MID_TIER_MIN = 35;

export type RichnessTier = 'rich' | 'mid' | 'sparse';

export function richnessTier(score: number): RichnessTier {
  if (score >= RICH_TIER_MIN) return 'rich';
  if (score >= MID_TIER_MIN) return 'mid';
  return 'sparse';
}

/**
 * `<priority>` for a carrier profile. RELATIVE-WITHIN-SITE by definition, so the
 * only thing that matters is the ordering it induces:
 *
 *   1.0  homepage
 *   0.7–0.9  commercial + hub pages (/pricing, /directory, state/port hubs)
 *   0.6  city hubs
 *   0.5  rich carrier   ← ceiling for a carrier profile
 *   0.4  mid carrier
 *   0.3  sparse carrier
 *
 * i.e. hubs > rich carriers > sparse carriers, which is the whole point. A
 * carrier profile never reaches hub priority no matter how complete its record.
 */
export function carrierPriority(score: number): string {
  switch (richnessTier(score)) {
    case 'rich':
      return '0.5';
    case 'mid':
      return '0.4';
    default:
      return '0.3';
  }
}

/**
 * `<changefreq>` for a carrier profile — an HONEST estimate, not a nudge.
 *
 * The underlying facts change only when the weekly FMCSA re-ingest brings new
 * census values, and for the overwhelming majority of rows it brings none (see
 * the truthful-`updated_at` change in carrierIngest.ts). Claiming 'monthly' for
 * a thin row that has not changed in a year is precisely the fake-freshness
 * signal that degrades recrawl scheduling, so sparse rows say 'yearly'.
 * Rich/mid rows carry the fields the census actually revises (fleet counts,
 * driver counts, ratings, authority), so 'monthly' is defensible for them.
 */
export function carrierChangefreq(score: number): string {
  return richnessTier(score) === 'sparse' ? 'yearly' : 'monthly';
}
