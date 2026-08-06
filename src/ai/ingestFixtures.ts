/**
 * Rate-sheet ingest FIXTURES — the parsed-JSON objects the model SHOULD emit
 * for representative rate-sheet formats, plus a couple of raw source texts for
 * optional live smoke tests.
 *
 * These drive deterministic tests of the schema / apply / engine path (the AI
 * call itself is non-deterministic and is exercised only by the gated live
 * smoke test). Each fixture mirrors one of the 8 document patterns in
 * docs/RATE-INGESTION-RESEARCH.md. Pure data — no imports, no side effects.
 */

import type { IngestParsed } from './ingestFile.js';

/** 1) FTL all-in rate con: one number, fuel included → fuelSurchargePct 0. */
export const FIXTURE_FTL_ALL_IN: IngestParsed = {
  summary: 'FTL 53\' dry van all-in spot rate LAX→PHX.',
  confidence: 'high',
  warnings: [],
  currency: 'USD',
  effectiveDate: null,
  expirationDate: null,
  fscDetected: {
    present: true,
    appearsIncludedInLinehaul: true,
    valuePct: null,
    valuePerMile: null,
    fscScale: null,
    notes: "'all-in' → fuel already included; not re-applied.",
  },
  rateCards: [
    {
      service: 'ftl',
      equipment: 'dryvan',
      label: "53' Dry Van",
      ratePerMile: 4.97,
      minimumCharge: null,
      flatFee: 0,
      fuelSurchargePct: 0,
      marginPct: null,
      maxWeightLbs: null,
      maxMiles: null,
      ltlConfig: null,
      derivedFrom: {
        totalUsd: 1850,
        originAddress: 'Los Angeles, CA',
        destinationAddress: 'Phoenix, AZ',
        approxMiles: 372,
        explanation: '1850 / 372',
      },
    },
  ],
  accessorials: [],
  laneZones: [],
};

/** 2) FTL linehaul + separate FSC% + minimum charge. */
export const FIXTURE_FTL_LINEHAUL_FSC_MIN: IngestParsed = {
  summary: 'Contract FTL dry van: linehaul + 28% FSC, $450 min.',
  confidence: 'high',
  warnings: [],
  currency: 'USD',
  effectiveDate: null,
  expirationDate: null,
  fscDetected: {
    present: true,
    appearsIncludedInLinehaul: false,
    valuePct: 28,
    valuePerMile: null,
    fscScale: null,
    notes: 'Separate FSC column at 28% of net linehaul.',
  },
  rateCards: [
    {
      service: 'ftl',
      equipment: 'dryvan',
      label: 'Dry Van (linehaul + FSC)',
      ratePerMile: 2.1,
      minimumCharge: 450,
      flatFee: 0,
      fuelSurchargePct: 28,
      marginPct: null,
      maxWeightLbs: null,
      maxMiles: null,
      ltlConfig: null,
      derivedFrom: null,
    },
  ],
  accessorials: [],
  laneZones: [],
};

/**
 * 3) LTL class×weight-break GRID with discount-off-named-base + AMC.
 * baseRatePerCwt is stored NET (65% discount folded in); classRates &
 * weightBreaks are ratios of the class-100 row; distanceFactor 0 (grid rates
 * are complete linehaul). AMC 95 also mirrored to minimumCharge on apply.
 */
export const FIXTURE_LTL_GRID: IngestParsed = {
  summary: 'LTL class×weight-break grid, CzarLite XL base at 65% discount, AMC $95.',
  confidence: 'high',
  warnings: ['LTL rated off CzarLite XL 2024 base at 65% discount (folded into net CWT).'],
  currency: 'USD',
  effectiveDate: '2026-03-01',
  expirationDate: null,
  fscDetected: {
    present: true,
    appearsIncludedInLinehaul: false,
    valuePct: 30,
    valuePerMile: null,
    fscScale: null,
    notes: 'LTL FSC ~30% of net linehaul (representative).',
  },
  rateCards: [
    {
      service: 'ltl',
      equipment: 'pallet',
      label: 'LTL (CzarLite XL, 65% off)',
      ratePerMile: null,
      minimumCharge: 95,
      flatFee: 0,
      fuelSurchargePct: 30,
      marginPct: null,
      maxWeightLbs: null,
      maxMiles: null,
      ltlConfig: {
        baseRatePerCwt: 26,
        classRates: { '50': 0.5, '70': 0.72, '100': 1.0, '175': 1.9, '500': 3.5 },
        weightBreaks: [
          { minLbs: 0, rateFactor: 1.0 },
          { minLbs: 1000, rateFactor: 0.7 },
          { minLbs: 5000, rateFactor: 0.45 },
        ],
        distanceFactorPer1000Mi: 0,
        discountPct: 65,
        baseTariffName: 'CzarLite XL 2024',
        fakClassMap: { '70': 85, '92.5': 85, '110': 85 },
        absoluteMinCharge: 95,
      },
      derivedFrom: null,
    },
  ],
  accessorials: [],
  laneZones: [],
};

