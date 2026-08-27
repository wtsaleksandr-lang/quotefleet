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
import { eq, desc, and, gte, or, ilike, count } from 'drizzle-orm';
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
  accessLinks,
} from '../../db/schema.js';
import { requireAuth, requireTenant, requireOwner, requirePlan } from '../middleware.js';
import { findConflictingEnabledCard } from '../../calc/engine.js';

/** Plan tiers for feature gating, expressed as EFFECTIVE plans (see
 *  src/server/plans.ts). Trial tenants resolve to 'pro' and pass every
 *  gate; that is intentional (all-inclusive trial). */
const CORE_PLANS = ['vital', 'pro'] as const; // branded quotes, core features
const PRO_PLANS = ['pro'] as const; // AI, PDF, automation, custom domain, analytics
import { encrypt } from '../../auth/secrets.js';
import { effectivePlan } from '../plans.js';
import {
  WIDGET_PRESETS,
  WIDGET_FONTS,
  WIDGET_PRESET_LIST,
  PRESET_MAP_STYLE,
  CTA_HOVER_STYLES,
  FONT_COLOR_SWATCHES,
  MAP_BLEND_VALUES,
} from '../widgetThemes.js';
import { HOSTED_BG_PRESETS } from '../hostedPage.js';
import { MAP_STYLE_KEYS, MAP_STYLE_LIST } from '../routeMap.js';
import { loadEnv } from '../../config.js';
import { resolveFeatures, sanitizeFeaturesPatch, sanitizeBookingPatch, sanitizeFollowUpPatch, resolveFollowUpConfig } from '../features.js';
import {
  renderFollowUpTouch,
  samplePreviewLead,
  FOLLOWUP_TOUCH_ORDER,
  type FollowUpTouch,
} from '../../email/followUp.js';
import { leadUnsubscribeUrl } from '../../email/unsubscribe.js';
import { makePreviewGrant, PREVIEW_GRANT_PARAM, PREVIEW_GRANT_TTL_MS } from '../access.js';
import { syncTenantToMarketplace } from '../../marketplace/sync.js';
import { logAndSwallow } from '../backgroundSafety.js';
import { carrierLookup } from '../directory/queries.js';
import { publicAutocompleteLimiter } from '../rateLimits.js';
import { DEFAULT_AI_SYSTEM_PROMPT, AUTO_FSC_DEFAULTS } from '../../calc/defaults.js';
import {
  FREIGHT_VERTICALS,
  PRICING_MODES,
  getSeedTemplate,
  mergeSeedTemplates,
  isSeedPristine,
  type FreightVertical,
} from '../../calc/seedTemplates.js';
import { getDieselPrice, asOfLabel } from '../../eia/dieselPrice.js';
import { autoFscPerMile } from '../../calc/fuelSurcharge.js';
import { summarizeKpis, isKpiPeriod, PERIOD_DAYS, type KpiPeriod } from '../overviewStats.js';
import { createHmac } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

// ── pricing input guards (audit RATE-C1 / H4) ──────────────────────────────
// Money / rate / percent / radius fields flow straight into customer quote
// totals via src/calc/engine.ts (miles × ratePerMile + flatFee, fuel %, margin
// %, zone flatPrice, accessorial amount). A bare `z.number()` accepts negative,
// non-finite (Infinity), and NaN values (typeof NaN === 'number', so zod's
// number type passes it) — any of which corrupts the total. These bounded,
// finite-checked validators reject bad input with a 400 instead of persisting
// it. `.finite()` rejects both NaN and ±Infinity.
const MAX_MONEY = 1_000_000; // flat fee, minimum charge, zone flat price, accessorial flat amount
const MAX_PER_MILE = 100_000; // $/mile linehaul rate, per-cwt rate
const MAX_MILES = 100_000; // radius / max miles bound
const MAX_WEIGHT = 100_000_000; // lbs upper bound (sane freight ceiling)
const MAX_FACTOR = 100_000; // dimensionless LTL rate factors

/** Non-negative finite dollar amount (flat fee, minimum charge, flat price). */
const zMoney = z.number().finite().min(0).max(MAX_MONEY);
/** Non-negative finite per-mile / per-cwt rate. */
const zRate = z.number().finite().min(0).max(MAX_PER_MILE);
/** Percentage 0–100, finite (fuel surcharge %, margin %, pct-of-base). */
const zPercent = z.number().finite().min(0).max(100);
/** Non-negative finite mileage / radius. */
const zMiles = z.number().finite().min(0).max(MAX_MILES);
/** Non-negative finite weight in lbs. */
const zWeight = z.number().finite().min(0).max(MAX_WEIGHT);
/** Non-negative finite dimensionless factor (LTL weight-break / distance). */
const zFactor = z.number().finite().min(0).max(MAX_FACTOR);

/** Shared 400 for a failed pricing-schema parse — surfaces the field-level
 *  zod messages so a client knows WHICH value was out of range, rather than a
 *  bare "Invalid input". */
function invalidInput(res: Response, err: z.ZodError) {
  return res.status(400).json({ error: 'Invalid input', details: err.flatten().fieldErrors });
}

/** The lead statuses the leads-list UI can filter by (mirrors the PATCH enum
 *  + app.js LEAD_STATUSES). Anything outside this set is treated as "no
 *  filter" rather than an error, so a stale/garbage `?status=` can't 400 the
 *  whole queue. */
export const LEAD_LIST_STATUSES = [
  'draft', 'new', 'replied', 'booking_requested', 'won', 'lost', 'spam',
] as const;

const LEADS_PAGE_SIZE_DEFAULT = 25;
const LEADS_PAGE_SIZE_MAX = 100;
const LEADS_SEARCH_MAX = 120;

function toInt(v: unknown, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Pure parse/clamp of the leads-list query string. Extracted so the
 *  pagination + filter contract is unit-testable without a live DB:
 *  - pageSize defaults to 25, floors at 1, caps at 100 (bounds the page query)
 *  - page floors at 1; offset = (page-1)*pageSize
 *  - status is whitelisted against LEAD_LIST_STATUSES (else undefined)
 *  - search is trimmed + length-capped
 *  Tenant scoping is applied in the handler, never here. */
export function parseLeadsQuery(query: Record<string, unknown>): {
  page: number; pageSize: number; offset: number; status?: string; search: string;
} {
  const rawStatus = typeof query.status === 'string' ? query.status : '';
  const status = (LEAD_LIST_STATUSES as readonly string[]).includes(rawStatus)
    ? rawStatus
    : undefined;
  const search = typeof query.search === 'string'
    ? query.search.trim().slice(0, LEADS_SEARCH_MAX)
    : '';
  const pageSize = Math.min(Math.max(toInt(query.pageSize, LEADS_PAGE_SIZE_DEFAULT), 1), LEADS_PAGE_SIZE_MAX);
  const page = Math.max(toInt(query.page, 1), 1);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset, status, search };
}

