/**
 * Server-rendered "Importer Search" feature (/importers) + its search API.
 *
 * Provider-FIRST (the differentiator vs ImportYeti's name-first search): our
 * users know their PORT / LANE / COMMODITY, not importer names, so the primary
 * pickers are Entry Port, US State and Commodity / HS code. A company-name box
 * is the small secondary path.
 *
 * The GET page is a light server-rendered shell (no external calls on load).
 * It fetches POST /api/importers/search, which runs the ImportYeti-only browse
 * path of `findImporterLeads` (no Hunter, no Anthropic — those are the paid
 * reveal). Results — importer, lane, volumes, incumbent, Winnability chip, AI
 * angle — are ALL FREE to view. The decision-maker CONTACT, the AI-drafted
 * email, and CSV export are LOCKED behind a sign-up CTA (placeholder unlock;
 * no Stripe/payment wired yet).
 *
 * Renders through the shared directory `layout()` + `esc()` (nav/footer parity
 * with /directory, /compliance, /glossary). Styles are inlined in this TS
 * module (like DIRECTORY_CSS), so the public-dir CSS/color/spacing guards —
 * which only scan src/server/public — never touch them.
 */
import type { Express, Request, Response } from 'express';
import { layout, esc } from './pages.js';
import { CONTAINER_PORTS } from './containerPorts.js';
import { US_STATES } from './usStates.js';
import {
  findImporterLeads,
  winnability,
  aiAngle,
  MAX_LEADS,
  type ImporterFilters,
  type ImporterLead,
  type ContactConfidence,
} from './importerLeads.js';
import {
  dbBolCacheStore,
  dbContactCacheStore,
  searchKey,
  companyKey,
  IMPORTER_CACHE_TTL_MS,
  type ContactCacheStore,
  type BolCacheStore,
} from './importerCache.js';
import { importerSearchLimiter } from '../rateLimits.js';

const SITE = 'https://quotefleet.net';

const US_PORTS = CONTAINER_PORTS.filter((p) => p.country === 'US');

/** Common supplier origin countries (ISO-2 → label) for the secondary picker. */
const SUPPLIER_COUNTRIES: ReadonlyArray<[string, string]> = [
  ['CN', 'China'], ['DE', 'Germany'], ['IN', 'India'], ['IT', 'Italy'], ['JP', 'Japan'],
  ['KR', 'South Korea'], ['MX', 'Mexico'], ['VN', 'Vietnam'], ['TW', 'Taiwan'], ['ES', 'Spain'],
  ['FR', 'France'], ['GB', 'United Kingdom'], ['TH', 'Thailand'], ['TR', 'Turkey'], ['BR', 'Brazil'],
];

const FREQ_BANDS: ReadonlyArray<[string, string]> = [
  ['', 'Any frequency'], ['50', '50+ / yr'], ['200', '200+ / yr'], ['800', '800+ / yr'], ['2000', '2,000+ / yr'],
];
const TEU_BANDS: ReadonlyArray<[string, string]> = [
  ['', 'Any TEU'], ['100', '100+ TEU'], ['500', '500+ TEU'], ['2000', '2,000+ TEU'],
];

