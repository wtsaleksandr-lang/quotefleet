/**
 * Server-rendered HTML for the PUBLIC carrier directory + Compliance Tools.
 *
 * These pages are unauthenticated and SEO-first: the carrier lists, port/state
 * grids and per-page <title>/description are rendered server-side (real data in
 * the initial HTML, no client fetch required to see content). They reuse the
 * QuoteFleet marketing shell (style.css, topnav, footer, fonts, favicons) so
 * they're visually consistent with /marketplace + /tools, and lean on CSS
 * design tokens (var(--surface) etc.) for light/dark theme parity.
 *
 * Routes that use these live in src/server/routes/directory.ts.
 *
 * HONEST DATA NOTE: FMCSA public data gives us authority, fleet, safety rating
 * and (derived) drayage/intermodal + nearest-port. It does NOT give UIIA / TWIC
 * / Hazmat / Reefer per-carrier flags — those are surfaced as external tools or
 * "coming soon", never faked.
 */
import type {
  DirectorySummary,
  CarrierListResult,
  VisibleCarrier,
  DirectoryFilters,
  FacetCounts,
  CityCount,
  FleetBucketId,
  DriversBucketId,
  EquipmentId,
  CargoId,
  SortId,
  SortDir,
} from './queries.js';
import {
  FLEET_BUCKETS,
  DRIVERS_BUCKETS,
  EQUIPMENT_OPTIONS,
  CARGO_OPTIONS,
  SORT_OPTIONS,
  SORT_DIR_DEFAULTS,
  sortIsDirectional,
  citySlugify,
  titleCaseCity,
} from './queries.js';
import { createHash } from 'node:crypto';
import { US_STATES, stateByCode, type UsState } from './usStates.js';
import { CONTAINER_PORTS, portByCode, PORT_GROUPS, portGroupForMemberCode, type ContainerPort } from './containerPorts.js';
import { CA_PROVINCE_CODES } from './caProvinces.js';
import {
  NATIONAL_DRIVER_OOS_RATE,
  NATIONAL_VEHICLE_OOS_RATE,
  SAFETY_WINDOW_MONTHS,
  compareToNational,
  comparisonPhrase,
  formatAsOf,
  formatRate,
  oosRate,
  safetyRatingExplainer,
  type CarrierSafety,
} from './safetyData.js';
import {
  LI_EXTRACT_DATE,
  formatCoverage,
  formatCredentialDate,
  hasInsuranceFilings,
  registeredSinceLabel,
  type CarrierCredentials,
} from './carrierCredentials.js';
import type { DirectoryIdentity } from './entitlement.js';
import {
  SITE_NAV_HTML,
  SITE_MOBILE_MENU_HTML,
  THEME_TOGGLE_BTN,
  SITE_BURGER_BTN,
  HEADER_SCRIPTS,
  FOOTER_PAY_ROW,
  DIRECTORY_DATA_SOURCES,
} from '../siteChrome.js';

const SITE = 'https://quotefleet.net';

/** Codes we recognize as US states/territories — used to keep the "browse by
 *  state" grid US-focused (FMCSA data also carries Canadian/Mexican codes). */
const US_STATE_CODES = new Set(US_STATES.map((s) => s.code));

// ─── Small HTML helpers ───────────────────────────────────────────────────
export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string),
  );
}

const fmtNum = (n: number | null | undefined): string =>
  n == null ? '—' : Number(n).toLocaleString('en-US');

/**
 * PR C — progressive-enhancement script for the Directory Pro "Reveal additional
 * contacts" button. Intercepts the form POST, fetches the reveal endpoint, and
 * swaps the returned HTML fragment into `.cp-reveal-result` — with loading +
 * error states. With JS disabled the form still POSTs and the endpoint returns
 * the same fragment as a standalone response, so the feature degrades cleanly.
 */
/**
 * ONE shared, memoized `/api/directory/auth/me` request per page.
 *
 * Every directory page hydrates its identity-dependent bits client-side so the
 * server HTML can stay byte-identical (and therefore shared-cacheable — see
 * directory/httpCache.ts). Two of those hydrators run on a carrier profile (the
 * nav slot and the Pro contacts block), and they must not become two network
 * round-trips. `window.__qfDirMe` is created by whichever script runs first and
 * awaited by the other, so it is always exactly one request. Resolves to null on
 * any failure, so a consumer's `.then` never has to care.
 */
const DIRECTORY_ME_PROMISE_JS =
  "(window.__qfDirMe=window.__qfDirMe||fetch('/api/directory/auth/me',{headers:{'Accept':'application/json'},credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}))";

/** True when the /me payload describes a live Directory Pro subscriber. */
const DIRECTORY_IS_PRO_JS =
  "function(d){var s=d&&d.directoryPro&&d.directoryPro.status;return s==='active'||s==='trialing';}";

const REVEAL_ENHANCE_SCRIPT = `
window.__qfBindReveal=function(){
  var forms = document.querySelectorAll('form[data-reveal-form]');
  Array.prototype.forEach.call(forms, function(f){
    if (f.__revealBound) return; f.__revealBound = true;
    var result = f.parentElement ? f.parentElement.querySelector('[data-reveal-result]') : null;
    var btn = f.querySelector('button');
    var label = btn ? btn.textContent : 'Reveal additional contacts';
    f.addEventListener('submit', function(e){
      e.preventDefault();
      if (btn) { btn.disabled = true; btn.textContent = 'Revealing…'; }
      if (result) { result.innerHTML = '<p class="cp-reveal-msg" role="status">Revealing additional contacts…</p>'; }
      fetch(f.action, { method: 'POST', headers: { 'Accept': 'text/html' }, credentials: 'same-origin' })
        .then(function(r){ return r.text(); })
        .then(function(html){ if (result) result.innerHTML = html; })
        .catch(function(){ if (result) result.innerHTML = '<p class="cp-reveal-msg cp-reveal-msg--error" role="status">Could not load additional contacts. Please try again.</p>'; })
        .then(function(){ if (btn) { btn.disabled = false; btn.textContent = label; } });
    });
  });
};
window.__qfBindReveal();
`.trim();

/**
 * Hydrates the carrier profile's "More dispatch contacts" block for a Directory
 * Pro subscriber. The server always renders the FREE variant so every one of the
 * ~334k profile URLs is byte-identical and cacheable; this swaps in the live
 * reveal form afterwards for a caller whose session says Pro. Anonymous and free
 * visitors keep exactly what the server sent. Degrades silently on any error —
 * and the reveal endpoint enforces the entitlement itself regardless, so the
 * worst case of a failed hydrate is a Pro user seeing the upgrade CTA, never a
 * free user gaining access.
 */
const CARRIER_PRO_HYDRATE_SCRIPT = `
(function(){
  var slot=document.querySelector('[data-cp-gated]'); if(!slot) return;
  var action=slot.getAttribute('data-reveal-action')||''; if(!action) return;
  var isPro=${DIRECTORY_IS_PRO_JS};
  ${DIRECTORY_ME_PROMISE_JS}.then(function(d){
    if(!d||!d.user||!isPro(d)) return;
    slot.className='cp-gated cp-gated--pro';
    slot.innerHTML='<h3>Additional contacts</h3>'
      +'<p>Direct dispatch and decision-maker contacts beyond the public FMCSA record \\u2014 part of your Directory Pro plan.</p>'
      +'<form class="cp-reveal-form" method="post" action="'+action+'" data-reveal-form>'
      +'<button type="submit" class="btn btn-primary cp-reveal-btn">Reveal additional contacts</button>'
      +'</form>'
      +'<div class="cp-reveal-result" data-reveal-result aria-live="polite"></div>';
    if(typeof window.__qfBindReveal==='function') window.__qfBindReveal();
  }).catch(function(){});
})();
`.trim();

/**
 * PR D — progressive-enhancement for the "Save to list" control (cards +
 * profile). One delegated handler for the whole page (idempotent bind). A click
 * opens a popover anchored to the button and fetches the caller's lists:
 *   • 401 → a sign-in prompt   • 403 → the Directory Pro upgrade CTA
 *   • 200 → the user's lists (click to add) + a "new list" input.
 * All list/carrier ids come from data-* attributes; every interpolation is
 * escaped. Server-side the control is inert without JS (it's a pure enhancement
 * over the Pro-gated JSON API — the saved-lists page itself works with no JS).
 */
const SAVE_WIDGET_SCRIPT = `
(function(){
  if (window.__qfSaveBound) return; window.__qfSaveBound = true;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);});}
  var open = null;
  function close(){ if(open){ open.pop.remove(); open.btn.setAttribute('aria-expanded','false'); open=null; } }
  function msg(pop, text, err){ var m = pop.querySelector('.qf-save-msg'); if(!m){ m=document.createElement('p'); pop.appendChild(m); } m.hidden=false; m.textContent=text; m.className='qf-save-msg'+(err?' qf-save-msg--err':''); }
  document.addEventListener('click', function(e){
    var t = e.target; if(!t || !t.closest){ return; }
    var btn = t.closest('.qf-save-btn');
    if (btn){ e.preventDefault(); e.stopPropagation(); var wrap = btn.closest('.qf-save'); if(open && open.wrap===wrap){ close(); return; } close(); openPop(wrap, btn); return; }
    if (open && !t.closest('.qf-save-pop')) close();
  });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') close(); });
  function openPop(wrap, btn){
    var dot = wrap.getAttribute('data-dot')||''; var name = wrap.getAttribute('data-name')||'this carrier';
    var pop = document.createElement('div'); pop.className='qf-save-pop'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label','Save '+name);
    pop.innerHTML = '<p class="qf-save-msg">Loading your lists…</p>'; wrap.appendChild(pop); btn.setAttribute('aria-expanded','true');
    open = { wrap: wrap, btn: btn, pop: pop };
    fetch('/api/directory/lists', { headers:{ 'Accept':'application/json' }, credentials:'same-origin' })
      .then(function(r){ return r.json().then(function(j){ return { status:r.status, body:j }; }); })
      .then(function(res){ render(pop, res, dot, name); })
      .catch(function(){ msg(pop, 'Could not load your lists. Try again.', true); });
  }
  function render(pop, res, dot, name){
    if (res.status === 401){ pop.innerHTML = '<h4>Save '+esc(name)+'</h4><p>Sign in to save carriers to your lists.</p><a class="btn btn-primary btn-sm qf-save-cta" href="/login">Sign in</a><a class="btn btn-secondary btn-sm qf-save-cta" href="/signup">Create an account</a>'; return; }
    if (res.status === 403){ var up = (res.body&&res.body.upgradeUrl)||'/signup'; pop.innerHTML = '<h4>Save carriers with Directory Pro</h4><p>Build named lists of carriers and revisit them anytime — $19/mo.</p><a class="btn btn-primary btn-sm qf-save-cta" href="'+esc(up)+'">Upgrade to Directory Pro — $19/mo</a>'; return; }
    if (!res.body || res.body.ok !== true){ msg(pop, 'Could not load your lists. Try again.', true); return; }
    var lists = res.body.lists || [];
    var listHtml = lists.length ? '<div class="qf-save-lists">'+lists.map(function(l){ return '<button type="button" class="qf-save-list" data-id="'+esc(l.id)+'"><span>'+esc(l.name)+'</span><span class="n">'+esc(l.count)+'</span></button>'; }).join('')+'</div>' : '<p>You have no lists yet — create one below.</p>';
    pop.innerHTML = '<h4>Save '+esc(name)+'</h4>'+listHtml+'<div class="qf-save-new"><input type="text" maxlength="80" placeholder="New list name" aria-label="New list name"><button type="button" class="btn btn-primary btn-sm qf-save-create">Create</button></div><p class="qf-save-msg" hidden></p>';
    Array.prototype.forEach.call(pop.querySelectorAll('.qf-save-list'), function(b){ b.addEventListener('click', function(){ addTo(pop, b.getAttribute('data-id'), dot, b, null); }); });
    var create = pop.querySelector('.qf-save-create'); var input = pop.querySelector('.qf-save-new input');
    create.addEventListener('click', function(){ var nm=(input.value||'').trim(); if(!nm){ input.focus(); return; } create.disabled=true;
      fetch('/api/directory/lists', { method:'POST', headers:{ 'Content-Type':'application/json','Accept':'application/json' }, credentials:'same-origin', body: JSON.stringify({ name: nm }) })
        .then(function(r){ return r.json(); })
        .then(function(j){ if(j&&j.ok&&j.list){ addTo(pop, j.list.id, dot, null, nm); } else { msg(pop, (j&&j.reason==='list-cap')?'You have reached the list limit.':'Could not create the list.', true); } })
        .catch(function(){ msg(pop, 'Could not create the list.', true); })
        .then(function(){ create.disabled=false; });
    });
    input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); create.click(); } });
  }
  function addTo(pop, id, dot, btnEl, listName){
    if (btnEl) btnEl.setAttribute('aria-pressed','true');
    fetch('/api/directory/lists/'+encodeURIComponent(id)+'/items', { method:'POST', headers:{ 'Content-Type':'application/json','Accept':'application/json' }, credentials:'same-origin', body: JSON.stringify({ carrierDot: dot }) })
      .then(function(r){ return r.json().then(function(j){ return { status:r.status, body:j }; }); })
      .then(function(res){ if(res.body&&res.body.ok){ msg(pop, 'Saved'+(listName?(' to '+listName):'')+'.', false); } else if(res.status===409){ msg(pop, 'That list is full.', true); } else { msg(pop, 'Could not save. Try again.', true); } })
      .catch(function(){ msg(pop, 'Could not save. Try again.', true); });
  }
})();
`.trim();

/** The "Save to list" control for a carrier (card or profile). A single button;
 *  the shared SAVE_WIDGET_SCRIPT builds its popover on click and drives gating
 *  (sign-in / upgrade / real lists) off the Pro-gated JSON API. */
function saveControl(c: VisibleCarrier, opts: { compact?: boolean } = {}): string {
  const name = carrierName(c);
  const label = opts.compact ? 'Save' : 'Save to list';
  return `<div class="qf-save" data-dot="${esc(c.usdot)}" data-name="${esc(name)}">
    <button type="button" class="btn btn-secondary btn-sm qf-save-btn" aria-haspopup="dialog" aria-expanded="false" title="Save ${esc(name)} to a list"><span class="qf-save-ic" aria-hidden="true">+</span> ${esc(label)}</button>
  </div>`;
}

/** RFQ recipient cap — mirrors rfqMaxRecipients() in routes/rfq.ts (default 25).
 *  Read locally (not imported) to avoid a routes→resolve→pages import cycle. The
 *  send flow enforces the same cap; the action-bar label reflects it so the CTA
 *  never promises to email more carriers than the request actually sends. */
function rfqRecipientCap(): number {
  const raw = process.env.RFQ_MAX_RECIPIENTS;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
}

function safetyLabel(code: string | null): { text: string; tone: 'good' | 'warn' | 'bad' | 'none' } {
  switch ((code || '').toUpperCase()) {
    case 'S':
      return { text: 'Satisfactory', tone: 'good' };
    case 'C':
      return { text: 'Conditional', tone: 'warn' };
    case 'U':
      return { text: 'Unsatisfactory', tone: 'bad' };
    default:
      return { text: 'Not rated', tone: 'none' };
  }
}

/**
 * The FMCSA roadside-inspection / out-of-service / crash record for the profile's
 * "Safety & compliance" panel.
 *
 * HONESTY RULES BAKED IN HERE (see src/server/directory/safetyData.ts for the
 * full contract — this is a real company's reputation on an indexable page):
 *
 *   • NO DATA ⇒ SAY SO. If FMCSA published no record we render one plain
 *     sentence saying that. We never fall back to zeros: "0 crashes" for a
 *     carrier we simply have no data on would invent a spotless history.
 *   • COUNTS ALWAYS, RATES ONLY WHEN MEANINGFUL. A percentage off fewer than
 *     MIN_INSPECTIONS_FOR_RATE inspections is suppressed — 1 of 1 is not a
 *     "100% out-of-service rate", it is noise, and publishing it would smear a
 *     real business.
 *   • NEUTRAL COMPARISON, NEVER A VERDICT. Where a rate is shown we put the
 *     published national average beside it and say "below"/"above"/"about" —
 *     arithmetic about a rate. No grades, no stars, no "unsafe", no "poor".
 *   • ALWAYS DATED. Stale safety data presented as current is misleading, so the
 *     as-of date is part of the block, not a footnote we might drop.
 *
 * The rate context (`.cp-safety-ctx`) sits on its OWN line under the count so a
 * long phrase can never force horizontal overflow at 375px, and is deliberately
 * muted and non-tabular — it qualifies the count, it does not out-shout it. It
 * is never colour-coded: a green or red rate would be precisely the verdict we
 * refuse to hand down. (This rationale lives here rather than in the CSS string
 * because that string is inlined into all ~330k pages — comments in it are
 * crawl budget, per PR #455.)
 *
 * Likewise the "no record" branch is intentionally ONE short sentence: it must
 * reassure a reader that nothing is being hidden without spending the byte
 * budget of a full data block on the large slice of carriers that have no data.
 */
function safetyRecordBlock(safety: CarrierSafety | null | undefined): string {
  const asOf = safety?.safetyDataAsOf;
  if (!safety || !asOf) {
    return `<section class="cp-card">
          <h2 class="cp-h">Roadside inspection &amp; crash record</h2>
          <p class="cp-note">FMCSA has not published a roadside inspection or crash record for this carrier. That is common — it does not indicate a problem. Use the live FMCSA check above for the current official record.</p>
        </section>`;
  }

  // ── Rows. Counts are facts and always render; the rate + national comparison
  //    is appended only when the sample is big enough to mean anything.
  const rows: string[] = [];
  const oosRow = (
    label: string,
    oos: number | null,
    insp: number | null,
    national: number,
  ): void => {
    if (insp == null) return;
    const rate = oosRate(oos, insp);
    const countTxt = `${fmtNum(oos)} of ${fmtNum(insp)}`;
    const ctx =
      rate == null
        ? // Too few inspections for a percentage to carry information.
          `<span class="cp-safety-ctx">too few inspections to compute a rate</span>`
        : `<span class="cp-safety-ctx">${esc(formatRate(rate))} · ${esc(
            comparisonPhrase(compareToNational(rate, national)),
          )} of ${esc(formatRate(national))}</span>`;
    rows.push(
      `<div class="cp-dt"><span class="k">${esc(label)}</span><span class="v">${esc(countTxt)} ${ctx}</span></div>`,
    );
  };

  if (safety.inspTotal != null)
    rows.push(
      `<div class="cp-dt"><span class="k">Inspections</span><span class="v">${fmtNum(safety.inspTotal)}</span></div>`,
    );
  oosRow(
    'Driver out-of-service',
    safety.driverOosTotal,
    safety.driverInspTotal,
    NATIONAL_DRIVER_OOS_RATE,
  );
  oosRow(
    'Vehicle out-of-service',
    safety.vehicleOosTotal,
    safety.vehicleInspTotal,
    NATIONAL_VEHICLE_OOS_RATE,
  );

  const crashRows: string[] = [];
  if (safety.crashesTotal != null) {
    // Severity is a BREAKDOWN of the total, so it renders as a sub-line under
    // the count (same treatment as the out-of-service rate context) rather than
    // as three more peer stats. That keeps the grid at exactly FOUR items — a
    // clean 2×2 on desktop and 4 stacked at 375px, with no line left holding a
    // single orphaned figure — and reads as "200 crashes, of which…" instead of
    // implying "fatal" is a metric on par with "inspections".
    const sev: string[] = [];
    if (safety.crashesTotal > 0) {
      if (safety.crashesFatal != null) sev.push(`${fmtNum(safety.crashesFatal)} fatal`);
      if (safety.crashesInjury != null) sev.push(`${fmtNum(safety.crashesInjury)} with injuries`);
      if (safety.crashesTow != null) sev.push(`${fmtNum(safety.crashesTow)} towed away`);
    }
    const sevLine = sev.length ? `<span class="cp-safety-ctx">${esc(sev.join(' · '))}</span>` : '';
    crashRows.push(
      `<div class="cp-dt"><span class="k">Reported crashes</span><span class="v">${fmtNum(safety.crashesTotal)}${sevLine}</span></div>`,
    );
  }

  const all = [...rows, ...crashRows];
  if (!all.length) {
    return `<section class="cp-card">
          <h2 class="cp-h">Roadside inspection &amp; crash record</h2>
          <p class="cp-note">FMCSA has not published a roadside inspection or crash record for this carrier. That is common — it does not indicate a problem. Use the live FMCSA check above for the current official record.</p>
        </section>`;
  }

  return `<section class="cp-card">
          <h2 class="cp-h">Roadside inspection &amp; crash record</h2>
          <p class="cp-note cp-safety-lede">Counts published by FMCSA over its rolling ${SAFETY_WINDOW_MONTHS}-month measurement period. QuoteFleet reports these figures as published and does not rate, certify or endorse any carrier.</p>
          <div class="cp-datagrid">${all.join('')}</div>
          <p class="cp-note">FMCSA safety data as of ${esc(formatAsOf(asOf))}. Crash counts are state-reported and are not adjusted for fault or for how many miles the carrier runs.</p>
        </section>`;
}

/**
 * The FMCSA INSURANCE FILINGS panel.
 *
 * Verifying insurance is the first thing a shipper does before tendering a load,
 * and until now the profile could not answer it at all — the page just pointed
 * at the live QCMobile check. The filings were sitting unread in the same L&I
 * row the ingest already downloads for operating authority.
 *
 * HONESTY RULES BAKED IN HERE (full contract in ./carrierCredentials.ts):
 *
 *   • A FILING IS NOT COVERAGE. L&I records that an insurer filed a form with
 *     FMCSA. It is not proof a policy is in force today, so the wording is
 *     "filing on record" and the note tells the reader to get a certificate
 *     before tendering. We never write "insured" or "verified".
 *   • THE FILE IS FROZEN. FMCSA stopped refreshing L&I on 14 May 2026, so every
 *     figure here is a snapshot of that date and says so. An undated figure off
 *     a closed file would be a claim we cannot stand behind.
 *   • THE FEDERAL MINIMUM SITS BESIDE THE AMOUNT, so $750,000 reads as "the
 *     legal floor" rather than as an achievement — the same neutral-context
 *     device the out-of-service rates use with the national average.
 *   • ABSENCE IS NOT A NEGATIVE. Cargo insurance and a surety bond are not
 *     required of most property carriers (measured: 3.8% and 1.4% have one), so
 *     their rows appear only when the filing EXISTS. A "Not on file" line would
 *     read as a black mark for the ~96% who were never required to have one.
 *     If there is no filing of any kind the whole card is omitted rather than
 *     rendered empty.
 *
 * The grid takes `cp-datagrid--auto` because the row count is 1–3: the odd-count
 * rule spans the first item full-width so the last line never strands a single
 * figure (the global no-orphan rule).
 *
 * The L&I provenance + freeze date live on the "Safety & compliance" card
 * IMMEDIATELY ABOVE this one in the same panel, which is where the authority
 * rows that share the same source and the same staleness also sit — stating it
 * once for both costs ~120 fewer bytes on every one of ~330k pages than
 * repeating it here. Keep the two together if either ever moves.
 */
function insuranceBlock(cred: CarrierCredentials | null | undefined): string {
  if (!hasInsuranceFilings(cred) || !cred) return '';
  const rows: string[] = [];
  if (cred.bipdOnFile != null) {
    const floor =
      cred.bipdRequired != null
        ? `<span class="cp-safety-ctx">federal minimum for this authority ${esc(formatCoverage(cred.bipdRequired))}</span>`
        : '';
    rows.push(
      `<div class="cp-dt"><span class="k">Liability (BIPD)</span><span class="v">${esc(formatCoverage(cred.bipdOnFile))}${floor}</span></div>`,
    );
  }
  if (cred.cargoInsuranceOnFile)
    rows.push('<div class="cp-dt"><span class="k">Cargo insurance</span><span class="v">Filing on record</span></div>');
  if (cred.bondOnFile)
    rows.push('<div class="cp-dt"><span class="k">Surety bond</span><span class="v">Filing on record</span></div>');
  if (!rows.length) return '';
  return `<section class="cp-card">
          <h2 class="cp-h">Insurance filings on record</h2>
          <div class="cp-datagrid cp-datagrid--auto">${rows.join('')}</div>
          <p class="cp-note">A filing on record is not proof of current coverage — ask the carrier for a certificate of insurance before tendering.</p>
        </section>`;
}

function authorityLabel(type: string | null): string {
  if (!type) return 'Authority on file';
  const parts = type.split(',').map((p) => p.trim()).filter(Boolean);
  const nice = parts.map((p) => (p === 'common' ? 'Common' : p === 'contract' ? 'Contract' : p));
  return nice.length ? nice.join(' + ') + ' authority' : 'Authority on file';
}

/**
 * One credential badge for the carrier profile.
 *
 * `held` (a credential the carrier ACTUALLY has) → a distinct SOLID colour keyed
 * by `tone`. `verified` (FMCSA-sourced) appends a "✓ FMCSA-verified." marker to
 * the tooltip so the honest verified-vs-self-declared line is never blurred.
 * A NOT-held self-declared credential → the muted "claim to add" affordance, its
 * tooltip flagged "Self-declared." Every badge is keyboard-focusable and carries
 * a pure-CSS hover/focus tooltip (data-tip) plus an aria-label combining the
 * label and the explanation for screen readers.
 */
function credBadge(opts: {
  tone: string;
  label: string;
  tip: string;
  held: boolean;
  verified?: boolean;
  /** A self-declared credential (e.g. from carrier_overrides.capabilities): even
   *  when `held` (solid badge), the tooltip stays "Self-declared." — it is NOT
   *  FMCSA-verified. */
  selfDeclared?: boolean;
}): string {
  const suffix = opts.verified
    ? ' ✓ FMCSA-verified.'
    : opts.held && !opts.selfDeclared
      ? ''
      : ' Self-declared.';
  // A not-held credential shows the compact "Claim" affordance; the terse word is
  // explained by the tooltip's claim call-to-action (hover AND keyboard focus).
  const claimHint = !opts.held ? ' Claim this profile to verify & add this credential.' : '';
  const full = opts.tip + suffix + claimHint;
  const aria = `${opts.label} — ${full}`;
  const common = `tabindex="0" role="note" aria-label="${esc(aria)}" data-tip="${esc(full)}"`;
  if (opts.held) {
    return `<span class="cp-badge cp-tip cp-badge--${opts.tone}" ${common}>${esc(opts.label)}</span>`;
  }
  return `<span class="cp-badge cp-tip cp-badge--claim" ${common}><span class="cp-badge-label">${esc(opts.label)}</span> <span class="tag" aria-hidden="true">Claim</span></span>`;
}

/** Up to two uppercase initials for the company monogram avatar, derived from
 *  the display name: first letter of the first two words, or the first two
 *  letters of a single-word name (e.g. "CEVA FREIGHT LLC" → "CF", "MOVERS" →
 *  "MO"). Non-alphanumeric leading chars are skipped. */
function monogramInitials(name: string): string {
  const words = name.trim().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/gi, '')).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return (words[0].slice(0, 2) || '—').toUpperCase();
  return ((words[0][0] ?? '') + (words[1][0] ?? '')).toUpperCase() || '—';
}

/** Self-declared credentials NOT derivable from FMCSA public data — shown muted
 *  with a "claim to add" affordance, never asserted as fact. Order = display order. */
const SELF_DECLARED_CREDENTIALS: Array<{ tone: string; label: string; tip: string }> = [
  { tone: 'uiia', label: 'UIIA member', tip: 'Uniform Intermodal Interchange Agreement — permits interchange of containers/chassis with ocean carriers & railroads.' },
  { tone: 'twic', label: 'TWIC', tip: 'Drivers hold TSA Transportation Worker Identification Credentials for secure port access.' },
  { tone: 'bonded', label: 'Customs-bonded / C-TPAT', tip: 'Customs-bonded / C-TPAT for in-bond and secure cross-border moves.' },
  { tone: 'reefer', label: 'Reefer', tip: 'Refrigerated container capability.' },
  { tone: 'transload', label: 'Transload / warehouse', tip: 'Cross-docks and stores freight between the ocean move and the inland leg.' },
  { tone: 'yard', label: 'Yard / parking', tip: 'Container yard and chassis / trailer parking.' },
];

/** FMCSA cargo-CLASS specialties (census crgo_* flags) → human labels, in
 *  display order. These are FMCSA-verified facts already stored on the carrier
 *  row but never surfaced before; only the flags that are `true` render, as a
 *  neutral chip group in the Services & Equipment tab. Keys map 1:1 to the
 *  boolean fields on VisibleCarrier. */
const CARGO_CLASS_SPECIALTIES: Array<[keyof VisibleCarrier, string]> = [
  ['householdGoods', 'Household goods'],
  ['beverages', 'Beverages'],
  ['produce', 'Produce'],
  ['motorVehicles', 'Motor vehicles'],
  ['livestock', 'Livestock'],
  ['grainFeed', 'Grain & feed'],
  ['oilfield', 'Oilfield'],
  ['meat', 'Meat'],
  ['paper', 'Paper products'],
  ['construction', 'Construction'],
  ['farmSupplies', 'Farm supplies'],
  ['coalCoke', 'Coal / coke'],
  ['buildingMaterials', 'Building materials'],
];

/** FMCSA record freshness → "Aug 21, 2026". Formatted from UTC parts so the
 *  rendered date is deterministic regardless of the server's timezone. Returns
 *  '' when the timestamp is missing/invalid so the caller omits the line. */
function fmtDataAsOf(d?: Date | null): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
}

// ─── Shared page shell ────────────────────────────────────────────────────
/** Exported so routes/directory.ts can serve it as ONE cacheable, content-hashed
 *  file instead of inlining 68 KB into all ~355k directory pages. See
 *  DIRECTORY_CSS_HREF below for the measurement that motivated this. */
