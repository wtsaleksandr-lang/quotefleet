// Verify no badge/pill/chip GROUP ever renders a line with exactly 1 item (orphan).
// Serves src/server/public statically, sweeps widths, measures item bounding boxes,
// groups by top-Y into lines, and fails any line with count===1 in a group of >1.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve('src/server/public');
const MIME = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.woff2':'font/woff2','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/landing.html';
    let fp = path.join(ROOT, p);
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    if (!existsSync(fp)) { res.writeHead(404); res.end('nope'); return; }
    const buf = await readFile(fp);
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise(r => server.listen(8861, r));
const port = 8861;

const GROUPS = [
  { name: 'hero-pills',     sel: '.qf-hero-pills',     item: '.qf-chip' },
  { name: 'refined-badges', sel: '.qf-refined-badges', item: '.qf-chip' },
  { name: 'trust-badges',   sel: '.qf-trust-badges',   item: '.qf-badge' },
  // hero-cta = primary button + secondary text link (dissimilar elements; the
  // mobile stack is the intended CTA pattern) -> excluded from the no-orphan rule.
  { name: 'hero-cta',       sel: '.hero-cta',          item: 'a', excluded: true },
];
const WIDTHS = [1440, 1024, 768, 480, 414, 375, 360, 320];

const browser = await chromium.launch();
const results = {};

function linesFromBoxes(boxes) {
  // group by top-Y with tolerance
  const sorted = [...boxes].sort((a,b)=>a.y-b.y || a.x-b.x);
  const lines = [];
  for (const b of sorted) {
    const cy = b.y + b.height/2;
    let line = lines.find(l => Math.abs(l.cy - cy) < b.height*0.6);
    if (!line) { line = { cy, items: [] }; lines.push(line); }
    line.items.push(b);
    line.cy = (line.cy*(line.items.length-1)+cy)/line.items.length;
  }
  return lines.map(l => l.items.length);
}

for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/landing.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  results[w] = {};
  for (const g of GROUPS) {
    const boxes = await page.$$eval(`${g.sel} ${g.item}`, els =>
      els.map(e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })
         .filter(r => r.width > 0 && r.height > 0));
    if (!boxes.length) { results[w][g.name] = { comp: 'n/a', orphan: false, n: 0 }; continue; }
    const comp = linesFromBoxes(boxes);
    const orphan = boxes.length > 1 && comp.some(c => c === 1);
    results[w][g.name] = { comp: comp.join('+'), orphan, n: boxes.length, excluded: !!g.excluded };
  }
  // screenshot the hero region + the refined-badge band for proof
  const hero = page.locator('.hero').first();
  await hero.screenshot({ path: `scratchpad/pillrows-hero-${w}.png` });
  const refined = page.locator('.qf-refined-badges').first();
  if (await refined.count()) await refined.screenshot({ path: `scratchpad/pillrows-refined-${w}.png` });
  await ctx.close();
}

await browser.close();
await new Promise(r => server.close(r));

let anyOrphan = false;
console.log('\n=== LINE COMPOSITION (items per line; ✗ = orphan) ===');
for (const g of GROUPS) {
  console.log(`\n[${g.name}]`);
  for (const w of WIDTHS) {
    const r = results[w][g.name];
    const flag = r.orphan ? (r.excluded ? ' ✗ (excluded: dissimilar/intentional stack)' : ' ✗ ORPHAN')
                          : (r.comp==='n/a'?'':' ✓');
    if (r.orphan && !r.excluded) anyOrphan = true;
    console.log(`  ${String(w).padStart(4)}px : ${r.n} items -> ${r.comp}${flag}`);
  }
}
console.log('\nRESULT:', anyOrphan ? 'FAIL — orphan lines present' : 'PASS — no orphan lines');
process.exit(anyOrphan ? 1 : 0);
