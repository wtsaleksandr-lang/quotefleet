// HERO PHONE LOOP — customer quote-generation on a phone (390×844).
// Adapted from qf-flow-record.mjs: serves the REAL src/server/public widget SPA
// with mocked public APIs (no auth/DB). Drives weight → pickup → delivery →
// branded route map → Calculate → hold on the estimate. Opening + closing holds
// are static so the encode's crossfade-wrap loops seamlessly.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { chromium } from '@playwright/test';

const PUB = path.resolve('src/server/public');
// Durable, self-contained config (QuoteFleet brand + mono/"Clarity" theme +
// booking enabled). Regenerate with: tsx _rec/_gen-cfg-mono-qf.mjs _rec/cfg-mono-qf.json
const CFG = JSON.parse(fs.readFileSync(path.resolve('_rec/cfg-mono-qf.json'), 'utf8'));
// LOCKED COMBO — Clarity (mono) calculator + DARK route map (dark_routes). The
// mono preset renders the map overlays as frosted-white "Uber-style" badges
// (semi-opaque white + blur, dark text) which are DESIGNED to float over a dark
// map — so the dark base + dark route read as the intended pairing, not a clash.
// na-branded-dark = dark NA base (no route); mapstyle-dark_routes = dark map with
// the cobalt Long Beach→Chicago route + A/B pins (matches the demo lane).
const BASE_MAP = fs.readFileSync(path.resolve('_rec/na-branded-dark.png'));
const ROUTE_MAP = fs.readFileSync(path.resolve('_rec/mapstyle-dark_routes.png'));
// FIX 6 — the customer auto-reply lands in a staged phone-inbox card at the end
// of the loop ("to the user's mailbox"). Rendered as ON-BRAND HTML (QuoteFleet ·
// Marcus Webb · Long Beach → Chicago · $3,950) so it matches the demo exactly —
// the pre-rendered PNG asset is addressed to a different sample customer/brand.
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

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;
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
  // Money-moment endpoints: lead capture → refId, deposit-book accept, route
  // snapshot on the thanks step. (Chat kept out of the loop for tightness.)
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
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: false,
  recordVideo: { dir: OUTDIR, size: { width: 390, height: 844 } },
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror:'+e.message));
page.on('console', m => { if (m.type()==='error') errs.push('console:'+m.text()); });
await page.addInitScript(() => { window.QF_TENANT_SLUG='demo'; });

