import { chromium } from '@playwright/test';

const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const log = (...a) => console.log(...a);

async function run(width, height, tag) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE: '+m.text().slice(0,200)); });
  page.on('pageerror', e => errors.push('PAGEERR: '+e.message.slice(0,200)));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  log(`\n===== ${tag} (${width}x${height}) =====`);

  await page.click('#qf-services button[data-service="drayage"]');
  await page.waitForTimeout(600);

  // ---- Terminal state before port ----
  const termDisabledBefore = await page.$eval('#qf-pickup-terminal-search', el => ({
    disabled: el.disabled, placeholder: el.placeholder, ph: el.getAttribute('placeholder'),
    readonly: el.readOnly, ariaDisabled: el.getAttribute('aria-disabled')
  })).catch(e=>'ERR '+e.message);
  log('TERM before port:', JSON.stringify(termDisabledBefore));
  // Try clicking terminal before port
  await page.click('#qf-pickup-terminal-search').catch(()=>{});
  await page.type('#qf-pickup-terminal-search','a').catch(()=>{});
  await page.waitForTimeout(500);
  const suggBefore = await page.$$eval('body *', els => els.filter(e => /terminal/i.test(e.className||'') && e.getBoundingClientRect().height>0).slice(0,3).map(e=>e.className)).catch(()=>[]);
  await page.screenshot({ path: `${OUT}/dray-${tag}-03-terminal-before-port.png`, fullPage: true });
  // clear
  await page.fill('#qf-pickup-terminal-search','').catch(()=>{});

  // ---- Port typeahead ----
  await page.click('#qf-pickup-port-input');
  await page.type('#qf-pickup-port-input', 'Los Angeles', { delay: 40 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/dray-${tag}-04-port-suggestions.png`, fullPage: true });
  // dump suggestion list
  const sugg = await page.evaluate(() => {
    const lists = [...document.querySelectorAll('ul,ol,[role="listbox"],div')].filter(l => /suggest|typeahead|listbox|option|result|menu|port/i.test((l.className||'')+(l.getAttribute?.('role')||'')));
    const items = [...document.querySelectorAll('li,[role="option"]')].filter(i=>i.getBoundingClientRect().height>0).slice(0,8).map(i=>({t:i.innerText.trim().slice(0,60), c:i.className}));
    return { items };
  });
  log('PORT SUGG:', JSON.stringify(sugg.items));
  // click first option
  const clicked = await page.evaluate(() => {
    const o = [...document.querySelectorAll('li,[role="option"]')].filter(i=>i.getBoundingClientRect().height>0 && /los angeles/i.test(i.innerText));
    if (o[0]) { o[0].click(); return o[0].innerText.trim().slice(0,60); }
    return null;
  });
  log('CLICKED PORT:', clicked);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/dray-${tag}-05-port-chosen.png`, fullPage: true });

  // ---- Terminal AFTER port ----
  const termAfter = await page.$eval('#qf-pickup-terminal-search', el => ({ disabled: el.disabled, ph: el.getAttribute('placeholder') })).catch(e=>'ERR '+e.message);
  log('TERM after port:', JSON.stringify(termAfter));
  await page.click('#qf-pickup-terminal-search').catch(()=>{});
  await page.type('#qf-pickup-terminal-search','a',{delay:40}).catch(()=>{});
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/dray-${tag}-06-terminal-suggestions.png`, fullPage: true });
  const termSugg = await page.evaluate(() => {
    const items = [...document.querySelectorAll('li,[role="option"]')].filter(i=>i.getBoundingClientRect().height>0).slice(0,12).map(i=>{
      const r=i.getBoundingClientRect(); const trunc = i.scrollWidth > i.clientWidth;
      return {t:i.innerText.trim().slice(0,80), w:Math.round(r.width), overflow:trunc};
    });
    return items;
  });
  log('TERMINAL SUGG:', JSON.stringify(termSugg, null, 0));
  // select first terminal
  const termClicked = await page.evaluate(() => {
    const o=[...document.querySelectorAll('li,[role="option"]')].filter(i=>i.getBoundingClientRect().height>0);
    if(o[0]){o[0].click();return o[0].innerText.trim().slice(0,80);} return null;
  });
  log('CLICKED TERMINAL:', termClicked);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/dray-${tag}-07-terminal-chosen.png`, fullPage: true });
  // check selected terminal label overflow in the field/pill
  const termLabel = await page.evaluate(() => {
    const el = document.querySelector('#qf-pickup-terminal-search');
    const wrap = el?.closest('div');
    return { val: el?.value, wrapScroll: wrap ? wrap.scrollWidth>wrap.clientWidth : null };
  });
  log('TERM LABEL:', JSON.stringify(termLabel));

  // ---- Delivery ----
  await page.fill('#qf-delivery-zip', '90802').catch(async()=>{ await page.type('#qf-delivery-zip','90802'); });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/dray-${tag}-08-delivery.png`, fullPage: true });
  // maybe delivery has suggestions too
  const delSugg = await page.evaluate(()=>[...document.querySelectorAll('li,[role="option"]')].filter(i=>i.getBoundingClientRect().height>0).slice(0,5).map(i=>i.innerText.trim().slice(0,50)));
  log('DELIVERY SUGG:', JSON.stringify(delSugg));
  await page.evaluate(()=>{const o=[...document.querySelectorAll('li,[role="option"]')].filter(i=>i.getBoundingClientRect().height>0);if(o[0])o[0].click();});
  await page.waitForTimeout(500);

  // ---- Weight ----
  await page.fill('#qf-weight','38000').catch(()=>{});
  await page.waitForTimeout(300);

  // ---- Options modal ----
  const optSummary = await page.$('#qf-options-summary');
  log('OPTIONS summary present=', !!optSummary, optSummary?await dumpTxt(optSummary):'');
  if (optSummary) {
    await optSummary.click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/dray-${tag}-09-options-modal.png`, fullPage: true });
    const chips = await page.$$eval('#qf-options-modal .qf-acc-chip', cs => cs.map(c=>({t:c.innerText.trim().replace(/\n+/g,' | ').slice(0,80), overflow:c.scrollWidth>c.clientWidth})));
    log('ACC CHIPS ('+chips.length+'):', JSON.stringify(chips, null, 0));
    // close modal
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(400);
  }

  // ---- Compute quote ----
  const getBtn = await page.evaluate(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/get (quote|price|estimate)|quote|calculate|estimate/i.test(x.innerText)&&x.offsetParent!==null);
    if(b){b.setAttribute('data-qf-getquote','1');return b.innerText.trim();}
    return null;
  });
  log('GET BTN:', getBtn);
  await page.click('[data-qf-getquote="1"]').catch(e=>log('getbtn click err',e.message));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/dray-${tag}-10-result.png`, fullPage: true });
  const result = await page.$('#qf-result');
  log('RESULT text:', result?await dumpTxt(result):'MISSING');

  log('ERRORS:', errors.length?errors.join('\n'):'none');
  await ctx.close(); await browser.close();
}
async function dumpTxt(el){try{return (await el.innerText()).replace(/\n+/g,' | ').slice(0,400);}catch{return '';}}

await run(520, 920, 'desktop');
await run(375, 800, 'mobile');
log('\nDONE');
