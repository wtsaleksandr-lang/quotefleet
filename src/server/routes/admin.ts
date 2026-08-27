/**
 * SUPER ADMIN routes — only for the super_admin role.
 *
 *   GET  /api/admin/tenants            — list all tenants
 *   GET  /api/admin/tenants/:slug      — view one tenant
 *   PATCH /api/admin/tenants/:slug     — update plan / status
 *   GET  /api/admin/stats              — global stats
 *   POST /api/admin/impersonate/:slug  — switch the dashboard view to that tenant
 *                                         (does not change session — frontend stores slug)
 */
import type { Express } from 'express';
import { eq, desc, sql, and, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  tenants,
  leads,
  users,
  auditLog,
  carrierDirectory,
  carrierOverrides,
  affiliates,
  referralAttributions,
  affiliateCommissions,
  directorySubscriptions,
  manifestSubscriptions,
  importerBolCache,
  importerContactCache,
  type NewCarrierOverrideRow,
} from '../../db/schema.js';
import { requireAuth, requireSuperAdmin } from '../middleware.js';
import { creditMeter } from '../directory/importerQuota.js';
import { companyKey } from '../directory/importerCache.js';
import { loadEnv } from '../../config.js';
import Stripe from 'stripe';
import { runAggregatesNow } from '../../marketplace/cron.js';
import { normalizeDot } from '../directory/carrierIngest.js';
import {
  PLAN_IDS,
  PLAN_PRICES_USD,
  normalizePlan,
  isTrialing,
  type PaidPlanId,
} from '../plans.js';
import { notifyAffiliateApproved, isTransitionToActive } from '../affiliate/notifications.js';

/** Valid tenant lifecycle statuses. 'active' is the only one that serves a
 *  public quote page — 'suspended'/'churned' 404 the widget (see public.ts's
 *  `status !== 'active'` gate + the admin.js status field). A bad status here
 *  is a full public-facing outage for that tenant, so the PATCH enum-validates. */
export const TENANT_STATUS_VALUES = ['active', 'suspended', 'churned'] as const;

/**
 * Schema for the admin tenant PATCH. `plan` and `status` are enum-validated
 * against the ACTUAL accepted values so a typo can't silently collapse a
 * paying tenant to free (via normalizePlan) or 404 its public pages. All
 * fields stay optional (partial PATCH); an unknown enum value is a clean 400.
 */
const AdminTenantPatch = z.object({
  plan: z.enum(PLAN_IDS).optional(),
  status: z.enum(TENANT_STATUS_VALUES).optional(),
  name: z.string().optional(),
  contactEmail: z.string().email().optional(),
});
export type AdminTenantPatch = z.infer<typeof AdminTenantPatch>;

/** The only trial-extension increments the admin shortcut offers. Validated as
 *  a closed set so a hand-crafted request can't push an arbitrary (or negative)
 *  number of days onto a tenant's trial. */
export const EXTEND_TRIAL_DAYS = [7, 14, 21, 30] as const;
export type ExtendTrialDays = (typeof EXTEND_TRIAL_DAYS)[number];

/** Body schema for the "extend trial" shortcut. `days` must be one of the
 *  fixed set (7/14/21/30); anything else is a clean 400. */
const AdminExtendTrial = z.object({
  days: z.union([z.literal(7), z.literal(14), z.literal(21), z.literal(30)]),
});
export type AdminExtendTrial = z.infer<typeof AdminExtendTrial>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Best-effort audit write for super-admin mutations. Mirrors the app-wide
 *  `insert(auditLog)` shape (tenant.ts / inbound.ts) but stamps
 *  `actorKind: 'super_admin'` and the acting operator's user id. Scoped to the
 *  TARGET tenant so the entry surfaces in that tenant's audit log. Never blocks
 *  the response — a failed audit is logged, not thrown. */
async function recordAdminAudit(
  tenantId: number | null,
  userId: number | null | undefined,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db().insert(auditLog).values({
      tenantId,
      userId: userId ?? null,
      action,
      actorKind: 'super_admin',
      detailsJson: details,
    });
  } catch (err) {
    console.error('[admin] audit write failed:', err);
  }
}

/**
 * Core of `PATCH /api/admin/tenants/:slug`, extracted so it is unit-testable
 * (same pattern as quoteDoc.ts). Returns `{ status, json }`.
 *
 *  - H1: enum-validates plan/status; unknown value → 400 with field detail.
 *  - H3: a slug that matches 0 rows → 404 (no more silent `{ok:true}`).
 *  - H2: on success, writes a before→after audit row scoped to the tenant.
 */
export async function patchTenantAdmin(opts: {
  slug: string;
  body: unknown;
  actorUserId?: number | null;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const parse = AdminTenantPatch.safeParse(opts.body);
  if (!parse.success) {
    return { status: 400, json: { error: 'Invalid input', details: parse.error.flatten() } };
  }

  // Load the current row first — gives both the existence check (H3) and the
  // before-values for the audit (H2).
  const existing = await db()
    .select()
    .from(tenants)
    .where(eq(tenants.slug, opts.slug))
    .limit(1);
  const before = existing[0] as Record<string, unknown> | undefined;
  if (!before) {
    return { status: 404, json: { error: `No tenant with slug '${opts.slug}'.` } };
  }

  const updated = await db()
    .update(tenants)
    .set({ ...parse.data, updatedAt: new Date() })
    .where(eq(tenants.slug, opts.slug))
    .returning();
  // Authoritative affected-row count — 0 means the row vanished between the
  // read and the write (race / concurrent delete). Still a 404, never {ok}.
  if (updated.length === 0) {
    return { status: 404, json: { error: `No tenant with slug '${opts.slug}'.` } };
  }
  const after = updated[0] as Record<string, unknown>;

  // Audit only the fields the caller actually sent, before→after.
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(parse.data)) {
    changed[key] = { before: before[key], after: after[key] };
  }
  await recordAdminAudit(before.id as number, opts.actorUserId, 'admin.tenant.update', {
    slug: opts.slug,
    changed,
  });

  return { status: 200, json: { ok: true, tenant: after } };
}

/**
 * Core of `POST /api/admin/tenants/:slug/extend-trial`, extracted so it is
 * unit-testable against a mocked db (same pattern as `patchTenantAdmin`).
 *
 * Semantics: the new `trial_ends_at` is (the LATER of now or the existing
 * `trial_ends_at`) + N days. So extending a LAPSED trial restarts it from now
 * (+N days of fresh runway); extending an ACTIVE trial adds N days onto its
 * remaining tail. `now` is injectable purely so tests are deterministic.
 *
 *  - Validates `days` against the fixed set → 400 on anything else.
 *  - A slug that matches 0 rows → 404 (mirrors patchTenantAdmin's H3).
 *  - On success, writes an audit row scoped to the target tenant and returns
 *    the new `trialEndsAt` (ISO string).
 */
