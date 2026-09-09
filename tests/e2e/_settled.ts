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

export async function settledLayout(page: Page): Promise<void> {
  // Fonts first — they are what moves the text.
  await page.evaluate(() => document.fonts.ready);
  // Then two frames, so the re-layout the font swap triggers has been painted
  // before anything is read back. One frame schedules it; the second observes it.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}
