/**
 * The public OS/OW permit calculator — the endpoint, the page, and the honesty
 * guarantees that are the whole reason this surface can exist.
 *
 * The engine under it has 21 states of cited fee data and, before this route,
 * no consumer at all. Exposing it publicly is only safe if the output cannot be
 * mistaken for a freight price, so these tests pin the four claims a user could
 * be misled by:
 *
 *   1. an uncovered state is NAMED and unpriced — never $0, never dropped;
 *   2. escort COST is never included and the response says so;
 *   3. a manual-review state ships its reasons, not just a flag;
 *   4. `totalPermitUsd === null` is a refusal to price, never zero.
 *
 * Plus the reference lane, so a data or arithmetic regression is caught by a
 * number a human has checked against the states' own published schedules.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  registerOsowPermitRoutes,
  renderOsowToolPage,
  priceOsowLane,
  osowCoveredStates,
  osowStateOptions,
  OSOW_ASOF_MIN,
  OSOW_MAX_LEGS,
  OSOW_ROUTE_CLASSES,
  OSOW_SELECTABLE_STATE_CODES,
  OSOW_TOOL_PATH,
} from './osowPermits.js';
import { SITE_NAV_HTML, SITE_MOBILE_MENU_HTML, PREMIUM_FOOTER } from '../siteChrome.js';

const ASOF = '2026-09-03';

function startServer(): Promise<{ base: string; close: () => void }> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerOsowPermitRoutes(app);
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
  const r = await fetch(`${base}/api/tools/osow-permits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, never> };
}

/**
 * THE REFERENCE LANE — Houston to Buffalo, 120,000 lb, 12'6" wide, 14'6" high,
 * 8 axles, running interstate.
 *
 * Per-state permit fees: TX $214.98 · AR $337 · TN $320 · KY $62.40 · OH $145 ·
 * PA $83.80 · NY $60, summing to $1,223.18.
 *
 * FIVE OF THE SEVEN DO NOT MOVE WITH MILEAGE for this load — Texas, Kentucky,
 * Ohio and New York are weight-banded or flat, and Arkansas's top mileage band
 * is open-ended above 251 miles — so those five figures are the state's charge
 * at any in-state distance. Only Tennessee (6¢ per ton-mile) and Pennsylvania
 * (per mile) vary, and they reach $320 and $83.80 at 250 and 46 in-state miles.
 *
 * OVERALL LENGTH AND ROUTE CLASS ARE PART OF THE FIXTURE, not decoration.
 * Without them every state's escort table stays unresolved and all seven flag
 * for review; with them the flag narrows to the two states that genuinely have
 * an unsettled fact — Tennessee, which never publishes how a part ton or part
 * mile is billed, and New York, which has three further issuing authorities
 * whose schedules we do not hold.
 */
const REFERENCE_LANE = {
  load: {
    grossWeightLbs: 120_000,
    widthIn: 12 * 12 + 6,
    heightIn: 14 * 12 + 6,
    overallLengthIn: 85 * 12,
    axleCount: 8,
    routeClass: 'interstate' as const,
  },
  legs: [
    { state: 'TX', miles: 215 },
    { state: 'AR', miles: 337 },
    { state: 'TN', miles: 250 },
    { state: 'KY', miles: 62.4 },
    { state: 'OH', miles: 145 },
    { state: 'PA', miles: 46 },
    { state: 'NY', miles: 60 },
  ],
  asOf: ASOF,
};

