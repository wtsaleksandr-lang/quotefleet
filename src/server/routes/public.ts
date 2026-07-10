/**
 * PUBLIC routes — no auth needed. Used by the embeddable widget and
 * the page at /w/:slug.
 *
 *   GET  /embed.js                       — small loader (creates iframe)
 *   GET  /api/public/widget/:slug        — widget config (rates, brand, accessorials)
 *   POST /api/public/quote/:slug         — compute a quote (no DB write)
 *   POST /api/public/lead/:slug          — submit lead with contact info
 *   POST /api/public/chat/:refId         — chat with AI about a lead
 *   POST /api/public/callback/:refId     — request a human callback
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
  terminals,
  ports,
  brandConfigs,
  leads,
  aiConfigs,
  callbackRequests,
} from '../../db/schema.js';
import express from 'express';
import { calculate, customerFacingLines, type CalcRequest } from '../../calc/engine.js';
import { distanceBetween } from '../../calc/distance.js';
import { generateLeadReply } from '../../ai/replyAgent.js';
import { leadChatTurn } from '../../ai/chatAgent.js';
import { sendEmail } from '../../email/send.js';
import { loadEnv } from '../../config.js';
import { getTrialState } from '../trialGating.js';
import { canUseProFeature } from '../plans.js';
import { publicCalcLimiter, publicChatLimiter, publicLeadLimiter } from '../rateLimits.js';
import { resolveWidgetTheme } from '../widgetThemes.js';
import { loadCarrierProfile } from './carrierProfile.js';
import { enforceTenantAccess } from '../access.js';

/** Returns true if the request's Origin/Referer host matches the
 *  tenant's brand_configs.allowed_domains (CSV). Empty list = wide open
 *  (default). Used by /api/public/{quote,lead,chat} to honor tenant
 *  domain restrictions, the column the dashboard claims to enforce. */
function originAllowed(allowedCsv: string | null | undefined, req: Request): boolean {
  if (!allowedCsv || allowedCsv.trim() === '') return true;
  const allowed = allowedCsv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return true;
  const candidate = String(req.headers.origin ?? req.headers.referer ?? '');
  if (!candidate) return false;
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    return allowed.some((a) => host === a || host.endsWith('.' + a));
  } catch {
    return false;
  }
}

function generateLeadRef(): string {
  // The refId doubles as the lookup key for the PUBLIC, unauthenticated
  // chat/quote/read endpoints (`/chat/:refId`, `/api/public/lead/:refId`,
  // …). A short 6-char code is enumerable — an attacker could brute-force
  // the space and scrape customer PII. A 21-char nanoid (~125 bits) makes
  // the ref unguessable while keeping a single key across the dashboard,
  // hosted quote page, chat page, and emails (no separate token to wire).
  const yyyy = new Date().getFullYear();
  const seq = nanoid(21);
  return `QF-${yyyy}-${seq}`;
}

