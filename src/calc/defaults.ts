/**
 * Default rate cards + accessorials applied to every newly-created tenant.
 *
 * Numbers are sourced from the rate-data research (docs/rate-data-sources.md):
 * national US spot benchmarks April-May 2026, port-by-port drayage tariffs,
 * standard accessorial fees compiled from carrier publications.
 *
 * Tenants WILL want to tune these per-lane / per-region. The AI agent
 * lets them do that in plain English. These values just ensure the
 * widget produces a credible quote on day 1.
 */
import type { NewRateCard, NewAccessorial, NewLaneZone } from '../db/schema.js';
import { DEFAULT_LTL_CONFIG } from './freightClass.js';

/**
 * Automatic fuel-surcharge defaults.
 *
 * Used when a tenant opts into `fscMode = 'auto'` — the surcharge is derived
 * from the EIA weekly national diesel price with the standard DOE-index model
 * (see src/calc/fuelSurcharge.ts). These are sensible, defensible industry
 * defaults; a peg of $1.25/gal and 6.0 mpg reproduce the classic
 * "+$0.01/mile per $0.06 over peg" carrier FSC table.
 */
export const AUTO_FSC_DEFAULTS = {
  /** Base/peg diesel price ($/gal). Surcharge is $0 at or below this. */
  pegUsdPerGal: 1.25,
  /** Assumed truck fuel economy (mi/gal). */
  mpg: 6.0,
  /**
   * Last-resort national average diesel price ($/gal) used only when BOTH
   * the live EIA fetch and the cached value are unavailable — so a quote
   * never breaks. Roughly the 2026 national average; refreshed in-band the
   * moment EIA responds.
   */
  fallbackDieselUsdPerGal: 3.9,
  /** Refresh the cached EIA price when it is older than this many days. */
  refreshAfterDays: 7,
} as const;

