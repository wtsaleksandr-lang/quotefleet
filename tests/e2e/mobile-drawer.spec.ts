/**
 * THE MOBILE DRAWER AND THE STICKY BAR IT HANGS OFF.
 *
 * ── TWO HAZARDS FOR WHOEVER DRIVES THIS MENU NEXT ─────────────────────────
 *
 * 1. `details.open = true` FROM SCRIPT DOES NOT EXPAND THE FOLD. The groups are
 *    <details>, but the animated body is `.mm-fold`, a `0fr -> 1fr` grid whose
 *    open state is `data-fold="open"` — and ONLY the controller's own summary
 *    click handler ever writes that attribute. Setting `.open` leaves the fold
 *    at literally 0px for ever, with its rows laid out and clipped: the links
 *    are in the DOM, they have boxes, and every one of them is zero-height. A
 *    reviewer measuring contrast that way read ~1.0 on every row and thought
 *    the menu was broken. Click the <summary> — a real click, dispatched at
 *    coordinates or via .click() — and wait for the 200ms transition.
 *
 * 2. MEASURING "IS THIS TEXT ON ONE LINE" WITH scrollWidth <= clientWidth IS
 *    VACUOUS HERE. `.mm-s` sits in `.mm-txt`, a `flex: 0 1 auto` column that
 *    shrinks to fit its content, so the two are equal by construction whatever
 *    the text does — the assertion passes on a subtitle wrapped to four lines.
 *    Count line boxes instead: `getClientRects().length`, which returns one
 *    rect per rendered line for an inline box, cross-checked against the
 *    element's own line-height. That is what the last test below does.
 */

import { test, expect, type Page } from '@playwright/test';

const PAGES = ['/', '/directory', '/tools/oversize-permits'] as const;
const openDrawer = async (page: Page) => {
  await page.locator('#site-burger').click();
  await expect(page.locator('#site-mobile-menu')).toBeVisible();
  await page.waitForTimeout(400);
};

/* ── THE BUG THIS FILE EXISTS FOR ──────────────────────────────────────────
   `.site-header` is `position: sticky; top: 0`, and style.css used to give BODY
   `height: 100%`. Body is the header's containing block, and a sticky box may
   never travel past its containing block's bottom edge — so the bar came
   unstuck at `viewportHeight - 64` on every page of the site and the burger
   left the screen 54px later. Measured before the fix at 375px wide: 568 -> 505,
   667 -> 604, 720 -> 657, 800 -> 737, 844 -> 781, 1024 -> 961, identical on /,
   /directory and /tools/oversize-permits. On the permits page at 800px tall
   that is 6,367px of scroll with no navigation for 88% of it.

   The fix is `body { min-height: 100% }`. These sweep the same six viewport
   heights the regression was characterised at, because a fix that only holds
   at one height is not a fix. */
const VIEWPORT_HEIGHTS = [568, 667, 720, 800, 844, 1024];

for (const path of PAGES) {
  test(`${path} — the header stays stuck for the whole document, at six viewport heights`, async ({ page }) => {
    for (const height of VIEWPORT_HEIGHTS) {
      await page.setViewportSize({ width: 375, height });
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(250);
      const probe = await page.evaluate(async () => {
        const header = document.querySelector('.site-header') as HTMLElement;
        const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const max = Math.max(
          document.documentElement.scrollHeight, document.body.scrollHeight,
        ) - window.innerHeight;
        let worst = 0;
        // Sample the whole document, not just the top: the old bug only showed
        // up past `innerHeight - headerHeight`.
        for (let y = 0; y <= max; y += Math.max(64, Math.round(max / 40))) {
          window.scrollTo(0, y);
          await raf();
          worst = Math.min(worst, header.getBoundingClientRect().top);
        }
        window.scrollTo(0, max);
        await raf();
        const burger = document.getElementById('site-burger')!.getBoundingClientRect();
        return {
          max,
          worstHeaderTop: +worst.toFixed(2),
          burgerOnScreenAtBottom: burger.bottom > 0 && burger.top < window.innerHeight,
        };
      });
      expect(probe.max, `${path} @${height}: page is too short to be a test`).toBeGreaterThan(height);
      expect(
        probe.worstHeaderTop,
        `${path} @${height}: the header came unstuck (top went to ${probe.worstHeaderTop})`,
      ).toBeGreaterThan(-0.5);
      expect(
        probe.burgerOnScreenAtBottom,
        `${path} @${height}: the burger is off screen at the bottom of the document`,
      ).toBe(true);
    }
  });
}

