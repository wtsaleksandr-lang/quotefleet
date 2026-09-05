/**
 * THE ACCURACY RATING — the product, not decoration.
 *
 * Every charge this engine produces says what kind of claim it is and what it
 * rests on. Four tiers, and the difference between them is the difference
 * between a statute and a broker's rate card:
 *
 *   CITED     — a figure that BINDS EVERY CARRIER, from a statute or a public
 *               agency's fee schedule. Tennessee's `$20 + $0.06/ton-mile` is
 *               Tenn. Code Ann. § 55-7-205: it is what the shipper will pay in
 *               Tennessee, from whoever hauls it. It is not an estimate and IT
 *               CARRIES NO BAND — see `citedCarriesNoBand` below, which is the
 *               whole test and is enforced rather than argued.
 *
 *               A FILED CARRIER TARIFF IS NOT THIS. Ace Doran's tariff binds Ace
 *               Doran; a different carrier tarps at a different price, and the
 *               shipper has not chosen a carrier yet. It is excellent evidence
 *               and it is a BENCHMARK, whose hover says so in as many words.
 *   INDEXED   — a live published index, with the date of the reading. The EIA
 *               weekly on-highway diesel price; the DAT national flatbed
 *               line-haul rate. Exact on its date; the band is drift since.
 *   BENCHMARK — real observed market data, with a sample and a date. ALWAYS
 *               RENDERS AS A RANGE, never a point.
 *   REFUSED   — we will not price it. The row says why, and what to do instead.
 *
 * ── WHY THIS IS NOT A PARALLEL VOCABULARY ─────────────────────────────────
 *
 * Two vocabularies already exist in this feature and neither is replaced:
 *
 *   `LineBasis` on `HeavyHaulLine` — 'sourced' | 'yours' | 'derived' | 'market'
 *       WHICH SUBTOTAL THE MONEY LANDS IN. A structural separation, enforced by
 *       arithmetic: money in one channel is never summed into another.
 *
 *   `ConfidenceGrounding` in confidence.ts — 'measured' | 'ratio' | 'judgement'
 *       HOW A CONFIDENCE DEDUCTION'S SIZE WAS ARRIVED AT. About the score, not
 *       about a dollar figure.
 *
 * `AccuracyTier` answers a third question neither of them answers — WHAT KIND
 * OF EVIDENCE IS BEHIND THIS DOLLAR FIGURE — and it is deliberately orthogonal
 * to both. A line's `basis` says which column it may be added into; its
 * `accuracy` says how much to trust the number in it. The two are related by
 * exactly one rule, `basisForTier` below, and that rule is one-way and total:
 * a BENCHMARK figure can only ever be 'market', so it is structurally incapable
 * of reaching `subtotalSourcedUsd`. `assertAccuracyBasisInvariant` proves it at
 * runtime and a test pins it.
 *
 * `LineBasis` gained one value — 'market' — for this engine, and that is the
 * whole extension. It was added rather than reusing 'derived' because 'derived'
 * means "a SOURCED input run through a model of ours" (the fuel surcharge: an
 * EIA price through a DOE-index formula). A market band has no single sourced
 * input to derive from — it is a spread across a dozen vendor rate sheets — and
 * putting it in the same subtotal as the EIA-anchored fuel line would make that
 * subtotal mean two different things at once.
 *
 * ── EACH TIER CARRIES ITS OWN BAND ────────────────────────────────────────
 *
 * There is no global ± number here. The default band per tier is below, and
 * every component overrides it with its OWN measured spread — the research
 * measured detention at ±15% and securement at ±60%, and flattening those to one
 * figure would throw away the most useful thing either of them says. The width
 * is CONTENT: a narrow band on a statutory analysis fee and a wide one on a
 * securement allowance nobody publishes say two different, true things.
 */
import type { MarketSource } from './sources.js';

/** What kind of evidence stands behind a dollar figure. */
export type AccuracyTier = 'cited' | 'indexed' | 'benchmark' | 'refused';

/**
 * The subtotal channel each tier is allowed to land in. ONE-WAY AND TOTAL.
 *
 * This is the whole of the "a benchmark figure must never enter a cited
 * subtotal" invariant, written once so it can be argued with rather than hunted
 * for. `null` means the tier produces no money at all.
 */
export const BASIS_FOR_TIER = {
  cited: 'sourced',
  indexed: 'derived',
  benchmark: 'market',
  refused: null,
} as const;

export type BasisForTier = (typeof BASIS_FOR_TIER)[AccuracyTier];

export function basisForTier(tier: AccuracyTier): BasisForTier {
  return BASIS_FOR_TIER[tier];
}

