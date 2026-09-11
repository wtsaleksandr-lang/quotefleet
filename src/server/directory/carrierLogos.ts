/**
 * ─── THE CURATED CARRIER-LOGO REGISTRY ────────────────────────────────────
 *
 * ONE hand-verified list of "this artwork belongs to the carrier at THIS
 * USDOT", read by BOTH surfaces that show a carrier logo:
 *
 *   • the directory — via `carrierLogoUrl()` in directory/pages.ts, which
 *     feeds the listing card tile and the profile header, and
 *   • the homepage logo marquee — via `HOME_PARTNER_LOGOS` in
 *     home/homeSections.ts, which is DERIVED from this array.
 *
 * Deriving both from one array is the point: a logo wall and a profile page
 * that disagree about which mark belongs to which company is precisely the
 * misidentification the logo slot was built to avoid, and two hand-maintained
 * lists drift the first time one is edited alone.
 *
 * ── WHY A CODE ARRAY AND NOT A DB COLUMN ─────────────────────────────────
 * There are two ways a real logo can reach a carrier tile, and they are not
 * the same mechanism:
 *
 *   1. A CARRIER CLAIMS ITS PROFILE and uploads one. That is per-tenant,
 *      arrives at runtime, and belongs in `carrier_overrides` — the
 *      survive-the-ingest table the claim flow already writes to.
 *      `carrierLogoUrl()` reads that first and it always WINS over this file,
 *      because a carrier's own upload outranks our curation of it.
 *
 *   2. WE CURATE ONE BY HAND, as here. That is a reviewed, version-controlled
 *      editorial decision about a specific USDOT, it must be identical in
 *      every environment with no migration or seed step, and it has to be
 *      readable by the homepage — which does no database work at all on the
 *      request path. A committed array is all three; a seeded table is none
 *      of them.
 *
 * ── THE MATCHING RULE, WHICH IS THE WHOLE POINT ──────────────────────────
 * Attaching Company A's mark to Company B's profile is a MISIDENTIFICATION,
 * not a cosmetic defect, so every row here was confirmed on TWO axes before
 * it was written down:
 *
 *   • NAME — the company's own website brands itself as this carrier, and
 *   • PLACE — the street address or city/state on that website matches the
 *     FMCSA record for this exact USDOT.
 *
 * Anything that cleared only one axis was DROPPED rather than guessed. Three
 * of the owner's original seven did exactly that and are absent on purpose:
 *   • CaroTrans — holds no active property authority in the L&I file, so it
 *     is not in this directory at all; a tile for it would be a claim about a
 *     carrier we do not list.
 *   • "Anchor" — a dozen US carriers are named Anchor-something and the only
 *     one whose live site uses an anchor-and-wordmark runs zero power units.
 *   • "Harbor Transport" — the only one with a website holds broker authority
 *     with zero power units; the active CARRIER of that name has no site.
 *
 * ── WHAT A TILE CLAIMS, AND WHAT IT MUST NOT ─────────────────────────────
 * These carriers are LISTED IN our FMCSA-derived directory. They are not
 * customers, partners or endorsers, none of them has any relationship with
 * QuoteFleet, and no copy around either surface may imply one. The marks
 * remain the property of their owners and are shown to identify the carrier —
 * the footer's data-source note carries that line and a removal address.
 */

/** One curated carrier + the artwork we show for it. */
export interface CuratedCarrierLogo {
  /** USDOT, leading zeros stripped — the key both surfaces match on. */
  usdot: string;
  /** The carrier's FMCSA legal name, verbatim, as the L&I file records it. */
  legalName: string;
  /** The brand name to label the tile with (what the company calls itself). */
  displayName: string;
  /**
   * Slug of the committed artwork — BOTH crops are derived from it (see
   * `carrierLogoPaths`), so a carrier can never end up with the wide mark of
   * one company and the square mark of another.
   *
   * `null` when we could not obtain the artwork, and that is a FIRST-CLASS
   * state rather than a gap to fill later: both surfaces already fall back to
   * a generated monogram, so a carrier whose IDENTITY is confirmed but whose
   * ARTWORK is not still renders honestly — instead of being dropped from the
   * list, or handed somebody else's mark.
   */
  logo: string | null;
  /** The company's own site the mark was taken from (`null` when unreachable). */
  sourceUrl: string | null;
  /** The evidence that this artwork belongs to THIS USDOT. Reviewed, not decorative. */
  evidence: string;
}

