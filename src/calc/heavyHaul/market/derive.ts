/**
 * DERIVATION — stop asking the shipper carrier questions.
 *
 * A freight forwarder knows the cargo and the two addresses. He does not know
 * how many axles the rig will run, whether the deck is a step deck or a
 * removable gooseneck, or what class of road the permit office will assign. All
 * three of those change the price, and all three are IMPLIED by what he does
 * know. So the engine derives them.
 *
 * ── THE RULE THAT GOVERNS EVERY DERIVATION HERE ───────────────────────────
 *
 * A caller-supplied value ALWAYS wins, and a derived value ALWAYS says it was
 * derived and from what. `Derived<T>` carries `from` — the fact the inference
 * keys on — so the page can print "8 axles, derived from 120,000 lb gross"
 * rather than presenting an inference as an input.
 *
 * Nothing here is a market rate and nothing here is cited. These are engineering
 * inferences from physical facts, and they are labelled `derived` for that
 * reason: they carry no dollar figure and never enter a subtotal.
 */
import type { OsowLoad } from '../../osow/engine.js';

/** A value the engine worked out, with the fact it worked it out from. */
export interface Derived<T> {
  value: T;
  /** 'supplied' when the caller gave it; 'derived' when we inferred it. */
  origin: 'supplied' | 'derived';
  /** What the inference keys on. Empty when the caller supplied the value. */
  from: string;
  /** One sentence for the hover. */
  note: string;
}

function supplied<T>(value: T, what: string): Derived<T> {
  return {
    value,
    origin: 'supplied',
    from: '',
    note: `${what} as you entered it. Nothing was inferred.`,
  };
}

// ── Equipment class ───────────────────────────────────────────────────────

/**
 * The trailer the load actually moves on. Drives the line-haul multiplier, the
 * fuel economy and the minimum charge.
 *
 * 'superload' is a REFUSAL, not a price tier: every source agrees these are
 * quoted individually after a route survey, and the model returns no number.
 */
export type EquipmentClass =
  | 'flatbed'
  | 'stepDeck'
  | 'rgn'
  | 'multiAxle'
  | 'superload';

export const EQUIPMENT_LABELS: Readonly<Record<EquipmentClass, string>> = {
  flatbed: 'Flatbed',
  stepDeck: 'Step deck',
  rgn: 'RGN / lowboy',
  multiAxle: 'Multi-axle permitted',
  superload: 'Superload',
};

/**
 * Gross weight above which the load is a superload and is not priced.
 *
 * The research states the threshold as ">150,000 lb / 9+ axles". Those two are
 * not the same line under our own axle derivation below — nine axles lands
 * around 131,000 lb — so the WEIGHT trigger is taken as primary because it is
 * the one the sources state in dollars, and a caller-supplied axle count of ten
 * or more triggers it independently. Saying which of two stated triggers we
 * chose, and why, is cheaper than discovering later that they disagreed.
 */
export const SUPERLOAD_GROSS_LBS = 150_000;
export const SUPERLOAD_AXLE_COUNT = 10;

/** Gross above which the rig is a permitted multi-axle configuration. */
export const MULTI_AXLE_GROSS_LBS = 80_000;

/** Cargo height above which a flatbed's 5 ft deck will not clear 13'6". */
export const STEP_DECK_HEIGHT_IN = 102; // 8 ft 6 in of cargo on a 5 ft deck
/** Cargo height above which only a well-deck / removable gooseneck clears. */
export const RGN_HEIGHT_IN = 120; // 10 ft 0 in

/**
 * Derive the trailer class from gross weight and cargo height.
 *
 * WEIGHT DECIDES FIRST, because axles are what a permitted move buys and no
 * deck height gets 90,000 lb onto five axles. Height decides between the three
 * legal-weight decks, because that is the only thing that separates them: a
 * flatbed deck sits at ~5 ft, a step deck at ~3 ft 6 in, an RGN well at ~1 ft
 * 10 in, and the load has to clear 13 ft 6 in.
 */
