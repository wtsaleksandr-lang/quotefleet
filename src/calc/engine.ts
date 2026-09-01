/**
 * Quote calculation engine — PURE function.
 *
 * Same engine runs:
 *   - inside the embeddable widget (server-side preview before "submit")
 *   - on lead submission (final stored quote)
 *   - inside the AI rate-adjustment chat (so the agent can show "what
 *     would happen if I changed X" without writing to the DB)
 *
 * Inputs: tenant rate config (rate cards + accessorials) + a request.
 * Output: line-itemised breakdown + total, labelled in the carrier's own
 * currency (req.currency, derived from their countryFocus). The engine never
 * converts — the carrier priced their rate cards in that currency already.
 *
 * Logic order (top-to-bottom, each step adds to running total):
 *   1. Linehaul   = max(miles × ratePerMile + flatFee, minimumCharge)
 *   2. Lane-zone overrides (drayage flat-tariff zones replace step 1)
 *   3. Auto-trigger accessorials (always-on or condition-based)
 *   4. Optional accessorials selected by the user
 *   5. Fuel surcharge = % of (linehaul subtotal)  ← typical industry practice
 *   6. Margin %      = % of running subtotal
 *
 * Rounded to nearest cent at the end.
 */
import type {
  RateCard,
  Accessorial,
  LaneZone,
  Terminal,
} from '../db/schema.js';
import {
  estimateFreightClass,
  ltlLinehaul,
  DEFAULT_LTL_CONFIG,
  type FreightClassEstimate,
} from './freightClass.js';
import {
  findMatrixCell,
  matrixLinehaul,
  type MatrixCellInput,
  type ZoneDefInput,
} from './rateMatrix.js';
import { maxQuotableWeightLbs as osowMaxQuotableWeightLbs } from './osow/engine.js';

/**
 * Federal legal gross weight on the Interstate system (23 U.S.C. 127). Above
 * this a load is over-legal and needs an oversize/overweight permit — it is a
 * PERMITTING threshold, not a quoting one.
 */
export const FEDERAL_LEGAL_GROSS_WEIGHT_LBS = 80000;

/**
 * Default upper bound (pounds) for an automated instant quote, used wherever
 * we have no OS/OW permit coverage for the lane. Anything above it routes to
 * a human ("please contact us") rather than silently pricing a load whose
 * permit cost we cannot compute. Mirrored as a literal in the client widget.
 *
 * This used to be the whole story, and it conflated "over the legal limit"
 * with "unquotable". They are different: a 100,000 lb load inside Texas is
 * over-legal AND fully priceable, because `src/calc/osow` can compute its
 * permit from published TxDMV figures. Use `maxQuotableWeightLbs()` to get
 * the real ceiling for a lane; this constant remains the floor it falls back
 * to, so every existing caller keeps its current behaviour unchanged.
 */
export const MAX_QUOTABLE_WEIGHT_LBS = 80000;

/**
 * The heaviest quotable load for a specific lane. Returns
 * `MAX_QUOTABLE_WEIGHT_LBS` unless both ends sit in one jurisdiction whose
 * OS/OW rules we hold, in which case it returns that jurisdiction's superload
 * threshold. See the implementation for why the same-state condition is
 * required rather than merely conservative.
 */
export function maxQuotableWeightLbs(
  pickupState?: string | null,
  deliveryState?: string | null,
): number {
  return osowMaxQuotableWeightLbs(
    pickupState,
    deliveryState,
    MAX_QUOTABLE_WEIGHT_LBS,
  );
}

/**
 * Quote-validity window, in calendar days. SINGLE SOURCE OF TRUTH for how long
 * an issued quote stays good. The terms text (src/server/quoteDisclaimer.ts)
 * interpolates this same number, and the widget result card surfaces it as an
 * explicit "Valid until <date>" — so the disclaimer's validity and the card's
 * clock can never contradict each other. Kept in the calc layer (the lowest,
 * shared by widget preview + lead ingest + AI builder) so every surface reads
 * one value. A per-tenant override can be threaded through later when a tenant
 * validity column exists; until then every quote defaults here.
 */
export const QUOTE_VALIDITY_DAYS = 30;

/**
 * Rate-confidence label, derived from MATCH QUALITY (which pricing tier actually
 * resolved the lane), never shown as a scary "low":
 *   - 'high'   : an exact rate-matrix cell priced the lane AND at least one end
 *                carried a precise ZIP.
 *   - 'medium' : a zone / flat tariff, a per-mile or LTL rate card, or a matrix
 *                cell that only had coarse (city/state, no ZIP) inputs to match.
 */
export type QuoteConfidence = 'high' | 'medium';

/**
 * Currency the carrier prices in.
 *
 * IMPORTANT: this LABELS the quote, it never converts it. A Canadian carrier
 * types Canadian dollars into their rate cards; we must render "CA$2,450.00",
 * not silently call it USD (which is what happened before — the engine
 * hard-coded 'USD' on every return path) and never apply an FX rate to a
 * number the carrier already priced.
 */
