// Drive the REAL onboarding wizard in a browser against a target origin.
// Usage: node repro-onboarding-ui.mjs <baseUrl>
// Signs up a fresh tenant via API, injects the session cookie, opens /app so the
// wizard gate fires, then walks all 5 steps — logging every console error and
// failed request, and screenshotting the brand step where Alex got stuck.
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://localhost:8854';
const OUT = path.resolve('scratchpad');
const stamp = String(Date.now());
const email = `obui+${stamp}@example.com`;

// 1. Signup via API to get a session cookie.
const suRes = await fetch(BASE + '/api/auth/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({
    companyName: `OB UI ${stamp}`, email, password: 'ReproTest!2345',
    countryFocus: 'US', dpaAccepted: true, dpaVersion: '1.0',
  }),
});
const suBody = await suRes.text();
console.log('signup:', suRes.status, suBody.slice(0, 200));
if (suRes.status >= 400) process.exit(1);
const cookies = (suRes.headers.getSetCookie?.() || []).map((c) => {
  const [pair] = c.split(';');
  const i = pair.indexOf('=');
  return { name: pair.slice(0, i), value: pair.slice(i + 1), url: BASE };
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies(cookies);
const page = await ctx.newPage();

const consoleErrs = [];
const failed = [];
page.on('pageerror', (e) => consoleErrs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push('console: ' + m.text()); });
page.on('response', async (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) {
    let b = ''; try { b = (await r.text()).slice(0, 300); } catch {}
    failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')} :: ${b}`);
  }
});

await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const seen = await page.locator('#qf-ob-overlay').count();
console.log('wizard overlay present:', seen);
if (!seen) {
  await page.screenshot({ path: path.join(OUT, 'repro-ob-noworkflow.png') });
  console.log('NO WIZARD — cannot repro. console:', consoleErrs.slice(0, 5));
  await browser.close(); process.exit(0);
}

async function stepInfo(tag) {
  const title = await page.locator('.qf-ob-title').first().textContent().catch(() => '?');
  const kicker = await page.locator('.qf-ob-kicker').first().textContent().catch(() => '?');
  const nextDisabled = await page.locator('.qf-ob-next, [class*="next"]').first().isDisabled().catch(() => null);
  const err = await page.locator('.qf-ob-error').first().textContent().catch(() => null);
  console.log(`[${tag}] ${kicker} | "${title}" | nextDisabled=${nextDisabled} | error=${err || 'none'}`);
  return { title, kicker, err };
}

const nextBtn = page.locator('#qf-ob-overlay button').filter({ hasText: /Continue|Finish/ }).first();

await stepInfo('step1');
await page.locator('.qf-ob-card').first().click();      // pick a vertical
await page.waitForTimeout(300);
await nextBtn.click();
await page.waitForTimeout(600);

await stepInfo('step2');
await page.locator('.qf-ob-card').first().click();      // pick pricing
await page.waitForTimeout(300);
await nextBtn.click();
await page.waitForTimeout(600);

await stepInfo('step3-lane');
// Leave the lane blank on purpose — it is advertised as optional.
await nextBtn.click();
await page.waitForTimeout(600);

const brand = await stepInfo('step4-brand');
await page.screenshot({ path: path.join(OUT, 'repro-ob-brand-before.png') });

// THE REPORTED BUG: click Continue on the brand step WITHOUT picking a color.
console.log('\n>>> clicking Continue on brand step with NO color picked...');
await nextBtn.click();
await page.waitForTimeout(3000);
const after = await stepInfo('after-continue-nocolor');
await page.screenshot({ path: path.join(OUT, 'repro-ob-after-nocolor.png') });

// If still stuck on the brand step, try picking a color and continuing.
if (/Make it yours/i.test(after.title || '')) {
  console.log('\n>>> STILL on brand step. Picking a color and retrying...');
  await page.locator('.qf-ob-swatch').first().click();
  await page.waitForTimeout(400);
  await nextBtn.click();
  await page.waitForTimeout(3000);
  await stepInfo('after-continue-withcolor');
  await page.screenshot({ path: path.join(OUT, 'repro-ob-after-color.png') });
}

console.log('\n=== console errors ===');
console.log(consoleErrs.length ? consoleErrs.slice(0, 10).join('\n') : '(none)');
console.log('=== failed API calls ===');
console.log(failed.length ? failed.slice(0, 10).join('\n') : '(none)');

await browser.close();
