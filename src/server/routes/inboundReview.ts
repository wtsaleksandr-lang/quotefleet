/**
 * SUPER-ADMIN inbound-review surface — REVERSE OUTREACH, Phase 2b.
 *
 * The human review layer over the harvest pipeline. It lets Alex turn a broker
 * email into a ready-to-send drafted reply WITHOUT any mailbox or credentials:
 * paste a forwarded broker email, the pipeline drafts a warm in-thread reply
 * against that broker's OWN branded demo, and this page shows the draft in a
 * copy-able box next to the demo link + the branded quote screenshot. Alex
 * copies the reply, pastes it in Outlook, sends, and clicks "Mark sent".
 *
 *   POST /api/admin/inbound/paste       { raw? , from?, subject?, bodyText? }
 *   GET  /api/admin/inbound/prospects   → drafted prospects + joined draft copy
 *   POST /api/admin/inbound/:id/skip    → status 'skipped'
 *   POST /api/admin/inbound/:id/sent    → status 'sent' (after Alex sends it)
 *   GET  /inbound-review                → the server-rendered review page
 *
 * Everything external (the harvest handler, the two stores, the raw-email
 * parser, the URL builders) is injectable via `deps`, so the unit tests run
 * with zero network and zero DB. Gated by requireAuth + requireSuperAdmin.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { simpleParser } from 'mailparser';
import { requireAuth, requireSuperAdmin } from '../middleware.js';
import { extractEmail } from '../outreach/inbound/parseInbound.js';
import {
  handleHarvestedEmail as realHandleHarvestedEmail,
  type HandleHarvestedEmailInput,
  type HandleHarvestedEmailResult,
} from '../outreach/inbound/handleHarvestedEmail.js';
import {
  dbInboundProspectStore,
  type InboundProspectStore,
} from '../outreach/inbound/inboundProspectStore.js';
import {
  dbOutreachEmailStore,
  type OutreachEmailStore,
} from '../outreach/outreachEmailStore.js';
import {
  demoUrlForToken as realDemoUrlForToken,
  quoteShotUrlForToken as realQuoteShotUrlForToken,
} from './outreach.js';

/** Normalized fields the paste route extracts from a raw .eml (or the form). */
export interface ParsedRawEmail {
  fromEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  messageId?: string;
  references?: string[];
}

/** Injectable dependencies — defaults are the real impls. */
export interface InboundReviewDeps {
  handle?: (
    input: HandleHarvestedEmailInput,
  ) => Promise<HandleHarvestedEmailResult>;
  inboundStore?: InboundProspectStore;
  emailStore?: OutreachEmailStore;
  /** Parse a raw RFC 822 .eml into the pipeline fields (defaults to mailparser). */
  parseRaw?: (raw: string) => Promise<ParsedRawEmail>;
  demoUrlForToken?: (token: string) => string;
  quoteShotUrlForToken?: (token: string) => string;
}

const PasteBody = z.object({
  raw: z.string().min(1).optional(),
  from: z.string().optional(),
  subject: z.string().optional(),
  bodyText: z.string().optional(),
});

/** Default raw-email parser — mailparser's simpleParser, normalized. */
export async function parseRawEmail(raw: string): Promise<ParsedRawEmail> {
  const parsed = await simpleParser(raw);
  const fromEmail =
    parsed.from?.value?.[0]?.address?.trim().toLowerCase() ??
    extractEmail(parsed.from?.text ?? '') ??
    '';
  const refs = parsed.references;
  const references = Array.isArray(refs) ? refs : refs ? [refs] : [];
  return {
    fromEmail,
    subject: parsed.subject ?? '',
    bodyText: parsed.text ?? '',
    bodyHtml: typeof parsed.html === 'string' ? parsed.html : undefined,
    messageId: parsed.messageId ?? undefined,
    references,
  };
}

