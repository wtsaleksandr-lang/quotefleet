import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import url from 'node:url';import {chromium} from '@playwright/test';
const PUB=path.resolve('src/server/public');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.json':'application/json','.mp4':'video/mp4','.webm':'video/webm'};
const s=http.createServer((q,r)=>{let rel=decodeURIComponent(url.parse(q.url).pathname).replace(/^\/+/,'')||'landing.html';const fp=path.join(PUB,rel);if(!fp.startsWith(PUB)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});r.end(fs.readFileSync(fp));});
await new Promise(r=>s.listen(0,r));const port=s.address().port;const b=await chromium.launch();
const p=await(await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto(`http://localhost:${port}/landing.html`,{waitUntil:'networkidle'});
const info=await p.evaluate(()=>{
  const ico=document.querySelector('.qf-hero-pills .qf-chip-badge .qf-trust-ico');
  const badge=document.querySelector('.qf-hero-pills .qf-chip-badge');
  const cs=getComputedStyle(ico);
  const path=ico.querySelector('path,circle,rect');
  return {icoColor:cs.color, icoStroke:cs.stroke, badgeColor:getComputedStyle(badge).color, badgeBg:getComputedStyle(badge).backgroundColor, pathStroke:path?getComputedStyle(path).stroke:'n/a', pathAttr:path?path.getAttribute('stroke')||path.getAttribute('fill'):'n/a'};
});
console.log(JSON.stringify(info,null,1));
await b.close();s.close();
