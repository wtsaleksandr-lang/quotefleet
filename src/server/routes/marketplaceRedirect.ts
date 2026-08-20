/**
 * 301-redirect the retired public marketplace URLs to the directory.
 *
 * The standalone /marketplace page (and its per-carrier page) is superseded by
 * the faceted /directory — same carriers, plus filters, RFQ and export. These
 * routes must be registered BEFORE express.static so the redirect wins over any
 * leftover marketplace*.html still on disk.
 *
 * A marketplace carrier slug uses a different slug scheme from the directory, so
 * a per-slug redirect could land on a missing /directory/carrier page and cache
 * a 301→404; redirecting to the directory root is the safe choice.
 *
 * This retires only the PAGE. The marketplace BACKEND (/api/marketplace/*, the
 * tenant sync in marketplace/sync.ts, the aggregates, and the calculator's
 * market medians) is intentionally left completely untouched.
 *
 * Kept in its own tiny module (express only, no DB/route graph) so the redirect
 * behaviour unit-tests without booting the whole app.
 */
import type { Express } from 'express';

export function registerMarketplaceRedirects(app: Express): void {
  app.get(['/marketplace', '/marketplace/'], (_req, res) => res.redirect(301, '/directory'));
  app.get('/marketplace/carrier/:slug', (_req, res) => res.redirect(301, '/directory'));
}
