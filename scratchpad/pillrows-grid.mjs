import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const widths = [1440,1024,768,480,414,375,360,320];
const comp = { 1440:'2+2',1024:'2+2',768:'2+2',480:'2+2',414:'2+2',375:'2+2',360:'2+2',320:'2+2' };
function dataUri(f){ const b=readFileSync(path.resolve('scratchpad',f)); return 'data:image/png;base64,'+b.toString('base64'); }
const cards = widths.map(w=>`<figure><figcaption>${w}px &middot; hero pills ${comp[w]} &check;</figcaption><img src="${dataUri('pillrows-hero-'+w+'.png')}"></figure>`).join('');
const html = `<!doctype html><meta charset=utf8><style>body{margin:0;background:#0b0f1a;font:14px system-ui;color:#e8eefc;padding:20px}h1{font-size:18px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}figure{margin:0;background:#111726;border:1px solid #223;border-radius:8px;overflow:hidden}figcaption{padding:8px 10px;font-weight:600;color:#9fb2e6}img{display:block;width:100%}</style><h1>QuoteFleet hero pills — no-orphan sweep (2&times;2 at every width)</h1><div class=grid>${cards}</div>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1600,height:900}, deviceScaleFactor:1 });
await page.setContent(html,{waitUntil:'load'});
await page.waitForTimeout(200);
await page.locator('.grid').screenshot({ path:'scratchpad/pillrows-compare-grid.png' });
await browser.close();
console.log('grid done');
