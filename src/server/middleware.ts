/**
 * Express auth middleware.
 *
 * - requireAuth: any logged-in user
 * - requireTenant: same + sets req.tenantId from the user's tenantId
 *                  (or from a path param + super_admin override).
 *                  Also enforces trial expiry: free-tier tenants past
 *                  `trialEndsAt` cannot mutate (POST/PUT/PATCH/DELETE),
 *                  except on the billing-upgrade flow itself.
 * - requirePlan:   factory — gates a route to one of the listed plans.
 * - requireSuperAdmin: only super-admins
 */
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { lookupSession, SESSION_COOKIE_NAME } from '../auth/session.js';
import { effectivePlan } from './plans.js';

/** HTTP methods considered mutations for trial-expiry enforcement.
 *  GETs (and HEAD/OPTIONS) stay readable so an expired tenant can still
 *  see their data and reach the upgrade prompt. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Path prefixes that bypass the trial-expired write-block. The billing
 *  upgrade flow itself must remain reachable — otherwise a locked-out
 *  tenant literally cannot pay to unlock. */
const BILLING_ROUTE_BYPASS = ['/api/billing/'];

/** When true, skip trial enforcement entirely. Set in test runners or
 *  when debugging against seeded fixtures. */
function trialEnforcementDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.BYPASS_TRIAL_ENFORCEMENT === '1' ||
    process.env.BYPASS_TRIAL_ENFORCEMENT === 'true'
  );
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies[SESSION_COOKIE_NAME];
  const ctx = await lookupSession(token);
  if (!ctx) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = ctx.user;
  next();
}

export async function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // Super admins can access any tenant — pass slug or id in query/path.
  if (req.user.role === 'super_admin') {
    const slug = (req.params.slug as string | undefined) ?? (req.query.slug as string | undefined);
    if (!slug) {
      res.status(400).json({ error: 'Super admin must specify ?slug=...' });
      return;
    }
    const t = await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (!t[0]) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    req.tenant = t[0];
    // Super admins are not subject to trial-expiry mutation block —
    // they manage tenants in any state.
    next();
    return;
  }
  // Regular user — uses their own tenant.
  if (!req.user.tenantId) {
    res.status(403).json({ error: 'User has no tenant' });
    return;
  }
  const t = await db()
    .select()
    .from(tenants)
    .where(eq(tenants.id, req.user.tenantId))
    .limit(1);
  if (!t[0]) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }
  req.tenant = t[0];

  // ── Trial-expiry write block ─────────────────────────────────
  // Frontend already disables inputs via the `qf-trial-locked` body
  // class, but that's purely cosmetic — a determined user can bypass
  // it via the JS console. This is the server-side enforcement.
  //
  //   plan === 'free'  AND  trialEndsAt < now  AND  method is mutating
  //                                                AND  not on /api/billing/*
  //       →  403 { error: 'trial_expired' }
  //
  // GETs remain allowed so the dashboard still loads. Billing routes
  // are exempt so the tenant can upgrade out of the lockout.
  if (!trialEnforcementDisabled() && MUTATING_METHODS.has(req.method)) {
    const tenant = req.tenant;
    const trialEnd = tenant.trialEndsAt ?? null;
    const expired = tenant.plan === 'free' && trialEnd != null && trialEnd.getTime() < Date.now();
    const onBillingPath = BILLING_ROUTE_BYPASS.some((p) => req.path.startsWith(p));
    if (expired && !onBillingPath) {
      res.status(403).json({
        error: 'trial_expired',
        message: 'Your trial has ended. Upgrade to a paid plan to keep making changes.',
        trialEndsAt: trialEnd.toISOString(),
      });
      return;
    }
  }

  next();
}

/**
 * Gate a route to one of the listed billing plans. Must be chained
 * AFTER requireTenant so `req.tenant` is populated.
 *
 *   app.put('/api/tenant/custom-domain',
 *     requireAuth, requireTenant, requirePlan('pro'),
 *     handler);
 *
 * Gates on the tenant's EFFECTIVE plan, so a tenant inside the 14-day
 * all-inclusive trial (effectivePlan → 'pro') passes Pro gates. Returns 403
 * `{ error: 'plan_upgrade_required', required: [...] }` otherwise.
 */
export function requirePlan(...plans: string[]) {
  const allowed = new Set(plans);
  return function planGate(req: Request, res: Response, next: NextFunction): void {
    if (!req.tenant) {
      res.status(500).json({ error: 'requirePlan used without requireTenant' });
      return;
    }
    // Super-admin bypass — operators can edit any tenant regardless of plan.
    if (req.user?.role === 'super_admin') {
      next();
      return;
    }
    // Gate on the tenant's EFFECTIVE plan, so a tenant inside the 14-day
    // all-inclusive trial (effectivePlan → 'pro') passes Pro gates and gets
    // to taste the paid features.
    if (!allowed.has(effectivePlan(req.tenant))) {
      res.status(403).json({
        error: 'plan_upgrade_required',
        required: [...allowed],
        current: effectivePlan(req.tenant),
      });
      return;
    }
    next();
  };
}

export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.user.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

/**
 * Owner-or-super-admin guard. Use on tenant settings that should not be
 * editable by lower-privileged staff accounts (Anthropic key, billing,
 * embed regen, custom domain, etc.). Must be chained AFTER requireAuth.
 */
export async function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.user.role !== 'tenant_owner' && req.user.role !== 'super_admin') {
    res.status(403).json({ error: 'Owner-only' });
    return;
  }
  next();
}
