import { pathToFileURL } from 'url';
const _pw = await import(pathToFileURL('C:/Users/Owner/.codex/quotefleet/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.js').href);
const chromium = (_pw.default && _pw.default.chromium) || _pw.chromium;
const BASE='http://localhost:8854', OUT='C:/Users/Owner/.codex/quotefleet/scratchpad';
const stamp=Date.now();
const b=await chromium.launch({headless:true});
const c=await b.newContext({viewport:{width:375,height:812},deviceScaleFactor:2,ignoreHTTPSErrors:true});
await c.request.post(BASE+'/api/auth/signup',{data:{companyName:'Drawer '+stamp,email:'drawer+'+stamp+'@example.com',password:'ReproTest!2345',countryFocus:'US',dpaAccepted:true,dpaVersion:'1.0'},headers:{'Content-Type':'application/json'}});
const p=await c.newPage();
await p.goto(BASE+'/app',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1500);
// skip wizard
const skip=p.locator('button:has-text("Skip for now"),button:has-text("Skip")').first();
if(await skip.count()&&await skip.isVisible().catch(()=>false)){await skip.click().catch(()=>{});await p.waitForTimeout(600);}
// tap hamburger
const ham=p.locator('.qf-menu-toggle,[aria-label*="menu" i],.sidebar-toggle').first();
console.log('hamburger count',await ham.count());
await ham.click().catch(e=>console.log('ham click err',e.message));
await p.waitForTimeout(700);
const st=await p.evaluate(()=>{const sb=document.querySelector('.sidebar');const r=sb.getBoundingClientRect();const cs=getComputedStyle(sb);
 // does it cover full screen or overlap content? check overlay
 const ov=document.querySelector('.qf-nav-scrim,.sidebar-scrim,.scrim,.backdrop,[class*="scrim"],[class*="overlay"]');
 return {left:Math.round(r.left),width:Math.round(r.width),right:Math.round(r.right),display:cs.display,scrim:!!ov, vw:window.innerWidth};});
console.log('drawer after open:',JSON.stringify(st));
await p.screenshot({path:OUT+'/dash-mobile-drawer-open.png',fullPage:false});
// try navigate via a nav item
const navRates=p.locator('.sidebar [data-route="rates"]').first();
await navRates.click().catch(e=>console.log('nav click err',e.message));
await p.waitForTimeout(800);
const url=p.url();
const drawerClosed=await p.evaluate(()=>{const sb=document.querySelector('.sidebar');const r=sb.getBoundingClientRect();return r.left<0;});
console.log('after nav click url=',url,'drawerAutoClosed=',drawerClosed);
await b.close();
console.log('DONE drawer');