export const DIRECTORY_CSS = `
  .dir-shell { max-width: 1100px; margin: 0 auto; padding: 28px; }
  /* Left-align the hero — the shared marketing .hero centers text; directory
     pages must read as a left-aligned page/company card, never centered. */
  /* Section keeps only vertical padding; the full-width gradient bg still spans
     edge-to-edge (via .hero::before). All horizontal work lives on the inner
     container so it mirrors .dir-shell's content column exactly (same max-width,
     same margin:0 auto centering, same 28px inset) → header and body cards share
     one left edge at every width. */
  .dir-hero { padding: 40px 0 22px; text-align: left; }
  .dir-hero .container-narrow { max-width: 1100px; margin: 0 auto; padding-left: 28px; padding-right: 28px; }
  .dir-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 10px; }
  .dir-hero p.lead { max-width: 640px; margin-left: 0; margin-right: 0; }
  .dir-hero .hero-cta, .dir-hero .hero-meta { justify-content: flex-start; }
  .dir-stats { display: flex; gap: 22px; flex-wrap: wrap; margin-top: 18px; }
  .dir-stat { display: flex; flex-direction: column; }
  .dir-stat b { font-size: 26px; font-family: var(--font-mono); color: var(--accent); }
  .dir-stat span { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-family: var(--font-mono); }
  .dir-section-h { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 34px 0 14px; }
  .dir-section-h h2 { font-size: 22px; margin: 0; }
  .dir-section-h .muted-small { white-space: nowrap; }
  .dir-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  /* BROWSE grids (top ports / browse by state / cities in state) — the short
     navigation cards, as opposed to the carrier-RESULT grids, which override
     grid-template-columns inline and are unaffected by anything below.
     grid-auto-rows:1fr is what makes every card the SAME SIZE: all rows are
     implicit here, so 1fr resolves each to the tallest row's height and a short
     name ("Guam") can no longer produce a shorter card than a wrapping one
     ("U.S. Virgin Islands"). Column count is handled per-breakpoint below. */
  .dir-grid--browse { grid-auto-rows: 1fr; }
  .dir-grid--browse > .dir-card { display: flex; flex-direction: column; }
  .dir-grid--browse > .dir-card .cnt { margin-top: auto; padding-top: 12px; }
  .dir-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; text-decoration: none; color: inherit; display: block; transition: border-color 0.15s ease, transform 0.15s ease; }
  .dir-card:hover { border-color: var(--border-strong); transform: translateY(-2px); }
  .dir-card h3 { margin: 0 0 4px; font-size: 17px; }
  .dir-card .sub { font-size: 12px; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.04em; }
  .dir-card .cnt { margin-top: 12px; font-size: 22px; font-family: var(--font-mono); color: var(--accent); }
  .dir-card .cnt small { font-size: 11px; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; margin-left: 4px; }
  .dir-chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 4px; }
  .dir-chip { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; padding: 6px 12px; border-radius: var(--radius-chip); border: 1px solid var(--border); background: var(--surface); color: var(--ink-soft); text-decoration: none; white-space: nowrap; }
  .dir-chip:hover { border-color: var(--border-strong); }
  .dir-chip.active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .carrier-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; text-decoration: none; color: inherit; display: block; transition: border-color 0.15s ease; }
  .carrier-card:hover { border-color: var(--border-strong); }
  .carrier-card .top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .carrier-card h3 { margin: 0 0 3px; font-size: 16px; line-height: 1.3; }
  .carrier-card-legal { font-size: 12px; color: var(--muted); margin: 0 0 4px; line-height: 1.3; }
  .carrier-card .meta { font-size: 12px; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.04em; }
  .carrier-facts { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 12px; }
  .carrier-facts .f { display: flex; flex-direction: column; }
  .carrier-facts .f b { font-size: 15px; font-family: var(--font-mono); }
  .carrier-facts .f span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
  .pill { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 8px; border-radius: var(--radius-chip); white-space: nowrap; }
  .pill-dray { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent); }
  .pill-good { background: rgba(46, 160, 87, 0.14); color: #57c274; border: 1px solid rgba(46, 160, 87, 0.4); }
  .pill-warn { background: rgba(214, 158, 46, 0.14); color: #e0b054; border: 1px solid rgba(214, 158, 46, 0.4); }
  .pill-bad { background: rgba(220, 76, 76, 0.14); color: #e88; border: 1px solid rgba(220, 76, 76, 0.4); }
  .pill-none { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
  .pill-eq { background: var(--surface-2); color: var(--ink-soft); border: 1px solid var(--border); }
  /* Carrier-card chip row — always narrow, so it always uses the count-aware
     grid partition (>=2 pills per line, never a stranded orphan). 1 pill keeps
     its natural width (left-aligned); 2+ fill equal columns. */
  .card-chips { display: grid; gap: 8px; margin-top: 12px; align-items: stretch; }
  .card-chips .pill { display: flex; align-items: center; justify-content: center; text-align: center; white-space: normal; }
  .card-chips[data-n="1"] { grid-template-columns: max-content; }
  .card-chips[data-n="2"], .card-chips[data-n="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-chips[data-n="3"], .card-chips[data-n="5"], .card-chips[data-n="6"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dir-pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 28px 0 8px; }
  .dir-pager .muted-small { font-family: var(--font-mono); }
  .dir-empty { padding: 60px 24px; text-align: center; color: var(--muted); }
  .src-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .src-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; text-decoration: none; color: inherit; display: block; }
  .src-card:hover { border-color: var(--border-strong); }
  .src-card h3 { margin: 0 0 6px; font-size: 16px; }
  .src-card p { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.5; }
  .src-card .go { display: inline-block; margin-top: 10px; font-size: 12px; font-family: var(--font-mono); color: var(--accent); }
  .lookup-box { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 22px; }
  .lookup-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; }
  .lookup-row .input { flex: 1 1 220px; }
  .lookup-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .lookup-toggle button { background: transparent; color: var(--muted); border: 0; padding: 0 16px; font-family: var(--font-mono); font-size: 13px; cursor: pointer; }
  .lookup-toggle button.on { background: var(--accent-soft); color: var(--accent); }
  .lookup-result { margin-top: 18px; }
  .lookup-result .row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
  .lookup-result .row:last-child { border-bottom: 0; }
  .lookup-result .row .k { color: var(--muted); }
  .lookup-result .row .v { font-family: var(--font-mono); text-align: right; }
  /* Breadcrumbs */
  .dir-crumbs { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.03em; color: var(--muted); margin: 0 0 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .dir-crumbs a { color: var(--muted); text-decoration: none; }
  .dir-crumbs a:hover { color: var(--accent); }
  .dir-crumbs .sep { opacity: 0.5; }
  .dir-crumbs .cur { color: var(--ink-soft); }
  /* Faceted two-column layout */
  .dir-layout { display: grid; grid-template-columns: 258px minmax(0, 1fr); gap: 24px; align-items: start; }
  .dir-rail { position: sticky; top: 16px; }
  .facet-group { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 14px 16px; margin-bottom: 12px; }
  .facet-group h3 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); font-family: var(--font-mono); }
  .facet-src { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); opacity: 0.8; display: block; margin: 0 0 8px; }
  .facet-opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 8px; text-decoration: none; color: var(--ink-soft); font-size: 13px; border: 1px solid transparent; }
  .facet-opt:hover { background: var(--surface-2); }
  .facet-opt .cb { font-family: var(--font-mono); font-size: 11px; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-chip); padding: 1px 8px; min-width: 20px; text-align: center; }
  .facet-opt.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .facet-opt.active .cb { color: var(--accent); border-color: var(--accent); background: transparent; }
  .facet-opt.disabled { opacity: 0.5; cursor: not-allowed; }
  .facet-opt.disabled .cb { text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; }
  /* Carrier-capabilities (Tier-3, claim-driven) group — visually secondary to
     the working FMCSA facets: subdued surface, per-kind sub-labels, claim CTA. */
  .facet-group--claim { background: var(--surface-2); border-style: dashed; }
  .facet-group--claim .cap-sub { margin-top: 10px; }
  .facet-group--claim .cap-sub:first-of-type { margin-top: 6px; }
  .cap-sublabel { display: block; font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); opacity: 0.85; margin: 0 0 3px 8px; }
  .cap-claim-cta { display: inline-block; margin-top: 12px; font-size: 12px; font-family: var(--font-mono); color: var(--accent); text-decoration: none; }
  .cap-claim-cta:hover { text-decoration: underline; }
  .facet-opt .lbl { display: flex; align-items: center; gap: 7px; }
  .facet-check { width: 14px; height: 14px; border: 1px solid var(--border-strong); border-radius: 4px; display: inline-block; flex: 0 0 auto; }
  .facet-opt.active .facet-check { background: var(--accent); border-color: var(--accent); }
  /* Ports & terminals unfolding picker — ONE combined list (seaports + inland
     rail ramps), grouped US / Canada, with a client-side free-text filter. */
  details.port-picker { padding: 0; overflow: hidden; }
  .port-picker-sum { list-style: none; cursor: pointer; display: flex; align-items: baseline; gap: 8px; padding: 14px 16px; }
  .port-picker-sum::-webkit-details-marker { display: none; }
  .port-picker-sum::after { content: '▾'; color: var(--muted); font-size: 11px; margin-left: auto; align-self: center; transition: transform 0.15s ease; }
  details[open] .port-picker-sum::after { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { .port-picker-sum::after { transition: none; } }
  .port-picker-sum .pp-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); font-family: var(--font-mono); }
  .port-picker-sum .pp-hint { font-size: 10px; font-family: var(--font-mono); color: var(--muted); opacity: 0.7; }
  .port-picker-sum:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--radius-lg); }
  .port-picker-body { padding: 0 16px 14px; }
  .pp-search { display: flex; flex-direction: column; gap: 4px; margin: 0 0 10px; }
  .pp-search-lbl { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  .pp-search-input { width: 100%; box-sizing: border-box; background: var(--surface-2); color: var(--ink); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; }
  .pp-search-input::placeholder { color: var(--muted); }
  .pp-search-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .pp-list { max-height: 320px; overflow-y: auto; }
  .pp-country + .pp-country { margin-top: 6px; }
  .pp-country-h { margin: 6px 0 2px; font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); opacity: 0.85; }
  .pp-empty { font-size: 12px; color: var(--muted); padding: 8px 2px; }
  .rail-toggle { display: none; }
  /* Slim breadcrumb bar for the hero-less results view. */
  .dir-crumbbar { padding-top: 22px; padding-bottom: 0; }
  .dir-shell--tight { padding-top: 14px; }
  /* Carrier-name free-text search — sits above the results bar. Squared 4px
     corners, 8px grid, theme-aware tokens; the input + button never wrap apart
     awkwardly (button drops full-width under the field at ≤640px). */
  .dir-search { margin: 0 0 14px; }
  .dir-search-lbl { display: block; font-size: 12px; font-family: var(--font-mono); color: var(--muted); margin: 0 0 6px; }
  .dir-search-row { display: flex; gap: 8px; align-items: stretch; }
  .dir-search-input { flex: 1 1 auto; min-width: 0; font-family: var(--font-sans); font-size: 14px; color: var(--ink); background: var(--surface); border: 1px solid var(--border-strong); border-radius: 4px; padding: 10px 12px; min-height: 44px; }
  .dir-search-input::placeholder { color: var(--muted); }
  .dir-search-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .dir-search-btn { flex: 0 0 auto; border-radius: 4px; }
  .dir-search-hint { display: block; font-size: 11px; color: var(--muted); margin: 6px 0 0; }
  @media (max-width: 640px) {
    .dir-search-row { flex-wrap: wrap; }
    .dir-search-btn { width: 100%; }
  }
  /* Single tidy control bar: count on the left, compact sort <select> on the
     right. Wraps to two rows only at very narrow widths (never mid-control). */
  .results-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap; margin: 0 0 14px; }
  .results-bar .rc { font-size: 15px; min-width: 0; }
  .results-bar .rc b { font-family: var(--font-mono); color: var(--accent); font-size: 20px; }
  .sort-ctl { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
  .sort-lbl { font-size: 11px; color: var(--muted); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; }
  .sort-select { position: relative; display: inline-flex; align-items: center; }
  .sort-select::after { content: '▾'; position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 10px; color: var(--muted); pointer-events: none; }
  .sort-select select { appearance: none; -webkit-appearance: none; background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 8px; padding: 8px 30px 8px 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.2; cursor: pointer; min-width: 168px; }
  .sort-select select:hover { border-color: var(--border-strong); }
  .sort-select select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }
  /* Squared asc/desc direction toggle — pairs with the sort <select> (same
     height + squared 8px corners, never pill-round). Theme-aware via tokens. */
  .sort-dir { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; background: var(--surface); color: var(--ink-soft); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.2; text-decoration: none; white-space: nowrap; cursor: pointer; }
  .sort-dir:hover { border-color: var(--border-strong); color: var(--ink); }
  .sort-dir:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }
  .sort-dir-ico { color: var(--accent); font-size: 10px; line-height: 1; }
  .sort-noscript { display: inline-flex; gap: 8px; flex-wrap: wrap; }
  .sort-noscript a { font-size: 12px; font-family: var(--font-mono); color: var(--accent); text-decoration: none; }
  .applied-chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 14px; align-items: center; }
  .applied-chip { font-size: 12px; font-family: var(--font-mono); padding: 5px 10px; border-radius: var(--radius-chip); border: 1px solid var(--accent); color: var(--accent); background: var(--accent-soft); text-decoration: none; display: inline-flex; gap: 6px; align-items: center; }
  .applied-chip .x { opacity: 0.7; }
  .applied-chip:hover .x { opacity: 1; }
  .applied-clear { font-size: 12px; font-family: var(--font-mono); color: var(--muted); text-decoration: underline; }
  .dir-pagenums { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: center; margin: 26px 0 8px; }
  .dir-pagenums a, .dir-pagenums span { min-width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 8px; text-decoration: none; color: var(--ink-soft); font-family: var(--font-mono); font-size: 13px; padding: 0 8px; }
  .dir-pagenums a:hover { border-color: var(--border-strong); }
  .dir-pagenums .cur { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .dir-pagenums .gap { border: 0; min-width: 16px; color: var(--muted); }
  /* ── Selectable carrier cards + sticky directory action bar ─────────────── */
  .cc-sel { position: relative; }
  /* Make room at the card top-right so the checkbox chip never sits on the
     Drayage pill (the pill is the right item of .top; padding shifts it left). */
  .cc-sel .carrier-card .top { padding-right: 40px; }
  /* Selection control: a ≥44px tap target stacked ABOVE the card link (z-index)
     so a tap toggles selection and never navigates. The visible 18px checkbox
     lives inside a bordered chip pinned top-right; the label's asymmetric padding
     extends the hit area DOWN + LEFT (away from the card title) to a comfortable
     44px without visually growing the chip. onclick stopPropagation is belt-and-
     suspenders (the link is a SIBLING, so a checkbox click never bubbles to it). */
  .cc-check { position: absolute; top: 6px; right: 6px; z-index: 4; margin: 0; display: inline-flex; align-items: flex-start; padding: 6px 6px 20px 20px; line-height: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .cc-box { display: inline-flex; padding: 4px; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 4px; box-shadow: var(--shadow-sm); transition: border-color 0.15s ease, background 0.15s ease; }
  .cc-check:hover .cc-box { border-color: var(--accent); }
  .cc-check:has(.cc-cb:checked) .cc-box { border-color: var(--accent); background: var(--accent-soft); }
  .cc-check:has(.cc-cb:focus-visible) .cc-box { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cc-cb { width: 18px; height: 18px; margin: 0; cursor: pointer; accent-color: var(--accent-fill); }
  /* One-line legend above the grid — makes the per-card checkbox's purpose
     obvious without crowding each card. Mirrors the action-bar hint wording. */
  .cc-legend { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 12px; color: var(--muted); }
  .cc-legend-box { flex: 0 0 auto; width: 16px; height: 16px; border: 1px solid var(--border-strong); border-radius: 3px; background: var(--surface-2); }
  .qf-actionbar { position: sticky; bottom: 12px; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; margin: 20px 0 0; padding: 10px 14px; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 8px; box-shadow: var(--shadow-md); }
  .qf-ab-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .qf-ab-count { font-size: 14px; color: var(--ink); }
  .qf-ab-count b { font-family: var(--font-mono); color: var(--accent); font-size: 18px; }
  .qf-ab-hint { font-size: 11px; color: var(--muted); }
  .qf-actionbar[data-mode="dots"] .qf-ab-hint { visibility: hidden; }
  .qf-ab-actions { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; }
  .qf-ab-btn { flex: 0 0 auto; }
  /* Desktop shows the full labels ("Request rates from N carriers →", "Save
     selected (N)", "Export list"); the compact "(N)" parens are mobile-only. */
  .qf-ab-rfqpar { display: none; }
  .qf-ab-fmts { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
  .qf-ab-fmt { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--accent); text-decoration: none; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
  .qf-ab-fmt:hover { border-color: var(--accent); }
  .qf-ab-fmt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* "— free" suffix on the topnav Claim CTA: drop it on small screens so the
     always-visible CTA never widens the header into horizontal overflow. */
  @media (max-width: 560px) { .site-actions .tn-free { display: none; } }
  @media (max-width: 640px) {
    /* Compact slim card: count on top, then all three actions on ONE row (no
       longer full-width stacked). Short labels ("Request rates (N)", "Save (N)",
       "Export") keep them on one line down to 360px. padding-right on the button
       row reserves the bottom-right corner for the chat FAB (which stays snug in
       the corner) so its rightmost button never sits under the launcher. XLSX/CSV
       drop to their own left-aligned line, clear of the corner FAB. */
    .qf-actionbar { flex-direction: column; align-items: stretch; gap: 8px; bottom: 8px; padding: 10px 12px; }
    .qf-ab-hint { display: none; }
    .qf-ab-actions { flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: 6px; padding-right: 66px; }
    .qf-ab-btn { flex: 1 1 auto; min-width: 0; padding-left: 8px; padding-right: 8px; font-size: 12px; white-space: nowrap; justify-content: center; text-align: center; }
    .qf-ab-rfq { flex: 1.5 1 auto; }
    /* Drop the count from the RFQ button on phones (it's redundant with the
       "N carriers filtered/selected" line above) so all three fit one row. */
    .qf-ab-rfqfull, .qf-ab-rfqw, .qf-ab-rfqof, .qf-ab-rfqn, .qf-ab-rfqpar { display: none; }
    .qf-ab-savefull, .qf-ab-exportfull { display: none; }
    .qf-ab-fmts { flex: 1 1 100%; justify-content: flex-start; gap: 12px; }
  }
  @media (max-width: 900px) {
    .dir-layout { grid-template-columns: 1fr; }
    .dir-rail { position: static; }
    .rail-toggle { display: block; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 16px; color: var(--ink); font-size: 14px; font-family: var(--font-mono); cursor: pointer; margin-bottom: 12px; }
    .dir-rail[data-collapsed="1"] .facet-group { display: none; }
  }
  @media (max-width: 640px) {
    .dir-hero h1 { font-size: 30px; }
    /* Mobile inset: pad the CONTENT containers (not the full-width .dir-hero
       section, whose horizontal padding is 0) so the header's inner container
       and the body share the same 18px left edge — no double-padding. */
    .dir-shell { padding-left: 18px; padding-right: 18px; }
    .dir-hero .container-narrow { padding-left: 18px; padding-right: 18px; }
    .dir-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
    .carrier-facts { gap: 14px; }
    /* Two EQUAL columns for the browse cards all the way down to 320px.
       minmax(0,1fr) — not the default minmax(auto,1fr) — is the part that
       stops a long territory name's min-content width from widening its track
       and pushing the page into horizontal scroll. Tighter padding + a stacked
       count keeps a ~137px card readable at 320px. */
    .dir-grid--browse { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .dir-grid--browse > .dir-card { padding: 14px 14px; min-width: 0; }
    .dir-grid--browse > .dir-card h3 { font-size: 15px; line-height: 1.25; overflow-wrap: anywhere; }
    .dir-grid--browse > .dir-card .cnt { font-size: 19px; padding-top: 10px; }
    .dir-grid--browse > .dir-card .cnt small { display: block; margin-left: 0; margin-top: 2px; }
    /* Odd count: the final card fills the row rather than sitting alone beside
       an empty half — see browseGrid(). Every row is full at two columns. */
    .dir-grid--browse[data-odd="1"] > .dir-card:last-child { grid-column: 1 / -1; }
    /* Sort bar: count on its own row, then the full sort control (label + select
       + direction toggle) together on the next — never stacks mid-control, never
       leaves the toggle orphaned. */
    .results-bar { align-items: flex-start; }
    .sort-ctl { flex: 1 1 100%; justify-content: flex-start; }
    .sort-select { flex: 1 1 auto; }
    .sort-select select { min-width: 0; width: 100%; }
    .sort-dir { flex: 0 0 auto; }
  }
  @media (max-width: 420px) {
    /* Result/detail grids still collapse to one column on the narrowest phones.
       The BROWSE grids deliberately do NOT: a full-width card holding one short
       state name and a count wasted the whole right half of the screen, which
       is the defect this excludes them from. */
    .dir-grid:not(.dir-grid--browse) { grid-template-columns: 1fr; }
  }
  /* Sub-375px phones (360/320): a single long browse-chip label (e.g. a full
     port-group name) has a nowrap min-content wider than the results column,
     which forces ~14px of horizontal page scroll at 360px. Let these chips
     wrap on the narrowest phones so they fit the column — no effect at ≥375px,
     where the chip already fits within the viewport. */
  @media (max-width: 374px) {
    .dir-chips .dir-chip { white-space: normal; }
  }
  /* ── Carrier profile (rich, DrayLocator-structured card) ────────────────── */
  .cp-caps { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 12px 0 4px; }
  /* Each badge GROUP (credentials / equipment) lays out on its own row. Desktop:
     a simple flex row — 4 credential or 5 equipment badges fit one line, so no
     wrap + no orphan. Narrow widths switch to a count-aware grid below so every
     line keeps >=2 badges (never a stranded single). */
  .cp-badgegroup { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; overflow-x: clip; width: 100%; }
  .cp-eqwrap { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; }
  .cp-eqlabel { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  @media (max-width: 640px) {
    /* Count-aware partition: columns chosen so no line ends with exactly one
       badge — 2→2, 3→3, 4→2×2, 5→3+2, 6→3×2. Equal 1fr columns + wrapping text
       (white-space:normal) means long labels never overflow the clipped group. */
    .cp-badgegroup { display: grid; gap: 8px; align-items: stretch; }
    .cp-badgegroup .cp-badge { justify-content: center; text-align: center; white-space: normal; font-size: 10px; padding: 4px 8px; min-width: 0; }
    .cp-badgegroup[data-n="1"] { grid-template-columns: max-content; }
    .cp-badgegroup[data-n="2"], .cp-badgegroup[data-n="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cp-badgegroup[data-n="3"], .cp-badgegroup[data-n="5"], .cp-badgegroup[data-n="6"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    /* Variable-length chip rows (cargo specialties up to 13, self-declared
       capabilities) can't use a per-count data-n map, so enforce the same
       no-orphan rule structurally: a 2-column grid, and when the count is ODD
       the first chip spans both columns — so the remaining even count fills
       clean pairs and the last row always has ≥2 (a sole chip is fine alone). */
    /* Doubled class (.cp-chiprow.cp-chiprow, specificity 0,2,0) so these beat the
       base .cp-chiprow flex rule, which is defined LATER in source order — media
       queries add no specificity, so an equal-specificity base rule further down
       would otherwise win the cascade and leave this grid dead. */
    .cp-chiprow.cp-chiprow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
    .cp-chiprow.cp-chiprow > * { min-width: 0; }
    .cp-chiprow.cp-chiprow > .cp-badge, .cp-chiprow.cp-chiprow > .cp-chip { justify-content: center; text-align: center; white-space: normal; }
    .cp-chiprow.cp-chiprow > :first-child:nth-last-child(odd) { grid-column: 1 / -1; }
  }
  .cp-badge-active { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; padding: 5px 9px; border-radius: var(--radius-chip); background: var(--success-bg); color: var(--success); border: 1px solid var(--success); display: inline-flex; align-items: center; gap: 6px; }
  .cp-badge-active::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--success); display: inline-block; }
  .cp-claimline { margin: 14px 0 0; font-size: 13px; color: var(--muted); }
  .cp-claimline a { color: var(--accent); text-decoration: none; }
  .cp-claimline a:hover { text-decoration: underline; }
  .cp-layout { display: grid; grid-template-columns: minmax(0, 1fr) 328px; gap: 24px; align-items: start; margin-top: 24px; }
  .cp-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .cp-side { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 16px; }
  .cp-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; }
  .cp-card > h2.cp-h { margin-top: 0; }
  .cp-h { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-family: var(--font-mono); margin: 0 0 16px; }
  .cp-about { margin: 0; line-height: 1.6; color: var(--ink-soft); font-size: 15px; }
  .cp-datagrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .cp-dt { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .cp-dt .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-family: var(--font-mono); }
  .cp-dt .v { font-size: 16px; color: var(--ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; word-break: break-word; }
  .cp-verify-link { display: inline-block; margin-top: 16px; font-size: 13px; font-family: var(--font-mono); color: var(--accent); text-decoration: none; }
  .cp-verify-link:hover { text-decoration: underline; }
  .cp-chiprow { display: flex; flex-wrap: wrap; gap: 8px; }
  .cp-chip { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.02em; padding: 8px 12px; border-radius: var(--radius-chip); border: 1px solid var(--border); background: var(--surface-2); color: var(--ink-soft); display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
  .cp-chip.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .cp-chip.good { border-color: var(--success); color: var(--success); background: var(--success-bg); }
  .cp-chip.muted { opacity: 0.6; }
  .cp-chip .tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; }
  .cp-note { margin: 16px 0 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
  /* Safety-record rate context — muted, own line, never colour-coded. */
  .cp-safety-ctx { display: block; margin-top: 2px; font-size: 12px; font-family: var(--font-sans, inherit); font-variant-numeric: normal; color: var(--muted); line-height: 1.4; }
  .cp-safety-lede { margin-top: 0; margin-bottom: 16px; }
  .cp-loc { margin: 0 0 8px; line-height: 1.6; color: var(--ink-soft); font-size: 14px; }
  .cp-loc:last-child { margin-bottom: 0; }
  .cp-loc .lk { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
  /* "Also operating in" — carrier-declared other metros. Sits below the base
     location lines; reuses .cp-eqlabel + .cp-chip / .cp-chiprow (which carries
     the no-orphan mobile grid). Small top gap separates it from the port line. */
  .cp-alsoloc { margin-top: 12px; }
  .cp-contact-row { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
  .cp-contact-row:last-of-type { border-bottom: 0; }
  .cp-contact-row .k { color: var(--muted); }
  .cp-contact-row .v { font-family: var(--font-mono); text-align: right; word-break: break-word; }
  .cp-contact-row .v a { color: var(--accent); text-decoration: none; }
  .cp-hidden { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .cp-gated { margin-top: 16px; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: var(--surface-2); padding: 16px; }
  .cp-gated h3 { margin: 0 0 4px; font-size: 13px; color: var(--ink-soft); }
  .cp-gated p { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
  /* Directory Pro contacts gate — blurred teaser + upgrade CTA (free) / reveal
     affordance (Pro). Token-only + theme-aware; buttons stack full-width so the
     no-orphan-wrap rule is moot (never an inline pill group). */
  .cp-gated .cp-gated-teaser { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 12px; }
  .cp-gated-blur { font-family: var(--font-mono); font-size: 12px; color: var(--muted); filter: blur(3px); user-select: none; letter-spacing: 0.5px; }
  .cp-gated .btn { width: 100%; justify-content: center; }
  .cp-gated .cp-unlock-btn { margin-bottom: 8px; }
  .cp-gated .cp-reveal-btn[disabled] { opacity: 0.55; cursor: not-allowed; }
  .cp-gated .cp-reveal-form { margin: 10px 0 0; }
  /* PR C — the revealed enriched-contacts result (swapped in by the inline
     enhancement script). Token-only + theme-aware; cards stack full-width so
     the no-orphan-wrap rule is moot. */
  .cp-reveal-result { margin-top: 12px; }
  .cp-reveal-list { display: flex; flex-direction: column; gap: 12px; }
  .cp-reveal-note { margin: 0 0 4px; font-size: 12px; color: var(--muted); }
  .cp-reveal-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--surface-2); }
  .cp-reveal-name { font-size: 13px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
  .cp-reveal-conf { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: var(--radius-chip); border: 1px solid var(--border); color: var(--muted); }
  .cp-reveal-conf--high { color: var(--accent); border-color: var(--accent); }
  .cp-reveal-msg { margin: 0; font-size: 13px; color: var(--muted); }
  .cp-reveal-msg--error { color: var(--ink-soft); font-weight: 500; }
  .cp-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .cp-actions .btn { width: 100%; justify-content: center; }
  /* ── Credential badges — distinct solid colours + pure-CSS hover/focus tooltip ─
     Palette defined as tokens (bg + text colour chosen for AA contrast). Solid
     colour = a credential the carrier ACTUALLY has (FMCSA-verified ones render
     now); self-declared credentials the carrier hasn't verified stay muted with
     a compact "Claim" affordance. Every badge is keyboard-focusable and carries a
     tooltip (data-tip → ::after on :hover/:focus). The badge rows clip horizontal
     overflow so a tooltip never triggers page horizontal scroll at 375px. */
  :root {
    /* Maersk-corner rule: EVERY directory badge / chip / pill uses this one small
       squared radius — no fully-rounded pills anywhere in the directory. */
    --radius-chip: 4px;
    --badge-dray-bg: #2563eb;        --badge-dray-fg: #ffffff;
    --badge-hazmat-bg: #ea580c;      --badge-hazmat-fg: #111827;
    --badge-reefer-bg: #14b8a6;      --badge-reefer-fg: #111827;
    --badge-dryvan-bg: #0f766e;      --badge-dryvan-fg: #ffffff;
    --badge-tanker-bg: #0369a1;      --badge-tanker-fg: #ffffff;
    --badge-flatbed-bg: #b45309;     --badge-flatbed-fg: #ffffff;
    --badge-drybulk-bg: #6d28d9;     --badge-drybulk-fg: #ffffff;
    --badge-authority-bg: #475569;   --badge-authority-fg: #ffffff;
    --badge-safety-good-bg: #15803d; --badge-safety-good-fg: #ffffff;
    --badge-safety-warn-bg: #d97706; --badge-safety-warn-fg: #111827;
    --badge-safety-bad-bg: #b91c1c;  --badge-safety-bad-fg: #ffffff;
    --badge-safety-none-bg: #6b7280; --badge-safety-none-fg: #ffffff;
    --badge-uiia-bg: #7c3aed;        --badge-uiia-fg: #ffffff;
    --badge-twic-bg: #4338ca;        --badge-twic-fg: #ffffff;
    --badge-bonded-bg: #166534;      --badge-bonded-fg: #ffffff;
    --badge-transload-bg: #92400e;   --badge-transload-fg: #ffffff;
    --badge-yard-bg: #334155;        --badge-yard-fg: #ffffff;
    --badge-tip-bg: #1f2937;         --badge-tip-fg: #f9fafb;
    --badge-tip-border: rgba(148, 163, 184, 0.28);
    --badge-focus: #2563eb;
  }
  .cp-chiprow, .cp-caps, .cp-nameline { overflow-x: clip; }
  .cp-badge { position: relative; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.05em; text-transform: uppercase; padding: 5px 9px; border-radius: var(--radius-chip); border: 1px solid transparent; white-space: nowrap; cursor: help; }
  .cp-badge:focus-visible, .cp-fmcsa:focus-visible { outline: 2px solid var(--badge-focus); outline-offset: 2px; }
  .cp-badge--dray { background: var(--badge-dray-bg); color: var(--badge-dray-fg); }
  .cp-badge--hazmat { background: var(--badge-hazmat-bg); color: var(--badge-hazmat-fg); }
  .cp-badge--reefer { background: var(--badge-reefer-bg); color: var(--badge-reefer-fg); }
  .cp-badge--dryvan { background: var(--badge-dryvan-bg); color: var(--badge-dryvan-fg); }
  .cp-badge--tanker { background: var(--badge-tanker-bg); color: var(--badge-tanker-fg); }
  .cp-badge--flatbed { background: var(--badge-flatbed-bg); color: var(--badge-flatbed-fg); }
  .cp-badge--drybulk { background: var(--badge-drybulk-bg); color: var(--badge-drybulk-fg); }
  .cp-badge--authority { background: var(--badge-authority-bg); color: var(--badge-authority-fg); }
  .cp-badge--safety-good { background: var(--badge-safety-good-bg); color: var(--badge-safety-good-fg); }
  .cp-badge--safety-warn { background: var(--badge-safety-warn-bg); color: var(--badge-safety-warn-fg); }
  .cp-badge--safety-bad { background: var(--badge-safety-bad-bg); color: var(--badge-safety-bad-fg); }
  .cp-badge--safety-none { background: var(--badge-safety-none-bg); color: var(--badge-safety-none-fg); }
  .cp-badge--uiia { background: var(--badge-uiia-bg); color: var(--badge-uiia-fg); }
  .cp-badge--twic { background: var(--badge-twic-bg); color: var(--badge-twic-fg); }
  .cp-badge--bonded { background: var(--badge-bonded-bg); color: var(--badge-bonded-fg); }
  .cp-badge--transload { background: var(--badge-transload-bg); color: var(--badge-transload-fg); }
  .cp-badge--yard { background: var(--badge-yard-bg); color: var(--badge-yard-fg); }
  .cp-badge--claim { background: var(--surface-2); color: var(--muted); border-color: var(--border); }
  .cp-badge--claim .tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; white-space: nowrap; flex: 0 0 auto; }
  /* Self-declared credentials → a UNIFORM card grid: 2-up on desktop, 1-up on
     narrow mobile. Each card is the same height per row (align-items:stretch),
     credential name left + compact "Claim" button right, so long labels
     (Customs-bonded / C-TPAT, Transload / warehouse) wrap gracefully WITHIN the
     card without making its row ragged. */
  .cp-claimgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-items: stretch; }
  .cp-claimgrid .cp-badge--claim { display: flex; justify-content: space-between; align-items: center; gap: 8px; height: 100%; white-space: normal; text-align: left; padding: 10px 12px; }
  .cp-claimgrid .cp-badge-label { min-width: 0; overflow-wrap: anywhere; }
  @media (max-width: 480px) {
    .cp-claimgrid { grid-template-columns: 1fr; }
  }
  .cp-tip[data-tip]:hover::after,
  .cp-tip[data-tip]:focus::after,
  .cp-tip[data-tip]:focus-visible::after {
    content: attr(data-tip);
    position: absolute; top: calc(100% + 9px); left: 50%; transform: translateX(-50%);
    z-index: 30; width: max-content; max-width: min(240px, 72vw);
    white-space: normal; text-align: left; text-transform: none; letter-spacing: normal;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px; line-height: 1.45;
    padding: 9px 11px; border-radius: 8px;
    background: var(--badge-tip-bg); color: var(--badge-tip-fg); border: 1px solid var(--badge-tip-border);
    box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35); pointer-events: none;
  }
  .cp-tip[data-tip]:hover::before,
  .cp-tip[data-tip]:focus::before,
  .cp-tip[data-tip]:focus-visible::before {
    content: ''; position: absolute; top: calc(100% + 3px); left: 50%; transform: translateX(-50%);
    border: 6px solid transparent; border-bottom-color: var(--badge-tip-bg); z-index: 31; pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .cp-tip[data-tip]::after, .cp-tip[data-tip]::before { transition: none; }
  }
  /* ── JS-positioned tooltip (directory-tooltip.js) ──────────────────────────
     When the script runs it flags <html class="js-tips"> and disables the CSS
     ::after/::before tooltip above (avoids a double tooltip). The .qf-tip node
     lives on <body> so it escapes every overflow:clip badge-row ancestor, and
     the embedded "✓" renders in the green success token via .qf-tip-check.
     No-JS users keep the CSS tooltip; aria-label carries the name regardless. */
  html.js-tips .cp-tip[data-tip]:hover::after,
  html.js-tips .cp-tip[data-tip]:focus::after,
  html.js-tips .cp-tip[data-tip]:focus-visible::after,
  html.js-tips .cp-tip[data-tip]:hover::before,
  html.js-tips .cp-tip[data-tip]:focus::before,
  html.js-tips .cp-tip[data-tip]:focus-visible::before { display: none !important; }
  .qf-tip {
    position: fixed; left: 0; top: 0; z-index: 9999; visibility: hidden;
    width: max-content; max-width: min(240px, 72vw);
    white-space: normal; text-align: left; text-transform: none; letter-spacing: normal;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px; line-height: 1.45;
    padding: 8px 11px; border-radius: 8px;
    background: var(--badge-tip-bg); color: var(--badge-tip-fg); border: 1px solid var(--badge-tip-border);
    box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35); pointer-events: none;
    opacity: 0; transition: opacity 0.12s ease;
  }
  .qf-tip.is-open { opacity: 1; }
  .qf-tip::after {
    content: ''; position: absolute; left: var(--tip-arrow-x, 50%); transform: translateX(-50%);
    border: 6px solid transparent;
  }
  .qf-tip[data-pos="above"]::after { top: 100%; border-top-color: var(--badge-tip-bg); }
  .qf-tip[data-pos="below"]::after { bottom: 100%; border-bottom-color: var(--badge-tip-bg); }
  .qf-tip-check { color: var(--success); font-weight: 700; }
  @media (prefers-reduced-motion: reduce) {
    .qf-tip { transition: none; }
  }
  /* ── DrayLocator-structured header: [monogram] name · Active · FMCSA / claim
     on the right, subtitle, then the squared badge row — all left-aligned. ──── */
  .cp-headrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; text-align: left; margin: 14px 0 0; }
  .cp-idblock { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
  .cp-monogram { flex: 0 0 auto; width: 54px; height: 54px; border-radius: 8px; margin-top: 2px; background: var(--surface-2); border: 1px solid var(--border); color: var(--ink); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 21px; font-weight: 700; letter-spacing: 0.04em; }
  .cp-idtext { min-width: 0; }
  .cp-nameline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .cp-nameline h1 { font-size: 30px; line-height: 1.15; margin: 0; }
  .cp-fmcsa { position: relative; font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 7px; border-radius: 4px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); white-space: nowrap; cursor: help; }
  .cp-subtitle { margin: 8px 0 0; }
  .cp-headrow .cp-claimline { margin: 4px 0 0; }
  /* Profile trailing blocks — desktop defaults (classes replace former inline
     styles so mobile can tighten them below). */
  .cp-crosslinks { margin-top: 24px; }
  .cp-claimcard { margin-top: 24px; padding: 24px; text-align: center; }
  /* The global .site-footer carries a generous marketing gap (72px margin-top +
     44px padding-top). On a short carrier profile that reads as a dead band
     between the claim card and the footer. Trim it — SCOPED to the profile via
     the profile's sibling footer, so every other page's footer is untouched.
     Uses ~ (not +) because a <script> sits between <main> and the footer. */
  main.dir-shell--cp ~ .site-footer { margin-top: 32px; }
  @media (max-width: 640px) {
    .cp-nameline h1 { font-size: 24px; }
    .cp-monogram { width: 46px; height: 46px; font-size: 18px; }
  }
  @media (max-width: 900px) {
    .cp-layout { grid-template-columns: 1fr; }
    .cp-side { position: static; }
  }
  @media (max-width: 640px) {
    .cp-card { padding: 16px; }
    /* Tighten the profile on mobile so it reads dense — no airy section gaps,
       no dead band before the footer (see the base rules above). */
    .cp-layout { margin-top: 16px; gap: 12px; }
    .cp-main, .cp-side { gap: 12px; }
    .cp-crosslinks { margin-top: 16px; }
    /* Nearby shortcut chips: on narrow widths the nowrap pills used to stack
       one-per-row (dead space on the right). Pack them into a 2-up grid that
       fills the width; when the count is ODD the first chip spans both columns
       so the last row always keeps >=2 (no orphaned single) — the same
       no-orphan pattern .cp-chiprow uses. */
    .cp-crosslinks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .cp-crosslinks .dir-chip { white-space: normal; text-align: center; }
    .cp-crosslinks .dir-chip:first-child:nth-last-child(odd) { grid-column: 1 / -1; }
    .cp-claimcard { margin-top: 16px; padding: 16px; }
    main.dir-shell--cp { padding-bottom: 8px; }
    /* Generalized from the profile-only trim: EVERY directory footer (results,
       state, profile) gets the same tight gap + trimmed top/bottom padding on
       mobile, killing the ~110px dead band the base 104px bottom padding left
       below the © / links row. The scoped line re-asserts 16px on the profile,
       whose desktop-scoped rule above (0,2,1) would otherwise win over this
       general selector on mobile too. */
    .site-footer { margin-top: 16px; padding-top: 24px; padding-bottom: 32px; }
    main.dir-shell--cp ~ .site-footer { margin-top: 16px; }
  }
  @media (max-width: 380px) {
    .cp-datagrid { grid-template-columns: 1fr; }
  }
  /* ── Carrier-profile TABS ─────────────────────────────────────────────────
     Pure-CSS, no-framework, SEO-safe tabs. The four section panels are ALL
     present in the HTML (crawlers index every field); CSS only hides the
     inactive ones. The mechanism is a native radio group: four visually-hidden
     but keyboard-FOCUSABLE radio inputs sit as siblings before the labels +
     panels. Selecting a radio (click a label, or Arrow-key within the group —
     native radio behaviour) flips :checked, and the general-sibling combinator
     reveals the matching panel. Works with zero JS; Arrow keys navigate + switch
     tabs for free; focus is shown on the label via :focus-visible. Theme-aware
     tokens only — no hardcoded colours. */
  .cp-tabs { display: flex; flex-wrap: wrap; position: relative; margin-top: 24px; }
  /* Visually hidden, still focusable (not display:none / visibility:hidden). */
  .cp-tab-input { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; clip: rect(0 0 0 0); clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
  .cp-tab {
    flex: 1 1 0; min-width: 0; text-align: center; cursor: pointer; user-select: none;
    padding: 13px 14px; font-size: 13px; font-family: var(--font-mono); letter-spacing: 0.04em;
    color: var(--muted); background: var(--surface);
    border: 1px solid var(--border); border-bottom-width: 2px; border-right: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cp-tab:first-of-type { border-top-left-radius: var(--radius-lg); }
  .cp-tab:last-of-type { border-right: 1px solid var(--border); border-top-right-radius: var(--radius-lg); }
  .cp-tab:hover { color: var(--ink-soft); background: var(--surface-2); }
  .cp-tab-input:checked + .cp-tab { color: var(--accent); background: var(--surface); border-bottom-color: var(--accent); }
  .cp-tab-input:focus-visible + .cp-tab { outline: 2px solid var(--accent); outline-offset: -2px; }
  .cp-tab-sm { display: none; }
  .cp-panel { flex: 0 0 100%; width: 100%; min-width: 0; display: none; padding-top: 16px; }
  #cp-tab-overview:checked ~ .cp-panel--overview,
  #cp-tab-services:checked ~ .cp-panel--services,
  #cp-tab-safety:checked ~ .cp-panel--safety,
  #cp-tab-contact:checked ~ .cp-panel--contact { display: flex; flex-direction: column; gap: 16px; }
  /* Cargo-class specialties: a neutral chip group (variable length → the same
     flex-wrap chip row the full-enumeration list already uses). */
  .cp-badge--cargo, .cp-badge--fact { background: var(--surface-2); color: var(--ink-soft); border-color: var(--border); text-transform: none; letter-spacing: 0.02em; }
  /* Credential FACTS carry figures, so tabular digits; outline-and-tint, never a
     fill — a measured credential should not out-shout the category badges. */
  .cp-badge--fact { font-variant-numeric: tabular-nums; cursor: default; }
  .cp-cargorow { margin-top: 2px; }
  .cp-factrow { margin-top: 8px; }
  /* Variable-length data grids (1–3 insurance rows): odd count ⇒ the first item
     spans both columns, so the last line never strands a single figure. Same
     structural no-orphan rule the chip rows use. */
  .cp-datagrid--auto > :first-child:nth-last-child(odd) { grid-column: 1 / -1; }
  .cp-asof { margin-top: 14px; }
  @media (max-width: 640px) {
    .cp-tabs { margin-top: 16px; }
    .cp-tab { padding: 10px 6px; font-size: 11px; letter-spacing: 0.02em; }
    .cp-tab-lg { display: none; }
    .cp-tab-sm { display: inline; }
  }

  /* ── Shipper nav state + Directory Pro join/checkout surface ───────────── */
  .nav-shipper { display: inline-flex; align-items: center; }
  .nav-shipper--auth { gap: 12px; }
  .nav-email { font-size: 13px; color: var(--ink-soft); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-pro-chip { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 8px; border-radius: var(--radius-chip); background: var(--success-bg); color: var(--success); border: 1px solid var(--success); white-space: nowrap; }
  .nav-upgrade, .nav-manage { white-space: nowrap; }

  .join-shell { max-width: 720px; }
  .join-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card, 16px); padding: 24px; }
  .join-panel h2 { margin: 0 0 8px; font-size: 22px; text-align: left; }
  .join-sub { margin: 0 0 16px; color: var(--ink-soft); font-size: 15px; line-height: 1.5; }
  .join-badge-row { margin-bottom: 12px; }
  .join-features { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 8px; }
  .join-features li { position: relative; padding-left: 24px; font-size: 14px; color: var(--ink); line-height: 1.5; }
  .join-features li::before { content: '✓'; position: absolute; left: 0; top: 0; color: var(--success); font-weight: 700; }
  .join-price { display: inline-flex; align-items: baseline; gap: 8px; margin: 0 0 16px; }
  .join-price b { font-size: 24px; font-weight: 700; color: var(--ink); }
  .join-price span { font-size: 13px; color: var(--ink-soft); }
  .join-split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0 0; }
  .join-plan { border: 1px solid var(--border); border-radius: var(--radius-input, 12px); background: var(--surface-2); padding: 16px; }
  .join-plan--pro { border-color: var(--accent); }
  .join-plan-head { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 4px; }
  .join-plan-price { font-size: 13px; font-weight: 600; color: var(--ink); margin: 0 0 12px; }
  .join-plan .join-features { margin-top: 0; }
  @media (max-width: 560px) { .join-split { grid-template-columns: 1fr; } }
  .join-form { display: grid; gap: 12px; margin: 0 0 12px; }
  .join-field { display: block; position: relative; border: 1px solid var(--border); border-radius: var(--radius-input, 12px); background: var(--surface-2); padding: 8px 12px; }
  .join-field:focus-within { border-color: var(--accent); }
  .join-field-label { display: block; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); }
  .join-field input { width: 100%; border: 0; background: transparent; color: var(--ink); font-size: 16px; padding: 2px 0 0; outline: none; }
  .join-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
  .join-actions .btn { flex: 1 1 auto; min-width: 180px; justify-content: center; }
  .join-msg { margin: 12px 0 0; font-size: 14px; color: var(--ink-soft); min-height: 20px; }
  .join-msg--ok { color: var(--success); }
  .join-msg--err { color: var(--error); }

  /* Premium GLASS on the shipper subscribe panel (funnel surface 3) — the
     $19/mo Directory Pro path should read as premium as the trucker pricing
     flagship. Regular-material glass + accent outline/glow; the input FIELDS
     (.join-field) keep their SOLID --surface-2 fill (glass never sits behind
     typed text). Directory is dark by default (style.css :root) with a
     html[data-theme="light"] override. -webkit-backdrop-filter is paired and
     an @supports-not SOLID fallback ships. */
  .join-panel {
    background: rgba(34, 40, 42, 0.60);
    border: 1px solid rgba(13, 60, 252, 0.55);
    border-radius: 18px;
    -webkit-backdrop-filter: blur(16px) saturate(1.3);
    backdrop-filter: blur(16px) saturate(1.3);
    box-shadow:
      0 0 0 1px rgba(13, 60, 252, 0.22),
      0 10px 34px rgba(13, 60, 252, 0.16),
      0 8px 32px rgba(0, 0, 0, 0.30);
  }
  html[data-theme="light"] .join-panel {
    background: rgba(255, 255, 255, 0.70);
    border: 1px solid rgba(13, 60, 252, 0.45);
    box-shadow:
      0 0 0 1px rgba(13, 60, 252, 0.14),
      0 12px 40px rgba(13, 60, 252, 0.12),
      0 8px 32px rgba(10, 37, 64, 0.10);
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .join-panel { background: rgba(34, 40, 42, 0.98); }
    html[data-theme="light"] .join-panel { background: rgba(255, 255, 255, 0.98); }
  }

  .dir-upgrade-banner { border: 1px solid var(--border); border-radius: var(--radius-card, 16px); padding: 16px; margin-bottom: 16px; font-size: 15px; line-height: 1.5; color: var(--ink); }
  .dir-upgrade-banner strong { color: var(--ink); }
  .dir-upgrade-banner a { color: var(--accent); }
  .dir-upgrade-banner--ok { background: var(--success-bg); border-color: var(--success); }
  .dir-upgrade-banner--info { background: var(--accent-soft); border-color: var(--accent); }

  /* The mobile burger menu carries its own "For shippers" link, so the desktop
     shipper nav slot (incl. the hydrated email / Pro chip / Manage) is hidden
     on mobile to avoid crowding + horizontal overflow in the top bar. */
  @media (max-width: 720px) {
    .nav-shipper { display: none; }
  }
  @media (max-width: 640px) {
    .nav-email { display: none; }
    .join-panel { padding: 16px; }
    .join-actions .btn { flex: 1 1 100%; }
  }
  /* ── Saved lists (Directory Pro, PR D) ──────────────────────────────────
     The "Save" affordance on cards + profile, its popover, and the saved-lists
     page rows. Theme-aware, tokens only. */
  .cp-headactions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  /* Primary shipper action group (Request a rate + Save). flex-wrap keeps >=2 per
     line where they fit and stacks each control full-width otherwise — never a
     stranded orphan, no horizontal overflow at 375px. */
  .cp-headcta { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
  .cp-rfq-btn { white-space: nowrap; }
  @media (max-width: 640px) {
    .cp-headactions { align-items: flex-start; }
    .cp-headcta { justify-content: flex-start; }
  }
  .qf-save { position: relative; display: inline-flex; }
  .cc-sel { display: flex; flex-direction: column; }
  .cc-sel .carrier-card { flex: 1 1 auto; }
  .qf-save-btn { display: inline-flex; align-items: center; gap: 6px; }
  .qf-save-ic { font-size: 15px; line-height: 1; font-weight: 700; }
  .qf-save-pop { position: absolute; z-index: 40; left: 0; top: calc(100% + 8px); width: 260px; max-width: 80vw;
    background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
    box-shadow: 0 12px 32px rgba(0,0,0,0.28); padding: 12px; }
  .qf-save-pop h4 { margin: 0 0 8px; font-size: 13px; color: var(--ink); }
  .qf-save-pop p { margin: 0 0 8px; font-size: 12px; color: var(--muted); line-height: 1.5; }
  .qf-save-lists { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; margin-bottom: 8px; }
  .qf-save-list { display: flex; align-items: center; justify-content: space-between; gap: 8px;
    width: 100%; text-align: left; background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 8px 12px; font-size: 13px; color: var(--ink); cursor: pointer; }
  .qf-save-list:hover, .qf-save-list:focus-visible { border-color: var(--accent); }
  .qf-save-list .n { font-size: 11px; color: var(--muted); font-family: var(--font-mono); }
  .qf-save-list[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
  .qf-save-new { display: flex; gap: 8px; margin-top: 8px; }
  .qf-save-new input { flex: 1 1 auto; min-width: 0; background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 8px 12px; font-size: 13px; color: var(--ink); }
  .qf-save-msg { margin: 8px 0 0; font-size: 12px; color: var(--accent); }
  .qf-save-msg--err { color: var(--ink-soft); }
  .qf-save-cta { display: block; margin-top: 8px; }

  /* Saved-lists page */
  .sl-wrap { display: flex; flex-direction: column; gap: 16px; }
  .sl-list { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
  .sl-list > summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 16px 20px; font-size: 16px; font-weight: 600; color: var(--ink); }
  .sl-list > summary::-webkit-details-marker { display: none; }
  .sl-list > summary .n { font-size: 12px; color: var(--muted); font-family: var(--font-mono); font-weight: 500; }
  .sl-body { padding: 0 20px 20px; }
  .sl-empty { color: var(--muted); font-size: 13px; margin: 0; }
  .sl-row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 12px 0; border-top: 1px solid var(--border); }
  .sl-row .lk { color: var(--ink); text-decoration: none; font-weight: 600; font-size: 14px; }
  .sl-row .lk:hover { color: var(--accent); }
  .sl-row .sub { font-size: 12px; color: var(--muted); font-family: var(--font-mono); }
  .sl-rm { flex: 0 0 auto; }

  /* ── Two-audience band (directory landing) ──────────────────────────────
     Shipper value-prop + RFQ/Directory Pro entry, shown as a peer to the
     carrier "Claim your listing" path. Tokens only, theme-aware, left-aligned.
     auto-fit → 2 columns on desktop, a clean single-column stack on mobile. */
  .dir-audience { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
  .aud-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 22px 24px; }
  .aud-eyebrow { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
  .aud-card h3 { margin: 0 0 8px; font-size: 20px; line-height: 1.2; text-align: left; }
  .aud-lead { margin: 0; color: var(--ink-soft); font-size: 15px; line-height: 1.55; }
  .aud-card .join-features { margin-top: 14px; }
  .aud-cta-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  .aud-cta-row .btn { flex: 1 1 180px; justify-content: center; }
  @media (max-width: 640px) {
    .aud-card { padding: 18px; }
    .aud-cta-row .btn { flex: 1 1 100%; }
  }

  /* ── Glass tokens (directory-local; canonical DESIGN-SYSTEM values) ────────
     landing-glass.css isn't linked on directory pages, so we define the few
     glass tokens the toolbar / action bar / modal need here. rgba() literals are
     NOT flagged by the hardcoded-color guard. Dark-default base + light override
     (mirrors style.css theming). Solid fallbacks (*-solid) feed the @supports
     no-backdrop-filter path so embedded / privacy contexts stay readable. */
  :root {
    --glass-ultra-bg: rgba(18, 22, 26, 0.62);
    --glass-ultra-brd: rgba(255, 255, 255, 0.10);
    --glass-ultra-solid: rgba(18, 22, 26, 0.97);
    --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }
  html[data-theme="light"] {
    --glass-ultra-bg: rgba(255, 255, 255, 0.64);
    --glass-ultra-brd: rgba(255, 255, 255, 0.55);
    --glass-ultra-solid: rgba(255, 255, 255, 0.98);
    --glass-shadow: 0 8px 32px rgba(10, 37, 64, 0.12);
  }

  /* ── D1: unified results toolbar — filters entry + count + sort as ONE cluster.
     Replaces the old separate results-bar + applied-chips rows. The mobile rail
     "Filters" toggle is relocated INTO this bar (see .rt-main .rail-toggle) so the
     filter entry point and the sort control read as one control group. */
  .results-toolbar { display: flex; flex-direction: column; gap: 10px; margin: 0 0 16px; padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; }
  .rt-main { display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; }
  .rt-main .rc { font-size: 15px; min-width: 0; margin-right: auto; }
  .rt-main .rc b { font-family: var(--font-mono); color: var(--accent); font-size: 20px; }
  .rt-main .sort-ctl { flex: 0 0 auto; }
  .rt-main .rail-toggle { display: none; } /* desktop: rail always visible, no toggle */
  .results-toolbar .applied-chips { margin: 0; padding-top: 12px; border-top: 1px solid var(--border); }

  /* ── D4: fold long facet lists (Show more / Show less). Rendered OPEN so no-JS
     + crawlers see every facet link; the fold script collapses it and reveals the
     toggle. True height animation via grid-template-rows 0fr↔1fr, reduced-motion
     guarded. Selected/again = accent text, never a bright fill. */
  .facet-fold { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.22s ease; }
  .facet-fold[data-collapsed="1"] { grid-template-rows: 0fr; }
  .facet-fold > .facet-fold-inner { overflow: hidden; min-height: 0; }
  .facet-more { display: inline-flex; align-items: center; gap: 6px; margin: 8px 2px 2px; padding: 4px 6px; background: transparent; border: 0; color: var(--accent); font-family: var(--font-mono); font-size: 12px; cursor: pointer; }
  .facet-more:hover { text-decoration: underline; }
  .facet-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  .facet-more .facet-more-ico { font-size: 9px; transition: transform 0.18s ease; }
  .facet-more[aria-expanded="true"] .facet-more-ico { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { .facet-fold, .facet-more .facet-more-ico { transition: none; } }

  /* ── Category accordions — each facet-group's <h3> header toggles its body.
     Rendered OPEN (no-JS + crawlers see every facet link); ACCORDION_SCRIPT
     folds them all on load so the rail is compact and results lead. Height
     animates via grid-template-rows 0fr↔1fr, reduced-motion guarded. */
  .facet-acc-h { margin: 0; }
  .facet-acc-btn { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 0; margin: 0; background: transparent; border: 0; cursor: pointer; text-align: left; color: inherit; font: inherit; }
  .facet-acc-ttl { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); font-family: var(--font-mono); }
  .facet-acc-btn:hover .facet-acc-ttl { color: var(--ink-soft); }
  .facet-acc-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
  .facet-acc-ico { flex: 0 0 auto; font-size: 9px; color: var(--muted); transition: transform 0.18s ease; }
  .facet-group[data-acc="open"] .facet-acc-ico { transform: rotate(180deg); }
  .facet-acc-body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.22s ease; margin-top: 8px; }
  .facet-group[data-acc="closed"] .facet-acc-body { grid-template-rows: 0fr; margin-top: 0; }
  .facet-acc-body > .facet-acc-inner { overflow: hidden; min-height: 0; }
  @media (prefers-reduced-motion: reduce) { .facet-acc-body, .facet-acc-ico { transition: none; } }

  /* ── D2: multi-select save — action-bar "Save selected (N)" + list-picker /
     empty-state modal. The (N) suffix only shows once ≥1 card is ticked. */
  .qf-ab-save[data-count="0"] .qf-ab-saven { display: none; }
  .qf-modal-backdrop { position: fixed; inset: 0; z-index: 2147482600; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(4, 7, 12, 0.55); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); opacity: 0; visibility: hidden; transition: opacity 0.18s ease, visibility 0s linear 0.18s; }
  .qf-modal-backdrop.open { opacity: 1; visibility: visible; transition: opacity 0.18s ease; }
  .qf-modal { width: 100%; max-width: 440px; max-height: calc(100vh - 40px); overflow-y: auto; background: var(--glass-ultra-bg); -webkit-backdrop-filter: blur(20px) saturate(1.4); backdrop-filter: blur(20px) saturate(1.4); border: 1px solid var(--glass-ultra-brd); border-radius: 16px; box-shadow: var(--glass-shadow); padding: 22px; transform: translateY(10px) scale(0.98); transition: transform 0.18s ease; }
  .qf-modal-backdrop.open .qf-modal { transform: none; }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .qf-modal { background: var(--glass-ultra-solid); } }
  @media (prefers-reduced-motion: reduce) { .qf-modal-backdrop, .qf-modal { transition: opacity 0.18s ease; } .qf-modal { transform: none; } }
  .qf-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 0 0 12px; }
  .qf-modal-head h2 { margin: 0; font-size: 18px; line-height: 1.25; color: var(--ink); }
  .qf-modal-x { flex: 0 0 auto; background: transparent; border: 0; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; padding: 0 6px; border-radius: 6px; }
  .qf-modal-x:hover { color: var(--ink); }
  .qf-modal-x:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .qf-modal p { margin: 0 0 12px; font-size: 14px; color: var(--ink-soft); line-height: 1.55; }
  .qf-modal-steps { margin: 0 0 16px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .qf-modal-steps li { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; color: var(--ink-soft); line-height: 1.45; }
  .qf-modal-steps .n { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent); font-family: var(--font-mono); font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
  .qf-modal-lists { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; margin: 4px 0 14px; }
  .qf-modal-list { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--ink); font-size: 14px; text-align: left; cursor: pointer; }
  .qf-modal-list:hover, .qf-modal-list:focus-visible { border-color: var(--accent); outline: none; }
  .qf-modal-list .n { font-size: 11px; color: var(--muted); font-family: var(--font-mono); }
  .qf-modal-newlbl { display: block; font-size: 12px; font-family: var(--font-mono); color: var(--muted); margin: 0 0 6px; }
  .qf-modal-new { display: flex; gap: 8px; }
  .qf-modal-new input { flex: 1 1 auto; min-width: 0; background: var(--surface); color: var(--ink); border: 1px solid var(--border-strong); border-radius: 6px; padding: 10px 12px; font-size: 14px; font-family: inherit; min-height: 44px; }
  .qf-modal-new input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .qf-modal-msg { margin: 12px 0 0; font-size: 13px; color: var(--accent); }
  .qf-modal-msg--err { color: var(--ink-soft); }
  .qf-modal-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }

  @media (max-width: 900px) {
    /* Relocated rail toggle sits inline in the toolbar (not the old full-width
       bar): auto width, no bottom margin, squared to match the sort control. */
    .rt-main .rail-toggle { display: inline-flex; width: auto; margin: 0; }
  }

  /* Complete city index (/directory/{state}/cities) — a dense A-Z link list.
     Appended at the END of DIRECTORY_CSS on purpose: the spacing/colour guards
     are line-based, so inserting mid-file renumbers every later baseline. */
  .ci-grp { margin: 0 0 18px; }
  .ci-grp:last-child { margin-bottom: 0; }
  .ci-ltr {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .ci-grp .dir-chip { font-size: 13px; }
  .ci-grp .dir-chip .muted-small { margin-left: 6px; opacity: 0.7; }

  /* Decade jump links under the numbered pager on long hub series. Keeps every
     page of a 146-page city hub within two hops of page 1. */
  .dir-pagejumps {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 10px 0 8px;
  }
  .dir-pagejumps a {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    padding: 2px 6px;
    border-radius: 6px;
  }
  .dir-pagejumps a:hover { color: var(--text); background: var(--surface-2); }
`;

