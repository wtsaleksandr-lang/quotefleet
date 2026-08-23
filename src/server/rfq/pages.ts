/**
 * Server-rendered HTML for the multi-carrier RFQ flow.
 *
 * Reuses the public directory shell (`layout` + `esc` from directory/pages.ts)
 * so these pages carry the same topnav/footer/fonts/theme toggle and are
 * light/dark-parity by construction (tokens only — no hardcoded hex). Squared
 * corners (4px), 8px-grid spacing, left-aligned page headers.
 *
 * Five surfaces:
 *   - renderRfqForm            → the shipper's rate-request form (GET /directory/rfq)
 *   - renderRfqConfirmation    → after POST: the shipper's responses link + counts
 *   - renderShipperView        → the shipper's live responses table (view_token)
 *   - renderCarrierQuotePage   → a carrier's quote-submission form (quote_token)
 *   - renderQuoteSubmitted     → carrier thank-you after submit
 *   - renderOptOutConfirmation → carrier one-click opt-out confirmation
 *   - renderRfqNotFound        → bad/expired token
 */
import { layout, esc } from '../directory/pages.js';
import type { RfqRequest, RfqRecipient, RfqQuote, RfqRecipientStatus } from '../../db/schema.js';

/** Scoped RFQ styles — tokens only (theme-parity), squared corners, 8px grid. */
const RFQ_CSS = `
  .rfq-wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 72px; }
  .rfq-wide { max-width: 960px; }
  .rfq-eyebrow { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); font-weight: 600; margin: 0 0 8px; text-align: left; }
  .rfq-wrap h1 { font-size: 30px; line-height: 1.18; margin: 0 0 12px; color: var(--ink); text-align: left; }
  .rfq-lede { color: var(--muted); font-size: 15px; line-height: 1.55; margin: 0 0 24px; text-align: left; max-width: 62ch; }
  .rfq-card { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 24px; margin: 0 0 16px; }
  .rfq-note { background: var(--accent-soft); border: 1px solid var(--border); border-radius: 4px; padding: 12px 16px; color: var(--ink-soft); font-size: 14px; margin: 0 0 24px; }
  .rfq-note strong { color: var(--ink); }
  .rfq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .rfq-field { display: flex; flex-direction: column; gap: 2px; margin: 0 0 16px; }
  .rfq-field.rfq-col2 { grid-column: 1 / -1; }
  .rfq-field label { font-size: 13px; font-weight: 600; color: var(--ink); text-align: left; }
  .rfq-field .rfq-help { font-size: 12px; color: var(--muted); text-align: left; margin: 0 0 4px; }
  .rfq-field input, .rfq-field select, .rfq-field textarea {
    font: inherit; font-size: 14px; color: var(--ink); background: var(--bg);
    border: 1px solid var(--border-strong); border-radius: 4px; padding: 10px 12px; width: 100%;
  }
  .rfq-field textarea { min-height: 140px; resize: vertical; }
  .rfq-field input:focus, .rfq-field select:focus, .rfq-field textarea:focus {
    outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent);
  }
  .rfq-section-title { font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 24px 0 12px; text-align: left; }
  .rfq-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin: 8px 0 0; }
  .rfq-btn {
    display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 15px; font-weight: 600;
    background: var(--cta-bg); color: var(--cta-text); border: 1px solid var(--cta-bg);
    border-radius: 4px; padding: 12px 22px; cursor: pointer; text-decoration: none;
  }
  .rfq-btn:hover { opacity: 0.92; }
  .rfq-btn[disabled], .rfq-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .rfq-btn[disabled]:hover, .rfq-btn:disabled:hover { opacity: 0.55; }
  .rfq-btn--ghost { background: transparent; color: var(--ink); border-color: var(--border-strong); }
  .rfq-btn--ghost:hover { background: var(--surface-2); }
  .rfq-linkbox { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 14px 16px; margin: 12px 0 0; }
  .rfq-linkbox code { font-family: var(--font-mono, monospace); font-size: 13px; color: var(--ink); word-break: break-all; }
  .rfq-help code { word-break: break-all; overflow-wrap: anywhere; }
  .rfq-counts { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0 0; }
  .rfq-count { flex: 1 1 120px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 14px 16px; text-align: left; }
  .rfq-count b { display: block; font-size: 24px; color: var(--ink); line-height: 1.1; }
  .rfq-count span { font-size: 12px; color: var(--muted); }
  .rfq-summary { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; }
  .rfq-summary dt { color: var(--muted); font-size: 13px; }
  .rfq-summary dd { color: var(--ink); font-size: 14px; font-weight: 600; margin: 0; }
  .rfq-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 4px; }
  table.rfq-table { border-collapse: collapse; width: 100%; min-width: 520px; }
  .rfq-table th, .rfq-table td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 14px; vertical-align: top; }
  .rfq-table th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); font-weight: 600; background: var(--surface-2); }
  .rfq-table tr:last-child td { border-bottom: none; }
  .rfq-table td .rfq-carrier { color: var(--ink); font-weight: 600; }
  .rfq-table td .rfq-dot { color: var(--muted); font-size: 12px; }
  .rfq-status { display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 4px; white-space: nowrap; }
  .rfq-status--pending { background: var(--surface-3); color: var(--muted); }
  .rfq-status--sent { background: var(--accent-soft); color: var(--accent); }
  .rfq-status--quoted { background: var(--success-bg); color: var(--success); }
  .rfq-status--no_email { background: var(--warn-bg); color: var(--warn); }
  .rfq-status--opted_out { background: var(--surface-3); color: var(--muted-soft); }
  .rfq-status--failed { background: var(--error-bg); color: var(--error); }
  .rfq-quote-cell b { color: var(--ink); }
  .rfq-quote-cell span { color: var(--muted); }
  .rfq-empty { color: var(--muted); font-size: 14px; padding: 24px 16px; text-align: left; }
  .rfq-draft { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 20px; margin: 0 0 16px; }
  .rfq-draft-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 12px; }
  .rfq-draft-name { color: var(--ink); font-weight: 600; font-size: 15px; }
  .rfq-draft-meta { color: var(--muted); font-size: 12px; }
  .rfq-draft-to { color: var(--muted); font-size: 12px; word-break: break-all; }
  .rfq-ai-tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); }
  .rfq-skip { background: var(--surface-2); border: 1px dashed var(--border); border-radius: 4px; padding: 12px 16px; margin: 0 0 12px; color: var(--muted); font-size: 13px; }
  .rfq-skip b { color: var(--ink); font-weight: 600; }
  .rfq-review-actions { position: sticky; bottom: 0; background: var(--bg); border-top: 1px solid var(--border); padding: 16px 0; margin: 24px 0 0; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  @media (max-width: 640px) {
    .rfq-wrap { padding: 28px 16px 56px; }
    .rfq-wrap h1 { font-size: 24px; }
    .rfq-grid { grid-template-columns: 1fr; }
    .rfq-draft-head { flex-direction: column; }
  }
`;

