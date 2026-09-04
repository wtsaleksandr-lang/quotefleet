/**
 * /tools/heavy-haul-quote — the delivered-cost estimator, driven in a real
 * browser.
 *
 * WHY THIS FILE EXISTS. The unit suite asserts the composer's arithmetic and
 * the page's CSS as STRINGS. A string match cannot see a rendered orphan, a
 * horizontal scrollbar, a `null` that painted as "$0.00", a confidence number
 * whose reasons fell below the fold, a cited fee painted as a range of width
 * zero, or a 375px column that cropped the headline. Those are exactly the
 * failures this surface cannot ship with, because its whole claim is that you
 * can see where every number came from.
 *
 * WHO THE FORM IS FOR, AND WHAT THAT CHANGED HERE. The page now asks a
 * shipper for two addresses, whether loading is provided at each end, and the
 * cargo — and derives the axle count, the trailer class and the route class
 * from that. So the helpers below fill a SHIPPER's form. Everything a
 * dispatcher used to type on the front page (axles, route class, his own
 * rates, filed per-state miles) is still reachable and still exercised; it
 * lives behind one collapsed disclosure and `openOverrides()` opens it.
 *
 * NETWORK. The worked-example lane's two endpoints are pre-resolved server-side
 * (see `SEEDED_ENDPOINTS` in src/server/routes/heavyHaulQuote.ts), so every
 * pricing flow below runs with ZERO calls to the US Census geocoder. The one
 * exception is the deliberate "an address that cannot be resolved" test, which
 * must reach the real service to prove the fail-closed path end to end; it
 * asserts the CONTRACT (a refusal, never a price) rather than which refusal, so
 * it holds whether Census answers "no match" or is unreachable. That service is
 * free, keyless and public domain, and no paid API is touched anywhere here.
 *
 * Run: `pnpm test:e2e tests/e2e/heavy-haul-quote.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test';

const TOOL_PATH = '/tools/heavy-haul-quote';

/** The lane whose two endpoints the server pre-resolves. */
const ORIGIN = '1500 McKinney St, Houston, TX 77010';
const DESTINATION = '403 Main St, Buffalo, NY 14203';

interface Leg {
  state: string;
  miles: number;
}

/**
 * THE REFERENCE LOAD, as a SHIPPER types it. 120,000 lb, 12.5 ft wide,
 * 14.5 ft high, 85 ft long — the same physical load the permits calculator
 * prices at $1,223.18, entered through a form that no longer asks how many
 * axles the carrier will run.
 */
const REFERENCE_LEGS: Leg[] = [
  { state: 'TX', miles: 214.98 },
  { state: 'AR', miles: 337 },
  { state: 'TN', miles: 250 },
  { state: 'KY', miles: 62.4 },
  { state: 'OH', miles: 145 },
  { state: 'PA', miles: 46 },
  { state: 'NY', miles: 60 },
];

async function openTool(page: Page, theme?: 'light' | 'dark') {
  if (theme) {
    await page.addInitScript((t) => {
      try {
        window.localStorage.setItem('qf-theme', t as string);
      } catch {
        /* private mode — the page falls back to the system theme */
      }
    }, theme);
  }
  const res = await page.goto(TOOL_PATH, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(res?.status(), `${TOOL_PATH} must serve with the database down`).toBe(200);
  await page.waitForSelector('#hh-form');
}

/** The whole shipper form: the cargo, in imperial. */
async function fillLoad(page: Page) {
  await page.fill('#hh-weight', '120000');
  await page.fill('#hh-width', '12.5');
  await page.fill('#hh-height', '14.5');
  await page.fill('#hh-length', '85');
}

async function fillLane(page: Page, origin = ORIGIN, destination = DESTINATION) {
  await page.fill('#hh-origin', origin);
  await page.fill('#hh-destination', destination);
}

/** The override disclosure — collapsed by default, and everything a
 *  dispatcher used to type on the front page lives inside it. */
async function openOverrides(page: Page) {
  const adv = page.locator('#hh-adv');
  if (!(await adv.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await page.click('#hh-adv-summary');
  }
  await expect(adv).toHaveJSProperty('open', true);
}

async function fillLegs(page: Page, legs: Leg[]) {
  await openOverrides(page);
  await page.click('#hh-clear-legs');
  for (let i = 0; i < legs.length; i++) await page.click('#hh-add');
  const rows = page.locator('#hh-legs .hh-leg');
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] as Leg;
    await rows.nth(i).locator('.hh-leg-state').selectOption(leg.state);
    await rows.nth(i).locator('.hh-leg-miles').fill(String(leg.miles));
  }
}

async function submit(page: Page) {
  await page.click('#hh-go');
  await page.waitForSelector('.hh-results .hh-total, .hh-results .hh-note--error', {
    timeout: 30_000,
  });
  // The results scroll themselves into view with `behavior: 'smooth'`; settle
  // before measuring anything, or a height read catches a mid-animation frame.
  await page.waitForTimeout(600);
}

/** A breakdown row by its visible name. The breakdown is a grid, not a table:
 *  every charge carries a hover card and a hover card inside an
 *  `overflow-x: auto` box is a clipped hover card. */
function line(page: Page, name: string | RegExp) {
  return page.locator('.hh-line', { hasText: name }).first();
}

