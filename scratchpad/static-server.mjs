import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('.');
http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/')p='/mock-host.html';
  const f = path.join(root,p);
  fs.readFile(f,(e,d)=>{ if(e){res.writeHead(404);res.end('nf');return;} res.writeHead(200,{'content-type':p.endsWith('.html')?'text/html':'text/plain'});res.end(d);});
}).listen(8899,()=>console.log('host on 8899'));
