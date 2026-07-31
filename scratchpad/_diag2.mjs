import { chromium } from '@playwright/test';
const BASE='http://localhost:8854';
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:300}});
const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{email:'grab+mrslk5ys@example.com',password:'GrabScroll123!'}});
console.log('login',lr.status());
const pg=await ctx.newPage(); await pg.goto(`${BASE}/app`,{waitUntil:'networkidle'}); await pg.waitForTimeout(1500);
await pg.evaluate(()=>{document.querySelectorAll('[class*="onboarding"]').forEach(n=>{if(n.style)n.style.display='none'}); document.documentElement.classList.remove('qf-ob-open');});
await pg.evaluate(()=>{const n=document.querySelector('.sidebar [data-route="rates"]'); if(n)n.click();}); await pg.waitForTimeout(1500);
const dump=await pg.evaluate(()=>{
  const main=document.querySelector('.app-main'); const mr=main.getBoundingClientRect();
  const out=[];
  for(let y=50;y<270;y+=30){ const row=[]; for(let x=300;x<1440;x+=180){ const el=document.elementFromPoint(x,y); row.push(el?(el.tagName+'.'+(el.className||'')).slice(0,22)+(main.contains(el)?'':'*OUT'):'null'); } out.push('y'+y+': '+row.join(' | ')); }
  return {mrTop:mr.top, mrLeft:mr.left, out};
});
console.log('app-main top=',dump.mrTop,'left=',dump.mrLeft);
dump.out.forEach(l=>console.log(l));
await b.close();
