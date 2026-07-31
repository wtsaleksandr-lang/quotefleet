import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {chromium} from '@playwright/test';
const f=path.resolve('scratchpad/icon-lab.html');
const s=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync(f));});
await new Promise(r=>s.listen(0,r));const b=await chromium.launch();
const p=await(await b.newContext({deviceScaleFactor:2})).newPage();
await p.goto(`http://localhost:${s.address().port}/`);await p.waitForTimeout(300);
await p.locator('body').screenshot({path:path.resolve('scratchpad/icon-lab.png')});
await b.close();s.close();console.log('ok');