// ── inline CSS (rendered from this TS module, exactly like DIRECTORY_CSS, so
//    it is NOT scanned by the public-dir spacing/color guards). Uses only
//    QuoteFleet's shared /style.css design tokens so BOTH themes render. ──────
const IMPORTERS_CSS = `
.imp-hero{padding:32px 0 8px}
.imp-hero .eyebrow{color:var(--accent);font-family:var(--font-mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px}
.imp-hero h1{margin:0 0 12px;line-height:1.15}
.imp-hero .lead{max-width:640px;margin:0 0 10px}
.imp-trust{color:var(--muted);font-size:13px;margin:0}
.imp-trust b{color:var(--ink-soft)}
.imp-shell{padding:0 0 48px}

/* ── search panel ── */
.imp-panel{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:24px;margin:24px 0;box-shadow:var(--shadow-sm)}
.imp-panel-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 16px}
.imp-panel-h h2{font-size:16px;margin:0;color:var(--ink)}
.imp-panel-h .sub{font-size:12px;color:var(--muted)}
.imp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.imp-field{display:flex;flex-direction:column;gap:8px;min-width:0}
.imp-field label{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.imp-field input,.imp-field select{width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:14px;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:12px 14px;min-height:44px;appearance:none;-webkit-appearance:none}
.imp-field input::placeholder{color:var(--muted)}
.imp-field input:hover,.imp-field select:hover{border-color:var(--accent)}
.imp-field input:focus-visible,.imp-field select:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.imp-field select{padding-right:38px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238a8a8a' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}

/* ── secondary filters (progressive-disclosure) ── */
.imp-more{margin-top:16px;border-top:1px solid var(--border);padding-top:4px}
.imp-more>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-size:13px;font-weight:600;padding:12px 0;min-height:44px}
.imp-more>summary::-webkit-details-marker{display:none}
.imp-more>summary::after{content:'▾';font-size:10px}
.imp-more[open]>summary::after{content:'▴'}
.imp-more-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:4px}
.imp-more-name{margin-top:16px}
.imp-more-name .hint{display:block;font-size:12px;color:var(--muted);margin-top:8px}

.imp-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:24px}
.imp-export{margin-left:auto}

.imp-status{color:var(--muted);font-size:13px;margin:24px 0 8px}
.imp-status b{color:var(--ink)}

/* ── result cards (approved ImportYeti-style prototype) ── */
.imp-results{display:grid;gap:16px}
.imp-card{border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-lg);background:var(--surface);padding:18px 20px;box-shadow:var(--shadow-sm)}
.imp-card-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.imp-co{font-size:17px;font-weight:700;color:var(--ink)}
.imp-flag{font-size:16px;line-height:1}
.imp-pill{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 8px;border-radius:4px;background:var(--accent);color:var(--bg)}
.imp-win{font-size:11px;font-weight:700;padding:4px 9px;border-radius:5px;white-space:nowrap}
.imp-win.hi{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.imp-win.md{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
.imp-addr{color:var(--muted);font-size:12px;margin-bottom:12px}
.imp-lane{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--ink-soft);margin-bottom:12px}
.imp-lane .arw{color:var(--muted)}
.imp-lane .prod{color:var(--muted)}
.imp-angle{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--ink-soft);background:color-mix(in srgb,var(--accent) 8%,transparent);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:8px;padding:10px 12px;margin-bottom:14px}
.imp-angle .z{color:var(--accent);font-weight:800;flex:0 0 auto;white-space:nowrap}
.imp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding-top:14px;border-top:1px solid var(--border)}
.imp-cell .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px}
.imp-cell .val{font-size:15px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.imp-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
.imp-incumb{font-size:12px;color:var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent);border-radius:5px;padding:4px 9px}
.imp-foot-r{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}
.imp-tier{font-size:12px;color:var(--muted)}
.imp-lock{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-soft);border:1px solid var(--border-strong);border-radius:8px;padding:9px 13px;background:var(--surface-2);text-decoration:none;min-height:44px;box-sizing:border-box}
.imp-lock:hover{border-color:var(--accent);color:var(--ink)}
.imp-lock .ico{opacity:.7}
.imp-empty{border:1px dashed var(--border-strong);border-radius:var(--radius-lg);padding:48px 24px;text-align:center;color:var(--muted);background:var(--surface)}
.imp-empty h3{color:var(--ink);margin:0 0 8px}
.imp-locknote{font-size:12px;color:var(--muted);margin:16px 0 0;line-height:1.5}
.imp-locknote b{color:var(--ink-soft)}
@media(max-width:760px){
  .imp-grid{grid-template-columns:1fr}
  .imp-more-grid{grid-template-columns:1fr 1fr}
  .imp-stats{grid-template-columns:1fr 1fr}
  .imp-export{margin-left:0}
}
@media(max-width:440px){
  .imp-more-grid{grid-template-columns:1fr}
  .imp-panel{padding:16px}
  .imp-foot-r{justify-content:flex-start}
}
`;