export type Currency = 'USD' | 'CAD';

/** Canadian province / territory codes. Some geocoders resolve a lane to a
 *  province rather than a country, so we accept either when labelling a
 *  BOTH-focus quote's currency. Used for the LABEL only — never to convert. */
const CA_PROVINCE_CODES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/** True when a resolved lane country (or province) code denotes Canada.
 *  Expects a COUNTRY code by contract — 'CA' means Canada here, not the US
 *  state California (callers pass the lane's resolved *country*). */
function isCanadianLane(code?: string | null): boolean {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return false;
  return c === 'CA' || c === 'CAN' || c === 'CANADA' || CA_PROVINCE_CODES.has(c);
}

/**
 * Country focus → the currency a carrier LABELS quotes in (never converts).
 *
 *   - 'CA'   → always CAD (the carrier priced their rate cards in CAD).
 *   - 'US'   → always USD, even on a cross-border lane still priced in USD.
 *   - 'BOTH' → per-lane: a Canadian origin/destination labels CAD, everything
 *              else USD. Pass the lane's resolved country (`laneCountry`, an
 *              ISO-2 code like 'CA'/'US') to activate this. Without it a BOTH
 *              tenant safely defaults to USD — mislabelling a US lane as CAD is
 *              worse than the reverse, and no amount is ever converted either
 *              way.
 *
 * The quote routes (public / ingest / ai quote builders) forward the lane's
 * resolved country here as `laneCountry` (delivery first, then pickup), so a
 * BOTH tenant now labels Canadian lanes CAD at runtime. The 2nd arg stays
 * optional so any other caller keeps the safe USD default.
 */
export function currencyForCountry(
  country?: string | null,
  laneCountry?: string | null,
): Currency {
  const focus = String(country ?? '').trim().toUpperCase();
  if (focus === 'CA') return 'CAD';
  if (focus === 'BOTH') return isCanadianLane(laneCountry) ? 'CAD' : 'USD';
  return 'USD';
}

export interface CalcRequest {
  service: string; // 'drayage' | 'ftl' | 'ltl' | ...
  equipment: string; // 'dryvan' | 'container_40hc' | ...
  miles: number;
  /** Carrier's pricing currency (label only — see Currency). Defaults USD. */
  currency?: Currency;
  weightLbs?: number;
  pieces?: number;
  /** LTL: shipment dimensions (inches) — required to derive freight class. */
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  /** LTL: explicit freight class override (skips density calc when set). */
  freightClass?: number;
  /** ZIP / city / lat-lng — used for zone matching only. */
  pickupCity?: string;
  pickupState?: string;
  pickupZip?: string;
  pickupCountry?: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryZip?: string;
  deliveryCountry?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  /** Anchor port code used for drayage zone lookup. */
  pickupPortCode?: string;
  deliveryPortCode?: string;
  /** Drayage: tenant terminal codes (when selected). Adds per-terminal surcharge. */
  pickupTerminalCode?: string;
  deliveryTerminalCode?: string;
  /** Codes of accessorials the user explicitly picked. */
  selectedAccessorialCodes?: string[];
  /** Free-form flags the AI / form might pass. */
  flags?: {
    residential?: boolean;
    hazmat?: boolean;
    tempControlled?: boolean;
    insideDelivery?: boolean;
    liftgate?: boolean;
    prepull?: boolean;
    storageDays?: number;
    detentionHours?: number;
    layoverDays?: number;
    /** LTL: freight is palletized (vs loose / floor-loaded). */
    palletized?: boolean;
    /** LTL: pickup/delivery is at a loading dock (false ⇒ liftgate needed). */
    loadedFromDock?: boolean;
  };
}

export interface CalcLine {
  name: string;
  amount: number; // USD, can be 0 for explanatory rows
  kind: 'linehaul' | 'minimum' | 'accessorial' | 'fuel' | 'margin' | 'note';
  note?: string;
  code?: string;
}

export interface CalcResult {
  request: CalcRequest;
  lines: CalcLine[];
  subtotalLinehaul: number;
  subtotalAccessorials: number;
  fuelSurcharge: number;
  margin: number;
  total: number;
  currency: Currency;
  /**
   * Set when the lane can't be priced. `reason` is customer-facing copy; `code`
   * lets callers (e.g. the operator auto-check) distinguish the generic
   * nets-to-$0 catch-all ('unpriceable') from the specific guards (over-range,
   * over-capacity, no card) that carry their own tailored reason.
   */
  unsupported?: { reason: string; code?: 'unpriceable' };
  /** LTL only: the size/weight rating basis behind the price (credibility). */
  ltl?: FreightClassEstimate & { classSource: 'derived' | 'override' };
  /**
   * Rate-confidence signal from match quality (see QuoteConfidence). Present on
   * a priced result; absent on the unsupported/unpriceable returns (no total).
   */
  confidence?: QuoteConfidence;
  /**
   * Estimated range around `total` — total ± a confidence-scaled band (high
   * ≈ ±4%, medium ≈ ±8%), in the quote's own currency, snapped to clean
   * dollars. `total` stays the single headline number; the range communicates
   * uncertainty without moving the price.
   */
  low?: number;
  high?: number;
  /**
   * Quote-validity window in days (= QUOTE_VALIDITY_DAYS). The widget renders it
   * as an explicit "Valid until" date aligned with the terms disclaimer.
   */
  validityDays?: number;
}

