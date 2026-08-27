/**
 * Importer contact-reveal endpoint (importerReveal.ts `handleImporterReveal`) —
 * the Leads Pro gating, allowance metering, and cache-first cost safety.
 *
 * Everything external is injected or mocked, so this is a pure offline unit test:
 *   • leadsIdentity is mocked (free vs subscriber);
 *   • the reveal meter, contact cache, and BOL cache are injected in-memory;
 *   • the contact resolver is a stub — NO live Hunter call is ever made.
 *
 * Asserts: free-taste gating + allowance decrement + exhaustion; the upgrade
 * state (coming-soon when the price is unset); the subscriber monthly allowance;
 * and cache-first no-double-charge (same-user re-reveal is free + does not
 * re-resolve, and a cross-user reveal of an already-cached company spends no
 * Hunter credit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('./leadsEntitlement.js', async (orig) => {
  const actual = await orig<typeof import('./leadsEntitlement.js')>();
  return { ...actual, leadsIdentity: vi.fn(), leadsProPurchasable: vi.fn(() => false) };
});
import { leadsIdentity } from './leadsEntitlement.js';
import { handleImporterReveal, type ImporterRevealDeps } from './importerReveal.js';
import type { LeadsRevealMeter } from './leadsRevealUsage.js';
import type { BolCacheStore, ContactCacheStore } from './importerCache.js';
import type { TieredContact } from './importerLeads.js';

// ─── Test doubles ────────────────────────────────────────────────────────
function res() {
  const r = {
    statusCode: 0,
    body: null as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return r as unknown as Response & { statusCode: number; body: any };
}

const req = (slug = 'bosch-tool', userId = 1) =>
  ({ params: { slug }, cookies: {}, user: { id: userId } }) as unknown as Request;

/** A verified-tier contact — the stub never touches Hunter. */
function tiered(email = 'dm@bosch.com'): TieredContact {
  return {
    contact_confidence: 'verified',
    domain: 'bosch.com',
    contact_name: 'Jane Buyer',
    title: 'Logistics Director',
    email,
    email_confidence: 95,
    role_emails: [],
    phone: null,
    address: null,
  };
}

/** BOL cache that always MISSES → loadCompanyIdentity falls back to the slug
 *  name (distinct per slug), so each slug maps to a distinct company/cache key. */
function missBolCache(): BolCacheStore {
  return { get: async () => null, put: async () => {} };
}

function memContactCache(): ContactCacheStore {
  const m = new Map<string, { companyKey: string; domain: string | null; confidence: any; contact: any; fetchedAt: Date }>();
  return {
    async get(k) {
      return m.get(k) ?? null;
    },
    async getMany() {
      return new Map();
    },
    async put(hit) {
      m.set(hit.companyKey, { ...hit, fetchedAt: new Date() });
    },
  };
}

function memMeter(): LeadsRevealMeter {
  const counts = new Map<string, number>();
  const revealed = new Map<string, Set<string>>();
  return {
    async getReveals(k, p) {
      return counts.get(`${k}|${p}`) ?? 0;
    },
    async hasRevealed(k, slug) {
      return revealed.get(k)?.has(slug.toLowerCase()) ?? false;
    },
    async record(k, p, slug) {
      let s = revealed.get(k);
      if (!s) {
        s = new Set();
        revealed.set(k, s);
      }
      s.add(slug.toLowerCase());
      const n = (counts.get(`${k}|${p}`) ?? 0) + 1;
      counts.set(`${k}|${p}`, n);
      return n;
    },
  };
}

function deps(overrides: Partial<ImporterRevealDeps> = {}): ImporterRevealDeps & { resolveContact: ReturnType<typeof vi.fn> } {
  const resolveContact = vi.fn(async () => tiered());
  return {
    meter: memMeter(),
    contactCache: memContactCache(),
    bolCache: missBolCache(),
    resolveContact,
    ...overrides,
  } as ImporterRevealDeps & { resolveContact: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.mocked(leadsIdentity).mockReset();
  vi.mocked(leadsIdentity).mockResolvedValue({
    userId: 1,
    email: 'shipper@co.com',
    isSubscriber: false,
    status: null,
    currentPeriodEnd: null,
    revealAllowance: 0,
  });
});

