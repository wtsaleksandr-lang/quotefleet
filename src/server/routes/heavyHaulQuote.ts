/**
 * THE HEAVY-HAUL DELIVERED-COST QUOTE TOOL — free, no account.
 *
 * Cargo dimensions and weight, an address at each end, and the answer is a
 * delivered-cost estimate with a line-by-line breakdown and a confidence score
 * that can be taken apart.
 *
 * ── WHY THIS IS A SECOND TOOL AND NOT A CHANGE TO THE FIRST ───────────────
 * `/tools/oversize-permits` prices STATE PERMIT FEES and says so beside its
 * number. It is not touched by this file and its output is not changed by a
 * line of it. This page composes that same engine with three others into a
 * delivered figure, which is a different claim and needs different guardrails —
 * chiefly that a cited permit fee and a rate the caller typed must never be
 * added into one undifferentiated number. The composition lives in
 * `src/calc/heavyHaul/quote.ts`; this file is the HTTP and HTML around it.
 *
 * ── THE MILEAGE FORK, WHICH IS THE WHOLE PRODUCT DESIGN ───────────────────
 * Two addresses give a LANE TOTAL and nothing else. That total is fit to price
 * line haul (measured within a few percent of a routed distance) and unfit to
 * price a permit: several states charge on miles travelled INSIDE the state,
 * and a straight line splits a lane so badly it invents whole states — a
 * measured +$285 Louisiana permit on a Houston→Buffalo lane that never enters
 * Louisiana. So at that tier the page does not price permits. It NAMES the
 * states the corridor probably crosses and asks for the miles, which the
 * dispatcher already has out of PC*Miler because the permit application asks
 * for them. Fill those in and every covered state is priced from filed figures,
 * the authoritative tier.
 *
 * ── ROUTES ────────────────────────────────────────────────────────────────
 *   GET  /tools/heavy-haul-quote          — the free public page.
 *   GET  /api/tools/heavy-haul-quote/coverage — covered states, route classes,
 *                                           exclusions and tier definitions.
 *   POST /api/tools/heavy-haul-quote      — price a lane. `publicCalcLimiter`.
 *
 * NO DATABASE ON THE ANSWER PATH. The permit corpus is compiled in, the diesel
 * price is memoised in-process with a hardcoded last resort, and the only
 * network call in the feature is the free keyless US Census geocoder. The tool
 * answers correctly with the database down — which is the state the dev Neon
 * branch is in.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  priceHeavyHaulLane,
  HEAVY_HAUL_NOT_INCLUDED,
  HEAVY_HAUL_DISCLAIMER,
  type DieselReading,
  type HeavyHaulQuote,
  type LaneEndpoint,
} from '../../calc/heavyHaul/quote.js';
import { MILEAGE_TIERS } from '../../calc/heavyHaul/corridor.js';
import {
  MARKET_SOURCES,
  TIER_DEFAULT_BAND_PCT,
  TIER_LABELS,
  TIER_MEANINGS,
} from '../../calc/heavyHaul/market/index.js';
import {
  CONFIDENCE_HIGH_MIN,
  CONFIDENCE_MEDIUM_MIN,
  CONFIDENCE_BANDS,
} from '../../calc/heavyHaul/confidence.js';
import {
  geocodeAddress,
  seedGeocodeCache,
  type GeocodeResult,
} from '../../calc/heavyHaul/geocode.js';
import {
  routedStateMileage,
  type RoutedMileageResult,
} from '../../calc/heavyHaul/routedMileage.js';
import { AUTO_FSC_DEFAULTS } from '../../calc/defaults.js';
import { todayIso } from '../../calc/osow/provenance.js';
import { getDieselPrice } from '../../eia/dieselPrice.js';
import {
  OSOW_ROUTE_CLASSES,
  OSOW_MAX_LEGS,
  OSOW_ASOF_MIN,
  OSOW_SELECTABLE_STATE_CODES,
  osowCoveredStates,
  osowStateOptions,
  OSOW_TOOL_PATH,
} from './osowPermits.js';
import { US_STATE_CODES, stateByCode, US_STATES } from '../directory/usStates.js';
import { publicCalcLimiter } from '../rateLimits.js';
import { setPublicDirectoryCache } from '../directory/httpCache.js';
import { escortDirectoryHref } from '../pilotCars/model.js';
import { FULL_SITE_HEADER, PREMIUM_FOOTER, HEADER_SCRIPTS } from '../siteChrome.js';

const SITE = 'https://quotefleet.net';
export const HEAVY_HAUL_TOOL_PATH = '/tools/heavy-haul-quote';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string),
  );
}

// ── The worked example ─────────────────────────────────────────────────────

/**
 * THE LANE THE "SEE A WORKED EXAMPLE" BUTTON LOADS, and the two endpoints it
 * resolves to.
 *
 * These are REAL results from the US Census geocoder for these two addresses,
 * recorded once and compiled in. Seeding them means the example renders with no
 * network round-trip at all — for a visitor, in dev, and in the automated
 * suite, which is how the e2e tests drive the full flow while making zero live
 * calls to the Census service.
 */
export const HEAVY_HAUL_EXAMPLE = {
  originAddress: '1500 McKinney St, Houston, TX 77010',
  destinationAddress: '403 Main St, Buffalo, NY 14203',
} as const;

const SEEDED_ENDPOINTS = [
  {
    ok: true as const,
    query: HEAVY_HAUL_EXAMPLE.originAddress,
    matchedAddress: '1500 MCKINNEY ST, HOUSTON, TX, 77010',
    latitude: 29.754276036552,
    longitude: -95.360587104838,
    state: 'TX',
    zip: '77010',
    benchmark: 'Public_AR_Current',
    ambiguous: false,
  },
  {
    ok: true as const,
    query: HEAVY_HAUL_EXAMPLE.destinationAddress,
    matchedAddress: '403 MAIN ST, BUFFALO, NY, 14203',
    latitude: 42.885553091904,
    longitude: -78.874342511112,
    state: 'NY',
    zip: '14203',
    benchmark: 'Public_AR_Current',
    ambiguous: false,
  },
];

// ── Request validation ─────────────────────────────────────────────────────

/**
 * INPUT-SANITY bounds, not permit limits. The engine decides what is a
 * superload and what has no published fee; these only stop a typo — a width in
 * millimetres, a weight with an extra zero — from reaching it. Deliberately the
 * same ceilings the permits calculator uses, so the two tools cannot disagree
 * about what a plausible load is.
 */
const MAX_WEIGHT_LBS = 2_000_000;
const MAX_DIMENSION_IN = 12 * 400;
const MAX_MILES_PER_STATE = 3_000;
const MAX_ADDRESS_CHARS = 200;
const MIN_ADDRESS_CHARS = 6;

const positive = (max: number) => z.number().finite().positive().max(max);
const ROUTE_CLASS_VALUES = OSOW_ROUTE_CLASSES.map((r) => r.value) as [string, ...string[]];

const AddressSchema = z
  .string()
  .trim()
  .min(
    MIN_ADDRESS_CHARS,
    'Enter a full US street address — number, street, city, state and ZIP. The geocoder matches street addresses, not landmarks or bare city names.',
  )
  .max(MAX_ADDRESS_CHARS);

const LegSchema = z.object({
  state: z.string().trim().min(2).max(2),
  miles: z
    .number()
    .finite()
    .positive(
      'In-state miles must be a positive number — a leg of 0 mi is not a state the load crosses.',
    )
    .max(MAX_MILES_PER_STATE),
});

