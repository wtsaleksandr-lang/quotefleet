// Verify the calculator degenerate-config fixes (P1-P6) against the REAL
// widget.html/js/css, with faithful app-calculator context (conditional-options
// script loads app-style.css + adds body.qf-app-calculator). Screenshots each
// fixed case + its normal counterpart into scratchpad/calc-fix-*.png.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { chromium } from '@playwright/test';

const PUB = path.resolve('src/server/public');
const OUT = path.resolve('scratchpad');
try { fs.mkdirSync(OUT, { recursive: true }); } catch {}

const GRAY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const THEME = {
  preset: 'cream', font: 'Inter', ctaHover: 'border', mapBlend: 'off',
  tokens: {
    '--w-bg': '#f7f5f0', '--w-surface': '#ffffff', '--w-fg': '#0b0f15',
    '--w-text': '#0b0f15', '--w-muted': '#5b6472', '--w-accent': '#0D3CFC',
    '--w-primary': '#0D3CFC', '--w-border': '#e4e2dc', '--w-contact-text': '#0b0f15',
    '--w-accent-on-surface': '#0D3CFC', '--w-font': 'Inter, system-ui, sans-serif',
    '--w-radius-card': '14px', '--w-label-transform': 'uppercase',
  },
};

function baseCfg(over) {
  return Object.assign({
    tenant: { slug: 'demo', name: 'Northwind Freight', countryFocus: 'US' },
    brand: {
      displayName: 'Northwind Freight', name: 'Northwind Freight', tagline: 'Instant freight rates',
      logoUrl: null, primaryColor: '#0D3CFC', showPoweredBy: true, ctaText: 'Calculate estimate',
      themePreset: 'cream', fontFamily: 'Inter', mapStyle: 'branded', ctaHover: 'border',
      requireEmail: true, requirePhone: false, showQuoteBeforeContact: false,
    },
    contact: { phone: '(414) 555-0177', email: 'dispatch@demo.co', address: '1200 Freight Way, Milwaukee, WI 53202', dotNumber: '3128840', mcNumber: '1002233' },
    disclaimer: 'Rates are estimates and subject to final confirmation.',
    features: { quoteShare: true, quoteBooking: false },
    booking: { depositType: 'none', depositValue: 0 },
    theme: THEME,
    services: ['ftl', 'ltl', 'drayage'],
    equipmentByService: {
      ftl: [{ value: 'dryvan', label: "53' Dry Van" }, { value: 'reefer', label: "53' Reefer" }, { value: 'flatbed', label: 'Flatbed' }],
      ltl: [{ value: 'pallet', label: 'LTL Pallet' }],
      drayage: [{ value: 'container_40hc', label: "40' HC container" }, { value: 'container_20', label: "20' container" }],
    },
    accessorials: [
      { code: 'liftgate', label: 'Liftgate', description: 'Liftgate at pickup or delivery', appliesToServices: null },
      { code: 'detention', label: 'Detention', description: 'Waiting time beyond free window', appliesToServices: null },
    ],
    drayagePorts: [{ code: 'USLAX', name: 'Los Angeles', state: 'CA', city: 'Los Angeles' }], terminalsByPort: {}, hasZones: false,
  }, over || {});
}

let QUOTE = { miles: 118, transit: { text: '1 day' }, result: { total: 1840, lines: [
  { name: 'Line haul', amount: 1520 }, { name: 'Fuel surcharge', amount: 235 }, { name: 'Accessorial', amount: 85 },
] } };
let CFG = baseCfg();

const T = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
const srv = http.createServer((req, res) => {
  const u = url.parse(req.url, true), p = u.pathname;
  const J = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p.startsWith('/api/public/widget/')) return void J(CFG);
  if (p.endsWith('.png') && p.indexOf('/api/public/') === 0) { res.writeHead(200, { 'Content-Type': 'image/png' }); return void res.end(GRAY_PNG); }
  if (p.startsWith('/api/public/route-preview/')) return void J({ ok: true, miles: QUOTE.miles, transit: QUOTE.transit, mapUrl: '/api/public/route-map.png?x=1' });
  if (p.startsWith('/api/public/autocomplete')) return void J({ suggestions: [] });
  if (p.startsWith('/api/public/quote/')) return void J(QUOTE);
  if (p.startsWith('/api/public/lead/')) return void J({ refId: 'QF-DEMO-40817', quoteUrl: 'http://x/q/1' });
  if (p.indexOf('/w/') === 0) { res.writeHead(200, { 'Content-Type': 'text/html' }); return void res.end(fs.readFileSync(path.join(PUB, 'widget.html'))); }
  let rel = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html';
  const fp = path.join(PUB, rel);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return void res.end('nf'); }
  res.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
const PORT = 8858;
await new Promise((r) => srv.listen(PORT, r));

