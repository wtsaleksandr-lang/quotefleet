/**
 * TENANT routes — for the carrier's own dashboard. Auth required.
 *
 *   GET    /api/tenant/overview           — stats + recent leads
 *   GET    /api/tenant/rate-cards
 *   PUT    /api/tenant/rate-cards/:id
 *   POST   /api/tenant/rate-cards
 *   DELETE /api/tenant/rate-cards/:id
 *   GET    /api/tenant/accessorials
 *   PUT    /api/tenant/accessorials/:id
 *   POST   /api/tenant/accessorials
 *   DELETE /api/tenant/accessorials/:id
 *   GET    /api/tenant/lane-zones
 *   PUT    /api/tenant/lane-zones/:id
 *   POST   /api/tenant/lane-zones
 *   DELETE /api/tenant/lane-zones/:id
 *   GET    /api/tenant/leads
 *   GET    /api/tenant/leads/:refId
 *   PATCH  /api/tenant/leads/:refId       — update status / notes
 *   GET    /api/tenant/ai-config
 *   PUT    /api/tenant/ai-config
 *   GET    /api/tenant/brand
 *   PUT    /api/tenant/brand
 *   GET    /api/tenant/embed              — embed snippet
 *   POST   /api/tenant/regenerate-embed   — regenerate embed token
 *   GET    /api/tenant/audit              — recent AI/manual edits
 *   GET    /api/tenant/callbacks          — callback inbox
 *   PATCH  /api/tenant/callbacks/:id      — update status / notes
 */
import type { Express, Request, Response } from 'express';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import {
  tenants,
  rateCards,
  accessorials,
  laneZones,
  aiConfigs,
  brandConfigs,
  leads,
  auditLog,
  conversations,
  callbackRequests,
} from '../../db/schema.js';
import { requireAuth, requireTenant, requireOwner, requirePlan } from '../middleware.js';

/** Plan tiers for feature gating, expressed as EFFECTIVE plans (see
 *  src/server/plans.ts). Trial tenants resolve to 'pro' and pass every
 *  gate; that is intentional (all-inclusive trial). */
const CORE_PLANS = ['vital', 'pro'] as const; // branded quotes, core features
const PRO_PLANS = ['pro'] as const; // AI, PDF, automation, custom domain, analytics
import { encrypt } from '../../auth/secrets.js';
import { effectivePlan } from '../plans.js';
import { WIDGET_PRESETS, WIDGET_FONTS, WIDGET_PRESET_LIST } from '../widgetThemes.js';
import { loadEnv } from '../../config.js';
import { syncTenantToMarketplace } from '../../marketplace/sync.js';
import { DEFAULT_AI_SYSTEM_PROMPT } from '../../calc/defaults.js';
import { createHmac } from 'node:crypto';

/** Seed defaults stamped at signup (see routes/auth.ts + calc/defaults.ts).
 *  Used to tell a genuinely-customized brand/AI config apart from the
 *  out-of-the-box seed so the guided-setup meter only credits real work. */
const SEED_BRAND_PRIMARY = '#2563eb';
const SEED_BRAND_ACCENT = '#06b6d4';
const SEED_BRAND_TAGLINE = 'Instant freight quotes';

/** Fire-and-forget marketplace sync. Logs but never throws. */
function bumpMarketplace(tenantId: number) {
  void syncTenantToMarketplace(tenantId);
}

/** Deterministic per-tenant verification token. Derived from
 *  SESSION_SECRET so we don't need a separate persistence column —
 *  always recoverable, never guessable from the outside. */
function customDomainToken(tenantId: number): string {
  return (
    'qf-verify-' +
    createHmac('sha256', loadEnv().SESSION_SECRET)
      .update(`custom-domain:${tenantId}`)
      .digest('hex')
      .slice(0, 32)
  );
}

