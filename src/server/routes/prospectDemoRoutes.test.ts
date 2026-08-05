/**
 * Prospect-demo route tests — provisioning + the public demo page/config, all
 * DB-free via a fake store and a mocked enrich. Proves:
 *   - provision: enrich → upsert → returns {demoUrl, token}; dedupe by domain
 *     (re-provision updates in place, keeps the token, no dup); super-admin gate.
 *   - public demo page: renders brand + mode for a valid token, 404s an unknown
 *     one, marks viewed_at, needs NO auth, and creates NO tenant/user rows.
 *   - widget-config interceptor: serves the prospect config for a demo token and
 *     falls through (next) for a non-demo slug.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { CompanyProfile } from '../outreach/enrichCompany.js';
import type { ProspectDemoStore, UpsertProspectDemoInput } from '../outreach/prospectDemoStore.js';
import type { ProspectDemo } from '../../db/schema.js';

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

// ── Fake store (in-memory, records calls) ──────────────────────────────
interface FakeStore extends ProspectDemoStore {
  rows: Map<string, ProspectDemo>;
  calls: { upsert: UpsertProspectDemoInput[]; markViewed: string[] };
}
function makeStore(): FakeStore {
  const rows = new Map<string, ProspectDemo>();
  const byDomain = new Map<string, string>();
  const calls = { upsert: [] as UpsertProspectDemoInput[], markViewed: [] as string[] };
  let counter = 0;
  const store: FakeStore = {
    rows,
    calls,
    async getByToken(token) {
      return rows.get(token) ?? null;
    },
    async getByDomain(domain) {
      const t = byDomain.get(domain);
      return t ? rows.get(t) ?? null : null;
    },
    async upsert(input) {
      calls.upsert.push(input);
      const existingToken = byDomain.get(input.domain);
      if (existingToken) {
        const r = rows.get(existingToken)!;
        const updated: ProspectDemo = {
          ...r,
          companyName: input.companyName,
          profileJson: input.profileJson,
          brandJson: input.brandJson,
          configJson: input.configJson,
          updatedAt: new Date(),
        };
        rows.set(existingToken, updated);
        return updated;
      }
      const token = 'tok_' + ++counter;
      const row: ProspectDemo = {
        id: counter,
        token,
        domain: input.domain,
        companyName: input.companyName,
        profileJson: input.profileJson,
        brandJson: input.brandJson,
        configJson: input.configJson,
        createdAt: new Date(),
        updatedAt: new Date(),
        viewedAt: null,
      };
      rows.set(token, row);
      byDomain.set(input.domain, token);
      return row;
    },
    async markViewed(token) {
      calls.markViewed.push(token);
      const r = rows.get(token);
      if (r && !r.viewedAt) rows.set(token, { ...r, viewedAt: new Date() });
    },
  };
  return store;
}

function drayageProfile(domain: string): CompanyProfile {
  return {
    domain,
    website: `https://${domain}`,
    companyName: 'Harbor Link Logistics',
    tagline: 'Port drayage specialists',
    phone: '(555) 987-6543',
    email: 'quotes@' + domain,
    mailingAddress: '77 Dock St, Long Beach, CA 90802',
    serviceModes: ['drayage'],
    regionsLanes: [],
    brandColors: { primary: '#1f6feb', secondary: '#0b2545', confidence: 'high' },
    logoUrl: `https://${domain}/logo.png`,
    logoConfidence: 'high',
    ai: {
      tone: 'professional',
      businessSummary: 's',
      painPoints: [],
      quoteFleetAngle: 'a',
      suggestedCalculator: { mode: 'drayage', fields: ['port', 'terminal', 'container', 'chassis'] },
    },
    aiAvailable: true,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes: [],
    fetchedPaths: [],
  };
}

let server: Server;
let baseUrl: string;
let store: FakeStore;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';
  process.env.PUBLIC_BASE_URL = 'http://localhost:5000';
  store = makeStore();
  const enrich = async (domain: string): Promise<CompanyProfile> => drayageProfile(domain);

  const { registerOutreachRoutes } = await import('./outreach.js');
  const { registerProspectDemoRoutes } = await import('./prospectDemo.js');

  const app = express();
  app.use(express.json());
  const publicDir = resolve(process.cwd(), 'src/server/public');
  registerProspectDemoRoutes(app, { store, publicDir });
  registerOutreachRoutes(app, { enrich, store });
  // Stand in for the tenant widget handler so a non-demo slug has somewhere to
  // fall through to.
  app.get('/api/public/widget/:slug', (_req, res) => res.status(404).json({ error: 'Tenant not found' }));

  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function provision(domain: string, role?: string) {
  const res = await fetch(`${baseUrl}/api/admin/outreach/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
    body: JSON.stringify({ domain }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/admin/outreach/provision', () => {
  it('super-admin gating: 401 unauth, 403 non-admin', async () => {
    const unauth = await provision('acme-freight.com');
    expect(unauth.status).toBe(401);
    const owner = await provision('acme-freight.com', 'tenant_owner');
    expect(owner.status).toBe(403);
  });

  it('enriches → upserts a prospect_demo → returns demoUrl + token', async () => {
    const before = store.rows.size;
    const r = await provision('acme-freight.com', 'super_admin');
    expect(r.status).toBe(200);
    expect(typeof r.json.token).toBe('string');
    expect(r.json.demoUrl).toBe(`http://localhost:5000/demo/${r.json.token}`);
    // a prospect_demo row was created — and nothing else (no tenant/user store)
    expect(store.rows.size).toBe(before + 1);
    expect(store.calls.upsert.length).toBeGreaterThan(0);
  });

  it('dedupes by domain: re-provision updates in place, keeps the token', async () => {
    const first = await provision('dedupe-co.com', 'super_admin');
    const sizeAfterFirst = store.rows.size;
    const second = await provision('dedupe-co.com', 'super_admin');
    expect(second.status).toBe(200);
    expect(second.json.token).toBe(first.json.token); // same token
    expect(store.rows.size).toBe(sizeAfterFirst); // no duplicate row
  });
});

describe('GET /demo/:token (public page)', () => {
  it('renders the prospect brand + mode, marks viewed, needs no auth', async () => {
    const p = await provision('harborlink.com', 'super_admin');
    const token = p.json.token as string;
    expect(store.rows.get(token)?.viewedAt).toBeNull();

    const res = await fetch(`${baseUrl}/demo/${token}`); // no auth header
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const html = await res.text();
    expect(html).toContain('window.QF_DEMO');
    expect(html).toContain('Harbor Link Logistics');
    expect(html).toContain(`/w/${token}`); // iframe points at the live widget
    // viewed_at stamped on first load
    expect(store.calls.markViewed).toContain(token);
    expect(store.rows.get(token)?.viewedAt).not.toBeNull();
  });

  it('404s an unknown token with a signup CTA', async () => {
    const res = await fetch(`${baseUrl}/demo/does-not-exist`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('/signup');
  });
});

describe('GET /api/public/widget/:slug (prospect interceptor)', () => {
  it('serves the prospect widget config for a demo token', async () => {
    const p = await provision('widgetcfg.com', 'super_admin');
    const token = p.json.token as string;
    const res = await fetch(`${baseUrl}/api/public/widget/${token}`);
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as Record<string, unknown>;
    expect(cfg.demo).toBe(true);
    expect((cfg.tenant as { name: string }).name).toBe('Harbor Link Logistics');
    expect(cfg.services).toContain('drayage');
    // Equipment options carry `value` (the key widget.js consumes) — guards the
    // value="undefined" shipping-blocker end-to-end through the served response.
    const ebs = cfg.equipmentByService as Record<string, Array<{ value?: string }>>;
    expect(ebs.drayage[0].value).toBe('container_40hc');
    expect('equipment' in ebs.drayage[0]).toBe(false);
  });

  it('falls through to the tenant handler for a non-demo slug', async () => {
    const res = await fetch(`${baseUrl}/api/public/widget/not-a-demo-slug`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Tenant not found');
  });
});