export const DEFAULT_RATE_CARDS: Omit<NewRateCard, 'tenantId'>[] = [
  // ─── Truckload (FTL) ──────────────────────────────────────────────
  {
    service: 'ftl',
    equipment: 'dryvan',
    label: '53\' Dry Van',
    ratePerMile: 2.55,
    minimumCharge: 350,
    flatFee: 0,
    fuelSurchargePct: 22,
    marginPct: 12,
    maxWeightLbs: 45000,
    maxMiles: 3000,
    enabled: true,
    sortOrder: 10,
  },
  {
    service: 'ftl',
    equipment: 'reefer',
    label: '53\' Reefer (refrigerated)',
    ratePerMile: 2.95,
    minimumCharge: 450,
    flatFee: 0,
    fuelSurchargePct: 25,
    marginPct: 12,
    maxWeightLbs: 44000,
    maxMiles: 3000,
    enabled: true,
    sortOrder: 20,
  },
  {
    service: 'ftl',
    equipment: 'flatbed',
    label: 'Flatbed (48\' or 53\')',
    ratePerMile: 3.25,
    minimumCharge: 500,
    flatFee: 0,
    fuelSurchargePct: 25,
    marginPct: 12,
    maxWeightLbs: 48000,
    maxMiles: 3000,
    enabled: true,
    sortOrder: 30,
  },
  {
    service: 'ftl',
    equipment: 'step_deck',
    label: 'Step Deck',
    ratePerMile: 3.40,
    minimumCharge: 550,
    flatFee: 0,
    fuelSurchargePct: 25,
    marginPct: 12,
    maxWeightLbs: 48000,
    maxMiles: 3000,
    enabled: true,
    sortOrder: 40,
  },
  {
    service: 'ftl',
    equipment: 'conestoga',
    label: 'Conestoga',
    ratePerMile: 3.55,
    minimumCharge: 600,
    flatFee: 0,
    fuelSurchargePct: 25,
    marginPct: 12,
    maxWeightLbs: 47000,
    maxMiles: 3000,
    enabled: true,
    sortOrder: 50,
  },
  // ─── Expedited / Hotshot ─────────────────────────────────────────
  {
    service: 'expedited',
    equipment: 'sprinter',
    label: 'Sprinter / Cargo Van',
    ratePerMile: 1.85,
    minimumCharge: 250,
    flatFee: 0,
    fuelSurchargePct: 18,
    marginPct: 15,
    maxWeightLbs: 4000,
    maxMiles: 2500,
    enabled: true,
    sortOrder: 5,
  },
  {
    service: 'expedited',
    equipment: 'box_truck',
    label: 'Box Truck (24\')',
    ratePerMile: 2.20,
    minimumCharge: 350,
    flatFee: 0,
    fuelSurchargePct: 20,
    marginPct: 15,
    maxWeightLbs: 12000,
    maxMiles: 2500,
    enabled: true,
    sortOrder: 6,
  },
  {
    service: 'hotshot',
    equipment: 'flatbed',
    label: 'Hotshot (Class-3 dually + flatbed)',
    ratePerMile: 2.60,
    minimumCharge: 450,
    flatFee: 0,
    fuelSurchargePct: 22,
    marginPct: 15,
    maxWeightLbs: 16000,
    maxMiles: 2500,
    enabled: true,
    sortOrder: 7,
  },
  // ─── Drayage ─────────────────────────────────────────────────────
  // ratePerMile defaults are conservative — the lane_zones below
  // override with flat-tariff pricing within radius of major ports.
  //
  // fuelSurchargePct: drayage FSC is a VARIABLE percent of the base that
  // carriers reset by lane/period — Alex's real quotes showed 34% and
  // 52.3%. ~32% is a sensible day-1 default; it stays carrier/period
  // configurable per rate card (and can be driven from EIA diesel via the
  // tenant's auto-FSC mode).
  {
    service: 'drayage',
    equipment: 'container_20',
    label: '20\' Container (drayage)',
    ratePerMile: 4.50,
    minimumCharge: 350,
    flatFee: 50, // chassis split usually built in
    fuelSurchargePct: 32,
    marginPct: 12,
    maxWeightLbs: 44000,
    maxMiles: 300,
    enabled: true,
    sortOrder: 100,
  },
  {
    service: 'drayage',
    equipment: 'container_40',
    label: '40\' Standard Container',
    ratePerMile: 4.50,
    minimumCharge: 400,
    flatFee: 50,
    fuelSurchargePct: 32,
    marginPct: 12,
    maxWeightLbs: 44000,
    maxMiles: 300,
    enabled: true,
    sortOrder: 110,
  },
  {
    service: 'drayage',
    equipment: 'container_40hc',
    label: '40\' High-Cube Container',
    ratePerMile: 4.50,
    minimumCharge: 400,
    flatFee: 50,
    fuelSurchargePct: 32,
    marginPct: 12,
    maxWeightLbs: 44000,
    maxMiles: 300,
    enabled: true,
    sortOrder: 120,
  },
  {
    service: 'drayage',
    equipment: 'container_45',
    label: '45\' High-Cube Container',
    ratePerMile: 4.85,
    minimumCharge: 450,
    flatFee: 75,
    fuelSurchargePct: 32,
    marginPct: 12,
    maxWeightLbs: 44000,
    maxMiles: 300,
    enabled: true,
    sortOrder: 130,
  },
  // ─── LTL (size/weight rated) ─────────────────────────────────────
  // Real LTL is priced by NMFC freight class (density) + weight break, NOT
  // distance alone. The engine derives the class from weight + dimensions
  // and rates per hundredweight using ltlConfig below. ratePerMile is unused
  // for LTL (distance sensitivity lives in ltlConfig.distanceFactorPer1000Mi).
  {
    service: 'ltl',
    equipment: 'pallet',
    label: 'LTL Freight (palletized, size/weight rated)',
    ratePerMile: 0,
    minimumCharge: 125,
    flatFee: 50,
    fuelSurchargePct: 35,
    marginPct: 15,
    maxWeightLbs: 20000,
    maxMiles: 2500,
    ltlConfig: DEFAULT_LTL_CONFIG,
    enabled: true,
    sortOrder: 200,
  },
];