export function registerTenantRoutes(app: Express) {
  // ── overview ──────────────────────────────────────────────────
  app.get('/api/tenant/overview', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const tid = req.tenant!.id;
    const [recent, allLeads, audit] = await Promise.all([
      db().select().from(leads).where(eq(leads.tenantId, tid)).orderBy(desc(leads.createdAt)).limit(20),
      db().select().from(leads).where(eq(leads.tenantId, tid)),
      db().select().from(auditLog).where(eq(auditLog.tenantId, tid)).orderBy(desc(auditLog.createdAt)).limit(10),
    ]);
    const stats = {
      totalLeads: allLeads.length,
      newLeads: allLeads.filter((l) => l.status === 'new').length,
      wonLeads: allLeads.filter((l) => l.status === 'won').length,
      avgQuote:
        allLeads.length > 0
          ? Math.round(
              allLeads.reduce((s, l) => s + (l.quotedTotal ?? 0), 0) / allLeads.length
            )
          : 0,
    };
    return res.json({ tenant: req.tenant, stats, recentLeads: recent, audit });
  });

  // ── guided-setup status ───────────────────────────────────────
  // Reports REAL, account-level configuration state for the 6 guided
  // setup areas so the dashboard progress meter reflects actual data
  // instead of per-browser localStorage answers. Notes:
  //   - rates/accessorials/zones ship with working seed defaults at
  //     signup, so ">=1 row" == "this area is ready to quote".
  //   - brand/AI are compared against the seed so the meter only credits
  //     a genuine customization (otherwise every fresh tenant would read
  //     as fully branded / AI-tuned on day one).
  //   - the public-link (embed) step is an inherently client-side
  //     "viewed/copied" signal and is merged in on the client.
  app.get('/api/tenant/setup-status', requireAuth, requireTenant, async (req, res) => {
    const tid = req.tenant!.id;
    const [rc, ac, lz, brandRow, aiRow] = await Promise.all([
      db().select({ id: rateCards.id }).from(rateCards).where(eq(rateCards.tenantId, tid)),
      db().select({ id: accessorials.id }).from(accessorials).where(eq(accessorials.tenantId, tid)),
      db().select({ id: laneZones.id }).from(laneZones).where(eq(laneZones.tenantId, tid)),
      db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, tid)).limit(1),
      db().select().from(aiConfigs).where(eq(aiConfigs.tenantId, tid)).limit(1),
    ]);

    const brand = brandRow[0];
    const tenantName = (req.tenant!.name ?? '').trim();
    const brandConfigured =
      !!brand &&
      ((!!brand.logoUrl && brand.logoUrl.trim() !== '') ||
        (!!brand.displayName && brand.displayName.trim() !== '' && brand.displayName.trim() !== tenantName) ||
        brand.primaryColor !== SEED_BRAND_PRIMARY ||
        brand.accentColor !== SEED_BRAND_ACCENT ||
        (!!brand.tagline && brand.tagline.trim() !== '' && brand.tagline.trim() !== SEED_BRAND_TAGLINE));

    const ai = aiRow[0];
    const aiConfigured =
      !!ai && ai.systemPrompt.trim() !== '' && ai.systemPrompt.trim() !== DEFAULT_AI_SYSTEM_PROMPT.trim();

    return res.json({
      rates: rc.length > 0,
      accessorials: ac.length > 0,
      zones: lz.length > 0,
      brand: brandConfigured,
      ai: aiConfigured,
    });
  });

  // ── rate cards ────────────────────────────────────────────────
  app.get('/api/tenant/rate-cards', requireAuth, requireTenant, async (req, res) => {
    const rows = await db()
      .select()
      .from(rateCards)
      .where(eq(rateCards.tenantId, req.tenant!.id))
      .orderBy(rateCards.sortOrder);
    res.json({ rateCards: rows });
  });

  const RateCardPatch = z.object({
    service: z.string().optional(),
    equipment: z.string().optional(),
    label: z.string().optional(),
    ratePerMile: z.number().optional(),
    minimumCharge: z.number().optional(),
    flatFee: z.number().optional(),
    fuelSurchargePct: z.number().optional(),
    marginPct: z.number().optional(),
    maxWeightLbs: z.number().nullable().optional(),
    maxMiles: z.number().nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().optional(),
    notes: z.string().nullable().optional(),
  });

  app.put('/api/tenant/rate-cards/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    const parse = RateCardPatch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const existing = await db()
      .select()
      .from(rateCards)
      .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, req.tenant!.id)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: 'Rate card not found' });
    await db()
      .update(rateCards)
      .set({ ...parse.data, updatedAt: new Date() })
      .where(eq(rateCards.id, id));
    await db().insert(auditLog).values({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'rate_card.update',
      actorKind: 'user',
      detailsJson: { id, before: existing[0], patch: parse.data },
    });
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true });
  });

  app.post('/api/tenant/rate-cards', requireAuth, requireTenant, async (req, res) => {
    const RateCardCreate = RateCardPatch.required({
      service: true,
      equipment: true,
    });
    const parse = RateCardCreate.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const [row] = await db()
      .insert(rateCards)
      .values({
        tenantId: req.tenant!.id,
        service: parse.data.service!,
        equipment: parse.data.equipment!,
        label: parse.data.label,
        ratePerMile: parse.data.ratePerMile ?? 0,
        minimumCharge: parse.data.minimumCharge ?? 0,
        flatFee: parse.data.flatFee ?? 0,
        fuelSurchargePct: parse.data.fuelSurchargePct ?? 0,
        marginPct: parse.data.marginPct ?? 0,
        maxWeightLbs: parse.data.maxWeightLbs ?? null,
        maxMiles: parse.data.maxMiles ?? null,
        enabled: parse.data.enabled ?? true,
        sortOrder: parse.data.sortOrder ?? 0,
        notes: parse.data.notes ?? null,
      })
      .returning();
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true, rateCard: row });
  });

  app.delete('/api/tenant/rate-cards/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    await db()
      .delete(rateCards)
      .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, req.tenant!.id)));
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true });
  });

  // ── accessorials ──────────────────────────────────────────────
  app.get('/api/tenant/accessorials', requireAuth, requireTenant, async (req, res) => {
    const rows = await db()
      .select()
      .from(accessorials)
      .where(eq(accessorials.tenantId, req.tenant!.id))
      .orderBy(accessorials.sortOrder);
    res.json({ accessorials: rows });
  });

  const AccessorialPatch = z.object({
    code: z.string().optional(),
    label: z.string().optional(),
    description: z.string().nullable().optional(),
    kind: z.string().optional(),
    amount: z.number().optional(),
    trigger: z.string().optional(),
    appliesToServices: z.array(z.string()).nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().optional(),
  });

  app.put('/api/tenant/accessorials/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    const parse = AccessorialPatch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(accessorials)
      .set({ ...parse.data, updatedAt: new Date() })
      .where(and(eq(accessorials.id, id), eq(accessorials.tenantId, req.tenant!.id)));
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true });
  });

  app.post('/api/tenant/accessorials', requireAuth, requireTenant, async (req, res) => {
    const AccessorialCreate = AccessorialPatch.required({ code: true, label: true });
    const parse = AccessorialCreate.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const [row] = await db()
      .insert(accessorials)
      .values({
        tenantId: req.tenant!.id,
        code: parse.data.code!,
        label: parse.data.label!,
        description: parse.data.description ?? null,
        kind: parse.data.kind ?? 'flat',
        amount: parse.data.amount ?? 0,
        trigger: parse.data.trigger ?? 'optional',
        appliesToServices: parse.data.appliesToServices ?? undefined,
        enabled: parse.data.enabled ?? true,
        sortOrder: parse.data.sortOrder ?? 0,
      })
      .returning();
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true, accessorial: row });
  });

  app.delete('/api/tenant/accessorials/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    await db()
      .delete(accessorials)
      .where(and(eq(accessorials.id, id), eq(accessorials.tenantId, req.tenant!.id)));
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true });
  });

  // ── lane zones ────────────────────────────────────────────────
  app.get('/api/tenant/lane-zones', requireAuth, requireTenant, async (req, res) => {
    const rows = await db()
      .select()
      .from(laneZones)
      .where(eq(laneZones.tenantId, req.tenant!.id))
      .orderBy(laneZones.sortOrder);
    res.json({ laneZones: rows });
  });

  const LaneZonePatch = z.object({
    label: z.string().optional(),
    anchorPortCode: z.string().nullable().optional(),
    anchorCity: z.string().nullable().optional(),
    anchorState: z.string().nullable().optional(),
    radiusMiles: z.number().optional(),
    flatPrice: z.number().optional(),
    equipmentScope: z.array(z.string()).nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().optional(),
  });

  app.put('/api/tenant/lane-zones/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    const parse = LaneZonePatch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(laneZones)
      .set({ ...parse.data, updatedAt: new Date() })
      .where(and(eq(laneZones.id, id), eq(laneZones.tenantId, req.tenant!.id)));
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true });
  });

  app.post('/api/tenant/lane-zones', requireAuth, requireTenant, async (req, res) => {
    const LaneZoneCreate = LaneZonePatch.required({
      label: true,
      radiusMiles: true,
      flatPrice: true,
    });
    const parse = LaneZoneCreate.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const [row] = await db()
      .insert(laneZones)
      .values({
        tenantId: req.tenant!.id,
        label: parse.data.label!,
        anchorPortCode: parse.data.anchorPortCode ?? null,
        anchorCity: parse.data.anchorCity ?? null,
        anchorState: parse.data.anchorState ?? null,
        radiusMiles: parse.data.radiusMiles!,
        flatPrice: parse.data.flatPrice!,
        equipmentScope: parse.data.equipmentScope ?? undefined,
        enabled: parse.data.enabled ?? true,
        sortOrder: parse.data.sortOrder ?? 0,
      })
      .returning();
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true, laneZone: row });
  });

  app.delete('/api/tenant/lane-zones/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    await db()
      .delete(laneZones)
      .where(and(eq(laneZones.id, id), eq(laneZones.tenantId, req.tenant!.id)));
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true });
  });

  // ── leads ─────────────────────────────────────────────────────
  app.get('/api/tenant/leads', requireAuth, requireTenant, async (req, res) => {
    const status = (req.query.status as string | undefined) ?? undefined;
    // Push the status filter into the SQL query — earlier we filtered in
    // JS *after* a 200-row LIMIT, so a tenant with >200 leads could ask
    // for `?status=won` and get 0 hits even with wins beyond the window.
    const baseWhere = eq(leads.tenantId, req.tenant!.id);
    const where = status ? and(baseWhere, eq(leads.status, status)) : baseWhere;
    const rows = await db()
      .select()
      .from(leads)
      .where(where)
      .orderBy(desc(leads.createdAt))
      .limit(200);
    res.json({ leads: rows });
  });

  // CSV export of all leads — used by the dashboard's Export button. We
  // stream a flat CSV with the columns dispatchers actually want. Drops
  // the `breakdown_json` blob (use the lead-detail page for that).
  // Hard cap at 50K rows to keep memory bounded; if a tenant has more,
  // they can paginate by month with ?since=YYYY-MM-DD.
  app.get('/api/tenant/leads/export.csv', requireAuth, requireTenant, async (req, res) => {
    const MAX_EXPORT_ROWS = 50_000;
    const rows = await db()
      .select()
      .from(leads)
      .where(eq(leads.tenantId, req.tenant!.id))
      .orderBy(desc(leads.createdAt))
      .limit(MAX_EXPORT_ROWS);
    const cols = [
      'refId', 'createdAt', 'status',
      'customerName', 'customerEmail', 'customerPhone', 'customerCompany',
      'service', 'equipment',
      'pickupCity', 'pickupState', 'pickupZip', 'pickupCountry', 'pickupTerminalCode',
      'deliveryCity', 'deliveryState', 'deliveryZip', 'deliveryCountry', 'deliveryTerminalCode',
      'oceanCarrier', 'bookingNumber', 'billOfLadingNumber',
      'pickupDate', 'deliveryDate',
      'weightLbs', 'pieces', 'commodity',
      'distanceMiles', 'quotedTotal', 'quotedCurrency',
      'autoReplySent', 'sourceUrl', 'notes',
    ] as const;
    const esc = (v: unknown) => {
      if (v == null) return '';
      const s = v instanceof Date ? v.toISOString() : String(v);
      return /[,\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.join(',');
    const body = rows.map((r) => cols.map((c) => esc((r as Record<string, unknown>)[c])).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="quotefleet-leads-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(header + '\n' + body);
  });

  app.get('/api/tenant/leads/:refId', requireAuth, requireTenant, async (req, res) => {
    const refId = String(req.params.refId ?? '');
    const rows = await db()
      .select()
      .from(leads)
      .where(and(eq(leads.refId, refId), eq(leads.tenantId, req.tenant!.id)))
      .limit(1);
    if (!rows[0]) return res.status(404).json({ error: 'Lead not found' });
    const conv = await db()
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, req.tenant!.id),
          eq(conversations.leadId, rows[0].id),
          eq(conversations.channel, 'lead_chat')
        )
      )
      .orderBy(conversations.createdAt);
    res.json({ lead: rows[0], conversations: conv });
  });

  app.patch('/api/tenant/leads/:refId', requireAuth, requireTenant, async (req, res) => {
    const refId = String(req.params.refId ?? '');
    const Patch = z.object({
      status: z.enum(['draft', 'new', 'replied', 'won', 'lost', 'spam']).optional(),
      notes: z.string().optional(),
    });
    const parse = Patch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(leads)
      .set({ ...parse.data, updatedAt: new Date() })
      .where(and(eq(leads.refId, refId), eq(leads.tenantId, req.tenant!.id)));
    res.json({ ok: true });
  });

  // ── AI config ─────────────────────────────────────────────────
  app.get('/api/tenant/ai-config', requireAuth, requireTenant, async (req, res) => {
    const row = await db()
      .select()
      .from(aiConfigs)
      .where(eq(aiConfigs.tenantId, req.tenant!.id))
      .limit(1);
    res.json({ aiConfig: row[0] ?? null });
  });

  const AiPatch = z.object({
    systemPrompt: z.string().optional(),
    tone: z.string().optional(),
    autoReplyEnabled: z.boolean().optional(),
    chatEnabled: z.boolean().optional(),
    modelPreference: z.string().optional(),
  });

  app.put('/api/tenant/ai-config', requireAuth, requireTenant, async (req, res) => {
    const parse = AiPatch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(aiConfigs)
      .set({ ...parse.data, updatedAt: new Date() })
      .where(eq(aiConfigs.tenantId, req.tenant!.id));
    res.json({ ok: true });
  });

  // ── tenant Anthropic key ──────────────────────────────────────
  // Owner-only: a non-owner staff account must NOT be able to overwrite
  // a tenant's BYO key (would let them swap in their own & bill the
  // tenant, or wipe the key to force fallback to platform key).
  app.put(
    '/api/tenant/anthropic-key',
    requireAuth,
    requireOwner,
    requireTenant,
    requirePlan(...PRO_PLANS),
    async (req, res) => {
      const { apiKey } = req.body ?? {};
      if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-ant-')) {
        return res.status(400).json({ error: 'Provide a valid sk-ant-... key' });
      }
      await db()
        .update(tenants)
        .set({ anthropicKeyEncrypted: encrypt(apiKey), updatedAt: new Date() })
        .where(eq(tenants.id, req.tenant!.id));
      res.json({ ok: true });
    }
  );

  app.delete(
    '/api/tenant/anthropic-key',
    requireAuth,
    requireOwner,
    requireTenant,
    requirePlan(...PRO_PLANS),
    async (req, res) => {
      await db()
        .update(tenants)
        .set({ anthropicKeyEncrypted: null, updatedAt: new Date() })
        .where(eq(tenants.id, req.tenant!.id));
      res.json({ ok: true });
    }
  );

  // ── brand ─────────────────────────────────────────────────────
  // The GET also returns the theming OPTION lists (curated presets + fonts)
  // straight from widgetThemes.ts so the dashboard "Customize" panel renders
  // real swatches/labels without hard-coding palettes on the client — one
  // source of truth for the theme engine.
  const PRESET_IDS = Object.keys(WIDGET_PRESETS) as [string, ...string[]];
  const FONT_IDS = Object.keys(WIDGET_FONTS) as [string, ...string[]];
  // Max encoded logo length. Logos are stored as data-URLs in logoUrl (there
  // is no blob store); the client downscales + caps at ~150KB, so 220K chars
  // is comfortable headroom while still rejecting an un-shrunk upload.
  const MAX_LOGO_CHARS = 220_000;

  app.get('/api/tenant/brand', requireAuth, requireTenant, async (req, res) => {
    const row = await db()
      .select()
      .from(brandConfigs)
      .where(eq(brandConfigs.tenantId, req.tenant!.id))
      .limit(1);
    const presets = WIDGET_PRESET_LIST.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      mode: p.mode,
      bg: p.palette.pageBg,
      surface: p.palette.surface,
      accent: p.palette.accent,
    }));
    const fonts = Object.values(WIDGET_FONTS).map((f) => ({ id: f.id, label: f.label }));
    res.json({ brand: row[0] ?? null, presets, fonts });
  });

  const BrandPatch = z.object({
    displayName: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    logoUrl: z.string().max(MAX_LOGO_CHARS).nullable().optional(),
    ctaText: z.string().optional(),
    footerNote: z.string().nullable().optional(),
    showPoweredBy: z.boolean().optional(),
    allowedDomains: z.string().nullable().optional(),
    requireEmail: z.boolean().optional(),
    requirePhone: z.boolean().optional(),
    showQuoteBeforeContact: z.boolean().optional(),
    // Wave 2 theming fields (validated against the theme engine's allowed
    // lists). accentOverride is a #RRGGBB hex or null (null = use the preset
    // accent). See src/server/widgetThemes.ts.
    themePreset: z.enum(PRESET_IDS).optional(),
    fontFamily: z.enum(FONT_IDS).optional(),
    accentOverride: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'accentOverride must be a #RRGGBB hex')
      .nullable()
      .optional(),
  });

  app.put('/api/tenant/brand', requireAuth, requireTenant, async (req, res) => {
    const parse = BrandPatch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    // Plan-gate the logoUrl field. Colors / tagline / display name stay
    // available to everyone. Branded quotes (custom logo) are a Vital+
    // perk — trial tenants qualify via effectivePlan → 'pro'.
    const patch = parse.data;
    const hasCore =
      req.user?.role === 'super_admin' ||
      (CORE_PLANS as readonly string[]).includes(effectivePlan(req.tenant!));
    const settingLogo = Object.prototype.hasOwnProperty.call(patch, 'logoUrl') && patch.logoUrl != null && patch.logoUrl !== '';
    if (settingLogo && !hasCore) {
      return res.status(403).json({
        error: 'plan_upgrade_required',
        required: [...CORE_PLANS],
        current: effectivePlan(req.tenant!),
        field: 'logoUrl',
      });
    }
    // Removing the "Powered by QuoteFleet" badge is a Vital+ perk (same
    // branded-widget tier as the custom logo). Free tenants may turn it
    // back ON but not OFF. Trial tenants resolve to 'pro' and pass.
    const removingBadge =
      Object.prototype.hasOwnProperty.call(patch, 'showPoweredBy') && patch.showPoweredBy === false;
    if (removingBadge && !hasCore) {
      return res.status(403).json({
        error: 'plan_upgrade_required',
        required: [...CORE_PLANS],
        current: effectivePlan(req.tenant!),
        field: 'showPoweredBy',
      });
    }
    await db()
      .update(brandConfigs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(brandConfigs.tenantId, req.tenant!.id));
    res.json({ ok: true });
  });

  // ── callback inbox ─────────────────────────────────────────────
  // Default list returns the open + in_progress queue with a small cap;
  // ?status= and ?limit= let the dashboard show other states. Newest first.
  app.get('/api/tenant/callbacks', requireAuth, requireTenant, async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
    const where = status
      ? and(eq(callbackRequests.tenantId, req.tenant!.id), eq(callbackRequests.status, status))
      : eq(callbackRequests.tenantId, req.tenant!.id);
    const rows = await db()
      .select()
      .from(callbackRequests)
      .where(where)
      .orderBy(desc(callbackRequests.createdAt))
      .limit(limit);
    res.json({ callbacks: rows });
  });

  const CallbackPatch = z.object({
    status: z.enum(['open', 'in_progress', 'completed', 'no_answer', 'cancelled']).optional(),
    notes: z.string().max(4000).nullable().optional(),
    assignedToUserId: z.number().int().nullable().optional(),
  });

  app.patch('/api/tenant/callbacks/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const parse = CallbackPatch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });

    // Confirm the row belongs to this tenant before updating.
    const existing = await db()
      .select()
      .from(callbackRequests)
      .where(and(eq(callbackRequests.id, id), eq(callbackRequests.tenantId, req.tenant!.id)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: 'Callback not found' });

    const patch: Record<string, unknown> = { ...parse.data, updatedAt: new Date() };
    // Stamp completedAt when the row transitions to a terminal status.
    if (
      parse.data.status &&
      ['completed', 'no_answer', 'cancelled'].includes(parse.data.status) &&
      !existing[0].completedAt
    ) {
      patch.completedAt = new Date();
    }
    await db()
      .update(callbackRequests)
      .set(patch)
      .where(eq(callbackRequests.id, id));
    res.json({ ok: true });
  });

  // ── custom domain (Pro tier — `quote.acme.com` → tenant) ────────
  // Two-step claim: (1) operator submits the domain; we return a TXT
  // value they paste into their DNS. (2) operator hits "verify"; we
  // resolve the TXT record server-side, and on match we set
  // tenants.custom_domain. From then on hostInfoMiddleware routes the
  // request to this tenant.
  app.get('/api/tenant/custom-domain', requireAuth, requireTenant, (req, res) => {
    res.json({
      customDomain: req.tenant!.customDomain,
      verificationToken: customDomainToken(req.tenant!.id),
      verificationHost: req.tenant!.customDomain
        ? `_qf-verify.${req.tenant!.customDomain}`
        : null,
    });
  });

  app.post('/api/tenant/custom-domain', requireAuth, requireOwner, requireTenant, requirePlan(...PRO_PLANS), async (req, res) => {
    const Schema = z.object({
      domain: z.string().min(3).max(120).regex(
        /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})+$/,
        'Enter a domain like quote.yourcompany.com (no scheme, no path).'
      ),
    });
    const parse = Schema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid domain' });
    const domain = parse.data.domain.toLowerCase().replace(/^(https?:\/\/)?/, '').replace(/\/.*$/, '');

    // Reject if any other tenant has claimed it.
    const owner = await db()
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.customDomain, domain))
      .limit(1);
    if (owner[0] && owner[0].id !== req.tenant!.id) {
      return res.status(409).json({ error: 'That domain is already claimed by another tenant.' });
    }

    // Save the request — verification flips it from claimed to live.
    // Explicitly null the verifiedAt so a re-claim after a previous
    // success requires the operator to re-prove ownership.
    await db()
      .update(tenants)
      .set({ customDomain: domain, customDomainVerifiedAt: null, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    res.json({
      ok: true,
      domain,
      verificationToken: customDomainToken(req.tenant!.id),
      instructions: {
        recordType: 'TXT',
        host: `_qf-verify.${domain}`,
        value: customDomainToken(req.tenant!.id),
        cnameRecord: { host: domain, value: 'quote-fleet.replit.app', proxied: true },
      },
    });
  });

  app.post('/api/tenant/custom-domain/verify', requireAuth, requireOwner, requireTenant, requirePlan(...PRO_PLANS), async (req, res) => {
    const t = req.tenant!;
    if (!t.customDomain) return res.status(400).json({ error: 'No domain to verify.' });
    const expected = customDomainToken(t.id);
    try {
      const resolver = await import('node:dns/promises');
      const records = await resolver.resolveTxt(`_qf-verify.${t.customDomain}`).catch(() => []);
      const flat = records.map((r) => r.join('').trim());
      if (!flat.includes(expected)) {
        return res.status(400).json({
          error: 'TXT record not found yet. DNS can take 5–30 min after you add the record.',
          expected,
          found: flat,
        });
      }
    } catch (err) {
      return res.status(500).json({ error: 'DNS lookup failed: ' + (err as Error).message });
    }
    // Flip the verifiedAt timestamp — until this is non-null, the
    // hostInfo middleware refuses to route requests for this domain.
    await db()
      .update(tenants)
      .set({ customDomainVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(tenants.id, t.id));
    res.json({ ok: true, customDomain: t.customDomain, verifiedAt: new Date() });
  });

  app.delete('/api/tenant/custom-domain', requireAuth, requireOwner, requireTenant, async (req, res) => {
    await db()
      .update(tenants)
      .set({ customDomain: null, customDomainVerifiedAt: null, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    res.json({ ok: true });
  });

  // ── marketplace opt-in (tenant settings) ──────────────────────
  // Toggling this flips the carrier's PUBLIC visibility in the
  // marketplace browser. Aggregated benchmarks include everyone
  // regardless (they're anonymized).
  app.get('/api/tenant/marketplace-settings', requireAuth, requireTenant, async (req, res) => {
    res.json({
      marketplaceOptIn: req.tenant!.marketplaceOptIn,
      mcNumber: req.tenant!.mcNumber,
      dotNumber: req.tenant!.dotNumber,
    });
  });

  app.put('/api/tenant/marketplace-settings', requireAuth, requireTenant, async (req, res) => {
    const Patch = z.object({
      marketplaceOptIn: z.boolean().optional(),
      mcNumber: z.string().max(20).nullable().optional(),
      dotNumber: z.string().max(20).nullable().optional(),
    });
    const parse = Patch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(tenants)
      .set({ ...parse.data, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true });
  });

  // ── embed snippet ─────────────────────────────────────────────
  app.get('/api/tenant/embed', requireAuth, requireTenant, async (req, res) => {
    const env = loadEnv();
    const fallbackBase = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const t = req.tenant!;
    // Prefer the tenant's chosen subdomain (slug.hostDomain). That's what
    // they picked at signup, what their customers see, what their cert
    // covers. Fall back to PUBLIC_BASE_URL only for legacy/unset hostDomain.
    const base = t.hostDomain && t.slug
      ? `https://${t.slug}.${t.hostDomain}`
      : fallbackBase;
    const snippet = `<script src="${base}/embed.js?t=${t.embedToken}" defer></script>`;
    const iframeFallback = `<iframe src="${base}/?embed=1" style="width:100%;max-width:560px;border:0;min-height:660px;" loading="lazy" title="Get a freight quote"></iframe>`;
    const directLink = `${base}/`;
    res.json({ snippet, iframeFallback, directLink, embedToken: t.embedToken, slug: t.slug, hostDomain: t.hostDomain });
  });

  app.post('/api/tenant/regenerate-embed', requireAuth, requireTenant, async (req, res) => {
    const newToken = nanoid(24);
    await db()
      .update(tenants)
      .set({ embedToken: newToken, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    res.json({ ok: true, embedToken: newToken });
  });

  // ── audit ─────────────────────────────────────────────────────
  app.get('/api/tenant/audit', requireAuth, requireTenant, async (req, res) => {
    const rows = await db()
      .select()
      .from(auditLog)
      .where(eq(auditLog.tenantId, req.tenant!.id))
      .orderBy(desc(auditLog.createdAt))
      .limit(100);
    res.json({ audit: rows });
  });
}
