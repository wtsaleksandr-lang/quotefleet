/**
 * Trial-gating logic — ensures the public lead endpoint correctly
 * blocks free-tier tenants past trial / over quota. We mock the DB
 * because trial state needs `count(*) FROM leads` to be predictable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tenant } from '../db/schema.js';

const now = new Date('2026-05-01T00:00:00Z');
const baseT: Tenant = {
  id: 1,
  slug: 'acme',
  hostDomain: 'quotefleet.net',
  customDomain: null,
  name: 'Acme',
  contactEmail: 'a@b.c',
  contactPhone: null,
  countryFocus: 'US',
  embedToken: 'tok',
  plan: 'free',
  status: 'active',
  trialEndsAt: new Date('2026-05-15T00:00:00Z'), // 14 days out
  marketplaceOptIn: false,
  mcNumber: null,
  dotNumber: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionEndsAt: null,
  lifecycleEmailsJson: null,
  anthropicKeyEncrypted: null,
  createdAt: now,
  updatedAt: now,
};

vi.mock('../db/client.js', () => {
  return {
    db: () => ({
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ n: leadCount }]) }) }),
    }),
  };
});

let leadCount = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  leadCount = 0;
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'test'.repeat(16);
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://x';
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'sk-test';
});

describe('getTrialState', () => {
  it('paid tenant accepts leads with no quota', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState({ ...baseT, plan: 'pro' });
    expect(r.status).toBe('paid');
    expect(r.acceptingLeads).toBe(true);
    expect(r.leadsLimit).toBeNull();
  });

  it('trial active accepts leads under quota', async () => {
    const { getTrialState } = await import('./trialGating.js');
    leadCount = 5;
    const r = await getTrialState(baseT);
    expect(r.status).toBe('trial');
    expect(r.acceptingLeads).toBe(true);
    expect(r.daysLeft).toBe(14);
  });

  it('trial active but quota exceeded blocks leads', async () => {
    const { getTrialState } = await import('./trialGating.js');
    leadCount = 999;
    const r = await getTrialState(baseT);
    expect(r.status).toBe('trial');
    expect(r.acceptingLeads).toBe(false);
    expect(r.reason).toMatch(/limit/i);
  });

  it('trial expired blocks leads', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const expired = { ...baseT, trialEndsAt: new Date('2026-04-01T00:00:00Z') };
    const r = await getTrialState(expired);
    expect(r.status).toBe('trial_expired');
    expect(r.acceptingLeads).toBe(false);
  });

  it('no trial_ends_at on free tenant treated as expired', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState({ ...baseT, trialEndsAt: null });
    expect(r.status).toBe('trial_expired');
    expect(r.acceptingLeads).toBe(false);
  });

  it('suspended tenant never accepts leads', async () => {
    const { getTrialState } = await import('./trialGating.js');
    leadCount = 0;
    const r = await getTrialState({ ...baseT, status: 'suspended' });
    expect(r.acceptingLeads).toBe(false);
  });
});
