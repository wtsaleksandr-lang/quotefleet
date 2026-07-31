import { chromium } from '@playwright/test';
const URL = 'http://localhost:8854/w/demo?raw=1&preset=midnight&mapStyle=branded&mapTheme=light';
const OUT = 'C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/qf-audit';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:520,height:920}, deviceScaleFactor:1.5 });
const page = await ctx.newPage();
const errors=[]; page.on('pageerror',e=>errors.push('P:'+e.message)); page.on('console',m=>{if(m.type()==='error')errors.push('C:'+m.text());});
await page.goto(URL,{waitUntil:'networkidle'});
await page.waitForTimeout(1800);
async function fillPlace(sel,val){ await page.click(sel); await page.fill(sel,''); await page.type(sel,val,{delay:80}); await page.waitForTimeout(1600); const pac=await page.$('.pac-item'); if(pac){await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');} else {await page.keyboard.press('Enter');} await page.waitForTimeout(1000); }
await fillPlace('#qf-pickup-zip','90802');
await fillPlace('#qf-delivery-zip','85001');
await page.fill('#qf-weight','20000');
await page.click('#qf-calc-btn');
await page.waitForTimeout(3000);
await page.click('#qf-continue-btn');
await page.waitForTimeout(800);
// fill lead form
await page.fill('#qf-c-name','Jordan Fields');
await page.fill('#qf-c-email','jordan@acme-shipping.com');
await page.fill('#qf-c-phone','(562) 555-0199');
await page.fill('#qf-c-company','Acme Shipping');
await page.fill('#qf-c-notes','Dock open 8-4, forklift on site.');
await page.click('#qf-submit-btn');
await page.waitForTimeout(3500);
await page.screenshot({path:`${OUT}/shell-desktop-30-thanks.png`, fullPage:true});
const thanks = await page.evaluate(()=>{ const t=document.getElementById('qf-step-thanks'); return {vis:t?t.getBoundingClientRect().height>0:null, text:t?t.innerText.slice(0,500):null}; });
console.log('THANKS:', JSON.stringify(thanks,null,1));

// open AI chat
await page.click('#qf-chat-open-btn').catch(e=>console.log('chat click',e.message));
await page.waitForTimeout(700);
await page.screenshot({path:`${OUT}/shell-desktop-31-chat-open.png`, fullPage:true});
// send a question, check live AI response
await page.fill('#qf-chat-input','How long is transit and can you do a Friday pickup?').catch(()=>{});
await page.click('#qf-chat-send').catch(()=>{});
await page.waitForTimeout(6000);
await page.screenshot({path:`${OUT}/shell-desktop-32-chat-answer.png`, fullPage:true});
const chat = await page.evaluate(()=>{ const p=document.getElementById('qf-chat'); return p?p.innerText.slice(0,600):null; });
console.log('CHAT CONTENT:', JSON.stringify(chat));

// open callback
await page.click('#qf-callback-open-btn').catch(e=>console.log('cb click',e.message));
await page.waitForTimeout(700);
await page.screenshot({path:`${OUT}/shell-desktop-33-callback-open.png`, fullPage:true});
if(errors.length) console.log('ERRORS:\n'+errors.join('\n'));
console.log('DONE thanks');
await browser.close();
