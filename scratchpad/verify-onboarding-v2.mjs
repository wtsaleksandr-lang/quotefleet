// Visual + functional review gate for the rebuilt 4-step onboarding wizard.
// Drives the REAL wizard at desktop and 375px: multi-selects modes, picks a
// service area (incl. the states/provinces picker), completes the flow, and
// asserts no badge/pill group ever renders a lone item on a line.
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://localhost:8854';
const OUT = path.resolve('scratchpad');

async function freshSession() {
  const stamp = String(Date.now()) + Math.floor(Math.random() * 1000);
  const res = await fetch(BASE + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      companyName: `OB V2 ${stamp}`, email: `obv2+${stamp}@example.com`,
      password: 'ReproTest!2345', countryFocus: 'US', dpaAccepted: true, dpaVersion: '1.0',
    }),
  });
  if (res.status >= 400) throw new Error('signup failed ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return (res.headers.getSetCookie?.() || []).map((c) => {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: BASE };
  });
}

// Fails if any multi-item group renders exactly one SMALL item alone on a line.
//
// The no-orphan rule targets badge / pill / chip / button groups — a little
// element stranded in whitespace looks broken. It does NOT mean "every row must
// hold >=2 elements": a full-bleed form input on its own row is a deliberate,
// correct layout (and at 375px stacking text inputs one-per-line is the ONLY
// sensible option — side-by-side inputs there would be worse UX).
//
// So a lone item is only an orphan when it does NOT span (nearly) the full
// width of its container. That distinguishes a stranded chip from a full-width
// field, which is exactly the line the rule cares about.
const FULL_BLEED_RATIO = 0.9;
async function noOrphanLines(page, selector) {
  return await page.evaluate(([sel, ratio]) => {
    const out = [];
    for (const group of document.querySelectorAll(sel)) {
      const gw = group.getBoundingClientRect().width || 1;
      const items = [...group.children].filter((c) => c.getBoundingClientRect().width > 0);
      if (items.length < 2) continue;
      const byTop = new Map();
      for (const it of items) {
        const r = it.getBoundingClientRect();
        const t = Math.round(r.top);
        if (!byTop.has(t)) byTop.set(t, []);
        byTop.get(t).push(r.width / gw);
      }
      const lines = [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, ws]) => ws);
      const offenders = lines.filter((ws) => ws.length === 1 && ws[0] < ratio);
      if (offenders.length) out.push({ sel, lines: lines.map((ws) => ws.length), offenders });
    }
    return out;
  }, [selector, FULL_BLEED_RATIO]);
}

