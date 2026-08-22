/**
 * defaultRfqGate — the entitlement/quota decision behind RFQ.
 *
 * Pure unit test: `directoryIdentity` is mocked (no session/DB) and an in-memory
 * usage meter is injected. Proves:
 *   - anonymous → blocked (needsAccount), never a send;
 *   - free account → free cap + free allowance, over-allowance blocks with
 *     needsUpgrade;
 *   - Pro account → full cap + Pro quota, over-quota blocks (no upgrade path);
 *   - the gate returns the accountKey/period the route increments on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';

vi.mock('../directory/entitlement.js', () => ({ directoryIdentity: vi.fn() }));
import { directoryIdentity } from '../directory/entitlement.js';
import {
  defaultRfqGate,
  rfqFreeRecipients,
  rfqFreeMonthly,
  rfqMaxRecipients,
  rfqProMonthly,
} from './rfq.js';
import type { RfqUsageStore } from '../directory/rfqUsage.js';
import { currentRfqPeriod } from '../directory/rfqUsage.js';

class MemUsage implements RfqUsageStore {
  map = new Map<string, number>();
  private k(a: string, p: string) {
    return `${a}|${p}`;
  }
  seed(a: string, p: string, n: number) {
    this.map.set(this.k(a, p), n);
  }
  async getSends(a: string, p: string) {
    return this.map.get(this.k(a, p)) ?? 0;
  }
  async increment(a: string, p: string) {
    const v = (this.map.get(this.k(a, p)) ?? 0) + 1;
    this.map.set(this.k(a, p), v);
    return v;
  }
}

const req = () => ({} as unknown as Request);
const identity = (over: Record<string, unknown> = {}) =>
  ({ userId: null, email: null, isPro: false, status: null, currentPeriodEnd: null, ...over });

describe('defaultRfqGate', () => {
  beforeEach(() => vi.mocked(directoryIdentity).mockReset());
  afterEach(() => {
    delete process.env.RFQ_FREE_RECIPIENTS;
    delete process.env.RFQ_FREE_MONTHLY;
    delete process.env.RFQ_PRO_MONTHLY;
    delete process.env.RFQ_MAX_RECIPIENTS;
  });

  it('blocks an anonymous caller (needsAccount) and hands back the free cap for preview', async () => {
    vi.mocked(directoryIdentity).mockResolvedValue(identity({ userId: null }) as never);
    const g = await defaultRfqGate(new MemUsage())(req(), 10);
    expect(g.ok).toBe(false);
    expect(g.needsAccount).toBe(true);
    expect(g.cap).toBe(rfqFreeRecipients());
    expect(g.accountKey).toBeUndefined(); // nothing to meter on
  });

  it('free account under allowance → ok with the free cap + allowance + account key', async () => {
    vi.mocked(directoryIdentity).mockResolvedValue(identity({ userId: 7, isPro: false }) as never);
    const g = await defaultRfqGate(new MemUsage())(req(), 3);
    expect(g.ok).toBe(true);
    expect(g.cap).toBe(rfqFreeRecipients());
    expect(g.allowance).toBe(rfqFreeMonthly());
    expect(g.used).toBe(0);
    expect(g.accountKey).toBe('user:7');
    expect(g.period).toBe(currentRfqPeriod());
  });

  it('free account at its monthly allowance → blocked with needsUpgrade', async () => {
    const usage = new MemUsage();
    usage.seed('user:7', currentRfqPeriod(), rfqFreeMonthly()); // used == allowance
    vi.mocked(directoryIdentity).mockResolvedValue(identity({ userId: 7, isPro: false }) as never);
    const g = await defaultRfqGate(usage)(req(), 1);
    expect(g.ok).toBe(false);
    expect(g.needsUpgrade).toBe(true);
    expect(g.reason).toBe('monthly_allowance');
    expect(g.used).toBe(rfqFreeMonthly());
    expect(g.allowance).toBe(rfqFreeMonthly());
  });

  it('Pro account → full cap + Pro quota, allowed up to quota', async () => {
    const usage = new MemUsage();
    usage.seed('user:9', currentRfqPeriod(), rfqProMonthly() - 1); // one left
    vi.mocked(directoryIdentity).mockResolvedValue(identity({ userId: 9, isPro: true }) as never);
    const g = await defaultRfqGate(usage)(req(), 25);
    expect(g.ok).toBe(true);
    expect(g.cap).toBe(rfqMaxRecipients());
    expect(g.allowance).toBe(rfqProMonthly());
  });

  it('Pro account over quota → blocked, but with NO upgrade path (hard ceiling)', async () => {
    const usage = new MemUsage();
    usage.seed('user:9', currentRfqPeriod(), rfqProMonthly());
    vi.mocked(directoryIdentity).mockResolvedValue(identity({ userId: 9, isPro: true }) as never);
    const g = await defaultRfqGate(usage)(req(), 25);
    expect(g.ok).toBe(false);
    expect(g.needsUpgrade).toBe(false);
    expect(g.reason).toBe('monthly_quota');
  });

  it('honors env overrides for the free cap + allowance', async () => {
    process.env.RFQ_FREE_RECIPIENTS = '3';
    process.env.RFQ_FREE_MONTHLY = '1';
    vi.mocked(directoryIdentity).mockResolvedValue(identity({ userId: 7, isPro: false }) as never);
    const g = await defaultRfqGate(new MemUsage())(req(), 3);
    expect(g.cap).toBe(3);
    expect(g.allowance).toBe(1);
  });
});

describe('currentRfqPeriod', () => {
  it('formats YYYY-MM in UTC', () => {
    expect(currentRfqPeriod(new Date('2026-08-22T23:59:59Z'))).toBe('2026-08');
    expect(currentRfqPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});
