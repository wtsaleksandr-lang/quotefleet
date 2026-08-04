/**
 * SUPER-ADMIN outreach routes — Phase 1 of the AI Outreach Engine.
 *
 *   POST /api/admin/outreach/enrich  { domain }  → CompanyProfile JSON
 *
 * Internal tool only: gated by requireAuth + requireSuperAdmin. Turns a freight
 * company's domain into a structured profile (deterministic HTML parse + AI
 * inference + optional FMCSA). No provisioning, no email, no sending — those
 * are later PRs.
 */
import type { Express } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../middleware.js';
import { enrichCompany, normalizeDomain } from '../outreach/enrichCompany.js';

const EnrichBody = z.object({
  domain: z.string().min(3).max(255),
});

export function registerOutreachRoutes(app: Express) {
  app.post('/api/admin/outreach/enrich', requireAuth, requireSuperAdmin, async (req, res) => {
    const parse = EnrichBody.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'A domain is required.' });
    }
    const domain = normalizeDomain(parse.data.domain);
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return res.status(400).json({ error: 'That does not look like a valid domain.' });
    }
    try {
      const profile = await enrichCompany(domain);
      return res.json({ ok: true, profile });
    } catch (err) {
      // enrichCompany is designed not to throw, but guard anyway so a super
      // admin never sees a raw stack. Log server-side.
      console.error('[outreach/enrich] error:', err);
      return res.status(500).json({ error: 'Enrichment failed. Try again or check server logs.' });
    }
  });
}