// ── Staging helpers (ripple + button-press + email-inbox overlay) installed
// before page scripts (FIX 3, 4, 6). ──
await page.addInitScript(() => {
  // FIX 3 — click ripple over an element (viewport coords; the phone widget
  // uses native scroll, no camera transform, so getBoundingClientRect is direct).
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
  // FIX 4 — a brief visible "pressed" state on a button so press→result reads.
  window.__press = (sel, on) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return false;
    if (on) { el.dataset.__prevTransform = el.style.transform || ''; el.style.transition = 'transform 90ms ease'; el.style.transform = (el.dataset.__prevTransform || '') + ' scale(0.96)'; el.style.filter = 'brightness(0.94)'; }
    else { el.style.transform = el.dataset.__prevTransform || ''; el.style.filter = ''; }
    return true;
  };
  // FIX 6 — "Email sent ✓" toast → phone-inbox card with the ON-BRAND auto-reply
  // (QuoteFleet · Marcus Webb · Long Beach → Chicago · $3,950), built as HTML so
  // it matches the demo exactly.
  window.__emailOverlay = () => {
    const ov = document.createElement('div');
    ov.id = '__qfemail';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:#eef0f3;display:flex;flex-direction:column;align-items:center;font:400 14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;color:#18181b;opacity:0;transition:opacity 320ms ease';
    // Green "sent" toast
    const toast = document.createElement('div');
    toast.style.cssText = 'margin-top:46px;display:inline-flex;align-items:center;gap:9px;padding:11px 18px;border-radius:999px;background:#0f7a3d;color:#fff;font-weight:700;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.2);transform:translateY(-22px);opacity:0;transition:transform 420ms cubic-bezier(0.4,0,0.2,1),opacity 420ms ease';
    toast.innerHTML = '<span style="display:inline-flex;width:20px;height:20px;border-radius:999px;background:rgba(255,255,255,.22);align-items:center;justify-content:center">✓</span> Email sent to your inbox';
    ov.appendChild(toast);
    // Inbox message card
    const card = document.createElement('div');
    card.style.cssText = 'margin-top:20px;width:344px;max-width:90vw;background:#fff;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.16);border:1px solid rgba(0,0,0,.06);overflow:hidden;transform:translateY(26px);opacity:0;transition:transform 480ms cubic-bezier(0.4,0,0.2,1),opacity 480ms ease';
    // Sender row
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid #eee';
    hdr.innerHTML = '<span style="flex:0 0 auto;display:inline-flex;width:36px;height:36px;border-radius:999px;background:#111;color:#fff;font-weight:800;align-items:center;justify-content:center;font-size:13px;letter-spacing:.02em">QF</span>'
      + '<div style="display:flex;flex-direction:column;min-width:0"><span style="font-weight:700;font-size:13px">QuoteFleet <span style="color:#9aa0a6;font-weight:500">&lt;quotes@quotefleet.net&gt;</span></span>'
      + '<span style="color:#6b7280;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Your quote QF-DEMO-40817 — Long Beach → Chicago</span></div>'
      + '<span style="margin-left:auto;color:#9aa0a6;font-size:12px;flex:0 0 auto">now</span>';
    // Email body
    const body = document.createElement('div');
    body.style.cssText = 'padding:16px 16px 18px';
    body.innerHTML =
      '<div style="font-weight:800;font-size:15px;letter-spacing:-.01em;margin-bottom:2px">QuoteFleet</div>'
      + '<div style="font-size:16px;font-weight:700;margin:8px 0 6px">Thanks for your request, Marcus.</div>'
      + '<div style="color:#4b5563;font-size:13px;margin-bottom:12px">Here’s your instant estimate for <strong>Long Beach, CA → Chicago, IL</strong>. Our team will confirm availability shortly.</div>'
      + '<div style="border:1px solid #ececec;border-radius:12px;padding:13px 14px;margin-bottom:14px">'
      +   '<div style="color:#6b7280;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">Estimated total</div>'
      +   '<div style="font-size:26px;font-weight:800;letter-spacing:-.02em">$3,950.00</div>'
      +   '<div style="color:#6b7280;font-size:12px;margin-top:4px">53′ Dry Van · ~2,015 mi · 3–4 days transit</div>'
      + '</div>'
      + '<div style="display:block;text-align:center;background:#111;color:#fff;font-weight:700;font-size:14px;padding:12px;border-radius:10px">View your full quote →</div>'
      + '<div style="color:#9aa0a6;font-size:11px;margin-top:12px">Reply to this email and the QuoteFleet team will get right back to you.</div>';
    card.appendChild(hdr);
    card.appendChild(body);
    ov.appendChild(card);
    document.body.appendChild(ov);
    requestAnimationFrame(() => { ov.style.opacity = '1'; });
    setTimeout(() => { toast.style.transform = 'translateY(0)'; toast.style.opacity = '1'; }, 120);
    setTimeout(() => { card.style.transform = 'translateY(0)'; card.style.opacity = '1'; }, 460);
    return true;
  };
});

