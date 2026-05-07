/**
 * PUBLIC SEO calculator at /tools/.
 *
 * Free, no signup, no tenant scoping. Uses platform default rates from
 * src/calc/defaults.ts and (when populated) the anonymized marketplace
 * aggregates to surface "this is the market median, not one carrier's
 * book." Indexed by Google because the route is plain HTML.
 *
 * Endpoints:
 *   GET  /tools/                      — landing for the calculator
 *   GET  /api/tools/config            — equipment + accessorials JSON
 *   POST /api/tools/quote             — compute a quote (no DB write)
 *   POST /api/tools/lead              — optional contact capture
 *
 * The /api/tools/* endpoints are rate-limited like /api/public/*.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { calculate, type CalcRequest } from '../../calc/engine.js';
import { distanceBetween } from '../../calc/distance.js';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
} from '../../calc/defaults.js';
import type { RateCard, Accessorial, LaneZone } from '../../db/schema.js';
import { publicCalcLimiter } from '../rateLimits.js';
import { db } from '../../db/client.js';
import { marketplaceAggregates } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

// Wrap the seed defaults into row shapes the calculator engine accepts.
// We use synthetic ids — they're never persisted.
const PLATFORM_RATE_CARDS: RateCard[] = DEFAULT_RATE_CARDS.map((c, i) => ({
  id: -1 - i,
  tenantId: 0,
  service: c.service,
  equipment: c.equipment,
  label: c.label ?? null,
  ratePerMile: c.ratePerMile ?? 0,
  minimumCharge: c.minimumCharge ?? 0,
  flatFee: c.flatFee ?? 0,
  fuelSurchargePct: c.fuelSurchargePct ?? 0,
  marginPct: c.marginPct ?? 0,
  maxWeightLbs: c.maxWeightLbs ?? null,
  maxMiles: c.maxMiles ?? null,
  enabled: true,
  sortOrder: c.sortOrder ?? 0,
  notes: null,
  lastAiEditAt: null,
  lastAiEditReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const PLATFORM_ACCESSORIALS: Accessorial[] = DEFAULT_ACCESSORIALS.map((a, i) => ({
  id: -1 - i,
  tenantId: 0,
  code: a.code,
  label: a.label,
  description: a.description ?? null,
  kind: a.kind ?? 'flat',
  amount: a.amount ?? 0,
  trigger: a.trigger ?? 'optional',
  conditionJson: (a.conditionJson ?? null) as Record<string, unknown> | null,
  appliesToServices: a.appliesToServices ?? null,
  enabled: true,
  sortOrder: a.sortOrder ?? 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const PLATFORM_LANE_ZONES: LaneZone[] = generateDefaultLaneZones().map((z, i) => ({
  id: -1 - i,
  tenantId: 0,
  label: z.label,
  anchorPortCode: z.anchorPortCode ?? null,
  anchorCity: z.anchorCity ?? null,
  anchorState: z.anchorState ?? null,
  radiusMiles: z.radiusMiles,
  flatPrice: z.flatPrice,
  equipmentScope: z.equipmentScope ?? null,
  enabled: true,
  sortOrder: z.sortOrder ?? 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const QuoteSchema = z.object({
  service: z.string(),
  equipment: z.string(),
  pickup: z.object({
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    portCode: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }),
  delivery: z.object({
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }),
  weightLbs: z.number().optional(),
  selectedAccessorialCodes: z.array(z.string()).optional(),
  flags: z
    .object({
      residential: z.boolean().optional(),
      hazmat: z.boolean().optional(),
      tempControlled: z.boolean().optional(),
    })
    .optional(),
});

export function registerToolsRoutes(app: Express) {
  // Config — equipment + accessorials available in the public form.
  app.get('/api/tools/config', (_req, res) => {
    const enabledCards = PLATFORM_RATE_CARDS.filter((c) => c.enabled);
    const services = Array.from(new Set(enabledCards.map((c) => c.service)));
    const equipmentByService: Record<string, Array<{ value: string; label: string }>> = {};
    for (const c of enabledCards) {
      if (!equipmentByService[c.service]) equipmentByService[c.service] = [];
      equipmentByService[c.service].push({ value: c.equipment, label: c.label ?? c.equipment });
    }
    return res.json({
      services,
      equipmentByService,
      accessorials: PLATFORM_ACCESSORIALS
        .filter((a) => a.trigger === 'optional')
        .map((a) => ({
          code: a.code,
          label: a.label,
          description: a.description,
          appliesToServices: a.appliesToServices,
        })),
    });
  });

  // Compute a quote against the platform defaults.
  app.post('/api/tools/quote', publicCalcLimiter, async (req: Request, res: Response) => {
    const parse = QuoteSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const body = parse.data;

    const dist = await distanceBetween(body.pickup, body.delivery);
    if ('error' in dist) return res.status(400).json({ error: dist.error });

    const calcReq: CalcRequest = {
      service: body.service,
      equipment: body.equipment,
      miles: dist.miles,
      weightLbs: body.weightLbs,
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
      selectedAccessorialCodes: body.selectedAccessorialCodes,
      flags: body.flags,
    };
    const result = calculate(PLATFORM_RATE_CARDS, PLATFORM_ACCESSORIALS, PLATFORM_LANE_ZONES, calcReq);

    // Pull a benchmark — "the market median for this lane is $X" — from
    // marketplace_aggregates if one matches. Suppress when sample < 5.
    let benchmark: { p50RatePerMile?: number | null; p50FlatPrice?: number | null; sampleSize: number } | null = null;
    try {
      const ag = (
        await db()
          .select()
          .from(marketplaceAggregates)
          .where(
            and(
              eq(marketplaceAggregates.service, body.service),
              eq(marketplaceAggregates.equipment, body.equipment)
            )
          )
          .limit(1)
      )[0];
      if (ag && ag.sampleSize >= 5) {
        benchmark = {
          p50RatePerMile: ag.p50RatePerMile,
          p50FlatPrice: ag.p50FlatPrice,
          sampleSize: ag.sampleSize,
        };
      }
    } catch (err) {
      console.warn('[tools.quote] benchmark lookup failed (non-fatal):', err);
    }

    return res.json({
      miles: dist.miles,
      origin: dist.origin,
      destination: dist.destination,
      result,
      benchmark,
      disclaimer:
        'This is a benchmark estimate using public 2026 rate data. Real carrier pricing varies — sign up to QuoteFleet to use your own rates.',
    });
  });

  // Optional: capture a contact for follow-up. If marketplace has
  // matching opted-in carriers, this could one day route the lead to
  // them. For now we just log; storage TBD.
  app.post('/api/tools/lead', publicCalcLimiter, async (req: Request, res: Response) => {
    const Schema = z.object({
      email: z.string().email(),
      name: z.string().optional(),
      company: z.string().optional(),
      message: z.string().optional(),
      quoteContext: z.unknown().optional(),
    });
    const parse = Schema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    // V1: log only. Real storage requires a `tools_leads` table or
    // routing to opted-in carriers (future).
    console.log('[tools.lead]', JSON.stringify(parse.data));
    return res.json({ ok: true });
  });
}
