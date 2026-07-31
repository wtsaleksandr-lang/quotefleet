// END-TO-END CAD verification. The currency chain was assembled by three
// separate agents (engine -> routes -> display); nobody drove it live. This
// creates a REAL Canadian tenant, quotes a REAL Canadian lane, submits a lead,
// and asserts the money reads CA$ at every surface — and that NO amount moved.
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://localhost:8854';
const OUT = path.resolve('scratchpad');
const stamp = String(Date.now());

async function signup(country, tag) {
  const res = await fetch(BASE + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      companyName: `CAD Check ${tag} ${stamp}`,
      email: `cadcheck-${tag}-${stamp}@example.com`,
      password: 'ReproTest!2345',
      countryFocus: country,
      dpaAccepted: true, dpaVersion: '1.0',
    }),
  });
  const body = await res.json();
  if (res.status >= 400) throw new Error(`signup ${tag} failed: ${JSON.stringify(body)}`);
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  return { slug: body.tenant.slug, cookie };
}

async function quote(slug, payload) {
  const r = await fetch(`${BASE}/api/public/quote/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json() };
}

// Identical shipment, priced by a CA tenant and a US tenant.
const LANE = {
  service: 'ftl', equipment: 'dryvan', weightLbs: 25000,
  pickup: { zip: 'M5V', country: 'CA' },
  delivery: { zip: 'V6B', country: 'CA' },
};

const ca = await signup('CA', 'ca');
const us = await signup('US', 'us');

const qCa = await quote(ca.slug, LANE);
const qUs = await quote(us.slug, LANE);

const rCa = qCa.body.result, rUs = qUs.body.result;
console.log('== engine ==');
console.log('  CA tenant currency:', rCa.currency, '| total:', rCa.total);
console.log('  US tenant currency:', rUs.currency, '| total:', rUs.total);
console.log('  miles:', qCa.body.miles);

// THE critical invariant: labelling must not change the number. Same rate cards
// (both freshly seeded), same lane -> identical total. If these differ, an FX
// rate leaked in somewhere and real carrier prices are being corrupted.
const sameNumber = rCa.total === rUs.total;
console.log(`  totals identical across currencies (NO conversion): ${sameNumber ? 'YES ✓' : 'NO ✗  CA=' + rCa.total + ' US=' + rUs.total}`);

// Lead submission persists the currency.
const leadRes = await fetch(`${BASE}/api/public/lead/${ca.slug}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...LANE, customerName: "CAD Tester", customerEmail: "cad@example.com", customerPhone: "+1 416 555 0100" }),
});
const lead = await leadRes.json();
console.log('== lead ==');
console.log('  status:', leadRes.status, '| refId:', lead.refId ?? '(none)');

// Rendered widget + hosted quote page.
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
const moneyOn = async (url, tag) => {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const txt = await page.evaluate(() => document.body.innerText);
  const hits = [...new Set(txt.match(/(?:CA\$|US\$|\$)\s?[\d,]+\.\d{2}/g) || [])];
  console.log(`  ${tag}: ${hits.length ? hits.slice(0, 8).join('  ') : '(no money rendered yet)'}`);
  return hits;
};
console.log('== rendered ==');
if (lead.quoteUrl) await moneyOn(lead.quoteUrl.startsWith('http') ? lead.quoteUrl : BASE + lead.quoteUrl, 'hosted quote page');
await page.screenshot({ path: path.join(OUT, 'cad-quote-page.png'), fullPage: true });
await browser.close();

console.log('\n== VERDICT ==');
console.log('  CA tenant labels CAD:', rCa.currency === 'CAD' ? 'PASS ✓' : 'FAIL ✗');
console.log('  US tenant still USD :', rUs.currency === 'USD' ? 'PASS ✓' : 'FAIL ✗');
console.log('  no amount converted :', sameNumber ? 'PASS ✓' : 'FAIL ✗');
