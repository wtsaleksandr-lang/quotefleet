// Live verification of the quote-correctness fixes against the running dev
// server at :8854. Screenshots to scratchpad/fix-quote-*.png.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8854';
const SHOT = path.resolve('scratchpad');
fs.mkdirSync(SHOT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

let browser;
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 } });
  const pg = await ctx.newPage();
  await pg.goto(`${BASE}/w/demo?raw=1`, { waitUntil: 'networkidle', timeout: 30000 });
  await pg.waitForSelector('#qf-calc-btn', { timeout: 15000 });
  return pg;
}
async function pickService(pg, svc) {
  await pg.evaluate((s) => { const b = [...document.querySelectorAll('#qf-services button')].find((x) => x.dataset.service === s); if (b) b.click(); }, svc);
  await pg.waitForTimeout(250);
}
async function readError(pg) {
  return pg.evaluate(() => { const e = document.getElementById('qf-error'); return (e && e.style.display !== 'none' && e.textContent) ? e.textContent.trim() : null; });
}
async function readResult(pg) {
  return pg.evaluate(() => {
    const r = document.getElementById('qf-result');
    if (!r || getComputedStyle(r).display === 'none') return null;
    const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
    return { total: t('#qf-total'), meta: t('#qf-meta') };
  });
}

async function verifyFix5() {
  const pg = await newPage();
  await pickService(pg, 'drayage');
  const opts = await pg.evaluate(() => [...document.querySelectorAll('#qf-equipment option')].map((o) => ({ value: o.value, label: o.textContent })));
  const bad = opts.filter((o) => /open.?top|flat.?rack/i.test(o.value + ' ' + o.label));
  out.fix5 = { options: opts.map((o) => o.value), hasOpenTopOrFlatRack: bad.length > 0 };
  await pg.locator('#qf-root').screenshot({ path: path.join(SHOT, 'fix-quote-5-drayage-equip.png') }).catch(() => {});
  await pg.context().close();
}

async function fillLtlItem(pg, it) {
  await pg.evaluate((it) => {
    const host = document.getElementById('qf-ltl-items');
    const item = host.querySelector('.qf-ltl-item');
    const bylabel = (lbl) => item.querySelector(`[aria-label="${lbl}"]`);
    const set = (el, v) => { if (el) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set(bylabel('Quantity'), it.qty);
    set(bylabel('Length'), it.l);
    set(bylabel('Width'), it.w);
    set(bylabel('Height'), it.h);
    set(bylabel('Combined wt.'), it.wt);
  }, it);
  await pg.waitForTimeout(300);
}

async function verifyFix1() {
  const pg = await newPage();
  await pickService(pg, 'ltl');
  await pg.waitForSelector('#qf-ltl-items .qf-ltl-item', { timeout: 8000 });
  await fillLtlItem(pg, { qty: 2, l: 48, w: 40, h: 48, wt: 500 });
  await pg.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('qf-pickup-zip', '90001'); set('qf-delivery-zip', '90210');
  });
  const summaryClass = await pg.evaluate(() => document.getElementById('qf-ltl-sum-class')?.textContent?.trim());
  await pg.waitForTimeout(300);
  await pg.click('#qf-calc-btn');
  await pg.waitForTimeout(2000);
  const res = await readResult(pg);
  out.fix1 = { summaryClass, resultMeta: res && res.meta, total: res && res.total, error: await readError(pg) };
  await pg.locator('#qf-root').screenshot({ path: path.join(SHOT, 'fix-quote-1-ltl-result.png') }).catch(() => {});
  // submit lead to verify stored class + meta
  await pg.click('#qf-continue-btn').catch(() => {});
  await pg.waitForTimeout(500);
  await pg.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('qf-c-name', 'LTL Verify'); set('qf-c-email', 'ltl-verify@example.com'); set('qf-c-phone', '5551230000'); set('qf-c-company', 'FixTest');
  });
  await pg.waitForTimeout(200);
  await pg.click('#qf-submit-btn');
  await pg.waitForTimeout(2200);
  out.fix1.lead = await pg.evaluate(() => {
    const thanks = document.getElementById('qf-step-thanks');
    const detail = document.getElementById('qf-thanks-detail');
    return { thanksActive: !!(thanks && thanks.classList.contains('active')), refId: detail ? (detail.textContent.match(/QF-[A-Z0-9-]+/) || [null])[0] : null };
  });
  await pg.locator('#qf-root').screenshot({ path: path.join(SHOT, 'fix-quote-1-ltl-lead.png') }).catch(() => {});
  await pg.context().close();
}

