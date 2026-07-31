import { chromium } from '@playwright/test';

const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 520, height: 920 } });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

// Dump services buttons
const services = await p.$$eval('#qf-services button', els => els.map(e => ({ ds: e.getAttribute('data-service'), txt: e.textContent.trim() })));
console.log('SERVICES:', JSON.stringify(services, null, 2));

// Helper to dump a select's options
async function dumpSelect(sel) {
  const exists = await p.$(sel);
  if (!exists) return `(no ${sel})`;
  return await p.$eval(sel, el => ({
    id: el.id,
    options: Array.from(el.options).map(o => ({ v: o.value, t: o.textContent.trim() }))
  }));
}

for (const svc of ['ftl','expedited','hotshot']) {
  const btn = await p.$(`#qf-services button[data-service="${svc}"]`);
  if (!btn) { console.log(`\n=== ${svc}: NO BUTTON ===`); continue; }
  await btn.click();
  await p.waitForTimeout(600);
  console.log(`\n=== MODE ${svc} ===`);
  console.log('equipment:', JSON.stringify(await dumpSelect('#qf-equipment')));
  console.log('weight elem:', await p.$eval('#qf-weight', el => ({ tag: el.tagName, type: el.type, ph: el.placeholder, val: el.value })).catch(()=>'none'));
  // list all visible labels in the form
  const labels = await p.$$eval('label, .qf-field-label, [class*="label"]', els => els.slice(0,40).map(e => e.textContent.trim()).filter(Boolean));
  console.log('labels:', JSON.stringify([...new Set(labels)]));
}

await b.close();
