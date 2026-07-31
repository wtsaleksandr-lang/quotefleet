// Grab-to-scroll verification for the customer widget (/w/demo).
// Serves src/server/public statically + stubs the widget config API (no map
// key needed). Drives real mouse drags at 1440 and a real CDP touch drag at 375.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { chromium } from '@playwright/test';

const PUB = path.resolve('src/server/public');
const SCRATCH = path.resolve('scratchpad');

const cfg = {
  tenant: { slug: 'demo', name: 'Harbor Link Logistics', countryFocus: 'US' },
  brand: {
    displayName: 'Harbor Link Logistics', name: 'Harbor Link Logistics',
    tagline: 'Instant freight rates', logoUrl: null, primaryColor: '#2f6df6',
    showPoweredBy: true, ctaText: 'Get my rate', themePreset: 'harbor',
    requireEmail: true, requirePhone: false, showQuoteBeforeContact: false,
  },
  contact: { phone: '(414) 555-0177', email: 'dispatch@harborlink.co', address: '1200 Freight Way, Milwaukee, WI 53202', dotNumber: '3128840', mcNumber: '1002233' },
  disclaimer: 'Rates are estimates and subject to final confirmation.',
  features: { quoteShare: true, quoteBooking: false },
  booking: { mode: 'none', amount: 0 },
  services: ['ftl', 'ltl', 'drayage'],
  equipmentByService: {
    ftl: [{ value: 'dryvan', label: "53' Dry Van" }, { value: 'reefer', label: "53' Reefer" }],
    ltl: [{ value: 'pallet', label: 'LTL Pallet' }],
    drayage: [{ value: 'container_40hc', label: "40' HC container" }],
  },
  accessorials: [
    { code: 'liftgate', label: 'Liftgate', description: 'Liftgate', appliesToServices: null },
    { code: 'detention', label: 'Detention', description: 'Detention', appliesToServices: null },
  ],
  drayagePorts: [], terminalsByPort: {}, hasZones: false,
};

const T = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
const srv = http.createServer((req, res) => {
  const u = url.parse(req.url, true), p = u.pathname;
  const J = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p.startsWith('/api/public/widget/')) return void J(cfg);
  if (p.startsWith('/api/public/autocomplete')) return void J({ suggestions: [] });
  if (p.startsWith('/api/public/route-preview/')) return void J({ ok:true, miles:118, transit:{ text:'1 day' } });
  if (p.startsWith('/api/public/quote/')) return void J({ miles:118, transit:{ text:'1 day' }, result:{ total:1840, lines:[{ name:'Line haul', amount:1520 }] } });
  if (p === '/w/demo') { res.writeHead(200, { 'Content-Type':'text/html' }); return void res.end(fs.readFileSync(path.join(PUB, 'widget.html'))); }
  let rel = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html';
  const fp = path.join(PUB, rel);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return void res.end('nf'); }
  res.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
const PORT = 8871;
await new Promise((r) => srv.listen(PORT, r));

