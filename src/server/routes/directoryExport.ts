/**
 * Branded carrier-list EXPORT routes — print / share / download of a FILTERED
 * directory carrier list (contacts + services), branded with the QuoteFleet
 * badge. NEW module (does not touch the results-page render or filter sidebar).
 *
 * Routes (all read-only, public, platform-level — no tenant scope):
 *   GET /directory/export/view?<filters>   → branded, print-optimized HTML sheet
 *                                             (this URL IS the share link).
 *   GET /directory/export.xlsx?<filters>    → real .xlsx (SheetJS).
 *   GET /directory/export.csv?<filters>     → plain CSV.
 *
 * Carriers resolve from the SAME directory filter querystring the /directory
 * results page uses (state, equipment[], cargo[], port, fleet/drivers, safety,
 * authority, recent) OR from an explicit `?dots=D1,D2,…` shortlist. Every export
 * is capped at EXPORT_MAX_ROWS with a visible "showing first N of M" note.
 *
 * Account-gating seam: `canExport(req)` gates the DOWNLOADS (.xlsx / .csv)
 * behind Directory Pro entitlement. The branded HTML VIEW (/export/view) stays
 * free — it is the shareable/SEO surface and is only capped by EXPORT_MAX_ROWS.
 * A `DIRECTORY_EXPORT_FREE=1` env kill-switch reopens the downloads to everyone
 * (launch fallback) without a code change.
 */
import type { Express, Request, Response } from 'express';
import {
  resolveExport,
  renderExportHtml,
  buildExportXlsx,
  buildExportCsv,
} from '../directory/exportSheet.js';
import { publicAutocompleteLimiter } from '../rateLimits.js';
import { hasDirectoryPro } from '../directory/entitlement.js';

/**
 * Download gate: spreadsheet exports (.xlsx / .csv) are Directory Pro-only.
 *   • `DIRECTORY_EXPORT_FREE=1` → open to everyone (env kill-switch), else
 *   • a live Directory Pro entitlement (hasDirectoryPro) is required.
 * Never throws — hasDirectoryPro degrades a DB hiccup to "not Pro" (deny), so a
 * gate failure can't 500 the route. The branded HTML view stays ungated.
 */
export async function canExport(req: Request): Promise<boolean> {
  if (process.env.DIRECTORY_EXPORT_FREE === '1') return true;
  return await hasDirectoryPro(req);
}

/** Raw querystring (no leading "?") from the request, for the download links. */
function queryOf(req: Request): string {
  const i = req.originalUrl.indexOf('?');
  return i >= 0 ? req.originalUrl.slice(i + 1) : '';
}

/** yyyy-mm-dd for a stable download filename. */
function fileStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function registerDirectoryExportRoutes(app: Express) {
  // Branded printable / shareable HTML sheet — FREE (the shareable/SEO surface).
  // Downloads below are Pro-gated; the view is only capped by EXPORT_MAX_ROWS.
  app.get('/directory/export/view', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      const resolved = await resolveExport(req.query as Record<string, unknown>, { query: queryOf(req) });
      res.type('html').send(renderExportHtml(resolved));
    } catch (err) {
      next(err);
    }
  });

  // XLSX download.
  app.get('/directory/export.xlsx', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      if (!(await canExport(req))) return res.status(403).json({ error: 'Export is a Directory Pro feature.' });
      const resolved = await resolveExport(req.query as Record<string, unknown>);
      const buf = buildExportXlsx(resolved);
      res
        .status(200)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .setHeader('Content-Disposition', `attachment; filename="quotefleet-carriers-${fileStamp(resolved.generatedAt)}.xlsx"`);
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });

  // CSV download.
  app.get('/directory/export.csv', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      if (!(await canExport(req))) return res.status(403).json({ error: 'Export is a Directory Pro feature.' });
      const resolved = await resolveExport(req.query as Record<string, unknown>);
      const csv = buildExportCsv(resolved);
      res
        .status(200)
        .type('text/csv; charset=utf-8')
        .setHeader('Content-Disposition', `attachment; filename="quotefleet-carriers-${fileStamp(resolved.generatedAt)}.csv"`);
      // Prepend a UTF-8 BOM so Excel opens the "—"/accented cells correctly.
      res.send('﻿' + csv);
    } catch (err) {
      next(err);
    }
  });
}
