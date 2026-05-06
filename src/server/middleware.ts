/**
 * Express auth middleware.
 *
 * - requireAuth: any logged-in user
 * - requireTenant: same + sets req.tenantId from the user's tenantId
 *                  (or from a path param + super_admin override)
 * - requireSuperAdmin: only super-admins
 */
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { lookupSession, SESSION_COOKIE_NAME } from '../auth/session.js';

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
  next();
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
