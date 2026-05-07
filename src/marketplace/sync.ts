/**
 * Marketplace sync — mirrors a tenant's rate book into the cross-tenant
 * `marketplace_*` tables. Called from the tenant CRUD routes after any
 * rate / accessorial / lane-zone / terminal change.
 *
 * What it does (idempotent):
 *   1. Upsert `marketplace_carriers` row (denormalized profile).
 *   2. Recompute `marketplace_lanes` (anchored at ports the tenant
 *      serves, plus a national fallback).
 *   3. Append `marketplace_rate_snapshots` rows ONLY when the latest
 *      snapshot for (service, equipment) differs from current values.
 *      Keeps the snapshot table from exploding on no-op writes.
 *
 * Visibility:
 *   - `marketplace_carriers.visible` mirrors `tenants.marketplace_opt_in`.
 *   - When a tenant flips opt-in OFF, we keep the row but set visible=false.
 *     Snapshots are kept for benchmark aggregation regardless of opt-in
 *     (they're anonymized in the public aggregates view).
 *
 * Background recompute:
 *   - `recomputeMarketplaceAggregates()` scans all snapshots and updates
 *     `marketplace_aggregates`. Run on a cron (~hourly is plenty).
 */
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  tenants,
  rateCards,
  laneZones,
  marketplaceCarriers,
  marketplaceLanes,
  marketplaceRateSnapshots,
  marketplaceAggregates,
  type Tenant,
} from '../db/schema.js';

/**
 * Main entry point — call after any rate / lane-zone / accessorial
 * change for a tenant. Safe to call from request handlers; takes ~50ms.
 *
 * Errors are logged and swallowed: marketplace sync failures must never
 * break the tenant's primary write.
 */
