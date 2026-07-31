import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.resolve('src/server/public');
const HARNESS = path.resolve('scratchpad/ob-harness.html');
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/harness') {
    const d = fs.readFileSync(HARNESS);
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(d);
  }
  const f = path.join(PUBLIC, p);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8931, () => console.log('ob-harness on http://localhost:8931'));
