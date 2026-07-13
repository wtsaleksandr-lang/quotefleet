/**
 * Freight-vertical SEED TEMPLATES for the post-signup onboarding wizard.
 *
 * Every template is a pure SELECTION / FILTER over the existing seed data in
 * `defaults.ts` — it invents no new rate/accessorial/zone numbers. The wizard
 * lets a new trucker pick the ONE vertical they actually run, and the
 * apply-endpoint reseeds their tenant with just that vertical's subset instead
 * of the everything-included default deck (13 rate cards, 35 accessorials, 39
 * port zones) that every tenant gets at signup.
 *
 * NOTE (Phase 2 — awaits Alex's freight sign-off): the exact per-vertical
 * numbers and which accessorials default-ON are still the raw signup-seed
 * values. The MAPPING (which cards / accessorials / zones belong to each
 * vertical) is what's encoded here; the tuned per-vertical pricing comes later.
 */
import type { NewRateCard, NewAccessorial, NewLaneZone } from '../db/schema.js';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
} from './defaults.js';

/** The six freight verticals the wizard offers. */
export type FreightVertical =
  | 'drayage'
  | 'dryvan_ftl'
  | 'reefer'
  | 'ltl'
  | 'hotshot'
  | 'flatbed';

export const FREIGHT_VERTICALS: FreightVertical[] = [
  'drayage',
  'dryvan_ftl',
  'reefer',
  'ltl',
  'hotshot',
  'flatbed',
];

/**
 * How the tenant prices the vertical. Phase 1 STORES this (drives template
 * selection, the onboarding record, and AI context) — it does NOT change the
 * calc engine yet.
 */
export type PricingMode = 'per_mile' | 'flat' | 'min_mileage' | 'zone';

export const PRICING_MODES: PricingMode[] = ['per_mile', 'flat', 'min_mileage', 'zone'];

/** A rate-card selector key — matches a default by service + equipment. */
interface RateKey {
  service: string;
  equipment: string;
}

/** Declarative spec for one vertical: which default rows it selects. */
interface VerticalSpec {
  vertical: FreightVertical;
  /** Customer-facing card label in the wizard. */
  label: string;
  /** One-line description under the label. */
  blurb: string;
  /** Rate cards to keep, by service+equipment. */
  rateCardKeys: RateKey[];
  /** Accessorials to keep, by `code`. */
  accessorialCodes: string[];
  /** Whether to keep all default drayage port zones (drayage only). */
  includeAllZones: boolean;
  /** Default pricing mode for this vertical (user can override in step 2). */
  pricingMode: PricingMode;
}

/**
 * The mapping. Every card key / accessorial code below exists in defaults.ts.
 * (See defaults.ts — DEFAULT_RATE_CARDS / DEFAULT_ACCESSORIALS.)
 */
