/**
 * Draft-email route + prospect-unsubscribe route tests — DB-free via fake
 * stores and an injected (AI-free) drafter. Proves:
 *   - POST /api/admin/outreach/draft-email: super-admin gating (401/403/200),
 *     returns subject + HTML + text + demoUrl + unsubscribeToken, persists the
 *     draft, and reuses an existing demo's stored profile (no re-enrich).
 *   - GET /outreach/unsubscribe/:token: marks the persisted draft suppressed,
 *     needs no auth, and shows a confirmation page.
 *   - source-level gate: the route chains requireAuth + requireSuperAdmin.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { CompanyProfile } from '../outreach/enrichCompany.js';
import type { ProspectDemoStore, UpsertProspectDemoInput } from '../outreach/prospectDemoStore.js';
import type { OutreachEmailStore, SaveOutreachEmailInput } from '../outreach/outreachEmailStore.js';
import { draftOutreachEmail } from '../outreach/draftEmail.js';
import type { ProspectDemo, OutreachEmail } from '../../db/schema.js';

// Mock ONLY requireAuth to a header-driven pass-through; keep the REAL
// requireSuperAdmin so the gate is exercised for real.
vi.mock('../middleware.js', async (orig) => {
  const actual = await orig<typeof import('../middleware.js')>();
  return {
    ...actual,
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header('x-test-role');
      if (role) (req as unknown as { user: unknown }).user = { id: 1, role };
      next();
    },
  };
});

// ── Fake prospect-demo store ────────────────────────────────────────────
interface FakeDemoStore extends ProspectDemoStore {
  rows: Map<string, ProspectDemo>;
  calls: { upsert: UpsertProspectDemoInput[] };
}
function makeDemoStore(): FakeDemoStore {
  const rows = new Map<string, ProspectDemo>();
  const byDomain = new Map<string, string>();
  const calls = { upsert: [] as UpsertProspectDemoInput[] };
  let counter = 0;
  return {
    rows,
    calls,
    async getByToken(token) { return rows.get(token) ?? null; },
    async getByDomain(domain) { const t = byDomain.get(domain); return t ? rows.get(t) ?? null : null; },
    async upsert(input) {
      calls.upsert.push(input);
      const existing = byDomain.get(input.domain);
      const token = existing ?? 'tok_' + ++counter;
      const row: ProspectDemo = {
        id: counter, token, domain: input.domain, companyName: input.companyName,
        profileJson: input.profileJson, brandJson: input.brandJson, configJson: input.configJson,
        createdAt: new Date(), updatedAt: new Date(), viewedAt: null,
      };
      rows.set(token, row); byDomain.set(input.domain, token);
      return row;
    },
    async markViewed() { /* unused here */ },
  };
}

