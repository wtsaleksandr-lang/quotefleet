import { chromium } from '@playwright/test';
const BASE='http://localhost:8854';
const stamp=String(Date.now());
const su=await fetch(BASE+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyName:'BareCheck '+stamp,email:`bare${stamp}@example.com`,password:'ReproTest!2345',countryFocus:'CA',dpaAccepted:true,dpaVersion:'1.0'})});
const t=(await su.json()).tenant;
const lead=await (await fetch(`${BASE}/api/public/lead/${t.slug}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service:'ftl',equipment:'dryvan',weightLbs:25000,pickup:{zip:'M5V',country:'CA'},delivery:{zip:'V6B',country:'CA'},customerName:'B',customerEmail:'b@example.com'})})).json();
console.log('refId',lead.refId);
const doc=await (await fetch(`${BASE}/api/public/quote-doc/${lead.refId}`)).json();
console.log('payload quote.currency =', JSON.stringify(doc.quote?.currency));
console.log('accessorial sample =', JSON.stringify((doc.possibleAccessorials||[]).slice(0,2)));
const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:900,height:1000}})).newPage();
await p.goto(BASE+'/quote/'+lead.refId,{waitUntil:'networkidle'});await p.waitForTimeout(2000);
const bare=await p.evaluate(()=>{
  const out=[];
  const rx=/(?<!CA|US)\$\s?[\d,]+\.\d{2}/;
  for(const el of document.querySelectorAll('*')){
    if(el.children.length) continue;
    const tx=(el.textContent||'').trim();
    if(rx.test(tx)) out.push({tag:el.tagName,id:el.id||null,cls:el.className||null,txt:tx.slice(0,40)});
  }
  return out.slice(0,12);
});
console.log('BARE-$ ELEMENTS:'); bare.forEach(x=>console.log(' ',JSON.stringify(x)));
await b.close();
