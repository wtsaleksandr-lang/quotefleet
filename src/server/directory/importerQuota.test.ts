/**
 * Credit guardrails — two separate concerns:
 *   1. SEARCH: free + generous, only a per-IP/day anti-abuse cap on live pulls.
 *   2. DETAIL OPEN: the FREE quota (default 3) that gates opening a profile.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  checkLiveSearchAllowed,
  recordLiveSearch,
  checkDetailQuota,
  recordDetailOpen,
  FREE_DETAIL_QUOTA,
  IP_DAILY_LIVE_SEARCH_CAP,
  IP_DAILY_DETAIL_CAP,
  DETAIL_COOKIE,
  __resetQuotaStateForTests,
} from './importerQuota.js';

beforeEach(() => __resetQuotaStateForTests());

function req(ip: string, detailCookie?: number): Request {
  const headers: Record<string, string> = {};
  if (detailCookie != null) headers.cookie = `${DETAIL_COOKIE}=${detailCookie}`;
  return { ip, headers } as unknown as Request;
}
function res(): Response & { _cookies: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    _cookies: store,
    cookie(name: string, value: string) {
      store[name] = value;
      return this as unknown as Response;
    },
  } as unknown as Response & { _cookies: Record<string, string> };
}

describe('search gate (free + generous, anti-abuse only)', () => {
  it('the free-search cap is generous (>= 50) so we never push users to ImportYeti', () => {
    expect(IP_DAILY_LIVE_SEARCH_CAP).toBeGreaterThanOrEqual(50);
  });

  it('a fresh IP may search live', () => {
    expect(checkLiveSearchAllowed(req('1.1.1.1')).allowed).toBe(true);
  });

  it('only closes after the generous per-IP daily cap of live pulls', () => {
    const ip = '2.2.2.2';
    for (let i = 0; i < IP_DAILY_LIVE_SEARCH_CAP - 1; i++) recordLiveSearch(req(ip));
    expect(checkLiveSearchAllowed(req(ip)).allowed).toBe(true); // still under the cap
    recordLiveSearch(req(ip));
    expect(checkLiveSearchAllowed(req(ip)).allowed).toBe(false); // now at the cap
    // a different IP is unaffected
    expect(checkLiveSearchAllowed(req('3.3.3.3')).allowed).toBe(true);
  });

  it('search and detail counters are independent', () => {
    const ip = '4.4.4.4';
    for (let i = 0; i < IP_DAILY_LIVE_SEARCH_CAP; i++) recordLiveSearch(req(ip));
    // search is capped, but detail opens for the same IP are still available
    expect(checkLiveSearchAllowed(req(ip)).allowed).toBe(false);
    expect(checkDetailQuota(req(ip)).allowed).toBe(true);
  });
});

describe('detail-open quota (the free quota is on PROFILES)', () => {
  it('a fresh visitor gets FREE_DETAIL_QUOTA (default 3) profile opens', () => {
    const q = checkDetailQuota(req('5.5.5.5'));
    expect(q.allowed).toBe(true);
    expect(q.remaining).toBe(FREE_DETAIL_QUOTA);
    expect(q.limit).toBe(FREE_DETAIL_QUOTA);
    expect(FREE_DETAIL_QUOTA).toBe(3);
  });

  it('a visitor whose cookie is at the quota is NOT allowed to open more', () => {
    const q = checkDetailQuota(req('6.6.6.6', FREE_DETAIL_QUOTA));
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('recordDetailOpen bumps the cookie and decrements remaining', () => {
    const r = res();
    const after = recordDetailOpen(req('7.7.7.7'), r);
    expect(r._cookies[DETAIL_COOKIE]).toBe('1');
    expect(after.remaining).toBe(FREE_DETAIL_QUOTA - 1);
  });

  it('checkDetailQuota never mutates state (pure read)', () => {
    const r = req('8.8.8.8');
    checkDetailQuota(r);
    checkDetailQuota(r);
    expect(checkDetailQuota(r).remaining).toBe(FREE_DETAIL_QUOTA);
  });

  it('the per-IP daily backstop bounds cookie-clearing abuse', () => {
    const ip = '9.9.9.9';
    for (let i = 0; i < IP_DAILY_DETAIL_CAP; i++) recordDetailOpen(req(ip), res());
    expect(checkDetailQuota(req(ip)).allowed).toBe(false);
  });

  it('re-opening the SAME company does not consume another free profile (slug dedup)', () => {
    const ip = '10.10.10.10';
    const r1 = res();
    const a1 = recordDetailOpen(req(ip), r1, 'valbruna-stainless');
    expect(a1.used).toBe(1);
    // Replay the cookie the server just set back into a fresh request.
    const cookie = r1._cookies[DETAIL_COOKIE];
    const reqWith = { ip, headers: { cookie: `${DETAIL_COOKIE}=${cookie}` } } as unknown as Request;
    // A re-open of the same slug is still allowed and records NO extra usage.
    expect(checkDetailQuota(reqWith, 'valbruna-stainless').allowed).toBe(true);
    const a2 = recordDetailOpen(reqWith, res(), 'valbruna-stainless');
    expect(a2.used).toBe(1); // unchanged — dedup by slug
  });

  it('three DISTINCT companies exhaust the quota, then a re-open is still allowed', () => {
    const ip = '11.11.11.11';
    let cookie: string | undefined;
    const build = () =>
      ({ ip, headers: cookie ? { cookie: `${DETAIL_COOKIE}=${cookie}` } : {} }) as unknown as Request;
    for (const slug of ['aaa', 'bbb', 'ccc']) {
      const r = res();
      expect(checkDetailQuota(build(), slug).allowed).toBe(true);
      recordDetailOpen(build(), r, slug);
      cookie = r._cookies[DETAIL_COOKIE];
    }
    // Quota is now exhausted for a NEW company…
    expect(checkDetailQuota(build(), 'ddd').allowed).toBe(false);
    // …but re-opening one of the three already opened is still allowed.
    expect(checkDetailQuota(build(), 'aaa').allowed).toBe(true);
  });

  it('legacy numeric cookie still parses as a used-count', () => {
    const q = checkDetailQuota(req('12.12.12.12', FREE_DETAIL_QUOTA));
    expect(q.used).toBe(FREE_DETAIL_QUOTA);
    expect(q.allowed).toBe(false);
  });
});

describe('detail-open quota keyed to the ACCOUNT (logged-in users)', () => {
  it('a fresh account gets the full free quota, independent of cookie/IP', () => {
    // Same IP, NO cookie — but keyed to userId=42.
    const q = checkDetailQuota(req('20.20.20.20'), undefined, 42);
    expect(q.allowed).toBe(true);
    expect(q.remaining).toBe(FREE_DETAIL_QUOTA);
  });

  it('opens decrement the account quota and it persists across DIFFERENT IPs', () => {
    // Open three DISTINCT companies for the same account from three different IPs.
    recordDetailOpen(req('1.0.0.1'), res(), 'aaa', 7);
    recordDetailOpen(req('1.0.0.2'), res(), 'bbb', 7);
    recordDetailOpen(req('1.0.0.3'), res(), 'ccc', 7);
    // Quota is now exhausted for the account, on ANY IP…
    expect(checkDetailQuota(req('9.9.9.1'), 'ddd', 7).allowed).toBe(false);
    // …but a re-open of an already-opened company is still free (slug dedup).
    expect(checkDetailQuota(req('9.9.9.2'), 'aaa', 7).allowed).toBe(true);
  });

  it('re-opening the same company does not consume another account profile', () => {
    const a1 = recordDetailOpen(req('2.0.0.1'), res(), 'valbruna', 8);
    expect(a1.used).toBe(1);
    const a2 = recordDetailOpen(req('2.0.0.9'), res(), 'valbruna', 8);
    expect(a2.used).toBe(1); // unchanged — dedup by slug
  });

  it('two different accounts have independent quotas', () => {
    recordDetailOpen(req('3.0.0.1'), res(), 'x', 100);
    recordDetailOpen(req('3.0.0.1'), res(), 'y', 100);
    recordDetailOpen(req('3.0.0.1'), res(), 'z', 100);
    expect(checkDetailQuota(req('3.0.0.1'), 'w', 100).allowed).toBe(false); // account 100 exhausted
    expect(checkDetailQuota(req('3.0.0.1'), 'w', 101).allowed).toBe(true); // account 101 fresh
  });
});