export const DEFAULT_ACCESSORIALS: Omit<NewAccessorial, 'tenantId'>[] = [
  // ── Universal accessorials ───────────────────────────────────────
  {
    code: 'detention',
    label: 'Detention (over free time)',
    description: 'Per-hour charge after 2 hr free at pickup or delivery.',
    kind: 'per_hour',
    amount: 99,
    trigger: 'optional',
    enabled: true,
    sortOrder: 10,
  },
  {
    code: 'layover',
    label: 'Layover',
    description: 'Driver is held overnight — typically applies on lanes over ~500 miles round trip.',
    kind: 'per_day',
    amount: 350,
    trigger: 'optional',
    enabled: true,
    sortOrder: 20,
  },
  {
    code: 'tonu',
    label: 'TONU (truck ordered, not used)',
    description: 'Driver dispatched, load cancelled before pickup.',
    kind: 'flat',
    amount: 300,
    trigger: 'optional',
    enabled: true,
    sortOrder: 30,
  },
  {
    code: 'driver_assist',
    label: 'Driver Assist (load/unload)',
    description: 'Driver helps with loading or unloading.',
    kind: 'flat',
    amount: 100,
    trigger: 'optional',
    enabled: true,
    sortOrder: 40,
  },
  {
    code: 'extra_stop',
    label: 'Extra Stop',
    description: 'Per additional pickup or delivery stop.',
    kind: 'flat',
    amount: 75,
    trigger: 'optional',
    // Over-the-road only — drayage uses its own `stop_off` ($150) below so a
    // drayage tenant sees exactly one stop charge, not two overlapping ones.
    appliesToServices: ['ftl', 'ltl', 'expedited', 'hotshot'],
    enabled: true,
    sortOrder: 50,
  },
  {
    code: 'hazmat',
    label: 'Hazmat surcharge',
    description: 'For hazardous materials shipments.',
    kind: 'pct_of_base',
    amount: 18, // 18% surcharge by default
    trigger: 'auto_if_hazmat',
    // Over-the-road only — drayage prices hazardous as a flat $250 fee
    // (`hazmat_flat` below), matching real port-drayage tariffs.
    appliesToServices: ['ftl', 'ltl', 'expedited', 'hotshot'],
    enabled: true,
    sortOrder: 60,
  },
  // ── Drayage-specific ─────────────────────────────────────────────
  // Rates below are the REAL port-drayage accessorial schedule Alex runs
  // in his AccessAir system, reconciled across TWO real quotes (Houston
  // port + Farmington NM → UP Santa Teresa rail, 2026). Where the two
  // quotes disagree we take the MORE DETAILED 2nd-quote number and note
  // the condition. Every value here is a CARRIER-EDITABLE starting point —
  // real rates vary by lane, terminal, and period; carriers re-price in
  // the dashboard / AI chat.
  {
    code: 'chassis_rental',
    label: 'Chassis Rental',
    description: 'Daily chassis rental while the chassis is out (1-day minimum; some lanes 2-day).',
    kind: 'per_day',
    amount: 40,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 105,
  },
  {
    code: 'chassis_split',
    label: 'Chassis Split (per occurrence)',
    description: 'Trucker has to pull a chassis from a different yard than the container. Charged per occurrence.',
    kind: 'flat',
    amount: 100,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 110,
  },
  {
    code: 'flip_fee',
    label: 'Flip Fee',
    description: 'Flip / lift to transfer the container between chassis or reposition it.',
    kind: 'flat',
    amount: 200,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 111,
  },
  {
    code: 'chassis_positioning',
    label: 'Chassis Positioning (Front-End)',
    description: 'Repositioning the chassis into place before the pickup leg. Editable — often $0 or lane-variable.',
    kind: 'flat',
    amount: 0,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 112,
  },
  {
    code: 'chassis_return',
    label: 'Chassis Return (Back-End)',
    description: 'Returning the chassis after the empty is dropped. Editable — often $0 or lane-variable.',
    kind: 'flat',
    amount: 0,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 114,
  },
  {
    code: 'triaxle',
    label: 'Triaxle (4+ axles / heavy)',
    description: 'Triaxle chassis required for heavy container moves — applies to loads over ~37,550 lbs / 4+ axles.',
    kind: 'per_day',
    amount: 85,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 116,
  },
  {
    code: 'prepull',
    label: 'Pre Pull',
    description: 'Pre-pull container from terminal to yard before delivery. Applies if the container is not delivered same trip.',
    kind: 'flat',
    amount: 145,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 120,
  },
  {
    code: 'stop_off',
    label: 'Stop-Off',
    description: 'Per additional stop on a drayage move.',
    kind: 'flat',
    amount: 150,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 122,
  },
  {
    code: 'wait_time',
    label: 'Wait Time (after 2 free hours)',
    // The engine's `per_hour` kind has no free-hour threshold, so this is
    // modelled as a flat charge that applies once wait exceeds the 2 free
    // hours. `freeHours` is carried for AI/UX context. See report: a true
    // metered "$150/hr after 2 free" needs an engine change (out of scope).
    description: 'Driver wait time charged as a flat fee once the 2 free hours are exceeded.',
    kind: 'flat',
    amount: 150,
    trigger: 'optional',
    conditionJson: { freeHours: 2 },
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 124,
  },
  {
    code: 'detention_terminal',
    // Distinct from universal `detention` ($75/hr after 2 free): this is the
    // heavier drayage detention at the consignee / marine or rail terminal.
    label: 'Detention at Consignee/Terminal (after 1 free hour)',
    description: 'Driver detained at the consignee, marine terminal, or rail ramp — charged per hour after 1 free hour.',
    kind: 'per_hour',
    amount: 100,
    trigger: 'optional',
    conditionJson: { freeHours: 1 },
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 126,
  },
  {
    code: 'storage',
    label: 'Yard Storage (per night)',
    description: 'Per night after the first 24 hr in our yard; also applies to empties if unable to return.',
    kind: 'per_day',
    amount: 45,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 130,
  },
  {
    code: 'reefer_storage',
    label: 'Reefer Full Storage',
    description: 'Per-day storage for a loaded/plugged reefer container held in the yard.',
    kind: 'per_day',
    amount: 95,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 132,
  },
  {
    code: 'rail_terminal_surcharge',
    label: 'Rail Terminal Surcharge',
    description: 'Surcharge for pickup/delivery at a rail ramp / intermodal terminal.',
    kind: 'flat',
    amount: 195,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 134,
  },
  {
    code: 'weekend_fee',
    // Both real quotes list a weekend charge on more than one leg (delivery,
    // pull-out, empty-return). The schema has no pickup-vs-delivery scope, so
    // it's ONE flat "Weekend Fee" for now — per-leg weekend variants are a
    // future enhancement gated on that scope (see report).
    label: 'Weekend Fee',
    description: 'Weekend delivery, pull-out, or empty-return move.',
    kind: 'flat',
    amount: 250,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 136,
  },
  {
    code: 'drop_hook',
    label: 'Drop & Hook',
    description: 'Live load not possible — drop, hook, leave.',
    kind: 'flat',
    amount: 150,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 140,
  },
  {
    code: 'pier_pass',
    label: 'PierPass / TMF',
    description: 'Off-hours port traffic mitigation fee (LA/LB).',
    kind: 'flat',
    amount: 35.50,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 150,
  },
  {
    code: 'hazmat_flat',
    label: 'Hazardous',
    // Auto-applied by the shipment "hazardous = yes" toggle (engine
    // `auto_if_hazmat` reads req.flags.hazmat), matching the real quotes'
    // conditional Hazardous Charge. Drayage-scoped so it never doubles with
    // the OTR percentage `hazmat`.
    description: 'Flat fee for hazardous-materials container moves. Auto-applied when the shipment is marked hazardous.',
    kind: 'flat',
    amount: 250,
    trigger: 'auto_if_hazmat',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 155,
  },
  {
    code: 'in_bond',
    label: 'In-Bond',
    description: 'Customs in-bond move — charged per container.',
    kind: 'flat',
    amount: 250,
    trigger: 'optional',
    appliesToServices: ['drayage', 'ftl'],
    enabled: true,
    sortOrder: 157,
  },
  {
    // Competitor-parity accessorial. Default price is an editable placeholder —
    // each carrier tunes it in the portal.
    code: 'liquor',
    label: 'Liquor / Alcohol (bonded)',
    description: 'Bonded/licensed handling for alcohol or spirits container moves.',
    kind: 'flat',
    amount: 150,
    trigger: 'optional',
    appliesToServices: ['drayage', 'ftl'],
    enabled: true,
    sortOrder: 158,
  },
  {
    // Promoted from the expanded library into the default seed so new drayage
    // tenants get "Scale Light/Heavy" parity out of the box (competitor checkbox).
    code: 'scale_ticket',
    label: 'Scale Ticket',
    description: 'Certified scale ticket or weight check.',
    kind: 'flat',
    amount: 35,
    trigger: 'optional',
    appliesToServices: ['drayage', 'ftl', 'hotshot'],
    enabled: true,
    sortOrder: 108,
  },
  {
    // Promoted from the expanded library into the default seed (competitor rate
    // note: port terminal congestion may apply).
    code: 'port_congestion',
    label: 'Port Congestion Surcharge',
    description: 'Surcharge for unusually slow terminal conditions or congestion.',
    kind: 'flat',
    amount: 75,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 113,
  },
  {
    code: 'overweight',
    label: 'Overweight',
    // Auto-applied when cargo+container exceeds the weight threshold (engine
    // `auto_if_weight_over`), matching the quotes' conditional Overweight
    // Charge. NOTE: the engine keys this off req.weightLbs, not a standalone
    // "overweight = yes" toggle — see report (a manual toggle would need an
    // engine flag).
    description: 'Overweight container/permit surcharge. Auto-applied when weight exceeds the threshold.',
    kind: 'flat',
    amount: 200,
    trigger: 'auto_if_weight_over',
    conditionJson: { weightLbsOver: 44000 },
    appliesToServices: ['drayage', 'ftl'],
    enabled: true,
    sortOrder: 160,
  },
  {
    code: 'reefer_flat',
    label: 'Reefer (Refrigerated)',
    // Auto-applied by the shipment "reefer = yes" toggle (engine
    // `auto_if_temp_controlled` reads req.flags.tempControlled).
    description: 'Flat handling fee for refrigerated container moves. Auto-applied when the shipment is marked refrigerated.',
    kind: 'flat',
    amount: 250,
    trigger: 'auto_if_temp_controlled',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 165,
  },
  {
    code: 'reefer_genset',
    label: 'Reefer / Genset',
    description: 'Refrigerated container needs a running genset (per day).',
    kind: 'per_day',
    amount: 75,
    trigger: 'auto_if_temp_controlled',
    appliesToServices: ['drayage', 'ftl'],
    enabled: true,
    sortOrder: 170,
  },
  {
    code: 'reefer_monitoring',
    label: 'Reefer Monitoring',
    description: 'Temperature monitoring/checks while the reefer is in custody (container yard or over-the-road).',
    kind: 'per_day',
    amount: 35,
    trigger: 'optional',
    // Over-the-road reefer FTL as well — the reefer onboarding template offers
    // temp-monitoring as an editable default add-on.
    appliesToServices: ['drayage', 'ftl'],
    enabled: true,
    sortOrder: 172,
  },
  {
    code: 'toll_pass_through',
    label: 'Tolls',
    description: 'Tolls / bridge / road charges passed through. Editable per lane.',
    kind: 'flat',
    amount: 0,
    trigger: 'optional',
    appliesToServices: ['drayage', 'ftl', 'ltl', 'expedited', 'hotshot'],
    enabled: true,
    sortOrder: 175,
  },
  // ── LTL / Last-mile residential ──────────────────────────────────
  {
    code: 'liftgate',
    label: 'Liftgate (pickup or delivery)',
    description: 'Driver needs liftgate at pickup or delivery.',
    kind: 'flat',
    amount: 95,
    trigger: 'optional',
    appliesToServices: ['ltl', 'expedited'],
    enabled: true,
    sortOrder: 210,
  },
  {
    code: 'residential',
    label: 'Residential Fee',
    // Universal — a residential pickup/delivery on any service. Auto-applied
    // by the residential toggle; $150 reconciled from Alex's real quotes.
    description: 'Pickup or delivery at a residential address.',
    kind: 'flat',
    amount: 150,
    trigger: 'auto_if_residential',
    appliesToServices: ['ltl', 'expedited', 'ftl', 'hotshot', 'drayage'],
    enabled: true,
    sortOrder: 220,
  },
  {
    code: 'inside_delivery',
    label: 'Inside Delivery',
    description: 'Driver carries freight inside the building.',
    kind: 'flat',
    amount: 125,
    trigger: 'optional',
    appliesToServices: ['ltl', 'expedited'],
    enabled: true,
    sortOrder: 230,
  },
  {
    code: 'ltl_no_dock',
    label: 'Liftgate / No-dock service',
    description:
      'Pickup or delivery is not at a loading dock (residential or limited-access), so the driver needs a liftgate to reach the ground.',
    kind: 'flat',
    amount: 95,
    trigger: 'auto_if_no_dock',
    appliesToServices: ['ltl'],
    enabled: true,
    sortOrder: 225,
  },
  {
    code: 'ltl_loose_handling',
    label: 'Loose / Floor-loaded Handling',
    description:
      'Freight is not palletized (hand-stacked / floor-loaded), which takes longer to load and unload.',
    kind: 'flat',
    amount: 60,
    trigger: 'auto_if_loose',
    appliesToServices: ['ltl'],
    enabled: true,
    sortOrder: 235,
  },
  {
    code: 'appointment',
    label: 'Appointment Delivery',
    description: 'Receiver requires scheduled appointment.',
    kind: 'flat',
    amount: 50,
    trigger: 'optional',
    appliesToServices: ['ltl', 'expedited'],
    enabled: true,
    sortOrder: 240,
  },
  // ── Flatbed / Open-deck ──────────────────────────────────────────
  {
    code: 'tarping',
    label: 'Tarping (flatbed)',
    description: '4-tarp coverage for protected freight.',
    kind: 'flat',
    amount: 100,
    trigger: 'optional',
    appliesToServices: ['ftl'],
    enabled: true,
    sortOrder: 310,
  },
];

