// Render landing.html at deviceScaleFactor 2 (desktop 1440 + mobile 390), force
// each hero device to the foreground stage, seek its video to each beat's mid-
// time, and screenshot the hero — to confirm the captions render inside the
// mockups, crisp + hero-styled + synced, foreground-only, no clipped words.
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
const SHOT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'qfhero-verify');
fs.mkdirSync(SHOT, { recursive: true });
const TYPES = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.webmanifest':'application/manifest+json','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm' };

const server = http.createServer((req, res) => {
  const u = url.parse(req.url);
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'landing.html';
  if (rel === '' || rel === '/') rel = 'landing.html';
  const fp = path.join(PUB, rel);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const LAPTOP_TIMES = [3, 8.5, 16, 22.5, 26.8, 31];   // import, review, customize, embed, leads, followup
const PHONE_TIMES = [6, 16, 21.5, 28];               // quote, ai, lead, deposit

const browser = await chromium.launch();

async function run(label, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 800 : 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:' + port + '/landing.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.qf-hero-devices--video', { timeout: 8000 });
  // Freeze the swap choreography so we can drive stage + currentTime.
  await page.evaluate(() => { try { window.qfHeroSwap && window.qfHeroSwap.pause(); } catch (e) {} });
  await page.waitForTimeout(200);
  const heroBox = await page.evaluate(() => {
    const el = document.querySelector('.qf-hero-media') || document.querySelector('.hero');
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(window.innerWidth, r.width + 16), height: r.height + 16 };
  });

  async function shot(stage, video, t, name) {
    await page.evaluate(({ stage, video, t }) => {
      const wrap = document.querySelector('.qf-hero-devices--video');
      wrap.classList.remove('stage-laptop', 'stage-phone');
      wrap.classList.add(stage);
      const v = wrap.querySelector(video);
      // Headless can't reliably SEEK preload=metadata video; fast-forward PLAY to
      // the target time instead (advances currentTime + renders real frames, so
      // the caption JS's timeupdate handler syncs exactly as it will in prod).
      v.muted = true; v.loop = false;
      if (v.currentTime > t + 0.2) { try { v.currentTime = 0; } catch (e) {} }
      v.playbackRate = 16;
      const p = v.play(); if (p && p.catch) p.catch(function () {});
    }, { stage, video, t });
    // Poll until the video has played up to (just past) the target time, then pause.
    await page.waitForFunction(({ video, t }) => {
      const v = document.querySelector('.qf-hero-devices--video ' + video);
      return v && (v.currentTime || 0) >= t;
    }, { video, t }, { timeout: 15000 }).catch(() => {});
    await page.evaluate((video) => { const v = document.querySelector('.qf-hero-devices--video ' + video); try { v.pause(); } catch (e) {} v.playbackRate = 1; }, video);
    await page.waitForTimeout(520); // caption cross-fade settle
    const cap = await page.evaluate((sel) => {
      const c = document.querySelector(sel);
      if (!c) return null;
      const k = c.querySelector('.qf-hero-cap__kicker'), ti = c.querySelector('.qf-hero-cap__title');
      const cs = getComputedStyle(c);
      return { show: c.getAttribute('data-show'), opacity: cs.opacity, kicker: k && k.textContent, title: ti && ti.textContent };
    }, stage === 'stage-laptop' ? '.qf-hero-cap--laptop' : '.qf-hero-cap--phone');
    await page.screenshot({ path: path.join(SHOT, name), clip: heroBox });
    console.log(label, name, JSON.stringify(cap));
  }

  for (let i = 0; i < LAPTOP_TIMES.length; i++) await shot('stage-laptop', '.qf-hero-laptop video', LAPTOP_TIMES[i], `${label}_lap_${i}_${LAPTOP_TIMES[i]}.png`);
  for (let i = 0; i < PHONE_TIMES.length; i++) await shot('stage-phone', '.qf-hero-vphone video', PHONE_TIMES[i], `${label}_phone_${i}_${PHONE_TIMES[i]}.png`);
  await ctx.close();
}

await run('desk', 1440);
await run('mob', 390);
await browser.close();
server.close();
console.log('SHOT_DIR', SHOT);