/** Seed defaults stamped at signup (see routes/auth.ts + calc/defaults.ts).
 *  Used to tell a genuinely-customized brand/AI config apart from the
 *  out-of-the-box seed so the guided-setup meter only credits real work. */
const SEED_BRAND_PRIMARY = '#2563eb';
const SEED_BRAND_ACCENT = '#6E8BFF';
const SEED_BRAND_TAGLINE = 'Instant freight quotes';

/** Fire-and-forget marketplace sync. Logs but never throws. */
function bumpMarketplace(tenantId: number) {
  void syncTenantToMarketplace(tenantId).catch(logAndSwallow('tenant syncTenantToMarketplace'));
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
    // This endpoint is polled on boot + on every Leads/Callbacks nav, so it must
    // stay bounded. The client only reads stats.newLeads + stats.pendingCallbacks
    // (the KPI cards come from the separate indexed /overview-kpis endpoint), so
    // count with SQL instead of loading the whole leads table into memory.
    const [recent, newLeadRows, audit, openCallbacks] = await Promise.all([
      db().select().from(leads).where(eq(leads.tenantId, tid)).orderBy(desc(leads.createdAt)).limit(20),
      db().select({ n: count() }).from(leads).where(and(eq(leads.tenantId, tid), eq(leads.status, 'new'))),
      db().select().from(auditLog).where(eq(auditLog.tenantId, tid)).orderBy(desc(auditLog.createdAt)).limit(10),
      db()
        .select({ id: callbackRequests.id })
        .from(callbackRequests)
        .where(and(eq(callbackRequests.tenantId, tid), eq(callbackRequests.status, 'open'))),
    ]);
    const stats = {
      newLeads: Number(newLeadRows[0]?.n ?? 0),
      // Unactioned callback requests — feeds the sidebar Callbacks badge.
      pendingCallbacks: openCallbacks.length,
    };
    return res.json({ tenant: req.tenant, stats, recentLeads: recent, audit });
  });

  // ── KPI overview (period-scoped big-number metrics) ────────────
  // Powers the dashboard's "Performance" board: quotes / conversions / quoted
  // value / avg-quote tiles with period-over-period deltas, a quotes-over-time
  // series, top lanes, and equipment mix. One indexed read over the tenant's
  // leads across BOTH the current and the prior equal-length window (via
  // leads_tenant_created_idx); all bucketing happens in the pure summarizeKpis()
  // so the conversion definition stays shared with the weekly digest.
  app.get('/api/tenant/overview/kpis', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const tid = req.tenant!.id;
    const period: KpiPeriod = isKpiPeriod(req.query.period) ? req.query.period : '30d';
    const now = new Date();
    const since = new Date(now.getTime() - 2 * PERIOD_DAYS[period] * DAY_MS);
    // Engagement is only rolled up over the CURRENT window, so the audit read
    // only needs events since the current window start (indexed by tenant_id +
    // created_at, filtered to the quote.activity action).
    const windowStart = new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
    const [rows, activityRows] = await Promise.all([
      db()
        .select({
          createdAt: leads.createdAt,
          status: leads.status,
          quotedTotal: leads.quotedTotal,
          equipment: leads.equipment,
          pickupCity: leads.pickupCity,
          deliveryCity: leads.deliveryCity,
        })
        .from(leads)
        .where(and(eq(leads.tenantId, tid), gte(leads.createdAt, since)))
        .orderBy(desc(leads.createdAt)),
      db()
        .select({ createdAt: auditLog.createdAt, detailsJson: auditLog.detailsJson })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tenantId, tid),
            eq(auditLog.action, 'quote.activity'),
            gte(auditLog.createdAt, windowStart),
          ),
        ),
    ]);
    return res.json(summarizeKpis({ now, period, leadRows: rows, activityRows }));
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
    // Any genuine customization credits the "Brand" step. This now also counts
    // the Customize panel's THEMING columns (theme preset, accent override, font,
    // map style, CTA hover, text color, map blend) — previously the meter only
    // looked at logo/name/colors/tagline, so a tenant who fully themed their
    // widget but left those four never got credit and the step stayed incomplete.
    const themeCustomized =
      !!brand &&
      ((brand.themePreset ?? 'midnight') !== 'midnight' ||
        (!!brand.accentOverride && brand.accentOverride.trim() !== '') ||
        (brand.fontFamily ?? 'satoshi') !== 'satoshi' ||
        (!!brand.mapStyle && brand.mapStyle.trim() !== '') ||
        (brand.ctaHover ?? 'border') !== 'border' ||
        (brand.fontColor ?? 'auto') !== 'auto' ||
        (brand.mapBlend ?? 'off') !== 'off' ||
        (brand.mapBlendOpacity ?? 0) > 0);
    const brandConfigured =
      !!brand &&
      ((!!brand.logoUrl && brand.logoUrl.trim() !== '') ||
        (!!brand.displayName && brand.displayName.trim() !== '' && brand.displayName.trim() !== tenantName) ||
        brand.primaryColor !== SEED_BRAND_PRIMARY ||
        brand.accentColor !== SEED_BRAND_ACCENT ||
        (!!brand.tagline && brand.tagline.trim() !== '' && brand.tagline.trim() !== SEED_BRAND_TAGLINE) ||
        themeCustomized);

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

  const LtlConfigSchema = z.object({
    baseRatePerCwt: zRate,
    classRates: z.record(z.string(), zRate),
    weightBreaks: z.array(z.object({ minLbs: zWeight, rateFactor: zFactor })),
    distanceFactorPer1000Mi: zFactor,
  });

  const RateCardPatch = z.object({
    service: z.string().optional(),
    equipment: z.string().optional(),
    label: z.string().optional(),
    ratePerMile: zRate.optional(),
    minimumCharge: zMoney.optional(),
    flatFee: zMoney.optional(),
    fuelSurchargePct: zPercent.optional(),
    marginPct: zPercent.optional(),
    maxWeightLbs: zWeight.nullable().optional(),
    maxMiles: zMiles.nullable().optional(),
    ltlConfig: LtlConfigSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().finite().min(0).optional(),
    notes: z.string().nullable().optional(),
  });

  app.put('/api/tenant/rate-cards/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    const parse = RateCardPatch.safeParse(req.body);
    if (!parse.success) return invalidInput(res, parse.error);
    const existing = await db()
      .select()
      .from(rateCards)
      .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, req.tenant!.id)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: 'Rate card not found' });
    // Duplicate guard: the state this card WOULD have after the patch must not
    // collide with a different enabled card for the same (service, equipment).
    const next = {
      id,
      service: parse.data.service ?? existing[0].service,
      equipment: parse.data.equipment ?? existing[0].equipment,
      enabled: parse.data.enabled ?? existing[0].enabled,
    };
    if (next.enabled) {
      const peers = await db()
        .select()
        .from(rateCards)
        .where(
          and(
            eq(rateCards.tenantId, req.tenant!.id),
            eq(rateCards.service, next.service),
            eq(rateCards.equipment, next.equipment),
            eq(rateCards.enabled, true),
          ),
        );
      if (findConflictingEnabledCard(peers, next)) {
        return res.status(409).json({
          error: `You already have an enabled rate card for ${next.service}/${next.equipment} — disable or edit the existing one first.`,
        });
      }
    }
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
    if (!parse.success) return invalidInput(res, parse.error);
    // Duplicate guard: reject creating an enabled card when a different enabled
    // card already exists for the same (service, equipment). Disabled cards may
    // duplicate freely.
    const willEnable = parse.data.enabled ?? true;
    if (willEnable) {
      const peers = await db()
        .select()
        .from(rateCards)
        .where(
          and(
            eq(rateCards.tenantId, req.tenant!.id),
            eq(rateCards.service, parse.data.service!),
            eq(rateCards.equipment, parse.data.equipment!),
            eq(rateCards.enabled, true),
          ),
        );
      if (
        findConflictingEnabledCard(peers, {
          service: parse.data.service!,
          equipment: parse.data.equipment!,
          enabled: true,
        })
      ) {
        return res.status(409).json({
          error: `You already have an enabled rate card for ${parse.data.service}/${parse.data.equipment} — disable or edit the existing one first.`,
        });
      }
    }
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
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid rate card id.' });
    const deleted = await db()
      .delete(rateCards)
      .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, req.tenant!.id)))
      .returning({ id: rateCards.id });
    if (!deleted.length) return res.status(404).json({ error: 'Rate card not found.' });
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

  const AccessorialBase = z.object({
    code: z.string().optional(),
    label: z.string().optional(),
    description: z.string().nullable().optional(),
    kind: z.string().optional(),
    // `amount` is a flat dollar figure for most kinds, but a PERCENTAGE when
    // kind === 'pct_of_base'. Bound non-negative + finite here (blocks
    // negative / NaN / Infinity / absurd), then clamp the percent case to
    // ≤ 100 in the refine below (audit RATE-C1 / H4).
    amount: zMoney.optional(),
    trigger: z.string().optional(),
    conditionJson: z.record(z.string(), z.unknown()).nullable().optional(),
    appliesToServices: z.array(z.string()).nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().finite().min(0).optional(),
  });
  // A percentage-kind accessorial's `amount` is a percent → clamp to ≤ 100.
  const pctOfBaseRefine = (val: { kind?: string; amount?: number }, ctx: z.RefinementCtx) => {
    if (val.kind === 'pct_of_base' && val.amount != null && val.amount > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'Percentage-of-base accessorial amount must be between 0 and 100',
      });
    }
  };
  const AccessorialPatch = AccessorialBase.superRefine(pctOfBaseRefine);

  app.put('/api/tenant/accessorials/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    const parse = AccessorialPatch.safeParse(req.body);
    if (!parse.success) return invalidInput(res, parse.error);
    const patch: Record<string, unknown> = { ...parse.data };
    // Guard the kind→pct_of_base transition: switching to a percent kind WITHOUT
    // a new amount leaves the STORED amount (a flat dollar figure, often >100) to
    // be read as a percent → e.g. a $500 flat fee silently becomes 500%-of-base
    // on every quote (the refine only clamps an amount present in the SAME patch).
    if (patch.kind === 'pct_of_base' && patch.amount == null) {
      const existing = await db()
        .select({ amount: accessorials.amount })
        .from(accessorials)
        .where(and(eq(accessorials.id, id), eq(accessorials.tenantId, req.tenant!.id)))
        .limit(1);
      const cur = existing[0]?.amount;
      if (typeof cur === 'number' && cur > 100) patch.amount = 100;
    }
    await db()
      .update(accessorials)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(accessorials.id, id), eq(accessorials.tenantId, req.tenant!.id)));
    bumpMarketplace(req.tenant!.id);
    res.json({ ok: true });
  });

  app.post('/api/tenant/accessorials', requireAuth, requireTenant, async (req, res) => {
    const AccessorialCreate = AccessorialBase.required({ code: true, label: true }).superRefine(
      pctOfBaseRefine,
    );
    const parse = AccessorialCreate.safeParse(req.body);
    if (!parse.success) return invalidInput(res, parse.error);
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
        conditionJson: parse.data.conditionJson ?? undefined,
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
    radiusMiles: zMiles.optional(),
    flatPrice: zMoney.optional(),
    equipmentScope: z.array(z.string()).nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().finite().min(0).optional(),
  });

  app.put('/api/tenant/lane-zones/:id', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    const parse = LaneZonePatch.safeParse(req.body);
    if (!parse.success) return invalidInput(res, parse.error);
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
    if (!parse.success) return invalidInput(res, parse.error);
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
    // Server-side pagination + search + status filter. Earlier this hard-capped
    // at LIMIT 200 with no offset, so a tenant with >200 leads could never see
    // (or search/filter) older rows — the client scanned only the loaded 200.
    // Now every filter runs in SQL, tenant-scoped, over the whole table.
    const { page, pageSize, offset, status, search } = parseLeadsQuery(req.query);

    const filters = [eq(leads.tenantId, req.tenant!.id)];
    if (status) filters.push(eq(leads.status, status));
    if (search) {
      // Escape LIKE wildcards so a literal % / _ in the term isn't a wildcard
      // (Postgres treats backslash as the default LIKE escape char).
      const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const match = or(
        ilike(leads.refId, like),
        ilike(leads.customerName, like),
        ilike(leads.customerEmail, like),
        ilike(leads.customerCompany, like),
        ilike(leads.pickupCity, like),
        ilike(leads.deliveryCity, like),
      );
      if (match) filters.push(match);
    }
    const where = and(...filters);

    // total = full filtered count (drives accurate "N leads" + page count).
    const [{ total }] = await db()
      .select({ total: count() })
      .from(leads)
      .where(where);

    // Stable order: newest first, id as tiebreak so paging never repeats/skips
    // rows sharing a createdAt second.
    const rows = await db()
      .select()
      .from(leads)
      .where(where)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(pageSize)
      .offset(offset);

    res.json({ leads: rows, total: Number(total ?? 0), page, pageSize });
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
      status: z.enum(['draft', 'new', 'replied', 'booking_requested', 'won', 'lost', 'spam']).optional(),
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
      mapStyle: PRESET_MAP_STYLE[p.id] || 'branded',
    }));
    const fonts = Object.values(WIDGET_FONTS).map((f) => ({ id: f.id, label: f.label }));
    // Option universes for the Customize panel's "Button hover" + "Text color"
    // controls. The panel filters fontColors to the WCAG-safe subset for the
    // currently-selected background client-side (mirrors safeFontColors).
    const ctaHovers = CTA_HOVER_STYLES.map((id) => ({ id }));
    // Map-style options (key + label + hint) for the Customize "Map style" picker.
    const mapStyles = MAP_STYLE_LIST.map((m) => ({ key: m.key, label: m.label, hint: m.hint }));
    // Surface the carrier's USDOT / MC (from tenants, already collected) so the
    // Customize → Page tab can show which credibility badges the trust-badge
    // toggle will display. Read-only convenience; the numbers are edited under
    // Company / Marketplace settings.
    res.json({
      brand: row[0] ?? null,
      presets, fonts, ctaHovers,
      fontColors: FONT_COLOR_SWATCHES,
      mapStyles,
      hostedBgPresets: HOSTED_BG_PRESETS.map((p) => ({ id: p.id, label: p.label })),
      dotNumber: req.tenant!.dotNumber,
      mcNumber: req.tenant!.mcNumber,
    });
  });

  // Follow-up email PREVIEW — renders a chosen touch (nudge | reminder |
  // discount) with this tenant's CURRENT follow-up settings + custom copy,
  // contact block and signature, using the SAME render the cron sends
  // (renderFollowUpTouch), so what the owner previews is exactly what ships. A
  // representative sample lead supplies realistic lane/total content. Returns
  // { subject, html }; the portal shows the html in a sandboxed iframe.
  app.get('/api/tenant/follow-up/preview', requireAuth, requireTenant, async (req, res) => {
    const raw = String(req.query.touch ?? 'nudge').toLowerCase();
    const touch = (FOLLOWUP_TOUCH_ORDER as readonly string[]).includes(raw)
      ? (raw as FollowUpTouch)
      : 'nudge';
    const brandRow = await db()
      .select()
      .from(brandConfigs)
      .where(eq(brandConfigs.tenantId, req.tenant!.id))
      .limit(1);
    const brand = brandRow[0] ?? null;
    const cfg = resolveFollowUpConfig(brand);
    // The discount touch's template refuses to render without a positive
    // percent (there's nothing to offer at 0%). Surface that as a clear,
    // previewable message rather than a 500.
    if (touch === 'discount' && cfg.discountPct <= 0) {
      res.json({
        touch,
        subject: null,
        html: null,
        note: 'The discount email only sends when the discount is above 0%. Raise it in the cadence settings to preview this touch.',
      });
      return;
    }
    const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
    const lead = samplePreviewLead();
    const { subject, html } = renderFollowUpTouch({
      touch,
      lead,
      cfg,
      brand,
      tenantName: req.tenant!.name,
      baseUrl: base,
      // Sample lead id 0 → a valid (but harmless) preview unsubscribe URL.
      unsubscribeUrl: leadUnsubscribeUrl(base, lead.id),
    });
    res.json({ touch, subject, html });
  });

  const BrandPatch = z.object({
    displayName: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    logoUrl: z.string().max(MAX_LOGO_CHARS).nullable().optional(),
    // How much of the header bar the logo fills — 'half' (compact, default) or
    // 'full' (full-width contained banner). Persisted verbatim; the widget
    // fits the logo with object-fit:contain in both modes. See renderHeader.
    headerLogoFill: z.enum(['half', 'full']).optional(),
    headerLogoSize: z.enum(['s', 'm', 'l', 'xl']).optional(),
    headerLayout: z.enum(['beside', 'stacked']).optional(),
    headerShowName: z.boolean().optional(),
    headerAlign: z.enum(['left', 'center']).optional(),
    // Show the carrier's USDOT/MC + public phone/email as muted meta-lines under
    // the company name in the calculator header. Only the toggle lives here; the
    // numbers themselves are saved via the tenant profile (see PUT
    // /api/tenant/profile). Persisted verbatim; spreads into the column set.
    headerShowCredentials: z.boolean().optional(),
    // Show the carrier's tagline (the one short sentence under the company name)
    // in the calculator header. Only the on/off toggle lives here; the tagline
    // text itself is the `tagline` field. Persisted verbatim; spreads into the
    // column set. Default true — see renderHeader (widget.js).
    showTagline: z.boolean().optional(),
    // Tagline chip SIZE (font size of the eyebrow chip beside the company name)
    // and visual STYLE. Enum-validated so only known values persist; both spread
    // straight into the update `set` via columnPatch like every other scalar
    // brand field. Defaults 'm' / 'solid' — see renderHeader (widget.js) + the
    // .brand-name::after variants in public-calculator-ux.css.
    taglineSize: z.enum(['s', 'm', 'l']).optional(),
    taglineStyle: z.enum(['solid', 'subtle', 'plain']).optional(),
    // Quote validity window (days). Forgiving: '' / non-numeric → null (app
    // default); a number is clamped to 1..365. Stored in the integer column.
    quoteValidityDays: z.preprocess((v) => {
      const n = Number(v);
      return (v === '' || v == null || !Number.isFinite(n)) ? null : Math.max(1, Math.min(365, Math.round(n)));
    }, z.number().int().nullable()).optional(),
    // Lead-notification routing. Kept as loose strings (accept-any); the actual
    // email validation happens where the notification is sent (invalid entries
    // are ignored and it falls back to the account email), so a typo never 400s
    // the save.
    leadEmailTo: z.string().max(200).optional().nullable(),
    leadEmailCc: z.string().max(500).optional().nullable(),
    ctaText: z.string().optional(),
    // Label for the post-quote "confirm the rate" CTA (#qf-continue-btn) that
    // reveals the contact form. Nullable — null clears back to the widget's
    // default copy ('Get the rate confirmed'). Persisted verbatim; spreads into
    // the update `set` via columnPatch like every other scalar brand field.
    claimCtaText: z.string().max(120).nullable().optional(),
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
    // Wave 3 — contrast engine + CTA hover. ctaHover is one of the curated
    // styles; fontColor is 'auto' or a #RRGGBB hex (applied only where it
    // passes WCAG — see resolveWidgetTheme / buildTokens).
    ctaHover: z.enum([...CTA_HOVER_STYLES] as [string, ...string[]]).optional(),
    fontColor: z
      .string()
      .regex(/^(auto|#[0-9a-fA-F]{6})$/, "fontColor must be 'auto' or a #RRGGBB hex")
      .optional(),
    // Per-tenant map style for the calculator's base + route maps. One of the
    // canonical keys; null clears back to the 'branded' default. See routeMap.ts.
    mapStyle: z.enum([...MAP_STYLE_KEYS] as [string, ...string[]]).nullable().optional(),
    // Per-tenant MAP-BLEND toggle ('on' | 'off'). Feathers the route-map edges
    // into the calculator surface. Persisted verbatim; resolveWidgetTheme reads
    // it and the widget applies body[data-qf-map-blend]. See widgetThemes.ts.
    mapBlend: z.enum([...MAP_BLEND_VALUES] as [string, ...string[]]).optional(),
    // Per-tenant MAP-BLEND OPACITY (0–100). Supersedes the binary mapBlend flag:
    // 0 = off (crisp map); 1–100 = blend on at that feather intensity. The
    // Customize panel's slider writes it; resolveWidgetTheme derives the on/off
    // master (map_blend / data-qf-map-blend) from opacity>0. See widgetThemes.ts.
    mapBlendOpacity: z.number().int().min(0).max(100).optional(),
    // Per-tenant optional feature toggles (partial) + the nested `booking`
    // deposit config object. Only known boolean keys (sanitizeFeaturesPatch)
    // and a validated booking object (sanitizeBookingPatch) are persisted, and
    // both are MERGED with the existing column so toggling one setting never
    // drops another. Value type is unknown here because `booking` is an object,
    // not a boolean — the sanitizers enforce the real shape. See
    // src/server/features.ts.
    featuresJson: z.record(z.string(), z.unknown()).optional(),
    // ── Hosted trust-wrap (Phase 1) ──────────────────────────────────────
    // The lean landing shell around the HOSTED calculator page (/w/:slug).
    // All optional + nullable so a partial patch (one control at a time) never
    // clobbers the rest; zod strips unknown keys so stored JSON stays clean.
    // The embed snippet + /w/demo ignore these fields entirely.
    hostedHeadline: z.string().max(120).nullable().optional(),
    hostedSubhead: z.string().max(240).nullable().optional(),
    hostedTrustBadges: z.boolean().optional(),
    hostedTestimonialsJson: z
      .array(
        z.object({
          quote: z.string().max(400),
          author: z.string().max(80),
          company: z.string().max(80).optional(),
          rating: z.number().int().min(1).max(5).optional(),
        }),
      )
      .max(4)
      .nullable()
      .optional(),
    hostedCtasJson: z
      .array(
        z.object({
          label: z.string().max(40),
          type: z.enum(['call', 'email', 'url']),
          value: z.string().max(300),
        }),
      )
      .max(3)
      .nullable()
      .optional(),
    hostedBackgroundJson: z
      .object({
        theme: z.enum(['light', 'dark']).optional(),
        preset: z.string().max(40).optional(),
        // Optional hero image as a downscaled data-URL (~500KB client budget).
        imageUrl: z.string().max(700000).optional(),
        scrim: z.number().int().min(0).max(100).optional(),
      })
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
    // Feature toggles live in a single JSON bag. MERGE a partial patch with the
    // existing column (sanitized to known boolean keys) so toggling one feature
    // never clobbers another. Strip the raw field out of the column spread — we
    // write the merged object explicitly below.
    const { featuresJson: rawFeatures, ...columnPatch } = patch;
    const set: Record<string, unknown> = { ...columnPatch, updatedAt: new Date() };
    const featurePatch = sanitizeFeaturesPatch(rawFeatures);
    // The booking deposit config is a nested object under the `booking` key —
    // sanitized + merged separately so it never collides with the boolean flags.
    const bookingPatch = sanitizeBookingPatch(
      rawFeatures && typeof rawFeatures === 'object'
        ? (rawFeatures as Record<string, unknown>).booking
        : undefined,
    );
    // The automated follow-up + promo config is a nested object under the
    // `followUp` key (Wave 1) — sanitized + merged separately, same pattern as
    // `booking`, so it never collides with the boolean flags or the deposit.
    const followUpPatch = sanitizeFollowUpPatch(
      rawFeatures && typeof rawFeatures === 'object'
        ? (rawFeatures as Record<string, unknown>).followUp
        : undefined,
    );
    if (featurePatch || bookingPatch || followUpPatch) {
      const existing = await db()
        .select({ featuresJson: brandConfigs.featuresJson })
        .from(brandConfigs)
        .where(eq(brandConfigs.tenantId, req.tenant!.id))
        .limit(1);
      const merged: Record<string, unknown> = { ...(existing[0]?.featuresJson ?? {}) };
      if (featurePatch) Object.assign(merged, featurePatch);
      if (bookingPatch) merged.booking = bookingPatch;
      if (followUpPatch) merged.followUp = followUpPatch;
      set.featuresJson = merged;
    }
    await db()
      .update(brandConfigs)
      .set(set)
      .where(eq(brandConfigs.tenantId, req.tenant!.id));
    res.json({ ok: true });
  });

  // ── company profile (single source of truth for public credentials) ──
  // The carrier's USDOT/MC + public phone/email. These four columns feed the
  // calculator-header credential meta-lines (widget.js renderHeader), the hosted
  // quote, and the marketplace profile, so this endpoint is the ONE place the
  // portal Account card saves them. `contactPhone` + `publicContactEmail` are
  // ALSO editable via PUT /api/auth/profile (the legacy Account form); both write
  // the same tenant columns, so either path is safe. `publicContactEmail` is the
  // OPT-IN public address — never the private login `contactEmail`.
  app.get('/api/tenant/profile', requireAuth, requireTenant, (req, res) => {
    res.json({
      dotNumber: req.tenant!.dotNumber ?? null,
      mcNumber: req.tenant!.mcNumber ?? null,
      publicContactEmail: req.tenant!.publicContactEmail ?? null,
      contactPhone: req.tenant!.contactPhone ?? null,
    });
  });

  const ProfilePatch = z.object({
    // Loose strings for the authority numbers (formats vary: "MC 748213",
    // "748213", hyphens); trimmed + emptied-to-null below. Empty string clears.
    dotNumber: z.string().max(40).nullable().optional(),
    mcNumber: z.string().max(40).nullable().optional(),
    // PUBLIC opt-in email — validated as an email (or '' to clear). Never seeded
    // from the private login email.
    publicContactEmail: z
      .union([z.string().email().max(160), z.literal('')])
      .nullable()
      .optional(),
    contactPhone: z.string().max(50).nullable().optional(),
  });

  app.put('/api/tenant/profile', requireAuth, requireTenant, async (req, res) => {
    const parse = ProfilePatch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const b = parse.data;
    // Trim, and treat a blank string as an explicit clear (→ null). An omitted
    // key never touches the column.
    const norm = (v: string | null | undefined): string | null => ((v ?? '').trim() || null);
    const upd: Partial<typeof tenants.$inferInsert> = {};
    if (b.dotNumber !== undefined) upd.dotNumber = norm(b.dotNumber);
    if (b.mcNumber !== undefined) upd.mcNumber = norm(b.mcNumber);
    if (b.publicContactEmail !== undefined) upd.publicContactEmail = norm(b.publicContactEmail);
    if (b.contactPhone !== undefined) upd.contactPhone = norm(b.contactPhone);
    if (Object.keys(upd).length > 0) {
      upd.updatedAt = new Date();
      await db().update(tenants).set(upd).where(eq(tenants.id, req.tenant!.id));
      // USDOT/MC also surface on the public marketplace profile — refresh it.
      if (b.dotNumber !== undefined || b.mcNumber !== undefined) bumpMarketplace(req.tenant!.id);
    }
    res.json({
      ok: true,
      dotNumber: b.dotNumber !== undefined ? (upd.dotNumber ?? null) : (req.tenant!.dotNumber ?? null),
      mcNumber: b.mcNumber !== undefined ? (upd.mcNumber ?? null) : (req.tenant!.mcNumber ?? null),
      publicContactEmail:
        b.publicContactEmail !== undefined
          ? (upd.publicContactEmail ?? null)
          : (req.tenant!.publicContactEmail ?? null),
      contactPhone:
        b.contactPhone !== undefined ? (upd.contactPhone ?? null) : (req.tenant!.contactPhone ?? null),
    });
  });

  // ── carrier self-lookup ("Find your company" autofill) ─────────
  // Authed convenience: a carrier searches OUR local FMCSA directory (by USDOT,
  // MC #, or company name) and prefills their own company-detail inputs, instead
  // of hand-typing. Behind the same auth as every /api/tenant/* route (kept off
  // the public surface so rate-limit exposure stays low) + the shared public
  // autocomplete limiter (keyed per IP). Returns the SLIM carrierLookup shape;
  // contactHidden carriers null their phone/email inside the query.
  app.get('/api/tenant/carrier-search', requireAuth, requireTenant, publicAutocompleteLimiter, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const dot = typeof req.query.dot === 'string' ? req.query.dot : undefined;
    const mc = typeof req.query.mc === 'string' ? req.query.mc : undefined;
    const results = await carrierLookup({ q, dot, mc });
    res.json({ results });
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

  // ── fuel-surcharge mode (auto EIA diesel vs manual per-card %) ──
  // 'manual' (default) → each rate card's fixed fuel_surcharge_pct is used.
  // 'auto' → surcharge derived weekly from the EIA national diesel price via
  // the standard DOE-index formula. The response also carries the current
  // national diesel price + resulting $/mile so the dashboard can show the
  // live basis read-only.
  app.get('/api/tenant/fsc-settings', requireAuth, requireTenant, async (req, res) => {
    const diesel = await getDieselPrice();
    const perMileUsd = autoFscPerMile({
      dieselUsdPerGal: diesel.usdPerGal,
      pegUsdPerGal: AUTO_FSC_DEFAULTS.pegUsdPerGal,
      mpg: AUTO_FSC_DEFAULTS.mpg,
    });
    res.json({
      mode: req.tenant!.fscMode === 'auto' ? 'auto' : 'manual',
      diesel: {
        usdPerGal: Math.round(diesel.usdPerGal * 1000) / 1000,
        asOf: diesel.asOf,
        asOfLabel: asOfLabel(diesel.asOf),
        source: diesel.source,
        stale: diesel.stale,
      },
      formula: {
        pegUsdPerGal: AUTO_FSC_DEFAULTS.pegUsdPerGal,
        mpg: AUTO_FSC_DEFAULTS.mpg,
        perMileUsd,
      },
    });
  });

  app.put('/api/tenant/fsc-settings', requireAuth, requireTenant, async (req, res) => {
    const Patch = z.object({ mode: z.enum(['manual', 'auto']) });
    const parse = Patch.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(tenants)
      .set({ fscMode: parse.data.mode, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    await db().insert(auditLog).values({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'fsc.mode.update',
      actorKind: 'user',
      detailsJson: { mode: parse.data.mode },
    });
    res.json({ ok: true, mode: parse.data.mode });
  });

  // ── embed snippet ─────────────────────────────────────────────
  app.get('/api/tenant/embed', requireAuth, requireTenant, async (req, res) => {
    const env = loadEnv();
    const fallbackBase = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const t = req.tenant!;
    // Prefer the tenant's chosen subdomain (slug.hostDomain). That's what
    // they picked at signup, what their customers see, what their cert
    // covers. Fall back to PUBLIC_BASE_URL only for legacy/unset hostDomain.
    const hasHost = !!(t.hostDomain && t.slug);
    const base = hasHost ? `https://${t.slug}.${t.hostDomain}` : fallbackBase;
    // On the tenant's own subdomain, GET / IS the calculator. On the platform
    // origin (unset hostDomain) GET / serves the MARKETING page — the calculator
    // lives at /w/:slug there — so point the direct link + iframe at /w/:slug,
    // never at QuoteFleet's marketing site. (The embed.js snippet works on either.)
    const widgetUrl = hasHost ? `${base}/` : `${base}/w/${encodeURIComponent(t.slug)}`;
    const snippet = `<script src="${base}/embed.js?t=${t.embedToken}" defer></script>`;
    const iframeFallback = `<iframe src="${widgetUrl}${widgetUrl.includes('?') ? '&' : '?'}embed=1" style="width:100%;max-width:560px;border:0;min-height:660px;" loading="lazy" title="Get a freight quote"></iframe>`;
    const directLink = widgetUrl;
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

  // ── owner live-preview URL ─────────────────────────────────────
  // Mints a short-lived, signed, tenant-scoped preview grant so the
  // authenticated owner can preview their OWN calculator in the dashboard
  // live-preview iframes even when the calculator is PRIVATE. The grant rides
  // in the URL (`?pk=`) because the widget is served from a different origin
  // (subdomain) that the dashboard's auth cookie does not reach. It verifies
  // only for THIS tenant (HMAC over the tenant id) and expires in ~30 min, so
  // it can never expose another tenant's private widget and is not a
  // shareable public link. (`tenantWidgetBase` is hoisted from below.)
  app.get('/api/tenant/preview-url', requireAuth, requireTenant, async (req, res) => {
    const t = req.tenant!;
    const grant = makePreviewGrant(t.id);
    // Build the preview on the PLATFORM origin (PUBLIC_BASE_URL) rather than the
    // tenant's customer subdomain: this is an owner preview shown inside the
    // dashboard, so same-origin keeps it robust (no third-party-cookie hop) and
    // testable. `/w/:slug` serves the identical widget on this host. The signed
    // grant is still what unlocks a PRIVATE calculator — the dashboard LOGIN
    // session does not, since the gate checks the access grant, not auth.
    const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
    const previewUrl = `${base}/w/${encodeURIComponent(t.slug)}?${PREVIEW_GRANT_PARAM}=${encodeURIComponent(grant)}`;
    res.json({ previewUrl, expiresInMs: PREVIEW_GRANT_TTL_MS });
  });

  // ── access control (public vs private invite-only calculator) ──────
  // Available on every plan (trial included) — locking a calculator is a
  // security control, not a paywalled perk. Invite links are the ONLY way
  // to reach a private calculator + its rate/quote APIs (enforced in
  // src/server/access.ts + routes/public.ts).

  /** The base URL the tenant's customers open — mirrors /api/tenant/embed. */
  function tenantWidgetBase(t: typeof tenants.$inferSelect): string {
    const env = loadEnv();
    return t.hostDomain && t.slug
      ? `https://${t.slug}.${t.hostDomain}`
      : env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  function inviteUrl(t: typeof tenants.$inferSelect, token: string): string {
    return `${tenantWidgetBase(t)}/?key=${token}`;
  }

  app.get('/api/tenant/access', requireAuth, requireTenant, async (req, res) => {
    const t = req.tenant!;
    const links = await db()
      .select()
      .from(accessLinks)
      .where(eq(accessLinks.tenantId, t.id))
      .orderBy(desc(accessLinks.createdAt));
    res.json({
      accessMode: t.accessMode,
      links: links.map((l) => ({
        id: l.id,
        label: l.label,
        url: inviteUrl(t, l.token),
        active: l.active,
        useCount: l.useCount,
        lastUsedAt: l.lastUsedAt,
        createdAt: l.createdAt,
      })),
    });
  });

  app.put('/api/tenant/access', requireAuth, requireTenant, async (req, res) => {
    const Schema = z.object({ accessMode: z.enum(['public', 'private']) });
    const parse = Schema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    await db()
      .update(tenants)
      .set({ accessMode: parse.data.accessMode, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenant!.id));
    res.json({ ok: true, accessMode: parse.data.accessMode });
  });

  app.post('/api/tenant/access/links', requireAuth, requireTenant, async (req, res) => {
    const Schema = z.object({ label: z.string().trim().min(1).max(120) });
    const parse = Schema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'A name for the invite link is required.' });
    }
    const t = req.tenant!;
    // 32-char nanoid → ~190 bits of entropy. Unguessable.
    const token = nanoid(32);
    const [row] = await db()
      .insert(accessLinks)
      .values({ tenantId: t.id, token, label: parse.data.label })
      .returning();
    res.json({
      ok: true,
      link: row
        ? {
            id: row.id,
            label: row.label,
            url: inviteUrl(t, row.token),
            active: row.active,
            useCount: row.useCount,
            lastUsedAt: row.lastUsedAt,
            createdAt: row.createdAt,
          }
        : null,
    });
  });

  app.post('/api/tenant/access/links/:id/revoke', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const updated = await db()
      .update(accessLinks)
      .set({ active: false })
      .where(and(eq(accessLinks.id, id), eq(accessLinks.tenantId, req.tenant!.id)))
      .returning({ id: accessLinks.id });
    if (!updated[0]) return res.status(404).json({ error: 'Link not found' });
    res.json({ ok: true });
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

  // ── post-signup guided onboarding ──────────────────────────────
  // The wizard (src/server/public/onboarding-wizard.js) posts here on FINISH
  // or SKIP. On finish we reseed the tenant with the picked freight vertical's
  // subset — but ONLY when the tenant's rows are still the untouched signup
  // seed (isSeedPristine). If the trucker already customized rates, we NEVER
  // delete their data: we just stamp pricing/lane/brand + completedAt.
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const OnboardingApply = z.object({
    skip: z.boolean().optional(),
    freightVertical: z.enum([...FREIGHT_VERTICALS] as [FreightVertical, ...FreightVertical[]]).optional(),
    /** Multi-mode selection. A carrier running dry van + reefer + flatbed is
     *  ordinary; seeding one vertical left them unable to quote the rest.
     *  `freightVertical` stays accepted so older clients keep working. */
    freightVerticals: z
      .array(z.enum([...FREIGHT_VERTICALS] as [FreightVertical, ...FreightVertical[]]))
      .min(1)
      .max(FREIGHT_VERTICALS.length)
      .optional(),
    pricingMode: z.enum([...PRICING_MODES] as [string, ...string[]]).optional(),
    /** Superseded by serviceArea; still accepted from older clients. */
    mainLane: z
      .object({
        from: z.string().max(160).nullable().optional(),
        to: z.string().max(160).nullable().optional(),
      })
      .nullable()
      .optional(),
    serviceArea: z
      .object({
        kind: z.enum(['nationwide_us', 'nationwide_ca', 'cross_border', 'regions', 'radius']),
        regions: z.array(z.string().min(2).max(3)).max(75).optional(),
        radiusMiles: z.number().int().positive().max(3000).optional(),
        baseCity: z.string().max(160).nullable().optional(),
      })
      .nullable()
      .optional(),
    brand: z
      .object({
        primaryColor: z.string().regex(HEX).optional(),
        accentColor: z.string().regex(HEX).optional(),
        logoUrl: z.string().max(MAX_LOGO_CHARS).nullable().optional(),
      })
      .nullable()
      .optional(),
    /** Quoting rules (wizard step 3). Every field below is OPTIONAL so the Skip
     *  path and older clients keep working — an omitted field NEVER overwrites
     *  the tenant's current value. */
    /** 'auto' derives the fuel surcharge from the EIA diesel index; 'manual'
     *  keeps the fixed per-rate-card percentage. → tenants.fscMode */
    fscMode: z.enum(['manual', 'auto']).optional(),
    /** Only meaningful with fscMode 'manual'. There is no tenant-level FSC
     *  percentage column — manual mode reads each rate card's
     *  fuel_surcharge_pct — so this is written across the tenant's rate cards.
     *  Ignored when fscMode is not 'manual'. */
    fscPercent: z.number().min(0).max(100).optional(),
    /** 'public' = prices shown instantly; 'private' = invite/lead-gated (the
     *  only two values src/server/access.ts recognises). → tenants.accessMode */
    accessMode: z.enum(['public', 'private']).optional(),
    /** OPTIONAL trust details (wizard step 5), all shown on customer-facing
     *  surfaces. Empty string is accepted and normalised to null so clearing a
     *  field is possible; omitting the key leaves the column untouched. */
    mcNumber: z.string().max(40).nullable().optional(),
    dotNumber: z.string().max(40).nullable().optional(),
    /** PUBLIC contact address — never seeded from the operator's login email
     *  (tenants.contactEmail), which must stay private. */
    publicContactEmail: z
      .union([z.string().email().max(160), z.literal('')])
      .nullable()
      .optional(),
    /** PUBLIC contact phone (tenants.contactPhone) — the wizard sends it ONLY
     *  when the "Find your company" finder supplied one, so an omitted key never
     *  overwrites a phone the carrier set in the Account card. */
    contactPhone: z.string().max(50).nullable().optional(),
  });

  app.post('/api/tenant/onboarding/apply', requireAuth, requireTenant, async (req, res) => {
    const parse = OnboardingApply.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const body = parse.data;
    const tid = req.tenant!.id;

    // SKIP — no reseed, no brand change. Just mark it skipped so the gate
    // stops firing. Leave completedAt null so a later real completion still
    // counts as "completed" if we ever re-open the flow.
    if (body.skip) {
      await db()
        .update(tenants)
        .set({
          onboardingJson: { completedAt: null, skipped: true },
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tid));
      return res.json({ ok: true, skipped: true, reseeded: false });
    }

    // Accept either shape: the multi-select `freightVerticals` (current wizard)
    // or a single `freightVertical` (older clients). Seed from the UNION so a
    // multi-mode carrier gets a calculator that can quote all of their business.
    const selectedVerticals: FreightVertical[] =
      body.freightVerticals && body.freightVerticals.length > 0
        ? body.freightVerticals
        : body.freightVertical
          ? [body.freightVertical]
          : [];
    if (selectedVerticals.length === 0) {
      return res.status(400).json({ error: 'At least one freight vertical is required to finish onboarding' });
    }
    const primaryVertical = selectedVerticals[0]!;
    const template = mergeSeedTemplates(selectedVerticals);
    const pricingMode = body.pricingMode ?? template.pricingMode;

    // Read the current seed rows + the tenant's existing onboarding record to
    // decide whether a reseed is safe.
    const [existingRates, existingAcc, existingZones, tenantRow] = await Promise.all([
      db().select().from(rateCards).where(eq(rateCards.tenantId, tid)),
      db().select().from(accessorials).where(eq(accessorials.tenantId, tid)),
      db().select().from(laneZones).where(eq(laneZones.tenantId, tid)),
      db().select().from(tenants).where(eq(tenants.id, tid)).limit(1),
    ]);

    const alreadyCompleted = (tenantRow[0]?.onboardingJson?.completedAt ?? null) != null;
    const pristine = isSeedPristine({
      rateCards: existingRates.map((c) => ({
        service: c.service,
        equipment: c.equipment,
        ratePerMile: c.ratePerMile,
        minimumCharge: c.minimumCharge,
        flatFee: c.flatFee,
      })),
      accessorials: existingAcc.map((a) => ({ code: a.code, amount: a.amount, enabled: a.enabled })),
      laneZones: existingZones.map((z) => ({ anchorPortCode: z.anchorPortCode, flatPrice: z.flatPrice })),
    });

    // Only reseed on the FIRST run over an untouched seed. A tenant who edited
    // rates, or already completed onboarding once, keeps every row.
    const doReseed = !alreadyCompleted && pristine;

    // Quoting rules + trust details. Each is applied ONLY when the client
    // actually sent it, so an older wizard, a partial payload, or the Skip path
    // never clobbers a value the carrier set elsewhere in Settings.
    const norm = (v: string | null | undefined): string | null =>
      ((v ?? '').trim() || null);
    const settingsPatch: Partial<typeof tenants.$inferInsert> = {};
    if (body.fscMode !== undefined) settingsPatch.fscMode = body.fscMode;
    if (body.accessMode !== undefined) settingsPatch.accessMode = body.accessMode;
    if (body.mcNumber !== undefined) settingsPatch.mcNumber = norm(body.mcNumber);
    if (body.dotNumber !== undefined) settingsPatch.dotNumber = norm(body.dotNumber);
    if (body.publicContactEmail !== undefined) {
      settingsPatch.publicContactEmail = norm(body.publicContactEmail);
    }
    if (body.contactPhone !== undefined) settingsPatch.contactPhone = norm(body.contactPhone);

    // A manual fuel surcharge has NO tenant-level column: manual mode reads each
    // rate card's fuel_surcharge_pct (see tenants.fscMode in schema.ts). So the
    // one percentage the carrier typed is written across their rate cards.
    // Only when they explicitly picked manual AND supplied a number — on 'auto'
    // the EIA index owns the surcharge and these columns are left alone.
    const manualFscPct =
      body.fscMode === 'manual' && body.fscPercent !== undefined ? body.fscPercent : null;

    await db().transaction(async (tx) => {
      if (doReseed) {
        await tx.delete(rateCards).where(eq(rateCards.tenantId, tid));
        await tx.delete(accessorials).where(eq(accessorials.tenantId, tid));
        await tx.delete(laneZones).where(eq(laneZones.tenantId, tid));
        if (template.rateCards.length > 0) {
          await tx.insert(rateCards).values(template.rateCards.map((c) => ({ ...c, tenantId: tid })));
        }
        if (template.accessorials.length > 0) {
          await tx
            .insert(accessorials)
            .values(template.accessorials.map((a) => ({ ...a, tenantId: tid })));
        }
        if (template.laneZones.length > 0) {
          await tx.insert(laneZones).values(template.laneZones.map((z) => ({ ...z, tenantId: tid })));
        }
      }

      // Runs AFTER the reseed so it lands on the rows the tenant actually keeps.
      if (manualFscPct !== null) {
        await tx
          .update(rateCards)
          .set({ fuelSurchargePct: manualFscPct, updatedAt: new Date() })
          .where(eq(rateCards.tenantId, tid));
      }

      // Brand: colors are free for everyone; a custom logo is a Vital+ perk, so
      // only apply logoUrl when the plan allows (never 403 the whole wizard —
      // silently skip the logo instead).
      if (body.brand) {
        const brandPatch: Record<string, unknown> = {};
        if (body.brand.primaryColor) brandPatch.primaryColor = body.brand.primaryColor;
        if (body.brand.accentColor) brandPatch.accentColor = body.brand.accentColor;
        const hasCore =
          req.user?.role === 'super_admin' ||
          (CORE_PLANS as readonly string[]).includes(effectivePlan(req.tenant!));
        if (hasCore && Object.prototype.hasOwnProperty.call(body.brand, 'logoUrl')) {
          brandPatch.logoUrl = body.brand.logoUrl ?? null;
        }
        if (Object.keys(brandPatch).length > 0) {
          brandPatch.updatedAt = new Date();
          await tx.update(brandConfigs).set(brandPatch).where(eq(brandConfigs.tenantId, tid));
        }
      }

      await tx
        .update(tenants)
        .set({
          onboardingJson: {
            completedAt: new Date().toISOString(),
            skipped: false,
            freightVertical: primaryVertical,
            freightVerticals: selectedVerticals,
            pricingMode,
            mainLane: body.mainLane
              ? { from: body.mainLane.from ?? null, to: body.mainLane.to ?? null }
              : undefined,
            serviceArea: body.serviceArea
              ? {
                  kind: body.serviceArea.kind,
                  regions: body.serviceArea.regions,
                  radiusMiles: body.serviceArea.radiusMiles,
                  baseCity: body.serviceArea.baseCity ?? null,
                }
              : undefined,
            fscMode: body.fscMode,
            fscPercent: manualFscPct ?? undefined,
            accessMode: body.accessMode,
          },
          ...settingsPatch,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tid));

      await tx.insert(auditLog).values({
        tenantId: tid,
        userId: req.user!.id,
        action: 'onboarding.apply',
        actorKind: 'user',
        detailsJson: {
          freightVertical: primaryVertical,
          freightVerticals: selectedVerticals,
          pricingMode,
          serviceArea: body.serviceArea?.kind ?? null,
          reseeded: doReseed,
          fscMode: body.fscMode ?? null,
          fscPercent: manualFscPct,
          accessMode: body.accessMode ?? null,
          // Whether they were set — never the values, which are tenant PII-ish
          // contact details already stored on the row itself.
          trustDetails: {
            mcNumber: settingsPatch.mcNumber != null,
            dotNumber: settingsPatch.dotNumber != null,
            publicContactEmail: settingsPatch.publicContactEmail != null,
            contactPhone: settingsPatch.contactPhone != null,
          },
        },
      });
    });

    bumpMarketplace(tid);
    res.json({
      ok: true,
      skipped: false,
      reseeded: doReseed,
      freightVertical: primaryVertical,
      freightVerticals: selectedVerticals,
      pricingMode,
      fscMode: body.fscMode ?? null,
      accessMode: body.accessMode ?? null,
    });
  });
}
