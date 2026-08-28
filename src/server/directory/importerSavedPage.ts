/**
 * Server-rendered "Saved importers" page (/importers/saved) for the broker
 * workflow. Styles + client JS are inlined in this TS module (exactly like
 * importerPages / DIRECTORY_CSS) so the public-dir spacing/color guards never
 * scan them; every color/space uses the shared /style.css design tokens so both
 * themes render. Anonymous callers get a sign-in prompt; a logged-in user gets
 * their saved importers with an editable note + pipeline status per row.
 */
import { layout, esc } from './pages.js';
import type { SavedImporter } from './importerSavedStore.js';
import { IMPORTER_SAVED_STATUSES } from '../routes/importerSaved.js';

const N = (v: number | null | undefined): string => (v == null ? '—' : Number(v).toLocaleString('en-US'));

const SAVED_CSS = `
.imps-shell{padding:24px 0 64px}
/* A working lead list needs the same canvas as the search results, not the
   shared 780px prose container. */
.imps-shell .container-narrow{max-width:1080px}
.imps-head{margin:8px 0 6px}
.imps-head h1{font-size:28px;line-height:1.14;margin:0;color:var(--ink);letter-spacing:-.02em}
.imps-lead{color:var(--muted);font-size:14px;margin:8px 0 0;line-height:1.5}
.imps-lead a{color:var(--accent);text-decoration:none}
.imps-lead a:hover{text-decoration:underline}
.imps-back{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;margin:0 0 4px;text-decoration:none;border-radius:4px}
.imps-back:hover{color:var(--accent)}
.imps-back:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

/* pipeline summary — counts per stage, so the list reads as a funnel */
.imps-pipe{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 0;padding:0;list-style:none}
.imps-pipe li{display:inline-flex;align-items:baseline;gap:7px;font-size:12px;font-weight:600;color:var(--ink-soft);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:6px 13px}
.imps-pipe li b{font-size:14px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.imps-pipe li .dt{width:7px;height:7px;border-radius:50%;background:var(--muted-soft,var(--muted));align-self:center}
.imps-pipe li[data-k="new"] .dt{background:var(--accent)}
.imps-pipe li[data-k="contacted"] .dt{background:var(--warn)}
.imps-pipe li[data-k="quoted"] .dt{background:var(--accent-strong,var(--accent))}
.imps-pipe li[data-k="won"] .dt{background:var(--success)}

.imps-grid{display:grid;gap:12px;margin-top:18px}
.imps-card{position:relative;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:15px 18px;box-shadow:var(--shadow-sm);overflow:hidden;transition:border-color .16s ease,box-shadow .16s ease}
.imps-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent)}
.imps-card:hover{border-color:color-mix(in srgb,var(--accent) 42%,var(--border));box-shadow:var(--shadow-md)}
.imps-card:focus-within{border-color:var(--accent)}
.imps-card-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.imps-co{font-size:16px;font-weight:700;color:var(--ink);letter-spacing:-.012em}
a.imps-co-link{color:var(--accent);text-decoration:none;border-radius:4px}
a.imps-co-link:hover{text-decoration:underline;text-underline-offset:3px}
a.imps-co-link:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
/* current stage, read at a glance without opening the select */
.imps-chip{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:3px 10px;color:var(--muted);background:var(--surface-2);border:1px solid var(--border-strong)}
.imps-chip[data-k="new"]{color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-color:color-mix(in srgb,var(--accent) 32%,transparent)}
.imps-chip[data-k="contacted"]{color:var(--warn);background:color-mix(in srgb,var(--warn) 13%,transparent);border-color:color-mix(in srgb,var(--warn) 32%,transparent)}
.imps-chip[data-k="quoted"]{color:var(--accent-strong,var(--accent));background:color-mix(in srgb,var(--accent) 10%,transparent);border-color:color-mix(in srgb,var(--accent) 28%,transparent)}
.imps-chip[data-k="won"]{color:var(--success);background:color-mix(in srgb,var(--success) 13%,transparent);border-color:color-mix(in srgb,var(--success) 32%,transparent)}
.imps-since{color:var(--muted);font-size:12px;margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}
/* stretch, not start: the note grows to the height of the status + actions
   column so the card never ends with a band of dead space under one side. */
.imps-row{display:grid;grid-template-columns:minmax(0,1fr) 224px;gap:12px 16px;align-items:stretch}
.imps-note{min-width:0;display:flex;flex-direction:column;gap:6px}
.imps-note textarea{flex:1 1 auto}
.imps-side{display:flex;flex-direction:column;gap:8px;min-width:0}
.imps-side .imps-actions{margin-top:auto}
/* Title-in-field: the field's own label is its placeholder, help sits top-left. */
.imps-field .imps-hint{font-size:11.5px;color:var(--muted);display:block;margin:0 0 6px}
.imps-note textarea{width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:14px;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:10px 12px;min-height:76px;resize:vertical;line-height:1.55}
.imps-note textarea::placeholder{color:var(--muted)}
.imps-note textarea:hover{border-color:var(--accent)}
.imps-note textarea:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.imps-status-sel{width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:14px;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:10px 12px;min-height:44px;appearance:none;-webkit-appearance:none;cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 16px) calc(50% + 1px),calc(100% - 11px) calc(50% + 1px);background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:34px}
.imps-status-sel:hover{border-color:var(--accent)}
.imps-status-sel:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.imps-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.imps-actions>*{flex:1 1 auto;justify-content:center}
.imps-open{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--ink-soft);border:1px solid var(--border-strong);border-radius:8px;padding:9px 13px;background:var(--surface-2);text-decoration:none;min-height:44px;box-sizing:border-box;transition:border-color .14s,color .14s}
.imps-open:hover{border-color:var(--accent);color:var(--ink)}
.imps-open:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.imps-remove{display:inline-flex;align-items:center;font-family:var(--font-sans);font-size:13px;font-weight:600;color:var(--ink-soft);background:none;border:1px solid var(--border-strong);border-radius:8px;padding:9px 13px;min-height:44px;box-sizing:border-box;cursor:pointer;transition:border-color .14s,color .14s}
.imps-remove:hover{border-color:var(--warn);color:var(--warn)}
.imps-remove:focus-visible{outline:2px solid var(--warn);outline-offset:2px}
.imps-saved-note{font-size:11.5px;color:var(--muted);min-height:15px;line-height:15px}
.imps-saved-note.ok{color:var(--success)}

.imps-empty{display:flex;gap:16px;align-items:flex-start;border:1px dashed var(--border-strong);border-radius:var(--radius-lg);padding:32px 28px;text-align:left;color:var(--muted);background:var(--surface);max-width:720px;margin-top:20px}
.imps-empty-ico{flex:0 0 auto;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;font-size:20px;line-height:1;background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 26%,transparent)}
.imps-empty-b{min-width:0}
.imps-empty h2{color:var(--ink);margin:0 0 6px;font-size:18px;letter-spacing:-.015em}
.imps-empty p{margin:0 0 16px;line-height:1.6;font-size:13.5px;max-width:56ch}
.imps-empty-act{display:flex;gap:10px;flex-wrap:wrap}
.imps-cta{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;text-decoration:none;background:var(--accent);color:var(--bg);min-height:44px;box-sizing:border-box}
.imps-cta:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.imps-cta.secondary{background:var(--surface-2);color:var(--ink);border:1px solid var(--border-strong)}
.imps-cta.secondary:hover{border-color:var(--accent)}
@media(max-width:720px){.imps-row{grid-template-columns:1fr}}
@media(max-width:560px){
  /* No-orphan wrap: four stage pills pair 2x2 rather than leaving one alone. */
  .imps-pipe{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .imps-pipe li{justify-content:center}
  .imps-empty-act>*{flex:1 1 100%;justify-content:center}
}
@media(max-width:440px){.imps-empty{flex-direction:column;padding:24px 20px}.imps-since{margin-left:0;width:100%}}
`;

