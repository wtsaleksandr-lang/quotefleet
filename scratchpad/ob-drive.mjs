import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8931';
const OUT = path.resolve('scratchpad/shots');

async function runFlow(label, w, h) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#qf-ob-overlay', { timeout: 5000 });
  await page.waitForTimeout(400);

  const shot = (n) => page.screenshot({ path: path.join(OUT, `ob-${label}-${n}.png`) });
  const next = page.locator('#qf-ob-overlay .qf-ob-btn-next');
  const fillPct = async () => {
    return page.evaluate(() => {
      const f = document.querySelector('.qf-ob-progress-fill');
      return f ? f.style.width : null;
    });
  };
  const log = [];

  // STEP 1 — What do you haul (pick 2 modes)
  const cards = page.locator('.qf-ob-card');
  await cards.nth(1).click();
  await cards.nth(2).click();
  await page.waitForTimeout(200);
  log.push(`step1 fill=${await fillPct()} kicker="${await page.locator('.qf-ob-kicker').first().textContent()}"`);
  await shot('1-modes');
  await next.click(); await page.waitForTimeout(300);

  // STEP 2 — Where do you operate
  await page.locator('.qf-ob-card').first().click();
  await page.waitForTimeout(200);
  log.push(`step2 fill=${await fillPct()} kicker="${await page.locator('.qf-ob-kicker').first().textContent()}"`);
  await shot('2-area');
  await next.click(); await page.waitForTimeout(300);

  // STEP 3 — How should we quote (defaults are fine)
  log.push(`step3 fill=${await fillPct()} kicker="${await page.locator('.qf-ob-kicker').first().textContent()}"`);
  await shot('3-quoting');
  await next.click(); await page.waitForTimeout(600); // triggers stubbed apply + rate-cards load

  // STEP 4 — Confirm rates + trust + share link
  await page.waitForTimeout(300);
  log.push(`step4 fill=${await fillPct()} kicker="${await page.locator('.qf-ob-kicker').first().textContent()}" nextLabel="${await next.textContent()}"`);
  await shot('4-confirm');

  // Layout + COMPUTED-COLOR checks (verify the wizard actually renders light).
  const geom = await page.evaluate(() => {
    const card = document.querySelector('.qf-ob-shell');
    const cardR = card.getBoundingClientRect();
    const bodyW = document.documentElement.clientWidth;
    const bodyScrollW = document.documentElement.scrollWidth;
    const brand = document.querySelector('.qf-ob-brand-mark');
    const prog = document.querySelector('.qf-ob-progress').getBoundingClientRect();
    const title = document.querySelector('.qf-ob-title');
    const nextBtn = document.querySelector('.qf-ob-btn-next');
    const cs = getComputedStyle(card);
    const titleCs = getComputedStyle(title);
    const nextCs = getComputedStyle(nextBtn);
    const avg = (c) => { const m = c.match(/\d+/g); return m ? Math.round((Number(m[0]) + Number(m[1]) + Number(m[2])) / 3) : null; };
    return {
      cardLeft: Math.round(cardR.left), cardRight: Math.round(cardR.right), cardW: Math.round(cardR.width),
      viewportW: bodyW, horizOverflow: bodyScrollW > bodyW + 1,
      brandLeftOfProgress: brand.getBoundingClientRect().left < prog.left,
      progressRightSide: prog.right > cardR.width * 0.5,
      backIco: !!document.querySelector('.qf-ob-btn-back .qf-ob-btn-ico'),
      nextIco: !!document.querySelector('.qf-ob-btn-next .qf-ob-btn-ico'),
      cardBg: cs.backgroundColor, cardBgAvg: avg(cs.backgroundColor),
      titleColor: titleCs.color, titleAvg: avg(titleCs.color),
      nextBg: nextCs.backgroundColor, nextBgAvg: avg(nextCs.backgroundColor),
      nextColor: nextCs.color, nextColorAvg: avg(nextCs.color),
      brandImg: getComputedStyle(brand).backgroundImage,
    };
  });
  const lightOk = geom.cardBgAvg > 230 && geom.titleAvg < 80;
  const ctaOk = geom.nextBgAvg < 120 && geom.nextColorAvg > 200; // solid blue bg, white text
  const brandOk = /mark-keys\.png/.test(geom.brandImg) && !/ondark/.test(geom.brandImg);
  log.push('geom ' + JSON.stringify(geom));
  log.push(`ASSERT lightCard=${lightOk} solidBlueCTA=${ctaOk} onLightBrand=${brandOk} noOverflow=${!geom.horizOverflow}`);

  console.log(`\n=== ${label} (${w}x${h}) ===`);
  log.forEach((l) => console.log('  ' + l));
  if (errs.length) console.log('  ERRORS: ' + errs.join(' | '));
  else console.log('  no page errors');

  await browser.close();
}

await runFlow('desktop', 1280, 900);
await runFlow('mobile', 375, 812);
console.log('\ndone');