export async function extendTenantTrialAdmin(opts: {
  slug: string;
  body: unknown;
  actorUserId?: number | null;
  now?: Date;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const parse = AdminExtendTrial.safeParse(opts.body);
  if (!parse.success) {
    return { status: 400, json: { error: 'Invalid input', details: parse.error.flatten() } };
  }
  const days = parse.data.days;
  const now = opts.now ?? new Date();

  // Load the current row: existence check (404) + before-value for the audit.
  const existing = await db()
    .select()
    .from(tenants)
    .where(eq(tenants.slug, opts.slug))
    .limit(1);
  const before = existing[0] as Record<string, unknown> | undefined;
  if (!before) {
    return { status: 404, json: { error: `No tenant with slug '${opts.slug}'.` } };
  }

  const rawTrialEnd = before.trialEndsAt as Date | string | null | undefined;
  const currentTrialEnd = rawTrialEnd ? new Date(rawTrialEnd) : null;
  // Extend from the later of now or the existing end — lapsed → from now,
  // active → onto the tail.
  const base =
    currentTrialEnd && currentTrialEnd.getTime() > now.getTime() ? currentTrialEnd : now;
  const newTrialEndsAt = new Date(base.getTime() + days * MS_PER_DAY);

  const updated = await db()
    .update(tenants)
    .set({ trialEndsAt: newTrialEndsAt, updatedAt: now })
    .where(eq(tenants.slug, opts.slug))
    .returning();
  if (updated.length === 0) {
    return { status: 404, json: { error: `No tenant with slug '${opts.slug}'.` } };
  }

  await recordAdminAudit(before.id as number, opts.actorUserId, 'admin.tenant.extendTrial', {
    slug: opts.slug,
    days,
    trialEndsAt: {
      before: currentTrialEnd ? currentTrialEnd.toISOString() : null,
      after: newTrialEndsAt.toISOString(),
    },
  });

  return { status: 200, json: { ok: true, trialEndsAt: newTrialEndsAt.toISOString() } };
}

/** The minimal tenant shape MRR needs: the billed/selected `plan`, the
 *  lifecycle `status`, and the `trialEndsAt` timestamp that decides whether
 *  the tenant is still inside its (unbilled) 14-day trial. */
export interface MrrTenant {
  plan: string | null;
  status: string | null;
  trialEndsAt: Date | null;
}

/** Per-plan and aggregate monthly-recurring-revenue breakdown. `mrr` is REAL
 *  recognized revenue; the trial figures are a separate, not-yet-billed
 *  pipeline number. All money values are USD rounded to cents. */
export interface MrrBreakdown {
  /** Total real MRR = Σ (active, past-trial, paid tenants) × plan price. */
  mrr: number;
  /** Count + revenue per paid tier, over the same active-paying population. */
  byPlan: {
    vital: { count: number; mrr: number };
    pro: { count: number; mrr: number };
  };
  /** Active tenants still inside their 14-day trial — NOT in `mrr`. */
  trialingCount: number;
  /** Pipeline MRR if every current trial converts to the tier it selected
   *  (a free/unset selection defaults to Vital). NOT counted in `mrr`. */
  potentialTrialMrr: number;
}

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Pure, unit-testable MRR computation over the tenant list.
 *
 * A tenant contributes to REAL `mrr` only when it is genuinely paying:
 *   - `status === 'active'`   (suspended / churned never bill), AND
 *   - NOT trialing            (a trial is $0 until Stripe auto-bills at day 14), AND
 *   - a paid `plan`           (normalizePlan → 'vital' | 'pro'; 'free' = never
 *                              subscribed / cancelled → excluded).
 *
 * Active trialing tenants are tallied separately as `trialingCount` +
 * `potentialTrialMrr` (their selected tier, defaulting Vital) so the trial
 * pipeline is visible but never inflates recognized revenue. This mirrors the
 * app's own access gate (see src/server/plans.ts: `effectivePlan` /
 * `hasCoreAccess`) — it just splits the trial slice out for accounting.
 */
export function computeMrr(rows: MrrTenant[]): MrrBreakdown {
  const byPlan = {
    vital: { count: 0, mrr: 0 },
    pro: { count: 0, mrr: 0 },
  };
  let trialingCount = 0;
  let potentialTrialMrr = 0;

  for (const t of rows) {
    if (t.status !== 'active') continue; // suspended / churned never bill
    if (isTrialing(t)) {
      // Still inside the free trial — pipeline, not revenue.
      trialingCount += 1;
      const selected = normalizePlan(t.plan);
      const converts: PaidPlanId = selected === 'free' ? 'vital' : selected;
      potentialTrialMrr += PLAN_PRICES_USD[converts];
      continue;
    }
    const plan = normalizePlan(t.plan);
    if (plan === 'free') continue; // never subscribed / cancelled
    byPlan[plan].count += 1;
    byPlan[plan].mrr += PLAN_PRICES_USD[plan];
  }

  byPlan.vital.mrr = roundCents(byPlan.vital.mrr);
  byPlan.pro.mrr = roundCents(byPlan.pro.mrr);
  return {
    mrr: roundCents(byPlan.vital.mrr + byPlan.pro.mrr),
    byPlan,
    trialingCount,
    potentialTrialMrr: roundCents(potentialTrialMrr),
  };
}

// ════════════════════════════════════════════════════════════════════
// PRODUCT-LINE MRR — the two per-SHIPPER revenue lines that live OUTSIDE
// `tenants` and were invisible to computeMrr: Directory Pro ($19/mo) and
// Manifest Privacy (annual $79/$249/$599 → ÷12 monthly). Both are fully
// decoupled from tenants.plan, so the tenant scan above never saw a cent of
// them and the admin MRR was understating real revenue by two whole products.
// ════════════════════════════════════════════════════════════════════

/** Directory Pro is a flat $19/mo subscription. */
export const DIRECTORY_PRO_MONTHLY_USD = 19;

/** The manifest tiers, as (tier → annual USD). Kept here (not imported) so the
 *  MRR math is a pure function with zero DB/entitlement coupling — mirrors how
 *  computeMrr owns PLAN_PRICES_USD via the plans module. */
