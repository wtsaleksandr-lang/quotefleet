/**
 * Directory Pro reveal endpoint (directoryReveal.ts `handleReveal`) — gating,
 * never-500, and the per-user DAILY cap. Entitlement is mocked; the store,
 * usage meter and enrich fn are injected, so this is a pure offline unit test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../directory/entitlement.js', () => ({
  hasDirectoryPro: vi.fn(),
  directoryIdentity: vi.fn(),
}));
import { hasDirectoryPro, directoryIdentity } from '../directory/entitlement.js';
import { handleReveal, type RevealRouteDeps } from './directoryReveal.js';
import type { CompanyProfile } from '../outreach/enrichCompany.js';
import type { RevealStore } from '../directory/carrierContacts.js';
import type { RevealUsageStore } from '../directory/revealUsage.js';

// ─── Test doubles ────────────────────────────────────────────────────────
function res() {
  const r = {
    statusCode: 0,
    body: '' as unknown,
    _type: '',
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    type(t: string) {
      this._type = t;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return r as unknown as Response & { statusCode: number; body: string; _type: string };
}

const req = (usdot = '107080') => ({ params: { usdot } }) as unknown as Request;

function profile(email: string | null): CompanyProfile {
  return {
    domain: 'acme-freight.com',
    website: 'https://acme-freight.com',
    companyName: 'Acme Freight',
    tagline: null,
    phone: null,
    email,
    mailingAddress: null,
    serviceModes: [],
    regionsLanes: [],
    brandColors: { primary: null, secondary: null, confidence: 'low' },
    logoUrl: null,
    logoConfidence: 'low',
    ai: null,
    aiAvailable: false,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes: [],
    fetchedPaths: [],
  };
}

/** Store that always takes the fresh-enrich path with a company census email. */
function alwaysEnrichStore(): RevealStore {
  return {
    getState: async () => null,
    getContacts: async () => [],
    saveContacts: async () => {},
    recordAttempt: async () => {},
    getCarrierContact: async () => ({ email: 'info@acme-freight.com', phone: null }),
  };
}

function memUsage(): RevealUsageStore {
  const m = new Map<string, number>();
  return {
    async getReveals(k, p) {
      return m.get(`${k}|${p}`) ?? 0;
    },
    async increment(k, p) {
      const n = (m.get(`${k}|${p}`) ?? 0) + 1;
      m.set(`${k}|${p}`, n);
      return n;
    },
  };
}

beforeEach(() => {
  vi.mocked(hasDirectoryPro).mockReset();
  vi.mocked(directoryIdentity).mockReset();
  vi.mocked(directoryIdentity).mockResolvedValue({
    userId: 7,
    email: 'shipper@co.com',
    isPro: true,
    status: 'active',
    currentPeriodEnd: null,
  });
});

describe('handleReveal — gating', () => {
  it('non-Pro (free / anonymous) → 403, enrich never called', async () => {
    vi.mocked(hasDirectoryPro).mockResolvedValue(false);
    const enrich = vi.fn();
    const r = res();
    await handleReveal(req(), r, { store: alwaysEnrichStore(), usage: memUsage(), enrich: enrich as never });
    expect(r.statusCode).toBe(403);
    expect(enrich).not.toHaveBeenCalled();
  });

  it('Pro → 200 with the rendered additional contact', async () => {
    vi.mocked(hasDirectoryPro).mockResolvedValue(true);
    const enrich = vi.fn(async () => profile('dispatch@acme-freight.com'));
    const r = res();
    await handleReveal(req(), r, { store: alwaysEnrichStore(), usage: memUsage(), enrich: enrich as never });
    expect(r.statusCode).toBe(200);
    expect(String(r.body)).toContain('dispatch@acme-freight.com');
  });
});

describe('handleReveal — never 500', () => {
  it('enrichment throwing → 200 with the empty fragment (not a 500)', async () => {
    vi.mocked(hasDirectoryPro).mockResolvedValue(true);
    const enrich = vi.fn(async () => {
      throw new Error('cloudflare');
    });
    const r = res();
    await handleReveal(req(), r, { store: alwaysEnrichStore(), usage: memUsage(), enrich: enrich as never });
    expect(r.statusCode).toBe(200);
    expect(String(r.body)).toContain('No additional contacts found');
  });
});

describe('handleReveal — per-user daily cap', () => {
  it('blocks the (N+1)th fresh reveal with a friendly limit message', async () => {
    vi.mocked(hasDirectoryPro).mockResolvedValue(true);
    const enrich = vi.fn(async () => profile('dispatch@acme-freight.com'));
    const usage = memUsage();
    const cap = 2;
    const deps: RevealRouteDeps = { store: alwaysEnrichStore(), usage, enrich: enrich as never, cap };

    // First `cap` reveals succeed.
    for (let i = 0; i < cap; i++) {
      const r = res();
      await handleReveal(req(), r, deps);
      expect(r.statusCode).toBe(200);
      expect(String(r.body)).not.toContain('Daily reveal limit reached');
    }
    expect(enrich).toHaveBeenCalledTimes(cap);

    // The (N+1)th is capped — no further enrich call.
    const r = res();
    await handleReveal(req(), r, deps);
    expect(r.statusCode).toBe(200);
    expect(String(r.body)).toContain('Daily reveal limit reached');
    expect(enrich).toHaveBeenCalledTimes(cap);
  });
});
