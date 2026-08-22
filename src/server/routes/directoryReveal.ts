/**
 * Directory Pro — "Reveal additional contacts" endpoint (PR C).
 *
 *   POST /api/directory/carrier/:usdot/reveal
 *
 * Gated by `hasDirectoryPro` (403 for free / anonymous). For a Pro shipper it
 * returns the ADDITIONAL enriched contacts for the carrier — scraped from the
 * carrier's own website via `enrichCompany`, cached in `carrier_contacts`, and
 * ALWAYS separate from the free FMCSA phone/email (never re-tiered). Returns an
 * HTML fragment the profile's inline script swaps into `.cp-reveal-result`
 * (and which also stands alone as the no-JS POST response).
 *
 * Cost governor (two levers, both env-configurable):
 *   • TTL cache — a per-DOT attempt marker (DIRECTORY_ENRICH_TTL_DAYS, def 60)
 *     means a fresh/empty domain is served from cache, never re-scraped.
 *   • Per-user DAILY cap — DIRECTORY_REVEAL_DAILY_CAP (def 50) FRESH reveals per
 *     UTC day (each = 1 AI call + up to 3 fetches), metered in
 *     directory_reveal_usage. A cached reveal is free and never counts.
 * Plus a coarse per-IP burst limiter (directoryRevealLimiter).
 *
 * HARD RULE: never 500. Any enrichment / DB failure degrades to a 200 with an
 * empty "no additional contacts" fragment.
 */
import type { Express, Request, Response } from 'express';
import { directoryRevealLimiter } from '../rateLimits.js';
import { directoryIdentity, hasDirectoryPro } from '../directory/entitlement.js';
import { dbRevealStore, revealContacts, type RevealStore } from '../directory/carrierContacts.js';
import {
  currentRevealPeriod,
  dbRevealUsageStore,
  revealDailyCap,
  type RevealUsageStore,
} from '../directory/revealUsage.js';
import { renderRevealedContacts, renderRevealMessage } from '../directory/revealRender.js';
import type { enrichCompany } from '../outreach/enrichCompany.js';

export interface RevealRouteDeps {
  /** Contact cache + carrier lookup seam (DB-backed by default). */
  store?: RevealStore;
  /** Daily reveal meter seam (DB-backed by default). */
  usage?: RevealUsageStore;
  /** Enrichment fn seam (real network + AI by default). */
  enrich?: typeof enrichCompany;
  /** Override the daily cap (defaults to DIRECTORY_REVEAL_DAILY_CAP / 50). */
  cap?: number;
  /** Clock seam for the meter period. */
  now?: () => Date;
}

/** Testable handler — mock entitlement + inject seams; no express app needed. */
export async function handleReveal(req: Request, res: Response, deps: RevealRouteDeps = {}): Promise<void> {
  try {
    // Gate: Pro-only. Free / anonymous callers never see the enriched data.
    if (!(await hasDirectoryPro(req))) {
      res
        .status(403)
        .type('html')
        .send(renderRevealMessage('Additional contacts are a Directory Pro feature.', 'error'));
      return;
    }

    const identity = await directoryIdentity(req);
    const accountKey = `user:${identity.userId ?? 'anon'}`;
    const period = currentRevealPeriod(deps.now ? deps.now() : undefined);
    const cap = deps.cap ?? revealDailyCap();
    const usage = deps.usage ?? dbRevealUsageStore;
    const store = deps.store ?? dbRevealStore;

    const result = await revealContacts(String(req.params.usdot ?? ''), {
      store,
      enrich: deps.enrich,
      // Only a FRESH reveal (an actual enrich) reaches this hook — check the
      // per-user daily cap, then meter this reveal. Cached reveals never call it.
      onBeforeEnrich: async () => {
        const used = await usage.getReveals(accountKey, period);
        if (used >= cap) return false;
        await usage.increment(accountKey, period);
        return true;
      },
    });

    if (result.status === 'capped') {
      // A cap hit is expected cost-control, NOT an error — log, don't throw.
      console.log(`[directory.reveal] daily reveal cap (${cap}) reached for ${accountKey}`);
      res
        .status(200)
        .type('html')
        .send(renderRevealMessage(`Daily reveal limit reached (${cap}/day). More reveals unlock tomorrow.`, 'error'));
      return;
    }

    res.status(200).type('html').send(renderRevealedContacts(result.contacts));
  } catch (err) {
    // Absolute backstop: the reveal must NEVER 500. Degrade to an empty result.
    console.warn('[directory.reveal] handler error; returning empty fragment:', err);
    res.status(200).type('html').send(renderRevealedContacts([]));
  }
}

export function registerDirectoryRevealRoutes(app: Express, deps: RevealRouteDeps = {}): void {
  app.post('/api/directory/carrier/:usdot/reveal', directoryRevealLimiter, (req: Request, res: Response) =>
    handleReveal(req, res, deps),
  );
}
