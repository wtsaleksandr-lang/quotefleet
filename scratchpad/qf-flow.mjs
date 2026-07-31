import { chromium } from '@playwright/test';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const tag = process.argv[2] || 'desktop';
const vp = tag === 'mobile' ? {width:375,height:800} : {width:520,height:920};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push('C:'+m.text()); });
page.on('pageerror', e => errors.push('P:'+e.message));
const shot = async n => { await page.screenshot({ path:`${OUT}/shell-${tag}-${n}.png`, fullPage:false }); console.log('shot',n); };
const shotFull = async n => { await page.screenshot({ path:`${OUT}/shell-${tag}-${n}.png`, fullPage:true }); console.log('shotFull',n); };

await page.goto(URL, { waitUntil:'networkidle' });
await page.waitForTimeout(2000);

// --- Tab bar: click each, capture indicator ---
for (const t of ['Expedite','Drayage','LTL','FTL']) {
  await page.getByRole('button',{name:t,exact:true}).click().catch(()=>{});
  await page.waitForTimeout(500);
}
await shot('10-tabbar-ftl');

// --- Options modal ---
await page.click('#qf-options-summary');
await page.waitForTimeout(700);
await shotFull('11-options-modal');
// toggle residential + hazmat + a chip, check count badge
await page.click('#qf-residential').catch(()=>{});
await page.click('#qf-hazmat').catch(()=>{});
await page.evaluate(()=>{ const c=[...document.querySelectorAll('.qf-acc-chip')]; if(c[0])c[0].click(); if(c[1])c[1].click(); });
await page.waitForTimeout(400);
await shotFull('12-options-selected');
const cnt = await page.evaluate(()=>{ const e=document.querySelector('#qf-options-count'); return e?e.innerText.trim():null; });
console.log('OPTIONS COUNT after 2 toggles+2 chips (hazmat opens class select):', cnt);
// check hazmat class select visibility
const hzClass = await page.evaluate(()=>{ const e=document.querySelector('#qf-hazmat-class'); if(!e)return null; const r=e.getBoundingClientRect(); return {vis:r.width>0&&r.height>0}; });
console.log('hazmat-class visible:', JSON.stringify(hzClass));
// close modal
await page.click('#qf-options-done').catch(()=>{});
await page.waitForTimeout(400);
const badge = await page.evaluate(()=>{ const e=document.querySelector('#qf-options-count'); return e?{txt:e.innerText.trim(),shown:e.getBoundingClientRect().width>0}:null; });
console.log('BADGE after done:', JSON.stringify(badge));
await shot('13-after-options');

// --- Fill lane ---
async function fillPlace(sel, val) {
  await page.click(sel);
  await page.fill(sel, '');
  await page.type(sel, val, { delay: 90 });
  await page.waitForTimeout(1800);
  // try Google pac dropdown
  const pac = await page.$('.pac-item');
  if (pac) { await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); }
  else { await page.keyboard.press('Enter'); }
  await page.waitForTimeout(1200);
}
await fillPlace('#qf-pickup-zip','90802');
await fillPlace('#qf-delivery-zip','85001');
await page.fill('#qf-weight','20000');
await page.waitForTimeout(400);
const laneState = await page.evaluate(()=>({
  pickup: document.querySelector('#qf-pickup-zip')?.value,
  delivery: document.querySelector('#qf-delivery-zip')?.value,
  weight: document.querySelector('#qf-weight')?.value,
  calcDisabled: document.querySelector('#qf-calc-btn')?.disabled,
}));
console.log('LANE STATE', JSON.stringify(laneState));
await shot('14-lane-filled');

// --- Get quote ---
await page.click('#qf-calc-btn');
await page.waitForTimeout(3500);
await shotFull('15-quote-result');
const result = await page.evaluate(()=>{
  const r = document.querySelector('#qf-result');
  if(!r) return {found:false};
  return { found:true, visible:r.getBoundingClientRect().height>0, text:r.innerText };
});
console.log('RESULT', JSON.stringify(result,null,1));

// --- AI chat toggle (force via JS; link may be hidden) ---
await page.evaluate(()=>document.getElementById('qf-chat-open-btn')?.click());
await page.waitForTimeout(800);
await shotFull('16-chat');
// --- Callback ---
await page.evaluate(()=>document.getElementById('qf-callback-open-btn')?.click());
await page.waitForTimeout(800);
await shotFull('17-callback');

// --- Lead form (continue in writing) ---
await page.click('#qf-continue-btn').catch(e=>console.log('no continue',e.message));
await page.waitForTimeout(900);
await shotFull('18-leadform');
const lead = await page.evaluate(()=>{
  const ids=['qf-c-name','qf-c-email','qf-c-phone','qf-c-company','qf-c-notes'];
  return ids.map(id=>{ const e=document.getElementById(id); if(!e)return {id,found:false};
    const lbl = e.closest('label')?.innerText || e.previousElementSibling?.innerText || '';
    return {id, ph:e.placeholder, required:e.required, label:lbl.slice(0,50)}; });
});
console.log('LEAD FIELDS', JSON.stringify(lead,null,1));
// try submit empty to see validation
await page.click('#qf-submit-btn').catch(()=>{});
await page.waitForTimeout(600);
await shotFull('19-leadform-validation');
const valMsg = await page.evaluate(()=>{
  const r=document.querySelector('#qf-result')||document.body;
  return r.innerText.slice(0,600);
});
console.log('AFTER EMPTY SUBMIT (excerpt):', valMsg.slice(0,400));

if (errors.length) console.log('ERRORS:\n'+errors.join('\n'));
console.log('DONE '+tag);
await browser.close();
