/**
 * Trial-gating logic — two-tier model (see src/server/plans.ts).
 *
 * The public lead endpoint accepts leads while a tenant is trialing or on a
 * paid tier (Vital/Pro), and blocks only 'free' tenants whose trial ended
 * (never subscribed / cancelled). There is NO lead cap. During the 14-day
 * trial the effective plan is 'pro' (all-inclusive), regardless of the tier
 * the tenant selected. getTrialState no longer queries the DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tenant } from '../db/schema.js';

const now = new Date('2026-05-01T00:00:00Z');
const inFuture = new Date('2026-05-15T00:00:00Z'); // 14 days out
const inPast = new Date('2026-04-01T00:00:00Z');

const baseT: Tenant = {
  id: 1,
  slug: 'acme',
  hostDomain: 'quotefleet.net',
  customDomain: null,
  customDomainVerifiedAt: null,
  name: 'Acme',
  contactEmail: 'a@b.c',
  contactPhone: null,
  countryFocus: 'US',
  embedToken: 'tok',
  plan: 'free',
  status: 'active',
  trialEndsAt: inFuture,
  marketplaceOptIn: false,
  mcNumber: null,
  dotNumber: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionEndsAt: null,
  lifecycleEmailsJson: null,
  anthropicKeyEncrypted: null,
  dpaAcceptedAt: null,
  dpaVersion: null,
  createdAt: now,
  updatedAt: now,
};

// getTrialState is pure now (no DB), but plans.ts → config.ts still loads
// env at import time in some paths; keep a harmless db mock + env defaults.
vi.mock('../db/client.js', () => ({
  db: () => ({ select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'test'.repeat(16);
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://x';
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'sk-test';
});

describe('getTrialState', () => {
  it('paid Pro tenant (trial over) accepts leads, no cap', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState({ ...baseT, plan: 'pro', trialEndsAt: inPast });
    expect(r.status).toBe('paid');
    expect(r.acceptingLeads).toBe(true);
    expect(r.plan).toBe('pro');
  });

  it('paid Vital tenant (trial over) accepts leads, effective plan vital', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState({ ...baseT, plan: 'vital', trialEndsAt: inPast });
    expect(r.status).toBe('paid');
    expect(r.acceptingLeads).toBe(true);
    expect(r.plan).toBe('vital');
  });

  it('trialing tenant is all-inclusive (effective plan pro) and accepts leads', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState(baseT); // free plan, trial in the future
    expect(r.status).toBe('trial');
    expect(r.acceptingLeads).toBe(true);
    expect(r.plan).toBe('pro'); // tastes Pro during the trial
    expect(r.daysLeft).toBe(14);
  });

  it('trialing Vital selection still tastes Pro during the trial', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState({ ...baseT, plan: 'vital', trialEndsAt: inFuture });
    expect(r.status).toBe('trial');
    expect(r.plan).toBe('pro');
    expect(r.acceptingLeads).toBe(true);
  });

  it('free tenant with trial ended is read-only (blocks leads)', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState({ ...baseT, plan: 'free', trialEndsAt: inPast });
    expect(r.status).toBe('trial_expired');
    expect(r.acceptingLeads).toBe(false);
    expect(r.plan).toBe('free');
    expect(r.reason).toMatch(/plan/i);
  });

  it('free tenant with no trial_ends_at treated as expired', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState({ ...baseT, plan: 'free', trialEndsAt: null });
    expect(r.status).toBe('trial_expired');
    expect(r.acceptingLeads).toBe(false);
  });

  it('suspended tenant never accepts leads (even while trialing)', async () => {
    const { getTrialState } = await import('./trialGating.js');
    const r = await getTrialState({ ...baseT, status: 'suspended' });
    expect(r.acceptingLeads).toBe(false);
  });
});
