import { chromium } from '@playwright/test';
const OUT='C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const URL='http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const log=(...a)=>console.log(...a);
const browser=await chromium.launch();

async function fresh(w=520,h=920){
  const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:2});
  const page=await ctx.newPage();
  await page.goto(URL,{waitUntil:'networkidle',timeout:60000});
  await page.waitForTimeout(1000);
  await page.click('#qf-services button[data-service="drayage"]');
  await page.waitForTimeout(400);
  return {ctx,page};
}
function clickGQ(page){return page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/get instant quote|get quote|calculate/i.test(x.innerText)&&x.offsetParent!==null);if(b)b.click();return !!b;});}

// 1. EMPTY submit
{
  const {ctx,page}=await fresh();
  const clicked=await clickGQ(page);
  await page.waitForTimeout(1500);
  await page.screenshot({path:`${OUT}/dray-edge-empty-submit.png`,fullPage:true});
  const res=await page.$eval('#qf-result',el=>el.innerText.replace(/\n+/g,' | ').slice(0,300)).catch(()=>'no #qf-result');
  const anyErr=await page.evaluate(()=>[...document.querySelectorAll('[class*="error"],[class*="invalid"],.qf-error')].filter(e=>e.getBoundingClientRect().height>0).map(e=>e.innerText.trim().slice(0,60)));
  log('EMPTY SUBMIT clicked=',clicked,'result=',res);
  log('EMPTY validation msgs:',JSON.stringify(anyErr));
  await ctx.close();
}

// 2. OVERWEIGHT 20' container with 60000 lbs
{
  const {ctx,page}=await fresh();
  await page.click('#qf-pickup-port-input');await page.type('#qf-pickup-port-input','Los Angeles',{delay:40});
  await page.waitForTimeout(1000);
  await page.click('#qf-pickup-port-suggestions .qf-suggestion').catch(()=>{});
  await page.waitForTimeout(400);
  await page.click('#qf-delivery-zip');await page.type('#qf-delivery-zip','90802',{delay:40});
  await page.waitForTimeout(900);
  await page.evaluate(()=>{const s=[...document.querySelectorAll('.qf-suggestion')].filter(x=>x.getBoundingClientRect().height>0);if(s[0])s[0].click();});
  await page.waitForTimeout(400);
  await page.fill('#qf-weight','60000');
  await page.waitForTimeout(400);
  await page.screenshot({path:`${OUT}/dray-edge-overweight-form.png`,fullPage:true});
  const weightWarn=await page.evaluate(()=>{
    const wf=document.querySelector('#qf-weight');
    const near=wf?.closest('.qf-field,.qf-addr-col,div');
    const txt=near?near.innerText:'';
    const warns=[...document.querySelectorAll('[class*="warn"],[class*="error"],[class*="hint"],[class*="help"]')].filter(e=>e.getBoundingClientRect().height>0&&/weight|limit|max|overweight|exceed|lb/i.test(e.innerText)).map(e=>e.innerText.trim().slice(0,80));
    return {warns};
  });
  log('OVERWEIGHT warns:',JSON.stringify(weightWarn));
  await clickGQ(page);
  await page.waitForTimeout(1800);
  await page.screenshot({path:`${OUT}/dray-edge-overweight-result.png`,fullPage:true});
  const res=await page.$eval('#qf-result',el=>el.innerText.replace(/\n+/g,' | ').slice(0,400)).catch(()=>'none');
  log('OVERWEIGHT result:',res);
  await ctx.close();
}

// 3. Proper terminal selection populates value
{
  const {ctx,page}=await fresh();
  await page.click('#qf-pickup-port-input');await page.type('#qf-pickup-port-input','Los Angeles',{delay:40});
  await page.waitForTimeout(1000);
  await page.click('#qf-pickup-port-suggestions .qf-suggestion').catch(()=>{});
  await page.waitForTimeout(400);
  await page.click('#qf-pickup-terminal-search');await page.type('#qf-pickup-terminal-search','fenix',{delay:50});
  await page.waitForTimeout(900);
  const before=await page.$eval('#qf-pickup-terminal-search',el=>el.value);
  await page.evaluate(()=>{const s=[...document.querySelectorAll('.qf-suggestion')].filter(x=>x.getBoundingClientRect().height>0&&/fenix/i.test(x.innerText));if(s[0])s[0].click();});
  await page.waitForTimeout(500);
  const after=await page.$eval('#qf-pickup-terminal-search',el=>({val:el.value,overflow:el.scrollWidth>el.clientWidth+1}));
  await page.screenshot({path:`${OUT}/dray-edge-terminal-populated.png`,fullPage:true});
  log('TERMINAL before click val=',JSON.stringify(before),'after=',JSON.stringify(after));
  await ctx.close();
}

await browser.close();
log('DONE');
