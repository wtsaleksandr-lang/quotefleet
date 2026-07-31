import { chromium } from '@playwright/test';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:520,height:920}, deviceScaleFactor:1 });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil:'networkidle' });
await page.waitForTimeout(2000);

const dump = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input,select,textarea')).map(e=>({
    tag:e.tagName, type:e.type, id:e.id, name:e.name, placeholder:e.placeholder, aria:e.getAttribute('aria-label')
  }));
  const buttons = Array.from(document.querySelectorAll('button,[role=button]')).map(e=>({
    id:e.id, cls:(e.className||'').toString().slice(0,60), txt:(e.innerText||'').trim().slice(0,40), aria:e.getAttribute('aria-label')
  }));
  return { inputs, buttons };
});
console.log('INPUTS', JSON.stringify(dump.inputs,null,1));
console.log('BUTTONS', JSON.stringify(dump.buttons,null,1));

// open options modal
const sum = await page.$('#qf-options-summary');
if (sum) { await sum.click(); await page.waitForTimeout(800); }
const modal = await page.evaluate(() => {
  const m = document.querySelector('#qf-options-modal');
  if(!m) return {found:false};
  return { found:true, text:m.innerText, chips:Array.from(m.querySelectorAll('.qf-acc-chip')).map(c=>c.innerText.trim()) };
});
console.log('MODAL', JSON.stringify(modal,null,1));
await browser.close();