/** Snap a band edge to a "clean" dollar step that scales with the total, so a
 *  range reads as $2,300 – $2,490, never $2,304.71 – $2,491.03. */
function bandStep(total: number): number {
  if (total >= 5000) return 50;
  if (total >= 2000) return 25;
  if (total >= 500) return 10;
  if (total >= 100) return 5;
  return 1;
}

/**
 * Estimated range + confidence for a priced total. Confidence starts from which
 * tier matched (an exact matrix cell is the only 'high' source) and is demoted
 * to 'medium' when the matched lane had only coarse inputs (no ZIP on either
 * end). The band widens with lower confidence; edges snap to clean dollars and
 * always bracket the total (low floored, high ceiled).
 */
function confidenceAndRange(
  total: number,
  matchedExactCell: boolean,
  hasPreciseInput: boolean
): { confidence: QuoteConfidence; low: number; high: number } {
  const confidence: QuoteConfidence =
    matchedExactCell && hasPreciseInput ? 'high' : 'medium';
  const band = confidence === 'high' ? 0.04 : 0.08;
  const step = bandStep(total);
  const low = Math.max(0, Math.floor((total * (1 - band)) / step) * step);
  const high = Math.ceil((total * (1 + band)) / step) * step;
  return { confidence, low, high };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 3958.8; // miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Used by the engine and by the geocoding cache to test zone match. */
export function distanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  return haversineMiles(a, b);
}

/**
 * Deterministic priority order for rate cards. When a tenant has more than
 * one enabled card for the same (service, equipment) — including legacy
 * duplicates created before the write-time guard existed — the winner MUST
 * be stable across every request, or a customer gets a random price.
 *
 * Rule: the most-recently-updated enabled card wins; `id` is the
 * deterministic final tiebreak (higher id, i.e. the newer row, wins). This
 * mirrors the `updatedAt DESC, id DESC` order used by the rate-card query in
 * `loadConfig` (src/server/routes/public.ts) so the SAME card always wins
 * regardless of arbitrary DB row order.
 */
export function compareRateCardPriority(a: RateCard, b: RateCard): number {
  const at = a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0;
  const bt = b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0;
  if (at !== bt) return bt - at; // updatedAt DESC
  return b.id - a.id; // id DESC
}

function findRateCard(
  cards: RateCard[],
  service: string,
  equipment: string
): RateCard | undefined {
  // Match predicate is unchanged (enabled + service + equipment). The only
  // change is that when multiple cards match we return the deterministic
  // winner (compareRateCardPriority) instead of whichever row happened to be
  // first in an arbitrarily-ordered array — so pricing can never be random.
  const matches = cards.filter(
    (c) => c.enabled && c.service === service && c.equipment === equipment
  );
  if (matches.length === 0) return undefined;
  return matches.slice().sort(compareRateCardPriority)[0];
}

/** Minimal shape needed to detect a duplicate-enabled rate-card conflict. */
export interface RateCardIdentity {
  id: number;
  service: string;
  equipment: string;
  enabled: boolean;
}

/**
 * Write-time duplicate guard. Given the tenant's existing rate cards and a
 * candidate being created or edited, return the conflicting card if enabling
 * the candidate would leave TWO different enabled cards for the same
 * (service, equipment) — otherwise undefined.
 *
 * Allowed (returns undefined): editing the SAME card (matched by id), a
 * disabled candidate, or a new (service, equipment) with no enabled peer.
 */
export function findConflictingEnabledCard<T extends RateCardIdentity>(
  existing: T[],
  candidate: { id?: number | null; service: string; equipment: string; enabled: boolean }
): T | undefined {
  if (!candidate.enabled) return undefined; // disabled cards may duplicate freely
  return existing.find(
    (c) =>
      c.enabled &&
      c.service === candidate.service &&
      c.equipment === candidate.equipment &&
      c.id !== candidate.id
  );
}

