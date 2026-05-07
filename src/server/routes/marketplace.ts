/**
 * PUBLIC marketplace API. Reads from `marketplace_*` tables.
 *
 *   GET /api/marketplace/carriers
 *     ?service=drayage|ftl|ltl|expedited|hotshot
 *     ?country=US|CA
 *     ?port=USLAX
 *     → list of opted-in carriers (paginated). Returns name, location,
 *       services + equipment, MC#, DOT#. NO rates inline (use /carrier/:slug).
 *
 *   GET /api/marketplace/carrier/:slug
 *     → full carrier profile + their CURRENT rate snapshots.
 *
 *   GET /api/marketplace/benchmarks
 *     ?service=ftl ?equipment=dryvan ?port=USLAX
 *     → anonymized P25/P50/P75 across ALL carriers (opted-in or not),
 *       with sample size. Rendered as "your $2.55/mi vs national
 *       median $2.30 (P25 $2.10, P75 $2.55, sample N=42)".
 *
 *   GET /api/marketplace/aggregates
 *     → bulk dump of all aggregates for the dashboards.
 */
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

// Aggregates with sample size below this are suppressed from the public
// API to prevent triangulation back to specific carriers.
const MIN_SAMPLE_FOR_PUBLIC = 5;

export function registerMarketplaceRoutes(app: Express) {
  // ── carrier directory ───────────────────────────────────────────
  app.get('/api/marketplace/carriers', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const service = req.query.service ? String(req.query.service).toLowerCase() : null;
    const country = req.query.country ? String(req.query.country).toUpperCase() : null;
    const port = req.query.port ? String(req.query.port).toUpperCase() : null;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const perPage = Math.min(50, Math.max(5, parseInt(String(req.query.perPage ?? '20'), 10) || 20));

    // Visible carriers only. Service / country filter applied in JS;
    // jsonb array containment varies by Postgres version.
    const rows = await db().select().from(marketplaceCarriers).where(eq(marketplaceCarriers.visible, true));

    let filtered = rows;
    if (country) filtered = filtered.filter((r) => r.countryFocus === country || r.countryFocus === 'BOTH');
    if (service) filtered = filtered.filter((r) => (r.servicesJson ?? []).includes(service));

    // If a port filter is given, intersect with marketplace_lanes so
    // we only return carriers serving that anchor.
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

  // ── single carrier with current rate snapshots ───────────────────
  app.get('/api/marketplace/carrier/:slug', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const slug = String(req.params.slug ?? '').toLowerCase().trim();
    const row = (
      await db().select().from(marketplaceCarriers).where(eq(marketplaceCarriers.publicSlug, slug)).limit(1)
    )[0];
    if (!row || !row.visible) return res.status(404).json({ error: 'Carrier not listed.' });

    // Current rate snapshots = latest per (service, equipment, lane_anchor).
    // For a small N (1-10s of rates per tenant) we just pull recent and dedupe in JS.
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

  // ── anonymized benchmarks ────────────────────────────────────────
  // Public, no auth, no opt-in required because aggregates are anonymized.
  // Suppress aggregates with sample size < 5.
  app.get('/api/marketplace/benchmarks', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const service = req.query.service ? String(req.query.service).toLowerCase() : null;
    const equipment = req.query.equipment ? String(req.query.equipment).toLowerCase() : null;
    const port = req.query.port ? String(req.query.port).toUpperCase() : null;

    let rows = await db().select().from(marketplaceAggregates);
    if (service) rows = rows.filter((r) => r.service === service);
    if (equipment) rows = rows.filter((r) => r.equipment === equipment);
    if (port) {
      rows = rows.filter((r) => r.anchorType === 'port' && r.anchorCode === port);
    }
    const visible = rows.filter((r) => r.sampleSize >= MIN_SAMPLE_FOR_PUBLIC);

    return res.json({
      benchmarks: visible.map((r) => ({
        service: r.service,
        equipment: r.equipment,
        anchorType: r.anchorType,
        anchorCode: r.anchorCode,
        sampleSize: r.sampleSize,
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
      })),
      suppressed: rows.length - visible.length,
      minSample: MIN_SAMPLE_FOR_PUBLIC,
    });
  });

  // Convenience: bulk dump for the in-app dashboard chart.
  app.get('/api/marketplace/aggregates', publicAutocompleteLimiter, async (_req, res) => {
    const rows = await db()
      .select({
        service: marketplaceAggregates.service,
        equipment: marketplaceAggregates.equipment,
        anchorType: marketplaceAggregates.anchorType,
        anchorCode: marketplaceAggregates.anchorCode,
        sampleSize: marketplaceAggregates.sampleSize,
        p50RatePerMile: marketplaceAggregates.p50RatePerMile,
        p50FlatPrice: marketplaceAggregates.p50FlatPrice,
      })
      .from(marketplaceAggregates)
      .where(sql`${marketplaceAggregates.sampleSize} >= ${MIN_SAMPLE_FOR_PUBLIC}`);
    res.json({ aggregates: rows, minSample: MIN_SAMPLE_FOR_PUBLIC });
  });
}