/** 4) Drayage port→zone per-container matrix mapped to lane zones. */
export const FIXTURE_DRAYAGE_ZONES: IngestParsed = {
  summary: 'Port of LA drayage per-container zone matrix (20/40), FSC 40%.',
  confidence: 'high',
  warnings: ['Drayage per-container zone matrix mapped to lane zones; FSC 40% captured.'],
  currency: 'USD',
  effectiveDate: null,
  expirationDate: null,
  fscDetected: {
    present: true,
    appearsIncludedInLinehaul: false,
    valuePct: 40,
    valuePerMile: null,
    fscScale: null,
    notes: 'Single FSC 40% applied across the matrix.',
  },
  rateCards: [
    {
      service: 'drayage',
      equipment: 'container_40',
      label: "40' Container Drayage",
      ratePerMile: null,
      minimumCharge: 385,
      flatFee: 0,
      fuelSurchargePct: 40,
      marginPct: null,
      maxWeightLbs: null,
      maxMiles: 300,
      ltlConfig: null,
      derivedFrom: null,
    },
  ],
  accessorials: [],
  laneZones: [
    {
      label: 'USLAX → Zone A (0-30mi)',
      anchorPortCode: 'USLAX',
      anchorCity: 'Los Angeles',
      anchorState: 'CA',
      radiusMiles: 30,
      flatPrice: 425,
      equipmentScope: ['container_40'],
    },
    {
      label: 'USLAX → Zone A (0-30mi) 20\'',
      anchorPortCode: 'USLAX',
      anchorCity: 'Los Angeles',
      anchorState: 'CA',
      radiusMiles: 30,
      flatPrice: 385,
      equipmentScope: ['container_20'],
    },
    {
      label: 'USLAX → Zone B (30-60mi)',
      anchorPortCode: 'USLAX',
      anchorCity: 'Los Angeles',
      anchorState: 'CA',
      radiusMiles: 60,
      flatPrice: 540,
      equipmentScope: ['container_40'],
    },
  ],
};

/** 7) Rate confirmation FORM (one load): linehaul + flat FSC + detention clause. */
export const FIXTURE_RATE_CON: IngestParsed = {
  summary: 'Rate confirmation for one FTL reefer load, linehaul + flat FSC.',
  confidence: 'high',
  warnings: ['Single-load rate con — rate is a snapshot, not a live scale.'],
  currency: 'USD',
  effectiveDate: null,
  expirationDate: null,
  fscDetected: {
    present: true,
    appearsIncludedInLinehaul: false,
    valuePct: null,
    valuePerMile: null,
    fscScale: null,
    notes: 'Flat FSC line stated on the con.',
  },
  rateCards: [
    {
      service: 'ftl',
      equipment: 'reefer',
      label: 'Reefer (rate con)',
      ratePerMile: 3.05,
      minimumCharge: null,
      flatFee: 0,
      fuelSurchargePct: 0,
      marginPct: null,
      maxWeightLbs: null,
      maxMiles: null,
      ltlConfig: null,
      derivedFrom: null,
    },
  ],
  accessorials: [
    {
      code: 'detention',
      label: 'Detention',
      kind: 'per_hour',
      amount: 65,
      trigger: 'optional',
      freeHours: 2,
      daysFlag: null,
      conditionJson: null,
      appliesToServices: ['ftl'],
    },
  ],
  laneZones: [],
};

/** 8) Rate-card email (mixed units) with an effective date. */
export const FIXTURE_RATE_CARD_EMAIL: IngestParsed = {
  summary: 'Rate-card email: reefer per-mile + fuel, detention, residential.',
  confidence: 'medium',
  warnings: ['Reefer FSC separate but percentage not stated.'],
  currency: 'USD',
  effectiveDate: '2026-03-01',
  expirationDate: null,
  fscDetected: {
    present: true,
    appearsIncludedInLinehaul: false,
    valuePct: null,
    valuePerMile: null,
    fscScale: null,
    notes: "'+fuel' → separate but percentage not stated.",
  },
  rateCards: [
    {
      service: 'ftl',
      equipment: 'reefer',
      label: 'Reefer',
      ratePerMile: 2.85,
      minimumCharge: null,
      flatFee: 0,
      fuelSurchargePct: null,
      marginPct: null,
      maxWeightLbs: null,
      maxMiles: null,
      ltlConfig: null,
      derivedFrom: null,
    },
  ],
  accessorials: [
    {
      code: 'detention',
      label: 'Detention',
      kind: 'per_hour',
      amount: 75,
      trigger: 'optional',
      freeHours: 2,
      daysFlag: null,
      conditionJson: null,
      appliesToServices: null,
    },
    {
      code: 'residential',
      label: 'Residential delivery',
      kind: 'flat',
      amount: 120,
      trigger: 'auto_if_residential',
      freeHours: null,
      daysFlag: null,
      conditionJson: null,
      appliesToServices: null,
    },
  ],
  laneZones: [],
};

