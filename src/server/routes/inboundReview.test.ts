/**
 * Inbound-review route tests — the super-admin review surface, all DB-free via
 * injected fakes. Proves:
 *   - super-admin gating (401 unauth, 403 non-admin, 200 super_admin);
 *   - POST /paste parses a raw forwarded broker .eml (real mailparser) and calls
 *     the injected handler with the extracted fields, returning status + ids;
 *   - GET /prospects joins each row with its drafted copy + demoUrl + quoteShotUrl;
 *   - POST /:id/skip and /:id/sent advance status via updateStatus.
 *
 * Mirrors prospectDemoRoutes.test.ts: mock ONLY requireAuth to a header-driven
 * pass-through, keep the REAL requireSuperAdmin so the gate runs for real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { HandleHarvestedEmailInput, HandleHarvestedEmailResult } from '../outreach/inbound/handleHarvestedEmail.js';
import type { InboundProspectStore } from '../outreach/inbound/inboundProspectStore.js';
import type { OutreachEmailStore } from '../outreach/outreachEmailStore.js';
import type { ProspectInbound, OutreachEmail } from '../../db/schema.js';

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

// ── Fakes (in-memory, record calls) ─────────────────────────────────────
interface Recorder {
  handled: HandleHarvestedEmailInput[];
  statusUpdates: Array<{ id: number; status: string }>;
}

function makeInboundStore(rows: ProspectInbound[], rec: Recorder): InboundProspectStore {
  return {
    async upsert() { throw new Error('not used'); },
    async getByMessageId() { return null; },
    async getById(id) { return rows.find((r) => r.id === id) ?? null; },
    async list(opts) {
      return opts?.status ? rows.filter((r) => r.status === opts.status) : rows;
    },
    async updateStatus(id, status) { rec.statusUpdates.push({ id, status }); },
  };
}

function makeEmailStore(emails: Record<number, OutreachEmail>): OutreachEmailStore {
  return {
    async saveDraft() { throw new Error('not used'); },
    async getByUnsubscribeToken() { return null; },
    async getById(id) { return emails[id] ?? null; },
    async suppressByToken() { return false; },
    async isRecipientSuppressed() { return false; },
    async recordSend() {},
    async markClickedByToken() { return null; },
  };
}

function inboundRow(over: Partial<ProspectInbound>): ProspectInbound {
  return {
    id: 1,
    harvestMailbox: 'paste',
    fromEmail: 'sam@acme-freight.com',
    fromDomain: 'acme-freight.com',
    originalMessageId: '<abc@acme-freight.com>',
    originalReferences: null,
    originalSubject: 'Spot capacity this week?',
    receivedAt: new Date('2026-08-01T12:00:00Z'),
    signatureJson: null,
    classifyCategory: 'broker_marketing',
    status: 'drafted',
    demoToken: 'tok_1',
    outreachEmailId: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function emailRow(over: Partial<OutreachEmail>): OutreachEmail {
  return {
    id: 10,
    demoToken: 'tok_1',
    domain: 'acme-freight.com',
    recipientEmail: 'sam@acme-freight.com',
    unsubscribeToken: 'unsub_1',
    subject: 'Re: Spot capacity this week?',
    bodyHtml: '<p>Hi Sam — here is a branded quote demo for Acme Freight.</p>',
    bodyText: 'Hi Sam — here is a branded quote demo for Acme Freight.',
    aiGenerated: true,
    suppressed: false,
    suppressedAt: null,
    sentAt: null,
    status: null,
    providerId: null,
    sendError: null,
    step: 1,
    nextFollowupAt: null,
    clickedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// A realistic forwarded broker email (raw RFC 822).
const RAW_EML = [
  'From: "Sam Rivera" <sam@acme-freight.com>',
  'To: quotes@quotefleet.net',
  'Subject: Spot capacity this week?',
  'Message-ID: <deal-9931@acme-freight.com>',
  'References: <thread-1@acme-freight.com> <thread-2@acme-freight.com>',
  'Date: Fri, 01 Aug 2026 09:12:00 -0400',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hi there,',
  '',
  'We have vans running the Midwest lanes and are quoting spot loads.',
  'Happy to send our rate sheet.',
  '',
  'Thanks,',
  'Sam Rivera',
  'Carrier Sales Manager',
  '(312) 555-0198',
  '',
].join('\r\n');

let server: Server;
let baseUrl: string;
let rec: Recorder;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';
  process.env.PUBLIC_BASE_URL = 'http://localhost:5000';
  rec = { handled: [], statusUpdates: [] };

  const rows = [
    inboundRow({}),
    inboundRow({ id: 2, status: 'skipped', demoToken: null, outreachEmailId: null, classifyCategory: 'irrelevant' }),
  ];
  const emails = { 10: emailRow({}) };

  const handle = async (input: HandleHarvestedEmailInput): Promise<HandleHarvestedEmailResult> => {
    rec.handled.push(input);
    return { status: 'drafted', inboundProspectId: 1, demoToken: 'tok_1', outreachEmailId: 10 };
  };

  const { registerInboundReviewRoutes } = await import('./inboundReview.js');
  const app = express();
  app.use(express.json());
  registerInboundReviewRoutes(app, {
    handle,
    inboundStore: makeInboundStore(rows, rec),
    emailStore: makeEmailStore(emails),
    demoUrlForToken: (t) => `http://localhost:5000/demo/${t}`,
    quoteShotUrlForToken: (t) => `http://localhost:5000/demo-shot/${t}.png`,
  });

  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function req(path: string, opts: { method?: string; role?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.role ? { 'x-test-role': opts.role } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describe('super-admin gating', () => {
  it('401 unauth, 403 non-admin, 200 super_admin — GET /prospects', async () => {
    expect((await req('/api/admin/inbound/prospects')).status).toBe(401);
    expect((await req('/api/admin/inbound/prospects', { role: 'tenant_owner' })).status).toBe(403);
    expect((await req('/api/admin/inbound/prospects', { role: 'super_admin' })).status).toBe(200);
  });

  it('gates POST /paste', async () => {
    expect((await req('/api/admin/inbound/paste', { method: 'POST', body: { from: 'x@y.com' } })).status).toBe(401);
    expect((await req('/api/admin/inbound/paste', { method: 'POST', role: 'tenant_owner', body: { from: 'x@y.com' } })).status).toBe(403);
  });

  it('gates POST /:id/skip and /:id/sent', async () => {
    expect((await req('/api/admin/inbound/1/skip', { method: 'POST' })).status).toBe(401);
    expect((await req('/api/admin/inbound/1/sent', { method: 'POST', role: 'tenant_owner' })).status).toBe(403);
  });

  it('gates GET /inbound-review page', async () => {
    expect((await req('/inbound-review')).status).toBe(401);
    const ok = await req('/inbound-review', { role: 'super_admin' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/html/);
    expect(await ok.text()).toContain('Inbound review');
  });
});

describe('POST /api/admin/inbound/paste', () => {
  it('parses a raw forwarded broker .eml and calls the handler with the extracted fields', async () => {
    const before = rec.handled.length;
    const res = await req('/api/admin/inbound/paste', { method: 'POST', role: 'super_admin', body: { raw: RAW_EML } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.status).toBe('drafted');
    expect(json.inboundProspectId).toBe(1);
    expect(json.outreachEmailId).toBe(10);
    expect(json.demoToken).toBe('tok_1');

    // The handler received the mailparser-extracted fields.
    expect(rec.handled.length).toBe(before + 1);
    const passed = rec.handled[rec.handled.length - 1];
    expect(passed.harvestMailbox).toBe('paste');
    expect(passed.fromEmail).toBe('sam@acme-freight.com');
    expect(passed.subject).toBe('Spot capacity this week?');
    expect(passed.messageId).toBe('<deal-9931@acme-freight.com>');
    expect(passed.references).toEqual(['<thread-1@acme-freight.com>', '<thread-2@acme-freight.com>']);
    expect(passed.bodyText).toContain('Midwest lanes');
  });

  it('400s when no sender address can be found', async () => {
    const res = await req('/api/admin/inbound/paste', { method: 'POST', role: 'super_admin', body: { bodyText: 'no sender here' } });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/inbound/prospects', () => {
  it('returns the list joined with each draft body + demoUrl + quoteShotUrl', async () => {
    const res = await req('/api/admin/inbound/prospects', { role: 'super_admin' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; prospects: Array<Record<string, unknown>> };
    expect(json.ok).toBe(true);
    expect(json.prospects.length).toBe(2);

    const drafted = json.prospects.find((p) => p.id === 1)!;
    expect(drafted.fromEmail).toBe('sam@acme-freight.com');
    expect(drafted.originalSubject).toBe('Spot capacity this week?');
    expect(drafted.status).toBe('drafted');
    expect(drafted.classifyCategory).toBe('broker_marketing');
    expect(drafted.demoUrl).toBe('http://localhost:5000/demo/tok_1');
    expect(drafted.quoteShotUrl).toBe('http://localhost:5000/demo-shot/tok_1.png');
    const draft = drafted.draft as { subject: string; bodyText: string; bodyHtml: string };
    expect(draft.subject).toBe('Re: Spot capacity this week?');
    expect(draft.bodyText).toContain('branded quote demo');

    // The row with no demo/draft joins to null cleanly.
    const skipped = json.prospects.find((p) => p.id === 2)!;
    expect(skipped.draft).toBeNull();
    expect(skipped.demoUrl).toBeNull();
    expect(skipped.quoteShotUrl).toBeNull();
  });
});

describe('POST /:id/skip and /:id/sent', () => {
  it('skip advances status to "skipped"', async () => {
    const res = await req('/api/admin/inbound/1/skip', { method: 'POST', role: 'super_admin' });
    expect(res.status).toBe(200);
    expect(rec.statusUpdates.at(-1)).toEqual({ id: 1, status: 'skipped' });
  });

  it('sent advances status to "sent"', async () => {
    const res = await req('/api/admin/inbound/2/sent', { method: 'POST', role: 'super_admin' });
    expect(res.status).toBe(200);
    expect(rec.statusUpdates.at(-1)).toEqual({ id: 2, status: 'sent' });
  });

  it('400s a non-numeric id', async () => {
    const res = await req('/api/admin/inbound/abc/skip', { method: 'POST', role: 'super_admin' });
    expect(res.status).toBe(400);
  });
});
