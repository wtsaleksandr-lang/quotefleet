import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const S = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad';
const b64 = f => 'data:image/png;base64,' + fs.readFileSync(path.join(S,f)).toString('base64');
const cell = (f,l) => `<figure><figcaption>${l}</figcaption><img src="${b64(f)}"></figure>`;
const rows = [
 ['1 · Cupertino map distance/transit badge — dark-on-frost (FIXED)', [['_gate-cupertino-desktop-1calc.png','cupertino desktop'],['_gate-cupertino-mobile-1calc.png','cupertino mobile 375']]],
 ['2 · Tesla + Booking add-ons bar label — light-on-dark (FIXED) + estimate-note toned', [['_gate-tesla-desktop-1calc.png','tesla desktop'],['_gate-booking-desktop-1calc.png','booking desktop']]],
 ['3 · Booking Back (contact) + Edit details (result) — light periwinkle (FIXED)', [['_gate-booking-desktop-3contact.png','booking Back'],['_gate-booking-desktop-2result.png','booking Edit details']]],
 ['4 · Midnight UNCHANGED (control)', [['_gate-midnight-desktop-1calc.png','midnight desktop']]],
];
const html = `<!doctype html><meta charset=utf8><style>
body{margin:0;background:#141414;font-family:Arial;padding:22px}
h2{color:#fff;font-size:20px;margin:14px 0 10px}
.row{display:flex;gap:14px;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap}
figure{margin:0}figcaption{color:#bbb;font-size:13px;margin-bottom:6px;text-align:center}
figure img{display:block;border:1px solid #333;border-radius:8px;width:360px;height:auto}
</style><body>
<h1 style="color:#fff;font:700 24px Arial">QuoteFleet — preset contrast fixes (after)</h1>
${rows.map(([t,cs])=>`<h2>${t}</h2><div class="row">${cs.map(([f,l])=>cell(f,l)).join('')}</div>`).join('')}
</body>`;
const br = await chromium.launch();
const pg = await (await br.newContext({deviceScaleFactor:1})).newPage();
await pg.setContent(html,{waitUntil:'networkidle'});
await pg.waitForTimeout(300);
const out = path.resolve('scratchpad/contrast-fixes-after.png');
await pg.screenshot({path:out,fullPage:true});
await br.close();
console.log('wrote', out);
