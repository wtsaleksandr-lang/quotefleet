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
 * Account-gating seam: `canExport(req)` is a single true-returning stub — Pro
 * limits / auth attach here later (e.g. gate .xlsx behind a plan, lower the cap
 * for anonymous users) without reshaping the generator. The row cap already
 * reads `EXPORT_MAX_ROWS` from the environment via the generator.
 */
import type { Express, Request, Response } from 'express';
import {
  resolveExport,
  renderExportHtml,
  buildExportXlsx,
  buildExportCsv,
} from '../directory/exportSheet.js';
import { publicAutocompleteLimiter } from '../rateLimits.js';

/**
 * Account-gating stub. Returns true for everyone today. Pro limits / auth land
 * here later — return false (or a reason) to deny an export without changing any
 * generation code. Kept as a single function so the gate has ONE home.
 */
export function canExport(_req: Request): boolean {
  return true;
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
  // Branded printable / shareable HTML sheet.
  app.get('/directory/export/view', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      if (!canExport(req)) return res.status(403).type('html').send('<h1>Export unavailable</h1>');
      const resolved = await resolveExport(req.query as Record<string, unknown>, { query: queryOf(req) });
      res.type('html').send(renderExportHtml(resolved));
    } catch (err) {
      next(err);
    }
  });

  // XLSX download.
  app.get('/directory/export.xlsx', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      if (!canExport(req)) return res.status(403).json({ error: 'Export unavailable' });
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
      if (!canExport(req)) return res.status(403).json({ error: 'Export unavailable' });
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
