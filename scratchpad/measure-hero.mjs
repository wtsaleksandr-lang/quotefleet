import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import url from 'node:url';import {chromium} from '@playwright/test';
const PUB=path.resolve('src/server/public');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.json':'application/json','.mp4':'video/mp4','.webm':'video/webm'};
const s=http.createServer((q,r)=>{let rel=decodeURIComponent(url.parse(q.url).pathname).replace(/^\/+/,'')||'landing.html';const fp=path.join(PUB,rel);if(!fp.startsWith(PUB)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});r.end(fs.readFileSync(fp));});
await new Promise(r=>s.listen(0,r));const port=s.address().port;const b=await chromium.launch();
for(const w of [1440,1512,1728,1920]){
  const p=await(await b.newContext({viewport:{width:w,height:900},deviceScaleFactor:1})).newPage();
  await p.goto(`http://localhost:${port}/landing.html`,{waitUntil:'networkidle'});await p.waitForTimeout(400);
  const m=await p.evaluate(()=>{
    const g=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {w:Math.round(r.width)};};
    const h1=document.querySelector('.hero h1');
    const h1lines=h1?Math.round(h1.getBoundingClientRect().height/parseFloat(getComputedStyle(h1).lineHeight)):0;
    const vid=document.querySelector('.qf-browser-vid');
    return {grid:g('.hero-grid'),copy:g('.hero-copy'),media:g('.qf-hero-media'),laptopVid:vid?Math.round(vid.getBoundingClientRect().width):0,h1w:g('.hero h1'),h1lines};
  });
  console.log(`vw=${w}  grid=${m.grid?.w}  copy=${m.copy?.w}  media=${m.media?.w}  laptopVideo=${m.laptopVid}px  h1=${m.h1w?.w}(${m.h1lines} lines)  gutter=${Math.round((w-(m.grid?.w||0))/2)}px/side`);
  await p.close();
}
await b.close();s.close();
