/**
 * /tools/heavy-haul-quote — the delivered-cost estimator, driven in a real
 * browser.
 *
 * WHY THIS FILE EXISTS. The unit suite asserts the composer's arithmetic and
 * the page's CSS as STRINGS. A string match cannot see a rendered orphan, a
 * horizontal scrollbar, a `null` that painted as "$0.00", a confidence number
 * whose reasons fell below the fold, or a 375px column that cropped the
 * headline. Those are exactly the failures this surface cannot ship with,
 * because its whole claim is that you can see where every number came from.
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
 * THE REFERENCE LOAD, as a dispatcher types it. 120,000 lb, 12'6" wide, 14'6"
 * high, 85 ft, 8 axles, interstate — the same fixture the permits calculator
 * prices at $1,223.18, entered through this form instead of that one.
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

async function fillLoad(page: Page) {
  await page.fill('#hh-weight', '120000');
  await page.fill('#hh-width-ft', '12');
  await page.fill('#hh-width-in', '6');
  await page.fill('#hh-height-ft', '14');
  await page.fill('#hh-height-in', '6');
  await page.fill('#hh-length-ft', '85');
  await page.fill('#hh-axles', '8');
  await page.click('.hh-pill[data-route="interstate"]');
}

async function fillLane(page: Page, origin = ORIGIN, destination = DESTINATION) {
  await page.fill('#hh-origin', origin);
  await page.fill('#hh-destination', destination);
}

async function fillLegs(page: Page, legs: Leg[]) {
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
// The reference lane
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
    // The composed page must not move a permit fee by a cent. Every state's
    // figure is in the fold, so read them from the breakdown table.
    const table = page.locator('.hh-lines');
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
    await expect(page.locator('.hh-lines')).not.toContainText('Margin');
  });

  test('KEEPS THE CALLER’S OWN RATES VISIBLY APART from the cited ones', async ({ page }) => {
    // Three subtotals, never one blended figure.
    const tiles = page.locator('.hh-split .hh-tile');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toContainText('Sourced');
    await expect(tiles.nth(1)).toContainText('Your rates');
    await expect(tiles.nth(2)).toContainText('Index-derived');
    // The user-rate tile is drawn differently — dashed, never the same surface.
    await expect(tiles.nth(1)).toHaveClass(/is-yours/);
    const dashed = await tiles.nth(1).evaluate((el) => getComputedStyle(el).borderStyle);
    expect(dashed).toContain('dashed');
    // And every line built from their rate carries the literal pill.
    const tags = page.locator('.hh-lines .hh-tag');
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

  test('STAYS COMPACT — a workbench, not a scroll-forever report', async ({ page }) => {
    // TWO BUDGETS, because only one of them is ours. The RESULTS column is what
    // this page renders and what a regression would inflate; the document also
    // carries the shared hero, the form and the site footer. The permits page
    // was cut from 8,124px to 3,554px on desktop and this one is built to that
    // discipline from the start, with headroom for a longer lane and none for a
    // regression to a report.
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
// The worked-example button — the same lane, zero geocoder calls
// ──────────────────────────────────────────────────────────────────────────

test('the worked example loads, prices and matches the permits tool', async ({ page }) => {
  await openTool(page);
  await page.click('#hh-example');
  await page.waitForSelector('.hh-results .hh-total', { timeout: 30_000 });
  await expect(page.locator('.hh-split .hh-tile').first()).toContainText('$1,223.18');
  await expect(page.locator('#hh-legs .hh-leg')).toHaveCount(7);
});

// ──────────────────────────────────────────────────────────────────────────
// The same lane with only addresses — the tier that must ASK, not price
// ──────────────────────────────────────────────────────────────────────────

test.describe('addresses only — the tier that cannot price permits', () => {
  test.beforeEach(async ({ page }) => {
    await openTool(page);
    await fillLoad(page);
    await fillLane(page);
    await page.fill('#hh-linehaul', '4.85');
    await submit(page);
  });

  test('ASKS FOR THE MILES, and prices no permit at all', async ({ page }) => {
    const corridor = page.locator('#hh-corridor');
    await expect(corridor).toBeVisible();
    await expect(corridor).toContainText('did NOT route this lane');
    await expect(corridor).toContainText('not one permit is priced from this list');
    // Tennessee bills per ton-mile; it must be named and it must not be priced.
    await expect(corridor.locator('.hh-chip', { hasText: /^TN$/ })).toBeVisible();
  });

  test('renders the unpriced permit line as "not priced" — NEVER as $0.00', async ({ page }) => {
    const row = page.locator('.hh-lines tr', { hasText: 'State OS/OW permits' });
    await expect(row).toContainText('not priced');
    await expect(row).not.toContainText('$0.00');
    // The SOURCED subtotal is genuinely zero here, and the page says the permit
    // money is missing rather than implying it was free.
    await expect(page.locator('.hh-total')).toContainText('Partial');
  });

  test('scores LOW and names the missing permits in the headline reasons', async ({ page }) => {
    await expect(page.locator('.hh-kpilabel')).toContainText('low');
    await expect(page.locator('.hh-kpi')).toContainText('no state permit priced');
  });

  test('turns the corridor list into mileage rows on one click', async ({ page }) => {
    const before = await page.locator('#hh-legs .hh-leg').count();
    await page.click('#hh-fill-corridor');
    const after = await page.locator('#hh-legs .hh-leg').count();
    expect(after).toBeGreaterThan(before);
    await expect(page.locator('#hh-legs .hh-leg-state').first()).not.toHaveValue('');
  });

  test('never leaves a single corridor chip alone on its last row', async ({ page }) => {
    // The grid is a fixed 4 columns and the renderer pads the count to a
    // multiple of 4, so the last row can never hold exactly one visible chip.
    const total = await page.locator('#hh-corridor .hh-chip').count();
    expect(total % 4).toBe(0);
  });

  test('does not scroll the document sideways', async ({ page }) => {
    await assertNoHorizontalOverflow(page, 'desktop, tier-4');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Named refusals
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

  const row = page.locator('.hh-lines tr', { hasText: 'Mississippi single-trip OS/OW permit' });
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
  await page.fill('#hh-linehaul', '4.85');
  await submit(page);

  const row = page.locator('.hh-lines tr', { hasText: 'Texas single-trip OS/OW permit' });
  await expect(row).toContainText('not priced');
  await expect(row).toContainText('superload');
  await expect(page.locator('.hh-kpi')).toContainText('superload');
});

test('a missing line-haul rate is excluded by name, not invented', async ({ page }) => {
  await openTool(page);
  await fillLoad(page);
  await fillLane(page);
  await fillLegs(page, REFERENCE_LEGS);
  await submit(page);

  const row = page.locator('.hh-lines tr', { hasText: /^Line haul/ });
  await expect(row).toContainText('not priced');
  await expect(row).toContainText('will not invent a market rate');
  await expect(page.locator('.hh-kpi')).toContainText('line haul not included');
  // The permits are unaffected by the exclusion.
  await expect(page.locator('.hh-split .hh-tile').first()).toContainText('$1,223.18');
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
  await page.fill('#hh-linehaul', '4.85');
  await page.click('#hh-go');
  await page.waitForSelector('.hh-note--error', { timeout: 30_000 });
  await expect(page.locator('.hh-note--error')).toContainText(/could not|not resolved|refused/i);
  await expect(page.locator('.hh-total')).toHaveCount(0);
  await expect(page.locator('.hh-tv')).toHaveCount(0);
});

// ──────────────────────────────────────────────────────────────────────────
// 375px, both themes
// ──────────────────────────────────────────────────────────────────────────

for (const theme of ['dark', 'light'] as const) {
  test(`renders at exactly 375px in the ${theme} theme without cropping`, async ({ page }) => {
    // MARKED SLOW, NOT GIVEN A LOOSER ASSERTION. This case loads the page,
    // fills eighteen fields, builds seven mileage rows, submits, and then reads
    // the painted geometry — genuinely more work than any other test here, and
    // on a loaded machine it ran past the 60s default while every assertion in
    // it still held. `test.slow()` triples the budget and changes nothing about
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
    await expect(page.locator('.hh-split .hh-tile')).toHaveCount(3);

    // THE SUBTOTAL TILES STACK — three across at 375px would put three values
    // on three baselines inside one stretched row.
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll('.hh-split .hh-tile')].map((el) =>
        Math.round(el.getBoundingClientRect().top),
      ),
    );
    expect(new Set(tops).size, 'the three tiles must be on three separate rows at 375px').toBe(3);

    // The permits page's mobile result was cut from 12,199px to 4,347px. Same
    // discipline: the RESULTS column is the part this page owns, and every line
    // note is clamped to three lines with the full text one click away in the
    // per-state disclosure. The document budget also carries the form and the
    // shared site footer, neither of which this page can shorten.
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
    // Three lines at 12px/1.5 is 54px. A taller note means the clamp stopped
    // working, which is how a compact result silently becomes a report again.
    expect(note, `375px ${theme} tallest line note ${note}px`).toBeLessThanOrEqual(56);
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
   * The KPI label specifically. The test above samples the body against the
   * hero heading and never touched the confidence pill — which is how a 3.54:1
   * "HIGH CONFIDENCE" label shipped past it. This measures a real ratio on the
   * element that actually renders, in both themes, for every variant.
   */
  test(`the confidence label clears WCAG AA in the ${theme} theme`, async ({ page }) => {
    test.slow();
    await openTool(page, theme);
    const ratios = await page.evaluate(() => {
      const lum = (c: string) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
        const f = (v: number) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const surface = getComputedStyle(document.body).backgroundColor;
      const probe = document.createElement('span');
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const out: Record<string, number> = {};
      for (const variant of ['high', 'medium', 'low']) {
        probe.className = 'hh-kpilabel hh-kpilabel--' + variant;
        probe.style.display = '';
        const ink = getComputedStyle(probe).color;
        const a = lum(ink);
        const b = lum(surface);
        out[variant] = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        probe.style.display = 'none';
      }
      probe.remove();
      return out;
    });
    // 11px text — AA large-text relief does not apply below 18.66px.
    for (const variant of ['high', 'medium', 'low']) {
      expect(ratios[variant], `${variant} label contrast`).toBeGreaterThanOrEqual(4.5);
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
  const rows = await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.hh-pill')].map((el) =>
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
