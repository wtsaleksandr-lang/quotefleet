/**
 * Server-rendered FREE-FOREVER profile-claim pages (routes/claim.ts):
 *
 *   /claim         — finder: type a USDOT / MC / name, pick your company.
 *   /claim/:slug   — the 3-step claim for ONE carrier:
 *                      1 Your email → 2 Verify ownership → 3 Done.
 *
 * Reuses the directory chrome (layout / dir-hero / .cp-card / .join-field) so
 * the page is visually a sibling of the profile it claims. Copy is deliberate:
 * claiming is free and always will be — no trial, no card, no plan. The ONLY
 * paid thing is the quote tool, which is offered as an OPTIONAL upsell at the
 * bottom of the page and again on the success step (30 days free, not 14).
 *
 * Pure render (no I/O) so it is unit-tested by string assertions.
 */
import { layout, esc, carrierName, crumbsHtml, VERIFIED_OWNER_BADGE, type Crumb } from './pages.js';
import type { VisibleCarrier } from './queries.js';
import { stateByCode } from './usStates.js';

export interface ClaimViewer {
  email: string;
  /** Signed-in account has a carrier tenant (a shipper account does not). */
  hasTenant: boolean;
  /** The viewer's tenant is the one that already owns this profile. */
  ownsThisProfile: boolean;
  /** Owner who has NOT yet started the quote-tool trial → show the upsell CTA. */
  canActivateTrial: boolean;
}

const SUPPORT = 'support@quotefleet.net';

/** Copy shared by the success step and the bottom-of-page card. */
function upsellCard(opts: { profileHref: string; muted: boolean }): string {
  return `<div class="claim-upsell${opts.muted ? ' claim-upsell--bottom' : ''}" data-upsell>
      <h2>Optional — turn your profile into a lead machine.</h2>
      <p>Add the QuoteFleet rate calculator so shippers get instant quotes from your profile. Profile owners get 30 days free (not 14), no card.</p>
      <div class="claim-actions">
        <button type="button" class="btn btn-primary" data-activate-trial>Start my 30 free days <span class="arr">→</span></button>
        <a class="claim-quiet" href="${esc(opts.profileHref)}" data-keep-free>Not now — just keep my free profile</a>
      </div>
    </div>`;
}

function termsLine(): string {
  return `<p class="claim-terms">By continuing you agree to our <a href="/terms" target="_blank" rel="noopener">Terms</a>, <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> and <a href="/dpa" target="_blank" rel="noopener">DPA</a>. Claiming creates a free QuoteFleet account for your company.</p>`;
}

