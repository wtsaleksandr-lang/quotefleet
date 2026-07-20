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
 * Per-vertical defaults: drayage carries the real AccessAir schedule (#110);
 * dry-van, reefer, LTL, hotshot, and flatbed each carry a sensible
 * industry-standard default rate card + accessorial selection. Every number is
 * a CARRIER-EDITABLE starting point — carriers re-price in the dashboard / AI
 * chat. Accessorials are SELECTED (by `code`) from the shared catalog
 * (DEFAULT_ACCESSORIALS + EXPANDED_ACCESSORIAL_LIBRARY); no per-vertical
 * numbers are invented here.
 */
import type { NewRateCard, NewAccessorial, NewLaneZone } from '../db/schema.js';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
} from './defaults.js';
import { EXPANDED_ACCESSORIAL_LIBRARY } from './accessorialLibrary.js';

/**
 * The full accessorial catalog a template may select from: the signup-seed
 * defaults PLUS the expanded add-on library. Deduped by `code` (DEFAULT wins),
 * exactly like the accessorials:seed script — every tenant is seeded with both,
 * so a vertical template can default-select from either.
 */
export const CATALOG_ACCESSORIALS: Omit<NewAccessorial, 'tenantId'>[] = (() => {
  const byCode = new Map<string, Omit<NewAccessorial, 'tenantId'>>();
  for (const a of [...DEFAULT_ACCESSORIALS, ...EXPANDED_ACCESSORIAL_LIBRARY]) {
    if (!byCode.has(a.code)) byCode.set(a.code, a);
  }
  return [...byCode.values()];
})();

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
    // Sensible dry-van FTL default set — every accessorial is a CARRIER-EDITABLE
    // industry-standard starting point (same convention as the drayage schedule
    // in defaults.ts). Universal detention/layover/TONU + extra-stop, driver
    // assist, lumper, hazmat, redelivery, and reweigh (scale ticket).
    accessorialCodes: [
      'detention', 'layover', 'tonu', 'extra_stop', 'driver_assist',
      'lumper', 'hazmat', 'redelivery', 'scale_ticket',
    ],
    includeAllZones: false,
    pricingMode: 'per_mile',
  },
  reefer: {
    vertical: 'reefer',
    label: 'Reefer / Temp-controlled',
    blurb: 'Refrigerated truckloads with genset, priced by the mile.',
    rateCardKeys: [{ service: 'ftl', equipment: 'reefer' }],
    // Reefer default set (carrier-editable industry defaults): the core OTR set
    // PLUS reefer-specific handling — genset, pre-cool, washout, and temp
    // monitoring. Reefer/genset auto-applies on the temp-controlled toggle.
    accessorialCodes: [
      'detention', 'layover', 'tonu', 'extra_stop', 'driver_assist',
      'reefer_genset', 'reefer_precool', 'reefer_washout', 'reefer_monitoring',
    ],
    includeAllZones: false,
    pricingMode: 'per_mile',
  },
  ltl: {
    vertical: 'ltl',
    label: 'LTL / Partial',
    blurb: 'Less-than-truckload, class-rated with a minimum plus mileage.',
    rateCardKeys: [{ service: 'ltl', equipment: 'pallet' }],
    // LTL / last-mile default set (carrier-editable industry defaults): liftgate,
    // residential, inside delivery, appointment, limited access, delivery
    // notification, sort & segregate, no-dock liftgate, reweigh/reclass, overlength.
    accessorialCodes: [
      'liftgate', 'residential', 'inside_delivery', 'appointment',
      'limited_access', 'delivery_notification', 'sort_and_segregate',
      'ltl_no_dock', 'reweigh_reclass', 'overlength',
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
    // Hotshot / expedited default set (carrier-editable industry defaults):
    // expedite/rush premium, after-hours/weekend, pickup & delivery waiting time,
    // liftgate, extra stop, detention, TONU.
    accessorialCodes: [
      'detention', 'tonu', 'extra_stop', 'liftgate', 'weekend_after_hours',
      'driver_wait_pickup', 'driver_wait_delivery', 'expedite_fee',
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
    // Flatbed / open-deck default set (carrier-editable industry defaults):
    // tarping, overweight, oversize permit, pilot car/escort, extra straps &
    // chains, coil rack, plus universal detention/layover/TONU/driver-assist.
    accessorialCodes: [
      'detention', 'layover', 'tonu', 'driver_assist', 'tarping',
      'overweight', 'oversize_permit', 'pilot_car', 'extra_straps_chains',
      'coil_rack',
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
  const accessorials = CATALOG_ACCESSORIALS.filter((a) => wantCodes.has(a.code)).map((a) => ({
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

/**
 * Build ONE seed set from several verticals.
 *
 * Carriers routinely run more than one mode — dry van + reefer + flatbed is an
 * ordinary combination, not an edge case. Seeding only the "main" vertical left
 * such a tenant with a calculator that couldn't quote most of their business,
 * so their customers silently bounced off the modes we never seeded.
 *
 * Union semantics, first-selected wins on a collision:
 *  - rate cards   deduped by service::equipment
 *  - accessorials deduped by code
 *  - lane zones   deduped by label (they're generated, so identical across
 *                 verticals that include them; take one copy)
 *
 * `pricingMode` follows the FIRST selected vertical — that's the tenant's
 * primary book of business and the wizard lets them override it anyway.
 */
export function mergeSeedTemplates(verticals: FreightVertical[]): SeedTemplate {
  const picked = verticals.filter((v, i) => verticals.indexOf(v) === i);
  if (picked.length === 0) throw new Error('mergeSeedTemplates requires at least one vertical');
  if (picked.length === 1) return getSeedTemplate(picked[0]!);

  const parts = picked.map((v) => getSeedTemplate(v));
  const primary = parts[0]!;

  const rcSeen = new Set<string>();
  const rateCards: SeedTemplate['rateCards'] = [];
  const accSeen = new Set<string>();
  const accessorials: SeedTemplate['accessorials'] = [];
  const zoneSeen = new Set<string>();
  const laneZones: SeedTemplate['laneZones'] = [];

  for (const p of parts) {
    for (const c of p.rateCards) {
      const k = `${c.service}::${c.equipment}`;
      if (rcSeen.has(k)) continue;
      rcSeen.add(k);
      rateCards.push({ ...c });
    }
    for (const a of p.accessorials) {
      if (accSeen.has(a.code)) continue;
      accSeen.add(a.code);
      accessorials.push({ ...a });
    }
    for (const z of p.laneZones) {
      const k = String(z.label ?? '');
      if (zoneSeen.has(k)) continue;
      zoneSeen.add(k);
      laneZones.push({ ...z });
    }
  }

  // Keep sortOrder stable and contiguous across the merged set so the
  // dashboard and the wizard's "top 3 rates" show a sensible order.
  rateCards.forEach((c, i) => { c.sortOrder = i; });

  return {
    vertical: primary.vertical,
    label: picked.length === 2 ? `${parts[0]!.label} + ${parts[1]!.label}` : `${primary.label} +${picked.length - 1} more`,
    blurb: primary.blurb,
    pricingMode: primary.pricingMode,
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
