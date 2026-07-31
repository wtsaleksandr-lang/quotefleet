import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const SCRATCH = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad';
const BASE = 'http://localhost:8854';
const shot = (name) => path.join(SCRATCH, `gap-${name}.png`);
const log = (...a) => console.log(...a);

const b = await chromium.launch();

// Helper: drive the raw widget to a quote result. Returns page + refId.
async function driveToResult(pg) {
  await pg.goto(`${BASE}/w/demo?raw=1`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  // service tab: pick FTL (first)
  await pg.evaluate(() => { const t = document.querySelectorAll('#qf-services button'); if (t[0]) t[0].click(); });
  await pg.waitForTimeout(200);
  // equipment
  await pg.evaluate(() => { const eq = document.getElementById('qf-equipment'); if (eq && eq.options.length>1){ eq.selectedIndex=1; eq.dispatchEvent(new Event('change',{bubbles:true})); } });
  await pg.fill('#qf-weight', '24000');
  // pickup typeahead
  async function pick(inputId, sugId, text) {
    await pg.click(`#${inputId}`);
    await pg.fill(`#${inputId}`, text);
    await pg.waitForTimeout(1200);
    const has = await pg.evaluate((s)=>{ const c=document.getElementById(s); return c && c.querySelectorAll('.qf-suggestion, [data-idx], button, li, div').length; }, sugId);
    // click first suggestion element that is clickable
    const clicked = await pg.evaluate((s)=>{
      const c=document.getElementById(s); if(!c) return false;
      const el = c.querySelector('.qf-suggestion') || c.firstElementChild;
      if(el){ el.click(); return true; } return false;
    }, sugId);
    return { has, clicked };
  }
  const p1 = await pick('qf-pickup-zip','qf-pickup-suggestions','90802');
  await pg.waitForTimeout(400);
  const p2 = await pick('qf-delivery-zip','qf-delivery-suggestions','85001');
  await pg.waitForTimeout(400);
  log('  typeahead pickup', JSON.stringify(p1), 'delivery', JSON.stringify(p2));
  // calculate
  await pg.click('#qf-calc-btn');
  await pg.waitForTimeout(2500);
  const resultShown = await pg.evaluate(()=>{ const r=document.getElementById('qf-result'); return r? getComputedStyle(r).display : 'none'; });
  const total = await pg.evaluate(()=> document.getElementById('qf-total')?.textContent);
  const err = await pg.evaluate(()=>{ const e=document.getElementById('qf-error'); return e && e.style.display!=='none' ? e.textContent : null; });
  log('  result display=', resultShown, 'total=', total, 'err=', err);
  return { resultShown, total, err };
}

// ============ PART 1: DEMO SHELL ============
log('\n=== PART 1: DEMO SHELL ===');
for (const [w, tag] of [[1440,'desktop'],[390,'mobile']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1200 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  const consoleErrs = [];
  pg.on('console', m => { if (m.type()==='error') consoleErrs.push(m.text()); });
  pg.on('pageerror', e => consoleErrs.push('PAGEERR: '+e.message));
  await pg.goto(`${BASE}/w/demo`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1800);
  await pg.screenshot({ path: shot(`demo-shell-${tag}`), fullPage: true });
  const info = await pg.evaluate(()=>({
    cta: document.querySelector('.qfd-cta')?.textContent?.trim(),
    ctaHref: document.querySelector('.qfd-cta')?.getAttribute('href'),
    foot: document.querySelector('.qfd-foot p')?.textContent?.trim(),
    tag: document.querySelector('.qfd-tag')?.textContent?.trim(),
    frameSrc: document.getElementById('qfd-frame')?.getAttribute('src'),
    frameH: document.getElementById('qfd-frame')?.style.height,
    hasDeviceToggle: !!document.getElementById('qfd-device-seg') && getComputedStyle(document.getElementById('qfd-device-seg')).display!=='none',
    hasThemeToggle: !!document.querySelector('[aria-label="Theme preview"]'),
  }));
  log(`[demo ${tag}]`, JSON.stringify(info));
  log(`[demo ${tag}] consoleErrs:`, consoleErrs.slice(0,5));
  await ctx.close();
}

// theme toggle test (desktop)
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 } });
  const pg = await ctx.newPage();
  await pg.goto(`${BASE}/w/demo`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  await pg.click('#qfd-light');
  await pg.waitForTimeout(1800);
  await pg.screenshot({ path: shot('demo-shell-light'), fullPage: true });
  const srcAfter = await pg.evaluate(()=>document.getElementById('qfd-frame')?.getAttribute('src'));
  log('[demo] after light toggle frameSrc=', srcAfter);
  await pg.click('#qfd-mobile');
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: shot('demo-shell-mobiletoggle'), fullPage: true });
  await ctx.close();
}