export function renderClaimPage(opts: { carrier: VisibleCarrier; viewer: ClaimViewer | null }): string {
  const c = opts.carrier;
  const name = carrierName(c);
  const st = stateByCode(c.state);
  const cityState = [c.city, c.state].filter(Boolean).join(', ');
  const profileHref = `/directory/carrier/${encodeURIComponent(c.slug)}`;
  const crumbs: Crumb[] = [{ name: 'Directory', path: '/directory' }];
  if (st) crumbs.push({ name: st.name, path: `/directory/${st.slug}` });
  crumbs.push({ name, path: profileHref });
  crumbs.push({ name: 'Claim' });

  const isClaimed = c.claimedTenantId != null;
  const v = opts.viewer;

  let main: string;
  if (isClaimed && !(v && v.ownsThisProfile)) {
    main = `<section class="cp-card claim-step">
      <h2>Already claimed</h2>
      <p>This profile has a verified owner. Not you? Contact <a href="mailto:${SUPPORT}">${SUPPORT}</a> from your company email with USDOT ${esc(c.usdot)} and we will sort it out.</p>
      <div class="claim-actions"><a class="btn btn-secondary" href="${esc(profileHref)}">Back to the profile <span class="arr">→</span></a></div>
    </section>`;
  } else if (isClaimed && v && v.ownsThisProfile) {
    main = `<section class="cp-card claim-step" data-step="3">
      <p class="claim-done-badge">${VERIFIED_OWNER_BADGE}</p>
      <h2>You are the verified owner of ${esc(name)}</h2>
      <p>Your profile is yours, free, forever. Your Verified owner badge can take up to a day to appear for visitors.</p>
      <div class="claim-actions"><a class="btn btn-primary" href="${esc(profileHref)}">Open my profile <span class="arr">→</span></a></div>
      ${v.canActivateTrial ? upsellCard({ profileHref, muted: false }) : ''}
    </section>`;
  } else {
    const step1Body = v
      ? v.hasTenant
        ? `<p class="claim-as">Claiming as <strong>${esc(v.email)}</strong>. <a class="claim-quiet" href="/api/auth/logout" data-signout>Not you? Sign out</a></p>
           <form class="claim-form" data-claim-start novalidate>
             <div class="claim-actions"><button type="submit" class="btn btn-primary">Continue <span class="arr">→</span></button></div>
           </form>`
        : `<p class="claim-as">You are signed in as <strong>${esc(v.email)}</strong>, which is a shipper account. <a class="claim-quiet" href="/api/auth/logout" data-signout>Sign out</a> and claim with your company email.</p>`
      : `<form class="claim-form" data-claim-start novalidate>
           <label class="join-field">
             <span class="join-field-label">Work email</span>
             <input type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required placeholder="dispatch@yourcompany.com">
           </label>
           <label class="join-field">
             <span class="join-field-label">Password (optional, 10+ characters)</span>
             <input type="password" name="password" autocomplete="new-password" minlength="10" maxlength="200" placeholder="Leave blank to sign in by email link">
           </label>
           ${termsLine()}
           <div class="claim-actions"><button type="submit" class="btn btn-primary">Continue <span class="arr">→</span></button></div>
         </form>`;

    main = `<ol class="claim-stepper" data-stepper>
      <li aria-current="step">Your email</li>
      <li>Verify ownership</li>
      <li>Done</li>
    </ol>

    <section class="cp-card claim-step" data-step="1">
      <h2>Your email</h2>
      <p>Use the address you run ${esc(name)} from. If it matches the email on the FMCSA record we can verify you instantly.</p>
      ${step1Body}
      <p class="claim-msg" data-msg role="status" aria-live="polite"></p>
    </section>

    <section class="cp-card claim-step" data-step="2" hidden>
      <h2>Verify ownership</h2>
      <div data-variant="otp" hidden>
        <p>We sent a 6-digit code to <strong data-masked></strong> — the email on ${esc(name)}'s FMCSA record. Enter it below. Codes expire in 15 minutes.</p>
        <form class="claim-form" data-claim-verify novalidate>
          <label class="join-field claim-code">
            <span class="join-field-label">6-digit code</span>
            <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000">
          </label>
          <div class="claim-actions">
            <button type="submit" class="btn btn-primary">Verify <span class="arr">→</span></button>
            <a class="claim-quiet" href="#" data-resend>Didn't get it? Send a new code</a>
          </div>
        </form>
      </div>
      <div data-variant="manual" hidden>
        <p>We couldn't find an email on your FMCSA record. Email <a href="mailto:${SUPPORT}">${SUPPORT}</a> from your company address with your USDOT and we'll verify within 1 business day.</p>
        <p class="claim-quiet">Your USDOT: <strong>${esc(c.usdot)}</strong>. Your request is saved — nothing else to do here.</p>
      </div>
      <div data-variant="magic_link" hidden>
        <p>You already have a QuoteFleet account. We emailed <strong data-claimant></strong> a sign-in link — open it and you will land back here to finish claiming.</p>
      </div>
      <p class="claim-msg" data-msg role="status" aria-live="polite"></p>
    </section>

    <section class="cp-card claim-step" data-step="3" hidden>
      <p class="claim-done-badge">${VERIFIED_OWNER_BADGE}</p>
      <h2>Verified owner of ${esc(name)}</h2>
      <p>Your profile is yours, free, forever. Shippers will see a Verified owner badge and your email on it. Your Verified owner badge can take up to a day to appear for visitors.</p>
      <div class="claim-actions"><a class="btn btn-primary" href="${esc(profileHref)}">Open my profile <span class="arr">→</span></a></div>
      ${upsellCard({ profileHref, muted: false })}
    </section>

    ${upsellCard({ profileHref, muted: true })}`;
  }

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml(crumbs)}
      <div class="claim-eyebrow">Free · forever</div>
      <h1>Claim ${esc(name)} — free, forever</h1>
      <p class="lead">USDOT ${esc(c.usdot)}${cityState ? ` · ${esc(cityState)}` : ''}. Claiming is free and always will be. No trial, no card, no plan.</p>
    </div>
  </section>
  <main class="dir-shell claim-shell" data-claim-root data-usdot="${esc(c.usdot)}" data-slug="${esc(c.slug)}" data-profile="${esc(profileHref)}">
    ${main}
  </main>
  <script>${CLAIM_SCRIPT}</script>`;

  return layout({
    title: `Claim ${name} — free, forever | QuoteFleet`,
    description: `Claim the ${name} (USDOT ${c.usdot}) carrier profile on QuoteFleet. Free forever — no trial, no card, no plan.`,
    canonicalPath: `/claim/${c.slug}`,
    bodyHtml: body,
    // Per-carrier action page: never indexed, but its links stay crawlable.
    robots: 'noindex, follow',
  });
}

/** /claim — find your company, then continue to /claim/:slug. */
export function renderClaimFinder(): string {
  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml([{ name: 'Directory', path: '/directory' }, { name: 'Claim your listing' }])}
      <div class="claim-eyebrow">Free · forever</div>
      <h1>Claim your carrier profile — free, forever</h1>
      <p class="lead">Every FMCSA carrier is already listed. Find yours by USDOT, MC number or name. Claiming is free and always will be. No trial, no card, no plan.</p>
    </div>
  </section>
  <main class="dir-shell claim-shell" data-claim-finder>
    <section class="cp-card claim-step">
      <h2>Find your company</h2>
      <form class="claim-form" data-finder-form novalidate>
        <label class="join-field">
          <span class="join-field-label">USDOT, MC number or company name</span>
          <input type="search" name="q" autocomplete="organization" required minlength="2" placeholder="e.g. 107080 or Acme Drayage">
        </label>
        <div class="claim-actions"><button type="submit" class="btn btn-primary">Search <span class="arr">→</span></button></div>
      </form>
      <p class="claim-msg" data-msg role="status" aria-live="polite"></p>
      <div class="dir-chips" data-finder-results></div>
    </section>
    <section class="cp-card claim-step">
      <h2>What you get</h2>
      <p>A Verified owner badge, control over how your profile reads, your own contact email on it, and shipper rate requests sent to you directly. Free, forever.</p>
    </section>
  </main>
  <script>${FINDER_SCRIPT}</script>`;
  return layout({
    title: 'Claim your carrier listing — free, forever | QuoteFleet',
    description: 'Find your FMCSA carrier profile on QuoteFleet and claim it. Free forever — no trial, no card, no plan.',
    canonicalPath: '/claim',
    bodyHtml: body,
  });
}

