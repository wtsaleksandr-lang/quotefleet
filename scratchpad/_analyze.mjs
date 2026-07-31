import fs from 'node:fs';
const R=JSON.parse(fs.readFileSync('C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-claude-orchestrator/db4b8d02-7aaa-40de-8e39-49f7a8b0dfd1/scratchpad/contrast-audit-report.json','utf8'));
for(const preset of Object.keys(R)){
  const seen=new Map();
  for(const bp of ['desktop','mobile']){
    const st=R[preset][bp]; if(!st) continue;
    for(const k of ['calc','tabMoved','modal','result']){
      for(const v of (st[k].violations||[])){
        const key=v.target+'|'+v.fg+'|'+v.bg;
        if(!seen.has(key)) seen.set(key,{target:v.target,fg:v.fg,bg:v.bg,ratio:v.ratio,exp:v.expected,states:new Set()});
        seen.get(key).states.add(bp[0]+k);
      }
    }
  }
  if(seen.size===0){ console.log(`\n### ${preset}: CLEAN`); continue; }
  console.log(`\n### ${preset} (${seen.size} unique)`);
  for(const s of seen.values()){
    console.log(`  ${s.ratio}  fg=${s.fg} bg=${s.bg}  ${s.target.slice(0,70)}`);
  }
}