// ============ PART 2: RAW WIDGET FLOW + refId + downstream features ============
log('\n=== PART 2: FEATURES (chat / callback / share / in-writing) ===');
{
  const ctx = await b.newContext({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  const netFail = [];
  pg.on('requestfailed', r => netFail.push(r.url()+' '+r.failure()?.errorText));
  const r = await driveToResult(pg);
  await pg.screenshot({ path: shot('raw-result'), fullPage: true });
  if (r.resultShown !== 'none' && r.total && r.total !== '0') {
    // continue -> contact
    await pg.click('#qf-continue-btn');
    await pg.waitForTimeout(500);
    await pg.fill('#qf-c-name', 'Gap Auditor');
    await pg.fill('#qf-c-email', 'gap-audit@example.com');
    await pg.fill('#qf-c-company', 'Audit Co');
    await pg.screenshot({ path: shot('raw-contact'), fullPage: true });
    // submit
    await pg.click('#qf-submit-btn');
    await pg.waitForTimeout(2500);
    const thanks = await pg.evaluate(()=>({
      msg: document.getElementById('qf-thanks-msg')?.textContent,
      detail: document.getElementById('qf-thanks-detail')?.textContent,
      viewHref: document.getElementById('qf-view-quote')?.getAttribute('href'),
      viewShown: (()=>{const e=document.getElementById('qf-view-quote'); return e?getComputedStyle(e).display:'?';})(),
      actions: Array.from(document.querySelectorAll('#qf-thanks-actions button, #qf-thanks-actions a')).map(x=>x.textContent.trim()),
      shareBar: Array.from(document.querySelectorAll('.qf-share-emailme,.qf-share-print,.qf-share-panel')).map(x=>x.className),
    }));
    log('[thanks]', JSON.stringify(thanks, null, 1));
    await pg.screenshot({ path: shot('raw-thanks'), fullPage: true });
    // extract refId
    const refId = await pg.evaluate(()=>{ const h=document.getElementById('qf-view-quote')?.getAttribute('href'); const m=h&&h.match(/quote\/([^?#]+)/); return m?decodeURIComponent(m[1]):null; });
    log('[refId]', refId);
    fs.writeFileSync(path.join(SCRATCH,'gap-refId.txt'), refId||'');

    // --- CHAT ---
    log('\n--- chat ---');
    await pg.click('#qf-chat-open-btn').catch(()=>{});
    await pg.waitForTimeout(400);
    const chatVisible = await pg.evaluate(()=>{ const c=document.getElementById('qf-chat'); return c?getComputedStyle(c).display:'?'; });
    log('[chat] panel display=', chatVisible);
    if (chatVisible !== 'none') {
      await pg.fill('#qf-chat-input', 'What is the transit time and can you do liftgate?');
      await pg.click('#qf-chat-send');
      await pg.waitForTimeout(6000);
      const chatMsgs = await pg.evaluate(()=> Array.from(document.querySelectorAll('#qf-chat-msgs > *')).map(x=>({cls:x.className, t:x.textContent.slice(0,140)})));
      log('[chat] msgs=', JSON.stringify(chatMsgs, null, 1));
    }
    await pg.screenshot({ path: shot('raw-chat'), fullPage: true });

    // --- CALLBACK ---
    log('\n--- callback ---');
    await pg.click('#qf-callback-open-btn').catch(()=>{});
    await pg.waitForTimeout(400);
    const cbVisible = await pg.evaluate(()=>{ const c=document.getElementById('qf-callback-form'); return c?getComputedStyle(c).display:'?'; });
    log('[callback] form display=', cbVisible);
    if (cbVisible !== 'none') {
      await pg.fill('#qf-cb-phone', '5625550123');
      await pg.fill('#qf-cb-time', 'Today after 2pm');
      await pg.fill('#qf-cb-topic', 'Confirm liftgate + pickup window');
      await pg.click('#qf-cb-send-btn');
      await pg.waitForTimeout(2500);
      const cbResult = await pg.evaluate(()=>({
        success: (()=>{const e=document.getElementById('qf-cb-success'); return e&&e.style.display!=='none'?e.textContent:null;})(),
        error: (()=>{const e=document.getElementById('qf-cb-error'); return e&&e.style.display!=='none'?e.textContent:null;})(),
      }));
      log('[callback]', JSON.stringify(cbResult));
    }
    await pg.screenshot({ path: shot('raw-callback'), fullPage: true });

    // --- SHARE / PDF / PRINT ---
    log('\n--- share bar ---');
    const shareInfo = await pg.evaluate(()=>{
      const bar = document.getElementById('qf-thanks-actions');
      return {
        links: Array.from(document.querySelectorAll('.qf-share-emailme,.qf-share-print,[class*="share"]')).map(x=>({c:x.className, t:x.textContent.trim().slice(0,40), tag:x.tagName})),
      };
    });
    log('[share] elements=', JSON.stringify(shareInfo, null, 1));

    // Test quote-doc share endpoint + print doc directly via HTTP
    if (refId) {
      const shareResp = await pg.evaluate(async (ref)=>{
        try { const r = await fetch('/api/public/quote-doc/'+encodeURIComponent(ref)+'/share', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({recipients:['friend@example.com']})}); return {status:r.status, body: (await r.text()).slice(0,300)}; }
        catch(e){ return {err:String(e)}; }
      }, refId);
      log('[quote-doc/share POST]', JSON.stringify(shareResp));
    }
  } else {
    log('!! Could not reach a valid result; downstream feature tests skipped. netFail=', netFail.slice(0,5));
  }
  await ctx.close();
}

await b.close();
log('\n=== DONE part1-2 ===');
process.exit(0);