function matchLaneZone(
  zones: LaneZone[],
  req: CalcRequest
): LaneZone | undefined {
  const enabled = zones.filter((z) => z.enabled);
  // 1. anchor matches port code on pickup OR delivery
  const candidates = enabled.filter((z) => {
    if (z.anchorPortCode) {
      const port =
        (req.pickupPortCode ?? '').toUpperCase() ===
          z.anchorPortCode.toUpperCase() ||
        (req.deliveryPortCode ?? '').toUpperCase() ===
          z.anchorPortCode.toUpperCase();
      if (!port) return false;
    } else if (z.anchorCity) {
      const cityMatch = (s?: string | null) =>
        (s ?? '').toLowerCase().trim() ===
        (z.anchorCity ?? '').toLowerCase().trim();
      if (
        !cityMatch(req.pickupCity ?? null) &&
        !cityMatch(req.deliveryCity ?? null)
      )
        return false;
    } else {
      return false;
    }
    // 2. equipment scope
    const scope = z.equipmentScope ?? [];
    if (scope.length > 0 && !scope.includes(req.equipment)) return false;
    // 3. radius — needs lat/lng on the non-anchor side. We don't store lat/lng
    //   on the zone itself; compute would need geocoding. For MVP we
    //   accept the zone if miles ≤ radius. Caller is expected to set
    //   req.miles to the distance from anchor to non-anchor.
    if (req.miles > z.radiusMiles) return false;
    return true;
  });
  // pick the smallest radius (most specific) that fits.
  candidates.sort((a, b) => a.radiusMiles - b.radiusMiles);
  return candidates[0];
}

/** Decide which accessorials auto-trigger for this request. */
// An accessorial applies to a quote's service if it has no service scope, or
// its scope includes the service. Enforced for BOTH auto and optional lines.
function inScope(a: Accessorial, req: CalcRequest): boolean {
  const scope = a.appliesToServices ?? [];
  return scope.length === 0 || scope.includes(req.service);
}

function autoTriggered(
  list: Accessorial[],
  req: CalcRequest
): Accessorial[] {
  const out: Accessorial[] = [];
  for (const a of list) {
    if (!a.enabled) continue;
    if (!inScope(a, req)) continue;
    if (a.trigger === 'auto') {
      out.push(a);
      continue;
    }
    if (a.trigger === 'auto_if_residential' && req.flags?.residential) {
      out.push(a);
      continue;
    }
    if (a.trigger === 'auto_if_hazmat' && req.flags?.hazmat) {
      out.push(a);
      continue;
    }
    if (a.trigger === 'auto_if_temp_controlled' && req.flags?.tempControlled) {
      out.push(a);
      continue;
    }
    // LTL: pickup/delivery is NOT at a dock → liftgate / limited-access service.
    if (a.trigger === 'auto_if_no_dock' && req.flags?.loadedFromDock === false) {
      out.push(a);
      continue;
    }
    // LTL: loose / floor-loaded (not palletized) → extra handling.
    if (a.trigger === 'auto_if_loose' && req.flags?.palletized === false) {
      out.push(a);
      continue;
    }
    if (
      a.trigger === 'auto_if_weight_over' &&
      a.conditionJson &&
      typeof a.conditionJson.weightLbsOver === 'number' &&
      typeof req.weightLbs === 'number' &&
      req.weightLbs > a.conditionJson.weightLbsOver
    ) {
      out.push(a);
    }
  }
  return out;
}

function applyAccessorial(
  a: Accessorial,
  base: number,
  req: CalcRequest
): number {
  switch (a.kind) {
    case 'flat':
      return a.amount;
    case 'per_mile':
      return a.amount * Math.max(0, req.miles);
    case 'pct_of_base':
      return base * (a.amount / 100);
    case 'per_day': {
      // Each per_day accessorial bills its OWN day count: layover reads
      // layoverDays; storage / yard / chassis / reefer-type charges read
      // storageDays. Summing both flags cross-charged every per_day line by the
      // other's days (e.g. storage billing layover nights). Source is chosen by
      // conditionJson.daysFlag, defaulting to storageDays.
      const flag: 'storageDays' | 'layoverDays' =
        a.conditionJson?.daysFlag === 'layoverDays' ? 'layoverDays' : 'storageDays';
      const days = Number(req.flags?.[flag] ?? 0);
      return a.amount * Math.max(0, days);
    }
    case 'per_hour': {
      // Bill hours OVER the accessorial's free window, not the raw hours.
      // conditionJson.freeHours (e.g. detention = 2, detention_terminal = 1)
      // was carried in the seed but never applied.
      const hours = Number(req.flags?.detentionHours ?? 0);
      const freeHours = Number(a.conditionJson?.freeHours ?? 0);
      return a.amount * Math.max(0, hours - freeHours);
    }
    default:
      return a.amount;
  }
}

/**
 * Automatic fuel-surcharge context. When `mode === 'auto'` and a per-mile
 * surcharge is supplied, the engine applies an EIA-diesel-derived fuel line
 * ($/mile × miles) INSTEAD of each card's fixed fuelSurchargePct. When
 * `mode === 'manual'` (or this arg is omitted), the original per-card
 * percentage model is used unchanged.
 */
export interface FscOptions {
  mode: 'manual' | 'auto';
  /** Surcharge dollars per mile (auto mode). */
  perMileUsd?: number;
  /** National avg diesel price used, for the honest quote-line label. */
  dieselUsd?: number;
  /** Short date label (e.g. "07/07") of the diesel price. */
  asOfLabel?: string;
}

