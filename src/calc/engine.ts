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
 * Output: line-itemised breakdown + total. Always USD for now.
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
} from '../db/schema.js';

export interface CalcRequest {
  service: string; // 'drayage' | 'ftl' | 'ltl' | ...
  equipment: string; // 'dryvan' | 'container_40hc' | ...
  miles: number;
  weightLbs?: number;
  pieces?: number;
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
  currency: 'USD';
  /** Set when no rate card / lane zone matches the request. */
  unsupported?: { reason: string };
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

function findRateCard(
  cards: RateCard[],
  service: string,
  equipment: string
): RateCard | undefined {
  return cards.find(
    (c) => c.enabled && c.service === service && c.equipment === equipment
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
function autoTriggered(
  list: Accessorial[],
  req: CalcRequest
): Accessorial[] {
  const out: Accessorial[] = [];
  for (const a of list) {
    if (!a.enabled) continue;
    // service scope
    const scope = a.appliesToServices ?? [];
    if (scope.length > 0 && !scope.includes(req.service)) continue;
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
      // Used for storage / layover. Reads ai-extracted day count if present.
      const days =
        Number(req.flags?.storageDays ?? 0) +
        Number(req.flags?.layoverDays ?? 0);
      return a.amount * Math.max(0, days);
    }
    case 'per_hour': {
      const hours = Number(req.flags?.detentionHours ?? 0);
      return a.amount * Math.max(0, hours);
    }
    default:
      return a.amount;
  }
}

export function calculate(
  cards: RateCard[],
  accessorialList: Accessorial[],
  zones: LaneZone[],
  req: CalcRequest
): CalcResult {
  const lines: CalcLine[] = [];

  const card = findRateCard(cards, req.service, req.equipment);
  const zone = matchLaneZone(zones, req);

  if (!card && !zone) {
    return {
      request: req,
      lines: [],
      subtotalLinehaul: 0,
      subtotalAccessorials: 0,
      fuelSurcharge: 0,
      margin: 0,
      total: 0,
      currency: 'USD',
      unsupported: {
        reason:
          `No rate card configured for service "${req.service}" with equipment "${req.equipment}". ` +
          `Ask the carrier to add a rate card for this combination.`,
      },
    };
  }

  // ── Linehaul ──────────────────────────────────────────────────────
  let linehaul = 0;
  if (zone) {
    linehaul = zone.flatPrice;
    lines.push({
      name: `${zone.label} (zone tariff)`,
      amount: linehaul,
      kind: 'linehaul',
      note: `Flat tariff applies because pickup/delivery is within ${zone.radiusMiles} mi of ${zone.anchorPortCode ?? zone.anchorCity ?? 'anchor'}.`,
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
  const subtotalAccessorials = round2(acc);

  // ── Fuel surcharge ────────────────────────────────────────────────
  let fuel = 0;
  if (card && card.fuelSurchargePct > 0) {
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

  return {
    request: req,
    lines,
    subtotalLinehaul,
    subtotalAccessorials,
    fuelSurcharge: fuel,
    margin,
    total,
    currency: 'USD',
  };
}
