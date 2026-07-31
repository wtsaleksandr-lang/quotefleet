import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import url from 'node:url';import {chromium} from '@playwright/test';
const PUB=path.resolve('src/server/public'),OUT=path.resolve('scratchpad');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.json':'application/json','.mp4':'video/mp4','.webm':'video/webm'};
const s=http.createServer((q,r)=>{let rel=decodeURIComponent(url.parse(q.url).pathname).replace(/^\/+/,'')||'landing.html';const fp=path.join(PUB,rel);if(!fp.startsWith(PUB)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});r.end(fs.readFileSync(fp));});
await new Promise(r=>s.listen(0,r));const port=s.address().port;const b=await chromium.launch();
for(const [tag,w] of [['desk',1440],['mob',375]]){
  const p=await(await b.newContext({viewport:{width:w,height:900},deviceScaleFactor:2})).newPage();
  await p.goto(`http://localhost:${port}/landing.html`,{waitUntil:'networkidle'});
  await p.waitForTimeout(700);
  const pills=p.locator('.qf-hero-pills');await pills.scrollIntoViewIfNeeded();
  await pills.screenshot({path:path.join(OUT,`pills-icons-${tag}.png`)});
  const info=await p.evaluate(()=>{
    const chips=[...document.querySelectorAll('.qf-hero-pills .qf-chip')];
    const rows={};chips.forEach(c=>{const t=Math.round(c.getBoundingClientRect().top);rows[t]=(rows[t]||0)+1;});
    const iconLeft=chips.every(c=>c.firstElementChild&&c.firstElementChild.classList.contains('qf-hero-trust-ico'));
    const sizes=[...document.querySelectorAll('.qf-hero-pills .qf-hero-trust-ico')].map(i=>Math.round(i.getBoundingClientRect().width));
    return {perRow:Object.values(rows),iconLeft,sizes};
  });
  console.log(`[${tag} ${w}] perRow=${JSON.stringify(info.perRow)} iconLeft=${info.iconLeft} sizes=${JSON.stringify(info.sizes)}`);
}
await b.close();s.close();