function statusOptions(current: string | null): string {
  const opts = [['', 'No status'], ...IMPORTER_SAVED_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])];
  return opts
    .map(([v, l]) => `<option value="${esc(v)}"${(current ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`)
    .join('');
}

function statusLabel(status: string | null): string {
  const s = (status ?? '').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'No status';
}

function savedCard(s: SavedImporter): string {
  const since = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const k = (s.status ?? '').trim();
  return `
  <div class="imps-card" data-slug="${esc(s.slug)}">
    <div class="imps-card-h">
      <a class="imps-co imps-co-link" href="/importers/company/${esc(encodeURIComponent(s.slug))}">${esc(s.company)}</a>
      <span class="imps-chip" data-k="${esc(k)}" data-chip>${esc(statusLabel(s.status))}</span>
      ${since ? `<span class="imps-since">Saved ${esc(since)}</span>` : ''}
    </div>
    <div class="imps-row">
      <div class="imps-note imps-field">
        <span class="imps-hint" id="notehint-${esc(s.slug)}">Saves as you type</span>
        <textarea id="note-${esc(s.slug)}" data-note aria-label="Note for ${esc(s.company)}" aria-describedby="notehint-${esc(s.slug)}" placeholder="Note — incumbent, target rate, who you spoke to…">${esc(s.note ?? '')}</textarea>
        <span class="imps-saved-note" data-savenote aria-live="polite"></span>
      </div>
      <div class="imps-side">
        <div class="imps-field">
          <span class="imps-hint">Pipeline status</span>
          <select id="status-${esc(s.slug)}" class="imps-status-sel" data-status aria-label="Pipeline status for ${esc(s.company)}">${statusOptions(s.status)}</select>
        </div>
        <div class="imps-actions">
          <a class="imps-open" href="/importers/company/${esc(encodeURIComponent(s.slug))}">Open profile</a>
          <button type="button" class="imps-remove" data-remove>Remove</button>
        </div>
      </div>
    </div>
  </div>`;
}

