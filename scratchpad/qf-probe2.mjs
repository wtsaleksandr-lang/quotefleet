import { chromium } from '@playwright/test';
const URL='http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT='C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:520,height:920}});
await p.goto(URL,{waitUntil:'networkidle'}); await p.waitForTimeout(1300);
await (await p.$('#qf-services button[data-service="ftl"]')).click(); await p.waitForTimeout(400);
await p.$eval('#qf-weight',e=>e.value='38000');
const pk=await p.$('#qf-pickup-zip'); await pk.click(); await pk.type('Los Angeles, CA',{delay:60});
await p.waitForTimeout(1900);
const dd=await p.evaluate(()=>{
  const cands=[...document.querySelectorAll('ul,ol,[role="listbox"],[class*="typeahead"],[class*="suggest"],[class*="autocomplete"],[class*="pac"],[class*="dropdown"],[class*="menu"]')];
  return cands.filter(e=>e.offsetParent!==null && e.textContent.trim().length>0).slice(0,10).map(e=>({tag:e.tagName,cls:(e.className||'').toString().slice(0,70),id:e.id,txt:e.textContent.trim().slice(0,90),kids:e.children.length}));
});
console.log('DROPDOWN:', JSON.stringify(dd,null,2));
await p.screenshot({path:`${OUT}/otr-probe-typeahead.png`});
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
console.log('pickup value after kbd:', await p.$eval('#qf-pickup-zip',e=>e.value));
await b.close();
