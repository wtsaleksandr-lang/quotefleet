/**
 * /pilot-cars — the escort operator directory, driven in a real browser.
 *
 * WHY THIS FILE EXISTS. The unit suite asserts the page's CSS as STRINGS:
 * `expect(html).toMatch(/\.pc-statebox \{[^}]*overflow-x: clip/)`. A string
 * match cannot see a rendered orphan, a horizontal scrollbar, a control that
 * fell under 44px, or a filter form that silently drops its own state on
 * submit. Those are the failures this surface cannot ship with.
 *
 * EVERY TEST HERE RUNS WITH THE DATABASE UNREACHABLE, and that is deliberate
 * rather than a limitation. The dev Neon branch is over quota, so this is the
 * production-realistic degraded state, and the single most important assertion
 * in the file is that a dispatcher in that state is told "we cannot reach the
 * directory" and never "no operators found". The rest of the page — the whole
 * filter form and the cited per-state certification table — is compiled data
 * and renders identically either way, so the layout assertions are just as
 * valid.
 *
 * Run: `pnpm test:e2e tests/e2e/pilot-car-directory.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test';

const DIR = '/pilot-cars';
const JOIN = '/pilot-cars/join';

/** Programmatic overflow, read from the document rather than eyeballed. */
async function docWidths(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    try {
      localStorage.setItem('qf-theme', t);
    } catch {
      /* private mode — the attribute below is what actually matters */
    }
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

async function open(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  expect(res?.status(), `${path} must serve with the database down`).toBe(200);
}

test.describe('the index renders with the database down', () => {
  test('serves 200 and says it cannot REACH the directory, not that it is empty', async ({ page }) => {
    await open(page, DIR);
    const banner = page.locator('#pc-unavailable');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('We cannot reach the directory right now');
    await expect(banner).toContainText('This is not "no operators found"');
    // The empty-result copy must be absent — the two must never both appear.
    await expect(page.locator('text=No listed operator matches all of that')).toHaveCount(0);
  });

  test('still renders the compiled certification table, which needs no database', async ({ page }) => {
    await open(page, DIR);
    await expect(page.locator('.pc-table tbody tr').first()).toBeVisible();
    const rows = await page.locator('.pc-table tbody tr').count();
    expect(rows, 'the cited per-state registry is compiled, not stored').toBeGreaterThanOrEqual(16);
  });

  test('the filter form is present and usable with the store down', async ({ page }) => {
    await open(page, DIR);
    await expect(page.locator('form.pc-filters')).toBeVisible();
    await expect(page.locator('form.pc-filters select[name="states"]')).toBeVisible();
  });
});

test.describe('filtering is a plain GET — every view is a shareable URL', () => {
  test('a submitted filter lands in the URL and is re-selected on the rendered page', async ({ page }) => {
    await open(page, DIR);
    await page.selectOption('select[name="states"]', ['KY', 'TN']);
    await page.selectOption('select[name="certin"]', ['WA']);
    await page.check('input[name="superload"]');
    await Promise.all([page.waitForURL(/\/pilot-cars\?/), page.click('form.pc-filters button[type="submit"]')]);

    // A native <select multiple> posts ONE PARAMETER PER OPTION, so the URL is
    // `?states=KY&states=TN` rather than a comma list. Both shapes are live URLs
    // for this page and `parseFilters` treats them identically — asserting
    // `.get()` here would pass while only half the filter applied.
    const url = new URL(page.url());
    expect(url.searchParams.getAll('states')).toEqual(['KY', 'TN']);
    expect(url.searchParams.getAll('certin')).toEqual(['WA']);
    expect(url.searchParams.get('superload')).toBe('1');

    // And the rendered page reflects it, so a pasted link is self-describing.
    await expect(page.locator('select[name="states"] option[value="KY"]')).toHaveAttribute('selected', '');
    await expect(page.locator('select[name="states"] option[value="TN"]')).toHaveAttribute('selected', '');
    await expect(page.locator('select[name="certin"] option[value="WA"]')).toHaveAttribute('selected', '');
    await expect(page.locator('input[name="superload"]')).toBeChecked();
  });

  test('a deep link with a junk state renders the directory rather than an error', async ({ page }) => {
    const res = await page.goto(`${DIR}?states=ZZ,KY&tier=platinum`, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
    await expect(page.locator('form.pc-filters')).toBeVisible();
  });

  test('works with JavaScript disabled — the quote-tool deep links depend on it', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    const res = await page.goto(`${DIR}?states=KY`, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
    await expect(page.locator('form.pc-filters')).toBeVisible();
    await expect(page.locator('.pc-table tbody tr').first()).toBeVisible();
    await ctx.close();
  });
});

test.describe('375px, in BOTH themes', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`the directory never scrolls sideways at 375px — ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, `${DIR}?states=KY,TN&certin=WA`);
      await setTheme(page, theme);
      const size = await docWidths(page);
      expect(size.scrollWidth, `${theme}: ${JSON.stringify(size)}`).toBeLessThanOrEqual(size.clientWidth);
    });

    test(`the join form never scrolls sideways at 375px — ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, JOIN);
      await setTheme(page, theme);
      const size = await docWidths(page);
      expect(size.scrollWidth, `${theme}: ${JSON.stringify(size)}`).toBeLessThanOrEqual(size.clientWidth);
    });
  }

  test('the wide certification table scrolls INSIDE its own box, not the document', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, DIR);
    const fit = await page.evaluate(() => {
      const wrap = document.querySelector('.pc-tablewrap') as HTMLElement;
      const doc = document.documentElement;
      return {
        wrapScroll: wrap.scrollWidth,
        wrapClient: wrap.clientWidth,
        docScroll: doc.scrollWidth,
        docClient: doc.clientWidth,
      };
    });
    // The wrapper overflows — 560px of table cannot compress to 375 and stay
    // readable — and the DOCUMENT does not. That is the whole contract.
    expect(fit.wrapScroll, JSON.stringify(fit)).toBeGreaterThan(fit.wrapClient);
    expect(fit.docScroll, JSON.stringify(fit)).toBeLessThanOrEqual(fit.docClient);
  });

  test('the state grid on the join form is two columns at 375px, never three', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, JOIN);
    const tracks = await page.evaluate(() => {
      const box = document.querySelector('.pc-statebox') as HTMLElement;
      return getComputedStyle(box).gridTemplateColumns.split(' ').filter(Boolean).length;
    });
    expect(tracks, 'three columns at 375px strands the last row').toBe(2);
  });

  test('no pill and no verification badge wraps onto two lines', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, DIR);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll<HTMLElement>('.pc-pill, .pc-tier').forEach((el) => {
        const line = parseFloat(getComputedStyle(el).lineHeight) || 16;
        // A one-line chip is at most its line box plus its own padding+border.
        if (el.getBoundingClientRect().height > line + 20) out.push(el.textContent ?? '');
      });
      return out;
    });
    expect(bad, `wrapped chips: ${JSON.stringify(bad)}`).toEqual([]);
  });

  test('every interactive control clears 44px at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, DIR);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      document
        .querySelectorAll<HTMLElement>('form.pc-filters select, form.pc-filters .btn, form.pc-filters button')
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.height < 44) out.push(`${el.tagName}.${el.className}: ${Math.round(r.height)}px`);
        });
      return out;
    });
    expect(small, `under 44px: ${JSON.stringify(small)}`).toEqual([]);
  });
});

