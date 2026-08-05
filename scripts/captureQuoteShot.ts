/**
 * Capture a prospect's branded quote screenshot and store it on their demo row.
 *
 * Runs ORCHESTRATOR-SIDE (needs a headless browser via Playwright) — NOT in the
 * Replit runtime. It drives the prospect's own live demo widget to produce a
 * real quote, screenshots the result card, and persists it as base64 PNG via
 * dbProspectDemoStore.setQuoteShot(). The Replit app then serves it at
 * /demo-shot/:token.png and the drafter embeds it (clickable) in the email.
 *
 * Usage (from repo root):
 *   PUBLIC_BASE_URL=https://<demo-host> doppler run -p quotefleet -c dev -- \
 *     pnpm exec tsx scripts/captureQuoteShot.ts <token>
 *
 * Requires the Playwright chromium browser (pnpm exec playwright install chromium).
 */
import { chromium } from '@playwright/test';
import { dbProspectDemoStore } from '../src/server/outreach/prospectDemoStore.js';

const token = process.argv[2];
const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
if (!token) throw new Error('usage: captureQuoteShot <token>');
if (!base) throw new Error('PUBLIC_BASE_URL must be set to the demo host');

// Currency-appropriate sample lane so the shot shows a realistic quote.
const demo = await dbProspectDemoStore.getByToken(token);
if (!demo) throw new Error(`no prospect_demos row for token ${token}`);
const ca = (demo.configJson?.countryFocus ?? 'US') === 'CA';
const pickup = ca ? 'Mississauga, ON' : 'Chicago, IL';
const delivery = ca ? 'Toronto, ON' : 'Detroit, MI';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/demo/${token}`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  const F = page.frames().find((f) => f !== page.mainFrame()) ?? page.mainFrame();

  const locs = F.locator('input[placeholder*="City, ZIP" i]');
  if ((await locs.count()) >= 2) {
    await locs.nth(0).fill(pickup); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await locs.nth(1).fill(delivery); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  const wt = F.locator('input[placeholder*="2000" i], input[placeholder*="e.g" i]').first();
  if (await wt.count()) await wt.fill('3500');
  await page.waitForTimeout(400);
  for (const sel of ['#qf-calc-btn', 'button:has-text("Get instant quote")', 'button:has-text("instant quote")']) {
    const b = F.locator(sel).first();
    if (await b.count()) { await b.click().catch(() => {}); break; }
  }
  await page.waitForTimeout(4500);

  // Mark the result card (smallest element containing both markers) and shoot it.
  const marked = await F.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div,section'));
    const has = (el: Element, t: string) => (el.textContent || '').includes(t);
    let best: Element | null = null;
    for (const el of all) {
      if (has(el, 'Estimated total') && has(el, 'Claim this quote')) {
        const h = (el as HTMLElement).getBoundingClientRect().height;
        if (!best || h < (best as HTMLElement).getBoundingClientRect().height) best = el;
      }
    }
    best = best || all.find((el) => has(el, 'Estimated total')) || null;
    if (!best) return false;
    best.setAttribute('data-qf-shot', '1');
    return true;
  });
  if (!marked) throw new Error('quote result card not found — the quote may not have computed');

  const card = F.locator('[data-qf-shot="1"]').first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const png = await card.screenshot();
  await dbProspectDemoStore.setQuoteShot!(token, png.toString('base64'));
  console.log(`captured quote shot for ${token} (${png.length} bytes)`);
} finally {
  await browser.close();
}
