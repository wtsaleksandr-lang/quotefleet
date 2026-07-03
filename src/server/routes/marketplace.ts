import type { Express, Request, Response } from 'express';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  marketplaceCarriers,
  marketplaceLanes,
  marketplaceRateSnapshots,
  marketplaceAggregates,
} from '../../db/schema.js';
import { publicAutocompleteLimiter } from '../rateLimits.js';

const MIN_SAMPLE_FOR_PUBLIC = 5;

function confidence(sampleSize: number): 'low' | 'medium' | 'high' {
  if (sampleSize >= 25) return 'high';
  if (sampleSize >= 10) return 'medium';
  return 'low';
}

function visibleAggregate(r: typeof marketplaceAggregates.$inferSelect) {
  return {
    service: r.service,
    equipment: r.equipment,
    anchorType: r.anchorType,
    anchorCode: r.anchorCode,
    sampleSize: r.sampleSize,
    confidence: confidence(r.sampleSize),
    minSample: MIN_SAMPLE_FOR_PUBLIC,
    p25RatePerMile: r.p25RatePerMile,
    p50RatePerMile: r.p50RatePerMile,
    p75RatePerMile: r.p75RatePerMile,
    p25Minimum: r.p25Minimum,
    p50Minimum: r.p50Minimum,
    p75Minimum: r.p75Minimum,
    p25FlatPrice: r.p25FlatPrice,
    p50FlatPrice: r.p50FlatPrice,
    p75FlatPrice: r.p75FlatPrice,
    computedAt: r.computedAt,
  };
}

export function registerMarketplaceRoutes(app: Express) {
  app.get('/api/marketplace/carriers', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const service = req.query.service ? String(req.query.service).toLowerCase() : null;
    const country = req.query.country ? String(req.query.country).toUpperCase() : null;
    const port = req.query.port ? String(req.query.port).toUpperCase() : null;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const perPage = Math.min(50, Math.max(5, parseInt(String(req.query.perPage ?? '20'), 10) || 20));

    const rows = await db().select().from(marketplaceCarriers).where(eq(marketplaceCarriers.visible, true));

    let filtered = rows;
    if (country) filtered = filtered.filter((r) => r.countryFocus === country || r.countryFocus === 'BOTH');
    if (service) filtered = filtered.filter((r) => (r.servicesJson ?? []).includes(service));

    if (port) {
      const tenantsAtPort = await db()
        .select({ tenantId: marketplaceLanes.tenantId })
        .from(marketplaceLanes)
        .where(and(eq(marketplaceLanes.anchorType, 'port'), eq(marketplaceLanes.anchorCode, port)));
      const set = new Set(tenantsAtPort.map((r) => r.tenantId));
      filtered = filtered.filter((r) => set.has(r.tenantId));
    }

    const total = filtered.length;
    const slice = filtered.slice((page - 1) * perPage, page * perPage);

    return res.json({
      carriers: slice.map((c) => ({
        slug: c.publicSlug,
        displayName: c.displayName,
        countryFocus: c.countryFocus,
        mcNumber: c.mcNumber,
        dotNumber: c.dotNumber,
        services: c.servicesJson ?? [],
        equipment: c.equipmentJson ?? [],
        summary: c.summary,
      })),
      total,
      page,
      perPage,
    });
  });

  app.get('/api/marketplace/carrier/:slug', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const slug = String(req.params.slug ?? '').toLowerCase().trim();
    const row = (
      await db().select().from(marketplaceCarriers).where(eq(marketplaceCarriers.publicSlug, slug)).limit(1)
    )[0];
    if (!row || !row.visible) return res.status(404).json({ error: 'Carrier not listed.' });

    const snapshots = await db()
      .select()
      .from(marketplaceRateSnapshots)
      .where(eq(marketplaceRateSnapshots.tenantId, row.tenantId))
      .orderBy(desc(marketplaceRateSnapshots.capturedAt))
      .limit(500);

    const seen = new Set<string>();
    const current = snapshots.filter((s) => {
      const k = [s.service, s.equipment, s.laneAnchorCode ?? ''].join(':');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const lanes = await db().select().from(marketplaceLanes).where(eq(marketplaceLanes.tenantId, row.tenantId));

    return res.json({
      carrier: {
        slug: row.publicSlug,
        displayName: row.displayName,
        countryFocus: row.countryFocus,
        mcNumber: row.mcNumber,
        dotNumber: row.dotNumber,
        services: row.servicesJson ?? [],
        equipment: row.equipmentJson ?? [],
      },
      lanes: lanes.map((l) => ({
        anchorType: l.anchorType,
        anchorCode: l.anchorCode,
        radiusMiles: l.radiusMiles,
        services: l.servicesJson ?? [],
        equipment: l.equipmentJson ?? [],
      })),
      currentRates: current.map((s) => ({
        service: s.service,
        equipment: s.equipment,
        ratePerMile: s.ratePerMile,
        minimumCharge: s.minimumCharge,
        flatFee: s.flatFee,
        fuelSurchargePct: s.fuelSurchargePct,
        laneAnchorCode: s.laneAnchorCode,
        laneRadiusMiles: s.laneRadiusMiles,
        laneFlatPrice: s.laneFlatPrice,
        capturedAt: s.capturedAt,
      })),
    });
  });

  app.get('/api/marketplace/benchmarks', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const service = req.query.service ? String(req.query.service).toLowerCase() : null;
    const equipment = req.query.equipment ? String(req.query.equipment).toLowerCase() : null;
    const port = req.query.port ? String(req.query.port).toUpperCase() : null;

    let rows = await db().select().from(marketplaceAggregates);
    if (service) rows = rows.filter((r) => r.service === service);
    if (equipment) rows = rows.filter((r) => r.equipment === equipment);
    if (port) rows = rows.filter((r) => r.anchorType === 'port' && r.anchorCode === port);
    const visible = rows.filter((r) => r.sampleSize >= MIN_SAMPLE_FOR_PUBLIC);

    return res.json({
      benchmarks: visible.map(visibleAggregate),
      suppressed: rows.length - visible.length,
      minSample: MIN_SAMPLE_FOR_PUBLIC,
      confidenceLegend: {
        low: '5-9 samples',
        medium: '10-24 samples',
        high: '25+ samples',
      },
    });
  });

  app.get('/api/marketplace/aggregates', publicAutocompleteLimiter, async (_req, res) => {
    const rows = await db()
      .select()
      .from(marketplaceAggregates)
      .where(sql`${marketplaceAggregates.sampleSize} >= ${MIN_SAMPLE_FOR_PUBLIC}`);
    res.json({
      aggregates: rows.map(visibleAggregate),
      minSample: MIN_SAMPLE_FOR_PUBLIC,
      confidenceLegend: {
        low: '5-9 samples',
        medium: '10-24 samples',
        high: '25+ samples',
      },
    });
  });
}
