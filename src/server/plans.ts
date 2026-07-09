/**
 * Two-tier subscription model + feature gating.
 *
 *   Vital  — $14.80/mo  → core: hosted quote page, embeddable widget,
 *            unlimited quotes, lead capture/inbox, branded quotes
 *            (logo/colors), basic follow-up reminders.
 *   Pro    — $34.80/mo  → everything in Vital PLUS AI auto-reply/chat
 *            (24-7), branded PDF quotes, full follow-up automation,
 *            custom domain, analytics, priority support.
 *
 * Trial: at signup the tenant picks a tier AND provides a card (Stripe
 * Checkout, subscription mode, 14-day trial, $0 card validation — no
 * charge). During the 14-day trial EVERY tenant tastes Pro (all-inclusive)
 * regardless of the tier they selected; at trial end Stripe auto-bills the
 * selected tier and a Vital tenant loses the Pro-only capabilities.
 *
 * `plan` on the tenant row is the *billed/selected* tier
 * ('free' | 'vital' | 'pro'). `effectivePlan()` is what FEATURE gates read
 * — it upgrades a trialing tenant to Pro so the trial is all-inclusive.
 *
 * There is NO lead cap and NO read-only downgrade after trial — the
 * tenant is a paying Vital/Pro customer, or 'free' (never subscribed /
 * cancelled), in which case the mutation gate in middleware applies.
 */
import type { Tenant } from '../db/schema.js';
import { loadEnv } from '../config.js';

export type PlanId = 'free' | 'vital' | 'pro';
export type PaidPlanId = 'vital' | 'pro';

/** Monthly price in USD, for copy + display. Source of truth for the app;
 *  the real charge is whatever the Stripe Price says. */
export const PLAN_PRICES_USD: Record<PaidPlanId, number> = {
  vital: 14.8,
  pro: 34.8,
};

export const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  vital: 'Vital',
  pro: 'Pro',
};

/** Length of the all-inclusive trial, in days. Mirrors Stripe's
 *  `trial_period_days` and the tenant's `trialEndsAt`. */
export const TRIAL_DAYS = 14;

/** Pro-only capabilities. Vital gets NONE of these; a trialing tenant of
 *  either tier gets ALL of them (via `effectivePlan` → 'pro'). */
export type ProFeature =
  | 'ai' // AI auto-reply + 24-7 customer chat
  | 'brandedPdf' // branded PDF quotes
  | 'automation' // full follow-up automation
  | 'customDomain' // custom domain
  | 'analytics'; // analytics dashboard

/** Is this tenant currently inside its 14-day trial window? */
export function isTrialing(tenant: Pick<Tenant, 'trialEndsAt'>): boolean {
  const end = tenant.trialEndsAt ?? null;
  return end != null && end.getTime() > Date.now();
}

/** Normalize any stored plan string onto the two-tier world. Legacy
 *  'starter' → Vital, legacy 'enterprise' → Pro. Unknown → 'free'. */
export function normalizePlan(plan: string | null | undefined): PlanId {
  switch (plan) {
    case 'pro':
    case 'enterprise':
      return 'pro';
    case 'vital':
    case 'starter':
      return 'vital';
    default:
      return 'free';
  }
}

/**
 * Effective plan used for FEATURE gating. During the 14-day trial every
 * tenant tastes Pro; once the trial ends the effective plan collapses to
 * whatever they pay for ('vital' or 'pro'), or 'free' if they never
 * subscribed / cancelled.
 */
export function effectivePlan(tenant: Pick<Tenant, 'plan' | 'trialEndsAt'>): PlanId {
  if (isTrialing(tenant)) return 'pro';
  return normalizePlan(tenant.plan);
}

/** May the tenant use a Pro-only capability right now? (AI, branded PDF,
 *  automation, custom domain, analytics.) True during trial. */
export function canUseProFeature(tenant: Pick<Tenant, 'plan' | 'trialEndsAt'>): boolean {
  return effectivePlan(tenant) === 'pro';
}

/** Does the tenant have core (Vital+) access — i.e. a live paid tier or an
 *  active trial? False for 'free' (never subscribed / cancelled). */
export function hasCoreAccess(tenant: Pick<Tenant, 'plan' | 'trialEndsAt'>): boolean {
  return effectivePlan(tenant) !== 'free';
}

/** Map a Stripe Price id → our internal paid plan id (or null if unknown). */
export function planForPriceId(priceId: string | null | undefined): PaidPlanId | null {
  if (!priceId) return null;
  const env = loadEnv();
  if (env.STRIPE_PRICE_PRO_MONTHLY && priceId === env.STRIPE_PRICE_PRO_MONTHLY) return 'pro';
  if (env.STRIPE_PRICE_VITAL_MONTHLY && priceId === env.STRIPE_PRICE_VITAL_MONTHLY) return 'vital';
  return null;
}

/** Resolve the Stripe Price id for a selected paid tier (or undefined if
 *  that tier's price isn't configured). */
export function priceIdForPlan(plan: PaidPlanId): string | undefined {
  const env = loadEnv();
  return plan === 'pro' ? env.STRIPE_PRICE_PRO_MONTHLY : env.STRIPE_PRICE_VITAL_MONTHLY;
}

/** Parse an untrusted plan input into a paid tier, defaulting to 'vital'. */
export function parsePaidPlan(input: unknown): PaidPlanId {
  return input === 'pro' ? 'pro' : 'vital';
}
