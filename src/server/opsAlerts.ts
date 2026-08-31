/**
 * Durable operational-alert ledger — the things that happen OUTSIDE the app,
 * carry a consequence, and need a human, kept visible until someone acts.
 *
 * WHY THIS EXISTS
 * ───────────────
 * PR #464 gave every SCHEDULED unit of work a heartbeat: `job_runs` records what
 * each cron did, and the watchdog turns silence into an alert. That closed the
 * "our automation died quietly" hole. It did not close the other one.
 *
 * Two classes of event happen where no cron of ours is ticking:
 *
 *   • Stripe raises a dispute or a customer's card stops working. Nothing in
 *     this codebase reacted — `handleEvent` fell through `default:` and acked
 *     200, so the first anyone knew was a missing balance or a churned customer.
 *     A dispute carries a RESPONSE WINDOW; miss it and the money is gone by
 *     default, with no notification that anything happened.
 *   • An RFQ blast half-fails, or lands with every carrier and gets no reply.
 *     Per-recipient rows recorded a status, but nothing aggregated it and
 *     nothing surfaced it.
 *
 * A one-shot email is the wrong home for any of it: an email that arrives while
 * nobody is looking is indistinguishable from an email that was never sent, and
 * a dispute deadline is precisely the case where "I missed that one" costs real
 * money. So each of these becomes a ROW with a state, and the daily ops digest
 * re-lists every open row until it is resolved. Push tells you now; this makes
 * sure the item survives being missed.
 *
 * WHY ONE TABLE FOR ALL OF THEM
 * ─────────────────────────────
 * Every item has the same shape: an external fact, keyed by a stable external
 * id, with a status, an optional deadline, and an idempotency marker. Splitting
 * that into a table per feature would mean a digest query per feature and a
 * fresh chance to forget one. One table means adding a kind is a one-line change
 * and the digest picks it up for free.
 *
 * THE THREE STATUSES
 * ──────────────────
 *   open     — a human owes this an action. THE DIGEST LISTS THESE.
 *   tracking — a durable idempotency marker, not work (e.g. "the shipper has
 *              been told about quotes up to id 41"). Never digested.
 *   resolved — done / closed out. Kept for the audit trail, never digested.
 *
 * SELF-HEAL DDL, NOT DRIZZLE — same rule as `job_runs` (jobHealth.ts): Replit's
 * deploy skips db:migrate and its publish tool has repeatedly proposed DROPping
 * tables the ORM does not know about, so every at-risk object is re-asserted on
 * each boot. src/db/schema.ts and drizzle/ stay untouched.
 *
 * COST: one small table (single-digit rows/day), one indexed read per digest.
 * No new service, no third-party call. $0.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { runSelfHealStatements } from '../db/migrate.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. STORAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statement shapes are exactly the three `selfHealTarget()` recognizes, so the
 * catalog pre-check makes the healthy-boot case a lock-free no-op. Never call
 * sql.unsafe() with these directly — always via runSelfHealStatements, which
 * sets lock_timeout + statement_timeout first.
 */
