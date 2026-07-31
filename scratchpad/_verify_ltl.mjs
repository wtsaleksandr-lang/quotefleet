import { chromium } from '@playwright/test';
const BASE='http://localhost:8854'; const s=Date.now();
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1400,height:1000}});
const p=await ctx.newPage(); const out={};
try{
  await p.goto(`${BASE}/signup`,{waitUntil:'networkidle'});
  await p.fill('#companyName','LTL QA '+s); await p.fill('#slug-input','ll-'+s);
  await p.fill('#email',`ll+${s}@example.com`); await p.fill('#password-input','SuperSecret123!'); await p.fill('#confirm-password-input','SuperSecret123!');
  const t=await p.$('[data-plan="pro"]'); if(t) await t.click();
  try{await p.selectOption('#countryFocus','US')}catch{}
  await p.check('#dpa-accept');
  await Promise.all([p.waitForNavigation({waitUntil:'networkidle',timeout:20000}).catch(()=>null),p.click('#signup-submit')]);
  await p.waitForTimeout(1200);
  // dismiss wizard overlay if present so we can reach the rates page cleanly
  const skip=await p.$('.qf-ob-skip'); if(skip){ await skip.click(); await p.waitForTimeout(800); }
  await p.goto(`${BASE}/app/rates`,{waitUntil:'networkidle'});
  await p.waitForTimeout(1500);
  out.analysis = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('table.table tbody tr')];
    const res=[];
    for(const tr of rows){
      const svcSel=tr.querySelector('select');
      const svc=svcSel? svcSel.value : null;
      // $/mi input is the cell with data-label "$/mi"
      const cell=[...tr.querySelectorAll('td')].find(td=>td.dataset && td.dataset.label==='$/mi');
      const inp=cell? cell.querySelector('input') : null;
      res.push({svc, rateDisabled: inp? inp.disabled : null, placeholder: inp? inp.placeholder : null});
    }
    return res;
  });
  out.ltlDisabled = out.analysis.filter(r=>r.svc==='ltl').every(r=>r.rateDisabled===true);
  out.nonLtlEnabled = out.analysis.filter(r=>r.svc && r.svc!=='ltl').every(r=>r.rateDisabled===false);
}catch(e){out.FATAL=String(e)} finally{console.log(JSON.stringify(out,null,2));await b.close();}
