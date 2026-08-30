/**
 * RFQ carrier email — the rate-request that lands in each filtered carrier's
 * inbox, plus the send wrapper with the LIVE-SEND gate + compliance guardrails.
 *
 * COMPLIANCE (mirrors outreach/sendOutreach.ts):
 *   - SUPPRESSION FIRST. A suppressed / opted-out address is NEVER emailed, even
 *     when live sending is on. Checked before anything hits the wire.
 *   - HONEST From via brandedFrom(SENDER_NAME) — reuses the platform's verified
 *     sending address so SPF/DKIM stay intact.
 *   - PHYSICAL mailing address (SENDER_ADDRESS) in the footer. It is the
 *     registered office of the operating entity — NEVER a personal residence
 *     (`check:no-home-address` fails the build if a home address reappears).
 *   - ONE-CLICK UNSUBSCRIBE (RFC 8058) = the carrier's opt-out link, passed as
 *     listUnsubscribeUrl so sendEmail attaches List-Unsubscribe + -Post headers.
 *
 * FOOTER (shared by both builders — see `footerHtml`): the opt-out line, one
 * quiet "also from QuoteFleet" line, and a single line carrying the legal links
 * plus the postal address. The address is ANCHOR-WRAPPED so mail clients cannot
 * auto-linkify it into a big blue Maps link; the reasoning is on `footerHtml`.
 * Everything is inline-styled — no external CSS, no web fonts, no <style> block.
 *
 * LIVE-SEND GATE (`RFQ_LIVE_SEND`, DEFAULT OFF):
 *   - OFF (dry-run): render the full email, LOG it, and report 'sent' WITHOUT
 *     calling the network sender. Lets us demo the flow before any real email.
 *   - ON: actually send via the injected `sendEmail`.
 *
 * Pure + injectable: `send`, `isEmailSuppressed`, `liveSend` and `baseUrl` are
 * all injectable so tests run with no network and can assert the dry-run path
 * never calls the sender.
 */
import { sendEmail as realSendEmail, brandedFrom, type EmailOut } from '../../email/send.js';
import { SENDER_NAME, SENDER_ADDRESS } from '../outreach/draftEmail.js';
import { esc } from '../directory/pages.js';
import type { RfqRequest, RfqRecipient } from '../../db/schema.js';

/** True iff live sending is enabled. DEFAULT OFF — only an explicit truthy
 *  RFQ_LIVE_SEND turns real email on. */
export function rfqLiveSendEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.RFQ_LIVE_SEND ?? '').toLowerCase());
}

const stripSlash = (s: string): string => (s || '').replace(/\/$/, '');

/** The carrier's private quote-submission URL. */
export function quoteUrl(baseUrl: string, quoteToken: string): string {
  return `${stripSlash(baseUrl)}/directory/rfq/quote/${quoteToken}`;
}

/** The carrier's one-click opt-out URL (also the List-Unsubscribe target). */
export function optOutUrl(baseUrl: string, quoteToken: string): string {
  return `${stripSlash(baseUrl)}/directory/rfq/optout/${quoteToken}`;
}

/** A concise one-line lane summary for the subject + body. */
export function laneSummary(request: Pick<RfqRequest, 'origin' | 'destination'>): string {
  return `${request.origin} → ${request.destination}`;
}

/**
 * Public site links carried in the email footer. Paths ONLY — each is joined to
 * the caller's baseUrl so a preview/staging send never points at prod.
 *
 * Every path here is a real registered route (verified 200 on the live site);
 * inventing one would put a 404 in front of a carrier. Keep this list and the
 * footer in lockstep — `email.test.ts` asserts each path is reachable in the
 * rendered HTML and that no path outside this set appears.
 */
export const FOOTER_LINKS = {
  /** Free public rate calculator — the single most useful thing we have for a
   *  trucking service provider, and our best top-of-funnel surface. */
  tools: '/tools',
  /** US importer database — carriers use it to find shippers to pitch. */
  importers: '/importers',
  terms: '/terms',
  privacy: '/privacy',
  support: '/support',
} as const;

/** Footer palette — muted greys that stay legible after Gmail's dark-mode
 *  inversion (the footer is deliberately quieter than the body, not invisible).
 *  11px is the floor: below it Outlook/Gmail start bumping sizes back up. */
const F_MUTED = '#8a919e';
const F_LINK = '#5b6472';
const F_SIZE = '11px';

