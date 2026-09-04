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
import {
  SITE_NAV_HTML,
  SITE_MOBILE_MENU_HTML,
  PREMIUM_FOOTER,
  FULL_SITE_HEADER,
  HEADER_OOG_CTA,
  FOOTER_OOG_CTA,
  OOG_QUOTE_HREF,
} from '../siteChrome.js';

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
        out.quote.subtotalDerivedUsd +
        out.quote.subtotalMarketUsd,
      2,
    );
  });

  it('derives what the shipper cannot answer, and LABELS every one as derived', () => {
    // The reference request supplies an axle count and a route class, so those
    // come back as 'supplied'. Nothing else does, and the trailer class and the
    // piece weight are worked out from the weight the shipper does know.
    const d = out.quote.derived;
    expect(d).not.toBeNull();
    expect(d?.equipmentClass.value).toBe('multiAxle');
    expect(d?.equipmentClass.origin).toBe('derived');
    expect(d?.equipmentClass.from).toMatch(/120,000 lb gross/);
    expect(d?.axleCount.origin).toBe('supplied');
    expect(d?.cargoWeightLbs.origin).toBe('derived');
    expect(d?.cargoWeightLbs.from).toMatch(/less 45,000 lb of tractor and trailer/);
  });

  it('discloses detention and layover without adding either to the total', () => {
    const codes = out.quote.riskLines.map((r) => r.code);
    expect(codes).toContain('risk_detention');
    expect(codes).toContain('risk_layover');
    for (const r of out.quote.riskLines) expect(r.inTotal).toBe(false);
    // 8 axles: $150 + 8 x $25 = $350/hr after two free hours at each end.
    const detention = out.quote.riskLines.find((r) => r.code === 'risk_detention');
    expect(detention?.headlineUsd).toBe(350);
    // BENCHMARK, not CITED: it comes from a filed carrier tariff, which binds
    // the carrier that filed it and not the one this shipper has yet to pick.
    // The band it carries is the tell -- a cited figure would not need one.
    expect(detention?.accuracy.tier).toBe('benchmark');
    expect(detention?.accuracy.hover).toMatch(/not a statute/);
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
      // Tier 1 is now REACHABLE: routed in process over the federal
      // primary-road network, and allowed to price a distance-priced state.
      expect(body.mileageTiers.routedPrimaryNetwork?.available).toBe(true);
      expect(body.mileageTiers.routedPrimaryNetwork?.mayPriceStates).toBe(true);
      // Still declared and NOT reachable — a straight line intersected with
      // state polygons measured per-state error from -100% to +780%, and the
      // type says so rather than leaving a silent gap.
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

  // ── THE SHIPPER FORM ─────────────────────────────────────────────────

  it('asks for the two addresses SIDE BY SIDE, not stacked', () => {
    expect(html).toContain('hh-row2 hh-row2--addr');
    expect(html).toMatch(/\.hh-row2--addr \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    // One column at 640px, which is the only other count that cannot orphan.
    expect(html).toMatch(/\.hh-row2--addr \{ grid-template-columns: minmax\(0, 1fr\)/);
    const form = html.slice(html.indexOf('<form class="hh-form"'), html.indexOf('</form>'));
    expect(form.indexOf('hh-origin')).toBeLessThan(form.indexOf('hh-destination'));
  });

  it('asks whether loading is PROVIDED at each end, as two checkmarks', () => {
    expect(html).toContain('id="hh-load-origin"');
    expect(html).toContain('id="hh-load-destination"');
    // Ticked by default: most shippers do have a forklift or a crane on site,
    // and defaulting the crane ON would inflate every quote on the page.
    expect(html).toMatch(/id="hh-load-origin" checked/);
    expect(html).toMatch(/id="hh-load-destination" checked/);
    // Two boxes in two tracks — a group of two can never orphan one.
    expect(html).toMatch(/\.hh-checks \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('offers metric AND imperial, with the unit in the field title', () => {
    expect(html).toContain('data-units="imperial"');
    expect(html).toContain('data-units="metric"');
    for (const id of ['hh-weight', 'hh-length', 'hh-width', 'hh-height']) {
      const field = html.slice(html.indexOf(`id="${id}"`), html.indexOf(`id="${id}"`) + 400);
      expect(field, `${id} must carry both unit titles`).toMatch(/data-imperial="/);
      expect(field, `${id} must carry both unit titles`).toMatch(/data-metric="/);
    }
    expect(html).toContain('data-metric="Gross weight (kg)"');
    expect(html).toContain('data-metric="Width (m)"');
  });

  it('STOPS ASKING THE SHIPPER CARRIER QUESTIONS on the default surface', () => {
    const form = html.slice(html.indexOf('<form class="hh-form"'), html.indexOf('</form>'));
    const disclosure = form.slice(form.indexOf('<details class="hh-adv"'));
    const surface = form.slice(0, form.indexOf('<details class="hh-adv"'));
    // Every one of these is DERIVED from the cargo and the two addresses, and
    // asking a forwarder for them is asking him to do the carrier's job.
    for (const carrierField of [
      'hh-axles',
      'hh-routeclass',
      'hh-linehaul',
      'hh-pc-mile',
      'hh-fuel-peg',
      'hh-fuel-mpg',
      'hh-legs',
    ]) {
      expect(surface, `${carrierField} must not be on the default surface`).not.toContain(
        carrierField,
      );
      expect(disclosure, `${carrierField} must stay REACHABLE in the disclosure`).toContain(
        carrierField,
      );
    }
    // And the disclosure ships closed.
    expect(form).not.toMatch(/<details class="hh-adv"[^>]*\sopen/);
  });

  // ── THE OOG CTA ──────────────────────────────────────────────────────

  it('carries a SUBTLE OOG CTA in the header bar and the footer bar', () => {
    expect(html).toContain(HEADER_OOG_CTA);
    expect(html).toContain(FOOTER_OOG_CTA);
    expect(HEADER_OOG_CTA).toContain(OOG_QUOTE_HREF);
    expect(FOOTER_OOG_CTA).toContain(OOG_QUOTE_HREF);
    // SUBTLE: a text link, not a button and not a coloured banner. The header
    // already carries exactly one primary CTA per surface.
    expect(HEADER_OOG_CTA).not.toMatch(/class="[^"]*\bbtn\b/);
    expect(FOOTER_OOG_CTA).not.toMatch(/class="[^"]*\bbtn\b/);
    // In the ACTION CLUSTER, never inside .site-nav or the drawer — both of
    // those already list this href once under Free Tools, and listing it twice
    // breaks the one-destination-one-home rule.
    expect(FULL_SITE_HEADER).toContain(`<div class="site-actions">${HEADER_OOG_CTA}`);
    expect(SITE_NAV_HTML).not.toContain(HEADER_OOG_CTA);
    expect(SITE_MOBILE_MENU_HTML).not.toContain(HEADER_OOG_CTA);
    expect(PREMIUM_FOOTER).toContain(FOOTER_OOG_CTA);
  });

  it('ships the CTA on every chrome surface, with one styling rule each', () => {
    const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8');
    const landing = read('src/server/public/landing.html');
    const directory = read('src/server/directory/pages.ts');
    // landing.html inlines its own copy of the chrome; the directory subsite
    // imports the constants. Both must carry the link or the site drifts.
    expect(landing).toContain('class="site-oog"');
    expect(landing).toContain('class="qf-foot-oog"');
    expect(directory).toContain('HEADER_OOG_CTA');
    expect(directory).toContain('FOOTER_OOG_CTA');
    // Styling: nav-unify for every chrome page, landing-conversion for the
    // homepage, which does not load nav-unify.
    for (const sheet of ['src/server/public/nav-unify.css', 'src/server/public/landing-conversion.css']) {
      const css = read(sheet);
      expect(css, sheet).toContain('.site-actions .site-oog');
      // HIDDEN BELOW 1141px — measured, not cautious. At 1024px the link put
      // the homepage header 39px over its content box, which is the #476/#477
      // defect. The footer copy carries every width instead.
      expect(css, sheet).toMatch(/@media \(max-width: 1140px\) \{\s*\.site-actions \.site-oog \{ display: none; \}/);
    }
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

  it('puts the basis pill in the row META, above the clamped note', () => {
    // The note is clamped, so "whose number is this" has to live somewhere a
    // clamp cannot reach: the meta strip, beside the accuracy pill.
    expect(client).toMatch(/basis === 'derived'/);
    expect(client).toContain('EIA index');
    expect(client).toMatch(/hh-lmeta[\s\S]{0,120}tierChip\(line\.accuracy\)[\s\S]{0,40}basisTag\(line\)/);
  });

  // ── THE ACCURACY RATING, WHICH IS THE PRODUCT ──────────────────────────

  it('renders a CITED figure with NO range and a BENCHMARK as a range', () => {
    // The structural invariant, on the render side. `citedCarriesNoBand` in
    // market/accuracy.ts enforces it in the engine; this is the half that stops
    // a cited fee being PAINTED as a band of width zero, which is what a naive
    // "has a low and a high" test produced over the seven reference permits.
    expect(client).toMatch(/acc\.tier === 'benchmark'[\s\S]{0,120}acc\.lowUsd !== null/);
    expect(client).toMatch(/l\.accuracy\.tier === 'benchmark'/);
    // A cited pill carries no band either.
    expect(client).toMatch(/acc\.tier === 'cited' \|\| acc\.tier === 'refused' \? '' : ' ±'/);
  });

  it('shows the brief hover and hides the argument behind READ MORE', () => {
    expect(client).toContain('hh-hbrief');
    expect(client).toContain('Read more');
    expect(client).toMatch(/acc\.hover/);
    expect(client).toMatch(/acc\.detail/);
    // The long form ships hidden, so the card opens brief.
    expect(client).toMatch(/hh-hdetail" hidden/);
  });

  it('discloses detention and layover WITHOUT adding them', () => {
    expect(client).toMatch(/q\.riskLines/);
    expect(client).toContain('Disclosed, and NOT in the total');
    // They are rendered from riskLines, which the composer keeps out of every
    // subtotal — nothing here ever adds a risk line into a total.
    expect(client).not.toMatch(/deliveredUsd \+[\s\S]{0,40}riskLines/);
  });

  it('GROUPS related lines instead of stacking a row per state', () => {
    expect(client).toMatch(/function renderGroup/);
    expect(client).toMatch(/State OS\/OW permits/);
    // A group pill is a LABEL, never one member's card borrowed for five rows.
    expect(client).toContain('hh-tier is-static');
  });

  it('converts metric and imperial by MEMORY so the round trip is exact', () => {
    // Converting 120,000 lb to kg and back through the factor returns
    // 120,000.04, because the displayed figure was rounded for a human. The
    // field therefore remembers the exact characters it held in the other
    // system, and an edit drops the memo.
    expect(client).toContain('0.45359237');
    expect(client).toContain('0.3048');
    expect(client).toMatch(/dataset\.altFor === next/);
    expect(client).toMatch(/delete el\.dataset\.alt;/);
    // Switching never clears a field.
    expect(client).not.toMatch(/setUnits[\s\S]{0,600}el\.value = '';[\s\S]{0,40}\n\s*\}\s*else/);
  });

  it('sends the LOADING checkboxes as the engine flags they invert to', () => {
    expect(client).toMatch(/loadingAtOrigin: !checked\('hh-load-origin'\)/);
    expect(client).toMatch(/loadingAtDestination: !checked\('hh-load-destination'\)/);
  });

  it('never asks the SHIPPER for an axle count on the default surface', () => {
    // It is still sent when the disclosure is filled in — a carrier who knows
    // the configuration beats our inference — but nothing outside the
    // disclosure reads it.
    expect(client).toMatch(/cargo\.axleCount = axles/);
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

  it('the worked example is a SHIPPER’S lane — cargo and two addresses only', () => {
    const example = client.slice(client.indexOf("getElementById('hh-example')"));
    for (const carrierField of ['hh-axles', 'hh-linehaul', 'hh-pc-mile', 'data-route']) {
      expect(example, `the example must not pre-fill ${carrierField}`).not.toContain(carrierField);
    }
    expect(example).toContain("getElementById('hh-weight').value = '120000'");
  });
});
