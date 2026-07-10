/**
 * AI routes:
 *   POST /api/ai/rate-chat      — tenant admin chats with rate-adjustment agent
 *   GET  /api/ai/rate-chat      — load chat history
 *   POST /api/ai/preview-quote  — preview a quote with current rate config (sandbox)
 *
 * The rate-chat endpoint is HEAVY — it can update DB rows. Strict
 * tenant scoping; no super-admin override (super-admin can switch
 * to a tenant first via /api/auth/impersonate).
 */
import type { Express } from 'express';
import { z } from 'zod';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  conversations,
  rateCards,
  accessorials,
  laneZones,
} from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { rateAgentTurn } from '../../ai/rateAgent.js';
import { calculate, type CalcRequest } from '../../calc/engine.js';
import { resolveFscForTenant, asOfLabel } from '../../eia/dieselPrice.js';
import { distanceBetween } from '../../calc/distance.js';

export function registerAiRoutes(app: Express) {
  app.post('/api/ai/rate-chat', requireAuth, requireTenant, async (req, res) => {
    const { message } = req.body ?? {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    try {
      const out = await rateAgentTurn(req.tenant!.id, req.user!.id, message.trim());
      return res.json({ ok: true, ...out });
    } catch (err) {
      // Don't leak Anthropic SDK / DB error internals to the client —
      // they expose model names, organization IDs, schema details. Log
      // the raw error server-side, return a generic message.
      console.error('[ai/rate-chat] error:', err);
      return res.status(500).json({ error: 'AI request failed. Try again or contact support.' });
    }
  });

  app.get('/api/ai/rate-chat', requireAuth, requireTenant, async (req, res) => {
    const rows = await db()
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, req.tenant!.id),
          eq(conversations.channel, 'admin_rate_chat')
        )
      )
      .orderBy(asc(conversations.createdAt))
      .limit(200);
    res.json({ messages: rows });
  });

  // ── preview quote (admin sandbox to test rates) ───────────────
  const PreviewSchema = z.object({
    service: z.string(),
    equipment: z.string(),
    pickup: z.object({
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
      portCode: z.string().optional(),
    }),
    delivery: z.object({
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
      portCode: z.string().optional(),
    }),
    weightLbs: z.number().optional(),
    selectedAccessorialCodes: z.array(z.string()).optional(),
  });

  app.post('/api/ai/preview-quote', requireAuth, requireTenant, async (req, res) => {
    const parse = PreviewSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const tid = req.tenant!.id;
    const [cards, accs, zones] = await Promise.all([
      db().select().from(rateCards).where(eq(rateCards.tenantId, tid)),
      db().select().from(accessorials).where(eq(accessorials.tenantId, tid)),
      db().select().from(laneZones).where(eq(laneZones.tenantId, tid)),
    ]);
    const dist = await distanceBetween(parse.data.pickup, parse.data.delivery);
    if ('error' in dist) return res.status(400).json({ error: dist.error });
    const calcReq: CalcRequest = {
      service: parse.data.service,
      equipment: parse.data.equipment,
      miles: dist.miles,
      weightLbs: parse.data.weightLbs,
      pickupCity: parse.data.pickup.city,
      pickupState: parse.data.pickup.state,
      pickupZip: parse.data.pickup.zip,
      pickupCountry: parse.data.pickup.country,
      pickupLat: dist.origin.lat,
      pickupLng: dist.origin.lng,
      deliveryCity: parse.data.delivery.city,
      deliveryState: parse.data.delivery.state,
      deliveryZip: parse.data.delivery.zip,
      deliveryCountry: parse.data.delivery.country,
      deliveryLat: dist.destination.lat,
      deliveryLng: dist.destination.lng,
      pickupPortCode: parse.data.pickup.portCode,
      deliveryPortCode: parse.data.delivery.portCode,
      selectedAccessorialCodes: parse.data.selectedAccessorialCodes,
    };
    const fscCtx = await resolveFscForTenant(req.tenant!);
    const result = calculate(cards, accs, zones, calcReq, [], {
      mode: fscCtx.mode,
      perMileUsd: fscCtx.perMileUsd,
      dieselUsd: fscCtx.dieselUsd,
      asOfLabel: fscCtx.asOf ? asOfLabel(fscCtx.asOf) : undefined,
    });
    res.json({ miles: dist.miles, origin: dist.origin, destination: dist.destination, result });
  });
}