/**
 * DIRECTORY_CSS AS AN EXTERNAL, CONTENT-HASHED, IMMUTABLE STYLESHEET.
 *
 * MEASURED PROBLEM (Search Console + live fetches, 2026-08-29): every directory
 * page inlined this block in a <style> tag. It is 68,058 bytes and BYTE-IDENTICAL
 * on every page (verified: same SHA-256 across three sampled carrier profiles), so
 * it was 59% of a ~115 KB carrier profile — and ~95% of each page was boilerplate
 * CSS + JS with only ~5 KB of per-carrier markup.
 *
 * Inline CSS cannot be cached across URLs. Googlebot therefore re-downloaded the
 * same 68 KB on every one of the ~330k carrier profiles: ~22 GB of the ~37 GB
 * needed to crawl the carrier set. Crawl budget is spent in BYTES and TIME as much
 * as in requests, and this site's binding constraint is crawl rate (URL Inspection
 * on 5 unindexed carriers: "Discovered – currently not indexed", lastCrawl NEVER,
 * while discovery is 100% solved). Serving it once as a cacheable file cuts crawl
 * bytes for the whole directory by ~60%.
 *
 * WHY CONTENT-HASHED + `immutable` RATHER THAN THE express.static DEFAULT: the
 * static mount deliberately sets `Cache-Control: no-cache` on .css because those
 * filenames are NOT content-hashed, so a positive TTL would pin visitors to a
 * stale bundle after a deploy (see app.ts). That reasoning does not apply here —
 * the hash IS the filename, so a changed stylesheet is a changed URL and can be
 * cached for a year with no staleness risk. A crawler fetches it once for the
 * entire directory instead of revalidating 330k times.
 *
 * USER-FACING EFFECT IS A NET WIN, NOT A TRADE: the HTML each visitor downloads
 * drops ~68 KB (115 KB → ~47 KB), and the stylesheet is fetched once and reused
 * across every subsequent directory page. The page already loads /style.css and
 * /nav-unify.css from the same origin, so this adds no NEW connection and is
 * multiplexed alongside them.
 */