export function calculate(
  cards: RateCard[],
  accessorialList: Accessorial[],
  zones: LaneZone[],
  req: CalcRequest,
  terminals: Terminal[] = [],
  fsc?: FscOptions,
  // ── Tier 2: native rate-matrix pricing (ADDITIVE) ──────────────────
  // Both default to [] so every existing caller is byte-identical: with no
  // matrices, `matrixMatch` is always undefined and every branch below collapses
  // to the pre-existing card / lane-zone / LTL logic. See src/calc/rateMatrix.ts.
  matrices: MatrixCellInput[] = [],
  matrixZones: ZoneDefInput[] = []
): CalcResult {
  const lines: CalcLine[] = [];

  const card = findRateCard(cards, req.service, req.equipment);
  const zone = matchLaneZone(zones, req);
  // Precedence: an exact matrix cell wins over a lane_zone radius match and the
  // per-mile / LTL rate card (documented in the PR). Resolved DIRECTIONALLY from
  // the shipment's origin/dest → matrix keys (zip5 → zip3 → named zone →
  // city/state). Only computed when the tenant actually has matrices.
  const matrixMatch = matrices.length
    ? findMatrixCell(matrices, matrixZones, {
        origin: { zip: req.pickupZip, city: req.pickupCity, state: req.pickupState, portCode: req.pickupPortCode },
        dest: { zip: req.deliveryZip, city: req.deliveryCity, state: req.deliveryState, portCode: req.deliveryPortCode },
        service: req.service,
        equipment: req.equipment,
      })
    : undefined;

  if (!card && !zone && !matrixMatch) {
    return {
      request: req,
      lines: [],
      subtotalLinehaul: 0,
      subtotalAccessorials: 0,
      fuelSurcharge: 0,
      margin: 0,
      total: 0,
      currency: req.currency ?? 'USD',
      unsupported: {
        reason:
          `No rate card configured for service "${req.service}" with equipment "${req.equipment}". ` +
          `Ask the carrier to add a rate card for this combination.`,
      },
    };
  }

  // ── Distance sanity guard ─────────────────────────────────────────
  // Each rate card carries a maxMiles ceiling (e.g. drayage = 300 mi). It
  // was previously only AI metadata and never enforced, so a per-mile
  // fall-through would silently price a 2,000-mi "drayage" lane at
  // $4.50/mi ≈ $12k — an absurd number that destroys quote credibility.
  // A lane-zone flat tariff (short-haul drayage inside its radius) is
  // exempt; this only guards the per-mile card path.
  if (!zone && !matrixMatch && card && typeof card.maxMiles === 'number' && card.maxMiles > 0 && req.miles > card.maxMiles) {
    return {
      request: req,
      lines: [],
      subtotalLinehaul: 0,
      subtotalAccessorials: 0,
      fuelSurcharge: 0,
      margin: 0,
      total: 0,
      currency: req.currency ?? 'USD',
      unsupported: {
        reason:
          `This lane is about ${Math.round(req.miles)} miles, beyond the ${Math.round(card.maxMiles)}-mile range for ${req.service.toUpperCase()} ${req.equipment}. ` +
          `Please contact us for a custom quote${req.service === 'drayage' ? ' or choose a truckload (FTL) service for long-haul lanes' : ''}.`,
      },
    };
  }

  // ── Weight-capacity guard ─────────────────────────────────────────
  // Each rate card also carries a maxWeightLbs ceiling (e.g. a Sprinter van
  // = 4,000 lb, a hotshot flatbed = 16,500 lb). Like maxMiles above it was
  // previously only surfaced to the widget as a soft, bypassable client
  // warning — the server never enforced it, so an API caller (or a user who
  // clicks past the warning) could price a physically-impossible 30,000-lb
  // Sprinter load. Enforce the tenant's OWN configured capacity here so the
  // displayed cap, the enforced cap, and the priced load can never diverge.
  // The global MAX_QUOTABLE_WEIGHT_LBS legal cap is checked separately at the
  // route; this is the finer, per-equipment ceiling. Zone flat tariffs are
  // exempt (mirrors the maxMiles guard) — they price a container move, not a
  // per-equipment truckload.
  if (
    !zone &&
    !matrixMatch &&
    card &&
    typeof card.maxWeightLbs === 'number' &&
    card.maxWeightLbs > 0 &&
    typeof req.weightLbs === 'number' &&
    req.weightLbs > card.maxWeightLbs
  ) {
    return {
      request: req,
      lines: [],
      subtotalLinehaul: 0,
      subtotalAccessorials: 0,
      fuelSurcharge: 0,
      margin: 0,
      total: 0,
      currency: req.currency ?? 'USD',
      unsupported: {
        reason:
          `This load is about ${Math.round(req.weightLbs).toLocaleString('en-US')} lb, beyond the ${Math.round(card.maxWeightLbs).toLocaleString('en-US')}-lb capacity for ${req.service.toUpperCase()} ${req.equipment}. ` +
          `Please choose a larger equipment type, or contact us for a custom quote.`,
      },
    };
  }

  // ── Linehaul ──────────────────────────────────────────────────────
  let linehaul = 0;
  let ltlRating: (FreightClassEstimate & { classSource: 'derived' | 'override' }) | undefined;
  if (matrixMatch) {
    // Matrix cell wins the linehaul (highest precedence). Price per unit_basis
    // then apply the cell's min-charge floor. FSC + margin + accessorials then
    // flow through the SAME existing card-driven path below — identical to how a
    // matched lane-zone flat tariff behaves.
    const cell = matrixMatch.cell;
    const priced = matrixLinehaul(cell, req.miles);
    linehaul = round2(priced.amount);
    const basis = String(cell.unitBasis || 'flat');
    const note =
      basis === 'per_mile'
        ? `${req.miles.toFixed(0)} mi × $${(Number(cell.rate) || 0).toFixed(2)}/mi from the rate matrix (${cell.originKey} → ${cell.destKey}).`
        : basis === 'per_container'
          ? `Per-container matrix rate for ${cell.originKey} → ${cell.destKey}.`
          : `Flat matrix lane rate for ${cell.originKey} → ${cell.destKey}.`;
    lines.push({
      name: priced.floored
        ? `Minimum charge (matrix ${cell.originKey} → ${cell.destKey})`
        : `Matrix lane rate (${cell.originKey} → ${cell.destKey})`,
      amount: linehaul,
      kind: priced.floored ? 'minimum' : 'linehaul',
      note,
    });
  } else if (zone) {
    linehaul = zone.flatPrice;
    lines.push({
      name: `${zone.label} (zone tariff)`,
      amount: linehaul,
      kind: 'linehaul',
      note: `Flat tariff applies because pickup/delivery is within ${zone.radiusMiles} mi of ${zone.anchorPortCode ?? zone.anchorCity ?? 'anchor'}.`,
    });
  } else if (card && req.service === 'ltl') {
    // ── LTL: class + weight-break pricing (NOT distance-only) ─────────
    // A 1,200-lb and a 40,000-lb LTL load must never price the same. We
    // derive the NMFC freight class from density (weight ÷ L×W×H) and rate
    // per hundredweight with class + weight-break factors.
    const est = estimateFreightClass({
      weightLbs: req.weightLbs,
      lengthIn: req.lengthIn,
      widthIn: req.widthIn,
      heightIn: req.heightIn,
    });
    const freightClass =
      typeof req.freightClass === 'number' && req.freightClass > 0
        ? req.freightClass
        : est?.freightClass ?? 100;
    if (est) {
      // When the widget sends an aggregate override (multi-item LTL), the
      // effective class used for pricing MUST also be the one reported back in
      // `ltl.freightClass` — otherwise the result-card chip + the stored lead
      // show the density-derived class while the price reflects the override.
      ltlRating = { ...est, freightClass, classSource: req.freightClass ? 'override' : 'derived' };
    } else if (typeof req.freightClass === 'number' && req.freightClass > 0) {
      ltlRating = {
        freightClass,
        densityPcf: 0,
        cubicFeet: 0,
        chargeableWeightLbs: Math.max(0, Number(req.weightLbs) || 0),
        classSource: 'override',
      };
    }
    const cfg = card.ltlConfig ?? DEFAULT_LTL_CONFIG;
    linehaul = round2(
      ltlLinehaul(cfg, {
        weightLbs: req.weightLbs ?? 0,
        freightClass,
        miles: req.miles,
        minimumCharge: card.minimumCharge,
        flatFee: card.flatFee,
      })
    );
    const wLbl = req.weightLbs ? `${Math.round(req.weightLbs).toLocaleString('en-US')} lb` : 'weight n/a';
    lines.push({
      name: `Line haul (LTL — class ${freightClass}, ${wLbl})`,
      amount: linehaul,
      kind: 'linehaul',
      note: est
        ? `Freight class ${freightClass} from density ${est.densityPcf} lb/ft³ (${est.cubicFeet} ft³). Rated per hundredweight with weight-break + distance.`
        : `Freight class ${freightClass}. Add dimensions for a density-based class.`,
    });
  } else if (card) {
    const computed = req.miles * card.ratePerMile + card.flatFee;
    if (computed >= card.minimumCharge) {
      linehaul = computed;
      const lineName = `Linehaul (${req.miles.toFixed(0)} mi × $${card.ratePerMile.toFixed(2)}/mi)`;
      lines.push({ name: lineName, amount: round2(req.miles * card.ratePerMile), kind: 'linehaul' });
      if (card.flatFee > 0) {
        lines.push({ name: 'Per-load fee', amount: round2(card.flatFee), kind: 'linehaul' });
      }
    } else {
      linehaul = card.minimumCharge;
      lines.push({
        name: `Minimum charge (${req.miles.toFixed(0)} mi × $${card.ratePerMile.toFixed(2)}/mi was below minimum)`,
        amount: round2(card.minimumCharge),
        kind: 'minimum',
      });
    }
  }

  const subtotalLinehaul = round2(linehaul);

  // ── Accessorials ──────────────────────────────────────────────────
  let acc = 0;
  const auto = autoTriggered(accessorialList, req);
  for (const a of auto) {
    const amt = round2(applyAccessorial(a, subtotalLinehaul, req));
    if (amt === 0) continue;
    lines.push({
      name: a.label,
      amount: amt,
      kind: 'accessorial',
      code: a.code,
      note: 'Automatically applied',
    });
    acc += amt;
  }
  const selectedCodes = new Set(req.selectedAccessorialCodes ?? []);
  const optional = accessorialList.filter(
    (a) =>
      a.enabled &&
      a.trigger === 'optional' &&
      selectedCodes.has(a.code) &&
      inScope(a, req) &&
      !auto.find((x) => x.code === a.code)
  );
  for (const a of optional) {
    const amt = round2(applyAccessorial(a, subtotalLinehaul, req));
    if (amt === 0) continue;
    lines.push({
      name: a.label,
      amount: amt,
      kind: 'accessorial',
      code: a.code,
    });
    acc += amt;
  }
  // ── Terminal surcharges (drayage) ─────────────────────────────────
  // Charged per leg when the user picked a specific terminal that the
  // carrier has marked with a non-zero surcharge.
  for (const [code, leg] of [
    [req.pickupTerminalCode, 'pickup'],
    [req.deliveryTerminalCode, 'delivery'],
  ] as const) {
    if (!code) continue;
    const t = terminals.find((x) => x.enabled && x.code === code);
    if (!t || !t.surcharge || t.surcharge <= 0) continue;
    const amt = round2(t.surcharge);
    lines.push({
      name: `Terminal surcharge — ${t.name} (${leg})`,
      amount: amt,
      kind: 'accessorial',
      code: 'terminal_surcharge',
    });
    acc += amt;
  }

  const subtotalAccessorials = round2(acc);

  // ── Fuel surcharge ────────────────────────────────────────────────
  // Auto mode (tenant opted in): apply the EIA-diesel-derived surcharge as a
  // $/mile add — the industry-standard DOE-index model — labelled with its
  // honest basis. Manual mode: each card's fixed % of linehaul (original).
  let fuel = 0;
  if (fsc?.mode === 'auto') {
    // Auto mode OWNS the fuel line — it must never fall through to the card's
    // fixed %. A diesel price at/below the peg legitimately yields $0 fuel.
    const autoPerMile = Math.max(0, fsc.perMileUsd ?? 0);
    if (autoPerMile > 0 && subtotalLinehaul > 0 && req.miles > 0) {
      fuel = round2(autoPerMile * req.miles);
      if (fuel > 0) {
        const basis =
          typeof fsc.dieselUsd === 'number' && fsc.dieselUsd > 0
            ? `national avg diesel $${fsc.dieselUsd.toFixed(2)}/gal${fsc.asOfLabel ? `, wk of ${fsc.asOfLabel}` : ''} — $${autoPerMile.toFixed(2)}/mi`
            : `$${autoPerMile.toFixed(2)}/mi`;
        lines.push({
          name: `Fuel surcharge (${basis})`,
          amount: fuel,
          kind: 'fuel',
        });
      }
    }
  } else if (card && card.fuelSurchargePct > 0) {
    fuel = round2(subtotalLinehaul * (card.fuelSurchargePct / 100));
    lines.push({
      name: `Fuel surcharge (${card.fuelSurchargePct.toFixed(1)}% of linehaul)`,
      amount: fuel,
      kind: 'fuel',
    });
  }

  // ── Margin ────────────────────────────────────────────────────────
  let margin = 0;
  const subtotal = subtotalLinehaul + subtotalAccessorials + fuel;
  if (card && card.marginPct > 0) {
    margin = round2(subtotal * (card.marginPct / 100));
    lines.push({
      name: `Margin (${card.marginPct.toFixed(1)}%)`,
      amount: margin,
      kind: 'margin',
    });
  }

  const total = round2(subtotal + margin);

  // ── Unpriceable catch-all ─────────────────────────────────────────
  // If we reach here with a non-positive total, NO rate source actually
  // priced the lane: no card/matrix/zone branch matched, or the one that
  // did nets to $0 (a card with zero ratePerMile+flatFee+minimumCharge, a
  // $0 zone/matrix cell, etc.). A $0 freight quote is never a real customer
  // price — it always means "can't price online". The specific guards above
  // (over-maxMiles, over-capacity, no card configured) return their own
  // tailored reasons and never fall through to here; this is the last-resort
  // net so the widget shows a "request a manual quote" message instead of a
  // misleading $0 hero + "Get this quote" CTA.
  if (total <= 0) {
    return {
      request: req,
      lines: [],
      subtotalLinehaul: 0,
      subtotalAccessorials: 0,
      fuelSurcharge: 0,
      margin: 0,
      total: 0,
      currency: req.currency ?? 'USD',
      unsupported: {
        reason:
          `We can't price this ${req.service.toUpperCase()} lane online right now. ` +
          `Please request a manual quote and our team will follow up with pricing.`,
        code: 'unpriceable',
      },
      ...(ltlRating ? { ltl: ltlRating } : {}),
    };
  }

  // ── Confidence / range / validity (premium KPI) ───────────────────
  // Match quality decides confidence: only an exact matrix cell with a precise
  // (ZIP-bearing) lane earns 'high'; a zone/flat tariff, per-mile / LTL card, or
  // a coarsely-matched matrix cell is 'medium'. The band scales off that.
  const hasPreciseInput = Boolean(
    String(req.pickupZip ?? '').trim() || String(req.deliveryZip ?? '').trim()
  );
  const { confidence, low, high } = confidenceAndRange(
    total,
    Boolean(matrixMatch),
    hasPreciseInput
  );

  return {
    request: req,
    lines,
    subtotalLinehaul,
    subtotalAccessorials,
    fuelSurcharge: fuel,
    margin,
    total,
    currency: req.currency ?? 'USD',
    confidence,
    low,
    high,
    validityDays: QUOTE_VALIDITY_DAYS,
    ...(ltlRating ? { ltl: ltlRating } : {}),
  };
}

