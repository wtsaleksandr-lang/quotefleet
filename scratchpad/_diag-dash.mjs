import { chromium } from '@playwright/test';
const BASE='http://localhost:8854'; const s=Date.now().toString(36);
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:300}});
await ctx.request.post(`${BASE}/api/auth/signup`,{data:{companyName:'Diag '+s,slug:'diag-'+s,email:`d+${s}@ex.com`,password:'GrabScroll123!',plan:'vital',countryFocus:'US',dpaAccepted:true,dpaVersion:'1.0'}});
const pg=await ctx.newPage(); await pg.goto(`${BASE}/app`,{waitUntil:'networkidle'}); await pg.waitForTimeout(1500);
await pg.evaluate(()=>{document.querySelectorAll('[class*="onboarding"]').forEach(n=>{if(n.style)n.style.display='none'}); document.documentElement.classList.remove('qf-ob-open');});
await pg.waitForTimeout(400);
const info=await pg.evaluate(()=>{
  const h=document.querySelector('.app-main h1');
  const r=h?h.getBoundingClientRect():null;
  const pt = r? document.elementFromPoint(r.x+Math.min(r.width/2,120), r.y+r.height/2):null;
  // walk ancestors for scrollable
  let chain=[]; let n=pt;
  while(n && n!==document.body){ const cs=getComputedStyle(n); const sc=(cs.overflowY==='auto'||cs.overflowY==='scroll')&&n.scrollHeight>n.clientHeight+1; chain.push((n.tagName+'.'+(n.className||'')).slice(0,40)+(sc?' [SCROLLABLE]':'')); n=n.parentElement; }
  return { h1exists:!!h, r, elAtPoint: pt?(pt.tagName+'.'+pt.className).slice(0,60):null, chain, maxTop: document.scrollingElement.scrollHeight-innerHeight, appMainCursor: getComputedStyle(document.querySelector('.app-main')).cursor };
});
console.log(JSON.stringify(info,null,2));
// now do a manual drag and check engagement
const r=info.r; const x=r.x+Math.min(r.width/2,120), y=r.y+r.height/2;
await pg.mouse.move(x,y); await pg.mouse.down();
await pg.mouse.move(x, y-20); 
const engagedEarly=await pg.evaluate(()=>document.documentElement.classList.contains('qf-grabbing'));
await pg.mouse.move(x, y-200);
const sy=await pg.evaluate(()=>window.scrollY);
await pg.mouse.up();
console.log('engagedAfter20px=',engagedEarly,'scrollYduring=',sy);
await b.close();