/** Human labels + tone class for each recipient status. */
const STATUS_META: Record<RfqRecipientStatus, string> = {
  pending: 'Pending',
  sent: 'Requested',
  no_email: 'No email',
  opted_out: 'Opted out',
  quoted: 'Quoted',
  failed: 'Failed',
};

function statusBadge(status: RfqRecipientStatus): string {
  const label = STATUS_META[status] ?? status;
  return `<span class="rfq-status rfq-status--${esc(status)}">${esc(label)}</span>`;
}

function page(title: string, description: string, canonicalPath: string, bodyInner: string): string {
  return layout({
    title,
    description,
    canonicalPath,
    bodyHtml: `<style>${RFQ_CSS}</style>${bodyInner}`,
  });
}

// ─── 1. The request form ───────────────────────────────────────────────────
export interface RfqFormOpts {
  recipientCount: number;
  totalMatched: number;
  cap: number;
  capped: boolean;
  /** Explicit selected dots (comma-joined) — carried into POST as a hidden field. */
  dots?: string;
  /** Directory filter querystring — carried into POST as a hidden field. */
  filterQuery?: string;
  /** Prefill from a bounced-back POST (validation error). */
  prefill?: Record<string, string>;
  /** Field-level or top-level error message. */
  error?: string;
  /** Entitlement/quota gate state — renders a sign-in / upgrade banner and
   *  disables the submit when blocked. Absent → no gating shown (open form). */
  gate?: {
    ok: boolean;
    needsAccount?: boolean;
    needsUpgrade?: boolean;
    used?: number;
    allowance?: number;
  };
}

