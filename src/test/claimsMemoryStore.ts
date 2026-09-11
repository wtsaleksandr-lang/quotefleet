/**
 * In-memory ClaimStore for the profile-claim tests (directory/claims.test.ts,
 * routes/claim.test.ts). Records every side effect so a test can assert the
 * exact writes a transition made — no DB, no email provider.
 */
import type { CarrierClaimRow, NewCarrierClaimRow } from '../db/schema.js';
import type { ClaimCarrier, ClaimStore } from '../server/directory/claims.js';
import { isNeutralClaimSlug } from '../server/directory/claims.js';

export interface MemoryTenant {
  isDirectoryOwner: boolean;
  trialEndsAt: Date | null;
  dotNumber: string | null;
  mcNumber: string | null;
  slug?: string;
}

export interface MemoryClaimStore extends ClaimStore {
  carriers: ClaimCarrier[];
  claims: CarrierClaimRow[];
  tenants: Map<number, MemoryTenant>;
  users: Map<number, { id: number; email: string; verified: boolean }>;
  sentCodes: Array<{ to: string; code: string; company: string }>;
  publicEmails: Array<{ usdot: string; email: string; actorUserId: number }>;
  claimedMarks: Array<{ usdot: string; tenantId: number; method: string }>;
  purged: string[];
  /** Simulates "a real provider accepted the send" (true) vs logged-only (false). */
  emailDeliverable: boolean;
}

export function memoryClaimStore(): MemoryClaimStore {
  let nextId = 1;
  const store: MemoryClaimStore = {
    carriers: [],
    claims: [],
    tenants: new Map(),
    users: new Map(),
    sentCodes: [],
    publicEmails: [],
    claimedMarks: [],
    purged: [],
    emailDeliverable: true,

    async carrierByUsdot(usdot) {
      return store.carriers.find((c) => c.usdot === usdot) ?? null;
    },
    async pendingClaim(usdot, tenantId) {
      return store.claims.find((c) => c.usdot === usdot && c.tenantId === tenantId && c.status === 'pending') ?? null;
    },
    async claimById(id) {
      return store.claims.find((c) => c.id === id) ?? null;
    },
    async insertClaim(row: NewCarrierClaimRow) {
      const full: CarrierClaimRow = {
        id: nextId++,
        usdot: row.usdot,
        tenantId: row.tenantId,
        userId: row.userId,
        method: row.method,
        status: row.status ?? 'pending',
        otpHash: row.otpHash ?? null,
        otpExpiresAt: row.otpExpiresAt ?? null,
        attempts: row.attempts ?? 0,
        note: row.note ?? null,
        createdAt: new Date(),
        verifiedAt: row.verifiedAt ?? null,
        rejectedReason: row.rejectedReason ?? null,
      };
      store.claims.push(full);
      return full;
    },
    async updateClaim(id, patch) {
      const c = store.claims.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
    async markCarrierClaimed(usdot, tenantId, method, at) {
      void at;
      const c = store.carriers.find((x) => x.usdot === usdot);
      if (!c || c.claimedTenantId != null) return 0;
      c.claimedTenantId = tenantId;
      store.claimedMarks.push({ usdot, tenantId, method });
      return 1;
    },
    async markTenantOwner(tenantId, ids) {
      const t = store.tenants.get(tenantId) ?? { isDirectoryOwner: false, trialEndsAt: null, dotNumber: null, mcNumber: null };
      t.isDirectoryOwner = true;
      if (!t.dotNumber) t.dotNumber = ids.dotNumber;
      if (!t.mcNumber) t.mcNumber = ids.mcNumber;
      store.tenants.set(tenantId, t);
    },
    async brandTenantSlug(tenantId, companyName) {
      const t = store.tenants.get(tenantId);
      if (!t || !isNeutralClaimSlug(t.slug)) return;
      t.slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    },
    async setPublicEmail(usdot, email, actor) {
      store.publicEmails.push({ usdot, email, actorUserId: actor.userId });
    },
    async sendOtpEmail(to, opts) {
      if (!store.emailDeliverable) return false;
      store.sentCodes.push({ to, code: opts.code, company: opts.company });
      return true;
    },
    async userEmailVerified(userId) {
      return store.users.get(userId)?.verified ?? false;
    },
    async userById(userId) {
      const u = store.users.get(userId);
      return u ? { id: u.id, email: u.email } : null;
    },
    async tenantTrial(tenantId) {
      const t = store.tenants.get(tenantId);
      return t ? { isDirectoryOwner: t.isDirectoryOwner, trialEndsAt: t.trialEndsAt } : null;
    },
    async hasVerifiedClaim(tenantId) {
      return store.carriers.some((c) => c.claimedTenantId === tenantId);
    },
    async setTrialEndsAt(tenantId, trialEndsAt) {
      const t = store.tenants.get(tenantId);
      if (t) t.trialEndsAt = trialEndsAt;
    },
    async purgeProfileCache(slug) {
      store.purged.push(slug);
    },
  };
  return store;
}

export function memoryCarrier(overrides: Partial<ClaimCarrier> = {}): ClaimCarrier {
  return {
    usdot: '107080',
    slug: 'acme-drayage-inc-107080',
    name: 'ACME DRAYAGE INC',
    mcNumber: 'MC012892',
    email: 'dispatch@acme.com',
    claimedTenantId: null,
    ...overrides,
  };
}
