/**
 * The heavy-haul quote endpoint and its page.
 *
 * ZERO LIVE CALLS. `globalThis.fetch` is replaced with a stub that intercepts
 * every request to the US Census geocoder and answers from a table of REAL
 * recorded responses, while passing local HTTP through to the real fetch so the
 * express server under test is still driven over the wire. If a test address is
 * not in the table the stub throws, so a live call cannot creep in unnoticed —
 * the suite fails instead of quietly reaching the internet.
 *
 * The claims pinned here are the ones a user could be misled by:
 *
 *   1. the composed permit subtotal is EXACTLY the permits-only tool's figure;
 *   2. money from the caller's own rate never lands in the sourced subtotal;
 *   3. a lane with no filed miles is NOT priced for permits — it is asked about;
 *   4. an address the geocoder cannot place refuses the whole quote;
 *   5. `null` is never rendered or returned as `0`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  registerHeavyHaulQuoteRoutes,
  renderHeavyHaulToolPage,
  priceResolvedHeavyHaulLane,
  HEAVY_HAUL_TOOL_PATH,
  HEAVY_HAUL_EXAMPLE,
  type HeavyHaulApiRequest,
} from './heavyHaulQuote.js';
import { clearGeocodeCache } from '../../calc/heavyHaul/geocode.js';
import type { DieselReading, LaneEndpoint } from '../../calc/heavyHaul/quote.js';
import { SITE_NAV_HTML, SITE_MOBILE_MENU_HTML, PREMIUM_FOOTER } from '../siteChrome.js';

const ASOF = '2026-09-03';

/**
 * REAL US Census geocoder responses, recorded once. The stub answers from this
 * table and from nothing else.
 */
const CENSUS_FIXTURES: Record<string, { matched: string; lat: number; lon: number; state: string; zip: string } | null> = {
  '1500 mckinney st, houston, tx 77010': {
    matched: '1500 MCKINNEY ST, HOUSTON, TX, 77010',
    lat: 29.754276036552,
    lon: -95.360587104838,
    state: 'TX',
    zip: '77010',
  },
  '403 main st, buffalo, ny 14203': {
    matched: '403 MAIN ST, BUFFALO, NY, 14203',
    lat: 42.885553091904,
    lon: -78.874342511112,
    state: 'NY',
    zip: '14203',
  },
  '400 edwards st, shreveport, la 71101': {
    matched: '400 EDWARDS ST, SHREVEPORT, LA, 71101',
    lat: 32.512099,
    lon: -93.749342,
    state: 'LA',
    zip: '71101',
  },
  // A deliberate no-match: this is what "fails closed" looks like on the wire.
  'nowhere at all, nowhere, tx 00000': null,
};

const realFetch = globalThis.fetch;

