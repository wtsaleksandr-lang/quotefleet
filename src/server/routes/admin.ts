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
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { tenants, leads, users, auditLog } from '../../db/schema.js';
import { requireAuth, requireSuperAdmin } from '../middleware.js';
import { runAggregatesNow } from '../../marketplace/cron.js';
import {
  PLAN_IDS,
  PLAN_PRICES_USD,
  normalizePlan,
  isTrialing,
  type PaidPlanId,
} from '../plans.js';

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

  app.get('/api/admin/stats', requireAuth, requireSuperAdmin, async (_req, res) => {
    const [tenantCount, userCount, leadCount, mrrRows] = await Promise.all([
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
    ]);
    const revenue = computeMrr(mrrRows);
    res.json({
      tenants: tenantCount[0]?.n ?? 0,
      users: userCount[0]?.n ?? 0,
      leads: leadCount[0]?.n ?? 0,
      mrr: revenue.mrr,
      byPlan: revenue.byPlan,
      trialingCount: revenue.trialingCount,
      potentialTrialMrr: revenue.potentialTrialMrr,
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
}
