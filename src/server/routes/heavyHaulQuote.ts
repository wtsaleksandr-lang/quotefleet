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
  CONFIDENCE_HIGH_MIN,
  CONFIDENCE_MEDIUM_MIN,
  CONFIDENCE_BANDS,
} from '../../calc/heavyHaul/confidence.js';
import {
  geocodeAddress,
  seedGeocodeCache,
  type GeocodeResult,
} from '../../calc/heavyHaul/geocode.js';
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
 * Price a request whose addresses are already resolved. Pure — exported so the
 * tests exercise exactly the path the route does, with no network at all.
 */
export function priceResolvedHeavyHaulLane(
  input: HeavyHaulApiRequest,
  lane: { origin: LaneEndpoint; destination: LaneEndpoint },
  diesel: DieselReading,
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
  .hh-tile .n { font-size: 12px; color: var(--muted); line-height: 1.5; display: block; margin-top: 4px; }

  .hh-note { border-radius: var(--radius-lg); padding: 16px; margin-top: 12px; border: 1px solid var(--border); background: var(--surface); }
  .hh-note h3 { font-size: 15px; margin: 0 0 8px; color: var(--ink); }
  .hh-note p, .hh-note li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }
  .hh-note ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
  .hh-note--warn { border-color: var(--warn); background: var(--warn-bg); }
  .hh-note--error { border-color: var(--error); background: var(--error-bg); }

  /* ── The breakdown. One table, every line, basis stated per row. ───────── */
  .hh-linesbox { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; margin-top: 12px; }
  .hh-linesbox > h3 { font-size: 15px; margin: 0 0 4px; color: var(--ink); }
  /* The safety net, not the plan. TWO columns fit 375px natively — unlike the
     permits page's seven money columns, which genuinely need an inner scroll —
     so the table carries NO min-width and nothing here ever scrolls sideways.
     The wrapper stays because a future column would otherwise push the document
     itself sideways, and that is the one failure this page must not have. */
  .hh-tablewrap { overflow-x: auto; }
  .hh-lines { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  .hh-lines td:first-child, .hh-lines th:first-child { width: auto; }
  .hh-lines td.num, .hh-lines th.num { width: 88px; }
  .hh-lines th, .hh-lines td { text-align: left; padding: 8px 8px 8px 0; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--ink-soft); }
  .hh-lines th { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
  .hh-lines td.num, .hh-lines th.num { text-align: right; padding-right: 0; font-family: var(--font-mono); color: var(--ink); white-space: nowrap; }
  /* USER-SOURCED money inside a table that also holds cited money. Never the
     same treatment — italic amount plus a dashed YOUR RATE pill on the name. */
  .hh-lines td.mine { font-style: italic; }
  .hh-lines td.nil { color: var(--warn); font-style: normal; }
  .hh-lines tbody tr:last-child td { border-bottom: none; }
  .hh-lines .hh-tot td { font-weight: 700; color: var(--ink); border-top: 2px solid var(--border-strong); border-bottom: none; padding-top: 12px; }
  /* THE LINE NOTE, CLAMPED TO THREE LINES — the same treatment .ow-reason gets
     on the permits page, and for the same reason. The fuel line's model note
     runs to six lines at 375px and the seven permit rows each carry their own
     fee arithmetic; unclamped they turned a 4,000px result into a 6,500px one.
     Nothing is lost: every note is repeated VERBATIM and in full in the
     per-state disclosure directly beneath, whose summary carries the count.
     overflow: clip, never hidden — hidden breaks position: sticky. */
  .hh-ln { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: clip; font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 4px; overflow-wrap: anywhere; }
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
  }