/**
 * The DEFAULT ± band per tier, as a percentage. Every component overrides it.
 *
 *   cited      0 — a statute states the number. There is no spread to report,
                  and a CITED row carrying one is rejected outright: if a figure
                  needs a band, it is not cited. That is the cheapest available
                  test for the category and it is the one this file enforces.
 *   indexed    5 — the reading is exact on its date. The band is how far the
 *                  index can move between the reading and the move: DAT's
 *                  national flatbed line-haul moved $2.79 → $2.67 in three
 *                  weeks (4.3%), and EIA diesel moved $5.257 → $5.454 in the
 *                  same window (3.7%). Five percent covers a weekly reading
 *                  read a fortnight later; it does not cover a frozen anchor.
 *   benchmark 30 — sits in the middle of the per-component spreads the research
 *                  actually measured. After the second accessorial pass those
 *                  are: state analysis fee where the rule is exact ±10%,
 *                  permit service with a declared tier ±11%, detention ±15%,
 *                  tarping ±20%, permit service with no declared tier ±20%,
 *                  layover ±25%, escorts ±25%, crane with the region known
 *                  ±25%, forklift ±30%, rigging crew ±30%, crane road permit
 *                  ±40%, state analysis fee where the state publishes a
 *                  per-unit rate but not the count ±40%, crane 80–160k lb
 *                  ±40%, crane 160–200k lb ±45%, insurance ±50%, securement
 *                  ±60%, crane with the region unknown ±35%, physical route
 *                  survey ±35%, and a superload state whose own schedule has
 *                  not been read ±70%. It is a fallback for a component that
 *                  does not state its own, and no shipped component uses it.
 *
 *                  Three of those moved on evidence and one deliberately did
 *                  not. The route-survey ±70% split into ±10/±40 for the
 *                  state's own analysis and ±35% for the private survey,
 *                  because one line had been carrying two products. Permit
 *                  service went ±45% → ±20% because its 3× spread turned out
 *                  to be two service tiers, each internally tight. The crane
 *                  narrowed ONLY where the region is known, never nationally,
 *                  because ±35% is almost exactly the observed full spread of
 *                  published US operator prices at the same tonnage.
 *                  SECUREMENT STAYED AT ±60% ON PURPOSE: four carrier tariffs
 *                  and one binding government tariff price it at zero, so the
 *                  width is evidence of absence rather than an unfinished
 *                  search, and narrowing it would invent a market.
 *   refused    — no band, because there is no number.
 */
export const TIER_DEFAULT_BAND_PCT: Readonly<Record<AccuracyTier, number>> = {
  cited: 0,
  indexed: 5,
  benchmark: 30,
  refused: 0,
};

/** Short label for the tier pill. */
export const TIER_LABELS: Readonly<Record<AccuracyTier, string>> = {
  cited: 'CITED',
  indexed: 'INDEXED',
  benchmark: 'BENCHMARK',
  refused: 'NOT PRICED',
};

/** What each tier means, in one sentence, for the legend the UI pass renders. */
export const TIER_MEANINGS: Readonly<Record<AccuracyTier, string>> = {
  cited:
    'A figure that binds every carrier — a statute or a public agency’s fee schedule. It is what you will pay, from whoever hauls it, and it carries no range because there is nothing to estimate.',
  indexed:
    'A live published index, with the date of the reading. Exact on that date; the band is how far the index can move before you move the load.',
  benchmark:
    'Real observed market data, with its sample and its date. Always a range — a point value would claim a precision the market does not have.',
  refused:
    'We will not put a number on this. The line says why, and what would produce a real one.',
};

/**
 * The rating carried by every priced line.
 *
 * `hover` IS DELIBERATELY SHORT — one or two sentences, because it renders in a
 * tooltip and a tooltip nobody finishes reading is worse than no tooltip. The
 * argument, the sample and what the figure excludes all live in `detail`, for
 * the "read more" affordance the UI pass will build.
 */
export interface AccuracyRating {
  tier: AccuracyTier;
  /** ± band as a PERCENTAGE of the headline. This component's own, not the tier's. */
  bandPct: number;
  /**
   * BENCHMARK figures carry a real range and MUST render as one. `null` on a
   * CITED line, which has no spread.
   */
  lowUsd: number | null;
  highUsd: number | null;
  /** One or two sentences. Renders in the hover card. */
  hover: string;
  /** The long form: the argument, the sample, and what the figure excludes. */
  detail: string;
  /** BENCHMARK only: what was actually observed. "11 operator rate sheets, 2025." */
  sample: string | null;
  /** The date the underlying data carries. Never the date we fetched it. */
  asOf: string | null;
  /** Market sources. NEVER `SourceDoc` — see sources.ts for why that matters. */
  marketSources: MarketSource[];
}

/** Longest a hover card may be. Two sentences; the argument goes in `detail`. */
export const MAX_HOVER_CHARS = 240;

