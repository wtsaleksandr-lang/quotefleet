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
.imps-head{margin:8px 0 6px}
.imps-head h1{font-size:26px;line-height:1.15;margin:0;color:var(--ink);letter-spacing:-.015em}
.imps-lead{color:var(--muted);font-size:14px;margin:8px 0 0;line-height:1.5}
.imps-lead a{color:var(--accent);text-decoration:none}
.imps-lead a:hover{text-decoration:underline}
.imps-back{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;margin:0 0 4px;text-decoration:none}
.imps-back:hover{color:var(--accent)}

.imps-grid{display:grid;gap:14px;margin-top:20px}
.imps-card{border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-lg);background:var(--surface);padding:16px 18px;box-shadow:var(--shadow-sm)}
.imps-card-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.imps-co{font-size:16px;font-weight:700;color:var(--ink)}
a.imps-co-link{color:var(--accent);text-decoration:none}
a.imps-co-link:hover{text-decoration:underline}
.imps-since{color:var(--muted);font-size:12px;margin-left:auto}
.imps-row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
.imps-note{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:8px}
.imps-side{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;min-width:180px}
.imps-field label{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;display:block;margin-bottom:6px}
.imps-note textarea{width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:14px;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:10px 12px;min-height:64px;resize:vertical;line-height:1.5}
.imps-note textarea:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.imps-status-sel{width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:14px;color:var(--ink);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:10px 12px;min-height:44px;appearance:none;-webkit-appearance:none}
.imps-status-sel:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.imps-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:2px}
.imps-open{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--ink-soft);border:1px solid var(--border-strong);border-radius:8px;padding:9px 13px;background:var(--surface-2);text-decoration:none;min-height:44px;box-sizing:border-box}
.imps-open:hover{border-color:var(--accent);color:var(--ink)}
.imps-remove{font-family:var(--font-sans);font-size:13px;font-weight:600;color:var(--warn);background:none;border:1px solid var(--border-strong);border-radius:8px;padding:9px 13px;min-height:44px;cursor:pointer}
.imps-remove:hover{border-color:var(--warn)}
.imps-saved-note{font-size:12px;color:var(--muted);min-height:16px}
.imps-saved-note.ok{color:var(--accent)}

.imps-empty{border:1px dashed var(--border-strong);border-radius:var(--radius-lg);padding:40px 24px;text-align:left;color:var(--muted);background:var(--surface);max-width:620px}
.imps-empty h2{color:var(--ink);margin:0 0 8px;font-size:18px}
.imps-empty p{margin:0 0 16px;line-height:1.55}
.imps-cta{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;text-decoration:none;background:var(--accent);color:var(--bg);min-height:44px;box-sizing:border-box}
.imps-cta.secondary{background:var(--surface-2);color:var(--ink);border:1px solid var(--border-strong)}
@media(max-width:640px){.imps-side{min-width:0;flex:1 1 100%}}
`;

function statusOptions(current: string | null): string {
  const opts = [['', 'No status'], ...IMPORTER_SAVED_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])];
  return opts
    .map(([v, l]) => `<option value="${esc(v)}"${(current ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`)
    .join('');
}

function savedCard(s: SavedImporter): string {
  const since = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  return `
  <div class="imps-card" data-slug="${esc(s.slug)}">
    <div class="imps-card-h">
      <a class="imps-co imps-co-link" href="/importers/company/${esc(encodeURIComponent(s.slug))}">${esc(s.company)}</a>
      ${since ? `<span class="imps-since">Saved ${esc(since)}</span>` : ''}
    </div>
    <div class="imps-row">
      <div class="imps-note imps-field">
        <label for="note-${esc(s.slug)}">Note</label>
        <textarea id="note-${esc(s.slug)}" data-note placeholder="Add a note — incumbent, target rate, who you spoke to…">${esc(s.note ?? '')}</textarea>
        <span class="imps-saved-note" data-savenote aria-live="polite"></span>
      </div>
      <div class="imps-side">
        <div class="imps-field">
          <label for="status-${esc(s.slug)}">Status</label>
          <select id="status-${esc(s.slug)}" class="imps-status-sel" data-status>${statusOptions(s.status)}</select>
        </div>
        <div class="imps-actions">
          <a class="imps-open" href="/importers/company/${esc(encodeURIComponent(s.slug))}">Open profile</a>
          <button type="button" class="imps-remove" data-remove>Remove</button>
        </div>
      </div>
    </div>
  </div>`;
}

export function renderSavedImportersPage(opts: { loggedIn: boolean; saved: SavedImporter[] }): string {
  const { loggedIn, saved } = opts;
  let inner: string;
  if (!loggedIn) {
    inner = `
    <div class="imps-empty">
      <h2>Sign in to see your saved importers</h2>
      <p>Save importers from the <a href="/importers">importer search</a> or any company profile to build a lead list with notes and a pipeline status you can revisit anytime.</p>
      <a class="imps-cta" href="/login">Sign in</a>
      <a class="imps-cta secondary" href="/signup">Create a free account</a>
    </div>`;
  } else if (!saved.length) {
    inner = `
    <div class="imps-empty">
      <h2>No saved importers yet</h2>
      <p>Use <strong>&#9734; Save</strong> on any importer in the <a href="/importers">search results</a> or on a company profile to add it here, then track it with a note and a pipeline status.</p>
      <a class="imps-cta" href="/importers">Find importers <span aria-hidden="true">&rarr;</span></a>
    </div>`;
  } else {
    inner = `<div class="imps-grid" id="imps-grid">${saved.map(savedCard).join('')}</div>`;
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
    if(status){ status.addEventListener('change',function(){ patch(slug,{status:status.value},saveNote); }); }
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
