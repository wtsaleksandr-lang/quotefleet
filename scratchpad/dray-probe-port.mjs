import { chromium } from '@playwright/test';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const log=(...a)=>console.log(...a);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:520,height:920}, deviceScaleFactor:1 });
const page = await ctx.newPage();
const reqs=[];
page.on('request', r => { if(/port|terminal|geocode|autocomplete|places|drayage/i.test(r.url())) reqs.push(r.method()+' '+r.url().slice(0,140)); });
await page.goto(URL,{waitUntil:'networkidle',timeout:60000});
await page.waitForTimeout(1000);
await page.click('#qf-services button[data-service="drayage"]');
await page.waitForTimeout(500);

// Inspect the port input structure
const portStruct = await page.evaluate(()=>{
  const el=document.querySelector('#qf-pickup-port-input');
  const wrap=el?.closest('[class]');
  return { tag:el?.tagName, ph:el?.placeholder, wrapClass:wrap?.className, parentHTML: el?.parentElement?.outerHTML.slice(0,400) };
});
log('PORT STRUCT:', JSON.stringify(portStruct,null,1));

await page.click('#qf-pickup-port-input');
await page.type('#qf-pickup-port-input','Los Angeles',{delay:60});
await page.waitForTimeout(1800);

// Dump everything that appeared
const after = await page.evaluate(()=>{
  const el=document.querySelector('#qf-pickup-port-input');
  // walk siblings / nearby containers
  let container = el;
  for(let i=0;i<5 && container;i++) container=container.parentElement;
  const listish=[...document.querySelectorAll('*')].filter(n=>{
    const r=n.getBoundingClientRect();
    return r.height>0 && r.width>0 && /los angeles|port of|suggest|option|listbox|dropdown|typeahead/i.test((n.innerText||'')+(n.className||'')+(n.getAttribute('role')||'')) && n.children.length<12;
  }).slice(0,10).map(n=>({tag:n.tagName, cls:(n.className||'').toString().slice(0,60), role:n.getAttribute('role'), txt:(n.innerText||'').trim().slice(0,60)}));
  return listish;
});
log('AFTER TYPE, matches:', JSON.stringify(after,null,1));
log('REQUESTS:', JSON.stringify(reqs,null,1));
await page.screenshot({path:'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit/dray-probe-port.png',fullPage:true});
await browser.close();
log('done');
