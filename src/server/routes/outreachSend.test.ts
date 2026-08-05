/**
 * POST /api/admin/outreach/send — Phase 3 route tests (DB-free, network-free).
 *
 * Wires the REAL route + the REAL sendOutreachEmail over fake stores and an
 * injected email sender, so suppression + recording are exercised end-to-end:
 *   - super-admin gating (401 unauth, 403 non-admin).
 *   - send by emailId → 'sent' + provider id, uses the persisted draft.
 *   - suppressed recipient/draft → skipped:'suppressed', NO email sent.
 *   - send by domain → drafts (Phase 2) then sends.
 *   - source-level: the route chains requireAuth + requireSuperAdmin.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { CompanyProfile } from '../outreach/enrichCompany.js';
import type { ProspectDemoStore, UpsertProspectDemoInput } from '../outreach/prospectDemoStore.js';
import type {
  OutreachEmailStore,
  SaveOutreachEmailInput,
  RecordSendInput,
} from '../outreach/outreachEmailStore.js';
import type { EmailOut } from '../../email/send.js';
import { draftOutreachEmail } from '../outreach/draftEmail.js';
import { sendOutreachEmail } from '../outreach/sendOutreach.js';
import type { ProspectDemo, OutreachEmail } from '../../db/schema.js';

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
function makeDemoStore(): ProspectDemoStore & { rows: Map<string, ProspectDemo> } {
  const rows = new Map<string, ProspectDemo>();
  const byDomain = new Map<string, string>();
  let counter = 0;
  return {
    rows,
    async getByToken(token) { return rows.get(token) ?? null; },
    async getByDomain(domain) { const t = byDomain.get(domain); return t ? rows.get(t) ?? null : null; },
    async upsert(input: UpsertProspectDemoInput) {
      const existing = byDomain.get(input.domain);
      const token = existing ?? 'tok_' + ++counter;
      const row: ProspectDemo = {
        id: counter, token, domain: input.domain, companyName: input.companyName,
        profileJson: input.profileJson, brandJson: input.brandJson, configJson: input.configJson,
        createdAt: new Date(), updatedAt: new Date(), viewedAt: null, quoteShotB64: null, quoteShotAt: null,
      };
      rows.set(token, row); byDomain.set(input.domain, token);
      return row;
    },
    async markViewed() { /* unused */ },
  };
}

