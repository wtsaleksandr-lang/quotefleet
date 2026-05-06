/**
 * PUBLIC routes — no auth needed. Used by the embeddable widget and
 * the page at /w/:slug.
 *
 *   GET  /embed.js                       — small loader (creates iframe)
 *   GET  /api/public/widget/:slug        — widget config (rates, brand, accessorials)
 *   POST /api/public/quote/:slug         — compute a quote (no DB write)
 *   POST /api/public/lead/:slug          — submit lead with contact info
 *   POST /api/public/chat/:refId         — chat with AI about a lead
 *   GET  /api/public/lead/:refId         — read lead (for chat page)
 */
import type { Express, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  tenants,
  rateCards,
  accessorials,
  laneZones,
  brandConfigs,
  leads,
  aiConfigs,
} from '../../db/schema.js';
import { calculate, type CalcRequest } from '../../calc/engine.js';
import { distanceBetween } from '../../calc/distance.js';
import { generateLeadReply } from '../../ai/replyAgent.js';
import { leadChatTurn } from '../../ai/chatAgent.js';
import { sendEmail } from '../../email/send.js';
import { loadEnv } from '../../config.js';

function generateLeadRef(): string {
  const yyyy = new Date().getFullYear();
  const seq = nanoid(6).toUpperCase();
  return `QF-${yyyy}-${seq}`;
}

const QuoteSchema = z.object({
  service: z.string(),
  equipment: z.string(),
  pickup: z.object({
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    portCode: z.string().optional(),
  }),
  delivery: z.object({
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    portCode: z.string().optional(),
  }),
  weightLbs: z.number().optional(),
  pieces: z.number().optional(),
  pickupDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  commodity: z.string().optional(),
  notes: z.string().optional(),
  selectedAccessorialCodes: z.array(z.string()).optional(),
  flags: z
    .object({
      residential: z.boolean().optional(),
      hazmat: z.boolean().optional(),
      tempControlled: z.boolean().optional(),
      insideDelivery: z.boolean().optional(),
      liftgate: z.boolean().optional(),
      prepull: z.boolean().optional(),
      storageDays: z.number().optional(),
      detentionHours: z.number().optional(),
      layoverDays: z.number().optional(),
    })
    .optional(),
});

const LeadSchema = QuoteSchema.extend({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  customerCompany: z.string().optional(),
});

async function getTenantBySlug(slug: string) {
  const rows = await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

async function loadConfig(tenantId: number) {
  const [cards, accs, zones, brand] = await Promise.all([
    db().select().from(rateCards).where(eq(rateCards.tenantId, tenantId)),
    db().select().from(accessorials).where(eq(accessorials.tenantId, tenantId)),
    db().select().from(laneZones).where(eq(laneZones.tenantId, tenantId)),
    db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, tenantId)).limit(1),
  ]);
  return { cards, accs, zones, brand: brand[0] ?? null };
}

