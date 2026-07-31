import { chromium } from '@playwright/test';
const hostUrl = 'http://localhost:8899/mock-host.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on('console', m => { const t = m.text(); if (/error/i.test(t)) console.log('  [iframe console]', t); });
await page.goto(hostUrl, { waitUntil: 'networkidle' });

const ifr = page.locator('#qf-embed-iframe');
await ifr.waitFor();
const frame = page.frameLocator('#qf-embed-iframe').first();
// Wait for widget to render its service tabs (config loaded).
await frame.locator('#qf-calc-btn').waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);

const before = await ifr.evaluate(el => Math.round(el.getBoundingClientRect().height));
console.log('BEFORE quote — iframe rendered height:', before, 'px');
await page.screenshot({ path: 'scratchpad/fix-embed-resize-before-note.png', fullPage: true });

// Drive a full quote inside the iframe.
await frame.locator('#qf-pickup-zip').fill('90001');
await frame.locator('#qf-delivery-zip').fill('07001');
const weight = frame.locator('#qf-weight');
if (await weight.count()) { try { await weight.fill('38000'); } catch {} }
await page.waitForTimeout(400);
await frame.locator('#qf-calc-btn').click();

// Wait for the result card to appear inside the iframe.
await frame.locator('#qf-result').waitFor({ state: 'visible', timeout: 25000 });
await page.waitForTimeout(2500); // let map/terms/CTA settle + resize messages flush

const after = await ifr.evaluate(el => Math.round(el.getBoundingClientRect().height));
// Full content scroll height inside the iframe (what SHOULD be visible).
const contentH = await frame.locator('body').evaluate(b => Math.ceil(b.getBoundingClientRect().height));
const resultVisible = await frame.locator('#qf-result').isVisible();
const mapVisible = await frame.locator('#qf-map, .qf-map, [id*="map"]').first().isVisible().catch(() => false);
const ctaVisible = await frame.locator('#qf-continue-btn').isVisible().catch(() => false);

console.log('AFTER quote  — iframe rendered height:', after, 'px');
console.log('AFTER quote  — iframe body content height:', contentH, 'px');
console.log('result card visible:', resultVisible, '| map visible:', mapVisible, '| continue CTA visible:', ctaVisible);
console.log('iframe grew to fit content (|after-content| <= 4px):', Math.abs(after - contentH) <= 4);
console.log('grew beyond 660 min-height fallback:', after > 700);

await page.screenshot({ path: 'scratchpad/fix-embed-resize-after.png', fullPage: true });

await browser.close();
const ok = after > 700 && Math.abs(after - contentH) <= 8 && resultVisible;
console.log(ok ? '\nRESULT: PASS — iframe auto-resized to fit the quote content.' : '\nRESULT: FAIL');
process.exit(ok ? 0 : 1);