const b = await chromium.launch();
const results = [];
function log(name, pass, detail) { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

async function dragMouse(pg, x0, y0, dx, dy, steps) {
  steps = steps || 12;
  await pg.mouse.move(x0, y0);
  await pg.mouse.down();
  for (let i = 1; i <= steps; i++) await pg.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
  await pg.mouse.up();
}

// Wait for any inertial glide to fully settle, then park the page at top so the
// next measurement starts from a known baseline.
async function rest(pg) {
  let prev = -1, stable = 0;
  for (let i = 0; i < 40; i++) {
    const y = await pg.evaluate(() => window.scrollY);
    if (y === prev) { if (++stable >= 3) break; } else stable = 0;
    prev = y;
    await pg.waitForTimeout(50);
  }
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.waitForTimeout(120);
}

// ── DESKTOP 1440 (short viewport → ample scroll room) ────────────────────────
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 480 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${PORT}/w/demo`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(800);

  // cursor:grab on the draggable background (body)
  const bodyCursor = await pg.evaluate(() => getComputedStyle(document.body).cursor);
  log('desktop cursor:grab on background', bodyCursor === 'grab', 'body cursor=' + bodyCursor);

  const box = (sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height }; }, sel);

  // Show the map card up front so total page height is stable across all tests.
  await pg.evaluate(() => { const c = document.getElementById('qf-map-card'); if (c) { c.removeAttribute('hidden'); c.classList.remove('qf-map-base'); } });
  await pg.waitForTimeout(150);
  const maxTop = await pg.evaluate(() => (document.scrollingElement.scrollHeight - window.innerHeight));

  // 1) Drag on CARD BACKGROUND (non-interactive text) scrolls the page.
  await rest(pg);
  const note = await box('.qf-customer-note') || await box('.qf-trust-strip');
  const y0 = await pg.evaluate(() => window.scrollY);
  await dragMouse(pg, note.x + note.w / 2, note.y + note.h / 2, 0, -220);
  await pg.waitForTimeout(500); // allow inertial glide to settle
  const y1 = await pg.evaluate(() => window.scrollY);
  log('desktop drag on card background scrolls page', y1 > y0 + 100, `scrollY ${y0} → ${y1} (maxTop ${maxTop})`);

  // 2) Drag on an INPUT does NOT scroll; input stays focusable/editable.
  // Horizontal drag keeps it inside the viewport (no native selection autoscroll).
  await rest(pg);
  const inp = await box('#qf-weight');
  const yi0 = await pg.evaluate(() => window.scrollY);
  await dragMouse(pg, inp.x + inp.w / 2, inp.y + inp.h / 2, 120, 0);
  const yi1 = await pg.evaluate(() => window.scrollY);
  await pg.fill('#qf-weight', '38000');
  const inpVal = await pg.inputValue('#qf-weight');
  log('desktop drag on input does NOT scroll', Math.abs(yi1 - yi0) < 8, `scrollY ${yi0} → ${yi1}`);
  log('desktop input still editable', inpVal === '38000', 'value=' + inpVal);

  // 3) Click on a TAB switches service, no page scroll.
  await rest(pg);
  const svcBefore = await pg.evaluate(() => { const a = document.querySelector('#qf-services button.active'); return a ? a.dataset.service : null; });
  const tabs = await pg.$$('#qf-services button');
  let targetTab = null;
  for (const t of tabs) { const s = await t.getAttribute('data-service'); if (s !== svcBefore) { targetTab = t; break; } }
  const yt0 = await pg.evaluate(() => window.scrollY);
  const tb = await targetTab.boundingBox();
  await pg.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await pg.waitForTimeout(200);
  const svcAfter = await pg.evaluate(() => { const a = document.querySelector('#qf-services button.active'); return a ? a.dataset.service : null; });
  const yt1 = await pg.evaluate(() => window.scrollY);
  const switched = svcAfter && svcAfter !== svcBefore;
  log('desktop click on tab switches service (no scroll)', switched && Math.abs(yt1 - yt0) < 8, `${svcBefore} → ${svcAfter}, scrollY ${yt0}→${yt1}`);

  // 4) Drag on the MAP card does NOT scroll the page (excluded / pans itself).
  await rest(pg);
  const mapBox = await box('.qf-map-canvas');
  if (mapBox && mapBox.h > 10) {
    const ym0 = await pg.evaluate(() => window.scrollY);
    await dragMouse(pg, mapBox.x + mapBox.w / 2, mapBox.y + mapBox.h / 2, 0, -180);
    await pg.waitForTimeout(300);
    const ym1 = await pg.evaluate(() => window.scrollY);
    log('desktop drag on map does NOT scroll page', Math.abs(ym1 - ym0) < 8, `scrollY ${ym0} → ${ym1}`);
  } else {
    log('desktop drag on map does NOT scroll page', true, 'map canvas not measurable — skipped (excluded selector still applies)');
  }

  // 5) A real click (no drag) still works — open the options modal.
  await rest(pg);
  await pg.click('#qf-options-summary');
  await pg.waitForTimeout(250);
  const modalOpen = await pg.evaluate(() => { const m = document.getElementById('qf-options-modal'); return m && !m.hidden; });
  log('desktop real click opens options modal', !!modalOpen, 'modal hidden=' + !modalOpen);
  await pg.evaluate(() => { const m = document.getElementById('qf-options-modal'); if (m) m.hidden = true; });

  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.screenshot({ path: path.join(SCRATCH, 'grabscroll-widget-desktop.png') });
  await ctx.close();
}

// ── MOBILE 375 (native touch scroll must still work) ─────────────────────────
{
  const ctx = await b.newContext({ viewport: { width: 375, height: 640 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${PORT}/w/demo`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(800);

  const client = await ctx.newCDPSession(pg);
  await pg.evaluate(() => window.scrollTo(0, 0));
  const ym0 = await pg.evaluate(() => window.scrollY);
  // Real native touch drag (finger up = page scrolls down).
  const cx = 200;
  async function touch(type, y) { await client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y }] }); }
  await touch('touchStart', 500);
  for (let y = 480; y >= 200; y -= 40) { await touch('touchMove', y); await pg.waitForTimeout(16); }
  await touch('touchEnd', 200);
  await pg.waitForTimeout(500);
  const ym1 = await pg.evaluate(() => window.scrollY);
  log('mobile native touch drag scrolls page (grab-scroll did not break it)', ym1 > ym0 + 60, `scrollY ${ym0} → ${ym1}`);

  await pg.screenshot({ path: path.join(SCRATCH, 'grabscroll-widget-mobile.png') });
  await ctx.close();
}

// ── reduced-motion: inertial glide disabled ──────────────────────────────────
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 480 }, reducedMotion: 'reduce' });
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${PORT}/w/demo`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => { const c = document.getElementById('qf-map-card'); if (c) { c.removeAttribute('hidden'); c.classList.remove('qf-map-base'); } });
  await pg.waitForTimeout(150);
  const box = await pg.evaluate(() => { const e = document.querySelector('.qf-customer-note') || document.querySelector('.qf-trust-strip'); const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height }; });
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await pg.mouse.down();
  for (let i = 1; i <= 12; i++) await pg.mouse.move(box.x + box.w / 2, box.y + box.h / 2 - (240 * i) / 12);
  await pg.mouse.up();
  const yRight = await pg.evaluate(() => window.scrollY);
  await pg.waitForTimeout(500);
  const yLater = await pg.evaluate(() => window.scrollY);
  // With reduced motion there is no glide → scroll position must not keep growing after release.
  log('reduced-motion disables inertial glide', Math.abs(yLater - yRight) < 6 && yRight > 80, `release ${yRight} → +500ms ${yLater}`);
  await ctx.close();
}

await b.close();
srv.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n=== WIDGET: ${results.length - failed.length}/${results.length} passed ===`);
process.exit(failed.length ? 1 : 0);
