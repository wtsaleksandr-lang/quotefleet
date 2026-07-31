import { chromium } from '@playwright/test';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:520,height:920}, deviceScaleFactor:1.5 });
const page = await ctx.newPage();
await page.goto(URL,{waitUntil:'networkidle'});
await page.waitForTimeout(1800);

await page.click('#qf-options-summary');
await page.waitForTimeout(600);
const clickTile = async (label) => {
  await page.getByText(label, { exact:true }).first().click().catch(e=>console.log('tileclick fail',label,e.message));
  await page.waitForTimeout(300);
};
await clickTile('Residential');
console.log('after Residential tile:', JSON.stringify(await page.evaluate(()=>({res:document.getElementById('qf-residential')?.checked,count:document.getElementById('qf-options-count')?.innerText.trim()}))));
await clickTile('Hazmat');
console.log('after Hazmat tile:', JSON.stringify(await page.evaluate(()=>({haz:document.getElementById('qf-hazmat')?.checked,count:document.getElementById('qf-options-count')?.innerText.trim(),hazClassVis:(()=>{const e=document.getElementById('qf-hazmat-class');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()}))));
await page.screenshot({path:`${OUT}/shell-desktop-20-toggles.png`, fullPage:true});
console.log('HELP buttons:', JSON.stringify(await page.evaluate(()=>{const hs=[...document.querySelectorAll('#qf-options-modal .qf-help')];return {total:hs.length,visible:hs.filter(h=>h.getBoundingClientRect().width>0).length};})));
await page.click('#qf-options-done').catch(()=>{});
await page.waitForTimeout(300);

async function fillPlace(sel,val){ await page.click(sel); await page.fill(sel,''); await page.type(sel,val,{delay:80}); await page.waitForTimeout(1600); const pac=await page.$('.pac-item'); if(pac){await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');} else {await page.keyboard.press('Enter');} await page.waitForTimeout(1000); }
await fillPlace('#qf-pickup-zip','90802');
await fillPlace('#qf-delivery-zip','85001');
await page.fill('#qf-weight','20000');
await page.click('#qf-calc-btn');
await page.waitForTimeout(3000);

const diag = await page.evaluate(()=>{
  const info=(id)=>{ const e=document.getElementById(id); if(!e)return {id,found:false};
    const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    let hiddenAnc=null,el=e;
    while(el){ const c=getComputedStyle(el); if(c.display==='none'||c.visibility==='hidden'||c.opacity==='0'){ hiddenAnc=(el.id||el.className||el.tagName)+':'+c.display; break;} el=el.parentElement; }
    return {id,found:true,w:Math.round(r.width),h:Math.round(r.height),display:cs.display,offParent:!!e.offsetParent,hiddenAnc}; };
  return { chat:info('qf-chat-open-btn'), cb:info('qf-callback-open-btn'), result:info('qf-result') };
});
console.log('CHAT/CB DIAG:', JSON.stringify(diag,null,1));
await page.evaluate(()=>document.getElementById('qf-chat-open-btn')?.click());
await page.waitForTimeout(700);
await page.screenshot({path:`${OUT}/shell-desktop-21-chat-forced.png`, fullPage:true});
console.log('CHAT after force:', JSON.stringify(await page.evaluate(()=>{const p=document.getElementById('qf-chat');if(!p)return null;const r=p.getBoundingClientRect();return{vis:r.height>0,text:p.innerText.slice(0,160)};})));
await page.evaluate(()=>document.getElementById('qf-callback-open-btn')?.click());
await page.waitForTimeout(700);
await page.screenshot({path:`${OUT}/shell-desktop-22-callback-forced.png`, fullPage:true});
console.log('DONE diag');
await browser.close();