const LocationSchema = z.object({
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  portCode: z.string().optional(),
  terminalCode: z.string().optional(),
  /** Direct lat/lng from typeahead pick — skips geocoding when present. */
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const QuoteSchema = z.object({
  service: z.string(),
  equipment: z.string(),
  pickup: LocationSchema,
  delivery: LocationSchema,
  weightLbs: z.number().optional(),
  pieces: z.number().optional(),
  pickupDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  commodity: z.string().optional(),
  notes: z.string().optional(),
  /** Drayage extras — captured for the carrier's dispatcher to verify. */
  oceanCarrier: z.string().optional(),
  bookingNumber: z.string().optional(),
  billOfLadingNumber: z.string().optional(),
  containerNumbers: z.string().optional(),
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

// Email/phone are optional at the schema layer because the brand config
// decides whether they're required. The route handler enforces presence
// based on brand.requireEmail / brand.requirePhone.
const LeadSchema = QuoteSchema.extend({
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerPhone: z.string().optional(),
  customerCompany: z.string().optional(),
});

async function getTenantBySlug(slug: string) {
  const rows = await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/**
 * For drayage, the customer often selects a port — not a city/ZIP.
 * In that case we resolve the pickup coordinates to the port's lat/lng
 * so distance calculations still work. The original location object
 * is unchanged (city/state/zip stay empty if not supplied).
 */
async function resolvePickupForDistance(loc: {
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  portCode?: string;
}): Promise<typeof loc & { lat?: number; lng?: number }> {
  const hasLocation = !!(loc.zip || loc.city);
  if (hasLocation || !loc.portCode) return loc;
  const p = await db().select().from(ports).where(eq(ports.code, loc.portCode)).limit(1);
  const port = p[0];
  if (!port) return loc;
  return {
    ...loc,
    city: loc.city ?? port.city,
    state: loc.state ?? (port.state ?? undefined),
    country: loc.country ?? port.country,
    lat: port.lat,
    lng: port.lng,
  };
}

async function loadConfig(tenantId: number) {
  const [cards, accs, zones, terms, brand] = await Promise.all([
    db().select().from(rateCards).where(eq(rateCards.tenantId, tenantId)),
    db().select().from(accessorials).where(eq(accessorials.tenantId, tenantId)),
    db().select().from(laneZones).where(eq(laneZones.tenantId, tenantId)),
    db().select().from(terminals).where(eq(terminals.tenantId, tenantId)),
    db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, tenantId)).limit(1),
  ]);
  return { cards, accs, zones, terms, brand: brand[0] ?? null };
}

export function registerPublicRoutes(app: Express) {
  // ── embed.js loader ────────────────────────────────────────────
  app.get('/embed.js', async (req: Request, res: Response) => {
    res.type('application/javascript');
    const token = String(req.query.t ?? '');
    if (!token) return res.status(400).send('// missing ?t=<token>');
    // Single SELECT — earlier we did 2 round-trips for slug then full row.
    let tenant: typeof tenants.$inferSelect | undefined;
    try {
      const rows = await db().select().from(tenants).where(eq(tenants.embedToken, token)).limit(1);
      tenant = rows[0];
    } catch (err) {
      console.warn('[embed.js] DB lookup failed:', (err as Error).message);
      return res.status(500).send('// embed lookup failed');
    }
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
    // Private-calculator gate — a private tenant's rates are not fetchable
    // without a valid access grant (invite cookie/token).
    if (!(await enforceTenantAccess(tenant, req, res))) return;
    const { cards, accs, zones, terms, brand } = await loadConfig(tenant.id);
    // Carrier contact block shown in the widget header — same source of
    // truth as the hosted quote (tenant.contactPhone/Email/mc/dot +
    // carrier-profile address). Assembled here so widget.js just renders.
    const carrierProfile = await loadCarrierProfile(tenant.id);
    const cp = carrierProfile as Record<string, string | null | undefined>;
    const addressParts = [
      cp.addressLine1,
      cp.addressLine2,
      [cp.city, cp.state, cp.postalCode].map((s) => (s ?? '').trim()).filter(Boolean).join(', '),
      cp.country,
    ].map((s) => (s ?? '').trim()).filter(Boolean);
    const contact = {
      phone: tenant.contactPhone || null,
      email: tenant.contactEmail || null,
      address: addressParts.length ? addressParts.join(' · ') : null,
      mcNumber: tenant.mcNumber || null,
      dotNumber: tenant.dotNumber || null,
    };

    // Ports relevant to drayage zones — only return ones that have at
    // least one enabled lane-zone or terminal so the dropdown stays short.
    const enabledZones = zones.filter((z) => z.enabled);
    const enabledTerms = terms.filter((t) => t.enabled);
    const portCodes = Array.from(new Set([
      ...enabledZones.map((z) => z.anchorPortCode).filter((x): x is string => !!x),
      ...enabledTerms.map((t) => t.portCode),
    ]));
    const portsRows = portCodes.length
      ? await db().select().from(ports)
      : [];
    const drayagePorts = portsRows
      .filter((p) => portCodes.includes(p.code))
      .map((p) => ({ code: p.code, name: p.name, city: p.city, state: p.state, country: p.country }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Terminals grouped by portCode for drayage UI dropdowns.
    const terminalsByPort: Record<string, Array<{ code: string; name: string; carrier: string | null; notes: string | null }>> = {};
    for (const t of enabledTerms) {
      if (!terminalsByPort[t.portCode]) terminalsByPort[t.portCode] = [];
      terminalsByPort[t.portCode].push({
        code: t.code,
        name: t.name,
        carrier: t.carrier ?? null,
        notes: t.notes ?? null,
      });
    }
    for (const k of Object.keys(terminalsByPort)) {
      terminalsByPort[k].sort((a, b) => a.name.localeCompare(b.name));
    }

    return res.json({
      tenant: {
        slug: tenant.slug,
        name: tenant.name,
        countryFocus: tenant.countryFocus,
      },
      contact,
      brand: brand ?? null,
      // Fully-resolved widget theme (preset + optional accent override +
      // font). widget.js#applyTheme writes tokens.* onto the document root.
      theme: resolveWidgetTheme(brand ?? null),
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
      drayagePorts,
      terminalsByPort,
      hasZones: enabledZones.length > 0,
    });
  });

  // ── compute a quote (no save) ─────────────────────────────────
  app.post('/api/public/quote/:slug', publicCalcLimiter, async (req: Request, res: Response) => {
    const tenant = await getTenantBySlug(String(req.params.slug));
    if (!tenant || tenant.status !== 'active') {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    // Private-calculator gate — no grant, no quote (rates stay locked).
    if (!(await enforceTenantAccess(tenant, req, res))) return;
    // Honor the carrier's allowedDomains brand setting.
    const brand = (await db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, tenant.id)).limit(1))[0];
    if (!originAllowed(brand?.allowedDomains, req)) {
      return res.status(403).json({ error: 'This widget is not authorized for the calling domain.' });
    }
    const parse = QuoteSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const body = parse.data;
    const { cards, accs, zones, terms } = await loadConfig(tenant.id);

    // Distance — for drayage with a known port, fall back to the port's
    // lat/lng when the user hasn't typed a pickup ZIP/city.
    const pickupForDistance = await resolvePickupForDistance(body.pickup);
    const dist = await distanceBetween(pickupForDistance, body.delivery);
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
      pickupTerminalCode: body.pickup.terminalCode,
      deliveryTerminalCode: body.delivery.terminalCode,
      selectedAccessorialCodes: body.selectedAccessorialCodes,
      flags: body.flags,
    };
    const result = calculate(cards, accs, zones, calcReq, terms);

    // Customer-facing surface: never expose the carrier's margin line, and
    // don't ship the raw margin figure over the wire. The grand total is
    // unchanged — margin is folded into the linehaul line for display.
    const customerResult = {
      ...result,
      margin: 0,
      lines: customerFacingLines(result.lines),
    };

    return res.json({
      miles: dist.miles,
      origin: dist.origin,
      destination: dist.destination,
      result: customerResult,
    });
  });

  // ── submit lead (creates quote_request row + sends auto-reply) ─
  app.post('/api/public/lead/:slug', publicLeadLimiter, async (req: Request, res: Response) => {
    const tenant = await getTenantBySlug(String(req.params.slug));
    if (!tenant || tenant.status !== 'active') {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    // Private-calculator gate — reject lead submissions without a grant.
    if (!(await enforceTenantAccess(tenant, req, res))) return;
    const brand = (await db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, tenant.id)).limit(1))[0];
    if (!originAllowed(brand?.allowedDomains, req)) {
      return res.status(403).json({ error: 'This widget is not authorized for the calling domain.' });
    }
    // Trial gating — block free-tier tenants past trial / over quota.
    const trial = await getTrialState(tenant);
    if (!trial.acceptingLeads) {
      return res.status(403).json({
        error: trial.reason ?? 'This carrier is not currently accepting new quote requests.',
        trialStatus: trial.status,
      });
    }
    const parse = LeadSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const body = parse.data;

    // Carrier-controlled contact requirements (brand_configs flags).
    // Default behavior preserves the original "email required" rule.
    const requireEmail = brand?.requireEmail ?? true;
    const requirePhone = brand?.requirePhone ?? false;
    if (requireEmail && !body.customerEmail) {
      return res.status(400).json({ error: 'Email is required for this carrier.' });
    }
    if (requirePhone && !body.customerPhone) {
      return res.status(400).json({ error: 'Phone number is required for this carrier.' });
    }
    if (!body.customerEmail && !body.customerPhone) {
      return res.status(400).json({ error: 'Please provide an email or phone so we can reach you.' });
    }
    const { cards, accs, zones, terms } = await loadConfig(tenant.id);

    const pickupForDistance = await resolvePickupForDistance(body.pickup);
    const dist = await distanceBetween(pickupForDistance, body.delivery);
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
      pickupTerminalCode: body.pickup.terminalCode,
      deliveryTerminalCode: body.delivery.terminalCode,
      selectedAccessorialCodes: body.selectedAccessorialCodes,
      flags: body.flags,
    };
    const calc = calculate(cards, accs, zones, calcReq, terms);

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
        // When the customer enters only a ZIP/port, backfill city/state from
        // the geocoded point so the dashboard lane shows "Long Beach → Chicago"
        // instead of "? → ?".
        pickupCity: body.pickup.city ?? dist.origin.city,
        pickupState: body.pickup.state ?? dist.origin.state,
        pickupZip: body.pickup.zip,
        pickupCountry: body.pickup.country ?? 'US',
        pickupLat: dist.origin.lat,
        pickupLng: dist.origin.lng,
        deliveryAddress: body.delivery.address,
        deliveryCity: body.delivery.city ?? dist.destination.city,
        deliveryState: body.delivery.state ?? dist.destination.state,
        deliveryZip: body.delivery.zip,
        deliveryCountry: body.delivery.country ?? 'US',
        deliveryLat: dist.destination.lat,
        deliveryLng: dist.destination.lng,
        pickupDate: body.pickupDate,
        deliveryDate: body.deliveryDate,
        pickupTerminalCode: body.pickup.terminalCode,
        deliveryTerminalCode: body.delivery.terminalCode,
        oceanCarrier: body.oceanCarrier,
        bookingNumber: body.bookingNumber,
        billOfLadingNumber: body.billOfLadingNumber,
        containerNumbers: body.containerNumbers,
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
      // Auto-reply only when we actually have an email to send to AND the
      // tenant's plan includes AI (Pro-only; granted to everyone during the
      // trial via effectivePlan → 'pro'). Vital tenants post-trial get the
      // lead + notification but no AI-written reply.
      if (ai[0]?.autoReplyEnabled && canUseProFeature(tenant) && row && body.customerEmail) {
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
      // Notify tenant. Show whichever contact channel we have.
      const contactLine = body.customerEmail
        ? `<${body.customerEmail}>`
        : body.customerPhone
          ? `(${body.customerPhone})`
          : '(no contact info provided)';
      await sendEmail({
        to: tenant.contactEmail,
        subject: `New lead ${refId} ($${calc.total.toFixed(2)}) — ${body.customerName}`,
        text:
          `New quote request from ${body.customerName} ${contactLine}.\n` +
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
      // Customer-facing: margin folded into linehaul (total unchanged). The
      // raw breakdown with the margin line is persisted in breakdownJson above
      // for the carrier's internal dashboard view.
      breakdown: customerFacingLines(calc.lines),
      chatUrl: `${loadEnv().PUBLIC_BASE_URL}/chat/${refId}`,
    });
  });

  // ── lead chat (customer follow-up) ─────────────────────────────
  // 8KB body cap on this route specifically — Anthropic input is per
  // token, and a 2MB blob would cost ~$1.50 per call.
  app.post(
    '/api/public/chat/:refId',
    publicChatLimiter,
    express.json({ limit: '8kb' }),
    async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '');
    if (!refId) return res.status(400).json({ error: 'Missing refId' });
    const message = String(req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (message.length > 2000) return res.status(400).json({ error: 'Message too long (2000 chars max).' });
    const rows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    // AI 24-7 customer chat is Pro-only (all tenants get it during trial).
    const chatTenant = (
      await db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1)
    )[0];
    // Private-calculator gate — follow-up chat also requires a grant.
    if (chatTenant && !(await enforceTenantAccess(chatTenant, req, res))) return;
    const ai = await db()
      .select()
      .from(aiConfigs)
      .where(eq(aiConfigs.tenantId, lead.tenantId))
      .limit(1);
    if (!ai[0]?.chatEnabled || !chatTenant || !canUseProFeature(chatTenant)) {
      return res
        .status(403)
        .json({ error: 'Customer chat is disabled. Please reply to the email instead.' });
    }
    try {
      const reply = await leadChatTurn(lead.tenantId, lead.id, message);
      return res.json({ ok: true, reply });
    } catch (err) {
      console.error('[public.chat] AI failed:', err);
      return res.status(503).json({ error: 'Chat is temporarily unavailable. Please try again in a minute.' });
    }
  });

  // ── callback request — visitor asks a human to call them back ──
  // Two creation paths share this endpoint:
  //   - manual button click: triggerSource = 'visitor_button'
  //   - AI chat escalation: triggerSource = 'chat_escalation' + aiContext
  // Rate-limited via the chat limiter (same shape: per-refId small POST).
  const CallbackSchema = z.object({
    customerName: z.string().min(1).max(120),
    customerPhone: z.string().min(5).max(40),
    customerEmail: z.string().email().optional().or(z.literal('')),
    customerCompany: z.string().max(160).optional(),
    preferredTime: z.string().max(160).optional(),
    topic: z.string().max(500).optional(),
    triggerSource: z.enum(['visitor_button', 'chat_escalation']).optional(),
    aiContext: z
      .object({
        reason: z.string().max(500).optional(),
        messages: z
          .array(z.object({ role: z.string().max(20), content: z.string().max(2000) }))
          .max(20)
          .optional(),
      })
      .optional(),
  });

  app.post(
    '/api/public/callback/:refId',
    publicChatLimiter,
    express.json({ limit: '16kb' }),
    async (req: Request, res: Response) => {
      const refId = String(req.params.refId ?? '');
      if (!refId) return res.status(400).json({ error: 'Missing refId' });
      const parse = CallbackSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
      }
      const body = parse.data;
      const leadRows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
      const lead = leadRows[0];
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      // Private-calculator gate — callback requests require a grant too.
      const cbTenant = (
        await db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1)
      )[0];
      if (cbTenant && !(await enforceTenantAccess(cbTenant, req, res))) return;

      const [row] = await db()
        .insert(callbackRequests)
        .values({
          tenantId: lead.tenantId,
          leadId: lead.id,
          leadRefId: lead.refId,
          customerName: body.customerName,
          customerPhone: body.customerPhone,
          customerEmail: body.customerEmail || lead.customerEmail || null,
          customerCompany: body.customerCompany || lead.customerCompany || null,
          preferredTime: body.preferredTime ?? null,
          topic: body.topic ?? null,
          triggerSource: body.triggerSource ?? 'visitor_button',
          aiContextJson: body.aiContext ?? null,
        })
        .returning();

      // Notify tenant — best-effort, don't fail the request if email errors.
      try {
        const tenantRow = await db()
          .select()
          .from(tenants)
          .where(eq(tenants.id, lead.tenantId))
          .limit(1);
        const tenant = tenantRow[0];
        if (tenant) {
          const lines = [
            `${body.customerName} requested a callback for quote ${refId}.`,
            `Phone: ${body.customerPhone}`,
            body.customerEmail ? `Email: ${body.customerEmail}` : '',
            body.preferredTime ? `Preferred time: ${body.preferredTime}` : '',
            body.topic ? `\nTopic:\n${body.topic}` : '',
            body.triggerSource === 'chat_escalation'
              ? `\n(Escalated from AI chat${body.aiContext?.reason ? ` — ${body.aiContext.reason}` : ''}.)`
              : '',
            `\nOpen in dashboard: ${loadEnv().PUBLIC_BASE_URL}/app/callbacks/${row?.id ?? ''}`,
          ].filter(Boolean);
          await sendEmail({
            to: tenant.contactEmail,
            subject: `📞 Callback requested — ${body.customerName} (quote ${refId})`,
            text: lines.join('\n'),
          });
        }
      } catch (err) {
        console.warn('[public/callback] notify failed (non-fatal):', err);
      }

      return res.json({ ok: true, id: row?.id });
    }
  );

  app.get('/api/public/lead/:refId', publicChatLimiter, async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '');
    if (!refId) return res.status(400).json({ error: 'Missing refId' });
    const rows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const t = await db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1);
    // Private-calculator gate — a private tenant's lead/quote data is not
    // readable without a grant.
    if (t[0] && !(await enforceTenantAccess(t[0], req, res))) return;
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