export const MANIFEST_ANNUAL_USD: Record<'basic' | 'professional' | 'enterprise', number> = {
  basic: 79,
  professional: 249,
  enterprise: 599,
};

/** Normalize a manifest tier string onto the three known tiers (default basic). */
function normalizeManifestTier(tier: string | null | undefined): 'basic' | 'professional' | 'enterprise' {
  return tier === 'professional' || tier === 'enterprise' ? tier : 'basic';
}

/** The minimal shape the product-MRR math needs from a subscription row. */
export interface ProductSubRow {
  status: string | null;
  currentPeriodEnd: Date | null;
  /** A super-admin comp/free-grant — real entitlement, but NOT recognized revenue. */
  comp?: boolean | null;
  /** Manifest only — the annual tier bought. */
  tier?: string | null;
}

export interface ProductMrrBreakdown {
  directory: { activeCount: number; mrr: number };
  manifest: {
    activeCount: number;
    mrr: number;
    byTier: Record<'basic' | 'professional' | 'enterprise', { count: number; mrr: number }>;
  };
  /** Directory + Manifest recognized MRR (does NOT include tenant SaaS MRR). */
  total: number;
}

/** A subscription contributes recognized revenue only when it is genuinely
 *  paying: status 'active' (trialing/past_due/inactive never bill), still inside
 *  its period (or unknown end), and NOT a comp grant. Mirrors computeMrr's
 *  active-past-trial-paid rule for the tenant world. */
function subIsRecognizedRevenue(s: ProductSubRow): boolean {
  if (s.comp) return false;
  if (s.status !== 'active') return false;
  if (s.currentPeriodEnd != null && s.currentPeriodEnd.getTime() <= Date.now()) return false;
  return true;
}

/**
 * Pure, unit-testable product-line MRR over the two per-shipper subscription
 * tables. Directory Pro is a flat $19/mo; each annual Manifest tier is amortized
 * to a monthly figure (annual ÷ 12) so all three revenue lines are expressed on
 * one comparable monthly basis. Comp grants and non-active subs are excluded.
 */
export function computeProductMrr(
  directoryRows: ProductSubRow[],
  manifestRows: ProductSubRow[]
): ProductMrrBreakdown {
  const directory = { activeCount: 0, mrr: 0 };
  for (const s of directoryRows) {
    if (!subIsRecognizedRevenue(s)) continue;
    directory.activeCount += 1;
    directory.mrr += DIRECTORY_PRO_MONTHLY_USD;
  }

  const byTier = {
    basic: { count: 0, mrr: 0 },
    professional: { count: 0, mrr: 0 },
    enterprise: { count: 0, mrr: 0 },
  };
  let manifestCount = 0;
  let manifestMrr = 0;
  for (const s of manifestRows) {
    if (!subIsRecognizedRevenue(s)) continue;
    const tier = normalizeManifestTier(s.tier);
    const monthly = MANIFEST_ANNUAL_USD[tier] / 12;
    byTier[tier].count += 1;
    byTier[tier].mrr += monthly;
    manifestCount += 1;
    manifestMrr += monthly;
  }

  byTier.basic.mrr = roundCents(byTier.basic.mrr);
  byTier.professional.mrr = roundCents(byTier.professional.mrr);
  byTier.enterprise.mrr = roundCents(byTier.enterprise.mrr);
  directory.mrr = roundCents(directory.mrr);
  const manifest = { activeCount: manifestCount, mrr: roundCents(manifestMrr), byTier };
  return {
    directory,
    manifest,
    total: roundCents(directory.mrr + manifest.mrr),
  };
}

/**
 * Schema for `POST /api/admin/carrier/:usdot/override`. Every field is optional
 * (partial upsert) and nullable (null clears the override → the profile falls
 * back to the FMCSA value). `.strict()` rejects unknown keys with a clean 400.
 * `capabilities` keys match CarrierCapabilities (schema.ts) 1:1.
 */
