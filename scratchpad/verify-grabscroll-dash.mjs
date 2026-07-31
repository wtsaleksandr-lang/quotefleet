// Grab-to-scroll verification for the tenant dashboard (/app).
// Reuses the already-running dev backend on :8854. Signs up a fresh tenant via
// the API (shares the cookie jar with the browser context), loads /app, and
// drives real mouse drags on the dashboard's main scroll container.
import { chromium } from '@playwright/test';
import path from 'node:path';

const BASE = 'http://localhost:8854';
const SCRATCH = path.resolve('scratchpad');
const stamp = Date.now().toString(36);
const slug = 'grabtest-' + stamp;
const email = `grab+${stamp}@example.com`;

const results = [];
function log(name, pass, detail) { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

async function dragMouse(pg, x0, y0, dx, dy, steps) {
  steps = steps || 12;
  await pg.mouse.move(x0, y0);
  await pg.mouse.down();
  for (let i = 1; i <= steps; i++) await pg.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
  await pg.mouse.up();
}
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
const box = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height }; }, sel);

const b = await chromium.launch();
// Short viewport so the (sparse, fresh-tenant) dashboard genuinely overflows.
const ctx = await b.newContext({ viewport: { width: 1440, height: 760 }, deviceScaleFactor: 1 });

// Auth (cookie jar shared with pages in this context). Try a fresh signup;
// if the IP signup limiter trips (429), fall back to logging in with a
// previously-created grab-test tenant.
const PW = 'GrabScroll123!';
const KNOWN = ['grab+mrslk5ys@example.com', 'grab+mrslhrrr@example.com', 'grab+mrslg3zt@example.com'];
const resp = await ctx.request.post(`${BASE}/api/auth/signup`, {
  data: { companyName: 'Grab Test Co ' + stamp, slug, email, password: PW, plan: 'vital', countryFocus: 'US', dpaAccepted: true, dpaVersion: '1.0' },
});
if (resp.ok()) {
  console.log('signed up tenant', slug);
} else if (resp.status() === 429) {
  let ok = false;
  for (const em of KNOWN) {
    const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: em, password: PW } });
    if (lr.ok()) { console.log('signup rate-limited; logged in as existing tenant', em); ok = true; break; }
  }
  if (!ok) { console.error('signup 429 AND no known tenant login worked'); process.exit(2); }
} else {
  console.error('signup failed', resp.status(), await resp.text()); process.exit(2);
}

// Properly close the onboarding wizard (real user path: "Skip for now"), which
// removes the full-screen .qf-ob-overlay and releases the body scroll-lock.
async function closeWizard(page) {
  await page.waitForTimeout(1200);
  const skip = page.locator('.qf-ob-skip');
  try {
    if (await skip.count()) {
      await skip.first().click({ timeout: 3000 });
      await page.waitForSelector('.qf-ob-overlay', { state: 'detached', timeout: 6000 }).catch(() => {});
    }
  } catch (e) { /* ignore */ }
  // Belt-and-suspenders: nuke any lingering overlay + lock.
  await page.evaluate(() => {
    document.querySelectorAll('.qf-ob-overlay').forEach((n) => n.remove());
    document.documentElement.classList.remove('qf-ob-open');
  });
}

const pg = await ctx.newPage();
await pg.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
await closeWizard(pg);
await pg.waitForSelector('.app-main', { timeout: 10000 });
await pg.waitForTimeout(400);

// 1) cursor:grab on the dashboard main scroll surface.
const cur = await pg.evaluate(() => { const m = document.querySelector('.app-main'); return m ? getComputedStyle(m).cursor : 'none'; });
log('dash cursor:grab on .app-main background', cur === 'grab', '.app-main cursor=' + cur);

// Navigate to Rate cards (has a title, inputs + buttons, and more height) for
// all the drag checks.
await pg.evaluate(() => { const nav = document.querySelector('.sidebar [data-route="rates"]'); if (nav) nav.click(); });
await pg.waitForTimeout(1400);
await rest(pg);