export function deriveEquipmentClass(cargo: {
  grossWeightLbs: number;
  heightIn?: number;
  axleCount?: number;
}): Derived<EquipmentClass> {
  const gross = cargo.grossWeightLbs;
  if (gross > SUPERLOAD_GROSS_LBS) {
    return {
      value: 'superload',
      origin: 'derived',
      from: `${gross.toLocaleString()} lb gross`,
      note: `Above ${SUPERLOAD_GROSS_LBS.toLocaleString()} lb gross a move is a superload: it is routed and priced individually after an engineering review, and no published rate applies to it.`,
    };
  }
  if (cargo.axleCount !== undefined && cargo.axleCount >= SUPERLOAD_AXLE_COUNT) {
    return {
      value: 'superload',
      origin: 'derived',
      from: `${cargo.axleCount} axles`,
      note: `A ${cargo.axleCount}-axle configuration is a superload rig. These are priced individually after a route survey.`,
    };
  }
  if (gross > MULTI_AXLE_GROSS_LBS) {
    return {
      value: 'multiAxle',
      origin: 'derived',
      from: `${gross.toLocaleString()} lb gross`,
      note: `Over ${MULTI_AXLE_GROSS_LBS.toLocaleString()} lb gross the load cannot run on a legal five-axle configuration, so it moves on a permitted multi-axle trailer.`,
    };
  }
  const height = cargo.heightIn;
  if (height !== undefined && height > RGN_HEIGHT_IN) {
    return {
      value: 'rgn',
      origin: 'derived',
      from: `${(height / 12).toFixed(1)} ft of cargo height`,
      note: 'Above about 10 ft of cargo only a removable-gooseneck well deck keeps the load under 13 ft 6 in overall.',
    };
  }
  if (height !== undefined && height > STEP_DECK_HEIGHT_IN) {
    return {
      value: 'stepDeck',
      origin: 'derived',
      from: `${(height / 12).toFixed(1)} ft of cargo height`,
      note: 'Above about 8 ft 6 in of cargo a flatbed deck runs out of headroom, so the load moves on a step deck.',
    };
  }
  return {
    value: 'flatbed',
    origin: 'derived',
    from: `${gross.toLocaleString()} lb gross${height === undefined ? '' : ` and ${(height / 12).toFixed(1)} ft of cargo height`}`,
    note: 'A legal-weight load that clears 13 ft 6 in on a standard 5 ft deck moves on a flatbed.',
  };
}

export function equipmentClassOf(cargo: {
  grossWeightLbs: number;
  heightIn?: number;
  axleCount?: number;
  equipmentClass?: EquipmentClass;
}): Derived<EquipmentClass> {
  if (cargo.equipmentClass) {
    return supplied(cargo.equipmentClass, EQUIPMENT_LABELS[cargo.equipmentClass]);
  }
  return deriveEquipmentClass(cargo);
}

// ── Axle count ────────────────────────────────────────────────────────────

/** A legal five-axle tractor-semitrailer at 80,000 lb — the starting point. */
export const LEGAL_AXLES = 5;
export const LEGAL_GROSS_LBS = 80_000;
/**
 * Weight each axle added past the legal five is expected to carry.
 *
 * OUR FIGURE, and it is an engineering rule of thumb rather than a published
 * one: heavy-haul practice adds an axle for roughly every 15,000–20,000 lb over
 * the legal gross, and 17,000 is the middle of that. It is checked against the
 * one worked configuration we hold — 120,000 lb reference lane, filed at eight
 * axles — which this reproduces exactly.
 */
export const LBS_PER_ADDED_AXLE = 17_000;

/** Ceiling. Beyond this the rig is a superload and is not priced anyway. */
export const MAX_DERIVED_AXLES = 19;

/**
 * Axle count implied by gross weight.
 *
 * THE SHIPPER CANNOT ANSWER THIS, and it is not cosmetic — the bridge formula
 * is a function of axle count and spacing, and the detention schedule scales at
 * $25/$35/$40 per axle per hour. Asking a forwarder how many axles his carrier
 * will run is asking him to do the carrier's job.
 */
export function deriveAxleCount(grossWeightLbs: number): Derived<number> {
  const over = Math.max(0, grossWeightLbs - LEGAL_GROSS_LBS);
  const value = Math.min(
    MAX_DERIVED_AXLES,
    LEGAL_AXLES + Math.ceil(over / LBS_PER_ADDED_AXLE),
  );
  return {
    value,
    origin: 'derived',
    from: `${grossWeightLbs.toLocaleString()} lb gross`,
    note:
      over === 0
        ? 'A legal-weight load runs on the standard five-axle tractor-semitrailer.'
        : `${grossWeightLbs.toLocaleString()} lb is ${over.toLocaleString()} lb over the 80,000 lb legal gross; heavy-haul practice adds an axle for roughly every ${LBS_PER_ADDED_AXLE.toLocaleString()} lb over, which gives ${value}. Your carrier's actual configuration wins over this.`,
  };
}

export function axleCountOf(cargo: {
  grossWeightLbs: number;
  axleCount?: number;
}): Derived<number> {
  if (cargo.axleCount !== undefined) return supplied(cargo.axleCount, 'Axle count');
  return deriveAxleCount(cargo.grossWeightLbs);
}

// ── Cargo weight, when only a gross was given ─────────────────────────────

/**
 * Tare weight of the tractor and trailer, by class.
 *
 * OUR FIGURES. They exist so a caller who gave only a permit GROSS still gets a
 * crane sized on something other than the tractor. A caller who gives the cargo
 * weight replaces them outright, and the crane line says which happened —
 * because sizing a crane on a derived payload is a derivation stacked on a
 * derivation, and that is worth saying out loud.
 */
