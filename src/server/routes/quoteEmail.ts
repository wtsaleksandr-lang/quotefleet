import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { brandConfigs, leads, tenants } from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { publicChatLimiter } from '../rateLimits.js';

function money(n: number | null | undefined, currency: string | null | undefined): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(
    typeof n === 'number' && Number.isFinite(n) ? n : 0
  );
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function laneText(lead: typeof leads.$inferSelect): string {
  const pickup = [lead.pickupCity, lead.pickupState || lead.pickupZip].filter(Boolean).join(', ') || 'Pickup not specified';
  const delivery = [lead.deliveryCity, lead.deliveryState || lead.deliveryZip].filter(Boolean).join(', ') || 'Delivery not specified';
  return `${pickup} → ${delivery}`;
}

export function registerQuoteEmailRoutes(app: Express) {
  app.get('/api/public/quote-email-preview/:refId', publicChatLimiter, async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '').trim();
    if (!refId) return res.status(400).json({ error: 'Missing refId' });

    const leadRows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ error: 'Quote not found' });

    const [tenantRows, brandRows] = await Promise.all([
      db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1),
      db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, lead.tenantId)).limit(1),
    ]);
    const tenant = tenantRows[0];
    if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Carrier not found' });

    const brand = brandRows[0] || null;
    const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
    const carrierName = brand?.displayName || tenant.name;
    const quoteUrl = `${base}/quote/${encodeURIComponent(lead.refId)}`;
    const total = money(lead.quotedTotal, lead.quotedCurrency);
    const lane = laneText(lead);
    const service = [lead.service, lead.equipment].filter(Boolean).join(' / ');
    const greeting = lead.customerName ? `Hi ${lead.customerName},` : 'Hello,';
    const subject = `Quote ${lead.refId} from ${carrierName}`;

    const text = [
      greeting,
      '',
      `${carrierName} prepared quote ${lead.refId}.`,
      `Estimated total: ${total}`,
      `Lane: ${lane}`,
      service ? `Service / equipment: ${service}` : '',
      lead.distanceMiles ? `Estimated distance: ${Math.round(lead.distanceMiles)} miles` : '',
      '',
      `View quote: ${quoteUrl}`,
      '',
      tenant.contactEmail ? `Questions: ${tenant.contactEmail}` : '',
      tenant.contactPhone ? `Phone: ${tenant.contactPhone}` : '',
    ].filter(Boolean).join('\n');

    const html = [
      '<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f3f5f8;margin:0;padding:24px;color:#111827;">',
      '<div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #d9e1ec;border-radius:10px;padding:24px;">',
      '<div style="font-size:12px;text-transform:uppercase;color:#64748b;font-weight:bold;">Freight Quote</div>',
      '<h1 style="margin:4px 0 18px;font-size:22px;">' + esc(carrierName) + '</h1>',
      '<p>' + esc(greeting) + '</p>',
      '<p>Your quote is ready. Open the hosted quote to view the complete pricing breakdown and next steps.</p>',
      '<div style="border:1px solid #d9e1ec;border-radius:8px;margin:16px 0;overflow:hidden;">',
      '<div style="padding:10px;border-bottom:1px solid #e5eaf1;"><b>Quote:</b> ' + esc(lead.refId) + '</div>',
      '<div style="padding:10px;border-bottom:1px solid #e5eaf1;"><b>Total:</b> ' + esc(total) + '</div>',
      '<div style="padding:10px;border-bottom:1px solid #e5eaf1;"><b>Lane:</b> ' + esc(lane) + '</div>',
      '<div style="padding:10px;"><b>Service:</b> ' + esc(service || '—') + '</div>',
      '</div>',
      '<p><a href="' + esc(quoteUrl) + '" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:bold;padding:11px 16px;border-radius:7px;">View hosted quote</a></p>',
      '<p style="font-size:12px;color:#475569;">Quote is based on the details provided and may change if shipment details or required add-ons change.</p>',
      '</div></body></html>',
    ].join('');

    return res.json({ refId: lead.refId, to: lead.customerEmail || null, subject, text, html, quoteUrl });
  });
}
