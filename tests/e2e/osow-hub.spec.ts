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

/* ═══════════════════════════════════════════════════════════════════════════
   THE 2026-09 OS/OW REFRESH — the folds, the footer and the ink ladder.

   Three things are asserted here that no HTML string test can reach:

     1. THE FOOTER IS TWO COLUMNS AT 375px, in all three variants, with no row
        holding a lone narrow column. The unit test proves the CSS cascade
        resolves to two tracks; this proves the boxes actually land two-up.
     2. EVERY DISCLOSURE WORKS WITH JAVASCRIPT DISABLED. That is the entire
        argument for native <details> over a hand-rolled accordion, and it is
        worth nothing unless it is measured with scripting off.
     3. THE MONO MICRO-LABELS CLEAR AA IN BOTH THEMES. Small uppercase mono at
        the bottom of an opacity ladder is the predictable failure of this
        visual language, so the ratio is computed rather than eyeballed.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `browser.newContext()` does NOT inherit `use.baseURL` from the config, so the
 * scripting-disabled contexts below navigate by absolute URL. Same default the
 * config uses, same env override.
 */
const BASE_FOR_NOJS = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5000';

/**
 * `rgb()` / `rgba()` → `[r, g, b, a]`.
 *
 * THE ALPHA IS NOT OPTIONAL HERE. Half the surfaces on these pages are tints —
 * the accent-soft callout, the conflict tint, every hairline — and reading
 * `rgba(13, 60, 252, 0.12)` as solid blue reports a 12% wash as a saturated
 * fill and fails a pairing that is in fact fine. Alpha is composited below.
 */
function rgba(css: string): [number, number, number, number] {
  const n = (css.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number);
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
}
/** `over` composited onto `under` (source-over, both opaque-backed). */
function flatten(over: [number, number, number, number], under: [number, number, number]): [number, number, number] {
  const a = over[3];
  return [0, 1, 2].map((i) => over[i] * a + under[i] * (1 - a)) as [number, number, number];
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/**
 * `layers` runs from the element's own background outwards to the page, each
 * possibly translucent. They are composited back-to-front, then the text — which
 * may itself be translucent — is composited onto the result.
 */
function contrast(fg: string, layers: string[]): number {
  let bg: [number, number, number] = [255, 255, 255];
  for (const layer of [...layers].reverse()) bg = flatten(rgba(layer), bg);
  const text = flatten(rgba(fg), bg);
  const [hi, lo] = [luminance(text), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const FOOTER_VARIANTS = [
  { name: 'PREMIUM_FOOTER (server-rendered chrome)', path: '/oversize', inner: '.premium-footer-inner', col: '.footer-col' },
  { name: 'landing.html inlined copy', path: '/', inner: '.premium-footer-inner', col: '.footer-col' },
  { name: 'directory subsite (.dirfoot)', path: '/directory', inner: '.dirfoot', col: '.dirfoot-col' },
];

for (const v of FOOTER_VARIANTS) {
  test(`footer: ${v.name} is TWO columns at 375px with no orphaned row`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(v.path, { waitUntil: 'domcontentloaded' });
    const measured = await page.evaluate(([innerSel, colSel]) => {
      const inner = document.querySelector(innerSel) as HTMLElement | null;
      if (inner === null) return null;
      const tracks = getComputedStyle(inner).gridTemplateColumns.split(' ').filter(Boolean).length;
      /* Group the columns by their RENDERED top edge — that is what a row is,
         whatever the cascade thinks it declared. */
      const rows = new Map<number, Array<{ name: string; full: boolean }>>();
      for (const el of Array.from(inner.querySelectorAll(colSel))) {
        const box = (el as HTMLElement).getBoundingClientRect();
        const top = Math.round(box.top);
        const list = rows.get(top) ?? [];
        list.push({
          name: (el.querySelector('h4, h2')?.textContent ?? '?').trim(),
          full: box.width > inner.clientWidth * 0.9,
        });
        rows.set(top, list);
      }
      return {
        tracks,
        columns: inner.querySelectorAll(colSel).length,
        rows: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list),
      };
    }, [v.inner, v.col] as const);

    expect(measured, `${v.inner} not found on ${v.path}`).not.toBeNull();
    expect(measured!.tracks, `${v.name}: rendered track count at 375px`).toBe(2);
    expect(measured!.columns, `${v.name}: link columns`).toBeGreaterThan(2);

    /* A row of one is only legal when that one column deliberately spans the
       full width — the full-bleed case, not a wrap remainder. */
    const orphans = measured!.rows
      .filter((r) => r.length === 1 && !r[0].full)
      .map((r) => r[0].name);
    expect(orphans, `${v.name}: rows holding a single narrow column`).toEqual([]);
    /* And two-up means two-up: at least one row must actually hold two. */
    expect(measured!.rows.some((r) => r.length === 2), `${v.name}: no row holds two columns`).toBe(true);
  });
}

const FOLDED_PAGES = ['/oversize/texas', '/oversize/common-figures', '/oversize/source-notes', '/oversize/federal-limits'];

for (const path of FOLDED_PAGES) {
  test(`${path} — every disclosure works with JavaScript DISABLED`, async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE_FOR_NOJS}${path}`, { waitUntil: 'domcontentloaded' });

    const folds = page.locator('details.qh-fold');
    expect(await folds.count(), `${path} ships no folds`).toBeGreaterThan(0);

    const first = folds.first();
    await expect(first.locator('.qh-fold-b')).toBeHidden();
    const closed = (await first.boundingBox())?.height ?? 0;
    await first.locator('summary').click();
    await page.waitForTimeout(400);
    await expect(first.locator('.qh-fold-b')).toBeVisible();
    expect(await first.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    /* The FOLD's own box, not the document's — the document height on a page
       this long also moves when the web fonts swap in, which has nothing to do
       with whether the disclosure worked. */
    const open = (await first.boundingBox())?.height ?? 0;
    expect(open, `${path}: opening the fold did not make it taller (${closed} -> ${open})`).toBeGreaterThan(closed);
    expect(await first.locator('.qh-fold-b').boundingBox().then((b) => b?.height ?? 0)).toBeGreaterThan(10);

    /* The expand-all control is script-built ON PURPOSE, so a reader with no
       JavaScript is never shown a button that cannot do anything. */
    expect(await page.locator('.qh-expand').count(), 'a dead expand-all button shipped').toBe(0);

    await assertNoDocumentOverflow(page, `${path} @375 no-JS, one fold open`);
    await ctx.close();
  });
}

test('a fold can be deep-linked by hash — with and without JavaScript', async ({ browser }) => {
  for (const javaScriptEnabled of [true, false]) {
    const ctx = await browser.newContext({ javaScriptEnabled });
    const page = await ctx.newPage();
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE_FOR_NOJS}/oversize/texas#why-no-phone`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await expect(
      page.locator('#why-no-phone .qh-fold-b'),
      `#why-no-phone did not open (javaScriptEnabled=${javaScriptEnabled})`,
    ).toBeVisible();
    await ctx.close();
  }
});