// Find a VISIBLE, non-interactive, non-scrollable point inside .app-main to grab.
async function findBgPoint(pg) {
  return pg.evaluate(() => {
    const main = document.querySelector('.app-main');
    const mr = main.getBoundingClientRect();
    const EXCL = 'input, textarea, select, button, a, label, [contenteditable], [role="slider"], [role="tab"], .qf-tabs, .qf-tabs-ind, .qf-map, .qf-map-card, .qf-map-canvas, .qf-modal, .qf-modal-card, [data-no-grabscroll], table, thead, tbody, tr, td, th, [role="dialog"], .modal';
    const x0 = Math.max(mr.x + 8, 250);
    const x1 = Math.min(mr.right - 8, window.innerWidth - 8);
    for (let y = 56; y < window.innerHeight - 30; y += 8) {
      for (let x = x0; x < x1; x += 24) {
        const el = document.elementFromPoint(x, y);
        if (!el || !main.contains(el)) continue;
        if (el.closest(EXCL)) continue;
        // reject if an ancestor is independently scrollable
        let n = el, bad = false;
        while (n && n !== main) { const cs = getComputedStyle(n); if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) { bad = true; break; } n = n.parentElement; }
        if (bad) continue;
        return { x, y, tag: (el.tagName + '.' + (el.className || '')).slice(0, 40) };
      }
    }
    return null;
  });
}

// 2) Drag on dashboard background scrolls the page.
const maxTop = await pg.evaluate(() => (document.scrollingElement.scrollHeight - window.innerHeight));
const bg = await findBgPoint(pg);
const y0 = await pg.evaluate(() => window.scrollY);
if (bg) {
  await dragMouse(pg, bg.x, bg.y, 0, -220);
  await pg.waitForTimeout(500);
}
const y1 = await pg.evaluate(() => window.scrollY);
log('dash drag on background scrolls page', bg && maxTop > 20 ? (y1 > y0 + 80) : (maxTop <= 20), `pt=${bg ? bg.x + ',' + bg.y + ' (' + bg.tag + ')' : 'none'} scrollY ${y0} → ${y1} (maxTop ${maxTop})`);
await rest(pg);

// Navigate to Account (persistent form inputs + Save button) for the
// control-exclusion checks.
await pg.evaluate(() => { const nav = document.querySelector('.sidebar [data-route="account"]'); if (nav) nav.click(); });
await pg.waitForTimeout(1400);
await rest(pg);