/** 6) Accessorial / FSC schedule with free-time (detention hr, storage/day). */
export const FIXTURE_ACCESSORIAL_SCHEDULE: IngestParsed = {
  summary: 'Accessorial schedule: detention (free 2 hr), storage per day, chassis per day.',
  confidence: 'high',
  warnings: [],
  currency: 'USD',
  effectiveDate: null,
  expirationDate: null,
  rateCards: [],
  accessorials: [
    {
      code: 'detention',
      label: 'Detention',
      kind: 'per_hour',
      amount: 60,
      trigger: 'optional',
      freeHours: 2,
      daysFlag: null,
      conditionJson: null,
      appliesToServices: null,
    },
    {
      code: 'storage',
      label: 'Storage',
      kind: 'per_day',
      amount: 150,
      trigger: 'optional',
      freeHours: null,
      daysFlag: 'storageDays',
      conditionJson: null,
      appliesToServices: null,
    },
    {
      code: 'layover',
      label: 'Layover',
      kind: 'per_day',
      amount: 350,
      trigger: 'optional',
      freeHours: null,
      daysFlag: 'layoverDays',
      conditionJson: null,
      appliesToServices: null,
    },
    {
      code: 'overweight',
      label: 'Overweight',
      kind: 'flat',
      amount: 200,
      trigger: 'auto_if_weight_over',
      freeHours: null,
      daysFlag: null,
      conditionJson: { weightLbsOver: 44000 },
      appliesToServices: null,
    },
  ],
  laneZones: [],
};

/**
 * BACKWARD-COMPAT: the CURRENT simple shape (pre-comprehension) — a per-mile
 * card with none of the new fields. Must still validate + apply + price.
 */
export const FIXTURE_LEGACY_SIMPLE: Record<string, unknown> = {
  summary: 'parsed 1 row',
  confidence: 'high',
  warnings: [],
  fscDetected: {
    present: true,
    appearsIncludedInLinehaul: false,
    valuePct: 22,
    valuePerMile: null,
    notes: 'separate fuel',
  },
  rateCards: [
    { service: 'ftl', equipment: 'dryvan', ratePerMile: 2.5, minimumCharge: 400, flatFee: 0, fuelSurchargePct: 22, marginPct: 10 },
  ],
  accessorials: [
    { code: 'liftgate', label: 'Liftgate', kind: 'flat', amount: 75, appliesToServices: null },
  ],
  laneZones: [],
};

/** A MALFORMED parsed object — rateCards is not an array. Top-level rejects. */
export const FIXTURE_MALFORMED_TOPLEVEL: unknown = {
  summary: 'broken',
  rateCards: 'not-an-array',
};

/** A draft whose rate-card array holds one valid + one un-salvageable member. */
export const FIXTURE_PARTIAL_SALVAGE: unknown = {
  summary: 'one good, one bad',
  confidence: 'medium',
  rateCards: [
    { service: 'ftl', equipment: 'dryvan', ratePerMile: 2.4 },
    42, // not an object → dropped with a warning
  ],
  accessorials: [],
  laneZones: [],
};

/** All well-formed fixtures the schema must accept. */
export const ALL_VALID_FIXTURES: Array<{ name: string; parsed: IngestParsed | Record<string, unknown> }> = [
  { name: 'FTL all-in', parsed: FIXTURE_FTL_ALL_IN },
  { name: 'FTL linehaul+FSC+min', parsed: FIXTURE_FTL_LINEHAUL_FSC_MIN },
  { name: 'LTL class×weight-break grid', parsed: FIXTURE_LTL_GRID },
  { name: 'Drayage per-container zones', parsed: FIXTURE_DRAYAGE_ZONES },
  { name: 'Rate confirmation', parsed: FIXTURE_RATE_CON },
  { name: 'Rate-card email', parsed: FIXTURE_RATE_CARD_EMAIL },
  { name: 'Accessorial schedule w/ free-time', parsed: FIXTURE_ACCESSORIAL_SCHEDULE },
  { name: 'Legacy simple per-mile', parsed: FIXTURE_LEGACY_SIMPLE },
];

/* ── Raw source texts (for the optional, API-key-gated live smoke test) ── */

export const RAW_TEXT_FTL_ALL_IN = `Spot Rate Confirmation
Lane: Los Angeles, CA -> Phoenix, AZ
Equipment: 53' Dry Van
Miles: 372 (PC*MILER practical)
RATE: $1,850 ALL-IN (fuel included)
Payment: Net 30`;

export const RAW_CSV_LTL_GRID = `### Sheet: LTL Tariff
Class,L5C (<500),1M (1000-1999),5M (5000-9999)
50,23.10,16.63,10.40
70,33.26,23.94,14.98
100,42.00,30.24,18.90
175,79.80,57.46,35.91
500,147.00,105.84,66.15
,,,
Absolute Minimum Charge (AMC): $95.00
Discount: 65% off CzarLite XL 2024 base
FSC: 30% of net linehaul`;

export const RAW_TEXT_ACCESSORIALS = `Accessorial Schedule
Detention: $60/hr after 2 hours free
Storage: $150/day
Layover: $350/day
Overweight (>44,000 lbs): $200 flat`;