function field(opts: {
  name: string;
  label: string;
  help?: string;
  type?: string;
  required?: boolean;
  value?: string;
  placeholder?: string;
  col2?: boolean;
  textarea?: boolean;
}): string {
  const id = `rfq-${opts.name}`;
  const cls = `rfq-field${opts.col2 ? ' rfq-col2' : ''}`;
  const help = opts.help ? `<div class="rfq-help">${esc(opts.help)}</div>` : '';
  const req = opts.required ? ' required' : '';
  const val = esc(opts.value ?? '');
  const ph = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : '';
  const control = opts.textarea
    ? `<textarea id="${id}" name="${esc(opts.name)}"${req}${ph}>${val}</textarea>`
    : `<input id="${id}" name="${esc(opts.name)}" type="${esc(opts.type ?? 'text')}"${req}${ph} value="${val}">`;
  return `<div class="${cls}"><label for="${id}">${esc(opts.label)}${
    opts.required ? '' : ' <span style="color:var(--muted);font-weight:400;">(optional)</span>'
  }</label>${help}${control}</div>`;
}

export function renderRfqForm(opts: RfqFormOpts): string {
  const p = opts.prefill ?? {};
  const n = opts.recipientCount;
  const capNotice = opts.capped
    ? ` Your selection matched <strong>${esc(String(opts.totalMatched))}</strong> carriers; this request goes to the first <strong>${esc(
        String(opts.cap),
      )}</strong> (the per-request cap).`
    : '';
  const errorHtml = opts.error
    ? `<div class="rfq-note" style="background:var(--error-bg);border-color:var(--error);color:var(--ink);">${esc(
        opts.error,
      )}</div>`
    : '';
  // Gate banner — sign-in required (no account) or monthly allowance reached.
  // Theme-aware, token-only styling; the submit is disabled while blocked.
  const g = opts.gate;
  const blocked = !!g && !g.ok;
  // Shipper account creation is the free, passwordless email sign-in (NOT the
  // carrier /signup, and NOT implying payment); the upgrade CTA lands on the
  // same surface pre-set to the subscribe intent.
  const joinHref = '/directory/join';
  const upgradeHref = '/directory/join?intent=subscribe';
  let gateHtml = '';
  if (blocked) {
    if (g!.needsAccount) {
      gateHtml = `<div class="rfq-note rfq-gate" role="alert" style="background:var(--accent-soft);border-color:var(--accent);color:var(--ink);"><strong>Sign in to send.</strong> Rate requests go out under your account so carriers know who's asking. <a href="${joinHref}" style="color:var(--accent);">Create a free account →</a></div>`;
    } else {
      const used = esc(String(g!.used ?? 0));
      const allow = esc(String(g!.allowance ?? 0));
      const upgrade = g!.needsUpgrade
        ? ` <a href="${upgradeHref}" style="color:var(--accent);">Upgrade to Directory Pro →</a>`
        : '';
      const tail = g!.needsUpgrade ? ' — upgrade to Directory Pro to send more.' : ' — your monthly limit is reached.';
      gateHtml = `<div class="rfq-note rfq-gate" role="alert" style="background:var(--accent-soft);border-color:var(--accent);color:var(--ink);"><strong>You've used ${used} of ${allow} rate requests this month${tail}</strong>${upgrade}</div>`;
    }
  }
  const submitAttrs = blocked ? ' disabled aria-disabled="true"' : '';
  const hidden = [
    opts.dots ? `<input type="hidden" name="dots" value="${esc(opts.dots)}">` : '',
    opts.filterQuery ? `<input type="hidden" name="filters" value="${esc(opts.filterQuery)}">` : '',
  ].join('');

  const body = `
  <main class="rfq-wrap">
    <p class="rfq-eyebrow">Multi-carrier rate request</p>
    <h1>Request rates from ${esc(String(n))} carrier${n === 1 ? '' : 's'}</h1>
    <p class="rfq-lede">Send one rate request to every carrier you selected. Each gets a private link to submit a quote, and you'll see the responses come back in one place — no phone tag, no re-typing your lane.</p>
    ${gateHtml}
    ${errorHtml}
    <div class="rfq-note">Requesting rates from <strong>${esc(
      String(n),
    )}</strong> carrier${n === 1 ? '' : 's'}.${capNotice}</div>
    <form method="post" action="/directory/rfq" novalidate>
      ${hidden}
      <div class="rfq-card">
        <div class="rfq-section-title">Shipment</div>
        <div class="rfq-grid">
          ${field({ name: 'origin', label: 'Origin', required: true, value: p.origin, placeholder: 'City, ST' })}
          ${field({ name: 'destination', label: 'Destination', required: true, value: p.destination, placeholder: 'City, ST' })}
          ${field({ name: 'equipment', label: 'Equipment', value: p.equipment, placeholder: 'Dry van, reefer, flatbed…' })}
          ${field({ name: 'container_type', label: 'Container type', value: p.container_type, placeholder: '40ft HC (if drayage)' })}
          ${field({ name: 'commodity', label: 'Commodity', value: p.commodity, placeholder: 'What are you shipping?' })}
          ${field({ name: 'weight', label: 'Weight', value: p.weight, placeholder: 'e.g. 42,000 lbs' })}
          ${field({ name: 'ready_date', label: 'Ready date', type: 'text', value: p.ready_date, placeholder: 'YYYY-MM-DD or ASAP' })}
          ${field({ name: 'target_rate', label: 'Target rate', value: p.target_rate, placeholder: 'Optional — your budget' })}
          ${field({ name: 'notes', label: 'Notes', value: p.notes, textarea: true, col2: true, placeholder: 'Anything carriers should know (accessorials, appointment, etc.)' })}
        </div>
      </div>
      <div class="rfq-card">
        <div class="rfq-section-title">Your contact</div>
        <p class="rfq-help" style="margin:-4px 0 12px;">So carriers know who's requesting and where to send their quote.</p>
        <div class="rfq-grid">
          ${field({ name: 'shipper_name', label: 'Your name', required: true, value: p.shipper_name })}
          ${field({ name: 'shipper_company', label: 'Company', value: p.shipper_company })}
          ${field({ name: 'shipper_email', label: 'Email', type: 'email', required: true, value: p.shipper_email, help: 'We send your responses link here.' })}
          ${field({ name: 'shipper_phone', label: 'Phone', type: 'tel', value: p.shipper_phone })}
        </div>
      </div>
      <div class="rfq-actions">
        <button type="submit" class="rfq-btn"${submitAttrs}>Send rate request <span aria-hidden="true">→</span></button>
        <a class="rfq-btn rfq-btn--ghost" href="/directory">Back to directory</a>
      </div>
    </form>
  </main>`;
  return page(
    `Request rates from ${n} carriers · QuoteFleet`,
    'Send one rate request to every carrier you selected and collect quotes in one place.',
    '/directory/rfq',
    body,
  );
}

