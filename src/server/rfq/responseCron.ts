/**
 * RFQ response watcher — "did anyone actually reply?"
 *
 * WHAT WAS MISSING
 * ────────────────
 * A carrier submitting a quote flipped a row to `quoted` and stopped there. The
 * shipper was never told; discovering it meant remembering a private link and
 * re-opening it on the off chance. For a rate quote — which expires — that is
 * effectively not being told at all. And a blast that reached twenty-five
 * carriers and got NOTHING back looked, from the responses page, exactly like a
 * page opened five minutes too early.
 *
 * Ops had the same blind spot from the other side: the delivery outcome of a
 * blast is now recorded (rfq/blast.ts), but "delivered fine, nobody answered" is
 * a different and equally important failure — it means the carrier set, the
 * lane, or the letter is wrong, and nothing was measuring it.
 *
 * WHAT THIS DOES, ONCE AN HOUR
 * ────────────────────────────
 *   • New quotes since the last notification → email the shipper, batched
 *     ("3 new quotes on Chicago → Dallas"), then advance the high-water mark.
 *   • Delivered ≥ NO_REPLY_HOURS ago with zero quotes → tell the shipper once
 *     (with the one useful next step) and open an `ops_alerts` row so the daily
 *     digest carries it. Both are idempotent.
 *   • A quote arriving later resolves the no-reply alert automatically, and a
 *     request that ages past the window resolves itself rather than sitting in
 *     the digest forever. An alert nobody can clear is an alert everyone learns
 *     to skip.
 *
 * IDEMPOTENCY, AND WHY THE MARKER MOVES *AFTER* THE SEND
 * ─────────────────────────────────────────────────────
 * The high-water mark is the id of the newest quote the shipper has been told
 * about, kept in `ops_alerts` (kind `rfq_quotes_notified`, status `tracking`).
 * It is advanced ONLY when `wasSentByAProvider()` confirms a real provider took
 * the message. `sendEmail` returns `ok: true` for a stdout-only fallback, and
 * stamping the marker on that would permanently lose the notification — the
 * exact bug #465 fixed in the lifecycle crons. A send that did not really send
 * leaves the mark where it was, so the next tick retries.
 *
 * COST: one hourly aggregate over rfq_* (indexed, ~dozens of rows) plus at most
 * one email per request per batch. $0.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sendEmail, wasSentByAProvider } from '../../email/send.js';
import {
  runTrackedJob,
  jobSkipped,
  jobSuccess,
  jobFailure,
  type JobOutcome,
} from '../jobHealth.js';
import {
  upsertOpsAlert,
  resolveOpsAlert,
  getOpsAlert,
  type OpsAlertRow,
} from '../opsAlerts.js';
import { buildShipperQuotesEmail, buildShipperNoRepliesEmail } from './email.js';

const TICK_MS = 60 * 60 * 1000; // hourly
const STARTUP_DELAY_MS = 90 * 1000;

/** How long after delivery a silent request counts as "no replies". Two days
 *  covers a weekend-adjacent send without crying wolf on a Monday morning. */
export const NO_REPLY_HOURS = 48;

/** After this the request is old news: the no-reply alert resolves itself so
 *  the ops digest cannot accumulate a permanent tail of unclearable items. */
export const NO_REPLY_EXPIRE_DAYS = 7;

/** Only look at recent requests — an old RFQ is settled business. */
export const LOOKBACK_DAYS = 30;

/** Marker value on the no-reply alert once the shipper has been told once. */
const SHIPPER_TOLD = 'shipper_notified';

let started = false;

export function startRfqResponseCron(): void {
  if (started) return;
  if (process.env.RFQ_RESPONSE_DISABLED === '1') {
    console.log('[rfqResponse.cron] disabled via RFQ_RESPONSE_DISABLED=1');
    return;
  }
  started = true;
  setTimeout(() => void tick('startup'), STARTUP_DELAY_MS);
  setInterval(() => void tick('tick'), TICK_MS);
  console.log('[rfqResponse.cron] scheduled — hourly');
}

