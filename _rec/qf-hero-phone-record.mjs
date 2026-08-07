// HERO PHONE LOOP — the CUSTOMER story, 4 feature beats on a phone (520×1126).
// Serves the REAL widget SPA (src/server/public/widget.html) with mocked public
// APIs. Each beat is a real feature UI + a purposeful zoom-in (a minimal __cam
// transform-scale punch) + pause on the key interaction. Captions are live HTML
// on landing.html, synced to the final video time (not burned in here):
//
//   1. Instant quote — weight + Long Beach → Chicago + branded route map →
//      Calculate → the instant estimate.  (Your customers price their own load…)
//   2. AI answer     — "Ask about this quote" → type a question → the built-in
//      assistant answers.  (A built-in AI agent answers their questions…)
//   3. Lead capture  — Continue → name + email → the request lands as a lead.
//      (Every request lands with you as a qualified lead.)
//   4. Deposit to book — Book this load → "$500 deposit to book" → Request booking
//      → booked ✓.  (Optionally collect a deposit — or full payment…)
//
// CAMERA: the widget uses native scroll for navigation between beats; for the
// punch on the result / answer / deposit we scale a one-time wrapper around the
// page content about the target's on-screen centre (window.__cam), then reset it
// (window.__camReset) before the next scroll. transform-origin is set in wrapper-
// local coords (scrollY + viewport centre) so the target stays fixed on screen.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { chromium } from '@playwright/test';

const PUB = path.resolve('src/server/public');
const CFG = JSON.parse(fs.readFileSync(path.resolve('_rec/cfg-mono-qf.json'), 'utf8'));
const BASE_MAP = fs.readFileSync(path.resolve('_rec/na-branded-dark.png'));
const ROUTE_MAP = fs.readFileSync(path.resolve('_rec/mapstyle-dark_routes.png'));
const OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qfhero-phone-'));
const TYPES = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };

const SUGG = {
  'long beach': [{ label:'Long Beach, CA 90802', mainText:'Long Beach, CA 90802', secondaryText:'California, United States', city:'Long Beach', state:'CA', zip:'90802', country:'US', lat:33.77, lng:-118.19 }],
  'chicago':    [{ label:'Chicago, IL 60606',   mainText:'Chicago, IL 60606',   secondaryText:'Illinois, United States',   city:'Chicago',    state:'IL', zip:'60606', country:'US', lat:41.88, lng:-87.63 }],
};
const QUOTE = {
  result: { total: 3950, lines: [ { name:'Linehaul', amount:3210 }, { name:'Fuel surcharge', amount:605 }, { name:'Load / dispatch fee', amount:135 } ] },
  miles: 2015,
  transit: { text: '3–4 days' },
};
// The built-in quote assistant's answer (concise so the bubble fits the phone).
const CHAT_REPLY = "Great question! This $3,950 covers a 53′ dry van, Long Beach → Chicago — about 2,015 mi, 3–4 days transit. Fuel surcharge is already included, and detention only bills after 2 free hours. Want me to lock in this rate?";

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;
  const method = req.method || 'GET';
  if (p === '/api/public/widget/demo') { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(CFG)); return; }
  if (p === '/api/public/base-map.png') { res.writeHead(200,{'Content-Type':'image/png'}); res.end(BASE_MAP); return; }
  if (p === '/api/public/route-map.png') { res.writeHead(200,{'Content-Type':'image/png'}); res.end(ROUTE_MAP); return; }
  if (p.startsWith('/api/public/route-preview/')) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:true, miles:2015, transit:{text:'3–4 days'}, origin:{lat:33.77,lng:-118.19}, destination:{lat:41.88,lng:-87.63}, mapUrl:'/api/public/route-map.png?lane=lgb-chi&theme=dark' })); return; }
  if (p.startsWith('/api/public/autocomplete')) {
    const q = String(u.query.q||'').toLowerCase().trim();
    let out = [];
    for (const k of Object.keys(SUGG)) if (k.startsWith(q) || q.startsWith(k) || k.includes(q)) out = SUGG[k];
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ suggestions: out })); return;
  }
  if (p.startsWith('/api/public/quote/')) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(QUOTE)); return; }
  // NEW — the built-in quote assistant (result-step chat).
  if (p.startsWith('/api/public/quote-chat/')) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ reply: CHAT_REPLY })); return; }
  if (p.startsWith('/api/public/lead/')) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:true, refId:'QF-DEMO-40817', quoteUrl:'/quote/QF-DEMO-40817' })); return; }
  if (p.startsWith('/api/public/accept/')) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:true })); return; }
  if (p.startsWith('/api/public/quote-map/')) { res.writeHead(200,{'Content-Type':'image/png'}); res.end(ROUTE_MAP); return; }
  if (p === '/w/demo') { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(fs.readFileSync(path.join(PUB, u.query.raw !== undefined ? 'widget.html' : 'widget-demo-shell.html'))); return; }
  let rel = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html';
  const fp = path.join(PUB, rel);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream'}); res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 520, height: 1126 },
  deviceScaleFactor: 2,
  isMobile: false,
  recordVideo: { dir: OUTDIR, size: { width: 520, height: 1126 } },
});
const page = await ctx.newPage();
const _t0mark = Date.now();
const marks = [];
const mark = (name) => { const ms = Date.now() - _t0mark; marks.push([name, ms]); console.log('BEAT_MARK', name, ms); };
const errs = [];
page.on('pageerror', e => errs.push('pageerror:'+e.message));
page.on('console', m => { if (m.type()==='error') errs.push('console:'+m.text()); });
await page.addInitScript(() => { window.QF_TENANT_SLUG='demo'; });