test('expand-all opens every fold in its own group', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/oversize/texas', { waitUntil: 'domcontentloaded' });
  const bar = page.locator('.qh-expand').first();
  await expect(bar).toBeVisible();
  await bar.click();
  const state = await page.evaluate(() => {
    const btn = document.querySelector('.qh-expand') as HTMLElement;
    const group = btn.nextElementSibling as HTMLElement;
    const items = group.querySelectorAll('details');
    return { total: items.length, open: [...items].filter((d) => (d as HTMLDetailsElement).open).length };
  });
  expect(state.total).toBeGreaterThan(2);
  expect(state.open).toBe(state.total);
});

test('a summary is focusable and operable by keyboard', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/oversize/texas', { waitUntil: 'domcontentloaded' });
  const focused = await page.evaluate(() => {
    const s = document.querySelector('details.qh-fold > summary') as HTMLElement;
    s.focus();
    return document.activeElement === s;
  });
  expect(focused, 'summary did not take focus').toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  expect(await page.locator('details.qh-fold').first().evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
});

test('the mono micro-labels clear AA in BOTH themes', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  /* Every place the new visual language puts small uppercase mono on a
     surface. These are the strings a contrast regression lands on first. */
  const SELECTORS = ['.qh-label', '.qh-fold .qh-n', '.qh-table thead th', '.qh-rev', '.qh-eyebrow'];
  for (const theme of ['dark', 'light'] as const) {
    await page.goto('/oversize/texas', { waitUntil: 'domcontentloaded' });
    await setTheme(page, theme);
    await page.waitForTimeout(150);
    const samples = await page.evaluate((sels) => {
      /* EVERY painted layer from the element outwards, translucent ones
         included, ending at an opaque one. The compositing happens in Node. */
      const stack = (el: Element): string[] => {
        const out: string[] = [];
        let node: Element | null = el;
        while (node !== null) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg !== '' && bg !== 'transparent') {
            const alpha = Number((bg.match(/[\d.]+/g) ?? [])[3] ?? '1');
            if (alpha > 0) {
              out.push(bg);
              if (alpha >= 1) return out;
            }
          }
          node = node.parentElement;
        }
        out.push(getComputedStyle(document.documentElement).backgroundColor);
        return out;
      };
      return sels
        .map((sel) => {
          const el = document.querySelector(sel);
          return el === null ? null : { sel, fg: getComputedStyle(el).color, layers: stack(el) };
        })
        .filter((x): x is { sel: string; fg: string; layers: string[] } => x !== null);
    }, SELECTORS);

    expect(samples.length, `${theme}: the micro-label selectors did not match`).toBeGreaterThan(3);
    for (const s of samples) {
      const ratio = contrast(s.fg, s.layers);
      expect(
        ratio,
        `${theme} ${s.sel}: ${s.fg} on [${s.layers.join(' / ')}] is ${ratio.toFixed(2)}:1, under the 4.5:1 floor`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('the collapsed rail is a two-column TOC box, not a tall single stack', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto('/oversize/texas', { waitUntil: 'domcontentloaded' });
  const cols = await page.locator('.qh-rail ol').evaluate((el) => getComputedStyle(el).columnCount);
  expect(cols, 'the on-page TOC is not in two columns below the desktop breakpoint').toBe('2');
});

test('folding removes nothing from the DOM — the prose is still indexable', async ({ page }) => {
  await page.goto('/oversize/texas', { waitUntil: 'domcontentloaded' });
  const html = await page.content();
  // A sentence that now lives inside a CLOSED fold.
  expect(html).toContain('gives two different states the same phone number');
  // And the summary-first half that must never fold.
  await expect(page.locator('.qh-short')).toBeVisible();
});
