// HERO LAPTOP LOOP — rate-sheet upload flow on a laptop screen (1280×800), LIGHT
// theme + DYNAMIC ZOOM choreography. Serves the REAL dashboard SPA with mocked
// tenant APIs, forces LIGHT theme, drives a VISIBLE drag-drop → staged
// processing → animated review reveal → leads money-moment → automated
// follow-up scene → settle.
//
// CAMERA: instead of window scrolling, a CSS transform on #app-shell acts as a
// camera. transform-origin is pinned to the shell's top-left (= document 0,0
// while scroll is locked at 0), and every beat sets
//   translate(896 - s*cx, 560 - s*cy) scale(s)
// which maps the target center (cx,cy in DOC coords) to the 1792×1120 frame
// center at zoom s. window.__rect INVERTS the live camera transform so element
// measurements are always in stable DOCUMENT coords — which lets the camera go
// straight zoom→pan→zoom with NO bounce back to wide mid-sequence (the old flow
// pulled to scale 1.0 before every measure; removed). body overflow is hidden so
// the scaled shell clips to the frame, and native scroll stays 0.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const _require = createRequire('C:/Users/Owner/.codex/quotefleet/package.json');
const _pw = await import(pathToFileURL(_require.resolve('@playwright/test')).href);
const chromium = _pw.chromium || _pw.default?.chromium;

const PUB = path.resolve('src/server/public');
const CFG = {}; // /api/public/widget/* payload — unused by the ingest surface.
const OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qfhero-laptop-'));
const TYPES = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };

const ME = {
  user: { name: 'Alex Morgan', email: 'dispatch@quotefleet.net', role: 'tenant' },
  tenant: { name: 'QuoteFleet', slug: 'quotefleet', hostedUrl: 'https://quotefleet.net/w/demo', needsOnboarding: false, plan: 'pro' },
  trial: null,
};
// Brand payload for the widget-settings / automated-follow-up scene (FIX 7).
// followUp is SEEDED (enabled + preset 'gentle') so the card renders POPULATED;
// the recorder then clicks "Standard" for a visible selection change. quoteShare
// on so the Quote-actions card is complete.
const BRAND = {
  displayName: 'QuoteFleet',
  requireEmail: true,
  requirePhone: false,
  showQuoteBeforeContact: false,
  showPoweredBy: true,
  featuresJson: {
    quoteShare: true,
    followUp: { enabled: true, preset: 'gentle', day1: 3, day2: 7, day3: 12, discountPct: 5 },
  },
};
const RATE_CARDS = [
  { id:'r1', service:'drayage', equipment:'container_40hc', label:"40' HC import drayage", enabled:true,  ratePerMile:0, minimumCharge:475, flatFee:520, fuelSurchargePct:25, marginPct:12 },
  { id:'r3', service:'ftl',     equipment:'dryvan',         label:"53' Dry Van",             enabled:true,  ratePerMile:2.10, minimumCharge:350, flatFee:null, fuelSurchargePct:28, marginPct:15 },
];
const PARSED = {
  summary: "Extracted QuoteFleet's Q3 drayage & truckload rate sheet — 5 rate cards, 3 accessorials, 2 lane zones.",
  confidence: 'high',
  warnings: ['Fuel surcharge on the flatbed line was blank — defaulted to 28%. Confirm before applying.'],
  rateCards: [
    { label:"40' HC import drayage", service:'drayage', equipment:'container_40hc', minimumCharge:475, flatFee:520, fuelSurchargePct:25, marginPct:12 },
    { label:"20' standard drayage",  service:'drayage', equipment:'container_20',   minimumCharge:395, flatFee:430, fuelSurchargePct:25, marginPct:12 },
    { label:"53' Dry Van",           service:'ftl',     equipment:'dryvan',  ratePerMile:2.10, minimumCharge:350, fuelSurchargePct:28, marginPct:15 },
    { label:"53' Reefer",            service:'ftl',     equipment:'reefer',  ratePerMile:2.65, minimumCharge:450, fuelSurchargePct:30, marginPct:15 },
    { label:'Flatbed',               service:'ftl',     equipment:'flatbed', ratePerMile:2.45, minimumCharge:500, fuelSurchargePct:28, marginPct:14 },
  ],
  accessorials: [
    { code:'chassis',   label:'Chassis rental',              kind:'per_day',  amount:35 },
    { code:'prepull',   label:'Pre-pull / yard storage',     kind:'flat',     amount:90 },
    { code:'detention', label:'Detention (after 2 free hrs)', kind:'per_hour', amount:65 },
  ],
  laneZones: [
    { label:'LA / Long Beach port complex',      anchorPortCode:'USLAX', radiusMiles:60, flatPrice:520 },
    { label:'Inland Empire (Ontario / Fontana)', anchorCity:'Ontario',   radiusMiles:35, flatPrice:610 },
  ],
};