// ─── 1b. Review screen (generate → REVIEW/EDIT → confirm & send) ────────────
export interface RfqReviewOpts {
  request: RfqRequest;
  recipients: RfqRecipient[];
  /** Absolute URL to re-open this review later (shown as a bookmarkable link). */
  reviewUrl: string;
  /** Where the confirm-&-send form posts (phase 2). */
  actionUrl: string;
  noEmail: number;
  optedOut: number;
  cappedOut: number;
  total: number;
  dryRun: boolean;
}

/**
 * The two-phase review gate: every carrier's individual, AI-personalized draft is
 * listed with an editable subject + body. The shipper edits any of them, then
 * confirms — nothing is sent until this form is submitted. Non-sendable rows
 * (no email / opted out) are shown as skipped so the coverage is transparent.
 */
export function renderRfqReview(opts: RfqReviewOpts): string {
  const { request, recipients } = opts;
  const sendable = recipients.filter((r) => r.status === 'pending');
  const skipped = recipients.filter((r) => r.status !== 'pending');

  const dryRunNote = opts.dryRun
    ? `<div class="rfq-note"><strong>Preview mode.</strong> Live sending is off — confirming will run the full flow and log each would-send without emailing any carrier.</div>`
    : '';

  const capNote =
    opts.cappedOut > 0
      ? `<div class="rfq-note">Your selection matched <strong>${esc(
          String(opts.total),
        )}</strong> carriers; this request covers the first <strong>${esc(
          String(sendable.length + opts.noEmail + opts.optedOut),
        )}</strong> (the per-request cap).</div>`
      : '';

  const draftCards = sendable
    .map((r) => {
      return `
      <div class="rfq-draft">
        <div class="rfq-draft-head">
          <div>
            <div class="rfq-draft-name">${esc(r.carrierName)}</div>
            <div class="rfq-draft-to">To: ${esc(r.carrierEmail ?? '—')} · USDOT ${esc(r.carrierDot)}</div>
          </div>
          <span class="rfq-ai-tag">Personalized draft</span>
        </div>
        ${field({
          name: `subject_${r.id}`,
          label: 'Subject',
          required: true,
          value: r.draftSubject ?? '',
        })}
        ${field({
          name: `body_${r.id}`,
          label: 'Message',
          textarea: true,
          required: true,
          col2: true,
          value: r.draftBody ?? '',
        })}
      </div>`;
    })
    .join('');

  const skippedHtml = skipped.length
    ? `<div class="rfq-section-title">Not contacted</div>${skipped
        .map(
          (r) =>
            `<div class="rfq-skip"><b>${esc(r.carrierName)}</b> — ${
              r.status === 'no_email' ? 'no public email on file' : 'opted out of rate requests'
            }.</div>`,
        )
        .join('')}`
    : '';

  const n = sendable.length;
  const body = `
  <main class="rfq-wrap rfq-wide">
    <p class="rfq-eyebrow">Review before sending</p>
    <h1>${esc(String(n))} personalized draft${n === 1 ? '' : 's'} ready</h1>
    <p class="rfq-lede">Each carrier gets its own email, addressed to them and written from your lane and their equipment. Read every draft, tweak anything, then send. Nothing goes out until you confirm.</p>
    ${dryRunNote}
    ${capNote}
    <div class="rfq-card">
      <div class="rfq-section-title">Shipment</div>
      ${requestSummary(request)}
    </div>
    <form method="post" action="${esc(opts.actionUrl)}" novalidate>
      <div class="rfq-section-title">Carrier drafts</div>
      ${draftCards || `<div class="rfq-empty">No carriers with an email to contact on this request.</div>`}
      ${skippedHtml}
      <div class="rfq-review-actions">
        ${
          n > 0
            ? `<button type="submit" class="rfq-btn">Confirm &amp; send ${esc(String(n))} request${
                n === 1 ? '' : 's'
              } <span aria-hidden="true">→</span></button>`
            : ''
        }
        <a class="rfq-btn rfq-btn--ghost" href="/directory">Back to directory</a>
      </div>
    </form>
    <p class="rfq-help" style="margin:16px 0 0;">Come back to these drafts any time: <code>${esc(opts.reviewUrl)}</code></p>
  </main>`;
  return page(
    `Review ${n} rate-request draft${n === 1 ? '' : 's'} · QuoteFleet`,
    'Review and edit each carrier’s personalized rate request before sending.',
    '/directory/rfq',
    body,
  );
}

