import { chromium } from '@playwright/test';
import path from 'node:path';
const SCRATCH = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad';
const BASE = 'http://localhost:8854';
const shot = (n)=>path.join(SCRATCH,`gap-${n}.png`);
const log = (...a)=>console.log(...a);
const b = await chromium.launch();

async function driveToResult(pg, {abortQuote=false, delayQuote=0}={}) {
  await pg.goto(`${BASE}/w/demo?raw=1`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  if (abortQuote) await pg.route('**/api/public/quote/**', r=>r.abort());
  if (delayQuote) await pg.route('**/api/public/quote/**', async r=>{ await new Promise(x=>setTimeout(x,delayQuote)); r.continue(); });
  await pg.evaluate(()=>{ const t=document.querySelectorAll('#qf-services button'); if(t[0])t[0].click(); });
  await pg.evaluate(()=>{ const eq=document.getElementById('qf-equipment'); if(eq&&eq.options.length>1){eq.selectedIndex=1;eq.dispatchEvent(new Event('change',{bubbles:true}));} });
  await pg.fill('#qf-weight','24000');
  async function pick(id,sug,text){ await pg.click(`#${id}`); await pg.fill(`#${id}`,text); await pg.waitForTimeout(1100); await pg.evaluate((s)=>{const c=document.getElementById(s); const el=c&&(c.querySelector('.qf-suggestion')||c.firstElementChild); if(el)el.click();},sug); }
  await pick('qf-pickup-zip','qf-pickup-suggestions','90802'); await pg.waitForTimeout(300);
  await pick('qf-delivery-zip','qf-delivery-suggestions','85001'); await pg.waitForTimeout(300);
}

// ---- 1. LOADING STATE ----
log('=== LOADING STATE (2.5s delayed /quote) ===');
{
  const ctx = await b.newContext({ viewport:{width:460,height:1000} });
  const pg = await ctx.newPage();
  await driveToResult(pg,{delayQuote:2500});
  await pg.click('#qf-calc-btn');
  await pg.waitForTimeout(500); // mid-flight
  const loading = await pg.evaluate(()=>{
    const btn=document.getElementById('qf-calc-btn');
    return { btnText: btn?.textContent?.trim(), btnDisabled: btn?.disabled, btnHTML: btn?.innerHTML.slice(0,120), spinner: !!document.querySelector('.qf-spinner') };
  });
  log('[loading mid-flight]', JSON.stringify(loading));
  await pg.screenshot({ path: shot('loading'), fullPage:false });
  await pg.waitForTimeout(3000);
  await ctx.close();
}

// ---- 2. NETWORK ERROR on /quote ----
log('\n=== NETWORK ERROR (/quote aborted) ===');
{
  const ctx = await b.newContext({ viewport:{width:460,height:1000} });
  const pg = await ctx.newPage();
  await driveToResult(pg,{abortQuote:true});
  await pg.click('#qf-calc-btn');
  await pg.waitForTimeout(2500);
  const err = await pg.evaluate(()=>{
    const e=document.getElementById('qf-error');
    const btn=document.getElementById('qf-calc-btn');
    return { errShown: e&&getComputedStyle(e).display!=='none', errText: e?.textContent, btnText: btn?.textContent?.trim(), btnDisabled: btn?.disabled };
  });
  log('[quote abort]', JSON.stringify(err));
  await pg.screenshot({ path: shot('neterr-quote'), fullPage:false });
  await ctx.close();
}

// ---- 3. NETWORK ERROR on /lead ----
log('\n=== NETWORK ERROR (/lead aborted) ===');
{
  const ctx = await b.newContext({ viewport:{width:460,height:1000} });
  const pg = await ctx.newPage();
  await driveToResult(pg);
  await pg.click('#qf-calc-btn');
  await pg.waitForTimeout(2500);
  await pg.route('**/api/public/lead/**', r=>r.abort());
  await pg.click('#qf-continue-btn'); await pg.waitForTimeout(400);
  await pg.fill('#qf-c-name','Err Test'); await pg.fill('#qf-c-email','err@example.com');
  await pg.click('#qf-submit-btn'); await pg.waitForTimeout(2500);
  const err = await pg.evaluate(()=>{
    const e=document.getElementById('qf-submit-error');
    const btn=document.getElementById('qf-submit-btn');
    const activeStep=document.querySelector('.qf-step.active')?.id;
    return { errShown: e&&getComputedStyle(e).display!=='none', errText: e?.textContent, btnText: btn?.textContent?.trim(), btnDisabled: btn?.disabled, activeStep };
  });
  log('[lead abort]', JSON.stringify(err));
  await pg.screenshot({ path: shot('neterr-lead'), fullPage:false });
  await ctx.close();
}

// ---- 4. STEP VISIBILITY after submit (raw full-height) ----
log('\n=== STEP VISIBILITY after submit ===');
{
  const ctx = await b.newContext({ viewport:{width:460,height:1000} });
  const pg = await ctx.newPage();
  await driveToResult(pg);
  await pg.click('#qf-calc-btn'); await pg.waitForTimeout(2500);
  await pg.click('#qf-continue-btn'); await pg.waitForTimeout(400);
  await pg.fill('#qf-c-name','Vis Test'); await pg.fill('#qf-c-email','vis@example.com');
  await pg.click('#qf-submit-btn'); await pg.waitForTimeout(2500);
  const vis = await pg.evaluate(()=>{
    const g=id=>{const e=document.getElementById(id); return e?getComputedStyle(e).display:'?';};
    return { stepQuote:g('qf-step-quote'), stepContact:g('qf-step-contact'), stepThanks:g('qf-step-thanks'),
      resultCard:g('qf-result'), activeStep: document.querySelector('.qf-step.active')?.id,
      qfStepQuoteClass: document.getElementById('qf-step-quote')?.className };
  });
  log('[step visibility]', JSON.stringify(vis));
  await ctx.close();
}

// ---- 5. HOSTED QUOTE PAGE + print ----
log('\n=== HOSTED QUOTE PAGE /quote/:ref ===');
{
  const fs = await import('node:fs');
  const ref = fs.readFileSync(path.join(SCRATCH,'gap-refId.txt'),'utf8').trim();
  const ctx = await b.newContext({ viewport:{width:1100,height:1200} });
  const pg = await ctx.newPage();
  const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  const resp = await pg.goto(`${BASE}/quote/${ref}`, { waitUntil:'networkidle' });
  await pg.waitForTimeout(1200);
  log('[hosted quote] status=', resp?.status(), 'title=', await pg.title());
  const has = await pg.evaluate(()=>({
    total: document.querySelector('[class*="total"],[id*="total"]')?.textContent?.slice(0,40),
    printBtn: !!Array.from(document.querySelectorAll('button,a')).find(x=>/print|pdf|download/i.test(x.textContent)),
    shareBtn: !!Array.from(document.querySelectorAll('button,a')).find(x=>/share|email/i.test(x.textContent)),
    bodyLen: document.body.innerText.length,
  }));
  log('[hosted quote] content=', JSON.stringify(has), 'pageErrs=', errs.slice(0,3));
  await pg.screenshot({ path: shot('hosted-quote'), fullPage:true });
  // print media emulation
  await pg.emulateMedia({ media:'print' });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: shot('hosted-quote-print'), fullPage:true });
  await ctx.close();
}

await b.close();
log('\n=== DONE ===');
process.exit(0);