test.describe('the honesty rules are visible, not just in the source', () => {
  test('the index leads with "self-reported unless it says otherwise"', async ({ page }) => {
    await open(page, DIR);
    await expect(page.locator('.pc-truth').first()).toContainText('Operators list themselves; we do not import anyone');
  });

  test('the join page states the consent and deletion terms before the form', async ({ page }) => {
    await open(page, JOIN);
    const truth = page.locator('.pc-truth').first();
    await expect(truth).toContainText('Nothing is published until you tick the consent box');
    await expect(truth).toContainText('removes the row rather than hiding it');
  });

  test('the certification table publishes the disagreement rather than an average', async ({ page }) => {
    await open(page, DIR);
    const table = page.locator('.pc-table');
    await expect(table).toContainText('Sources disagree');
    await expect(table).toContainText('Not published');
  });

  test('the manage page is noindex', async ({ page }) => {
    await page.goto('/pilot-cars/manage/not-a-real-token', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  });
});

test.describe('the quote tools link in, pre-filtered', () => {
  test('the OS/OW calculator hands the directory the lane and only the certifying states', async ({ page }) => {
    // Driven through the real calculator: it is pure computation over compiled
    // jurisdiction data with NO DATABASE, which is exactly why it works here.
    await page.goto('/tools/oversize-permits', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ow-form .ow-leg');
    await page.click('#ow-example');
    await page.waitForSelector('#ow-results .ow-note', { timeout: 30_000 });

    const href = await page.evaluate(() => {
      const a = document.querySelector('.ow-find a') as HTMLAnchorElement | null;
      return a ? a.getAttribute('href') : null;
    });
    expect(href, 'the reference lane requires escorts, so the link must render').toBeTruthy();
    const url = new URL(href as string, 'https://quotefleet.net');
    expect(url.pathname).toBe('/pilot-cars');
    const certin = (url.searchParams.get('certin') ?? '').split(',').filter(Boolean);
    // Kentucky and Tennessee certify nobody — filtering on a certificate they do
    // not issue would return zero operators forever.
    expect(certin).not.toContain('KY');
    expect(certin).not.toContain('TN');
    expect(certin.length, 'the reference lane crosses NY and PA, which do certify').toBeGreaterThan(0);
  });

  test('following that link lands on a filtered directory that renders', async ({ page }) => {
    const res = await page.goto('/pilot-cars?states=TX,AR,TN,KY,OH,PA,NY&certin=PA,NY', {
      waitUntil: 'domcontentloaded',
    });
    expect(res?.status()).toBe(200);
    await expect(page.locator('form.pc-filters')).toBeVisible();
  });
});
