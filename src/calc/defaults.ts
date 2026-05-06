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
  {
    service: 'drayage',
    equipment: 'container_20',
    label: '20\' Container (drayage)',
    ratePerMile: 4.50,
    minimumCharge: 350,
    flatFee: 50, // chassis split usually built in
    fuelSurchargePct: 18,
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
    fuelSurchargePct: 18,
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
    fuelSurchargePct: 18,
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
    fuelSurchargePct: 18,
    marginPct: 12,
    maxWeightLbs: 44000,
    maxMiles: 300,
    enabled: true,
    sortOrder: 130,
  },
  // ─── LTL (LIGHT) ─────────────────────────────────────────────────
  // Rough approximation — real LTL is class+lane-based. The widget
  // surfaces this as "approximate" and asks for shipper details.
  {
    service: 'ltl',
    equipment: 'pallet',
    label: 'LTL Pallet (4-foot pallet, ≤2000 lbs)',
    ratePerMile: 0.85,
    minimumCharge: 125,
    flatFee: 50,
    fuelSurchargePct: 35,
    marginPct: 15,
    maxWeightLbs: 2000,
    maxMiles: 2500,
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
    amount: 75,
    trigger: 'optional',
    enabled: true,
    sortOrder: 10,
  },
  {
    code: 'layover',
    label: 'Layover',
    description: 'Driver is held overnight — typically $250-$400.',
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
    enabled: true,
    sortOrder: 60,
  },
  // ── Drayage-specific ─────────────────────────────────────────────
  {
    code: 'chassis_split',
    label: 'Chassis Split / Pickup',
    description: 'Trucker has to pull a chassis from a different yard.',
    kind: 'flat',
    amount: 175,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 110,
  },
  {
    code: 'prepull',
    label: 'Prepull',
    description: 'Pre-pull container from terminal to yard before delivery.',
    kind: 'flat',
    amount: 175,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 120,
  },
  {
    code: 'storage',
    label: 'Yard Storage',
    description: 'Per day after first 24 hr in our yard.',
    kind: 'per_day',
    amount: 65,
    trigger: 'optional',
    appliesToServices: ['drayage'],
    enabled: true,
    sortOrder: 130,
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
    code: 'overweight',
    label: 'Overweight Permit',
    description: 'Cargo + container > 44,000 lbs requires special permit.',
    kind: 'flat',
    amount: 175,
    trigger: 'auto_if_weight_over',
    conditionJson: { weightLbsOver: 44000 },
    appliesToServices: ['drayage', 'ftl'],
    enabled: true,
    sortOrder: 160,
  },
  {
    code: 'reefer_genset',
    label: 'Reefer / Genset',
    description: 'Refrigerated container needs running genset.',
    kind: 'per_day',
    amount: 75,
    trigger: 'auto_if_temp_controlled',
    appliesToServices: ['drayage', 'ftl'],
    enabled: true,
    sortOrder: 170,
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
    label: 'Residential Delivery',
    description: 'Delivery to a residential address.',
    kind: 'flat',
    amount: 85,
    trigger: 'auto_if_residential',
    appliesToServices: ['ltl', 'expedited'],
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
