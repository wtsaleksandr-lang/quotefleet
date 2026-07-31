// Verify the mobile table-reflow fix on the tenant dashboard at 375px.
// Signs up a fresh tenant (seeds drayage zones), dismisses onboarding, opens the
// Zones page, and checks: (a) no horizontal page overflow, (b) the price input,
// enabled toggle and delete button are all ON-SCREEN (not hidden behind scroll).
import { chromium } from '@playwright/test';
import path from 'node:path';
const BASE='http://localhost:8854', OUT=path.resolve('scratchpad');
const stamp=String(Date.now());
const su=await fetch(BASE+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyName:'DashFix '+stamp,email:`dashfix+${stamp}@example.com`,password:'ReproTest!2345',countryFocus:'US',dpaAccepted:true,dpaVersion:'1.0'})});
if(su.status>=400){console.log('signup failed',su.status,await su.text());process.exit(1);}
const cookies=(su.headers.getSetCookie?.()||[]).map(c=>{const p=c.split(';')[0];const i=p.indexOf('=');return{name:p.slice(0,i),value:p.slice(i+1),url:BASE};});

const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:375,height:812}});
await ctx.addCookies(cookies);
const p=await ctx.newPage();
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});

await p.goto(BASE+'/app',{waitUntil:'networkidle'});
await p.waitForTimeout(2000);
// dismiss onboarding wizard if present
const skip=p.locator('#qf-ob-overlay .qf-ob-skip');
if(await skip.count()){await skip.click();await p.waitForTimeout(1500);}

async function checkRoute(hash, tag, mustSee){
  await p.goto(BASE+'/app'+hash,{waitUntil:'networkidle'});
  await p.waitForTimeout(1800);
  const m=await p.evaluate((sels)=>{
    const se=document.scrollingElement;
    const overflow=se.scrollWidth-se.clientWidth;
    const vis=(el)=>{ if(!el)return null; const r=el.getBoundingClientRect();
      return {onscreen: r.left>=-1 && r.right<=window.innerWidth+1 && r.width>0, right:Math.round(r.right)}; };
    const out={};
    for(const [k,s] of Object.entries(sels)){ out[k]=vis(document.querySelector(s)); }
    return {overflow, innerWidth:window.innerWidth, out};
  }, mustSee);
  await p.screenshot({path:path.join(OUT,`dashfix-${tag}.png`),fullPage:true});
  console.log(`\n[${tag}]  page h-overflow=${m.overflow}px (0 = good)`);
  for(const [k,v] of Object.entries(m.out)){
    console.log(`   ${k}: ${v? (v.onscreen?'ON-SCREEN ✓':`OFF-SCREEN ✗ (right=${v.right} > ${m.innerWidth})`) : 'not found'}`);
  }
  return m;
}

// Zones page has seed data → the real proof.
await checkRoute('/zones','zones',{
  priceInput:'.qf-zones-table tbody tr td[data-label="Flat $"] input',
  enabledToggle:'.qf-zones-table tbody tr td[data-label="Enabled"] input',
  deleteBtn:'.qf-zones-table tbody tr td:last-child .btn',
});
// Overview recent-leads is empty on a fresh tenant, but confirm the class is applied.
await checkRoute('','overview',{ recentLeadsTable:'.qf-kpi-section' });

console.log('\nconsole errors:', errs.length?errs.slice(0,5):'none');
await b.close();
