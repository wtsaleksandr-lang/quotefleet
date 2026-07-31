import { chromium } from '@playwright/test';
import fs from 'fs';
const BASE = 'http://localhost:8854';
const SS = 'scratchpad';
const stamp = Date.now();
const SLUG = 'mb-' + stamp;
const EMAIL = `mb+${stamp}@example.com`;
const PASSWORD = 'SuperSecret123!';
const COMPANY = 'MapBlend QA ' + stamp;
const out = {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const api = async (m, p, b) => page.evaluate(async ([m,p,b]) => {
  const r = await fetch(p,{method:m,headers:b?{'Content-Type':'application/json'}:{},body:b?JSON.stringify(b):undefined});
  let j=null; try{j=await r.clone().json()}catch{}; return {status:r.status,json:j};
},[m,p,b]);

try {
  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
  await page.fill('#companyName', COMPANY);
  await page.fill('#slug-input', SLUG);
  await page.fill('#email', EMAIL);
  await page.fill('#password-input', PASSWORD);
  await page.fill('#confirm-password-input', PASSWORD);
  const proTile = await page.$('[data-plan="pro"]'); if (proTile) await proTile.click();
  try { await page.selectOption('#countryFocus', 'US'); } catch {}
  await page.check('#dpa-accept');
  await Promise.all([ page.waitForNavigation({waitUntil:'networkidle',timeout:20000}).catch(()=>null), page.click('#signup-submit') ]);
  await page.waitForTimeout(1200);

  // setup-status BEFORE theming
  out.setupBefore = (await api('GET','/api/tenant/setup-status')).json;
  // change a NON-DEFAULT theme preset
  out.putTheme = (await api('PUT','/api/tenant/brand',{themePreset:'vault'})).status;
  out.setupAfterTheme = (await api('GET','/api/tenant/setup-status')).json;
  // reset preset to midnight, then test predicate via mapBlend alone
  await api('PUT','/api/tenant/brand',{themePreset:'midnight'});
  await api('PUT','/api/tenant/brand',{mapBlend:'off'});
  out.setupMapBlendOff = (await api('GET','/api/tenant/setup-status')).json; // expect brand:false (all defaults)
  await api('PUT','/api/tenant/brand',{mapBlend:'on'});
  out.setupMapBlendOn = (await api('GET','/api/tenant/setup-status')).json;  // expect brand:true

  // ── VISUAL: map-blend OFF ──
  await api('PUT','/api/tenant/brand',{mapBlend:'off'});
  const w1 = await ctx.newPage();
  await w1.goto(`${BASE}/w/${SLUG}`, { waitUntil:'networkidle', timeout:25000 });
  await w1.waitForTimeout(2500);
  out.attrOff = await w1.getAttribute('body','data-qf-map-blend');
  let cardOff = await w1.$('#qf-map-card');
  if (cardOff) await cardOff.screenshot({ path: `${SS}/fix-mapblend-off.png` });
  else await w1.screenshot({ path: `${SS}/fix-mapblend-off.png` });

  // ── VISUAL: map-blend ON ──
  await api('PUT','/api/tenant/brand',{mapBlend:'on'});
  const w2 = await ctx.newPage();
  await w2.goto(`${BASE}/w/${SLUG}`, { waitUntil:'networkidle', timeout:25000 });
  await w2.waitForTimeout(2500);
  out.attrOn = await w2.getAttribute('body','data-qf-map-blend');
  // Prove the feather CSS is active: card border transparent + ::after has a gradient.
  out.blendCss = await w2.evaluate(() => {
    const card = document.getElementById('qf-map-card');
    const canvas = document.querySelector('#qf-map-card .qf-map-canvas') || document.querySelector('.qf-map-canvas');
    const cardBorder = card ? getComputedStyle(card).borderTopColor : null;
    const after = canvas ? getComputedStyle(canvas, '::after') : null;
    return {
      hasCard: !!card, hasCanvas: !!canvas,
      cardBorderTop: cardBorder,
      afterContent: after ? after.content : null,
      afterBgImage: after ? (after.backgroundImage || '').slice(0, 60) : null,
    };
  });
  let cardOn = await w2.$('#qf-map-card');
  if (cardOn) await cardOn.screenshot({ path: `${SS}/fix-mapblend-on.png` });
  else await w2.screenshot({ path: `${SS}/fix-mapblend-on.png` });
} catch (e) { out.FATAL = String(e && e.stack || e); }
finally {
  out.slug = SLUG;
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}
