/**
 * /tools/oversize-permits — the OS/OW state-permit calculator, driven in a real
 * browser.
 *
 * WHY THIS FILE EXISTS. The unit suite asserts the engine's arithmetic and the
 * page's CSS as STRINGS: `expect(html).toMatch(/\.ow-flags \{[^}]*repeat\(2/)`.
 * A string match cannot see a rendered orphan, a horizontal scrollbar, a tile
 * whose number contradicts the block beneath it, or a disclaimer that fell below
 * the fold — and those are exactly the failures this surface cannot ship with,
 * because it is the first customer-facing consumer of the permit engine and its
 * whole claim is that the number can be trusted and checked.
 *
 * Everything here drives the real form against the real endpoint and reads what
 * the browser actually painted. No mocks: the calculator is pure computation
 * over compiled jurisdiction data with NO DATABASE, which is precisely why it
 * can be exercised end to end while the dev database is unavailable.
 *
 * Run: `pnpm test:e2e tests/e2e/osow-permit-calculator.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test';

const TOOL_PATH = '/tools/oversize-permits';

interface Leg {
  state: string;
  miles: number;
}

interface Load {
  grossWeightLbs: number;
  widthFt?: number;
  widthIn?: number;
  heightFt?: number;
  heightIn?: number;
  lengthFt?: number;
  axles?: number;
  routeClass?: string;
}

/**
 * THE REFERENCE LANE, as a dispatcher types it. Houston to Buffalo, 120,000 lb,
 * 12'6" wide, 14'6" high, 85 ft long, 8 axles, interstate — the same fixture the
 * unit suite prices at $1,223.18, entered through the form instead of passed to
 * a function.
 */
const REFERENCE_LOAD: Load = {
  grossWeightLbs: 120_000,
  widthFt: 12,
  widthIn: 6,
  heightFt: 14,
  heightIn: 6,
  lengthFt: 85,
  axles: 8,
  routeClass: 'interstate',
};

const REFERENCE_LEGS: Leg[] = [
  { state: 'TX', miles: 215 },
  { state: 'AR', miles: 337 },
  { state: 'TN', miles: 250 },
  { state: 'KY', miles: 62.4 },
  { state: 'OH', miles: 145 },
  { state: 'PA', miles: 46 },
  { state: 'NY', miles: 60 },
];

async function openTool(page: Page) {
  const res = await page.goto(TOOL_PATH, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  expect(res?.status(), `${TOOL_PATH} must serve with the database down`).toBe(200);
  await page.waitForSelector('#ow-form .ow-leg');
}

async function fillLoad(page: Page, load: Load) {
  await page.fill('#ow-weight', String(load.grossWeightLbs));
  if (load.widthFt !== undefined) await page.fill('#ow-width-ft', String(load.widthFt));
  if (load.widthIn !== undefined) await page.fill('#ow-width-in', String(load.widthIn));
  if (load.heightFt !== undefined) await page.fill('#ow-height-ft', String(load.heightFt));
  if (load.heightIn !== undefined) await page.fill('#ow-height-in', String(load.heightIn));
  if (load.lengthFt !== undefined) await page.fill('#ow-length-ft', String(load.lengthFt));
  if (load.axles !== undefined) await page.fill('#ow-axles', String(load.axles));
  if (load.routeClass) await page.click(`.ow-pill[data-route="${load.routeClass}"]`);
}

async function fillLegs(page: Page, legs: Leg[]) {
  const rows = page.locator('#ow-legs .ow-leg');
  while ((await rows.count()) < legs.length) await page.click('#ow-add');
  while ((await rows.count()) > legs.length) await rows.last().locator('.ow-legdrop').click();
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] as Leg;
    await rows.nth(i).locator('.ow-leg-state').selectOption(leg.state);
    await rows.nth(i).locator('.ow-leg-miles').fill(String(leg.miles));
  }
}

