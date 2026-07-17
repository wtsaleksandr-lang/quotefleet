/**
 * Forward-email auto-import — inbound webhook handler tests.
 *
 * Drives POST /api/inbound/rate-email through its full safety model with the DB,
 * parser, apply path, and email all mocked, asserting:
 *   - bad / missing secret → 401; unset secret → 503
 *   - unknown to-address / unknown tenant → 404; feature OFF → 403
 *   - high-confidence + all-clean → AUTO-APPLIED + owner emailed + audited
 *   - low-confidence or flagged → HELD as a draft + owner emailed (never applied)
 *   - parse failure → graceful (job failed, owner told, 200 — no crash)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    env: {} as Record<string, unknown>,
    selectQueue: [] as Array<Array<Record<string, unknown>>>,
    inserts: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
    emails: [] as Array<{ to: string; subject: string }>,
    jobId: 42,
    parsed: {} as Record<string, unknown>,
    parseThrows: false,
    autoCheck: { total: 4, flaggedCount: 0, clean: 4, flagged: [] as Array<{ label: string; reason: string }>, samples: [] as unknown[] },
    applyCounts: { rateCards: 1, accessorials: 0, laneZones: 0 },
    applyThrows: false,
  };
  return { state };
});

vi.mock('../../db/client.js', () => {
  function nextRows() { return h.state.selectQueue.length ? h.state.selectQueue.shift()! : []; }
  function makeSelect() {
    const chain: Record<string, unknown> = {
      from() { return chain; },
      where() { return chain; },
      limit() { return Promise.resolve(nextRows()); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(nextRows()).then(res, rej);
      },
    };
    return chain;
  }
  return {
    db: () => ({
      select: () => makeSelect(),
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          h.state.inserts.push(vals);
          return {
            returning: () => Promise.resolve([{ id: h.state.jobId }]),
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({}).then(res, rej),
          };
        },
      }),
      update: () => ({ set: (s: Record<string, unknown>) => { h.state.updates.push(s); return { where: () => Promise.resolve() }; } }),
    }),
  };
});

vi.mock('../../config.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, loadEnv: () => h.state.env };
});

vi.mock('../../ai/ingestFile.js', () => ({
  parseRateSheet: vi.fn(async () => {
    if (h.state.parseThrows) throw new Error('unreadable rate sheet');
    return { parsed: h.state.parsed, raw: '', modelUsed: 'test', toolCalls: 0 };
  }),
}));

vi.mock('./ingest.js', () => ({
  runDraftAutoCheck: () => h.state.autoCheck,
  applyDraftToTenant: vi.fn(async () => {
    if (h.state.applyThrows) throw new Error('apply failed');
    return h.state.applyCounts;
  }),
}));

vi.mock('../../email/send.js', () => ({
  sendEmail: vi.fn(async (msg: { to: string; subject: string }) => {
    h.state.emails.push({ to: msg.to, subject: msg.subject });
    return { ok: true };
  }),
}));

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq { body: unknown; headers: Record<string, string>; header(n: string): string | undefined; tenant?: unknown; ip?: string }
class MockRes {
  statusCode = 200;
  body: unknown = undefined;
  status(c: number) { this.statusCode = c; return this; }
  json(o: unknown) { this.body = o; return this; }
}

async function getPostHandler(): Promise<Handler> {
  const { registerInboundRoutes } = await import('./inbound.js');
  let handler: Handler | undefined;
  const fakeApp = {
    post: (path: string, ...rest: unknown[]) => {
      if (path === '/api/inbound/rate-email') handler = rest[rest.length - 1] as Handler;
    },
    get: () => {},
  } as unknown as import('express').Express;
  registerInboundRoutes(fakeApp);
  if (!handler) throw new Error('inbound handler not registered');
  return handler;
}

function req(body: unknown, headers: Record<string, string> = { 'x-inbound-secret': 'topsecret' }): MockReq {
  const lower: Record<string, string> = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return { body, headers: lower, header(n: string) { return lower[n.toLowerCase()]; }, ip: '1.2.3.4' };
}

const goodPayload = {
  from: 'dispatch@carrier.com',
  to: 'rates-tok123@rates.quotefleet.net',
  subject: 'Updated rates',
  text: 'FTL dry van $2.50/mi',
  attachments: [{ filename: 'rates.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }],
};
const tenantRow = { id: 7, contactEmail: 'owner@carrier.com', ingestEmailToken: 'tok123' };
const brandOn = { featuresJson: { emailImport: true } };

beforeEach(() => {
  h.state.env = { INBOUND_WEBHOOK_SECRET: 'topsecret', INBOUND_EMAIL_DOMAIN: 'rates.quotefleet.net', PUBLIC_BASE_URL: 'https://app.quotefleet.net' };
  h.state.selectQueue = [[tenantRow], [brandOn]];
  h.state.inserts = [];
  h.state.updates = [];
  h.state.emails = [];
  h.state.parsed = { confidence: 'high', rateCards: [{ service: 'ftl', equipment: 'dryvan', ratePerMile: 2.5 }], accessorials: [], laneZones: [] };
  h.state.parseThrows = false;
  h.state.autoCheck = { total: 4, flaggedCount: 0, clean: 4, flagged: [], samples: [] };
  h.state.applyCounts = { rateCards: 1, accessorials: 0, laneZones: 0 };
  h.state.applyThrows = false;
});

describe('secret gate', () => {
  it('503 when INBOUND_WEBHOOK_SECRET is not configured', async () => {
    h.state.env = { PUBLIC_BASE_URL: 'https://x' };
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload), res);
    expect(res.statusCode).toBe(503);
    expect(h.state.inserts).toEqual([]);
  });

  it('401 on a wrong secret header', async () => {
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload, { 'x-inbound-secret': 'wrong' }), res);
    expect(res.statusCode).toBe(401);
    expect(h.state.inserts).toEqual([]);
  });

  it('401 on a missing secret header', async () => {
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload, {}), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('recipient / tenant / feature resolution', () => {
  it('404 when no rates- recipient is present', async () => {
    const res = new MockRes();
    await (await getPostHandler())(req({ ...goodPayload, to: 'someone@else.com' }), res);
    expect(res.statusCode).toBe(404);
    expect(h.state.inserts).toEqual([]);
  });

  it('404 when the token resolves to no tenant', async () => {
    h.state.selectQueue = [[]]; // tenant lookup finds nothing
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload), res);
    expect(res.statusCode).toBe(404);
  });

  it('403 when the tenant has email import turned OFF', async () => {
    h.state.selectQueue = [[tenantRow], [{ featuresJson: { emailImport: false } }]];
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload), res);
    expect(res.statusCode).toBe(403);
    expect(h.state.inserts).toEqual([]); // no job created
  });
});

describe('smart safety model', () => {
  it('AUTO-APPLIES a high-confidence + all-clean draft and emails the owner', async () => {
    const { applyDraftToTenant } = await import('./ingest.js');
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { status: string }).status).toBe('auto_applied');
    expect(applyDraftToTenant).toHaveBeenCalledTimes(1);
    // Owner told it was applied.
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.emails[0].to).toBe('owner@carrier.com');
    expect(h.state.emails[0].subject).toMatch(/updated your rates/i);
    // Audit records the auto-apply.
    const audit = h.state.inserts.find((i) => i.action === 'ingest.email_auto_applied');
    expect(audit).toBeTruthy();
  });

  it('HOLDS a low-confidence draft as a review draft (never applies)', async () => {
    h.state.parsed = { ...h.state.parsed, confidence: 'low' };
    const { applyDraftToTenant } = await import('./ingest.js');
    (applyDraftToTenant as ReturnType<typeof vi.fn>).mockClear();
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { status: string }).status).toBe('held_for_review');
    expect(applyDraftToTenant).not.toHaveBeenCalled();
    expect(h.state.emails[0].subject).toMatch(/need a quick review/i);
    expect(h.state.inserts.find((i) => i.action === 'ingest.email_held')).toBeTruthy();
  });

  it('HOLDS when the auto-check flags a lane, even at high confidence', async () => {
    h.state.autoCheck = { total: 4, flaggedCount: 1, clean: 3, flagged: [{ label: 'x', reason: '$0' }], samples: [] };
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload), res);
    expect((res.body as { status: string }).status).toBe('held_for_review');
  });

  it('parse failure is graceful — job marked failed, owner told, 200', async () => {
    h.state.parseThrows = true;
    const res = new MockRes();
    await (await getPostHandler())(req(goodPayload), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { status: string }).status).toBe('parse_failed');
    expect(h.state.updates.some((u) => u.status === 'failed')).toBe(true);
    expect(h.state.emails[0].subject).toMatch(/couldn.t read/i);
  });

  it('no parseable content → 200 no_parseable_content, no job created', async () => {
    const res = new MockRes();
    await (await getPostHandler())(req({ from: 'a@b.com', to: goodPayload.to }), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { status: string }).status).toBe('no_parseable_content');
    expect(h.state.inserts).toEqual([]);
  });
});