const VERTICAL_SPECS: Record<FreightVertical, VerticalSpec> = {
  drayage: {
    vertical: 'drayage',
    label: 'Drayage / Port containers',
    blurb: 'Pull containers from the port or rail ramp on a zone tariff.',
    rateCardKeys: [
      { service: 'drayage', equipment: 'container_20' },
      { service: 'drayage', equipment: 'container_40' },
      { service: 'drayage', equipment: 'container_40hc' },
      { service: 'drayage', equipment: 'container_45' },
    ],
    // Real port-drayage accessorial set (Alex's AccessAir schedule,
    // reconciled across two live quotes). Shared/universal codes + the
    // drayage-specific real ones from DEFAULT_ACCESSORIALS.
    accessorialCodes: [
      // shared / universal
      'detention', 'detention_terminal', 'layover', 'tonu', 'driver_assist',
      'residential', 'drop_hook', 'pier_pass', 'toll_pass_through',
      // chassis
      'chassis_rental', 'chassis_split', 'chassis_positioning',
      'chassis_return', 'flip_fee', 'triaxle',
      // moves / storage
      'prepull', 'stop_off', 'wait_time', 'storage', 'reefer_storage',
      // conditional / fees
      'hazmat_flat', 'in_bond', 'overweight', 'reefer_flat', 'reefer_genset',
      'rail_terminal_surcharge', 'weekend_fee',
    ],
    includeAllZones: true,
    pricingMode: 'zone',
  },
  dryvan_ftl: {
    vertical: 'dryvan_ftl',
    label: 'Dry-Van FTL',
    blurb: 'Full truckloads in a 53′ dry van, priced by the mile.',
    rateCardKeys: [{ service: 'ftl', equipment: 'dryvan' }],
    // universal minus driver_assist (detention/layover/TONU/extra-stop/hazmat)
    accessorialCodes: ['detention', 'layover', 'tonu', 'extra_stop', 'hazmat'],
    includeAllZones: false,
    pricingMode: 'per_mile',
  },
  reefer: {
    vertical: 'reefer',
    label: 'Reefer / Temp-controlled',
    blurb: 'Refrigerated truckloads with genset, priced by the mile.',
    rateCardKeys: [{ service: 'ftl', equipment: 'reefer' }],
    // universal (6) + reefer genset
    accessorialCodes: [
      'detention', 'layover', 'tonu', 'driver_assist', 'extra_stop', 'hazmat',
      'reefer_genset',
    ],
    includeAllZones: false,
    pricingMode: 'per_mile',
  },
  ltl: {
    vertical: 'ltl',
    label: 'LTL / Partial',
    blurb: 'Less-than-truckload, class-rated with a minimum plus mileage.',
    rateCardKeys: [{ service: 'ltl', equipment: 'pallet' }],
    // LTL / last-mile residential set
    accessorialCodes: [
      'liftgate', 'residential', 'inside_delivery', 'appointment',
      'ltl_no_dock', 'ltl_loose_handling',
    ],
    includeAllZones: false,
    pricingMode: 'min_mileage',
  },
  hotshot: {
    vertical: 'hotshot',
    label: 'Hotshot / Expedited',
    blurb: 'Hotshot dually plus sprinter / box truck, priced by the mile.',
    rateCardKeys: [
      { service: 'hotshot', equipment: 'flatbed' },
      { service: 'expedited', equipment: 'sprinter' },
      { service: 'expedited', equipment: 'box_truck' },
    ],
    // universal (6) + liftgate
    accessorialCodes: [
      'detention', 'layover', 'tonu', 'driver_assist', 'extra_stop', 'hazmat',
      'liftgate',
    ],
    includeAllZones: false,
    pricingMode: 'per_mile',
  },
  flatbed: {
    vertical: 'flatbed',
    label: 'Flatbed / Open-deck',
    blurb: 'Flatbed, step-deck and Conestoga loads, priced by the mile.',
    rateCardKeys: [
      { service: 'ftl', equipment: 'flatbed' },
      { service: 'ftl', equipment: 'step_deck' },
      { service: 'ftl', equipment: 'conestoga' },
    ],
    // universal (6) + tarping + overweight
    accessorialCodes: [
      'detention', 'layover', 'tonu', 'driver_assist', 'extra_stop', 'hazmat',
      'tarping', 'overweight',
    ],
    includeAllZones: false,
    pricingMode: 'per_mile',
  },
};

/** The fully-resolved seed subset for one vertical (Omit tenantId — the caller
 *  stamps it, exactly like the signup path does). */
export interface SeedTemplate {
  vertical: FreightVertical;
  label: string;
  blurb: string;
  pricingMode: PricingMode;
  rateCards: Omit<NewRateCard, 'tenantId'>[];
  accessorials: Omit<NewAccessorial, 'tenantId'>[];
  laneZones: Omit<NewLaneZone, 'tenantId'>[];
}

/** Light shape for the wizard's vertical picker (no heavy row payloads). */
export interface VerticalOption {
  vertical: FreightVertical;
  label: string;
  blurb: string;
  pricingMode: PricingMode;
}

export function listVerticalOptions(): VerticalOption[] {
  return FREIGHT_VERTICALS.map((v) => {
    const s = VERTICAL_SPECS[v];
    return { vertical: v, label: s.label, blurb: s.blurb, pricingMode: s.pricingMode };
  });
}

export function isFreightVertical(v: unknown): v is FreightVertical {
  return typeof v === 'string' && (FREIGHT_VERTICALS as string[]).includes(v);
}

export function isPricingMode(v: unknown): v is PricingMode {
  return typeof v === 'string' && (PRICING_MODES as string[]).includes(v);
}

/**
 * Build the seed subset for a vertical by SELECTING over the default arrays.
 * Rate cards are matched by service+equipment, accessorials by code, and lane
 * zones are all-or-none. Numbers are copied verbatim from defaults.ts.
 */