export function registerPublicRoutes(app: Express) {
  // ── embed.js loader ────────────────────────────────────────────
  app.get('/embed.js', async (req: Request, res: Response) => {
    res.type('application/javascript');
    const token = String(req.query.t ?? '');
    if (!token) return res.status(400).send('// missing ?t=<token>');
    let t: { slug: string }[] = [];
    try {
      t = await db().select({ slug: tenants.slug }).from(tenants).where(eq(tenants.embedToken, token)).limit(1);
    } catch (err) {
      console.warn('[embed.js] DB lookup failed:', (err as Error).message);
      return res.status(500).send('// embed lookup failed');
    }
    if (!t[0]) return res.send('// invalid embed token');
    // Look up the tenant's full row so we know its host_domain.
    const tRow = await db().select().from(tenants).where(eq(tenants.embedToken, token)).limit(1);
    const tenant = tRow[0];
    if (!tenant) return res.send('// invalid embed token');
    const env = loadEnv();
    // Prefer the tenant's hosted subdomain (`<slug>.<host>`) — gives us
    // a clean URL with no path. Fall back to `<base>/w/<slug>` if no
    // host_domain (legacy tenants pre-migration).
    const proto = env.PUBLIC_BASE_URL.startsWith('http://') ? 'http:' : 'https:';
    const widgetUrl = tenant.hostDomain
      ? `${proto}//${tenant.slug}.${tenant.hostDomain}/?embed=1`
      : `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/w/${tenant.slug}?embed=1`;
    res.type('application/javascript').send(`
(function(){
  var d=document, scripts=d.getElementsByTagName('script'),
      me=scripts[scripts.length-1],
      mount=me.parentNode;
  var div=d.createElement('div');
  div.id='qf-widget-${tenant.slug}';
  div.style.cssText='width:100%;max-width:560px;margin:0 auto;';
  var ifr=d.createElement('iframe');
  ifr.src=${JSON.stringify(widgetUrl)};
  ifr.style.cssText='width:100%;border:0;display:block;min-height:660px;';
  ifr.setAttribute('loading','lazy');
  ifr.setAttribute('title','Instant freight quote');
  ifr.setAttribute('allow','clipboard-write');
  div.appendChild(ifr);
  mount.parentNode.insertBefore(div, mount);
  // Auto-resize via postMessage from the iframe.
  window.addEventListener('message', function(e){
    if(!e || !e.data || e.data.qf!=='resize' || e.data.slug!==${JSON.stringify(tenant.slug)}) return;
    if (typeof e.data.h==='number') ifr.style.height=e.data.h+'px';
  });
})();
`);
  });

  // ── widget config (read-only, no PII) ──────────────────────────
  app.get('/api/public/widget/:slug', async (req: Request, res: Response) => {
    const tenant = await getTenantBySlug(String(req.params.slug));
    if (!tenant || tenant.status !== 'active') {
      return res.status(404).json({ error: 'Tenant not found or inactive' });
    }
    const { cards, accs, zones, brand } = await loadConfig(tenant.id);
    return res.json({
      tenant: {
        slug: tenant.slug,
        name: tenant.name,
        countryFocus: tenant.countryFocus,
      },
      brand: brand ?? null,
      services: Array.from(new Set(cards.filter((c) => c.enabled).map((c) => c.service))),
      equipmentByService: groupBy(cards.filter((c) => c.enabled), 'service', 'equipment', 'label'),
      accessorials: accs
        .filter((a) => a.enabled && a.trigger === 'optional')
        .map((a) => ({
          code: a.code,
          label: a.label,
          description: a.description,
          appliesToServices: a.appliesToServices ?? null,
        })),
      hasZones: zones.filter((z) => z.enabled).length > 0,
    });
  });

  // ── compute a quote (no save) ─────────────────────────────────
  app.post('/api/public/quote/:slug', async (req: Request, res: Response) => {
    const tenant = await getTenantBySlug(String(req.params.slug));
    if (!tenant || tenant.status !== 'active') {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const parse = QuoteSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const body = parse.data;
    const { cards, accs, zones } = await loadConfig(tenant.id);

    // Distance
    const dist = await distanceBetween(body.pickup, body.delivery);
    if ('error' in dist) {
      return res.status(400).json({ error: dist.error });
    }

    const calcReq: CalcRequest = {
      service: body.service,
      equipment: body.equipment,
      miles: dist.miles,
      weightLbs: body.weightLbs,
      pieces: body.pieces,
      pickupCity: body.pickup.city,
      pickupState: body.pickup.state,
      pickupZip: body.pickup.zip,
      pickupCountry: body.pickup.country,
      pickupLat: dist.origin.lat,
      pickupLng: dist.origin.lng,
      deliveryCity: body.delivery.city,
      deliveryState: body.delivery.state,
      deliveryZip: body.delivery.zip,
      deliveryCountry: body.delivery.country,
      deliveryLat: dist.destination.lat,
      deliveryLng: dist.destination.lng,
      pickupPortCode: body.pickup.portCode,
      deliveryPortCode: body.delivery.portCode,
      selectedAccessorialCodes: body.selectedAccessorialCodes,
      flags: body.flags,
    };
    const result = calculate(cards, accs, zones, calcReq);

    return res.json({
      miles: dist.miles,
      origin: dist.origin,
      destination: dist.destination,
      result,
    });
  });

  // ── submit lead (creates quote_request row + sends auto-reply) ─
  app.post('/api/public/lead/:slug', async (req: Request, res: Response) => {
    const tenant = await getTenantBySlug(String(req.params.slug));
    if (!tenant || tenant.status !== 'active') {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const parse = LeadSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const body = parse.data;
    const { cards, accs, zones } = await loadConfig(tenant.id);

    const dist = await distanceBetween(body.pickup, body.delivery);
    if ('error' in dist) return res.status(400).json({ error: dist.error });

    const calcReq: CalcRequest = {
      service: body.service,
      equipment: body.equipment,
      miles: dist.miles,
      weightLbs: body.weightLbs,
      pieces: body.pieces,
      pickupCity: body.pickup.city,
      pickupState: body.pickup.state,
      pickupZip: body.pickup.zip,
      pickupCountry: body.pickup.country,
      pickupLat: dist.origin.lat,
      pickupLng: dist.origin.lng,
      deliveryCity: body.delivery.city,
      deliveryState: body.delivery.state,
      deliveryZip: body.delivery.zip,
      deliveryCountry: body.delivery.country,
      deliveryLat: dist.destination.lat,
      deliveryLng: dist.destination.lng,
      pickupPortCode: body.pickup.portCode,
      deliveryPortCode: body.delivery.portCode,
      selectedAccessorialCodes: body.selectedAccessorialCodes,
      flags: body.flags,
    };
    const calc = calculate(cards, accs, zones, calcReq);

    const refId = generateLeadRef();
    const sourceUrl = req.headers.referer ?? null;
    const sourceIp =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.ip ?? null;

    const [row] = await db()
      .insert(leads)
      .values({
        tenantId: tenant.id,
        refId,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerPhone: body.customerPhone,
        customerCompany: body.customerCompany,
        service: body.service,
        equipment: body.equipment,
        pickupAddress: body.pickup.address,
        pickupCity: body.pickup.city,
        pickupState: body.pickup.state,
        pickupZip: body.pickup.zip,
        pickupCountry: body.pickup.country ?? 'US',
        pickupLat: dist.origin.lat,
        pickupLng: dist.origin.lng,
        deliveryAddress: body.delivery.address,
        deliveryCity: body.delivery.city,
        deliveryState: body.delivery.state,
        deliveryZip: body.delivery.zip,
        deliveryCountry: body.delivery.country ?? 'US',
        deliveryLat: dist.destination.lat,
        deliveryLng: dist.destination.lng,
        pickupDate: body.pickupDate,
        deliveryDate: body.deliveryDate,
        weightLbs: body.weightLbs,
        pieces: body.pieces,
        commodity: body.commodity,
        notes: body.notes,
        accessorialCodes: body.selectedAccessorialCodes ?? [],
        distanceMiles: dist.miles,
        breakdownJson: calc.lines.map((l) => ({
          name: l.name,
          amount: l.amount,
          kind: l.kind,
          note: l.note,
        })),
        quotedTotal: calc.total,
        quotedCurrency: 'USD',
        sourceUrl,
        sourceIp,
        userAgent: req.headers['user-agent'] ?? null,
        status: 'new',
      })
      .returning();

    // Auto-reply email + tenant notification — best-effort, don't fail
    // the request if it errors.
    try {
      const ai = await db()
        .select()
        .from(aiConfigs)
        .where(eq(aiConfigs.tenantId, tenant.id))
        .limit(1);
      if (ai[0]?.autoReplyEnabled && row) {
        const aiBody = await generateLeadReply(tenant.id, row.id);
        await sendEmail({
          to: body.customerEmail,
          subject: `Quote ${refId} — ${tenant.name}`,
          text: aiBody,
        });
        await db()
          .update(leads)
          .set({ autoReplySent: true, autoReplyAt: new Date(), aiSummary: aiBody })
          .where(eq(leads.id, row.id));
      }
      // Notify tenant.
      await sendEmail({
        to: tenant.contactEmail,
        subject: `New lead ${refId} ($${calc.total.toFixed(2)}) — ${body.customerName}`,
        text:
          `New quote request from ${body.customerName} <${body.customerEmail}>.\n` +
          `Lane: ${body.pickup.city ?? '?'} → ${body.delivery.city ?? '?'} (${dist.miles} mi)\n` +
          `Equipment: ${body.equipment}\n` +
          `Total: $${calc.total.toFixed(2)}\n\n` +
          `View in dashboard: ${loadEnv().PUBLIC_BASE_URL}/app/leads/${refId}`,
      });
    } catch (err) {
      console.warn('[public/lead] notify failed (non-fatal):', err);
    }

    return res.json({
      ok: true,
      refId,
      total: calc.total,
      breakdown: calc.lines,
      chatUrl: `${loadEnv().PUBLIC_BASE_URL}/chat/${refId}`,
    });
  });

  // ── lead chat (customer follow-up) ─────────────────────────────
  app.post('/api/public/chat/:refId', async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '');
    if (!refId) return res.status(400).json({ error: 'Missing refId' });
    const message = String(req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const rows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const ai = await db()
      .select()
      .from(aiConfigs)
      .where(eq(aiConfigs.tenantId, lead.tenantId))
      .limit(1);
    if (!ai[0]?.chatEnabled) {
      return res
        .status(403)
        .json({ error: 'Customer chat is disabled. Please reply to the email instead.' });
    }
    const reply = await leadChatTurn(lead.tenantId, lead.id, message);
    return res.json({ ok: true, reply });
  });

  app.get('/api/public/lead/:refId', async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '');
    if (!refId) return res.status(400).json({ error: 'Missing refId' });
    const rows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const t = await db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1);
    const brand = await db()
      .select()
      .from(brandConfigs)
      .where(eq(brandConfigs.tenantId, lead.tenantId))
      .limit(1);
    return res.json({
      lead: {
        refId: lead.refId,
        customerName: lead.customerName,
        service: lead.service,
        equipment: lead.equipment,
        pickup: [lead.pickupCity, lead.pickupState, lead.pickupZip].filter(Boolean).join(', '),
        delivery: [lead.deliveryCity, lead.deliveryState, lead.deliveryZip]
          .filter(Boolean)
          .join(', '),
        miles: lead.distanceMiles,
        total: lead.quotedTotal,
        breakdown: lead.breakdownJson,
        aiSummary: lead.aiSummary,
        createdAt: lead.createdAt,
      },
      tenant: t[0] ? { name: t[0].name, slug: t[0].slug } : null,
      brand: brand[0] ?? null,
    });
  });
}

function groupBy<T extends Record<string, unknown>>(
  arr: T[],
  byKey: keyof T,
  valKey: keyof T,
  labelKey: keyof T
): Record<string, Array<{ value: string; label: string }>> {
  const out: Record<string, Array<{ value: string; label: string }>> = {};
  for (const row of arr) {
    const k = String(row[byKey] ?? '');
    if (!out[k]) out[k] = [];
    out[k].push({
      value: String(row[valKey] ?? ''),
      label: String(row[labelKey] ?? row[valKey] ?? ''),
    });
  }
  return out;
}