async function tick(reason: string): Promise<void> {
  await runTrackedJob('rfq-response-digest', () => runRfqResponsePassOnce(new Date(), {}, reason));
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the state of every recent blast
// ─────────────────────────────────────────────────────────────────────────────

export interface RfqResponseRow {
  id: number;
  viewToken: string;
  shipperEmail: string;
  shipperName: string;
  origin: string;
  destination: string;
  equipment: string | null;
  /** Recipients a request actually reached (`sent` or already `quoted`). */
  delivered: number;
  /** Newest successful delivery on the request. */
  lastSentAt: Date | null;
  quoteCount: number;
  /** Highest quote id on the request — the notification high-water mark. */
  maxQuoteId: number | null;
}

interface RawRow {
  id: number | string;
  view_token: string;
  shipper_email: string;
  shipper_name: string;
  origin: string;
  destination: string;
  equipment: string | null;
  delivered: number | string;
  last_sent_at: string | Date | null;
  quote_count: number | string;
  max_quote_id: number | string | null;
}

const num = (v: number | string | null): number => (v == null ? 0 : typeof v === 'number' ? v : Number(v) || 0);
const maybeNum = (v: number | string | null): number | null => (v == null ? null : num(v));
const maybeDate = (v: string | Date | null): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Every recent request that actually reached at least one carrier, with its
 * delivery + quote counters. One indexed round trip; a request that reached
 * nobody is excluded because there is no reply to wait for.
 */
export async function readRfqResponseState(): Promise<RfqResponseRow[]> {
  const rows = (await db().execute(sql`
    select r."id"             as "id",
           r."view_token"     as "view_token",
           r."shipper_email"  as "shipper_email",
           r."shipper_name"   as "shipper_name",
           r."origin"         as "origin",
           r."destination"    as "destination",
           r."equipment"      as "equipment",
           count(*) filter (where rec."status" in ('sent', 'quoted'))  as "delivered",
           max(rec."sent_at")                                          as "last_sent_at",
           (select count(*)   from "rfq_quotes" q where q."rfq_id" = r."id") as "quote_count",
           (select max(q."id") from "rfq_quotes" q where q."rfq_id" = r."id") as "max_quote_id"
      from "rfq_requests" r
      join "rfq_recipients" rec on rec."rfq_id" = r."id"
     where r."created_at" > now() - ${`${LOOKBACK_DAYS} days`}::interval
     group by r."id"
    having count(*) filter (where rec."status" in ('sent', 'quoted')) > 0
     order by r."id"
  `)) as unknown as RawRow[];

  return rows.map((r) => ({
    id: num(r.id),
    viewToken: r.view_token,
    shipperEmail: r.shipper_email,
    shipperName: r.shipper_name,
    origin: r.origin,
    destination: r.destination,
    equipment: r.equipment,
    delivered: num(r.delivered),
    lastSentAt: maybeDate(r.last_sent_at),
    quoteCount: num(r.quote_count),
    maxQuoteId: maybeNum(r.max_quote_id),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The decision (PURE — no DB, no clock, no email)
// ─────────────────────────────────────────────────────────────────────────────

export type RfqAction =
  /** New quotes the shipper has not seen. */
  | { kind: 'notify_quotes'; newSince: number }
  /** Delivered, silent past the window, shipper not yet told. */
  | { kind: 'no_replies'; hoursSilent: number; tellShipper: boolean }
  /** A quote arrived, or the request aged out — clear any standing alert. */
  | { kind: 'clear'; reason: string }
  | { kind: 'none' };

const HOUR_MS = 60 * 60 * 1000;

/**
 * What to do about one request. PURE.
 *
 * `notifiedMarker` is the highest quote id already reported to the shipper;
 * `noReplyAlert` is the standing ops alert for this request, if any.
 *
 * Order matters: quotes beat silence. A request that got a late quote must
 * clear its no-reply alert in the same pass that notifies the shipper, or the
 * digest keeps asking about a lane that has already been answered.
 */
export function decideRfqAction(
  row: RfqResponseRow,
  notifiedMarker: number | null,
  noReplyAlert: OpsAlertRow | null,
  now: Date,
): RfqAction {
  if (row.maxQuoteId != null && row.maxQuoteId > (notifiedMarker ?? 0)) {
    return { kind: 'notify_quotes', newSince: notifiedMarker ?? 0 };
  }
  if (row.quoteCount > 0) {
    // Answered and already reported. Clear a stale no-reply alert if one stands.
    return noReplyAlert && noReplyAlert.status === 'open'
      ? { kind: 'clear', reason: 'a quote arrived' }
      : { kind: 'none' };
  }
  if (!row.lastSentAt) return { kind: 'none' };
  const hoursSilent = (now.getTime() - row.lastSentAt.getTime()) / HOUR_MS;
  if (hoursSilent < NO_REPLY_HOURS) return { kind: 'none' };
  if (hoursSilent > NO_REPLY_EXPIRE_DAYS * 24) {
    // Old news. Resolve rather than let it sit in the digest forever — an alert
    // nobody can clear is an alert everyone learns to skip.
    return noReplyAlert && noReplyAlert.status === 'open'
      ? { kind: 'clear', reason: `aged out after ${NO_REPLY_EXPIRE_DAYS} days with no replies` }
      : { kind: 'none' };
  }
  return { kind: 'no_replies', hoursSilent, tellShipper: noReplyAlert?.marker !== SHIPPER_TOLD };
}

// ─────────────────────────────────────────────────────────────────────────────
// The pass
// ─────────────────────────────────────────────────────────────────────────────

export interface RfqResponseDeps {
  read: () => Promise<RfqResponseRow[]>;
  /** Exact count of quotes newer than the shipper's high-water mark. */
  countNew: (rfqId: number, marker: number) => Promise<number>;
  getAlert: typeof getOpsAlert;
  upsert: typeof upsertOpsAlert;
  resolve: typeof resolveOpsAlert;
  send: typeof sendEmail;
  baseUrl: () => string;
  log: (msg: string) => void;
}

function defaultDeps(): RfqResponseDeps {
  return {
    read: readRfqResponseState,
    countNew: countQuotesAbove,
    getAlert: getOpsAlert,
    upsert: upsertOpsAlert,
    resolve: resolveOpsAlert,
    send: sendEmail,
    baseUrl: () => (process.env.PUBLIC_BASE_URL ?? 'https://quotefleet.net').replace(/\/$/, ''),
    log: (msg) => console.log(msg),
  };
}

const QUOTES_KIND = 'rfq_quotes_notified' as const;
const NO_REPLY_KIND = 'rfq_no_replies' as const;
const refOf = (rfqId: number): string => `rfq:${rfqId}`;

/**
 * One pass.
 *
 * A read failure PROPAGATES (→ `failure` + admin alert): a pass that cannot see
 * the quotes must never report "no new quotes". Per-request failures are
 * collected instead of thrown — one bad row must not stop the other twenty —
 * but they still make the whole pass report `failure`, because a pass that
 * silently dropped a shipper's notification did not succeed.
 */
export async function runRfqResponsePassOnce(
  now: Date,
  overrides: Partial<RfqResponseDeps> = {},
  reason = 'tick',
): Promise<JobOutcome> {
  const deps: RfqResponseDeps = { ...defaultDeps(), ...overrides };
  const rows = await deps.read();
  if (rows.length === 0) return jobSkipped('no recent rate requests that reached a carrier');

  const base = deps.baseUrl();
  let notified = 0;
  let flagged = 0;
  let cleared = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const ref = refOf(row.id);
    try {
      const [marker, alert] = await Promise.all([
        deps.getAlert(QUOTES_KIND, ref),
        deps.getAlert(NO_REPLY_KIND, ref),
      ]);
      const notifiedMarker = marker?.marker != null ? Number(marker.marker) : null;
      const action = decideRfqAction(
        row,
        Number.isFinite(notifiedMarker as number) ? (notifiedMarker as number) : null,
        alert,
        now,
      );
      const viewUrl = `${base}/directory/rfq/${row.viewToken}`;

      if (action.kind === 'notify_quotes') {
        const newQuotes = await deps.countNew(row.id, action.newSince);
        const built = buildShipperQuotesEmail({
          request: row,
          newQuotes: Math.max(1, newQuotes),
          totalQuotes: row.quoteCount,
          viewUrl,
        });
        const out = await deps.send({
          to: row.shipperEmail,
          subject: built.subject,
          text: built.text,
          html: built.html,
        });
        if (!wasSentByAProvider(out)) {
          // NOT sent. Leave the high-water mark where it is so the next tick
          // retries, instead of marking a notification delivered that was only
          // written to stdout (see the header).
          errors.push(`rfq #${row.id}: quote notification not sent (${out.error ?? 'logged only'})`);
          continue;
        }
        await deps.upsert({
          kind: QUOTES_KIND,
          ref,
          status: 'tracking',
          title: `Quotes reported to shipper for rfq #${row.id}`,
          detail: `${row.quoteCount} quote(s) on ${row.origin} → ${row.destination}`,
          marker: String(row.maxQuoteId ?? 0),
        });
        // An answered request is no longer a silent one.
        if (alert && alert.status === 'open') {
          await deps.resolve(NO_REPLY_KIND, ref, 'a quote arrived');
          cleared++;
        }
        notified++;
        continue;
      }

      if (action.kind === 'clear') {
        await deps.resolve(NO_REPLY_KIND, ref, action.reason);
        cleared++;
        continue;
      }

      if (action.kind === 'no_replies') {
        let shipperTold = alert?.marker === SHIPPER_TOLD;
        if (action.tellShipper) {
          const built = buildShipperNoRepliesEmail({
            request: row,
            delivered: row.delivered,
            viewUrl,
            directoryUrl: `${base}/directory`,
          });
          const out = await deps.send({
            to: row.shipperEmail,
            subject: built.subject,
            text: built.text,
            html: built.html,
          });
          // Only claim the shipper was told when a provider actually took it.
          shipperTold = wasSentByAProvider(out);
          if (!shipperTold) {
            errors.push(`rfq #${row.id}: no-reply notice not sent (${out.error ?? 'logged only'})`);
          }
        }
        await deps.upsert({
          kind: NO_REPLY_KIND,
          ref,
          status: 'open',
          title: `Rate request with no replies — ${row.origin} → ${row.destination}`,
          detail:
            `rfq #${row.id} reached ${row.delivered} carrier(s) ${Math.round(action.hoursSilent)}h ago ` +
            `and none has quoted. Check the carrier set for this lane — the letter and the filters are ` +
            `the levers here. Shipper ${shipperTold ? 'has been told once' : 'NOT yet told'}.`,
          marker: shipperTold ? SHIPPER_TOLD : null,
        });
        flagged++;
      }
    } catch (err) {
      errors.push(`rfq #${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const shape = `${rows.length} request(s): ${notified} notified, ${flagged} flagged silent, ${cleared} cleared`;
  if (errors.length > 0) {
    return jobFailure(`RFQ response pass hit ${errors.length} error(s) — ${shape}. First: ${errors[0]}`);
  }
  deps.log(`[rfqResponse.cron] pass=${reason} ${shape}`);
  const worked = notified + flagged + cleared;
  return worked > 0 ? jobSuccess(worked, shape) : jobSkipped(shape);
}

/**
 * Exactly how many quotes on this request are newer than the marker.
 *
 * Run ONLY for a request that already has new quotes (rare — a handful a day),
 * so the extra round trip buys an accurate "3 new quotes" instead of a guess.
 * Rides the `rfq_quotes_rfq_idx` index.
 */
export async function countQuotesAbove(rfqId: number, marker: number): Promise<number> {
  const rows = (await db().execute(sql`
    select count(*) as "n" from "rfq_quotes"
     where "rfq_id" = ${rfqId} and "id" > ${marker}
  `)) as unknown as { n: number | string }[];
  return num(rows[0]?.n ?? 0);
}
