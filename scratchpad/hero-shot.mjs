// Hero mockup size verification. Serves src/server/public statically and
// screenshots the hero at 4 breakpoints. TAG=before|after.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { chromium } from '@playwright/test';

const PUB = path.resolve('src/server/public');
const OUT = 'scratchpad';
const TAG = process.env.TAG || 'after';
const PORT = Number(process.env.PORT || 8860);

const T = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf','.webmanifest':'application/manifest+json','.webm':'video/webm','.mp4':'video/mp4' };
const srv = http.createServer((req, res) => {
  const p = url.parse(req.url).pathname;
  let rel = decodeURIComponent(p).replace(/^\/+/, '') || 'landing.html';
  if (rel === '' ) rel = 'landing.html';
  const fp = path.join(PUB, rel);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return void res.end('nf'); }
  res.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise((r) => srv.listen(PORT, r));

const b = await chromium.launch();
const bps = [ ['1440', 1440], ['1280', 1280], ['768', 768], ['375', 375] ];
for (const [label, width] of bps) {
  const ctx = await b.newContext({ viewport: { width, height: 1400 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${PORT}/landing.html`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1200); // let deferred motion.js inject cleanup.css + videos start
  const info = await pg.evaluate(() => {
    const de = document.documentElement;
    const hero = document.querySelector('.hero.visual-hero');
    const lap = document.querySelector('.qf-hero-laptop');
    const ph = document.querySelector('.qf-hero-vphone');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left), right: Math.round(b.right) }; };
    return {
      scrollW: de.scrollWidth, innerW: window.innerWidth,
      overflow: de.scrollWidth - window.innerWidth,
      laptop: r(lap), phone: r(ph), heroH: hero ? Math.round(hero.getBoundingClientRect().height) : null,
    };
  });
  console.log(`[${label}] overflow=${info.overflow}px (scrollW=${info.scrollW} innerW=${info.innerW}) heroH=${info.heroH} laptop=${JSON.stringify(info.laptop)} phone=${JSON.stringify(info.phone)}`);
  const hero = pg.locator('.hero.visual-hero');
  await hero.screenshot({ path: path.join(OUT, `hero-mockups-${TAG}-${label}.png`) });
  await ctx.close();
}
await b.close();
srv.close();
console.log('done', TAG);
