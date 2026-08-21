/**
 * Affiliate + Referral program — PURE terms, tiers and helpers (no DB, no IO).
 *
 * Single source of truth for the numbers Alex decided (kept out of the DB /
 * render / route layers so tests pin the terms and both programs read one
 * definition). See src/server/affiliate/{codes,attribution,dashboard,pages}.ts
 * and src/server/routes/partners.ts for the DB-touching + HTTP layers.
 *
 * TWO PROGRAMS
 *   • REFERRAL (existing tenants → peers, double-sided):
 *       - referrer earns 1 free month (account credit) per referred tenant that
 *         becomes paying;
 *       - referee gets a 30-day trial (vs 14) + 20% off the first 3 months.
 *   • AFFILIATE (public marketers/creators, tiered recurring cash):
 *       - 25% recurring base → 30% recurring for 12 months once the affiliate has
 *         10+ active referred customers → negotiated lifetime % for top partners;
 *       - 90-day cookie, monthly payouts, $50 minimum payout.
 */

// ── Referral (peer) program terms ──────────────────────────────────────────
/** Referee's extended trial length (days) — vs the standard 14. */
export const REFEREE_TRIAL_DAYS = 30;
/** Referee's intro discount (fraction) applied to the first N months. */
export const REFEREE_DISCOUNT_PCT = 0.2;
export const REFEREE_DISCOUNT_MONTHS = 3;
/** Free months the referrer earns per referred tenant that becomes paying. */
export const REFERRER_FREE_MONTHS = 1;

// ── Affiliate (public) program terms ───────────────────────────────────────
export const AFFILIATE_BASE_RATE = 0.25; // 25% recurring
export const AFFILIATE_PRO_RATE = 0.3; // 30% recurring
/** Active referred customers required to reach the 'pro' tier. */
export const AFFILIATE_PRO_THRESHOLD = 10;
/** How long the elevated 'pro' rate lasts once earned (months). */
export const AFFILIATE_PRO_DURATION_MONTHS = 12;
/** 'partner' is a hand-negotiated lifetime %; this is the published floor. */
export const AFFILIATE_PARTNER_RATE = 0.35;
/** Cookie attribution window — 90 days. */
export const REF_COOKIE_DAYS = 90;
export const REF_COOKIE_MAX_AGE_MS = REF_COOKIE_DAYS * 24 * 60 * 60 * 1000;
export const REF_COOKIE_NAME = 'qf_ref';
/** Monthly payout cadence + minimum balance (USD) to trigger a payout. */
export const AFFILIATE_MIN_PAYOUT_CENTS = 5000; // $50.00
export const AFFILIATE_PAYOUT_CADENCE = 'monthly';

export type AffiliateTier = 'base' | 'pro' | 'partner';
export type AttributionKind = 'referral' | 'affiliate' | 'unknown';

/**
 * The tier an affiliate qualifies for from their active referred-customer count.
 * 'partner' is never auto-assigned here (it is granted manually to top partners);
 * this maps the self-serve ladder: <10 → base, ≥10 → pro.
 */
export function resolveTier(activeReferredCustomers: number): AffiliateTier {
  return activeReferredCustomers >= AFFILIATE_PRO_THRESHOLD ? 'pro' : 'base';
}

/** Published commission rate (fraction) for a tier. */
export function commissionRateForTier(tier: AffiliateTier): number {
  switch (tier) {
    case 'partner':
      return AFFILIATE_PARTNER_RATE;
    case 'pro':
      return AFFILIATE_PRO_RATE;
    case 'base':
    default:
      return AFFILIATE_BASE_RATE;
  }
}

export interface TierProgress {
  tier: AffiliateTier;
  activeReferredCustomers: number;
  /** Customers still needed to reach the next tier; 0 when already there/top. */
  toNextTier: number;
  /** The tier that `toNextTier` unlocks; null at the top of the ladder. */
  nextTier: AffiliateTier | null;
  rate: number;
}

/**
 * Progress toward the next tier, from a live active-customer count. Deterministic
 * and pure so the dashboard + tests share one definition. A 'partner' affiliate
 * is already top-of-ladder (no next tier).
 */
export function tierProgress(
  activeReferredCustomers: number,
  currentTier?: AffiliateTier
): TierProgress {
  const n = Math.max(0, Math.floor(activeReferredCustomers || 0));
  const tier = currentTier === 'partner' ? 'partner' : resolveTier(n);
  if (tier === 'base') {
    return {
      tier,
      activeReferredCustomers: n,
      toNextTier: Math.max(0, AFFILIATE_PRO_THRESHOLD - n),
      nextTier: 'pro',
      rate: commissionRateForTier('base'),
    };
  }
  // pro or partner — top of the self-serve ladder.
  return {
    tier,
    activeReferredCustomers: n,
    toNextTier: 0,
    nextTier: tier === 'pro' ? 'partner' : null,
    rate: commissionRateForTier(tier),
  };
}

/**
 * Estimated MONTHLY commission (cents) from active referred customers, at the
 * affiliate's rate. Phase-1 estimate only — the phase-2 billing job writes the
 * authoritative affiliate_commissions rows from real invoice amounts.
 */
export function estimateMonthlyCommissionCents(
  activeReferredCustomers: number,
  avgMonthlyRevenueCents: number,
  rate: number
): number {
  const n = Math.max(0, Math.floor(activeReferredCustomers || 0));
  return Math.round(n * Math.max(0, avgMonthlyRevenueCents) * rate);
}

// ── Code format ─────────────────────────────────────────────────────────────
/** Unambiguous alphabet for shareable codes (no O/0/I/1/L to avoid mis-typing). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
const CODE_RE = /^[A-Z0-9]{4,16}$/;

/** Normalize a user-supplied code from a `?ref=` param (uppercase, trimmed). */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
}

/** True when a code is structurally valid (does NOT check DB existence). */
export function isValidCodeShape(code: string): boolean {
  return CODE_RE.test(code);
}

/**
 * Generate one candidate code. Pure given the injected randomness source (so a
 * uniqueness test can force a collision then a hit). Defaults to Math.random.
 */
export function generateCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return out;
}