// ─── 2. Confirmation ────────────────────────────────────────────────────────
export interface RfqConfirmationOpts {
  viewUrl: string;
  sent: number;
  noEmail: number;
  optedOut: number;
  cappedOut: number;
  total: number;
  dryRun: boolean;
}

export function renderRfqConfirmation(opts: RfqConfirmationOpts): string {
  const dryRunNote = opts.dryRun
    ? `<div class="rfq-note"><strong>Preview mode.</strong> Live sending is off, so no carrier emails actually went out — the flow is fully wired and ready to enable.</div>`
    : '';
  const counts = [
    { n: opts.sent, label: opts.dryRun ? 'Prepared' : 'Requests sent' },
    { n: opts.noEmail, label: 'No email on file' },
    { n: opts.optedOut, label: 'Opted out' },
    ...(opts.cappedOut > 0 ? [{ n: opts.cappedOut, label: 'Over the cap' }] : []),
  ];
  const body = `
  <main class="rfq-wrap">
    <p class="rfq-eyebrow">Rate request sent</p>
    <h1>Your request is on its way</h1>
    <p class="rfq-lede">We've notified the carriers with a public email on file. Bookmark your responses link below — quotes will appear there as carriers reply.</p>
    ${dryRunNote}
    <div class="rfq-card">
      <div class="rfq-section-title">Your responses link</div>
      <p class="rfq-help" style="margin:-4px 0 0;">Private to you — anyone with this link can see the quotes.</p>
      <div class="rfq-linkbox">
        <code>${esc(opts.viewUrl)}</code>
        <a class="rfq-btn" href="${esc(opts.viewUrl)}">View responses <span aria-hidden="true">→</span></a>
      </div>
    </div>
    <div class="rfq-counts">
      ${counts
        .map((c) => `<div class="rfq-count"><b>${esc(String(c.n))}</b><span>${esc(c.label)}</span></div>`)
        .join('')}
    </div>
  </main>`;
  return page('Rate request sent · QuoteFleet', 'Your multi-carrier rate request has been sent.', '/directory/rfq', body);
}

