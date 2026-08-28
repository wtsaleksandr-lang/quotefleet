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

/** The FREE FLOOR: Hunter resolved no email at all. The phone and address that
 *  ride along are free page data, so this outcome sells nothing. */
function nothingFound(): TieredContact {
  return {
    contact_confidence: 'phone_only',
    domain: null,
    contact_name: null,
    title: null,
    email: null,
    email_confidence: null,
    role_emails: [],
    phone: '912-555-0100',
    address: '1 Main St, Newberry, SC 29108',
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
    const d = deps({ resolveContact: vi.fn(async () => nothingFound()) });
    const r = res();
    await handleImporterReveal(req('unknown-co'), r, d);
    expect(r.body.ok).toBe(true);
    expect(r.body.contact.confidence).toBe('phone_only');
    expect(r.body.contact.email).toBeNull();
  });
});

/* ── NEVER CONSUME AN ALLOWANCE FOR NOTHING ─────────────────────────────────
 * The phone and street address render FREE on the importer profile. A reveal that
 * resolves no email has therefore handed the user nothing they did not already
 * have, and charging a reveal for it — out of a 2-free / 50-per-month allowance —
 * would be selling them their own page back. It must cost nothing and say so.
 *
 * This reuses the ONE no-charge exit the cost-guard path already established
 * (flag the view via `unavailable`, return the count unchanged, skip
 * meter.record) rather than adding a second refund mechanism. */
describe('a reveal that finds nothing beyond the free page is never charged', () => {
  it('does not decrement the FREE taste allowance, and says why', async () => {
    const d = deps({ resolveContact: vi.fn(async () => nothingFound()) });

    // Three reveals of three different companies, all resolving to no email.
    for (const slug of ['unknown-a', 'unknown-b', 'unknown-c']) {
      const r = res();
      await handleImporterReveal(req(slug), r, d);
      expect(r.body.ok).toBe(true);
      expect(r.body.charged).toBe(false);
      // The FULL free taste is still intact after every one of them.
      expect(r.body.remaining).toBe(2);
      expect(r.body.contact.unavailable).toBe('no-email');
    }
    // …and a real, chargeable reveal afterwards still has its whole allowance.
    const good = deps({ meter: (d as { meter: LeadsRevealMeter }).meter });
    const r = res();
    await handleImporterReveal(req('bosch-tool'), r, good);
    expect(r.body.charged).toBe(true);
    expect(r.body.remaining).toBe(1);
  });

  it('does not decrement the Leads Pro monthly allowance either', async () => {
    vi.mocked(leadsIdentity).mockResolvedValue({
      userId: 7,
      email: 'pro@co.com',
      isSubscriber: true,
      status: 'active',
      currentPeriodEnd: null,
      revealAllowance: 3,
    });
    const d = deps({ resolveContact: vi.fn(async () => nothingFound()) });
    for (const slug of ['unknown-a', 'unknown-b', 'unknown-c', 'unknown-d']) {
      const r = res();
      await handleImporterReveal(req(slug, 7), r, d);
      expect(r.body.charged).toBe(false);
      expect(r.body.tier).toBe('pro');
      expect(r.body.remaining).toBe(3); // never moves
    }
  });

  it('leaves the company un-recorded, so a later retry is still a first reveal', async () => {
    // The importer may simply not be in Hunter today. Recording an uncharged
    // reveal would silently spend the user's retry: the next attempt would come
    // back `reused` from a cached negative instead of resolving fresh.
    const resolveContact = vi.fn(async () => nothingFound());
    const d = deps({ resolveContact });
    let r = res();
    await handleImporterReveal(req('unknown-a'), r, d);
    expect(r.body.reused).toBe(false);

    r = res();
    await handleImporterReveal(req('unknown-a'), r, d);
    expect(r.body.reused).toBe(false); // NOT a "you already revealed this"
    expect(r.body.charged).toBe(false);
    expect(r.body.remaining).toBe(2);
  });

  it('charges a role-based reveal — a role inbox is a real, sellable email', async () => {
    const resolveContact = vi.fn(async () => ({
      ...nothingFound(),
      contact_confidence: 'role_based' as const,
      domain: 'bosch.com',
      role_emails: ['purchasing@bosch.com', 'logistics@bosch.com'],
    }));
    const d = deps({ resolveContact });
    const r = res();
    await handleImporterReveal(req('bosch-tool'), r, d);
    expect(r.body.charged).toBe(true);
    expect(r.body.remaining).toBe(1);
  });

  it('a normal verified reveal still charges exactly one', async () => {
    const d = deps();
    const r = res();
    await handleImporterReveal(req('bosch-tool'), r, d);
    expect(r.body.charged).toBe(true);
    expect(r.body.contact.unavailable).toBeUndefined();
    expect(r.body.remaining).toBe(1);
  });
});