export const TARE_LBS: Readonly<Record<EquipmentClass, number>> = {
  flatbed: 32_000,
  stepDeck: 33_000,
  rgn: 38_000,
  multiAxle: 45_000,
  superload: 55_000,
};

export function cargoWeightOf(input: {
  grossWeightLbs: number;
  cargoWeightLbs?: number;
  equipmentClass: EquipmentClass;
}): Derived<number> {
  if (input.cargoWeightLbs !== undefined) {
    return supplied(input.cargoWeightLbs, 'Cargo weight');
  }
  const tare = TARE_LBS[input.equipmentClass];
  const value = Math.max(0, input.grossWeightLbs - tare);
  return {
    value,
    origin: 'derived',
    from: `${input.grossWeightLbs.toLocaleString()} lb gross less ${tare.toLocaleString()} lb of tractor and trailer`,
    note: `You gave a permit GROSS, not a cargo weight. A ${EQUIPMENT_LABELS[input.equipmentClass].toLowerCase()} combination tares at roughly ${tare.toLocaleString()} lb, so the piece being lifted is about ${value.toLocaleString()} lb. Enter the cargo weight to replace this — the crane is sized on it.`,
  };
}

// ── Route class ───────────────────────────────────────────────────────────

export type RouteClass = NonNullable<OsowLoad['routeClass']>;

/**
 * Route class from the corridor the router actually found.
 *
 * `RoutedCorridor.label` lists the roads that carry the corridor, most miles
 * first. If the principal road is an Interstate, the move is an interstate move
 * and several states' fee schedules read differently for it.
 *
 * WE REFUSE TO GUESS THE OTHER THREE. TIGER/Line PRIMARYROADS carries
 * Interstates and US routes, and a US route may be a four-lane divided highway
 * or a two-lane road through a town — the network does not say which, and
 * picking one would be inventing the input that changes the fee. So a non-
 * Interstate corridor returns `null` with a sentence asking for the class,
 * which is the same refusal shape the mileage tiers already use.
 */
export function deriveRouteClass(corridorLabel: string | null): Derived<RouteClass> | null {
  if (!corridorLabel) return null;
  const roads = corridorLabel.split('·').map((s) => s.trim()).filter(Boolean);
  const principal = roads[0];
  if (!principal) return null;
  if (/^I-\s?\d+/i.test(principal)) {
    return {
      value: 'interstate',
      origin: 'derived',
      from: `the routed corridor's principal road, ${principal}`,
      note: `The corridor this lane was measured on runs primarily on ${principal}, so it is priced as an interstate move. Change it if your permit routes you off the interstate.`,
    };
  }
  return null;
}

export function routeClassOf(input: {
  routeClass?: RouteClass;
  corridorLabel?: string | null;
}): Derived<RouteClass> | null {
  if (input.routeClass) return supplied(input.routeClass, 'Route class');
  return deriveRouteClass(input.corridorLabel ?? null);
}

/** The sentence shown when the corridor exists but is not an Interstate one. */
export const ROUTE_CLASS_UNDERIVABLE =
  'Route class could not be derived: the corridor’s principal road is not an Interstate, and the road network does not record whether a US route is divided, multi-lane or two-lane. Several states price the permit differently by class, so pick one rather than let us guess.';

// ── The whole derivation, in one call ─────────────────────────────────────

export interface DerivedLoad {
  equipmentClass: Derived<EquipmentClass>;
  axleCount: Derived<number>;
  cargoWeightLbs: Derived<number>;
  routeClass: Derived<RouteClass> | null;
  /** Present when the corridor exists but could not settle the class. */
  routeClassNote: string | null;
}

export function deriveLoad(input: {
  grossWeightLbs: number;
  cargoWeightLbs?: number;
  heightIn?: number;
  widthIn?: number;
  axleCount?: number;
  equipmentClass?: EquipmentClass;
  routeClass?: RouteClass;
  corridorLabel?: string | null;
}): DerivedLoad {
  const equipmentClass = equipmentClassOf(input);
  const axleCount = axleCountOf(input);
  const cargoWeightLbs = cargoWeightOf({
    grossWeightLbs: input.grossWeightLbs,
    ...(input.cargoWeightLbs === undefined ? {} : { cargoWeightLbs: input.cargoWeightLbs }),
    equipmentClass: equipmentClass.value,
  });
  const routeClass = routeClassOf(input);
  return {
    equipmentClass,
    axleCount,
    cargoWeightLbs,
    routeClass,
    routeClassNote:
      routeClass === null && input.corridorLabel ? ROUTE_CLASS_UNDERIVABLE : null,
  };
}
