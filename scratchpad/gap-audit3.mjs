import { chromium } from '@playwright/test';
import path from 'node:path';
const SCRATCH='C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad';
const BASE='http://localhost:8854';
const shot=(n)=>path.join(SCRATCH,`gap-${n}.png`);
const log=(...a)=>console.log(...a);
const b=await chromium.launch();
async function driveToResult(pg){
  await pg.goto(`${BASE}/w/demo?raw=1`,{waitUntil:'networkidle'}); await pg.waitForTimeout(500);
  await pg.evaluate(()=>{const t=document.querySelectorAll('#qf-services button');if(t[0])t[0].click();});
  await pg.evaluate(()=>{const eq=document.getElementById('qf-equipment');if(eq&&eq.options.length>1){eq.selectedIndex=1;eq.dispatchEvent(new Event('change',{bubbles:true}));}});
  await pg.fill('#qf-weight','24000');
  async function pick(id,sug,t){await pg.click(`#${id}`);await pg.fill(`#${id}`,t);await pg.waitForTimeout(1100);await pg.evaluate((s)=>{const c=document.getElementById(s);const el=c&&(c.querySelector('.qf-suggestion')||c.firstElementChild);if(el)el.click();},sug);}
  await pick('qf-pickup-zip','qf-pickup-suggestions','90802');await pg.waitForTimeout(300);
  await pick('qf-delivery-zip','qf-delivery-suggestions','85001');await pg.waitForTimeout(300);
}
const ctx=await b.newContext({viewport:{width:460,height:1000}});
const pg=await ctx.newPage();
await driveToResult(pg);
await pg.click('#qf-calc-btn');await pg.waitForTimeout(2500);
await pg.click('#qf-continue-btn');await pg.waitForTimeout(400);
await pg.fill('#qf-c-name','Vis2');await pg.fill('#qf-c-email','vis2@example.com');
await pg.click('#qf-submit-btn');await pg.waitForTimeout(2500);
const vis=await pg.evaluate(()=>{const g=id=>{const e=document.getElementById(id);return e?getComputedStyle(e).display:'?';};
  // find visible result card bounding
  const rc=document.getElementById('qf-result'); const rcVisible = rc && rc.offsetParent!==null;
  const sq=document.getElementById('qf-step-quote'); const sqVisible = sq && sq.offsetParent!==null;
  return {stepQuote:g('qf-step-quote'),stepThanks:g('qf-step-thanks'),resultOffsetParentNull: rc?rc.offsetParent===null:'?', stepQuoteVisible:sqVisible, resultVisible:rcVisible};});
log('[visibility+screenshot run]',JSON.stringify(vis));
await pg.screenshot({path:shot('thanks-recheck'),fullPage:true});
await ctx.close();
await b.close();process.exit(0);