/**
 * The compliance + navigation footer shared by BOTH email builders (static
 * template and AI-drafted letter), so the two can never drift apart on the
 * guarantees that matter: physical postal address, one-click opt-out.
 *
 * ── WHY THE ADDRESS IS WRAPPED IN AN ANCHOR ──────────────────────────────────
 * Gmail (and Apple Mail's data detectors, and Outlook) run an auto-linkifier
 * over rendered message text and turn anything shaped like a postal address
 * into a big blue "open in Maps" link. That is what made the footer address the
 * loudest thing on the email instead of the quietest.
 *
 * A `<meta name="format-detection">` hint alone does NOT fix this — it is an
 * Apple/iOS convention that Gmail ignores. The reliable, client-agnostic fix is
 * structural: put the address inside an anchor we control. No linkifier will
 * ever create a nested `<a>` (that is invalid HTML and every implementation
 * skips text already inside an anchor), so the address keeps OUR inline colour
 * and OUR font-size instead of the client's link styling. We send it to /terms,
 * which is where the operating entity and this same registered office are
 * published — so the link is honest rather than a decoy `href="#"`.
 *
 * Both belts are worn: the meta hint (Apple Mail / iOS) in `emailHead()`, and
 * the anchor wrap (Gmail, Outlook, everything else).
 */
function footerHtml(baseUrl: string, optOutHref: string): string {
  const b = stripSlash(baseUrl);
  const url = (p: string) => esc(`${b}${p}`);
  const a = (p: string, label: string, nowrap = false) =>
    `<a href="${url(p)}" style="color:${F_LINK};text-decoration:underline;${
      nowrap ? 'white-space:nowrap;' : ''
    }">${label}</a>`;
  return (
    `<hr style="border:none;border-top:1px solid #e3e6ea;margin:24px 0 12px;">` +
    // Opt-out — REDUCED to 11px, but still the first thing in the footer and
    // still one click. RFC 8058 List-Unsubscribe rides the same URL.
    `<p style="margin:0 0 6px;color:${F_MUTED};font-size:${F_SIZE};line-height:1.55;">` +
    `You received this because your carrier is listed in the public FMCSA-sourced ${esc(SENDER_NAME)} directory. ` +
    `<a href="${esc(optOutHref)}" style="color:${F_LINK};text-decoration:underline;">Opt out in one click</a>.` +
    `</p>` +
    // Promotional, but useful-first and one quiet line — never a banner.
    // The two labels are nowrap so a 375px line breaks at the "·" separator
    // instead of orphaning a single word ("US importer / directory"). Each
    // label is ~120px at 11px, well inside the 343px mobile content box.
    `<p style="margin:0 0 6px;color:${F_MUTED};font-size:${F_SIZE};line-height:1.55;">` +
    `Also from ${esc(SENDER_NAME)}, free to use: ` +
    `${a(FOOTER_LINKS.tools, 'freight rate calculator', true)} &middot; ` +
    `${a(FOOTER_LINKS.importers, 'US importer directory', true)}` +
    `</p>` +
    // Legal links + the physical address, all on ONE quiet line so the address
    // sits among peers instead of standing alone as the only thing there.
    `<p style="margin:0;color:${F_MUTED};font-size:${F_SIZE};line-height:1.55;">` +
    `${a(FOOTER_LINKS.terms, 'Terms')} &middot; ` +
    `${a(FOOTER_LINKS.privacy, 'Privacy')} &middot; ` +
    `${a(FOOTER_LINKS.support, 'Support')} &middot; ` +
    `<a href="${url(FOOTER_LINKS.terms)}" style="color:${F_MUTED};text-decoration:none;">` +
    `${esc(SENDER_NAME)} &middot; ${esc(SENDER_ADDRESS)}</a>` +
    `</p>`
  );
}

/** Plaintext mirror of `footerHtml` — same links, same order, same guarantees. */
function footerText(baseUrl: string, optOutHref: string): string[] {
  const b = stripSlash(baseUrl);
  return [
    '',
    `If you'd rather not receive rate requests, opt out here:`,
    optOutHref,
    '',
    `Also from ${SENDER_NAME}, free to use:`,
    `  Freight rate calculator: ${b}${FOOTER_LINKS.tools}`,
    `  US importer directory:   ${b}${FOOTER_LINKS.importers}`,
    '',
    `Terms: ${b}${FOOTER_LINKS.terms} · Privacy: ${b}${FOOTER_LINKS.privacy} · Support: ${b}${FOOTER_LINKS.support}`,
    `${SENDER_NAME} · ${SENDER_ADDRESS}`,
  ];
}

/**
 * Shared `<head>`. `format-detection` asks Apple Mail / iOS not to run its data
 * detectors over the message (the address + phone-shaped strings); Gmail ignores
 * it, which is why the address is ALSO anchor-wrapped — see `footerHtml`.
 * No external CSS and no web fonts: everything downstream is inline.
 */