const CarrierOverridePatch = z
  .object({
    about: z.string().max(4000).nullable().optional(),
    // `''` allowed so an admin can clear the email override; normalized to null.
    email: z.string().max(320).email().or(z.literal('')).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    hidden: z.boolean().nullable().optional(),
    capabilities: z
      .object({
        uiia: z.boolean().optional(),
        twic: z.boolean().optional(),
        bonded: z.boolean().optional(),
        reefer: z.boolean().optional(),
        transload: z.boolean().optional(),
        yard: z.boolean().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    // Carrier-declared OTHER operating cities/terminals (metros beyond the single
    // FMCSA HQ). Array of `{ city, state }` with a 2-letter state; capped at 25.
    // `[]` / null clears it. City trimmed; state upper-cased in the write below.
    operatingLocations: z
      .array(
        z
          .object({
            city: z.string().trim().min(1).max(80),
            state: z
              .string()
              .trim()
              .regex(/^[A-Za-z]{2}$/, 'state must be a 2-letter code'),
          })
          .strict(),
      )
      .max(25)
      .nullable()
      .optional(),
  })
  .strict();
export type CarrierOverridePatch = z.infer<typeof CarrierOverridePatch>;

/**
 * Core of `POST /api/admin/carrier/:usdot/override`, extracted so it is
 * unit-testable (same pattern as patchTenantAdmin). Upserts a `carrier_overrides`
 * row — the write path the future admin UI + AI-Copilot tool will call.
 *
 *  - Validates input; unknown/invalid field → 400.
 *  - USDOT is normalized (leading zeros stripped) to match carrier_directory.
 *  - A USDOT not present in carrier_directory → 404 (never orphan an override).
 *  - On success, writes an audit row and returns the upserted override.
 *
 * This table is NEVER touched by the FMCSA re-ingest, so the override persists
 * across every re-ingest (the merge re-applies it on read via carrierBySlug).
 */
export async function upsertCarrierOverride(opts: {
  usdot: string;
  body: unknown;
  actorUserId?: number | null;
  actorLabel?: string | null;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const usdot = normalizeDot(opts.usdot);
  if (!usdot) return { status: 400, json: { error: 'Invalid USDOT number.' } };

  const parse = CarrierOverridePatch.safeParse(opts.body);
  if (!parse.success) {
    return { status: 400, json: { error: 'Invalid input', details: parse.error.flatten() } };
  }
  if (Object.keys(parse.data).length === 0) {
    return { status: 400, json: { error: 'No override fields provided.' } };
  }

  // Never create an override for a USDOT that isn't in the public directory.
  const existing = await db()
    .select({ usdot: carrierDirectory.usdot })
    .from(carrierDirectory)
    .where(eq(carrierDirectory.usdot, usdot))
    .limit(1);
  if (!existing[0]) {
    return { status: 404, json: { error: `No carrier with USDOT '${usdot}'.` } };
  }

  const blankToNull = (v: string | null | undefined): string | null =>
    v == null || v.trim() === '' ? null : v;
  // Only the fields the caller SENT are written (partial upsert); updatedAt /
  // updatedBy are always refreshed.
  const set: Partial<NewCarrierOverrideRow> = {
    updatedAt: new Date(),
    updatedBy: opts.actorLabel ?? (opts.actorUserId != null ? String(opts.actorUserId) : null),
  };
  const d = parse.data;
  if ('about' in d) set.aboutOverride = blankToNull(d.about ?? null);
  if ('email' in d) set.emailOverride = blankToNull(d.email ?? null);
  if ('phone' in d) set.phoneOverride = blankToNull(d.phone ?? null);
  if ('hidden' in d) set.hidden = d.hidden ?? null;
  if ('capabilities' in d) set.capabilities = d.capabilities ?? null;
  if ('operatingLocations' in d) {
    // Normalize state to upper-case; an empty array clears the override (→ null).
    const list = d.operatingLocations;
    set.operatingLocations =
      list && list.length ? list.map((l) => ({ city: l.city, state: l.state.toUpperCase() })) : null;
  }

  const upserted = await db()
    .insert(carrierOverrides)
    .values({ usdot, ...set })
    .onConflictDoUpdate({ target: carrierOverrides.usdot, set })
    .returning();

  // Global (not tenant-scoped) admin action → audit with a null tenantId.
  await recordAdminAudit(null, opts.actorUserId, 'admin.carrier.override', {
    usdot,
    fields: Object.keys(d),
  });

  return { status: 200, json: { ok: true, override: upserted[0] ?? null } };
}

// ════════════════════════════════════════════════════════════════════
// AFFILIATE ADMIN — operator view over the self-serve affiliate program.
//   - GET   /api/admin/affiliates          — list + per-affiliate stats
//   - PATCH /api/admin/affiliates/:id       — status / tier / commissionRate
// Self-serve affiliates are created active; this is the only surface to
// suspend one, grant the hand-negotiated `partner` tier, or override the
// denormalized commission rate. Mirrors patchTenantAdmin's shape.
// ════════════════════════════════════════════════════════════════════

/** Affiliate lifecycle states (schema.ts: affiliates.status). */
export const AFFILIATE_STATUS_VALUES = ['pending', 'active', 'suspended'] as const;
/** Commission tiers (schema.ts: affiliates.tier). 'partner' is granted here. */
export const AFFILIATE_TIER_VALUES = ['base', 'pro', 'partner'] as const;

/**
 * Schema for the affiliate PATCH. `status`/`tier` are enum-validated against
 * the ACTUAL accepted values; `commissionRate` is a fraction in [0,1] (0.25 =
 * 25%). All optional (partial PATCH), but at least one field must be present —
 * an empty body is a clean 400.
 */
const AdminAffiliatePatch = z
  .object({
    status: z.enum(AFFILIATE_STATUS_VALUES).optional(),
    tier: z.enum(AFFILIATE_TIER_VALUES).optional(),
    commissionRate: z.number().min(0).max(1).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one of status, tier, commissionRate is required.',
  });
export type AdminAffiliatePatch = z.infer<typeof AdminAffiliatePatch>;

/** The subset of an affiliate row the diff planner needs. */
export interface AffiliateBefore {
  status: string;
  tier: string;
  commissionRate: number;
}

export type AffiliatePatchPlan =
  | { ok: false; status: number; json: Record<string, unknown> }
  | {
      ok: true;
      set: Record<string, unknown>;
      changed: Record<string, { before: unknown; after: unknown }>;
    };

/**
 * PURE core of the affiliate PATCH: Zod-validates the body, then computes the
 * before→after diff so ONLY genuinely-changed columns are written and audited.
 * No DB, no IO — unit-testable in isolation (same idea as computeMrr).
 *
 *  - Invalid body (bad enum / rate out of [0,1] / no fields) → 400.
 *  - A body whose values all equal the current row → 400 (nothing to change).
 *  - Otherwise → { set, changed } where both cover exactly the differing fields.
 */
export function planAffiliateUpdate(before: AffiliateBefore, body: unknown): AffiliatePatchPlan {
  const parse = AdminAffiliatePatch.safeParse(body);
  if (!parse.success) {
    return { ok: false, status: 400, json: { error: 'Invalid input', details: parse.error.flatten() } };
  }
  const data = parse.data;
  const set: Record<string, unknown> = {};
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(data) as (keyof typeof data)[]) {
    const next = data[key];
    if (next === undefined) continue;
    const cur = (before as unknown as Record<string, unknown>)[key];
    if (cur !== next) {
      set[key] = next;
      changed[key] = { before: cur, after: next };
    }
  }
  if (Object.keys(set).length === 0) {
    return { ok: false, status: 400, json: { error: 'No changes — submitted values match the current ones.' } };
  }
  return { ok: true, set, changed };
}

/**
 * Core of `PATCH /api/admin/affiliates/:id`, extracted so it is unit-testable
 * against a mocked db (same pattern as `patchTenantAdmin`). Returns `{ status,
 * json }`.
 *
 *  - Non-numeric id → 400.
 *  - id that matches 0 rows → 404 (no silent success).
 *  - Validation + diff via `planAffiliateUpdate`; invalid / no-op → its status.
 *  - On success, writes ONLY the changed columns and an `affiliate.update` audit
 *    row (before→after), scoped to the affiliate's owner tenant when known.
 */
export async function patchAffiliateAdmin(opts: {
  id: string | number;
  body: unknown;
  actorUserId?: number | null;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const id = Number(opts.id);
  if (!Number.isInteger(id) || id <= 0) {
    return { status: 400, json: { error: 'Invalid affiliate id.' } };
  }

  // Load current row: existence check (404) + before-values for the diff/audit.
  const existing = await db().select().from(affiliates).where(eq(affiliates.id, id)).limit(1);
  const before = existing[0] as Record<string, unknown> | undefined;
  if (!before) {
    return { status: 404, json: { error: `No affiliate with id '${id}'.` } };
  }

  const plan = planAffiliateUpdate(
    {
      status: before.status as string,
      tier: before.tier as string,
      commissionRate: before.commissionRate as number,
    },
    opts.body
  );
  if (!plan.ok) return { status: plan.status, json: plan.json };

  const updated = await db()
    .update(affiliates)
    .set({ ...plan.set, updatedAt: new Date() })
    .where(eq(affiliates.id, id))
    .returning();
  if (updated.length === 0) {
    return { status: 404, json: { error: `No affiliate with id '${id}'.` } };
  }

  await recordAdminAudit(
    (before.ownerTenantId as number | null) ?? null,
    opts.actorUserId,
    'affiliate.update',
    { affiliateId: id, code: before.code, changed: plan.changed }
  );

  // Best-effort: on a genuine transition INTO `active` (pending/suspended →
  // active), email the affiliate their approved welcome. isTransitionToActive
  // gates it so a no-op PATCH, a non-status edit, or an already-active row never
  // emails. Uses the (possibly just-updated) commission rate for the headline.
  if (isTransitionToActive(plan.changed)) {
    const newRate = (updated[0] as Record<string, unknown>).commissionRate;
    void notifyAffiliateApproved({
      to: (before.email as string | null) ?? null,
      affiliateName: (before.name as string | null) ?? null,
      code: String(before.code ?? ''),
      commissionRate: typeof newRate === 'number' ? newRate : null,
    }).catch((err) => {
      console.warn('[admin] affiliate-approved notify failed (non-fatal):', err);
    });
  }

  return { status: 200, json: { ok: true, affiliate: updated[0] } };
}

// ════════════════════════════════════════════════════════════════════
// SUBSCRIPTION OPS — comp/free-grant + refund over the two per-shipper
// revenue tables (directory_subscriptions, manifest_subscriptions). Both are
// webhook-write-only in normal operation; these are the ONLY super-admin write
// paths, so a partner comp or a support-case fix no longer requires touching
// the DB by hand. All are superadmin-only + audited.
// ════════════════════════════════════════════════════════════════════

/** Entity quota per manifest tier (mirrors manifestEntitlement.tierMeta). */
const MANIFEST_TIER_QUOTA: Record<'basic' | 'professional' | 'enterprise', number> = {
  basic: 1,
  professional: 5,
  enterprise: 100,
};

const AdminCompBody = z.object({
  email: z.string().email(),
  /** Comp length in (30-day) months; default 12. Sets currentPeriodEnd = now + N months. */
  months: z.number().int().min(1).max(120).optional(),
  /** Manifest only — the tier to grant. Ignored for directory. */
  tier: z.enum(['basic', 'professional', 'enterprise']).optional(),
  note: z.string().max(500).optional(),
});

/**
 * Core of the comp/free-grant upsert for a product subscription. Looks up the
 * shipper user by email, then upserts an ACTIVE, comp-flagged entitlement keyed
 * by user id (no Stripe ids — a comp is not a paid subscription). Excluded from
 * recognized MRR by the `comp` flag. Unit-testable against a mocked db.
 */
export async function upsertCompSubscription(opts: {
  product: 'directory' | 'manifest';
  body: unknown;
  actorUserId?: number | null;
  now?: Date;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const parse = AdminCompBody.safeParse(opts.body);
  if (!parse.success) {
    return { status: 400, json: { error: 'Invalid input', details: parse.error.flatten() } };
  }
  const { email, note } = parse.data;
  const months = parse.data.months ?? 12;
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + months * 30 * MS_PER_DAY);

  const userRows = await db()
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  const user = userRows[0];
  if (!user) {
    return { status: 404, json: { error: `No user with email '${email}'. They must have an account first.` } };
  }

  if (opts.product === 'directory') {
    const upserted = await db()
      .insert(directorySubscriptions)
      .values({
        userId: user.id,
        status: 'active',
        comp: true,
        compNote: note ?? null,
        currentPeriodEnd: expiresAt,
      })
      .onConflictDoUpdate({
        target: directorySubscriptions.userId,
        set: { status: 'active', comp: true, compNote: note ?? null, currentPeriodEnd: expiresAt, updatedAt: now },
      })
      .returning();
    await recordAdminAudit(null, opts.actorUserId, 'admin.subscription.comp', {
      product: 'directory',
      email,
      months,
      expiresAt: expiresAt.toISOString(),
    });
    return { status: 200, json: { ok: true, subscription: upserted[0] ?? null } };
  }

  const tier = parse.data.tier ?? 'basic';
  const upserted = await db()
    .insert(manifestSubscriptions)
    .values({
      userId: user.id,
      status: 'active',
      tier,
      entityQuota: MANIFEST_TIER_QUOTA[tier],
      comp: true,
      compNote: note ?? null,
      currentPeriodEnd: expiresAt,
    })
    .onConflictDoUpdate({
      target: manifestSubscriptions.userId,
      set: {
        status: 'active',
        tier,
        entityQuota: MANIFEST_TIER_QUOTA[tier],
        comp: true,
        compNote: note ?? null,
        currentPeriodEnd: expiresAt,
        updatedAt: now,
      },
    })
    .returning();
  await recordAdminAudit(null, opts.actorUserId, 'admin.subscription.comp', {
    product: 'manifest',
    email,
    tier,
    months,
    expiresAt: expiresAt.toISOString(),
  });
  return { status: 200, json: { ok: true, subscription: upserted[0] ?? null } };
}

/** Minimal Stripe surface the refund core needs — lets tests inject a fake. */
export interface RefundCapableStripe {
  refunds: { create: (args: Record<string, unknown>) => Promise<{ id: string; status: string | null; amount: number }> };
}

let refundStripeClient: Stripe | null = null;
function refundStripe(): RefundCapableStripe | null {
  if (refundStripeClient) return refundStripeClient as unknown as RefundCapableStripe;
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY) return null;
  refundStripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return refundStripeClient as unknown as RefundCapableStripe;
}

const AdminRefundBody = z
  .object({
    paymentIntentId: z.string().trim().min(1).optional(),
    chargeId: z.string().trim().min(1).optional(),
    /** Optional partial-refund amount in cents; omit for a full refund. */
    amountCents: z.number().int().positive().optional(),
    reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
    /** Free-text operator note stored on the audit row (not sent to Stripe). */
    note: z.string().max(500).optional(),
  })
  .refine((d) => !!(d.paymentIntentId || d.chargeId), {
    message: 'A paymentIntentId or chargeId is required.',
  });

/**
 * Core of the admin Stripe refund. REAL MONEY — superadmin-only, audited, and
 * defensively validated (must name a payment_intent or charge). The Stripe
 * client is injectable so the money-moving call is unit-tested against a fake.
 */
export async function issueRefundAdmin(opts: {
  body: unknown;
  actorUserId?: number | null;
  stripe?: RefundCapableStripe | null;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const parse = AdminRefundBody.safeParse(opts.body);
  if (!parse.success) {
    return { status: 400, json: { error: 'Invalid input', details: parse.error.flatten() } };
  }
  const client = opts.stripe ?? refundStripe();
  if (!client) {
    return { status: 400, json: { error: 'Stripe is not configured (STRIPE_SECRET_KEY unset).' } };
  }
  const d = parse.data;
  const args: Record<string, unknown> = {};
  if (d.paymentIntentId) args.payment_intent = d.paymentIntentId;
  else if (d.chargeId) args.charge = d.chargeId;
  if (d.amountCents != null) args.amount = d.amountCents;
  if (d.reason) args.reason = d.reason;

  try {
    const refund = await client.refunds.create(args);
    await recordAdminAudit(null, opts.actorUserId, 'admin.subscription.refund', {
      paymentIntentId: d.paymentIntentId ?? null,
      chargeId: d.chargeId ?? null,
      amountCents: d.amountCents ?? null,
      reason: d.reason ?? null,
      note: d.note ?? null,
      refundId: refund.id,
      refundStatus: refund.status,
    });
    return { status: 200, json: { ok: true, refundId: refund.id, status: refund.status, amount: refund.amount } };
  } catch (err) {
    console.error('[admin] refund failed:', err);
    const message = err instanceof Error ? err.message : 'Refund failed';
    return { status: 502, json: { error: `Stripe refund failed: ${message}` } };
  }
}

const AdminCachePurgeBody = z
  .object({
    /** Purge the Hunter contact cache for this company (indexed unique key). */
    company: z.string().trim().min(1).max(200).optional(),
    /** Optionally purge one BOL result-set by its exact search key (hash). */
    searchKey: z.string().trim().min(1).max(200).optional(),
  })
  .refine((d) => !!(d.company || d.searchKey), { message: 'A company or searchKey is required.' });

/**
 * Core of the importer cache purge. Deletes the resolved-contact cache row for a
 * company by its normalized key (the credit-heavy, PII-bearing cache) so the
 * next open re-resolves fresh; optionally also deletes ONE BOL result set by its
 * exact search key. Both are UNIQUE-index deletes — never a table scan (the
 * importer cache MUST never reintroduce the unbounded-scan outages).
 */
export async function purgeImporterCacheAdmin(opts: {
  body: unknown;
  actorUserId?: number | null;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const parse = AdminCachePurgeBody.safeParse(opts.body);
  if (!parse.success) {
    return { status: 400, json: { error: 'Invalid input', details: parse.error.flatten() } };
  }
  const { company, searchKey } = parse.data;
  let contactPurged = 0;
  let bolPurged = 0;
  if (company) {
    const key = companyKey(company);
    if (key) {
      const del = await db()
        .delete(importerContactCache)
        .where(eq(importerContactCache.companyKey, key))
        .returning({ id: importerContactCache.id });
      contactPurged = del.length;
    }
  }
  if (searchKey) {
    const del = await db()
      .delete(importerBolCache)
      .where(eq(importerBolCache.searchKey, searchKey))
      .returning({ id: importerBolCache.id });
    bolPurged = del.length;
  }
  await recordAdminAudit(null, opts.actorUserId, 'admin.importers.cachePurge', {
    company: company ?? null,
    searchKey: searchKey ?? null,
    contactPurged,
    bolPurged,
  });
  return { status: 200, json: { ok: true, contactPurged, bolPurged } };
}

export function registerAdminRoutes(app: Express) {
  app.get('/api/admin/tenants', requireAuth, requireSuperAdmin, async (_req, res) => {
    const rows = await db().select().from(tenants).orderBy(desc(tenants.createdAt));
    // Lead counts per tenant
    const counts = await db()
      .select({
        tenantId: leads.tenantId,
        n: sql<number>`count(*)::int`,
      })
      .from(leads)
      .groupBy(leads.tenantId);
    const countMap = new Map(counts.map((c) => [c.tenantId, c.n]));
    const enriched = rows.map((t) => ({
      ...t,
      leadCount: countMap.get(t.id) ?? 0,
    }));
    res.json({ tenants: enriched });
  });

  app.get('/api/admin/tenants/:slug', requireAuth, requireSuperAdmin, async (req, res) => {
    const t = await db()
      .select()
      .from(tenants)
      .where(eq(tenants.slug, String(req.params.slug)))
      .limit(1);
    if (!t[0]) return res.status(404).json({ error: 'Tenant not found' });
    const [tenantUsers, tenantLeads, tenantAudit] = await Promise.all([
      db().select().from(users).where(eq(users.tenantId, t[0].id)),
      db()
        .select()
        .from(leads)
        .where(eq(leads.tenantId, t[0].id))
        .orderBy(desc(leads.createdAt))
        .limit(50),
      db()
        .select()
        .from(auditLog)
        .where(eq(auditLog.tenantId, t[0].id))
        .orderBy(desc(auditLog.createdAt))
        .limit(50),
    ]);
    res.json({
      tenant: t[0],
      users: tenantUsers.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        lastLoginAt: u.lastLoginAt,
      })),
      leads: tenantLeads,
      audit: tenantAudit,
    });
  });

  app.patch('/api/admin/tenants/:slug', requireAuth, requireSuperAdmin, async (req, res) => {
    const result = await patchTenantAdmin({
      slug: String(req.params.slug),
      body: req.body,
      actorUserId: req.user?.id ?? null,
    });
    res.status(result.status).json(result.json);
  });

  // Extend a tenant's trial by a fixed number of days (7/14/21/30) from the
  // admin tenant-detail shortcut. Never throws to the client — a DB failure is
  // logged and returned as a clean 500.
  app.post('/api/admin/tenants/:slug/extend-trial', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const result = await extendTenantTrialAdmin({
        slug: String(req.params.slug),
        body: req.body,
        actorUserId: req.user?.id ?? null,
      });
      res.status(result.status).json(result.json);
    } catch (err) {
      console.error('[admin] extend-trial failed:', err);
      res.status(500).json({ error: 'Failed to extend trial' });
    }
  });

  // Upsert a carrier-card OVERRIDE (about / email / phone / hidden /
  // capabilities). Write path for the future admin UI + AI-Copilot tool; the
  // overrides survive the FMCSA re-ingest (separate table) and merge on read.
  app.post('/api/admin/carrier/:usdot/override', requireAuth, requireSuperAdmin, async (req, res) => {
    const result = await upsertCarrierOverride({
      usdot: String(req.params.usdot),
      body: req.body,
      actorUserId: req.user?.id ?? null,
      actorLabel: req.user?.email ?? null,
    });
    res.status(result.status).json(result.json);
  });

  // ── AFFILIATES — list with per-affiliate stats. ──────────────────────
  // One page query + one count + two GROUP-BY aggregates over ONLY the page's
  // codes/ids → no N+1 regardless of page size. `?status=` filters the list;
  // `limit`/`offset` paginate. Returns `{ data, total }`.
  app.get('/api/admin/affiliates', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const statusRaw = String(req.query.status ?? '').trim();
      const statusFilter = (AFFILIATE_STATUS_VALUES as readonly string[]).includes(statusRaw)
        ? statusRaw
        : null;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const whereClause = statusFilter ? eq(affiliates.status, statusFilter) : undefined;

      const [page, totalRows] = await Promise.all([
        db()
          .select({
            id: affiliates.id,
            email: affiliates.email,
            name: affiliates.name,
            code: affiliates.code,
            tier: affiliates.tier,
            status: affiliates.status,
            commissionRate: affiliates.commissionRate,
            payoutMethod: affiliates.payoutMethod,
            createdAt: affiliates.createdAt,
          })
          .from(affiliates)
          .where(whereClause)
          .orderBy(desc(affiliates.createdAt))
          .limit(limit)
          .offset(offset),
        db().select({ n: sql<number>`count(*)::int` }).from(affiliates).where(whereClause),
      ]);

      const codes = page.map((a) => a.code);
      const ids = page.map((a) => a.id);

      // Attribution stats keyed by code (denormalized in referral_attributions);
      // signups = attributions that linked to a signed-up tenant.
      const attrRows = codes.length
        ? await db()
            .select({
              code: referralAttributions.code,
              clicks: sql<number>`count(*)::int`,
              signups: sql<number>`count(${referralAttributions.referredTenantId})::int`,
            })
            .from(referralAttributions)
            .where(
              and(inArray(referralAttributions.code, codes), eq(referralAttributions.kind, 'affiliate'))
            )
            .groupBy(referralAttributions.code)
        : [];
      const attrByCode = new Map(attrRows.map((r) => [r.code, r]));

      // Commission cents keyed by affiliate id — pending (not yet paid) vs paid.
      const commRows = ids.length
        ? await db()
            .select({
              affiliateId: affiliateCommissions.affiliateId,
              pendingCents: sql<number>`coalesce(sum(case when ${affiliateCommissions.status} <> 'paid' then ${affiliateCommissions.amountCents} else 0 end), 0)::int`,
              paidCents: sql<number>`coalesce(sum(case when ${affiliateCommissions.status} = 'paid' then ${affiliateCommissions.amountCents} else 0 end), 0)::int`,
            })
            .from(affiliateCommissions)
            .where(inArray(affiliateCommissions.affiliateId, ids))
            .groupBy(affiliateCommissions.affiliateId)
        : [];
      const commById = new Map(commRows.map((r) => [r.affiliateId, r]));

      const data = page.map((a) => {
        const at = attrByCode.get(a.code);
        const cm = commById.get(a.id);
        return {
          ...a,
          clicks: at?.clicks ?? 0,
          signups: at?.signups ?? 0,
          pendingCents: cm?.pendingCents ?? 0,
          paidCents: cm?.paidCents ?? 0,
        };
      });

      res.json({ data, total: totalRows[0]?.n ?? 0 });
    } catch (err) {
      console.error('[admin] list affiliates failed:', err);
      res.status(500).json({ error: 'Failed to list affiliates' });
    }
  });

  // Update an affiliate's status / tier / commissionRate. Never throws to the
  // client — a DB failure is logged and returned as a clean 500.
  app.patch('/api/admin/affiliates/:id', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const result = await patchAffiliateAdmin({
        id: String(req.params.id),
        body: req.body,
        actorUserId: req.user?.id ?? null,
      });
      res.status(result.status).json(result.json);
    } catch (err) {
      console.error('[admin] patch affiliate failed:', err);
      res.status(500).json({ error: 'Failed to update affiliate' });
    }
  });

  app.get('/api/admin/stats', requireAuth, requireSuperAdmin, async (_req, res) => {
    const [tenantCount, userCount, leadCount, mrrRows, dirSubs, manSubs] = await Promise.all([
      db().select({ n: sql<number>`count(*)::int` }).from(tenants),
      db().select({ n: sql<number>`count(*)::int` }).from(users),
      db().select({ n: sql<number>`count(*)::int` }).from(leads),
      // One flat scan of the columns MRR needs — no N+1; billing math runs
      // in-code via computeMrr (unit-tested), not in SQL.
      db()
        .select({
          plan: tenants.plan,
          status: tenants.status,
          trialEndsAt: tenants.trialEndsAt,
        })
        .from(tenants),
      // The two per-shipper revenue lines that live OUTSIDE tenants — small
      // per-subscriber tables, flat-scanned for the same in-code MRR math.
      db()
        .select({
          status: directorySubscriptions.status,
          currentPeriodEnd: directorySubscriptions.currentPeriodEnd,
          comp: directorySubscriptions.comp,
        })
        .from(directorySubscriptions),
      db()
        .select({
          status: manifestSubscriptions.status,
          currentPeriodEnd: manifestSubscriptions.currentPeriodEnd,
          comp: manifestSubscriptions.comp,
          tier: manifestSubscriptions.tier,
        })
        .from(manifestSubscriptions),
    ]);
    const revenue = computeMrr(mrrRows);
    const products = computeProductMrr(dirSubs, manSubs);
    // The corrected, all-products headline MRR: QuoteFleet SaaS + Directory Pro
    // + Manifest Privacy. `mrr` stays the tenant-only figure for back-compat;
    // `totalMrr` + `byProduct` are the new source of truth for the dashboard.
    const totalMrr = roundCents(revenue.mrr + products.total);
    res.json({
      tenants: tenantCount[0]?.n ?? 0,
      users: userCount[0]?.n ?? 0,
      leads: leadCount[0]?.n ?? 0,
      mrr: revenue.mrr,
      byPlan: revenue.byPlan,
      trialingCount: revenue.trialingCount,
      potentialTrialMrr: revenue.potentialTrialMrr,
      totalMrr,
      byProduct: {
        quotefleet: { mrr: revenue.mrr, activeCount: revenue.byPlan.vital.count + revenue.byPlan.pro.count },
        directory: products.directory,
        manifest: products.manifest,
      },
    });
  });

  // Manually trigger marketplace-aggregate recomputation (also runs hourly).
  app.post('/api/admin/marketplace/recompute-aggregates', requireAuth, requireSuperAdmin, async (req, res) => {
    const result = await runAggregatesNow();
    // Global (not tenant-scoped) admin action → audit with a null tenantId.
    await recordAdminAudit(null, req.user?.id ?? null, 'admin.marketplace.recompute', {
      ok: result.ok,
      ...(result.ok ? {} : { error: (result as { error?: unknown }).error }),
    });
    if (!result.ok) return res.status(500).json(result);
    return res.json(result);
  });

  // ── SUBSCRIPTIONS — visibility over the two per-shipper revenue tables. ──
  // JOIN users so ops sees WHO is subscribed (email/name) alongside product,
  // tier, status, renewal, and the Stripe ids. `?status=` filters; `limit`/
  // `offset` paginate. Comp grants surface with `comp: true`.
  app.get('/api/admin/subscriptions/directory', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const statusRaw = String(req.query.status ?? '').trim();
      const statusFilter = ['active', 'trialing', 'past_due', 'inactive'].includes(statusRaw) ? statusRaw : null;
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const whereClause = statusFilter ? eq(directorySubscriptions.status, statusFilter) : undefined;
      const [rows, totalRows] = await Promise.all([
        db()
          .select({
            id: directorySubscriptions.id,
            userId: directorySubscriptions.userId,
            email: users.email,
            name: users.name,
            status: directorySubscriptions.status,
            comp: directorySubscriptions.comp,
            compNote: directorySubscriptions.compNote,
            priceId: directorySubscriptions.priceId,
            stripeCustomerId: directorySubscriptions.stripeCustomerId,
            stripeSubscriptionId: directorySubscriptions.stripeSubscriptionId,
            currentPeriodEnd: directorySubscriptions.currentPeriodEnd,
            createdAt: directorySubscriptions.createdAt,
          })
          .from(directorySubscriptions)
          .leftJoin(users, eq(users.id, directorySubscriptions.userId))
          .where(whereClause)
          .orderBy(desc(directorySubscriptions.createdAt))
          .limit(limit)
          .offset(offset),
        db().select({ n: sql<number>`count(*)::int` }).from(directorySubscriptions).where(whereClause),
      ]);
      res.json({ data: rows, total: totalRows[0]?.n ?? 0, priceMonthlyUsd: DIRECTORY_PRO_MONTHLY_USD });
    } catch (err) {
      console.error('[admin] list directory subscriptions failed:', err);
      res.status(500).json({ error: 'Failed to list directory subscriptions' });
    }
  });

  app.get('/api/admin/subscriptions/manifest', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const statusRaw = String(req.query.status ?? '').trim();
      const statusFilter = ['active', 'trialing', 'past_due', 'inactive'].includes(statusRaw) ? statusRaw : null;
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const whereClause = statusFilter ? eq(manifestSubscriptions.status, statusFilter) : undefined;
      const [rows, totalRows] = await Promise.all([
        db()
          .select({
            id: manifestSubscriptions.id,
            userId: manifestSubscriptions.userId,
            email: users.email,
            name: users.name,
            tier: manifestSubscriptions.tier,
            status: manifestSubscriptions.status,
            comp: manifestSubscriptions.comp,
            compNote: manifestSubscriptions.compNote,
            entityQuota: manifestSubscriptions.entityQuota,
            priceId: manifestSubscriptions.priceId,
            stripeCustomerId: manifestSubscriptions.stripeCustomerId,
            stripeSubscriptionId: manifestSubscriptions.stripeSubscriptionId,
            currentPeriodEnd: manifestSubscriptions.currentPeriodEnd,
            createdAt: manifestSubscriptions.createdAt,
          })
          .from(manifestSubscriptions)
          .leftJoin(users, eq(users.id, manifestSubscriptions.userId))
          .where(whereClause)
          .orderBy(desc(manifestSubscriptions.createdAt))
          .limit(limit)
          .offset(offset),
        db().select({ n: sql<number>`count(*)::int` }).from(manifestSubscriptions).where(whereClause),
      ]);
      res.json({ data: rows, total: totalRows[0]?.n ?? 0, annualUsd: MANIFEST_ANNUAL_USD });
    } catch (err) {
      console.error('[admin] list manifest subscriptions failed:', err);
      res.status(500).json({ error: 'Failed to list manifest subscriptions' });
    }
  });

  // Comp / free-grant a product subscription (partner, support case). Upserts an
  // active, comp-flagged (NOT revenue-counted) entitlement by user email.
  app.post('/api/admin/subscriptions/:product/comp', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const product = String(req.params.product);
      if (product !== 'directory' && product !== 'manifest') {
        return res.status(400).json({ error: 'Unknown product.' });
      }
      const result = await upsertCompSubscription({
        product,
        body: req.body,
        actorUserId: req.user?.id ?? null,
      });
      res.status(result.status).json(result.json);
    } catch (err) {
      console.error('[admin] comp subscription failed:', err);
      res.status(500).json({ error: 'Failed to comp subscription' });
    }
  });

  // Issue a Stripe refund from admin — REAL MONEY, superadmin-only + audited.
  app.post('/api/admin/refund', requireAuth, requireSuperAdmin, async (req, res) => {
    const result = await issueRefundAdmin({ body: req.body, actorUserId: req.user?.id ?? null });
    res.status(result.status).json(result.json);
  });

  // ── IMPORTER SEARCH admin — credits/usage meter + cache purge. ──
  app.get('/api/admin/importers/usage', requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const [bolCount, contactCount] = await Promise.all([
        db().select({ n: sql<number>`count(*)::int` }).from(importerBolCache),
        db().select({ n: sql<number>`count(*)::int` }).from(importerContactCache),
      ]);
      res.json({
        meter: creditMeter(),
        cache: { bolRows: bolCount[0]?.n ?? 0, contactRows: contactCount[0]?.n ?? 0 },
      });
    } catch (err) {
      console.error('[admin] importer usage failed:', err);
      res.status(500).json({ error: 'Failed to load importer usage' });
    }
  });

  app.post('/api/admin/importers/cache/purge', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const result = await purgeImporterCacheAdmin({ body: req.body, actorUserId: req.user?.id ?? null });
      res.status(result.status).json(result.json);
    } catch (err) {
      console.error('[admin] importer cache purge failed:', err);
      res.status(500).json({ error: 'Failed to purge importer cache' });
    }
  });
}
