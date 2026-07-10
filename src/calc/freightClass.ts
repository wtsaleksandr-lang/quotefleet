/**
 * LTL freight-class + class/weight-aware pricing.
 *
 * Real LTL is NOT priced on distance alone. Carriers rate a shipment by its
 * NMFC *freight class* (a density-derived number, 50 = dense/cheap … 500 =
 * light/expensive) and its *weight break* (heavier = lower rate per 100 lb),
 * subject to an absolute minimum charge. This module gives QuoteFleet a
 * practical, defensible version of that so a 1,200-lb and a 40,000-lb LTL
 * load no longer price identically.
 *
 * Two independent pieces:
 *   1. Classification — density (lb/ft³) → freight class, via the standard
 *      18-tier NMFC density scale.
 *   2. Pricing — a per-hundredweight (CWT) base rate scaled by a class
 *      multiplier and a weight-break rate factor, using the real LTL
 *      "deficit weight" (as-rated) rule so the charge is always
 *      monotonic non-decreasing in both weight and class.
 *
 * Everything here is a PURE function; `LtlConfig` is tenant-configurable so
 * a carrier can tune their own numbers (defaults ship credible out of box).
 */

/** One row of the standard NMFC density→class scale. */
export interface DensityBreak {
  /** Inclusive lower bound of density in lb/ft³ for this class. */
  minPcf: number;
  freightClass: number;
}

/**
 * Standard 18-tier NMFC density scale (lb per cubic foot → freight class).
 * Ordered densest-first. A shipment's class is the first row whose `minPcf`
 * its density meets or exceeds.
 *
 *   ≥ 50      → 50      12   – <13.5 → 85       6 – <7  → 150
 *   35 – <50  → 55      10.5 – <12   → 92.5     5 – <6  → 175
 *   30 – <35  → 60      9    – <10.5 → 100      4 – <5  → 200
 *   22.5–<30  → 65      8    – <9    → 110      3 – <4  → 250
 *   15 – <22.5→ 70      7    – <8    → 125      2 – <3  → 300
 *   13.5–<15  → 77.5    6    – <7    → 150      1 – <2  → 400
 *                                              < 1      → 500
 */
export const DENSITY_CLASS_SCALE: DensityBreak[] = [
  { minPcf: 50, freightClass: 50 },
  { minPcf: 35, freightClass: 55 },
  { minPcf: 30, freightClass: 60 },
  { minPcf: 22.5, freightClass: 65 },
  { minPcf: 15, freightClass: 70 },
  { minPcf: 13.5, freightClass: 77.5 },
  { minPcf: 12, freightClass: 85 },
  { minPcf: 10.5, freightClass: 92.5 },
  { minPcf: 9, freightClass: 100 },
  { minPcf: 8, freightClass: 110 },
  { minPcf: 7, freightClass: 125 },
  { minPcf: 6, freightClass: 150 },
  { minPcf: 5, freightClass: 175 },
  { minPcf: 4, freightClass: 200 },
  { minPcf: 3, freightClass: 250 },
  { minPcf: 2, freightClass: 300 },
  { minPcf: 1, freightClass: 400 },
  { minPcf: 0, freightClass: 500 },
];

/** All freight classes, ascending — used for the pricing class multiplier. */
export const FREIGHT_CLASSES = DENSITY_CLASS_SCALE.map((d) => d.freightClass).sort(
  (a, b) => a - b
);

/** Map a density (lb/ft³) to its NMFC freight class. */
export function freightClassForDensity(pcf: number): number {
  const d = Number.isFinite(pcf) ? pcf : 0;
  for (const row of DENSITY_CLASS_SCALE) {
    if (d >= row.minPcf) return row.freightClass;
  }
  return 500;
}

export interface FreightClassEstimate {
  freightClass: number;
  densityPcf: number;
  cubicFeet: number;
  chargeableWeightLbs: number;
}

/**
 * Compute the freight class from weight + L×W×H (inches).
 * density = weight (lb) ÷ volume (ft³), where volume = L×W×H ÷ 1728.
 * Returns null if any input is missing / non-positive (can't classify).
 */
export function estimateFreightClass(input: {
  weightLbs?: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
}): FreightClassEstimate | null {
  const w = Number(input.weightLbs);
  const l = Number(input.lengthIn);
  const wd = Number(input.widthIn);
  const h = Number(input.heightIn);
  if (![w, l, wd, h].every((n) => Number.isFinite(n) && n > 0)) return null;
  const cubicFeet = (l * wd * h) / 1728;
  if (cubicFeet <= 0) return null;
  const densityPcf = w / cubicFeet;
  return {
    freightClass: freightClassForDensity(densityPcf),
    densityPcf: Math.round(densityPcf * 100) / 100,
    cubicFeet: Math.round(cubicFeet * 100) / 100,
    chargeableWeightLbs: w,
  };
}

// ─── Pricing ─────────────────────────────────────────────────────────────

export interface LtlWeightBreak {
  /** Weight (lb) at which this break's rate factor starts to apply. */
  minLbs: number;
  /** Multiplier on the per-CWT base. Lower = cheaper (heavier freight). */
  rateFactor: number;
}

