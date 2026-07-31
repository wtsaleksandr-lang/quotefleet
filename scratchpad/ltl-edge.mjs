import { chromium } from '@playwright/test';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 520, height: 920 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.click('#qf-services button[data-service="ltl"]');
await page.waitForTimeout(400);

// helper to click calc
async function calc(){ const b= await page.$('button.qf-cta:not(.qf-modal-done)'); if(b) await b.click().catch(()=>{}); await page.waitForTimeout(2500); }
async function readResult(){ return await page.evaluate(()=>{ const r=document.querySelector('#qf-result'); const err=document.querySelector('#qf-error'); const rv=r&&getComputedStyle(r).display!=='none'; const ev=err&&getComputedStyle(err).display!=='none'; return { resultVisible:!!rv, resultText: rv? r.innerText.slice(0,300):null, errVisible:!!ev, errText: ev? err.innerText:null }; }); }

// CASE A: empty submit (no ZIPs, no item data - qty defaults 1)
console.log('--- CASE A: empty submit (default qty1, no dims/weight/zips) ---');
await calc();
console.log('A result:', JSON.stringify(await readResult()));
await page.screenshot({ path: `${OUT}/ltl-edge-A-empty-submit.png`, fullPage: true });

// Reload for clean state
await page.goto(URL, { waitUntil:'networkidle' }); await page.waitForTimeout(800);
await page.click('#qf-services button[data-service="ltl"]'); await page.waitForTimeout(400);

// CASE B: weight-only item (qty+weight, NO dimensions), with ZIPs
console.log('--- CASE B: weight-only, no dims ---');
const it = await page.$('#qf-ltl-items .qf-ltl-item');
await (await it.$('.qf-ltl-qty input')).fill('2');
await (await it.$('.qf-ltl-wt input')).fill('1200');
await page.waitForTimeout(300);
const sumB = await page.evaluate(()=>({w:document.querySelector('#qf-ltl-sum-weight')?.textContent,p:document.querySelector('#qf-ltl-sum-pieces')?.textContent,c:document.querySelector('#qf-ltl-sum-class')?.textContent}));
console.log('B summary (no dims):', JSON.stringify(sumB));
await page.fill('#qf-pickup-zip','60601'); await page.waitForTimeout(1300);
let s=await page.$('#qf-pickup-suggestions > *'); if(s) await s.click().catch(()=>{}); await page.waitForTimeout(500);
await page.fill('#qf-delivery-zip','30301'); await page.waitForTimeout(1300);
s=await page.$('#qf-delivery-suggestions > *'); if(s) await s.click().catch(()=>{}); await page.waitForTimeout(500);
await calc();
console.log('B result:', JSON.stringify(await readResult()));
await page.screenshot({ path: `${OUT}/ltl-edge-B-noDims.png`, fullPage: true });

// CASE C: tiny low-density (1 pc 48x40x48, 50 lb) -> should be very high class
await page.goto(URL, { waitUntil:'networkidle' }); await page.waitForTimeout(800);
await page.click('#qf-services button[data-service="ltl"]'); await page.waitForTimeout(400);
const it2 = await page.$('#qf-ltl-items .qf-ltl-item');
await (await it2.$('.qf-ltl-qty input')).fill('1');
const nums = await it2.$$('.qf-ltl-dims .qf-field:not(.qf-ltl-qty):not(.qf-ltl-unit) input');
await nums[0].fill('48'); await nums[1].fill('40'); await nums[2].fill('48');
await (await it2.$('.qf-ltl-wt input')).fill('50');
await page.waitForTimeout(300);
const sumC = await page.evaluate(()=>({w:document.querySelector('#qf-ltl-sum-weight')?.textContent,c:document.querySelector('#qf-ltl-sum-class')?.textContent}));
console.log('C summary (48x40x48, 50lb -> low density):', JSON.stringify(sumC));

// CASE D: negative / weird input - negative length
await it2.$$('.qf-ltl-dims .qf-field:not(.qf-ltl-qty):not(.qf-ltl-unit) input').then(async ns=>{ await ns[0].fill('-10'); });
await page.waitForTimeout(300);
const sumD = await page.evaluate(()=>({c:document.querySelector('#qf-ltl-sum-class')?.textContent,w:document.querySelector('#qf-ltl-sum-weight')?.textContent}));
console.log('D summary (negative length):', JSON.stringify(sumD));

// CASE E: over-legal single dim (700 in)
const it3 = await page.$('#qf-ltl-items .qf-ltl-item');
const nE = await it3.$$('.qf-ltl-dims .qf-field:not(.qf-ltl-qty):not(.qf-ltl-unit) input');
await nE[0].fill('700');
await page.waitForTimeout(300);
const sumE = await page.evaluate(()=>({c:document.querySelector('#qf-ltl-sum-class')?.textContent}));
console.log('E summary (700in length):', JSON.stringify(sumE));

console.log('ERRORS:', errs.slice(0,10).join(' || '));
await browser.close();
