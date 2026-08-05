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
import { dbOutreachEmailStore, type OutreachEmailStore } from '../outreach/outreachEmailStore.js';
import { draftOutreachEmail, type DraftedEmail } from '../outreach/draftEmail.js';
import { sendOutreachEmail, type SendOutreachInput, type SendOutreachResult } from '../outreach/sendOutreach.js';
import type { OutreachEmail } from '../../db/schema.js';
import { loadEnv } from '../../config.js';

const DomainBody = z.object({
  domain: z.string().min(3).max(255),
});

const SendBody = z.object({
  domain: z.string().min(3).max(255).optional(),
  emailId: z.number().int().positive().optional(),
  to: z.string().email().optional(),
});

/** Injectable deps so provision is unit-testable without network / DB. */
export interface OutreachRouteDeps {
  enrich?: (domain: string) => Promise<CompanyProfile>;
  store?: ProspectDemoStore;
  emailStore?: OutreachEmailStore;
  /** Override the drafter (tests). Defaults to the real draftOutreachEmail. */
  draft?: (profile: CompanyProfile, demoUrl: string) => Promise<DraftedEmail>;
  /** Override the sender (tests). Defaults to the real sendOutreachEmail. */
  send?: (input: SendOutreachInput) => Promise<SendOutreachResult>;
}

/** Build the public, shareable demo URL for a token. */
export function demoUrlForToken(token: string): string {
  const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${base}/demo/${token}`;
}

export function registerOutreachRoutes(app: Express, deps: OutreachRouteDeps = {}) {
  const enrich = deps.enrich ?? ((domain: string) => enrichCompany(domain));
  const store = deps.store ?? dbProspectDemoStore;
  const emailStore = deps.emailStore ?? dbOutreachEmailStore;
  const draft =
    deps.draft ??
    ((profile: CompanyProfile, demoUrl: string) =>
      draftOutreachEmail(profile, demoUrl, { publicBaseUrl: loadEnv().PUBLIC_BASE_URL }));
  const send =
    deps.send ?? ((input: SendOutreachInput) => sendOutreachEmail(input, { store: emailStore }));

  // Ensure a persisted draft exists for a domain: reuse the existing demo's
  // stored profile when present (no re-enrich), else enrich + provision a demo
  // now so the email always links to a real preview. Drafts the email against
  // the prospect's OWN branded demo URL and persists it. Returns the saved row +
  // the drafted email + the demo URL — shared by draft-email and send.
  async function ensureDraftRow(
    domain: string,
  ): Promise<{ row: OutreachEmail; email: DraftedEmail; demoUrl: string }> {
    let demo = await store.getByDomain(domain);
    let profile: CompanyProfile;
    if (demo && demo.profileJson) {
      profile = demo.profileJson as unknown as CompanyProfile;
    } else {
      profile = await enrich(domain);
      const config = deriveDemoConfig(profile);
      const brand = deriveDemoBrand(profile);
      demo = await store.upsert({
        domain,
        companyName: profile.companyName,
        profileJson: profile as unknown as Record<string, unknown>,
        brandJson: brand,
        configJson: config,
      });
    }
    const demoUrl = demoUrlForToken(demo.token);
    const email = await draft(profile, demoUrl);
    const row = await emailStore.saveDraft({
      demoToken: demo.token,
      domain,
      recipientEmail: profile.email ?? null,
      unsubscribeToken: email.unsubscribeToken,
      subject: email.subject,
      bodyHtml: email.bodyHtml,
      bodyText: email.bodyText,
      aiGenerated: email.aiGenerated,
    });
    return { row, email, demoUrl };
  }

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

  // Draft a personalized, CASL/CAN-SPAM-compliant outreach email for a domain.
  // Ensures a demo exists (reusing its stored profile, or enriching + provisioning
  // one if absent), drafts the email against the prospect's OWN branded demo URL,
  // persists the draft (so Phase 3 can send the exact reviewed copy), and returns
  // the subject + HTML/text body for human review. Never sends anything.
  app.post('/api/admin/outreach/draft-email', requireAuth, requireSuperAdmin, async (req, res) => {
    const parse = DomainBody.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'A domain is required.' });
    }
    const domain = normalizeDomain(parse.data.domain);
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return res.status(400).json({ error: 'That does not look like a valid domain.' });
    }
    try {
      const { row, email, demoUrl } = await ensureDraftRow(domain);
      return res.json({
        ok: true,
        emailId: row.id,
        subject: email.subject,
        bodyHtml: email.bodyHtml,
        bodyText: email.bodyText,
        demoUrl,
        unsubscribeToken: email.unsubscribeToken,
        aiGenerated: email.aiGenerated,
      });
    } catch (err) {
      console.error('[outreach/draft-email] error:', err);
      return res.status(500).json({ error: 'Drafting failed. Try again or check server logs.' });
    }
  });

  // Send a reviewed outreach email (sequence step 1). Accepts either an
  // `emailId` (send an already-persisted draft) or a `domain` (draft-if-needed
  // via Phase 2, then send). Suppression is honored inside sendOutreachEmail —
  // an opted-out recipient returns { skipped:'suppressed' } and nothing is sent.
  // Never sends more than the reviewed draft; records the outcome on the row.
  app.post('/api/admin/outreach/send', requireAuth, requireSuperAdmin, async (req, res) => {
    const parse = SendBody.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Provide an emailId or a domain, plus an optional "to".' });
    }
    const { emailId, to } = parse.data;
    const domain = parse.data.domain ? normalizeDomain(parse.data.domain) : '';
    if (!emailId && !domain) {
      return res.status(400).json({ error: 'Provide an emailId or a domain.' });
    }
    if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return res.status(400).json({ error: 'That does not look like a valid domain.' });
    }
    try {
      let sendInput: SendOutreachInput;
      if (emailId) {
        sendInput = { emailId, to };
      } else {
        // Ensure a fresh reviewed draft exists for the domain, then send that row.
        const { row } = await ensureDraftRow(domain);
        sendInput = { draft: row, to: to ?? row.recipientEmail };
      }
      const result = await send(sendInput);
      return res.json(result);
    } catch (err) {
      console.error('[outreach/send] error:', err);
      return res.status(500).json({ error: 'Send failed. Try again or check server logs.' });
    }
  });
}