// Calm, premium camera pans: a CUSTOM eased scroll (~1.1s, Material-standard
// cubic-bezier(0.4,0,0.2,1)) that we AWAIT to completion — instead of the
// browser's snappy native smooth scroll — so each move between beats glides and
// the eye settles before the next transition. Each pan is fully awaited, so the
// wait() that follows is pure hold on top of the completed move.
const PAN_MS = 1100;
const smoothTo = (y, ms = PAN_MS) => page.evaluate(({ yy, dur }) => new Promise((resolve) => {
  const bez = (p) => {
    // Solve x=p on cubic-bezier(0.4,0,0.2,1) for t, then return its y.
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

// ?mapStyle=dark_routes pins the LOCKED dark route map (raw=1 lets the demo
// showcase read the override); theme=mono comes from the cfg's themePreset.
await page.goto(`http://localhost:${port}/w/demo?raw=1&mapStyle=dark_routes&mapTheme=dark`, { waitUntil:'networkidle' });
await wait(300);

// 1) Opening static hold (loop-in point): header + empty form + branded base map.
await wait(600);

// 2) Weight.
// Typing is mechanical time — the message is "only three fields", not "watch
// me type". Faster keystrokes actually SELL the speed better and buy seconds
// back for the quote at the end.
await page.locator('#qf-weight').click();
await page.locator('#qf-weight').pressSequentially('42000', { delay: 40 });
await wait(220);

// 3) Pickup -> Long Beach, CA.
await page.locator('#qf-pickup-zip').click();
await page.locator('#qf-pickup-zip').pressSequentially('Long Beach', { delay: 40 });
await wait(480);
await page.locator('#qf-pickup-suggestions .qf-suggestion').first().click();
await wait(260);

// 4) Delivery -> Chicago, IL (triggers branded route map).
await page.locator('#qf-delivery-zip').click();
await page.locator('#qf-delivery-zip').pressSequentially('Chicago', { delay: 40 });
await wait(480);
await page.locator('#qf-delivery-suggestions .qf-suggestion').first().click();
await wait(240);

// 5) Reveal + hold on the branded route map.
const mapTop = await page.evaluate(() => { const c=document.getElementById('qf-map-card'); return c ? Math.round(c.getBoundingClientRect().top + window.scrollY) : 0; });
await smoothTo(Math.max(0, mapTop - 120));
await page.waitForFunction(() => { const i=document.getElementById('qf-map-img'); return i && /route-map\.png/.test(i.src); }, { timeout: 4000 }).catch(()=>{});
// The branded route map is a real selling point ("it's YOUR brand, not ours")
// and survives mobile downscaling because it's a large shape. Give it a beat.
await wait(1200);

// 6) Calculate (FIX 3 + 4): ripple the CTA, then a brief visible "pressed" hold
// BEFORE #qf-result appears, so the press→quote causal chain reads clearly.
await page.locator('#qf-calc-btn').scrollIntoViewIfNeeded();
await wait(220);
await page.evaluate(() => window.__ripple('#qf-calc-btn'));
await wait(180);
await page.evaluate(() => window.__press('#qf-calc-btn', true));
await wait(250); // pressed hold — the button is visibly down before the quote
await page.locator('#qf-calc-btn').click();
await page.evaluate(() => window.__press('#qf-calc-btn', false));
await page.waitForSelector('#qf-result', { state:'visible', timeout: 4000 });
await wait(260);

// 7) THE INSTANT QUOTE — frame + hold the branded total + line items. This is
// still a payoff, but no longer the SOLE one: the loop now continues to the
// carrier's win (the booking). So it's a firm read (~2.4s) rather than the old
// 5s dwell — the branded total + line items + transit are legible, then we move.
const resTop = await page.evaluate(() => { const r=document.getElementById('qf-result'); return r ? Math.round(r.getBoundingClientRect().top + window.scrollY) : 0; });
await smoothTo(Math.max(0, resTop - 150));
await wait(1900);

// 8) TRANSIT TIMELINE GLIDE — the truck slides pickup → delivery just under the
// total. Nudge the camera so the timeline row sits center-frame and the glide
// reads. It re-runs its width/translate transition on reveal; the scroll lands
// it while the truck is still travelling.
const tlTop = await page.evaluate(() => { const t=document.getElementById('qf-timeline'); return (t && !t.hidden) ? Math.round(t.getBoundingClientRect().top + window.scrollY) : -1; });
if (tlTop >= 0) { await smoothTo(Math.max(0, tlTop - 300)); }
await wait(1400);

// 9) CONTINUE → contact. Quick capture (name + email) — the message is "one tap
// to lock it in", not "fill a form", so keep it brisk.
await page.locator('#qf-continue-btn').scrollIntoViewIfNeeded();
await wait(200);
await page.evaluate(() => window.__ripple('#qf-continue-btn')); // FIX 3
await wait(240);
await page.locator('#qf-continue-btn').click();
// FIX 5 — the contact step renders at scrollTop 0; jump scroll to 0 INSTANTLY
// while it's mid-swap (before its fade-in) so NO upward travel is ever visible.
await page.evaluate(() => window.scrollTo(0, 0));
await wait(360);
await page.locator('#qf-c-name').click();
await page.locator('#qf-c-name').pressSequentially('Marcus Webb', { delay: 26 });
await wait(120);
await page.locator('#qf-c-email').click();
await page.locator('#qf-c-email').pressSequentially('marcus@vantagefreight.com', { delay: 22 });
await wait(200);
await page.evaluate(() => window.__ripple('#qf-submit-btn')); // FIX 3
await wait(220);
await page.locator('#qf-submit-btn').click();
await page.waitForSelector('#qf-step-thanks.active', { timeout: 4000 }).catch(()=>{});
await wait(500);

// 10) BOOK THIS LOAD — the money moment. Reveal the booking panel, glide down to
// the "$500 deposit to book" line + Request booking CTA, hold so it reads.
// FIX 5 — the thanks step renders at top; instant reset (no upward glide), then
// proceed strictly DOWNWARD to the booking CTA.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForSelector('.qf-book-btn', { timeout: 4000 }).catch(()=>{});
const bookTop = await page.evaluate(() => { const b=document.querySelector('.qf-book-btn'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : 0; });
await smoothTo(Math.max(0, bookTop - 90));
await wait(600);
await page.evaluate(() => window.__ripple('.qf-book-btn')); // FIX 3
await wait(240);
await page.locator('.qf-book-btn').click();
await wait(600);
// Frame the deposit line + Request booking button (bottom of the panel).
const depTop = await page.evaluate(() => { const d=document.querySelector('.qf-book-deposit'); return d ? Math.round(d.getBoundingClientRect().top + window.scrollY) : 0; });
await smoothTo(Math.max(0, depTop - 330));
await wait(1500);

// 11) REQUEST BOOKING → BOOKED ✓ — the payoff. Green "Booking requested —
// QuoteFleet will confirm." This is the new closing hold; the encode's
// crossfade-wrap dissolves it back into the opening empty form.
await page.evaluate(() => window.__ripple('.qf-book-send')); // FIX 3
await wait(220);
await page.locator('.qf-book-send').click();
await page.waitForSelector('.qf-book-done', { timeout: 4000 }).catch(()=>{});
await wait(400);
// Center the green "Booking requested — QuoteFleet will confirm." confirmation
// so the win sits mid-frame; brief read before the mailbox scene.
const doneTop = await page.evaluate(() => { const d=document.querySelector('.qf-book-done'); return d ? Math.round(d.getBoundingClientRect().top + window.scrollY) : 0; });
await smoothTo(Math.max(0, doneTop - 430));
await wait(1500);

// FIX 6 — the confirmation email lands in the customer's mailbox. Overlay a
// staged "Email sent ✓" toast animating into a phone-inbox card showing the
// rendered auto-reply email. This is the closing STATIC hold that the encode's
// crossfade-wrap dissolves back into the opening empty form.
await page.evaluate(() => window.scrollTo(0, 0));
await page.evaluate(() => window.__emailOverlay());
await wait(2400);

console.log('ERRS', errs.length, errs.slice(0,8));
await ctx.close();
await browser.close();
server.close();

const webm = fs.readdirSync(OUTDIR).find(f => f.endsWith('.webm'));
const outPath = path.resolve('_rec/qf-hero-phone-raw.webm');
fs.copyFileSync(path.join(OUTDIR, webm), outPath);
console.log('RAW_WEBM', outPath, fs.statSync(outPath).size, '390x844');
