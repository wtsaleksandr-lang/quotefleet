/**
 * SUPER-ADMIN outreach routes — Phase 1 of the AI Outreach Engine.
 *
 *   POST /api/admin/outreach/enrich     { domain }  → CompanyProfile JSON
 *   POST /api/admin/outreach/provision  { domain }  → { demoUrl, token, profile }
 *
 * Internal tool only: both gated by requireAuth + requireSuperAdmin.
 *   - enrich turns a domain into a structured profile (deterministic parse + AI
 *     + optional FMCSA). No side effects.
 *   - provision goes further: it enriches, derives a mode-appropriate SAMPLE
 *     calculator config + brand, and upserts a `prospect_demos` row (dedupe by
 *     domain) — a LIGHTWEIGHT preview, NOT a tenant. It returns a shareable
 *     /demo/:token URL. No tenant/user/lead row is ever created.
 *
 * The provision logic depends on injected `enrich` + `store` so tests exercise
 * it without the network or the DB.
 */
import type { Express } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../middleware.js';
import { enrichCompany, normalizeDomain, type CompanyProfile } from '../outreach/enrichCompany.js';
import { deriveDemoConfig, deriveDemoBrand } from '../outreach/prospectDemo.js';
import { dbProspectDemoStore, type ProspectDemoStore } from '../outreach/prospectDemoStore.js';
import { loadEnv } from '../../config.js';

const DomainBody = z.object({
  domain: z.string().min(3).max(255),
});

/** Injectable deps so provision is unit-testable without network / DB. */
export interface OutreachRouteDeps {
  enrich?: (domain: string) => Promise<CompanyProfile>;
  store?: ProspectDemoStore;
}

/** Build the public, shareable demo URL for a token. */
export function demoUrlForToken(token: string): string {
  const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${base}/demo/${token}`;
}

export function registerOutreachRoutes(app: Express, deps: OutreachRouteDeps = {}) {
  const enrich = deps.enrich ?? ((domain: string) => enrichCompany(domain));
  const store = deps.store ?? dbProspectDemoStore;

  app.post('/api/admin/outreach/enrich', requireAuth, requireSuperAdmin, async (req, res) => {
    const parse = DomainBody.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'A domain is required.' });
    }
    const domain = normalizeDomain(parse.data.domain);
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return res.status(400).json({ error: 'That does not look like a valid domain.' });
    }
    try {
      const profile = await enrich(domain);
      return res.json({ ok: true, profile });
    } catch (err) {
      // enrichCompany is designed not to throw, but guard anyway so a super
      // admin never sees a raw stack. Log server-side.
      console.error('[outreach/enrich] error:', err);
      return res.status(500).json({ error: 'Enrichment failed. Try again or check server logs.' });
    }
  });

  // Provision (or refresh) a shareable branded demo page for a domain. Dedupe
  // by domain: re-provisioning the same domain updates the existing demo and
  // keeps its token/URL stable.
  app.post('/api/admin/outreach/provision', requireAuth, requireSuperAdmin, async (req, res) => {
    const parse = DomainBody.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'A domain is required.' });
    }
    const domain = normalizeDomain(parse.data.domain);
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return res.status(400).json({ error: 'That does not look like a valid domain.' });
    }
    try {
      const profile = await enrich(domain);
      const config = deriveDemoConfig(profile);
      const brand = deriveDemoBrand(profile);
      const row = await store.upsert({
        domain,
        companyName: profile.companyName,
        profileJson: profile as unknown as Record<string, unknown>,
        brandJson: brand,
        configJson: config,
      });
      return res.json({
        ok: true,
        token: row.token,
        demoUrl: demoUrlForToken(row.token),
        profile,
      });
    } catch (err) {
      console.error('[outreach/provision] error:', err);
      return res.status(500).json({ error: 'Provisioning failed. Try again or check server logs.' });
    }
  });
}