export const DIRECTORY_CSS_HASH = createHash('sha256').update(DIRECTORY_CSS).digest('hex').slice(0, 16);

/** The immutable href for DIRECTORY_CSS. Changes only when the CSS changes. */
export const DIRECTORY_CSS_HREF = `/assets/directory-${DIRECTORY_CSS_HASH}.css`;

/**
 * Progressive-enhancement for the results action bar. No-JS renders links that
 * act on ALL filtered carriers (the filter querystring baked into data-filter-qs);
 * this swaps the count + all four hrefs to `?dots=…` the moment ≥1 card is ticked,
 * and reverts to the filter querystring when the selection is cleared. Kept as a
 * plain IIFE string (no build step) and defensively null-guarded throughout.
 */
const ACTION_BAR_SCRIPT = `(function(){
  var bar=document.querySelector('.qf-actionbar');
  var results=document.querySelector('.dir-results');
  if(!bar||!results)return;
  var filterQs=bar.getAttribute('data-filter-qs')||'';
  var total=parseInt(bar.getAttribute('data-total')||'0',10)||0;
  var cap=parseInt(bar.getAttribute('data-rfq-cap')||'0',10)||0;
  var nEl=bar.querySelector('.qf-ab-n');
  var lblEl=bar.querySelector('.qf-ab-lbl');
  var rfqnEl=bar.querySelector('.qf-ab-rfqn');
  var rfqofEl=bar.querySelector('.qf-ab-rfqof');
  var rfqwEl=bar.querySelector('.qf-ab-rfqw');
  var countEl=bar.querySelector('.qf-ab-count');
  var links={rfq:'/directory/rfq','export-view':'/directory/export/view','export-xlsx':'/directory/export.xlsx','export-csv':'/directory/export.csv'};
  function fmt(n){try{return n.toLocaleString('en-US');}catch(e){return String(n);}}
  function suffix(dots){return dots.length?'?dots='+dots.join(','):(filterQs?'?'+filterQs:'');}
  function selected(){var out=[];var cbs=results.querySelectorAll('.cc-cb');for(var i=0;i<cbs.length;i++){if(cbs[i].checked){var d=cbs[i].getAttribute('data-dot');if(d)out.push(d);}}return out;}
  function apply(){
    var dots=selected();
    var s=suffix(dots);
    var n=dots.length?dots.length:total;
    // The RFQ button reflects the send cap; the count label shows the true total.
    var shown=(cap>0&&n>cap)?cap:n;
    var word='carrier'+(shown===1?'':'s');
    var ofClause=(cap>0&&n>cap)?(' of '+fmt(n)):'';
    if(nEl)nEl.textContent=fmt(n);
    if(rfqnEl)rfqnEl.textContent=fmt(shown);
    if(rfqofEl)rfqofEl.textContent=ofClause;
    if(rfqwEl)rfqwEl.textContent=word;
    if(lblEl)lblEl.textContent='carrier'+(n===1?'':'s')+(dots.length?' selected':' filtered');
    if(countEl)countEl.setAttribute('data-selected',String(dots.length));
    bar.setAttribute('data-mode',dots.length?'dots':'filter');
    for(var key in links){if(!links.hasOwnProperty(key))continue;var a=bar.querySelector('[data-role="'+key+'"]');if(a)a.setAttribute('href',links[key]+s);}
    // "Save selected (N)" — reflect the live selection count (only ticked cards
    // are ever saved; with 0 ticked the button opens the how-it-works modal).
    var saveBtn=bar.querySelector('[data-role="save-selected"]');
    if(saveBtn){saveBtn.setAttribute('data-count',String(dots.length));var sn=saveBtn.querySelector('.qf-ab-saven');if(sn)sn.textContent=' ('+dots.length+')';}
  }
  results.addEventListener('change',function(e){var t=e.target;if(t&&t.classList&&t.classList.contains('cc-cb'))apply();});
  apply();
})();`;

/**
 * D2 — multi-select SAVE from the action bar. The "Save selected (N)" button:
 *   • 0 ticked  → opens a glass how-it-works MODAL (select carriers, then save).
 *   • ≥1 ticked → opens the list-picker MODAL: fetch the caller's lists, gate on
 *     401 (sign-in) / 403 (Directory Pro upsell), else add ALL selected carriers
 *     to a chosen (or newly-created) list via the batch endpoint in ONE request.
 * The modal is keyboard-dismissible (Esc / backdrop / ×), focus-trapped, and
 * reuses the same Pro-gated saved-lists API as the (profile-only) single save.
 * Inert without JS — Save is a pure enhancement over the JSON API.
 */
const SAVE_SELECTED_SCRIPT = `(function(){
  if(window.__qfSaveSelBound)return; window.__qfSaveSelBound=true;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);});}
  var results=document.querySelector('.dir-results');
  var bar=document.querySelector('.qf-actionbar');
  if(!results||!bar)return;
  var saveBtn=bar.querySelector('[data-role="save-selected"]');
  if(!saveBtn)return;
  var backdrop=document.createElement('div'); backdrop.className='qf-modal-backdrop';
  var modal=document.createElement('div'); modal.className='qf-modal'; modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-labelledby','qf-modal-title');
  backdrop.appendChild(modal); document.body.appendChild(backdrop);
  var isOpen=false,lastFocus=null;
  function focusables(){return modal.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');}
  function openModal(){ if(isOpen)return; isOpen=true; lastFocus=document.activeElement; backdrop.classList.add('open'); var f=focusables(); if(f.length)f[0].focus(); }
  function closeModal(){ if(!isOpen)return; isOpen=false; backdrop.classList.remove('open'); if(lastFocus&&lastFocus.focus)try{lastFocus.focus();}catch(e){} }
  backdrop.addEventListener('click',function(e){ if(e.target===backdrop)closeModal(); });
  document.addEventListener('keydown',function(e){
    if(!isOpen)return;
    if(e.key==='Escape'){ e.preventDefault(); closeModal(); return; }
    if(e.key==='Tab'){ var f=focusables(); if(!f.length)return; var first=f[0],last=f[f.length-1];
      if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); } }
  });
  function selected(){ var out=[]; var cbs=results.querySelectorAll('.cc-cb'); for(var i=0;i<cbs.length;i++){ if(cbs[i].checked){ var d=cbs[i].getAttribute('data-dot'); if(d)out.push(d); } } return out; }
  function head(title){ return '<div class="qf-modal-head"><h2 id="qf-modal-title">'+esc(title)+'</h2><button type="button" class="qf-modal-x" data-close aria-label="Close">\\u00d7</button></div>'; }
  function wireClose(){ Array.prototype.forEach.call(modal.querySelectorAll('[data-close]'),function(b){ b.addEventListener('click',closeModal); }); var f=focusables(); if(f.length)f[0].focus(); }
  function msg(text,err){ var m=modal.querySelector('.qf-modal-msg'); if(!m){ m=document.createElement('p'); modal.appendChild(m); } m.hidden=false; m.textContent=text; m.className='qf-modal-msg'+(err?' qf-modal-msg--err':''); }
  function renderEmpty(){
    modal.innerHTML=head('Save carriers to a list')+
      '<p>Pick the carriers you want to keep, then save them all to a list in one step.</p>'+
      '<ol class="qf-modal-steps">'+
        '<li><span class="n">1</span><span>Tick the box on each carrier card you want.</span></li>'+
        '<li><span class="n">2</span><span>Come back here and choose <b>Save selected</b>.</span></li>'+
        '<li><span class="n">3</span><span>Add them to a new list, or one you already have.</span></li>'+
      '</ol>'+
      '<div class="qf-modal-actions"><button type="button" class="btn btn-primary btn-sm" data-close>Got it</button></div>';
    wireClose();
  }
  function renderPicker(dots){
    modal.innerHTML=head('Save '+dots.length+' carrier'+(dots.length===1?'':'s'))+'<p class="qf-modal-msg">Loading your lists…</p>';
    fetch('/api/directory/lists',{headers:{'Accept':'application/json'},credentials:'same-origin'})
      .then(function(r){ return r.json().then(function(j){ return {status:r.status,body:j}; }); })
      .then(function(res){ renderLists(res,dots); })
      .catch(function(){ modal.innerHTML=head('Save carriers')+'<p class="qf-modal-msg qf-modal-msg--err">Could not load your lists. Please try again.</p><div class="qf-modal-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Close</button></div>'; wireClose(); });
  }
  function renderLists(res,dots){
    if(res.status===401){ modal.innerHTML=head('Save carriers')+'<p>Sign in to save carriers to your lists.</p><div class="qf-modal-actions"><a class="btn btn-primary btn-sm" href="/login">Sign in</a><a class="btn btn-secondary btn-sm" href="/signup">Create an account</a></div>'; wireClose(); return; }
    if(res.status===403){ var up=(res.body&&res.body.upgradeUrl)||'/signup'; modal.innerHTML=head('Save carriers with Directory Pro')+'<p>Build named lists of carriers and revisit them anytime — $19/mo.</p><div class="qf-modal-actions"><a class="btn btn-primary btn-sm" href="'+esc(up)+'">Upgrade to Directory Pro</a><button type="button" class="btn btn-secondary btn-sm" data-close>Not now</button></div>'; wireClose(); return; }
    if(!res.body||res.body.ok!==true){ modal.innerHTML=head('Save carriers')+'<p class="qf-modal-msg qf-modal-msg--err">Could not load your lists. Please try again.</p><div class="qf-modal-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Close</button></div>'; wireClose(); return; }
    var lists=res.body.lists||[];
    var listHtml=lists.length?('<div class="qf-modal-lists">'+lists.map(function(l){ return '<button type="button" class="qf-modal-list" data-id="'+esc(l.id)+'"><span>'+esc(l.name)+'</span><span class="n">'+esc(l.count)+'</span></button>'; }).join('')+'</div>'):'<p>You have no lists yet — create one below.</p>';
    modal.innerHTML=head('Save '+dots.length+' carrier'+(dots.length===1?'':'s'))+
      '<p>Add the selected carrier'+(dots.length===1?'':'s')+' to a list.</p>'+
      listHtml+
      '<label class="qf-modal-newlbl" for="qf-modal-newname">New list name</label>'+
      '<div class="qf-modal-new"><input type="text" id="qf-modal-newname" maxlength="80" placeholder="e.g. Savannah drayage" aria-label="New list name"><button type="button" class="btn btn-primary btn-sm" data-create>Create &amp; save</button></div>'+
      '<p class="qf-modal-msg" hidden></p>';
    wireClose();
    Array.prototype.forEach.call(modal.querySelectorAll('.qf-modal-list'),function(b){ b.addEventListener('click',function(){ saveTo(b.getAttribute('data-id'),dots,null); }); });
    var input=modal.querySelector('#qf-modal-newname'); var createBtn=modal.querySelector('[data-create]');
    createBtn.addEventListener('click',function(){ var nm=(input.value||'').trim(); if(!nm){ input.focus(); return; } createBtn.disabled=true; msg('Creating…',false);
      fetch('/api/directory/lists',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:'same-origin',body:JSON.stringify({name:nm})})
        .then(function(r){ return r.json(); })
        .then(function(j){ if(j&&j.ok&&j.list){ saveTo(j.list.id,dots,nm); } else { msg((j&&j.reason==='list-cap')?'You have reached the list limit.':'Could not create the list.',true); createBtn.disabled=false; } })
        .catch(function(){ msg('Could not create the list.',true); createBtn.disabled=false; }); });
    input.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); createBtn.click(); } });
  }
  function saveTo(id,dots,listName){ msg('Saving…',false);
    fetch('/api/directory/lists/'+encodeURIComponent(id)+'/items/batch',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:'same-origin',body:JSON.stringify({carrierDots:dots})})
      .then(function(r){ return r.json().then(function(j){ return {status:r.status,body:j}; }); })
      .then(function(res){ if(res.body&&res.body.ok){ msg('Saved '+dots.length+' carrier'+(dots.length===1?'':'s')+(listName?(' to '+listName):'')+'.',false); } else if(res.status===409){ msg('That list is full.',true); } else { msg('Could not save. Please try again.',true); } })
      .catch(function(){ msg('Could not save. Please try again.',true); }); }
  saveBtn.addEventListener('click',function(e){ e.preventDefault(); var dots=selected(); if(!dots.length){ renderEmpty(); } else { renderPicker(dots); } openModal(); });
})();`;

/**
 * Which of the surfaces sharing this shell actually render FMCSA-sourced carrier
 * data — so the data-source attribution strip appears exactly where it is TRUE
 * and nowhere else. layout() is shared by the carrier directory, /compliance,
 * /drayage-rates, /services and /guides (all FMCSA-backed) AND by /importers and
 * /manifest-privacy, whose data comes from a licensed CBP-manifest provider on a
 * different code path entirely. Naming FMCSA under an importer page would be the
 * same padding-with-untrue-sources mistake the badges exist to avoid, so the
 * strip is gated on the canonical path rather than bolted to the shell.
 */
function rendersCarrierData(canonicalPath: string): boolean {
  return /^\/(directory|compliance|drayage-rates|services|guides)(\/|\?|$)/.test(canonicalPath);
}

/** Test seam for the gate above — footerPayRow.test.ts pins which surfaces may
 *  claim FMCSA as a source and which must not. */
export const rendersCarrierDataForTest = rendersCarrierData;

interface LayoutOpts {
  title: string;
  description: string;
  canonicalPath: string;
  bodyHtml: string;
  /** JSON-LD blocks (already stringified objects) to inject into <head>. */
  jsonLd?: string[];
  /** Paginated-series crawl hints — absolute URLs for the previous/next page in a
   *  paginated listing. Emitted as <link rel="prev">/<link rel="next"> so Google
   *  understands the state/city/port/master listing is a single series. */
  relPrev?: string;
  relNext?: string;
  /** <meta name="robots"> value. Omit for the default (indexable). Set to
   *  'noindex, follow' on pages that must stay out of the index but whose links
   *  should still be crawled — the site-wide 404 body, gated/personal surfaces. */
  robots?: string;
}

export function layout({ title, description, canonicalPath, bodyHtml, jsonLd, relPrev, relNext, robots }: LayoutOpts): string {
  const ld = (jsonLd ?? [])
    .filter(Boolean)
    .map((j) => `<script type="application/ld+json">${j}</script>`)
    .join('\n  ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${esc(canonicalPath)}">
  ${robots ? `<meta name="robots" content="${esc(robots)}">` : ''}
  ${relPrev ? `<link rel="prev" href="${esc(relPrev)}">` : ''}
  ${relNext ? `<link rel="next" href="${esc(relNext)}">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/nav-unify.css">
  <link rel="stylesheet" href="${DIRECTORY_CSS_HREF}">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#0b0f15">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/brand/og-image-1200x630.png">
  ${ld}
</head>
<body>
  <header class="site-header">
    <div class="site-header-inner">
      <a href="/" class="site-brand" aria-label="QuoteFleet home"><span class="site-logo" aria-hidden="true"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>QuoteFleet</a>
      ${SITE_NAV_HTML}
      <div class="site-actions"><span class="nav-shipper" id="nav-shipper"><a class="signin" href="/directory/join">For shippers</a></span>${THEME_TOGGLE_BTN}<a class="btn btn-secondary" href="/signup">Claim your listing<span class="tn-free"> — free</span> <span class="arr">→</span></a>${SITE_BURGER_BTN}</div>
    </div>
    ${SITE_MOBILE_MENU_HTML}
  </header>
  ${bodyHtml}
  <footer class="site-footer">
    © <span id="year"></span> QuoteFleet · <a href="/directory">Directory</a> · <a href="/importers">Importer Search</a> · <a href="/manifest-privacy">Manifest Privacy</a> · <a href="/compliance">Compliance</a> · <a href="/glossary">Glossary</a> · <a href="/guides">Guides</a> · <a href="/drayage-rates">Drayage Rates</a> · <a href="/services">Services</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/">Home</a>
    ${rendersCarrierData(canonicalPath) ? DIRECTORY_DATA_SOURCES : ''}
    ${FOOTER_PAY_ROW}
  </footer>
  ${HEADER_SCRIPTS}
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
  <script src="/directory-tooltip.js" defer></script>
  <script>${NAV_SHIPPER_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Hydrates the "For shippers" nav slot from GET /api/directory/auth/me (soft
 * auth — never 401). Anonymous keeps the static "For shippers" link; a signed-in
 * free shipper gets their email + an Upgrade link; a Directory Pro shipper gets
 * their email + a "Directory Pro ✓" chip + a "Manage" link that opens the Stripe
 * billing portal. Degrades silently on any error (nav stays as server-rendered).
 */
const NAV_SHIPPER_SCRIPT = `
(function(){
  var slot=document.getElementById('nav-shipper'); if(!slot) return;
  var isPro=${DIRECTORY_IS_PRO_JS};
  ${DIRECTORY_ME_PROMISE_JS}
    .then(function(d){
      if(!d||!d.user) return;
      var pro=isPro(d);
      var email=String(d.user.email||'').replace(/[<>&"']/g,'');
      var parts='<span class="nav-email" title="'+email+'">'+email+'</span>';
      if(pro){ parts+='<span class="nav-pro-chip">Directory Pro \\u2713</span><a class="nav-link nav-manage" href="#" data-nav-portal>Manage</a>'; }
      else { parts+='<a class="nav-link nav-upgrade" href="/directory/join?intent=subscribe">Upgrade</a>'; }
      slot.classList.add('nav-shipper--auth');
      slot.innerHTML=parts;
      var p=slot.querySelector('[data-nav-portal]');
      if(p){ p.addEventListener('click',function(e){
        e.preventDefault();
        fetch('/api/directory/billing/portal',{headers:{'Accept':'application/json'},credentials:'same-origin'})
          .then(function(r){return r.json();})
          .then(function(j){ if(j&&j.url) window.location.href=j.url; })
          .catch(function(){});
      }); }
    })
    .catch(function(){});
})();
`.trim();

/**
 * Display name for a carrier: prefer the DBA / trade name, but fall back to the
 * legal name when the DBA is a bare single word too short to identify the
 * carrier on its own (e.g. FMCSA lists "SELECT" for "SELECT WATER SOLUTIONS LLC").
 */
export function carrierName(c: { dbaName?: string | null; legalName: string }): string {
  const dba = (c.dbaName ?? '').trim();
  if (dba && (dba.includes(' ') || dba.length >= 8)) return dba;
  return c.legalName;
}

/**
 * Deterministic 2–3 sentence "About" summary built ONLY from the carrier's own
 * FMCSA facts — no external AI, no invented capabilities. Every clause is
 * omitted when its underlying data is missing, so a sparse record still yields
 * a clean, factual sentence. Plain text (the caller escapes it once).
 */
export function carrierAbout(c: VisibleCarrier): string {
  const name = carrierName(c);
  const isCa = !!(c.state && CA_PROVINCE_CODES.has(c.state));
  const typeWord = c.intermodal ? 'drayage and intermodal carrier' : 'motor carrier';
  // "active" only when FMCSA authority is on file; "an FMCSA" reads correctly.
  const lead = c.authorityType ? 'an active FMCSA-registered' : 'an FMCSA-registered';
  let s1 = `${name} is ${lead} ${typeWord}`;

  const cityDisp = c.city ? titleCaseCity(c.city) : '';
  const stName = (isCa ? null : stateByCode(c.state))?.name ?? c.state ?? '';
  if (cityDisp && c.state) s1 += ` based in ${cityDisp}, ${c.state}`;
  else if (stName) s1 += ` based in ${stName}`;
  else if (cityDisp) s1 += ` based in ${cityDisp}`;

  const puTxt =
    c.powerUnits != null ? `${c.powerUnits.toLocaleString('en-US')} power unit${c.powerUnits === 1 ? '' : 's'}` : '';
  const drTxt = c.drivers != null ? `${c.drivers.toLocaleString('en-US')} driver${c.drivers === 1 ? '' : 's'}` : '';
  const fleet = puTxt && drTxt ? `${puTxt} and ${drTxt}` : puTxt || drTxt;
  const authPhrase = c.authorityType
    ? authorityLabel(c.authorityType).replace(/ authority$/i, '').toLowerCase()
    : '';
  if (fleet) s1 += `, operating ${fleet}`;
  if (authPhrase) s1 += `${fleet ? ' under ' : ' operating under '}${authPhrase} authority`;
  s1 += '.';

  const sr = safetyLabel(c.safetyRating);
  const s2 = sr.tone !== 'none' ? ` Its FMCSA safety rating is ${sr.text}.` : '';

  let s3 = '';
  if (c.intermodal) {
    const p = portByCode(c.nearestPortCode);
    const ports = isCa ? 'North American container ports' : 'US container ports';
    s3 = ` It runs container drayage and intermodal moves, serving shippers at ${ports}${p ? ` such as ${p.name}` : ''}.`;
  }

  return `${s1}${s2}${s3}`.trim();
}

// ─── Carrier card (shared by state + port pages) ──────────────────────────
export function carrierCard(c: VisibleCarrier): string {
  const sr = safetyLabel(c.safetyRating);
  const cityState = [c.city, c.state].filter(Boolean).join(', ');
  const idMeta = [c.usdot ? `USDOT ${esc(c.usdot)}` : '', c.mcNumber ? `MC ${esc(c.mcNumber)}` : '']
    .filter(Boolean)
    .join(' · ');
  // Compliance + capability pills. Safety leads, then hazmat, then the FMCSA
  // equipment/cargo-type flags. Drayage stays the accent pill top-right (out of
  // this row + count). The row is capped so the count-aware grid always
  // partitions cleanly (>=2 per line, never an orphan); any overflow collapses
  // into a "+N more" pill and the full set stays on the profile.
  const cardPills: string[] = [`<span class="pill pill-${sr.tone}">${esc(sr.text)}</span>`];
  if (c.hazmat) cardPills.push('<span class="pill pill-warn">Hazmat</span>');
  const eqDefs: Array<[boolean, string]> = [
    [c.dryVan, 'Dry van'],
    [c.reefer, 'Reefer'],
    [c.tanker, 'Tanker / bulk'],
    [c.flatbed, 'Flatbed'],
    [c.dryBulk, 'Dry bulk'],
  ];
  for (const [on, label] of eqDefs) if (on) cardPills.push(`<span class="pill pill-eq">${esc(label)}</span>`);
  const CARD_MAX = 6; // 6 → clean 3×2 grid; higher counts would strand a pill
  let shown = cardPills;
  if (cardPills.length > CARD_MAX) {
    const hidden = cardPills.length - (CARD_MAX - 1);
    shown = [...cardPills.slice(0, CARD_MAX - 1), `<span class="pill pill-eq">+${hidden} more</span>`];
  }
  return `<a class="carrier-card" href="/directory/carrier/${encodeURIComponent(c.slug)}">
    <div class="top">
      <div>
        <h3>${esc(carrierName(c))}</h3>
        ${carrierName(c) !== c.legalName ? `<div class="carrier-card-legal">Legal name: ${esc(c.legalName)}</div>` : ''}
        <div class="meta">${esc(cityState)}${idMeta ? ' · ' + idMeta : ''}</div>
      </div>
      ${c.intermodal ? '<span class="pill pill-dray">Drayage</span>' : ''}
    </div>
    <div class="carrier-facts">
      <div class="f"><b>${fmtNum(c.powerUnits)}</b><span>Power units</span></div>
      <div class="f"><b>${fmtNum(c.drivers)}</b><span>Drivers</span></div>
      <div class="f"><b>${esc(authorityLabel(c.authorityType).replace(' authority', ''))}</b><span>Authority</span></div>
    </div>
    <div class="card-chips" data-n="${shown.length}">${shown.join('')}</div>
  </a>`;
}

// ─── Directory action-bar (RFQ + Export) link building ────────────────────
/**
 * Build the RFQ + Export action-bar hrefs for a directory selection.
 *
 *   - 0 selected  → act on ALL currently filtered carriers: carry the current
 *     directory FILTER querystring (`filterQuery`, no leading '?').
 *   - ≥1 selected → act on exactly those carriers: `?dots=D1,D2,…`.
 *
 * Pure + exported so the 0-vs-N logic is unit-tested directly. Returns RAW hrefs
 * (callers esc() them before embedding in HTML). Dots take precedence over the
 * filter querystring — mirroring how the RFQ/export routes resolve a selection.
 */
export function actionBarLinks(opts: { filterQuery?: string; dots?: string[] }): {
  rfq: string;
  exportView: string;
  exportXlsx: string;
  exportCsv: string;
} {
  const dots = (opts.dots ?? []).filter((d) => d != null && String(d).trim() !== '');
  const suffix = dots.length
    ? `?dots=${dots.map((d) => encodeURIComponent(String(d))).join(',')}`
    : opts.filterQuery
      ? `?${opts.filterQuery}`
      : '';
  return {
    rfq: `/directory/rfq${suffix}`,
    exportView: `/directory/export/view${suffix}`,
    exportXlsx: `/directory/export.xlsx${suffix}`,
    exportCsv: `/directory/export.csv${suffix}`,
  };
}

// ─── JSON-LD helpers ──────────────────────────────────────────────────────
/** Serialize an object as a JSON-LD-safe string (guards against </script>). */
function ld(obj: unknown): string {
  // Escaping '<' is enough to prevent a </script> breakout inside the block.
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

export interface Crumb {
  name: string;
  path?: string; // omitted on the current (last) crumb
}

function jsonLdBreadcrumb(crumbs: Crumb[]): string {
  return ld({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: SITE + c.path } : {}),
    })),
  });
}

function jsonLdItemListAndCollection(opts: {
  name: string;
  description: string;
  path: string;
  carriers: VisibleCarrier[];
  total: number;
}): string {
  return ld({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: SITE + opts.path,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.total,
      itemListElement: opts.carriers.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/directory/carrier/${encodeURIComponent(c.slug)}`,
        name: carrierName(c),
      })),
    },
  });
}

function jsonLdFaq(faqs: Array<{ q: string; a: string }>): string {
  return ld({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  });
}

function jsonLdCarrier(c: VisibleCarrier): string {
  const addr = {
    '@type': 'PostalAddress',
    // The STORED domicile country, not an assumption. This was hardcoded 'US',
    // which published a wrong country in structured data for every
    // Canada-domiciled carrier the ingest deliberately keeps.
    addressCountry: c.country === 'CA' ? 'CA' : 'US',
    ...(c.city ? { addressLocality: c.city } : {}),
    ...(c.state ? { addressRegion: c.state } : {}),
    ...(c.zip ? { postalCode: c.zip } : {}),
  };
  return ld({
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'Organization'],
    name: carrierName(c),
    legalName: c.legalName,
    url: `${SITE}/directory/carrier/${encodeURIComponent(c.slug)}`,
    identifier: [
      { '@type': 'PropertyValue', propertyID: 'USDOT', value: c.usdot },
      ...(c.mcNumber ? [{ '@type': 'PropertyValue', propertyID: 'MC', value: c.mcNumber }] : []),
    ],
    // Suppress contact fields entirely when the carrier has opted out.
    ...(!c.contactHidden && c.phone ? { telephone: c.phone } : {}),
    ...(!c.contactHidden && c.email ? { email: c.email } : {}),
    address: addr,
    ...(c.city || c.state ? { areaServed: [c.city, c.state].filter(Boolean).join(', ') } : {}),
    knowsAbout: c.intermodal ? ['Container drayage', 'Intermodal trucking'] : ['Freight trucking'],
  });
}

