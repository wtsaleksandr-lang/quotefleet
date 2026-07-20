/**
 * Regression guard for the expired-trial onboarding trap.
 *
 * The post-signup wizard is gated on `needsOnboarding`, and BOTH "Continue" and
 * "Skip for now" POST to /api/tenant/onboarding/apply. That route used to be
 * caught by the trial-expired write-block, so a tenant on `plan:'free'` past
 * trialEndsAt got 403 on every button, saw only "Something went wrong saving
 * your setup", and could never dismiss the wizard or reach the upgrade CTA.
 *
 * These tests assert the bypass AND that the write-block still fires on a
 * normal tenant-config route (so the exemption can't silently widen).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const EXPIRED_FREE_TENANT = {
  id: 7,
  slug: 'expired-co',
  plan: 'free',
  status: 'active',
  trialEndsAt: new Date('2020-01-01T00:00:00Z'), // long past
};

vi.mock('./db/client.js', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([EXPIRED_FREE_TENANT]) }),
      }),
    }),
  }),
}));
vi.mock('../db/client.js', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([EXPIRED_FREE_TENANT]) }),
      }),
    }),
  }),
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function makeCtx(method: string, path: string) {
  const req: any = {
    user: { id: 1, role: 'tenant_owner', tenantId: EXPIRED_FREE_TENANT.id },
    method,
    path,
    params: {},
    query: {},
  };
  const res: any = {
    statusCode: null as number | null,
    payload: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.payload = body; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, wasAllowed: () => nextCalled };
}

describe('expired-trial write block — onboarding bypass', () => {
  beforeEach(() => {
    // The block is a no-op under NODE_ENV=test, so force enforcement on.
    process.env.NODE_ENV = 'production';
    delete process.env.BYPASS_TRIAL_ENFORCEMENT;
  });
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.resetModules();
  });

  it('lets an expired-trial tenant COMPLETE onboarding (Continue)', async () => {
    const { requireTenant } = await import('./middleware.js');
    const { req, res, next, wasAllowed } = makeCtx('POST', '/api/tenant/onboarding/apply');
    await requireTenant(req, res, next);
    expect(res.statusCode, 'must not 403 the onboarding gate-clear').toBeNull();
    expect(wasAllowed()).toBe(true);
  });

  it('lets an expired-trial tenant SKIP onboarding (same route)', async () => {
    const { requireTenant } = await import('./middleware.js');
    const { req, res, next, wasAllowed } = makeCtx('POST', '/api/tenant/onboarding/apply');
    await requireTenant(req, res, next);
    expect(wasAllowed()).toBe(true);
  });

  it('STILL blocks a normal tenant-config write for an expired trial', async () => {
    // The deliberate-regression proof: if this stops 403-ing, the bypass has
    // widened past the onboarding gate and the write-block is toothless.
    const { requireTenant } = await import('./middleware.js');
    const { req, res, next, wasAllowed } = makeCtx('PUT', '/api/tenant/rate-cards/12');
    await requireTenant(req, res, next);
    expect(res.statusCode).toBe(403);
    expect((res.payload as { error: string }).error).toBe('trial_expired');
    expect(wasAllowed()).toBe(false);
  });

  it('still allows GETs for an expired trial (dashboard must load)', async () => {
    const { requireTenant } = await import('./middleware.js');
    const { req, res, next, wasAllowed } = makeCtx('GET', '/api/tenant/rate-cards');
    await requireTenant(req, res, next);
    expect(res.statusCode).toBeNull();
    expect(wasAllowed()).toBe(true);
  });
});
