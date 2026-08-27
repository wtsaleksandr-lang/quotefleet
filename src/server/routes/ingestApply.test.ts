/**
 * Rate-sheet ingest APPLY endpoint — trust-on-approve (audit H2).
 *
 * When an operator approves an email-originated held import (POST
 * /api/tenant/ingest/:id/apply), its sender must be added to the tenant's
 * `ingestTrustedSendersJson` allowlist, so subsequent imports from that
 * now-known sender can auto-apply. A manual upload (no sourceEmail) must NOT
 * touch the allowlist. The DB, the apply transaction, and marketplace sync are
 * mocked — we assert only the trust-update side effect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    jobRows: [] as Record<string, unknown>[],
    tenant: {} as Record<string, unknown>,
    tenantUpdates: [] as Array<Record<string, unknown>>,
  };
  return { state };
});

vi.mock('../../db/client.js', () => {
  function makeSelect() {
    const chain: Record<string, unknown> = {
      from() { return chain; },
      where() { return chain; },
      limit() { return Promise.resolve(h.state.jobRows); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(h.state.jobRows).then(res, rej);
      },
    };
    return chain;
  }
  return {
    db: () => ({
      select: () => makeSelect(),
      update: () => ({
        set: (s: Record<string, unknown>) => {
          h.state.tenantUpdates.push(s);
          return { where: () => Promise.resolve() };
        },
      }),
      // applyDraftToTenant runs inside a transaction; no-op it (apply "succeeds"
      // with zero rows — we only care about the trust side effect here).
      transaction: async () => {},
    }),
  };
});

// The real syncTenantToMarketplace returns Promise<void>; apply chains .catch()
// on it (ingest.ts:783), so the mock MUST resolve a promise, not bare undefined.
vi.mock('../../marketplace/sync.js', () => ({ syncTenantToMarketplace: vi.fn().mockResolvedValue(undefined) }));

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq { params: { id: string }; body: unknown; tenant: Record<string, unknown>; user: { id: number } }
class MockRes {
  statusCode = 200;
  body: unknown = undefined;
  status(c: number) { this.statusCode = c; return this; }
  json(o: unknown) { this.body = o; return this; }
}

async function getApplyHandler(): Promise<Handler> {
  const { registerIngestRoutes } = await import('./ingest.js');
  let handler: Handler | undefined;
  const fakeApp = {
    post: (path: string, ...rest: unknown[]) => {
      if (path === '/api/tenant/ingest/:id/apply') handler = rest[rest.length - 1] as Handler;
    },
    get: () => {},
  } as unknown as import('express').Express;
  registerIngestRoutes(fakeApp);
  if (!handler) throw new Error('apply handler not registered');
  return handler;
}

function req(tenant: Record<string, unknown>): MockReq {
  return { params: { id: '7' }, body: {}, tenant, user: { id: 1 } };
}

beforeEach(() => {
  h.state.jobRows = [];
  h.state.tenantUpdates = [];
});

describe('apply — trust-on-approve', () => {
  it('adds an email-import sender to the tenant allowlist on approve', async () => {
    h.state.jobRows = [{ id: 7, tenantId: 1, status: 'ready_for_review', sourceEmail: 'dispatch@carrier.com' }];
    const res = new MockRes();
    await (await getApplyHandler())(req({ id: 1, ingestTrustedSendersJson: [] }), res);
    expect(res.statusCode).toBe(200);
    const trust = h.state.tenantUpdates.find((u) => 'ingestTrustedSendersJson' in u) as
      | { ingestTrustedSendersJson?: string[] }
      | undefined;
    expect(trust).toBeTruthy();
    expect(trust!.ingestTrustedSendersJson).toEqual(['dispatch@carrier.com']);
  });

  it('does NOT re-write the allowlist when the sender is already trusted', async () => {
    h.state.jobRows = [{ id: 7, tenantId: 1, status: 'ready_for_review', sourceEmail: 'dispatch@carrier.com' }];
    const res = new MockRes();
    await (await getApplyHandler())(req({ id: 1, ingestTrustedSendersJson: ['dispatch@carrier.com'] }), res);
    expect(res.statusCode).toBe(200);
    expect(h.state.tenantUpdates.some((u) => 'ingestTrustedSendersJson' in u)).toBe(false);
  });

  it('never touches the allowlist for a manual upload (no sourceEmail)', async () => {
    h.state.jobRows = [{ id: 7, tenantId: 1, status: 'ready_for_review', sourceEmail: null }];
    const res = new MockRes();
    await (await getApplyHandler())(req({ id: 1, ingestTrustedSendersJson: [] }), res);
    expect(res.statusCode).toBe(200);
    expect(h.state.tenantUpdates.some((u) => 'ingestTrustedSendersJson' in u)).toBe(false);
  });
});
