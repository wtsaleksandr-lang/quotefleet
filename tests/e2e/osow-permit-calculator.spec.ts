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

/** The operator's OWN pilot-car rate, as the form takes it. */
interface PilotRate {
  usdPerMile?: number;
  usdPerDay?: number;
  days?: number;
  minimum?: number;
}

async function fillPilotRate(page: Page, rate: PilotRate) {
  if (rate.usdPerMile !== undefined) await page.fill('#ow-pc-mile', String(rate.usdPerMile));
  if (rate.usdPerDay !== undefined) await page.fill('#ow-pc-day', String(rate.usdPerDay));
  if (rate.days !== undefined) await page.fill('#ow-pc-days', String(rate.days));
  if (rate.minimum !== undefined) await page.fill('#ow-pc-min', String(rate.minimum));
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
  /**
   * The response the PAGE ITSELF received, captured off the wire rather than
   * re-requested. A second POST would spend another slot of the 30-a-minute
   * public limiter for data the browser already has, and — worse — would let a
   * test pass against a response the page never rendered.
   */
  let apiBody: {
    quote: { totalPermitUsd: number | null };
    review: { byState: Array<{ code: string; notes: string[] }> };
    escorts: { costIncluded: boolean };
    escortEstimate: { estimate: { pilotCarBasis: string; pilotCarUsd: number | null } | null };
  } | null = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    const baseURL =
      testInfo.project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5000';
    const context = await browser.newContext({ baseURL });
    page = await context.newPage();
    page.on('response', async (res) => {
      if (!res.url().includes('/api/tools/osow-permits') || res.status() !== 200) return;
      try {
        apiBody = await res.json();
      } catch {
        /* a non-JSON body is not this lane's response */
      }
    });
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
    // Lane level. The copy was reworded when the page gained a rate input — the
    // claim that stays is that escort money is NEVER inside the permit total.
    const escortNote = page.locator('.ow-note', { hasText: 'Pilot cars / escorts' });
    await expect(escortNote).toBeVisible();
    await expect(escortNote).toContainText('Escort COST is never inside the permit total');
    await expect(escortNote).toContainText('we hold no rates of our own');
    // The stale sentence is gone: this page no longer tells the user to go and
    // do the sum somewhere else, because it will do it from their rate.
    await expect(escortNote).not.toContainText('the cost is yours to add');

    // Per state — Kentucky and New York each require one on this load.
    const perState = page.locator('.ow-over', { hasText: 'certified escort' });
    expect(await perState.count()).toBeGreaterThanOrEqual(2);
    await expect(perState.first()).toContainText('escort COST is not included in any figure on this page');

    // A price would be the lie. There is none anywhere near the escort copy, and
    // with no rate supplied the figure is UNKNOWN rather than zero.
    const escortText = (await escortNote.textContent()) ?? '';
    expect(escortText).not.toMatch(/\$0(\.00)?\b/);
    await expect(page.locator('.ow-yourv')).toHaveText('Cost unknown');
    await expect(page.locator('.ow-yourtag')).toHaveText('No pilot-car rate supplied');
    const overText = (await perState.allTextContents()).join(' ');
    expect(overText).not.toMatch(/\$\d/);

    // And the summary tile calls it a per-state figure, not a lane total.
    const tile = page.locator('.ow-flag', { hasText: 'Escorts, per state' });
    await expect(tile).toContainText('per state');
    await expect(tile).toContainText('not a lane total');
    await expect(tile).toContainText('Cost NOT included');
  });

  test('shows the review reason beside the badge and every note one click away', async () => {
    // Tennessee and New York carry the unsettled facts on this lane.
    const why = page.locator('.ow-why');
    expect(await why.count()).toBeGreaterThanOrEqual(2);

    const tennessee = page
      .locator('.ow-state')
      .filter({ has: page.locator('.ow-sh h3', { hasText: /^Tennessee$/ }) });
    // The BADGE is painted, not folded.
    await expect(tennessee.locator('.ow-badge--review')).toHaveText('Manual review');
    // The REASON is painted, not folded, and it is a note the engine recorded
    // verbatim rather than a summary written here.
    const reason = tennessee.locator('.ow-reason');
    await expect(reason).toBeVisible();
    const reasonText = ((await reason.textContent()) ?? '').trim();
    expect(reasonText.length).toBeGreaterThan(40);
    expect(await reason.evaluate((el) => el.closest('details') !== null)).toBe(false);
    // A ONE-LINE REASON, not a second essay. Tennessee's most state-specific
    // unsettled note runs to ~1,800 characters; the preview is clamped to three
    // lines and the disclosure below holds it verbatim.
    const clamp = await reason.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        height: Math.round(el.getBoundingClientRect().height),
        lineHeight: parseFloat(cs.lineHeight),
        overflow: cs.overflowY,
      };
    });
    expect(clamp.overflow, 'overflow: clip, never hidden').not.toBe('hidden');
    expect(clamp.height).toBeLessThanOrEqual(Math.ceil(clamp.lineHeight * 3) + 4);

    // AND NOTHING WAS LOST. The disclosure holds every note the API returned for
    // Tennessee, in the API's own order, verbatim — including the one shown
    // above it. Checked against the response the page actually received.
    expect(apiBody, 'the page must have received a 200 from the calculator').not.toBeNull();
    const notes = apiBody?.review.byState.find((s) => s.code === 'TN')?.notes ?? [];
    expect(notes.length).toBeGreaterThanOrEqual(10);

    const fold = tennessee.locator('.ow-why details.ow-fold');
    await expect(fold.locator('summary')).toContainText(`(${notes.length})`);
    await expect(fold.locator('summary')).toContainText('nothing is dropped');
    const rendered = (await fold.locator('ol > li').allTextContents()).map((s) => s.trim());
    expect(rendered).toEqual(notes.map((n) => n.trim()));
    // The reason shown above is one of them, not a paraphrase of them.
    expect(notes.map((n) => n.trim())).toContain(reasonText);

    // One click, and they are painted.
    await fold.locator('summary').click();
    await expect(fold.locator('ol > li').first()).toBeVisible();
    await fold.locator('summary').click();
  });

  test('puts every state on one table with a totals row, and no escort money in it', async () => {
    const table = page.locator('.ow-sum');
    await expect(table).toBeVisible();

    // Seven states plus the totals row. Uncovered states would add rows of
    // their own; there are none on this lane.
    const bodyRows = table.locator('tbody tr');
    await expect(bodyRows).toHaveCount(8);
    await expect(table.locator('.ow-sumtot')).toHaveCount(1);

    // The header is the seven columns the review asked for, in order.
    expect((await table.locator('thead th').allTextContents()).map((s) => s.trim())).toEqual([
      'State', 'Oversize', 'Overweight', 'Base & fees', 'Escorts', 'Subtotal', 'Status',
    ]);

    // The Subtotal column is the engine's own per-state figure, not a re-sum.
    const subtotals = await table
      .locator('tbody tr:not(.ow-sumtot) td:nth-child(6)')
      .allTextContents();
    expect(subtotals.map((s) => s.trim()).sort()).toEqual(
      ['$145.00', '$214.98', '$320.00', '$337.00', '$60.00', '$62.40', '$83.80'].sort(),
    );

    // The totals row carries the lane total, and it is the permit total — the
    // escort column beside it is never added into it.
    const totalRow = table.locator('.ow-sumtot');
    await expect(totalRow.locator('td:nth-child(6)')).toHaveText('$1,223.18');
    await expect(page.locator('.ow-total .ow-tv')).toHaveText('$1,223.18');
    await expect(page.locator('.ow-summary')).toContainText('NEVER inside it');

    // NO $0 AGAINST AN ESCORT, anywhere in the column, ever.
    const escortCells = await table.locator('tbody tr td:nth-child(5)').allTextContents();
    expect(escortCells.length).toBe(8);
    for (const cell of escortCells) expect(cell).not.toMatch(/\$0(\.00)?\b/);
    // Kentucky and New York need one each and say the cost is unknown, not free.
    expect(escortCells.filter((c) => /cost unknown/.test(c)).length).toBeGreaterThanOrEqual(2);

    // Two states are flagged, and the table says so where the reader is looking.
    const statuses = (await table.locator('tbody tr td:nth-child(7)').allTextContents()).map((s) => s.trim());
    expect(statuses.filter((s) => s === 'Review').length).toBe(2);
    expect(statuses.filter((s) => s === 'Priced').length).toBe(5);

    // ON DESKTOP IT FITS. Scrolling inside the box is the right answer at 375px
    // and the wrong one in a 554px results column, where it would cut the Status
    // column off entirely. Measured, not eyeballed. Every status chip is one
    // line — a pill broken across two reads as a rendering fault.
    const fit = await page.evaluate(() => {
      const wrap = document.querySelector('.ow-sumwrap') as HTMLElement;
      const chips = [...document.querySelectorAll('.ow-sum .ow-st')] as HTMLElement[];
      return {
        scrollWidth: wrap.scrollWidth,
        clientWidth: wrap.clientWidth,
        chipLines: chips.map((c) => Math.round(c.getBoundingClientRect().height)),
      };
    });
    expect(fit.scrollWidth, JSON.stringify(fit)).toBeLessThanOrEqual(fit.clientWidth);
    expect(fit.chipLines.length).toBe(8);
    for (const h of fit.chipLines) expect(h, JSON.stringify(fit.chipLines)).toBeLessThan(32);
  });

  test('keeps every fee line and every citation, folded rather than deleted', async () => {
    // Seven states, seven fee-line folds, each naming its own subtotal.
    const folds = page.locator('.ow-linefold');
    await expect(folds).toHaveCount(7);
    await expect(folds.first().locator('summary')).toContainText('cited fee line');

    // The lines themselves are still in the document, subtotal row included.
    const subtotals = await page.locator('.ow-lines .sub .num').allTextContents();
    expect(subtotals.map((s) => s.trim()).sort()).toEqual(
      ['$145.00', '$214.98', '$320.00', '$337.00', '$60.00', '$62.40', '$83.80'].sort(),
    );

    // And the citations are all still there — one details per state.
    const cites = page.locator('.ow-cites');
    await expect(cites).toHaveCount(7);
    const citeCount = await page.locator('.ow-cites li').count();
    expect(citeCount).toBeGreaterThan(40);

    // A click paints one, so "one click away" is a fact and not a claim.
    await folds.first().locator('summary').click();
    await expect(folds.first().locator('table.ow-lines')).toBeVisible();
    await folds.first().locator('summary').click();
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
  test('shows a PARTIAL figure on an uncovered lane, never a lane total', async ({ page }) => {
    await openTool(page);
    await calculate(page, REFERENCE_LOAD, [
      { state: 'TX', miles: 215 },
      { state: 'MS', miles: 160 },
      { state: 'AL', miles: 90 },
    ]);

    // A NUMBER IS SHOWN, AND IT IS LABELLED AS NOT THE LANE TOTAL. The label
    // does the work: the figure is the sum of the states that priced, the line
    // under it counts what is missing, and the sentence under that names them.
    await expect(page.locator('.ow-total .ow-tl')).toHaveText('Partial — NOT a lane total');
    const value = (await page.locator('.ow-total .ow-tv').textContent()) ?? '';
    expect(value).toMatch(/^\$[\d,]+\.\d{2}$/);
    expect(value).not.toMatch(/^\$0(\.00)?$/);
    await expect(page.locator('.ow-total .ow-tpart')).toHaveText(/^\d+ of 3 states priced · \d+ unpriced$/);
    await expect(page.locator('.ow-total')).toHaveClass(/ow-total--partial/);

    // The sum is arithmetic over the per-state subtotals shown below it, not a
    // second opinion about the lane.
    const subtotals = await page.locator('.ow-lines .sub .num').allTextContents();
    const summed = subtotals
      .map((s) => Number(s.replace(/[^0-9.]/g, '')))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => a + b, 0);
    expect(Number(value.replace(/[^0-9.]/g, ''))).toBeCloseTo(summed, 2);

    // THE REFUSAL IS INTACT. The words "lane total" only ever appear negated,
    // and Mississippi is named in full rather than folded into the figure.
    const tsub = (await page.locator('.ow-total .ow-tsub').textContent()) ?? '';
    expect(tsub).toContain('There is no lane total for this lane');
    expect(tsub).toContain('Mississippi');
    const uncovered = page.locator('.ow-note--error');
    await expect(uncovered).toContainText('Mississippi (MS)');
    await expect(uncovered).toContainText('nothing is charged for it and nothing is assumed');

    // Mississippi is a ROW in the summary table too — named, with no zeros.
    const msRow = page.locator('.ow-sum tbody tr', { hasText: 'Mississippi' });
    await expect(msRow).toHaveCount(1);
    await expect(msRow.locator('.ow-st')).toHaveText('Not covered');
    expect((await msRow.textContent()) ?? '').not.toMatch(/\$/);
    await expect(page.locator('.ow-sumtot td').first()).toHaveText('Priced states only');
    await expect(page.locator('.ow-sumtot .ow-st')).toHaveText('Partial');

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
    // A covered-but-unpriced state is a THIRD state of affairs, and the summary
    // row says so in the same words the block does — never a $0, never omitted.
    const flRow = page.locator('.ow-sum tbody tr', { hasText: 'Florida' });
    await expect(flRow.locator('.ow-st')).toHaveText('Not priced');
    // Georgia priced, so the lane shows a partial rather than nothing at all.
    await expect(page.locator('.ow-total .ow-tl')).toHaveText('Partial — NOT a lane total');
    await expect(page.locator('.ow-total .ow-tpart')).toContainText('1 of 2 states priced');

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

test.describe('OS/OW calculator — escort cost, in two channels that never touch', () => {
  test.describe.configure({ mode: 'serial' });

  test('prices pilot cars from the operator’s OWN rate, drawn as theirs', async ({ page }) => {
    await openTool(page);
    await fillPilotRate(page, { usdPerMile: 3 });
    await calculate(page, REFERENCE_LOAD, REFERENCE_LEGS);

    // THE PERMIT TOTAL IS UNTOUCHED. This is the whole structural claim: the
    // estimator reads a finished quote and cannot write to one, so supplying a
    // rate cannot move a permit fee by a cent.
    await expect(page.locator('.ow-total .ow-tv')).toHaveText('$1,223.18');

    // The figure is the caller's arithmetic: Kentucky 62.4 mi and New York
    // 60 mi, one car each, at $3.00 a mile.
    const yours = page.locator('.ow-yours');
    await expect(yours.locator('.ow-yourv')).toHaveText('$367.20');
    await expect(yours.locator('li')).toHaveCount(2);
    await expect(yours.locator('li').nth(0)).toContainText('Kentucky');
    await expect(yours.locator('li').nth(0)).toContainText('$187.20');
    await expect(yours.locator('li').nth(1)).toContainText('New York');
    await expect(yours.locator('li').nth(1)).toContainText('$180.00');

    // AND IT IS DRAWN AS THEIRS, not as a figure we sourced: a literal tag, a
    // dashed outline rather than a surface, and copy that says whose it is.
    await expect(yours.locator('.ow-yourtag')).toHaveText('Your rate — not a figure we source');
    await expect(yours).toContainText('computed from the rate YOU supplied');
    await expect(yours).toContainText('it is not cited');
    const style = await yours.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderTopStyle, bg: cs.backgroundColor };
    });
    expect(style.border, 'user-sourced money is outlined, never on a cited surface').toBe('dashed');

    // The summary table marks the same money as the caller's, in its own column,
    // and the Subtotal column beside it is still permit money only.
    const kyRow = page.locator('.ow-sum tbody tr', { hasText: 'Kentucky' });
    await expect(kyRow.locator('td.mine')).toContainText('$187.20 (yours)');
    await expect(kyRow.locator('td:nth-child(6)')).toHaveText('$62.40');
    await expect(page.locator('.ow-sumtot td:nth-child(6)')).toHaveText('$1,223.18');
    await expect(page.locator('.ow-sumtot td.mine')).toContainText('$367.20 (yours)');

    // NO SYNTHESISED MARKET RATE ANYWHERE. QuoteFleet's own fallback band is
    // opt-in, this page never asks for it, and its disclaimer must not appear.
    await expect(page.locator('.ow-results')).not.toContainText('QUOTEFLEET’S OWN ESTIMATE');
    await expect(page.locator('.ow-results')).not.toContainText("QUOTEFLEET'S OWN ESTIMATE");
  });

  test('refuses a day rate with no day count instead of billing one day', async ({ page }) => {
    await openTool(page);
    await fillPilotRate(page, { usdPerDay: 900 });
    await fillLoad(page, REFERENCE_LOAD);
    await fillLegs(page, [{ state: 'KY', miles: 62.4 }]);
    await page.click('#ow-go');
    const error = page.locator('.ow-results .ow-note--error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('day rate without a day count is not a price');
    // Nothing was priced, so no five-day crossing was billed as one.
    await expect(page.locator('.ow-total')).toHaveCount(0);
  });

  test('surfaces the six states that DO publish a police rate, with citations', async ({ page }) => {
    await openTool(page);
    // 20 ft wide trips Tennessee's THP escort rule (over 18 ft) and Louisiana's
    // (over 16 ft) — two of the six jurisdictions publishing a trooper rate.
    await calculate(
      page,
      { grossWeightLbs: 160_000, widthFt: 20, widthIn: 0, heightFt: 14, heightIn: 6, lengthFt: 100, axles: 9, routeClass: 'interstate' },
      [{ state: 'TN', miles: 250 }, { state: 'LA', miles: 180 }],
    );

    const police = page.locator('.ow-note', { hasText: 'Law-enforcement escorts' });
    await expect(police).toBeVisible();
    // TDOT prints "2 officers x 4 hours x $65.00 = $520.00". That is the floor,
    // and it is labelled a floor rather than a total.
    await expect(police).toContainText('Tennessee');
    await expect(police).toContainText('$520.00');
    await expect(police).toContainText('published FLOOR for 2 officers');
    await expect(police).toContainText('a floor, never a total');
    await expect(police).toContainText('No police money is inside the permit total');
    // Louisiana's own floor: 1 officer, 2-hour minimum at $75/hr.
    await expect(police).toContainText('Louisiana');
    await expect(police).toContainText('$150.00');

    // CITED, like a permit fee — publisher, link and revision date.
    const sources = police.locator('details.ow-fold');
    await expect(sources.locator('summary')).toContainText('Sources for these escort rates');
    expect(await sources.locator('li').count()).toBeGreaterThanOrEqual(2);
    expect(await sources.locator('a[href^="http"]').count()).toBeGreaterThanOrEqual(2);

    // And it is NOT drawn as the caller's own figure — different channel.
    await expect(police.locator('.ow-yours')).toHaveCount(0);
  });

  test('reports no derivable floor for Illinois and Indiana rather than picking one', async ({ request }) => {
    // Both publish a rate and neither yields a floor: Illinois because two live
    // schedules charge on different bases, Indiana because its schedule states
    // no minimum at all. The engine must return null, never a chosen number.
    const post = async (data: unknown) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await request.post('/api/tools/osow-permits', { data });
        if (res.status() !== 429) return res;
        const reset = Number(res.headers()['ratelimit-reset'] ?? '5');
        await new Promise((r) => setTimeout(r, (Number.isFinite(reset) ? reset : 5) * 1000 + 1000));
      }
      return request.post('/api/tools/osow-permits', { data });
    };

    const res = await post({
      load: { grossWeightLbs: 220_000, widthIn: 12 * 18, heightIn: 174, overallLengthIn: 1200, axleCount: 9, routeClass: 'interstate' },
      legs: [{ state: 'IL', miles: 180 }, { state: 'IN', miles: 150 }],
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      quote: { totalPermitUsd: number | null };
      escorts: { costIncluded: boolean };
      escortEstimate: {
        estimate: {
          byJurisdiction: Array<{
            jurisdiction: string;
            policeRequired: boolean;
            policeFloorUsd: number | null;
          }>;
        } | null;
      };
    };
    // `costIncluded: false` is the claim that never goes stale — it means no
    // escort money is inside the permit total, however the escorts are priced.
    expect(body.escorts.costIncluded).toBe(false);
    const rows = body.escortEstimate.estimate?.byJurisdiction ?? [];
    for (const code of ['IL', 'IN']) {
      const row = rows.find((r) => r.jurisdiction === code);
      expect(row, `${code} must be in the escort estimate`).toBeTruthy();
      if (row?.policeRequired) expect(row.policeFloorUsd).toBeNull();
    }
  });
});