/**
 * Tenant-configurable LTL rate model. Stored on the LTL rate card
 * (`rate_cards.ltl_config`); when absent the engine falls back to
 * DEFAULT_LTL_CONFIG so a fresh tenant still prices credibly.
 */
export interface LtlConfig {
  /** Base $ per hundredweight (100 lb) at reference class 100. */
  baseRatePerCwt: number;
  /** class number → multiplier vs class 100 (1.0). Higher class = pricier. */
  classRates: Record<string, number>;
  /** Weight breaks, ascending minLbs / descending rateFactor. */
  weightBreaks: LtlWeightBreak[];
  /** Linehaul distance sensitivity: multiplier = 1 + (miles/1000)×this. */
  distanceFactorPer1000Mi: number;
}

/** Standard class multipliers (class 100 = 1.0), monotonic in class. */
export const DEFAULT_CLASS_RATES: Record<string, number> = {
  '50': 0.55,
  '55': 0.6,
  '60': 0.65,
  '65': 0.7,
  '70': 0.75,
  '77.5': 0.8,
  '85': 0.85,
  '92.5': 0.92,
  '100': 1.0,
  '110': 1.1,
  '125': 1.25,
  '150': 1.5,
  '175': 1.75,
  '200': 2.0,
  '250': 2.35,
  '300': 2.7,
  '400': 3.1,
  '500': 3.5,
};

export const DEFAULT_WEIGHT_BREAKS: LtlWeightBreak[] = [
  { minLbs: 0, rateFactor: 1.0 }, // L5C  — under 500 lb
  { minLbs: 500, rateFactor: 0.85 }, // M5C  — 500–999
  { minLbs: 1000, rateFactor: 0.72 }, // M1M  — 1,000–1,999
  { minLbs: 2000, rateFactor: 0.6 }, // M2M  — 2,000–4,999
  { minLbs: 5000, rateFactor: 0.5 }, // M5M  — 5,000–9,999
  { minLbs: 10000, rateFactor: 0.42 }, // M10M — 10,000–19,999
  { minLbs: 20000, rateFactor: 0.36 }, // M20M — 20,000+
];

export const DEFAULT_LTL_CONFIG: LtlConfig = {
  baseRatePerCwt: 14,
  classRates: DEFAULT_CLASS_RATES,
  weightBreaks: DEFAULT_WEIGHT_BREAKS,
  distanceFactorPer1000Mi: 0.8,
};

/** Look up the class multiplier, snapping to the nearest configured class. */
export function classMultiplier(cfg: LtlConfig, freightClass: number): number {
  const exact = cfg.classRates[String(freightClass)];
  if (typeof exact === 'number') return exact;
  // Fall back to the closest configured class so an odd class still prices.
  const classes = Object.keys(cfg.classRates)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!classes.length) return 1;
  let best = classes[0];
  for (const c of classes) {
    if (Math.abs(c - freightClass) < Math.abs(best - freightClass)) best = c;
  }
  return cfg.classRates[String(best)] ?? 1;
}

export interface LtlLinehaulInput {
  weightLbs: number;
  freightClass: number;
  miles: number;
  minimumCharge: number;
  flatFee: number;
}

/**
 * LTL linehaul price — class + weight + distance aware.
 *
 * base       = baseRatePerCwt × classMultiplier(class)
 * charge(b)  = max(weight, b.minLbs)/100 × base × b.rateFactor   for each break b
 * rated      = min over all breaks of charge(b)   ← real "deficit weight" rule:
 *              a shipper may bump to the next break's minimum weight to get its
 *              lower rate, so the customer always gets the cheapest legal rating.
 * linehaul   = max( rated × distanceMult + flatFee, minimumCharge )
 *
 * Because every charge(b) is non-decreasing in weight and the class multiplier
 * is non-decreasing in class, the result is monotonic non-decreasing in both —
 * heavier or higher-class freight can never come out cheaper.
 */
export function ltlLinehaul(cfg: LtlConfig, input: LtlLinehaulInput): number {
  const weight = Math.max(0, Number(input.weightLbs) || 0);
  const miles = Math.max(0, Number(input.miles) || 0);
  const base = cfg.baseRatePerCwt * classMultiplier(cfg, input.freightClass);
  const breaks =
    cfg.weightBreaks && cfg.weightBreaks.length
      ? cfg.weightBreaks
      : DEFAULT_WEIGHT_BREAKS;

  let rated = Infinity;
  for (const b of breaks) {
    const billed = Math.max(weight, b.minLbs);
    const charge = (billed / 100) * base * b.rateFactor;
    if (charge < rated) rated = charge;
  }
  if (!Number.isFinite(rated)) rated = (weight / 100) * base;

  const distanceMult = 1 + (miles / 1000) * cfg.distanceFactorPer1000Mi;
  const linehaul = rated * distanceMult + (Number(input.flatFee) || 0);
  return Math.max(linehaul, Number(input.minimumCharge) || 0);
}
