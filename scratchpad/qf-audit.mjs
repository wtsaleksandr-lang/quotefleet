import { chromium } from '@playwright/test';

const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';

const MODES = ['ftl', 'expedited', 'hotshot'];
const VPS = { desk: { width: 520, height: 920 }, mob: { width: 375, height: 800 } };

async function fillAddress(p, zipSel, dropId, zip) {
  const el = await p.$(zipSel);
  if (!el) return `no ${zipSel}`;
  await el.click();
  await el.fill('');
  await el.type(zip, { delay: 40 });
  await p.waitForTimeout(1400);
  // try click first suggestion in any visible dropdown
  const sugg = await p.$('.qf-typeahead-item, .qf-suggestion, [role="option"], .pac-item');
  if (sugg) { await sugg.click(); await p.waitForTimeout(500); return 'picked-suggestion'; }
  return 'typed-no-suggestion';
}

async function overflowReport(p) {
  return await p.evaluate(() => {
    const root = document.querySelector('#qf-widget, .qf-widget, #qf-root') || document.body;
    const out = [];
    const all = root.querySelectorAll('*');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // horizontal overflow beyond viewport
      if (r.right > window.innerWidth + 2 || r.left < -2) {
        const cls = (el.className && el.className.toString().slice(0,40)) || el.id || el.tagName;
        out.push(`OVERFLOW-X ${cls} right=${Math.round(r.right)} vw=${window.innerWidth}`);
      }
    }
    // body horizontal scroll
    const bodyScroll = document.documentElement.scrollWidth > window.innerWidth + 2;
    return { bodyScrollX: bodyScroll, items: [...new Set(out)].slice(0, 15) };
  });
}

const b = await chromium.launch();
const log = [];

for (const [vpName, vp] of Object.entries(VPS)) {
  const p = await b.newPage({ viewport: vp });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  for (const mode of MODES) {
    const tag = `${mode}-${vpName}`;
    const rec = { tag, notes: [] };
    const btn = await p.$(`#qf-services button[data-service="${mode}"]`);
    await btn.click();
    await p.waitForTimeout(700);

    // weight placeholder + equipment default
    rec.weightPh = await p.$eval('#qf-weight', el => el.placeholder).catch(()=>null);
    rec.equipDefault = await p.$eval('#qf-equipment', el => el.options[el.selectedIndex]?.textContent.trim()).catch(()=>null);
    rec.equipCount = await p.$eval('#qf-equipment', el => el.options.length).catch(()=>0);

    // screenshot initial form (full page)
    await p.screenshot({ path: `${OUT}/otr-${tag}-1-form.png`, fullPage: true });

    // fill weight
    await p.$eval('#qf-weight', el => { el.value=''; }).catch(()=>{});
    const w = await p.$('#qf-weight');
    if (w) { await w.fill('12000'); }

    // fill addresses
    rec.pickup = await fillAddress(p, '#qf-pickup-zip', null, '90802');
    rec.delivery = await fillAddress(p, '#qf-delivery-zip', null, '85001');
    await p.waitForTimeout(800);

    // options modal
    const optSummary = await p.$('#qf-options-summary');
    if (optSummary) {
      await optSummary.click();
      await p.waitForTimeout(600);
      await p.screenshot({ path: `${OUT}/otr-${tag}-3-options.png`, fullPage: true });
      // list chips
      rec.chips = await p.$$eval('#qf-options-modal .qf-acc-chip', els => els.map(e=>e.textContent.trim())).catch(()=>[]);
      // close modal
      const closeBtn = await p.$('#qf-options-modal [aria-label*="close" i], #qf-options-modal .qf-modal-close, #qf-options-modal button');
      if (closeBtn) await closeBtn.click().catch(()=>{});
      await p.keyboard.press('Escape').catch(()=>{});
      await p.waitForTimeout(400);
    } else { rec.notes.push('no #qf-options-summary'); }

    // find & click get quote button
    const quoteBtn = await p.evaluateHandle(() => {
      const bs = [...document.querySelectorAll('button, a')];
      return bs.find(b => /get quote|calculate|get my quote|see price|estimate/i.test(b.textContent||''));
    });
    const qb = quoteBtn.asElement();
    if (qb) {
      rec.quoteBtnText = await qb.evaluate(e=>e.textContent.trim());
      await qb.scrollIntoViewIfNeeded().catch(()=>{});
      await qb.click().catch(()=>{});
      await p.waitForTimeout(2500);
    } else { rec.notes.push('no quote button found'); }

    // result
    const result = await p.$('#qf-result');
    rec.hasResult = !!result;
    if (result) {
      rec.resultText = (await result.evaluate(e=>e.innerText)).replace(/\s+/g,' ').slice(0, 400);
      await result.scrollIntoViewIfNeeded().catch(()=>{});
      await p.waitForTimeout(300);
    }
    await p.screenshot({ path: `${OUT}/otr-${tag}-4-result.png`, fullPage: true });

    rec.overflow = await overflowReport(p);
    log.push(rec);
    // reset page for next mode to clear state
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
  }
  await p.close();
}

await b.close();
console.log(JSON.stringify(log, null, 2));