`;

// ── Page markup ────────────────────────────────────────────────────────────

function field(
  id: string,
  label: string,
  opts: { step?: string; type?: string } = {},
): string {
  return `<label class="hh-field"><input id="${esc(id)}" type="${esc(opts.type ?? 'number')}" ${opts.type === 'text' ? '' : `inputmode="decimal" step="${esc(opts.step ?? 'any')}" min="0"`} placeholder=" " autocomplete="off"><span class="hh-lab">${esc(label)}</span></label>`;
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

  const body = `
  <section class="hero hh-hero">
    <div class="container-narrow">
      <p class="hh-eyebrow">Free tool · no account needed</p>
      <h1>Heavy-Haul Delivered-Cost Estimator</h1>
      <p class="lead">Enter the cargo, an address at each end, and your own line-haul rate. You get a delivered-cost estimate, a line-by-line breakdown that says where every number came from, and a confidence score you can take apart.</p>
      <div class="hh-truth">
        <h2>Every line says whose number it is.</h2>
        <p><strong>State permit fees are cited to the statute or fee schedule they came from. Line haul and pilot cars are computed from the rates YOU enter — we hold no market rates and will not invent one. Fuel comes from the EIA weekly diesel index through a surcharge model whose peg and fuel economy are our assumptions.</strong> No margin is added, ever. A component we cannot price is named and left out, never counted as $0.</p>
      </div>
    </div>
  </section>

  <main class="hh-shell">
    <div class="hh-grid">
      <form class="hh-form" id="hh-form" novalidate>
        <div class="hh-card">
          <div class="hh-sec">${cue('cue-cargo')}<h2>The cargo</h2></div>
          ${cueBody('cue-cargo', 'Gross weight is what every state prices the overweight permit from. Width, height and overall length decide the oversize fee band and the escort rules — leave one blank and the states that need it will say so instead of guessing.')}
          <div class="hh-stack">
            ${field('hh-weight', 'Gross weight (lb)', { step: '1' })}
            <div class="hh-row2">
              ${field('hh-width-ft', 'Width (ft)', { step: '1' })}
              ${field('hh-width-in', 'Width (in)', { step: '1' })}
            </div>
            <div class="hh-row2">
              ${field('hh-height-ft', 'Height (ft)', { step: '1' })}
              ${field('hh-height-in', 'Height (in)', { step: '1' })}
            </div>
            <div class="hh-row2">
              ${field('hh-length-ft', 'Overall length (ft)', { step: '1' })}
              ${field('hh-axles', 'Axles (incl. steer)', { step: '1' })}
            </div>
          </div>
        </div>

        <div class="hh-card">
          <div class="hh-sec">${cue('cue-lane')}<h2>Point A to point B</h2></div>
          ${cueBody('cue-lane', 'Full US street addresses — number, street, city, state and ZIP. They are resolved by the US Census geocoder, which is free, keyless and public domain, and which refuses an address it cannot place rather than matching a different town. We show you what it matched so you can check it. Two addresses give a LANE TOTAL and no per-state mileage, which is enough to price line haul and not enough to price a permit.')}
          <div class="hh-stack">
            ${field('hh-origin', 'Pickup address', { type: 'text' })}
            ${field('hh-destination', 'Delivery address', { type: 'text' })}
          </div>
        </div>

        <div class="hh-card">
          <div class="hh-sec">${cue('cue-route')}<h2>Road type</h2></div>
          ${cueBody('cue-route', 'Escort rules are written per road class. Pick the class most of the move runs on. States that classify their own highways will leave those rules unresolved and say so in their notes rather than assume an answer.')}
          <div class="hh-pills" id="hh-routeclass">${pills}</div>
        </div>

        <div class="hh-card">
          <div class="hh-sec">${cue('cue-rates')}<h2>Your rates</h2></div>
          ${cueBody('cue-rates', 'Your line-haul rate is the one number this tool cannot supply. The engine that prices line haul reads a carrier rate card and needs an account, so a public tool has no honest way to produce a market rate — and a made-up per-mile figure sitting beside cited statute numbers would be the one dishonest line on the page. Same for pilot cars: no state publishes a rate, and your negotiated figure beats any range we could invent. A day rate needs a day count — a rate without one is not a price, and one day is not a safe default.')}
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
          <p class="hh-hint">Blank is a valid answer. Anything left blank comes back named and excluded, and costs the confidence score points — never quietly $0. Leave the peg and mpg blank and we use the standard OOIDA figures ($1.25/gal, 6 mpg) and label them as ours; fill them in and the fuel line becomes your model on our sourced diesel price.</p>
        </div>

        <div class="hh-card">
          <div class="hh-sec">${cue('cue-miles')}<h2>Filed per-state miles — unlocks permits</h2></div>
          ${cueBody('cue-miles', 'These are YOUR miles, not ours. We do not route the lane. Type the per-state mileage your PC*Miler or ProMiles run produced — the same figures that go on the permit application, which is why they are the miles the state will bill. Leave this empty and the quote comes back with no permit money in it and says so; fill it in and every covered state is priced from a cited fee schedule.')}
          <div class="hh-legs" id="hh-legs"></div>
          <div class="hh-actions">
            <button type="button" class="btn btn-secondary" id="hh-add">Add a state</button>
            <button type="button" class="btn btn-secondary" id="hh-clear-legs">Clear states</button>
          </div>
          <p class="hh-hint" id="hh-cap" hidden>${OSOW_MAX_LEGS} states is the most one lane can carry here. Remove a state to add another.</p>
          <p class="hh-hint">We hold a cited fee schedule for these ${covered.length} states: ${esc(covered.map((s) => s.code).join(' '))}. Any other state can still be added — it comes back named and unpriced, never as $0.</p>
        </div>

        <div class="hh-go">
          <button type="submit" class="btn btn-primary" id="hh-go">Get the delivered estimate</button>
        </div>
      </form>

      <section class="hh-results is-empty" id="hh-results" aria-live="polite">
        <div class="hh-card">
          <p class="hh-empty">Fill in the cargo and both addresses, then press <strong>Get the delivered estimate</strong>. Nothing is stored and no account is needed.</p>
          <div class="hh-eg">
            <button type="button" class="btn btn-secondary" id="hh-example">See a worked example — Houston to Buffalo</button>
          </div>
          <ul class="hh-eglist">
            <li>120,000 lb · 12'6" wide · 14'6" high · 85 ft · 8 axles, interstate.</li>
            <li>Houston, TX to Buffalo, NY, with the filed miles inside all seven states.</li>
            <li>A $4.85/mi line-haul rate and a $1.95/mi pilot-car rate — both entered as yours.</li>
          </ul>
          <div class="hh-sec">${cue('cue-output')}<h2>What comes back</h2></div>
          ${cueBody('cue-output', 'A delivered figure with a range around it, the three subtotals kept apart (money we sourced, money from your rates, money derived from an index), a line for every component including the ones we could not price, and a confidence score itemised into the specific facts that took points off it.')}
          <ul class="hh-eglist">
            <li><strong>Money we SOURCED, money from YOUR rates, and money DERIVED</strong> — three subtotals, never blended into one.</li>
            <li><strong>A confidence score you can take apart</strong> — every deduction names the engine field it keys on and whether its weight is measured or our judgement.</li>
            <li><strong>Named gaps.</strong> An uncovered state, a superload, a missing rate — each appears as its own line with no dollar figure, never as $0.</li>
            <li><strong>The statute behind each permit line</strong>, effective-dated, per state.</li>
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
        return res.json(
          priceResolvedHeavyHaulLane(
            parsed.data,
            { origin: originPoint, destination: destinationPoint },
            diesel,
          ),
        );
      } catch (err) {
        next(err);
      }
    },
  );
}
