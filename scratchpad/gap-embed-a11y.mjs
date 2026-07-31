import { chromium } from '@playwright/test';
import path from 'node:path';
const SCRATCH='C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad';
const BASE='http://localhost:8854';
const shot=(n)=>path.join(SCRATCH,`gap-${n}.png`);
const log=(...a)=>console.log(...a);
const b=await chromium.launch();

// ================= EMBED auto-resize + isolation =================
log('=== EMBED (third-party host page, embed.js-style resize listener) ===');
{
  const ctx=await b.newContext({viewport:{width:1000,height:1400}});
  const pg=await ctx.newPage();
  // Host page mimics a real customer's site: hostile global CSS + the EXACT
  // embed.js resize listener (qf==='resize' + slug) AND a catch-all logger.
  const host = `<!doctype html><html><head><style>
    *{box-sizing:content-box;} body{margin:0;background:#fff;font-family:Georgia;}
    /* hostile leakage attempt */
    button{color:red!important;font-size:30px!important;background:yellow!important;}
    input,select{border:5px dashed green!important;}
    .qf-cta{color:red!important;}
    h1{color:#333}
  </style></head><body>
  <h1>Acme Shipper — Get a Freight Quote</h1>
  <div id="host-mount"></div>
  <script>
    window.__msgs=[]; window.__embedFired=0;
    var ifr=document.createElement('iframe');
    ifr.id='qf-embed-frame';
    ifr.src=${JSON.stringify(BASE+'/w/demo?embed=1')};
    ifr.style.cssText='width:100%;max-width:560px;border:0;display:block;min-height:660px;';
    document.getElementById('host-mount').appendChild(ifr);
    // EXACT embed.js listener shape:
    window.addEventListener('message', function(e){
      if(!e||!e.data) return;
      window.__msgs.push(typeof e.data==='object'? JSON.stringify(e.data).slice(0,80): String(e.data).slice(0,80));
      if(e.data.qf==='resize' && e.data.slug==='demo'){ window.__embedFired++; if(typeof e.data.h==='number') ifr.style.height=e.data.h+'px'; }
    });
  </script></body></html>`;
  await pg.setContent(host,{waitUntil:'networkidle'});
  await pg.waitForTimeout(3000);
  const frame = pg.frames().find(f=>f.url().includes('/w/demo'));
  const before = await pg.evaluate(()=>({ h: document.getElementById('qf-embed-frame').style.height, offsetH: document.getElementById('qf-embed-frame').offsetHeight, msgs: window.__msgs.slice(0,8), embedFired: window.__embedFired }));
  log('[embed initial] iframe.style.height=', before.h, 'offsetHeight=', before.offsetH);
  log('[embed initial] messages received=', JSON.stringify(before.msgs));
  log('[embed initial] embed.js-style listener fired count=', before.embedFired);
  // Style isolation: check widget button color inside iframe (should NOT be red/yellow from host)
  let iso='?';
  if (frame) {
    iso = await frame.evaluate(()=>{
      const cta=document.getElementById('qf-calc-btn'); if(!cta) return 'no-cta';
      const cs=getComputedStyle(cta); return { color:cs.color, bg:cs.backgroundColor, fontSize:cs.fontSize };
    });
  }
  log('[embed isolation] widget CTA computed (host tried red/yellow/30px):', JSON.stringify(iso));
  // Drive a quote INSIDE the embed to expand content, then re-check height growth
  if (frame) {
    await frame.evaluate(()=>{const t=document.querySelectorAll('#qf-services button');if(t[0])t[0].click();});
    await frame.evaluate(()=>{const eq=document.getElementById('qf-equipment');if(eq&&eq.options.length>1){eq.selectedIndex=1;eq.dispatchEvent(new Event('change',{bubbles:true}));}});
    await frame.fill('#qf-weight','24000');
    async function pick(id,sug,txt){await frame.click(`#${id}`);await frame.fill(`#${id}`,txt);await frame.waitForTimeout(1100);await frame.evaluate((s)=>{const c=document.getElementById(s);const el=c&&(c.querySelector('.qf-suggestion')||c.firstElementChild);if(el)el.click();},sug);}
    await pick('qf-pickup-zip','qf-pickup-suggestions','90802');await frame.waitForTimeout(300);
    await pick('qf-delivery-zip','qf-delivery-suggestions','85001');await frame.waitForTimeout(300);
    await frame.click('#qf-calc-btn'); await frame.waitForTimeout(2800);
    const qOk = await frame.evaluate(()=>document.getElementById('qf-total')?.textContent);
    log('[embed quote inside] total=', qOk);
    const after = await pg.evaluate(()=>({ h: document.getElementById('qf-embed-frame').style.height, offsetH: document.getElementById('qf-embed-frame').offsetHeight, contentScroll: 0, embedFired: window.__embedFired, msgCount: window.__msgs.length, lastMsgs: window.__msgs.slice(-4) }));
    const innerContentH = await frame.evaluate(()=>document.getElementById('qf-root')?.scrollHeight || document.body.scrollHeight);
    log('[embed after quote] iframe.style.height=', after.h, 'offsetHeight=', after.offsetH, 'inner content height=', innerContentH);
    log('[embed after quote] embed.js listener fired=', after.embedFired, 'total msgs=', after.msgCount, 'lastMsgs=', JSON.stringify(after.lastMsgs));
    log('[embed VERDICT] content='+innerContentH+'px but iframe height='+after.offsetH+'px -> '+(innerContentH>after.offsetH+40?'CLIPPED / needs scroll (auto-resize FAILED)':'fits OK'));
    await pg.screenshot({ path: shot('embed-host'), fullPage:true });
  }
  await ctx.close();
}