/** Minimal shape shared by CalcLine and the persisted breakdownJson rows. */
type BreakdownLine = { name?: string; amount?: number; kind?: string; note?: string; code?: string };

/**
 * Customer-facing surfaces fold the carrier's margin INTO the displayed
 * linehaul/minimum amount (see customerFacingLines). That makes any
 * parenthetical descriptor that states an arithmetic relationship against the
 * PRE-margin base no longer reconcile with the number shown — e.g.
 * "Fuel surcharge (22.0% of linehaul) $77.00" where 22% of the displayed
 * (margin-inflated) $401.24 linehaul ≠ $77, or "Minimum charge (96 mi ×
 * $2.55/mi was below minimum)" where the shown amount now includes margin.
 *
 * Strip ONLY those non-reconciling descriptors so the customer line reads
 * honestly ("Fuel surcharge", "Linehaul", "Minimum charge"). Descriptors that
 * make no margin-relative arithmetic claim are left intact: the auto-mode fuel
 * basis ("$0.53/mi" diesel-derived, computed off miles not linehaul), the LTL
 * class/weight note, the zone-tariff label, per-load fee. Internal/admin views
 * never call customerFacingLines, so their descriptors (which DO reconcile
 * against the pre-margin base) are unchanged.
 */
function stripNonReconcilingDescriptor<T extends BreakdownLine>(line: T): T {
  if (!line || typeof line.name !== 'string') return line;
  if (line.kind === 'fuel' || line.kind === 'minimum' || line.kind === 'linehaul') {
    line.name = line.name
      .replace(/\s*\([^()]*(?:% of linehaul|mi ×|was below minimum)[^()]*\)\s*$/i, '')
      .trim();
  }
  return line;
}