// ── Staging helpers (ripple + button-press + a minimal scale-camera punch). ──
await page.addInitScript(() => {
  window.__ripple = (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:999px;border:3px solid rgba(17,17,17,.5);background:rgba(17,17,17,.10);z-index:2147483647;pointer-events:none';
    document.body.appendChild(ring);
    ring.animate([{ transform: 'scale(1)', opacity: 0.95 }, { transform: 'scale(6)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(0.4,0,0.2,1)' }).onfinish = () => ring.remove();
    return true;
  };
  window.__press = (sel, on) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return false;
    if (on) { el.dataset.__prevTransform = el.style.transform || ''; el.style.transition = 'transform 90ms ease'; el.style.transform = (el.dataset.__prevTransform || '') + ' scale(0.96)'; el.style.filter = 'brightness(0.94)'; }
    else { el.style.transform = el.dataset.__prevTransform || ''; el.style.filter = ''; }
    return true;
  };
  // Minimal scale-camera: wrap the page content ONCE, then scale that wrapper
  // about a target's on-screen centre for a purposeful punch-in. Native scroll is
  // used for navigation between beats; __cam only runs during a static hold and is
  // reset (__camReset) before the next scroll.
  window.__ensureCamWrap = () => {
    let w = document.getElementById('__qfcamwrap');
    if (w) return w;
    w = document.createElement('div');
    w.id = '__qfcamwrap';
    w.style.transformOrigin = '0 0';
    w.style.willChange = 'transform';
    while (document.body.firstChild) w.appendChild(document.body.firstChild);
    document.body.appendChild(w);
    return w;
  };
  window.__cam = (sel, s, ms) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return false;
    const w = window.__ensureCamWrap();
    const r = el.getBoundingClientRect();
    // Horizontal origin is the VIEWPORT centre (not the target's centre) so a
    // short / left-aligned target never pushes its own text off the left edge —
    // full-width cards scale symmetrically and no word clips. Vertical origin
    // tracks the target so the punch lands on it.
    const ox = (window.scrollX || 0) + window.innerWidth / 2;
    const oy = (window.scrollY || 0) + r.top + r.height / 2;
    w.style.transformOrigin = ox + 'px ' + oy + 'px';
    w.style.transition = ms ? ('transform ' + ms + 'ms cubic-bezier(0.4,0,0.2,1)') : 'none';
    void w.offsetWidth;
    w.style.transform = 'scale(' + s + ')';
    return true;
  };
  window.__camReset = (ms) => {
    const w = document.getElementById('__qfcamwrap');
    if (!w) return;
    w.style.transition = ms ? ('transform ' + ms + 'ms cubic-bezier(0.4,0,0.2,1)') : 'none';
    void w.offsetWidth;
    w.style.transform = 'none';
  };
});

