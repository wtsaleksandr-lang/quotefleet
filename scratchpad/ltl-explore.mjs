import { chromium } from '@playwright/test';

const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 520, height: 920 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Dump services buttons
const services = await page.$$eval('#qf-services button', bs => bs.map(b => ({ svc: b.getAttribute('data-service'), text: b.innerText.trim() })));
console.log('SERVICES:', JSON.stringify(services));

// Select LTL
const ltl = await page.$('#qf-services button[data-service="ltl"]');
if (!ltl) { console.log('NO LTL BUTTON'); }
else {
  await ltl.click();
  await page.waitForTimeout(800);
}
const rootClass = await page.$eval('#qf-root, .qf-root, [class*="qf-"]', el => el.className).catch(()=>'?');
console.log('ROOT-ish class:', rootClass);
const hasLtlMode = await page.evaluate(() => !!document.querySelector('.qf-ltl-mode'));
console.log('has qf-ltl-mode:', hasLtlMode);

// Screenshot after LTL select
await page.screenshot({ path: `${OUT}/ltl-01-desktop-ltl-selected.png`, fullPage: true });

// Dump the full form HTML structure (tags + ids + classes, trimmed)
const struct = await page.evaluate(() => {
  const root = document.querySelector('.qf-ltl-mode') || document.querySelector('[class*="qf-"]')?.closest('form') || document.body;
  function walk(el, depth) {
    if (depth > 6) return '';
    let out = '';
    for (const c of el.children) {
      const id = c.id ? `#${c.id}` : '';
      const cls = (typeof c.className === 'string' && c.className) ? '.' + c.className.split(/\s+/).slice(0,3).join('.') : '';
      const tag = c.tagName.toLowerCase();
      const txt = (c.children.length===0 && c.innerText) ? ` "${c.innerText.slice(0,40).replace(/\n/g,' ')}"` : '';
      const ph = c.getAttribute && c.getAttribute('placeholder') ? ` ph="${c.getAttribute('placeholder')}"` : '';
      out += '  '.repeat(depth) + `${tag}${id}${cls}${ph}${txt}\n`;
      out += walk(c, depth+1);
    }
    return out;
  }
  return walk(document.querySelector('#qf-root') || document.body, 0);
});
console.log('=== STRUCT ===\n' + struct.slice(0, 8000));

console.log('=== LOGS ===\n' + logs.join('\n').slice(0,2000));
await browser.close();