// ─── Faceted directory rendering ──────────────────────────────────────────
interface FacetScope {
  kind: 'all' | 'state' | 'port' | 'city';
  basePath: string;
  locked: Set<string>;
  state?: UsState;
  port?: ContainerPort;
  city?: { name: string; slug: string };
  /**
   * True when this scope has a crawlable PATH form of pagination
   * (`{basePath}/page/N`) in addition to `?page=N`.
   *
   * MEASURED REASON THIS EXISTS: robots.txt line 24 is `Disallow: /*?*page=`,
   * so every `?page=2` link the pager emitted was invisible to Googlebot. Each
   * hub was therefore frozen at its first 24 carriers (DEFAULT_PER_PAGE), and
   * 66.77% of carriers (220,479 of 330,218) live in a city with MORE than 24 —
   * i.e. past page 1, with no crawlable route to them at all. Combined with the
   * city-hub orphaning this left ~91% of carrier profiles unreachable from `/`,
   * which is exactly the "Discovered – currently not indexed / lastCrawl NEVER"
   * state Search Console reports.
   *
   * The path form is offered ONLY for the unfiltered hub series. A FACETED view
   * keeps the query pager: those combinations are a ~1.9e11 URL space that
   * robots.txt blocks on purpose, and minting clean paths for them would undo
   * that. Pagination of a clean hub is a legitimate, bounded, non-duplicate
   * series; faceted pagination is not.
   */
  pagePaths?: boolean;
}

/** True when no facet is active in this scope — i.e. the plain hub listing, the
 *  one series we want crawled. Sort/page are not facets for this purpose: `page`
 *  is handled separately and a non-default `sort` DOES count as a facet. */
function isUnfilteredHub(f: DirectoryFilters, locked: Set<string>): boolean {
  return Object.keys(currentParams(f, locked)).length === 0;
}

/** The clean, crawlable path for page N of an unfiltered hub series. Page 1 is
 *  the bare hub path so the series never has a `/page/1` duplicate. */
export function hubPagePath(basePath: string, page: number): string {
  return page > 1 ? `${basePath}/page/${page}` : basePath;
}

/** Href for page N in this scope: the crawlable path when the hub is unfiltered
 *  and supports it, otherwise the (robots-blocked) query form. */
function pageHref(scope: FacetScope, f: DirectoryFilters, page: number): string {
  if (scope.pagePaths && isUnfilteredHub(f, scope.locked)) return hubPagePath(scope.basePath, page);
  return hrefWith(scope, f, { page: page > 1 ? String(page) : null }, { keepPage: false });
}

/** Active facet dims serialized as query params (respecting path-locked dims). */
function currentParams(f: DirectoryFilters, locked: Set<string>): Record<string, string> {
  const p: Record<string, string> = {};
  if (!locked.has('state') && f.state) p.state = f.state;
  if (!locked.has('port') && f.port) p.port = f.port;
  if (!locked.has('city') && f.citySlug) p.city = f.citySlug;
  if (f.fleet) p.fleet = f.fleet;
  if (f.drivers) p.drivers = f.drivers;
  if (f.goodStandingOnly) p.standing = 'good';
  if (f.authorityActive) p.authority = 'active';
  // Equipment / cargo are MULTI-select → a stable comma-list (canonical option
  // order, set by normalizeFilters). Drayage round-trips as `equipment=drayage`
  // (normalizeFilters still accepts the legacy `intermodal=1` on input).
  if (f.equipment.length) p.equipment = f.equipment.join(',');
  if (f.cargo.length) p.cargo = f.cargo.join(',');
  if (f.recent) p.recent = '1';
  if (f.q) p.q = f.q;
  if (f.sort && f.sort !== 'featured') p.sort = f.sort;
  // `dir` only when it differs from the sort's default → canonical stays minimal.
  if (sortIsDirectional(f.sort) && f.dir !== SORT_DIR_DEFAULTS[f.sort]) p.dir = f.dir;
  return p;
}

/** Filter querystring (no leading '?') reproducing the CURRENTLY DISPLAYED set
 *  for the action bar. Unlike canonicalSuffix it includes path-locked dims
 *  (state/port/city) so an RFQ/export launched from a /directory/texas or a
 *  /directory/port/... page still scopes to that state/port — the routes only
 *  see the querystring, not the URL path. Paging is intentionally dropped. */
function actionBarFilterQuery(f: DirectoryFilters): string {
  return new URLSearchParams(currentParams(f, new Set<string>())).toString();
}

type FacetChange = Partial<
  Record<
    | 'state'
    | 'port'
    | 'city'
    | 'fleet'
    | 'drivers'
    | 'standing'
    | 'authority'
    | 'equipment'
    | 'cargo'
    | 'intermodal'
    | 'recent'
    | 'q'
    | 'sort'
    | 'dir'
    | 'page',
    string | null
  >
>;

/** Toggle one id in a multi-select facet list → the new comma-list for the URL
 *  (canonical order preserved) or null when the toggle empties the facet. */
function toggleMulti<T extends string>(order: ReadonlyArray<T>, current: T[], id: T): string | null {
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  const ordered = order.filter((o) => next.includes(o));
  return ordered.length ? ordered.join(',') : null;
}

/** Remove one id from a multi-select facet list → the new comma-list or null. */
function removeMulti<T extends string>(order: ReadonlyArray<T>, current: T[], id: T): string | null {
  const ordered = order.filter((o) => o !== id && current.includes(o));
  return ordered.length ? ordered.join(',') : null;
}

/** Build an href for the current scope with one dimension changed. */
function hrefWith(scope: FacetScope, f: DirectoryFilters, change: FacetChange, opts?: { keepPage?: boolean }): string {
  const p = currentParams(f, scope.locked);
  if (opts?.keepPage && f.page > 1) p.page = String(f.page);
  for (const [k, v] of Object.entries(change)) {
    if (v == null || v === '') delete p[k];
    else p[k] = v;
  }
  const qs = new URLSearchParams(p).toString();
  return qs ? `${scope.basePath}?${qs}` : scope.basePath;
}

/**
 * One facet row. `count === null` means the count could not be computed for this
 * request (see FacetCounts.unavailable) — the badge is then OMITTED rather than
 * printed as "0". Rendering a fabricated 0 next to a facet that really has
 * thousands of matches is the page asserting something false; an absent badge is
 * simply an absent measurement, and the facet stays clickable either way.
 */
function facetOptionRow(active: boolean, href: string, label: string, count: number | null): string {
  return `<a class="facet-opt ${active ? 'active' : ''}" href="${href}">
    <span class="lbl"><span class="facet-check"></span>${esc(label)}</span>
    ${count == null ? '' : `<span class="cb">${fmtNum(count)}</span>`}
  </a>`;
}

/** Read one facet count, or null when this request's counts are unavailable. */
function facetCount(counts: FacetCounts, value: number | undefined): number | null {
  return counts.unavailable ? null : value ?? 0;
}

function disabledFacetRow(label: string): string {
  return `<span class="facet-opt disabled"><span class="lbl"><span class="facet-check"></span>${esc(label)}</span><span class="cb">claim</span></span>`;
}

/** Carrier-declared (Tier-3) capabilities NOT in FMCSA public data. Rendered as
 *  disabled/"claim" rows, grouped by kind — they drive listing claims, they are
 *  never applied as working filters (we don't assert data we don't have). */
const CARRIER_CAPABILITY_GROUPS: ReadonlyArray<{ label: string; items: string[] }> = [
  // NOTE: "Household goods" + "Liquor" were MOVED OUT of this claim group into the
  // real FMCSA-backed "Cargo specialties" facet group (crgo_household / crgo_beverages,
  // migration 0050) — they are now working filters with live counts. ISO tank / open
  // top / flatrack stay claim-driven (FMCSA doesn't distinguish trailer subtypes).
  { label: 'Equipment specialties', items: ['ISO tank', 'Open top', 'Flatrack', 'Overweight', 'Tank-endorsed'] },
  { label: 'Services', items: ['Transload', 'Warehouse', 'Container storage'] },
  { label: 'Cargo', items: ['Customs-bonded'] },
  { label: 'Retail / partner programs', items: ['Menards-approved', 'Amazon warehouse delivery'] },
];

/** The full "Carrier capabilities" rail block — a visually-secondary Tier-3
 *  section of claim-driven options with per-kind sub-labels + a claim CTA. */
function capabilitiesGroup(): string {
  const blocks = CARRIER_CAPABILITY_GROUPS.map(
    (g) => `<div class="cap-sub"><span class="cap-sublabel">${esc(g.label)}</span>${g.items.map(disabledFacetRow).join('\n')}</div>`,
  ).join('\n');
  return facetGroup(
    'Carrier capabilities',
    `<span class="facet-src">Carrier-verified — shown as carriers claim their profiles.</span>
    ${blocks}
    <a class="cap-claim-cta" href="/signup">Claim a listing to verify these →</a>`,
    'facet-group--claim',
  );
}

/** One row inside the ports/terminals picker (data-pk drives the client filter). */
function portPickerRow(scope: FacetScope, f: DirectoryFilters, counts: FacetCounts, g: (typeof PORT_GROUPS)[number]): string {
  const active = f.port === g.code;
  const href = hrefWith(scope, f, { port: active ? null : g.code });
  const search = `${g.label} ${g.city} ${g.state}`.toLowerCase();
  return `<a class="facet-opt${active ? ' active' : ''}" href="${href}" data-pk="${esc(search)}">
    <span class="lbl"><span class="facet-check"></span>${esc(g.label)}</span>
    ${counts.unavailable ? '' : `<span class="cb">${fmtNum(counts.ports[g.code] ?? 0)}</span>`}
  </a>`;
}

/**
 * The combined "Ports & terminals" unfolding picker — ONE list (seaports AND
 * inland rail ramps together, deduped via the canonical PORT_GROUPS set), split
 * only into United States / Canada sections, with a client-side free-text filter
 * at the top. Co-located ports show as one "/" hub. No-JS: the <details> still
 * unfolds natively and the full list is present; the search input is simply inert.
 */
function portsPickerGroup(scope: FacetScope, f: DirectoryFilters, counts: FacetCounts): string {
  const section = (country: 'US' | 'CA', heading: string): string => {
    const rows = PORT_GROUPS.filter((g) => g.country === country)
      .map((g) => portPickerRow(scope, f, counts, g))
      .join('\n');
    if (!rows) return '';
    return `<div class="pp-country" data-country="${country}"><h4 class="pp-country-h">${esc(heading)}</h4>${rows}</div>`;
  };
  return `<details class="facet-group port-picker" id="port-picker"${f.port ? ' open' : ''}>
    <summary class="port-picker-sum">
      <span class="pp-title">Ports &amp; terminals</span>
      <span class="pp-hint">seaports + rail ramps</span>
    </summary>
    <div class="port-picker-body">
      <div class="pp-search">
        <label class="pp-search-lbl" for="port-search">Search ports &amp; terminals</label>
        <input type="search" id="port-search" class="pp-search-input" placeholder="Search by name, city or state…" autocomplete="off" aria-controls="port-picker-list">
      </div>
      <div id="port-picker-list" class="pp-list">
        ${section('US', 'United States')}
        ${section('CA', 'Canada')}
        <div class="pp-empty" hidden>No ports or terminals match your search.</div>
      </div>
    </div>
  </details>
  <script>
    (function(){
      var inp=document.getElementById('port-search'),list=document.getElementById('port-picker-list');
      if(!inp||!list)return;
      var rows=list.querySelectorAll('.facet-opt'),countries=list.querySelectorAll('.pp-country'),empty=list.querySelector('.pp-empty');
      inp.addEventListener('input',function(){
        var q=inp.value.trim().toLowerCase(),any=false;
        rows.forEach(function(r){var m=!q||(r.getAttribute('data-pk')||'').indexOf(q)!==-1;r.hidden=!m;if(m)any=true;});
        countries.forEach(function(c){c.hidden=c.querySelectorAll('.facet-opt:not([hidden])').length===0;});
        if(empty)empty.hidden=any;
      });
    })();
  </script>`;
}

/** D4 — progressive-enhancement fold for a long facet option list. EVERY row
 *  renders (crawlable + works with no JS); the first `visible` stay in view and
 *  the overflow goes inside a collapsible region that FOLD_SCRIPT collapses on
 *  load and toggles via the revealed "Show N more / Show less" button. `id` links
 *  the button to the region (aria-controls). Below the threshold → a plain list. */
function foldableRows(rows: string[], visible: number, id: string): string {
  if (rows.length <= visible) return rows.join('\n');
  const head = rows.slice(0, visible).join('\n');
  const rest = rows.slice(visible);
  return `${head}
    <div class="facet-fold" id="${esc(id)}" data-fold><div class="facet-fold-inner">${rest.join('\n')}</div></div>
    <button type="button" class="facet-more" data-fold-toggle aria-controls="${esc(id)}" aria-expanded="true" data-more="${rest.length}" hidden><span class="facet-more-txt">Show ${rest.length} more</span><span class="facet-more-ico" aria-hidden="true">▾</span></button>`;
}

/** Collapses each [data-fold] region on load and wires its sibling toggle. Runs
 *  once (idempotent). Reduced-motion is handled purely in CSS. */
const FOLD_SCRIPT = `(function(){
  if(window.__qfFoldBound)return; window.__qfFoldBound=true;
  var folds=document.querySelectorAll('[data-fold]');
  Array.prototype.forEach.call(folds,function(fold){
    var parent=fold.parentNode; if(!parent)return;
    var btn=parent.querySelector('[data-fold-toggle][aria-controls="'+fold.id+'"]')||parent.querySelector('[data-fold-toggle]');
    if(!btn||btn.__foldBound)return; btn.__foldBound=1;
    var more=btn.getAttribute('data-more')||''; var txt=btn.querySelector('.facet-more-txt');
    function set(open){ fold.setAttribute('data-collapsed',open?'0':'1'); btn.setAttribute('aria-expanded',open?'true':'false'); if(txt)txt.textContent=open?'Show less':('Show '+more+' more'); }
    set(false); btn.hidden=false;
    btn.addEventListener('click',function(){ set(fold.getAttribute('data-collapsed')==='1'); });
  });
})();`;

/** Collapses every facet-group into an accordion on load: the <h3> header toggles
 *  its body open/closed. Rendered OPEN (no-JS + crawlers see every facet link);
 *  this folds them all on load so the rail is compact and the results lead (Alex:
 *  "each category for filters must be folded by default"). Height animates via the
 *  same grid-rows 0fr↔1fr pattern as the D4 fold, reduced-motion guarded in CSS. */
const ACCORDION_SCRIPT = `(function(){
  if(window.__qfAccBound)return; window.__qfAccBound=true;
  var groups=document.querySelectorAll('.facet-group[data-acc]');
  Array.prototype.forEach.call(groups,function(g){
    var btn=g.querySelector('.facet-acc-btn'); var body=g.querySelector('[data-acc-body]');
    if(!btn||!body||btn.__accBound)return; btn.__accBound=1;
    function set(o){ g.setAttribute('data-acc',o?'open':'closed'); btn.setAttribute('aria-expanded',o?'true':'false'); }
    set(false);
    btn.addEventListener('click',function(){ set(g.getAttribute('data-acc')!=='open'); });
  });
})();`;

/** One collapsible facet category. Header is a heading-wrapped button (a11y: a
 *  heading containing the disclosure control); the body holds the source label +
 *  option rows and folds under the accordion. `data-acc` marks it for the script. */
function facetGroup(title: string, inner: string, extraClass = ''): string {
  const cls = 'facet-group' + (extraClass ? ' ' + extraClass : '');
  return `<div class="${cls}" data-acc>
    <h3 class="facet-acc-h"><button type="button" class="facet-acc-btn" aria-expanded="true"><span class="facet-acc-ttl">${title}</span><span class="facet-acc-ico" aria-hidden="true">▾</span></button></h3>
    <div class="facet-acc-body" data-acc-body><div class="facet-acc-inner">${inner}</div></div>
  </div>`;
}

function renderSidebar(scope: FacetScope, f: DirectoryFilters, counts: FacetCounts, summary?: DirectorySummary): string {
  // Tier 1 — Equipment & cargo (FMCSA crgo_* columns; MULTI-select checkboxes,
  // OR within the facet). Each row toggles its id in/out of the comma-list.
  const eqOrder = EQUIPMENT_OPTIONS.map((o) => o.id);
  const equipment = EQUIPMENT_OPTIONS.map((o) =>
    facetOptionRow(
      f.equipment.includes(o.id),
      hrefWith(scope, f, { equipment: toggleMulti(eqOrder, f.equipment, o.id) }),
      o.label,
      facetCount(counts, counts.equipment[o.id]),
    ),
  ).join('\n');

  // Tier 1 — Cargo specialties (FMCSA crgo_* columns; MULTI-select checkboxes,
  // OR within the facet, orthogonal to equipment via the separate `cargo` param).
  const cargoOrder = CARGO_OPTIONS.map((o) => o.id);
  // 13 cargo specialties clutter the rail — keep the first 6 visible and fold the
  // rest under "Show more" (all still render for no-JS / crawlers).
  const cargoRows = CARGO_OPTIONS.map((o) =>
    facetOptionRow(
      f.cargo.includes(o.id),
      hrefWith(scope, f, { cargo: toggleMulti(cargoOrder, f.cargo, o.id) }),
      o.label,
      facetCount(counts, counts.cargo[o.id]),
    ),
  );
  const cargo = foldableRows(cargoRows, 6, 'fold-cargo');

  // Tier 1 — Fleet size (trucks / power units).
  const fleet = FLEET_BUCKETS.map((b) =>
    facetOptionRow(f.fleet === b.id, hrefWith(scope, f, { fleet: f.fleet === b.id ? null : b.id }), b.label, facetCount(counts, counts.fleet[b.id])),
  ).join('\n');

  // Tier 1 — Drivers count.
  const drivers = DRIVERS_BUCKETS.map((b) =>
    facetOptionRow(
      f.drivers === b.id,
      hrefWith(scope, f, { drivers: f.drivers === b.id ? null : b.id }),
      b.label,
      facetCount(counts, counts.drivers[b.id]),
    ),
  ).join('\n');

  // Tier 1 — Safety: ONE "good standing" toggle. Excludes Conditional +
  // Unsatisfactory; keeps Satisfactory + Not-rated (most carriers are unrated,
  // so the useful filter is dropping the known-bad, not a satisfactory-only one).
  const goodStanding = facetOptionRow(
    f.goodStandingOnly,
    hrefWith(scope, f, { standing: f.goodStandingOnly ? null : 'good' }),
    'Good standing only',
    facetCount(counts, counts.goodStanding),
  );

  // Tier 1/2 — Active authority + recently-updated (status/activity).
  const authority = facetOptionRow(
    f.authorityActive,
    hrefWith(scope, f, { authority: f.authorityActive ? null : 'active' }),
    'Active authority only',
    facetCount(counts, counts.authorityActive),
  );
  const recent = facetOptionRow(
    f.recent,
    hrefWith(scope, f, { recent: f.recent ? null : '1' }),
    'Updated in last 12 mo',
    facetCount(counts, counts.recent),
  );

  // 'all' scope only — quick state refine (links to canonical state pages / scope).
  let stateGroup = '';
  if (scope.kind === 'all' && summary) {
    const top = summary.byState.filter((s) => US_STATE_CODES.has(s.state)).slice(0, 12);
    if (top.length) {
      const stateRows = top.map((s) => {
        const st = stateByCode(s.state)!;
        const active = f.state === s.state;
        return `<a class="facet-opt ${active ? 'active' : ''}" href="${hrefWith(scope, f, { state: active ? null : s.state })}">
            <span class="lbl"><span class="facet-check"></span>${esc(st.name)}</span>
            <span class="cb">${fmtNum(s.count)}</span>
          </a>`;
      });
      // Up to 12 states — keep the top 6 visible, fold the rest.
      const links = foldableRows(stateRows, 6, 'fold-state');
      stateGroup = facetGroup(
        'State',
        `<span class="facet-src">FMCSA physical state · top 12</span>${links}
        <a class="facet-opt" href="/directory" style="justify-content:center;"><span class="lbl">All states &amp; ports →</span></a>`,
      );
    }
  }

  // Ports & terminals picker — only where port isn't the page's locked subject
  // (i.e. everywhere except the dedicated /directory/port/:port page).
  const portsGroup = scope.locked.has('port') ? '' : portsPickerGroup(scope, f, counts);

  // NOTE: the mobile "Filters" toggle button now lives in the results toolbar
  // (co-located with sort — D1); it still drives this rail by id (#rail-toggle).
  return `<aside class="dir-rail" id="dir-rail">
    ${stateGroup}
    ${portsGroup}
    ${facetGroup('Equipment &amp; cargo', `<span class="facet-src">FMCSA cargo-type flags</span>${equipment}`)}
    ${facetGroup('Cargo specialties', `<span class="facet-src">FMCSA cargo-class flags</span>${cargo}`)}
    ${facetGroup('Fleet size', `<span class="facet-src">FMCSA power units (trucks)</span>${fleet}`)}
    ${facetGroup('Drivers', `<span class="facet-src">FMCSA total drivers</span>${drivers}`)}
    ${facetGroup('Safety', `<span class="facet-src">FMCSA safety rating</span>${goodStanding}`)}
    ${facetGroup('Authority &amp; activity', `<span class="facet-src">FMCSA authority &amp; MCS-150</span>${authority}${recent}`)}
    ${capabilitiesGroup()}
  </aside>
  <script>
    (function(){
      // #rail-toggle lives in the results toolbar, which is parsed AFTER this
      // sidebar — so defer wiring until DOMContentLoaded, else getElementById
      // returns null and the rail never collapses on mobile (the bug Alex saw:
      // every facet group sat expanded at the top of the phone screen).
      function init(){
        var t=document.getElementById('rail-toggle'),r=document.getElementById('dir-rail');
        if(!t||!r)return;
        function apply(){var c=window.matchMedia('(max-width:900px)').matches;if(c){r.setAttribute('data-collapsed','1');t.setAttribute('aria-expanded','false');t.textContent='Filters ▾';}else{r.removeAttribute('data-collapsed');t.setAttribute('aria-expanded','true');}}
        apply();
        t.addEventListener('click',function(){var c=r.getAttribute('data-collapsed')==='1';if(c){r.removeAttribute('data-collapsed');t.setAttribute('aria-expanded','true');t.textContent='Filters ▴';}else{r.setAttribute('data-collapsed','1');t.setAttribute('aria-expanded','false');t.textContent='Filters ▾';}});
      }
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
    })();
  </script>
  <script>${FOLD_SCRIPT}</script>
  <script>${ACCORDION_SCRIPT}</script>`;
}

function appliedChips(scope: FacetScope, f: DirectoryFilters): string {
  const chips: string[] = [];
  const add = (label: string, change: FacetChange) =>
    chips.push(`<a class="applied-chip" href="${hrefWith(scope, f, change)}">${esc(label)} <span class="x">✕</span></a>`);
  if (f.q) add(`Name: “${f.q}”`, { q: null });
  if (!scope.locked.has('state') && f.state) add(stateByCode(f.state)?.name ?? f.state, { state: null });
  if (!scope.locked.has('port') && f.port) {
    const g = PORT_GROUPS.find((x) => x.code === f.port) ?? portGroupForMemberCode(f.port);
    add(g?.label ?? f.port, { port: null });
  }
  if (!scope.locked.has('city') && f.citySlug) add(f.citySlug.replace(/-/g, ' '), { city: null });
  // One removable chip per selected equipment / cargo value — removing one leaves
  // the rest in the URL (removeMulti rebuilds the comma-list minus that id).
  const eqOrder = EQUIPMENT_OPTIONS.map((e) => e.id);
  for (const id of f.equipment) {
    add(EQUIPMENT_OPTIONS.find((e) => e.id === id)?.label ?? id, { equipment: removeMulti(eqOrder, f.equipment, id) });
  }
  const cargoOrder = CARGO_OPTIONS.map((c) => c.id);
  for (const id of f.cargo) {
    add(CARGO_OPTIONS.find((c) => c.id === id)?.label ?? id, { cargo: removeMulti(cargoOrder, f.cargo, id) });
  }
  if (f.fleet) add(FLEET_BUCKETS.find((b) => b.id === f.fleet)?.label ?? f.fleet, { fleet: null });
  if (f.drivers) add(DRIVERS_BUCKETS.find((b) => b.id === f.drivers)?.label ?? f.drivers, { drivers: null });
  if (f.goodStandingOnly) add('Good standing', { standing: null });
  if (f.authorityActive) add('Active authority', { authority: null });
  if (f.recent) add('Updated ≤12 mo', { recent: null });
  if (!chips.length) return '';
  return `<div class="applied-chips">${chips.join('\n')}<a class="applied-clear" href="${scope.basePath}">Clear all</a></div>`;
}

/** Direction-toggle label pair per sort — asc-label / desc-label — so the arrow
 *  control reads naturally for each dimension (numeric vs recency vs safety). */
function dirLabels(sort: SortId): { asc: string; desc: string } {
  switch (sort) {
    case 'recent':
      return { asc: 'Oldest first', desc: 'Newest first' };
    case 'safety':
      return { asc: 'Best first', desc: 'Worst first' };
    default: // fleet / drivers (numeric)
      return { asc: 'Low → High', desc: 'High → Low' };
  }
}

/**
 * Squared asc/desc direction toggle shown next to the sort <select> for the
 * directional (numeric / recency / safety) sorts. It's an anchor (keyboard-
 * accessible, crawlable, works with no JS) whose href flips `dir`; the URL only
 * carries `dir` when it differs from the sort's default so canonical stays clean.
 * `featured` has no direction → the control is omitted entirely.
 */
function dirControl(scope: FacetScope, f: DirectoryFilters): string {
  if (!sortIsDirectional(f.sort)) return '';
  const labels = dirLabels(f.sort);
  const cur: SortDir = f.dir;
  const next: SortDir = cur === 'asc' ? 'desc' : 'asc';
  const curLabel = cur === 'asc' ? labels.asc : labels.desc;
  const nextLabel = next === 'asc' ? labels.asc : labels.desc;
  // Minimal canonical: drop `dir` when the flip lands back on the sort default.
  const change: FacetChange = { dir: next === SORT_DIR_DEFAULTS[f.sort] ? null : next };
  const href = hrefWith(scope, f, change);
  const arrow = cur === 'asc' ? '▲' : '▼';
  return `<a class="sort-dir" href="${href}" role="button"
    aria-label="Sort direction: ${esc(curLabel)}. Activate to sort ${esc(nextLabel)}."
    title="${esc(curLabel)} — switch to ${esc(nextLabel)}">
    <span class="sort-dir-ico" aria-hidden="true">${arrow}</span>
    <span class="sort-dir-txt">${esc(curLabel)}</span>
  </a>`;
}

/**
 * Compact sort control — a native <select> for the sort key plus a squared
 * asc/desc direction toggle (numeric sorts go Low→High or High→Low). Each option's
 * value is the destination href; a tiny bound script navigates on change. Changing
 * the sort key resets `dir` to that sort's default (dir:null drops the param).
 * No-JS users still get a labelled, focusable control + crawlable links.
 */
function sortRow(scope: FacetScope, f: DirectoryFilters): string {
  const opts = SORT_OPTIONS.map((s) => {
    const href = hrefWith(scope, f, { sort: s.id === 'featured' ? null : s.id, dir: null });
    return `<option value="${esc(href)}"${f.sort === s.id ? ' selected' : ''}>${esc(s.label)}</option>`;
  }).join('');
  const crawlLinks = SORT_OPTIONS.map(
    (s) => `<a href="${hrefWith(scope, f, { sort: s.id === 'featured' ? null : s.id, dir: null })}">${esc(s.label)}</a>`,
  ).join('');
  return `<div class="sort-ctl">
    <label class="sort-lbl" for="dir-sort">Sort</label>
    <span class="sort-select">
      <select id="dir-sort" aria-label="Sort carriers" data-sort-nav>${opts}</select>
    </span>
    ${dirControl(scope, f)}
    <noscript><span class="sort-noscript">${crawlLinks}</span></noscript>
  </div>
  <script>(function(){var s=document.getElementById('dir-sort');if(s)s.addEventListener('change',function(){if(this.value)window.location.href=this.value;});})();</script>`;
}

/** Windowed numbered pagination (1 … n-1 [n] n+1 … last). */
function numberedPager(scope: FacetScope, f: DirectoryFilters, list: CarrierListResult): string {
  if (list.totalPages <= 1) return '';
  const cur = list.page;
  const last = list.totalPages;
  const link = (p: number, label?: string, cls = '') =>
    `<a class="${cls}" href="${esc(pageHref(scope, f, p))}">${esc(label ?? String(p))}</a>`;
  const nums: Array<number | '…'> = [];
  const push = (p: number) => nums.push(p);
  push(1);
  const lo = Math.max(2, cur - 2);
  const hi = Math.min(last - 1, cur + 2);
  if (lo > 2) nums.push('…');
  for (let p = lo; p <= hi; p++) push(p);
  if (hi < last - 1) nums.push('…');
  if (last > 1) push(last);
  const body = nums
    .map((n) => (n === '…' ? '<span class="gap">…</span>' : n === cur ? `<span class="cur">${n}</span>` : link(n)))
    .join('\n');

  /**
   * DEPTH JUMPS — every 10th page, on long UNFILTERED hub series only.
   *
   * The window above is ±2 pages, so on Houston's 146-page city hub, page 73 sat
   * ~18 link hops from page 1. Crawlers discount pages by depth, and a 146-page
   * chain is exactly the shape that never gets walked to the end — the same
   * class of defect as the orphaned city hubs this work exists to fix.
   *
   * Linking every 10th page bounds the whole series at TWO hops from page 1
   * (page 1 → nearest decade anchor → any page within 5 of it), for ~15 extra
   * links on the largest hub in prod. Restricted to the path-paginated
   * unfiltered series so this never mints jump links into the robots-blocked
   * facet space.
   */
  const jumps =
    scope.pagePaths && isUnfilteredHub(f, scope.locked) && last > 12
      ? (() => {
          const decades: number[] = [];
          for (let p = 10; p < last; p += 10) if (Math.abs(p - cur) > 2) decades.push(p);
          return decades.length
            ? `<nav class="dir-pagejumps" aria-label="Jump to page">
                <span class="muted-small">Jump to</span>
                ${decades.map((p) => link(p)).join('\n')}
              </nav>`
            : '';
        })()
      : '';

  return `<nav class="dir-pagenums" aria-label="Pagination">
    ${cur > 1 ? link(cur - 1, '← Prev') : ''}
    ${body}
    ${cur < last ? link(cur + 1, 'Next →') : ''}
  </nav>${jumps}`;
}