// ── Fake outreach-email store ───────────────────────────────────────────
interface FakeEmailStore extends OutreachEmailStore {
  rows: Map<string, OutreachEmail>;
  calls: { save: SaveOutreachEmailInput[] };
}
function makeEmailStore(): FakeEmailStore {
  const rows = new Map<string, OutreachEmail>();
  const calls = { save: [] as SaveOutreachEmailInput[] };
  let counter = 0;
  return {
    rows,
    calls,
    async saveDraft(input) {
      calls.save.push(input);
      const row: OutreachEmail = {
        id: ++counter, demoToken: input.demoToken, domain: input.domain,
        recipientEmail: input.recipientEmail, unsubscribeToken: input.unsubscribeToken,
        subject: input.subject, bodyHtml: input.bodyHtml, bodyText: input.bodyText,
        aiGenerated: input.aiGenerated, suppressed: false, suppressedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      rows.set(input.unsubscribeToken, row);
      return row;
    },
    async getByUnsubscribeToken(token) { return rows.get(token) ?? null; },
    async suppressByToken(token) {
      const r = rows.get(token);
      if (!r) return false;
      rows.set(token, { ...r, suppressed: true, suppressedAt: new Date() });
      return true;
    },
  };
}

function acmeProfile(domain: string): CompanyProfile {
  return {
    domain, website: `https://${domain}`, companyName: 'Acme Drayage', tagline: 't',
    phone: null, email: `dispatch@${domain}`, mailingAddress: null,
    serviceModes: ['drayage'], regionsLanes: ['Los Angeles to Phoenix'],
    brandColors: { primary: '#123456', secondary: null, confidence: 'high' },
    logoUrl: null, logoConfidence: 'low',
    ai: {
      tone: 'pro', businessSummary: 's', painPoints: ['manual quoting is slow'],
      quoteFleetAngle: 'a', suggestedCalculator: { mode: 'drayage', fields: ['port'] },
    },
    aiAvailable: true, fmcsa: null, fmcsaAvailable: false, fetchNotes: [], fetchedPaths: [],
  };
}

let server: Server;
let baseUrl: string;
let demoStore: FakeDemoStore;
let emailStore: FakeEmailStore;
let enrichCalls: string[];

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';
  process.env.PUBLIC_BASE_URL = 'http://localhost:5000';
  demoStore = makeDemoStore();
  emailStore = makeEmailStore();
  enrichCalls = [];
  const enrich = async (domain: string): Promise<CompanyProfile> => {
    enrichCalls.push(domain);
    return acmeProfile(domain);
  };
  // AI-free deterministic drafter so the route test never touches the vendor.
  const draft = (profile: CompanyProfile, demoUrl: string) =>
    draftOutreachEmail(profile, demoUrl, { anthropicKey: '', publicBaseUrl: 'http://localhost:5000' });

  const { registerOutreachRoutes } = await import('./outreach.js');
  const { registerOutreachUnsubscribeRoutes } = await import('./outreachUnsubscribe.js');

  const app = express();
  app.use(express.json());
  registerOutreachRoutes(app, { enrich, store: demoStore, emailStore, draft });
  registerOutreachUnsubscribeRoutes(app, { emailStore });

  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function draftEmail(domain: string, role?: string) {
  const res = await fetch(`${baseUrl}/api/admin/outreach/draft-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
    body: JSON.stringify({ domain }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/admin/outreach/draft-email', () => {
  it('super-admin gating: 401 unauth, 403 non-admin', async () => {
    expect((await draftEmail('acme.com')).status).toBe(401);
    expect((await draftEmail('acme.com', 'tenant_owner')).status).toBe(403);
  });

  it('drafts, returns subject/body/demoUrl/token, and persists the draft', async () => {
    const r = await draftEmail('acmedrayage.com', 'super_admin');
    expect(r.status).toBe(200);
    expect(typeof r.json.subject).toBe('string');
    expect(String(r.json.subject)).toContain('Acme Drayage');
    expect(String(r.json.bodyHtml)).toContain('30 Angus Road, Hamilton, ON L8K 6L1, Canada');
    expect(String(r.json.bodyText)).toContain('30 Angus Road, Hamilton, ON L8K 6L1, Canada');
    expect(String(r.json.demoUrl)).toMatch(/\/demo\/tok_/);
    expect(String(r.json.bodyText)).toContain(String(r.json.demoUrl));
    expect(typeof r.json.unsubscribeToken).toBe('string');
    // Persisted for Phase 3.
    expect(emailStore.calls.save.length).toBeGreaterThan(0);
    expect(emailStore.rows.get(String(r.json.unsubscribeToken))?.domain).toBe('acmedrayage.com');
  });

  it('reuses an existing demo profile without re-enriching', async () => {
    // Seed a demo for this domain (as provision would) with a stored profile.
    await demoStore.upsert({
      domain: 'seeded.com', companyName: 'Seeded Co',
      profileJson: acmeProfile('seeded.com') as unknown as Record<string, unknown>,
      brandJson: null, configJson: null,
    });
    const before = enrichCalls.length;
    const r = await draftEmail('seeded.com', 'super_admin');
    expect(r.status).toBe(200);
    // No new enrich call — it reused the stored profile.
    expect(enrichCalls.length).toBe(before);
  });
});

describe('GET /outreach/unsubscribe/:token', () => {
  it('marks the persisted draft suppressed and shows a confirmation (no auth)', async () => {
    const r = await draftEmail('optout.com', 'super_admin');
    const token = String(r.json.unsubscribeToken);
    expect(emailStore.rows.get(token)?.suppressed).toBe(false);

    const res = await fetch(`${baseUrl}/outreach/unsubscribe/${token}`); // no auth header
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain('unsubscribed');
    expect(emailStore.rows.get(token)?.suppressed).toBe(true);
  });

  it('shows a friendly page even for an unknown token', async () => {
    const res = await fetch(`${baseUrl}/outreach/unsubscribe/does-not-exist`);
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).toContain('unsubscribed');
  });
});

describe('route wiring (source-level)', () => {
  it('the draft-email route chains requireAuth + requireSuperAdmin', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/routes/outreach.ts'), 'utf8');
    expect(src).toContain("'/api/admin/outreach/draft-email'");
    expect(src).toMatch(/outreach\/draft-email',\s*requireAuth,\s*requireSuperAdmin/);
  });

  it('the unsubscribe route is registered in app.ts', async () => {
    const app = await readFile(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
    expect(app).toContain('registerOutreachUnsubscribeRoutes(app)');
  });
});
