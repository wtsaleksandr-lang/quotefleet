/**
 * Free-search quota gate — per-visitor cookie + per-IP daily backstop.
 *
 * Verifies the credit guardrail: a new visitor gets FREE_SEARCH_QUOTA live
 * searches, each live pull decrements, and past the quota the gate closes — while
 * a cache hit (which never calls recordLiveSearch) never counts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  checkSearchQuota,
  recordLiveSearch,
  FREE_SEARCH_QUOTA,
  IP_DAILY_LIVE_CAP,
  QUOTA_COOKIE,
  __resetQuotaStateForTests,
} from './importerQuota.js';

beforeEach(() => __resetQuotaStateForTests());

function req(ip: string, cookieUsed?: number): Request {
  const headers: Record<string, string> = {};
  if (cookieUsed != null) headers.cookie = `${QUOTA_COOKIE}=${cookieUsed}`;
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

describe('checkSearchQuota', () => {
  it('a fresh visitor is allowed with the full free quota remaining', () => {
    const q = checkSearchQuota(req('1.1.1.1'));
    expect(q.allowed).toBe(true);
    expect(q.remaining).toBe(FREE_SEARCH_QUOTA);
    expect(q.used).toBe(0);
    expect(q.limit).toBe(FREE_SEARCH_QUOTA);
  });

  it('a visitor whose cookie is at the quota is NOT allowed', () => {
    const q = checkSearchQuota(req('2.2.2.2', FREE_SEARCH_QUOTA));
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('checkSearchQuota never mutates state (pure read)', () => {
    const r = req('3.3.3.3');
    checkSearchQuota(r);
    checkSearchQuota(r);
    expect(checkSearchQuota(r).remaining).toBe(FREE_SEARCH_QUOTA);
  });
});

describe('recordLiveSearch', () => {
  it('increments the visitor cookie and decrements remaining', () => {
    const r = res();
    const after = recordLiveSearch(req('4.4.4.4'), r);
    expect(r._cookies[QUOTA_COOKIE]).toBe('1');
    expect(after.remaining).toBe(FREE_SEARCH_QUOTA - 1);
  });

  it('the per-IP daily backstop closes the gate after IP_DAILY_LIVE_CAP live pulls', () => {
    const ip = '5.5.5.5';
    // Each call sends a FRESH cookie-less request (simulates cookie clearing);
    // the IP backstop must still bound total live pulls.
    for (let i = 0; i < IP_DAILY_LIVE_CAP; i++) recordLiveSearch(req(ip), res());
    expect(checkSearchQuota(req(ip)).allowed).toBe(false);
  });

  it('one IP hitting the backstop does not affect a different IP', () => {
    const ip = '6.6.6.6';
    for (let i = 0; i < IP_DAILY_LIVE_CAP; i++) recordLiveSearch(req(ip), res());
    expect(checkSearchQuota(req('7.7.7.7')).allowed).toBe(true);
  });
});
