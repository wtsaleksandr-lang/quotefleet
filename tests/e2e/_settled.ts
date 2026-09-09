/**
 * WAIT FOR THE LAYOUT TO BE FINAL BEFORE MEASURING IT.
 *
 * The horizontal-overflow guards assert that a document never scrolls sideways.
 * They were measuring it too early, and a page mid-load is not the page.
 *
 * WHAT THIS FIXES, precisely. On a cold load the browser paints text in the
 * fallback stack first and re-lays it out when the web fonts arrive. The
 * fallback is wider, so the homepage genuinely does overflow for a moment:
 * measured at 320px it is 35px over while `document.fonts.status` is
 * "loading" and exactly 0 once it is "loaded". Because the measurement landed
 * at a different point in font loading on every run, the same guard failed at
 * `/` @375px on one branch, `/tools/heavy-haul-quote` @320px on another, and
 * passed on main — three results from one cause, none of them a real layout
 * regression, and each one an afternoon of chasing a defect that was not there.
 *
 * A settled measurement still fails loudly for a real overflow, which is the
 * point: this narrows the guard to the stable layout it was always meant to
 * assert rather than weakening it.
 *
 * The transient itself is not hidden here — it is a sub-second flash of
 * sideways scroll on a cold 320px load, worth its own fix (fallback metrics or
 * `font-display`), and deliberately not smuggled into a test-only change.
 */
import type { Page } from '@playwright/test';

/**
 * BOUNDED, because one of these pages has JavaScript DISABLED.
 *
 * `/oversize/texas — every disclosure works with JavaScript DISABLED` runs in a
 * context where page scripts never execute, so `requestAnimationFrame` schedules
 * a callback that is never called and `document.fonts.ready` may never settle.
 * A wait on either simply hangs, and the first version of this helper turned
 * four passing tests into 60-second timeouts.
 *
 * The ceiling is therefore enforced from Node, where the timer always fires,
 * rather than from inside the page. If the page cannot tell us it has settled we
 * measure it as it stands — which is the correct outcome, because a page with no
 * JavaScript has no font-swap reflow to wait for in the first place.
 */
const SETTLE_CEILING_MS = 3_000;

export async function settledLayout(page: Page): Promise<void> {
  const settled = (async () => {
    // Fonts first — they are what moves the text. `.then(() => undefined)` because
    // `document.fonts.ready` resolves to a FontFaceSet, which cannot cross the
    // evaluate boundary.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Then two frames, so the re-layout the font swap triggers has been painted
    // before anything is read back. One frame schedules it; the second observes it.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  })().catch(() => {
    // The page navigated, closed, or runs no scripts. Measure what is there.
  });

  let timer: NodeJS.Timeout | undefined;
  const ceiling = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SETTLE_CEILING_MS);
  });
  try {
    await Promise.race([settled, ceiling]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