test('the burger opens the menu at scroll depth, without the page moving under it', async ({ page }) => {
  // The reviewer could not click the burger at scrollY 1400 at all — Playwright
  // had to auto-scroll back to 368 first, which is itself the bug. page.mouse
  // never auto-scrolls, so this is the honest version of that click.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/tools/oversize-permits', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(200);

  const at = await page.evaluate(() => {
    const r = document.getElementById('site-burger')!.getBoundingClientRect();
    return { y: Math.round(window.scrollY), x: r.x + r.width / 2, cy: r.y + r.height / 2, onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  expect(at.y, 'the page did not reach scrollY 1400').toBe(1400);
  expect(at.onScreen, 'the burger is not in the viewport at scrollY 1400').toBe(true);

  await page.mouse.click(at.x, at.cy);
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => ({
    expanded: document.getElementById('site-burger')!.getAttribute('aria-expanded'),
    lockY: document.documentElement.style.getPropertyValue('--qf-lock-y'),
  }));
  expect(open.expanded, 'the click at scrollY 1400 did not open the menu').toBe('true');
  expect(open.lockY, 'the lock did not pin the page at the scroll depth it was opened from').toBe('1400px');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    expanded: document.getElementById('site-burger')!.getAttribute('aria-expanded'),
    focused: document.activeElement?.id,
    bodyPosition: getComputedStyle(document.body).position,
  }));
  expect(closed.y, 'Escape lost the scroll position').toBe(1400);
  expect(closed.expanded).toBe('false');
  expect(closed.focused, 'focus must return to the burger').toBe('site-burger');
  expect(closed.bodyPosition, 'the scroll lock was not released').toBe('static');
});

test('every menu subtitle renders on exactly one line, counted as line boxes', async ({ page }) => {
  // NOT `scrollWidth <= clientWidth` — see hazard 2 in this file's header. The
  // subtitles are held to a <=28 character editorial budget and the sheet only
  // backstops that with an ellipsis, so a bad copy edit is exactly the failure
  // this has to catch, and the vacuous version cannot catch anything.
  await page.setViewportSize({ width: 320, height: 800 }); // tightest track
  await page.goto('/tools/oversize-permits', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await openDrawer(page);
  // Real summary clicks — hazard 1: `.open = true` would leave every row at 0px.
  const groups = page.locator('#site-mobile-menu .mm-group > summary');
  for (let i = 0; i < await groups.count(); i++) {
    await groups.nth(i).click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);

  const subs = await page.evaluate(() => {
    const out: { text: string; lines: number; height: number; lineHeight: number; headroom: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('#site-mobile-menu .mm-s'))) {
      const e = el as HTMLElement;
      if (!e.getClientRects().length) continue;          // inside a collapsed fold
      const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
      /* THE ELLIPSIS BACKSTOP MEANS AN OVERLONG STRING IS CLIPPED, NOT
         WRAPPED, so the line count alone would still pass on copy that has
         run off the end of its track. Headroom is the honest second measure:
         the text's own natural width (a Range over the contents — `nowrap`
         keeps it one line, so the rect is the real thing) against the track
         the row actually leaves for it. Do NOT try to get this from
         scrollWidth/clientWidth or from a clone: `.mm-txt` is `flex: 0 1 auto`
         and shrinks to fit, so both are equal by construction. */
      const row = e.closest('a') as HTMLElement;
      const tile = row.querySelector('.mm-tile') as HTMLElement;
      const cs = getComputedStyle(row);
      const track = row.getBoundingClientRect().width
        - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - tile.getBoundingClientRect().width - parseFloat(cs.gap || '0');
      const range = document.createRange();
      range.selectNodeContents(e);
      const natural = range.getBoundingClientRect().width;
      out.push({
        text: (e.textContent || '').trim(),
        lines: e.getClientRects().length,
        height: +e.getBoundingClientRect().height.toFixed(2),
        lineHeight: lh,
        headroom: +(track - natural).toFixed(2),
      });
    }
    return out;
  });

  expect(subs.length, 'no subtitles were rendered — did the folds open?').toBeGreaterThan(10);
  for (const s of subs) {
    expect(s.lines, `"${s.text}" renders on ${s.lines} line boxes`).toBe(1);
    expect(s.height, `"${s.text}" is ${s.height}px tall against a ${s.lineHeight}px line`)
      .toBeLessThanOrEqual(s.lineHeight + 1);
  }
  // And none of them is riding the ellipsis: if the tightest one has no room
  // left, the copy is over budget even though it still renders on one line.
  const tightest = subs.reduce((a, b) => (a.headroom <= b.headroom ? a : b));
  expect(tightest.headroom, `"${tightest.text}" has ${tightest.headroom}px of track left`)
    .toBeGreaterThan(0);
});
