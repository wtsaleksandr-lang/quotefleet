import { chromium } from '@playwright/test';
const BASE='http://localhost:8854'; const s=Date.now();
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:900}});
const p=await ctx.newPage(); const out={};
try{
  await p.goto(`${BASE}/signup`,{waitUntil:'networkidle'});
  await p.fill('#companyName','Lock QA '+s); await p.fill('#slug-input','lk-'+s);
  await p.fill('#email',`lk+${s}@example.com`); await p.fill('#password-input','SuperSecret123!'); await p.fill('#confirm-password-input','SuperSecret123!');
  const t=await p.$('[data-plan="pro"]'); if(t) await t.click();
  try{await p.selectOption('#countryFocus','US')}catch{}
  await p.check('#dpa-accept');
  await Promise.all([p.waitForNavigation({waitUntil:'networkidle',timeout:20000}).catch(()=>null),p.click('#signup-submit')]);
  await p.waitForTimeout(1500);
  if(!p.url().includes('/app')) await p.goto(`${BASE}/app`,{waitUntil:'networkidle'});
  await p.waitForTimeout(1800);
  out.wizardShown=!!(await p.$('#qf-ob-overlay'));
  out.hasLockClass=await p.evaluate(()=>document.documentElement.classList.contains('qf-ob-open'));
  out.bodyOverflow=await p.evaluate(()=>getComputedStyle(document.body).overflow);
  // try to scroll the page down; with lock it should stay at 0
  await p.evaluate(()=>window.scrollTo(0,500));
  await p.waitForTimeout(200);
  out.scrollYAfter=await p.evaluate(()=>window.scrollY);
  await p.screenshot({path:'scratchpad/wizard-locked-full.png',fullPage:true});
}catch(e){out.FATAL=String(e)} finally{console.log(JSON.stringify(out,null,2));await b.close();}