async function calculate(page: Page, load: Load, legs: Leg[]) {
  await fillLoad(page, load);
  await fillLegs(page, legs);
  await page.click('#ow-go');
  await page.waitForSelector('.ow-results .ow-total, .ow-results .ow-note--error', {
    timeout: 30_000,
  });
}

/**
 * The results scroll themselves into view with `behavior: 'smooth'`, so a
 * geometry read taken the instant the node appears is a read of an animation
 * frame. Wait for the scroll position to stop moving before measuring anything.
 */
async function waitForScrollSettle(page: Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __owLastY?: number; __owStill?: number };
      const y = Math.round(window.scrollY);
      if (w.__owLastY === y) w.__owStill = (w.__owStill ?? 0) + 1;
      else w.__owStill = 0;
      w.__owLastY = y;
      return (w.__owStill ?? 0) >= 3;
    },
    undefined,
    { polling: 100, timeout: 10_000 },
  );
}

/** The page must never scroll sideways. Reads what the browser laid out. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
}

/**
 * The reference lane is priced ONCE and then read six ways.
 *
 * `/api/tools/osow-permits` is behind `publicCalcLimiter` at 30 requests a
 * minute from one address, and a suite that re-priced the same lane in every
 * test spent that budget on nothing — two consecutive full runs tipped it and a
 * later test failed with a 429 that had nothing to do with the calculator.
 * One calculation, one shared page, serial order.
 */
test.describe('OS/OW calculator — the priced lane', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    const baseURL =
      testInfo.project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5000';
    const context = await browser.newContext({ baseURL });
    page = await context.newPage();
    await openTool(page);
    await calculate(page, REFERENCE_LOAD, REFERENCE_LEGS);
    await waitForScrollSettle(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test('prices the reference lane at $1,223.18 through the form', async () => {
    await expect(page.locator('.ow-total .ow-tv')).toHaveText('$1,223.18');
    // The label says what the number IS, before anyone reads it as a quote.
    await expect(page.locator('.ow-total .ow-tl')).toContainText('State permit fees');
    // Seven states, seven blocks, each with its own subtotal.
    await expect(page.locator('.ow-state')).toHaveCount(7);

    const subtotals = await page.locator('.ow-lines .sub .num').allTextContents();
    expect(subtotals.map((s) => s.trim()).sort()).toEqual(
      ['$145.00', '$214.98', '$320.00', '$337.00', '$60.00', '$62.40', '$83.80'].sort(),
    );
  });

  test('keeps the disclaimer 4px under the number and above the fold', async () => {
    const geometry = await page.evaluate(() => {
      const value = document.querySelector('.ow-total .ow-tv');
      const sub = document.querySelector('.ow-total .ow-tsub');
      if (!value || !sub) return null;
      const v = value.getBoundingClientRect();
      const s = sub.getBoundingClientRect();
      return {
        gap: s.top - v.bottom,
        subTop: s.top,
        subBottom: s.bottom,
        viewport: window.innerHeight,
        text: sub.textContent ?? '',
      };
    });
    expect(geometry).not.toBeNull();
    const g = geometry as NonNullable<typeof geometry>;
    // 4px margin, measured on the painted boxes rather than asserted as a
    // CSS string.
    expect(g.gap).toBeGreaterThanOrEqual(0);
    expect(g.gap).toBeLessThanOrEqual(6);
    expect(g.text).toContain('Not a freight quote');
    // Above the fold: the exclusion is on screen WITH the number it qualifies,
    // once the page has finished scrolling the result into view.
    await expect(page.locator('.ow-total .ow-tv')).toBeInViewport();
    await expect(page.locator('.ow-total .ow-tsub')).toBeInViewport();
    expect(g.viewport).toBeGreaterThan(0);
    expect(g.subBottom - g.subTop).toBeGreaterThan(0);
  });

  test('renders escorts as a requirement with the cost excluded, never $0', async () => {
    // Lane level.
    const escortNote = page.locator('.ow-note', { hasText: 'Pilot cars / escorts' });
    await expect(escortNote).toBeVisible();
    await expect(escortNote).toContainText('Escort COST is not included anywhere in this total');
    await expect(escortNote).toContainText('Cost not included.');

    // Per state — Kentucky and New York each require one on this load.
    const perState = page.locator('.ow-over', { hasText: 'certified escort' });
    expect(await perState.count()).toBeGreaterThanOrEqual(2);
    await expect(perState.first()).toContainText('escort COST is not included in any figure on this page');

    // A price would be the lie. There is none anywhere near the escort copy.
    const escortText = (await escortNote.textContent()) ?? '';
    expect(escortText).not.toMatch(/\$0(\.00)?\b/);
    const overText = (await perState.allTextContents()).join(' ');
    expect(overText).not.toMatch(/\$\d/);

    // And the summary tile calls it a per-state figure, not a lane total.
    const tile = page.locator('.ow-flag', { hasText: 'Escorts, per state' });
    await expect(tile).toContainText('per state');
    await expect(tile).toContainText('not a lane total');
    await expect(tile).toContainText('Cost NOT included');
  });

  test('renders every review reason expanded, not behind a toggle', async () => {
    // Tennessee and New York carry the unsettled facts on this lane.
    const why = page.locator('.ow-why');
    expect(await why.count()).toBeGreaterThanOrEqual(2);
    await expect(why.first()).toBeVisible();
    // Visible WITHOUT a click: no <details> ancestor, and the reasons are list
    // items that are painted right now.
    const reasons = why.first().locator('li');
    expect(await reasons.count()).toBeGreaterThan(0);
    await expect(reasons.first()).toBeVisible();
    const insideDetails = await why
      .first()
      .evaluate((el) => el.closest('details') !== null);
    expect(insideDetails).toBe(false);
  });

  test('shows absorbed conflicts as low, high and adopted', async () => {
    const absorbed = page.locator('.ow-note--warn', {
      hasText: 'Fees rounded up because official sources disagreed',
    });
    await expect(absorbed).toBeVisible();
    const text = (await absorbed.textContent()) ?? '';
    expect(text).toMatch(/quoted at \$[\d,.]+, the higher of \$[\d,.]+ and \$[\d,.]+/);
    expect(text).toMatch(/\$[\d,.]+ apart/);
  });
});