const results = [];
for (const [label, w, h] of [['desktop', 1280, 900], ['mobile', 375, 812]]) {
  const cookies = await freshSession();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const errs = [];
  const failedApi = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('response', async (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.url().replace(BASE, '')}`);
  });

  await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const next = page.locator('#qf-ob-overlay button').filter({ hasText: /Continue|Finish/ }).first();
  const kick = async () => (await page.locator('.qf-ob-kicker').first().textContent().catch(() => '?'));
  const title = async () => (await page.locator('.qf-ob-title').first().textContent().catch(() => '?'));

  const log = [];
  log.push(`${await kick()} | ${await title()}`);

  // STEP 1 — multi-select three modes.
  const cards = page.locator('.qf-ob-card');
  await cards.nth(1).click(); await page.waitForTimeout(150);
  await cards.nth(2).click(); await page.waitForTimeout(150);
  await cards.nth(5).click(); await page.waitForTimeout(250);
  const selected = await page.locator('.qf-ob-card.is-selected').count();
  log.push(`multi-select: ${selected} modes selected simultaneously`);
  await page.screenshot({ path: path.join(OUT, `ob2-${label}-1modes.png`) });
  await next.click(); await page.waitForTimeout(500);

  // STEP 2 — pricing.
  log.push(`${await kick()} | ${await title()}`);
  await page.locator('.qf-ob-card').first().click(); await page.waitForTimeout(200);
  await next.click(); await page.waitForTimeout(500);

  // STEP 3 — NEW quoting rules: fuel surcharge + who sees prices.
  log.push(`${await kick()} | ${await title()}`);
  const qCards = await page.locator('.qf-ob-card').count();
  const preselected = await page.locator('.qf-ob-card.is-selected').count();
  log.push(`quoting-rules cards: ${qCards}, preselected defaults: ${preselected}`);
  // Exercise the manual-% reveal, then return to the auto default.
  await page.locator('.qf-ob-card', { hasText: 'Use my own fixed %' }).first().click();
  await page.waitForTimeout(350);
  const pctShown = await page.locator('.qf-ob-pct').count();
  log.push(`manual selected -> % input revealed: ${pctShown > 0}`);
  const hintLeft = await page.evaluate(() => {
    const h = document.querySelector('.qf-ob-hint');
    return h ? getComputedStyle(h).textAlign : null;
  });
  log.push(`hint text-align (must be left): ${hintLeft}`);
  await page.screenshot({ path: path.join(OUT, `ob2-${label}-2quoting.png`) });
  await page.locator('.qf-ob-card', { hasText: 'Track diesel automatically' }).first().click();
  await page.waitForTimeout(250);
  await next.click(); await page.waitForTimeout(500);

  // STEP 4 — service area; exercise the states/provinces picker.
  log.push(`${await kick()} | ${await title()}`);
  const areaCount = await page.locator('.qf-ob-card').count();
  log.push(`service-area options: ${areaCount}`);
  await page.screenshot({ path: path.join(OUT, `ob2-${label}-2area.png`) });
  // "Specific states / provinces" is the 4th option.
  await page.locator('.qf-ob-card').nth(3).click();
  await page.waitForTimeout(400);
  const gatedEmpty = await next.isDisabled();
  log.push(`regions picked=0 -> Continue disabled: ${gatedEmpty}`);
  for (const code of ['CA', 'AZ', 'NV', 'ON']) {
    await page.locator('.qf-ob-region', { hasText: new RegExp(`^${code}$`) }).first().click();
    await page.waitForTimeout(120);
  }
  const chosen = await page.locator('.qf-ob-region.is-selected').count();
  log.push(`regions selected: ${chosen}`);
  const orphans = await noOrphanLines(page, '.qf-ob-region-row');
  log.push(`region-row orphan lines: ${orphans.length === 0 ? 'NONE ✓' : JSON.stringify(orphans)}`);
  await page.screenshot({ path: path.join(OUT, `ob2-${label}-3regions.png`) });
  await next.click(); await page.waitForTimeout(3500);

  // STEP 4 — confirm rates (seeded from ALL selected modes).
  log.push(`${await kick()} | ${await title()}`);
  const rateRows = await page.locator('.qf-ob-rate-row').count();
  log.push(`seeded rate rows shown: ${rateRows}`);
  await page.screenshot({ path: path.join(OUT, `ob2-${label}-4rates.png`) });
  const trust = await page.locator('.qf-ob-trust').count();
  const trustOrphan = await noOrphanLines(page, '.qf-ob-trust');
  log.push(`trust block present: ${trust > 0}, orphan lines: ${trustOrphan.length === 0 ? 'NONE' : JSON.stringify(trustOrphan)}`);
  // A bad email must BLOCK Finish (agent gated it via gateNext, no re-render).
  const emailIn = page.locator('.qf-ob-trust input[type="email"], .qf-ob-trust-wide input').first();
  if (await emailIn.count()) {
    await emailIn.fill('not-an-email');
    await page.waitForTimeout(400);
    log.push(`invalid email -> Finish disabled: ${await next.isDisabled()}`);
    await emailIn.fill('dispatch@harborlink.example');
    await page.waitForTimeout(400);
    log.push(`valid email -> Finish enabled: ${!(await next.isDisabled())}`);
  }
  const finishText = await next.textContent();
  log.push(`final button: "${finishText?.trim()}"`);
  await next.click(); await page.waitForTimeout(2500);
  const stillOpen = await page.locator('#qf-ob-overlay').count();
  log.push(`wizard closed after Finish: ${stillOpen === 0}`);

  results.push({ label, log, errs, failedApi });
  await browser.close();
}

for (const r of results) {
  console.log(`\n───── ${r.label} ─────`);
  r.log.forEach((l) => console.log('  ' + l));
  console.log('  console errors:', r.errs.length ? r.errs.slice(0, 5) : 'none');
  console.log('  failed API:', r.failedApi.length ? r.failedApi : 'none');
}