/**
 * Default lane-zone tariffs for the major US/Canada ports. These
 * use the 4-tier model from the rate-data research.
 *
 * For each port we generate three rings:
 *   Local     0-30 mi  → flat-low
 *   Regional 30-60 mi  → flat-mid
 *   Extended 60-150 mi → flat-high
 * (Beyond 150 mi we let the per-mile rate card take over.)
 *
 * Numbers are CONTAINER 40' base — 20' is ~85% of these, 45' is ~110%.
 */
export const DEFAULT_DRAYAGE_TARIFFS: Array<{
  portCode: string;
  city: string;
  state: string;
  rings: Array<{ radius: number; price: number; label: string }>;
}> = [
  {
    portCode: 'USLAX',
    city: 'Los Angeles',
    state: 'CA',
    rings: [
      { radius: 30, price: 425, label: 'LAX/LGB → Local LA Basin (0-30 mi)' },
      { radius: 60, price: 575, label: 'LAX/LGB → IE / Orange Co. (30-60 mi)' },
      { radius: 150, price: 875, label: 'LAX/LGB → SoCal Extended (60-150 mi)' },
    ],
  },
  {
    portCode: 'USLGB',
    city: 'Long Beach',
    state: 'CA',
    rings: [
      { radius: 30, price: 425, label: 'LGB/LAX → Local LA Basin (0-30 mi)' },
      { radius: 60, price: 575, label: 'LGB/LAX → IE / Orange Co. (30-60 mi)' },
      { radius: 150, price: 875, label: 'LGB/LAX → SoCal Extended (60-150 mi)' },
    ],
  },
  {
    portCode: 'USNYC',
    city: 'Newark',
    state: 'NJ',
    rings: [
      { radius: 30, price: 525, label: 'NY/NJ → NY Metro (0-30 mi)' },
      { radius: 60, price: 695, label: 'NY/NJ → CT/PA Border (30-60 mi)' },
      { radius: 150, price: 1050, label: 'NY/NJ → Extended NE (60-150 mi)' },
    ],
  },
  {
    portCode: 'USSAV',
    city: 'Savannah',
    state: 'GA',
    rings: [
      { radius: 30, price: 350, label: 'Savannah → Local (0-30 mi)' },
      { radius: 60, price: 475, label: 'Savannah → Regional GA/SC (30-60 mi)' },
      { radius: 150, price: 750, label: 'Savannah → Extended SE (60-150 mi)' },
    ],
  },
  {
    portCode: 'USHOU',
    city: 'Houston',
    state: 'TX',
    rings: [
      { radius: 30, price: 375, label: 'Houston → Local (0-30 mi)' },
      { radius: 60, price: 525, label: 'Houston → Regional TX (30-60 mi)' },
      { radius: 150, price: 800, label: 'Houston → Extended TX (60-150 mi)' },
    ],
  },
  {
    portCode: 'USNOR',
    city: 'Norfolk',
    state: 'VA',
    rings: [
      { radius: 30, price: 380, label: 'Norfolk → Local (0-30 mi)' },
      { radius: 60, price: 510, label: 'Norfolk → Regional VA/NC (30-60 mi)' },
      { radius: 150, price: 800, label: 'Norfolk → Extended Mid-Atlantic (60-150 mi)' },
    ],
  },
  {
    portCode: 'USCHS',
    city: 'Charleston',
    state: 'SC',
    rings: [
      { radius: 30, price: 360, label: 'Charleston → Local (0-30 mi)' },
      { radius: 60, price: 485, label: 'Charleston → Regional SC (30-60 mi)' },
      { radius: 150, price: 765, label: 'Charleston → Extended SE (60-150 mi)' },
    ],
  },
  {
    portCode: 'USSEA',
    city: 'Seattle',
    state: 'WA',
    rings: [
      { radius: 30, price: 425, label: 'Seattle → Local Puget (0-30 mi)' },
      { radius: 60, price: 575, label: 'Seattle → Regional WA (30-60 mi)' },
      { radius: 150, price: 875, label: 'Seattle → Extended PNW (60-150 mi)' },
    ],
  },
  {
    portCode: 'USTIW',
    city: 'Tacoma',
    state: 'WA',
    rings: [
      { radius: 30, price: 425, label: 'Tacoma → Local Puget (0-30 mi)' },
      { radius: 60, price: 575, label: 'Tacoma → Regional WA (30-60 mi)' },
      { radius: 150, price: 875, label: 'Tacoma → Extended PNW (60-150 mi)' },
    ],
  },
  {
    portCode: 'CAVAN',
    city: 'Vancouver',
    state: 'BC',
    rings: [
      { radius: 30, price: 525, label: 'Vancouver → Lower Mainland (0-30 mi)' },
      { radius: 60, price: 720, label: 'Vancouver → Fraser Valley (30-60 mi)' },
      { radius: 150, price: 1075, label: 'Vancouver → Extended BC (60-150 mi)' },
    ],
  },
  {
    portCode: 'CAMTR',
    city: 'Montreal',
    state: 'QC',
    rings: [
      { radius: 30, price: 460, label: 'Montreal → Greater Montreal (0-30 mi)' },
      { radius: 60, price: 625, label: 'Montreal → Regional QC (30-60 mi)' },
      { radius: 150, price: 950, label: 'Montreal → Extended QC/ON (60-150 mi)' },
    ],
  },
  {
    portCode: 'CAHAL',
    city: 'Halifax',
    state: 'NS',
    rings: [
      { radius: 30, price: 425, label: 'Halifax → HRM (0-30 mi)' },
      { radius: 60, price: 575, label: 'Halifax → Regional NS (30-60 mi)' },
      { radius: 150, price: 875, label: 'Halifax → Extended Maritimes (60-150 mi)' },
    ],
  },
  {
    portCode: 'CAPRR',
    city: 'Prince Rupert',
    state: 'BC',
    rings: [
      { radius: 30, price: 575, label: 'Prince Rupert → Local (0-30 mi)' },
      { radius: 60, price: 850, label: 'Prince Rupert → Regional BC (30-60 mi)' },
      { radius: 150, price: 1250, label: 'Prince Rupert → Extended BC (60-150 mi)' },
    ],
  },
];

