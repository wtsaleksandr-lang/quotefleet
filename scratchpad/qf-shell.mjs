import { chromium } from '@playwright/test';

const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';

const log = (...a) => console.log(...a);

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/shell-${name}.png`, fullPage: false });
  log('shot', name);
}

async function run(viewport, tag) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle' }).catch(e => log('goto', e.message));
  await page.waitForTimeout(2500);
  await shot(page, `${tag}-01-initial`);

  // Dump some structural facts
  const facts = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    const txt = s => { const e = q(s); return e ? e.innerText.trim().slice(0,200) : null; };
    const box = s => { const e = q(s); if(!e) return null; const r = e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
    const services = Array.from(document.querySelectorAll('#qf-services *')).filter(e=>e.children.length===0 && e.innerText && e.innerText.trim().length<30).map(e=>e.innerText.trim()).filter((v,i,a)=>a.indexOf(v)===i);
    return {
      title: document.title,
      bodyScrollW: document.body.scrollWidth,
      innerW: window.innerWidth,
      hasHorizScroll: document.body.scrollWidth > window.innerWidth + 1,
      services,
      servicesBox: box('#qf-services'),
      optionsSummary: txt('#qf-options-summary'),
      optionsCount: txt('#qf-options-count'),
      header: txt('header') || txt('[class*="header"]'),
    };
  });
  log(tag, 'FACTS', JSON.stringify(facts, null, 2));
  if (errors.length) log(tag, 'ERRORS', errors.join('\n'));

  await ctx.close();
  await browser.close();
}

await run({ width: 520, height: 920 }, 'desktop');
await run({ width: 375, height: 800 }, 'mobile');
log('DONE');