/** Client for /claim/:slug — plain ES5, same conventions as JOIN_SCRIPT. */
const CLAIM_SCRIPT = `
(function(){
  var root=document.querySelector('[data-claim-root]'); if(!root) return;
  var usdot=root.getAttribute('data-usdot'), profile=root.getAttribute('data-profile');
  var verified=false;
  function q(sel,el){ return (el||root).querySelector(sel); }
  function step(n){ return q('[data-step="'+n+'"]'); }
  function say(el,text,cls){ var m=q('[data-msg]',el); if(!m) return; m.textContent=text||''; m.className='claim-msg'+(cls?' '+cls:''); }
  function showStep(n){
    for(var i=1;i<=3;i++){ var s=step(i); if(s) s.hidden=(i!==n); }
    var items=root.querySelectorAll('[data-stepper] li');
    for(var k=0;k<items.length;k++){ var li=items[k]; li.removeAttribute('aria-current'); li.classList.remove('is-done'); if(k+1<n) li.classList.add('is-done'); if(k+1===n) li.setAttribute('aria-current','step'); }
    var first=step(n)&&step(n).querySelector('input'); if(first) first.focus();
  }
  function variant(name){ var vs=root.querySelectorAll('[data-variant]'); for(var i=0;i<vs.length;i++){ vs[i].hidden=(vs[i].getAttribute('data-variant')!==name); } }
  function post(url,body){ return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:'same-origin',body:JSON.stringify(body||{})}).then(function(r){ return r.json().then(function(j){ return {ok:r.ok,status:r.status,j:j||{}}; }); }); }
  function handleStart(res,s1){
    var j=res.j, kind=j.kind;
    if(kind==='verified'){ verified=true; showStep(3); return; }
    if(kind==='otp_sent'){ var m=q('[data-masked]'); if(m) m.textContent=j.maskedEmail||''; variant('otp'); showStep(2); say(step(2),''); return; }
    if(kind==='needs_manual'){ variant('manual'); showStep(2); return; }
    if(kind==='magic_link'){ var c=q('[data-claimant]'); if(c) c.textContent=j.email||''; variant('magic_link'); showStep(2); return; }
    if(kind==='already_claimed'){ say(s1,'This profile was just claimed by someone else. Reload to see its status.','claim-msg--err'); return; }
    say(s1,(j&&(j.message||j.error))||'Something went wrong. Try again.','claim-msg--err');
  }
  var s1=step(1), startForm=s1&&s1.querySelector('[data-claim-start]');
  if(startForm){ startForm.addEventListener('submit',function(e){
    e.preventDefault();
    var btn=startForm.querySelector('button[type="submit"]');
    var emailEl=startForm.querySelector('input[name="email"]'), pwEl=startForm.querySelector('input[name="password"]');
    var body={};
    if(emailEl){ var email=(emailEl.value||'').trim().toLowerCase(); if(!email){ say(s1,'Enter your work email.','claim-msg--err'); return; } body.email=email; }
    if(pwEl&&pwEl.value){ if(pwEl.value.length<10){ say(s1,'Password must be at least 10 characters (or leave it blank).','claim-msg--err'); return; } body.password=pwEl.value; }
    if(btn) btn.disabled=true; say(s1,'Working\\u2026');
    post('/api/claim/'+encodeURIComponent(usdot)+'/start',body)
      .then(function(res){ handleStart(res,s1); })
      .catch(function(){ say(s1,'Network error \\u2014 try again.','claim-msg--err'); })
      .then(function(){ if(btn) btn.disabled=false; });
  }); }
  var s2=step(2), verifyForm=s2&&s2.querySelector('[data-claim-verify]');
  if(verifyForm){ verifyForm.addEventListener('submit',function(e){
    e.preventDefault();
    var code=(verifyForm.querySelector('input[name="code"]').value||'').replace(/\\D/g,'');
    if(code.length!==6){ say(s2,'Enter the 6-digit code from the email.','claim-msg--err'); return; }
    var btn=verifyForm.querySelector('button[type="submit"]'); if(btn) btn.disabled=true; say(s2,'Checking\\u2026');
    post('/api/claim/'+encodeURIComponent(usdot)+'/verify',{code:code})
      .then(function(res){
        var j=res.j, kind=j.kind;
        if(kind==='verified'){ verified=true; showStep(3); return; }
        if(kind==='wrong_code'){ say(s2,'That code is not right. '+(j.attemptsLeft||0)+' attempt'+(j.attemptsLeft===1?'':'s')+' left.','claim-msg--err'); return; }
        if(kind==='locked'){ say(s2,'Too many wrong codes. Send a new code to try again.','claim-msg--err'); return; }
        if(kind==='expired'){ say(s2,'That code expired. Send a new code.','claim-msg--err'); return; }
        if(kind==='already_claimed'){ say(s2,'This profile was just claimed by someone else.','claim-msg--err'); return; }
        say(s2,(j&&(j.message||j.error))||'Could not verify. Try again.','claim-msg--err');
      })
      .catch(function(){ say(s2,'Network error \\u2014 try again.','claim-msg--err'); })
      .then(function(){ if(btn) btn.disabled=false; });
  }); }
  var resend=s2&&s2.querySelector('[data-resend]');
  if(resend){ resend.addEventListener('click',function(e){ e.preventDefault(); say(s2,'Sending a new code\\u2026');
    post('/api/claim/'+encodeURIComponent(usdot)+'/start',{}).then(function(res){ if(res.j.kind==='otp_sent'){ say(s2,'New code sent.','claim-msg--ok'); } else { handleStart(res,s2); } }).catch(function(){ say(s2,'Network error \\u2014 try again.','claim-msg--err'); });
  }); }
  var acts=root.querySelectorAll('[data-activate-trial]');
  for(var a=0;a<acts.length;a++){ (function(btn){ btn.addEventListener('click',function(){
    if(!verified&&!btn.closest('[data-step="3"]')){ var el=step(1)||root; el.scrollIntoView({behavior:'smooth',block:'start'}); var f=el.querySelector('input'); if(f) f.focus(); return; }
    btn.disabled=true;
    post('/api/tenant/trial/activate',{}).then(function(res){
      if(res.ok){ window.location.href='/app'; return; }
      btn.disabled=false; var card=btn.closest('[data-upsell]'); var m=document.createElement('p'); m.className='claim-msg claim-msg--err'; m.textContent=(res.j&&(res.j.message||res.j.error))||'Could not start the trial.'; card.appendChild(m);
    }).catch(function(){ btn.disabled=false; });
  }); })(acts[a]); }
  var so=root.querySelector('[data-signout]');
  if(so){ so.addEventListener('click',function(e){ e.preventDefault(); post('/api/auth/logout',{}).then(function(){ window.location.reload(); }); }); }
})();
`.trim();

