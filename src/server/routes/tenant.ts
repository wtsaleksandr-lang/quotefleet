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
} from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { encrypt } from '../../auth/secrets.js';
import { loadEnv } from '../../config.js';
import { syncTenantToMarketplace } from '../../marketplace/sync.js';

/** Fire-and-forget marketplace sync. Logs but never throws. */
function bumpMarketplace(tenantId: number) {
  void syncTenantToMarketplace(tenantId);
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
    const rows = await db()
      .select()
      .from(leads)
      .where(eq(leads.tenantId, req.tenant!.id))
      .orderBy(desc(leads.createdAt))
      .limit(200);
    const filtered = status ? rows.filter((l) => l.status === status) : rows;
    res.json({ leads: filtered });
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
  app.put('/api/tenant/anthropic-key', requireAuth, requireTenant, async (req, res) => {
    const { apiKey } = req.body ?? {};
    if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Provide a valid sk-ant-... key' });
    }
    await db()
      .update(tenants)
      .set({ anthropicKeyEncrypted: encrypt(apiKey), updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    res.json({ ok: true });
  });

  app.delete('/api/tenant/anthropic-key', requireAuth, requireTenant, async (req, res) => {
    await db()
      .update(tenants)
      .set({ anthropicKeyEncrypted: null, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    res.json({ ok: true });
  });

  // ── brand ─────────────────────────────────────────────────────
  app.get('/api/tenant/brand', requireAuth, requireTenant, async (req, res) => {
    const row = await db()
      .select()
      .from(brandConfigs)
      .where(eq(brandConfigs.tenantId, req.tenant!.id))
      .limit(1);
    res.json({ brand: row[0] ?? null });
  });

  const BrandPatch = z.object({
    displayName: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    logoUrl: z.string().nullable().optional(),
    ctaText: z.string().optional(),
    footerNote: z.string().nullable().optional(),
    showPoweredBy: z.boolean().optional(),
    allowedDomains: z.string().nullable().optional(),
  });

  app.put('/api/tenant/brand', requireAuth, requireTenant, async (req, res) => {
    const parse = BrandPatch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(brandConfigs)
      .set({ ...parse.data, updatedAt: new Date() })
      .where(eq(brandConfigs.tenantId, req.tenant!.id));
    res.json({ ok: true });
  });

  // ── embed snippet ─────────────────────────────────────────────
  app.get('/api/tenant/embed', requireAuth, requireTenant, async (req, res) => {
    const env = loadEnv();
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const t = req.tenant!;
    const snippet = `<script src="${base}/embed.js?t=${t.embedToken}" defer></script>`;
    const iframeFallback = `<iframe src="${base}/w/${t.slug}?embed=1" style="width:100%;max-width:560px;border:0;min-height:660px;" loading="lazy" title="Get a freight quote"></iframe>`;
    const directLink = `${base}/w/${t.slug}`;
    res.json({ snippet, iframeFallback, directLink, embedToken: t.embedToken, slug: t.slug });
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