/**
 * TWO CROPS PER MARK, BECAUSE THE TWO TILES ARE TWO DIFFERENT SHAPES.
 *
 * The marquee tile is a wide rectangle (~2.1:1); the directory's tile is a
 * SQUARE avatar. One shared asset cannot serve both: a canvas shaped for the
 * marquee wastes over half the height of a square tile, which is how Old
 * Dominion's round seal ended up rendering at 15px inside a 48px tile next to
 * a monogram that filled it.
 *
 * So each mark is normalised TWICE from the same source — `/carrier-logos/x.webp`
 * for the wide tile, `/carrier-logos/square/x.webp` for the square one — both
 * keyed on the same registry slug so the pair can never come from different
 * companies. Inside each crop, artwork is trimmed of its source padding and
 * scaled so every mark carries the same optical weight; see
 * scripts/normalise-carrier-logos.mjs for the scale formula and for why a plain
 * contain-fit is not good enough.
 *
 * Both resolve under src/server/public, which express.static serves with a
 * 7-day TTL for .webp (app.ts).
 */
const WIDE_DIR = '/carrier-logos';
const SQUARE_DIR = '/carrier-logos/square';

/** The two same-origin paths for a registry slug. */
export function carrierLogoPaths(slug: string): { wide: string; square: string } {
  return { wide: `${WIDE_DIR}/${slug}.webp`, square: `${SQUARE_DIR}/${slug}.webp` };
}

/**
 * THE LIST. Ordered by how the marquee reads, not by fleet size.
 */
export const CURATED_CARRIER_LOGOS: readonly CuratedCarrierLogo[] = [
  {
    usdot: '258304',
    legalName: 'LYNDEN LOGISTICS,INC.',
    displayName: 'Lynden Logistics',
    logo: 'lynden',
    sourceUrl: 'https://www.lynden.com/',
    evidence:
      'FMCSA census address for 258304 is 18000 International Blvd Suite 700, Seattle WA 98188 — the Lynden Incorporated corporate address; Lynden Logistics, Inc. is one of the Lynden companies. Mark is the green/yellow striped "L" wordmark.',
  },
  {
    usdot: '3527709',
    legalName: 'TCI TRANSPORTATION SERVICES OF NORCAL LLC',
    displayName: 'TCI Transportation',
    logo: 'tci',
    sourceUrl: 'https://tcitransportation.com/',
    evidence:
      'FMCSA census address for 3527709 is 2150 West Charter Way, Stockton CA — Stockton is one of the locations TCI Transportation lists on its own site. The mark itself reads "TCI / DEDICATED LOGISTICS / LEASING & RENTAL", matching the divisions that site describes.',
  },
  {
    usdot: '1300813',
    legalName: 'PINCH FLATBED, INC.',
    displayName: 'Pinch',
    logo: 'pinch',
    sourceUrl: 'https://www.pinchtransport.com/',
    evidence:
      'pinchtransport.com gives its address as 18515 Aldine Westfield Rd, Houston TX 77073, which is the FMCSA address on record for USDOT 1300813. Pinch brands its operating companies as Pinch Flatbed / Pinch Intermodal / Pinch Logistics.',
  },
  {
    usdot: '264184',
    legalName: 'SCHNEIDER NATIONAL CARRIERS, INC.',
    displayName: 'Schneider',
    logo: 'schneider',
    sourceUrl: 'https://schneider.com/',
    evidence: 'L&I record for 264184 is Green Bay, WI — Schneider National’s headquarters. Mark taken from schneider.com’s own header.',
  },
  {
    usdot: '53467',
    legalName: 'WERNER ENTERPRISES, INC.',
    displayName: 'Werner Enterprises',
    logo: 'werner',
    sourceUrl: 'https://www.werner.com/',
    evidence: 'L&I record for 53467 is Omaha, NE — Werner Enterprises’ headquarters. Mark taken from werner.com’s own header.',
  },
  {
    usdot: '90849',
    legalName: 'OLD DOMINION FREIGHT LINE, INC.',
    displayName: 'Old Dominion Freight Line',
    logo: 'odfl',
    sourceUrl: 'https://www.odfl.com/',
    evidence: 'L&I record for 90849 is Thomasville, NC — Old Dominion’s headquarters. Mark taken from odfl.com’s own header.',
  },
  {
    usdot: '121018',
    legalName: 'ESTES EXPRESS LINES',
    displayName: 'Estes Express Lines',
    logo: 'estes',
    sourceUrl: 'https://www.estes-express.com/',
    evidence: 'L&I record for 121018 is Richmond, VA — Estes Express Lines’ headquarters. Mark taken from estes-express.com’s own header.',
  },
  {
    usdot: '241572',
    legalName: 'LANDSTAR RANGER, INC.',
    displayName: 'Landstar',
    logo: 'landstar',
    sourceUrl: 'https://www.landstar.com/',
    evidence: 'L&I record for 241572 is Jacksonville, FL — Landstar System’s headquarters. Mark taken from landstar.com.',
  },
  {
    usdot: '134697',
    legalName: 'HEARTLAND EXPRESS INC OF IOWA',
    displayName: 'Heartland Express',
    logo: 'heartland',
    sourceUrl: 'https://www.heartlandexpress.com/',
    evidence:
      'L&I record for 134697 is North Liberty, IA — Heartland Express’ headquarters; the L&I dba is literally "HEARTLAND EXPRESS". Mark taken from heartlandexpress.com’s own header.',
  },
  {
    usdot: '273301',
    legalName: 'DAYTON FREIGHT LINES, INC.',
    displayName: 'Dayton Freight',
    logo: 'daytonfreight',
    sourceUrl: 'https://daytonfreight.com/',
    evidence: 'L&I record for 273301 is Dayton, OH — Dayton Freight Lines’ headquarters. Mark taken from daytonfreight.com.',
  },
  {
    usdot: '55787',
    legalName: 'RUAN TRANSPORT CORPORATION',
    displayName: 'Ruan',
    logo: 'ruan',
    sourceUrl: 'https://www.ruan.com/',
    evidence: 'L&I record for 55787 is Des Moines, IA — Ruan’s headquarters. Mark taken from ruan.com.',
  },
  {
    // IDENTITY CONFIRMED, ARTWORK NOT OBTAINED — and therefore no artwork is
    // shown. riveroakscouriers.com refuses connections from our network (its
    // media is also served from a leftover staging host), so rather than take
    // the mark from a third-party aggregator — the exact shortcut that
    // produces wrong logos — this renders the same monogram every unclaimed
    // carrier already gets.
    usdot: '1891736',
    legalName: 'RIVER OAKS COURIERS INC',
    displayName: 'River Oaks Couriers',
    logo: null,
    sourceUrl: 'https://riveroakscouriers.com/',
    evidence:
      'FMCSA census address for 1891736 is 12835 Jess Pirtle Blvd, Sugar Land TX 77478, matching the address on the company’s own contact page exactly. US company (Sugar Land, greater Houston), not the Oakville, Ontario "River Oaks".',
  },
];