/** Build a rating, defaulting the band to the tier's own. */
export function rate(input: {
  tier: AccuracyTier;
  hover: string;
  detail: string;
  bandPct?: number;
  lowUsd?: number | null;
  highUsd?: number | null;
  sample?: string | null;
  asOf?: string | null;
  marketSources?: MarketSource[];
}): AccuracyRating {
  return {
    tier: input.tier,
    bandPct: input.bandPct ?? TIER_DEFAULT_BAND_PCT[input.tier],
    lowUsd: input.lowUsd ?? null,
    highUsd: input.highUsd ?? null,
    hover: input.hover,
    detail: input.detail,
    sample: input.sample ?? null,
    asOf: input.asOf ?? null,
    marketSources: input.marketSources ?? [],
  };
}

/** The shape the invariant checker needs. Structural, so it accepts a `HeavyHaulLine`. */
export interface AccuracyCheckable {
  code?: string;
  name: string;
  basis: string;
  amountUsd: number | null;
  accuracy?: AccuracyRating;
}

/**
 * A CITED FIGURE CARRIES NO BAND — the structural test for the category.
 *
 * This exists because the judgement call it replaces is genuinely easy to get
 * wrong. "A published fee schedule" reads as though a filed carrier tariff
 * qualifies, and it does not: a statute binds every carrier in the state, a
 * tariff binds the one carrier that filed it, and the shipper has not chosen a
 * carrier yet. Reasoning that out correctly every time is not something to rely
 * on, so the rule is expressed as arithmetic instead.
 *
 * If a figure needs a range, we do not know it, and if we do not know it, it is
 * not cited. Tennessee's $320 has no range. A tarping charge quoted from one
 * carrier's tariff has a ±20% one, and that band is the tell.
 *
 * Both forms of "no band" are accepted: no low/high at all, or a low and high
 * that both equal the amount exactly. Anything else is a violation.
 */
export function citedCarriesNoBand(line: AccuracyCheckable): string | null {
  const acc = line.accuracy;
  if (!acc || acc.tier !== 'cited') return null;
  const id = line.code ?? line.name;
  if (acc.bandPct !== 0) {
    return `${id}: tier CITED with a ±${acc.bandPct}% band. A cited figure carries no band — if it needs one it is a BENCHMARK, whatever published it.`;
  }
  const hasRange = acc.lowUsd !== null || acc.highUsd !== null;
  if (hasRange && (acc.lowUsd !== line.amountUsd || acc.highUsd !== line.amountUsd)) {
    return `${id}: tier CITED but its low ($${acc.lowUsd}) and high ($${acc.highUsd}) do not both equal the figure ($${line.amountUsd}). A cited figure carries no band.`;
  }
  return null;
}

/**
 * THE INVARIANT, CHECKED RATHER THAN ASSERTED IN PROSE.
 *
 * Returns every violation it finds, so a caller can throw, log or test on it.
 * Four rules:
 *
 *  1. A line's `basis` must be the one `BASIS_FOR_TIER` allows for its tier.
 *     This is what stops a market band being summed into the cited column.
 *  2. A BENCHMARK line must carry a low and a high. A benchmark rendered as a
 *     point is the exact dishonesty this whole rating exists to prevent.
 *  3. A CITED line must carry NO band. The mirror of rule 2, and the one that
 *     settles what may call itself cited without anybody re-arguing it.
 *  4. A REFUSED line must carry no money.
 */
export function accuracyBasisViolations(
  lines: ReadonlyArray<AccuracyCheckable>,
): string[] {
  const problems: string[] = [];
  for (const line of lines) {
    const acc = line.accuracy;
    if (!acc) continue;
    const id = line.code ?? line.name;
    const required = basisForTier(acc.tier);
    if (required === null) {
      if (line.amountUsd !== null) {
        problems.push(
          `${id}: tier REFUSED but carries $${line.amountUsd} — a refusal that quotes a number is not a refusal.`,
        );
      }
    } else if (line.basis !== required) {
      problems.push(
        `${id}: tier ${acc.tier.toUpperCase()} must sit in the "${required}" subtotal, not "${line.basis}".`,
      );
    }
    if (acc.tier === 'benchmark' && (acc.lowUsd === null || acc.highUsd === null)) {
      problems.push(
        `${id}: a BENCHMARK figure must render as a range and this one has no low/high.`,
      );
    }
    const banded = citedCarriesNoBand(line);
    if (banded) problems.push(banded);
    if (acc.hover.length > MAX_HOVER_CHARS) {
      problems.push(
        `${id}: hover text is ${acc.hover.length} characters, over the ${MAX_HOVER_CHARS} the card holds. Move the argument into detail.`,
      );
    }
  }
  return problems;
}

/** Throwing form, for the composer. Cheap, and it fails at the seam. */
export function assertAccuracyBasisInvariant(
  lines: ReadonlyArray<AccuracyCheckable>,
): void {
  const problems = accuracyBasisViolations(lines);
  if (problems.length > 0) {
    throw new Error(`accuracy/basis invariant violated: ${problems.join(' | ')}`);
  }
}