export const OPS_ALERTS_SELF_HEAL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "ops_alerts" (
     "id" bigserial PRIMARY KEY,
     "kind" text NOT NULL,
     "ref" text NOT NULL,
     "status" text NOT NULL DEFAULT 'open',
     "title" text NOT NULL,
     "detail" text,
     "amount_cents" integer,
     "currency" text,
     "due_at" timestamptz,
     "marker" text,
     "opened_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now(),
     "resolved_at" timestamptz,
     "outcome" text
   )`,
  // The upsert key. Every writer is at-least-once (Stripe re-delivers webhooks;
  // an hourly cron re-examines the same RFQ), so (kind, ref) MUST be unique or
  // a redelivery silently duplicates the alert.
  `CREATE UNIQUE INDEX IF NOT EXISTS "ops_alerts_kind_ref_idx" ON "ops_alerts" ("kind", "ref")`,
  // The digest's only query is "open rows, soonest deadline first".
  `CREATE INDEX IF NOT EXISTS "ops_alerts_status_due_idx" ON "ops_alerts" ("status", "due_at")`,
];

/** Boot hook. Non-blocking + never throws at the call site (see server/index.ts). */
export async function ensureOpsAlertsTable(): Promise<void> {
  await runSelfHealStatements('ops_alerts ledger', OPS_ALERTS_SELF_HEAL_STATEMENTS);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE MODEL
// ─────────────────────────────────────────────────────────────────────────────

export type OpsAlertKind =
  /** A Stripe dispute/chargeback. Deadline-bearing — evidence is due by a date. */
  | 'stripe_dispute'
  /** A paying customer's card expires soon (or its payment method vanished). */
  | 'card_problem'
  /** An RFQ blast that reached carriers and got no reply. */
  | 'rfq_no_replies'
  /** Idempotency marker: quotes the shipper has already been told about. */
  | 'rfq_quotes_notified';

/**
 * `open` = a human owes this an action (digested daily until resolved).
 * `tracking` = a durable marker, never digested.
 * `resolved` = closed out, kept for the trail.
 */
export type OpsAlertStatus = 'open' | 'tracking' | 'resolved';

export interface OpsAlertRow {
  kind: string;
  ref: string;
  status: string;
  title: string;
  detail: string | null;
  amountCents: number | null;
  currency: string | null;
  dueAt: Date | null;
  marker: string | null;
  openedAt: Date | null;
  updatedAt: Date | null;
}

export interface UpsertOpsAlertInput {
  kind: OpsAlertKind;
  /** Stable external key — the Stripe dispute id, `rfq:<id>`, etc. */
  ref: string;
  status: OpsAlertStatus;
  /** One line naming the thing. Shown as the digest heading. */
  title: string;
  detail?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  /** Deadline, when the item has one. Drives urgency + the countdown. */
  dueAt?: Date | null;
  /** Idempotency high-water mark (e.g. the last quote id notified). */
  marker?: string | null;
}

/** Alert `detail` is a prompt to act, not an archive — keep rows small. */
export const OPS_ALERT_DETAIL_MAX = 1000;

export function truncateAlertDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const s = detail.trim();
  if (!s) return null;
  return s.length <= OPS_ALERT_DETAIL_MAX ? s : `${s.slice(0, OPS_ALERT_DETAIL_MAX - 1)}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. READ / WRITE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert or update one alert, keyed by (kind, ref).
 *
 * THROWS on failure — deliberately. Unlike the job ledger (whose write is
 * best-effort because the watchdog catches its silence), an ops alert has no
 * second observer: if the row is not written, the dispute deadline is simply
 * lost. The webhook caller turns that throw into a 500 so Stripe RETRIES the
 * delivery, which is exactly the recovery we want.
 *
 * A `resolved` row is never silently re-opened by a late/re-ordered event: the
 * conflict clause keeps `resolved` unless the caller explicitly passes a new
 * status, and the dispute handler derives status from the dispute's own Stripe
 * state, so replays converge on the same answer whatever order they arrive in.
 */
export async function upsertOpsAlert(input: UpsertOpsAlertInput): Promise<void> {
  const detail = truncateAlertDetail(input.detail);
  await db().execute(sql`
    insert into "ops_alerts"
      ("kind", "ref", "status", "title", "detail", "amount_cents", "currency", "due_at", "marker",
       "opened_at", "updated_at", "resolved_at")
    values (
      ${input.kind}, ${input.ref}, ${input.status}, ${input.title}, ${detail},
      ${input.amountCents ?? null}, ${input.currency ?? null},
      ${input.dueAt ? input.dueAt.toISOString() : null}, ${input.marker ?? null},
      now(), now(), ${input.status === 'resolved' ? sql`now()` : sql`null`}
    )
    on conflict ("kind", "ref") do update set
      "status"       = excluded."status",
      "title"        = excluded."title",
      "detail"       = excluded."detail",
      "amount_cents" = excluded."amount_cents",
      "currency"     = excluded."currency",
      "due_at"       = excluded."due_at",
      "marker"       = coalesce(excluded."marker", "ops_alerts"."marker"),
      "updated_at"   = now(),
      "resolved_at"  = case when excluded."status" = 'resolved'
                            then coalesce("ops_alerts"."resolved_at", now())
                            else null end
  `);
}

/** Close an alert out. No-op when the row does not exist (a `closed` event that
 *  arrives before its `created` sibling is not an error — the created handler
 *  will derive the same resolved state from the object's own status). */
export async function resolveOpsAlert(
  kind: OpsAlertKind,
  ref: string,
  outcome: string,
): Promise<void> {
  await db().execute(sql`
    update "ops_alerts"
       set "status" = 'resolved',
           "outcome" = ${outcome},
           "resolved_at" = coalesce("resolved_at", now()),
           "updated_at" = now()
     where "kind" = ${kind} and "ref" = ${ref}
  `);
}

