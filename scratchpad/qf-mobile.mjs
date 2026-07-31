import { chromium } from '@playwright/test';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:375,height:800}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const page = await ctx.newPage();
await page.goto(URL,{waitUntil:'load'});
await page.waitForTimeout(3000);
const shot = async n => { await page.screenshot({path:`${OUT}/shell-mobile-${n}.png`, fullPage:true}); console.log('shot',n); };

// options modal
await page.click('#qf-options-summary');
await page.waitForTimeout(700);
await shot('40-options-modal');
// check modal fits / scroll, done btn reachable, overlap with page CTA
const modalFacts = await page.evaluate(()=>{
  const m=document.getElementById('qf-options-modal'); const r=m?m.getBoundingClientRect():null;
  const done=document.getElementById('qf-options-done'); const dr=done?done.getBoundingClientRect():null;
  return { modalTop:r?Math.round(r.top):null, modalH:r?Math.round(r.height):null, vh:window.innerHeight, doneBottom:dr?Math.round(dr.bottom):null, doneVisible: dr?dr.bottom<=window.innerHeight+2:null };
});
console.log('MOBILE MODAL:', JSON.stringify(modalFacts));
await page.click('#qf-options-done').catch(()=>{});
await page.waitForTimeout(400);

// fill lane
async function fillPlace(sel,val){ await page.click(sel); await page.fill(sel,''); await page.type(sel,val,{delay:60}); await page.waitForTimeout(1500); const pac=await page.$('.pac-item'); if(pac){await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');} else {await page.keyboard.press('Enter');} await page.waitForTimeout(900); }
await fillPlace('#qf-pickup-zip','90802');
await fillPlace('#qf-delivery-zip','85001');
await page.fill('#qf-weight','20000');
await page.click('#qf-calc-btn');
await page.waitForTimeout(3000);
await shot('41-quote-result');
// lead form
await page.click('#qf-continue-btn').catch(()=>{});
await page.waitForTimeout(800);
await shot('42-leadform');
// horizontal scroll check across states
const hs = await page.evaluate(()=>({ bodyW:document.body.scrollWidth, win:window.innerWidth, over:document.body.scrollWidth>window.innerWidth+1 }));
console.log('MOBILE HSCROLL:', JSON.stringify(hs));
console.log('DONE mobilecap');
await browser.close();
