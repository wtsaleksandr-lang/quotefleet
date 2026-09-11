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
 * The second curation pass dropped seven more, for three distinct reasons that
 * are worth naming because each will recur:
 *   • ONE AXIS ONLY — Swift Transportation (54283) and R+L Carriers /
 *     Greenwood Motor Lines (63391). Both are unambiguously in the directory
 *     and both publish a clean mark, but neither prints its FMCSA street
 *     address anywhere on its own site, so the PLACE axis never closed.
 *   • THE MARK ON THE SITE IS NOT THIS CARRIER'S MARK — ABF Freight (82866),
 *     whose page lives on the parent's domain and carries the PARENT's
 *     wordmark; and Roehl Transport (74481), whose site publishes only the
 *     "Roehl.Jobs" recruiting sub-brand. Hanging either on these USDOTs would
 *     be the same misidentification as borrowing a stranger's logo.
 *   • ARTWORK THAT CANNOT RENDER ON A LIGHT TILE — Maverick Transportation
 *     (178538) and Western Express (511412) publish only a white/reversed
 *     lockup, refused by the knockout check in the normalise script; and
 *     A. Duie Pyle (113594), whose only published lockup is half-reversed —
 *     it passes the >88% test on aggregate while "PYLE" itself is pure white
 *     and vanishes, leaving a tile that reads "A. Duie".
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
 * THE LIST. Ordered by how the marquee reads, not by fleet size — colour and
 * silhouette are alternated so no two adjacent tiles are the same yellow block
 * or the same black wordmark.
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
    usdot: '80806',
    legalName: 'J. B. HUNT TRANSPORT, INC.',
    displayName: 'J.B. Hunt',
    logo: 'jbhunt',
    sourceUrl: 'https://www.jbhunt.com/',
    evidence:
      'L&I 80806 holds active common + contract property authority; its census address is 615 J B Hunt Corporate Drive, Lowell AR 72745, and jbhunt.com/contact-us prints that street, city and ZIP verbatim. Mark taken from jbhunt.com’s own primary nav.',
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
    usdot: '92261',
    legalName: 'AAA COOPER TRANSPORTATION',
    displayName: 'AAA Cooper Transportation',
    logo: 'aaacooper',
    sourceUrl: 'https://www.aaacooper.com/',
    evidence:
      'L&I 92261 holds active common + contract property authority at 1751 Kinsey Road, Dothan AL — the street number, street name and city aaacooper.com prints on its own home and about pages. Mark is the ACT badge + "AAA COOPER TRANSPORTATION" lockup served from aaacooper.com.',
  },
  {
    usdot: '34666',
    legalName: 'MELTON TRUCK LINES, INC.',
    displayName: 'Melton Truck Lines',
    logo: 'melton',
    sourceUrl: 'https://meltontruck.com/',
    evidence:
      'L&I 34666 is 808 N 161st East Ave, Tulsa OK 74116; meltontruck.com prints that street, city and ZIP on its own home page. Mark taken from meltontruck.com’s own header.',
  },
  {
    usdot: '428823',
    legalName: 'KNIGHT TRANSPORTATION, INC.',
    displayName: 'Knight Transportation',
    logo: 'knight',
    sourceUrl: 'https://www.knighttrans.com/',
    evidence:
      'L&I 428823 is 2002 West Wahalla Lane, Phoenix AZ 85027 — printed verbatim on knighttrans.com’s own privacy page. NOT one of the eight other active "…Knight Transportation…" carriers (Blue/Red/White/Green/Thunder Knight et al.), none of which is in Phoenix. Mark is the site’s own ON-LIGHT variant; the header serves an on-dark file that the knockout check refuses.',
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
    usdot: '29124',
    legalName: 'SAIA MOTOR FREIGHT LINE, LLC',
    displayName: 'Saia LTL Freight',
    logo: 'saia',
    sourceUrl: 'https://www.saia.com/',
    evidence:
      'L&I 29124 carries the dba "SAIA LTL FREIGHT" and the address 11465 Johns Creek Pkwy Ste 400, Johns Creek GA 30097; saia.com’s own contact page prints that street, city and ZIP. Mark taken from saia.com’s own header.',
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
    usdot: '273301',
    legalName: 'DAYTON FREIGHT LINES, INC.',
    displayName: 'Dayton Freight',
    logo: 'daytonfreight',
    sourceUrl: 'https://daytonfreight.com/',
    evidence: 'L&I record for 273301 is Dayton, OH — Dayton Freight Lines’ headquarters. Mark taken from daytonfreight.com.',
  },
  {
    usdot: '65769',
    legalName: 'HIRSCHBACH MOTOR LINES, LLC',
    displayName: 'Hirschbach',
    logo: 'hirschbach',
    sourceUrl: 'https://hirschbach.com/',
    evidence:
      'L&I 65769 carries the dba "HIRSCHBACH" at 2099 Southpark Ct, Dubuque IA 52003; hirschbach.com’s own contact page prints that street number, city and ZIP. The mark is the company’s own "HML" brand glyph (images/brand/hml-mark.svg) — Hirschbach publishes no on-light wordmark lockup, so the tile carries the glyph and the accessible label carries the name.',
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
    usdot: '36684',
    legalName: 'AVERITT EXPRESS, INC',
    displayName: 'Averitt',
    logo: 'averitt',
    sourceUrl: 'https://www.averitt.com/',
    evidence:
      'L&I 36684 carries the dba "AVERITT" at 1415 Neal Street, Cookeville TN 38501; averitt.com prints that street, city and ZIP on its own home and about pages. Mark taken from averitt.com’s own header.',
  },
  {
    usdot: '63419',
    legalName: 'SOUTHEASTERN FREIGHT LINES, LLC',
    displayName: 'Southeastern Freight Lines',
    logo: 'sefl',
    sourceUrl: 'https://www.sefl.com/',
    evidence:
      'L&I 63419 carries the dba "SOUTHEASTERN FREIGHT LINES" at 420 Davega Road, Lexington SC 29073; sefl.com prints that street, city and ZIP on its own home page. Mark taken from sefl.com’s own header.',
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
    usdot: '190180',
    legalName: 'PITT OHIO EXPRESS, LLC',
    displayName: 'Pitt Ohio',
    logo: 'pittohio',
    sourceUrl: 'https://pittohio.com/',
    evidence:
      'L&I 190180 carries the dba "PITT OHIO" at 15 27th Street, Pittsburgh PA 15222; pittohio.com prints that street and ZIP on its own home page. The two sibling dockets at the same address (Pitt Ohio Ground, Pitt Ohio International) run zero power units; 190180 is the operating carrier. Mark taken from pittohio.com’s own header.',
  },
  {
    usdot: '73705',
    legalName: 'CRETE CARRIER CORPORATION',
    displayName: 'Crete Carrier',
    logo: 'crete',
    sourceUrl: 'https://www.cretecarrier.com/',
    evidence:
      'L&I 73705 is 400 NW 56th Street, Lincoln NE 68528; cretecarrier.com prints that street, city and ZIP on its own home and contact pages. Mark is the site’s own full-colour "Crete Carrier Corporation" lockup — its header serves a white/reversed file the knockout check refuses.',
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
    usdot: '3706',
    legalName: 'NEW PRIME, INC.',
    displayName: 'Prime Inc.',
    logo: 'prime',
    sourceUrl: 'https://www.primeinc.com/',
    evidence:
      'L&I 3706 carries the dba "PRIME, INC." at 2740 North Mayfair Ave, Springfield MO 65803; primeinc.com prints that street, city and ZIP on its own home, about and contact pages. Mark taken from primeinc.com’s own header.',
  },
  {
    usdot: '75250',
    legalName: 'HALVOR LINES, INC.',
    displayName: 'Halvor Lines',
    logo: 'halvor',
    sourceUrl: 'https://www.halvorlines.com/',
    evidence:
      'L&I 75250 is 217 Grand Avenue, Superior WI 54880; halvorlines.com prints that street, city and ZIP on its own home and contact pages. Mark taken from halvorlines.com’s own header.',
  },
  {
    usdot: '79466',
    legalName: 'STEVENS TRANSPORT, INC.',
    displayName: 'Stevens Transport',
    logo: 'stevens',
    sourceUrl: 'https://www.stevenstransport.com/',
    evidence:
      'L&I 79466 is 9757 Military Parkway, Dallas TX 75227; stevenstransport.com prints that street, city and ZIP on its own home page. The sibling docket at the same address (Stevens Statewide, dba "Stevens Transport CD") is a different USDOT and is not in this list.',
  },
  {
    usdot: '606920',
    legalName: 'ANDERSON TRUCKING SERVICE, INC.',
    displayName: 'Anderson Trucking Service',
    logo: 'ats',
    sourceUrl: 'https://www.atsinc.com/',
    evidence:
      'L&I 606920 is 725 Opportunity Drive, St Cloud MN 56301; atsinc.com prints that street, city and ZIP on its own home page. Mark is the ATS seal served from atsinc.com.',
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
    usdot: '179752',
    legalName: 'P.A.M. TRANSPORT, INC.',
    displayName: 'P.A.M. Transport',
    logo: 'pamtransport',
    sourceUrl: 'https://www.pamtransport.com/',
    evidence:
      'L&I 179752 is 297 W Henri De Tonti Blvd, Tontitown AR 72770; pamtransport.com prints that street, city and ZIP on its own home and contact pages. Mark taken from pamtransport.com’s own header.',
  },
  {
    // IDENTITY CONFIRMED, ARTWORK NOT OBTAINED — and therefore no artwork is
    // shown. Retried in full on 2026-09-11: riveroakscouriers.com resolves
    // (209.126.24.156) but every route to it times out at the TCP layer —
    // https and http, apex and www, port 8080, the bare IP with a Host header,
    // /about, /contact, /services, /sitemap.xml, both from a plain fetch and
    // from a real headless browser. Nothing was served, so there is no header
    // <img>, no SVG sprite and no og:image to read. Rather than take the mark
    // from a third-party aggregator — the exact shortcut that produces wrong
    // logos — or redraw it by hand, this renders the same monogram every
    // unclaimed carrier already gets.
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
