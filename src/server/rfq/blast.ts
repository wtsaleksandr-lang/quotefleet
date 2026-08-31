/**
 * RFQ fan-out — one blast, one durable outcome.
 *
 * WHAT WAS INVISIBLE
 * ──────────────────
 * The send route looped recipients, called the mailer, wrote a per-recipient
 * status, and then threw the aggregate away. Three consequences, all bad now
 * that `RFQ_LIVE_SEND` is ON and these are real emails to real carriers:
 *
 *   1. The confirmation page counted `sent`, `no_email` and `opted_out` — and
 *      NOT `failed`. A blast in which every single delivery hard-failed rendered
 *      "0 Requests sent" with no indication that anything had gone wrong. The
 *      shipper was shown a success page for a total failure.
 *   2. `sendRfqToCarrier` returns an `error` string on each failure ("no email
 *      provider configured", an SMTP rejection). The route discarded it, so WHY
 *      a send failed was never recorded anywhere.
 *   3. Nothing was written to the job-run ledger and nothing alerted. A
 *      systematic failure — provider key rotated, sender domain suspended —
 *      looked exactly like a quiet day.
 *
 * WHAT THIS DOES
 * ──────────────
 * Runs the same fan-out, but returns the full breakdown (attempted / sent /
 * prepared / suppressed / failed, plus the failure reasons) and records it as
 * ONE run in the #464 ledger via `runTrackedJob`. A blast with any hard failure
 * records `failure`, which is what raises the de-duped admin email — no second
 * notification mechanism, the existing one now simply has something to say.
 *
 * WHY A DRY RUN IS `skipped`, NOT `success`
 * ─────────────────────────────────────────
 * With `RFQ_LIVE_SEND` off the mailer renders the letter, logs it, and reports
 * `sent` WITHOUT touching a provider. Recording that as a successful send would
 * be the same lie as #465's "logged to stdout, marked delivered" — the ledger
 * would show 25 rate requests delivered on a day nothing left the building. A
 * dry run ticked and correctly did nothing, which is exactly `skipped`.
 */
import {
  runTrackedJob,
  jobSuccess,
  jobSkipped,
  jobFailure,
  type JobOutcome,
} from '../jobHealth.js';
import { sendRfqToCarrier, type SendRfqDeps } from './email.js';
import type { RfqStore } from './store.js';
import type { RfqRequest, RfqRecipient, RfqRecipientStatus } from '../../db/schema.js';

/** Ledger key. NOT in JOB_REGISTRY on purpose — a blast is user-triggered, so
 *  "no blast in three hours" is a quiet Tuesday, not a fault. The watchdog
 *  checks CADENCE; this job has none. Its failures still alert through
 *  runTrackedJob, and the ledger still records every run. */
export const RFQ_BLAST_JOB = 'rfq-blast';

export interface RfqBlastResult {
  rfqId: number;
  /** Recipients we actually attempted (status was `pending`). */
  attempted: number;
  /** Accepted by a real email provider. Zero in a dry run, always. */
  sent: number;
  /** Rendered + logged only, because the live-send gate is off. NOT sent. */
  prepared: number;
  /** Skipped at send time by the suppression / opt-out list. */
  suppressed: number;
  /** Hard delivery failures. THE COUNT THAT USED TO VANISH. */
  failed: number;
  /** Recipients that never had an address (classified before this send). */
  noEmail: number;
  /** Recipients already opted out before this send. */
  optedOutBefore: number;
  /** One reason per failure — carrier + the mailer's error. */
  errors: string[];
  dryRun: boolean;
  /** Final status per recipient id, for the confirmation page's counts. */
  finalStatus: Map<number, RfqRecipientStatus>;
}

export interface RfqBlastDeps {
  store: Pick<RfqStore, 'markRecipientStatus' | 'updateRecipientDraft'>;
  /** Per-recipient edits from the confirm form, keyed by recipient id. */
  edited: (rec: RfqRecipient) => { subject: string; body: string };
  sendDeps: SendRfqDeps;
  liveSend: boolean;
  throttleMs: number;
  sleep: (ms: number) => Promise<void>;
}

/** Cap on how much failure detail rides into the ledger row (which truncates at
 *  500 chars anyway) — enough to name the pattern without burying it. */
const MAX_REPORTED_ERRORS = 3;

/**
 * Run the fan-out over the PENDING recipients of one request.
 *
 * Per-recipient failures are collected, never thrown: one carrier's dead mailbox
 * must not abort the other twenty-four. A throw out of here means something
 * structural broke (the store, the loop) and the caller records + rethrows it.
 */