export function registerInboundReviewRoutes(app: Express, deps: InboundReviewDeps = {}) {
  const handle = deps.handle ?? realHandleHarvestedEmail;
  const inboundStore = deps.inboundStore ?? dbInboundProspectStore;
  const emailStore = deps.emailStore ?? dbOutreachEmailStore;
  const parseRaw = deps.parseRaw ?? parseRawEmail;
  const buildDemoUrl = deps.demoUrlForToken ?? realDemoUrlForToken;
  const buildShotUrl = deps.quoteShotUrlForToken ?? realQuoteShotUrlForToken;

  // ── Paste-a-broker-email intake → draft a warm reply ──────────────────
  app.post('/api/admin/inbound/paste', requireAuth, requireSuperAdmin, async (req, res) => {
    const parse = PasteBody.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Provide a raw email, or from + subject + bodyText.' });
    }
    const { raw } = parse.data;
    let fields: ParsedRawEmail;
    try {
      if (raw && raw.trim()) {
        fields = await parseRaw(raw);
      } else {
        fields = {
          fromEmail: (parse.data.from ?? '').trim().toLowerCase(),
          subject: parse.data.subject ?? '',
          bodyText: parse.data.bodyText ?? '',
          references: [],
        };
      }
    } catch (err) {
      console.error('[inbound/paste] parse failed:', err);
      return res.status(400).json({ error: 'Could not parse that email. Paste the full raw message or fill the fields.' });
    }
    if (!fields.fromEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.fromEmail)) {
      return res.status(400).json({ error: 'Could not find a sender address in that email.' });
    }
    try {
      const result = await handle({
        harvestMailbox: 'paste',
        fromEmail: fields.fromEmail,
        subject: fields.subject,
        bodyText: fields.bodyText,
        bodyHtml: fields.bodyHtml,
        messageId: fields.messageId,
        references: fields.references,
        receivedAt: new Date(),
      });
      return res.json({ ok: true, ...result, fromEmail: fields.fromEmail, subject: fields.subject });
    } catch (err) {
      console.error('[inbound/paste] handler failed:', err);
      return res.status(500).json({ error: 'Drafting failed. Try again or check server logs.' });
    }
  });

  // ── List drafted prospects joined with their draft copy + links ───────
  app.get('/api/admin/inbound/prospects', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const rows = await inboundStore.list(status ? { status } : undefined);
      const prospects = await Promise.all(
        rows.map(async (row) => {
          let draft: { subject: string; bodyText: string; bodyHtml: string } | null = null;
          if (row.outreachEmailId) {
            const email = await emailStore.getById(row.outreachEmailId);
            if (email) {
              draft = { subject: email.subject, bodyText: email.bodyText, bodyHtml: email.bodyHtml };
            }
          }
          return {
            id: row.id,
            fromEmail: row.fromEmail,
            fromDomain: row.fromDomain,
            originalSubject: row.originalSubject,
            status: row.status,
            classifyCategory: row.classifyCategory,
            demoToken: row.demoToken,
            demoUrl: row.demoToken ? buildDemoUrl(row.demoToken) : null,
            quoteShotUrl: row.demoToken ? buildShotUrl(row.demoToken) : null,
            receivedAt: row.receivedAt,
            draft,
          };
        }),
      );
      return res.json({ ok: true, prospects });
    } catch (err) {
      console.error('[inbound/prospects] list failed:', err);
      return res.status(500).json({ error: 'Could not load prospects. Check server logs.' });
    }
  });

  // ── Skip a prospect (not worth a reply) ───────────────────────────────
  app.post('/api/admin/inbound/:id/skip', requireAuth, requireSuperAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
    try {
      await inboundStore.updateStatus(id, 'skipped');
      return res.json({ ok: true, id, status: 'skipped' });
    } catch (err) {
      console.error('[inbound/skip] failed:', err);
      return res.status(500).json({ error: 'Could not update. Check server logs.' });
    }
  });

  // ── Mark a prospect sent (after Alex sends the copy from Outlook) ──────
  app.post('/api/admin/inbound/:id/sent', requireAuth, requireSuperAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
    try {
      await inboundStore.updateStatus(id, 'sent');
      return res.json({ ok: true, id, status: 'sent' });
    } catch (err) {
      console.error('[inbound/sent] failed:', err);
      return res.status(500).json({ error: 'Could not update. Check server logs.' });
    }
  });

  // ── The server-rendered review page ───────────────────────────────────
  app.get('/inbound-review', requireAuth, requireSuperAdmin, (_req: Request, res: Response) => {
    res.status(200).type('html').send(reviewPageHtml());
  });
}

