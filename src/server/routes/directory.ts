/**
 * PUBLIC carrier-directory read API — no auth. Backs the browsable US
 * motor-carrier directory (carrier_directory table, populated by
 * scripts/ingestFmcsaCarriers.ts from FMCSA's free public data).
 *
 *   GET /api/public/directory?state=XX&port=YY&intermodal=1&page=N
 *        → paginated carrier list (read-only, sane page sizes).
 *   GET /api/public/directory/summary
 *        → carrier counts per state and per port (+ intermodal total).
 *
 * Read-only + platform-level (no tenant scope). Uses the shared public
 * autocomplete rate limiter, same as the marketplace read routes.
 */
import type { Express, Request, Response } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierDirectory } from '../../db/schema.js';
import { CONTAINER_PORTS, portByCode } from '../directory/containerPorts.js';
import { publicAutocompleteLimiter } from '../rateLimits.js';

const DEFAULT_PER_PAGE = 24;
const MAX_PER_PAGE = 50;

/** Shape one carrier row for the public list (drops internal ids). */
function visibleCarrier(r: typeof carrierDirectory.$inferSelect) {
  return {
    slug: r.publicSlug,
    legalName: r.legalName,
    dbaName: r.dbaName,
    usdot: r.usdot,
    mcNumber: r.mcNumber,
    city: r.city,
    state: r.state,
    zip: r.zip,
    phone: r.phone,
    powerUnits: r.powerUnits,
    drivers: r.drivers,
    safetyRating: r.safetyRating,
    authorityType: r.authorityType,
    intermodal: r.intermodal,
    nearestPortCode: r.nearestPortCode,
  };
}

export function registerDirectoryRoutes(app: Express) {
  // ── Paginated, filterable carrier list ─────────────────────────────────
  app.get('/api/public/directory', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const state = req.query.state ? String(req.query.state).toUpperCase().slice(0, 2) : null;
    const port = req.query.port ? String(req.query.port).toUpperCase().slice(0, 8) : null;
    const intermodalOnly = ['1', 'true', 'yes'].includes(String(req.query.intermodal ?? '').toLowerCase());
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const perPage = Math.min(
      MAX_PER_PAGE,
      Math.max(5, parseInt(String(req.query.perPage ?? String(DEFAULT_PER_PAGE)), 10) || DEFAULT_PER_PAGE),
    );

    const conditions = [];
    if (state) conditions.push(eq(carrierDirectory.state, state));
    if (port) conditions.push(eq(carrierDirectory.nearestPortCode, port));
    if (intermodalOnly) conditions.push(eq(carrierDirectory.intermodal, true));
    const where = conditions.length ? and(...conditions) : undefined;

    const totalRow = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(where);
    const total = totalRow[0]?.n ?? 0;

    const rows = await db()
      .select()
      .from(carrierDirectory)
      .where(where)
      // Stable, name-ordered browse; id breaks ties for deterministic paging.
      .orderBy(asc(carrierDirectory.legalName), asc(carrierDirectory.id))
      .limit(perPage)
      .offset((page - 1) * perPage);

    return res.json({
      carriers: rows.map(visibleCarrier),
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      filters: { state, port, intermodal: intermodalOnly },
    });
  });

  // ── Counts per state + per port (for the directory index / facets) ─────
  app.get('/api/public/directory/summary', publicAutocompleteLimiter, async (_req: Request, res: Response) => {
    const byStateRows = await db()
      .select({ state: carrierDirectory.state, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .groupBy(carrierDirectory.state);

    const byPortRows = await db()
      .select({ port: carrierDirectory.nearestPortCode, n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .groupBy(carrierDirectory.nearestPortCode);

    const intermodalRow = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(carrierDirectory)
      .where(eq(carrierDirectory.intermodal, true));

    const byState = byStateRows
      .filter((r) => r.state)
      .map((r) => ({ state: r.state as string, count: r.n }))
      .sort((a, b) => b.count - a.count);

    const portCountByCode = new Map(byPortRows.filter((r) => r.port).map((r) => [r.port as string, r.n]));
    // Present all seeded ports (0 when none loaded yet) with name/city metadata.
    const byPort = CONTAINER_PORTS.map((p) => ({
      code: p.code,
      name: p.name,
      city: p.city,
      state: p.state,
      count: portCountByCode.get(p.code) ?? 0,
    })).sort((a, b) => b.count - a.count);

    const total = byState.reduce((s, r) => s + r.count, 0);

    return res.json({
      total,
      intermodalTotal: intermodalRow[0]?.n ?? 0,
      states: byState.length,
      byState,
      byPort,
    });
  });
}

// Re-export for callers that want the port list without importing two modules.
export { portByCode };
