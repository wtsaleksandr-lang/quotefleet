import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8854';
const URL = `${BASE}/w/demo?raw=1`;
const OUT = 'C:/Users/Owner/.codex/quotefleet/scratchpad';
const logs = [];

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/audit-widget-${name}.png`, fullPage: true });
  console.log('SHOT', name);
}

async function selectService(page, svc) {
  // Service tabs live in #qf-services as clickable elements. Click the one whose data-service or text matches.
  const clicked = await page.evaluate((svc) => {
    const box = document.getElementById('qf-services');
    if (!box) return 'no-box';
    const els = [...box.querySelectorAll('*')];
    for (const el of els) {
      const ds = el.getAttribute('data-service') || el.dataset?.service;
      if (ds === svc) { el.click(); return 'clicked-data'; }
    }
    for (const el of els) {
      if (el.children.length === 0 && el.innerText && el.innerText.toLowerCase().includes(svc)) { el.click(); return 'clicked-text:'+el.innerText.trim(); }
    }
    return 'not-found';
  }, svc);
  console.log('selectService', svc, '=>', clicked);
  await page.waitForTimeout(500);
}

async function golden(page, tag) {
  await selectService(page, 'ftl');
  await page.fill('#qf-pickup-zip', '90802');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.fill('#qf-delivery-zip', '60607');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.fill('#qf-weight', '25000');
  await shot(page, `${tag}-midfill`);
  await page.click('#qf-calc-btn');
  await page.waitForTimeout(2500);
  await shot(page, `${tag}-result`);
  const res = await page.evaluate(() => {
    const err = document.getElementById('qf-error');
    return { errShown: err && err.style.display !== 'none', errText: err?.innerText, bodyLen: document.body.innerText.length,
             totalMatch: (document.body.innerText.match(/\$[0-9,]+\.?[0-9]*/g)||[]).slice(0,8) };
  });
  console.log(`RESULT ${tag}:`, JSON.stringify(res));
}

async function errorState(page, tag) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await selectService(page, 'ftl');
  await page.fill('#qf-pickup-zip', '00001');
  await page.keyboard.press('Escape');
  await page.fill('#qf-delivery-zip', '60607');
  await page.keyboard.press('Escape');
  await page.fill('#qf-weight', '25000');
  await page.click('#qf-calc-btn');
  await page.waitForTimeout(2000);
  await shot(page, `${tag}-error`);
  const err = await page.evaluate(() => {
    const e = document.getElementById('qf-error');
    return { shown: e && e.style.display !== 'none', text: e?.innerText };
  });
  console.log(`ERROR ${tag}:`, JSON.stringify(err));
}

async function run(width, tag) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') logs.push(`[${tag} console] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[${tag} pageerror] ${e.message}`));
  page.on('response', r => { if (r.url().includes('/api/public/') && r.status()>=400) logs.push(`[${tag} http ${r.status()}] ${r.url().split('/api')[1]}`); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, `${tag}-initial`);
  await golden(page, tag);
  await errorState(page, tag);
  await browser.close();
}

await run(1280, 'desktop');
await run(375, 'mobile');
console.log('\n=== LOGS ===\n' + (logs.length ? logs.join('\n') : 'none'));