/** Pipeline summary: a count per stage across the saved list. */
function pipelineStrip(saved: SavedImporter[]): string {
  const stages: Array<[string, string]> = [['', 'No status'], ...IMPORTER_SAVED_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)] as [string, string])];
  const items = stages
    .map(([k, label]) => {
      const n = saved.filter((s) => (s.status ?? '') === k).length;
      return n ? `<li data-k="${esc(k)}"><span class="dt" aria-hidden="true"></span><b>${N(n)}</b> ${esc(label)}</li>` : '';
    })
    .filter(Boolean)
    .join('');
  return items ? `<ul class="imps-pipe">${items}</ul>` : '';
}

export function renderSavedImportersPage(opts: { loggedIn: boolean; saved: SavedImporter[] }): string {
  const { loggedIn, saved } = opts;
  let inner: string;
  if (!loggedIn) {
    inner = `
    <div class="imps-empty">
      <span class="imps-empty-ico" aria-hidden="true">&#128274;</span>
      <div class="imps-empty-b">
        <h2>Sign in to see your saved importers</h2>
        <p>Save importers from the <a href="/importers">importer search</a> or any company profile to build a lead list with notes and a pipeline status you can revisit anytime.</p>
        <div class="imps-empty-act">
          <a class="imps-cta" href="/login">Sign in</a>
          <a class="imps-cta secondary" href="/signup">Create a free account</a>
        </div>
      </div>
    </div>`;
  } else if (!saved.length) {
    inner = `
    <div class="imps-empty">
      <span class="imps-empty-ico" aria-hidden="true">&#9734;</span>
      <div class="imps-empty-b">
        <h2>No saved importers yet</h2>
        <p>Use <strong>&#9734; Save</strong> on any importer in the <a href="/importers">search results</a> or on a company profile to add it here, then track it with a note and a pipeline status.</p>
        <div class="imps-empty-act">
          <a class="imps-cta" href="/importers">Find importers <span aria-hidden="true">&rarr;</span></a>
        </div>
      </div>
    </div>`;
  } else {
    inner = `${pipelineStrip(saved)}<div class="imps-grid" id="imps-grid">${saved.map(savedCard).join('')}</div>`;
  }

  const body = `
  <style>${SAVED_CSS}</style>
  <main class="imps-shell">
    <div class="container-narrow">
      <a class="imps-back" href="/importers">&larr; Back to importer search</a>
      <div class="imps-head">
        <h1>Saved importers</h1>
        <p class="imps-lead">${loggedIn ? `${N(saved.length)} saved importer${saved.length === 1 ? '' : 's'} — add a note and a pipeline status to work your leads.` : 'Your saved importer lead list.'}</p>
      </div>
      ${inner}
    </div>
  </main>
  ${loggedIn && saved.length ? `<script>${SAVED_JS}</script>` : ''}`;

  return layout({
    title: 'Saved importers | QuoteFleet',
    description: 'Your saved importer leads on QuoteFleet — notes and pipeline status for importers you plan to pitch.',
    canonicalPath: '/importers/saved',
    bodyHtml: body,
  });
}