/**
 * Server-rendered review page. Reuses the app's /style.css tokens/classes; the
 * card list hydrates from /api/admin/inbound/prospects on load. Kept intentionally
 * simple, on-brand, light-mode — no framework, one inline script.
 */
export function reviewPageHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inbound review · QuoteFleet</title>
<link rel="stylesheet" href="/style.css">
<style>
  .ir-wrap { max-width: 900px; margin: 0 auto; padding: var(--space-4) var(--space-3); }
  .ir-head { margin-bottom: var(--space-3); }
  .ir-head h1 { font-size: 24px; margin: 0 0 4px 0; letter-spacing: -0.01em; }
  .ir-paste { margin-bottom: var(--space-4); }
  .ir-paste .textarea { min-height: 120px; font-family: var(--font-mono); font-size: 13px; }
  .ir-paste-actions { display: flex; gap: var(--space-1); margin-top: var(--space-1); align-items: center; flex-wrap: wrap; }
  .ir-list { display: flex; flex-direction: column; gap: var(--space-3); }
  .ir-card-head { display: flex; align-items: baseline; gap: var(--space-1); justify-content: space-between; flex-wrap: wrap; margin-bottom: var(--space-1); }
  .ir-from { font-weight: 700; font-size: 15px; color: var(--ink); }
  .ir-subject { color: var(--muted); font-size: 13.5px; margin: 0 0 var(--space-2) 0; }
  .ir-reply { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); padding: var(--space-2); margin-bottom: var(--space-2); }
  .ir-reply-subject { font-weight: 600; font-size: 14px; margin-bottom: var(--space-1); color: var(--ink); }
  .ir-reply-body { white-space: pre-wrap; font-size: 13.5px; line-height: 1.5; color: var(--ink-soft); max-height: 260px; overflow: auto; }
  .ir-media { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: flex-start; margin-bottom: var(--space-2); }
  .ir-shot { max-width: 320px; width: 100%; border: 1px solid var(--border); border-radius: var(--radius); }
  .ir-actions { display: flex; gap: var(--space-1); flex-wrap: wrap; align-items: center; }
  .ir-empty { color: var(--muted); padding: var(--space-4); text-align: center; }
  .ir-links { display: flex; gap: var(--space-2); flex-wrap: wrap; font-size: 13px; margin-bottom: var(--space-2); }
</style>
</head><body>
<div class="ir-wrap">
  <div class="ir-head">
    <h1>Inbound review</h1>
    <p class="muted">Paste a forwarded broker email → get a ready-to-send warm reply. Copy it, send from Outlook, mark sent.</p>
  </div>

  <div class="ir-paste card">
    <div class="field">
      <label class="field-label" for="ir-raw">Paste a broker email</label>
      <textarea id="ir-raw" class="textarea" placeholder="Paste the full forwarded broker email (raw .eml or just the body)…"></textarea>
    </div>
    <div class="ir-paste-actions">
      <button id="ir-draft-btn" class="btn btn-primary" type="button">Draft reply</button>
      <span id="ir-paste-msg" class="muted" role="status"></span>
    </div>
  </div>

  <div id="ir-list" class="ir-list" aria-live="polite">
    <div class="ir-empty">Loading…</div>
  </div>
</div>
<script>${reviewPageScript()}</script>
</body></html>`;
}

/** The page's client script — no framework, no deps. Exported for the harness. */
export function reviewPageScript(): string {
  return `
