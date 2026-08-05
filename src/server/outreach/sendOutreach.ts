/**
 * Outreach SEND — Phase 3 of the AI Outreach Engine.
 *
 * Takes a reviewed, persisted draft (subject + HTML/plaintext body + unsubscribe
 * token, produced by Phase 2's `draftOutreachEmail` and stored in
 * `outreach_emails`) and actually sends it, then records the outcome on the row.
 *
 * Two invariants:
 *   1. SUPPRESSION FIRST. Before anything hits the wire we check the opt-out
 *      state — the draft's own `suppressed` flag AND any prior suppressed row for
 *      the same normalized recipient address. A suppressed recipient is NEVER
 *      emailed: we return `{ ok:false, skipped:'suppressed' }` and record
 *      `status:'skipped'`. This is the CASL/CAN-SPAM opt-out guarantee.
 *   2. GRACEFUL. We reuse the app's existing `sendEmail` abstraction
 *      (Resend → SMTP → stdout, see src/email/send.ts). If no provider is
 *      configured it degrades to a logged-only "send"; we surface that as
 *      `{ ok:false, status:'unconfigured' }` (recorded, logged) and NEVER throw.
 *      A provider error is caught and recorded as `status:'failed'`.
 *
 * Pure + injectable: `send` (the email sender) and `store` are injected so tests
 * run without the network, the vendor, or the DB.
 */
import type { OutreachEmail } from '../../db/schema.js';
import { sendEmail as realSendEmail, brandedFrom, type EmailOut } from '../../email/send.js';
import { SENDER_NAME } from './draftEmail.js';
import {
  dbOutreachEmailStore,
  normalizeEmailAddress,
  type OutreachEmailStore,
} from './outreachEmailStore.js';

/** Result of a Phase-3 send attempt. */
export interface SendOutreachResult {
  ok: boolean;
  /** 'sent' | 'failed' | 'skipped' | 'unconfigured'. */
  status: 'sent' | 'failed' | 'skipped' | 'unconfigured';
  /** Provider message id on a successful send. */
  providerId?: string;
  /** Set when the send was skipped (e.g. 'suppressed', 'no-recipient'). */
  skipped?: string;
  /** Set on a failure — a human-readable summary (never a secret value). */
  error?: string;
  /** The row id that was sent/recorded, when known. */
  emailId?: number;
}

export interface SendOutreachDeps {
  /** Injected email sender — defaults to the app's real `sendEmail`. */
  send?: (msg: Parameters<typeof realSendEmail>[0]) => Promise<EmailOut>;
  /** Injected persistence — defaults to the DB-backed store. */
  store?: OutreachEmailStore;
  /** Base URL for the one-click unsubscribe link. Defaults to PUBLIC_BASE_URL. */
  publicBaseUrl?: string;
}

export interface SendOutreachInput {
  /** Send a persisted draft by its row id (looked up via the store). */
  emailId?: number;
  /** OR pass an already-loaded persisted draft row directly. */
  draft?: OutreachEmail;
  /** Recipient address. Falls back to the draft's stored `recipientEmail`. */
  to?: string | null;
}

/** Build the RFC 8058 one-click unsubscribe URL for a draft's token. */
function unsubscribeUrl(base: string, token: string): string {
  return `${(base || '').replace(/\/$/, '')}/outreach/unsubscribe/${token}`;
}

/**
 * Send a single reviewed outreach draft (sequence step 1).
 *
 * Suppression is checked FIRST; the send goes through the shared `sendEmail`
 * abstraction; the outcome is recorded on the `outreach_emails` row. Never throws.
 */
export async function sendOutreachEmail(
  input: SendOutreachInput,
  deps: SendOutreachDeps = {},
): Promise<SendOutreachResult> {
  const send = deps.send ?? realSendEmail;
  const store = deps.store ?? dbOutreachEmailStore;
  const publicBaseUrl = deps.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:5000';

  // 1. Resolve the persisted draft.
  const draft = input.draft ?? (input.emailId != null ? await store.getById(input.emailId) : null);
  if (!draft) {
    return { ok: false, status: 'failed', error: 'draft not found' };
  }
  const emailId = draft.id;

  // 2. Resolve the recipient (explicit `to` wins, else the draft's stored one).
  const to = normalizeEmailAddress(input.to ?? draft.recipientEmail);
  if (!to) {
    await store.recordSend(emailId, { status: 'skipped' });
    return { ok: false, status: 'skipped', skipped: 'no-recipient', emailId };
  }

  // 3. SUPPRESSION FIRST — never email an opted-out recipient.
  const suppressed = draft.suppressed || (await store.isRecipientSuppressed(to));
  if (suppressed) {
    await store.recordSend(emailId, { status: 'skipped' });
    return { ok: false, status: 'skipped', skipped: 'suppressed', emailId };
  }

  // 4. Send via the shared abstraction, with a marketing List-Unsubscribe header.
  let out: EmailOut;
  try {
    out = await send({
      to,
      subject: draft.subject,
      html: draft.bodyHtml,
      text: draft.bodyText,
      from: brandedFrom(SENDER_NAME),
      listUnsubscribeUrl: unsubscribeUrl(publicBaseUrl, draft.unsubscribeToken),
    });
  } catch (err) {
    // Graceful: an unexpected sender throw is recorded, never propagated.
    const error = err instanceof Error ? err.message : String(err);
    await store.recordSend(emailId, { status: 'failed', error });
    return { ok: false, status: 'failed', error, emailId };
  }

  // 5. No provider configured → the abstraction logged only. Surface as
  //    'unconfigured' (recorded, not a hard failure).
  if (out.logged || out.provider === 'stdout') {
    await store.recordSend(emailId, { status: 'unconfigured' });
    return { ok: false, status: 'unconfigured', emailId };
  }

  // 6. Provider failed (all configured providers errored).
  if (!out.ok) {
    await store.recordSend(emailId, { status: 'failed', error: out.error ?? 'send failed' });
    return { ok: false, status: 'failed', error: out.error, emailId };
  }

  // 7. Sent. Record sent_at + provider id.
  await store.recordSend(emailId, { status: 'sent', sentAt: new Date(), providerId: out.id ?? null, step: 1 });
  return { ok: true, status: 'sent', providerId: out.id, emailId };
}
