import { chromium } from '@playwright/test';

const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const P = (n) => `${OUT}/${n}`;

async function run(label, W, H) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (m.type()==='error'||m.type()==='warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Select LTL
  await page.click('#qf-services button[data-service="ltl"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: P(`ltl-${label}-01-selected-empty.png`), fullPage: true });

  // Inspect: equip row hidden? panel visible? summary defaults?
  const state1 = await page.evaluate(() => {
    const vis = el => { if(!el) return 'MISSING'; const s = getComputedStyle(el); return (s.display==='none'||s.visibility==='hidden')?'hidden':'visible'; };
    const eq = document.querySelector('#qf-equip-weight-row');
    const panel = document.querySelector('#qf-ltl-panel');
    const items = document.querySelectorAll('#qf-ltl-items .qf-ltl-item').length;
    const sum = {
      weight: document.querySelector('#qf-ltl-sum-weight')?.textContent,
      pieces: document.querySelector('#qf-ltl-sum-pieces')?.textContent,
      cls: document.querySelector('#qf-ltl-sum-class')?.textContent,
    };
    const remark = document.querySelector('#qf-ltl-remark')?.textContent;
    const addBtn = !!document.querySelector('#qf-ltl-add');
    const removeBtns = document.querySelectorAll('#qf-ltl-items .qf-ltl-remove').length;
    const helpTip = document.querySelector('#qf-ltl-panel .qf-help')?.getAttribute('data-tip');
    return { equipRow: vis(eq), panel: vis(panel), items, sum, remark, addBtn, removeBtns, helpTip };
  });
  console.log(`[${label}] state1`, JSON.stringify(state1, null, 1));

  // Fill first item (a light, low-density load -> high freight class)
  const items = await page.$$('#qf-ltl-items .qf-ltl-item');
  async function fillItem(itemEl, {commodity, ftype, qty, l, w, h, wt}) {
    const commodityInput = await itemEl.$('.qf-ltl-commodity input');
    if (commodity) await commodityInput.fill(commodity);
    if (ftype) await itemEl.$eval('.qf-ltl-ftype select', (s,v)=>{s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));}, ftype);
    const qtyI = await itemEl.$('.qf-ltl-qty input'); if (qty) await qtyI.fill(String(qty));
    const nums = await itemEl.$$('.qf-ltl-dims .qf-field:not(.qf-ltl-qty):not(.qf-ltl-unit) input');
    if (l) await nums[0].fill(String(l));
    if (w) await nums[1].fill(String(w));
    if (h) await nums[2].fill(String(h));
    const wtI = await itemEl.$('.qf-ltl-wt input'); if (wt) await wtI.fill(String(wt));
  }
  await fillItem(items[0], { commodity: 'Furniture', ftype:'General', qty:2, l:48, w:40, h:60, wt:300 });
  await page.waitForTimeout(400);
  const sumAfter1 = await page.evaluate(() => ({
    weight: document.querySelector('#qf-ltl-sum-weight')?.textContent,
    pieces: document.querySelector('#qf-ltl-sum-pieces')?.textContent,
    cls: document.querySelector('#qf-ltl-sum-class')?.textContent,
  }));
  console.log(`[${label}] sumAfter item1 (2x48x40x60 300lb):`, JSON.stringify(sumAfter1));
  await page.screenshot({ path: P(`ltl-${label}-02-item1-filled.png`), fullPage: true });

  // Add a second item
  await page.click('#qf-ltl-add');
  await page.waitForTimeout(300);
  const items2 = await page.$$('#qf-ltl-items .qf-ltl-item');
  await fillItem(items2[1], { commodity:'Machine parts', ftype:'General', qty:1, l:24, w:24, h:24, wt:400 });
  await page.waitForTimeout(400);
  const removeCount = await page.$$eval('#qf-ltl-items .qf-ltl-remove', b=>b.length);
  const sumAfter2 = await page.evaluate(() => ({
    weight: document.querySelector('#qf-ltl-sum-weight')?.textContent,
    pieces: document.querySelector('#qf-ltl-sum-pieces')?.textContent,
    cls: document.querySelector('#qf-ltl-sum-class')?.textContent,
  }));
  console.log(`[${label}] removeBtns after add:`, removeCount, 'sum:', JSON.stringify(sumAfter2));
  await page.screenshot({ path: P(`ltl-${label}-03-two-items.png`), fullPage: true });

  // Zoom into item rows region for layout scrutiny
  const panelBox = await page.$('#qf-ltl-panel');
  if (panelBox) await panelBox.screenshot({ path: P(`ltl-${label}-04-panel-closeup.png`) });

  // ZIPs
  await page.fill('#qf-pickup-zip', '60601');
  await page.waitForTimeout(1500);
  // pick first suggestion if present
  const pkSug = await page.$('#qf-pickup-suggestions .qf-suggestion, #qf-pickup-suggestions [role="option"], #qf-pickup-suggestions > *');
  if (pkSug) { await pkSug.click().catch(()=>{}); }
  await page.waitForTimeout(600);
  await page.fill('#qf-delivery-zip', '30301');
  await page.waitForTimeout(1500);
  const dvSug = await page.$('#qf-delivery-suggestions .qf-suggestion, #qf-delivery-suggestions [role="option"], #qf-delivery-suggestions > *');
  if (dvSug) { await dvSug.click().catch(()=>{}); }
  await page.waitForTimeout(600);
  await page.screenshot({ path: P(`ltl-${label}-05-zips.png`), fullPage: true });

  // Open options modal
  await page.click('#qf-options-summary');
  await page.waitForTimeout(500);
  const accList = await page.$$eval('#qf-accessorials .qf-acc-chip .qf-acc-label', els=>els.map(e=>e.textContent));
  const flags = await page.$$eval('#qf-options-body .qf-flags label span:not(.qf-help)', els=>els.map(e=>e.textContent).filter(Boolean));
  console.log(`[${label}] flags:`, JSON.stringify(flags), 'accessorials:', JSON.stringify(accList));
  await page.screenshot({ path: P(`ltl-${label}-06-options-modal.png`), fullPage: true });
  // close modal
  await page.click('#qf-options-done').catch(()=>{});
  await page.waitForTimeout(400);

  // Compute quote — find CTA
  const ctaSel = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => /quote|estimate|calculate|get /i.test(x.innerText) && !x.closest('.qf-modal'));
    return b ? (b.id ? '#'+b.id : b.innerText.trim()) : null;
  });
  console.log(`[${label}] CTA:`, ctaSel);
  // Try common CTA id
  let clicked = false;
  for (const sel of ['#qf-submit','#qf-quote','#qf-cta','#qf-get-quote','#qf-calculate']) {
    const b = await page.$(sel); if (b) { await b.click().catch(()=>{}); clicked=true; console.log('clicked',sel); break; }
  }
  if (!clicked) {
    const b = await page.$('button.qf-cta:not(.qf-modal-done)');
    if (b) { await b.click().catch(()=>{}); clicked=true; console.log('clicked .qf-cta'); }
  }
  await page.waitForTimeout(3500);
  const resultState = await page.evaluate(() => {
    const r = document.querySelector('#qf-result');
    if (!r) return { present:false };
    const s = getComputedStyle(r);
    return { present:true, visible:(s.display!=='none'&&s.visibility!=='hidden'), text: r.innerText.slice(0,600) };
  });
  console.log(`[${label}] RESULT:`, JSON.stringify(resultState, null, 1));
  await page.screenshot({ path: P(`ltl-${label}-07-result.png`), fullPage: true });

  // result closeup
  const rEl = await page.$('#qf-result');
  if (rEl && resultState.visible) await rEl.screenshot({ path: P(`ltl-${label}-08-result-closeup.png`) }).catch(()=>{});

  console.log(`[${label}] LOGS:`, logs.slice(0,15).join(' || '));
  await browser.close();
}

await run('desktop', 520, 920);
await run('mobile', 375, 800);
console.log('DONE');
