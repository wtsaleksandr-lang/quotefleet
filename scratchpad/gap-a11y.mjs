import { chromium } from '@playwright/test';
const BASE='http://localhost:8854';
const log=(...a)=>console.log(...a);
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:900,height:1200}});
const pg=await ctx.newPage();
await pg.goto(`${BASE}/w/demo?raw=1`,{waitUntil:'networkidle'});
await pg.waitForTimeout(800);
const aria = await pg.evaluate(()=>{
  const tabs=Array.from(document.querySelectorAll('#qf-services button')).map(t=>({txt:t.textContent.trim(), role:t.getAttribute('role'), sel:t.getAttribute('aria-selected')}));
  const wt=Array.from(document.getElementById('qf-wt-unit')?.querySelectorAll('button')||[]).map(x=>({t:x.textContent,pressed:x.getAttribute('aria-pressed')}));
  const help=document.querySelector('.qf-help');
  const optBtn=document.getElementById('qf-options-summary');
  return { servicesRole: document.getElementById('qf-services')?.getAttribute('role'), tabs, weightToggle: wt,
    help: help?{role:help.getAttribute('role'),tabindex:help.getAttribute('tabindex'),label:help.getAttribute('aria-label')}:null,
    optionsBtn: optBtn?{haspopup:optBtn.getAttribute('aria-haspopup'),expanded:optBtn.getAttribute('aria-expanded')}:null };
});
log('[aria]', JSON.stringify(aria));
const order=[];
for (let i=0;i<13;i++){
  await pg.keyboard.press('Tab');
  const f=await pg.evaluate(()=>{const a=document.activeElement;if(!a)return null;const cs=getComputedStyle(a);
    return {id:a.id||null,tag:a.tagName,txt:(a.textContent||'').trim().slice(0,18),outline:cs.outlineStyle+' '+cs.outlineWidth,ring:cs.boxShadow!=='none'};});
  order.push(f);
}
log('[tab order]', JSON.stringify(order));
await pg.evaluate(()=>document.getElementById('qf-options-summary')?.focus());
await pg.keyboard.press('Enter'); await pg.waitForTimeout(500);
const modal = await pg.evaluate(()=>{const m=document.getElementById('qf-options-modal');const card=m?.querySelector('.qf-modal-card');
  return {hidden:m?.hasAttribute('hidden'),display:m?getComputedStyle(m).display:'?',ariaModal:card?.getAttribute('aria-modal'),role:card?.getAttribute('role'),focusInside:m?m.contains(document.activeElement):false,active:document.activeElement?.id||document.activeElement?.className};});
log('[modal opened]', JSON.stringify(modal));
// tab trap: press Tab a bunch, ensure focus stays inside modal
let escapedTrap=false;
for(let i=0;i<10;i++){await pg.keyboard.press('Tab');const inside=await pg.evaluate(()=>document.getElementById('qf-options-modal')?.contains(document.activeElement));if(!inside){escapedTrap=true;break;}}
log('[modal focus-trap] focus escaped modal during Tab cycling=', escapedTrap);
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
const esc = await pg.evaluate(()=>{const m=document.getElementById('qf-options-modal');return {hidden:m?.hasAttribute('hidden'),display:m?getComputedStyle(m).display:'?',focusReturn:document.activeElement?.id||document.activeElement?.className};});
log('[modal after Esc]', JSON.stringify(esc));
await ctx.close(); await b.close(); process.exit(0);