export function getSeedTemplate(vertical: FreightVertical): SeedTemplate {
  const spec = VERTICAL_SPECS[vertical];

  const wantKey = new Set(spec.rateCardKeys.map((k) => `${k.service}::${k.equipment}`));
  const rateCards = DEFAULT_RATE_CARDS.filter((c) =>
    wantKey.has(`${c.service}::${c.equipment}`)
  ).map((c) => ({ ...c }));

  const wantCodes = new Set(spec.accessorialCodes);
  const accessorials = DEFAULT_ACCESSORIALS.filter((a) => wantCodes.has(a.code)).map((a) => ({
    ...a,
  }));

  const laneZones = spec.includeAllZones
    ? generateDefaultLaneZones().map((z) => ({ ...z }))
    : [];

  return {
    vertical,
    label: spec.label,
    blurb: spec.blurb,
    pricingMode: spec.pricingMode,
    rateCards,
    accessorials,
    laneZones,
  };
}

// ── first-run "seed pristine" guard ────────────────────────────────────────
// The apply-endpoint is only allowed to DELETE + reseed a tenant's rate rows
// when those rows are still exactly the out-of-the-box signup seed. If the
// trucker already edited anything, we must NOT clobber their work — we only
// stamp pricing/lane/brand + completedAt. These pure helpers make that
// detection testable without a database.

/** The default seed counts, computed from defaults.ts (single source). */
export const DEFAULT_SEED_COUNTS = {
  rateCards: DEFAULT_RATE_CARDS.length,
  accessorials: DEFAULT_ACCESSORIALS.length,
  laneZones: generateDefaultLaneZones().length,
} as const;

/** Signature of a rate card that changes if the user edits pricing. */
function rateSig(c: { service: string; equipment: string; ratePerMile: number; minimumCharge: number; flatFee: number }): string {
  return `${c.service}|${c.equipment}|${c.ratePerMile}|${c.minimumCharge}|${c.flatFee}`;
}
function accSig(a: { code: string; amount: number; enabled: boolean }): string {
  return `${a.code}|${a.amount}|${a.enabled}`;
}
function zoneSig(z: { anchorPortCode: string | null | undefined; flatPrice: number }): string {
  return `${z.anchorPortCode ?? ''}|${z.flatPrice}`;
}

/** Multiset equality of two signature lists. */
function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const s of a) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const s of b) {
    const n = counts.get(s);
    if (!n) return false;
    counts.set(s, n - 1);
  }
  return true;
}

export interface ExistingSeedRows {
  rateCards: Array<{ service: string; equipment: string; ratePerMile: number; minimumCharge: number; flatFee: number }>;
  accessorials: Array<{ code: string; amount: number; enabled: boolean }>;
  laneZones: Array<{ anchorPortCode: string | null; flatPrice: number }>;
}

/**
 * True when the tenant's rows are STILL the untouched signup seed: counts match
 * the default deck AND every row's pricing signature matches a default row. Any
 * edit (rate change, disabled accessorial, deleted card, extra card) makes this
 * false, so a customized tenant is never reseeded.
 */
export function isSeedPristine(existing: ExistingSeedRows): boolean {
  if (existing.rateCards.length !== DEFAULT_SEED_COUNTS.rateCards) return false;
  if (existing.accessorials.length !== DEFAULT_SEED_COUNTS.accessorials) return false;
  if (existing.laneZones.length !== DEFAULT_SEED_COUNTS.laneZones) return false;

  if (
    !sameMultiset(
      existing.rateCards.map(rateSig),
      DEFAULT_RATE_CARDS.map((c) => rateSig({
        service: c.service,
        equipment: c.equipment,
        ratePerMile: c.ratePerMile ?? 0,
        minimumCharge: c.minimumCharge ?? 0,
        flatFee: c.flatFee ?? 0,
      }))
    )
  ) {
    return false;
  }
  if (
    !sameMultiset(
      existing.accessorials.map(accSig),
      DEFAULT_ACCESSORIALS.map((a) => accSig({
        code: a.code,
        amount: a.amount ?? 0,
        enabled: a.enabled ?? true,
      }))
    )
  ) {
    return false;
  }
  if (
    !sameMultiset(
      existing.laneZones.map(zoneSig),
      generateDefaultLaneZones().map((z) => zoneSig({
        anchorPortCode: z.anchorPortCode ?? null,
        flatPrice: z.flatPrice ?? 0,
      }))
    )
  ) {
    return false;
  }
  return true;
}
