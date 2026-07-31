import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import url from 'node:url';import {chromium} from '@playwright/test';
const PUB=path.resolve('src/server/public'),OUT=path.resolve('scratchpad');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.json':'application/json','.mp4':'video/mp4','.webm':'video/webm'};
const s=http.createServer((q,r)=>{let rel=decodeURIComponent(url.parse(q.url).pathname).replace(/^\/+/,'')||'landing.html';const fp=path.join(PUB,rel);if(!fp.startsWith(PUB)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});r.end(fs.readFileSync(fp));});
await new Promise(r=>s.listen(0,r));const b=await chromium.launch();
const p=await(await b.newContext({viewport:{width:640,height:900},deviceScaleFactor:2})).newPage();
await p.goto(`http://localhost:${s.address().port}/landing.html`,{waitUntil:'networkidle'});await p.waitForTimeout(700);
await p.locator('.qf-hero-pills').scrollIntoViewIfNeeded();await p.waitForTimeout(300);await p.screenshot({path:path.join(OUT,'pills-view.png')});
await b.close();s.close();console.log('ok');