function emailHead(title: string): string {
  return (
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">` +
    `<title>${esc(title)}</title>` +
    `</head>`
  );
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Build the carrier-facing rate-request email. Plain, professional, factual —
 *  a business rate request, not marketing. Every optional detail is omitted when
 *  absent so a sparse request still reads cleanly. */
export function buildCarrierRfqEmail(
  request: RfqRequest,
  recipient: Pick<RfqRecipient, 'carrierName' | 'quoteToken'>,
  baseUrl: string,
): BuiltEmail {
  const lane = laneSummary(request);
  const qUrl = quoteUrl(baseUrl, recipient.quoteToken);
  const oUrl = optOutUrl(baseUrl, recipient.quoteToken);

  // Detail lines — only those with a value.
  const details: Array<[string, string]> = [];
  details.push(['Lane', lane]);
  if (request.equipment) details.push(['Equipment', request.equipment]);
  if (request.containerType) details.push(['Container', request.containerType]);
  if (request.commodity) details.push(['Commodity', request.commodity]);
  if (request.weight) details.push(['Weight', request.weight]);
  if (request.readyDate) details.push(['Ready date', request.readyDate]);
  if (request.targetRate) details.push(['Target rate', request.targetRate]);

  const shipper = request.shipperCompany
    ? `${request.shipperName} (${request.shipperCompany})`
    : request.shipperName;

  const subject = `Rate request: ${lane}${request.equipment ? ` · ${request.equipment}` : ''}`;

  // ── Plaintext ────────────────────────────────────────────────────────────
  const textLines: string[] = [
    `Hello ${recipient.carrierName},`,
    '',
    `A shipper is requesting a rate for the following shipment:`,
    '',
    ...details.map(([k, v]) => `  ${k}: ${v}`),
  ];
  if (request.notes) {
    textLines.push('', `Notes: ${request.notes}`);
  }
  textLines.push(
    '',
    `Submit your quote here:`,
    qUrl,
    '',
    `Requested by: ${shipper}`,
    ...footerText(baseUrl, oUrl),
  );
  const text = textLines.join('\n');

  // ── HTML (inline styles — email clients don't support CSS variables) ───────
  const rows = details
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#5b6472;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(
          k,
        )}</td><td style="padding:6px 0;color:#0b0f15;font-size:14px;font-weight:600;">${esc(v)}</td></tr>`,
    )
    .join('');
  const notesHtml = request.notes
    ? `<p style="margin:16px 0 0;color:#3a4250;font-size:14px;line-height:1.5;"><strong style="color:#0b0f15;">Notes:</strong> ${esc(
        request.notes,
      )}</p>`
    : '';
  const html = `<!doctype html>
<html lang="en">${emailHead(subject)}<body style="margin:0;padding:0;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0b0f15;">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6472;">Rate request</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.25;color:#0b0f15;">${esc(laneSummary(request))}</h1>
    <p style="margin:0 0 16px;color:#3a4250;font-size:14px;line-height:1.5;">Hello ${esc(
      recipient.carrierName,
    )}, a shipper is requesting a rate for the shipment below. If it's a lane you run, submit a quote — it takes about a minute.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px;">${rows}</table>
    ${notesHtml}
    <div style="margin:24px 0;">
      <a href="${esc(qUrl)}" style="display:inline-block;background:#0b0f15;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:4px;">Submit your quote →</a>
    </div>
    <p style="margin:0 0 4px;color:#5b6472;font-size:13px;">Requested by ${esc(shipper)}.</p>
    ${footerHtml(baseUrl, oUrl)}
  </div>
</body></html>`;

  return { subject, text, html };
}

/**
 * Build the carrier-facing email from a per-carrier DRAFT (the AI-drafted,
 * shipper-reviewed "Dear <Company>," letter) instead of the static template. The
 * letter body carries the personalization + the ask; this wrapper only adds the
 * factual quote-submission CTA and the SAME compliance chrome (one-click opt-out
 * + physical address) as buildCarrierRfqEmail — so the two-phase send keeps every
 * guardrail intact.
 */
export function buildDraftedRfqEmail(
  request: RfqRequest,
  recipient: Pick<RfqRecipient, 'quoteToken'>,
  baseUrl: string,
  draft: { subject: string; body: string },
): BuiltEmail {
  const qUrl = quoteUrl(baseUrl, recipient.quoteToken);
  const oUrl = optOutUrl(baseUrl, recipient.quoteToken);
  const subject = (draft.subject || '').trim() || `Rate request: ${laneSummary(request)}`;
  const bodyText = (draft.body || '').trim();

  // ── Plaintext ────────────────────────────────────────────────────────────
  const text = [
    bodyText,
    '',
    'Submit your quote here:',
    qUrl,
    ...footerText(baseUrl, oUrl),
  ].join('\n');

  // ── HTML — the letter as paragraphs, then the CTA + compliance footer. ─────
  const paras = bodyText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;color:#0b0f15;font-size:14px;line-height:1.6;white-space:pre-line;">${esc(
          p,
        )}</p>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en">${emailHead(subject)}<body style="margin:0;padding:0;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0b0f15;">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6472;">Rate request</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.25;color:#0b0f15;">${esc(laneSummary(request))}</h1>
    ${paras}
    <div style="margin:24px 0;">
      <a href="${esc(qUrl)}" style="display:inline-block;background:#0b0f15;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:4px;">Submit your quote →</a>
    </div>
    ${footerHtml(baseUrl, oUrl)}
  </div>
</body></html>`;

  return { subject, text, html };
}