const b = await chromium.launch();
async function shot(name, cfg, quote, opts) {
  opts = opts || {};
  CFG = cfg; QUOTE = quote || QUOTE;
  const ctx = await b.newContext({ viewport: { width: opts.width || 430, height: 1500 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${PORT}/w/acme`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(700);
  if (opts.service) await pg.evaluate((s) => { const t = Array.from(document.querySelectorAll('#qf-services button')).find(x => x.dataset.service === s); if (t) t.click(); }, opts.service);
  await pg.waitForTimeout(200);
  if (opts.ltlFill) {
    await pg.evaluate(() => {
      const set = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      const item = document.querySelector('#qf-ltl-items .qf-ltl-item');
      if (item) {
        set(item.querySelector('.qf-ltl-qty input'), '3');
        const nums = item.querySelectorAll('.qf-ltl-dims .qf-field input');
        set(nums[1], '48'); set(nums[2], '40'); set(nums[3], '48');
        set(item.querySelector('.qf-ltl-wt .qf-field input'), '1200');
      }
    });
    await pg.waitForTimeout(200);
  }
  if (opts.drive) {
    await pg.evaluate(() => {
      const setV = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
      setV('qf-weight', '38000'); setV('qf-pickup-zip', 'Milwaukee, WI 53202'); setV('qf-delivery-zip', 'Chicago, IL 60601');
    });
    await pg.waitForTimeout(200);
  }
  if (opts.calc) { await pg.click('#qf-calc-btn').catch(() => {}); await pg.waitForTimeout(1100); }
  const file = path.join(OUT, `calc-fix-${name}.png`);
  await pg.locator('#qf-root').screenshot({ path: file }).catch(async () => { await pg.screenshot({ path: file }); });
  const facts = await pg.evaluate(() => {
    const q = (id) => document.getElementById(id);
    const vis = (e) => { if (!e) return 'MISSING'; const cs = getComputedStyle(e); return (cs.display === 'none' || e.hidden || cs.visibility === 'hidden') ? 'hidden' : 'shown'; };
    const eq = q('qf-equipment');
    const vw = window.innerWidth;
    // Detect any help cue whose painted box escapes the widget's right edge or
    // sits detached at the very top-right of the page (the P6 stray-cue symptom).
    const root = q('qf-root');
    const rb = root ? root.getBoundingClientRect() : { right: vw, top: 0 };
    const strayHelp = Array.from(document.querySelectorAll('.qf-help')).filter((h) => {
      const cs = getComputedStyle(h);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = h.getBoundingClientRect();
      if (r.width === 0) return false;
      return (r.left > rb.right - 4) || (r.top < rb.top - 4) || (r.right > vw - 2 && r.top < rb.top + 30 && cs.position === 'absolute' && h.closest('.qf-booking-summary'));
    }).map((h) => { const r = h.getBoundingClientRect(); return { host: (h.closest('[class]') || {}).className, left: Math.round(r.left), top: Math.round(r.top), pos: getComputedStyle(h).position }; });
    return {
      servicesShown: vis(q('qf-services')), serviceBtns: document.querySelectorAll('#qf-services button').length,
      rootClasses: root ? root.className : '',
      equipShown: vis(q('qf-equip-weight-row')), equipOpts: eq ? eq.options.length : -1,
      equipStatic: (() => { const s = document.querySelector('.qf-equip-static'); return s ? (vis(s) + ':' + (s.textContent || '').trim()) : 'none'; })(),
      equipSelectShown: (() => { const cs = document.querySelector('.qf-field.qf-equip-single .qf-cs, #qf-equipment'); return cs ? vis(cs) : 'n/a'; })(),
      stateEquip: (window.__qfState && window.__qfState.equipment) || 'n/a',
      ltlPieces: (q('qf-ltl-sum-pieces') || {}).textContent,
      ltlWeight: (q('qf-ltl-sum-weight') || {}).textContent,
      ltlStackCell: !!q('qf-ltl-sum-stack'),
      resultShown: vis(q('qf-result')), errorShown: vis(q('qf-error')), errorText: (q('qf-error') || {}).textContent,
      lines: Array.from(document.querySelectorAll('#qf-lines .line')).map(x => x.textContent.trim()),
      meta: (q('qf-meta') || {}).textContent,
      strayHelp,
    };
  });
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(facts));
  await ctx.close();
  return facts;
}

const R = {};
// P1 — single vs multi service
R.p1single = await shot('p1-single-service', baseCfg({ services: ['drayage'] }), null, {});
R.p1multi  = await shot('p1-multi-service', baseCfg(), null, {});
// P3 — single equip (ftl one option) vs multi equip
R.p3single = await shot('p3-single-equip', baseCfg({ services: ['ftl', 'ltl'], equipmentByService: { ftl: [{ value: 'flatbed', label: 'Flatbed' }], ltl: [{ value: 'pallet', label: 'Pallet' }] } }), null, { service: 'ftl' });
R.p3singleCalc = await shot('p3-single-equip-calc', baseCfg({ services: ['ftl', 'ltl'], equipmentByService: { ftl: [{ value: 'flatbed', label: 'Flatbed' }], ltl: [{ value: 'pallet', label: 'Pallet' }] } }), null, { service: 'ftl', drive: true, calc: true });
R.p3multi  = await shot('p3-multi-equip', baseCfg(), null, { service: 'ftl' });
R.p3dray   = await shot('p3-drayage-equip', baseCfg({ services: ['drayage'] }), null, { service: 'drayage' });
// P4 — LTL empty vs filled
R.p4empty  = await shot('p4-ltl-empty', baseCfg({ services: ['ltl', 'ftl'] }), null, { service: 'ltl' });
R.p4fill   = await shot('p4-ltl-filled', baseCfg({ services: ['ltl', 'ftl'] }), null, { service: 'ltl', ltlFill: true });
// P2 — $0 result vs normal positive
R.p2zero   = await shot('p2-result-zero', baseCfg(), { miles: 0, transit: null, result: { total: 0, lines: [] } }, { drive: true, calc: true });
R.p2norm   = await shot('p2-result-normal', baseCfg(), { miles: 118, transit: { text: '1 day' }, result: { total: 1840, lines: [{ name: 'Line haul', amount: 1520 }, { name: 'Fuel surcharge', amount: 235 }, { name: 'Accessorial', amount: 85 }] } }, { drive: true, calc: true });
// P5 — single line==total vs multi-line
R.p5one    = await shot('p5-single-line', baseCfg(), { miles: 118, transit: { text: '1 day' }, result: { total: 1520, lines: [{ name: 'Line haul', amount: 1520 }] } }, { drive: true, calc: true });
R.p5multi  = await shot('p5-multi-line', baseCfg(), { miles: 118, transit: { text: '1 day' }, result: { total: 1840, lines: [{ name: 'Line haul', amount: 1520 }, { name: 'Fuel surcharge', amount: 235 }, { name: 'Accessorial', amount: 85 }] } }, { drive: true, calc: true });
// P6 — drayage layout (booking help cue)
R.p6dray   = await shot('p6-drayage-layout', baseCfg({ services: ['drayage'] }), null, { service: 'drayage' });

await b.close();
srv.close();

// ── ASSERTIONS ────────────────────────────────────────────────────────────
const fails = [];
function ck(cond, msg) { if (!cond) fails.push(msg); }
ck(R.p1single.servicesShown === 'hidden' && /qf-single-service/.test(R.p1single.rootClasses), 'P1 single: services bar not hidden');
ck(R.p1multi.servicesShown === 'shown' && !/qf-single-service/.test(R.p1multi.rootClasses), 'P1 multi: services bar changed');
ck(/shown:Flatbed/.test(R.p3single.equipStatic), 'P3 single: static equip label not shown');
ck(R.p3singleCalc.resultShown === 'shown' && R.p3singleCalc.lines.length > 0, 'P3 single: calculate did not work with static label');
ck(R.p3multi.equipStatic === 'none' || /hidden/.test(R.p3multi.equipStatic), 'P3 multi: static label leaked into multi-equip');
ck(R.p3dray.equipOpts >= 4, 'P3 drayage: expected padded (>=4) select options');
ck(R.p4empty.ltlPieces === '—', 'P4 empty: pieces not "—" (got ' + R.p4empty.ltlPieces + ')');
ck(R.p4empty.ltlStackCell === false, 'P4: stacking cell still present');
ck(R.p4fill.ltlPieces === '3', 'P4 filled: pieces not "3" (got ' + R.p4fill.ltlPieces + ')');
ck(R.p2zero.resultShown === 'hidden' && R.p2zero.errorShown === 'shown', 'P2 zero: did not fall back to error');
ck(R.p2norm.resultShown === 'shown' && /Approx\. 118 mi/.test(R.p2norm.meta), 'P2 normal: result/meta changed');
ck(R.p5one.lines.length === 1 && /^Total/.test(R.p5one.lines[0]), 'P5 single: redundant line not suppressed (lines=' + JSON.stringify(R.p5one.lines) + ')');
ck(R.p5multi.lines.length === 4, 'P5 multi: expected 3 lines + total (got ' + R.p5multi.lines.length + ')');
ck(R.p6dray.strayHelp.length === 0, 'P6 drayage: stray help cue detected: ' + JSON.stringify(R.p6dray.strayHelp));

console.log('\n──────── RESULT ────────');
if (fails.length) { console.log('FAIL:\n' + fails.map(f => ' - ' + f).join('\n')); process.exit(1); }
console.log('ALL ASSERTIONS PASSED');
process.exit(0);
