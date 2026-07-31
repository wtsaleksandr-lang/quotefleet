import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { resolveWidgetTheme } from '../src/server/widgetThemes.ts';

const ROOT = join(process.cwd(), 'src', 'server', 'public');
const OUT = join(process.cwd(), 'scratchpad');
const CFG_PATH = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-demo-cfg.json';
const BASE_CFG = JSON.parse(await readFile(CFG_PATH, 'utf8'));
BASE_CFG.contact.email = BASE_CFG.contact.email || 'quotes@harborlinklogistics.com';
BASE_CFG.contact.chat = BASE_CFG.contact.email;

const PRESETS = ['midnight', 'mono', 'ironhorse', 'harbor', 'cupertino', 'material', 'booking', 'tesla', 'stripe', 'stone', 'cream'];

const T: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

function gridHtml(): string {
  const tiles = PRESETS.map((p) => `<div class="tile"><div class="lbl">${p}</div><iframe src="/widget.html?preset=${p}" width="460" height="880" frameborder="0"></iframe></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#33393f;font-family:system-ui;padding:16px}.grid{display:grid;grid-template-columns:repeat(3,460px);gap:20px}.tile{background:#22262a;border-radius:8px;overflow:hidden}.lbl{color:#fff;font-weight:700;font-size:14px;padding:8px 12px;text-transform:uppercase;letter-spacing:.05em}iframe{display:block;background:transparent}</style></head><body><div class="grid">${tiles}</div></body></html>`;
}

const srv = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url!, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/grid.html') { rs.writeHead(200, { 'content-type': 'text/html' }); rs.end(gridHtml()); return; }
  if (p.indexOf('/api/public/widget/') === 0) {
    const preset = u.searchParams.get('preset') || 'midnight';
    const cfg = JSON.parse(JSON.stringify(BASE_CFG));
    cfg.theme = resolveWidgetTheme({ themePreset: preset });
    rs.writeHead(200, { 'content-type': 'application/json' }); rs.end(JSON.stringify(cfg)); return;
  }
  if (p.indexOf('/api/') === 0) { rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('{"suggestions":[]}'); return; }
  let fp = normalize(join(ROOT, p));
  if (!fp.startsWith(ROOT)) { rs.writeHead(403); rs.end(); return; }
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
  if (!existsSync(fp)) { rs.writeHead(404); rs.end('nf'); return; }
  try { rs.writeHead(200, { 'content-type': T[extname(fp)] || 'application/octet-stream' }); rs.end(await readFile(fp)); } catch (e) { rs.writeHead(500); rs.end(String(e)); }
});
await new Promise<void>((r) => srv.listen(0, () => r()));
const PORT = (srv.address() as any).port;
const b = await chromium.launch();
async function blockExternal(ctx: any) {
  await ctx.route('**/*', (route: any) => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:' + PORT) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    // external (google maps tiles, fonts CDNs) → transparent 1x1 for images, abort otherwise
    return route.abort();
  });
}

// ── 1. Master grid (desktop) ──────────────────────────────────────────────
{
  const ctx = await b.newContext({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 1 });
  await blockExternal(ctx);
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { (window as any).QF_TENANT_SLUG = 'demo'; });
  await pg.goto('http://localhost:' + PORT + '/grid.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(3500);
  await pg.screenshot({ path: join(OUT, 'themes-final-grid.png'), fullPage: true });
  console.log('GRID written: themes-final-grid.png');
  await ctx.close();
}

// ── helper: drive one preset page ─────────────────────────────────────────
async function drive(preset: string, vp: { width: number; height: number }, mobile: boolean) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mobile });
  await blockExternal(ctx);
  const pg = await ctx.newPage();
  const errs: string[] = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { (window as any).QF_TENANT_SLUG = 'demo'; });
  await pg.goto('http://localhost:' + PORT + '/widget.html?preset=' + preset, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  return { ctx, pg, errs };
}

