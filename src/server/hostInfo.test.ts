/**
 * THE HEALTH PROBE MUST NEVER REACH THE DATABASE.
 *
 * On 2026-09-08 quotefleet.net returned 502 on every route for roughly a day.
 * Replit's VM supervisor probes `GET /` on the loopback listener and restarts
 * the machine when that probe fails, so anything that can make a loopback
 * request slow can restart production in a loop.
 *
 * `hostInfoMiddleware` used to run a `tenants.custom_domain` query for ANY host
 * that was neither the base domain nor a subdomain of it — and `127.0.0.1`, the
 * probe's own host, is in that set. These tests pin the guard that keeps it out
 * of the database.
 *
 * They assert on whether the QUERY HAPPENED, not on the answer, because the
 * answer was never in doubt: an IP literal cannot be CNAMEd and cannot carry a
 * TXT ownership claim, so it can never match a row.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

// loadEnv() runs inside the middleware and refuses to start without these, the
// same way access.test.ts seeds them.
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = randomBytes(32).toString('hex');
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:59999/quotefleet_test';
}

let selectCalls = 0;

const dbStub = {
  select: () => {
    selectCalls += 1;
    return {
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    };
  },
};

vi.mock('./db/client.js', () => ({ db: () => dbStub }));
vi.mock('../db/client.js', () => ({ db: () => dbStub }));

let hostInfoMiddleware: typeof import('./hostInfo.js').hostInfoMiddleware;

beforeEach(async () => {
  selectCalls = 0;
  process.env.HOST_DOMAINS = 'quotefleet.net';
  ({ hostInfoMiddleware } = await import('./hostInfo.js'));
});

async function run(host: string) {
  const req = { headers: { host }, } as unknown as Request;
  let called = false;
  await hostInfoMiddleware(req, {} as Response, (() => {
    called = true;
  }) as NextFunction);
  return { req, called };
}

describe('hostInfoMiddleware — which hosts are allowed to hit the database', () => {
  it('never queries for the loopback hosts a platform probe uses', async () => {
    for (const host of ['127.0.0.1', '127.0.0.1:5000', 'localhost', 'localhost:3000']) {
      selectCalls = 0;
      const { called } = await run(host);
      expect(called, `${host} must continue the chain`).toBe(true);
      expect(selectCalls, `${host} must not reach the database`).toBe(0);
    }
  });

  it('never queries for any IP literal, not just the loopback one', async () => {
    // A probe, a load balancer or a scanner can arrive on any address the
    // machine answers on. None of them can be a customer's custom domain.
    for (const host of ['0.0.0.0', '10.0.0.5', '172.17.0.1', '192.168.1.20']) {
      selectCalls = 0;
      await run(host);
      expect(selectCalls, `${host} must not reach the database`).toBe(0);
    }
  });

  it('STILL queries for a real custom domain, which is the whole feature', async () => {
    // The guard must not have been bought by breaking custom-domain routing.
    selectCalls = 0;
    await run('quote.astova.com');
    expect(selectCalls, 'a real hostname must still be looked up').toBe(1);
  });

  it('does not query for the base domain or ANY subdomain of it', async () => {
    /*
     * `www.` and the reserved subdomains are the reason this test exists.
     * Path 1 deliberately declines to treat them as a tenant slug, and they then
     * fell through to the custom-domain lookup and queried the database on every
     * request. Nobody can prove ownership of a subdomain of ours, so the query
     * could never match — it was pure load on the request path.
     */
    for (const host of [
      'quotefleet.net',
      'acme.quotefleet.net',
      'www.quotefleet.net',
      'app.quotefleet.net',
      'api.quotefleet.net',
      'admin.quotefleet.net',
      'status.quotefleet.net',
    ]) {
      selectCalls = 0;
      await run(host);
      expect(selectCalls, `${host} must not reach the database`).toBe(0);
    }
  });
});