describe('free-taste gating + allowance decrement + exhaustion', () => {
  it('gives exactly FREE_REVEAL_TASTE (2) reveals, then walls with an upgrade', async () => {
    const d = deps();

    // Reveal #1 (new company) → ok, 1 remaining, resolver called once.
    let r = res();
    await handleImporterReveal(req('bosch-tool'), r, d);
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.remaining).toBe(1);
    expect(r.body.contact.email).toBe('dm@bosch.com');

    // Reveal #2 (different company) → ok, 0 remaining.
    r = res();
    await handleImporterReveal(req('komatsu-america'), r, d);
    expect(r.body.ok).toBe(true);
    expect(r.body.remaining).toBe(0);
    expect(d.resolveContact).toHaveBeenCalledTimes(2);

    // Reveal #3 (out of taste) → NOT ok, upgrade, coming-soon (price unset),
    // and the resolver is NOT called (no Hunter spend past the wall).
    r = res();
    await handleImporterReveal(req('axis-comm'), r, d);
    expect(r.body.ok).toBe(false);
    expect(r.body.reason).toBe('upgrade');
    expect(r.body.comingSoon).toBe(true);
    expect(d.resolveContact).toHaveBeenCalledTimes(2);
  });
});

describe('subscriber monthly allowance', () => {
  it('meters against the monthly allowance and exhausts with allowance_exhausted', async () => {
    vi.mocked(leadsIdentity).mockResolvedValue({
      userId: 5,
      email: 's@co.com',
      isSubscriber: true,
      status: 'active',
      currentPeriodEnd: null,
      revealAllowance: 2, // small cap for the test
    });
    const d = deps();

    for (const slug of ['co-a', 'co-b']) {
      const r = res();
      await handleImporterReveal(req(slug, 5), r, d);
      expect(r.body.ok).toBe(true);
      expect(r.body.tier).toBe('pro');
    }

    const r = res();
    await handleImporterReveal(req('co-c', 5), r, d);
    expect(r.body.ok).toBe(false);
    expect(r.body.reason).toBe('allowance_exhausted');
    expect(d.resolveContact).toHaveBeenCalledTimes(2);
  });
});

describe('cache-first — no double charge', () => {
  it('same-user re-reveal is free: no decrement and no re-resolve', async () => {
    const d = deps();

    let r = res();
    await handleImporterReveal(req('bosch-tool'), r, d);
    expect(r.body.remaining).toBe(1);
    expect(d.resolveContact).toHaveBeenCalledTimes(1);

    // Re-reveal the SAME company → reused, allowance unchanged, no new resolve.
    r = res();
    await handleImporterReveal(req('bosch-tool'), r, d);
    expect(r.body.ok).toBe(true);
    expect(r.body.reused).toBe(true);
    expect(r.body.remaining).toBe(1);
    expect(d.resolveContact).toHaveBeenCalledTimes(1);
  });

  it('cross-user reveal of an already-cached company spends no Hunter credit', async () => {
    // Shared cache + resolver across two users; each has their own allowance.
    const d = deps();

    // User 1 reveals bosch-tool → resolver runs once, result cached.
    vi.mocked(leadsIdentity).mockResolvedValue({
      userId: 1,
      email: 'a@co.com',
      isSubscriber: false,
      status: null,
      currentPeriodEnd: null,
      revealAllowance: 0,
    });
    let r = res();
    await handleImporterReveal(req('bosch-tool', 1), r, d);
    expect(d.resolveContact).toHaveBeenCalledTimes(1);

    // User 2 reveals the SAME company → served from the shared contact cache
    // (no resolver call), but User 2's own allowance decrements (they got value).
    vi.mocked(leadsIdentity).mockResolvedValue({
      userId: 2,
      email: 'b@co.com',
      isSubscriber: false,
      status: null,
      currentPeriodEnd: null,
      revealAllowance: 0,
    });
    r = res();
    await handleImporterReveal(req('bosch-tool', 2), r, d);
    expect(r.body.ok).toBe(true);
    expect(r.body.remaining).toBe(1); // 2 free - 1 used
    expect(d.resolveContact).toHaveBeenCalledTimes(1); // still only ONE Hunter resolve
  });
});

describe('honest claims', () => {
  it('returns the real resolved tier verbatim — never a fabricated contact', async () => {
    const resolveContact = vi.fn(async () => ({
      contact_confidence: 'phone_only' as const,
      domain: null,
      contact_name: null,
      title: null,
      email: null,
      email_confidence: null,
      role_emails: [],
      phone: null,
      address: null,
    }));
    const d = deps({ resolveContact });
    const r = res();
    await handleImporterReveal(req('unknown-co'), r, d);
    expect(r.body.ok).toBe(true);
    expect(r.body.contact.confidence).toBe('phone_only');
    expect(r.body.contact.email).toBeNull();
  });
});
