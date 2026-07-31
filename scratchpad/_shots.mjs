// Proof-crop capture: drives the rendered widget for each preset and saves the
// three previously-failing surfaces (active service tab, result card w/ ETA +
// timeline + line items, footer) to repo scratchpad/contrast-fixed-*.png.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url'; import zlib from 'node:zlib';
import { chromium } from '@playwright/test';
import { resolveWidgetTheme } from '../src/server/widgetThemes.ts';
const PUB = path.resolve('src/server/public');
const OUT = path.resolve('scratchpad');
const PORT = 8877;
const PRESETS = ['midnight','mono','ironhorse','harbor','cupertino','material','booking','tesla','stripe','stone','citron','vault','cream'];
const CRC=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function png(w,h,[r,g,b]){const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const td=Buffer.concat([Buffer.from(t),d]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(td),0);return Buffer.concat([l,td,cr]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){const o=y*(w*3+1);raw[o]=0;for(let x=0;x<w;x++){const p=o+1+x*3;raw[p]=r;raw[p+1]=g;raw[p+2]=b;}}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const MAP=png(320,180,[214,220,227]);
const PU='Milwaukee, WI 53202',DEL='Green Bay, WI 54301',MILES=118,TRANSIT='1 day';
let STATE={cfg:null};
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
function cfg(preset,theme){return{tenant:{slug:'demo',name:'Demo Freight Co',countryFocus:'US'},brand:{displayName:'Demo Freight Co',name:'Demo Freight Co',tagline:'Instant freight rates',logoUrl:null,primaryColor:theme.tokens['--w-accent'],showPoweredBy:true,ctaText:'Get my rate',themePreset:preset,fontFamily:theme.font,mapStyle:preset,ctaHover:theme.ctaHover,requireEmail:true,requirePhone:false,showQuoteBeforeContact:false},contact:{phone:'(414) 555-0177',email:'dispatch@demo.co',address:'1200 Freight Way, Milwaukee, WI 53202',dotNumber:'3128840',mcNumber:'1002233'},disclaimer:'Rates are estimates and subject to final confirmation by the team.',features:{quoteShare:true,quoteBooking:false},booking:{mode:'none',amount:0},theme,services:['ftl','ltl','drayage'],equipmentByService:{ftl:[{value:'dryvan',label:"53' Dry Van"},{value:'reefer',label:"53' Reefer"}],ltl:[{value:'pallet',label:'LTL Pallet'}],drayage:[{value:'container_40hc',label:"40' HC container"}]},accessorials:[{code:'liftgate',label:'Liftgate',description:'Liftgate',appliesToServices:null}],drayagePorts:[],terminalsByPort:{},hasZones:false};}
const srv=http.createServer((req,res)=>{const u=url.parse(req.url,true),p=u.pathname;const J=(o)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
 if(p.startsWith('/api/public/widget/'))return void J(STATE.cfg);
 if(p==='/api/public/base-map.png'||p==='/api/public/route-map.png'){res.writeHead(200,{'Content-Type':'image/png'});return void res.end(MAP);}
 if(p.startsWith('/api/public/quote-map/')){res.writeHead(200,{'Content-Type':'image/png'});return void res.end(MAP);}
 if(p.startsWith('/api/public/route-preview/'))return void J({ok:true,miles:MILES,transit:{text:TRANSIT},origin:{lat:43,lng:-87.9},destination:{lat:44.5,lng:-88},mapUrl:'/api/public/route-map.png?x=1'});
 if(p.startsWith('/api/public/autocomplete'))return void J({suggestions:[]});
 if(p.startsWith('/api/public/quote/'))return void J({miles:MILES,transit:{text:TRANSIT},result:{total:1840,lines:[{name:'Line haul',amount:1520},{name:'Fuel surcharge',amount:235},{name:'Liftgate',amount:85}]}});
 if(p.startsWith('/api/public/lead/'))return void J({refId:'QF-DEMO-40817'});
 if(p==='/w/demo'){res.writeHead(200,{'Content-Type':'text/html'});return void res.end(fs.readFileSync(path.join(PUB,'widget.html')));}
 let rel=decodeURIComponent(p).replace(/^\/+/,'')||'index.html';const fp=path.join(PUB,rel);
 if(!fp.startsWith(PUB)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.writeHead(404);return void res.end('nf');}
 res.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});res.end(fs.readFileSync(fp));});
await new Promise(r=>srv.listen(PORT,r));
async function drive(pg){await pg.evaluate(({pu,del})=>{const t=document.querySelectorAll('#qf-services button');if(t[0])t[0].click();const eq=document.getElementById('qf-equipment');if(eq&&eq.options.length){eq.selectedIndex=Math.min(1,eq.options.length-1);eq.dispatchEvent(new Event('change',{bubbles:true}));}const s=(id,v)=>{const e=document.getElementById(id);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}};s('qf-weight','38000');s('qf-pickup-zip',pu);s('qf-delivery-zip',del);},{pu:PU,del:DEL});await pg.waitForTimeout(300);}
const b=await chromium.launch();
for(const preset of PRESETS){
  const theme=resolveWidgetTheme({themePreset:preset});STATE.cfg=cfg(preset,theme);
  const ctx=await b.newContext({viewport:{width:900,height:1500},deviceScaleFactor:2});const pg=await ctx.newPage();
  await pg.goto(`http://localhost:${PORT}/w/demo`,{waitUntil:'networkidle'});await pg.waitForTimeout(500);await drive(pg);
  // move to the LTL tab so the sliding indicator sits under an active tab (the stone/vault/tesla regression state)
  await pg.evaluate(()=>{const t=document.querySelectorAll('#qf-services button');if(t[1])t[1].click();});await pg.waitForTimeout(450);
  await pg.locator('#qf-services').screenshot({path:path.join(OUT,`contrast-fixed-${preset}-tab.png`)}).catch(()=>{});
  await pg.evaluate(()=>{const t=document.querySelectorAll('#qf-services button');if(t[0])t[0].click();});await pg.waitForTimeout(250);await drive(pg);
  await pg.click('#qf-calc-btn');await pg.waitForTimeout(1200);
  await pg.locator('#qf-root').screenshot({path:path.join(OUT,`contrast-fixed-${preset}-result.png`)}).catch(()=>{});
  await ctx.close();
  console.log('shot',preset);
}
await b.close();srv.close();process.exit(0);
