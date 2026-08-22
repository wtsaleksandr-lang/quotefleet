/**
 * Enriched-contacts reveal core (carrierContacts.ts) — cache / TTL / dedupe /
 * cost-gate behaviors. Fully offline: a fake `RevealStore` + a stub `enrich`,
 * no DB, no network, no AI.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CompanyProfile } from '../outreach/enrichCompany.js';
import {
  revealContacts,
  extractAdditionalContacts,
  normalizeUsdot,
  type DerivedContact,
  type RevealStore,
  type RevealedContact,
} from './carrierContacts.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────
function profile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    domain: 'acme-freight.com',
    website: 'https://acme-freight.com',
    companyName: 'Acme Freight',
    tagline: null,
    phone: null,
    email: null,
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
    ...overrides,
  };
}

interface FakeStoreState {
  state?: { attemptedAt: Date; contactCount: number } | null;
  carrier?: { email: string | null; phone: string | null } | null;
  contacts?: RevealedContact[];
}

function fakeStore(init: FakeStoreState = {}) {
  const saved: DerivedContact[] = [];
  const attempts: number[] = [];
  const store: RevealStore = {
    getState: vi.fn(async () => init.state ?? null),
    getContacts: vi.fn(async () => init.contacts ?? []),
    saveContacts: vi.fn(async (_dot, cs) => {
      // Dedupe by email like the real UNIQUE(carrier_dot,email) upsert.
      for (const c of cs) {
        const i = saved.findIndex((s) => s.email === c.email);
        if (i >= 0) saved[i] = c;
        else saved.push(c);
      }
    }),
    recordAttempt: vi.fn(async (_dot, count) => {
      attempts.push(count);
    }),
    getCarrierContact: vi.fn(async () => init.carrier ?? null),
  };
  return { store, saved, attempts };
}

// ─── normalizeUsdot ──────────────────────────────────────────────────────
describe('normalizeUsdot', () => {
  it('strips non-digits and leading zeros', () => {
    expect(normalizeUsdot('0107080')).toBe('107080');
    expect(normalizeUsdot('USDOT 107080')).toBe('107080');
    expect(normalizeUsdot('107080')).toBe('107080');
  });
  it('returns "" for non-numeric / all-zero input', () => {
    expect(normalizeUsdot('abc')).toBe('');
    expect(normalizeUsdot('000')).toBe('');
    expect(normalizeUsdot(null)).toBe('');
  });
});

// ─── extractAdditionalContacts (Model-B dedupe) ──────────────────────────
describe('extractAdditionalContacts', () => {
  it('DROPS a scraped email/phone equal to the free FMCSA record (never re-tiers free)', () => {
    const p = profile({ email: 'info@acme-freight.com', phone: '(555) 111-2222' });
    const out = extractAdditionalContacts(p, 'INFO@acme-freight.com', '555-111-2222');
    expect(out).toEqual([]); // both equal the free record → nothing additional
  });

  it('returns an additional contact when the scraped email differs from the free one', () => {
    const p = profile({ email: 'dispatch@acme-freight.com', phone: '555-111-2222' });
    const out = extractAdditionalContacts(p, 'info@acme-freight.com', '555-111-2222');
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe('dispatch@acme-freight.com');
    expect(out[0].phone).toBeNull(); // phone matched the free record → dropped
    expect(out[0].source).toBe('enrich');
    expect(out[0].confidence).toBe('low');
  });

  it('keeps an additional phone even when the email matches the free record', () => {
    const p = profile({ email: 'info@acme-freight.com', phone: '555-999-0000' });
    const out = extractAdditionalContacts(p, 'info@acme-freight.com', '555-111-2222');
    expect(out).toHaveLength(1);
    expect(out[0].email).toBeNull();
    expect(out[0].phone).toBe('555-999-0000');
  });
});

// ─── revealContacts — cache / TTL ────────────────────────────────────────
describe('revealContacts — cache & TTL', () => {
  const now = () => Date.UTC(2026, 7, 22);

  it('FRESH cache: returns cached contacts WITHOUT calling enrich', async () => {
    const cached: RevealedContact[] = [
      { contactName: 'Acme Freight', title: 'Ops', email: 'dispatch@acme-freight.com', phone: null, confidence: 'low' },
    ];
    const { store } = fakeStore({
      state: { attemptedAt: new Date(now() - 10 * 86_400_000), contactCount: 1 },
      contacts: cached,
    });
    const enrich = vi.fn();
    const res = await revealContacts('107080', { store, enrich, now, ttlDays: 60 });
    expect(res.status).toBe('cached');
    expect(res.contacts).toHaveLength(1);
    expect(enrich).not.toHaveBeenCalled();
  });

  it('attempted-and-empty within TTL: returns empty from cache, NO re-scrape', async () => {
    const { store } = fakeStore({ state: { attemptedAt: new Date(now() - 5 * 86_400_000), contactCount: 0 } });
    const enrich = vi.fn();
    const res = await revealContacts('107080', { store, enrich, now, ttlDays: 60 });
    expect(res.status).toBe('cached');
    expect(res.contacts).toEqual([]);
    expect(enrich).not.toHaveBeenCalled();
    expect(store.getContacts).not.toHaveBeenCalled();
  });

  it('STALE marker (older than TTL): re-enriches', async () => {
    const { store, attempts } = fakeStore({
      state: { attemptedAt: new Date(now() - 100 * 86_400_000), contactCount: 0 },
      carrier: { email: 'ops@acme-freight.com', phone: null },
    });
    const enrich = vi.fn(async () => profile({ email: 'dispatch@acme-freight.com' }));
    const res = await revealContacts('107080', { store, enrich, now, ttlDays: 60 });
    expect(enrich).toHaveBeenCalledOnce();
    expect(res.status).toBe('fresh');
    expect(attempts).toEqual([1]);
  });
});

// ─── revealContacts — enrich path ────────────────────────────────────────
describe('revealContacts — enrich, upsert, dedupe', () => {
  it('stale/absent → enrich + upsert + records the attempt count', async () => {
    const { store, saved, attempts } = fakeStore({
      state: null,
      carrier: { email: 'info@acme-freight.com', phone: '555-111-2222' },
    });
    const enrich = vi.fn(async () => profile({ email: 'dispatch@acme-freight.com', phone: '555-999-0000' }));
    const res = await revealContacts('0107080', { store, enrich });
    expect(res.status).toBe('fresh');
    expect(res.contacts).toHaveLength(1);
    expect(res.contacts[0].email).toBe('dispatch@acme-freight.com');
    expect(saved).toHaveLength(1);
    expect(attempts).toEqual([1]);
    // enrich is called with the census-email DOMAIN, not the USDOT.
    expect(enrich).toHaveBeenCalledWith('acme-freight.com', expect.anything());
  });

  it('re-reveal upserts on (dot,email) rather than duplicating', async () => {
    const { store, saved } = fakeStore({ state: null, carrier: { email: 'info@acme-freight.com', phone: null } });
    const enrich = vi.fn(async () => profile({ email: 'dispatch@acme-freight.com' }));
    await revealContacts('107080', { store, enrich });
    await revealContacts('107080', { store, enrich });
    expect(saved).toHaveLength(1); // same email upserted, not duplicated
  });

  it('carrier with NO census email → empty, enrich NOT called, attempt recorded 0', async () => {
    const { store, attempts } = fakeStore({ state: null, carrier: { email: null, phone: null } });
    const enrich = vi.fn();
    const res = await revealContacts('107080', { store, enrich });
    expect(res.status).toBe('empty');
    expect(enrich).not.toHaveBeenCalled();
    expect(attempts).toEqual([0]);
  });

  it('freemail census email (gmail) → empty, enrich NOT called', async () => {
    const { store } = fakeStore({ state: null, carrier: { email: 'joe@gmail.com', phone: null } });
    const enrich = vi.fn();
    const res = await revealContacts('107080', { store, enrich });
    expect(res.status).toBe('empty');
    expect(enrich).not.toHaveBeenCalled();
  });

  it('enrichment THROWING → status "error", empty contacts, never throws', async () => {
    const { store } = fakeStore({ state: null, carrier: { email: 'ops@acme-freight.com', phone: null } });
    const enrich = vi.fn(async () => {
      throw new Error('bot-walled');
    });
    const res = await revealContacts('107080', { store, enrich });
    expect(res.status).toBe('error');
    expect(res.contacts).toEqual([]);
  });
});

// ─── revealContacts — daily cap hook ─────────────────────────────────────
describe('revealContacts — onBeforeEnrich quota gate', () => {
  it('aborts with status "capped" when the quota hook returns false (no enrich)', async () => {
    const { store, attempts } = fakeStore({ state: null, carrier: { email: 'ops@acme-freight.com', phone: null } });
    const enrich = vi.fn();
    const res = await revealContacts('107080', { store, enrich, onBeforeEnrich: () => false });
    expect(res.status).toBe('capped');
    expect(enrich).not.toHaveBeenCalled();
    expect(attempts).toEqual([]); // not recorded — they can retry when the cap resets
  });
});
