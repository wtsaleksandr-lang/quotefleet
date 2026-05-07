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
    const Patch = z.object({
      plan: z.string().optional(),
      status: z.string().optional(),
      name: z.string().optional(),
      contactEmail: z.string().email().optional(),
    });
    const parse = Patch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(tenants)
      .set({ ...parse.data, updatedAt: new Date() })
      .where(eq(tenants.slug, String(req.params.slug)));
    res.json({ ok: true });
  });

  app.get('/api/admin/stats', requireAuth, requireSuperAdmin, async (_req, res) => {
    const [tenantCount, userCount, leadCount] = await Promise.all([
      db().select({ n: sql<number>`count(*)::int` }).from(tenants),
      db().select({ n: sql<number>`count(*)::int` }).from(users),
      db().select({ n: sql<number>`count(*)::int` }).from(leads),
    ]);
    res.json({
      tenants: tenantCount[0]?.n ?? 0,
      users: userCount[0]?.n ?? 0,
      leads: leadCount[0]?.n ?? 0,
    });
  });

  // Manually trigger marketplace-aggregate recomputation (also runs hourly).
  app.post('/api/admin/marketplace/recompute-aggregates', requireAuth, requireSuperAdmin, async (_req, res) => {
    const result = await runAggregatesNow();
    if (!result.ok) return res.status(500).json(result);
    return res.json(result);
  });
}
