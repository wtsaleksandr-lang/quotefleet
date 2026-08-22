/**
 * Directory Pro entitlement — SOFT auth.
 *
 * Asserts the gate's contract:
 *   • active / trialing (unexpired)      → isPro true
 *   • inactive / past_due / expired      → isPro false
 *   • no session                         → free ({userId:null}), NOT an error
 *   • DB hiccup                          → free, never throws
 *   • memoized: two calls in one request → one session/DB round-trip
 *
 * The session lookup + db are mocked so this exercises the real gate logic
 * without live infrastructure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

const state = vi.hoisted(() => ({
  session: null as { user: { id: number; email: string } } | null,
  subRow: null as Record<string, unknown> | null,
  sessionCalls: 0,
  selectCalls: 0,
  throwOnSelect: false,
}));

vi.mock('../../auth/session.js', () => ({
  SESSION_COOKIE_NAME: 'qf_sess',
  lookupSession: vi.fn(async (token: string | undefined) => {
    state.sessionCalls++;
    if (!token) return null;
    return state.session;
  }),
}));

vi.mock('../../db/client.js', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            state.selectCalls++;
            if (state.throwOnSelect) return Promise.reject(new Error('db down'));
            return Promise.resolve(state.subRow ? [state.subRow] : []);
          },
        }),
      }),
    }),
  }),
}));

const { directoryIdentity, hasDirectoryPro } = await import('./entitlement.js');

function reqWith(token: string | undefined): Request {
  return { cookies: token ? { qf_sess: token } : {} } as unknown as Request;
}

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

beforeEach(() => {
  state.session = { user: { id: 42, email: 'shipper@acme.com' } };
  state.subRow = null;
  state.sessionCalls = 0;
  state.selectCalls = 0;
  state.throwOnSelect = false;
});

describe('hasDirectoryPro — entitlement decision', () => {
  it('active + unexpired → Pro', async () => {
    state.subRow = { status: 'active', currentPeriodEnd: FUTURE };
    expect(await hasDirectoryPro(reqWith('t'))).toBe(true);
  });

  it('active + null period end → Pro (open-ended)', async () => {
    state.subRow = { status: 'active', currentPeriodEnd: null };
    expect(await hasDirectoryPro(reqWith('t'))).toBe(true);
  });

  it('trialing + unexpired → Pro', async () => {
    state.subRow = { status: 'trialing', currentPeriodEnd: FUTURE };
    expect(await hasDirectoryPro(reqWith('t'))).toBe(true);
  });

  it('inactive → free', async () => {
    state.subRow = { status: 'inactive', currentPeriodEnd: FUTURE };
    expect(await hasDirectoryPro(reqWith('t'))).toBe(false);
  });

  it('past_due → free', async () => {
    state.subRow = { status: 'past_due', currentPeriodEnd: FUTURE };
    expect(await hasDirectoryPro(reqWith('t'))).toBe(false);
  });

  it('active but EXPIRED period end → free', async () => {
    state.subRow = { status: 'active', currentPeriodEnd: PAST };
    expect(await hasDirectoryPro(reqWith('t'))).toBe(false);
  });

  it('session but no subscription row → free (not error)', async () => {
    state.subRow = null;
    const id = await directoryIdentity(reqWith('t'));
    expect(id.userId).toBe(42);
    expect(id.isPro).toBe(false);
    expect(id.status).toBeNull();
  });
});

describe('directoryIdentity — no session is free, not an error', () => {
  it('no cookie → anonymous free identity', async () => {
    const id = await directoryIdentity(reqWith(undefined));
    expect(id).toEqual({ userId: null, email: null, isPro: false, status: null, currentPeriodEnd: null });
  });

  it('invalid session (lookup returns null) → anonymous free', async () => {
    state.session = null;
    const id = await directoryIdentity(reqWith('bad-token'));
    expect(id.userId).toBeNull();
    expect(id.isPro).toBe(false);
  });
});

describe('directoryIdentity — resilience + memoization', () => {
  it('DB error degrades to free and does NOT throw', async () => {
    state.throwOnSelect = true;
    const id = await directoryIdentity(reqWith('t'));
    expect(id.isPro).toBe(false);
    expect(id.userId).toBeNull();
  });

  it('memoizes on the request — two gate calls, one DB round-trip', async () => {
    state.subRow = { status: 'active', currentPeriodEnd: FUTURE };
    const req = reqWith('t');
    await directoryIdentity(req);
    await hasDirectoryPro(req);
    expect(state.selectCalls).toBe(1);
    expect(state.sessionCalls).toBe(1);
  });
});
