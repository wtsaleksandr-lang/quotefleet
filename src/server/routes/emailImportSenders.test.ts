/**
 * Trusted-sender allowlist API — read + revoke (provenance/trust surfacing).
 *
 * The dashboard email-import card now SHOWS the tenant's trusted senders (the
 * addresses whose future rate emails auto-apply) and lets the operator revoke
 * one. These tests lock that API contract:
 *   - GET returns the current allowlist (empty array when none),
 *   - DELETE removes a sender (normalized/case-insensitive match) and persists,
 *   - DELETE of an unknown/invalid address is a safe no-op / 400.
 * The DB + env are mocked; normalizeSenderAddress runs for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = { updates: [] as Array<Record<string, unknown>> };
  return { state };
});

vi.mock('../../db/client.js', () => ({
  db: () => ({
    update: () => ({ set: (s: Record<string, unknown>) => { h.state.updates.push(s); return { where: () => Promise.resolve() }; } }),
  }),
}));
vi.mock('../../config.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, loadEnv: () => ({ INBOUND_EMAIL_DOMAIN: 'rates.quotefleet.net', INBOUND_WEBHOOK_SECRET: 's', PUBLIC_BASE_URL: 'https://x' }) };
});

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq { params: Record<string, string>; tenant: Record<string, unknown> }
class MockRes {
  statusCode = 200;
  body: any = undefined;
  status(c: number) { this.statusCode = c; return this; }
  json(o: unknown) { this.body = o; return this; }
}

async function getHandlers(): Promise<{ getSenders: Handler; delSender: Handler }> {
  const { registerInboundRoutes } = await import('./inbound.js');
  const handlers: Record<string, Handler> = {};
  const fakeApp = {
    get: (path: string, ...rest: unknown[]) => { handlers['GET ' + path] = rest[rest.length - 1] as Handler; },
    post: () => {},
    delete: (path: string, ...rest: unknown[]) => { handlers['DELETE ' + path] = rest[rest.length - 1] as Handler; },
  } as unknown as import('express').Express;
  registerInboundRoutes(fakeApp);
  return {
    getSenders: handlers['GET /api/tenant/email-import/senders'],
    delSender: handlers['DELETE /api/tenant/email-import/senders/:email'],
  };
}

beforeEach(() => { h.state.updates = []; });

describe('GET /api/tenant/email-import/senders', () => {
  it('returns the tenant allowlist', async () => {
    const { getSenders } = await getHandlers();
    const res = new MockRes();
    await getSenders({ params: {}, tenant: { id: 1, ingestTrustedSendersJson: ['dispatch@acmecarrier.com'] } }, res);
    expect(res.body.senders).toEqual(['dispatch@acmecarrier.com']);
  });
  it('returns an empty array when the allowlist is null/absent', async () => {
    const { getSenders } = await getHandlers();
    const res = new MockRes();
    await getSenders({ params: {}, tenant: { id: 1, ingestTrustedSendersJson: null } }, res);
    expect(res.body.senders).toEqual([]);
  });
});

describe('DELETE /api/tenant/email-import/senders/:email', () => {
  it('removes a trusted sender (case-insensitive) and persists the new list', async () => {
    const { delSender } = await getHandlers();
    const res = new MockRes();
    await delSender(
      { params: { email: encodeURIComponent('Dispatch@AcmeCarrier.com') }, tenant: { id: 1, ingestTrustedSendersJson: ['dispatch@acmecarrier.com', 'ops@other.com'] } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.senders).toEqual(['ops@other.com']);
    const upd = h.state.updates.find((u) => 'ingestTrustedSendersJson' in u) as { ingestTrustedSendersJson?: string[] } | undefined;
    expect(upd!.ingestTrustedSendersJson).toEqual(['ops@other.com']);
  });

  it('is a no-op (no DB write) when the address is not on the list', async () => {
    const { delSender } = await getHandlers();
    const res = new MockRes();
    await delSender(
      { params: { email: encodeURIComponent('nobody@nowhere.com') }, tenant: { id: 1, ingestTrustedSendersJson: ['dispatch@acmecarrier.com'] } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.senders).toEqual(['dispatch@acmecarrier.com']);
    expect(h.state.updates.some((u) => 'ingestTrustedSendersJson' in u)).toBe(false);
  });

  it('rejects an unparseable address with 400', async () => {
    const { delSender } = await getHandlers();
    const res = new MockRes();
    await delSender({ params: { email: 'not-an-email' }, tenant: { id: 1, ingestTrustedSendersJson: [] } }, res);
    expect(res.statusCode).toBe(400);
  });
});
