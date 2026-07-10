/**
 * Security tests for the private-calculator access gate.
 *
 * These prove the LOCK, not just the UI: a private tenant's calculator is
 * unreachable without a valid grant, a valid invite token / signed cookie
 * grants access, and a revoked token is denied. If the gate is removed
 * (e.g. `tenantAccessAllowed` starts returning true unconditionally), the
 * "denied" cases below fail — which is the point.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';

// SESSION_SECRET must exist before loadEnv() runs inside the signer.
beforeAll(() => {
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
});

function reqWith(opts: { cookies?: Record<string, string>; query?: Record<string, string>; params?: Record<string, string> } = {}): Request {
  return {
    cookies: opts.cookies ?? {},
    query: opts.query ?? {},
    params: opts.params ?? {},
  } as unknown as Request;
}

const PRIVATE = { id: 42, accessMode: 'private' as const };
const PUBLIC = { id: 7, accessMode: 'public' as const };

// Injectable token lookups (stand in for the DB) so the decision logic is
// tested without infrastructure.
const tokenActive = async (tenantId: number, token: string) =>
  tenantId === PRIVATE.id && token === 'good-token';
const tokenRevoked = async () => false; // revoked / unknown → never valid

describe('access cookie sign/verify', () => {
  it('round-trips a valid grant for the right tenant', async () => {
    const { makeAccessCookieValue, verifyAccessCookieValue } = await import('./access.js');
    const v = makeAccessCookieValue(PRIVATE.id);
    expect(verifyAccessCookieValue(PRIVATE.id, v)).toBe(true);
  });

  it('rejects a grant minted for a DIFFERENT tenant', async () => {
    const { makeAccessCookieValue, verifyAccessCookieValue } = await import('./access.js');
    const v = makeAccessCookieValue(PRIVATE.id);
    expect(verifyAccessCookieValue(999, v)).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const { makeAccessCookieValue, verifyAccessCookieValue } = await import('./access.js');
    const v = makeAccessCookieValue(PRIVATE.id);
    const tampered = v.slice(0, -1) + (v.slice(-1) === 'a' ? 'b' : 'a');
    expect(verifyAccessCookieValue(PRIVATE.id, tampered)).toBe(false);
  });

  it('rejects an expired grant', async () => {
    const { makeAccessCookieValue, verifyAccessCookieValue } = await import('./access.js');
    const expired = makeAccessCookieValue(PRIVATE.id, -1000); // already in the past
    expect(verifyAccessCookieValue(PRIVATE.id, expired)).toBe(false);
  });

  it('rejects empty / malformed values', async () => {
    const { verifyAccessCookieValue } = await import('./access.js');
    expect(verifyAccessCookieValue(PRIVATE.id, undefined)).toBe(false);
    expect(verifyAccessCookieValue(PRIVATE.id, '')).toBe(false);
    expect(verifyAccessCookieValue(PRIVATE.id, 'not-a-grant')).toBe(false);
  });
});

describe('tenantAccessAllowed', () => {
  it('PUBLIC tenant is always reachable (no grant needed)', async () => {
    const { tenantAccessAllowed } = await import('./access.js');
    expect(await tenantAccessAllowed(PUBLIC, reqWith(), tokenRevoked)).toBe(true);
  });

  it('PRIVATE tenant is DENIED with no cookie and no token', async () => {
    const { tenantAccessAllowed } = await import('./access.js');
    expect(await tenantAccessAllowed(PRIVATE, reqWith(), tokenRevoked)).toBe(false);
  });

  it('PRIVATE tenant is ALLOWED with a valid signed cookie', async () => {
    const { tenantAccessAllowed, makeAccessCookieValue, accessCookieName } = await import('./access.js');
    const req = reqWith({ cookies: { [accessCookieName(PRIVATE.id)]: makeAccessCookieValue(PRIVATE.id) } });
    expect(await tenantAccessAllowed(PRIVATE, req, tokenRevoked)).toBe(true);
  });

  it('PRIVATE tenant is ALLOWED with a valid active invite token (?key=)', async () => {
    const { tenantAccessAllowed } = await import('./access.js');
    const req = reqWith({ query: { key: 'good-token' } });
    expect(await tenantAccessAllowed(PRIVATE, req, tokenActive)).toBe(true);
  });

  it('PRIVATE tenant is DENIED with a REVOKED / unknown token', async () => {
    const { tenantAccessAllowed } = await import('./access.js');
    const req = reqWith({ query: { key: 'good-token' } });
    // Same token string, but the lookup now reports it inactive → denied.
    expect(await tenantAccessAllowed(PRIVATE, req, tokenRevoked)).toBe(false);
  });

  it('PRIVATE tenant is DENIED when the cookie belongs to another tenant', async () => {
    const { tenantAccessAllowed, makeAccessCookieValue, accessCookieName } = await import('./access.js');
    // A valid grant for tenant 999, presented under this tenant's cookie name.
    const req = reqWith({ cookies: { [accessCookieName(PRIVATE.id)]: makeAccessCookieValue(999) } });
    expect(await tenantAccessAllowed(PRIVATE, req, tokenRevoked)).toBe(false);
  });
});

describe('owner-preview grant (?pk=)', () => {
  it('round-trips a valid preview grant for the right tenant', async () => {
    const { makePreviewGrant, hasValidPreviewGrant } = await import('./access.js');
    const req = reqWith({ query: { pk: makePreviewGrant(PRIVATE.id) } });
    expect(hasValidPreviewGrant(PRIVATE.id, req)).toBe(true);
  });

  it('a grant minted for tenant A does NOT unlock tenant B', async () => {
    const { makePreviewGrant, hasValidPreviewGrant } = await import('./access.js');
    // Grant is for PRIVATE (42); present it while checking tenant 999.
    const req = reqWith({ query: { pk: makePreviewGrant(PRIVATE.id) } });
    expect(hasValidPreviewGrant(999, req)).toBe(false);
  });

  it('rejects a tampered preview grant', async () => {
    const { makePreviewGrant, hasValidPreviewGrant } = await import('./access.js');
    const v = makePreviewGrant(PRIVATE.id);
    const tampered = v.slice(0, -1) + (v.slice(-1) === 'a' ? 'b' : 'a');
    const req = reqWith({ query: { pk: tampered } });
    expect(hasValidPreviewGrant(PRIVATE.id, req)).toBe(false);
  });

  it('rejects an expired preview grant', async () => {
    // makeAccessCookieValue with a negative TTL is already in the past; the
    // preview grant uses the same signer, so verify rejects it.
    const { makeAccessCookieValue, hasValidPreviewGrant } = await import('./access.js');
    const req = reqWith({ query: { pk: makeAccessCookieValue(PRIVATE.id, -1000) } });
    expect(hasValidPreviewGrant(PRIVATE.id, req)).toBe(false);
  });

  it('rejects a missing / empty grant param', async () => {
    const { hasValidPreviewGrant } = await import('./access.js');
    expect(hasValidPreviewGrant(PRIVATE.id, reqWith())).toBe(false);
    expect(hasValidPreviewGrant(PRIVATE.id, reqWith({ query: { pk: '' } }))).toBe(false);
  });

  it('tenantAccessAllowed ALLOWS a private tenant with a valid own-tenant grant', async () => {
    const { tenantAccessAllowed, makePreviewGrant } = await import('./access.js');
    const req = reqWith({ query: { pk: makePreviewGrant(PRIVATE.id) } });
    expect(await tenantAccessAllowed(PRIVATE, req, tokenRevoked)).toBe(true);
  });

  it('tenantAccessAllowed DENIES a private tenant when the grant is for another tenant', async () => {
    const { tenantAccessAllowed, makePreviewGrant } = await import('./access.js');
    // Valid grant, but minted for tenant 999 — must not open PRIVATE (42).
    const req = reqWith({ query: { pk: makePreviewGrant(999) } });
    expect(await tenantAccessAllowed(PRIVATE, req, tokenRevoked)).toBe(false);
  });
});

describe('enforceTenantAccess (HTTP guard)', () => {
  function fakeRes() {
    const out: { code: number; body: unknown } = { code: 200, body: null };
    const res = {
      status(c: number) { out.code = c; return this; },
      json(b: unknown) { out.body = b; return this; },
    };
    return { res: res as unknown as import('express').Response, out };
  }

  it('writes 403 for a blocked private request', async () => {
    const { enforceTenantAccess } = await import('./access.js');
    const { res, out } = fakeRes();
    const ok = await enforceTenantAccess(PRIVATE, reqWith(), res);
    expect(ok).toBe(false);
    expect(out.code).toBe(403);
    expect((out.body as { error: string }).error).toBe('access_denied');
  });

  it('passes a public request through without touching the response', async () => {
    const { enforceTenantAccess } = await import('./access.js');
    const { res, out } = fakeRes();
    const ok = await enforceTenantAccess(PUBLIC, reqWith(), res);
    expect(ok).toBe(true);
    expect(out.code).toBe(200);
  });
});

describe('renderGatePage', () => {
  it('shows the company name and NO calculator markup', async () => {
    const { renderGatePage } = await import('./access.js');
    const html = renderGatePage({ name: 'Acme Drayage' }, null);
    expect(html).toContain('Acme Drayage');
    expect(html).toContain('This rate calculator is private');
    // The gate must never leak the calculator shell / rate inputs.
    expect(html).not.toContain('qf-calc-btn');
    expect(html).not.toContain('/widget.js');
  });

  it('escapes HTML in the company name', async () => {
    const { renderGatePage } = await import('./access.js');
    const html = renderGatePage({ name: '<script>alert(1)</script>' }, null);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