let ingestJob = null;
const READY_POLLS = 5;

const _now = Date.now();
const _iso = (minsAgo) => new Date(_now - minsAgo * 60000).toISOString();
const LEADS = [
  { refId:'QF-2F19', customerName:'Dana Reyes',    customerEmail:'dana@brightpath.co',    service:'ftl',     equipment:'reefer',        pickupCity:'Fresno',   deliveryCity:'Denver',   quotedTotal:2870, status:'replied', createdAt:_iso(52) },
  { refId:'QF-2F08', customerName:'Sam Okafor',    customerEmail:'sam@midwestparts.com',  service:'drayage', equipment:'container_40hc', pickupCity:'Savannah', deliveryCity:'Atlanta',  quotedTotal:640,  status:'new',     createdAt:_iso(96) },
  { refId:'QF-2EF7', customerName:'Lena Whitfield',customerEmail:'lena@coastsupply.com',  service:'ftl',     equipment:'dryvan',        pickupCity:'Dallas',   deliveryCity:'Phoenix',  quotedTotal:1920, status:'won',     createdAt:_iso(180) },
  { refId:'QF-2EE1', customerName:'Priya Nair',    customerEmail:'priya@harborlink.io',   service:'ltl',     equipment:'pallet',        pickupCity:'Newark',   deliveryCity:'Columbus', quotedTotal:410,  status:'replied', createdAt:_iso(240) },
  { refId:'QF-2ED3', customerName:'Marcus Hill',   customerEmail:'marcus@ridgeline.co',   service:'ftl',     equipment:'flatbed',       pickupCity:'Houston',  deliveryCity:'Memphis',  quotedTotal:1740, status:'new',     createdAt:_iso(310) },
  { refId:'QF-2EC9', customerName:'Tara Nguyen',   customerEmail:'tara@pacificpine.com',  service:'drayage', equipment:'container_20',  pickupCity:'Oakland',  deliveryCity:'Sacramento',quotedTotal:520, status:'replied', createdAt:_iso(365) },
  { refId:'QF-2EBF', customerName:'Owen Brooks',   customerEmail:'owen@delta-freight.io', service:'ftl',     equipment:'reefer',        pickupCity:'Miami',    deliveryCity:'Charlotte',quotedTotal:2410, status:'won',     createdAt:_iso(420) },
  { refId:'QF-2EB4', customerName:'Grace Alvarez', customerEmail:'grace@summitcargo.com', service:'ltl',     equipment:'pallet',        pickupCity:'Portland', deliveryCity:'Boise',    quotedTotal:380,  status:'new',     createdAt:_iso(505) },
];