function crumbsHtml(crumbs: Crumb[]): string {
  return `<nav class="dir-crumbs" aria-label="Breadcrumb">${crumbs
    .map((c, i) =>
      i === crumbs.length - 1
        ? `<span class="cur">${esc(c.name)}</span>`
        : `<a href="${esc(c.path ?? '/directory')}">${esc(c.name)}</a><span class="sep">/</span>`,
    )
    .join('')}</nav>`;
}

interface FacetedCfg {
  scope: FacetScope;
  list: CarrierListResult;
  counts: FacetCounts;
  filters: DirectoryFilters;
  crumbs: Crumb[];
  h1: string;
  intro: string;
  title: string;
  description: string;
  canonicalPath: string;
  summary?: DirectorySummary;
  extraModulesHtml?: string;
  faqsHtml?: string;
  jsonLd: string[];
  /** Faceted master-search view (/directory?…): drop the hero H1 + intro (the
   *  shipper already knows what the directory is) and keep only the breadcrumb +
   *  the result count. SEO pages (state/city/port) leave this false → keep their
   *  hero H1/intro, which they need for indexing. */
  hideHero?: boolean;
}

/** A carrier card with a top-right selection checkbox (sibling of the card link
 *  so ticking it never navigates). data-dot carries the USDOT for the client
 *  progressive-enhancement script. */
function selectableCard(c: VisibleCarrier): string {
  const name = carrierName(c);
  // The checkbox <label> is a large (≥44px) tap target stacked ABOVE the card
  // link (z-index) with a click handler that stops propagation, so a tap toggles
  // selection and never opens the profile — even on mobile where a fat-finger tap
  // used to land on the underlying card <a>. A visible chip + "Select" caption
  // make it read as a selection control (see .cc-check styles + the grid legend).
  // Save is NO LONGER per-card (it was redundant above+below every card). The
  // checkbox selects carriers; Save lives once in the bottom action bar
  // ("Save selected (N)"). Single-carrier save stays on the carrier PROFILE page.
  return `<div class="cc-sel"><label class="cc-check" title="Select ${esc(name)} — tick to save, request rates or export" onclick="event.stopPropagation()"><span class="cc-box"><input type="checkbox" class="cc-cb" data-dot="${esc(c.usdot)}" aria-label="Select ${esc(name)} to save, request rates or export" onclick="event.stopPropagation()"></span></label>${carrierCard(c)}</div>`;
}

/** Free-text carrier-name search box shown above the results bar. A plain GET
 *  form → `scope.basePath?q=…`, carrying every OTHER active filter as hidden
 *  inputs so a search AND-combines with the current facets (page is dropped so a
 *  new search lands on page 1). Works with no JS; `q` is fully shareable/crawlable. */
function nameSearchBox(scope: FacetScope, f: DirectoryFilters): string {
  const carried = currentParams(f, scope.locked);
  delete carried.q; // the visible input owns `q`
  const hidden = Object.entries(carried)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  const val = f.q ? ` value="${esc(f.q)}"` : '';
  return `<form class="dir-search" role="search" method="get" action="${esc(scope.basePath)}" aria-label="Search carriers by company name">
    ${hidden}
    <label class="dir-search-lbl" for="dir-q">Search by company name</label>
    <div class="dir-search-row">
      <input type="search" id="dir-q" name="q" class="dir-search-input"${val}
        placeholder="e.g. Harbor Link Logistics" minlength="2" maxlength="100"
        autocomplete="off" enterkeyhint="search" aria-describedby="dir-search-hint">
      <button type="submit" class="btn btn-primary btn-sm dir-search-btn">Search</button>
    </div>
    <span class="dir-search-hint" id="dir-search-hint">Matches legal or DBA name. Combine with the filters at left.</span>
  </form>`;
}

function renderFacetedResults(cfg: FacetedCfg): string {
  const { scope, list, counts, filters } = cfg;
  const hasCarriers = list.carriers.length > 0;
  const cards = hasCarriers
    ? `<p class="cc-legend"><span class="cc-legend-box" aria-hidden="true"></span> Tick a card's box to save, request rates from, or export specific carriers. The bar below acts on all matches when nothing is ticked.</p>
      <div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">${list.carriers
        .map(selectableCard)
        .join('\n')}</div>`
    : `<div class="dir-empty">No carriers match these filters. <a href="${scope.basePath}" style="color:var(--accent);">Clear filters</a> to see all.</div>`;

  // Action bar: no-JS fallback links act on ALL filtered carriers (the filter
  // querystring); the enhancement script below swaps to ?dots= when ≥1 card is
  // ticked. Only rendered when there is at least one carrier to act on.
  const total = list.total;
  const plural = total === 1 ? '' : 's';
  // The RFQ send flow caps recipients at rfqRecipientCap() (default 25). When the
  // filtered set is larger, the button must show what actually gets emailed
  // ("Request rates from 25 of N carriers") rather than over-promising the full N.
  const rfqCap = rfqRecipientCap();
  const rfqShown = total > rfqCap ? rfqCap : total;
  const rfqPlural = rfqShown === 1 ? '' : 's';
  const rfqOf = total > rfqCap ? ` of ${fmtNum(total)}` : '';
  const filterQs = actionBarFilterQuery(filters);
  const links0 = actionBarLinks({ filterQuery: filterQs });
  const actionBar = hasCarriers
    ? `<div class="qf-actionbar" data-mode="filter" data-filter-qs="${esc(filterQs)}" data-total="${total}" data-rfq-cap="${rfqCap}" role="region" aria-label="Carrier actions">
        <div class="qf-ab-info">
          <span class="qf-ab-count" data-selected="0"><b class="qf-ab-n">${fmtNum(total)}</b> <span class="qf-ab-lbl">carrier${plural} filtered</span></span>
          <span class="qf-ab-hint">Tick cards to target specific carriers</span>
        </div>
        <div class="qf-ab-actions">
          <a class="btn btn-primary btn-sm qf-ab-btn qf-ab-rfq" data-role="rfq" href="${esc(links0.rfq)}">Request rates<span class="qf-ab-rfqfull"> from</span> <span class="qf-ab-rfqpar">(</span><span class="qf-ab-rfqn">${fmtNum(rfqShown)}</span><span class="qf-ab-rfqof">${rfqOf}</span><span class="qf-ab-rfqw">&nbsp;carrier${rfqPlural}</span><span class="qf-ab-rfqpar">)</span> <span class="arr">→</span></a>
          <button type="button" class="btn btn-secondary btn-sm qf-ab-btn qf-ab-save" data-role="save-selected" data-count="0" aria-haspopup="dialog">Save<span class="qf-ab-savefull"> selected</span><span class="qf-ab-saven"> (0)</span></button>
          <a class="btn btn-secondary btn-sm qf-ab-btn" data-role="export-view" href="${esc(links0.exportView)}">Export<span class="qf-ab-exportfull"> list</span></a>
          <span class="qf-ab-fmts"><a class="qf-ab-fmt" data-role="export-xlsx" href="${esc(links0.exportXlsx)}">XLSX</a><a class="qf-ab-fmt" data-role="export-csv" href="${esc(links0.exportCsv)}">CSV</a></span>
        </div>
      </div>
      <script>${ACTION_BAR_SCRIPT}</script>
      <script>${SAVE_SELECTED_SCRIPT}</script>`
    : '';

  // Results view: breadcrumb-only slim header, no hero. SEO pages: full hero.
  const heroHtml = cfg.hideHero
    ? `<div class="dir-shell dir-crumbbar">${crumbsHtml(cfg.crumbs)}</div>`
    : `<section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml(cfg.crumbs)}
      <h1 style="margin-top: 6px;">${esc(cfg.h1)}</h1>
      <p class="lead">${cfg.intro}</p>
    </div>
  </section>`;

  const body = `
  ${heroHtml}
  <main class="dir-shell${cfg.hideHero ? ' dir-shell--tight' : ''}">
    <div class="dir-layout">
      ${renderSidebar(scope, filters, counts, cfg.summary)}
      <div class="dir-results">
        ${nameSearchBox(scope, filters)}
        <div class="results-toolbar" role="group" aria-label="Filter and sort controls">
          <div class="rt-main">
            <button type="button" class="rail-toggle" id="rail-toggle" aria-expanded="true" aria-controls="dir-rail">Filters ▾</button>
            <div class="rc"><b>${fmtNum(list.total)}</b> carrier${list.total === 1 ? '' : 's'} match${counts.intermodal ? ` · ${fmtNum(counts.intermodal)} run drayage` : ''}</div>
            ${sortRow(scope, filters)}
          </div>
          ${appliedChips(scope, filters)}
        </div>
        ${cards}
        ${numberedPager(scope, filters, list)}
        ${cfg.extraModulesHtml ?? ''}
        ${actionBar}
      </div>
    </div>
    ${cfg.faqsHtml ?? ''}
    <p class="muted-small" style="margin: 24px 0 0; max-width: 760px;">Carrier information is sourced from public FMCSA records and shown so shippers can contact carriers directly. Carriers: email us to update or hide your details.</p>
  </main>`;

  const { relPrev, relNext } = paginationRelLinks(scope, filters, list);
  return layout({
    title: cfg.title,
    description: cfg.description,
    canonicalPath: cfg.canonicalPath,
    bodyHtml: body,
    jsonLd: cfg.jsonLd,
    relPrev,
    relNext,
  });
}

/** Absolute prev/next URLs for the paginated series (rel=prev/rel=next crawl
 *  hints), built with the SAME pageHref used by the visible pager so they always
 *  agree — including the clean `/page/N` path form on an unfiltered hub, where
 *  the old `?page=N` target was one robots.txt disallowed and could never fetch.
 *  Empty when there is no prev/next page. */
function paginationRelLinks(
  scope: FacetScope,
  f: DirectoryFilters,
  list: CarrierListResult,
): { relPrev?: string; relNext?: string } {
  const out: { relPrev?: string; relNext?: string } = {};
  if (list.totalPages <= 1) return out;
  if (list.page > 1) out.relPrev = `${SITE}${pageHref(scope, f, list.page - 1)}`;
  if (list.page < list.totalPages) out.relNext = `${SITE}${pageHref(scope, f, list.page + 1)}`;
  return out;
}

/** Canonical query suffix for a faceted URL (stable key order, no page dup). */
function canonicalSuffix(f: DirectoryFilters, locked: Set<string>): string {
  const p = currentParams(f, locked);
  if (f.page > 1) p.page = String(f.page);
  const qs = new URLSearchParams(p).toString();
  return qs ? `?${qs}` : '';
}

/**
 * The canonical URL path for a hub listing.
 *
 * On an UNFILTERED hub that has the crawlable path pager, page N canonicalises
 * to `{basePath}/page/N` — the URL the pager, rel=prev/next and the sitemap all
 * point at. Emitting the `?page=N` form here instead would have every crawlable
 * page of the series declare a robots.txt-disallowed URL as its canonical, which
 * is a page asking not to be indexed under the only address Google can reach it
 * by. Everything else (any facet active) keeps the existing query-string
 * canonical, unchanged.
 */
function hubCanonicalPath(scope: FacetScope, f: DirectoryFilters): string {
  if (scope.pagePaths && isUnfilteredHub(f, scope.locked)) return hubPagePath(scope.basePath, f.page);
  return `${scope.basePath}${canonicalSuffix(f, scope.locked)}`;
}

// ─── 1. Directory landing ─────────────────────────────────────────────────
// ─── Shipper join / Directory Pro checkout (/directory/join) ──────────────
/**
 * Progressive-enhancement for /directory/join.
 *   • The email form POSTs to /api/directory/auth/signup. A NEW email logs the
 *     shipper in immediately (session cookie); an EXISTING email gets a magic
 *     link ("check your email"). With intent=subscribe, a fresh account is sent
 *     straight to Stripe Checkout.
 *   • The Subscribe button (signed-in free) POSTs /api/directory/billing/checkout
 *     and redirects to the returned hosted-checkout URL.
 *   • The Manage button (Pro) GETs /api/directory/billing/portal and redirects.
 * Buttons need JS; the email form still POSTs without it (endpoint returns JSON).
 */
const JOIN_SCRIPT = `
(function(){
  var root=document.querySelector('[data-join]'); if(!root) return;
  var intent=root.getAttribute('data-intent')||'signin';
  var msg=root.querySelector('[data-join-msg]');
  function say(t,cls){ if(msg){ msg.textContent=t; msg.className='join-msg'+(cls?' '+cls:''); } }
  function startCheckout(){
    return fetch('/api/directory/billing/checkout',{method:'POST',headers:{'Accept':'application/json'},credentials:'same-origin'})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(res){ if(res.ok&&res.j&&res.j.url){ window.location.href=res.j.url; } else { throw new Error((res.j&&res.j.error)||'Could not start checkout.'); } });
  }
  var form=root.querySelector('[data-join-signup-form]');
  if(form){ form.addEventListener('submit',function(e){
    e.preventDefault();
    var input=form.querySelector('input[type="email"]');
    var btn=form.querySelector('button[type="submit"]');
    var email=input?input.value.trim():'';
    if(!email){ return; }
    if(btn){ btn.disabled=true; }
    say('Working\\u2026');
    fetch('/api/directory/auth/signup',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:'same-origin',body:JSON.stringify({email:email})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(res){
        if(!res.ok){ throw new Error((res.j&&res.j.error)||'Something went wrong.'); }
        if(res.j.existing){ say('We emailed you a sign-in link \\u2014 click it to continue.','join-msg--ok'); if(btn){btn.disabled=false;} return; }
        if(intent==='subscribe'){ say('Account created \\u2014 taking you to secure checkout\\u2026','join-msg--ok'); return startCheckout().catch(function(){ say('Account created, but checkout could not start. Reload this page and click Subscribe.','join-msg--err'); if(btn){btn.disabled=false;} }); }
        say('You\\u2019re signed in.','join-msg--ok'); window.location.reload();
      })
      .catch(function(err){ say((err&&err.message)||'Something went wrong. Try again.','join-msg--err'); if(btn){btn.disabled=false;} });
  }); }
  var sub=root.querySelector('[data-subscribe-btn]');
  if(sub){ sub.addEventListener('click',function(e){ e.preventDefault(); sub.disabled=true; say('Starting secure checkout\\u2026'); startCheckout().catch(function(err){ say((err&&err.message)||'Could not start checkout. Try again.','join-msg--err'); sub.disabled=false; }); }); }
  var mng=root.querySelector('[data-manage-btn]');
  if(mng){ mng.addEventListener('click',function(e){ e.preventDefault(); mng.setAttribute('aria-busy','true'); say('Opening billing portal\\u2026');
    fetch('/api/directory/billing/portal',{headers:{'Accept':'application/json'},credentials:'same-origin'})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(res){ if(res.ok&&res.j&&res.j.url){ window.location.href=res.j.url; } else { throw new Error(); } })
      .catch(function(){ mng.removeAttribute('aria-busy'); say('Could not open the billing portal. Try again.','join-msg--err'); }); }); }
})();
`.trim();

/** The Directory Pro value bullets (shared across the join surfaces). */
function directoryProFeatures(): string {
  const cap = rfqRecipientCap();
  const items = [
    'Reveal direct dispatch &amp; decision-maker contacts beyond the FMCSA record',
    'Export filtered carrier lists to CSV',
    'Save carrier lists to reuse across searches',
    `Send one rate request to up to ${cap} carriers at once`,
  ];
  return `<ul class="join-features">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

/**
 * Free-vs-Pro split for the shipper join surface — so an anonymous visitor sees
 * the price AND what a free account gets before entering their email. Free =
 * the passwordless shipper account (browse everything, limited rate requests);
 * Pro ($19/mo) adds contact reveal, exports, saved lists and the full RFQ cap.
 */
function freeVsProSplit(): string {
  const cap = rfqRecipientCap();
  const free = [
    'Browse all US &amp; Canadian FMCSA carriers',
    'See authority, safety rating &amp; fleet on every profile',
    'Send a starter rate request',
  ];
  const pro = [
    'Reveal direct dispatch &amp; decision-maker contacts',
    'Export filtered carrier lists to CSV',
    'Save carrier lists to reuse across searches',
    `Send one rate request to up to ${cap} carriers at once`,
  ];
  return `
    <div class="join-price"><b>$19/mo</b><span>· cancel anytime</span></div>
    <div class="join-split">
      <div class="join-plan">
        <p class="join-plan-head">Free account</p>
        <p class="join-plan-price">$0 — magic-link sign-in</p>
        <ul class="join-features">${free.map((i) => `<li>${i}</li>`).join('')}</ul>
      </div>
      <div class="join-plan join-plan--pro">
        <p class="join-plan-head">Directory Pro</p>
        <p class="join-plan-price">$19/mo · cancel anytime · everything in Free, plus:</p>
        <ul class="join-features">${pro.map((i) => `<li>${i}</li>`).join('')}</ul>
      </div>
    </div>`;
}

/**
 * Shipper-facing "Directory Pro" join / sign-in / subscribe surface (/directory/join).
 * Dedicated shipper flow — NEVER the carrier /signup. Server-branches on the
 * soft-auth identity: anonymous → passwordless email form; signed-in free →
 * Subscribe ($19/mo → Stripe Checkout); Directory Pro → manage subscription.
 */
export function renderDirectoryJoin(opts: {
  identity: DirectoryIdentity;
  intent?: 'subscribe' | 'signin';
}): string {
  const { identity } = opts;
  const intent: 'subscribe' | 'signin' = opts.intent === 'subscribe' ? 'subscribe' : 'signin';
  const signedIn = identity.userId != null;
  const isPro = identity.isPro;
  const email = identity.email ?? '';

  let panel: string;
  if (isPro) {
    panel = `<div class="join-panel" data-join>
      <div class="join-badge-row"><span class="nav-pro-chip">Directory Pro ✓</span></div>
      <h2>You're on Directory Pro</h2>
      <p class="join-sub">Signed in as <strong>${esc(email)}</strong>. Your exports, contact reveal, saved lists, and multi-carrier RFQs are unlocked.</p>
      ${directoryProFeatures()}
      <div class="join-actions">
        <a class="btn btn-primary" href="/directory">Browse the directory <span class="arr">→</span></a>
        <button type="button" class="btn btn-secondary" data-manage-btn>Manage subscription</button>
      </div>
      <p class="join-msg" data-join-msg role="status" aria-live="polite"></p>
    </div>`;
  } else if (signedIn) {
    panel = `<div class="join-panel" data-join data-intent="subscribe">
      <h2>Subscribe to Directory Pro</h2>
      <p class="join-sub">Signed in as <strong>${esc(email)}</strong>. Unlock the full directory for <strong>$19/mo</strong> — cancel anytime.</p>
      ${directoryProFeatures()}
      <div class="join-actions">
        <button type="button" class="btn btn-primary" data-subscribe-btn>Subscribe — $19/mo</button>
        <a class="btn btn-secondary" href="/directory">Keep browsing free</a>
      </div>
      <p class="join-msg" data-join-msg role="status" aria-live="polite"></p>
    </div>`;
  } else {
    const heading = intent === 'subscribe' ? 'Sign in to subscribe to Directory Pro' : 'Sign in or create your shipper account';
    const sub =
      intent === 'subscribe'
        ? `Directory Pro is <strong>$19/mo</strong>, cancel anytime. Enter your email — we'll sign you in, then take you to secure checkout.`
        : `Shippers sign in with a magic link — no password. Enter your work email and we'll email you a secure sign-in link.`;
    const btnLabel = intent === 'subscribe' ? 'Continue' : 'Email me a sign-in link';
    panel = `<div class="join-panel" data-join data-intent="${intent}">
      <h2>${esc(heading)}</h2>
      <p class="join-sub">${sub}</p>
      <form class="join-form" data-join-signup-form method="post" action="/api/directory/auth/signup" novalidate>
        <label class="join-field">
          <span class="join-field-label">Work email</span>
          <input type="email" name="email" autocomplete="email" required placeholder="you@company.com">
        </label>
        <button type="submit" class="btn btn-primary">${esc(btnLabel)}</button>
      </form>
      <p class="join-msg" data-join-msg role="status" aria-live="polite"></p>
      ${freeVsProSplit()}
    </div>`;
  }

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      <div class="eyebrow" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;">For shippers</div>
      <h1>Directory Pro</h1>
      <p class="lead">The full carrier directory — direct contacts, CSV exports, saved lists, and multi-carrier rate requests.</p>
    </div>
  </section>
  <main class="dir-shell join-shell">
    ${panel}
  </main>
  <script>${JOIN_SCRIPT}</script>`;

  return layout({
    title: 'Directory Pro for Shippers — Sign in & Subscribe | QuoteFleet',
    description: 'Sign in or subscribe to QuoteFleet Directory Pro: direct carrier contacts, CSV exports, saved lists, and multi-carrier rate requests. $19/mo, cancel anytime.',
    canonicalPath: '/directory/join',
    bodyHtml: body,
  });
}

export function renderDirectoryLanding(
  summary: DirectorySummary,
  opts?: { upgrade?: 'success' | 'cancelled' | null },
): string {
  const portCards = summary.byPort
    .map(
      (p) => `<a class="dir-card" href="/directory/port/${encodeURIComponent(p.code)}">
        <h3>${esc(p.name)}</h3>
        <div class="sub">${esc([p.city, p.state].filter(Boolean).join(', '))} · ${esc(p.code)}</div>
        <div class="cnt">${fmtNum(p.count)}<small>carriers</small></div>
      </a>`,
    )
    .join('\n');

  const usStateRows = summary.byState.filter((s) => US_STATE_CODES.has(s.state));
  const stateCards = usStateRows
    .map((s) => {
      const st = stateByCode(s.state)!;
      return `<a class="dir-card" href="/directory/${st.slug}">
        <h3>${esc(st.name)}</h3>
        <div class="sub">${esc(s.state)}</div>
        <div class="cnt">${fmtNum(s.count)}<small>carriers</small></div>
      </a>`;
    })
    .join('\n');

  // When the directory has no carriers yet (fresh/empty table, e.g. a prod DB
  // still being ingested), show a clean "being set up" notice instead of empty
  // grids — the page must never look broken and must never 500.
  const isEmpty = summary.total === 0;
  const emptyNotice = isEmpty
    ? `<div class="dir-empty">The carrier directory is being set up — carriers are loading. Check back shortly.</div>`
    : '';

  // Post-checkout confirmation banner (Stripe returns here via success_url /
  // cancel_url). Directory Pro success reflects the shipper feature set; a
  // cancel is a soft "no charge" note with a retry link.
  const upgrade = opts?.upgrade ?? null;
  const upgradeBanner =
    upgrade === 'success'
      ? `<div class="dir-upgrade-banner dir-upgrade-banner--ok" role="status"><strong>You're on Directory Pro.</strong> Exports, contact reveal, saved lists, and ${rfqRecipientCap()}-recipient RFQs are unlocked.</div>`
      : upgrade === 'cancelled'
        ? `<div class="dir-upgrade-banner dir-upgrade-banner--info" role="status"><strong>Checkout cancelled — no charge was made.</strong> <a href="/directory/join?intent=subscribe">Subscribe to Directory Pro →</a></div>`
        : '';

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      <div class="eyebrow" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;">US carrier directory</div>
      <h1>Find US freight &amp; drayage carriers</h1>
      <p class="lead">Browse ${fmtNum(summary.total)} active US motor carriers by port and by state — fleet size, authority, safety rating, and which run container drayage. Sourced from FMCSA public data.</p>
      <div class="dir-stats">
        <div class="dir-stat"><b>${fmtNum(summary.total)}</b><span>Carriers</span></div>
        <div class="dir-stat"><b>${fmtNum(summary.intermodalTotal)}</b><span>Drayage / intermodal</span></div>
        <div class="dir-stat"><b>${fmtNum(usStateRows.length)}</b><span>States</span></div>
      </div>
    </div>
  </section>
  <main class="dir-shell">
    ${upgradeBanner}
    ${emptyNotice}
    ${
      isEmpty
        ? ''
        : `<div class="dir-card" style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
        <div><h2 style="margin:0 0 4px; font-size:18px;">Search &amp; filter every carrier</h2>
        <p class="muted-small" style="margin:0;">Filter ${fmtNum(summary.total)} carriers by state, city, fleet size, safety rating and authority — every filter is a shareable link.</p></div>
        <a class="btn btn-primary" href="/directory?sort=featured">Browse &amp; filter carriers <span class="arr">→</span></a>
      </div>`
    }
    ${shipperCarrierBand(summary)}
    <div class="dir-section-h">
      <h2>Top US ports</h2>
      <a class="muted-small" href="/compliance">Compliance tools →</a>
    </div>
    ${browseGrid(portCards, summary.byPort.length)}

    <div class="dir-section-h">
      <h2>Browse by state</h2>
      <span class="muted-small">${fmtNum(usStateRows.length)} states</span>
    </div>
    ${browseGrid(stateCards, usStateRows.length)}
  </main>`;

  return layout({
    title: `US Freight & Drayage Carrier Directory — ${summary.total.toLocaleString('en-US')} Carriers | QuoteFleet`,
    description: `Browse ${summary.total.toLocaleString('en-US')} US trucking and drayage carriers by port and state. Fleet size, operating authority, safety ratings and intermodal status from FMCSA data.`,
    canonicalPath: '/directory',
    bodyHtml: body,
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Directory', path: '/directory' }]),
      jsonLdItemListAndCollection({
        name: 'US Freight & Drayage Carrier Directory',
        description: `Browse ${summary.total} US motor carriers by port and state from FMCSA public data.`,
        path: '/directory',
        carriers: [],
        total: summary.total,
      }),
    ],
  });
}

/**
 * Two-audience band for the directory landing. The directory serves BOTH
 * shippers (source carriers + send one rate request to many) and carriers
 * (claim the FMCSA listing). The carrier SEO hero above stays intact; this
 * band surfaces the shipper product — the RFQ entry point and Directory Pro —
 * as a peer to the existing "Claim your listing" path, without burying it.
 */
function shipperCarrierBand(summary: DirectorySummary): string {
  const cap = rfqRecipientCap();
  const total = fmtNum(summary.total);
  return `
    <div class="dir-section-h"><h2>For shippers &amp; carriers</h2></div>
    <div class="dir-audience">
      <section class="aud-card">
        <div class="aud-eyebrow">For shippers</div>
        <h3>Get freight rates from many carriers — one request</h3>
        <p class="aud-lead">Search ${total} FMCSA carriers, shortlist the ones you want, and send a single rate request to all of them. Directory Pro adds direct contacts, exports, and saved lists.</p>
        <ul class="join-features">
          <li>Send one rate request to up to ${cap} carriers at once</li>
          <li>Reveal direct dispatch &amp; decision-maker contacts</li>
          <li>Export filtered carrier lists to CSV</li>
          <li>Save carrier lists to reuse across searches</li>
        </ul>
        <div class="aud-cta-row">
          <a class="btn btn-primary" href="/directory/rfq?sort=featured">Get freight quotes <span class="arr">→</span></a>
          <a class="btn btn-secondary" href="/directory/join">Directory Pro — $19/mo</a>
        </div>
      </section>
      <section class="aud-card">
        <div class="aud-eyebrow">For carriers</div>
        <h3>Get found by shippers sourcing capacity</h3>
        <p class="aud-lead">Your FMCSA record is already listed. Claim it — free — to control your profile, add lanes and contact details, and receive rate requests directly.</p>
        <ul class="join-features">
          <li>Control how your carrier profile reads</li>
          <li>Add the lanes and equipment you run</li>
          <li>Receive shipper rate requests directly</li>
        </ul>
        <div class="aud-cta-row">
          <a class="btn btn-primary" href="/signup">Claim your listing — free <span class="arr">→</span></a>
        </div>
      </section>
    </div>`;
}

// ─── Shared cross-link modules ────────────────────────────────────────────
/**
 * "Cities in {state}" module — links to the city-tier pages with counts.
 *
 * The card grid shows the TOP cities by carrier count (good for a person), and
 * the trailing link goes to the COMPLETE index at /directory/{state}/cities.
 * That link is the fix for a measured orphaning defect: only these top-24 cards
 * ever linked to a city hub, so 54 x 24 = 1,296 of 24,728 city hubs had any
 * internal inbound link at all and the other ~95% were reachable only from
 * sitemap-cities.xml. See allCitiesForState() in queries.ts for the numbers.
 */
function citiesModule(state: UsState, cities: CityCount[]): string {
  if (!cities.length) return '';
  const cards = cities
    .map(
      (c) => `<a class="dir-card" href="/directory/${state.slug}/${encodeURIComponent(c.slug)}">
        <h3>${esc(c.city)}</h3>
        <div class="cnt">${fmtNum(c.count)}<small>carriers</small></div>
      </a>`,
    )
    .join('\n');
  return `<div class="dir-section-h"><h2 style="font-size: 18px;">Cities in ${esc(state.name)}</h2><span class="muted-small">top ${cities.length} by carrier count</span></div>
    ${browseGrid(cards, cities.length)}
    <div class="dir-chips" style="margin-top: 14px;"><a class="dir-chip" href="/directory/${state.slug}/cities">All ${esc(state.name)} cities A–Z <span class="arr">→</span></a></div>`;
}

/**
 * Wrapper for the BROWSE card grids (top ports / browse by state / cities in a
 * state), as distinct from the carrier-RESULT grids.
 *
 * `data-odd` exists for the no-orphan rule. At phone widths these grids are two
 * equal columns, so an ODD number of cards would leave the final one alone
 * beside an empty half-row — which is the exact "wasted right half" this whole
 * layout change was raised to fix, just moved to the bottom of the list. When
 * the count is odd the CSS spans that last card across both columns, so every
 * row is full. Even counts need no special case.
 */
function browseGrid(cards: string, count: number): string {
  return `<div class="dir-grid dir-grid--browse"${count % 2 === 1 ? ' data-odd="1"' : ''}>${cards}</div>`;
}

/** "Browse by state" chip row (all US states except an optional current one). */
function statesChipRow(exceptCode?: string): string {
  const chips = US_STATES.filter((s) => s.code !== exceptCode)
    .map((s) => `<a class="dir-chip" href="/directory/${s.slug}">${esc(s.name)}</a>`)
    .join('\n');
  return `<div class="dir-section-h"><h2 style="font-size: 18px;">Browse by state</h2></div><div class="dir-chips">${chips}</div>`;
}

// ─── Faceted directory results (/directory?…) ─────────────────────────────
export function renderDirectoryResults(opts: {
  filters: DirectoryFilters;
  list: CarrierListResult;
  counts: FacetCounts;
  summary: DirectorySummary;
}): string {
  const { filters, list, counts, summary } = opts;
  const scope: FacetScope = { kind: 'all', basePath: '/directory', locked: new Set() };
  const st = filters.state ? stateByCode(filters.state) : null;
  const focus = st ? st.name : 'US';
  const h1 = st ? `${st.name} freight & drayage carriers` : 'Search US freight & drayage carriers';
  const canonicalPath = `/directory${canonicalSuffix(filters, scope.locked)}`;
  return renderFacetedResults({
    scope,
    list,
    counts,
    filters,
    summary,
    crumbs: [{ name: 'Directory', path: '/directory' }, { name: 'Search' }],
    hideHero: true,
    h1,
    intro: `Filter ${fmtNum(list.total)} FMCSA-registered ${focus} motor carriers by state, city, fleet size, safety rating and authority. Every filter is a shareable, crawlable link.`,
    title: `${st ? st.name + ' ' : ''}Carrier Search — Filter by Fleet, Safety & Authority | QuoteFleet`,
    description: `Faceted search of ${list.total.toLocaleString('en-US')} ${st ? st.name + ' ' : 'US '}freight and drayage carriers — filter by fleet size, safety rating, active authority and drayage service. FMCSA data.`,
    canonicalPath,
    extraModulesHtml: statesChipRow(filters.state ?? undefined),
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Directory', path: '/directory' }, { name: 'Search' }]),
      jsonLdItemListAndCollection({
        name: h1,
        description: `Filtered directory of ${list.total} carriers.`,
        path: canonicalPath,
        carriers: list.carriers,
        total: list.total,
      }),
    ],
  });
}

// ─── 2. State page (faceted) ──────────────────────────────────────────────
export function renderStatePage(opts: {
  state: UsState;
  list: CarrierListResult;
  counts: FacetCounts;
  filters: DirectoryFilters;
  cities: CityCount[];
}): string {
  const { state, list, counts, filters, cities } = opts;
  const scope: FacetScope = {
    kind: 'state',
    basePath: `/directory/${state.slug}`,
    locked: new Set(['state']),
    state,
    pagePaths: true,
  };
  const canonicalPath = hubCanonicalPath(scope, filters);
  return renderFacetedResults({
    scope,
    list,
    counts,
    filters,
    crumbs: [{ name: 'Directory', path: '/directory' }, { name: state.name }],
    h1: `${state.name} freight & drayage carriers`,
    intro: `${fmtNum(list.total)} FMCSA-registered motor carriers based in ${esc(state.name)}. Filter by city, fleet size, safety rating and authority, or <a href="/compliance">verify any carrier live</a>.`,
    title: `${state.name} Trucking & Drayage Carriers Directory — ${list.total.toLocaleString('en-US')} Carriers | QuoteFleet`,
    description: `Directory of ${list.total.toLocaleString('en-US')} freight and drayage carriers in ${state.name}. Filter by fleet size, safety rating and authority. FMCSA data, free to browse.`,
    canonicalPath,
    extraModulesHtml: `${citiesModule(state, cities)}${statesChipRow(state.code)}`,
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Directory', path: '/directory' }, { name: state.name, path: `/directory/${state.slug}` }]),
      jsonLdItemListAndCollection({
        name: `${state.name} freight & drayage carriers`,
        description: `Directory of ${list.total} carriers in ${state.name}.`,
        path: canonicalPath,
        carriers: list.carriers,
        total: list.total,
      }),
    ],
  });
}

// ─── 2a. Complete city index (/directory/{state}/cities) ──────────────────

/** Cities per index page. Chosen so the largest states need only a handful of
 *  pages while a page stays a reasonable size (~500 chips ≈ 35 KB of markup). */
export const CITY_INDEX_PER_PAGE = 500;

/** How many index pages a given city count needs (always ≥ 1). */
export function cityIndexPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / CITY_INDEX_PER_PAGE));
}

/** Path for one page of a state's city index. Page 1 is the bare path so the
 *  index has exactly ONE canonical URL rather than a `/page/1` duplicate. */
export function cityIndexPath(stateSlug: string, page: number): string {
  return page > 1 ? `/directory/${stateSlug}/cities/page/${page}` : `/directory/${stateSlug}/cities`;
}

/**
 * The COMPLETE, alphabetical index of every city hub in one state.
 *
 * THE POINT: this page exists to carry link equity into ~24,728 city hubs that
 * previously had none, which in turn are the only route to the 24 carriers on
 * each hub's first page. It is deliberately a dense, plain list of links — that
 * is what an index is for, and a crawler reads it in one fetch.
 *
 * Paginated by clean PATH (`/cities/page/2`), never `?page=`, because robots.txt
 * disallows `/*?*page=` outright — a query-string pager is invisible to Google,
 * which is precisely how the directory ended up with an unreachable long tail.
 */
