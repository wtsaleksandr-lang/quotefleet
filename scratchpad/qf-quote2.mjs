import { chromium } from '@playwright/test';
const URL='http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT='C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const MODES=['ftl','expedited','hotshot'];
const VPS={desk:{width:520,height:920},mob:{width:375,height:800}};
const WEIGHT={ftl:'38000',expedited:'2500',hotshot:'12000'};
async function addr(p,sel,txt){
  const el=await p.$(sel); await el.click(); await el.fill(''); await el.type(txt,{delay:55});
  await p.waitForTimeout(1700);
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(250); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  return await p.$eval(sel,e=>e.value);
}
const b=await chromium.launch();
const log=[];
for(const [vn,vp] of Object.entries(VPS)){
  const p=await b.newPage({viewport:vp});
  for(const mode of MODES){
    await p.goto(URL,{waitUntil:'networkidle'}); await p.waitForTimeout(1200);
    const tag=`${mode}-${vn}`; const rec={tag};
    await (await p.$(`#qf-services button[data-service="${mode}"]`)).click(); await p.waitForTimeout(400);
    await p.$eval('#qf-weight',(e,w)=>e.value=w, WEIGHT[mode]);
    rec.pickup=await addr(p,'#qf-pickup-zip','Los Angeles, CA');
    rec.delivery=await addr(p,'#qf-delivery-zip','Phoenix, AZ');
    await p.waitForTimeout(400);
    const qh=await p.evaluateHandle(()=>[...document.querySelectorAll('button,a')].find(b=>/instant quote|get quote|calculate/i.test(b.textContent||'')));
    const qb=qh.asElement();
    rec.btn=qb?await qb.evaluate(e=>e.textContent.trim()):'NONE';
    if(qb){ await qb.click({force:true}); await p.waitForTimeout(3200); }
    rec.resultVisible=await p.$eval('#qf-result',e=>e.offsetParent!==null).catch(()=>false);
    rec.resultText=await p.$eval('#qf-result',e=>e.offsetParent!==null?e.innerText.replace(/\s+/g,' ').slice(0,300):'(hidden)').catch(()=>'(none)');
    rec.errorVisible=await p.$eval('#qf-error',e=>e.offsetParent!==null?e.innerText.trim():'').catch(()=>'');
    await p.screenshot({path:`${OUT}/otr-${tag}-QUOTE.png`,fullPage:true});
    log.push(rec);
  }
  await p.close();
}
await b.close();
console.log(JSON.stringify(log,null,2));