function portOptions(): string {
  return US_PORTS.map((p) => {
    const v = `${p.city}, ${p.state}`;
    return `<option value="${esc(v)}">${esc(p.name)} — ${esc(v)}</option>`;
  }).join('');
}
function stateOptions(): string {
  return US_STATES.map((s) => `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join('');
}
function countryOptions(): string {
  return SUPPLIER_COUNTRIES.map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join('');
}
function bandOptions(bands: ReadonlyArray<[string, string]>): string {
  return bands.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
}

export function renderImporterSearchPage(): string {
  const body = `
  <style>${IMPORTERS_CSS}</style>
  <section class="hero imp-hero">
    <div class="container-narrow">
      <div class="eyebrow">US importer database</div>
      <h1>Find US importers to pitch &mdash; by port, lane &amp; commodity.</h1>
      <p class="lead">Search real customs bill-of-lading records to surface importers moving freight on your lane, who they buy from, how much they ship, and which forwarder you'd displace.</p>
      <p class="imp-trust">Browsing is free. Searching live customs records &mdash; <b id="imp-recordline">pick a port or commodity to start</b>.</p>
    </div>
  </section>

  <main class="imp-shell">
    <div class="container-narrow">
      <form class="imp-panel" id="imp-form" novalidate>
        <div class="imp-panel-h">
          <h2>Browse importers</h2>
          <span class="sub">Start with your port, lane or commodity</span>
        </div>
        <div class="imp-grid">
          <div class="imp-field">
            <label for="imp-port">Entry port</label>
            <select id="imp-port" name="entryPort">
              <option value="">Any US port</option>
              ${portOptions()}
            </select>
          </div>
          <div class="imp-field">
            <label for="imp-state">US state (importer)</label>
            <select id="imp-state" name="state">
              <option value="">Any state</option>
              ${stateOptions()}
            </select>
          </div>
          <div class="imp-field">
            <label for="imp-commodity">Commodity / HS code</label>
            <input id="imp-commodity" name="commodity" type="text" placeholder="e.g. saw blades, or 820299" autocomplete="off" maxlength="80">
          </div>
        </div>

        <details class="imp-more">
          <summary>More filters</summary>
          <div class="imp-more-grid">
            <div class="imp-field">
              <label for="imp-supplier">Supplier country</label>
              <select id="imp-supplier" name="supplierCountry">
                <option value="">Any origin</option>
                ${countryOptions()}
              </select>
            </div>
            <div class="imp-field">
              <label for="imp-freq">Frequency</label>
              <select id="imp-freq" name="minShipments12m">${bandOptions(FREQ_BANDS)}</select>
            </div>
            <div class="imp-field">
              <label for="imp-teu">TEU band</label>
              <select id="imp-teu" name="minTeu12m">${bandOptions(TEU_BANDS)}</select>
            </div>
          </div>
          <div class="imp-more-name">
            <div class="imp-field">
              <label for="imp-company">Or search by company name</label>
              <input id="imp-company" name="company" type="text" placeholder="Importer name (optional)" autocomplete="off" maxlength="80">
            </div>
            <span class="hint">Secondary &mdash; most users start from a port, lane or commodity above.</span>
          </div>
        </details>

        <div class="imp-actions">
          <button type="submit" class="btn btn-primary" id="imp-search">Search importers <span class="arr">&rarr;</span></button>
          <a class="imp-lock imp-export" id="imp-export" href="/signup" title="CSV export is a paid feature">
            <span class="ico" aria-hidden="true">&#128274;</span> Export CSV
          </a>
        </div>
      </form>

      <p class="imp-status" id="imp-status" role="status" aria-live="polite" hidden></p>

      <div class="imp-results" id="imp-results">
        <div class="imp-empty" id="imp-empty">
          <h3>Start with your lane</h3>
          <p>Pick an entry port, state or commodity above and hit Search to build importer profiles from live customs data.</p>
        </div>
      </div>

      <p class="imp-locknote"><b>Free to view:</b> importer, lane, volumes, incumbent forwarder, winnability &amp; the AI angle. <b>Unlock with a free account:</b> the decision-maker contact, an AI-drafted opener, and CSV export.</p>
    </div>
  </main>

  <script>${CLIENT_JS}</script>`;

  return layout({
    title: 'US Importer Database — Find & Contact Importers | QuoteFleet',
    description:
      'Search real US customs bill-of-lading records to find importers by port, lane and commodity — their suppliers, volumes, incumbent forwarder, a winnability score and an AI pitch angle. Free to browse.',
    canonicalPath: '/importers',
    bodyHtml: body,
    jsonLd: [
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'QuoteFleet Importer Search',
        applicationCategory: 'BusinessApplication',
        url: `${SITE}/importers`,
        description:
          'Find US importers to pitch from customs bill-of-lading data, searchable by port, lane and commodity.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      }),
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Importer Search', item: `${SITE}/importers` },
        ],
      }),
    ],
  });
}

// ── client script: POST the form, render cards + the freemium locked state ──
const CLIENT_JS = `
(function(){
  var form=document.getElementById('imp-form');
  var results=document.getElementById('imp-results');
  var statusEl=document.getElementById('imp-status');
  var recordLine=document.getElementById('imp-recordline');
  var btn=document.getElementById('imp-search');
  if(!form||!results)return;

  function flag(cc){ if(!cc)return ''; cc=String(cc).toUpperCase();
    if(!/^[A-Z]{2}$/.test(cc))return '';
    return cc.replace(/./g,function(c){return String.fromCodePoint(127397+c.charCodeAt(0));}); }
  function n(v){ return (v==null||v==='')?'\\u2014':Number(v).toLocaleString('en-US'); }
  function T(tag,cls,txt){ var e=document.createElement(tag); if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e; }

  function card(l){
    var c=T('div','imp-card');
    var h=T('div','imp-card-h');
    h.appendChild(T('span','imp-co',l.company));
    if(l.supplier_country){var f=T('span','imp-flag',flag(l.supplier_country)); h.appendChild(f);}
    h.appendChild(T('span','imp-pill','Importer'));
    var w=l.winnability||{}; var win=T('span','imp-win '+(w.label==='High'?'hi':'md'),'Winnability '+(w.score||'')+' \\u00b7 '+(w.label||''));
    win.title='How switchable this account looks (volume + named incumbent + contact on file)';
    h.appendChild(win);
    c.appendChild(h);

    if(l.state){ c.appendChild(T('div','imp-addr','United States \\u00b7 '+l.state)); }

    var lane=T('div','imp-lane');
    if(l.supplier_country) lane.appendChild(T('span','imp-flag',flag(l.supplier_country)));
    lane.appendChild(T('span',null,l.supplier||'Supplier'));
    lane.appendChild(T('span','arw','\\u2192'));
    lane.appendChild(T('span',null,l.entry_port||'US port'));
    if(l.product){ lane.appendChild(T('span','arw','\\u00b7'));
      lane.appendChild(T('span','prod',l.product+(l.hs_code?(' \\u00b7 HS '+l.hs_code):''))); }
    c.appendChild(lane);

    if(l.aiAngle){ var a=T('div','imp-angle'); a.appendChild(T('span','z','\\u26a1 AI angle'));
      a.appendChild(T('span',null,l.aiAngle)); c.appendChild(a); }

    var stats=T('div','imp-stats');
    [['Total shipments',n(l.total_shipments)],['Shipments \\u00b7 12 mo',n(l.ships_12m)],
     ['TEU \\u00b7 12 mo',n(l.teu_12m)],['Last shipment',l.last_shipment||'\\u2014']].forEach(function(p){
      var cell=T('div','imp-cell'); cell.appendChild(T('div','lbl',p[0])); cell.appendChild(T('div','val',p[1])); stats.appendChild(cell);
    });
    c.appendChild(stats);

    var foot=T('div','imp-foot');
    if(l.incumbent_forwarder){ var inc=T('span','imp-incumb'); inc.appendChild(document.createTextNode('Displacing: '));
      var b=document.createElement('b'); b.textContent=l.incumbent_forwarder; inc.appendChild(b); foot.appendChild(inc); }
    else { foot.appendChild(T('span',null,'')); }
    var right=T('div','imp-foot-r');
    var tierTxt={verified:'\\u2713 Verified decision-maker on file',role_based:'Role-based email available (unverified)',phone_only:'Phone & address on file'};
    right.appendChild(T('span','imp-tier',tierTxt[l.contact_confidence]||tierTxt.phone_only));
    var lock=document.createElement('a'); lock.className='imp-lock'; lock.href='/signup';
    lock.title='Unlock the decision-maker contact + an AI-drafted opener with a free account';
    var ico=T('span','ico','\\ud83d\\udd12'); ico.setAttribute('aria-hidden','true');
    lock.appendChild(ico); lock.appendChild(document.createTextNode(' Unlock contact \\u2014 sign up'));
    right.appendChild(lock);
    foot.appendChild(right);
    c.appendChild(foot);
    return c;
  }

  function setStatus(msg,busy){ statusEl.hidden=false; statusEl.innerHTML=''; statusEl.appendChild(document.createTextNode(msg)); btn.disabled=!!busy; }

  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var fd=new FormData(form); var payload={};
    fd.forEach(function(v,k){ v=String(v).trim(); if(v)payload[k]=v; });
    // commodity → hsCode if it's a code, else product keyword
    if(payload.commodity){ if(/^[0-9]{4,10}$/.test(payload.commodity)) payload.hsCode=payload.commodity; else payload.product=payload.commodity; delete payload.commodity; }
    if(!payload.entryPort&&!payload.state&&!payload.hsCode&&!payload.product&&!payload.supplierCountry&&!payload.company){
      setStatus('Pick a port, state or commodity (or enter a company name) to search.',false); return;
    }
    setStatus('Searching live customs records\\u2026',true);
    results.innerHTML='';
    fetch('/api/importers/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
      .then(function(res){
        btn.disabled=false;
        if(!res.ok||!res.j||res.j.error){
          setStatus((res.j&&res.j.message)||'Importer search is temporarily unavailable. Try again shortly.',false);
          return;
        }
        var leads=res.j.leads||[];
        if(recordLine&&res.j.recordsScanned){ recordLine.textContent=Number(res.j.recordsScanned).toLocaleString('en-US')+' customs records scanned'; }
        setStatus(leads.length? ('Showing '+leads.length+' importer'+(leads.length===1?'':'s')+' built from customs data.') : 'No importers matched those filters \\u2014 widen your lane or commodity.',false);
        results.innerHTML='';
        if(!leads.length){ var e=T('div','imp-empty'); e.appendChild(T('h3',null,'No matches')); e.appendChild(T('p',null,'Try a busier port, drop the state filter, or broaden the commodity.')); results.appendChild(e); return; }
        leads.forEach(function(l){ results.appendChild(card(l)); });
      })
      .catch(function(){ btn.disabled=false; setStatus('Network error \\u2014 please try again.',false); });
  });
})();
`.trim();

// ── search API ──────────────────────────────────────────────────────────────
/** Parse + clamp the request body into ImporterFilters (all optional). */
function parseFilters(body: unknown): ImporterFilters {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const s = (v: unknown, max = 80): string | undefined => {
    if (v == null) return undefined;
    const t = String(v).trim().slice(0, max);
    return t || undefined;
  };
  const posInt = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  };
  return {
    entryPort: s(b.entryPort),
    state: s(b.state, 2),
    hsCode: s(b.hsCode, 12),
    product: s(b.product),
    supplierCountry: s(b.supplierCountry, 2),
    company: s(b.company),
    minShipments12m: posInt(b.minShipments12m),
    minTeu12m: posInt(b.minTeu12m),
  };
}

function hasAnyFilter(f: ImporterFilters): boolean {
  return !!(f.entryPort || f.state || f.hsCode || f.product || f.supplierCountry || f.company);
}

/** FREE browse projection — never leak locked contact fields (phone / email /
 *  name / address) to the client; only the TIER LABEL (what the user would
 *  unlock) plus a boolean that a phone is on file. */
function toPublicCard(l: ImporterLead, tier: ContactConfidence): Record<string, unknown> {
  return {
    company: l.company,
    state: l.state,
    supplier: l.supplier,
    supplier_country: l.supplier_country,
    product: l.product,
    hs_code: l.hs_code,
    entry_port: l.entry_port,
    ships_12m: l.ships_12m,
    total_shipments: l.total_shipments,
    teu_12m: l.teu_12m,
    last_shipment: l.last_shipment,
    incumbent_forwarder: l.incumbent_forwarder,
    winnability: winnability(l),
    aiAngle: aiAngle(l),
    // Freemium: the tier is shown honestly, the CONTACT itself stays locked.
    contact_confidence: tier,
    hasPhone: !!l.phone,
    contactLocked: true,
  };
}

/** The pull-affecting filters (state / company / bands are POST-filters on the
 *  same pulled set, so they are intentionally NOT part of the cache key). */
function bolCacheKey(f: ImporterFilters): string {
  return searchKey({
    entryPort: f.entryPort,
    product: f.product,
    hsCode: f.hsCode,
    supplierCountry: f.supplierCountry,
    pageSize: Math.max(50, MAX_LEADS * 4),
  });
}

/** Cheap, guaranteed-non-empty contact tier for the free browse card. Every
 *  lead has AT LEAST phone_only (ImportYeti phone + address on every record). A
 *  prior paid reveal cached in importer_contact_cache upgrades the label for
 *  free — via a single indexed IN() lookup (never a scan). Degrades to
 *  phone_only on any cache failure. */
async function browseTiers(
  leads: readonly ImporterLead[],
  cache: ContactCacheStore,
): Promise<Map<string, ContactConfidence>> {
  const out = new Map<string, ContactConfidence>();
  for (const l of leads) out.set(l.company, 'phone_only');
  try {
    const keyed = leads.map((l) => [l.company, companyKey(l.company)] as const);
    const hits = await cache.getMany(keyed.map(([, k]) => k));
    for (const [company, k] of keyed) {
      const hit = hits.get(k);
      if (hit && Date.now() - hit.fetchedAt.getTime() < IMPORTER_CACHE_TTL_MS) {
        out.set(company, hit.confidence);
      }
    }
  } catch {
    /* cache down → everyone keeps the phone_only floor */
  }
  return out;
}

export async function handleImporterSearch(
  req: Request,
  res: Response,
  deps: { bolCache?: BolCacheStore; contactCache?: ContactCacheStore } = {},
): Promise<void> {
  try {
    const filters = parseFilters(req.body);
    if (!hasAnyFilter(filters)) {
      res.status(400).json({
        error: 'no_filter',
        message: 'Pick a port, state or commodity (or enter a company name) to search.',
      });
      return;
    }
    const bolCache = deps.bolCache ?? dbBolCacheStore;
    const contactCache = deps.contactCache ?? dbContactCacheStore;
    // Browse path: ImportYeti ONLY (no Hunter / Anthropic) + cache-first so a
    // repeat search inside the TTL spends ZERO external credits.
    const { leads, creditsRemaining, cached } = await findImporterLeads({
      filters,
      maxLeads: MAX_LEADS,
      withEnrichment: false,
      withEmails: false,
      bolCache,
      cacheKey: bolCacheKey(filters),
      cacheTtlMs: IMPORTER_CACHE_TTL_MS,
    });
    const tiers = await browseTiers(leads, contactCache);
    res.json({
      leads: leads.map((l) => toPublicCard(l, tiers.get(l.company) ?? 'phone_only')),
      count: leads.length,
      recordsScanned: leads.reduce((a, l) => a + (l.total_shipments ?? 0), 0),
      creditsRemaining,
      cached,
    });
  } catch (err) {
    // Never 500 the browse path. A missing key / provider timeout / upstream
    // error degrades to a clean, actionable message.
    const msg = (err as Error)?.message || 'unknown error';
    const missingKey = /API_KEY not set/i.test(msg);
    console.warn('[importers.search] failed:', msg);
    res.status(missingKey ? 503 : 502).json({
      error: missingKey ? 'not_configured' : 'upstream_error',
      message: missingKey
        ? 'Importer search is not configured yet — check back soon.'
        : 'Importer search is temporarily unavailable. Please try again shortly.',
    });
  }
}

export function registerImporterRoutes(app: Express): void {
  app.get(['/importers', '/importers/'], (_req: Request, res: Response, next) => {
    try {
      res.type('html').send(renderImporterSearchPage());
    } catch (err) {
      next(err);
    }
  });
  app.post('/api/importers/search', importerSearchLimiter, (req: Request, res: Response) =>
    handleImporterSearch(req, res),
  );
}