// ─── 3. Shipper responses view ──────────────────────────────────────────────
function laneLabel(r: RfqRequest): string {
  return `${r.origin} → ${r.destination}`;
}

function requestSummary(r: RfqRequest): string {
  const rows: Array<[string, string | null]> = [
    ['Lane', laneLabel(r)],
    ['Equipment', r.equipment],
    ['Container', r.containerType],
    ['Commodity', r.commodity],
    ['Weight', r.weight],
    ['Ready date', r.readyDate],
    ['Target rate', r.targetRate],
    ['Notes', r.notes],
  ];
  return `<dl class="rfq-summary">${rows
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v as string)}</dd>`)
    .join('')}</dl>`;
}

export function renderShipperView(view: {
  request: RfqRequest;
  recipients: RfqRecipient[];
  quotes: RfqQuote[];
}): string {
  const { request, recipients, quotes } = view;
  const quoteByRecipient = new Map(quotes.map((q) => [q.recipientId, q] as const));
  const quotedCount = recipients.filter((r) => r.status === 'quoted').length;

  const rows = recipients.length
    ? recipients
        .map((r) => {
          const q = quoteByRecipient.get(r.id);
          const quoteCell = q
            ? `<div class="rfq-quote-cell"><b>${esc(q.price ?? '—')}</b>${
                q.transitDays != null ? ` <span>· ${esc(String(q.transitDays))} days transit</span>` : ''
              }${q.validUntil ? `<br><span>Valid until ${esc(q.validUntil)}</span>` : ''}${
                q.notes ? `<br><span>${esc(q.notes)}</span>` : ''
              }</div>`
            : `<span class="rfq-dot">—</span>`;
          return `<tr>
            <td><div class="rfq-carrier">${esc(r.carrierName)}</div><div class="rfq-dot">USDOT ${esc(
              r.carrierDot,
            )}</div></td>
            <td>${statusBadge(r.status as RfqRecipientStatus)}</td>
            <td>${quoteCell}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="3"><div class="rfq-empty">No recipients on this request.</div></td></tr>`;

  const body = `
  <main class="rfq-wrap rfq-wide">
    <p class="rfq-eyebrow">Your rate request</p>
    <h1>${esc(laneLabel(request))}</h1>
    <p class="rfq-lede">${esc(String(quotedCount))} of ${esc(
      String(recipients.length),
    )} carrier${recipients.length === 1 ? '' : 's'} have quoted. This page updates as more replies come in.</p>
    <div class="rfq-card">
      <div class="rfq-section-title">Shipment</div>
      ${requestSummary(request)}
    </div>
    <div class="rfq-section-title">Carriers &amp; quotes</div>
    <div class="rfq-table-wrap">
      <table class="rfq-table">
        <thead><tr><th>Carrier</th><th>Status</th><th>Quote</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </main>`;
  return page(
    `Rate request · ${laneLabel(request)} · QuoteFleet`,
    'Live quotes for your multi-carrier rate request.',
    '/directory/rfq',
    body,
  );
}

// ─── 4. Carrier quote-submission page ───────────────────────────────────────
export function renderCarrierQuotePage(ctx: {
  request: RfqRequest;
  recipient: RfqRecipient;
  quote: RfqQuote | null;
  error?: string;
}): string {
  const { request, recipient, quote } = ctx;
  const already = quote != null;
  const errorHtml = ctx.error
    ? `<div class="rfq-note" style="background:var(--error-bg);border-color:var(--error);color:var(--ink);">${esc(
        ctx.error,
      )}</div>`
    : '';
  const shipper = request.shipperCompany
    ? `${request.shipperName} (${request.shipperCompany})`
    : request.shipperName;
  const body = `
  <main class="rfq-wrap">
    <p class="rfq-eyebrow">Rate request for ${esc(recipient.carrierName)}</p>
    <h1>${esc(laneLabel(request))}</h1>
    <p class="rfq-lede">${esc(shipper)} is requesting a rate for the shipment below. Submit your quote — it takes about a minute.</p>
    ${errorHtml}
    ${already ? `<div class="rfq-note"><strong>You've already quoted this lane.</strong> Submitting again updates your quote.</div>` : ''}
    <div class="rfq-card">
      <div class="rfq-section-title">Shipment</div>
      ${requestSummary(request)}
    </div>
    <form method="post" action="/directory/rfq/quote/${esc(recipient.quoteToken)}" novalidate>
      <div class="rfq-card">
        <div class="rfq-section-title">Your quote</div>
        <div class="rfq-grid">
          ${field({ name: 'price', label: 'All-in rate', required: true, value: quote?.price ?? '', placeholder: 'e.g. $2,400' })}
          ${field({
            name: 'transit_days',
            label: 'Transit days',
            type: 'number',
            value: quote?.transitDays != null ? String(quote.transitDays) : '',
            placeholder: 'e.g. 3',
          })}
          ${field({ name: 'valid_until', label: 'Valid until', value: quote?.validUntil ?? '', placeholder: 'YYYY-MM-DD or 7 days' })}
          ${field({ name: 'notes', label: 'Notes', value: quote?.notes ?? '', textarea: true, col2: true, placeholder: 'Equipment, accessorials, terms…' })}
        </div>
      </div>
      <div class="rfq-actions">
        <button type="submit" class="rfq-btn">${already ? 'Update quote' : 'Submit quote'} <span aria-hidden="true">→</span></button>
        <a class="rfq-btn rfq-btn--ghost" href="/directory/rfq/optout/${esc(recipient.quoteToken)}">Not interested — opt out</a>
      </div>
    </form>
  </main>`;
  return page(
    `Rate request · ${laneLabel(request)} · QuoteFleet`,
    'Submit your quote for this shipper rate request.',
    '/directory/rfq',
    body,
  );
}

// ─── 5. Carrier thank-you ───────────────────────────────────────────────────
export function renderQuoteSubmitted(ctx: { request: RfqRequest }): string {
  const body = `
  <main class="rfq-wrap">
    <p class="rfq-eyebrow">Quote submitted</p>
    <h1>Thanks — your quote is in</h1>
    <p class="rfq-lede">We've sent your quote for <strong>${esc(
      laneLabel(ctx.request),
    )}</strong> to the shipper. If they choose you, they'll reach out using the contact details on your request. You can update your quote any time from the link in your email.</p>
    <div class="rfq-actions">
      <a class="rfq-btn" href="/directory">Browse the directory <span aria-hidden="true">→</span></a>
    </div>
  </main>`;
  return page('Quote submitted · QuoteFleet', 'Your quote has been submitted to the shipper.', '/directory/rfq', body);
}

// ─── 6. Opt-out confirmation ────────────────────────────────────────────────
export function renderOptOutConfirmation(ctx: { carrierName?: string }): string {
  const who = ctx.carrierName ? `<strong>${esc(ctx.carrierName)}</strong>` : 'your carrier';
  const body = `
  <main class="rfq-wrap">
    <p class="rfq-eyebrow">Opted out</p>
    <h1>You're opted out</h1>
    <p class="rfq-lede">We've removed ${who} from this rate request and suppressed future rate requests and public contact display. You won't receive further outreach. If this was a mistake, reply to the email that brought you here and we'll restore your listing.</p>
    <div class="rfq-actions">
      <a class="rfq-btn rfq-btn--ghost" href="/directory">Back to directory</a>
    </div>
  </main>`;
  return page('Opted out · QuoteFleet', 'You have opted out of rate requests.', '/directory/rfq', body);
}

// ─── 7. Not found ───────────────────────────────────────────────────────────
export function renderRfqNotFound(): string {
  const body = `
  <main class="rfq-wrap">
    <p class="rfq-eyebrow">Not found</p>
    <h1>This link isn't valid</h1>
    <p class="rfq-lede">The rate-request link you followed is expired or incorrect. If you reached this from an email, check that you copied the full link.</p>
    <div class="rfq-actions">
      <a class="rfq-btn rfq-btn--ghost" href="/directory">Back to directory</a>
    </div>
  </main>`;
  return page('Not found · QuoteFleet', 'This rate-request link is not valid.', '/directory/rfq', body);
}