const PAN_MS = 1100;
const smoothTo = (y, ms = PAN_MS) => page.evaluate(({ yy, dur }) => new Promise((resolve) => {
  const bez = (p) => {
    const cx = 3 * 0.4, bx = 3 * (0.2 - 0.4) - cx, ax = 1 - cx - bx;
    const cyy = 0, byy = 3 * (1 - 0) - cyy, ayy = 1 - cyy - byy;
    let t = p;
    for (let i = 0; i < 6; i++) {
      const x = ((ax * t + bx) * t + cx) * t - p;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6) break;
      t -= x / d;
    }
    return ((ayy * t + byy) * t + cyy) * t;
  };
  const startY = window.scrollY;
  const dy = yy - startY;
  if (Math.abs(dy) < 2 || dur <= 0) { window.scrollTo(0, yy); return resolve(); }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    window.scrollTo(0, Math.round(startY + dy * bez(p)));
    if (p < 1) requestAnimationFrame(step); else resolve();
  };
  requestAnimationFrame(step);
}), { yy: y, dur: ms });
const wait = (ms) => page.waitForTimeout(ms);
const topOf = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1; }, sel);

await page.goto(`http://localhost:${port}/w/demo?raw=1&mapStyle=dark_routes&mapTheme=dark`, { waitUntil:'networkidle' });
await wait(300);

// ══ BEAT 1 — INSTANT QUOTE ══
mark('m1-quote');
await wait(500);
await page.locator('#qf-weight').click();
await page.locator('#qf-weight').pressSequentially('42000', { delay: 40 });
await wait(200);
await page.locator('#qf-pickup-zip').click();
await page.locator('#qf-pickup-zip').pressSequentially('Long Beach', { delay: 38 });
await wait(460);
await page.locator('#qf-pickup-suggestions .qf-suggestion').first().click();
await wait(240);
await page.locator('#qf-delivery-zip').click();
await page.locator('#qf-delivery-zip').pressSequentially('Chicago', { delay: 38 });
await wait(460);
await page.locator('#qf-delivery-suggestions .qf-suggestion').first().click();
await wait(220);
// Reveal + hold on the branded route map.
const mapTop = await topOf('#qf-map-card');
if (mapTop >= 0) await smoothTo(Math.max(0, mapTop - 120));
await page.waitForFunction(() => { const i=document.getElementById('qf-map-img'); return i && /route-map\.png/.test(i.src); }, { timeout: 4000 }).catch(()=>{});
await wait(1100);
// Calculate — ripple + pressed → #qf-result.
await page.locator('#qf-calc-btn').scrollIntoViewIfNeeded();
await wait(200);
await page.evaluate(() => window.__ripple('#qf-calc-btn'));
await wait(170);
await page.evaluate(() => window.__press('#qf-calc-btn', true));
await wait(240);
await page.locator('#qf-calc-btn').click();
await page.evaluate(() => window.__press('#qf-calc-btn', false));
await page.waitForSelector('#qf-result', { state:'visible', timeout: 4000 });
await wait(240);
// Centre the total, then PUNCH-IN on the instant estimate.
const resTop = await topOf('#qf-result');
await smoothTo(Math.max(0, resTop - 150));
await wait(500);
await page.evaluate(() => window.__cam('#qf-total-box, .qf-total-box', 1.24, 900));
await wait(2400); // hold on the branded total
await page.evaluate(() => window.__camReset(600));
await wait(500);