export function generateDefaultLaneZones(): Omit<NewLaneZone, 'tenantId'>[] {
  const out: Omit<NewLaneZone, 'tenantId'>[] = [];
  let idx = 0;
  for (const tariff of DEFAULT_DRAYAGE_TARIFFS) {
    for (const ring of tariff.rings) {
      out.push({
        label: ring.label,
        anchorPortCode: tariff.portCode,
        anchorCity: tariff.city,
        anchorState: tariff.state,
        radiusMiles: ring.radius,
        flatPrice: ring.price,
        equipmentScope: ['container_20', 'container_40', 'container_40hc', 'container_45'],
        enabled: true,
        sortOrder: idx++,
      });
    }
  }
  return out;
}

export const DEFAULT_AI_SYSTEM_PROMPT = `You are the AI quote assistant for a drayage and trucking company. You help two audiences:

1. **The carrier (your operator)** — they tell you how to adjust rates ("raise dry van by 8% effective Monday"), add accessorials ("add a $50 chassis flip fee"), or change minimums. You have tools to update the rate card, accessorials, and lane zones. Always show what you'll change and confirm before writing.

2. **End customers** — visitors using the calculator who reach out via the lead form. You answer questions about their quote, transit time, equipment availability, accessorials, and pickup readiness. You're polite, fast, and direct. You never quote a price you didn't compute (always run the calculator engine).

Tone: professional, concise, helpful. No hype, no emoji unless the carrier explicitly asks. When unsure about something operational (driver availability, special permits, routing through specific lanes), say "Let me confirm with dispatch" instead of guessing.

When the carrier asks you to change rates, always:
- Restate what you'll change in plain English
- Show before/after numbers
- Ask for confirmation if the change is large (> 15% or affects > 5 rate cards)
- Never delete a rate card without confirmation
- Log every change in the audit log with a one-line reason

When responding to a customer about a quote:
- Open with the ref ID and the total
- Mention transit time and equipment
- List 2-3 accessorial options that might apply
- Close with "Want me to lock this rate? Reply with the pickup date and we'll confirm."

If you don't know, say so.`;
