// Visual-review gate for the re-paced hero loops.
// Serves the real landing page, seeks BOTH hero videos to their payoff frame,
// and screenshots desktop + mobile 375px so the payoff can be judged in context
// (the laptop is downscaled ~3.7x on mobile, so legibility there is the risk).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { chromium } from '@playwright/test';

const PUB = path.resolve('src/server/public');
const OUT = path.resolve('scratchpad');
const TYPES = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.webm':'video/webm','.mp4':'video/mp4','.webmanifest':'application/manifest+json' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(url.parse(req.url).pathname);
  let rel = p.replace(/^\/+/, '') || 'landing.html';
  if (rel === '' || rel === '/') rel = 'landing.html';
  const fp = path.join(PUB, rel);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ctype = TYPES[path.extname(fp)] || 'application/octet-stream';
  const size = fs.statSync(fp).size;
  // Video seeking REQUIRES byte-range support — without 206 responses the
  // browser can't jump to a timestamp and currentTime silently stays at 0.
  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= size) end = size - 1;
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, {
      'Content-Type': ctype,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(fp, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': ctype, 'Accept-Ranges': 'bytes', 'Content-Length': size });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch();

// Seek both hero videos to a timestamp inside the payoff hold and pause there.
async function freezeAtPayoff(page, lapT, phT) {
  return await page.evaluate(async ([lt, pt]) => {
    const seek = async (v, t) => {
      if (!v) return null;
      v.loop = false;              // stop the loop from rewinding us
      v.autoplay = false;
      v.pause();
      // preload="metadata" means the payoff timestamp isn't buffered yet — force
      // a full load and wait until the frame at `t` is actually decodable.
      v.preload = 'auto';
      v.load();
      await new Promise((res) => {
        if (v.readyState >= 3) return res();
        const done = () => { v.removeEventListener('canplaythrough', done); res(); };
        v.addEventListener('canplaythrough', done);
        setTimeout(res, 8000);
      });
      v.pause();
      await new Promise((res) => {
        const done = () => { v.removeEventListener('seeked', done); res(); };
        v.addEventListener('seeked', done);
        v.currentTime = t;
        setTimeout(res, 5000);
      });
      // A paused <video> in headless Chromium does NOT repaint after a seek —
      // the compositor keeps showing the previously painted frame (frame 0), and
      // the poster can reappear after load(). Drop the poster and play a beat so
      // a real frame at ~t is actually pushed, then freeze there.
      v.removeAttribute('poster');
      try { await v.play(); } catch {}
      await new Promise((r) => setTimeout(r, 300));
      v.pause();
      return { requested: t, landed: Number(v.currentTime.toFixed(2)), dur: Number((v.duration || 0).toFixed(2)) };
    };
    const laptop = await seek(document.querySelector('.qf-browser-vid'), lt);
    const phone = await seek(document.querySelector('.qf-hero-vphone__vid'), pt);
    return { laptop, phone };
  }, [lapT, phT]);
}

const results = [];
for (const [label, w, h] of [['desktop', 1440, 900], ['mobile', 375, 812]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/landing.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const seekInfo = await freezeAtPayoff(page, 6.0, 7.0);
  console.log(`[${label}] seek →`, JSON.stringify(seekInfo));

  const media = page.locator('.qf-hero-media').first();
  await media.screenshot({ path: path.join(OUT, `hero-pause-${label}.png`) }); await page.screenshot({ path: path.join(OUT, `hero-pause-${label}-full.png`) });

  // Measure the rendered size of each device so we know the real downscale factor.
  const dims = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return { laptop: g('.qf-browser-vid'), phone: g('.qf-hero-vphone__vid') };
  });
  results.push({ label, viewport: `${w}x${h}`, ...dims });
  await ctx.close();
}

await browser.close();
server.close();

for (const r of results) {
  const lap = r.laptop ? `${r.laptop.w}x${r.laptop.h} (downscale ${(1280 / r.laptop.w).toFixed(2)}x from 1280)` : 'n/a';
  const ph = r.phone ? `${r.phone.w}x${r.phone.h} (downscale ${(390 / r.phone.w).toFixed(2)}x from 390)` : 'n/a';
  console.log(`${r.label} @ ${r.viewport}\n  laptop: ${lap}\n  phone:  ${ph}`);
}
console.log('SHOTS hero-pause-desktop.png hero-pause-mobile.png');