export type RfqSendStatus = 'sent' | 'failed' | 'opted_out';

export interface RfqSendResult {
  status: RfqSendStatus;
  /** True when the email was rendered + logged but NOT actually sent (gate off). */
  dryRun: boolean;
  providerId?: string;
  error?: string;
}

export interface SendRfqDeps {
  /** Injected sender (defaults to the app's real sendEmail). */
  send?: (msg: Parameters<typeof realSendEmail>[0]) => Promise<EmailOut>;
  /** Injected suppression check (defaults to always-false; the route wires the
   *  real outreach suppression store). */
  isEmailSuppressed?: (email: string) => Promise<boolean>;
  /** Override the live-send gate (defaults to rfqLiveSendEnabled()). */
  liveSend?: boolean;
  /** Base URL for links (defaults to PUBLIC_BASE_URL). */
  baseUrl?: string;
}

/**
 * Send ONE carrier's rate-request email, honoring the compliance guardrails +
 * the live-send gate. Never throws — an unexpected sender failure is caught and
 * reported as 'failed'.
 */
export async function sendRfqToCarrier(
  request: RfqRequest,
  recipient: Pick<RfqRecipient, 'carrierName' | 'carrierEmail' | 'quoteToken'> &
    Partial<Pick<RfqRecipient, 'draftSubject' | 'draftBody'>>,
  deps: SendRfqDeps = {},
): Promise<RfqSendResult> {
  const send = deps.send ?? realSendEmail;
  const isEmailSuppressed = deps.isEmailSuppressed ?? (async () => false);
  const liveSend = deps.liveSend ?? rfqLiveSendEnabled();
  const baseUrl = deps.baseUrl ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:5000';

  const to = (recipient.carrierEmail ?? '').trim();
  if (!to) return { status: 'failed', dryRun: !liveSend, error: 'no recipient email' };

  // SUPPRESSION FIRST — never email an opted-out/suppressed address, even live.
  if (await isEmailSuppressed(to)) {
    return { status: 'opted_out', dryRun: !liveSend };
  }

  // Prefer the per-carrier drafted (AI/edited) letter when one is persisted;
  // otherwise fall back to the static template (keeps old callers working).
  const draftBody = (recipient.draftBody ?? '').trim();
  const built = draftBody
    ? buildDraftedRfqEmail(request, recipient, baseUrl, {
        subject: (recipient.draftSubject ?? '').trim(),
        body: draftBody,
      })
    : buildCarrierRfqEmail(request, recipient, baseUrl);

  // Gate OFF → dry-run: render + log, but DO NOT touch the network sender.
  if (!liveSend) {
    console.log(
      `[rfq] DRY-RUN (RFQ_LIVE_SEND off) — would email ${to}: ${built.subject}`,
    );
    return { status: 'sent', dryRun: true };
  }

  // Gate ON → actually send.
  try {
    const out = await send({
      to,
      subject: built.subject,
      text: built.text,
      html: built.html,
      from: brandedFrom(SENDER_NAME),
      listUnsubscribeUrl: optOutUrl(baseUrl, recipient.quoteToken),
    });
    if (out.logged || out.provider === 'stdout') {
      // No real provider configured — treat as a failed live send (not a false
      // 'sent'), so the recipient row reflects that nothing left the building.
      return { status: 'failed', dryRun: false, error: 'no email provider configured' };
    }
    if (!out.ok) return { status: 'failed', dryRun: false, error: out.error ?? 'send failed' };
    return { status: 'sent', dryRun: false, providerId: out.id };
  } catch (err) {
    return { status: 'failed', dryRun: false, error: err instanceof Error ? err.message : String(err) };
  }
}
