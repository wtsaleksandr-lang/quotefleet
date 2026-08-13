/**
 * Shared SHIPPER follow-up logic — the ONE place that decides which touch is
 * due and renders it. Both the sender (src/email/followUpCron.ts) and the
 * portal preview endpoint (routes/tenant.ts) import from here, so a preview is
 * byte-for-byte what actually sends.
 *
 * No timers / no DB / no I/O — pure functions over a resolved FollowUpConfig +
 * a lead-shaped record, so it's trivially unit-testable and reused verbatim.
 *
 * Marketing model: three touches sent to a customer who got a quote but didn't
 * book — a gentle nudge, then a reminder, then a discount (saved for LAST so
 * customers aren't trained to wait). The cadence day-offsets + discount percent
 * come from the tenant's FollowUpConfig; the copy defaults live in templates.ts
 * and are overridable per-touch via the config's custom intros / contact /
 * signature.
 */
import type { FollowUpConfig } from '../server/features.js';
import type { QuoteCurrency } from './templates.js';
import {
  followupNudgeEmail,
  followupReminderEmail,
  followupDiscountEmail,
  formatEmailMoney,
} from './templates.js';

/** The three touches, in send order. */
export type FollowUpTouch = 'nudge' | 'reminder' | 'discount';
export const FOLLOWUP_TOUCH_ORDER: readonly FollowUpTouch[] = ['nudge', 'reminder', 'discount'];

/** The minimal lead shape the follow-up logic needs. A subset of the `leads`
 *  row so tests can build one without the full table. */
export interface FollowUpLead {
  id: number;
  refId: string;
  customerName: string | null;
  customerEmail: string | null;
  pickupCity: string | null;
  deliveryCity: string | null;
  quotedTotal: number | null;
  quotedCurrency: string | null;
  status: string;
  followUpOptOut: boolean | null;
  followUpsSentJson: Record<string, string> | null;
  createdAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The only lead status the follow-up sequence runs against. A lead that booked
 *  ('won'), died ('lost'), was flagged ('spam'), replied ('replied'), or is a
 *  bare calc with no contact yet ('draft') is NEVER followed up — 'new' is the
 *  single followable state, so conversion/reply/dead all stop the sequence by
 *  construction. Exported so the cron's query and the guard read one constant. */
export const FOLLOWABLE_STATUS = 'new';

/** Synthesize the discount promo code for a touch from the configured percent.
 *  There is no separate promo-code store yet (that CRUD is a later wave), so the
 *  code is deterministically derived from the discount — matching the portal's
 *  `SAVE8` placeholder — and pre-applied to the quote URL via `?promo=`. */
export function followUpPromoCode(discountPct: number): string {
  return `SAVE${Math.round(discountPct)}`;
}

/**
 * Decide the single follow-up touch (if any) DUE for `lead` under `cfg` at
 * `now`. Priority-ordered nudge → reminder → discount; at most one per call, so
 * a lead the cron fell behind on catches up one touch per tick. Returns null
 * when nothing is due.
 *
 * Assumes the caller already filtered on enable/plan/opt-out/status/email — this
 * is purely the cadence + already-sent + max-touches decision. `now` injectable
 * for deterministic tests.
 *
 * STOP conditions honored here:
 *   - a touch already recorded in followUpsSentJson never re-sends (idempotent).
 *   - the discount touch is skipped entirely when discountPct ≤ 0 (nothing to
 *     offer), which also caps the sequence at 2 touches for a no-discount tenant.
 */
export function decideNextFollowUp(
  lead: Pick<FollowUpLead, 'followUpsSentJson' | 'createdAt'>,
  cfg: FollowUpConfig,
  now: number = Date.now(),
): FollowUpTouch | null {
  const sent = lead.followUpsSentJson ?? {};
  const ageDays = (now - lead.createdAt.getTime()) / DAY_MS;

  if (!sent.nudge && ageDays >= cfg.day1) return 'nudge';
  if (!sent.reminder && ageDays >= cfg.day2) return 'reminder';
  if (!sent.discount && cfg.discountPct > 0 && ageDays >= cfg.day3) return 'discount';
  return null;
}

/** Map a stored currency string to a QuoteCurrency (defaults to USD). */
function toCurrency(c: string | null | undefined): QuoteCurrency {
  return c === 'CAD' ? 'CAD' : 'USD';
}

export interface RenderFollowUpOpts {
  touch: FollowUpTouch;
  lead: FollowUpLead;
  cfg: FollowUpConfig;
  /** Carrier brand — the email wears the CARRIER's identity, not QuoteFleet's. */
  brand: { displayName?: string | null; logoUrl?: string | null } | null | undefined;
  /** Tenant display name, used when the brand has no displayName. */
  tenantName: string;
  /** Public base URL (no trailing slash needed) for the quote link. */
  baseUrl: string;
  /** Lead-scoped unsubscribe URL (the customer opts out of THIS sequence). */
  unsubscribeUrl: string;
}

/**
 * Render a touch to `{ subject, html }` using the tenant's live config + custom
 * copy. The SAME function the cron sends and the portal previews, so preview ==
 * sent. The per-touch custom intro (cfg.intro1/2/3), the optional contact block
 * (cfg.showContact + phone/email) and the signature are threaded into every
 * touch; unset fields fall back to the template defaults.
 */
export function renderFollowUpTouch(opts: RenderFollowUpOpts): { subject: string; html: string } {
  const { touch, lead, cfg, brand, tenantName, baseUrl, unsubscribeUrl } = opts;
  const base = baseUrl.replace(/\/$/, '');
  const currency = toCurrency(lead.quotedCurrency);
  const total = formatEmailMoney(lead.quotedTotal ?? 0, currency);
  const contact =
    cfg.showContact && (cfg.contactPhone || cfg.contactEmail)
      ? { phone: cfg.contactPhone ?? null, email: cfg.contactEmail ?? null }
      : null;
  const common = {
    refId: lead.refId,
    customerName: lead.customerName?.trim() || 'there',
    brandName: brand?.displayName?.trim() || tenantName,
    brandLogoUrl: brand?.logoUrl ?? null,
    quoteUrl: `${base}/quote/${encodeURIComponent(lead.refId)}`,
    laneFrom: lead.pickupCity?.trim() || '—',
    laneTo: lead.deliveryCity?.trim() || '—',
    total,
    currency,
    unsubscribeUrl,
    contact,
    signature: cfg.signature ?? null,
  };

  if (touch === 'reminder') {
    return followupReminderEmail({ ...common, customIntro: cfg.intro2 ?? null });
  }
  if (touch === 'discount') {
    return followupDiscountEmail({
      ...common,
      customIntro: cfg.intro3 ?? null,
      promoCode: followUpPromoCode(cfg.discountPct),
      percentOff: cfg.discountPct,
    });
  }
  return followupNudgeEmail({ ...common, customIntro: cfg.intro1 ?? null });
}

/** A representative sample lead for the portal preview (never persisted). Lets
 *  the preview endpoint render any touch with realistic content before a real
 *  lead exists. */
export function samplePreviewLead(): FollowUpLead {
  return {
    id: 0,
    refId: 'QF-PREVIEW',
    customerName: 'Jordan Chen',
    customerEmail: 'jordan@example.com',
    pickupCity: 'Long Beach, CA',
    deliveryCity: 'Phoenix, AZ',
    quotedTotal: 2450,
    quotedCurrency: 'USD',
    status: FOLLOWABLE_STATUS,
    followUpOptOut: false,
    followUpsSentJson: null,
    createdAt: new Date(),
  };
}