/** Client for /claim — search, then link to /claim/<usdot> (the route resolves the slug). */
const FINDER_SCRIPT = `
(function(){
  var root=document.querySelector('[data-claim-finder]'); if(!root) return;
  var form=root.querySelector('[data-finder-form]'), out=root.querySelector('[data-finder-results]'), msg=root.querySelector('[data-msg]');
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; }); }
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var raw=(form.querySelector('input[name="q"]').value||'').trim(); if(raw.length<2) return;
    var digits=raw.replace(/\\D/g,''); var isDot=/^\\d+$/.test(raw); var isMc=/^mc[- ]?\\d+$/i.test(raw);
    var qs=isDot?'dot='+encodeURIComponent(digits):isMc?'mc='+encodeURIComponent(digits):'q='+encodeURIComponent(raw);
    msg.textContent='Searching\\u2026'; msg.className='claim-msg'; out.innerHTML='';
    fetch('/api/public/carrier-search?'+qs,{headers:{'Accept':'application/json'}}).then(function(r){ return r.json(); }).then(function(j){
      var rows=(j&&j.results)||[];
      if(!rows.length){ msg.textContent='No FMCSA carrier matched. Try your USDOT number.'; msg.className='claim-msg claim-msg--err'; return; }
      msg.textContent=rows.length===1?'Is this you?':'Pick your company:';
      out.innerHTML=rows.map(function(r){ var nm=r.dbaName||r.legalName; var loc=[r.city,r.state].filter(Boolean).join(', '); return '<a class="dir-chip" href="/claim/'+encodeURIComponent(r.usdot)+'">'+esc(nm)+' \\u00b7 USDOT '+esc(r.usdot)+(loc?' \\u00b7 '+esc(loc):'')+'</a>'; }).join('');
    }).catch(function(){ msg.textContent='Search is unavailable right now. Try again.'; msg.className='claim-msg claim-msg--err'; });
  });
})();
`.trim();
