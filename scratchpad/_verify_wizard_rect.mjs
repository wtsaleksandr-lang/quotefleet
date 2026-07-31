import { chromium } from '@playwright/test';
const BASE='http://localhost:8854';
const s=Date.now();
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:900}});
const p=await ctx.newPage();
const out={};
try{
  await p.goto(`${BASE}/signup`,{waitUntil:'networkidle'});
  await p.fill('#companyName','Rect QA '+s);
  await p.fill('#slug-input','rq-'+s);
  await p.fill('#email',`rq+${s}@example.com`);
  await p.fill('#password-input','SuperSecret123!');
  await p.fill('#confirm-password-input','SuperSecret123!');
  const t=await p.$('[data-plan="pro"]'); if(t) await t.click();
  try{await p.selectOption('#countryFocus','US')}catch{}
  await p.check('#dpa-accept');
  await Promise.all([p.waitForNavigation({waitUntil:'networkidle',timeout:20000}).catch(()=>null),p.click('#signup-submit')]);
  await p.waitForTimeout(1500);
  if(!p.url().includes('/app')) await p.goto(`${BASE}/app`,{waitUntil:'networkidle'});
  await p.waitForTimeout(1800);
  out.wizardShown = !!(await p.$('#qf-ob-overlay'));
  // VIEWPORT (non-fullPage) capture — what a real user actually sees
  await p.screenshot({path:'scratchpad/wizard-viewport.png'});
  // sample the bottom-left pixel region for navy vs page-bg by reading overlay bg + body scroll
  out.overlayCoversViewport = await p.evaluate(()=>{
    const o=document.getElementById('qf-ob-overlay'); if(!o) return null;
    const r=o.getBoundingClientRect();
    const cs=getComputedStyle(o);
    return {top:r.top,left:r.left,w:r.width,h:r.height,pos:cs.position,bg:cs.backgroundColor,z:cs.zIndex,vw:innerWidth,vh:innerHeight};
  });
  out.bodyScrollHeight = await p.evaluate(()=>({scrollH:document.body.scrollHeight,innerH:innerHeight}));
}catch(e){out.FATAL=String(e)}
finally{console.log(JSON.stringify(out,null,2));await b.close();}