(function () {
  var listEl = document.getElementById('ir-list');
  var draftBtn = document.getElementById('ir-draft-btn');
  var rawEl = document.getElementById('ir-raw');
  var pasteMsg = document.getElementById('ir-paste-msg');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function card(p) {
    var d = p.draft;
    var reply = d
      ? '<div class="ir-reply">' +
          '<div class="ir-reply-subject">' + esc(d.subject) + '</div>' +
          '<div class="ir-reply-body" id="ir-body-' + p.id + '">' + esc(d.bodyText) + '</div>' +
        '</div>'
      : '<p class="muted">No draft yet (' + esc(p.status) + ').</p>';
    var shot = p.quoteShotUrl
      ? '<img class="ir-shot" alt="Branded quote preview" loading="lazy" src="' + esc(p.quoteShotUrl) + '">'
      : '';
    var links = '';
    if (p.demoUrl) links += '<a href="' + esc(p.demoUrl) + '" target="_blank" rel="noopener">Open demo ↗</a>';
    var copyBtn = d
      ? '<button class="btn btn-secondary btn-sm" type="button" data-copy="' + p.id + '">Copy reply</button>'
      : '';
    return '<div class="card ir-card" data-id="' + p.id + '">' +
      '<div class="ir-card-head">' +
        '<span class="ir-from">' + esc(p.fromEmail) + '</span>' +
        '<span class="badge">' + esc(p.status) + '</span>' +
      '</div>' +
      '<p class="ir-subject">Re: ' + esc(p.originalSubject || '(no subject)') + '</p>' +
      (links ? '<div class="ir-links">' + links + '</div>' : '') +
      '<div class="ir-media">' + shot + '</div>' +
      reply +
      '<div class="ir-actions">' + copyBtn +
        '<button class="btn btn-primary btn-sm" type="button" data-sent="' + p.id + '">Mark sent</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-skip="' + p.id + '">Skip</button>' +
      '</div>' +
    '</div>';
  }

  function render(prospects) {
    if (!prospects || !prospects.length) {
      listEl.innerHTML = '<div class="ir-empty">No inbound prospects yet. Paste a broker email above to draft a reply.</div>';
      return;
    }
    listEl.innerHTML = prospects.map(card).join('');
  }

  function load() {
    fetch('/api/admin/inbound/prospects', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { render(j.prospects || []); })
      .catch(function () { listEl.innerHTML = '<div class="ir-empty">Could not load prospects.</div>'; });
  }

  function post(url) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
  }

  draftBtn && draftBtn.addEventListener('click', function () {
    var raw = (rawEl.value || '').trim();
    if (!raw) { pasteMsg.textContent = 'Paste an email first.'; return; }
    draftBtn.disabled = true;
    pasteMsg.textContent = 'Drafting…';
    fetch('/api/admin/inbound/paste', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: raw }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        draftBtn.disabled = false;
        if (!res.ok) { pasteMsg.textContent = res.j.error || 'Failed.'; return; }
        pasteMsg.textContent = res.j.status === 'drafted'
          ? 'Drafted a reply for ' + (res.j.fromEmail || 'the sender') + '.'
          : 'Result: ' + res.j.status + '.';
        rawEl.value = '';
        load();
      })
      .catch(function () { draftBtn.disabled = false; pasteMsg.textContent = 'Failed.'; });
  });

  listEl.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof HTMLElement)) return;
    var copyId = t.getAttribute('data-copy');
    var sentId = t.getAttribute('data-sent');
    var skipId = t.getAttribute('data-skip');
    if (copyId) {
      var body = document.getElementById('ir-body-' + copyId);
      var text = body ? body.textContent : '';
      var done = function () { t.textContent = 'Copied ✓'; setTimeout(function () { t.textContent = 'Copy reply'; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
        ta.select(); try { document.execCommand('copy'); } catch (err) {} document.body.removeChild(ta); done();
      }
      return;
    }
    if (sentId) { t.disabled = true; post('/api/admin/inbound/' + sentId + '/sent').then(load); return; }
    if (skipId) { t.disabled = true; post('/api/admin/inbound/' + skipId + '/skip').then(load); return; }
  });

  load();
})();
`;
}