// ── 2. Help-cue position + genset legibility per preset ────────────────────
const report: any[] = [];
for (const preset of PRESETS) {
  const { ctx, pg, errs } = await drive(preset, { width: 460, height: 1000 }, false);
  const measureSrc = `(() => {
    var lum = function(c){ var m=c.match(/rgba?\\(([^)]+)\\)/); if(!m) return null; var parts=m[1].split(',').map(function(x){return parseFloat(x)/255;}); var f=function(v){return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(parts[0])+0.7152*f(parts[1])+0.0722*f(parts[2]); };
    var ratio = function(a,b){ var la=lum(a), lb=lum(b); var hi=Math.max(la,lb), lo=Math.min(la,lb); return (hi+0.05)/(lo+0.05); };
    var row = document.querySelector('#qf-equip-weight-row');
    var helpLeftOfLabel=null, helpRect=null, titleText='';
    if(row){ var title=row.querySelector('.qf-title-inline'); var help=title&&title.querySelector('.qf-help');
      if(title&&help){ var hr=help.getBoundingClientRect(), tr=title.getBoundingClientRect(); var disp=getComputedStyle(help).display;
        helpRect={helpLeft:Math.round(hr.left),helpRight:Math.round(hr.right),titleLeft:Math.round(tr.left),titleRight:Math.round(tr.right),display:disp};
        helpLeftOfLabel = disp==='none'?null:((hr.left+hr.width/2) < (tr.left+tr.width/3));
        titleText=(title.textContent||'').trim().slice(0,20); } }
    var gp=document.querySelector('#qf-genset-panel'); var genset=null;
    if(gp){ gp.style.display=''; var span=gp.querySelector('.qf-oog-toggle span'); var panelBg=getComputedStyle(gp).backgroundColor; var labelColor=getComputedStyle(span).color; genset={labelColor:labelColor,panelBg:panelBg,contrast:+ratio(labelColor,panelBg).toFixed(2)}; }
    var activeTab=document.querySelector('.qf-tabs button.active'); var tab=activeTab?{bg:getComputedStyle(activeTab).backgroundColor,color:getComputedStyle(activeTab).color}:null;
    return {helpRect:helpRect,helpLeftOfLabel:helpLeftOfLabel,titleText:titleText,genset:genset,tab:tab};
  })()`;
  const data = await pg.evaluate(measureSrc);
  report.push({ preset, ...data, errs: errs.slice(0, 2) });
  await ctx.close();
}
console.log('PER-PRESET:\n' + JSON.stringify(report, null, 1));

// ── 3. Full-calculator screenshots (spot) + genset revealed ────────────────
async function shot(preset: string, name: string, vp: { width: number; height: number }, mobile: boolean, revealGenset: boolean) {
  const { ctx, pg } = await drive(preset, vp, mobile);
  if (revealGenset) {
    await pg.evaluate(() => { const gp = document.querySelector('#qf-genset-panel') as HTMLElement; if (gp) gp.style.display = ''; });
    await pg.waitForTimeout(200);
  }
  const root = await pg.$('#qf-root');
  await (root ?? pg).screenshot({ path: join(OUT, name) });
  await ctx.close();
  console.log('shot:', name);
}
await shot('midnight', 'v-midnight-desktop.png', { width: 460, height: 1000 }, false, true);
await shot('material', 'v-material-desktop.png', { width: 460, height: 1000 }, false, true);
await shot('stone', 'v-stone-desktop.png', { width: 460, height: 1000 }, false, true);
await shot('tesla', 'v-tesla-desktop.png', { width: 460, height: 1000 }, false, true);
await shot('booking', 'v-booking-desktop.png', { width: 460, height: 1000 }, false, true);
await shot('cupertino', 'v-cupertino-desktop.png', { width: 460, height: 1000 }, false, true);
// mobile 375
await shot('midnight', 'v-midnight-375.png', { width: 375, height: 1000 }, true, true);
await shot('tesla', 'v-tesla-375.png', { width: 375, height: 1000 }, true, true);
await shot('material', 'v-material-375.png', { width: 375, height: 1000 }, true, true);

await b.close();
srv.close();
console.log('DONE');
