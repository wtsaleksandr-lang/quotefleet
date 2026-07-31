import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const ROOT = path.resolve('src/server/public');
const MIME = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.woff2':'font/woff2','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon' };
const server = http.createServer(async (req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/landing.html'; let fp=path.join(ROOT,p); if(existsSync(fp)&&statSync(fp).isDirectory())fp=path.join(fp,'index.html'); if(!existsSync(fp)){res.writeHead(404);res.end('x');return;} const b=await readFile(fp); res.writeHead(200,{'content-type':MIME[path.extname(fp)]||'application/octet-stream'}); res.end(b); });
await new Promise(r=>server.listen(8862,r));
const browser = await chromium.launch();
for (const w of [320,375,768,1440]) {
  const ctx = await browser.newContext({ viewport:{width:w,height:1000}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8862/landing.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(300);
  await page.evaluate(()=>{ document.querySelectorAll('[data-reveal]').forEach(e=>{e.classList.add('is-revealed','revealed','in-view');e.style.opacity='1';e.style.transform='none';}); const r=document.querySelector('.qf-refined-badges'); r&&r.scrollIntoView({block:'center'}); });
  await page.waitForTimeout(300);
  const el = page.locator('.qf-refined-badges').first();
  await el.screenshot({ path:`scratchpad/pillrows-refined-${w}.png` });
  await ctx.close();
}
await browser.close(); await new Promise(r=>server.close(r));
console.log('done');
