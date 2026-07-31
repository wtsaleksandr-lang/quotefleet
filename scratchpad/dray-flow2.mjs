import { chromium } from '@playwright/test';
const OUT='C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const URL='http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const log=(...a)=>console.log(...a);

async function run(width,height,tag){
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:2});
  const page=await ctx.newPage();
  const errors=[];
  page.on('console',m=>{if(m.type()==='error')errors.push('C:'+m.text().slice(0,160));});
  page.on('pageerror',e=>errors.push('P:'+e.message.slice(0,160)));
  await page.goto(URL,{waitUntil:'networkidle',timeout:60000});
  await page.waitForTimeout(1200);
  log(`\n===== ${tag} (${width}x${height}) =====`);
  await page.click('#qf-services button[data-service="drayage"]');
  await page.waitForTimeout(500);

  // Port
  await page.click('#qf-pickup-port-input');
  await page.type('#qf-pickup-port-input','Los Angeles',{delay:50});
  await page.waitForTimeout(1200);
  await page.screenshot({path:`${OUT}/dray-${tag}-04-port-suggestions.png`,fullPage:true});
  const portSugg=await page.$$eval('#qf-pickup-port-suggestions .qf-suggestion',ss=>ss.map(s=>s.innerText.replace(/\n+/g,' / ').trim()));
  log('PORT SUGG:',JSON.stringify(portSugg));
  await page.click('#qf-pickup-port-suggestions .qf-suggestion');
  await page.waitForTimeout(700);
  await page.screenshot({path:`${OUT}/dray-${tag}-05-port-chosen.png`,fullPage:true});

  // Terminal
  const termPh=await page.$eval('#qf-pickup-terminal-search',el=>el.placeholder).catch(e=>'ERR');
  log('TERM ph after port:',termPh);
  await page.click('#qf-pickup-terminal-search');
  await page.type('#qf-pickup-terminal-search','a',{delay:50});
  await page.waitForTimeout(1000);
  await page.screenshot({path:`${OUT}/dray-${tag}-06-terminal-suggestions.png`,fullPage:true});
  const termSugg=await page.evaluate(()=>{
    const items=[...document.querySelectorAll('.qf-suggestion,.qf-terminal-suggestion,[class*="terminal"] li,[class*="suggestion"]')].filter(i=>i.getBoundingClientRect().height>0&&i.innerText.trim());
    return items.slice(0,14).map(i=>({t:i.innerText.replace(/\n+/g,' / ').trim().slice(0,90),overflow:i.scrollWidth>i.clientWidth+1}));
  });
  log('TERM SUGG:',JSON.stringify(termSugg,null,0));
  // click a terminal (prefer a long-named one)
  const termPick=await page.evaluate(()=>{
    const items=[...document.querySelectorAll('.qf-suggestion,.qf-terminal-suggestion')].filter(i=>i.getBoundingClientRect().height>0&&i.innerText.trim());
    const longest=items.sort((a,b)=>b.innerText.length-a.innerText.length)[0];
    if(longest){longest.click();return longest.innerText.replace(/\n+/g,' / ').trim().slice(0,90);}return null;
  });
  log('TERM PICKED:',termPick);
  await page.waitForTimeout(600);
  await page.screenshot({path:`${OUT}/dray-${tag}-07-terminal-chosen.png`,fullPage:true});
  const termVal=await page.evaluate(()=>{
    const el=document.querySelector('#qf-pickup-terminal-search');
    return {val:el?.value, overflow: el?el.scrollWidth>el.clientWidth+1:null};
  });
  log('TERM VAL:',JSON.stringify(termVal));

  // Delivery
  await page.click('#qf-delivery-zip');
  await page.type('#qf-delivery-zip','90802',{delay:50});
  await page.waitForTimeout(1000);
  const delSugg=await page.$$eval('.qf-suggestion',ss=>ss.filter(s=>s.getBoundingClientRect().height>0).map(s=>s.innerText.replace(/\n+/g,' / ').trim().slice(0,50)));
  log('DEL SUGG:',JSON.stringify(delSugg));
  await page.evaluate(()=>{const s=[...document.querySelectorAll('.qf-suggestion')].filter(x=>x.getBoundingClientRect().height>0);if(s[0])s[0].click();});
  await page.waitForTimeout(500);
  await page.screenshot({path:`${OUT}/dray-${tag}-08-delivery.png`,fullPage:true});

  // Weight
  await page.fill('#qf-weight','38000').catch(()=>{});
  await page.waitForTimeout(300);
  await page.screenshot({path:`${OUT}/dray-${tag}-08b-filled.png`,fullPage:true});

  // Options modal
  await page.click('#qf-options-summary');
  await page.waitForTimeout(600);
  await page.screenshot({path:`${OUT}/dray-${tag}-09-options-modal.png`,fullPage:true});
  // scroll modal to bottom to catch overflow
  await page.evaluate(()=>{const m=document.querySelector('#qf-options-modal');if(m)m.scrollTop=m.scrollHeight;});
  await page.waitForTimeout(300);
  await page.screenshot({path:`${OUT}/dray-${tag}-09b-options-bottom.png`,fullPage:true});
  // select a few chips
  await page.evaluate(()=>{const c=[...document.querySelectorAll('#qf-options-modal .qf-acc-chip')];[0,3,6].forEach(i=>c[i]&&c[i].click());});
  await page.waitForTimeout(300);
  await page.screenshot({path:`${OUT}/dray-${tag}-09c-options-selected.png`,fullPage:true});
  // close
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#qf-options-modal button,.qf-modal button')].find(x=>/done|apply|close|save/i.test(x.innerText));if(b)b.click();});
  await page.keyboard.press('Escape').catch(()=>{});
  await page.waitForTimeout(400);
  const optSummaryTxt=await page.$eval('#qf-options-summary',el=>el.innerText.replace(/\n+/g,' | ').slice(0,120)).catch(()=>'');
  log('OPT SUMMARY after select:',optSummaryTxt);

  // Compute
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/get instant quote|get quote|calculate/i.test(x.innerText)&&x.offsetParent!==null);if(b){b.setAttribute('data-gq','1');}});
  await page.click('[data-gq="1"]').catch(e=>log('gq err',e.message));
  await page.waitForTimeout(2500);
  await page.screenshot({path:`${OUT}/dray-${tag}-10-result.png`,fullPage:true});
  const result=await page.$eval('#qf-result',el=>el.innerText.replace(/\n+/g,' | ').slice(0,500)).catch(()=>'MISSING');
  log('RESULT:',result);

  // map presence
  const map=await page.evaluate(()=>{const m=document.querySelector('#qf-map,[class*="map"],canvas,.mapboxgl-canvas,img[src*="map"]');return m?{tag:m.tagName,cls:(m.className||'').toString().slice(0,50),h:Math.round(m.getBoundingClientRect().height)}:null;});
  log('MAP:',JSON.stringify(map));

  log('ERRORS:',errors.length?errors.join(' ;; '):'none');
  await ctx.close();await browser.close();
}
await run(520,920,'desktop');
await run(375,800,'mobile');
log('\nDONE');