test.describe('OS/OW calculator — the empty state a first-time visitor meets', () => {
  test('loads a worked lane in one click and prices it for real', async ({ page }) => {
    await openTool(page);

    // ONE disclaimer on the empty page, not three: the banner states the claim,
    // the five-item exclusion list is a disclosure, and the sentence beside the
    // number appears with the number.
    await expect(page.locator('.ow-truth')).toBeVisible();
    const restatements = await page.evaluate(
      () => (document.body.textContent ?? '').match(/not a freight quote/gi)?.length ?? 0,
    );
    expect(restatements).toBeLessThanOrEqual(1);
    const excl = page.locator('details.ow-notincluded');
    await expect(excl).toBeVisible();
    await expect(excl.locator('summary')).toContainText('What this total never includes (5)');
    await expect(excl.locator('li')).toHaveCount(5);
    // The reworded pilot-car copy: it no longer tells the user to go elsewhere.
    await expect(excl).toContainText('enter YOUR pilot-car rate on this page');
    await expect(excl).not.toContainText('the cost is yours to add');

    // One click fills the form and prices the same lane the suite asserts.
    await page.click('#ow-example');
    await page.waitForSelector('.ow-results .ow-total', { timeout: 30_000 });
    await expect(page.locator('.ow-total .ow-tv')).toHaveText('$1,223.18');
    await expect(page.locator('.ow-sum tbody tr')).toHaveCount(8);
    // It FILLED the form rather than faking a result — the inputs carry it.
    await expect(page.locator('#ow-weight')).toHaveValue('120000');
    await expect(page.locator('#ow-legs .ow-leg')).toHaveCount(7);
    await expect(page.locator('.ow-pill[data-route="interstate"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('keeps the desktop results column beside the form instead of a dead gap', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTool(page);

    const before = await page.evaluate(() => {
      const form = document.querySelector('#ow-form');
      const results = document.getElementById('ow-results');
      if (!form || !results) return null;
      return {
        formHeight: Math.round(form.getBoundingClientRect().height),
        resultsHeight: Math.round(results.getBoundingClientRect().height),
        sticky: getComputedStyle(results).position,
        empty: results.classList.contains('is-empty'),
      };
    });
    expect(before).not.toBeNull();
    const b = before as NonNullable<typeof before>;
    expect(b.empty).toBe(true);
    // STICKY WHILE EMPTY is the fix. The right column is shorter than a
    // four-card form and always will be; what was wrong was that it stopped
    // dead and left several hundred px of nothing beside the lower half of the
    // form. Pinned, it travels with whatever is being filled in.
    expect(b.sticky).toBe('sticky');
    // It carries real content — a loadable example and a description of the
    // output — not a single sentence.
    expect(b.resultsHeight).toBeGreaterThan(380);

    // Scroll to the bottom of the form and the card is STILL on screen next to
    // it. That is the property the pixel gap was a proxy for.
    await page.evaluate(() => {
      const form = document.querySelector('#ow-form') as HTMLElement;
      window.scrollTo(0, form.getBoundingClientRect().bottom + window.scrollY - window.innerHeight);
    });
    await page.waitForTimeout(200);
    await expect(page.locator('#ow-example')).toBeInViewport();
    const after = await page.evaluate(() => {
      const results = document.getElementById('ow-results') as HTMLElement;
      const r = results.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    expect(after.top).toBeLessThan(after.vh);
    expect(after.bottom).toBeGreaterThan(0);

    // The moment a real result renders the pin is dropped — a 3,500px result
    // must scroll like any other block.
    await calculate(page, REFERENCE_LOAD, REFERENCE_LEGS);
    const live = await page.evaluate(() => {
      const results = document.getElementById('ow-results') as HTMLElement;
      return { empty: results.classList.contains('is-empty'), position: getComputedStyle(results).position };
    });
    expect(live.empty).toBe(false);
    expect(live.position).not.toBe('sticky');
  });
});

test.describe('OS/OW calculator — layout the browser actually painted', () => {
  test('never scrolls sideways on a 7-state result at 375px, in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openTool(page);
    await calculate(page, REFERENCE_LOAD, REFERENCE_LEGS);

    const dark = await horizontalOverflow(page);
    expect(dark.scrollWidth, `dark: ${JSON.stringify(dark)}`).toBeLessThanOrEqual(dark.clientWidth);

    /**
     * THE SUMMARY TABLE SCROLLS, THE PAGE DOES NOT. Seven money columns cannot
     * compress to 375px and stay readable, so the table carries a min-width and
     * its own `overflow-x: auto` wrapper. That is the allowed shape — what is
     * not allowed is the document scrolling sideways, asserted above and again
     * below in the other theme.
     */
    const box = await page.evaluate(() => {
      const wrap = document.querySelector('.ow-sumwrap');
      const table = document.querySelector('.ow-sum');
      const firstCell = document.querySelector('.ow-sum tbody td');
      if (!wrap || !table || !firstCell) return null;
      return {
        wrapScroll: wrap.scrollWidth,
        wrapClient: wrap.clientWidth,
        overflowX: getComputedStyle(wrap).overflowX,
        stickyName: getComputedStyle(firstCell).position,
      };
    });
    expect(box).not.toBeNull();
    const b = box as NonNullable<typeof box>;
    expect(b.overflowX).toBe('auto');
    // It really does scroll inside its own box at this width.
    expect(b.wrapScroll).toBeGreaterThan(b.wrapClient);
    // And the state name stays put while the money columns move under it.
    expect(b.stickyName).toBe('sticky');

    // The four result tiles stack at 375 rather than stretching to the tallest
    // of a 2x2 row, which is where ~180px of dead space came from.
    const tiles = await page.$$eval('.ow-flag', (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const n = e.querySelector('.n') as HTMLElement;
        return { left: Math.round(r.left), dead: Math.round(r.bottom - n.getBoundingClientRect().bottom) };
      }),
    );
    expect(tiles).toHaveLength(4);
    // One column: every tile starts at the same x.
    expect(new Set(tiles.map((t) => t.left)).size).toBe(1);
    for (const t of tiles) expect(t.dead, JSON.stringify(tiles)).toBeLessThan(40);

    await page.evaluate(() => {
      localStorage.setItem('qf-theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    const light = await horizontalOverflow(page);
    expect(light.scrollWidth, `light: ${JSON.stringify(light)}`).toBeLessThanOrEqual(
      light.clientWidth,
    );
    // The summary table is readable in BOTH themes — the sticky first column
    // paints an opaque background over the scrolling cells, not a transparent
    // one that lets figures slide under the state name.
    const bg = await page.evaluate(() => {
      const cell = document.querySelector('.ow-sum tbody td');
      return cell ? getComputedStyle(cell).backgroundColor : null;
    });
    expect(bg).not.toBeNull();
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
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
