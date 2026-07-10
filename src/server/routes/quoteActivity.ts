import type { Express, Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { auditLog, leads, tenants } from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { publicDocLimiter } from '../rateLimits.js';

const QuoteEventSchema = z.object({
  event: z.enum([
    'view',
    'copy_link',
    'print',
    'save_pdf',
    'email_click',
    'chat_open',
    'callback_open',
    'callback_submit',
  ]),
  pageUrl: z.string().max(1000).optional(),
});

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip;
}

function summarizeEvents(events: Array<typeof auditLog.$inferSelect>) {
  const counts: Record<string, number> = {};
  let lastViewedAt: string | null = null;
  let firstViewedAt: string | null = null;
  let lastEventAt: string | null = null;

  for (const row of events) {
    const details = (row.detailsJson || {}) as Record<string, unknown>;
    const event = typeof details.event === 'string' ? details.event : 'unknown';
    counts[event] = (counts[event] || 0) + 1;
    const at = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
    if (!lastEventAt || at > lastEventAt) lastEventAt = at;
    if (event === 'view') {
      if (!firstViewedAt || at < firstViewedAt) firstViewedAt = at;
      if (!lastViewedAt || at > lastViewedAt) lastViewedAt = at;
    }
  }

  return {
    totalEvents: events.length,
    counts,
    firstViewedAt,
    lastViewedAt,
    lastEventAt,
    viewed: !!counts.view,
    pdfSaved: !!counts.save_pdf,
    copied: !!counts.copy_link,
    chatOpened: !!counts.chat_open,
    callbackRequested: !!counts.callback_submit,
  };
}

export function registerQuoteActivityRoutes(app: Express) {
  app.post('/api/public/quote-activity/:refId', publicDocLimiter, async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '').trim();
    if (!refId) return res.status(400).json({ error: 'Missing refId' });

    const parse = QuoteEventSchema.safeParse(req.body ?? {});
    if (!parse.success) return res.status(400).json({ error: 'Invalid event' });

    const leadRows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ error: 'Quote not found' });

    const tenantRows = await db().select({ status: tenants.status }).from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1);
    if (!tenantRows[0] || tenantRows[0].status !== 'active') return res.status(404).json({ error: 'Carrier not found' });

    await db().insert(auditLog).values({
      tenantId: lead.tenantId,
      userId: null,
      actorKind: 'system',
      action: 'quote.activity',
      detailsJson: {
        event: parse.data.event,
        refId: lead.refId,
        leadId: lead.id,
        pageUrl: parse.data.pageUrl,
        userAgent: req.headers['user-agent'],
        ip: clientIp(req),
      },
    });

    return res.status(204).end();
  });

  app.get('/api/tenant/quote-activity/:refId', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '').trim();
    if (!refId) return res.status(400).json({ error: 'Missing refId' });

    const leadRows = await db()
      .select({ id: leads.id, refId: leads.refId })
      .from(leads)
      .where(and(eq(leads.refId, refId), eq(leads.tenantId, req.tenant!.id)))
      .limit(1);
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const rows = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, req.tenant!.id), eq(auditLog.action, 'quote.activity')))
      .orderBy(desc(auditLog.createdAt))
      .limit(1000);

    const events = rows.filter((row) => {
      const details = (row.detailsJson || {}) as Record<string, unknown>;
      return details.refId === lead.refId || details.leadId === lead.id;
    });

    return res.json({
      refId: lead.refId,
      summary: summarizeEvents(events),
      events: events.slice(0, 100).map((row) => ({
        id: row.id,
        event: ((row.detailsJson || {}) as Record<string, unknown>).event || 'unknown',
        pageUrl: ((row.detailsJson || {}) as Record<string, unknown>).pageUrl || null,
        createdAt: row.createdAt,
      })),
    });
  });
}
