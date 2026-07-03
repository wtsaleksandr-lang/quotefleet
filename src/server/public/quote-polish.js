(function(){
  'use strict';
  var EMAIL_RE=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  function $(id){return document.getElementById(id);}
  function mailAnchor(email){var a=document.createElement('a');a.href='mailto:'+email;a.textContent=email;return a;}
  function line(text){var s=document.createElement('span');s.className='qdoc-line';var m=String(text||'').match(EMAIL_RE);if(!m){s.textContent=text;return s;}var before=text.slice(0,m.index);var after=text.slice(m.index+m[0].length);if(before)s.appendChild(document.createTextNode(before));s.appendChild(mailAnchor(m[0]));if(after)s.appendChild(document.createTextNode(after));return s;}
  function polishCarrier(){var el=$('qdoc-carrier-details');if(!el||el.dataset.polished==='1')return;var raw=el.textContent||'';if(!raw.trim())return;var parts=raw.split('·').map(function(x){return x.trim();}).filter(Boolean);el.textContent='';if(parts.length<=2){el.appendChild(line(raw.trim()));}else{var contact=[];var ids=[];parts.forEach(function(p){if(/^(MC|US DOT|SCAC)\b/i.test(p))ids.push(p);else contact.push(p);});if(contact.length)el.appendChild(line(contact.join('   ')));if(ids.length)el.appendChild(line(ids.join('   ')));}el.dataset.polished='1';}
  function polishFooter(){var el=$('qdoc-issued-by');if(!el||el.dataset.polished==='1')return;var raw=el.textContent||'';var m=raw.match(EMAIL_RE);if(!m)return;el.textContent='';var before=raw.slice(0,m.index);var after=raw.slice(m.index+m[0].length);if(before)el.appendChild(document.createTextNode(before));el.appendChild(mailAnchor(m[0]));if(after)el.appendChild(document.createTextNode(after));el.dataset.polished='1';}
  function run(){polishCarrier();polishFooter();}
  var obs=new MutationObserver(function(){run();});
  document.addEventListener('DOMContentLoaded',function(){run();var d=$('qdoc-carrier-details');var f=$('qdoc-issued-by');if(d)obs.observe(d,{childList:true,characterData:true,subtree:true});if(f)obs.observe(f,{childList:true,characterData:true,subtree:true});});
})();