function handle(req, res) {
  const u = url.parse(req.url, true);
  const p = u.pathname;
  const method = req.method || 'GET';
  const J = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

  // Recorder-only control: reset the ingest job so the dropzone renders empty
  // again for the seamless loop-out (beat 9 returns to the opening dropzone).
  if (p === '/rec/reset-ingest') { ingestJob = null; return J({ ok: true }); }

  if (p === '/api/auth/me') return J(ME);
  if (p === '/api/tenant/setup-status') return J({ rates: true, brand: true });
  if (p === '/api/tenant/rate-cards') return J({ rateCards: RATE_CARDS });
  if (p === '/api/tenant/preview-url') return J({ previewUrl: '' });
  // Latest main's renderLeads is server-backed + paginated: it gates the empty
  // state on `total`, so the mock MUST return total/page/pageSize, not just leads.
  if (p === '/api/tenant/leads') return J({ leads: LEADS, total: LEADS.length, page: 1, pageSize: 25 });

  // ── Widget-settings / automated-follow-up scene (FIX 7) ──
  if (p === '/api/tenant/embed') return J({ directLink: 'https://quotefleet.net/w/demo', origin: 'https://quotefleet.net', slug: 'demo' });
  if (p === '/api/tenant/access') return J({ accessMode: 'public', links: [] });
  if (p === '/api/tenant/brand') {
    if (method === 'PUT') {
      // Merge-PUT persist of the follow-up patch — echo the merged brand so the
      // tile-click's save() resolves cleanly (toastOk('Saved')).
      return J({ ok: true, brand: BRAND });
    }
    return J({ brand: BRAND });
  }

  // ── AI rate-sheet ingest ──
  if (p === '/api/tenant/ingest') {
    if (method === 'POST') {
      ingestJob = { id: 1, filename: 'QuoteFleet-Q3-Rates.pdf', mimeType: 'application/pdf', sizeBytes: 214000, createdAt: new Date().toISOString(), polls: 0 };
      return J({ ok: true, jobId: 1, status: 'parsing' });
    }
    if (!ingestJob) return J({ jobs: [] });
    const j = ingestJob;
    const status = j.polls < READY_POLLS ? 'parsing' : 'ready_for_review';
    return J({ jobs: [{ id: j.id, filename: j.filename, mimeType: j.mimeType, sizeBytes: j.sizeBytes, status, appliedAt: null, createdAt: j.createdAt }] });
  }
  if (/^\/api\/tenant\/ingest\/\d+\/autocheck$/.test(p)) {
    return J({ total: 12, clean: 12, flaggedCount: 0, flagged: [] });
  }
  if (p.startsWith('/api/tenant/ingest/')) {
    if (ingestJob) {
      ingestJob.polls++;
      const ready = ingestJob.polls >= READY_POLLS;
      return J({ job: {
        id: ingestJob.id, filename: ingestJob.filename, mimeType: ingestJob.mimeType, sizeBytes: ingestJob.sizeBytes,
        status: ready ? 'ready_for_review' : 'parsing',
        parsed: ready ? PARSED : null,
        errorMessage: null, appliedAt: null, createdAt: ingestJob.createdAt,
      } });
    }
    return J({ job: null });
  }

  if (p.startsWith('/api/public/widget/')) return J(CFG);
  if (p.startsWith('/api/')) return J({});

  if (p === '/app' || p.startsWith('/app/')) {
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(PUB, 'app.html')));
    return;
  }
  let rel = decodeURIComponent(p).replace(/^\/+/, '') || 'app.html';
  const fp = path.join(PUB, rel);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' }); res.end(fs.readFileSync(fp));
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { try { handle(req, res); } catch (e) { res.writeHead(500); res.end('err'); } });
});
const PORT = Number(process.env.REC_PORT || 0);
await new Promise(r => server.listen(PORT, r));
const port = server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1792, height: 1120 },
  deviceScaleFactor: 2,                       // 2x render → crisp antialiasing when captured
  recordVideo: { dir: OUTDIR, size: { width: 1792, height: 1120 } }, // video res == CSS viewport (Playwright screencast is CSS-px; DSF does NOT boost video res)
});
// CRISPNESS: the video is captured at the CSS-viewport resolution (1792 wide), so
// on a retina landing page (~786→972 CSS box → up to ~1944 physical px) the source
// is large enough to avoid the upscale blur the old 1280-wide loop suffered.
// The camera math uses a 1792×1120 LOGICAL frame → centre (896,560), height 1120.
const page = await ctx.newPage();
const _t0mark = Date.now(); // ~video-start reference; used to compute the encode trim (T0) to the tight beat-1 framing
const errs = [];
page.on('pageerror', e => errs.push('pageerror:' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text()); });