export async function syncTenantToMarketplace(tenantId: number): Promise<void> {
  try {
    const t = (await db().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
    if (!t) return;

    const cards = await db().select().from(rateCards).where(eq(rateCards.tenantId, tenantId));
    const zones = await db().select().from(laneZones).where(eq(laneZones.tenantId, tenantId));

    await upsertCarrierProfile(t, cards);
    await recomputeLanes(tenantId, cards, zones);
    await appendRateSnapshotsIfChanged(tenantId, cards, zones);
  } catch (err) {
    console.warn(`[marketplace.sync] tenantId=${tenantId} failed (non-fatal):`, err);
  }
}

async function upsertCarrierProfile(t: Tenant, cards: typeof rateCards.$inferSelect[]) {
  const enabled = cards.filter((c) => c.enabled);
  const equipmentJson = Array.from(new Set(enabled.map((c) => c.equipment)));
  const servicesJson = Array.from(new Set(enabled.map((c) => c.service)));

  const row = {
    tenantId: t.id,
    displayName: t.name,
    countryFocus: t.countryFocus,
    mcNumber: t.mcNumber,
    dotNumber: t.dotNumber,
    summary: null,
    publicSlug: t.slug,
    equipmentJson,
    servicesJson,
    visible: t.marketplaceOptIn,
    lastSyncedAt: new Date(),
  };

  // Upsert by tenantId (PK).
  await db()
    .insert(marketplaceCarriers)
    .values(row)
    .onConflictDoUpdate({
      target: marketplaceCarriers.tenantId,
      set: {
        displayName: row.displayName,
        countryFocus: row.countryFocus,
        mcNumber: row.mcNumber,
        dotNumber: row.dotNumber,
        publicSlug: row.publicSlug,
        equipmentJson: row.equipmentJson,
        servicesJson: row.servicesJson,
        visible: row.visible,
        lastSyncedAt: row.lastSyncedAt,
      },
    });
}

async function recomputeLanes(
  tenantId: number,
  cards: typeof rateCards.$inferSelect[],
  zones: typeof laneZones.$inferSelect[]
) {
  // Replace-all strategy: delete existing rows, re-insert. Cheaper than
  // diffing for the lane volumes we expect (~10-30 per carrier).
  await db().delete(marketplaceLanes).where(eq(marketplaceLanes.tenantId, tenantId));

  const enabledCards = cards.filter((c) => c.enabled);
  const enabledZones = zones.filter((z) => z.enabled);

  // 1. Port anchors from drayage lane zones.
  const byPort = new Map<string, { equip: Set<string>; services: Set<string>; radius: number }>();
  for (const z of enabledZones) {
    if (!z.anchorPortCode) continue;
    const k = z.anchorPortCode;
    if (!byPort.has(k)) byPort.set(k, { equip: new Set(), services: new Set(), radius: 0 });
    const e = byPort.get(k)!;
    (z.equipmentScope ?? []).forEach((x) => e.equip.add(x));
    e.services.add('drayage');
    if (z.radiusMiles > e.radius) e.radius = z.radiusMiles;
  }
  for (const [code, v] of byPort) {
    await db().insert(marketplaceLanes).values({
      tenantId,
      anchorType: 'port',
      anchorCode: code,
      radiusMiles: v.radius,
      equipmentJson: [...v.equip],
      servicesJson: [...v.services],
      enabled: true,
      updatedAt: new Date(),
    });
  }

  // 2. National fallback for any service the carrier has at least one
  //    enabled rate card for. Tells the marketplace browser "this carrier
  //    accepts X service nationally" before anchor-specific lanes.
  const services = Array.from(new Set(enabledCards.map((c) => c.service)));
  for (const svc of services) {
    const equip = Array.from(
      new Set(enabledCards.filter((c) => c.service === svc).map((c) => c.equipment))
    );
    await db().insert(marketplaceLanes).values({
      tenantId,
      anchorType: 'national',
      anchorCode: 'US', // future: split by countryFocus
      radiusMiles: null,
      equipmentJson: equip,
      servicesJson: [svc],
      enabled: true,
      updatedAt: new Date(),
    });
  }
}

async function appendRateSnapshotsIfChanged(
  tenantId: number,
  cards: typeof rateCards.$inferSelect[],
  zones: typeof laneZones.$inferSelect[]
) {
  // ── per-rate-card snapshots ──────────────────────────────────────
  for (const c of cards) {
    if (!c.enabled) continue;
    const last = (
      await db()
        .select()
        .from(marketplaceRateSnapshots)
        .where(
          and(
            eq(marketplaceRateSnapshots.tenantId, tenantId),
            eq(marketplaceRateSnapshots.service, c.service),
            eq(marketplaceRateSnapshots.equipment, c.equipment)
          )
        )
        .orderBy(desc(marketplaceRateSnapshots.capturedAt))
        .limit(1)
    )[0];
    const changed =
      !last ||
      last.ratePerMile !== c.ratePerMile ||
      last.minimumCharge !== c.minimumCharge ||
      last.flatFee !== c.flatFee ||
      last.fuelSurchargePct !== c.fuelSurchargePct;
    if (!changed) continue;
    await db().insert(marketplaceRateSnapshots).values({
      tenantId,
      service: c.service,
      equipment: c.equipment,
      ratePerMile: c.ratePerMile,
      minimumCharge: c.minimumCharge,
      flatFee: c.flatFee,
      fuelSurchargePct: c.fuelSurchargePct,
      sourceKind: 'rate_card_edit',
      sourceMeta: { rateCardId: c.id },
      capturedAt: new Date(),
    });
  }

  // ── per-lane-zone snapshots (drayage flat tariffs) ────────────────
  for (const z of zones) {
    if (!z.enabled || !z.anchorPortCode) continue;
    const equip = (z.equipmentScope ?? [])[0] ?? 'container_40';
    const last = (
      await db()
        .select()
        .from(marketplaceRateSnapshots)
        .where(
          and(
            eq(marketplaceRateSnapshots.tenantId, tenantId),
            eq(marketplaceRateSnapshots.service, 'drayage'),
            eq(marketplaceRateSnapshots.equipment, equip),
            eq(marketplaceRateSnapshots.laneAnchorCode, z.anchorPortCode)
          )
        )
        .orderBy(desc(marketplaceRateSnapshots.capturedAt))
        .limit(1)
    )[0];
    const changed =
      !last ||
      last.laneRadiusMiles !== z.radiusMiles ||
      last.laneFlatPrice !== z.flatPrice;
    if (!changed) continue;
    await db().insert(marketplaceRateSnapshots).values({
      tenantId,
      service: 'drayage',
      equipment: equip,
      laneAnchorCode: z.anchorPortCode,
      laneRadiusMiles: z.radiusMiles,
      laneFlatPrice: z.flatPrice,
      sourceKind: 'lane_zone_edit',
      sourceMeta: { laneZoneId: z.id },
      capturedAt: new Date(),
    });
  }
}

/**
 * Recompute the anonymized aggregates table. Suitable for an hourly cron.
 * Pulls latest snapshot per (tenant, service, equipment), groups, and
 * computes P25/P50/P75 across tenants.
 *
 * Suppress aggregates with sample size < 5 (caller's responsibility to
 * filter when displaying — we still write the row so we can see growth).
 */
export async function recomputeMarketplaceAggregates(): Promise<void> {
  // National rate-per-mile aggregates (no anchor).
  const nationalRates = await db().execute<{
    service: string;
    equipment: string;
    sample: number;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p25_min: number | null;
    p50_min: number | null;
    p75_min: number | null;
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (tenant_id, service, equipment)
             tenant_id, service, equipment, rate_per_mile, minimum_charge
        FROM marketplace_rate_snapshots
       WHERE lane_anchor_code IS NULL
       ORDER BY tenant_id, service, equipment, captured_at DESC
    )
    SELECT service, equipment,
           COUNT(*)::int AS sample,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY rate_per_mile) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY rate_per_mile) AS p50,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY rate_per_mile) AS p75,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY minimum_charge) AS p25_min,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY minimum_charge) AS p50_min,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY minimum_charge) AS p75_min
      FROM latest
     GROUP BY service, equipment
  `);

  for (const row of nationalRates) {
    await db()
      .insert(marketplaceAggregates)
      .values({
        service: row.service,
        equipment: row.equipment,
        anchorType: null,
        anchorCode: null,
        sampleSize: row.sample,
        p25RatePerMile: row.p25,
        p50RatePerMile: row.p50,
        p75RatePerMile: row.p75,
        p25Minimum: row.p25_min,
        p50Minimum: row.p50_min,
        p75Minimum: row.p75_min,
      })
      .onConflictDoUpdate({
        target: [
          marketplaceAggregates.service,
          marketplaceAggregates.equipment,
          marketplaceAggregates.anchorType,
          marketplaceAggregates.anchorCode,
        ],
        set: {
          sampleSize: row.sample,
          p25RatePerMile: row.p25,
          p50RatePerMile: row.p50,
          p75RatePerMile: row.p75,
          p25Minimum: row.p25_min,
          p50Minimum: row.p50_min,
          p75Minimum: row.p75_min,
          computedAt: new Date(),
        },
      });
  }

  // Per-port flat-tariff aggregates for drayage.
  const portAggs = await db().execute<{
    anchor: string;
    service: string;
    equipment: string;
    sample: number;
    p25: number | null;
    p50: number | null;
    p75: number | null;
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (tenant_id, service, equipment, lane_anchor_code)
             tenant_id, service, equipment, lane_anchor_code, lane_flat_price
        FROM marketplace_rate_snapshots
       WHERE lane_anchor_code IS NOT NULL
       ORDER BY tenant_id, service, equipment, lane_anchor_code, captured_at DESC
    )
    SELECT lane_anchor_code AS anchor, service, equipment,
           COUNT(*)::int AS sample,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY lane_flat_price) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY lane_flat_price) AS p50,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY lane_flat_price) AS p75
      FROM latest
     GROUP BY lane_anchor_code, service, equipment
  `);

  for (const row of portAggs) {
    await db()
      .insert(marketplaceAggregates)
      .values({
        service: row.service,
        equipment: row.equipment,
        anchorType: 'port',
        anchorCode: row.anchor,
        sampleSize: row.sample,
        p25FlatPrice: row.p25,
        p50FlatPrice: row.p50,
        p75FlatPrice: row.p75,
      })
      .onConflictDoUpdate({
        target: [
          marketplaceAggregates.service,
          marketplaceAggregates.equipment,
          marketplaceAggregates.anchorType,
          marketplaceAggregates.anchorCode,
        ],
        set: {
          sampleSize: row.sample,
          p25FlatPrice: row.p25,
          p50FlatPrice: row.p50,
          p75FlatPrice: row.p75,
          computedAt: new Date(),
        },
      });
  }
}