/**
 * USDOT → curated logo path. Built once; the directory calls this per TILE, so
 * a linear scan over a few dozen rows on a 5,000-row listing page would be
 * ~150k comparisons for no reason.
 */
const BY_USDOT: ReadonlyMap<string, CuratedCarrierLogo> = new Map(
  CURATED_CARRIER_LOGOS.map((c) => [c.usdot, c]),
);

/** Normalize a USDOT the same way the directory stores it: digits, no leading zeros. */
function normalizeUsdot(usdot: string | null | undefined): string | null {
  if (typeof usdot !== 'string') return null;
  const digits = usdot.trim().replace(/^0+/, '');
  return /^[0-9]+$/.test(digits) ? digits : null;
}

/**
 * The curated SQUARE mark for a USDOT — what the directory's listing card and
 * profile header render — or null.
 *
 * Returns null both for an unknown USDOT and for a curated carrier we have no
 * artwork for. Callers cannot tell those two apart and must not need to: in
 * both cases the honest tile is a monogram.
 */
export function curatedSquareLogoForUsdot(usdot: string | null | undefined): string | null {
  const key = normalizeUsdot(usdot);
  if (key === null) return null;
  const slug = BY_USDOT.get(key)?.logo;
  return slug ? carrierLogoPaths(slug).square : null;
}

/** The curated WIDE mark for a USDOT — what the homepage marquee renders — or null. */
export function curatedWideLogoForUsdot(usdot: string | null | undefined): string | null {
  const key = normalizeUsdot(usdot);
  if (key === null) return null;
  const slug = BY_USDOT.get(key)?.logo;
  return slug ? carrierLogoPaths(slug).wide : null;
}

/** The full curated entry for a USDOT (identity + evidence), or null. */
export function curatedCarrierForUsdot(usdot: string | null | undefined): CuratedCarrierLogo | null {
  const key = normalizeUsdot(usdot);
  if (key === null) return null;
  return BY_USDOT.get(key) ?? null;
}