/**
 * Customer-facing view of a price breakdown.
 *
 * The carrier's profit margin must NEVER be shown to their customer — it
 * exposes their markup and invites them to negotiate it away or go direct.
 * This folds every `margin`-kind line's amount into the base linehaul (or
 * minimum) line and drops the margin lines, so the displayed line items
 * still sum to the SAME grand total (the total is computed independently
 * and is never changed by this function).
 *
 * Internal/admin surfaces (the dashboard lead detail, the rate-card config
 * where margin % is SET, the admin preview) keep the raw lines with the
 * margin line intact — only customer-facing surfaces (widget calc result,
 * hosted quote, customer auto-reply email) call this.
 *
 * Returns fresh line objects; the input array/objects are never mutated.
 */
export function customerFacingLines<T extends BreakdownLine>(lines: T[] | null | undefined): T[] {
  const src = Array.isArray(lines) ? lines : [];
  const marginTotal = round2(
    src.filter((l) => l && l.kind === 'margin').reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
  );
  const visible = src
    .filter((l) => l && l.kind !== 'margin')
    .map((l) => stripNonReconcilingDescriptor({ ...l }));
  if (marginTotal === 0) return visible;
  const target =
    visible.find((l) => l.kind === 'linehaul') ?? visible.find((l) => l.kind === 'minimum');
  if (target) {
    target.amount = round2((Number(target.amount) || 0) + marginTotal);
  } else {
    // No base line to absorb into (shouldn't happen when margin exists) —
    // surface it as a neutral "Line haul" charge rather than leaking margin.
    visible.unshift({ name: 'Line haul', amount: marginTotal, kind: 'linehaul' } as T);
  }
  return visible;
}