async function verifyFix1SingleUnchanged() {
  const pg = await newPage();
  await pickService(pg, 'ltl');
  await pg.waitForSelector('#qf-ltl-items .qf-ltl-item', { timeout: 8000 });
  await fillLtlItem(pg, { qty: 1, l: 48, w: 40, h: 48, wt: 500 });
  await pg.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('qf-pickup-zip', '90001'); set('qf-delivery-zip', '90210'); });
  const summaryClass = await pg.evaluate(() => document.getElementById('qf-ltl-sum-class')?.textContent?.trim());
  await pg.click('#qf-calc-btn'); await pg.waitForTimeout(1800);
  const res = await readResult(pg);
  out.fix1_single = { summaryClass, resultMeta: res && res.meta, total: res && res.total };
  await pg.context().close();
}

async function verifyFix4() {
  const pg = await newPage();
  await pickService(pg, 'ftl');
  await pg.evaluate(() => { const sel = document.getElementById('qf-equipment'); sel.value = 'dryvan'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  const run = async (weight) => {
    await pg.evaluate((w) => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('qf-pickup-zip', '60607'); set('qf-delivery-zip', '53202'); set('qf-weight', w); }, String(weight));
    await pg.waitForTimeout(200); await pg.click('#qf-calc-btn'); await pg.waitForTimeout(1600);
    return { error: await readError(pg), result: await readResult(pg) };
  };
  out.fix4_absurd = await run(999999);
  await pg.locator('#qf-root').screenshot({ path: path.join(SHOT, 'fix-quote-4-weight-absurd.png') }).catch(() => {});
  await sleep(1200);
  out.fix4_ok = await run(44000);
  await pg.context().close();
}

async function verifyFix3() {
  const pg = await newPage();
  await pickService(pg, 'ftl');
  await pg.evaluate(() => { const sel = document.getElementById('qf-equipment'); sel.value = 'dryvan'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await pg.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('qf-pickup-zip', '00000'); set('qf-delivery-zip', '99999'); set('qf-weight', '38000'); });
  await pg.waitForTimeout(200); await pg.click('#qf-calc-btn'); await pg.waitForTimeout(1800);
  out.fix3_bogus = { error: await readError(pg), result: await readResult(pg) };
  await pg.locator('#qf-root').screenshot({ path: path.join(SHOT, 'fix-quote-3-bogus-zip.png') }).catch(() => {});
  await pg.context().close();
}

async function verifyFix6Dims() {
  const pg = await newPage();
  await pickService(pg, 'ltl');
  await pg.waitForSelector('#qf-ltl-items .qf-ltl-item', { timeout: 8000 });
  await fillLtlItem(pg, { qty: 1, l: 9999, w: 9999, h: 9999, wt: 500 });
  await pg.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('qf-pickup-zip', '60607'); set('qf-delivery-zip', '53202'); });
  await pg.waitForTimeout(200); await pg.click('#qf-calc-btn'); await pg.waitForTimeout(1500);
  out.fix6_dims = { error: await readError(pg), result: await readResult(pg) };
  await pg.locator('#qf-root').screenshot({ path: path.join(SHOT, 'fix-quote-6-absurd-dims.png') }).catch(() => {});
  await pg.context().close();
}

async function main() {
  browser = await chromium.launch();
  await verifyFix5(); await sleep(800);
  await verifyFix1(); await sleep(1500);
  await verifyFix1SingleUnchanged(); await sleep(1500);
  await verifyFix4(); await sleep(1500);
  await verifyFix3(); await sleep(1200);
  await verifyFix6Dims();
  await browser.close();
  fs.writeFileSync(path.join(SHOT, '_verify-fixes.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