// ================= A11Y: keyboard + modal =================
log('\n=== A11Y: keyboard tab order + focus + modal ===');
{
  const ctx=await b.newContext({viewport:{width:900,height:1200}});
  const pg=await ctx.newPage();
  await pg.goto(`${BASE}/w/demo?raw=1`,{waitUntil:'networkidle'});
  await pg.waitForTimeout(800);
  // ARIA of tabs + toggle + help
  const aria = await pg.evaluate(()=>{
    const tabs=Array.from(document.querySelectorAll('#qf-services button')).map(t=>({txt:t.textContent.trim(), role:t.getAttribute('role'), sel:t.getAttribute('aria-selected'), pressed:t.getAttribute('aria-pressed')}));
    const wtWrap=document.getElementById('qf-wt-unit');
    const wt=Array.from(wtWrap?.querySelectorAll('button')||[]).map(x=>({t:x.textContent,pressed:x.getAttribute('aria-pressed')}));
    const help=document.querySelector('.qf-help');
    const optBtn=document.getElementById('qf-options-summary');
    return { servicesRole: document.getElementById('qf-services')?.getAttribute('role'), tabs, weightToggle: wt,
      help: help?{role:help.getAttribute('role'),tabindex:help.getAttribute('tabindex'),label:help.getAttribute('aria-label')}:null,
      optionsBtn: optBtn?{haspopup:optBtn.getAttribute('aria-haspopup'),expanded:optBtn.getAttribute('aria-expanded')}:null };
  });
  log('[aria]', JSON.stringify(aria,null,1));
  // Keyboard tab-through: press Tab N times, record focused element + whether focus-visible ring exists
  const order=[];
  for (let i=0;i<14;i++){
    await pg.keyboard.press('Tab');
    const f=await pg.evaluate(()=>{const a=document.activeElement; if(!a)return null; const cs=getComputedStyle(a);
      return { id:a.id||null, cls:(a.className||'').toString().slice(0,30), tag:a.tagName, txt:(a.textContent||'').trim().slice(0,20),
        outline: cs.outlineStyle+' '+cs.outlineWidth, boxShadow: cs.boxShadow!=='none' };});
    order.push(f);
  }
  log('[tab order]', JSON.stringify(order,null,1));
  // Open options modal via keyboard (focus the options button then Enter)
  await pg.evaluate(()=>document.getElementById('qf-options-summary')?.focus());
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(500);
  const modal = await pg.evaluate(()=>{
    const m=document.getElementById('qf-options-modal');
    const card=m?.querySelector('.qf-modal-card');
    return { modalHidden:m?.hasAttribute('hidden'), display:m?getComputedStyle(m).display:'?', ariaModal:card?.getAttribute('aria-modal'), role:card?.getAttribute('role'), focusInside: m?m.contains(document.activeElement):false, activeEl:document.activeElement?.id||document.activeElement?.className };
  });
  log('[modal opened]', JSON.stringify(modal));
  // Esc to close + focus return
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(400);
  const afterEsc = await pg.evaluate(()=>{
    const m=document.getElementById('qf-options-modal');
    return { modalHidden:m?.hasAttribute('hidden'), display:m?getComputedStyle(m).display:'?', focusReturnedTo:document.activeElement?.id||document.activeElement?.className };
  });
  log('[modal after Esc]', JSON.stringify(afterEsc));
  await ctx.close();
}

await b.close();
log('\n=== DONE ===');
process.exit(0);
