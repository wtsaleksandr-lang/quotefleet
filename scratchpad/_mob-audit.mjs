import { pathToFileURL } from 'url';
const _pw = await import(pathToFileURL('C:/Users/Owner/.codex/quotefleet/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.js').href);
const chromium = (_pw.default && _pw.default.chromium) || _pw.chromium;

const BASE = 'http://localhost:8854';
const OUT = 'C:/Users/Owner/.codex/quotefleet/scratchpad';
const ROUTES = ['overview','leads','rates','accessorials','zones','ai','brand','embed','widget-settings','callbacks','account','audit','ingest'];

const stamp = Date.now();
const results = [];
const consoleErrors = [];
const failedReqs = [];

async function dismissWizard(page) {
  // Onboarding wizard overlay: click "Skip for now" if present
  try {
    const skip = page.locator('button:has-text("Skip for now"), a:has-text("Skip for now"), button:has-text("Skip")').first();
    if (await skip.count() && await skip.isVisible().catch(()=>false)) {
      await skip.click({ timeout: 2000 }).catch(()=>{});
      await page.waitForTimeout(500);
    }
    // also dismiss any generic modal close
    const ov = page.locator('.qf-onboarding, [data-onboarding], .onboarding-wizard').first();
    if (await ov.count() && await ov.isVisible().catch(()=>false)) {
      const x = page.locator('.qf-onboarding button[aria-label*="lose"], .onboarding-wizard button:has-text("Skip")').first();
      if (await x.count()) await x.click({timeout:1500}).catch(()=>{});
    }
  } catch {}
}

async function measure(page) {
  return await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const sw = se.scrollWidth, iw = window.innerWidth;
    const overflow = sw > iw + 1;
    // find widest offending element
    let worst = null, worstRight = iw;
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') continue;
      if (r.right > iw + 2 && r.right > worstRight) {
        worstRight = r.right;
        worst = { tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,60), id: el.id||'', right: Math.round(r.right), w: Math.round(r.width) };
      }
    }
    // tap targets < 44px
    const smalls = [];
    const clk = document.querySelectorAll('a, button, [role="button"], .sidebar [data-route], input[type=checkbox]');
    for (const el of clk) {
      const r = el.getBoundingClientRect();
      if (r.width===0||r.height===0) continue;
      if (r.height < 44) {
        const label = (el.textContent||el.getAttribute('aria-label')||el.className||'').toString().trim().replace(/\s+/g,' ').slice(0,40);
        smalls.push({ h: Math.round(r.height), tag: el.tagName.toLowerCase(), label });
      }
    }
    // tables overflowing
    const tables = [];
    document.querySelectorAll('table').forEach(t => {
      const r = t.getBoundingClientRect();
      const parent = t.parentElement;
      const pcs = parent ? getComputedStyle(parent) : null;
      tables.push({ w: Math.round(r.width), overflowsVp: r.right > window.innerWidth+2, parentScroll: pcs ? pcs.overflowX : '?' });
    });
    // sidebar state
    const sb = document.querySelector('.sidebar');
    let sidebar = null;
    if (sb) {
      const r = sb.getBoundingClientRect();
      const cs = getComputedStyle(sb);
      sidebar = { w: Math.round(r.width), left: Math.round(r.left), display: cs.display, position: cs.position, visible: r.width>0 && cs.display!=='none' };
    }
    const hamburger = !!document.querySelector('.qf-menu-toggle, .hamburger, [aria-label*="menu" i], .sidebar-toggle, .mobile-nav-toggle');
    return { sw, iw, overflow, worst, smalls: smalls.slice(0,12), smallCount: smalls.length, tables, sidebar, hamburger,
             bodyText: (document.querySelector('.app-main')||document.body).innerText.slice(0,180) };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });

  // signup via context request -> cookies stored in context
  const su = await ctx.request.post(BASE + '/api/auth/signup', {
    data: { companyName: 'MobileAudit '+stamp, email: 'mobaudit+'+stamp+'@example.com', password: 'ReproTest!2345', countryFocus: 'US', dpaAccepted: true, dpaVersion: '1.0' },
    headers: { 'Content-Type': 'application/json' },
  });
  const suj = await su.json().catch(()=>({}));
  console.log('signup status', su.status(), 'tenant', suj.tenant && suj.tenant.slug);

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text().slice(0,200)); });
  page.on('requestfailed', r => failedReqs.push(r.url().replace(BASE,'') + ' ' + (r.failure()&&r.failure().errorText)));
  page.on('response', r => { if (r.status()>=400 && r.url().includes('/api/')) failedReqs.push(r.status()+' '+r.url().replace(BASE,'')); });

  // first load /app to trigger + dismiss wizard
  await page.goto(BASE + '/app', { waitUntil: 'networkidle', timeout: 30000 }).catch(e=>console.log('goto /app err', e.message));
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await page.waitForTimeout(500);

  for (const route of ROUTES) {
    try {
      await page.goto(BASE + '/app/' + route, { waitUntil: 'networkidle', timeout: 25000 });
      await page.waitForTimeout(1200);
      await dismissWizard(page);
      await page.waitForTimeout(600);
      const m = await measure(page);
      const shot = `${OUT}/dash-mobile-${route}.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(e=>console.log('shot err',route,e.message));
      results.push({ route, ...m, shot });
      console.log(`\n=== ${route} === overflow=${m.overflow} sw=${m.sw}/${m.iw} worst=${JSON.stringify(m.worst)} smallTaps=${m.smallCount} tables=${m.tables.length} sidebar=${JSON.stringify(m.sidebar)} hamburger=${m.hamburger}`);
    } catch (e) {
      results.push({ route, error: e.message });
      console.log(`=== ${route} === ERROR ${e.message}`);
    }
  }

  // desktop reference pass (overflow only, quick)
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  // reuse cookies
  const cookies = await ctx.cookies();
  await dctx.addCookies(cookies);
  const dp = await dctx.newPage();
  await dp.goto(BASE + '/app', { waitUntil:'networkidle', timeout:20000 }).catch(()=>{});
  await dp.waitForTimeout(1000); await dismissWizard(dp);
  const desk = [];
  for (const route of ROUTES) {
    try {
      await dp.goto(BASE + '/app/' + route, { waitUntil:'networkidle', timeout:20000 });
      await dp.waitForTimeout(800); await dismissWizard(dp);
      const o = await dp.evaluate(()=>{const se=document.scrollingElement;return {sw:se.scrollWidth, iw:window.innerWidth, overflow: se.scrollWidth>window.innerWidth+1};});
      desk.push({ route, ...o });
    } catch(e){ desk.push({route, error:e.message}); }
  }
  console.log('\n\n#### DESKTOP 1280 ####');
  desk.forEach(d=>console.log(`${d.route}: overflow=${d.overflow} sw=${d.sw}`));

  console.log('\n\n#### CONSOLE ERRORS ####'); console.log([...new Set(consoleErrors)].slice(0,30).join('\n'));
  console.log('\n#### FAILED/4xx REQ ####'); console.log([...new Set(failedReqs)].slice(0,30).join('\n'));

  const fs = await import('fs');
  fs.writeFileSync(OUT+'/_mob-audit-results.json', JSON.stringify({results, desk, consoleErrors:[...new Set(consoleErrors)], failedReqs:[...new Set(failedReqs)]}, null, 2));
  await browser.close();
  console.log('\nDONE. json at _mob-audit-results.json');
})();