export function renderStateCityIndex(opts: {
  state: UsState;
  cities: CityCount[];
  page: number;
  totalCities: number;
}): string {
  const { state, cities, page, totalCities } = opts;
  const totalPages = cityIndexPageCount(totalCities);
  const path = cityIndexPath(state.slug, page);

  // Group into A–Z sections so a person can actually navigate a few thousand
  // entries. Anything not starting with a letter lands in '#'.
  const groups = new Map<string, CityCount[]>();
  for (const c of cities) {
    const first = c.city.charAt(0).toUpperCase();
    const key = first >= 'A' && first <= 'Z' ? first : '#';
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }
  const sections = [...groups.entries()]
    .sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0].localeCompare(b[0])))
    .map(
      ([letter, items]) => `<section class="ci-grp">
        <h2 class="ci-ltr">${esc(letter)}</h2>
        <div class="dir-chips">${items
          .map(
            (c) =>
              `<a class="dir-chip" href="/directory/${state.slug}/${encodeURIComponent(c.slug)}">${esc(c.city)} <span class="muted-small">${fmtNum(
                c.count,
              )}</span></a>`,
          )
          .join('')}</div>
      </section>`,
    )
    .join('\n');

  // Numbered pager over clean paths. Every page of the series is reachable from
  // every other page, so a crawler never has to walk the series one hop at a time.
  const pager =
    totalPages > 1
      ? `<nav class="dir-pagenums" aria-label="City index pagination">${Array.from({ length: totalPages }, (_, i) => i + 1)
          .map((p) =>
            p === page
              ? `<span class="cur">${p}</span>`
              : `<a href="${esc(cityIndexPath(state.slug, p))}">${p}</a>`,
          )
          .join('\n')}</nav>`
      : '';

  const body = `<main class="dir-shell">
    ${crumbsHtml([
      { name: 'Directory', path: '/directory' },
      { name: state.name, path: `/directory/${state.slug}` },
      { name: 'All cities' },
    ])}
    <section class="hero dir-hero">
      <h1>Carriers by city in ${esc(state.name)}</h1>
      <p class="muted">Every city in ${esc(state.name)} with FMCSA-registered motor carriers — ${fmtNum(
        totalCities,
      )} in total${totalPages > 1 ? `, page ${page} of ${totalPages}` : ''}. Pick a city for its carrier list, or browse <a href="/directory/${
        state.slug
      }">all ${esc(state.name)} carriers</a>.</p>
    </section>
    <div class="dir-card" style="padding: 24px;">${sections || '<p class="muted">No cities found for this state.</p>'}</div>
    ${pager}
  </main>`;

  return layout({
    title: `Carriers by City in ${state.name} — ${totalCities.toLocaleString('en-US')} Cities${
      totalPages > 1 ? ` (Page ${page} of ${totalPages})` : ''
    } | QuoteFleet`,
    description: `Complete A–Z index of every ${state.name} city with FMCSA-registered freight and drayage carriers. ${totalCities.toLocaleString(
      'en-US',
    )} cities, free to browse.`,
    canonicalPath: path,
    bodyHtml: body,
    relPrev: page > 1 ? `${SITE}${cityIndexPath(state.slug, page - 1)}` : undefined,
    relNext: page < totalPages ? `${SITE}${cityIndexPath(state.slug, page + 1)}` : undefined,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Directory', path: '/directory' },
        { name: state.name, path: `/directory/${state.slug}` },
        { name: 'All cities', path: cityIndexPath(state.slug, 1) },
      ]),
    ],
  });
}

// ─── 2b. City page (faceted) ──────────────────────────────────────────────
export function renderCityPage(opts: {
  state: UsState;
  city: { name: string; slug: string };
  list: CarrierListResult;
  counts: FacetCounts;
  filters: DirectoryFilters;
  cities: CityCount[];
}): string {
  const { state, city, list, counts, filters, cities } = opts;
  const scope: FacetScope = {
    kind: 'city',
    basePath: `/directory/${state.slug}/${city.slug}`,
    locked: new Set(['state', 'city']),
    state,
    city,
    pagePaths: true,
  };
  const canonicalPath = hubCanonicalPath(scope, filters);
  const otherCities = cities.filter((c) => c.slug !== city.slug).slice(0, 23);
  return renderFacetedResults({
    scope,
    list,
    counts,
    filters,
    crumbs: [
      { name: 'Directory', path: '/directory' },
      { name: state.name, path: `/directory/${state.slug}` },
      { name: city.name },
    ],
    h1: `Top Drayage Carriers in ${city.name}, ${state.name}`,
    intro: `${fmtNum(list.total)} FMCSA-registered motor carriers based in ${esc(city.name)}, ${esc(state.name)}. Filter by fleet size, safety rating and authority, or <a href="/compliance">verify any carrier live</a>.`,
    title: `${city.name}, ${state.code} Trucking & Drayage Carriers — ${list.total.toLocaleString('en-US')} Carriers | QuoteFleet`,
    description: `Directory of ${list.total.toLocaleString('en-US')} freight and drayage carriers in ${city.name}, ${state.name}. Fleet size, safety rating and authority from FMCSA data.`,
    canonicalPath,
    extraModulesHtml: `${otherCities.length ? citiesModule(state, otherCities) : ''}
      <div class="dir-section-h"><h2 style="font-size: 18px;">More in ${esc(state.name)}</h2></div>
      <div class="dir-chips"><a class="dir-chip" href="/directory/${state.slug}">All ${esc(state.name)} carriers →</a></div>`,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Directory', path: '/directory' },
        { name: state.name, path: `/directory/${state.slug}` },
        { name: city.name, path: `/directory/${state.slug}/${city.slug}` },
      ]),
      jsonLdItemListAndCollection({
        name: `Drayage carriers in ${city.name}, ${state.name}`,
        description: `Directory of ${list.total} carriers in ${city.name}, ${state.name}.`,
        path: canonicalPath,
        carriers: list.carriers,
        total: list.total,
      }),
    ],
  });
}

// ─── 4a. Port page (faceted, + FAQ schema) ────────────────────────────────
function portFaqs(port: { name: string; city: string; state: string }): Array<{ q: string; a: string }> {
  return [
    {
      q: `How many carriers serve ${port.name}?`,
      a: `This directory maps every FMCSA-registered motor carrier whose physical location is nearest to ${port.name} in ${port.city}, ${port.state}, using ZIP-centroid proximity. Use the filters to narrow by fleet size, safety rating or drayage service.`,
    },
    {
      q: `What is drayage at ${port.city}?`,
      a: `Drayage is the short-haul trucking of ocean containers between ${port.name}'s marine terminals and nearby warehouses, rail ramps or transload facilities. Carriers flagged "Drayage / intermodal" here report intermodal container operations to FMCSA.`,
    },
    {
      q: `How do I verify a carrier's authority and insurance?`,
      a: `Every profile links to the official FMCSA SAFER Company Snapshot, and the on-page "Verify live now" button pulls a real-time authority, insurance and safety snapshot from FMCSA's QCMobile system. You can also use the free lookup on our compliance tools page.`,
    },
    {
      q: `Is this directory free to use?`,
      a: `Yes. Browsing, filtering and verifying carriers is free. Carrier data is sourced from FMCSA public records; carriers can claim their profile to publish live rates and take instant quotes.`,
    },
  ];
}

