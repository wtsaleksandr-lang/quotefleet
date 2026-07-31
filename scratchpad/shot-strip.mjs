import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import url from 'node:url';import {chromium} from '@playwright/test';
const PUB=path.resolve('src/server/public');
const s=http.createServer((q,r)=>{const p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/'){r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync(path.resolve('scratchpad/circ-strip.html')));return;}const fp=path.join(PUB,p.replace(/^\/+/,''));if(fs.existsSync(fp)){r.writeHead(200,{'Content-Type':'image/png'});r.end(fs.readFileSync(fp));}else{r.writeHead(404);r.end();}});
await new Promise(r=>s.listen(0,r));const b=await chromium.launch();const p=await(await b.newContext({deviceScaleFactor:2})).newPage();
await p.goto(`http://localhost:${s.address().port}/`);await p.waitForTimeout(300);
await p.locator('body').screenshot({path:path.resolve('scratchpad/circ-strip.png')});await b.close();s.close();console.log('ok');
