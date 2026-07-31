import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {chromium} from '@playwright/test';
const f=path.resolve('scratchpad/snap-lab.html');
const s=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync(f));});
await new Promise(r=>s.listen(0,r));const b=await chromium.launch();
const p=await(await b.newContext({viewport:{width:420,height:240},deviceScaleFactor:2})).newPage();
await p.goto(`http://localhost:${s.address().port}/`);await p.waitForTimeout(250);
await p.locator('body').screenshot({path:path.resolve('scratchpad/snap-lab.png')});
await b.close();s.close();console.log('ok');
