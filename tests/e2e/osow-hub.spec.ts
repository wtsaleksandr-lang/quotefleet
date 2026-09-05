/**
 * THE OS/OW HUB, DRIVEN IN A REAL BROWSER.
 *
 * The unit tests assert what the HTML says. This asserts what it DOES, and it
 * exists mainly for the two failure modes that are invisible to a string test:
 *
 *   1. **Horizontal overflow at 375 px.** These pages are almost entirely wide
 *      data tables — one is eleven columns — and the house rule is that a wide
 *      table scrolls inside its OWN container while the document never scrolls
 *      sideways. That is measured here, in both themes, rather than eyeballed.
 *   2. **The calculators actually calculating.** Both tool pages ship a
 *      server-computed first result and then recompute in the browser on every
 *      edit; a broken script leaves a page that passes every HTML assertion and
 *      answers nothing the moment a reader changes an axle.
 *
 * Both themes are checked because a token defined only inside one theme block
 * is the recurring contrast defect in this codebase, and because the sticky
 * table header and first column are painted from tokens that must exist in both.
 */
import { expect, test, type Page } from '@playwright/test';

const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1440, height: 900 };

const HUB_PAGES = [
  '/oversize',
  '/oversize/coverage',
  '/oversize/legal-limits',
  '/oversize/permit-fees',
  '/oversize/escort-requirements',
  '/oversize/superloads',
  '/oversize/police-escorts',
  '/oversize/source-notes',
  '/oversize/common-figures',
  '/oversize/federal-limits',
  '/oversize/bridge-formula',
  '/oversize/non-divisible',
  '/oversize/texas',
  '/oversize/tennessee',
  '/tools/bridge-formula',
  '/tools/axle-weights',
];

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    try {
      localStorage.setItem('qf-theme', t);
    } catch {
      /* private mode — the attribute below is what actually matters */
    }
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

/**
 * The document must not scroll sideways. A 1 px tolerance absorbs sub-pixel
 * layout rounding; anything above that is a real overflow a reader would feel.
 */
async function assertNoDocumentOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return {
      scrollWidth: Math.max(de.scrollWidth, document.body.scrollWidth),
      clientWidth: de.clientWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `${label}: document scrolls horizontally (${overflow.scrollWidth} > ${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * Every table wider than the viewport must sit inside a scroller of its own.
 * A table that overflows its container is exactly how the document ends up
 * scrolling sideways one release later.
 */
async function assertTablesScrollInTheirOwnBox(page: Page, label: string) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('table').forEach((table, i) => {
      const wrap = table.closest('.qh-tablewrap');
      if (wrap === null) {
        out.push(`table ${i} has no .qh-tablewrap ancestor`);
        return;
      }
      const style = getComputedStyle(wrap as Element);
      if (!['auto', 'scroll'].includes(style.overflowX)) {
        out.push(`table ${i} wrapper overflow-x is "${style.overflowX}"`);
      }
      if ((wrap as HTMLElement).scrollWidth > (wrap as HTMLElement).clientWidth + 1) {
        // Wider than its box is FINE — that is what the scroller is for — but
        // the box itself must not be wider than its own parent.
        const parent = (wrap as HTMLElement).parentElement;
        if (parent && (wrap as HTMLElement).clientWidth > parent.clientWidth + 1) {
          out.push(`table ${i} wrapper is wider than its parent`);
        }
      }
    });
    return out;
  });
  expect(bad, `${label}: ${bad.join('; ')}`).toEqual([]);
}

for (const path of HUB_PAGES) {
  test(`${path} — no horizontal overflow at 375px, both themes`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    for (const theme of ['dark', 'light'] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await setTheme(page, theme);
      await page.waitForTimeout(120);
      await assertNoDocumentOverflow(page, `${path} @375 ${theme}`);
      await assertTablesScrollInTheirOwnBox(page, `${path} @375 ${theme}`);
    }
  });

  test(`${path} — renders its heading and no overflow at desktop`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const h1 = page.locator('h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
    await assertNoDocumentOverflow(page, `${path} @1440`);
  });
}

test('the hub links to every reference page it advertises', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/oversize', { waitUntil: 'domcontentloaded' });
  for (const p of HUB_PAGES.filter((x) => x !== '/oversize')) {
    await expect(page.locator(`a[href="${p}"]`).first()).toHaveCount(1);
  }
});

test('an uncovered state has no page rather than an empty one', async ({ page }) => {
  const res = await page.goto('/oversize/wyoming', { waitUntil: 'domcontentloaded' });
  expect(res?.status()).toBe(404);
});

test('the bridge formula calculator answers on load and after an edit', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/tools/bridge-formula', { waitUntil: 'domcontentloaded' });

  // The first result is SERVER-COMPUTED and shipped with the page, so it is
  // painted without a round trip and without spending a public rate-limit slot.
  await expect(page.locator('#qt-initial')).toHaveCount(1);
  const verdict = page.locator('#qt-verdict');
  await expect(verdict).toBeVisible({ timeout: 15_000 });
  await expect(verdict).toContainText('Compliant');
  await expect(page.locator('#qt-out')).toContainText('80,000 lb');
  // Ten groups on a five-axle rig, not three.
  await expect(page.locator('#qt-out')).toContainText('Groups checked');

  // Overload the trailer tandems and the verdict must flip.
  const weights = page.locator('#qt-axles input[data-k="weightLbs"]');
  await weights.nth(3).fill('26000');
  await page.locator('#qt-run').click();
  await expect(page.locator('#qt-verdict')).toContainText('violation', { timeout: 15_000 });
  await assertNoDocumentOverflow(page, '/tools/bridge-formula after edit @375');
});

test('the axle checker brings a state\'s cited limits into the answer', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/tools/axle-weights', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#qt-verdict')).toBeVisible({ timeout: 15_000 });

  await page.locator('#qt-state').selectOption('TX');
  await page.locator('#qt-run').click();
  const out = page.locator('#qt-out');
  await expect(out).toContainText('Texas legal limits', { timeout: 15_000 });
  // Every state verdict line carries the document AND its dates.
  await expect(out).toContainText('read 20');
  await assertNoDocumentOverflow(page, '/tools/axle-weights TX @375');

  // Georgia's own documents disagree; the tool must refuse a verdict there.
  await page.locator('#qt-state').selectOption('GA');
  await page.locator('#qt-run').click();
  await expect(out).toContainText('Sources disagree', { timeout: 15_000 });
  await expect(out).toContainText('Cannot tell');
  await assertNoDocumentOverflow(page, '/tools/axle-weights GA @375');
});

test('the wide legal-limits table scrolls inside its own box, not the page', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/oversize/legal-limits', { waitUntil: 'domcontentloaded' });
  const wrap = page.locator('.qh-tablewrap').first();
  const metrics = await wrap.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  // The table IS wider than the phone — that is the point of the scroller.
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  await wrap.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await assertNoDocumentOverflow(page, '/oversize/legal-limits scrolled @375');
});

test('the state page rail anchors resolve to real sections', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/oversize/texas', { waitUntil: 'domcontentloaded' });
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.qh-rail a')).map((a) =>
      (a.getAttribute('href') ?? '').slice(1),
    ),
  );
  expect(ids.length).toBeGreaterThan(5);
  for (const id of ids) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
});