test.describe('OS/OW calculator — refusals a user can reach', () => {
  test('refuses a lane touching an uncovered state with null, not $0', async ({ page }) => {
    await openTool(page);
    await calculate(page, REFERENCE_LOAD, [
      { state: 'TX', miles: 215 },
      { state: 'MS', miles: 160 },
      { state: 'AL', miles: 90 },
    ]);

    // The headline is a refusal, and it is not a zero.
    await expect(page.locator('.ow-total .ow-tv')).toHaveText('Not priceable');
    await expect(page.locator('.ow-total .ow-tv')).not.toHaveText(/\$0/);
    await expect(page.locator('.ow-total .ow-tl')).toHaveText('No lane total');

    // Mississippi is named as its own block rather than silently dropped.
    const uncovered = page.locator('.ow-note--error');
    await expect(uncovered).toContainText('Mississippi (MS)');
    await expect(uncovered).toContainText('nothing is charged for it and nothing is assumed');

    // The states we DO hold still price, so the refusal is partial and honest.
    await expect(page.locator('.ow-state')).toHaveCount(2);
  });

  test('never claims a covered-but-unpriced state was priced', async ({ page }) => {
    // Florida comes back COVERED with a null subtotal on this load — no overall
    // length, so its oversize band cannot be selected — while Georgia prices.
    // The tile used to read "2 of 2 — every state on this lane is covered"
    // directly above a Florida block reading "Not priceable".
    //
    // Driven at 375px, because the replacement copy is longer than what it
    // replaced and the narrow tile is where a longer string would break out.
    await page.setViewportSize({ width: 375, height: 812 });
    await openTool(page);
    await calculate(
      page,
      { grossWeightLbs: 120_000, widthFt: 12, widthIn: 6, heightFt: 14, heightIn: 6, axles: 8, routeClass: 'interstate' },
      [
        { state: 'FL', miles: 300 },
        { state: 'GA', miles: 120 },
      ],
    );

    const tile = page.locator('.ow-flag', { hasText: 'States priced' });
    await expect(tile.locator('.v')).toHaveText('1 of 2');
    await expect(tile).toContainText('covered but not priceable for this load');
    await expect(tile).not.toContainText('Every state on this lane is covered');

    // And the block below still says the same thing, so the two agree. Matched
    // on the state's own heading — another state's citations can mention
    // Florida, and a text filter would pick both blocks up.
    const florida = page
      .locator('.ow-state')
      .filter({ has: page.locator('.ow-sh h3', { hasText: /^Florida$/ }) });
    await expect(florida).toHaveCount(1);
    await expect(florida.locator('.ow-sh .amt')).toHaveText('Not priceable');
    await expect(page.locator('.ow-total .ow-tv')).toHaveText('Not priceable');

    const size = await horizontalOverflow(page);
    expect(size.scrollWidth, JSON.stringify(size)).toBeLessThanOrEqual(size.clientWidth);
  });

  test('blames the mileage when Arkansas’s 251-mile hole voids the lane', async ({ page }) => {
    await openTool(page);
    await calculate(page, REFERENCE_LOAD, [{ state: 'AR', miles: 251 }]);

    const why = page.locator('.ow-why');
    await expect(why.first()).toBeVisible();
    const text = (await why.first().textContent()) ?? '';
    expect(text).toContain('No overweight fee band on file covers a 251-mile move in Arkansas');
    expect(text).toContain('it is the MILEAGE that falls in the gap, not the weight');
    expect(text).not.toContain('No overweight fee band on file covers 120,000 lb in Arkansas');
  });

  test('stops the Add button at the 20-state cap instead of a bare “Invalid input”', async ({ page }) => {
    await openTool(page);
    const add = page.locator('#ow-add');
    const rows = page.locator('#ow-legs .ow-leg');

    while ((await rows.count()) < 20) await add.click();
    await expect(rows).toHaveCount(20);
    await expect(add).toBeDisabled();
    await expect(add).toContainText('Limit: 20 states');
    // The label must fit its own button at the narrowest width the site
    // supports — an inline-flex `.btn` overflows rather than wrapping.
    await page.setViewportSize({ width: 320, height: 812 });
    const fits = await add.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(fits.scrollWidth, JSON.stringify(fits)).toBeLessThanOrEqual(fits.clientWidth);
    await expect(page.locator('#ow-cap')).toBeVisible();
    await expect(page.locator('#ow-cap')).toContainText('20 states is the most one lane can carry');

    // Clicking a disabled control cannot produce a 21st row.
    await add.click({ force: true });
    await expect(rows).toHaveCount(20);

    // Dropping one re-opens it.
    await rows.last().locator('.ow-legdrop').click();
    await expect(rows).toHaveCount(19);
    await expect(add).toBeEnabled();
    await expect(page.locator('#ow-cap')).toBeHidden();
  });

  test('refuses a 0-mile leg with the words the page already used', async ({ page }) => {
    await openTool(page);
    await fillLoad(page, REFERENCE_LOAD);
    await fillLegs(page, [{ state: 'PA', miles: 0 }]);
    await page.click('#ow-go');
    const error = page.locator('.ow-results .ow-note--error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('not a usable distance');
    await expect(error).toContainText('positive number');
    // Nothing was priced, so nothing understated a per-mile state at $0.
    await expect(page.locator('.ow-total')).toHaveCount(0);
  });
});

test.describe('OS/OW calculator — layout the browser actually painted', () => {
  test('never scrolls sideways on a 7-state result at 375px, in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openTool(page);
    await calculate(page, REFERENCE_LOAD, REFERENCE_LEGS);

    const dark = await horizontalOverflow(page);
    expect(dark.scrollWidth, `dark: ${JSON.stringify(dark)}`).toBeLessThanOrEqual(dark.clientWidth);

    await page.evaluate(() => {
      localStorage.setItem('qf-theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    const light = await horizontalOverflow(page);
    expect(light.scrollWidth, `light: ${JSON.stringify(light)}`).toBeLessThanOrEqual(
      light.clientWidth,
    );
  });

  test('never scrolls sideways with a 20-state lane at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openTool(page);
    // Twenty covered-or-not states, which is the widest the form can get.
    const codes = [
      'AL', 'AR', 'AZ', 'CA', 'CO', 'FL', 'GA', 'IL', 'IN', 'KY',
      'LA', 'MO', 'MS', 'NC', 'NJ', 'NY', 'OH', 'OK', 'PA', 'TN',
    ];
    await calculate(
      page,
      REFERENCE_LOAD,
      codes.map((state) => ({ state, miles: 120 })),
    );
    const size = await horizontalOverflow(page);
    expect(size.scrollWidth, JSON.stringify(size)).toBeLessThanOrEqual(size.clientWidth);
  });

  test('lays the coverage chips out 7 across and never orphans a badge', async ({ page }) => {
    await openTool(page);
    const chips = await page.evaluate(() => {
      const grid = document.querySelector('.ow-cov');
      if (!grid) return null;
      return {
        count: grid.children.length,
        columns: getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      };
    });
    expect(chips).not.toBeNull();
    expect((chips as NonNullable<typeof chips>).columns).toBe(7);
    expect((chips as NonNullable<typeof chips>).count % 7).toBe(0);

    await calculate(page, REFERENCE_LOAD, REFERENCE_LEGS);
    // renderState pads an odd badge count with the as-of badge, so no row can
    // end with a single item in a two-column grid.
    const badgeCounts = await page.$$eval('.ow-badges', (els) => els.map((e) => e.children.length));
    expect(badgeCounts.length).toBeGreaterThan(0);
    for (const n of badgeCounts) expect(n % 2).toBe(0);

    // The four result tiles are a 2x2 for the same reason.
    await expect(page.locator('.ow-flag')).toHaveCount(4);
  });
});

test.describe('OS/OW calculator — the API behind it', () => {
  test.setTimeout(120_000);

  test('prices with no database and refuses the inputs the form cannot make', async ({ request }) => {
    /**
     * `publicCalcLimiter` allows 30 requests a minute from one address, and
     * every browser test above spends from the same budget. A 429 here is the
     * limiter working, not the calculator failing — so wait out the window it
     * reports and ask again rather than asserting on it.
     */
    const post = async (data: unknown) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await request.post('/api/tools/osow-permits', { data });
        if (res.status() !== 429) return res;
        const reset = Number(res.headers()['ratelimit-reset'] ?? '5');
        await new Promise((r) => setTimeout(r, (Number.isFinite(reset) ? reset : 5) * 1000 + 1000));
      }
      return request.post('/api/tools/osow-permits', { data });
    };

    const load = {
      grossWeightLbs: 120_000,
      widthIn: 150,
      heightIn: 174,
      overallLengthIn: 1020,
      axleCount: 8,
      routeClass: 'interstate',
    };

    const ok = await post({ load, legs: REFERENCE_LEGS });
    expect(ok.status()).toBe(200);
    const body = (await ok.json()) as { quote: { totalPermitUsd: number | null } };
    expect(body.quote.totalPermitUsd).toBe(1223.18);

    for (const [payload, pattern] of [
      [{ load, legs: [{ state: 'PR', miles: 100 }] }, /US territory/],
      [{ load, legs: [{ state: 'ZZ', miles: 100 }] }, /not a US state code/],
      [{ load, legs: [{ state: 'PA', miles: 0 }] }, /positive number/i],
      [{ load, legs: REFERENCE_LEGS, asOf: '1800-01-01' }, /asOf must fall between/],
    ] as const) {
      const res = await post(payload);
      expect(res.status(), JSON.stringify(payload.legs?.[0] ?? {})).toBe(400);
      const err = (await res.json()) as { error?: string };
      expect(String(err.error)).toMatch(pattern);
    }
  });
});