export async function runRfqBlast(
  request: RfqRequest,
  recipients: readonly RfqRecipient[],
  deps: RfqBlastDeps,
): Promise<RfqBlastResult> {
  const finalStatus = new Map<number, RfqRecipientStatus>();
  for (const rec of recipients) finalStatus.set(rec.id, rec.status as RfqRecipientStatus);

  const result: RfqBlastResult = {
    rfqId: request.id,
    attempted: 0,
    sent: 0,
    prepared: 0,
    suppressed: 0,
    failed: 0,
    noEmail: recipients.filter((r) => r.status === 'no_email').length,
    optedOutBefore: recipients.filter((r) => r.status === 'opted_out').length,
    errors: [],
    dryRun: !deps.liveSend,
    finalStatus,
  };

  for (const rec of recipients) {
    // Only pending rows are sent. Re-posting a request whose recipients are
    // already 'sent'/'quoted'/'opted_out' is a no-op, not a re-blast.
    if (rec.status !== 'pending') continue;
    result.attempted++;

    const { subject, body } = deps.edited(rec);
    if (subject !== (rec.draftSubject ?? '') || body !== (rec.draftBody ?? '')) {
      await deps.store.updateRecipientDraft(rec.id, subject, body);
    }

    const outcome = await sendRfqToCarrier(
      request,
      {
        carrierName: rec.carrierName,
        carrierEmail: rec.carrierEmail,
        quoteToken: rec.quoteToken,
        draftSubject: subject || null,
        draftBody: body || null,
      },
      deps.sendDeps,
    );

    if (outcome.status === 'sent') {
      if (outcome.dryRun) result.prepared++;
      else result.sent++;
    } else if (outcome.status === 'opted_out') {
      result.suppressed++;
    } else {
      result.failed++;
      result.errors.push(`${rec.carrierName}: ${outcome.error ?? 'unknown error'}`);
    }

    const next: RfqRecipientStatus =
      outcome.status === 'sent' ? 'sent' : outcome.status === 'opted_out' ? 'opted_out' : 'failed';
    await deps.store.markRecipientStatus(rec.id, next, next === 'sent' ? new Date() : null);
    finalStatus.set(rec.id, next);

    if (deps.liveSend && deps.throttleMs > 0) await deps.sleep(deps.throttleMs);
  }

  return result;
}

/**
 * Turn a blast into a ledger outcome. PURE — unit-tested without a send.
 *
 * The ordering matters:
 *   • ANY hard failure ⇒ `failure`. A half-failed blast is the case this whole
 *     module exists for: it is the one that looks fine and is not. It alerts.
 *   • Nothing attempted ⇒ `skipped` (a re-post of an already-sent request).
 *   • A dry run ⇒ `skipped`, never `success` — nothing was sent (see header).
 */
export function rfqBlastOutcome(r: RfqBlastResult): JobOutcome {
  const shape =
    `rfq #${r.rfqId}: ${r.attempted} attempted, ${r.sent} sent, ${r.prepared} prepared (dry-run), ` +
    `${r.suppressed} suppressed, ${r.failed} failed`;

  if (r.failed > 0) {
    const shown = r.errors.slice(0, MAX_REPORTED_ERRORS).join('; ');
    const more = r.errors.length > MAX_REPORTED_ERRORS ? ` (+${r.errors.length - MAX_REPORTED_ERRORS} more)` : '';
    return jobFailure(
      `${r.failed} of ${r.attempted} rate requests could not be delivered — ${shape}. ${shown}${more}`,
    );
  }
  if (r.attempted === 0) return jobSkipped(`${shape} — nothing pending to send`);
  if (r.dryRun) return jobSkipped(`${shape} — RFQ_LIVE_SEND is off, nothing left the building`);
  return jobSuccess(r.sent, shape);
}

/**
 * Run a blast and record it. Rethrows a structural failure AFTER recording it,
 * so the route still 500s rather than rendering a confirmation for a blast that
 * did not happen — the ledger and the shipper get the same answer.
 */
export async function runTrackedRfqBlast(
  request: RfqRequest,
  recipients: readonly RfqRecipient[],
  deps: RfqBlastDeps,
  track: typeof runTrackedJob = runTrackedJob,
): Promise<RfqBlastResult> {
  let result: RfqBlastResult | undefined;
  let thrown: unknown;
  await track(RFQ_BLAST_JOB, async () => {
    try {
      result = await runRfqBlast(request, recipients, deps);
    } catch (err) {
      thrown = err;
      return jobFailure(
        `rfq #${request.id} blast aborted: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return rfqBlastOutcome(result);
  });
  if (thrown) throw thrown;
  // `result` is assigned unless `thrown` was set, and that path returned above.
  return result as RfqBlastResult;
}