/** A row INSIDE a group's disclosure. A group header contains all of its
 *  members' text, so a bare `.hh-line` filter resolves to the group first. */
function subLine(page: Page, name: string | RegExp) {
  return page.locator('.hh-sub .hh-line', { hasText: name }).first();
}

/** A tier pill that is a real card button, and on screen.
 *
 *  Two things make the naive selector wrong. A GROUP HEADER'S pill is a static
 *  LABEL with no card, because the band and the evidence are per component —
 *  hence `[aria-controls]`. And the first pill in document order belongs to a
 *  member row inside a group's CLOSED disclosure — hence `:visible`. */
function tierButton(page: Page, within = '.hh-linesbox') {
  return page.locator(`${within} .hh-tier[aria-controls]:visible`);
}

/**
 * DOCUMENT-LEVEL horizontal overflow. A wide table scrolling inside its own
 * `overflow-x: auto` box is correct and must NOT fail this; the page body
 * scrolling sideways is the defect.
 */
async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label}: the page body must not scroll horizontally (scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

// ──────────────────────────────────────────────────────────────────────────
// The reference lane — a forwarder who DOES have his own rates and his own
// filed miles, entered through the disclosure.
// ──────────────────────────────────────────────────────────────────────────

test.describe('the reference lane, through the form', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page);
    await fillLoad(page);
    await fillLane(page);
    await fillLegs(page, REFERENCE_LEGS);
    await page.fill('#hh-linehaul', '4.85');
    await page.fill('#hh-pc-mile', '1.95');
    await submit(page);
  });

  test('prices the permits at the permits-only tool’s own $1,223.18', async ({ page }) => {
    // The composed page must not move a permit fee by a cent. The seven states
    // are grouped into one row, so read them from inside the group.
    const table = page.locator('.hh-linesbox');
    await expect(table).toContainText('Texas single-trip OS/OW permit');
    await expect(table).toContainText('$214.98');
    await expect(table).toContainText('$337.00');
    await expect(table).toContainText('$320.00');
    await expect(table).toContainText('$62.40');
    await expect(table).toContainText('$145.00');
    await expect(table).toContainText('$83.80');
    await expect(table).toContainText('$60.00');
    // And the SOURCED tile is those seven and nothing else.
    await expect(page.locator('.hh-split .hh-tile').first()).toContainText('$1,223.18');
  });

  test('shows a delivered total with a range and no margin line', async ({ page }) => {
    await expect(page.locator('.hh-tv')).toContainText('$');
    await expect(page.locator('.hh-trange')).toContainText('confidence');
    await expect(page.locator('.hh-total')).not.toContainText('Margin');
    await expect(page.locator('.hh-linesbox')).not.toContainText('Margin');
  });

  test('KEEPS THE CALLER’S OWN RATES VISIBLY APART from the cited ones', async ({ page }) => {
    // FOUR subtotals, never one blended figure. The fourth is the market band,
    // which is structurally incapable of reaching the cited column.
    const tiles = page.locator('.hh-split .hh-tile');
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(0)).toContainText('Sourced');
    await expect(tiles.nth(1)).toContainText('Your rates');
    await expect(tiles.nth(2)).toContainText('Index-derived');
    await expect(tiles.nth(3)).toContainText('Market estimate');
    // The user-rate tile is drawn differently — dashed, never the same surface.
    await expect(tiles.nth(1)).toHaveClass(/is-yours/);
    const dashed = await tiles.nth(1).evaluate((el) => getComputedStyle(el).borderStyle);
    expect(dashed).toContain('dashed');
    // And every line built from their rate carries the literal pill.
    const tags = page.locator('.hh-linesbox .hh-tag');
    expect(await tags.count()).toBeGreaterThan(0);
    await expect(tags.first()).toHaveText(/YOUR RATE — NOT A FIGURE WE SOURCE/i);
  });

  test('THE CONFIDENCE NUMBER NEVER APPEARS WITHOUT ITS REASONS', async ({ page }) => {
    const score = page.locator('#hh-score');
    await expect(score).toBeVisible();
    await expect(score).toHaveText(/^\d{1,3}%$/);
    // The reasons sit directly under it, visible, not behind a disclosure.
    const reasons = page.locator('.hh-kpi .hh-why li');
    expect(await reasons.count()).toBeGreaterThan(0);
    await expect(reasons.first()).toBeVisible();
    // And the full list, with the engine field each keys on, is one click away.
    const fold = page.locator('#hh-whyfold');
    await expect(fold).toBeVisible();
    await fold.locator('summary').click();
    await expect(fold).toContainText('Keys on:');
    await expect(fold).toContainText(/measured|ratio|judgement/);
  });

  test('scores in a band consistent with its own label', async ({ page }) => {
    const score = Number((await page.locator('#hh-score').innerText()).replace('%', ''));
    // `innerText` applies `text-transform: uppercase`; the label is authored in
    // lower case, so compare on a case-folded copy rather than the painted one.
    const label = (await page.locator('.hh-kpilabel').innerText()).toLowerCase();
    if (score >= 85) expect(label).toContain('high');
    else if (score >= 60) expect(label).toContain('medium');
    else expect(label).toContain('low');
  });

  test('shows the address the geocoder MATCHED, not just what was typed', async ({ page }) => {
    await expect(page.locator('.hh-results')).toContainText('1500 MCKINNEY ST, HOUSTON, TX, 77010');
    await expect(page.locator('.hh-results')).toContainText('403 MAIN ST, BUFFALO, NY, 14203');
  });

  test('runs the free cross-check and says it changed nothing', async ({ page }) => {
    await expect(page.locator('.hh-results')).toContainText('Cross-check');
    await expect(page.locator('.hh-results')).toContainText('Nothing was changed');
  });

  // ── THE ACCURACY RATING, WHICH IS THE PRODUCT ─────────────────────────

  test('A CITED CHARGE RENDERS WITH NO RANGE, and says so', async ({ page }) => {
    const permits = line(page, 'State OS/OW permits');
    await expect(permits.locator('.hh-tier').first()).toHaveText('CITED');
    // A cited pill carries no ± — a cited figure has no band at all, and the
    // grouped subtotal is one number rather than "$1,223 – $1,223".
    await expect(permits.locator('.hh-tier').first()).not.toContainText('±');
    const amount = (await permits.locator('> .hh-lamt').innerText()).trim();
    expect(amount, 'a cited figure must render as one number').toBe('$1,223.18');
    expect(amount).not.toContain('–');
  });

  test('A BENCHMARK CHARGE ALWAYS RENDERS AS A RANGE, never a point', async ({ page }) => {
    const benchmarks = page.locator('.hh-line', { has: page.locator('.hh-tier--benchmark') });
    expect(await benchmarks.count(), 'the lane must produce market money').toBeGreaterThan(0);
    const priced = benchmarks.filter({ hasNot: page.locator('.hh-lamt.is-nil') }).first();
    const amount = await priced.locator('> .hh-lamt').innerText();
    expect(amount, `a benchmark must be a range: ${amount}`).toMatch(/\$[\d,]+ – \$[\d,]+/);
    // The single figure beneath it is labelled as nothing more than the number
    // the delivered total actually summed.
    expect(amount).toContain('in the total');
  });

  test('the hover card is BRIEF, with the argument behind READ MORE', async ({ page }) => {
    const pill = page.locator('.hh-tier--benchmark[aria-controls]:visible').first();
    await pill.click();
    const card = page.locator('.hh-hover.is-open').first();
    await expect(card).toBeVisible();
    const brief = await card.locator('.hh-hbrief').innerText();
    // The engine enforces ≤240 characters on `hover` and puts the argument in
    // `detail`; a card that rendered `detail` would blow straight past it.
    expect(brief.length, `hover card text is ${brief.length} chars`).toBeLessThanOrEqual(260);
    const detail = card.locator('.hh-hdetail');
    await expect(detail).toBeHidden();
    await card.locator('.hh-more').click();
    await expect(detail).toBeVisible();
    expect((await detail.innerText()).length).toBeGreaterThan(brief.length);
    // Subtle: a bordered text button, not a filled one.
    const fill = await card.locator('.hh-more').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test('DETENTION AND LAYOVER ARE DISCLOSED AND NOT ADDED', async ({ page }) => {
    const risk = page.locator('#hh-risk');
    await expect(risk).toBeVisible();
    await expect(risk).toContainText('NOT in the total');
    await expect(risk).toContainText(/Detention after 2 free hours/);
    await expect(risk).toContainText(/Layover/);
    // The published hourly rate is on screen — that is the whole point, because
    // a shipper carries $50–$100 in his head and this is several times it.
    await expect(risk).toContainText(/\$\d/);
    // And not a cent of it reached the delivered figure: the four subtotals
    // still add up to the headline.
    const money = (t: string) => Number(t.replace(/[^0-9.]/g, ''));
    const tiles = await page.locator('.hh-split .hh-tile .v').allInnerTexts();
    const total = money(await page.locator('.hh-tv').innerText());
    const summed = tiles.reduce((a, t) => a + (t.includes('$') ? money(t) : 0), 0);
    expect(Math.abs(summed - total), 'the risk lines must not be in the total').toBeLessThan(0.02);
  });

  test('says what it worked out from the cargo instead of asking for it', async ({ page }) => {
    const derived = page.locator('#hh-derived');
    await expect(derived).toBeVisible();
    await derived.locator('summary').click();
    // An inference is never presented as an input: each says what it keys on.
    await expect(derived).toContainText('derived from');
    await expect(derived).toContainText(/Axles/);
    await expect(derived).toContainText(/Trailer class/);
  });

  test('STAYS COMPACT — a workbench, not a scroll-forever report', async ({ page }) => {
    // TWO BUDGETS, because only one of them is ours. The RESULTS column is what
    // this page renders and what a regression would inflate; the document also
    // carries the shared hero, the form and the site footer. The permits page
    // was cut from 8,124px to 3,554px on desktop and this one is built to that
    // discipline. THE RATING ON EVERY CHARGE WAS PAID FOR, not added: grouping
    // the seven permit rows into one, clamping the line notes to two lines now
    // that the full text is one hover away, and merging the lane and mileage
    // cards bought back more than the pills and cards cost.
    const { results, doc } = await page.evaluate(() => ({
      results: Math.round((document.querySelector('.hh-results') as HTMLElement).getBoundingClientRect().height),
      doc: document.documentElement.scrollHeight,
    }));
    expect(results, `desktop results column ${results}px`).toBeLessThan(2600);
    expect(doc, `desktop document ${doc}px`).toBeLessThan(4200);
  });

  test('does not scroll the document sideways', async ({ page }) => {
    await assertNoHorizontalOverflow(page, 'desktop, priced');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The worked-example button — a SHIPPER's lane, zero geocoder calls
// ──────────────────────────────────────────────────────────────────────────

test('the worked example is cargo and two addresses, and prices from them', async ({ page }) => {
  await openTool(page);
  await page.click('#hh-example');
  await page.waitForSelector('.hh-results .hh-total', { timeout: 30_000 });
  // Nothing a shipper cannot answer was filled in for him.
  await expect(page.locator('#hh-axles')).toHaveValue('');
  await expect(page.locator('#hh-linehaul')).toHaveValue('');
  await expect(page.locator('#hh-legs .hh-leg')).toHaveCount(0);
  await expect(page.locator('.hh-pill[data-route][aria-pressed="true"]')).toHaveCount(0);
  // And it still priced: the lane is routed, the permits are cited per state,
  // and the move itself comes from the market band.
  await expect(page.locator('.hh-linesbox')).toContainText('State OS/OW permits');
  await expect(page.locator('.hh-tier--cited').first()).toBeVisible();
  await expect(page.locator('.hh-linesbox')).toContainText('market rate');
});

// ──────────────────────────────────────────────────────────────────────────
// A lane with only addresses — no rates, no filed miles, nothing derived asked
// ──────────────────────────────────────────────────────────────────────────

test.describe('two addresses and a load — the shipper’s whole journey', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page);
    await fillLoad(page);
    await fillLane(page);
    await submit(page);
  });

  test('prices the move from a market BAND and says it is a band', async ({ page }) => {
    const row = line(page, /^Line haul/);
    await expect(row).toBeVisible();
    await expect(row.locator('.hh-tier')).toHaveText(/BENCHMARK/);
    await expect(row.locator('> .hh-lamt')).toContainText('–');
    await expect(row).toContainText(/MARKET BAND/i);
    // Your own rate replaces it outright, and the row says so.
    await expect(row).toContainText(/replaces this outright|your own/i);
  });

  test('never asks for an axle count, and never needs one', async ({ page }) => {
    // The disclosure is closed, so nothing on screen asks a carrier question.
    await expect(page.locator('#hh-adv')).toHaveJSProperty('open', false);
    const derived = page.locator('#hh-derived');
    await derived.locator('summary').click();
    await expect(derived).toContainText(/Axles: 8/);
    await expect(derived).toContainText('120,000 lb gross');
  });

  test('does not scroll the document sideways', async ({ page }) => {
    await assertNoHorizontalOverflow(page, 'desktop, addresses only');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// LOADING AT EACH END — the question only the shipper can answer
// ──────────────────────────────────────────────────────────────────────────

test('loading provided at BOTH ends prices no crane at all', async ({ page }) => {
  await openTool(page);
  await fillLoad(page);
  await fillLane(page);
  // Both boxes ship ticked, because most shippers do have a machine on site.
  await expect(page.locator('#hh-load-origin')).toBeChecked();
  await expect(page.locator('#hh-load-destination')).toBeChecked();
  await submit(page);
  await expect(page.locator('.hh-linesbox')).not.toContainText(/crane/i);
});

test('loading provided at NEITHER end prices the machine nobody costed', async ({ page }) => {
  await openTool(page);
  await fillLoad(page);
  await fillLane(page);
  await page.uncheck('#hh-load-origin');
  await page.uncheck('#hh-load-destination');
  await submit(page);
  // A filed carrier tariff says the crane and its crew "shall be supplied by
  // the Consignor or Consignee" — so a shipper with neither is buying a machine
  // no one in his quote chain has priced. It is priced here, as a band.
  const accessorials = line(page, 'Accessorials');
  await expect(accessorials).toBeVisible();
  await accessorials.locator('summary').click();
  await expect(accessorials).toContainText(/crane/i);
  await expect(accessorials).toContainText(/pickup/i);
  await expect(accessorials).toContainText(/delivery/i);
});

// ──────────────────────────────────────────────────────────────────────────
// Named refusals — a refusal that quotes a number is not a refusal
// ──────────────────────────────────────────────────────────────────────────

test('an uncovered state is NAMED and unpriced, never $0', async ({ page }) => {
  await openTool(page);
  await fillLoad(page);
  await fillLane(page);
  await fillLegs(page, [
    { state: 'TX', miles: 200 },
    { state: 'MS', miles: 180 },
    { state: 'TN', miles: 250 },
  ]);
  await page.fill('#hh-linehaul', '4.85');
  await submit(page);

  await line(page, 'State OS/OW permits').locator('summary').click();
  const row = subLine(page, 'Mississippi single-trip OS/OW permit');
  await expect(row).toBeVisible();
  await expect(row).toContainText('not priced');
  await expect(row).toContainText('will not infer one from a neighbouring state');
  await expect(page.locator('.hh-total')).toContainText('Partial');
  await expect(page.locator('.hh-kpi')).toContainText('MS not covered');
});

test('a superload is refused a price, because no published fee exists', async ({ page }) => {
  await openTool(page);
  await fillLoad(page);
  await page.fill('#hh-weight', '400000');
  await fillLane(page);
  await fillLegs(page, [{ state: 'TX', miles: 214.98 }]);
  await submit(page);

  // One leg, so the permits group is a single row named for the state.
  await expect(line(page, 'Texas single-trip OS/OW permit')).toContainText('superload');
  await expect(page.locator('.hh-kpi')).toContainText('superload');
  // AND THE MOVE ITSELF IS REFUSED, with a NOT PRICED rating and no money.
  const haul = line(page, /^Line haul/);
  await expect(haul.locator('.hh-tier')).toHaveText('NOT PRICED');
  await expect(haul.locator('> .hh-lamt')).toHaveText('not priced');
  await expect(haul).toContainText(/route survey|engineering/i);
});

test('a tarp above the tariff’s own 14 ft is refused, not extrapolated', async ({ page }) => {
  await openTool(page);
  await fillLoad(page);
  await page.fill('#hh-width', '15');
  await fillLane(page);
  await openOverrides(page);
  await page.check('#hh-tarping');
  await submit(page);

  const accessorials = line(page, 'Accessorials');
  await accessorials.locator('summary').first().click();
  const tarp = subLine(page, /Tarping/);
  await expect(tarp.locator('.hh-tier')).toHaveText('NOT PRICED');
  await expect(tarp.locator('> .hh-lamt')).toHaveText('not priced');
  // A refusal says what to do instead rather than guessing at a number.
  await expect(tarp).toContainText(/spot bid/i);
});

test('an incomplete form is refused before any request is made', async ({ page }) => {
  await openTool(page);
  await fillLoad(page);
  await page.fill('#hh-origin', ORIGIN);
  await page.click('#hh-go');
  await page.waitForSelector('.hh-note--error');
  await expect(page.locator('.hh-note--error')).toContainText('full US street address');
  // Nothing was priced, and nothing that looks like a price is on screen.
  await expect(page.locator('.hh-total')).toHaveCount(0);
});

/**
 * THE FAIL-CLOSED PATH, end to end. This is the one test that reaches the real
 * (free, keyless, public-domain) Census service. It asserts the CONTRACT — a
 * refusal and no price — rather than which of the two refusals came back, so it
 * is correct whether Census answers "no match" or cannot be reached. A price
 * appearing here would be the failure, and that is what it catches.
 */
test('AN ADDRESS THAT CANNOT BE PLACED STOPS THE QUOTE — no price from a guess', async ({
  page,
}) => {
  await openTool(page);
  await fillLoad(page);
  await fillLane(page, 'Nowhere at all, Nowhere, TX 00000', DESTINATION);
  await page.click('#hh-go');
  await page.waitForSelector('.hh-note--error', { timeout: 30_000 });
  await expect(page.locator('.hh-note--error')).toContainText(/could not|not resolved|refused/i);
  await expect(page.locator('.hh-total')).toHaveCount(0);
  await expect(page.locator('.hh-tv')).toHaveCount(0);
});

// ──────────────────────────────────────────────────────────────────────────
// METRIC AND IMPERIAL
// ──────────────────────────────────────────────────────────────────────────

test('THE UNIT TOGGLE CONVERTS WHAT IS TYPED AND ROUND-TRIPS IT EXACTLY', async ({ page }) => {
  await openTool(page);
  const typed = { 'hh-weight': '120000', 'hh-width': '12.5', 'hh-height': '14.5', 'hh-length': '85' };
  for (const [id, value] of Object.entries(typed)) await page.fill(`#${id}`, value);

  await page.click('.hh-pill[data-units="metric"]');
  // IT CONVERTS, IT DOES NOT CLEAR — and it converts at a precision that
  // survives the trip back. 14.5 ft is 4.4196 m, and showing that as 4.42 m
  // is 0.02 in of height on the way home, which is enough to cross a state's
  // fee band and quietly move the quote.
  await expect(page.locator('#hh-weight')).toHaveValue('54431.084');
  await expect(page.locator('#hh-width')).toHaveValue('3.81');
  await expect(page.locator('#hh-height')).toHaveValue('4.4196');
  await expect(page.locator('#hh-length')).toHaveValue('25.908');
  // The field TITLE changes with it, and stays inside the field.
  await expect(page.locator('#hh-weight + .hh-lab')).toHaveText('Gross weight (kg)');
  await expect(page.locator('#hh-width + .hh-lab')).toHaveText('Width (m)');

  await page.click('.hh-pill[data-units="imperial"]');
  // AND NO FLOAT DRIFT ON A ROUND NUMBER. Converting 120,000 lb to kg and back
  // through the factor gives 120,000.04; the exact characters come back.
  for (const [id, value] of Object.entries(typed)) {
    await expect(page.locator(`#${id}`), `${id} must round-trip unchanged`).toHaveValue(value);
  }
  await expect(page.locator('#hh-weight + .hh-lab')).toHaveText('Gross weight (lb)');

  // Twice more, to prove the memo is not a one-shot.
  await page.click('.hh-pill[data-units="metric"]');
  await page.click('.hh-pill[data-units="imperial"]');
  for (const [id, value] of Object.entries(typed)) {
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  }

  // An EDIT in the new system invalidates the memo, so the next switch converts
  // for real rather than handing back a number nobody typed.
  await page.click('.hh-pill[data-units="metric"]');
  await page.fill('#hh-width', '4');
  await page.click('.hh-pill[data-units="imperial"]');
  await expect(page.locator('#hh-width')).toHaveValue('13.1234');

  // Selected = OUTLINE, never a bright fill.
  await expect(page.locator('.hh-pill[data-units="imperial"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a lane entered in METRIC prices the same load as one entered in imperial', async ({
  page,
}) => {
  await openTool(page);
  await page.click('.hh-pill[data-units="metric"]');
  // 120,000 lb / 12.5 ft / 14.5 ft / 85 ft, in the units a European forwarder
  // actually has on the packing list.
  await page.fill('#hh-weight', '54431.084');
  await page.fill('#hh-width', '3.81');
  await page.fill('#hh-height', '4.4196');
  await page.fill('#hh-length', '25.908');
  await fillLane(page);
  await fillLegs(page, REFERENCE_LEGS);
  await submit(page);
  // The permits are computed from inches and pounds either way, so the cited
  // subtotal is the permits-only tool's own figure to the cent.
  await expect(page.locator('.hh-split .hh-tile').first()).toContainText('$1,223.18');
});

// ──────────────────────────────────────────────────────────────────────────
// 375px, both themes
// ──────────────────────────────────────────────────────────────────────────

for (const theme of ['dark', 'light'] as const) {
  test(`renders at exactly 375px in the ${theme} theme without cropping`, async ({ page }) => {
    // MARKED SLOW, NOT GIVEN A LOOSER ASSERTION. This case loads the page,
    // fills the form, builds seven mileage rows, submits, and then reads the
    // painted geometry — genuinely more work than any other test here, and on a
    // loaded machine it ran past the 60s default while every assertion in it
    // still held. `test.slow()` triples the budget and changes nothing about
    // what is checked.
    test.slow();
    await page.setViewportSize({ width: 375, height: 812 });
    await openTool(page, theme);
    await fillLoad(page);
    await fillLane(page);
    await fillLegs(page, REFERENCE_LEGS);
    await page.fill('#hh-linehaul', '4.85');
    await page.fill('#hh-pc-mile', '1.95');
    await submit(page);

    await assertNoHorizontalOverflow(page, `375px ${theme}`);

    // Every result block must fit inside the viewport, not hang off its edge.
    const widest = await page.evaluate(() => {
      let worst = 0;
      document.querySelectorAll('.hh-results *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > worst) worst = r.right;
      });
      return Math.round(worst);
    });
    expect(widest, `${theme}: nothing in the results may extend past 375px`).toBeLessThanOrEqual(376);

    // The headline figure and its score are both readable, not clipped.
    await expect(page.locator('.hh-tv')).toBeVisible();
    await expect(page.locator('#hh-score')).toBeVisible();
    await expect(page.locator('.hh-split .hh-tile')).toHaveCount(4);

    // THE SUBTOTAL TILES STACK — four across at 375px would put four values on
    // four baselines inside one stretched row.
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll('.hh-split .hh-tile')].map((el) =>
        Math.round(el.getBoundingClientRect().top),
      ),
    );
    expect(new Set(tops).size, 'the four tiles must be on four separate rows at 375px').toBe(4);

    // THE HOVER CARD MUST BE OPENABLE ON A PHONE, and must not push the
    // document sideways when it is: at this width it renders in flow rather
    // than as a 320px popover inside a 343px column.
    await tierButton(page).first().click();
    await expect(page.locator('.hh-hover.is-open')).toHaveCount(1);
    await assertNoHorizontalOverflow(page, `375px ${theme}, card open`);

    // The permits page's mobile result was cut from 12,199px to 4,347px. Same
    // discipline: the RESULTS column is the part this page owns, and every line
    // note is clamped with the full text one hover away.
    const { results, doc, note } = await page.evaluate(() => {
      const notes = [...document.querySelectorAll('.hh-ln')].map((el) =>
        Math.round(el.getBoundingClientRect().height),
      );
      return {
        results: Math.round(
          (document.querySelector('.hh-results') as HTMLElement).getBoundingClientRect().height,
        ),
        doc: document.documentElement.scrollHeight,
        note: Math.max(0, ...notes),
      };
    });
    expect(results, `375px ${theme} results column ${results}px`).toBeLessThan(3200);
    expect(doc, `375px ${theme} document ${doc}px`).toBeLessThan(7400);
    // Two lines at 12px/1.5 is 36px. A taller note means the clamp stopped
    // working, which is how a compact result silently becomes a report again.
    expect(note, `375px ${theme} tallest line note ${note}px`).toBeLessThanOrEqual(40);
  });

  test(`the form itself fits 375px in the ${theme} theme`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 375, height: 812 });
    await openTool(page, theme);
    await assertNoHorizontalOverflow(page, `375px ${theme}, empty form`);
    // THE ADDRESSES STACK. Two 160px address boxes are unusable, so the
    // side-by-side row collapses to one column — the only other count that
    // cannot leave a field orphaned.
    const addrTops = await page.evaluate(() =>
      [...document.querySelectorAll('.hh-row2--addr .hh-field')].map((el) =>
        Math.round(el.getBoundingClientRect().top),
      ),
    );
    expect(new Set(addrTops).size, 'the two addresses stack at 375px').toBe(2);
    // The two loading checkmarks do the same, and both have a 44px+ tap target.
    const checkHeights = await page.evaluate(() =>
      [...document.querySelectorAll('.hh-check')].map((el) =>
        Math.round(el.getBoundingClientRect().height),
      ),
    );
    for (const h of checkHeights) expect(h).toBeGreaterThanOrEqual(44);
    await openOverrides(page);
    await assertNoHorizontalOverflow(page, `375px ${theme}, overrides open`);
  });

  test(`theme-aware contrast holds in the ${theme} theme`, async ({ page }) => {
    test.slow();
    await openTool(page, theme);
    const painted = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const hero = document.querySelector('.hh-hero h1');
      return {
        bg: body.backgroundColor,
        heroInk: hero ? getComputedStyle(hero).color : '',
      };
    });
    // Neither may be transparent — a transparent surface borrows whatever is
    // behind it and the two themes stop being distinguishable.
    expect(painted.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(painted.heroInk).not.toBe('rgba(0, 0, 0, 0)');
    expect(painted.heroInk).not.toBe(painted.bg);
  });

  /**
   * The KPI label and the four ACCURACY TIER pills. The test above samples the
   * body against the hero heading and never touched either — which is how a
   * 3.54:1 "HIGH CONFIDENCE" label shipped past it once. This measures a real
   * ratio on the elements that actually render, in both themes, for every
   * variant, against the surface each one actually sits on.
   */
  test(`the confidence label clears WCAG AA in the ${theme} theme`, async ({ page }) => {
    test.slow();
    await openTool(page, theme);
    const ratios = await page.evaluate(() => {
      // getComputedStyle returns TWO notations here. A plain colour comes back
      // as `rgb(r, g, b)` with 0-255 channels; anything resolved through
      // color-mix() comes back as `color(srgb 0.02 0.47 0.37)` with 0-1
      // channels. Reading the second as though it were the first makes a dark
      // green look like near-black and reports a wildly passing ratio, which
      // is exactly how the first version of this test passed on a colour it
      // had not actually measured.
      const lum = (c: string) => {
        const nums = c.match(/[\d.]+/g)!.map(Number);
        const chans = c.startsWith('color(')
          ? nums.slice(0, 3).map((v) => v * 255)
          : nums.slice(0, 3);
        const f = (v: number) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(chans[0]) + 0.7152 * f(chans[1]) + 0.0722 * f(chans[2]);
      };
      const ratio = (ink: string, surface: string) => {
        const a = lum(ink);
        const b = lum(surface);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const out: Record<string, number> = {};

      const surface = getComputedStyle(document.body).backgroundColor;
      const probe = document.createElement('span');
      probe.style.display = 'none';
      document.body.appendChild(probe);
      for (const variant of ['high', 'medium', 'low']) {
        probe.className = 'hh-kpilabel hh-kpilabel--' + variant;
        probe.style.display = '';
        out[variant] = ratio(getComputedStyle(probe).color, surface);
        probe.style.display = 'none';
      }
      probe.remove();

      // The tier pills render on the breakdown card, not on the body.
      const box = document.createElement('div');
      box.className = 'hh-linesbox';
      document.body.appendChild(box);
      const boxSurface = getComputedStyle(box).backgroundColor;
      const pill = document.createElement('span');
      box.appendChild(pill);
      for (const tier of ['cited', 'indexed', 'benchmark', 'refused']) {
        pill.className = 'hh-tier hh-tier--' + tier;
        out['tier:' + tier] = ratio(getComputedStyle(pill).color, boxSurface);
      }
      box.remove();
      return out;
    });
    // 10–11px text — AA large-text relief does not apply below 18.66px.
    for (const key of Object.keys(ratios)) {
      expect(ratios[key], `${key} contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// The standing UI rules
// ──────────────────────────────────────────────────────────────────────────

test('the hero is left-aligned with its eyebrow top-left', async ({ page }) => {
  await openTool(page);
  const boxes = await page.evaluate(() => {
    const eyebrow = document.querySelector('.hh-eyebrow') as HTMLElement;
    const h1 = document.querySelector('.hh-hero h1') as HTMLElement;
    return {
      eyebrowLeft: Math.round(eyebrow.getBoundingClientRect().left),
      h1Left: Math.round(h1.getBoundingClientRect().left),
      eyebrowTop: Math.round(eyebrow.getBoundingClientRect().top),
      h1Top: Math.round(h1.getBoundingClientRect().top),
      align: getComputedStyle(h1).textAlign,
    };
  });
  expect(boxes.align).toBe('left');
  expect(Math.abs(boxes.eyebrowLeft - boxes.h1Left)).toBeLessThanOrEqual(1);
  expect(boxes.eyebrowTop).toBeLessThan(boxes.h1Top);
});

test('a selected route-class pill is an OUTLINE, never a bright fill', async ({ page }) => {
  await openTool(page);
  await openOverrides(page);
  await page.click('.hh-pill[data-route="interstate"]');
  const style = await page.locator('.hh-pill[data-route="interstate"]').evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopWidth, bg: s.backgroundColor, color: s.color };
  });
  expect(parseFloat(style.border)).toBeGreaterThanOrEqual(2);
  // A tint, not a solid fill: the selected pill's background must stay largely
  // transparent so the label keeps the body's own contrast.
  const alpha = /rgba?\([^)]*,\s*([\d.]+)\)$/.exec(style.bg);
  if (alpha) expect(parseFloat(alpha[1] as string)).toBeLessThan(0.4);
});

test('the four route-class pills wrap 2×2 and never leave one alone', async ({ page }) => {
  await openTool(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await openOverrides(page);
  const rows = await page.evaluate(() => {
    const tops = [...document.querySelectorAll('#hh-routeclass .hh-pill')].map((el) =>
      Math.round(el.getBoundingClientRect().top),
    );
    const counts = new Map<number, number>();
    for (const t of tops) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.values()];
  });
  expect(rows).toEqual([2, 2]);
});

test('stacked form components sit 2px apart, with the title inside the field', async ({ page }) => {
  await openTool(page);
  const gap = await page.evaluate(
    () => getComputedStyle(document.querySelector('.hh-stack') as HTMLElement).rowGap,
  );
  expect(gap).toBe('2px');
  const labelInside = await page.evaluate(() => {
    const field = document.querySelector('.hh-field') as HTMLElement;
    const input = field.querySelector('input') as HTMLElement;
    const label = field.querySelector('.hh-lab') as HTMLElement;
    const f = input.getBoundingClientRect();
    const l = label.getBoundingClientRect();
    return l.top >= f.top - 1 && l.bottom <= f.bottom + 1;
  });
  expect(labelInside, 'the field title must render inside the input, not above it').toBe(true);
});

test('the page links the permits-only tool rather than replacing it', async ({ page }) => {
  await openTool(page);
  const res = await page.request.get('/tools/oversize-permits');
  expect(res.status(), 'the permits-only tool must be untouched').toBe(200);
  await expect(page.locator('footer a[href="/tools/oversize-permits"]').first()).toHaveCount(1);
  await expect(page.locator('footer a[href="/tools/heavy-haul-quote"]').first()).toHaveCount(1);
});

// ──────────────────────────────────────────────────────────────────────────
// THE OOG CTA — subtle, in the header bar and the footer bar, and it must NOT
// reintroduce the header overflow #476/#477 removed.
// ──────────────────────────────────────────────────────────────────────────

test.describe('the OOG call to action', () => {
  const SURFACES = ['/tools/heavy-haul-quote', '/pricing', '/directory', '/'];

  test('sits in the header action cluster and the footer bar, quietly', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTool(page);
    const header = page.locator('.site-actions .site-oog');
    await expect(header).toBeVisible();
    await expect(header).toHaveAttribute('href', '/tools/heavy-haul-quote');
    // SUBTLE: a text link, not a button, and not a coloured banner. Its
    // background is the header's own and it carries no border.
    const painted = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, border: s.borderTopWidth };
    });
    expect(painted.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(parseFloat(painted.border)).toBe(0);
    // And it is not a second primary CTA beside the existing one.
    await expect(page.locator('.site-actions .btn')).toHaveCount(1);

    const footer = page.locator('footer .qf-foot-oog');
    await expect(footer).toBeVisible();
    await expect(footer).toHaveAttribute('href', '/tools/heavy-haul-quote');
  });

  test('the footer copy is present at 375px, where the header bar is a burger', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openTool(page);
    await expect(page.locator('.site-actions .site-oog')).toBeHidden();
    await expect(page.locator('.site-burger')).toBeVisible();
    await expect(page.locator('footer .qf-foot-oog')).toBeVisible();
  });

  test('ZERO HEADER OVERFLOW at every width, on every chrome surface', async ({ page }) => {
    test.slow();
    for (const path of SURFACES) {
      for (const width of [320, 375, 640, 768, 900, 1023, 1024, 1100, 1140, 1141, 1200, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: 800 });
        const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        expect(res?.status(), `${path} must serve`).toBe(200);
        const m = await page.evaluate(() => {
          const inner = document.querySelector('.site-header-inner') as HTMLElement | null;
          return {
            doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            head: inner ? inner.scrollWidth - inner.clientWidth : 0,
          };
        });
        expect(m.doc, `${path} @${width}px: the document must not scroll sideways`).toBeLessThanOrEqual(1);
        expect(m.head, `${path} @${width}px: the header bar must not overflow its card`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('ONE COLLAPSE POINT, at 1024px', async ({ page }) => {
    // 641–960px used to have a bar that ran off the end; #476/#477 replaced it
    // with a single point. The CTA must not open a second one.
    for (const [width, expectBurger] of [
      [1023, true],
      [1024, false],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await openTool(page);
      const vis = async (sel: string) =>
        page.evaluate((s) => {
          const el = document.querySelector(s);
          if (!el) return false;
          const cs = getComputedStyle(el);
          return cs.display !== 'none' && el.getBoundingClientRect().width > 0;
        }, sel);
      expect(await vis('.site-burger'), `burger @${width}px`).toBe(expectBurger);
      expect(await vis('.site-nav'), `nav @${width}px`).toBe(!expectBurger);
    }
  });
});
