// Independently verify NO horizontal section divider overlaps content on the
// dark landing, at 1440 and 375. Measures each divider's rendered Y (the
// section::after) against every section's content bounding box.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { chromium } from '@playwright/test';
const PUB=path.resolve('src/server/public'), OUT=path.resolve('scratchpad');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.mp4':'video/mp4','.webm':'video/webm'};
const srv=http.createServer((rq,rs)=>{let rel=decodeURIComponent(url.parse(rq.url).pathname).replace(/^\/+/,'')||'landing.html';const fp=path.join(PUB,rel);if(!fp.startsWith(PUB)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end();return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});rs.end(fs.readFileSync(fp));});
await new Promise(r=>srv.listen(0,r));const port=srv.address().port;
const b=await chromium.launch();
for(const w of [1440,375]){
  const p=await (await b.newContext({viewport:{width:w,height:1000}})).newPage();
  await p.goto(`http://localhost:${port}/landing.html`,{waitUntil:'networkidle'});
  await p.evaluate(()=>document.body.classList.add('landing-v2','qf-wft'));
  await p.waitForTimeout(600);
  const res=await p.evaluate(()=>{
    const secs=[...document.querySelectorAll('main > section')];
    // divider Y = section top + the ::after top offset
    const rows=secs.map(s=>{
      const r=s.getBoundingClientRect();
      const cs=getComputedStyle(s,'::after');
      const hasLine=cs.content!=='none' && cs.display!=='none';
      const afterTop=parseFloat(cs.top)||0; // relative to section top (absolute pos)
      const divY = hasLine ? Math.round(r.top+window.scrollY+afterTop) : null;
      // content box = section minus its top/bottom padding
      const pt=parseFloat(getComputedStyle(s).paddingTop)||0, pb=parseFloat(getComputedStyle(s).paddingBottom)||0;
      return {cls:s.className.split(' ')[0]||s.tagName, top:Math.round(r.top+window.scrollY), bottom:Math.round(r.top+window.scrollY+r.height), contentTop:Math.round(r.top+window.scrollY+pt), contentBottom:Math.round(r.top+window.scrollY+r.height-pb), divY};
    });
    // for each divider, does its Y fall inside ANY section's content box?
    const overlaps=[];
    for(const d of rows){ if(d.divY==null) continue;
      for(const s of rows){ if(d.divY>s.contentTop+1 && d.divY<s.contentBottom-1){ overlaps.push({divOf:d.cls, divY:d.divY, insideContentOf:s.cls, box:[s.contentTop,s.contentBottom]}); } }
    }
    const overflow=document.scrollingElement.scrollWidth-window.innerWidth;
    return {overlaps, overflow, count:rows.filter(r=>r.divY!=null).length};
  });
  console.log(`\n[${w}px] dividers=${res.count}  h-overflow=${res.overflow}px  content-overlaps=${res.overlaps.length}`);
  res.overlaps.forEach(o=>console.log('   ✗ OVERLAP:',JSON.stringify(o)));
  if(!res.overlaps.length) console.log('   ✓ every divider sits in a gap, no content crossed');
}
await b.close();srv.close();