const wait = (ms) => page.waitForTimeout(ms);

// Force LIGHT theme before first paint (no dark flash).
await page.addInitScript(() => { try { localStorage.setItem('qf-theme', 'light'); } catch (e) {} });

// ── Staging helpers (ripple / drag-chip / drag-events) — installed before page
// scripts so they're available all through the recording (FIX 2 + FIX 3). ──
await page.addInitScript(() => {
  // FIX 3 — click ripple. A dark ring scales + fades over an element; the REAL
  // click fires ~280ms later (recorder-side). Uses RAW getBoundingClientRect so
  // the ring aligns with the element AS RENDERED (camera-transform aware).
  window.__ripple = (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:999px;border:3px solid rgba(17,17,17,.55);background:rgba(17,17,17,.10);z-index:2147483647;pointer-events:none';
    document.body.appendChild(ring);
    ring.animate([{ transform: 'scale(1)', opacity: 0.95 }, { transform: 'scale(6)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(0.4,0,0.2,1)' }).onfinish = () => ring.remove();
    return true;
  };
  // FIX 2 — a floating "file chip" (PDF icon + filename) that drags from off the
  // top-right into the dropzone. position:fixed → viewport coords.
  window.__spawnChip = () => {
    const c = document.createElement('div');
    c.id = '__qfchip';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;display:flex;align-items:center;gap:9px;padding:10px 13px;border-radius:11px;background:#fff;box-shadow:0 16px 40px rgba(0,0,0,.24);border:1px solid rgba(0,0,0,.08);font:600 13px/1.15 system-ui,Segoe UI,Roboto,sans-serif;color:#18181b;white-space:nowrap;transform:translate(1150px,-72px) scale(.96);transition:transform 950ms cubic-bezier(0.4,0,0.2,1);pointer-events:none';
    c.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:32px;border-radius:5px;background:#d5372b;color:#fff;font:700 9px/1 system-ui;letter-spacing:.02em">PDF</span><span>QuoteFleet-Q3-Rates.pdf</span>';
    document.body.appendChild(c);
    window.__chip = c;
    return true;
  };
  window.__chipTo = (x, y) => { if (window.__chip) window.__chip.style.transform = 'translate(' + (x - 96) + 'px,' + (y - 22) + 'px) scale(1)'; };
  window.__chipFade = () => {
    const c = window.__chip; if (!c) return;
    c.style.transition = 'opacity 240ms ease, transform 240ms ease';
    c.style.opacity = '0';
    c.style.transform = c.style.transform + ' translateY(6px)';
    setTimeout(() => c.remove(), 300);
    window.__chip = null;
  };
  // Fire a real drag event on an element so its dropzone hover style lights up.
  window.__fireDrag = (sel, type) => {
    const el = document.querySelector(sel); if (!el) return false;
    const r = el.getBoundingClientRect();
    let dt = null; try { dt = new DataTransfer(); } catch (e) { dt = null; }
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt });
    el.dispatchEvent(ev); return true;
  };
});

await page.goto('http://localhost:' + port + '/app/ingest', { waitUntil: 'networkidle' });
await page.waitForSelector('#app-shell:not([hidden])', { timeout: 8000 }).catch(() => {});
await page.waitForSelector('.qf-dropzone', { timeout: 8000 });
await wait(500);

