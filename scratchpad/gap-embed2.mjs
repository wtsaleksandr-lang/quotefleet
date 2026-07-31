import { chromium } from '@playwright/test';
import path from 'node:path';
const SCRATCH='C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad';
const BASE='http://localhost:8854';
const shot=(n)=>path.join(SCRATCH,`gap-${n}.png`);
const log=(...a)=>console.log(...a);
const b=await chromium.launch();

const ctx=await b.newContext({viewport:{width:1000,height:1600}});
const pg=await ctx.newPage();
// Real customer host page: hostile CSS + embed.js EXACT listener + catch-all logger.
// Use raw=1 so the bare widget loads (demo slug quirk: ?embed=1 alone -> shell).
const host = `<!doctype html><html><head><style>
  *{box-sizing:content-box;} body{margin:0;background:#fff;font-family:Georgia;}
  button{color:red!important;font-size:30px!important;background:yellow!important;}
  input,select{border:5px dashed green!important;}
</style></head><body>
<h1>Acme Shipper — Get a Freight Quote</h1>
<div id="host-mount"></div>
<script>
  window.__msgs=[]; window.__embedFired=0; window.__heightMsgs=0;
  var ifr=document.createElement('iframe');
  ifr.id='qf-embed-frame';
  ifr.src=${JSON.stringify(BASE+'/w/demo?raw=1&embed=1')};
  ifr.style.cssText='width:100%;max-width:560px;border:0;display:block;min-height:660px;';
  document.getElementById('host-mount').appendChild(ifr);
  window.addEventListener('message', function(e){
    if(!e||!e.data) return;
    var s = typeof e.data==='object'? JSON.stringify(e.data).slice(0,90): String(e.data).slice(0,90);
    window.__msgs.push(s);
    if(e.data && e.data.type==='QF_WIDGET_HEIGHT') window.__heightMsgs++;
    // EXACT embed.js resize handling:
    if(e.data.qf==='resize' && e.data.slug==='demo'){ window.__embedFired++; if(typeof e.data.h==='number') ifr.style.height=e.data.h+'px'; }
  });
</script></body></html>`;
await pg.setContent(host,{waitUntil:'networkidle'});
await pg.waitForTimeout(2500);
const frame = pg.frames().find(f=>f.url().includes('/w/demo'));
const init = await pg.evaluate(()=>({ h:document.getElementById('qf-embed-frame').style.height, offsetH:document.getElementById('qf-embed-frame').offsetHeight, msgs:window.__msgs.slice(0,6), heightMsgs:window.__heightMsgs, embedFired:window.__embedFired }));
log('[init] iframe style.height='+init.h+' offsetHeight='+init.offsetH);
log('[init] messages from widget=', JSON.stringify(init.msgs));
log('[init] QF_WIDGET_HEIGHT msgs='+init.heightMsgs+'  embed.js-shape(qf:resize) fired='+init.embedFired);
const iso = frame ? await frame.evaluate(()=>{const c=document.getElementById('qf-calc-btn'); if(!c)return 'no-cta'; const s=getComputedStyle(c); return {color:s.color,bg:s.backgroundColor,fontSize:s.fontSize};}) : 'no-frame';
log('[isolation] widget CTA computed (host forced red/yellow/30px):', JSON.stringify(iso));

// Drive quote inside to expand content
if (frame) {
  await frame.evaluate(()=>{const t=document.querySelectorAll('#qf-services button');if(t[0])t[0].click();});
  await frame.evaluate(()=>{const eq=document.getElementById('qf-equipment');if(eq&&eq.options.length>1){eq.selectedIndex=1;eq.dispatchEvent(new Event('change',{bubbles:true}));}});
  await frame.fill('#qf-weight','24000');
  async function pick(id,sug,txt){await frame.click(`#${id}`);await frame.fill(`#${id}`,txt);await frame.waitForTimeout(1100);await frame.evaluate((s)=>{const c=document.getElementById(s);const el=c&&(c.querySelector('.qf-suggestion')||c.firstElementChild);if(el)el.click();},sug);}
  await pick('qf-pickup-zip','qf-pickup-suggestions','90802');await frame.waitForTimeout(300);
  await pick('qf-delivery-zip','qf-delivery-suggestions','85001');await frame.waitForTimeout(300);
  await frame.click('#qf-calc-btn'); await frame.waitForTimeout(2800);
  const total = await frame.evaluate(()=>document.getElementById('qf-total')?.textContent);
  const innerH = await frame.evaluate(()=>{const r=document.getElementById('qf-root'); return r?Math.ceil(r.getBoundingClientRect().height):document.body.scrollHeight;});
  const after = await pg.evaluate(()=>({ h:document.getElementById('qf-embed-frame').style.height, offsetH:document.getElementById('qf-embed-frame').offsetHeight, heightMsgs:window.__heightMsgs, embedFired:window.__embedFired }));
  log('\n[after quote] total='+total+' innerContentHeight='+innerH+'px');
  log('[after quote] iframe style.height='+after.h+' offsetHeight='+after.offsetH);
  log('[after quote] QF_WIDGET_HEIGHT msgs='+after.heightMsgs+'  embed.js(qf:resize) fired='+after.embedFired);
  log('[VERDICT] widget content '+innerH+'px vs iframe '+after.offsetH+'px -> '+(innerH>after.offsetH+40?'CLIPPED (embed.js auto-resize NOT working)':'fits'));
  await pg.screenshot({ path: shot('embed-host'), fullPage:true });
}
await ctx.close();
await b.close();
process.exit(0);