// 3) Drag on an INPUT does NOT scroll; input stays editable.
const anyInput = await pg.evaluate(() => {
  const el = document.querySelector('.app-main input:not([type=checkbox]):not([type=radio]):not([hidden]), .app-main input[type=text], .app-main input[type=number]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  return { x: r.x, y: r.y, w: r.width, h: r.height, tag: el.tagName };
});
if (anyInput) {
  await rest(pg);
  const yi0 = await pg.evaluate(() => window.scrollY);
  await dragMouse(pg, anyInput.x + anyInput.w / 2, anyInput.y + anyInput.h / 2, 100, 0);
  const yi1 = await pg.evaluate(() => window.scrollY);
  log('dash drag on form input does NOT scroll', Math.abs(yi1 - yi0) < 8, `scrollY ${yi0} → ${yi1}`);
  // editability — robust locator fill (a number/text input on the rates page)
  const inputLoc = pg.locator('.app-main input[type="text"], .app-main input[type="number"], .app-main input:not([type])').first();
  let editable = false, val = '';
  try { await inputLoc.fill('12', { timeout: 3000 }); val = await inputLoc.inputValue(); editable = val === '12'; } catch (e) { val = 'err:' + e.message.split('\n')[0]; }
  log('dash input still focusable/editable', editable, 'value=' + val);
} else {
  log('dash drag on form input does NOT scroll', false, 'no input found on rates page');
}

// 4) Drag on a BUTTON does NOT scroll; a real click works.
const anyBtn = await pg.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.app-main button'));
  const el = btns.find((x) => { const r = x.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.top > 0 && r.top < window.innerHeight - 40; });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
if (anyBtn) {
  await rest(pg);
  const yb0 = await pg.evaluate(() => window.scrollY);
  await dragMouse(pg, anyBtn.x + anyBtn.w / 2, anyBtn.y + anyBtn.h / 2, 0, -160);
  await pg.waitForTimeout(250);
  const yb1 = await pg.evaluate(() => window.scrollY);
  log('dash drag on button does NOT scroll', Math.abs(yb1 - yb0) < 8, `scrollY ${yb0} → ${yb1}`);
} else {
  log('dash drag on button does NOT scroll', false, 'no button found');
}

// 5) Nested scroll pane (if any) scrolls independently, page does not.
const nested = await pg.evaluate(() => {
  const els = Array.from(document.querySelectorAll('.app-main *'));
  for (const el of els) {
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40 && r.top > 0 && r.top < window.innerHeight - 40) {
        return { x: r.x, y: r.y, w: r.width, h: r.height, sel: el.className || el.tagName };
      }
    }
  }
  return null;
});
if (nested) {
  await rest(pg);
  const before = await pg.evaluate((n) => { const e = document.elementFromPoint(n.x + n.w / 2, n.y + n.h / 2); let s = e; while (s && s !== document.body) { const cs = getComputedStyle(s); if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && s.scrollHeight > s.clientHeight + 8) return s.scrollTop; s = s.parentElement; } return -1; }, nested);
  const pageBefore = await pg.evaluate(() => window.scrollY);
  await dragMouse(pg, nested.x + nested.w / 2, nested.y + nested.h / 2, 0, -120);
  await pg.waitForTimeout(300);
  const pageAfter = await pg.evaluate(() => window.scrollY);
  log('dash nested scroll pane not hijacked by page-pan', Math.abs(pageAfter - pageBefore) < 8, `nested "${nested.sel}" · page scrollY ${pageBefore} → ${pageAfter}`);
} else {
  log('dash nested scroll pane not hijacked by page-pan', true, 'no independent scroll pane on this page — N/A (utility still skips them via isScrollable)');
}

await pg.evaluate(() => window.scrollTo(0, 0));
await pg.screenshot({ path: path.join(SCRATCH, 'grabscroll-dash-desktop.png') });

// Mobile 375 — native touch scroll still works.
const mctx = await b.newContext({ viewport: { width: 375, height: 400 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
// reuse the session by copying cookies
const cookies = await ctx.cookies();
await mctx.addCookies(cookies);
const mpg = await mctx.newPage();
await mpg.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
await closeWizard(mpg);
const mclient = await mctx.newCDPSession(mpg);
await mpg.evaluate(() => window.scrollTo(0, 0));
const mm0 = await mpg.evaluate(() => window.scrollY);
async function touch(type, y) { await mclient.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] }); }
await touch('touchStart', 520);
for (let y = 500; y >= 200; y -= 40) { await touch('touchMove', y); await mpg.waitForTimeout(16); }
await touch('touchEnd', 200);
await mpg.waitForTimeout(500);
const mm1 = await mpg.evaluate(() => window.scrollY);
const mMax = await mpg.evaluate(() => (document.scrollingElement.scrollHeight - window.innerHeight));
log('dash mobile native touch scroll still works', mMax > 20 ? (mm1 > mm0 + 40) : true, `scrollY ${mm0} → ${mm1} (maxTop ${mMax})`);
await mpg.screenshot({ path: path.join(SCRATCH, 'grabscroll-dash-mobile.png') });

await b.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== DASHBOARD: ${results.length - failed.length}/${results.length} passed ===`);
process.exit(failed.length ? 1 : 0);
