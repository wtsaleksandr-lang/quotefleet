import { chromium } from '@playwright/test';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const MODES = ['ftl','expedited','hotshot'];
const VPS = { desk:{width:520,height:920}, mob:{width:375,height:800} };
const WEIGHT = { ftl:'38000', expedited:'2500', hotshot:'12000' };

async function addr(p, sel, txt) {
  const el = await p.$(sel); if(!el) return 'no-el';
  await el.click(); await el.fill(''); await el.type(txt,{delay:50});
  await p.waitForTimeout(1600);
  const s = await p.$('.qf-typeahead-item, .qf-suggestion, [role="option"], .pac-item, li[data-idx]');
  if(s){ await s.click(); await p.waitForTimeout(600); return 'picked'; }
  return 'no-suggestion';
}

const b = await chromium.launch();
const log=[];
for(const [vn,vp] of Object.entries(VPS)){
  const p = await b.newPage({viewport:vp});
  for(const mode of MODES){
    await p.goto(URL,{waitUntil:'networkidle'}); await p.waitForTimeout(1300);
    const tag=`${mode}-${vn}`; const rec={tag};
    await (await p.$(`#qf-services button[data-service="${mode}"]`)).click();
    await p.waitForTimeout(500);
    const w=await p.$('#qf-weight'); if(w) await w.fill(WEIGHT[mode]);
    rec.pickup=await addr(p,'#qf-pickup-zip','Los Angeles, CA');
    rec.delivery=await addr(p,'#qf-delivery-zip','Phoenix, AZ');
    await p.waitForTimeout(500);
    // click Get instant quote
    const qh = await p.evaluateHandle(()=>[...document.querySelectorAll('button,a')].find(b=>/instant quote|get quote|calculate|see price/i.test(b.textContent||'')));
    const qb=qh.asElement();
    if(qb){ rec.btn=await qb.evaluate(e=>e.textContent.trim()); await qb.scrollIntoViewIfNeeded(); await qb.click(); await p.waitForTimeout(3000);}
    else rec.btn='NOT FOUND';
    const r=await p.$('#qf-result');
    if(r){ rec.result=(await r.evaluate(e=>e.innerText)).replace(/\s+/g,' ').slice(0,500); await r.scrollIntoViewIfNeeded(); }
    // screenshot just the result region and full
    await p.waitForTimeout(400);
    await p.screenshot({path:`${OUT}/otr-${tag}-QUOTE.png`, fullPage:true});
    // check any visible error
    rec.error = await p.$eval('#qf-error', e=> (e.offsetParent!==null? e.innerText.trim():'')).catch(()=>'');
    log.push(rec);
  }
  await p.close();
}
await b.close();
console.log(JSON.stringify(log,null,2));