interface RawAlertRow {
  kind: string;
  ref: string;
  status: string;
  title: string;
  detail: string | null;
  amount_cents: number | string | null;
  currency: string | null;
  due_at: string | Date | null;
  marker: string | null;
  opened_at: string | Date | null;
  updated_at: string | Date | null;
}

function toDate(v: string | Date | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toInt(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRow(r: RawAlertRow): OpsAlertRow {
  return {
    kind: r.kind,
    ref: r.ref,
    status: r.status,
    title: r.title,
    detail: r.detail,
    amountCents: toInt(r.amount_cents),
    currency: r.currency,
    dueAt: toDate(r.due_at),
    marker: r.marker,
    openedAt: toDate(r.opened_at),
    updatedAt: toDate(r.updated_at),
  };
}

/** Every alert a human still owes an action, soonest deadline first (rows with
 *  no deadline last). This is the digest's single query. */
export async function listOpenOpsAlerts(): Promise<OpsAlertRow[]> {
  const rows = (await db().execute(sql`
    select "kind", "ref", "status", "title", "detail", "amount_cents", "currency",
           "due_at", "marker", "opened_at", "updated_at"
      from "ops_alerts"
     where "status" = 'open'
     order by "due_at" asc nulls last, "opened_at" asc
  `)) as unknown as RawAlertRow[];
  return rows.map(mapRow);
}

/** One alert by key, or null. Used for idempotency-marker reads. */
export async function getOpsAlert(kind: OpsAlertKind, ref: string): Promise<OpsAlertRow | null> {
  const rows = (await db().execute(sql`
    select "kind", "ref", "status", "title", "detail", "amount_cents", "currency",
           "due_at", "marker", "opened_at", "updated_at"
      from "ops_alerts"
     where "kind" = ${kind} and "ref" = ${ref}
     limit 1
  `)) as unknown as RawAlertRow[];
  const r = rows[0];
  return r ? mapRow(r) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PRESENTATION (pure — no clock, no DB)
// ─────────────────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A deadline inside this window makes the whole digest [URGENT]. Three days is
 *  the point at which a Stripe evidence deadline stops being comfortable — the
 *  bank needs the submission before the window closes, not on the last hour. */
export const OPS_ALERT_URGENT_WINDOW_MS = 3 * DAY_MS;

/**
 * Is this alert urgent right now? PURE.
 *
 * A dispute is ALWAYS urgent, deadline or not: an unanswered dispute is lost by
 * default, and Stripe does not always populate a due date on the object we see.
 * Everything else is urgent only once its deadline is inside the window.
 */
export function isOpsAlertUrgent(row: OpsAlertRow, now: Date): boolean {
  if (row.kind === 'stripe_dispute') return true;
  if (!row.dueAt) return false;
  return row.dueAt.getTime() - now.getTime() <= OPS_ALERT_URGENT_WINDOW_MS;
}

/** "in 4 days" / "in 6 h" / "OVERDUE by 2 days". PURE. */
export function formatDeadline(dueAt: Date, now: Date): string {
  const ms = dueAt.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const unit = abs >= DAY_MS ? `${(abs / DAY_MS).toFixed(1)} days` : `${Math.max(1, Math.round(abs / HOUR_MS))} h`;
  return ms >= 0 ? `due in ${unit}` : `OVERDUE by ${unit}`;
}

/** Money for humans: 4250 → "$42.50". PURE. */
export function formatAmount(amountCents: number | null, currency: string | null): string | null {
  if (amountCents == null) return null;
  const sym = (currency ?? 'usd').toLowerCase() === 'usd' ? '$' : '';
  const cur = sym ? '' : ` ${(currency ?? '').toUpperCase()}`;
  return `${sym}${(amountCents / 100).toFixed(2)}${cur}`;
}

/** One digest line per alert. PURE — the clock is passed in. */
export function opsAlertLine(row: OpsAlertRow, now: Date): string {
  const bits: string[] = [row.title];
  const amount = formatAmount(row.amountCents, row.currency);
  if (amount) bits.push(amount);
  if (row.dueAt) bits.push(formatDeadline(row.dueAt, now));
  const head = bits.join(' · ');
  return row.detail ? `${head}\n      ${row.detail}` : head;
}
