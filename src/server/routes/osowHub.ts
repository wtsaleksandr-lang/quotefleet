/**
 * ROUTE REGISTRATION FOR THE `/oversize` REFERENCE HUB.
 *
 * Every page is a pure function of the compiled jurisdiction data and the
 * as-of date, so **the whole hub renders with the database unreachable** — no
 * store is touched, nothing billable is called, and the HTML is byte-identical
 * for every visitor, which is why it takes the same public cache headers as the
 * other free tools.
 *
 * ORDERING IS LOAD-BEARING. The fixed paths are registered BEFORE the
 * `/oversize/:state` catch-all, and the catch-all calls `next()` for any slug
 * that is not a covered state rather than rendering an empty profile — a
 * jurisdiction with no file behind it must 404 into the site's own not-found
 * page, not into a page shaped like an answer.
 *
 * There is also a JSON mirror at `/api/oversize/coverage`, for the same reason
 * the seasonal tool has one: a dispatcher's own TMS being able to poll which
 * states we hold, and how fresh each one is, is the point.
 */
import type { Express, Request, Response } from 'express';
import { todayIso } from '../../calc/osow/provenance.js';
import { osowRulesFor } from '../../calc/osow/jurisdictions/index.js';
import { isInEffect } from '../../calc/osow/provenance.js';
import { setPublicDirectoryCache } from '../directory/httpCache.js';
import {
  HUB_COVERED_STATES,
  HUB_STATES,
  OSOW_HUB_PATH,
  bandConflictsFor,
  conflictEntriesFor,
  hubStateBySlug,
  hubStatePath,
  provenanceFor,
} from '../osow/hubData.js';
import {
  renderCoverage,
  renderEscortRequirements,
  renderHub,
  renderLegalLimits,
  renderPermitFees,
  renderPoliceEscorts,
  renderSourceNotes,
  renderStatePage,
  renderSuperloads,
} from '../osow/hubPages.js';
import {
  renderBridgeFormulaExplainer,
  renderCommonFigures,
  renderFederalLimits,
  renderNonDivisible,
} from '../osow/federalPages.js';

const SITE = 'https://quotefleet.net';

/** The fixed pages, in nav order. Also the list the sitemap reads. */
export const OSOW_HUB_PAGES: ReadonlyArray<{
  path: string;
  render: (asOf: string) => string;
  changefreq: string;
  priority: string;
}> = [
  { path: OSOW_HUB_PATH, render: renderHub, changefreq: 'weekly', priority: '0.8' },
  { path: `${OSOW_HUB_PATH}/legal-limits`, render: renderLegalLimits, changefreq: 'monthly', priority: '0.8' },
  { path: `${OSOW_HUB_PATH}/permit-fees`, render: renderPermitFees, changefreq: 'monthly', priority: '0.8' },
  {
    path: `${OSOW_HUB_PATH}/escort-requirements`,
    render: renderEscortRequirements,
    changefreq: 'monthly',
    priority: '0.8',
  },
  { path: `${OSOW_HUB_PATH}/superloads`, render: renderSuperloads, changefreq: 'monthly', priority: '0.7' },
  { path: `${OSOW_HUB_PATH}/police-escorts`, render: renderPoliceEscorts, changefreq: 'monthly', priority: '0.7' },
  { path: `${OSOW_HUB_PATH}/source-notes`, render: renderSourceNotes, changefreq: 'monthly', priority: '0.7' },
  { path: `${OSOW_HUB_PATH}/common-figures`, render: renderCommonFigures, changefreq: 'monthly', priority: '0.7' },
  { path: `${OSOW_HUB_PATH}/federal-limits`, render: () => renderFederalLimits(), changefreq: 'yearly', priority: '0.7' },
  {
    path: `${OSOW_HUB_PATH}/bridge-formula`,
    render: () => renderBridgeFormulaExplainer(),
    changefreq: 'yearly',
    priority: '0.7',
  },
  { path: `${OSOW_HUB_PATH}/non-divisible`, render: () => renderNonDivisible(), changefreq: 'yearly', priority: '0.7' },
  { path: `${OSOW_HUB_PATH}/coverage`, render: renderCoverage, changefreq: 'monthly', priority: '0.6' },
];

export function registerOsowHubRoutes(app: Express) {
  for (const page of OSOW_HUB_PAGES) {
    app.get([page.path, `${page.path}/`], (req: Request, res: Response, next) => {
      try {
        setPublicDirectoryCache(req, res);
        res.type('html').send(page.render(todayIso()));
      } catch (err) {
        next(err);
      }
    });
  }

  /**
   * The per-state profile. `next()` — not a 404 body — for anything that is not
   * a covered state, so an uncovered slug lands on the site's own not-found
   * page rather than on a page shaped like an answer with nothing in it.
   */
  app.get(`${OSOW_HUB_PATH}/:state`, (req: Request, res: Response, next) => {
    try {
      const state = hubStateBySlug(String(req.params.state ?? ''));
      if (state === null || !state.covered) return next();
      setPublicDirectoryCache(req, res);
      return res.type('html').send(renderStatePage(state, todayIso()));
    } catch (err) {
      return next(err);
    }
  });

  /**
   * JSON mirror of the coverage page. No auth and no limiter beyond the global
   * one: it is a read of compiled constants, it is CDN-cacheable, and it never
   * touches the database.
   */
  app.get('/api/oversize/coverage', (req: Request, res: Response, next) => {
    try {
      const asOf = todayIso();
      setPublicDirectoryCache(req, res);
      return res.json({
        asOf,
        disclaimer:
          'Every figure behind these pages carries the state document it came from, that document\'s own revision date, and the date we retrieved it. Where two in-effect official documents disagree, no value is adopted.',
        coveredCount: HUB_COVERED_STATES.length,
        totalCount: HUB_STATES.length,
        states: HUB_STATES.map((s) => {
          const rules = s.covered ? osowRulesFor(s.code) : null;
          const prov = rules === null ? null : provenanceFor(rules);
          return {
            code: s.code,
            name: s.name,
            covered: s.covered,
            page: s.covered ? `${SITE}${hubStatePath(s.slug)}` : null,
            sourceDocuments: prov?.count ?? 0,
            oldestRevision: prov?.oldestRevision ?? null,
            lastRetrieved: prov?.lastRetrieved ?? null,
            escortRulesInEffect:
              rules === null ? 0 : rules.escortRules.filter((r) => isInEffect(r, asOf)).length,
            sourceConflicts: s.covered
              ? conflictEntriesFor(s, asOf).length + bandConflictsFor(s, asOf).length
              : 0,
          };
        }),
      });
    } catch (err) {
      return next(err);
    }
  });
}
