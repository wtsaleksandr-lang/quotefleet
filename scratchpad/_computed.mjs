import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import url from 'node:url';import {chromium} from '@playwright/test';
const PUB=path.resolve('src/server/public');
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.jpg':'image/jpeg','.mp4':'video/mp4','.webm':'video/webm','.json':'application/json'};
const s=http.createServer((q,r)=>{let rel=decodeURIComponent(url.parse(q.url).pathname).replace(/^\/+/,'')||'landing.html';const fp=path.join(PUB,rel);if(!fp.startsWith(PUB)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});r.end(fs.readFileSync(fp));});
await new Promise(r=>s.listen(0,r));const b=await chromium.launch();
const p=await(await b.newContext({viewport:{width:1512,height:900}})).newPage();
await p.goto(`http://localhost:${s.address().port}/landing.html`,{waitUntil:'networkidle'});
const r=await p.evaluate(()=>{
  const g=document.querySelector('.hero-grid'),c=document.querySelector('.hero-copy');
  const par=[];let e=g;while(e&&e.tagName!=='BODY'){const cs=getComputedStyle(e);par.push(`${e.className||e.tagName}: w=${Math.round(e.getBoundingClientRect().width)} maxW=${cs.maxWidth} pad=${cs.paddingLeft}/${cs.paddingRight}`);e=e.parentElement;}
  const cg=getComputedStyle(g);return {disp:cg.display,wid:cg.width,justifySelf:cg.justifySelf,justifyContent:cg.justifyContent,cols:cg.gridTemplateColumns,heroDisplay:getComputedStyle(document.querySelector('.hero')).display};
});
console.log(JSON.stringify(r,null,1));
await b.close();s.close();