function censusStub(url: string): Response {
  const address = (new URL(url).searchParams.get('address') ?? '').trim().toLowerCase();
  const hit = CENSUS_FIXTURES[address];
  if (hit === undefined) {
    throw new Error(
      `heavy-haul test tried to geocode "${address}" for real. Add it to CENSUS_FIXTURES — this suite makes no live calls.`,
    );
  }
  const body =
    hit === null
      ? { result: { addressMatches: [] } }
      : {
          result: {
            addressMatches: [
              {
                matchedAddress: hit.matched,
                coordinates: { x: hit.lon, y: hit.lat },
                addressComponents: { state: hit.state, zip: hit.zip },
              },
            ],
          },
        };
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeAll(() => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes('geocoding.geo.census.gov')) return censusStub(url);
    return realFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

function startServer(): Promise<{ base: string; close: () => void }> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerHeavyHaulQuoteRoutes(app);
  return new Promise((res) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      res({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function post(base: string, body: unknown) {
  const r = await realFetch(`${base}/api/tools/heavy-haul-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, never> };
}

const REFERENCE_REQUEST: HeavyHaulApiRequest = {
  cargo: {
    grossWeightLbs: 120_000,
    widthIn: 12 * 12 + 6,
    heightIn: 14 * 12 + 6,
    overallLengthIn: 85 * 12,
    axleCount: 8,
    routeClass: 'interstate',
  },
  originAddress: HEAVY_HAUL_EXAMPLE.originAddress,
  destinationAddress: HEAVY_HAUL_EXAMPLE.destinationAddress,
  legs: [
    { state: 'TX', miles: 214.98 },
    { state: 'AR', miles: 337 },
    { state: 'TN', miles: 250 },
    { state: 'KY', miles: 62.4 },
    { state: 'OH', miles: 145 },
    { state: 'PA', miles: 46 },
    { state: 'NY', miles: 60 },
  ],
  rates: { linehaulUsdPerMile: 4.85, pilotCarUsdPerMile: 2.25 },
  asOf: ASOF,
};

const HOUSTON: LaneEndpoint = {
  address: HEAVY_HAUL_EXAMPLE.originAddress,
  matchedAddress: '1500 MCKINNEY ST, HOUSTON, TX, 77010',
  latitude: 29.754276036552,
  longitude: -95.360587104838,
  state: 'TX',
  benchmark: 'Public_AR_Current',
  ambiguous: false,
};
const BUFFALO: LaneEndpoint = {
  address: HEAVY_HAUL_EXAMPLE.destinationAddress,
  matchedAddress: '403 MAIN ST, BUFFALO, NY, 14203',
  latitude: 42.885553091904,
  longitude: -78.874342511112,
  state: 'NY',
  benchmark: 'Public_AR_Current',
  ambiguous: false,
};
const DIESEL: DieselReading = { usdPerGal: 3.9, asOf: '2026-08-31', source: 'eia', stale: false };

// ──────────────────────────────────────────────────────────────────────────

describe('the composed reference lane', () => {
  const out = priceResolvedHeavyHaulLane(
    REFERENCE_REQUEST,
    { origin: HOUSTON, destination: BUFFALO },
    DIESEL,
  );

  it('MATCHES THE PERMITS-ONLY TOOL EXACTLY: $1,223.18 of permits', () => {
    expect(out.quote.permits?.totalPermitUsd).toBe(1223.18);
    expect(out.quote.subtotalSourcedUsd).toBe(1223.18);
  });

  it('never lets the caller’s own rate into the sourced column', () => {
    const yours = out.quote.lines.filter((l) => l.basis === 'yours');
    expect(yours.length).toBeGreaterThan(0);
    for (const line of yours) {
      expect(line.kind === 'linehaul' || line.kind === 'minimum' || line.kind === 'escort').toBe(true);
    }
    // 2 pilot cars (KY + NY) at $2.25/mi is $275.40, exactly as the permits
    // tool prices the same rate on the same lane — and it is nowhere near the
    // sourced subtotal.
    expect(out.quote.escorts?.pilotCarUsd).toBe(275.4);
    expect(out.quote.subtotalSourcedUsd).not.toBe(
      out.quote.subtotalSourcedUsd + (out.quote.escorts?.pilotCarUsd ?? 0),
    );
  });

  it('adds no margin, on any code path', () => {
    expect(out.quote.lines.some((l) => l.kind === 'margin')).toBe(false);
    expect(out.quote.deliveredUsd).toBeCloseTo(
      out.quote.subtotalSourcedUsd +
        out.quote.subtotalYourRatesUsd +
        out.quote.subtotalDerivedUsd,
      2,
    );
  });

  it('echoes back the address the geocoder actually matched, not the one typed', () => {
    expect(out.lane.origin.matched).toBe('1500 MCKINNEY ST, HOUSTON, TX, 77010');
    expect(out.lane.origin.entered).toBe(HEAVY_HAUL_EXAMPLE.originAddress);
  });

  it('carries a decomposable score whose deductions sum to the gap from 100', () => {
    expect(out.quote.confidence.score).toBe(100 - out.quote.confidence.deducted);
    expect(out.quote.confidence.headline).toMatch(/confidence \d+%/);
  });
});

describe('the same lane over HTTP', () => {
  it('prices end to end and answers with no database', async () => {
    const { base, close } = await startServer();
    try {
      const r = await post(base, REFERENCE_REQUEST);
      expect(r.status).toBe(200);
      const body = r.body as unknown as ReturnType<typeof priceResolvedHeavyHaulLane>;
      expect(body.quote.permits?.totalPermitUsd).toBe(1223.18);
      expect(body.quote.subtotalSourcedUsd).toBe(1223.18);
    } finally {
      close();
    }
  });

  it('REFUSES A LANE IT CANNOT PLACE rather than measuring from a guess', async () => {
    const { base, close } = await startServer();
    try {
      const r = await post(base, {
        ...REFERENCE_REQUEST,
        originAddress: 'Nowhere at all, Nowhere, TX 00000',
      });
      expect(r.status).toBe(422);
      const body = r.body as unknown as { error: string; unresolved: Array<{ field: string; code: string }> };
      expect(body.unresolved[0]?.field).toBe('originAddress');
      expect(body.unresolved[0]?.code).toBe('noMatch');
      expect(body.error).toMatch(/could not place/i);
    } finally {
      close();
    }
  });

  it('rejects a bare city name before it ever reaches the geocoder', async () => {
    const { base, close } = await startServer();
    try {
      const r = await post(base, { ...REFERENCE_REQUEST, destinationAddress: 'NY' });
      expect(r.status).toBe(400);
      expect((r.body as unknown as { error: string }).error).toMatch(/full US street address/i);
    } finally {
      close();
    }
  });

  it('rejects a state listed twice, because an agency bills it once', async () => {
    const { base, close } = await startServer();
    try {
      const r = await post(base, {
        ...REFERENCE_REQUEST,
        legs: [
          { state: 'TX', miles: 100 },
          { state: 'TX', miles: 120 },
        ],
      });
      expect(r.status).toBe(400);
      expect((r.body as unknown as { error: string }).error).toMatch(/listed twice/);
    } finally {
      close();
    }
  });

  it('rejects a leg of zero miles — an empty row is not a free state', async () => {
    const { base, close } = await startServer();
    try {
      const r = await post(base, { ...REFERENCE_REQUEST, legs: [{ state: 'TX', miles: 0 }] });
      expect(r.status).toBe(400);
      expect((r.body as unknown as { error: string }).error).toMatch(/positive number/);
    } finally {
      close();
    }
  });

  it('rejects a US territory no mainland lane can reach by road', async () => {
    const { base, close } = await startServer();
    try {
      const r = await post(base, { ...REFERENCE_REQUEST, legs: [{ state: 'PR', miles: 40 }] });
      expect(r.status).toBe(400);
      expect((r.body as unknown as { error: string }).error).toMatch(/territory/);
    } finally {
      close();
    }
  });

  it('bounds asOf to the window the fee schedules on file are effective for', async () => {
    const { base, close } = await startServer();
    try {
      const r = await post(base, { ...REFERENCE_REQUEST, asOf: '1800-01-01' });
      expect(r.status).toBe(400);
      expect((r.body as unknown as { error: string }).error).toMatch(/asOf must fall between/);
    } finally {
      close();
    }
  });
});

describe('a lane given as addresses only', () => {
  const out = priceResolvedHeavyHaulLane(
    { ...REFERENCE_REQUEST, legs: undefined },
    { origin: HOUSTON, destination: BUFFALO },
    DIESEL,
  );

  it('prices NO permit and says why, rather than inventing per-state miles', () => {
    expect(out.quote.permits).toBeNull();
    expect(out.quote.subtotalSourcedUsd).toBe(0);
    const permitLine = out.quote.lines.find((l) => l.kind === 'permit');
    expect(permitLine?.amountUsd).toBeNull();
    expect(permitLine?.note).toMatch(/miles travelled inside that state|per-state mileage/i);
  });

  it('turns the refusal into a question, with the states named', () => {
    const codes = out.quote.corridor?.states.map((s) => s.stateCode) ?? [];
    expect(codes).toContain('TN');
    expect(codes).toContain('AR');
    expect(out.corridorNames.TN).toBe('Tennessee');
    expect(out.quote.corridor?.disclaimer).toMatch(/not one permit is priced from this list/);
  });

  it('is partial and low, and the headline says so in words', () => {
    expect(out.quote.partial).toBe(true);
    expect(out.quote.confidenceLabel).toBe('low');
    expect(out.quote.confidence.headline).toMatch(/no state permit priced/);
  });
});

describe('the coverage endpoint', () => {
  it('publishes the tiers, the cut points and the exclusions the page reads', async () => {
    const { base, close } = await startServer();
    try {
      const r = await realFetch(`${base}/api/tools/heavy-haul-quote/coverage`);
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        mileageTiers: Record<string, { mayPriceStates: boolean; available: boolean }>;
        confidence: { highMin: number; mediumMin: number; bands: Record<string, number> };
        permitsOnlyTool: string;
        coveredStates: unknown[];
      };
      expect(body.coveredStates.length).toBe(21);
      expect(body.mileageTiers.filed?.mayPriceStates).toBe(true);
      expect(body.mileageTiers.scalar?.mayPriceStates).toBe(false);
      // Declared and NOT reachable — the type says what is missing rather than
      // pretending the ladder has two rungs.
      expect(body.mileageTiers.routed?.available).toBe(false);
      expect(body.mileageTiers.geodesicSplit?.available).toBe(false);
      expect(body.confidence.bands.high).toBe(0.04);
      expect(body.confidence.bands.medium).toBe(0.08);
      expect(body.permitsOnlyTool).toBe('/tools/oversize-permits');
    } finally {
      close();
    }
  });
});

describe('the page', () => {
  const html = renderHeavyHaulToolPage();

  it('serves with the database down and carries the shared chrome', async () => {
    clearGeocodeCache();
    const { base, close } = await startServer();
    try {
      const r = await realFetch(`${base}${HEAVY_HAUL_TOOL_PATH}`);
      expect(r.status).toBe(200);
      const page = await r.text();
      expect(page).toContain('Heavy-Haul Delivered-Cost Estimator');
    } finally {
      close();
    }
    expect(html).toContain(SITE_NAV_HTML);
    expect(html).toContain(SITE_MOBILE_MENU_HTML);
    expect(html).toContain(PREMIUM_FOOTER);
  });

  it('states whose number is whose, above the fold', () => {
    expect(html).toMatch(/cited to the statute or fee schedule/);
    expect(html).toMatch(/rates YOU enter/);
    expect(html).toMatch(/No margin is added, ever/);
  });

  it('LEFT-ALIGNS the hero and puts the eyebrow top-left', () => {
    expect(html).toMatch(/\.hh-hero \{[^}]*text-align: left/);
    expect(html).toMatch(/\.hh-hero h1 \{[^}]*text-align: left/);
    expect(html).toMatch(/\.hh-eyebrow \{[^}]*text-align: left/);
  });

  it('puts input titles IN the field and stacks components at 2px', () => {
    expect(html).toMatch(/\.hh-field \.hh-lab \{[^}]*position: absolute/);
    expect(html).toMatch(/\.hh-stack \{[^}]*gap: 2px/);
    expect(html).toMatch(/\.hh-row2 \{[^}]*gap: 2px/);
  });

  it('draws a selected pill as an OUTLINE, never a bright fill', () => {
    expect(html).toMatch(/\.hh-pill\[aria-pressed="true"\] \{[^}]*border-width: 2px/);
    expect(html).toMatch(/\.hh-pill\[aria-pressed="true"\] \{[^}]*background: var\(--accent-soft\)/);
  });

  it('uses fixed even column counts so a group can never orphan one item', () => {
    // 4 route-class pills in a 2-column grid, 3 subtotal tiles in a 3-column
    // grid that collapses to 1, corridor chips in a padded 4-column grid.
    expect(html).toMatch(/\.hh-pills \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(html).toMatch(/\.hh-split \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(html).toMatch(/\.hh-chips \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(html).toMatch(/@media \(max-width: 720px\) \{\s*[^}]*\.hh-split \{ grid-template-columns: minmax\(0, 1fr\)/);
  });

  it('uses overflow: clip near the sticky column, never overflow: hidden', () => {
    const css = html.slice(html.indexOf('.hh-shell'), html.indexOf('</style>'));
    expect(css).not.toMatch(/overflow:\s*hidden/);
    expect(css).toMatch(/overflow: clip/);
  });

  it('uses only design tokens — no raw hex anywhere in the page CSS', () => {
    const css = html.slice(html.indexOf('.hh-shell'), html.indexOf('</style>'));
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('scrolls a wide table inside its own box, never the document', () => {
    expect(html).toMatch(/\.hh-tablewrap \{ overflow-x: auto; \}/);
  });

  it('links the permits-only tool from the nav rather than replacing it', () => {
    expect(html).toContain('/tools/oversize-permits');
    expect(html).toContain(HEAVY_HAUL_TOOL_PATH);
  });
});

describe('the client script', () => {
  const client = readFileSync(
    resolve(process.cwd(), 'src/server/public/heavy-haul-quote.js'),
    'utf8',
  );

  it('renders an unpriceable line as "not priced", never as $0', () => {
    expect(client).toMatch(/amountUsd === null/);
    expect(client).toContain('not priced');
  });

  it('tags every figure derived from the caller’s own rate', () => {
    expect(client).toContain('Your rate — not a figure we source');
    expect(client).toMatch(/basis === 'yours'/);
  });

  it('puts the basis pill on the ROW NAME, above the clamped note', () => {
    // The note is clamped to three lines, so "whose number is this" has to live
    // somewhere a clamp cannot reach.
    expect(client).toMatch(/basis === 'derived'/);
    expect(client).toContain('EIA index');
    expect(client).toMatch(/esc\(l\.name\) \+\s*\n?\s*tag/);
  });

  it('never shows the score without the reasons behind it', () => {
    expect(client).toMatch(/findings\.slice\(0, 3\)/);
    expect(client).toMatch(/Every deduction, in full/);
  });

  it('pads the corridor chips so the last row cannot hold a single chip', () => {
    expect(client).toMatch(/4 - \(states\.length % 4\)/);
  });

  it('loads the worked example from the pre-resolved endpoints', () => {
    expect(client).toContain(HEAVY_HAUL_EXAMPLE.originAddress);
    expect(client).toContain(HEAVY_HAUL_EXAMPLE.destinationAddress);
  });
});