// ══ BEAT 2 — AI ANSWER: ask the built-in assistant about the quote. ══
mark('m2-chat');
// Open "Ask about this quote".
await page.locator('#qf-rchat-open-btn').scrollIntoViewIfNeeded();
await wait(200);
await page.evaluate(() => window.__ripple('#qf-rchat-open-btn'));
await wait(240);
await page.locator('#qf-rchat-open-btn').click();
await page.waitForSelector('#qf-rchat', { state:'visible', timeout: 4000 }).catch(()=>{});
await wait(500);
// Type a customer question + send.
const chatTop = await topOf('#qf-rchat');
if (chatTop >= 0) await smoothTo(Math.max(0, chatTop - 90));
await wait(300);
await page.locator('#qf-rchat-input').click();
await page.locator('#qf-rchat-input').pressSequentially("What's the transit time, and is fuel included?", { delay: 26 });
await wait(260);
await page.evaluate(() => window.__ripple('#qf-rchat-send'));
await wait(200);
await page.locator('#qf-rchat-send').click();
// Wait for the assistant answer bubble (last non-user bubble) to render.
await page.waitForFunction(() => {
  const msgs = document.getElementById('qf-rchat-msgs');
  if (!msgs) return false;
  const bubbles = msgs.children;
  const last = bubbles[bubbles.length - 1];
  return last && /transit|dry van|fuel/i.test(last.textContent || '') && !/Thinking/i.test(last.textContent || '');
}, { timeout: 6000 }).catch(()=>{});
await wait(400);
// Scroll the answer into view + PUNCH-IN on the assistant bubble.
const msgsTop = await topOf('#qf-rchat-msgs');
if (msgsTop >= 0) await smoothTo(Math.max(0, msgsTop - 120));
await wait(400);
await page.evaluate(() => {
  const msgs = document.getElementById('qf-rchat-msgs');
  const last = msgs && msgs.lastElementChild;
  if (last) window.__cam(last, 1.2, 900);
});
await wait(2600); // hold on the AI answer
await page.evaluate(() => window.__camReset(600));
await wait(500);

// ══ BEAT 3 — LEAD CAPTURE ══
mark('m3-lead');
await page.locator('#qf-continue-btn').scrollIntoViewIfNeeded();
await wait(200);
await page.evaluate(() => window.__ripple('#qf-continue-btn'));
await wait(240);
await page.locator('#qf-continue-btn').click();
await page.evaluate(() => { window.scrollTo(0, 0); });
await wait(360);
await page.locator('#qf-c-name').click();
await page.locator('#qf-c-name').pressSequentially('Marcus Webb', { delay: 26 });
await wait(120);
await page.locator('#qf-c-email').click();
await page.locator('#qf-c-email').pressSequentially('marcus@vantagefreight.com', { delay: 22 });
await wait(220);
await page.evaluate(() => window.__ripple('#qf-submit-btn'));
await wait(220);
await page.locator('#qf-submit-btn').click();
await page.waitForSelector('#qf-step-thanks.active', { timeout: 4000 }).catch(()=>{});
await wait(1500); // hold on the "thanks — qualified lead" confirmation

// ══ BEAT 4 — DEPOSIT TO BOOK ══
mark('m4-book');
await page.evaluate(() => { window.scrollTo(0, 0); });
await page.waitForSelector('.qf-book-btn', { timeout: 4000 }).catch(()=>{});
const bookTop = await topOf('.qf-book-btn');
if (bookTop >= 0) await smoothTo(Math.max(0, bookTop - 90));
await wait(500);
await page.evaluate(() => window.__ripple('.qf-book-btn'));
await wait(240);
await page.locator('.qf-book-btn').click();
await wait(600);
// Frame the deposit line + Request booking button, then PUNCH-IN on the deposit.
const depTop = await topOf('.qf-book-deposit');
if (depTop >= 0) await smoothTo(Math.max(0, depTop - 300));
await wait(400);
await page.evaluate(() => window.__cam('.qf-book-deposit', 1.1, 850));
await wait(2200); // hold on "$500 deposit to book"
await page.evaluate(() => window.__camReset(500));
await wait(400);
// Request booking → booked ✓.
await page.evaluate(() => window.__ripple('.qf-book-send'));
await wait(220);
await page.locator('.qf-book-send').click();
await page.waitForSelector('.qf-book-done', { timeout: 4000 }).catch(()=>{});
await wait(400);
const doneTop = await topOf('.qf-book-done');
if (doneTop >= 0) await smoothTo(Math.max(0, doneTop - 380));
await wait(1600); // closing hold on the booked confirmation (crossfade-wraps to the opening)

console.log('MARKS', JSON.stringify(marks));
console.log('ERRS', errs.length, errs.slice(0,8));
await ctx.close();
await browser.close();
server.close();

const webm = fs.readdirSync(OUTDIR).find(f => f.endsWith('.webm'));
const outPath = path.resolve('_rec/qf-hero-phone-raw.webm');
fs.copyFileSync(path.join(OUTDIR, webm), outPath);
console.log('RAW_WEBM', outPath, fs.statSync(outPath).size, '520x1126');