export function renderPortPage(opts: {
  port: ContainerPort;
  list: CarrierListResult;
  counts: FacetCounts;
  filters: DirectoryFilters;
}): string {
  const { port, list, counts, filters } = opts;
  const scope: FacetScope = {
    kind: 'port',
    basePath: `/directory/port/${port.code}`,
    locked: new Set(['port']),
    port,
    pagePaths: true,
  };
  const canonicalPath = hubCanonicalPath(scope, filters);
  const faqs = portFaqs(port);
  // Other US gateways as their DISPLAY groups (co-located ports as one "/" hub),
  // linking to the canonical group slug so no chip lands on a redirect.
  const usGroupCodes = new Set(CONTAINER_PORTS.map((p) => portGroupForMemberCode(p.code)?.code ?? p.code));
  const portChips = PORT_GROUPS.filter((g) => usGroupCodes.has(g.code) && g.code !== port.code)
    .map((g) => `<a class="dir-chip" href="/directory/port/${g.code}">${esc(g.label)}</a>`)
    .join('\n');
  const faqsHtml = `<div class="dir-section-h"><h2>Frequently asked questions</h2></div>
    ${faqs
      .map(
        (f) => `<div class="dir-card" style="margin-bottom:12px;"><h3 style="margin:0 0 6px; font-size:16px;">${esc(f.q)}</h3><p class="muted" style="margin:0; line-height:1.55;">${esc(f.a)}</p></div>`,
      )
      .join('\n')}`;
  return renderFacetedResults({
    scope,
    list,
    counts,
    filters,
    crumbs: [{ name: 'Directory', path: '/directory' }, { name: port.name }],
    h1: `Drayage & trucking carriers near ${port.name}`,
    intro: `${fmtNum(list.total)} carriers whose nearest US container gateway is ${esc(port.name)} (${esc(port.city)}, ${esc(port.state)}), by ZIP proximity from FMCSA data.`,
    title: `${port.name} Drayage & Trucking Carriers — ${list.total.toLocaleString('en-US')} Near ${port.city} | QuoteFleet`,
    description: `Directory of ${list.total.toLocaleString('en-US')} carriers near ${port.name} in ${port.city}, ${port.state}. Filter by fleet size, safety rating and drayage service. FMCSA data.`,
    canonicalPath,
    extraModulesHtml: `<div class="dir-section-h"><h2 style="font-size: 18px;">Other US ports</h2></div><div class="dir-chips">${portChips}</div>`,
    faqsHtml,
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Directory', path: '/directory' }, { name: port.name, path: `/directory/port/${port.code}` }]),
      jsonLdItemListAndCollection({
        name: `Carriers near ${port.name}`,
        description: `Directory of ${list.total} carriers near ${port.name}.`,
        path: canonicalPath,
        carriers: list.carriers,
        total: list.total,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ─── 4b. Carrier profile ──────────────────────────────────────────────────
export function renderCarrierProfile(opts: {
  carrier: VisibleCarrier;
  related?: VisibleCarrier[];
  cityCount?: number;
  stateCount?: number;
  // NOTE: there is deliberately NO `isPro` option. Entitlement must never reach
  // this renderer — the output has to be byte-identical for every visitor so the
  // ~334k profile URLs stay shared-cacheable. The Pro affordance is hydrated
  // client-side by CARRIER_PRO_HYDRATE_SCRIPT.
}): string {
  const c = opts.carrier;
  const related = opts.related ?? [];
  const sr = safetyLabel(c.safetyRating);
  const cityState = [c.city, c.state].filter(Boolean).join(', ');
  const st = stateByCode(c.state);
  const port = portByCode(c.nearestPortCode);
  const citySlug = c.city ? citySlugify(c.city) : '';
  const cityName = c.city ? titleCaseCity(c.city) : '';
  const saferUrl = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(
    c.usdot,
  )}`;

  // Breadcrumb: Directory / State / City / Carrier.
  const crumbs: Crumb[] = [{ name: 'Directory', path: '/directory' }];
  if (st) crumbs.push({ name: st.name, path: `/directory/${st.slug}` });
  if (st && citySlug && cityName) crumbs.push({ name: cityName, path: `/directory/${st.slug}/${citySlug}` });
  crumbs.push({ name: carrierName(c) });

  const isCa = !!(c.state && CA_PROVINCE_CODES.has(c.state));
  const isActive = !!c.authorityType;
  const claimHref = `/signup?claim=${encodeURIComponent(c.usdot)}&amp;name=${encodeURIComponent(carrierName(c))}`;

  // ── §3 FMCSA DATA — clean labeled grid (numbers tabular via CSS). ──────────
  const dataItems: Array<[string, string]> = [
    ['USDOT', c.usdot ? esc(c.usdot) : '—'],
    ['MC / Docket', c.mcNumber ? esc(c.mcNumber) : '—'],
    ['Power units', fmtNum(c.powerUnits)],
    ['Drivers', fmtNum(c.drivers)],
    ['Authority', esc(authorityLabel(c.authorityType))],
    ['Safety rating', esc(sr.text)],
    ['Status', isActive ? 'Active' : 'On file'],
  ];
  // Data-as-of date is not carried on VisibleCarrier today — omit rather than fake.
  const dataGrid = dataItems
    .map(([k, v]) => `<div class="cp-dt"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`)
    .join('');

  // ── §Capabilities — credentials we can DERIVE from FMCSA (authority, drayage,
  // HAZMAT, safety) render as distinct SOLID-colour badges tagged ✓ FMCSA in
  // their tooltip; self-declared credentials the carrier hasn't verified stay
  // muted with a "claim to add" affordance. Every badge is focusable and carries
  // a pure-CSS hover/focus tooltip (see credBadge). ────────────────────────────
  // Two SEPARATE badge groups so neither wraps a single badge onto a line of its
  // own (the global no-orphan rule): credential/compliance badges (authority,
  // drayage, hazmat, safety) render on their own row; the FMCSA equipment/
  // cargo-type badges render on their own row below. Each group is laid out with
  // a count-aware grid on narrow widths (see .cp-badgegroup CSS) so every line
  // keeps >=2 badges — never a stranded orphan — at desktop AND 390px.
  const credentialBadges: string[] = [];
  const equipmentBadges: string[] = [];
  if (isActive)
    credentialBadges.push(
      credBadge({
        tone: 'authority',
        label: authorityLabel(c.authorityType),
        tip: 'Active FMCSA operating authority.',
        held: true,
        verified: true,
      }),
    );
  if (c.intermodal)
    credentialBadges.push(
      credBadge({
        tone: 'dray',
        label: 'Drayage / intermodal',
        tip: 'Hauls containers to/from ports and rail ramps (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  // Equipment / cargo-type flags from the FMCSA census crgo_* columns — verified
  // facts, so they render as solid ✓ FMCSA badges (not "self-declared").
  if (c.dryVan)
    equipmentBadges.push(
      credBadge({
        tone: 'dryvan',
        label: 'Dry van',
        tip: 'Hauls dry van / general freight (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.reefer)
    equipmentBadges.push(
      credBadge({
        tone: 'reefer',
        label: 'Reefer',
        tip: 'Temperature-controlled / refrigerated freight (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.tanker)
    equipmentBadges.push(
      credBadge({
        tone: 'tanker',
        label: 'Tanker / bulk',
        tip: 'Hauls bulk liquids, gases or chemicals in tank equipment (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.flatbed)
    equipmentBadges.push(
      credBadge({
        tone: 'flatbed',
        label: 'Flatbed / oversized',
        tip: 'Hauls heavy or dimensional freight on flatbed / open-deck equipment (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.dryBulk)
    equipmentBadges.push(
      credBadge({
        tone: 'drybulk',
        label: 'Dry bulk',
        tip: 'Hauls dry bulk commodities (FMCSA cargo classification).',
        held: true,
        verified: true,
      }),
    );
  if (c.hazmat)
    credentialBadges.push(
      credBadge({
        tone: 'hazmat',
        label: 'Hazmat',
        tip: 'FMCSA-registered to transport hazardous materials.',
        held: true,
        verified: true,
      }),
    );
  if (sr.tone !== 'none')
    credentialBadges.push(
      credBadge({
        tone: `safety-${sr.tone}`,
        label: `${sr.text} safety`,
        tip: 'FMCSA safety rating.',
        held: true,
        verified: true,
      }),
    );
  // Self-declared credentials: a carrier_overrides.capabilities flag flips the
  // matching badge from the muted "claim to add" affordance to an ACTIVE solid
  // badge — still tooltip-labeled "Self-declared." (never FMCSA-verified). The
  // credential `tone` ids match the CarrierCapabilities keys 1:1.
  const caps = c.capabilities ?? {};
  const claimBadges = SELF_DECLARED_CREDENTIALS
    // The self-declared "Reefer" claim is redundant once the carrier's FMCSA
    // reefer flag is verified above — drop it to avoid a duplicate Reefer badge.
    .filter((b) => !(b.tone === 'reefer' && c.reefer))
    .map((b) => credBadge({ ...b, held: !!caps[b.tone as keyof typeof caps], selfDeclared: true }))
    .join('');
  // Badge groups, each wrapped with a data-n count so the count-aware grid
  // (mobile) partitions them without ever stranding a lone badge. The credential
  // strip lives on the Overview tab; the equipment strip on Services & Equipment.
  const credentialGroup = credentialBadges.length
    ? `<div class="cp-badgegroup" data-n="${credentialBadges.length}">${credentialBadges.join('')}</div>`
    : '';
  // ── FMCSA CREDENTIAL FACTS — the measurable ones, as neutral outline chips.
  //
  // Deliberately NOT more solid colour badges. The solid badges above say what a
  // carrier IS (a category: has authority, hauls hazmat); these say HOW MUCH (a
  // quantity: insured for $1m, registered 14 years). Different kind of fact,
  // different weight — and a positive credential is an outline-and-tint chip,
  // never a bright fill, so eight saturated badges never shout at once.
  //
  // Variable length, so this is a `.cp-chiprow` and inherits the STRUCTURAL
  // no-orphan rule (odd count ⇒ first chip spans both columns) rather than the
  // fixed `data-n` map, which only covers 1..6.
  //
  // Fleet size and the inspection count are NOT repeated here on purpose. Fleet
  // is already two inches below in the FMCSA snapshot grid on this same tab, and
  // the inspection count belongs with the out-of-service rates and the national
  // average that make it mean anything — a bare "5,043 inspections" chip would
  // strip exactly the context that keeps it honest.
  const factChips: string[] = [];
  const tenureLabel = registeredSinceLabel(c.credentials?.fmcsaRegisteredSince ?? null);
  if (tenureLabel) factChips.push(tenureLabel);
  if (c.credentials?.bipdOnFile != null)
    factChips.push(`${formatCoverage(c.credentials.bipdOnFile)} liability on file`);
  if (c.credentials?.cargoInsuranceOnFile) factChips.push('Cargo insurance on file');
  if (c.credentials?.bondOnFile) factChips.push('Surety bond on file');
  const factGroup = factChips.length
    ? `<div class="cp-chiprow cp-factrow">${factChips
        .map((t) => `<span class="cp-badge cp-badge--fact">${esc(t)}</span>`)
        .join('')}</div>`
    : '';
  const equipmentGroup = equipmentBadges.length
    ? `<div class="cp-eqwrap"><span class="cp-eqlabel">Equipment</span><div class="cp-badgegroup cp-badgegroup--equip" data-n="${equipmentBadges.length}">${equipmentBadges.join('')}</div></div>`
    : '';
  // NEW — FMCSA cargo-CLASS specialties (13 census crgo_* flags, already stored,
  // never surfaced before). Only render the ones that are true, with human
  // labels, as a neutral chip group (flex-wrap chip row — variable length).
  const cargoSpecs = CARGO_CLASS_SPECIALTIES.filter(([key]) => c[key] === true);
  const cargoGroup = cargoSpecs.length
    ? `<div class="cp-eqwrap"><span class="cp-eqlabel">Cargo specialties</span><div class="cp-chiprow cp-cargorow">${cargoSpecs
        .map(([, label]) => `<span class="cp-badge cp-badge--cargo">${esc(label)}</span>`)
        .join('')}</div></div>`
    : '';
  // NEW — FMCSA record freshness (updatedAt threaded onto VisibleCarrier). '' when absent.
  const dataAsOf = fmtDataAsOf(c.updatedAt);
  // WHEN the rating was assigned, as a sub-line under it. A rating without its
  // date is misleading — FMCSA only rates after a compliance review, most of the
  // ratings in this directory are many years old, and "Satisfactory" earned in
  // 2004 is a different claim from one earned last year. Renders only for a real
  // rating: an unrated carrier has no date and must not gain a second line
  // implying something is missing.
  const ratingDateLine =
    sr.tone !== 'none' && c.credentials?.safetyRatingDate
      ? `<span class="cp-safety-ctx">assigned ${esc(formatCredentialDate(c.credentials.safetyRatingDate))}</span>`
      : '';

  // ── §6 Contact — TIERED. Public block = FMCSA-sourced phone/email (encoded
  // href, escaped text), respecting the contactHidden opt-out. Gated block is
  // structure-only for now; Phase 2 will gate it behind real auth and render
  // additional dispatch contacts to signed-in users.
  const publicContact = c.contactHidden
    ? `<p class="cp-hidden">Contact details hidden at the carrier's request.</p>`
    : [
        c.phone
          ? `<div class="cp-contact-row"><span class="k">Phone</span><span class="v"><a href="tel:${encodeURIComponent(
              c.phone,
            )}">${esc(c.phone)}</a></span></div>`
          : '',
        c.email
          ? `<div class="cp-contact-row"><span class="k">Email</span><span class="v"><a href="mailto:${encodeURIComponent(
              c.email,
            )}">${esc(c.email)}</a></span></div>`
          : '',
        !c.phone && !c.email
          ? `<p class="cp-hidden">No public contact details on the FMCSA record.</p>`
          : '',
      ].join('');
  // Additional (enriched) dispatch contacts are a Directory Pro feature, SEPARATE
  // from the public FMCSA phone/email above (which stays free + unchanged).
  //   • Free / anonymous → a blurred teaser + an "Unlock with Directory Pro"
  //     upgrade CTA + a disabled "Reveal contacts" affordance.
  //   • Directory Pro → a live "Reveal additional contacts" button that POSTs to
  //     the reveal endpoint (built in PR C; the button is wired + ready now).
  // The enriched data + the reveal endpoint itself are PR C — this renders the
  // gate surface only, never real enriched contacts.
  //
  // ENTITLEMENT IS HYDRATED CLIENT-SIDE, NOT BRANCHED SERVER-SIDE.
  // This block used to be an `opts.isPro ? pro : free` ternary. That made the
  // server HTML differ per visitor on the page type the sitemap advertises ~334k
  // times, which meant NONE of those URLs could ever be stored in a shared cache
  // (see directory/httpCache.ts). The server now always emits the FREE variant —
  // identical bytes for every visitor — and CARRIER_PRO_HYDRATE_SCRIPT swaps in
  // the Pro variant after /api/directory/auth/me answers, mirroring how the nav's
  // "For shippers" slot already works.
  //
  // Safe because the free variant contains NO withheld data to protect: the
  // teaser is hardcoded bullet characters, and real enriched contacts only ever
  // arrive from POST /api/directory/carrier/:usdot/reveal, which re-checks the
  // entitlement itself and 403s a non-Pro caller (routes/directoryReveal.ts).
  const revealAction = `/api/directory/carrier/${encodeURIComponent(c.usdot)}/reveal`;
  const gatedContact = `<div class="cp-gated" data-cp-gated data-reveal-action="${esc(revealAction)}">
        <h3>More dispatch contacts</h3>
        <p>Direct dispatch and decision-maker contacts beyond the public FMCSA phone and email are part of Directory Pro.</p>
        <div class="cp-gated-teaser" aria-hidden="true">
          <span class="cp-gated-blur">Dispatch direct · ••• ••• ••••</span>
          <span class="cp-gated-blur">Ops email · ●●●●●@●●●●●●</span>
        </div>
        <a class="btn btn-primary cp-unlock-btn" href="/directory/join?intent=subscribe">Unlock with Directory Pro — $19/mo</a>
        <button type="button" class="btn btn-secondary cp-reveal-btn" disabled aria-disabled="true" title="Available on Directory Pro">Reveal contacts</button>
      </div>
      <script>${CARRIER_PRO_HYDRATE_SCRIPT}</script>
      <script>${REVEAL_ENHANCE_SCRIPT}</script>`;

  // Count-bearing cross-links (city + state).
  const crossLinks: string[] = [];
  if (st && citySlug && cityName && (opts.cityCount ?? 0) > 1) {
    crossLinks.push(
      `<a class="dir-chip" href="/directory/${st.slug}/${citySlug}">${esc(cityName)} carriers (${fmtNum(opts.cityCount)})</a>`,
    );
  }
  if (st && (opts.stateCount ?? 0) > 1) {
    crossLinks.push(`<a class="dir-chip" href="/directory/${st.slug}">${esc(st.name)} carriers (${fmtNum(opts.stateCount)})</a>`);
  }
  if (port) crossLinks.push(`<a class="dir-chip" href="/directory/port/${port.code}">Near ${esc(port.name)}</a>`);

  // Related carriers arrive as ONE ordered list from the ring mesh (queries.ts
  // relatedCarriers): the carrier's own city ring first, then its corridor ring
  // (nearest port, else the no-port carriers of its state). Split them here so
  // each group gets an honest heading — a card only says "City, ST" in its meta
  // line, so a single "Other carriers in Houston" heading over a mixed list
  // would be a lie. Nothing is dropped or reordered; this is a partition.
  const sameCity = (r: VisibleCarrier): boolean =>
    !!r.city && !!r.state && !!citySlug && r.state === c.state && citySlugify(r.city) === citySlug;
  const relatedCity = related.filter(sameCity);
  const relatedNearby = related.filter((r) => !sameCity(r));
  const relatedGrid = (list: VisibleCarrier[]): string =>
    `<div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">${list
      .map(carrierCard)
      .join('\n')}</div>`;
  // Corridor heading names the actual scope the ring used, so the reason those
  // carriers are on the page is legible: the port group, or failing that the
  // state. Never "the area" when we can name it.
  const nearbyHeading = port ? `More carriers near ${esc(port.name)}` : st ? `More carriers in ${esc(st.name)}` : 'More carriers nearby';
  const relatedModule = related.length
    ? [
        relatedCity.length
          ? `<div class="dir-section-h"><h2 style="font-size: 18px;">Other carriers in ${esc(cityName || st?.name || 'the area')}</h2></div>
       ${relatedGrid(relatedCity)}`
          : '',
        relatedNearby.length
          ? `<div class="dir-section-h"><h2 style="font-size: 18px;">${nearbyHeading}</h2></div>
       ${relatedGrid(relatedNearby)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  // Location line — NEW: append ZIP (stored, never shown before) after City, State.
  const cityStateZip = [cityState, c.zip].filter(Boolean).join(' ');
  const locBased = cityStateZip ? esc(cityStateZip) : isCa ? 'Canada' : 'the United States';
  // ── Also operating in — CLAIM-DRIVEN other operating cities/terminals. FMCSA
  // gives one physical HQ; a claimed carrier declares the extra metros it serves
  // via carrier_overrides.operating_locations (already normalized in the merge).
  // Render only when present + non-empty — no fabrication, no empty state. Reuse
  // the existing chip styling; .cp-chiprow carries the no-orphan mobile grid.
  const operatingLocations = (c.operatingLocations ?? []).filter(
    (l) => l && typeof l.city === 'string' && l.city.trim() !== '' && typeof l.state === 'string' && l.state.trim() !== '',
  );
  const alsoOperatingBlock = operatingLocations.length
    ? `<div class="cp-eqwrap cp-alsoloc">
            <span class="cp-eqlabel">Also operating in</span>
            <div class="cp-chiprow cp-alsoloc-row">${operatingLocations
              .map((l) => `<span class="cp-chip">${esc(`${titleCaseCity(l.city)}, ${l.state.trim().toUpperCase()}`)}</span>`)
              .join('')}</div>
          </div>`
    : '';
  // Subtitle line — DrayLocator order: USDOT · MC · City, State (each dropped when absent).
  const headerSubtitle = [
    c.usdot ? `USDOT ${esc(c.usdot)}` : '',
    c.mcNumber ? `MC ${esc(c.mcNumber)}` : '',
    cityState ? esc(cityState) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  // Highest-intent shipper action on this page: start a one-recipient RFQ
  // pre-seeded with THIS carrier. Links to the same /directory/rfq?dots= flow the
  // results action bar uses — a single USDOT resolves to a one-recipient request
  // (parseDots). The RFQ route handles the anonymous→account gate downstream, so
  // this is just a link. Guard on a missing USDOT so we never render a broken one.
  const rfqButton = c.usdot
    ? `<a class="btn btn-primary btn-sm cp-rfq-btn" href="/directory/rfq?dots=${esc(c.usdot)}" title="Request a freight rate from ${esc(carrierName(c))}">Request a rate <span class="arr">→</span></a>`
    : '';
  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml(crumbs)}
      <div class="cp-headrow">
        <div class="cp-idblock">
          <div class="cp-monogram" aria-hidden="true">${esc(monogramInitials(carrierName(c)))}</div>
          <div class="cp-idtext">
            <div class="cp-nameline">
              <h1>${esc(carrierName(c))}</h1>
              ${isActive ? '<span class="cp-badge-active">Active</span>' : ''}
              <span class="cp-fmcsa cp-tip" tabindex="0" role="note" aria-label="FMCSA — Profile built from FMCSA public records." data-tip="Profile built from FMCSA public records.">FMCSA</span>
            </div>
            <p class="lead cp-subtitle">${headerSubtitle}</p>
            ${carrierName(c) !== c.legalName ? `<p class="muted-small" style="margin: 6px 0 0;">Legal name: ${esc(c.legalName)}</p>` : ''}
          </div>
        </div>
        <div class="cp-headactions">
          <div class="cp-headcta">
            ${rfqButton}
            ${saveControl(c)}
          </div>
          <p class="cp-claimline">Own this company? <a href="${claimHref}">Claim this profile — it's free →</a></p>
        </div>
      </div>
    </div>
  </section>
  <main class="dir-shell dir-shell--cp">
    <div class="cp-tabs" role="group" aria-label="Carrier profile sections">
      <input type="radio" name="cp-tab" id="cp-tab-overview" class="cp-tab-input" checked>
      <label class="cp-tab" for="cp-tab-overview"><span class="cp-tab-lg">Overview</span><span class="cp-tab-sm">Overview</span></label>
      <input type="radio" name="cp-tab" id="cp-tab-services" class="cp-tab-input">
      <label class="cp-tab" for="cp-tab-services"><span class="cp-tab-lg">Services &amp; equipment</span><span class="cp-tab-sm">Services</span></label>
      <input type="radio" name="cp-tab" id="cp-tab-safety" class="cp-tab-input">
      <label class="cp-tab" for="cp-tab-safety"><span class="cp-tab-lg">Safety &amp; compliance</span><span class="cp-tab-sm">Safety</span></label>
      <input type="radio" name="cp-tab" id="cp-tab-contact" class="cp-tab-input">
      <label class="cp-tab" for="cp-tab-contact"><span class="cp-tab-lg">Contact &amp; location</span><span class="cp-tab-sm">Contact</span></label>

      <div class="cp-panel cp-panel--overview">
        <section class="cp-card">
          <h2 class="cp-h">About</h2>
          <p class="cp-about">${esc(c.aboutOverride ?? carrierAbout(c))}</p>
        </section>

        ${credentialGroup || factGroup ? `<section class="cp-card">
          <h2 class="cp-h">Credentials</h2>
          ${credentialGroup}
          ${factGroup}
          <p class="cp-note">Read from FMCSA public records — hover any badge for its meaning and source. Insurance is a filing on record, not proof of current coverage.</p>
        </section>` : ''}

        <section class="cp-card">
          <h2 class="cp-h">FMCSA snapshot</h2>
          <div class="cp-datagrid">${dataGrid}</div>
          ${dataAsOf ? `<p class="cp-note cp-asof">FMCSA data as of ${esc(dataAsOf)}.</p>` : ''}
          <a class="cp-verify-link" href="${saferUrl}" target="_blank" rel="noopener nofollow">Verify on FMCSA SAFER ↗</a>
        </section>
      </div>

      <div class="cp-panel cp-panel--services">
        <section class="cp-card">
          <h2 class="cp-h">Services &amp; equipment</h2>
          ${equipmentGroup || cargoGroup ? `${equipmentGroup}${cargoGroup}` : `<p class="cp-loc">No FMCSA equipment or cargo-class flags on this carrier's record yet.</p>`}
          ${c.intermodal ? `<p class="cp-loc" style="margin-top: 12px;"><span class="lk">Container drayage / intermodal</span>${port ? ` · nearest port ${esc(port.name)}` : ''}</p>` : ''}
        </section>

        <section class="cp-card">
          <h2 class="cp-h">Self-declared capabilities</h2>
          <div class="cp-claimgrid">${claimBadges}</div>
          <p class="cp-note">Muted credentials (UIIA, TWIC, bonded / C-TPAT, reefer, transload, yard) are self-declared — claim this profile to verify and add them.</p>
        </section>
      </div>

      <div class="cp-panel cp-panel--safety">
        <section class="cp-card">
          <h2 class="cp-h">Safety &amp; compliance</h2>
          <div class="cp-datagrid">
            <div class="cp-dt"><span class="k">Safety rating</span><span class="v">${esc(sr.text)}${ratingDateLine}</span></div>
            <div class="cp-dt"><span class="k">Operating authority</span><span class="v">${esc(authorityLabel(c.authorityType))}</span></div>
            <div class="cp-dt"><span class="k">Authority status</span><span class="v">${isActive ? 'Active' : 'On file'}</span></div>
            <div class="cp-dt"><span class="k">Hazmat registration</span><span class="v">${c.hazmat ? 'Registered' : 'Not registered'}</span></div>
          </div>
          <p class="cp-note">${esc(safetyRatingExplainer(c.safetyRating))}</p>
          <div class="cp-actions">
            <a class="btn btn-secondary" href="${saferUrl}" target="_blank" rel="noopener nofollow">Verify on FMCSA SAFER ↗</a>
            <button class="btn btn-primary" id="live-verify" data-usdot="${esc(c.usdot)}">Verify live now</button>
          </div>
          <div id="live-result" class="lookup-result" style="margin-top: 8px;"></div>
          <p class="cp-note">Authority and insurance come from FMCSA's Licensing &amp; Insurance file, last refreshed ${esc(LI_EXTRACT_DATE)}; out-of-service status is from the live check above.</p>
        </section>

        ${insuranceBlock(c.credentials)}

        ${safetyRecordBlock(c.safety)}
      </div>

      <div class="cp-panel cp-panel--contact">
        <section class="cp-card">
          <h2 class="cp-h">Contact</h2>
          ${publicContact}
          ${gatedContact}
          <p class="cp-note">Carrier information is sourced from public FMCSA records. To correct or hide your details, email support@quotefleet.net with your USDOT number.</p>
        </section>

        <section class="cp-card">
          <h2 class="cp-h">Location &amp; service area</h2>
          <p class="cp-loc">Based in ${locBased}.</p>
          <p class="cp-loc">Serving shippers, brokers and forwarders ${isCa ? 'across Canadian trade lanes' : 'at US container ports'}.</p>
          ${port ? `<p class="cp-loc"><span class="lk">Nearest port</span> ${esc(port.name)}${port.city || port.state ? ` · ${esc([port.city, port.state].filter(Boolean).join(', '))}` : ''}</p>` : ''}
          ${alsoOperatingBlock}
        </section>
      </div>
    </div>

    ${crossLinks.length ? `<div class="dir-chips cp-crosslinks">${crossLinks.join('\n')}</div>` : ''}

    ${relatedModule}

    <div class="dir-card cp-claimcard">
      <h2 style="font-size: 18px; margin: 0 0 8px;">Is this your company?</h2>
      <p class="muted" style="margin: 0 auto 16px; max-width: 460px;">Claim your profile to publish live rates, take instant quotes, and get booked directly by shippers — free to list.</p>
      <a class="btn btn-primary" href="${claimHref}">Claim this profile <span class="arr">→</span></a>
      <p class="muted-small" style="margin: 16px auto 0; max-width: 460px;">Carrier data is sourced from public FMCSA records. To correct or hide your contact details, email support@quotefleet.net with your USDOT number.</p>
    </div>
  </main>
  <script>
    (function () {
      var btn = document.getElementById('live-verify');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var dot = btn.getAttribute('data-usdot');
        var box = document.getElementById('live-result');
        btn.disabled = true; btn.textContent = 'Checking FMCSA…';
        fetch('/api/public/directory/lookup?dot=' + encodeURIComponent(dot))
          .then(function (r) { return r.json(); })
          .then(function (j) { box.innerHTML = renderLive(j); })
          .catch(function () { box.innerHTML = '<p class="muted-small" style="margin-top:12px;">Live check unavailable right now — use SAFER above.</p>'; })
          .finally(function () { btn.disabled = false; btn.textContent = 'Verify live now'; });
      });
      function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);});}
      function renderLive(j){
        if(!j||!j.found){return '<p class="muted-small" style="margin-top:12px;">'+esc((j&&j.note)||'No live FMCSA record found.')+'</p>';}
        function yn(v){return v==='Y'?'Yes':v==='N'?'No':(v||'—');}
        function auth(v){return v==='A'?'Active':v==='I'?'Inactive':v==='N'?'None':(v||'—');}
        function fmtBipd(v){var n=Number(String(v==null?'':v).replace(/[^0-9.]/g,''));if(!isFinite(n)||n<=0)return '—';var d=n*1000;return d%1000000===0?('$'+(d/1000000)+'M'):('$'+d.toLocaleString('en-US'));}
        var rows=[
          ['Allowed to operate', j.allowedToOperate==='Y'?'Yes':j.allowedToOperate==='N'?'No':'—'],
          ['Common authority', auth(j.authority&&j.authority.common)],
          ['Contract authority', auth(j.authority&&j.authority.contract)],
          ['BIPD insurance on file', j.insurance&&j.insurance.bipdOnFile?fmtBipd(j.insurance.bipdOnFile):'—'],
          ['Out of service', j.outOfService?('Yes'+(j.outOfServiceDate?' ('+esc(j.outOfServiceDate)+')':'')):'No'],
          ['Power units', j.powerUnits==null?'—':esc(String(j.powerUnits))]
        ];
        return '<p class="muted-small" style="margin:14px 0 6px;">Live FMCSA QCMobile result:</p>'+rows.map(function(r){
          return '<div class="row"><span class="k">'+esc(r[0])+'</span><span class="v">'+r[1]+'</span></div>';
        }).join('');
      }
    })();
  </script>
  <script>${SAVE_WIDGET_SCRIPT}</script>`;

  return layout({
    title: `${carrierName(c)} — USDOT ${c.usdot} Carrier Profile | QuoteFleet`,
    description: `${carrierName(c)}${cityState ? ' of ' + cityState : ''}: USDOT ${c.usdot}, ${
      c.powerUnits ? c.powerUnits + ' power units, ' : ''
    }${authorityLabel(c.authorityType)}, ${sr.text} safety rating. Verify live with FMCSA.`,
    canonicalPath: `/directory/carrier/${encodeURIComponent(c.slug)}`,
    bodyHtml: body,
    jsonLd: [jsonLdBreadcrumb(crumbs), jsonLdCarrier(c)],
  });
}

/**
 * The SITE-WIDE 404 body, for any path no route claimed.
 *
 * The global catch-all used to answer every unknown URL with a bare
 * `{"error":"Not found"}` JSON payload — correct status, but a dead end for a
 * person who mistyped a URL or followed a stale link, and a page with no route
 * back into the site for a crawler that found one. This renders a real branded
 * page with the full site chrome and hand-picked links into the highest-value
 * hubs, so a 404 recirculates instead of terminating.
 *
 * Deliberately `noindex, follow`: the status code already keeps it out of the
 * index, and `follow` lets a crawler that lands here use the links out.
 */
export function renderSiteNotFound(): string {
  const links: Array<[string, string]> = [
    ['/directory', 'Carrier directory'],
    ['/services', 'Drayage services'],
    ['/glossary', 'Freight glossary'],
    ['/compliance', 'Compliance lookup'],
    ['/tools', 'Free tools'],
    ['/pricing', 'Pricing'],
  ];
  const body = `<main class="dir-shell"><div class="dir-card" style="margin-top: 40px; padding: 40px;">
    <h1 style="font-size: 24px;">That page isn't here</h1>
    <p class="muted">The link may be out of date, or the address may have a typo. Here's where most people are headed:</p>
    <div class="dir-chips" style="margin-top: 16px;">${links
      .map(([href, label]) => `<a class="dir-chip" href="${esc(href)}">${esc(label)}</a>`)
      .join('')}</div>
  </div></main>`;
  return layout({
    title: 'Page not found | QuoteFleet',
    description: 'This QuoteFleet page could not be found.',
    canonicalPath: '/',
    bodyHtml: body,
    robots: 'noindex, follow',
  });
}

export function renderCarrierNotFound(): string {
  const body = `<main class="dir-shell"><div class="dir-card" style="margin-top: 40px; text-align: center; padding: 40px;">
    <h1 style="font-size: 24px;">Carrier not found</h1>
    <p class="muted">This carrier isn't in the directory, or the link is wrong.</p>
    <a class="btn btn-secondary" href="/directory">Browse the directory</a>
  </div></main>`;
  return layout({
    title: 'Carrier not found | QuoteFleet',
    description: 'This carrier is not in the QuoteFleet directory.',
    canonicalPath: '/directory',
    bodyHtml: body,
  });
}

/**
 * 404 body for a `?page=` past MAX_PAGE. Deliberately a real page (not a bare
 * text 404) so a person who followed a stale deep link lands somewhere useful,
 * and canonicals to the un-paginated hub so nothing points back at the OFFSET.
 */
export function renderDirectoryPageOutOfRange(maxPage: number, backPath = '/directory'): string {
  const body = `<main class="dir-shell"><div class="dir-card" style="margin-top: 40px; text-align: center; padding: 40px;">
    <h1 style="font-size: 24px;">Page not found</h1>
    <p class="muted">This listing stops at page ${maxPage}. Narrow the results with a city, state or filter to find what you're after.</p>
    <a class="btn btn-secondary" href="${esc(backPath)}">Back to the listing</a>
  </div></main>`;
  return layout({
    title: 'Page not found | QuoteFleet',
    description: 'This directory page is outside the available range.',
    canonicalPath: backPath,
    bodyHtml: body,
  });
}

// ─── Saved lists (Directory Pro, PR D) ─────────────────────────────────────
/** Wire the saved-lists page remove buttons (DELETE → drop the row + update the
 *  count). Pure progressive enhancement: viewing the lists works with no JS. */
const SAVED_LISTS_PAGE_SCRIPT = `
(function(){
  document.addEventListener('click', function(e){
    var t = e.target; if(!t || !t.closest) return;
    var btn = t.closest('.sl-rm'); if(!btn) return;
    var listId = btn.getAttribute('data-list'); var dot = btn.getAttribute('data-dot');
    btn.disabled = true; btn.textContent = 'Removing…';
    fetch('/api/directory/lists/'+encodeURIComponent(listId)+'/items/'+encodeURIComponent(dot), { method:'DELETE', headers:{ 'Accept':'application/json' }, credentials:'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(j){ if(j&&j.ok){ var row=btn.closest('.sl-row'); var det=btn.closest('.sl-list'); if(row) row.remove(); update(det, j.count); } else { btn.disabled=false; btn.textContent='Remove'; } })
      .catch(function(){ btn.disabled=false; btn.textContent='Remove'; });
  });
  function update(det, count){ if(!det) return; var n=det.querySelector('summary .n'); if(n && typeof count==='number'){ n.textContent = count+' carrier'+(count===1?'':'s'); } var body=det.querySelector('.sl-body'); if(body && count===0){ body.innerHTML='<p class="sl-empty">No carriers in this list yet.</p>'; } }
})();
`.trim();

/** One saved carrier as a directory-style row with a remove button. */
function savedCarrierRow(listId: number, c: VisibleCarrier): string {
  const cityState = [c.city ? titleCaseCity(c.city) : '', c.state].filter(Boolean).join(', ');
  const sub = [c.usdot ? `USDOT ${esc(c.usdot)}` : '', cityState ? esc(cityState) : ''].filter(Boolean).join(' · ');
  const name = carrierName(c);
  return `<div class="sl-row" data-dot="${esc(c.usdot)}">
    <div>
      <a class="lk" href="/directory/carrier/${encodeURIComponent(c.slug)}">${esc(name)}</a>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>
    <button type="button" class="btn btn-secondary btn-sm sl-rm" data-list="${listId}" data-dot="${esc(c.usdot)}" aria-label="Remove ${esc(name)} from this list">Remove</button>
  </div>`;
}

/** One saved list as an expandable block of carrier rows. */
function savedListBlock(list: { id: number; name: string; carriers: VisibleCarrier[] }): string {
  const n = list.carriers.length;
  const rows = n ? list.carriers.map((c) => savedCarrierRow(list.id, c)).join('\n') : `<p class="sl-empty">No carriers in this list yet.</p>`;
  return `<details class="sl-list" open data-list-id="${list.id}">
    <summary><span>${esc(list.name)}</span><span class="n">${n} carrier${n === 1 ? '' : 's'}</span></summary>
    <div class="sl-body">${rows}</div>
  </details>`;
}

/** The Pro-gated saved-lists view: the user's lists + their saved carriers. */
export function renderSavedListsPage(opts: { lists: Array<{ id: number; name: string; carriers: VisibleCarrier[] }> }): string {
  const lists = opts.lists ?? [];
  const total = lists.reduce((sum, l) => sum + l.carriers.length, 0);
  const listsHtml = lists.length
    ? `<div class="sl-wrap">${lists.map(savedListBlock).join('\n')}</div>
       <script>${SAVED_LISTS_PAGE_SCRIPT}</script>`
    : `<div class="dir-card" style="padding: 32px; max-width: 560px;">
        <h2 style="margin: 0 0 8px; font-size: 18px;">No saved lists yet</h2>
        <p class="muted" style="margin: 0 0 16px; line-height: 1.55;">Save carriers from the <a href="/directory">directory</a> or any carrier profile to build a shortlist you can revisit whenever you're sourcing capacity.</p>
        <a class="btn btn-primary" href="/directory">Browse the directory <span class="arr">→</span></a>
      </div>`;
  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml([{ name: 'Directory', path: '/directory' }, { name: 'Saved lists' }])}
      <h1 style="margin-top: 6px;">Your saved carrier lists</h1>
      <p class="lead">${total ? `${fmtNum(total)} carrier${total === 1 ? '' : 's'} across ${fmtNum(lists.length)} list${lists.length === 1 ? '' : 's'}.` : 'Build named shortlists of carriers and revisit them anytime.'}</p>
    </div>
  </section>
  <main class="dir-shell dir-shell--tight">
    ${listsHtml}
  </main>`;
  return layout({
    title: 'Your saved carrier lists | QuoteFleet',
    description: 'Your saved carrier shortlists on QuoteFleet Directory Pro.',
    canonicalPath: '/directory/lists',
    bodyHtml: body,
  });
}

/** Upsell shown on /directory/lists to callers without Directory Pro: a sign-in
 *  prompt (no session) or the $19/mo upgrade CTA (free account). */
export function renderSavedListsUpsell(reason: 'needs-account' | 'needs-pro'): string {
  const isAccount = reason === 'needs-account';
  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${crumbsHtml([{ name: 'Directory', path: '/directory' }, { name: 'Saved lists' }])}
      <h1 style="margin-top: 6px;">Saved carrier lists</h1>
      <p class="lead">${isAccount ? 'Sign in to save carriers into named lists and revisit them anytime.' : 'Saving carriers into named lists is a Directory Pro feature.'}</p>
    </div>
  </section>
  <main class="dir-shell dir-shell--tight">
    <div class="dir-card" style="padding: 32px; max-width: 560px;">
      <h2 style="margin: 0 0 8px; font-size: 18px;">${isAccount ? 'Sign in to build saved lists' : 'Save carriers with Directory Pro'}</h2>
      <p class="muted" style="margin: 0 0 16px; line-height: 1.55;">Build named shortlists of carriers from the directory and any carrier profile, then come back to them whenever you're sourcing capacity.${isAccount ? '' : ' Directory Pro is $19/mo.'}</p>
      ${isAccount
        ? `<a class="btn btn-primary" href="/login">Sign in</a> <a class="btn btn-secondary" href="/signup?plan=directory-pro">Create an account</a>`
        : `<a class="btn btn-primary" href="/signup?plan=directory-pro">Upgrade to Directory Pro — $19/mo <span class="arr">→</span></a>`}
    </div>
  </main>`;
  return layout({
    title: 'Saved carrier lists | QuoteFleet',
    description: 'Save carriers into named lists with QuoteFleet Directory Pro.',
    canonicalPath: '/directory/lists',
    bodyHtml: body,
  });
}

// ─── 3. Compliance Tools ──────────────────────────────────────────────────
const COMPLIANCE_SOURCES: Array<{ name: string; href: string; desc: string }> = [
  {
    name: 'FMCSA SAFER',
    href: 'https://safer.fmcsa.dot.gov/CompanySnapshot.aspx',
    desc: 'The official Company Snapshot — operating authority, insurance status, out-of-service orders and crash/inspection history by USDOT or MC number.',
  },
  {
    name: 'FMCSA SMS (BASIC scores)',
    href: 'https://ai.fmcsa.dot.gov/SMS/',
    desc: 'Safety Measurement System percentile scores across the BASIC categories (unsafe driving, HOS, vehicle maintenance, and more).',
  },
  {
    name: 'FMCSA License & Insurance',
    href: 'https://li-public.fmcsa.dot.gov/LIVIEW/pkg_menu.prc_menu',
    desc: 'Authoritative L&I system: authority history, active/pending/revoked status, and the insurance forms (BMC-91, BOC-3) on file.',
  },
  {
    name: 'UIIA Member Search',
    href: 'https://www.uiia.org/',
    desc: 'The Uniform Intermodal Interchange Agreement registry — confirm whether a drayage carrier is a UIIA member eligible to interchange containers.',
  },
  {
    name: 'TSA TWIC',
    href: 'https://www.tsa.gov/for-industry/twic',
    desc: 'Transportation Worker Identification Credential — the port-access credential drivers need for secure maritime facilities.',
  },
];

export function renderCompliancePage(summary: DirectorySummary): string {
  const sourceCards = COMPLIANCE_SOURCES.map(
    (s) => `<a class="src-card" href="${s.href}" target="_blank" rel="noopener nofollow">
      <h3>${esc(s.name)}</h3>
      <p>${esc(s.desc)}</p>
      <span class="go">Open ↗</span>
    </a>`,
  ).join('\n');

  // Compliance filter chips. Only flags we truly have (drayage/intermodal) deep-link;
  // the rest are honestly marked "coming soon".
  const availableChips = `
    <a class="dir-chip active" href="/directory?intermodal=1">Drayage / intermodal (${fmtNum(summary.intermodalTotal)})</a>
    <a class="dir-chip" href="/directory">All carriers (${fmtNum(summary.total)})</a>`;
  const comingSoon = ['UIIA member', 'TWIC-ready', 'Hazmat', 'Reefer']
    .map((n) => `<span class="dir-chip" style="opacity: 0.55; cursor: default;">${esc(n)} · soon</span>`)
    .join('\n');

  const body = `
  <section class="hero dir-hero">
    <div class="container-narrow">
      <div class="eyebrow" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;">Compliance tools</div>
      <h1>Verify a carrier before you book</h1>
      <p class="lead">Check any US carrier's operating authority, insurance and safety status straight from FMCSA — and jump to the official government sources for a deeper look.</p>
    </div>
  </section>
  <main class="dir-shell">
    <div class="lookup-box">
      <h2 style="font-size: 18px; margin: 0 0 4px;">Live USDOT / MC lookup</h2>
      <p class="muted-small" style="margin: 0 0 16px;">Pulls a live snapshot from FMCSA's QCMobile system. Data is FMCSA's, updated on their schedule.</p>
      <div class="lookup-row">
        <div class="lookup-toggle" id="lk-toggle">
          <button type="button" class="on" data-kind="dot">USDOT</button>
          <button type="button" data-kind="mc">MC</button>
        </div>
        <input class="input" id="lk-input" inputmode="numeric" placeholder="e.g. 3733285" autocomplete="off">
        <button class="btn btn-primary" id="lk-go">Verify <span class="arr">→</span></button>
      </div>
      <div id="lk-result" class="lookup-result"></div>
    </div>

    <div class="dir-section-h"><h2>Official verification sources</h2></div>
    <div class="src-grid">${sourceCards}</div>

    <div class="dir-section-h"><h2>Filter carriers by compliance</h2></div>
    <p class="muted-small" style="margin: -6px 0 12px;">FMCSA public data reliably gives us drayage/intermodal today. UIIA, TWIC, Hazmat and Reefer are self-declared credentials we're adding next — we won't fake them.</p>
    <div class="dir-chips">${availableChips}</div>
    <div class="dir-chips" style="margin-top: 8px;">${comingSoon}</div>
  </main>
  <script>
    (function () {
      var kind = 'dot';
      var toggle = document.getElementById('lk-toggle');
      var input = document.getElementById('lk-input');
      var go = document.getElementById('lk-go');
      var box = document.getElementById('lk-result');
      toggle.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        kind = b.getAttribute('data-kind');
        Array.prototype.forEach.call(toggle.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
        input.placeholder = kind === 'dot' ? 'e.g. 3733285' : 'e.g. 1515';
      });
      function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);});}
      function run() {
        var v = (input.value || '').trim();
        if (!v) { box.innerHTML = '<p class="muted-small" style="margin-top:12px;">Enter a number first.</p>'; return; }
        go.disabled = true; go.textContent = 'Checking…';
        fetch('/api/public/directory/lookup?' + kind + '=' + encodeURIComponent(v))
          .then(function (r) { return r.json(); })
          .then(function (j) { box.innerHTML = render(j); })
          .catch(function () { box.innerHTML = '<p class="muted-small" style="margin-top:12px;">Lookup failed. Try SAFER directly.</p>'; })
          .finally(function () { go.disabled = false; go.innerHTML = 'Verify <span class="arr">→</span>'; });
      }
      go.addEventListener('click', run);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
      function auth(v){return v==='A'?'Active':v==='I'?'Inactive':v==='N'?'None':(v||'—');}
      function fmtBipd(v){var n=Number(String(v==null?'':v).replace(/[^0-9.]/g,''));if(!isFinite(n)||n<=0)return '—';var d=n*1000;return d%1000000===0?('$'+(d/1000000)+'M'):('$'+d.toLocaleString('en-US'));}
      function render(j) {
        if (!j || !j.found) { return '<p class="muted-small" style="margin-top:14px;">' + esc((j && j.note) || 'No FMCSA record found.') + '</p>'; }
        var rows = [
          ['Legal name', esc(j.legalName || '—')],
          ['DBA', j.dbaName ? esc(j.dbaName) : '—'],
          ['Location', esc([j.city, j.state].filter(Boolean).join(', ') || '—')],
          ['USDOT', esc(j.usdot || '—')],
          ['MC / Docket', j.mcNumber ? esc(j.mcNumber) : '—'],
          ['Allowed to operate', j.allowedToOperate === 'Y' ? '✓ Yes' : j.allowedToOperate === 'N' ? '✗ No' : '—'],
          ['Common authority', auth(j.authority && j.authority.common)],
          ['Contract authority', auth(j.authority && j.authority.contract)],
          ['BIPD insurance on file', j.insurance && j.insurance.bipdOnFile ? fmtBipd(j.insurance.bipdOnFile) : '—'],
          ['Safety rating', esc(j.safetyRating || 'Not rated')],
          ['Out of service', j.outOfService ? ('Yes' + (j.outOfServiceDate ? ' (' + esc(j.outOfServiceDate) + ')' : '')) : 'No'],
          ['Power units', j.powerUnits == null ? '—' : esc(String(j.powerUnits))],
          ['Drivers', j.drivers == null ? '—' : esc(String(j.drivers))]
        ];
        return '<p class="muted-small" style="margin:16px 0 6px;">Live FMCSA snapshot:</p>' + rows.map(function (r) {
          return '<div class="row"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
        }).join('');
      }
    })();
  </script>`;

  return layout({
    title: 'Carrier Compliance Tools — Verify USDOT, MC, Authority & Insurance | QuoteFleet',
    description: 'Free tools to verify a US freight carrier: live USDOT/MC lookup of authority, insurance and safety status from FMCSA, plus links to SAFER, SMS BASIC scores, L&I, UIIA and TWIC.',
    canonicalPath: '/compliance',
    bodyHtml: body,
  });
}
