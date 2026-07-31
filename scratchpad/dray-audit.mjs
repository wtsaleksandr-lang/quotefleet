import { chromium } from '@playwright/test';

const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';

const log = (...a) => console.log(...a);

async function dumpText(page, sel) {
  try {
    const el = await page.$(sel);
    if (!el) return `MISSING(${sel})`;
    return (await el.innerText()).slice(0, 300).replace(/\n+/g, ' | ');
  } catch (e) { return `ERR(${sel}): ${e.message}`; }
}

async function run(width, height, tag) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0,200)); });
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message.slice(0,200)));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  log(`\n===== ${tag} (${width}x${height}) =====`);

  // Initial
  await page.screenshot({ path: `${OUT}/dray-${tag}-01-initial.png`, fullPage: true });

  // Services present?
  const services = await page.$$eval('#qf-services button', bs => bs.map(b => ({ svc: b.getAttribute('data-service'), txt: b.innerText.trim() })));
  log('SERVICES:', JSON.stringify(services));

  // Select drayage
  const drayBtn = await page.$('#qf-services button[data-service="drayage"]');
  if (!drayBtn) { log('NO DRAYAGE BUTTON'); await browser.close(); return; }
  await drayBtn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/dray-${tag}-02-drayage-selected.png`, fullPage: true });

  // Equipment options
  const equip = await page.$('#qf-equipment');
  if (equip) {
    const opts = await page.$$eval('#qf-equipment option', os => os.map(o => o.value + ' :: ' + o.innerText.trim()));
    log('EQUIPMENT OPTS:', JSON.stringify(opts));
  } else log('NO #qf-equipment');

  // Terminal selector state before port chosen
  const termBefore = await page.$('#qf-pickup-terminal-search');
  log('TERMINAL before port: present=', !!termBefore, termBefore ? 'disabled=' + await termBefore.isDisabled() : '');
  const termWrap = await dumpText(page, '#qf-pickup-terminal-search');
  log('TERMINAL wrap text:', termWrap);

  // Screenshot the pickup/terminal region
  const portInput = await page.$('#qf-pickup-port-input');
  log('PORT input present=', !!portInput);

  await ctx.close(); await browser.close();
  log('ERRORS:', errors.length ? errors.join('\n') : 'none');
}

await run(520, 920, 'desktop');
await run(375, 800, 'mobile');
log('\nDONE');
