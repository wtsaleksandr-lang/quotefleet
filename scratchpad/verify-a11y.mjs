import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
await page.goto('http://localhost:8854/w/demo?raw=1', { waitUntil: 'networkidle' });
await page.locator('#qf-calc-btn').waitFor({ timeout: 20000 });
await page.waitForTimeout(1000);

let pass = true;
const ok = (label, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label); if (!cond) pass = false; };

// ---------- FIX 3: service tab semantics ----------
console.log('\n=== FIX 3: service tab semantics ===');
const tabs = page.locator('#qf-services button');
const nTabs = await tabs.count();
const listRole = await page.locator('#qf-services').getAttribute('role');
console.log('tab count:', nTabs, '| container role:', listRole);
ok('#qf-services role=tablist', listRole === 'tablist');
if (nTabs > 0) {
  const roles = await tabs.evaluateAll(bs => bs.map(b => b.getAttribute('role')));
  const sel = await tabs.evaluateAll(bs => bs.map(b => b.getAttribute('aria-selected')));
  const active = await tabs.evaluateAll(bs => bs.map(b => b.classList.contains('active')));
  console.log('roles:', roles, '| aria-selected:', sel, '| active class:', active);
  ok('every tab role=tab', roles.every(r => r === 'tab'));
  ok('exactly one aria-selected=true', sel.filter(s => s === 'true').length === 1);
  ok('aria-selected mirrors .active', sel.every((s, i) => (s === 'true') === active[i]));
  if (nTabs > 1) {
    // Switch to the 2nd tab and re-check.
    await tabs.nth(1).click();
    await page.waitForTimeout(300);
    const sel2 = await tabs.evaluateAll(bs => bs.map(b => b.getAttribute('aria-selected')));
    console.log('after switching to tab[1] — aria-selected:', sel2);
    ok('tab[1] now aria-selected=true', sel2[1] === 'true');
    ok('tab[0] now aria-selected=false', sel2[0] === 'false');
    ok('still exactly one selected', sel2.filter(s => s === 'true').length === 1);
    await tabs.nth(0).click(); // reset
    await page.waitForTimeout(200);
  } else {
    console.log('(demo has a single service — tablist hidden but semantics still asserted)');
  }
}

// ---------- FIX 2: options modal focus management ----------
console.log('\n=== FIX 2: options modal focus management ===');
const summary = page.locator('#qf-options-summary');
await summary.scrollIntoViewIfNeeded();
await summary.focus();
const triggerFocused = await page.evaluate(() => document.activeElement && document.activeElement.id);
console.log('trigger focused before open:', triggerFocused);
await summary.click();
await page.waitForTimeout(400);

const modalHidden = await page.locator('#qf-options-modal').evaluate(m => m.hidden);
ok('modal open (not hidden)', modalHidden === false);
const activeInModal = await page.evaluate(() => {
  const card = document.querySelector('#qf-options-modal .qf-modal-card');
  return { id: document.activeElement && document.activeElement.id, inside: !!(card && card.contains(document.activeElement)) };
});
console.log('activeElement on open:', activeInModal);
ok('focus moved INTO the dialog on open', activeInModal.inside === true);

// Focus trap: Tab forward from last focusable should wrap to first (stay inside).
const trap = await page.evaluate(async () => {
  const card = document.querySelector('#qf-options-modal .qf-modal-card');
  const f = Array.prototype.slice.call(card.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter(n => n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  return { count: f.length, firstId: f[0] && (f[0].id || f[0].className), lastId: f[f.length-1] && (f[f.length-1].id || f[f.length-1].className) };
});
console.log('focusables in dialog:', trap);

// Simulate Tab from the last focusable element.
await page.evaluate(() => {
  const card = document.querySelector('#qf-options-modal .qf-modal-card');
  const f = Array.prototype.slice.call(card.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter(n => n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  f[f.length - 1].focus();
});
await page.keyboard.press('Tab');
await page.waitForTimeout(150);
let stillInside = await page.evaluate(() => {
  const card = document.querySelector('#qf-options-modal .qf-modal-card');
  return !!(card && card.contains(document.activeElement));
});
ok('Tab from last focusable stays inside dialog (wraps)', stillInside);

// Shift+Tab from the first focusable should wrap to last (stay inside).
await page.evaluate(() => {
  const card = document.querySelector('#qf-options-modal .qf-modal-card');
  const f = Array.prototype.slice.call(card.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter(n => n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  f[0].focus();
});
await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(150);
stillInside = await page.evaluate(() => {
  const card = document.querySelector('#qf-options-modal .qf-modal-card');
  return !!(card && card.contains(document.activeElement));
});
ok('Shift+Tab from first focusable stays inside dialog (wraps)', stillInside);

// Esc closes + returns focus to the trigger.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const afterEsc = await page.evaluate(() => ({
  hidden: document.getElementById('qf-options-modal').hidden,
  active: document.activeElement && document.activeElement.id,
}));
console.log('after Esc:', afterEsc);
ok('Esc closes the modal', afterEsc.hidden === true);
ok('Esc returns focus to the trigger (#qf-options-summary)', afterEsc.active === 'qf-options-summary');

await page.screenshot({ path: 'scratchpad/fix-a11y-state.png' });
await browser.close();
console.log('\nOVERALL: ' + (pass ? 'PASS' : 'FAIL'));
process.exit(pass ? 0 : 1);
