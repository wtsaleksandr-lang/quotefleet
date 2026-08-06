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
  rateMatrices,
  rateZones,
} from '../../db/schema.js';
import type { MatrixCellInput, ZoneDefInput } from '../../calc/rateMatrix.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { aiTenantBurstLimiter, aiTenantDailyLimiter } from '../rateLimits.js';
import { rateAgentTurn, applyRateMutation } from '../../ai/rateAgent.js';
import { calculate, currencyForCountry, type CalcRequest } from '../../calc/engine.js';
import { resolveFscForTenant, asOfLabel } from '../../eia/dieselPrice.js';
import { distanceBetween } from '../../calc/distance.js';

export function registerAiRoutes(app: Express) {
  // Per-tenant AI cost cap (audit H3): rate-chat calls Anthropic on the shared
  // platform key when the tenant has no BYO key. Burst + daily limiters keyed by
  // tenant id, chained AFTER requireTenant so req.tenant is resolved; BYO-key
  // tenants are skipped. See rateLimits.ts.
  app.post('/api/ai/rate-chat', requireAuth, requireTenant, aiTenantBurstLimiter, aiTenantDailyLimiter, async (req, res) => {
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

  // ── Confirm-before-apply: proposals (audit H1) ─────────────────
  // The AI never writes live pricing. A mutation produces a `pending`
  // proposal (a conversations row whose id is the proposal id). These two
  // endpoints are the ONLY path that mutates rates from the AI surface:
  //   apply   — re-validates the STORED input against RATE-C1 bounds
  //             server-side (client sends only the id — never a number),
  //             then writes + audit-logs, and flips the row to `applied`.
  //   discard — flips the row to `discarded`; nothing is written.
  type LoadedProposal =
    | { ok: false; code: number; msg: string; status?: unknown }
    | { ok: true; meta: Record<string, unknown> };
  async function loadPendingProposal(tenantId: number, id: number): Promise<LoadedProposal> {
    if (!Number.isInteger(id) || id <= 0) return { ok: false, code: 400, msg: 'Invalid proposal id' };
    const rows = await db()
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    const meta = (row?.metadataJson ?? {}) as Record<string, unknown>;
    if (!row || meta.kind !== 'rate_proposal') return { ok: false, code: 404, msg: 'Proposal not found' };
    if (meta.status !== 'pending') {
      return { ok: false, code: 409, msg: `This change was already ${String(meta.status)}.`, status: meta.status };
    }
    return { ok: true, meta };
  }

  app.post('/api/ai/rate-proposals/:id/apply', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    const loaded = await loadPendingProposal(req.tenant!.id, id);
    if (!loaded.ok) return res.status(loaded.code).json({ error: loaded.msg, status: loaded.status });
    const { meta } = loaded;
    try {
      // NEVER trust a client number: apply from the stored input, and
      // applyRateMutation re-runs the full RATE-C1 validation before writing.
      const result = await applyRateMutation(
        req.tenant!.id,
        req.user!.id,
        String(meta.tool),
        (meta.input ?? {}) as Record<string, unknown>
      );
      if (!result.ok) {
        // Re-validation rejected the stored value (e.g. tampered / out of
        // bounds). Nothing was written; leave it pending and report why.
        return res.status(400).json({ error: result.message });
      }
      await db()
        .update(conversations)
        .set({ metadataJson: { ...meta, status: 'applied', appliedAt: new Date().toISOString(), appliedByUserId: req.user!.id } })
        .where(eq(conversations.id, id));
      return res.json({ ok: true, status: 'applied', message: result.message });
    } catch (err) {
      console.error('[ai/rate-proposals/apply] error:', err);
      return res.status(500).json({ error: 'Apply failed. Try again or contact support.' });
    }
  });

  app.post('/api/ai/rate-proposals/:id/discard', requireAuth, requireTenant, async (req, res) => {
    const id = Number(req.params.id);
    const loaded = await loadPendingProposal(req.tenant!.id, id);
    if (!loaded.ok) return res.status(loaded.code).json({ error: loaded.msg, status: loaded.status });
    const { meta } = loaded;
    await db()
      .update(conversations)
      .set({ metadataJson: { ...meta, status: 'discarded', discardedAt: new Date().toISOString() } })
      .where(eq(conversations.id, id));
    return res.json({ ok: true, status: 'discarded' });
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
    const [cards, accs, zones, matrixRows, matrixZoneRows] = await Promise.all([
      db().select().from(rateCards).where(eq(rateCards.tenantId, tid)),
      db().select().from(accessorials).where(eq(accessorials.tenantId, tid)),
      db().select().from(laneZones).where(eq(laneZones.tenantId, tid)),
      db().select().from(rateMatrices).where(eq(rateMatrices.tenantId, tid)),
      db().select().from(rateZones).where(eq(rateZones.tenantId, tid)),
    ]);
    const matrices = matrixRows as unknown as MatrixCellInput[];
    const matrixZones = matrixZoneRows as unknown as ZoneDefInput[];
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
      // Label only — mirrors what the public widget would quote for this
      // carrier. No amount is converted. BOTH-focus tenants label per resolved
      // lane country (delivery first, then pickup).
      currency: currencyForCountry(req.tenant!.countryFocus, parse.data.delivery.country ?? parse.data.pickup.country),
    };
    const fscCtx = await resolveFscForTenant(req.tenant!);
    const result = calculate(cards, accs, zones, calcReq, [], {
      mode: fscCtx.mode,
      perMileUsd: fscCtx.perMileUsd,
      dieselUsd: fscCtx.dieselUsd,
      asOfLabel: fscCtx.asOf ? asOfLabel(fscCtx.asOf) : undefined,
    }, matrices, matrixZones);
    res.json({ miles: dist.miles, origin: dist.origin, destination: dist.destination, result });
  });
}
