import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { platformSettings } from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';

const CarrierProfileSchema = z.object({
  addressLine1: z.string().max(160).nullable().optional(),
  addressLine2: z.string().max(160).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(80).nullable().optional(),
  postalCode: z.string().max(40).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  scac: z.string().max(20).nullable().optional(),
  websiteUrl: z.string().max(300).nullable().optional(),
  quoteContactName: z.string().max(120).nullable().optional(),
  quoteFooterText: z.string().max(1000).nullable().optional(),
  quoteTermsText: z.string().max(2000).nullable().optional(),
});

function keyForTenant(tenantId: number): string {
  return `tenant:${tenantId}:carrier-profile`;
}

function normalize(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v.trim() || null;
    else out[k] = v ?? null;
  }
  return out;
}

export async function loadCarrierProfile(tenantId: number): Promise<Record<string, unknown>> {
  const row = (
    await db()
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, keyForTenant(tenantId)))
      .limit(1)
  )[0];
  if (!row) return {};
  try {
    return JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function registerCarrierProfileRoutes(app: Express) {
  app.get('/api/tenant/carrier-profile', requireAuth, requireTenant, async (req: Request, res: Response) => {
    return res.json({ profile: await loadCarrierProfile(req.tenant!.id) });
  });

  app.put('/api/tenant/carrier-profile', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const parsed = CarrierProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    const profile = normalize(parsed.data);
    await db()
      .insert(platformSettings)
      .values({ key: keyForTenant(req.tenant!.id), value: JSON.stringify(profile), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: JSON.stringify(profile), updatedAt: new Date() },
      });
    return res.json({ ok: true, profile });
  });
}
