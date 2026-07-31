import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const OUT = 'scratchpad';
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, f)).toString('base64');
const bps = ['1440', '1280', '768', '375'];
const row = (bp) => `<div class="bp ${bp==='375'?'narrow':''}"><h3>${bp}px</h3><div class="pair">
  <figure><figcaption>BEFORE</figcaption><img src="${b64('hero-mockups-before-'+bp+'.png')}"></figure>
  <figure><figcaption>AFTER (bigger mockups)</figcaption><img src="${b64('hero-mockups-after-'+bp+'.png')}"></figure>
</div></div>`;
const html = `<!doctype html><meta charset=utf8><style>
 body{margin:0;background:#0b0f15;font-family:Inter,Arial;padding:24px;color:#e8eef7}
 h2{font-size:22px;margin:0 0 18px}
 h3{font-size:14px;color:#8aa;margin:22px 0 8px;letter-spacing:.08em}
 .pair{display:flex;gap:16px;align-items:flex-start}
 figure{margin:0;flex:1 1 0;min-width:0}
 figcaption{font-size:12px;color:#9fb;margin-bottom:6px}
 img{display:block;width:100%;border:1px solid #223;border-radius:8px}
 .bp.narrow .pair figure{flex:0 0 300px}
</style>
<h2>QuoteFleet hero device mockups — before vs after (bigger)</h2>
${bps.map(row).join('')}`;
const pg = await (await chromium.launch()).newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 });
await pg.setContent(html, { waitUntil: 'networkidle' });
await pg.locator('body').screenshot({ path: path.join(OUT, 'hero-mockups-compare.png') });
await pg.context().browser().close();
console.log('compare written');