// ── Install the camera on #app-shell + lock scroll/clip to the frame. ──
const camReady = await page.evaluate(() => {
  const shell = document.getElementById('app-shell');
  if (!shell) return false;
  const bg = getComputedStyle(document.body).backgroundColor || '#0b0f15';
  document.documentElement.style.background = bg;
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.body.style.background = bg;
  try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e) {}
  const _noop = function () {};
  window.scrollTo = _noop;
  window.scroll = _noop;
  Element.prototype.scrollIntoView = _noop;
  shell.style.transformOrigin = '0 0';
  shell.style.willChange = 'transform';
  shell.style.backfaceVisibility = 'hidden';
  shell.style.transition = 'none';
  shell.style.transform = 'translate(0px,0px) scale(1)';
  // Live camera state — lets __rect invert the transform to DOC coords.
  window.__camState = { tx: 0, ty: 0, s: 1 };
  window.__cam = (cx, cy, s, ms) => {
    const el = document.getElementById('app-shell');
    el.style.transition = ms ? ('transform ' + ms + 'ms cubic-bezier(0.4,0,0.2,1)') : 'none';
    const tx = 896 - s * cx, ty = 560 - s * cy;
    window.__camState = { tx, ty, s };
    // eslint-disable-next-line no-void
    void el.offsetWidth;
    el.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + s + ')';
  };
  // Rect of a selector in DOCUMENT coords — inverts the live camera transform,
  // so measurements are correct at ANY zoom (no need to pull back to wide first).
  window.__rect = (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = window.__camState || { tx: 0, ty: 0, s: 1 };
    const s = cs.s || 1;
    return { left: (r.left - cs.tx) / s, top: (r.top - cs.ty) / s, right: (r.right - cs.tx) / s, bottom: (r.bottom - cs.ty) / s, width: r.width / s, height: r.height / s };
  };
  return true;
});
if (!camReady) console.log('WARN camera not installed (no #app-shell)');


// ── FIT-TO-WIDTH camera ─────────────────────────────────────────────────────
// The dashboard content column (#page-content) is 1440px wide beside a 254px
// sidebar. The old camera fit a VERTICAL band → it over-zoomed and CLIPPED text
// at the left/right edges ("Leads"→"ads", "Export CSV"→"Export CS"). __fitW fits
// the target element's WIDTH into the 1792 frame with a margin each side, so the
// content is ALWAYS fully visible horizontally (never a clipped word). Vertically
// it top-aligns tall content (fills the frame) or centres short content (symmetric
// minimal bands — never a big white BOTTOM band). Sidebar sits just off-frame left.
await page.evaluate(() => {
  const FW = 1792, FH = 1120;
  window.__fitW = (sel, opt) => {
    const o = opt || {};
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const r = el ? window.__rect(el) : null;
    if (!r) return { err: 'missing' };
    const marginX = o.marginX ?? 54;               // logical px margin each side (no edge clipping)
    let s = (FW - 2 * marginX) / r.width;
    s = Math.max(o.minS ?? 1.0, Math.min(o.maxS ?? 1.34, s));
    const cx = (r.left + r.right) / 2;
    const visH = FH / s;
    const topPad = o.topPad ?? 34;
    let cy;
    if (o.align === 'top' || r.height > visH - topPad) cy = r.top + visH / 2 - topPad; // top-align → the content below the target fills the lower frame
    else cy = (r.top + r.bottom) / 2;                             // shorter → centre (symmetric bands)
    window.__cam(cx, cy, s, o.ms ?? 1150);
    return { s: +s.toFixed(3), w: Math.round(r.width), h: Math.round(r.height), visH: Math.round(visH) };
  };
});
const navTo = async (route, waitSel) => {
  await page.evaluate((r) => { const a = document.createElement('a'); a.setAttribute('data-route', r); a.href = '/app/' + r; document.body.appendChild(a); a.click(); a.remove(); }, route);
  if (waitSel) await page.waitForSelector(waitSel, { timeout: 8000 }).catch(() => {});
};

// ── Beat 1: OPENING — fit the ingest content column (fully visible, no clip),
// centred. This is also the loop-out framing (beat 6) so the crossfade-wrap has
// matching, content-forward ends. ──
const open1 = await page.evaluate(() => window.__fitW('#page-content', { ms: 0, maxS: 1.3 }));
console.log('CAM_OPEN', JSON.stringify(open1), 'BEAT1_MS', Date.now() - _t0mark); // encode T0 ≈ BEAT1_MS/1000
await wait(700);

