/**
 * RFQ carrier email — the rate-request that lands in each filtered carrier's
 * inbox, plus the send wrapper with the LIVE-SEND gate + compliance guardrails.
 *
 * COMPLIANCE (mirrors outreach/sendOutreach.ts):
 *   - SUPPRESSION FIRST. A suppressed / opted-out address is NEVER emailed, even
 *     when live sending is on. Checked before anything hits the wire.
 *   - HONEST From via brandedFrom(SENDER_NAME) — reuses the platform's verified
 *     sending address so SPF/DKIM stay intact.
 *   - PHYSICAL mailing address (SENDER_ADDRESS) in the footer.
 *   - ONE-CLICK UNSUBSCRIBE (RFC 8058) = the carrier's opt-out link, passed as
 *     listUnsubscribeUrl so sendEmail attaches List-Unsubscribe + -Post headers.
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
    '',
    `If you'd rather not receive rate requests, opt out here:`,
    oUrl,
    '',
    `${SENDER_NAME} · ${SENDER_ADDRESS}`,
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
<html><body style="margin:0;padding:0;background:#f4f5f7;">
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
    <hr style="border:none;border-top:1px solid #e3e6ea;margin:24px 0 12px;">
    <p style="margin:0 0 6px;color:#8a919e;font-size:12px;line-height:1.5;">You received this because your carrier is listed in the public FMCSA-sourced ${esc(
      SENDER_NAME,
    )} directory. Don't want rate requests? <a href="${esc(
      oUrl,
    )}" style="color:#5b6472;">Opt out in one click</a>.</p>
    <p style="margin:0;color:#8a919e;font-size:12px;">${esc(SENDER_NAME)} · ${esc(SENDER_ADDRESS)}</p>
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
  recipient: Pick<RfqRecipient, 'carrierName' | 'carrierEmail' | 'quoteToken'>,
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

  const built = buildCarrierRfqEmail(request, recipient, baseUrl);

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
