/**
 * Admin subscription/manifest-ops over real HTTP:
 *   - GET /api/admin/subscriptions/directory returns the JOINed rows (email);
 *   - GET /admin/privacy?filter=renewals applies a WHERE (renewals filter);
 *   - POST /api/admin/privacy/:id/refile clones a signed filing into a new
 *     Submitted row (fresh token, copied grantor/signer/hash);
 *   - GET /admin/privacy UNAUTHENTICATED 302-redirects to /login (never a raw
 *     JSON 401 on a browser navigation).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import {
  poaApplications,
  poaAuditEvents,
  manifestSubscriptions,
  directorySubscriptions,
} from '../../db/schema.js';

const store = vi.hoisted(() => ({
  apps: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  manSubs: [] as Record<string, unknown>[],
  dirSubs: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  whereSeen: [] as boolean[],
  appsWhereDefined: [] as boolean[],
  nextId: 100,
}));

vi.mock('../../config.js', () => ({
  loadEnv: () => ({ PUBLIC_BASE_URL: 'http://localhost:5000' }),
}));

// Session: a token of 'good' resolves to a super_admin; anything else = no session.
vi.mock('../../auth/session.js', () => ({
  SESSION_COOKIE_NAME: 'qf_session',
  lookupSession: vi.fn(async (token?: string) =>
    token === 'good' ? { user: { id: 1, role: 'super_admin', email: 'admin@qf.test', name: 'Op' } } : null,
  ),
}));

vi.mock('../../db/client.js', () => {
  const rowsFor = (table: unknown, cols: Record<string, unknown> | undefined): unknown[] => {
    const isCount = !!cols && Object.prototype.hasOwnProperty.call(cols, 'n');
    let base: unknown[] = [];
    if (table === poaApplications) base = store.apps;
    else if (table === poaAuditEvents) base = store.events;
    else if (table === manifestSubscriptions) base = store.manSubs;
    else if (table === directorySubscriptions) base = store.dirSubs;
    return isCount ? [{ n: base.length }] : base;
  };
  const makeSelect = (cols: Record<string, unknown> | undefined) => {
    const b: Record<string, unknown> & { _t?: unknown } = {};
    b._t = null;
    b.from = (t: unknown) => { b._t = t; return b; };
    b.leftJoin = () => b;
    b.where = (w: unknown) => {
      store.whereSeen.push(w !== undefined);
      if (b._t === poaApplications) store.appsWhereDefined.push(w !== undefined);
      return b;
    };
    b.orderBy = () => b;
    b.limit = () => b;
    b.offset = () => b;
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(b._t, cols)).then(res, rej);
    return b;
  };
  return {
    db: () => ({
      select: (cols?: Record<string, unknown>) => makeSelect(cols),
      insert: (table: unknown) => ({
        values: (vals: Record<string, unknown>) => {
          const row = { id: store.nextId++, ...vals };
          if (table === poaApplications) store.inserted.push(row);
          else if (table === poaAuditEvents) store.events.push(row);
          return {
            returning: () => Promise.resolve([row]),
            then: (res: (v: unknown) => unknown) => res(undefined),
            catch: () => Promise.resolve(),
          };
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }),
  };
});

const { registerAdminRoutes } = await import('./admin.js');
const { registerManifestPrivacyRoutes } = await import('./manifestPrivacy.js');

function startServer(): Promise<{ base: string; close: () => void }> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  // Minimal cookie shim: lift an x-auth header into req.cookies[qf_session].
  app.use((req, _res, next) => {
    const token = req.headers['x-auth'];
    (req as express.Request & { cookies: Record<string, string> }).cookies = token
      ? { qf_session: String(token) }
      : {};
    next();
  });
  registerAdminRoutes(app);
  registerManifestPrivacyRoutes(app);
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

beforeEach(() => {
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  store.apps = [];
  store.events = [];
  store.manSubs = [];
  store.dirSubs = [];
  store.inserted = [];
  store.whereSeen = [];
  store.appsWhereDefined = [];
  store.nextId = 100;
});

describe('GET /api/admin/subscriptions/directory', () => {
  it('returns the subscriber rows with customer email', async () => {
    store.dirSubs = [
      { id: 1, userId: 5, email: 'ship@co.test', name: 'Shipper', status: 'active', comp: false, currentPeriodEnd: new Date() },
    ];
    const { base, close } = await startServer();
    try {
      const r = await fetch(base + '/api/admin/subscriptions/directory', { headers: { 'x-auth': 'good' } });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { data: { email: string }[]; total: number };
      expect(body.total).toBe(1);
      expect(body.data[0].email).toBe('ship@co.test');
    } finally {
      close();
    }
  });

  it('403s a non-admin (no session)', async () => {
    const { base, close } = await startServer();
    try {
      const r = await fetch(base + '/api/admin/subscriptions/directory');
      expect(r.status).toBe(401);
    } finally {
      close();
    }
  });
});

describe('GET /admin/privacy', () => {
  it('redirects an unauthenticated browser to /login (not a JSON 401)', async () => {
    const { base, close } = await startServer();
    try {
      const r = await fetch(base + '/admin/privacy', { redirect: 'manual' });
      expect(r.status).toBeGreaterThanOrEqual(300);
      expect(r.status).toBeLessThan(400);
      expect(r.headers.get('location') || '').toContain('/login');
    } finally {
      close();
    }
  });

  it('applies a WHERE clause when ?filter=renewals is set', async () => {
    const { base, close } = await startServer();
    try {
      store.appsWhereDefined = [];
      const r = await fetch(base + '/admin/privacy?filter=renewals', { headers: { 'x-auth': 'good' } });
      expect(r.status).toBe(200);
      // The poa_applications query for the renewals view must have received a
      // DEFINED where predicate (the default 'all' view passes undefined).
      expect(store.appsWhereDefined).toContain(true);

      // And the default view passes an UNDEFINED predicate for the same query.
      store.appsWhereDefined = [];
      const rAll = await fetch(base + '/admin/privacy', { headers: { 'x-auth': 'good' } });
      expect(rAll.status).toBe(200);
      expect(store.appsWhereDefined.every((w) => w === false)).toBe(true);
    } finally {
      close();
    }
  });
});

describe('POST /api/admin/privacy/:id/refile', () => {
  it('clones a signed filing into a new Submitted request', async () => {
    store.apps = [
      {
        id: 7,
        publicToken: 'tok-original',
        userId: 5,
        status: 'active',
        grantorLegalName: 'Acme Imports LLC',
        nameVariations: ['Acme Imports LLC'],
        signerName: 'Jane Doe',
        signerEmail: 'jane@acme.test',
        signedAt: new Date('2024-01-01T00:00:00Z'),
        docSha256: 'a'.repeat(64),
      },
    ];
    const { base, close } = await startServer();
    try {
      const r = await fetch(base + '/api/admin/privacy/7/refile', {
        method: 'POST',
        headers: { 'x-auth': 'good', 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'portal', reference: 'CBP-123' }),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { status: string; newId: number; newToken: string };
      expect(body.status).toBe('submitted');
      expect(body.newToken).toBeTruthy();
      expect(body.newToken).not.toBe('tok-original');
      // The cloned row copied the grantor + signer + retained hash, at 'submitted'.
      const clone = store.inserted[0];
      expect(clone.grantorLegalName).toBe('Acme Imports LLC');
      expect(clone.signerName).toBe('Jane Doe');
      expect(clone.docSha256).toBe('a'.repeat(64));
      expect(clone.status).toBe('submitted');
      expect(clone.cbpReference).toBe('CBP-123');
    } finally {
      close();
    }
  });

  it('409s when the source filing is not signed', async () => {
    store.apps = [{ id: 8, publicToken: 'x', status: 'draft', signedAt: null, docSha256: null }];
    const { base, close } = await startServer();
    try {
      const r = await fetch(base + '/api/admin/privacy/8/refile', {
        method: 'POST',
        headers: { 'x-auth': 'good', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(409);
    } finally {
      close();
    }
  });
});