// ── Beat 2: VISIBLE drag-and-drop at the same framing. Chip glides from the
// top-right to the dropzone's ON-SCREEN centre (raw rect = post-camera viewport
// coords), lights the dropzone, ripple, then the REAL drop. ──
await page.evaluate(() => window.__spawnChip());
const chipXY = await page.evaluate(() => { const r = document.querySelector('.qf-dropzone').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
await wait(180);
await page.evaluate(([x, y]) => window.__chipTo(x, y), chipXY);
await wait(430);
await page.evaluate(() => { window.__fireDrag('.qf-dropzone', 'dragenter'); window.__fireDrag('.qf-dropzone', 'dragover'); });
await wait(420);
await page.evaluate(() => window.__ripple('.qf-dropzone'));
await wait(240);
await page.evaluate(() => { window.__fireDrag('.qf-dropzone', 'dragleave'); window.__chipFade(); });
await page.setInputFiles('.qf-dropzone input[type="file"]', { name: 'QuoteFleet-Q3-Rates.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 QuoteFleet — Q3 rate sheet (demo)\n') });
await page.waitForSelector('.qf-ingest-processing', { timeout: 5000 }).catch(() => {});
// Processing grows the page → refit so it fills (dropzone + parsing card + skeleton).
const camProc = await page.evaluate(() => window.__fitW('#page-content', { ms: 700, maxS: 1.3 }));
console.log('CAM_PROC', JSON.stringify(camProc));
await wait(2800); // "reading your rate sheet…" — long enough to read, no longer

// ── Beat 3: REVIEW PAYOFF — fit the review card (fully visible, fills). ──
await page.waitForSelector('#ingest-review .card h2', { timeout: 9000 }).catch(() => {});
await page.waitForSelector('#ingest-review .qf-autocheck', { timeout: 9000 }).catch(() => {});
await wait(900);
const camReview = await page.evaluate(() => window.__fitW('#ingest-review', { maxS: 1.3, topPad: 28 }));
console.log('CAM_REVIEW', JSON.stringify(camReview));
await wait(3200); // parsed rate cards + CONFIDENCE: HIGH + 12/12 green check

// ── Beat 4: LEADS — navigate, fit the leads content column (fully visible). ──
await navTo('leads', '.qf-leads-table tbody tr');
if (!await page.$('.qf-leads-table tbody tr')) { await navTo('leads', '.qf-leads-table tbody tr'); }
// SNAP (ms:0) the moment the leads page renders — a cross-page nav is a CUT, so the
// camera never holds the previous (review) scroll position over the new page (that
// stale hold is what showed a white band below the shorter page).
const camLeads = await page.evaluate(() => window.__fitW('#page-content', { maxS: 1.3, ms: 0 }));
console.log('CAM_LEADS', JSON.stringify(camLeads));
await wait(1600);

// A NEW LEAD LANDS — Marcus Webb · Long Beach → Chicago · $3,950 (marketing staging).
const landed = await page.evaluate(() => {
  const tb = document.querySelector('.qf-leads-table tbody');
  if (!tb) return false;
  const style = document.createElement('style');
  style.textContent =
    '@keyframes qfLeadLand{0%{transform:translateY(-16px);opacity:0}100%{transform:translateY(0);opacity:1}}' +
    '.qf-lead-arriving{animation:qfLeadLand .55s cubic-bezier(.22,.61,.36,1) both;box-shadow:inset 3px 0 0 0 #111;background:#f4f4f5}' +
    '.qf-lead-newpill{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:999px;background:#111;color:#fff;font-size:10px;font-weight:700;letter-spacing:.04em;vertical-align:middle}';
  document.head.appendChild(style);
  const tr = document.createElement('tr');
  tr.id = 'qf-mm-newlead';
  tr.className = 'qf-lead-arriving';
  tr.style.cursor = 'pointer';
  tr.innerHTML =
    '<td data-label="Ref"><strong>QF-2F27</strong><span class="qf-lead-newpill">NEW</span></td>' +
    '<td data-label="Customer">Marcus Webb<br><span class="muted-small">marcus@vantagefreight.com</span></td>' +
    '<td data-label="Service">ftl / dryvan</td>' +
    '<td data-label="Lane">Long Beach &rarr; Chicago</td>' +
    '<td data-label="Total" style="text-align:right;">$3,950.00</td>' +
    '<td data-label="Status"><span class="badge badge-info">New</span></td>' +
    '<td data-label="When"><span class="muted-small">just now</span></td>';
  tb.insertBefore(tr, tb.firstChild);
  const n = document.querySelectorAll('.qf-leads-table tbody tr').length;
  document.querySelectorAll('.page-sub').forEach((elx) => { if (/^\s*\d+\s+leads?\s*$/.test(elx.textContent || '')) elx.textContent = n + (n === 1 ? ' lead' : ' leads'); });
  document.querySelectorAll('*').forEach((elx) => {
    if (elx.children.length !== 0) return;
    const t = elx.textContent || '';
    if (/^Showing\s+\d+\s*[–—-]\s*\d+\s+of\s+\d+$/.test(t)) elx.textContent = 'Showing 1–' + n + ' of ' + n;
    else if (/^\s*\d+\s+visible\s*$/.test(t)) elx.textContent = n + ' visible';
  });
  return true;
});
console.log('LEAD_LANDED', landed);
// Refit (the new row grew the table) — still fully visible, no clip.
await page.evaluate(() => window.__fitW('#page-content', { maxS: 1.3, ms: 700 }));
await wait(2700); // money-moment hold

// ── Beat 5: AUTOMATED FOLLOW-UP — navigate, open the cadence fold, fit the card,
// then ripple + click the "Standard" tile (a visible selection change). ──
await navTo('widget-settings');
await page.waitForFunction(() => [].slice.call(document.querySelectorAll('.card')).some(c => /Automated follow-up/.test(c.textContent)), { timeout: 8000 }).catch(() => {});
// Open the cadence fold + SNAP the camera to the follow-up card the moment the page
// is ready — cross-page nav is a CUT, so no stale scroll position is ever held.
const camFU = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find(c => /Automated follow-up/.test(c.textContent));
  if (!card) return { err: 'no-card' };
  const det = card.querySelector('details'); if (det) det.open = true;
  if (!card.id) card.id = 'qf-fu-card';
  return window.__fitW('#qf-fu-card', { maxS: 1.32, topPad: 26, align: 'top', ms: 0 });
});
console.log('CAM_FU', JSON.stringify(camFU));
await wait(1100);
const tileHit = await page.evaluate(() => {
  const card = document.getElementById('qf-fu-card') || [...document.querySelectorAll('.card')].find(c => /Automated follow-up/.test(c.textContent));
  if (!card) return false;
  const tile = [...card.querySelectorAll('div')].find(d => d.children.length === 2 && d.firstElementChild && (d.firstElementChild.textContent || '').trim() === 'Standard' && /Days/.test(d.textContent));
  if (!tile) return false;
  window.__ripple(tile); window.__fuTile = tile; return true;
});
console.log('TILE_HIT', tileHit);
await wait(300);
await page.evaluate(() => { if (window.__fuTile) window.__fuTile.click(); });
await wait(2500); // hold on the selected Standard cadence + day-timing tiles

// ── Beat 6: RETURN to the ingest dropzone, framed EXACTLY like the opening, for a
// seamless crossfade-wrap (loop-out == loop-in). Reset the mock job so the
// dropzone renders empty again. ──
await page.evaluate(() => fetch('/rec/reset-ingest').catch(() => {}));
await navTo('ingest', '.qf-dropzone');
// SNAP to the opening framing (cut) so the loop-out is instantly the empty dropzone
// (no stale widget-settings position held over it) and holds static for the wrap.
const back = await page.evaluate(() => window.__fitW('#page-content', { ms: 0, maxS: 1.3 }));
console.log('BACK', JSON.stringify(back));
await wait(1200); // static loop-out hold


console.log('ERRS', errs.length, errs.slice(0, 8));
await ctx.close();
await browser.close();
server.close();

const webm = fs.readdirSync(OUTDIR).find(f => f.endsWith('.webm'));
const outPath = path.resolve('_rec/qf-hero-laptop-raw.webm');
fs.copyFileSync(path.join(OUTDIR, webm), outPath);
console.log('RAW_WEBM', outPath, fs.statSync(outPath).size, '1792x1120');