const HeavyHaulRequestSchema = z.object({
  cargo: z.object({
    grossWeightLbs: positive(MAX_WEIGHT_LBS),
    widthIn: positive(MAX_DIMENSION_IN).optional(),
    heightIn: positive(MAX_DIMENSION_IN).optional(),
    overallLengthIn: positive(MAX_DIMENSION_IN).optional(),
    trailerLengthIn: positive(MAX_DIMENSION_IN).optional(),
    axleCount: z.number().int().min(2).max(40).optional(),
    routeClass: z.enum(ROUTE_CLASS_VALUES).optional(),
  }),
  originAddress: AddressSchema,
  destinationAddress: AddressSchema,
  /**
   * The caller's FILED per-state mileage. Optional, and supplying it is what
   * moves the lane from "we cannot price permits" to "here is every state's
   * fee" — it is the tier-0 upgrade path, not a formality.
   */
  legs: z
    .array(LegSchema)
    .max(
      OSOW_MAX_LEGS,
      `A lane can carry at most ${OSOW_MAX_LEGS} states here. Remove a state before adding another.`,
    )
    .optional(),
  rates: z
    .object({
      linehaulUsdPerMile: z.number().finite().positive().max(1_000).optional(),
      linehaulMinimumUsd: z.number().finite().positive().max(10_000_000).optional(),
      pilotCarUsdPerMile: z.number().finite().positive().max(1_000).optional(),
      pilotCarUsdPerDay: z.number().finite().positive().max(100_000).optional(),
      pilotCarDaysPerState: z.number().finite().positive().max(60).optional(),
      pilotCarMinimumPerState: z.number().finite().positive().max(1_000_000).optional(),
      /**
       * The caller's own FSC model. The diesel PRICE stays sourced from the EIA
       * index either way; these are the two assumptions inside the surcharge,
       * and every carrier's table pegs somewhere. Bounds are sanity rails, not
       * opinions: a peg above the current pump price yields $0 surcharge, which
       * is a legitimate answer, and 1 mpg is absurd but not our call to refuse.
       */
      fuelPegUsdPerGal: z.number().finite().nonnegative().max(20).optional(),
      fuelMpg: z.number().finite().positive().min(1).max(20).optional(),
    })
    .optional(),
  /**
   * THE MARKET ENGINE'S SWITCHES. Every field optional, and the whole object
   * optional, so the form as it stands today keeps working unchanged — a
   * request that omits this gets the fallbacks on and every conditional off,
   * which is the behaviour the page already renders.
   *
   * `enabled: false` restores the old refuse-rather-than-estimate behaviour in
   * full, which is what the regression tests use to prove the reversal is a
   * switch rather than a rewrite.
   */
  market: z
    .object({
      enabled: z.boolean().optional(),
      region: z
        .enum(['midwest', 'mountainPlains', 'west', 'southCentral', 'southeast', 'northeast'])
        .optional(),
      equipmentClass: z
        .enum(['flatbed', 'stepDeck', 'rgn', 'multiAxle', 'superload'])
        .optional(),
      cargoWeightLbs: z.number().finite().positive().max(MAX_WEIGHT_LBS).optional(),
      loadingAtOrigin: z.boolean().optional(),
      loadingAtDestination: z.boolean().optional(),
      tarping: z.boolean().optional(),
      highPoleEscort: z.boolean().optional(),
      declaredValueUsd: z.number().finite().positive().max(500_000_000).optional(),
      securementAllowance: z.boolean().optional(),
    })
    .optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type HeavyHaulApiRequest = z.infer<typeof HeavyHaulRequestSchema>;

// ── The diesel reading, without a database on the answer path ──────────────

/**
 * Diesel price for the quote, memoised in-process.
 *
 * `getDieselPrice()` reads a cached value from `platform_settings` and refreshes
 * it from EIA (or the keyless USDA republication) when it is stale. Both of
 * those are unavailable to us in the state this tool is built for — the DB is
 * down and there may be no EIA key — and `getDieselPrice` is contractually
 * non-throwing, so it degrades on its own to a stale cache and then to a
 * hardcoded constant.
 *
 * What this adds is a SHORT IN-PROCESS MEMO and a hard timeout. Without them an
 * unauthenticated endpoint with no usable cache would attempt an upstream fetch
 * on every request, which is neither polite to a free public dataset nor
 * survivable under a rate-limited burst. `source: 'default'` and `stale` both
 * travel into the confidence score, so serving the constant visibly costs the
 * quote points rather than passing silently.
 */
const DIESEL_MEMO_MS = 6 * 60 * 60 * 1000;
const DIESEL_TIMEOUT_MS = 4_000;
let dieselMemo: { at: number; value: DieselReading } | null = null;

export async function resolveDieselReading(): Promise<DieselReading> {
  if (dieselMemo && Date.now() - dieselMemo.at < DIESEL_MEMO_MS) return dieselMemo.value;

  const fallback: DieselReading = {
    usdPerGal: AUTO_FSC_DEFAULTS.fallbackDieselUsdPerGal,
    asOf: '',
    source: 'default',
    stale: true,
  };

  let value: DieselReading = fallback;
  try {
    const timeout = new Promise<null>((resolve) => {
      const t = setTimeout(() => resolve(null), DIESEL_TIMEOUT_MS);
      // Never hold the event loop open for a price we are willing to guess at.
      if (typeof t.unref === 'function') t.unref();
    });
    const priced = await Promise.race([getDieselPrice(), timeout]);
    if (priced) {
      value = {
        usdPerGal: priced.usdPerGal,
        asOf: priced.asOf,
        source: priced.source,
        stale: priced.stale,
      };
    }
  } catch {
    value = fallback;
  }

  dieselMemo = { at: Date.now(), value };
  return value;
}

/** Exposed so the tests can drive both the fresh and the fallback path. */
export function __resetDieselMemo(): void {
  dieselMemo = null;
}

// ── Response shaping ───────────────────────────────────────────────────────

export interface HeavyHaulApiResponse {
  asOf: string;
  lane: {
    origin: { entered: string; matched: string; state: string | null };
    destination: { entered: string; matched: string; state: string | null };
  };
  quote: HeavyHaulQuote;
  /** Names for the corridor prompt, so the page holds no state list of its own. */
  corridorNames: Record<string, string>;
  /**
   * A DEEP LINK INTO THE ESCORT DIRECTORY, pre-filtered to this lane.
   *
   * Built server-side from the states whose own escort rules fired on THIS load
   * and, separately, from the cited certification registry, so the `certin`
   * half never asks for a certificate the state does not issue. `null` when no
   * state on the lane requires a pilot car — there is nothing to go and find,
   * and a link offering to find it anyway would be an advert.
   */
  escortDirectoryHref: string | null;
  disclaimer: string;
}

const STATE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  US_STATES.map((s) => [s.code, s.name]),
);

/**
 * Measure the lane on the primary-road network, or return `undefined`.
 *
 * ── WHY THIS NEVER THROWS ─────────────────────────────────────────────────
 * This is the only place in the request path that touches the routing assets,
 * and a quote must not stop working because one of them is missing from a
 * deploy. Every failure — a missing 4.5 MB graph, an unreadable boundary
 * archive, an endpoint outside coverage — degrades to `undefined`, and the
 * quote then behaves exactly as it did before this tier existed: it names the
 * corridor states and asks for filed miles. That is a WORSE ANSWER, not a wrong
 * one, and it is the only acceptable direction to fall.
 *
 * The first call pays ~250 ms and about 130 MB to load the graph and the
 * full-resolution state polygons; every call after it is free, because both are
 * held in module singletons for the life of the process.
 */
function measureLaneMileage(lane: {
  origin: LaneEndpoint;
  destination: LaneEndpoint;
}): RoutedMileageResult | undefined {
  try {
    return routedStateMileage(
      { latitude: lane.origin.latitude, longitude: lane.origin.longitude },
      { latitude: lane.destination.latitude, longitude: lane.destination.longitude },
    );
  } catch {
    return undefined;
  }
}

/**
 * Price a request whose addresses are already resolved. Pure — exported so the
 * tests exercise exactly the path the route does, with no network at all.
 */
export function priceResolvedHeavyHaulLane(
  input: HeavyHaulApiRequest,
  lane: { origin: LaneEndpoint; destination: LaneEndpoint },
  diesel: DieselReading,
  /**
   * The tier-1 routed measurement, PASSED IN so this function stays pure.
   *
   * `measureLaneMileage` below does the disk I/O; the tests call this function
   * without it, or with a fixture, and never touch the 14 MB of assets.
   */
  routedMileage?: RoutedMileageResult,
): HeavyHaulApiResponse {
  const asOf = input.asOf ?? todayIso();
  const pilotCar = {
    ...(input.rates?.pilotCarUsdPerMile === undefined
      ? {}
      : { usdPerMile: input.rates.pilotCarUsdPerMile }),
    ...(input.rates?.pilotCarUsdPerDay === undefined
      ? {}
      : { usdPerDay: input.rates.pilotCarUsdPerDay }),
    ...(input.rates?.pilotCarDaysPerState === undefined
      ? {}
      : { daysPerJurisdiction: input.rates.pilotCarDaysPerState }),
    ...(input.rates?.pilotCarMinimumPerState === undefined
      ? {}
      : { minimumUsdPerJurisdiction: input.rates.pilotCarMinimumPerState }),
  };

  const quote = priceHeavyHaulLane({
    cargo: input.cargo as Parameters<typeof priceHeavyHaulLane>[0]['cargo'],
    lane,
    ...(routedMileage ? { routedMileage } : {}),
    ...(input.legs && input.legs.length > 0
      ? {
          filedLegs: input.legs.map((l) => {
            const code = l.state.toUpperCase();
            return { stateCode: code, stateName: stateByCode(code)?.name ?? code, miles: l.miles };
          }),
        }
      : {}),
    rates: {
      ...(input.rates?.linehaulUsdPerMile === undefined
        ? {}
        : { linehaulUsdPerMile: input.rates.linehaulUsdPerMile }),
      ...(input.rates?.linehaulMinimumUsd === undefined
        ? {}
        : { linehaulMinimumUsd: input.rates.linehaulMinimumUsd }),
      ...(Object.keys(pilotCar).length === 0 ? {} : { pilotCar }),
      ...(input.rates?.fuelPegUsdPerGal === undefined
        ? {}
        : { fuelPegUsdPerGal: input.rates.fuelPegUsdPerGal }),
      ...(input.rates?.fuelMpg === undefined ? {} : { fuelMpg: input.rates.fuelMpg }),
    },
    ...(input.market === undefined ? {} : { market: input.market }),
    diesel,
    asOf,
    stateNames: STATE_NAMES,
  });

  const corridorNames: Record<string, string> = {};
  for (const s of quote.corridor?.states ?? []) {
    corridorNames[s.stateCode] = STATE_NAMES[s.stateCode] ?? s.stateCode;
  }

  return {
    asOf,
    lane: {
      origin: {
        entered: lane.origin.address,
        matched: lane.origin.matchedAddress,
        state: lane.origin.state,
      },
      destination: {
        entered: lane.destination.address,
        matched: lane.destination.matchedAddress,
        state: lane.destination.state,
      },
    },
    quote,
    corridorNames,
    escortDirectoryHref: (() => {
      const states = (quote.permits?.jurisdictions ?? [])
        .filter((j) => j.escortsRequired > 0)
        .map((j) => j.jurisdiction);
      return states.length > 0 ? escortDirectoryHref(states) : null;
    })(),
    disclaimer: HEAVY_HAUL_DISCLAIMER,
  };
}

function toEndpoint(address: string, result: GeocodeResult): LaneEndpoint | null {
  if (!result.ok) return null;
  return {
    address,
    matchedAddress: result.matchedAddress,
    latitude: result.latitude,
    longitude: result.longitude,
    state: result.state,
    benchmark: result.benchmark,
    ambiguous: result.ambiguous,
  };
}

// ── Page CSS ───────────────────────────────────────────────────────────────
//
// Lives here rather than in `src/server/public/*.css` for the same reason
// `OSOW_CSS` does: the page is server-rendered from one file and its styles
// travel with it. Every colour is a token from style.css, so light and dark
// both work with no `data-theme` block of our own and no raw hex anywhere.

const HH_CSS = `
  .hh-shell { max-width: 1080px; margin: 0 auto; padding: 24px; }
  /* Shared .hero centres its text. Left-align it and centre the same 1032px
     column the body uses, so the H1 starts on the body's left edge. */
  .hh-hero { padding: 48px 24px 16px; text-align: left; }
  .hh-hero .container-narrow { max-width: 1032px; margin: 0 auto; padding: 0; }
  .hh-eyebrow { color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px; text-align: left; }
  .hh-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 8px; text-align: left; text-wrap: balance; }
  .hh-hero p.lead { max-width: 800px; margin: 0; text-align: left; text-wrap: pretty; }

  /* The honesty banner. Solid, never glass: it sits behind body text. */
  .hh-truth { background: var(--warn-bg); border: 1px solid var(--warn); border-radius: var(--radius-lg); padding: 16px; margin: 16px 0 0; }
  .hh-truth h2 { font-size: 16px; margin: 0 0 4px; color: var(--ink); }
  .hh-truth p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }
  .hh-truth strong { color: var(--ink); }

  .hh-grid { display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 1fr); gap: 24px; align-items: start; margin-top: 24px; }
  .hh-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
  .hh-card + .hh-card { margin-top: 16px; }

  /* Section header: help cue TOP-LEFT, never inline with a label. */
  .hh-sec { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px; }
  .hh-cue { flex: 0 0 auto; width: 24px; height: 24px; min-width: 24px; min-height: 24px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; font-weight: 700; line-height: 1; cursor: pointer; padding: 0; }
  .hh-cue:hover, .hh-cue:focus-visible { border-color: var(--accent); color: var(--accent); }
  .hh-sec h2 { font-size: 15px; margin: 0; align-self: center; color: var(--ink); }
  .hh-cue-body { display: none; font-size: 13px; line-height: 1.55; color: var(--ink-soft); background: var(--surface-3); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin: 0 0 8px; }
  .hh-cue-body.is-open { display: block; }

  /* Inputs: title INSIDE the field, 2px between stacked components. */
  .hh-stack { display: grid; gap: 2px; }
  .hh-row2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; }
  .hh-field { position: relative; display: block; }
  .hh-field input, .hh-field select { width: 100%; min-height: 48px; box-sizing: border-box; padding: 20px 12px 6px; font: inherit; font-size: 15px; color: var(--ink); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); appearance: none; }
  .hh-field input:focus, .hh-field select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .hh-field .hh-lab { position: absolute; left: 12px; top: 6px; font-size: 11px; letter-spacing: 0.02em; color: var(--muted); pointer-events: none; }
  .hh-field input:placeholder-shown:not(:focus) + .hh-lab { top: 16px; font-size: 14px; color: var(--muted); }
  .hh-field input:focus + .hh-lab, .hh-field select:focus + .hh-lab { color: var(--accent); }

  /* Route-class pills: 4 options in a 2-column grid, so they wrap 2x2 and a
     single pill can never sit alone on a line. Selected = outline + tint. */
  .hh-pills { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; }
  .hh-pill { min-height: 44px; padding: 8px 12px; font: inherit; font-size: 13px; text-align: left; color: var(--ink-soft); background: transparent; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
  .hh-pill:hover { border-color: var(--border-strong); }
  .hh-pill[aria-pressed="true"] { border-color: var(--accent); border-width: 2px; padding: 8px 12px; background: var(--accent-soft); color: var(--ink); }

  .hh-legs { display: grid; gap: 2px; }
  .hh-leg { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 116px) 44px; gap: 2px; }
  .hh-legdrop { min-height: 44px; min-width: 44px; border: 1px solid var(--border); border-radius: var(--radius); background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; }
  .hh-legdrop:hover { border-color: var(--error); color: var(--error); }

  .hh-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .hh-actions .btn { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; }
  .hh-actions .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .hh-go { margin-top: 16px; }
  .hh-go .btn { width: 100%; min-height: 52px; display: inline-flex; align-items: center; justify-content: center; }
  .hh-hint { font-size: 12px; color: var(--muted); margin: 8px 0 0; line-height: 1.5; }
  .hh-hint[hidden] { display: none; }

  /* ── RESULTS. Compact by construction: one headline, one KPI, one table,
     everything else folded. The permits page was cut from 8,124px to 3,554px
     by exactly this discipline and this page is built to it from the start. */
  .hh-results { scroll-margin-top: 96px; }
  .hh-total { scroll-margin-top: 96px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); padding: 16px; }
  .hh-total--partial { border-color: var(--warn); }
  .hh-tl { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
  /* Flat ink, never the accent: the total must not collide with its surface. */
  .hh-tv { font-size: 40px; font-weight: 700; line-height: 1.1; color: var(--ink); margin: 0; }
  .hh-trange { font-size: 13px; color: var(--ink-soft); margin: 4px 0 0; font-family: var(--font-mono); }
  .hh-tpart { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--warn); margin: 4px 0 0; }
  .hh-tsub { font-size: 13px; color: var(--ink-soft); margin: 4px 0 0; line-height: 1.55; }

  /* ── THE KPI. A number, a bar, and the reasons — in that order, because the
     reasons are what make the number worth reading. */
  .hh-kpi { margin-top: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); padding: 12px; }
  .hh-kpihead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .hh-kpiscore { font-size: 28px; font-weight: 700; line-height: 1.1; color: var(--ink); font-family: var(--font-mono); }
  .hh-kpilabel { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 8px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); color: var(--muted); white-space: nowrap; }
  /* The BORDER may be the raw success token; the 11px TEXT may not. Bare
     var(--success) renders 3.54:1 on this page's light surface — under WCAG
     AA's 4.5:1, which has no large-text relief below 18.66px. Mixing it toward
     var(--ink) darkens it on light and lightens it on dark, so one declaration
     clears AA in both themes without a theme block, and it stays token-only:
     a hardcoded hex here would (rightly) fail the page's no-raw-hex guard. */
  .hh-kpilabel--high {
    border-color: var(--success);
    color: color-mix(in srgb, var(--success) 75%, var(--ink));
  }
  .hh-kpilabel--medium { border-color: var(--warn); color: var(--warn); }
  .hh-kpilabel--low { border-color: var(--error); color: var(--error); }
  .hh-bar { height: 6px; border-radius: var(--radius-pill); background: var(--surface-3); margin: 8px 0; overflow: clip; }
  .hh-bar > span { display: block; height: 100%; border-radius: var(--radius-pill); background: var(--muted); }
  .hh-bar--high > span { background: var(--success); }
  .hh-bar--medium > span { background: var(--warn); }
  .hh-bar--low > span { background: var(--error); }
  .hh-why { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .hh-why li { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; align-items: baseline; font-size: 13px; line-height: 1.5; color: var(--ink-soft); }
  .hh-why .pts { font-family: var(--font-mono); font-size: 12px; color: var(--warn); white-space: nowrap; }
  .hh-why .lab { overflow-wrap: anywhere; }
  .hh-whyfold { margin-top: 8px; }
  .hh-whyfold > summary { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); cursor: pointer; }
  .hh-whyfold > summary:hover, .hh-whyfold > summary:focus-visible { color: var(--accent); }
  .hh-whyfold ol { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 8px; }
  .hh-whyfold li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }
  .hh-ground { display: inline-block; font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); padding: 2px 6px; color: var(--muted); margin-right: 4px; white-space: nowrap; }

  /* THREE TILES, and three is exactly why this is a 3-column grid rather than a
     wrap: at any width where two fit and three do not, a flex wrap leaves one
     alone on a second line. Below 720px it becomes a single column, which is
     the only other count that cannot orphan. */
  .hh-split { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .hh-tile { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--bg); }
  .hh-tile.is-yours { border-style: dashed; border-color: var(--accent); }
  .hh-tile .k { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 4px; }
  .hh-tile .v { font-size: 18px; font-weight: 600; color: var(--ink); font-family: var(--font-mono); }
  /* CLAMPED TO TWO LINES. Four captions at four lines each is 200px of prose
     above the breakdown, and every one of these claims is repeated on the
     rows beneath with its own rating and its own hover card. */
  .hh-tile .n { font-size: 12px; color: var(--muted); line-height: 1.5; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: clip; margin-top: 4px; }

  .hh-note { border-radius: var(--radius-lg); padding: 16px; margin-top: 12px; border: 1px solid var(--border); background: var(--surface); }
  .hh-note h3 { font-size: 15px; margin: 0 0 8px; color: var(--ink); }
  .hh-note p, .hh-note li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }
  /* The routing engine's own notes run to six lines at 375px. Clamped to
     three; the tier label above them already says which measurement this is. */
  .hh-note p.hh-clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: clip; }
  .hh-note ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
  .hh-note--warn { border-color: var(--warn); background: var(--warn-bg); }
  .hh-note--error { border-color: var(--error); background: var(--error-bg); }

  /* ── The breakdown. One table, every line, basis stated per row. ───────── */
  .hh-linesbox { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; margin-top: 12px; }
  .hh-linesbox > h3 { font-size: 15px; margin: 0 0 4px; color: var(--ink); }
  /* The safety net, not the plan. The breakdown itself is a two-track GRID and
     fits 375px natively, so nothing here scrolls sideways. The wrapper stays
     for the folded per-state detail, whose citation URLs are unbreakable
     strings: it lets THAT box scroll rather than the document, which is the
     one failure this page must not have. */
  .hh-tablewrap { overflow-x: auto; }
  /* THE DELIVERED TOTAL, as the last row of the breakdown. */
  .hh-line.hh-tot { border-top: 2px solid var(--border-strong); border-bottom: none; padding-top: 12px; }
  .hh-line.hh-tot .hh-lname, .hh-line.hh-tot .hh-lamt { font-weight: 700; color: var(--ink); }
  /* THE LINE NOTE, CLAMPED TO THREE LINES — the same treatment .ow-reason gets
     on the permits page, and for the same reason. The fuel line's model note
     runs to six lines at 375px and the seven permit rows each carry their own
     fee arithmetic; unclamped they turned a 4,000px result into a 6,500px one.
     Nothing is lost: every note is repeated VERBATIM and in full in the
     per-state disclosure directly beneath, whose summary carries the count.
     overflow: clip, never hidden — hidden breaks position: sticky. */
  .hh-ln { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: clip; font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 4px; overflow-wrap: anywhere; }
  /* THE BASIS PILL LIVES ON THE ROW NAME, NOT IN THE NOTE, and that placement
     is load-bearing: the note beneath is clamped to three lines, and the claim
     "this is your number, not one we sourced" is the one sentence on the row
     that must never be the sentence that got clipped. Dashed = the caller's own
     rate; solid = a sourced index run through a model of ours.
     A PILL MUST NEVER WRAP — broken over two lines a chip reads as a fault. */
  .hh-tag { display: inline-block; white-space: nowrap; font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 6px; border-radius: var(--radius-pill); border: 1px dashed var(--accent); color: var(--accent); margin-left: 6px; }
  .hh-tag--derived { border-style: solid; border-color: var(--border-strong); color: var(--muted); }

  /* ── THE CORRIDOR PROMPT. The refusal turned into a question. ──────────── */
  .hh-corridor { border: 1px solid var(--accent); border-radius: var(--radius-lg); background: var(--accent-soft); padding: 16px; margin-top: 12px; }
  .hh-corridor h3 { font-size: 15px; margin: 0 0 4px; color: var(--ink); }
  .hh-corridor p { font-size: 13px; line-height: 1.55; color: var(--ink-soft); margin: 0 0 8px; }
  /* FOUR COLUMNS. The list is 2-12 states and a fixed even column count cannot
     leave one chip alone on a row unless the count is odd by one — which
     renderCorridor pads, the same trick .ow-badges uses. */
  .hh-chips { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
  .hh-chip { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; padding: 6px 4px; text-align: center; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); color: var(--muted); white-space: nowrap; }
  .hh-chip--endpoint { border-color: var(--accent); color: var(--accent); }
  .hh-chip--likely { border-color: var(--warn); color: var(--warn); }
  .hh-chip--none { border-color: var(--error); color: var(--error); }
  .hh-chip--pad { border-color: transparent; color: transparent; }
  .hh-corridor .btn { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; margin-top: 8px; }

  /* ── FOLDED PROSE. Nothing is dropped; it is one click away. ───────────── */
  .hh-fold { margin-top: 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 16px; }
  .hh-fold > summary { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); cursor: pointer; }
  .hh-fold > summary:hover, .hh-fold > summary:focus-visible { color: var(--accent); }
  .hh-fold ol, .hh-fold ul { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 8px; }
  .hh-fold li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }
  .hh-fold a { color: var(--accent); overflow-wrap: anywhere; }

  .hh-empty { color: var(--muted); font-size: 14px; line-height: 1.6; margin: 0; }
  .hh-busy { color: var(--muted); font-size: 14px; margin: 0; }
  .hh-eglist { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 4px; }
  .hh-eglist li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); }
  .hh-eg { margin-top: 12px; }
  .hh-eg .btn { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; }

  /* -- THE SHIPPER FORM --------------------------------------------------
     Three questions and a disclosure. Everything a shipper cannot answer --
     axle count, trailer class, route class, per-state mileage -- is derived by
     the engine from the cargo and the two addresses, and everything a
     forwarder with his own book MIGHT want to override lives behind one
     collapsed summary rather than in front of everybody who has neither. */

  /* The two addresses sit SIDE BY SIDE on one line, per the brief -- cards
     next to each other, not stacked. They collapse to one column at 640px,
     where two 160px address boxes would be unusable. */
  .hh-row2--addr { grid-template-columns: repeat(2, minmax(0, 1fr)); }

  /* UNITS. Two options, so the group is a two-track grid and can never leave
     one pill alone on a row. Selected = OUTLINE + tint, never a bright fill. */
  .hh-units { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; margin: 0 0 8px; }

  /* LOADING AT EACH END. Two checkmarks, two tracks -- the same no-orphan rule.
     Both default CHECKED, i.e. "provided", because most shippers do have a
     forklift or a crane on site and defaulting the crane ON would inflate
     every quote on the page. Unticking one is what buys the machine. */
  .hh-checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; }
  .hh-check { display: flex; align-items: flex-start; gap: 8px; min-height: 48px; padding: 12px; box-sizing: border-box; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); font-size: 13px; line-height: 1.5; color: var(--ink-soft); cursor: pointer; }
  .hh-check input { width: 20px; height: 20px; min-width: 20px; margin: 0; flex: none; accent-color: var(--accent); }
  .hh-check:hover { border-color: var(--border-strong); }
  .hh-check:has(input:checked) { border-color: var(--accent); color: var(--ink); }
  .hh-check:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

  /* THE OVERRIDE DISCLOSURE. Collapsed by default and deliberately quiet: a
     shipper never opens it, and a forwarder with a negotiated rate finds it
     without being asked a carrier question first. */
  .hh-adv { margin-top: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 16px; }
  .hh-adv > summary { font-size: 13px; color: var(--muted); cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; min-height: 24px; }
  .hh-adv > summary::-webkit-details-marker { display: none; }
  .hh-adv > summary::before { content: "+"; font-family: var(--font-mono); font-size: 14px; line-height: 1; color: var(--muted); }
  .hh-adv[open] > summary::before { content: "−"; }
  .hh-adv > summary:hover, .hh-adv > summary:focus-visible { color: var(--accent); }
  .hh-advbody { margin-top: 12px; display: grid; gap: 12px; }
  .hh-advsec > h3 { font-size: 13px; margin: 0 0 4px; color: var(--ink); }

  /* -- THE BREAKDOWN. A GRID, NOT A TABLE -- because every charge carries a
     hover card, and a hover card inside an overflow-x:auto box is a clipped hover
     card. Two tracks: the claim on the left, the money on the right. */
  .hh-lines { list-style: none; margin: 8px 0 0; padding: 0; display: grid; }
  .hh-line { display: grid; grid-template-columns: minmax(0, 1fr) max-content; column-gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); position: relative; }
  .hh-lines > .hh-line:last-child { border-bottom: none; }
  .hh-lname { grid-column: 1; font-size: 13px; color: var(--ink); line-height: 1.5; overflow-wrap: anywhere; }
  .hh-lamt { grid-column: 2; grid-row: 1; text-align: right; font-family: var(--font-mono); font-size: 13px; color: var(--ink); white-space: nowrap; }
  .hh-lamt.is-mine { font-style: italic; }
  .hh-lamt.is-nil { color: var(--warn); }
  /* A BENCHMARK NEVER RENDERS AS A POINT. The range is the figure; the single
     number beneath it is only what the delivered total actually summed. */
  .hh-lamt .rng { display: block; }
  .hh-lamt .mid { display: block; font-size: 11px; color: var(--muted); margin-top: 4px; }
  .hh-lmeta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 4px; }

  /* THE ACCURACY RATING. One pill per charge, and the pill is the button that
     opens its card. Four tiers, four borders, and CITED never carries a band. */
  .hh-tierwrap { position: relative; display: inline-flex; }
  .hh-tier { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 8px; min-height: 24px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); background: transparent; color: var(--muted); cursor: pointer; white-space: nowrap; }
  /* 10px text: WCAG AA has no large-text relief here, so every tier colour is
     mixed toward var(--ink) rather than used raw. That darkens it on light and
     lightens it on dark from ONE declaration, with no theme block and no raw
     hex -- the same fix .hh-kpilabel--high already carries. */
  .hh-tier--cited { border-color: var(--success); color: color-mix(in srgb, var(--success) 70%, var(--ink)); }
  .hh-tier--indexed { border-color: var(--accent); color: color-mix(in srgb, var(--accent) 70%, var(--ink)); }
  .hh-tier--benchmark { border-color: var(--border-strong); color: var(--ink-soft); }
  .hh-tier--refused { border-color: var(--warn); color: color-mix(in srgb, var(--warn) 80%, var(--ink)); }
  .hh-tier:hover, .hh-tier:focus-visible { border-color: var(--accent); }
  /* A GROUP HEADER'S PILL IS A LABEL, NOT A BUTTON. It says what kind of
     claim every member makes and stops there: the band and the evidence
     are per component and live on the member rows. */
  .hh-tier.is-static { cursor: default; }

  /* THE HOVER CARD. Brief in the card, the argument behind "read more" -- the
     engine already splits a short hover from a long detail and renders them
     way. Anchored to the pill and constrained to the row, so it can never push
     the document sideways. Opens on hover where there IS a hover, and on click
     everywhere, because a tooltip a phone cannot open is not a tooltip. */
  .hh-hover { display: none; position: absolute; z-index: 6; top: calc(100% + 4px); left: 0; width: 320px; max-width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
  .hh-hover.is-open { display: block; }
  @media (hover: hover) { .hh-tierwrap:hover > .hh-hover, .hh-tierwrap:focus-within > .hh-hover { display: block; } }
  .hh-hbrief { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink-soft); }
  .hh-hmeta { margin: 4px 0 0; font-size: 11px; line-height: 1.5; color: var(--muted); }
  .hh-more { margin-top: 8px; min-height: 24px; padding: 4px 8px; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; background: transparent; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); color: var(--muted); cursor: pointer; }
  .hh-more:hover, .hh-more:focus-visible { border-color: var(--accent); color: var(--accent); }
  .hh-hdetail { margin-top: 8px; font-size: 12px; line-height: 1.5; color: var(--ink-soft); max-height: 240px; overflow-y: auto; overflow-x: clip; overscroll-behavior: contain; }
  .hh-hdetail p { margin: 0; overflow-wrap: anywhere; }
  .hh-hdetail a { color: var(--accent); overflow-wrap: anywhere; }

  /* GROUPED LINES. Seven permit rows are one claim, so they render as one row
     with the states one click inside it. This is the whole reason the result
     block did not grow when the accuracy rating was added to every charge. */
  .hh-sub { grid-column: 1 / -1; margin-top: 4px; }
  .hh-sub > summary { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); cursor: pointer; min-height: 24px; }
  .hh-sub > summary:hover, .hh-sub > summary:focus-visible { color: var(--accent); }
  .hh-sub .hh-lines { margin-top: 4px; padding-left: 12px; border-left: 1px solid var(--border); }
  .hh-sub .hh-line { padding: 8px 0; }
  .hh-nil { font-size: 11px; font-family: var(--font-mono); color: var(--warn); }

  /* DISCLOSED, NOT ADDED. Detention at 13 axles is $605/hr and a shipper
     expects $50-100. It belongs on the page and NOT in the total. */
  .hh-risk { border: 1px solid var(--warn); background: var(--warn-bg); border-radius: var(--radius-lg); padding: 16px; margin-top: 12px; }
  .hh-risk h3 { font-size: 15px; margin: 0 0 4px; color: var(--ink); }
  .hh-risk > p { font-size: 13px; line-height: 1.55; color: var(--ink-soft); margin: 0; }
  .hh-risk .hh-lines { margin-top: 8px; }
  .hh-risk .hh-line { border-bottom-color: var(--border); }

  .hh-legend { margin-top: 12px; }
  .hh-legend > summary { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); cursor: pointer; min-height: 24px; }
  .hh-legend > summary:hover, .hh-legend > summary:focus-visible { color: var(--accent); }
  .hh-legend dl { margin: 8px 0 0; display: grid; gap: 8px; }
  .hh-legend dt { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  .hh-legend dd { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink-soft); }

  @media (min-width: 961px) {
    /* Keep the worked example beside whatever part of the form is being filled
       in. Dropped the moment a real result renders — a result must scroll. */
    .hh-results.is-empty { position: sticky; top: 88px; }
  }
  @media (max-width: 960px) {
    .hh-grid { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 720px) {
    /* ONE COLUMN, NOT A 2+1. Three tiles side by side below this width stretch
       to the tallest of the row and put three values on three baselines. */
    .hh-split { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 640px) {
    .hh-hero h1 { font-size: 28px; }
    .hh-hero { padding: 32px 16px 12px; }
    /* 80px of bottom clearance so the last line never sits under the fixed
       chat launcher, which is bottom-right at phone widths. */
    .hh-shell { padding: 16px 16px 80px; }
    .hh-tv { font-size: 32px; }
    .hh-leg { grid-template-columns: minmax(0, 1fr) minmax(0, 92px) 44px; }
    .hh-field input, .hh-field select { font-size: 16px; }
    .hh-chips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* Two 160px address boxes are unusable. ONE COLUMN, which is the only
       other count that cannot orphan. */
    .hh-row2--addr { grid-template-columns: minmax(0, 1fr); }
    .hh-checks { grid-template-columns: minmax(0, 1fr); }
    /* In flow, not floating: a 320px popover anchored inside a 343px column is
       the whole column, so it may as well push the rows below it down rather
       than cover them. */
    .hh-hover { position: static; width: auto; box-shadow: none; margin-top: 8px; }
  }
  @media (max-width: 640px) and (hover: hover) {
    .hh-tierwrap:hover > .hh-hover, .hh-tierwrap:focus-within > .hh-hover { display: none; }
    .hh-hover.is-open { display: block; }
  }
`;

// ── Page markup ────────────────────────────────────────────────────────────

function field(
  id: string,
  label: string,
  opts: { step?: string; type?: string; imperial?: string; metric?: string; unit?: 'weight' | 'length' } = {},
): string {
  /**
   * THE UNIT-AWARE FIELD. `imperial`/`metric` carry the two titles and `unit`
   * says which conversion applies, so the client swaps the TITLE and the VALUE
   * from data on the element rather than from a table it keeps in step by hand.
   * The title stays INSIDE the field either way — see `.hh-field .hh-lab`.
   */
  const unitAttrs = opts.unit
    ? ` data-unit="${esc(opts.unit)}" data-imperial="${esc(opts.imperial ?? label)}" data-metric="${esc(opts.metric ?? label)}"`
    : '';
  return `<label class="hh-field"><input id="${esc(id)}" type="${esc(opts.type ?? 'number')}" ${opts.type === 'text' ? '' : `inputmode="decimal" step="${esc(opts.step ?? 'any')}" min="0"`} placeholder=" " autocomplete="off"${unitAttrs}><span class="hh-lab">${esc(label)}</span></label>`;
}

/** The help cue. ALWAYS top-left of the section header, exactly one per section. */
function cue(id: string): string {
  return `<button type="button" class="hh-cue" data-cue="${esc(id)}" aria-expanded="false" aria-controls="${esc(id)}" aria-label="What this section is for">?</button>`;
}

function cueBody(id: string, text: string): string {
  return `<p class="hh-cue-body" id="${esc(id)}">${esc(text)}</p>`;
}

export function renderHeavyHaulToolPage(): string {
  const covered = osowCoveredStates();
  const options = osowStateOptions();

  const stateOptionsHtml = ['<option value="">—</option>']
    .concat(
      options.map(
        (s) =>
          `<option value="${esc(s.code)}">${esc(s.name)}${s.covered ? '' : ' — not covered'}</option>`,
      ),
    )
    .join('');

  const pills = OSOW_ROUTE_CLASSES.map(
    (r) =>
      `<button type="button" class="hh-pill" data-route="${esc(r.value)}" aria-pressed="false" title="${esc(r.hint)}">${esc(r.label)}</button>`,
  ).join('');

  const notIncludedHtml = HEAVY_HAUL_NOT_INCLUDED.map(
    (n) => `<li><strong>${esc(n.item)}.</strong> ${esc(n.why)}</li>`,
  ).join('');

  const tierLegend = (['cited', 'indexed', 'benchmark', 'refused'] as const)
    .map(
      (t) =>
        `<dt>${esc(TIER_LABELS[t])}</dt><dd>${esc(TIER_MEANINGS[t])}</dd>`,
    )
    .join('');

  const body = `
  <section class="hero hh-hero">
    <div class="container-narrow">
      <p class="hh-eyebrow">Free tool &middot; no account needed</p>
      <h1>Heavy-Haul &amp; OOG Delivered-Cost Estimator</h1>
      <p class="lead">Two addresses and your cargo. That is the whole form. Axle count, trailer class and route class are worked out from the load rather than asked for, and every charge that comes back says what kind of evidence stands behind it.</p>
      <div class="hh-truth">
        <h2>Every line says what kind of number it is.</h2>
        <p><strong>State permit fees are cited to the statute or fee schedule they came from, and carry no range. Fuel is indexed to the EIA weekly diesel price. Line haul, pilot cars and accessorials are a benchmark band from published market data, always shown as a range, and replaced outright by any rates YOU enter.</strong> No margin is added, ever. A component we cannot price is named and left out, never counted as $0.</p>
      </div>
    </div>
  </section>

  <main class="hh-shell">
    <div class="hh-grid">
      <form class="hh-form" id="hh-form" novalidate>
        <div class="hh-card">
          <div class="hh-sec">${cue('cue-lane')}<h2>Pickup and delivery</h2></div>
          ${cueBody('cue-lane', 'Full US street addresses — number, street, city, state and ZIP. They are resolved by the US Census geocoder, which is free, keyless and public domain, and which refuses an address it cannot place rather than matching a different town. Two addresses are enough: we route the lane over the federal primary-road network (US Census TIGER/Line, public domain) and split it against state lines, so permits are priced per state. LOADING IS THE ONE QUESTION ONLY YOU CAN ANSWER. A filed heavy-haul tariff says cranes, hoists and winches "shall be supplied by the Consignor or Consignee" together with the people to run them — so if nobody at your pickup or your delivery has the machine, it is a real cost that nobody in your quote chain has priced. Untick the end that has none and we price it.')}
          <div class="hh-stack">
            <div class="hh-row2 hh-row2--addr">
              ${field('hh-origin', 'Pickup address', { type: 'text' })}
              ${field('hh-destination', 'Delivery address', { type: 'text' })}
            </div>
            <div class="hh-checks">
              <label class="hh-check"><input type="checkbox" id="hh-load-origin" checked><span>Loading provided at pickup</span></label>
              <label class="hh-check"><input type="checkbox" id="hh-load-destination" checked><span>Unloading provided at delivery</span></label>
            </div>
          </div>
        </div>

        <div class="hh-card">
          <div class="hh-sec">${cue('cue-cargo')}<h2>The cargo</h2></div>
          ${cueBody('cue-cargo', 'Weight and the three dimensions of the piece, in whichever system you work in — switching converts what you have already typed and never clears it. Decimals are fine: 12 ft 6 in is 12.5. Weight is what every state prices the overweight permit from, and it is also what tells us the trailer and the axle count; width, height and length decide the oversize fee band and the escort rules. Leave one blank and the states that need it say so instead of guessing.')}
          <div class="hh-units" id="hh-units" role="group" aria-label="Units">
            <button type="button" class="hh-pill" data-units="imperial" aria-pressed="true">Imperial &mdash; ft &middot; lb</button>
            <button type="button" class="hh-pill" data-units="metric" aria-pressed="false">Metric &mdash; m &middot; kg</button>
          </div>
          <div class="hh-stack">
            <div class="hh-row2">
              ${field('hh-weight', 'Gross weight (lb)', { unit: 'weight', imperial: 'Gross weight (lb)', metric: 'Gross weight (kg)' })}
              ${field('hh-length', 'Overall length (ft)', { unit: 'length', imperial: 'Overall length (ft)', metric: 'Overall length (m)' })}
            </div>
            <div class="hh-row2">
              ${field('hh-width', 'Width (ft)', { unit: 'length', imperial: 'Width (ft)', metric: 'Width (m)' })}
              ${field('hh-height', 'Height (ft)', { unit: 'length', imperial: 'Height (ft)', metric: 'Height (m)' })}
            </div>
          </div>
        </div>

        <details class="hh-adv" id="hh-adv">
          <summary id="hh-adv-summary">I have my own rates, my own filed miles, or an extra to add</summary>
          <div class="hh-advbody">
            <p class="hh-hint">Nothing here is needed for an estimate. It is here because a forwarder with a negotiated rate should be able to use it: anything you enter REPLACES our band outright, and the line then says the basis is yours rather than ours.</p>

            <div class="hh-advsec">
              <h3>Your own rates</h3>
              <div class="hh-stack">
                <div class="hh-row2">
                  ${field('hh-linehaul', 'Line haul $ / mile')}
                  ${field('hh-linehaul-min', 'Your minimum charge ($)')}
                </div>
                <div class="hh-row2">
                  ${field('hh-pc-mile', 'Pilot car $ / mile')}
                  ${field('hh-pc-day', 'Pilot car $ / day')}
                </div>
                <div class="hh-row2">
                  ${field('hh-pc-days', 'Days per state', { step: '1' })}
                  ${field('hh-pc-min', 'Pilot car minimum per state ($)')}
                </div>
                <div class="hh-row2">
                  ${field('hh-fuel-peg', 'Your FSC peg $ / gal')}
                  ${field('hh-fuel-mpg', 'Your fuel economy (mpg)')}
                </div>
              </div>
            </div>

            <div class="hh-advsec">
              <h3>The rig, if you already know it</h3>
              <div class="hh-stack">
                <div class="hh-row2">
                  ${field('hh-axles', 'Axles (incl. steer)', { step: '1' })}
                  ${field('hh-value', 'Declared cargo value ($)')}
                </div>
                <div class="hh-pills" id="hh-routeclass">${pills}</div>
                <div class="hh-checks">
                  <label class="hh-check"><input type="checkbox" id="hh-tarping"><span>Tarping requested</span></label>
                  <label class="hh-check"><input type="checkbox" id="hh-securement"><span>Cribbing / built cradle needed</span></label>
                </div>
              </div>
            </div>

            <div class="hh-advsec">
              <h3>Filed per-state miles &mdash; your figures beat ours</h3>
              <div class="hh-legs" id="hh-legs"></div>
              <div class="hh-actions">
                <button type="button" class="btn btn-secondary" id="hh-add">Add a state</button>
                <button type="button" class="btn btn-secondary" id="hh-clear-legs">Clear states</button>
              </div>
              <p class="hh-hint" id="hh-cap" hidden>${OSOW_MAX_LEGS} states is the most one lane can carry here. Remove a state to add another.</p>
              <p class="hh-hint">We hold a cited fee schedule for these ${covered.length} states: ${esc(covered.map((s) => s.code).join(' '))}. Any other state can still be added &mdash; it comes back named and unpriced, never as $0.</p>
            </div>
          </div>
        </details>

        <div class="hh-go">
          <button type="submit" class="btn btn-primary" id="hh-go">Get the delivered estimate</button>
        </div>
      </form>

      <section class="hh-results is-empty" id="hh-results" aria-live="polite">
        <div class="hh-card">
          <p class="hh-empty">Enter both addresses and the cargo, then press <strong>Get the delivered estimate</strong>. Nothing is stored and no account is needed.</p>
          <div class="hh-eg">
            <button type="button" class="btn btn-secondary" id="hh-example">See a worked example &mdash; Houston to Buffalo</button>
          </div>
          <ul class="hh-eglist">
            <li>120,000 lb &middot; 12.5 ft wide &middot; 14.5 ft high &middot; 85 ft long, loading provided at both ends.</li>
            <li>Houston, TX to Buffalo, NY &mdash; two addresses, nothing else.</li>
            <li>Eight axles, a multi-axle trailer and an interstate route class, all worked out from that.</li>
          </ul>
          <div class="hh-sec">${cue('cue-output')}<h2>What comes back</h2></div>
          ${cueBody('cue-output', 'A delivered figure with a range around it, a rating on EVERY charge saying what kind of evidence stands behind it, a line for every component including the ones we refuse to price, and a confidence score itemised into the specific facts that took points off it.')}
          <ul class="hh-eglist">
            <li><strong>An accuracy rating on every charge.</strong> Cited, indexed, benchmark or not priced &mdash; with the evidence one hover away and the full argument behind &ldquo;read more&rdquo;.</li>
            <li><strong>A cited fee carries no range</strong>, because a statute states it. <strong>A benchmark always carries one</strong>, because the market does not have a point value.</li>
            <li><strong>Detention and layover are disclosed and NOT added</strong>, because the hours are set by whoever keeps the truck waiting.</li>
            <li><strong>Named refusals.</strong> A superload line haul, a lift above 160,000 lb, a tarp above 14 ft wide &mdash; each says what to do instead, and none of them carries a number.</li>
          </ul>
        </div>
        <details class="hh-fold">
          <summary>What this estimate never includes (${HEAVY_HAUL_NOT_INCLUDED.length})</summary>
          <ul>${notIncludedHtml}</ul>
        </details>
      </section>
    </div>
  </main>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Heavy-Haul Delivered-Cost Estimator',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any',
      url: `${SITE}${HEAVY_HAUL_TOOL_PATH}`,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      description: `Free heavy-haul delivered-cost estimator: cargo dimensions and weight, pickup and delivery addresses, and a line-by-line cost breakdown with a decomposable confidence score. State permit fees cited across ${covered.length} states.`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Free Tools', item: `${SITE}/tools` },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Heavy-Haul Quote Tool',
          item: `${SITE}${HEAVY_HAUL_TOOL_PATH}`,
        },
      ],
    },
  ];

  const title = 'Heavy-Haul Quote Calculator — Delivered Cost + Confidence | QuoteFleet';
  const description = `Free heavy-haul quote tool. Enter cargo dimensions, weight and two addresses for a delivered-cost estimate with a line-by-line breakdown and a confidence score. State permit fees cited across ${covered.length} states; line haul and pilot cars priced from your own rates.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${HEAVY_HAUL_TOOL_PATH}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/nav-unify.css">
  <style>${HH_CSS}</style>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#0b0f15">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/brand/og-image-1200x630.png">
  ${jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n  ')}
</head>
<body>
  ${FULL_SITE_HEADER}
  ${body}
  ${PREMIUM_FOOTER}
  ${HEADER_SCRIPTS}
  <template id="hh-tier-legend"><details class="hh-legend"><summary>What the four ratings mean</summary><dl>${tierLegend}</dl></details></template>
  <template id="hh-leg-tpl"><div class="hh-leg">
    <label class="hh-field"><select class="hh-leg-state">${stateOptionsHtml}</select><span class="hh-lab">State</span></label>
    <label class="hh-field"><input class="hh-leg-miles" type="number" inputmode="decimal" step="any" min="0" placeholder=" " autocomplete="off"><span class="hh-lab">Miles in state</span></label>
    <button type="button" class="hh-legdrop" aria-label="Remove this state">&times;</button>
  </div></template>
  <script src="/heavy-haul-quote.js" defer></script>
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
</body>
</html>`;
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function registerHeavyHaulQuoteRoutes(app: Express) {
  // Zero-network worked example. See `SEEDED_ENDPOINTS`.
  seedGeocodeCache(SEEDED_ENDPOINTS);

  app.get(
    [HEAVY_HAUL_TOOL_PATH, `${HEAVY_HAUL_TOOL_PATH}/`],
    (req: Request, res: Response, next) => {
      try {
        // Byte-identical for every visitor — a static form over compiled data,
        // no DB read and no per-user branch. Exactly the CDN-cacheable shape.
        setPublicDirectoryCache(req, res);
        res.type('html').send(renderHeavyHaulToolPage());
      } catch (err) {
        next(err);
      }
    },
  );

  app.get('/api/tools/heavy-haul-quote/coverage', (_req: Request, res: Response) => {
    return res.json({
      coveredStates: osowCoveredStates(),
      allStates: osowStateOptions(),
      routeClasses: OSOW_ROUTE_CLASSES,
      mileageTiers: MILEAGE_TIERS,
      confidence: {
        highMin: CONFIDENCE_HIGH_MIN,
        mediumMin: CONFIDENCE_MEDIUM_MIN,
        bands: CONFIDENCE_BANDS,
      },
      notIncluded: HEAVY_HAUL_NOT_INCLUDED,
      /**
       * THE ACCURACY LEGEND AND THE SOURCE REGISTER, served alongside the
       * coverage list so the page can render the tier pills and a "where these
       * numbers come from" panel without hardcoding either.
       *
       * `sources` deliberately carries `refetch` on every row: it is the field
       * that says whether a figure can be put on a cron or whether it ages
       * silently until somebody re-reads a PDF, and that is worth showing.
       */
      accuracyTiers: (['cited', 'indexed', 'benchmark', 'refused'] as const).map((t) => ({
        tier: t,
        label: TIER_LABELS[t],
        meaning: TIER_MEANINGS[t],
        defaultBandPct: TIER_DEFAULT_BAND_PCT[t],
      })),
      sources: MARKET_SOURCES,
      permitsOnlyTool: OSOW_TOOL_PATH,
      disclaimer: HEAVY_HAUL_DISCLAIMER,
    });
  });

  app.post(
    '/api/tools/heavy-haul-quote',
    publicCalcLimiter,
    async (req: Request, res: Response, next) => {
      try {
        const parsed = HeavyHaulRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          return res.status(400).json({
            error: first ? `Invalid input: ${first.message}` : 'Invalid input',
            details: parsed.error.flatten(),
          });
        }

        const asOf = parsed.data.asOf;
        if (asOf !== undefined && (asOf < OSOW_ASOF_MIN || asOf > todayIso())) {
          return res.status(400).json({
            error: `asOf must fall between ${OSOW_ASOF_MIN} and ${todayIso()} — the range the fee schedules on file are effective for. Outside it whole schedules are out of effect and the answer would be $0 for a date we hold no data for.`,
          });
        }

        const legs = parsed.data.legs ?? [];
        const codes = legs.map((l) => l.state.toUpperCase());
        const duplicate = codes.find((c, i) => codes.indexOf(c) !== i);
        if (duplicate) {
          return res.status(400).json({
            error: `${duplicate} is listed twice. Put a state's total in-state miles on one row — a re-entered state is billed once by its issuing agency.`,
          });
        }
        // `stateByCode` SYNTHESIZES an entry for an unrecognised code, so it can
        // never report an unknown one. The membership set is the real check, and
        // it is the FORM's list — the wider directory set carries PR/VI/GU,
        // which no mainland lane reaches by road.
        const unknown = codes.find((c) => !OSOW_SELECTABLE_STATE_CODES.has(c));
        if (unknown) {
          return res.status(400).json({
            error: US_STATE_CODES.has(unknown)
              ? `"${unknown}" is a US territory, not one of the 50 states or DC this calculator covers. It is not reachable by road from the mainland.`
              : `"${unknown}" is not a US state code.`,
          });
        }

        // ── Geocoding. FAILS CLOSED: an address we cannot place stops the
        // quote with the reason attached, rather than producing a lane
        // measured from a guess.
        const [origin, destination] = await Promise.all([
          geocodeAddress(parsed.data.originAddress),
          geocodeAddress(parsed.data.destinationAddress),
        ]);
        const originPoint = toEndpoint(parsed.data.originAddress, origin);
        const destinationPoint = toEndpoint(parsed.data.destinationAddress, destination);
        if (!originPoint || !destinationPoint) {
          const failures = [
            ...(originPoint ? [] : [{ field: 'originAddress', ...(origin as { reason: string; code: string }) }]),
            ...(destinationPoint
              ? []
              : [{ field: 'destinationAddress', ...(destination as { reason: string; code: string }) }]),
          ];
          return res.status(422).json({
            error: failures.map((f) => f.reason).join(' '),
            unresolved: failures.map((f) => ({ field: f.field, code: f.code, reason: f.reason })),
          });
        }

        const diesel = await resolveDieselReading();
        const lane = { origin: originPoint, destination: destinationPoint };
        return res.json(
          priceResolvedHeavyHaulLane(parsed.data, lane, diesel, measureLaneMileage(lane)),
        );
      } catch (err) {
        next(err);
      }
    },
  );
}