// ── Fake outreach-email store (with Phase-3 methods) ────────────────────
interface FakeEmailStore extends OutreachEmailStore {
  byId: Map<number, OutreachEmail>;
  suppressedAddresses: Set<string>;
  records: Array<{ id: number; input: RecordSendInput }>;
}
function makeEmailStore(): FakeEmailStore {
  const byToken = new Map<string, OutreachEmail>();
  const byId = new Map<number, OutreachEmail>();
  const suppressedAddresses = new Set<string>();
  const records: Array<{ id: number; input: RecordSendInput }> = [];
  let counter = 0;
  return {
    byId, suppressedAddresses, records,
    async saveDraft(input: SaveOutreachEmailInput) {
      const row: OutreachEmail = {
        id: ++counter, demoToken: input.demoToken, domain: input.domain,
        recipientEmail: input.recipientEmail, unsubscribeToken: input.unsubscribeToken,
        subject: input.subject, bodyHtml: input.bodyHtml, bodyText: input.bodyText,
        aiGenerated: input.aiGenerated, suppressed: false, suppressedAt: null,
        sentAt: null, status: null, providerId: null, sendError: null,
        step: 1, nextFollowupAt: null, clickedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      byToken.set(input.unsubscribeToken, row); byId.set(row.id, row);
      return row;
    },
    async getByUnsubscribeToken(token) { return byToken.get(token) ?? null; },
    async getById(id) { return byId.get(id) ?? null; },
    async suppressByToken(token) {
      const r = byToken.get(token);
      if (!r) return false;
      const next = { ...r, suppressed: true, suppressedAt: new Date() };
      byToken.set(token, next); byId.set(next.id, next);
      return true;
    },
    async isRecipientSuppressed(email) {
      return suppressedAddresses.has(String(email).trim().toLowerCase());
    },
    async recordSend(id, input) {
      records.push({ id, input });
      const r = byId.get(id);
      if (r) byId.set(id, { ...r, status: input.status, sentAt: input.sentAt ?? null, providerId: input.providerId ?? null });
    },
    async markClickedByToken() { return null; },
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
let demoStore: ReturnType<typeof makeDemoStore>;
let emailStore: FakeEmailStore;
let emailSender: ReturnType<typeof vi.fn>;
let senderOut: EmailOut;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';
  process.env.PUBLIC_BASE_URL = 'http://localhost:5000';
  demoStore = makeDemoStore();
  emailStore = makeEmailStore();
  senderOut = { ok: true, provider: 'resend', id: 'msg_1' };
  emailSender = vi.fn(async () => senderOut);

  const enrich = async (domain: string): Promise<CompanyProfile> => acmeProfile(domain);
  const draft = (profile: CompanyProfile, demoUrl: string) =>
    draftOutreachEmail(profile, demoUrl, { anthropicKey: '', publicBaseUrl: 'http://localhost:5000' });
  // Real send path over the fake store + injected email sender.
  const send = (input: Parameters<typeof sendOutreachEmail>[0]) =>
    sendOutreachEmail(input, { store: emailStore, send: emailSender, publicBaseUrl: 'http://localhost:5000' });

  const { registerOutreachRoutes } = await import('./outreach.js');
  const app = express();
  app.use(express.json());
  registerOutreachRoutes(app, { enrich, store: demoStore, emailStore, draft, send });

  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function post(path: string, body: unknown, role?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/admin/outreach/send', () => {
  it('super-admin gating: 401 unauth, 403 non-admin', async () => {
    expect((await post('/api/admin/outreach/send', { domain: 'acme.com', to: 'x@y.com' })).status).toBe(401);
    expect((await post('/api/admin/outreach/send', { domain: 'acme.com', to: 'x@y.com' }, 'tenant_owner')).status).toBe(403);
  });

  it('sends a persisted draft by emailId and records the outcome', async () => {
    // Seed a draft row (as draft-email would).
    const row = await emailStore.saveDraft({
      demoToken: 'tok_seed', domain: 'byid.com', recipientEmail: 'dispatch@byid.com',
      unsubscribeToken: 'unsub_byid', subject: 'Subj', bodyHtml: '<p>b</p>', bodyText: 'b',
      aiGenerated: false,
    });
    emailSender.mockClear();
    const r = await post('/api/admin/outreach/send', { emailId: row.id, to: 'lead@byid.com' }, 'super_admin');

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, status: 'sent', providerId: 'msg_1' });
    expect(emailSender).toHaveBeenCalledTimes(1);
    // The wire payload is the persisted draft's exact subject/body.
    const msg = emailSender.mock.calls[0][0] as { subject: string; html: string; text: string; to: string };
    expect(msg.subject).toBe('Subj');
    expect(msg.html).toBe('<p>b</p>');
    expect(msg.to).toBe('lead@byid.com');
    expect(emailStore.byId.get(row.id)?.status).toBe('sent');
  });

  it('SKIPS a suppressed recipient — nothing sent', async () => {
    const row = await emailStore.saveDraft({
      demoToken: 'tok_sup', domain: 'sup.com', recipientEmail: 'dispatch@sup.com',
      unsubscribeToken: 'unsub_sup', subject: 'S', bodyHtml: '<p>b</p>', bodyText: 'b',
      aiGenerated: false,
    });
    emailStore.suppressedAddresses.add('optout@sup.com');
    emailSender.mockClear();
    const r = await post('/api/admin/outreach/send', { emailId: row.id, to: 'optout@sup.com' }, 'super_admin');

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, status: 'skipped', skipped: 'suppressed' });
    expect(emailSender).not.toHaveBeenCalled();
  });

  it('drafts-if-needed then sends when given a domain', async () => {
    emailSender.mockClear();
    const r = await post('/api/admin/outreach/send', { domain: 'freshsend.com', to: 'lead@freshsend.com' }, 'super_admin');

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, status: 'sent' });
    expect(emailSender).toHaveBeenCalledTimes(1);
    // A draft row was persisted for the domain.
    expect([...emailStore.byId.values()].some((x) => x.domain === 'freshsend.com')).toBe(true);
  });

  it('400s when neither emailId nor domain is provided', async () => {
    const r = await post('/api/admin/outreach/send', { to: 'x@y.com' }, 'super_admin');
    expect(r.status).toBe(400);
  });
});

describe('route wiring (source-level)', () => {
  it('the send route chains requireAuth + requireSuperAdmin', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/routes/outreach.ts'), 'utf8');
    expect(src).toContain("'/api/admin/outreach/send'");
    expect(src).toMatch(/outreach\/send',\s*requireAuth,\s*requireSuperAdmin/);
  });
});
