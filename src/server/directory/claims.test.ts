/**
 * Profile-claim state machine (directory/claims.ts) against the in-memory
 * store — every transition, no DB, no email provider.
 *
 *   start → email_otp → verify (right code)      → verified + all 4 writes
 *   wrong code x5                                  → locked
 *   expired code                                   → expired
 *   already-claimed profile                        → already_claimed (start AND verify)
 *   verified claimant on the census domain         → domain_match, verified at once
 *   freemail domain match                          → still email_otp (never domain_match)
 *   record without an email                        → needs_manual; admin review verifies/rejects
 *   activateOwnerTrial                             → only a directory owner with NO trial
 *   CARRIER_UPSERT_SET                             → never touches claimed_* (re-ingest can't un-claim)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CLAIM_OTP_MAX_ATTEMPTS,
  CLAIM_OTP_TTL_MS,
  activateOwnerTrial,
  chooseClaimMethod,
  hashOtp,
  isFreemailDomain,
  isNeutralClaimSlug,
  maskEmail,
  neutralClaimSlug,
  otpMatches,
  reviewClaim,
  startClaim,
  verifyClaimCode,
} from './claims.js';
import { CLAIM_OWNER_TRIAL_DAYS } from '../plans.js';
import { CARRIER_UPSERT_SET } from './carrierIngest.js';
import { memoryCarrier, memoryClaimStore, type MemoryClaimStore } from '../../test/claimsMemoryStore.js';

const now = new Date('2026-09-10T12:00:00Z');
const actor = { userId: 7, email: 'owner@acme.com' };

let store: MemoryClaimStore;
beforeEach(() => {
  store = memoryClaimStore();
  store.carriers.push(memoryCarrier());
  store.users.set(7, { id: 7, email: actor.email, verified: false });
  store.tenants.set(42, { isDirectoryOwner: false, trialEndsAt: null, dotNumber: null, mcNumber: null });
});

describe('pure helpers', () => {
  it('masks an email to first char + domain', () => {
    expect(maskEmail('dispatch@acme.com')).toBe('d***@acme.com');
    expect(maskEmail('x')).toBe('***');
  });
  it('hashes the code (sha256 hex) and compares constant-time', () => {
    const h = hashOtp('123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(otpMatches('123456', h)).toBe(true);
    expect(otpMatches('123457', h)).toBe(false);
    expect(otpMatches('123456', null)).toBe(false);
  });
  it('chooses domain_match only for a VERIFIED claimant on the same non-freemail domain', () => {
    expect(chooseClaimMethod({ claimantEmail: 'a@acme.com', censusEmail: 'b@acme.com', claimantVerified: true })).toBe('domain_match');
    expect(chooseClaimMethod({ claimantEmail: 'a@acme.com', censusEmail: 'b@acme.com', claimantVerified: false })).toBe('email_otp');
    expect(chooseClaimMethod({ claimantEmail: 'a@gmail.com', censusEmail: 'b@gmail.com', claimantVerified: true })).toBe('email_otp');
    expect(chooseClaimMethod({ claimantEmail: 'a@other.com', censusEmail: 'b@acme.com', claimantVerified: true })).toBe('email_otp');
    expect(chooseClaimMethod({ claimantEmail: 'a@acme.com', censusEmail: null, claimantVerified: true })).toBe('manual');
    expect(chooseClaimMethod({ claimantEmail: 'a@acme.com', censusEmail: '  ', claimantVerified: true })).toBe('manual');
  });
  it('residential-ISP and country-TLD freemail domains never domain-match', () => {
    for (const d of ['att.net', 'sbcglobal.net', 'comcast.net', 'verizon.net', 'cox.net', 'ymail.com', 'pm.me', 'gmx.de', 'outlook.fr', 'live.co.uk', 'hotmail.de', 'yahoo.co.jp', 'yahoo.ca', 'protonmail.ch', 'mail.com', 'zoho.com']) {
      expect(isFreemailDomain(d), d).toBe(true);
      expect(chooseClaimMethod({ claimantEmail: `owner@${d}`, censusEmail: `dispatch@${d}`, claimantVerified: true }), d).toBe('email_otp');
    }
    expect(isFreemailDomain('acme.com')).toBe(false);
    expect(isFreemailDomain('outlookfreight.com')).toBe(false);
  });
  it('neutral claim slugs are recognisable; branded ones are not', () => {
    expect(neutralClaimSlug('107080', 'AbC123')).toBe('claim-107080-abc123');
    expect(isNeutralClaimSlug('claim-107080-abc123')).toBe(true);
    expect(isNeutralClaimSlug('acme-drayage')).toBe(false);
  });
});

describe('startClaim → email_otp → verifyClaimCode', () => {
  it('sends a 6-digit code to the CENSUS email (not the claimant), stores only its hash, masks the address', async () => {
    const r = await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    expect(r.kind).toBe('otp_sent');
    if (r.kind !== 'otp_sent') return;
    expect(r.maskedEmail).toBe('d***@acme.com');
    expect(r.expiresAt.getTime()).toBe(now.getTime() + CLAIM_OTP_TTL_MS);
    expect(store.sentCodes).toHaveLength(1);
    expect(store.sentCodes[0].to).toBe('dispatch@acme.com');
    expect(store.sentCodes[0].code).toMatch(/^\d{6}$/);
    const claim = store.claims[0];
    expect(claim.method).toBe('email_otp');
    expect(claim.status).toBe('pending');
    expect(claim.otpHash).toBe(hashOtp(store.sentCodes[0].code));
    expect(claim.otpHash).not.toContain(store.sentCodes[0].code);
    // Nothing is verified yet.
    expect(store.claimedMarks).toHaveLength(0);
    expect(store.publicEmails).toHaveLength(0);
  });

  it('the right code verifies: claim row, carrier mirror, tenant owner flag + dot/mc, public email', async () => {
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    const code = store.sentCodes[0].code;
    const v = await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code, now: new Date(now.getTime() + 60_000) });
    expect(v.kind).toBe('verified');
    const claim = store.claims[0];
    expect(claim.status).toBe('verified');
    expect(claim.verifiedAt).toBeInstanceOf(Date);
    expect(claim.otpHash).toBeNull();
    expect(store.claimedMarks).toEqual([{ usdot: '107080', tenantId: 42, method: 'email_otp' }]);
    expect(store.carriers[0].claimedTenantId).toBe(42);
    const t = store.tenants.get(42)!;
    expect(t.isDirectoryOwner).toBe(true);
    expect(t.dotNumber).toBe('107080');
    expect(t.mcNumber).toBe('MC012892');
    // Trial is untouched: claiming never starts one.
    expect(t.trialEndsAt).toBeNull();
    expect(store.publicEmails).toEqual([{ usdot: '107080', email: 'owner@acme.com', actorUserId: 7 }]);
  });

  it('a code no provider accepted is never honoured: the claim falls back to manual, no hash kept', async () => {
    store.emailDeliverable = false;
    const r = await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    expect(r.kind).toBe('needs_manual');
    expect(store.sentCodes).toHaveLength(0);
    expect(store.claims[0]).toMatchObject({ method: 'manual', status: 'pending', otpHash: null, otpExpiresAt: null });
    // No code exists to verify against.
    expect((await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: '123456', now })).kind).toBe('not_found');
  });

  it('a losing racer (row claimed between start and verify) is REJECTED, never verified or owner', async () => {
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    // The directory row read still looks unclaimed, but the guarded UPDATE
    // writes 0 rows — exactly what a concurrent winner produces.
    store.markCarrierClaimed = async () => 0;
    const v = await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: store.sentCodes[0].code, now });
    expect(v.kind).toBe('already_claimed');
    expect(store.claims[0]).toMatchObject({ status: 'rejected', rejectedReason: 'already_claimed', otpHash: null });
    expect(store.tenants.get(42)!.isDirectoryOwner).toBe(false);
    expect(store.publicEmails).toHaveLength(0);
    expect(store.purged).toHaveLength(0);
  });

  it('a verified claim brands the neutral slug from the company name and purges the profile', async () => {
    store.tenants.set(42, { isDirectoryOwner: false, trialEndsAt: null, dotNumber: null, mcNumber: null, slug: 'claim-107080-x1y2z3' });
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: store.sentCodes[0].code, now });
    expect(store.tenants.get(42)!.slug).toBe('acme-drayage-inc');
    expect(store.purged).toEqual(['acme-drayage-inc-107080']);
  });

  it('never re-slugs a tenant that already has a real slug', async () => {
    store.tenants.set(42, { isDirectoryOwner: false, trialEndsAt: null, dotNumber: null, mcNumber: null, slug: 'harbor-link' });
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: store.sentCodes[0].code, now });
    expect(store.tenants.get(42)!.slug).toBe('harbor-link');
  });

  it('never overwrites a DOT/MC the tenant already typed', async () => {
    store.tenants.set(42, { isDirectoryOwner: false, trialEndsAt: null, dotNumber: '999', mcNumber: 'MC1' });
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: store.sentCodes[0].code, now });
    expect(store.tenants.get(42)!.dotNumber).toBe('999');
    expect(store.tenants.get(42)!.mcNumber).toBe('MC1');
  });

  it(`wrong code x${CLAIM_OTP_MAX_ATTEMPTS} locks the claim; the right code no longer works`, async () => {
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    const right = store.sentCodes[0].code;
    const wrong = right === '000000' ? '000001' : '000000';
    for (let i = 1; i < CLAIM_OTP_MAX_ATTEMPTS; i++) {
      const r = await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: wrong, now });
      expect(r).toEqual({ kind: 'wrong_code', attemptsLeft: CLAIM_OTP_MAX_ATTEMPTS - i });
    }
    const last = await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: wrong, now });
    expect(last.kind).toBe('locked');
    const again = await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: right, now });
    expect(again.kind).toBe('locked');
    expect(store.claims[0].status).toBe('pending');
    expect(store.claimedMarks).toHaveLength(0);
  });

  it('an expired code is refused and the claim is marked expired', async () => {
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    const late = new Date(now.getTime() + CLAIM_OTP_TTL_MS + 1);
    const r = await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: store.sentCodes[0].code, now: late });
    expect(r.kind).toBe('expired');
    expect(store.claims[0].status).toBe('expired');
  });

  it('restarting an open claim issues a FRESH code and resets attempts', async () => {
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: '000000', now });
    await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: '000001', now });
    const r = await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    expect(r.kind).toBe('otp_sent');
    expect(store.claims).toHaveLength(1);
    expect(store.claims[0].attempts).toBe(0);
    expect(store.sentCodes).toHaveLength(2);
    // The old code is dead (unless the CSPRNG repeated it, 1 in 10^6); the new one works.
    const [first, second] = store.sentCodes.map((s) => s.code);
    if (first !== second) {
      const old = await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: first, now });
      expect(old.kind).toBe('wrong_code');
    }
    const fresh = await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: second, now });
    expect(fresh.kind).toBe('verified');
  });

  it('verify without a pending claim → not_found; unknown USDOT → not_found', async () => {
    expect((await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: '123456', now })).kind).toBe('not_found');
    expect((await verifyClaimCode(store, { usdot: '1', tenantId: 42, actor, code: '123456', now })).kind).toBe('not_found');
    expect((await startClaim(store, { usdot: 'abc', tenantId: 42, actor, claimantVerified: false, now })).kind).toBe('not_found');
  });
});

describe('already-claimed profiles', () => {
  it('start and verify both refuse with already_claimed', async () => {
    store.carriers[0].claimedTenantId = 99;
    expect((await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: true, now })).kind).toBe('already_claimed');
    expect((await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: '123456', now })).kind).toBe('already_claimed');
    expect(store.claims).toHaveLength(0);
    expect(store.sentCodes).toHaveLength(0);
  });
});

describe('domain_match', () => {
  it('a VERIFIED claimant on the census domain is verified immediately, no code sent', async () => {
    const r = await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: true, now });
    expect(r.kind).toBe('verified');
    if (r.kind !== 'verified') return;
    expect(r.method).toBe('domain_match');
    expect(r.slug).toBe('acme-drayage-inc-107080');
    expect(store.sentCodes).toHaveLength(0);
    expect(store.claims[0].status).toBe('verified');
    expect(store.claims[0].method).toBe('domain_match');
    expect(store.claimedMarks[0].method).toBe('domain_match');
    expect(store.tenants.get(42)!.isDirectoryOwner).toBe(true);
    expect(store.publicEmails[0].email).toBe('owner@acme.com');
  });

  it('an UNVERIFIED claimant on the same domain still gets the code', async () => {
    const r = await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    expect(r.kind).toBe('otp_sent');
  });

  it('a freemail match is never domain_match', async () => {
    store.carriers[0].email = 'acmedrayage@gmail.com';
    const r = await startClaim(store, { usdot: '107080', tenantId: 42, actor: { userId: 7, email: 'someone@gmail.com' }, claimantVerified: true, now });
    expect(r.kind).toBe('otp_sent');
  });
});

describe('manual path', () => {
  beforeEach(() => {
    store.carriers[0].email = null;
  });

  it('a record with no email creates a pending manual claim and sends nothing', async () => {
    const r = await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: true, now });
    expect(r.kind).toBe('needs_manual');
    expect(store.sentCodes).toHaveLength(0);
    expect(store.claims[0]).toMatchObject({ method: 'manual', status: 'pending', otpHash: null, note: 'claimant:owner@acme.com' });
    expect(store.claimedMarks).toHaveLength(0);
  });

  it('admin approval verifies it (all 4 writes); a second review is not_pending', async () => {
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: true, now });
    const r = await reviewClaim(store, { claimId: store.claims[0].id, decision: 'verified', now });
    expect(r.kind).toBe('verified');
    expect(store.claims[0].status).toBe('verified');
    expect(store.claimedMarks).toEqual([{ usdot: '107080', tenantId: 42, method: 'manual' }]);
    expect(store.tenants.get(42)!.isDirectoryOwner).toBe(true);
    expect(store.publicEmails[0].email).toBe('owner@acme.com');
    expect((await reviewClaim(store, { claimId: store.claims[0].id, decision: 'verified', now })).kind).toBe('not_pending');
  });

  it('admin rejection records the reason and writes nothing else', async () => {
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: true, now });
    const r = await reviewClaim(store, { claimId: store.claims[0].id, decision: 'rejected', reason: 'Not the registrant', now });
    expect(r.kind).toBe('rejected');
    expect(store.claims[0]).toMatchObject({ status: 'rejected', rejectedReason: 'Not the registrant' });
    expect(store.claimedMarks).toHaveLength(0);
    expect(store.tenants.get(42)!.isDirectoryOwner).toBe(false);
  });

  it('unknown claim id → not_found; approving a profile another tenant owns → already_claimed', async () => {
    expect((await reviewClaim(store, { claimId: 999, decision: 'verified', now })).kind).toBe('not_found');
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: true, now });
    store.carriers[0].claimedTenantId = 99;
    expect((await reviewClaim(store, { claimId: store.claims[0].id, decision: 'verified', now })).kind).toBe('already_claimed');
  });
});

describe('activateOwnerTrial — the "30 days free" upsell', () => {
  it('a VERIFIED directory owner with NO trial gets exactly CLAIM_OWNER_TRIAL_DAYS', async () => {
    store.tenants.set(42, { isDirectoryOwner: true, trialEndsAt: null, dotNumber: null, mcNumber: null });
    store.carriers[0].claimedTenantId = 42;
    const r = await activateOwnerTrial(store, { tenantId: 42, now });
    expect(r.kind).toBe('activated');
    if (r.kind !== 'activated') return;
    expect(r.trialEndsAt.getTime()).toBe(now.getTime() + CLAIM_OWNER_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    expect(CLAIM_OWNER_TRIAL_DAYS).toBe(30);
    expect(store.tenants.get(42)!.trialEndsAt?.getTime()).toBe(r.trialEndsAt.getTime());
  });

  it('an UNVERIFIED claimant (started, never verified) cannot start the trial; after verifying they can', async () => {
    await startClaim(store, { usdot: '107080', tenantId: 42, actor, claimantVerified: false, now });
    expect((await activateOwnerTrial(store, { tenantId: 42, now })).kind).toBe('not_eligible');
    // Even a stray owner flag without a directory row naming the tenant is refused.
    store.tenants.get(42)!.isDirectoryOwner = true;
    expect((await activateOwnerTrial(store, { tenantId: 42, now })).kind).toBe('not_eligible');
    store.tenants.get(42)!.isDirectoryOwner = false;
    await verifyClaimCode(store, { usdot: '107080', tenantId: 42, actor, code: store.sentCodes[0].code, now });
    expect((await activateOwnerTrial(store, { tenantId: 42, now })).kind).toBe('activated');
  });

  it('refuses a regular (non-owner) tenant, an owner already in/after a trial, and an unknown tenant', async () => {
    store.carriers[0].claimedTenantId = 42;
    store.tenants.set(42, { isDirectoryOwner: false, trialEndsAt: null, dotNumber: null, mcNumber: null });
    expect((await activateOwnerTrial(store, { tenantId: 42, now })).kind).toBe('not_eligible');
    store.tenants.set(42, { isDirectoryOwner: true, trialEndsAt: new Date(now.getTime() - 1), dotNumber: null, mcNumber: null });
    expect((await activateOwnerTrial(store, { tenantId: 42, now })).kind).toBe('not_eligible');
    store.tenants.set(42, { isDirectoryOwner: true, trialEndsAt: new Date(now.getTime() + 1), dotNumber: null, mcNumber: null });
    expect((await activateOwnerTrial(store, { tenantId: 42, now })).kind).toBe('not_eligible');
    expect((await activateOwnerTrial(store, { tenantId: 1, now })).kind).toBe('not_eligible');
  });
});

describe('re-ingest can never un-claim a profile', () => {
  it('CARRIER_UPSERT_SET never writes claimed_tenant_id / claimed_at / claim_method', () => {
    const keys = Object.keys(CARRIER_UPSERT_SET);
    for (const forbidden of ['claimedTenantId', 'claimedAt', 'claimMethod']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
