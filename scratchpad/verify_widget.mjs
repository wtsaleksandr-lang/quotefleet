import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8854/w/demo?raw=1';
const SHOT = 'C:/Users/Owner/.codex/quotefleet/scratchpad';
import { mkdirSync } from 'node:fs';
mkdirSync(SHOT, { recursive: true });

const results = [];
function log(name, pass, detail) { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + ' :: ' + detail); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();

async function pickService(svc) {
  await page.click(`#qf-services button[data-service="${svc}"]`);
  await page.waitForTimeout(200);
}
async function pickEquipment(val) {
  await page.selectOption('#qf-equipment', val).catch(() => {});
  await page.waitForTimeout(100);
}
async function setVal(id, v) { const el = page.locator('#' + id); await el.fill(''); await el.fill(String(v)); }
async function errText() { return (await page.locator('#qf-error').textContent().catch(() => '')) || ''; }
async function errVisible() { return await page.locator('#qf-error').isVisible().catch(() => false); }

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#qf-services button', { timeout: 15000 });

// ── FIX 2: sprinter @ 44,000 lb warns ─────────────────────────────
await pickService('expedited');
await pickEquipment('sprinter');
await setVal('qf-pickup-zip', '90001');
await setVal('qf-delivery-zip', '10001');
await setVal('qf-weight', '44000');
await page.click('#qf-calc-btn');
await page.waitForTimeout(600);
let e = await errText();
log('FIX2 sprinter@44000 warns', /typical capacity|4,000 lb|larger equipment|oversize/i.test(e) && await errVisible(), JSON.stringify(e).slice(0, 160));
await page.screenshot({ path: SHOT + '/flagfix-2-sprinter-weight.png' });

// second click proceeds (soft): should NOT re-show the same capacity warning (goes to fetch)
await page.click('#qf-calc-btn');
await page.waitForTimeout(1200);
let e2 = await errText();
log('FIX2 soft-proceed on 2nd click', !/typical capacity/i.test(e2), 'after 2nd click err=' + JSON.stringify(e2).slice(0, 120));

// ── FIX 2: hotshot @ 48,000 lb warns ─────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#qf-services button');
await pickService('hotshot');
await pickEquipment('flatbed');
await setVal('qf-pickup-zip', '90001');
await setVal('qf-delivery-zip', '10001');
await setVal('qf-weight', '48000');
await page.click('#qf-calc-btn');
await page.waitForTimeout(600);
let eh = await errText();
log('FIX2 hotshot@48000 warns', /typical capacity|16,000 lb|larger|oversize/i.test(eh) && await errVisible(), JSON.stringify(eh).slice(0, 160));
await page.screenshot({ path: SHOT + '/flagfix-2-hotshot-weight.png' });

// ── FIX 2: normal load unaffected (dryvan @ 38,000) ──────────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#qf-services button');
await pickService('ftl');
await pickEquipment('dryvan');
await setVal('qf-pickup-zip', '90001');
await setVal('qf-delivery-zip', '10001');
await setVal('qf-weight', '38000');
await page.click('#qf-calc-btn');
await page.waitForTimeout(1200);
let en = await errText();
log('FIX2 normal 38000 no weight warning', !/typical capacity/i.test(en), 'err=' + JSON.stringify(en).slice(0, 120));

// ── FIX 4a: same pickup==delivery ZIP warns ──────────────────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#qf-services button');
await pickService('ftl');
await pickEquipment('dryvan');
await setVal('qf-pickup-zip', '60607');
await setVal('qf-delivery-zip', '60607');
await setVal('qf-weight', '38000');
await page.click('#qf-calc-btn');
await page.waitForTimeout(600);
let es = await errText();
log('FIX4a same-ZIP warns', /same location|is that right/i.test(es) && await errVisible(), JSON.stringify(es).slice(0, 160));
await page.screenshot({ path: SHOT + '/flagfix-4a-same-zip.png' });

// ── FIX 4b: pickup city-only rejected like delivery (symmetric) ──
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#qf-services button');
await pickService('ftl');
await pickEquipment('dryvan');
await setVal('qf-pickup-zip', 'Chicago, IL');
await setVal('qf-delivery-zip', '10001');
await setVal('qf-weight', '38000');
await page.click('#qf-calc-btn');
await page.waitForTimeout(600);
let ec = await errText();
log('FIX4b pickup city-only requires ZIP (symmetric)', /pickup ZIP\/postal|City-only pickup/i.test(ec) && await errVisible(), JSON.stringify(ec).slice(0, 160));
await page.screenshot({ path: SHOT + '/flagfix-4b-symmetric.png' });

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log('\n=== SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
process.exit(failed.length ? 1 : 0);