// ── client JS: inline note/status save (debounced) + remove ──────────────────
const SAVED_JS = `
(function(){
  var grid=document.getElementById('imps-grid');
  if(!grid)return;
  function patch(slug,payload,noteEl){
    if(noteEl){ noteEl.className='imps-saved-note'; noteEl.textContent='Saving\\u2026'; }
    fetch('/api/importers/saved/'+encodeURIComponent(slug),{method:'PATCH',
      headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){ return r.json().then(function(j){return {ok:r.ok,j:j};}); })
      .then(function(o){ if(noteEl){ if(o.ok){ noteEl.className='imps-saved-note ok'; noteEl.textContent='Saved'; setTimeout(function(){noteEl.textContent='';noteEl.className='imps-saved-note';},1600); }
        else { noteEl.textContent=(o.j&&o.j.reason==='needs-account')?'Please sign in again':'Could not save'; } } })
      .catch(function(){ if(noteEl){ noteEl.textContent='Network error'; } });
  }
  var cards=grid.querySelectorAll('.imps-card');
  for(var i=0;i<cards.length;i++){ (function(card){
    var slug=card.getAttribute('data-slug');
    var note=card.querySelector('[data-note]');
    var status=card.querySelector('[data-status]');
    var saveNote=card.querySelector('[data-savenote]');
    var removeBtn=card.querySelector('[data-remove]');
    var noteTimer=null; var lastNote=note?note.value:'';
    if(note){ note.addEventListener('input',function(){ if(noteTimer)clearTimeout(noteTimer);
      noteTimer=setTimeout(function(){ if(note.value===lastNote)return; lastNote=note.value; patch(slug,{note:note.value},saveNote); },700); });
      note.addEventListener('blur',function(){ if(noteTimer)clearTimeout(noteTimer); if(note.value===lastNote)return; lastNote=note.value; patch(slug,{note:note.value},saveNote); }); }
    var chip=card.querySelector('[data-chip]');
    if(status){ status.addEventListener('change',function(){
      // Keep the at-a-glance stage chip in sync with the select.
      if(chip){ var v=status.value;
        chip.setAttribute('data-k', v);
        chip.textContent = v ? (v.charAt(0).toUpperCase()+v.slice(1)) : 'No status'; }
      patch(slug,{status:status.value},saveNote); }); }
    if(removeBtn){ removeBtn.addEventListener('click',function(){
      removeBtn.disabled=true;
      fetch('/api/importers/saved/'+encodeURIComponent(slug),{method:'DELETE',headers:{'Accept':'application/json'}})
        .then(function(r){ if(r.ok){ card.parentNode.removeChild(card); if(!grid.querySelector('.imps-card')){ location.reload(); } }
          else { removeBtn.disabled=false; } })
        .catch(function(){ removeBtn.disabled=false; });
    }); }
  })(cards[i]); }
})();
`.trim();