describe('the reference lane', () => {
  const out = priceOsowLane(REFERENCE_LANE);

  it('totals $1,223.18 across the seven states', () => {
    expect(out.quote.totalPermitUsd).toBe(1223.18);
  });

  it('prices each state at the figure that state publishes', () => {
    const byState = Object.fromEntries(
      out.quote.jurisdictions.map((j) => [j.jurisdiction, j.subtotalUsd]),
    );
    expect(byState).toEqual({
      TX: 214.98,
      AR: 337,
      TN: 320,
      KY: 62.4,
      OH: 145,
      PA: 83.8,
      NY: 60,
    });
    // The parts must sum to the whole — a total assembled from anything other
    // than these lines would still pass the assertion above.
    const sum = Object.values(byState).reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(out.quote.totalPermitUsd);
  });

  it('flags manual review on exactly Tennessee and New York', () => {
    const flagged = out.review.byState.filter((s) => s.requiresManualReview).map((s) => s.code);
    expect(flagged.sort()).toEqual(['NY', 'TN']);
    expect(out.review.required).toBe(true);
  });

  it('ships the review REASON, not just the flag', () => {
    const tn = out.review.byState.find((s) => s.code === 'TN');
    const ny = out.review.byState.find((s) => s.code === 'NY');
    // Tennessee: the part-ton / part-mile rounding it never publishes.
    expect(tn?.notes.join(' ')).toMatch(/never says how a part ton or a part mile is billed/i);
    // New York: further issuing authorities whose fees are not in the subtotal.
    expect(ny?.notes.join(' ')).toMatch(/not a single-issuer state/i);
    expect(ny?.notes.join(' ')).toMatch(/Thruway/);
    // Every note the engine recorded travels — none is dropped on the way out.
    for (const j of out.quote.jurisdictions) {
      const entry = out.review.byState.find((s) => s.code === j.jurisdiction);
      expect(entry?.notes.length).toBe(j.warnings.length);
      expect([...(entry?.notes ?? [])].sort()).toEqual([...j.warnings].sort());
    }
  });

  it('reports escorts as a requirement with the cost excluded', () => {
    expect(out.escorts.costIncluded).toBe(false);
    expect(out.escorts.note).toMatch(/cost is not included/i);
    // Kentucky and New York each require one certified escort on this load.
    const needing = out.escorts.byState.filter((s) => s.required > 0).map((s) => s.code);
    expect(needing.sort()).toEqual(['KY', 'NY']);
    expect(out.escorts.maxRequiredOnAnyState).toBe(1);
  });

  it('surfaces the fee conflicts it absorbed under the $50 rule', () => {
    expect(out.absorbedConflicts.thresholdUsd).toBe(50);
    const fields = out.absorbedConflicts.items.map((a) => a.field);
    expect(fields).toContain('PA oversize fee band');
    expect(fields).toContain('NY single-trip permit base fee');
    for (const a of out.absorbedConflicts.items) {
      expect(a.adoptedUsd).toBe(a.highUsd);
      expect(a.spreadUsd).toBeLessThanOrEqual(50);
    }
  });

  it('carries every fee line with its own citations', () => {
    for (const j of out.quote.jurisdictions) {
      expect(j.sources.length).toBeGreaterThan(0);
      for (const s of j.sources) expect(s.url).toMatch(/^https?:\/\//);
    }
  });

  it('labels the mileage as the operator’s, never as a route we computed', () => {
    expect(out.mileage.basis).toBe('operatorSupplied');
    expect(out.mileage.note).toMatch(/not a route we computed/i);
    expect(out.quote.warnings.join(' ')).toMatch(/Per-state mileage was SUPPLIED, not measured/);
  });
});

describe('an uncovered state is a first-class outcome', () => {
  const out = priceOsowLane({
    load: { ...REFERENCE_LANE.load },
    legs: [
      { state: 'TX', miles: 215 },
      { state: 'MS', miles: 160 },
      { state: 'AL', miles: 90 },
    ],
    asOf: ASOF,
  });

  it('names the state instead of charging $0 for it', () => {
    expect(out.uncovered).toEqual([{ code: 'MS', name: 'Mississippi' }]);
    expect(out.quote.uncoveredJurisdictions).toEqual(['MS']);
    // It must not appear as a priced jurisdiction at any amount, least of all 0.
    expect(out.quote.jurisdictions.some((j) => j.jurisdiction === 'MS')).toBe(false);
  });

  it('refuses a lane total rather than quietly excluding it', () => {
    // null, NOT 0. A $259 total here would read as the whole lane's permits.
    expect(out.quote.totalPermitUsd).toBeNull();
    expect(out.quote.requiresManualReview).toBe(true);
  });

  it('still prices the states it does cover', () => {
    const byState = Object.fromEntries(
      out.quote.jurisdictions.map((j) => [j.jurisdiction, j.subtotalUsd]),
    );
    expect(byState.TX).toBe(214.98);
    expect(byState.AL).toBe(44);
  });
});

describe('loads with no published price', () => {
  it('returns no total for a superload above a state’s ceiling', () => {
    const out = priceOsowLane({
      load: { ...REFERENCE_LANE.load, grossWeightLbs: 260_000, axleCount: 13 },
      legs: [{ state: 'TX', miles: 300 }],
      asOf: ASOF,
    });
    expect(out.quote.jurisdictions[0]?.superload).toBe(true);
    expect(out.quote.totalPermitUsd).toBeNull();
    expect(out.review.required).toBe(true);
  });

  it('treats New York’s inclusive 200,000 lb threshold as inclusive', () => {
    const out = priceOsowLane({
      load: { ...REFERENCE_LANE.load, grossWeightLbs: 205_000, axleCount: 13 },
      legs: [{ state: 'NY', miles: 60 }],
      asOf: ASOF,
    });
    expect(out.quote.jurisdictions[0]?.superload).toBe(true);
    expect(out.quote.totalPermitUsd).toBeNull();
  });

  it('quotes a genuine $0 for a legal load, which is NOT the same as null', () => {
    const out = priceOsowLane({
      load: { grossWeightLbs: 70_000, widthIn: 102, heightIn: 162, overallLengthIn: 900, axleCount: 5, routeClass: 'interstate' },
      legs: [{ state: 'OH', miles: 100 }],
      asOf: ASOF,
    });
    expect(out.quote.jurisdictions[0]?.permitRequired).toBe(false);
    expect(out.quote.totalPermitUsd).toBe(0);
  });
});

describe('POST /api/tools/osow-permits', () => {
  it('prices the reference lane over HTTP', async () => {
    const { base, close } = await startServer();
    try {
      const r = await post(base, REFERENCE_LANE);
      expect(r.status).toBe(200);
      const body = r.body as unknown as ReturnType<typeof priceOsowLane>;
      expect(body.quote.totalPermitUsd).toBe(1223.18);
      expect(body.escorts.costIncluded).toBe(false);
      expect(body.disclaimer).toMatch(/STATE PERMIT FEES ONLY/);
      expect(body.notIncluded.map((n) => n.item).join(' ')).toMatch(/escort/i);
    } finally {
      close();
    }
  });

  it('400s on an invalid load rather than pricing a guess', async () => {
    const { base, close } = await startServer();
    try {
      const missingWeight = await post(base, { load: {}, legs: [{ state: 'TX', miles: 10 }] });
      expect(missingWeight.status).toBe(400);

      const noLegs = await post(base, { load: { grossWeightLbs: 100000 }, legs: [] });
      expect(noLegs.status).toBe(400);

      const badState = await post(base, {
        load: { grossWeightLbs: 100000 },
        legs: [{ state: 'ZZ', miles: 10 }],
      });
      expect(badState.status).toBe(400);
      expect(String(badState.body.error)).toMatch(/not a US state code/);

      const dup = await post(base, {
        load: { grossWeightLbs: 100000 },
        legs: [{ state: 'TX', miles: 10 }, { state: 'TX', miles: 20 }],
      });
      expect(dup.status).toBe(400);
      expect(String(dup.body.error)).toMatch(/listed twice/);

      const negative = await post(base, {
        load: { grossWeightLbs: 100000 },
        legs: [{ state: 'TX', miles: -5 }],
      });
      expect(negative.status).toBe(400);
    } finally {
      close();
    }
  });

  it('serves the coverage list the form is built from', async () => {
    const { base, close } = await startServer();
    try {
      const r = await fetch(`${base}/api/tools/osow-permits/coverage`);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { coveredStates: unknown[]; routeClasses: unknown[] };
      expect(body.coveredStates.length).toBe(21);
      expect(body.routeClasses.length).toBe(4);
    } finally {
      close();
    }
  });
});

describe('coverage lists', () => {
  it('covers the 21 states the engine holds data for, and no more', () => {
    const codes = osowCoveredStates().map((s) => s.code).sort();
    expect(codes).toEqual(
      ['TX', 'OH', 'PA', 'NY', 'IL', 'IN', 'CA', 'GA', 'NC', 'NJ', 'VA', 'WA', 'AL', 'FL', 'MO', 'OK', 'LA', 'CO', 'AR', 'KY', 'TN'].sort(),
    );
  });

  it('still OFFERS the 29 states it cannot price, so choosing one is explicit', () => {
    const all = osowStateOptions();
    expect(all.length).toBe(51); // 50 states + DC
    expect(all.filter((s) => s.covered).length).toBe(21);
    expect(all.find((s) => s.code === 'MS')?.covered).toBe(false);
  });

  it('offers exactly four route classes — an even count wraps 2x2, never 3+1', () => {
    expect(OSOW_ROUTE_CLASSES.length % 2).toBe(0);
    expect(OSOW_ROUTE_CLASSES.length).toBe(4);
  });
});

describe('the page', () => {
  const html = renderOsowToolPage();

  it('says what the number is before the user reads it as a freight quote', () => {
    expect(html).toMatch(/This prices state permit fees\. It is not a freight quote\./);
    expect(html).toMatch(/STATE PERMIT FEES ONLY/);
    // The escort omission is stated on the page itself, not only in the API.
    expect(html).toMatch(/one escort can cost more than every permit below combined/);
  });

  it('left-aligns the hero and puts the eyebrow above it, top-left', () => {
    expect(html).toMatch(/\.ow-hero \{[^}]*text-align: left/);
    expect(html).toMatch(/\.ow-hero h1 \{[^}]*text-align: left/);
    expect(html).toMatch(/\.ow-eyebrow \{[^}]*text-align: left/);
    // Eyebrow renders BEFORE the h1 in source order.
    expect(html.indexOf('ow-eyebrow')).toBeLessThan(html.indexOf('<h1>'));
  });

  it('never uses overflow:hidden, which breaks sticky in embedded contexts', () => {
    expect(html).not.toMatch(/overflow:\s*hidden/);
  });

  it('puts the field label INSIDE the field and one help cue top-left per section', () => {
    // No <label> text block above an input duplicating its placeholder.
    expect(html).toMatch(/<label class="ow-field"><input[^>]*placeholder=" "[^>]*><span class="ow-lab">/);
    const cues = html.match(/class="ow-cue"/g) ?? [];
    const sections = html.match(/class="ow-sec"/g) ?? [];
    expect(cues.length).toBe(sections.length);
    // The cue is the first child of the section header row.
    expect(html).toMatch(/<div class="ow-sec"><button type="button" class="ow-cue"/);
  });

  it('keeps stacked input components 2px apart', () => {
    expect(html).toMatch(/\.ow-stack \{[^}]*gap: 2px/);
    expect(html).toMatch(/\.ow-row2 \{[^}]*gap: 2px/);
    expect(html).toMatch(/\.ow-pills \{[^}]*gap: 2px/);
  });

  it('renders a selected pill as an outline, never a bright fill', () => {
    const selected = html.match(/\.ow-pill\[aria-pressed="true"\] \{[^}]*\}/)?.[0] ?? '';
    expect(selected).toMatch(/border-color: var\(--accent\)/);
    expect(selected).toMatch(/background: var\(--accent-soft\)/);
    expect(selected).not.toMatch(/background: var\(--accent-fill\)/);
  });

  it('wraps every small-element group in a fixed grid so none can be orphaned', () => {
    // 4 route pills and 4 result tiles -> 2 columns is exactly 2x2.
    expect(html).toMatch(/\.ow-pills \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(html).toMatch(/\.ow-flags \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    // 1-4 status badges per state -> 2 content-sized columns, padded to even.
    expect(html).toMatch(/\.ow-badges \{[^}]*grid-template-columns: repeat\(2, minmax\(0, max-content\)\)/);
    // The coverage chips are a FIXED 7 across because 21 states divide by 7 and
    // by nothing else that a fluid grid would land on. Assert the arithmetic,
    // not just the number, so adding a 22nd state fails here rather than
    // shipping a chip alone on a row.
    const cols = Number(
      html.match(/\.ow-cov \{[^}]*grid-template-columns: repeat\((\d+), minmax\(0, 1fr\)\)/)?.[1],
    );
    expect(cols).toBeGreaterThan(0);
    expect(osowCoveredStates().length % cols).toBe(0);
  });

  it('uses theme tokens only — no raw hex that would break one theme', () => {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(css.length).toBeGreaterThan(1000);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:color|background)\s*:\s*(?:white|black)\b/);
  });

  it('lets a wide table scroll inside itself rather than the page', () => {
    expect(html).toMatch(/\.ow-tablewrap \{[^}]*overflow-x: auto/);
  });

  it('carries canonical chrome, canonical URL and its own JSON-LD', () => {
    expect(html).toContain('class="site-header"');
    expect(html).toContain('class="premium-footer"');
    expect(html).toContain(`<link rel="canonical" href="https://quotefleet.net${OSOW_TOOL_PATH}">`);
    expect(html).toMatch(/"@type":"WebApplication"/);
    expect(html).toMatch(/"@type":"BreadcrumbList"/);
  });
});

describe('the Free Tools group carries the new tool on every surface', () => {
  const LANDING = readFileSync(resolve(process.cwd(), 'src/server/public/landing.html'), 'utf8');
  const DIRECTORY_PAGES = readFileSync(resolve(process.cwd(), 'src/server/directory/pages.ts'), 'utf8');
  const HREF = `href="${OSOW_TOOL_PATH}"`;

  it('appears exactly once in the desktop nav, the drawer and both footers', () => {
    const surfaces: Array<[string, string]> = [
      ['SITE_NAV_HTML', SITE_NAV_HTML],
      ['SITE_MOBILE_MENU_HTML', SITE_MOBILE_MENU_HTML],
      ['PREMIUM_FOOTER', PREMIUM_FOOTER],
    ];
    for (const [name, markup] of surfaces) {
      expect((markup.match(new RegExp(HREF, 'g')) ?? []).length, name).toBe(1);
    }
    // The directory subsite footer is a separate markup copy.
    const dirFooter = DIRECTORY_PAGES.match(/<nav class="dirfoot"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect((dirFooter.match(new RegExp(HREF, 'g')) ?? []).length).toBe(1);
    // landing.html holds literal copies of the nav, the drawer and the footer.
    expect((LANDING.match(new RegExp(HREF, 'g')) ?? []).length).toBe(3);
  });

  it('files it under Free Tools, not under an audience menu', () => {
    const freeMenu = SITE_NAV_HTML.match(/nav-free-menu[\s\S]*?<\/div><\/div>/)?.[0] ?? '';
    expect(freeMenu).toContain(HREF);

    for (const [name, markup, colRe] of [
      ['PREMIUM_FOOTER', PREMIUM_FOOTER, /<div class="footer-col"><h4>Free Tools<\/h4>[\s\S]*?<\/div>/],
      ['dirfoot', DIRECTORY_PAGES, /<div class="dirfoot-col"><h2 class="dirfoot-head">Free Tools<\/h2>[\s\S]*?<\/div>/],
    ] as const) {
      const col = markup.match(colRe)?.[0] ?? '';
      expect(col, name).toContain(HREF);
      expect(col, name).toContain('href="/tools"');
      expect(col, name).toContain('href="/glossary"');
    }
  });

  it('keeps the footer at five columns — the grid ladder depends on the count', () => {
    expect((PREMIUM_FOOTER.match(/class="footer-col"/g) ?? []).length).toBe(5);
    expect((DIRECTORY_PAGES.match(/class="dirfoot-col"/g) ?? []).length).toBe(4);
  });

  it('keeps landing.html byte-identical to the shared chrome constants', () => {
    expect(LANDING).toContain(SITE_NAV_HTML);
    expect(LANDING).toContain(SITE_MOBILE_MENU_HTML);
    expect(LANDING).toContain(PREMIUM_FOOTER);
  });
});

/**
 * THE SCREEN MUST NOT CONTRADICT ITSELF.
 *
 * Every case below is one a dispatcher can reach from the form in under a
 * minute, and each used to produce a page that asserted two incompatible things
 * at once — a summary saying every state was priced above a block saying one was
 * not, a fee explanation that did not produce its fee, a refusal that blamed the
 * wrong input. They are honesty defects rather than bugs: the arithmetic was
 * right and the sentence beside it was wrong.
 */
describe('covered is not the same fact as priced', () => {
  /**
   * Florida returns a COVERED jurisdiction with a null subtotal on this load —
   * its oversize band cannot be selected without an overall length — while
   * Georgia prices normally. Counting `jurisdictions.length` as "priced" made
   * the summary read "2 of 2 — every state on this lane is covered" directly
   * above a Florida block reading "Not priceable".
   */
  const out = priceOsowLane({
    load: {
      grossWeightLbs: 120_000,
      widthIn: 12 * 12 + 6,
      heightIn: 14 * 12 + 6,
      axleCount: 8,
      routeClass: 'interstate' as const,
    },
    legs: [
      { state: 'FL', miles: 300 },
      { state: 'GA', miles: 120 },
    ],
    asOf: ASOF,
  });

  it('returns a covered state with no subtotal, which is the shape the tile got wrong', () => {
    const fl = out.quote.jurisdictions.find((j) => j.jurisdiction === 'FL');
    const ga = out.quote.jurisdictions.find((j) => j.jurisdiction === 'GA');
    expect(fl).toBeDefined();
    expect(fl?.subtotalUsd).toBeNull();
    expect(ga?.subtotalUsd).not.toBeNull();
    // Not an uncovered state — Florida's schedule is on file. The two facts are
    // reported separately and must stay separate.
    expect(out.uncovered).toEqual([]);
    expect(out.quote.totalPermitUsd).toBeNull();
  });

  it('counts priced states by subtotal, so 2 of 2 can never sit above a refusal', () => {
    const priced = out.quote.jurisdictions.filter((j) => j.subtotalUsd !== null).length;
    const onLane = out.quote.jurisdictions.length + out.uncovered.length;
    expect(priced).toBe(1);
    expect(onLane).toBe(2);
    // The page renders `priced of onLane`. The old count would have said 2 of 2.
    expect(out.quote.jurisdictions.length).toBe(2);

    // The client owns the arithmetic, so assert the client says so too.
    const client = readFileSync(
      resolve(process.cwd(), 'src/server/public/osow-calculator.js'),
      'utf8',
    );
    expect(client).toContain('function pricedCount(');
    expect(client).toContain('subtotalUsd !== null');
    expect(client).toContain('covered but not priceable for this load');
    // The old wording asserted coverage where the count meant pricing.
    expect(client).not.toContain('Every state on this lane is covered');
  });

  it('states the escort count as a per-state maximum, not a lane total', () => {
    // Florida and Georgia each require one pilot car on this load: two cars on
    // the move, and `maxRequiredOnAnyState` is 1 by construction.
    const needing = out.escorts.byState.filter((s) => s.required > 0).map((s) => s.code);
    expect(needing.sort()).toEqual(['FL', 'GA']);
    expect(out.escorts.maxRequiredOnAnyState).toBe(1);

    const client = readFileSync(
      resolve(process.cwd(), 'src/server/public/osow-calculator.js'),
      'utf8',
    );
    expect(client).toContain('Escorts, per state');
    expect(client).toContain('The most any ONE state requires, not a lane total');
    // The exclusion still has to be spelled out on the tile itself.
    expect(client).toContain('Cost NOT included');
  });
});

describe('a refusal names the input that actually failed', () => {
  const load = {
    grossWeightLbs: 120_000,
    widthIn: 12 * 12 + 6,
    heightIn: 14 * 12 + 6,
    overallLengthIn: 85 * 12,
    axleCount: 8,
    routeClass: 'interstate' as const,
  };
  const at = (miles: number) =>
    priceOsowLane({ load, legs: [{ state: 'AR', miles }], asOf: ASOF });

  it('prices Arkansas either side of the 251-mile hole', () => {
    expect(at(250).quote.totalPermitUsd).toBe(297);
    expect(at(252).quote.totalPermitUsd).toBe(337);
  });

  it('blames the mileage, not a weight that prices fine one mile either side', () => {
    const gap = at(251);
    expect(gap.quote.totalPermitUsd).toBeNull();
    const notes = (gap.review.byState.find((s) => s.code === 'AR')?.notes ?? []).join(' ');
    expect(notes).toContain('No overweight fee band on file covers a 251-mile move in Arkansas');
    expect(notes).toContain('it is the MILEAGE that falls in the gap, not the weight');
    expect(notes).toContain('201–250 mi');
    expect(notes).not.toContain('No overweight fee band on file covers 120,000 lb in Arkansas');
    // The blank fee LINE says why it is blank too, so the cause sits beside the
    // "Not priceable" cell rather than only in the notes block below it.
    const ar = gap.quote.jurisdictions.find((j) => j.jurisdiction === 'AR');
    const line = ar?.lines.find((l) => l.code === 'osow_overweight');
    expect(line?.amountUsd).toBeNull();
    expect(line?.note).toContain('price no move of exactly 251 mi');
    // It is ranked with the UNSETTLED notes, not after the advisory ones, so a
    // reader meets it inside the expanded reasons block.
    const ordered = gap.review.byState.find((s) => s.code === 'AR')?.notes ?? [];
    const gapIndex = ordered.findIndex((n) => n.includes('251-mile move'));
    const advisoryIndex = ordered.findIndex((n) => n.includes('Per-state mileage'));
    expect(gapIndex).toBeGreaterThanOrEqual(0);
    if (advisoryIndex >= 0) expect(gapIndex).toBeLessThan(advisoryIndex);
  });
});

describe('the public API and the form agree on what is askable', () => {
  it('refuses a 0-mile leg, which the page’s own copy already called invalid', async () => {
    const { base, close } = await startServer();
    try {
      const zero = await post(base, {
        load: { grossWeightLbs: 120_000 },
        legs: [{ state: 'PA', miles: 0 }],
      });
      expect(zero.status).toBe(400);
      expect(String(zero.body.error)).toMatch(/positive number/i);
    } finally {
      close();
    }
  });

  it('refuses the territories the form does not offer', async () => {
    const { base, close } = await startServer();
    try {
      for (const code of ['PR', 'VI', 'GU']) {
        const r = await post(base, {
          load: { grossWeightLbs: 120_000 },
          legs: [{ state: code, miles: 100 }],
        });
        expect(r.status, code).toBe(400);
        expect(String(r.body.error)).toMatch(/US territory/);
      }
      // A code that is not a state at all still gets the original answer.
      const zz = await post(base, {
        load: { grossWeightLbs: 120_000 },
        legs: [{ state: 'ZZ', miles: 100 }],
      });
      expect(zz.status).toBe(400);
      expect(String(zz.body.error)).toMatch(/not a US state code/);
      const lower = await post(base, {
        load: { grossWeightLbs: 120_000 },
        legs: [{ state: 'zz', miles: 100 }],
      });
      expect(lower.status).toBe(400);
    } finally {
      close();
    }
  });

  it('offers exactly the codes the API accepts', () => {
    const offered = osowStateOptions().map((s) => s.code).sort();
    expect([...OSOW_SELECTABLE_STATE_CODES].sort()).toEqual(offered);
    expect(OSOW_SELECTABLE_STATE_CODES.has('PR')).toBe(false);
    expect(OSOW_SELECTABLE_STATE_CODES.size).toBe(51);
  });

  it('names the leg cap instead of answering a 21-leg lane with “Invalid input”', async () => {
    const { base, close } = await startServer();
    try {
      const codes = osowStateOptions().slice(0, OSOW_MAX_LEGS + 1).map((s) => s.code);
      expect(codes.length).toBe(OSOW_MAX_LEGS + 1);
      const tooMany = await post(base, {
        load: { grossWeightLbs: 120_000 },
        legs: codes.map((state) => ({ state, miles: 10 })),
      });
      expect(tooMany.status).toBe(400);
      expect(String(tooMany.body.error)).toMatch(
        new RegExp(`at most ${OSOW_MAX_LEGS} states`),
      );

      // Exactly at the cap still prices.
      const atCap = await post(base, {
        load: { grossWeightLbs: 120_000 },
        legs: codes.slice(0, OSOW_MAX_LEGS).map((state) => ({ state, miles: 10 })),
      });
      expect(atCap.status).toBe(200);
    } finally {
      close();
    }
  });

  it('stops the Add button at the cap rather than letting the user build a 21st row', () => {
    const client = readFileSync(
      resolve(process.cwd(), 'src/server/public/osow-calculator.js'),
      'utf8',
    );
    expect(client).toMatch(new RegExp(`var MAX_LEGS = ${OSOW_MAX_LEGS};`));
    expect(client).toContain('if (legRows().length >= MAX_LEGS)');
    expect(client).toContain('addBtn.disabled = full');
    // And the page carries the sentence that explains the disabled control.
    const html = renderOsowToolPage();
    expect(html).toContain('id="ow-cap"');
    expect(html).toContain(`${OSOW_MAX_LEGS} states is the most one lane can carry here`);
  });

  it('bounds asOf, the one public lever that could turn a refusal into $0', async () => {
    const { base, close } = await startServer();
    try {
      // 1800-01-01 puts every effective-dated fee row out of effect. It used to
      // return 200 with totalPermitUsd: 0 and permitRequired: false — a $0 that
      // means "we hold no schedule for that year", rendered as "this is free".
      const ancient = await post(base, {
        load: { grossWeightLbs: 120_000 },
        legs: [{ state: 'FL', miles: 300 }],
        asOf: '1800-01-01',
      });
      expect(ancient.status).toBe(400);
      expect(String(ancient.body.error)).toMatch(/asOf must fall between/);

      const future = await post(base, {
        load: { grossWeightLbs: 120_000 },
        legs: [{ state: 'FL', miles: 300 }],
        asOf: '2999-01-01',
      });
      expect(future.status).toBe(400);

      // The floor is the day the newest schedule on file took effect, so the
      // whole corpus is in force from it — and it must be a date, not a guess.
      expect(OSOW_ASOF_MIN).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const atFloor = await post(base, {
        load: { grossWeightLbs: 120_000 },
        legs: [{ state: 'FL', miles: 300 }],
        asOf: OSOW_ASOF_MIN,
      });
      expect(atFloor.status).toBe(200);
    } finally {
      close();
    }
  });

  it('never sends asOf from the page — it only ever reads the one it got back', () => {
    const client = readFileSync(
      resolve(process.cwd(), 'src/server/public/osow-calculator.js'),
      'utf8',
    );
    // Nothing puts it on the request body.
    expect(client).not.toMatch(/asOf\s*[:=]/);
    expect(client).not.toMatch(/payload\.asOf/);
    // It is only ever rendered from the response.
    expect(client).toContain('j.asOf');
    expect(client).toContain('data.asOf');
  });
});

/**
 * THE ESCORT SECTION.
 *
 * The reference lane is the whole argument for building this at all: seven
 * states of cited permit fees total $1,223.18, and the two pilot cars the same
 * seven states require are worth more than that on any rate a carrier would
 * recognise. What is pinned here is that the second number never contaminates
 * the first, and that we still refuse to invent it.
 */
describe('the escort section', () => {
  const REFERENCE_PERMIT_TOTAL = 1223.18;

  it('sits beside the permit total, never inside it', () => {
    const out = priceOsowLane({
      ...REFERENCE_LANE,
      pilotCarRate: { usdPerMile: 2.25 },
    });
    expect(out.quote.totalPermitUsd).toBe(REFERENCE_PERMIT_TOTAL);
    expect(out.escortEstimate.included).toBe(true);
    // Kentucky 62.4 mi + New York 60 mi, one pilot car each, at $2.25/mi.
    expect(out.escortEstimate.estimate?.pilotCarsRequired).toBe(2);
    expect(out.escortEstimate.estimate?.pilotCarUsd).toBe(275.4);
    // The permit total is untouched by the escort figure existing at all.
    expect(out.quote.totalPermitUsd).toBe(REFERENCE_PERMIT_TOTAL);
    expect(out.escorts.costIncluded).toBe(false);
  });

  it('leaves the permit subtotals BYTE-IDENTICAL with the estimate on and off', () => {
    const withEstimate = priceOsowLane({
      ...REFERENCE_LANE,
      includeEscortEstimate: true,
      pilotCarRate: { usdPerMile: 2.25, usdPerDay: 500, daysPerJurisdiction: 2 },
    });
    const without = priceOsowLane({ ...REFERENCE_LANE, includeEscortEstimate: false });

    expect(JSON.stringify(withEstimate.quote)).toBe(JSON.stringify(without.quote));
    expect(without.escortEstimate.included).toBe(false);
    expect(without.escortEstimate.estimate).toBeNull();
    expect(without.quote.totalPermitUsd).toBe(REFERENCE_PERMIT_TOTAL);
  });

  it('defaults to "we hold no pilot-car rates" rather than a synthesised range', () => {
    const out = priceOsowLane(REFERENCE_LANE);
    const est = out.escortEstimate.estimate;
    expect(est?.pilotCarBasis).toBe('none');
    expect(est?.pilotCarUsd).toBeNull();
    expect(est?.pilotCarLowUsd).toBeNull();
    expect(est?.internalBand).toBeNull();
    expect(est?.disclaimer).toMatch(/We hold no pilot-car rates/);
  });

  it('carries the sourced police floor as its own figure, cited', () => {
    // 19 ft wide trips Tennessee's THP trigger; TDOT publishes the rate.
    const out = priceOsowLane({
      load: { ...REFERENCE_LANE.load, widthIn: 19 * 12 },
      legs: [{ state: 'TN', miles: 250 }],
      asOf: ASOF,
    });
    const est = out.escortEstimate.estimate;
    expect(est?.policeStatesRequiring).toEqual(['TN']);
    expect(est?.policeFloorUsd).toBe(520);
    expect(est?.policeSources.every((s) => /^https?:\/\//.test(s.url))).toBe(true);
    // And it is still nowhere near the permit total.
    expect(out.quote.jurisdictions[0]?.subtotalUsd).not.toBe(520);
  });

  it('accepts the caller’s rate over HTTP and rejects a nonsense one', async () => {
    const { base, close } = await startServer();
    try {
      const ok = await post(base, { ...REFERENCE_LANE, pilotCarRate: { usdPerMile: 2.25 } });
      expect(ok.status).toBe(200);
      const body = ok.body as unknown as ReturnType<typeof priceOsowLane>;
      expect(body.quote.totalPermitUsd).toBe(REFERENCE_PERMIT_TOTAL);
      expect(body.escortEstimate.estimate?.pilotCarBasis).toBe('userSupplied');
      expect(body.escortEstimate.estimate?.pilotCarUsd).toBe(275.4);

      const bad = await post(base, { ...REFERENCE_LANE, pilotCarRate: { usdPerMile: -4 } });
      expect(bad.status).toBe(400);
    } finally {
      close();
    }
  });

  it('leaves the public page untouched — its escort copy is still the old copy', () => {
    const html = renderOsowToolPage();
    // Nothing about the new section reaches the rendered page in this change.
    expect(html).not.toMatch(/escortEstimate/);
    expect(html).not.toMatch(/pilotCarRate/);
    // The page's own "not included" copy is unchanged, verbatim.
    expect(html).toContain('We hold no pilot-car rates, so the cost is yours to add');
  });
});
