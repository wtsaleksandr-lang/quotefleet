/**
 * CONTACT-ENRICHMENT PROVIDER CHAIN — the specs that make the capacity fix real.
 *
 * The chain exists because Hunter's ~25-search free tier was the hard ceiling on
 * how many Leads Pro reveals could be sold. Everything below fences the two ways
 * that fix could go wrong:
 *
 *   1. IT SILENTLY STOPS WORKING — the chain skips a provider it should have
 *      called, or gives up after the first miss, and capacity quietly reverts to
 *      one provider's quota.
 *   2. IT SILENTLY STARTS SPENDING — a provider gets called outside production,
 *      a domain-only provider is called speculatively with no domain, or a
 *      cost-guard block is mistaken for a real "nothing found" and charged.
 *
 * EVERY PROVIDER IS MOCKED. `globalThis.fetch` is replaced with a spy in each
 * spec, and the final describe block asserts that the real network is never
 * reached — no test in this file may cost a credit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveViaChain,
  providerOrder,
  providerQuotas,
  domainMatchesCompany,
  normalizeDomain,
  hunterProvider,
  prospeoProvider,
  ENRICHMENT_PROVIDERS,
  DEFAULT_PROVIDER_ORDER,
  PROVIDER_ORDER_ENV,
} from './enrichmentProviders.js';
import { resolveContactTiered } from './importerLeads.js';
import { __setLivePullsForTests, __resetGuardMetersForTests } from './externalPullGuard.js';

const realFetch = globalThis.fetch;

/** A `fetch` double that answers per-URL, and records every URL it was given.
 *  Anything it was not taught about throws, so an unexpected provider call is a
 *  test failure rather than a silent pass. */
function stubFetch(routes: Array<{ match: RegExp; status?: number; body: unknown }>): {
  calls: string[];
  spy: ReturnType<typeof vi.fn>;
} {
  const calls: string[] = [];
  const spy = vi.fn(async (url: unknown) => {
    const u = String(url);
    calls.push(u);
    const r = routes.find((x) => x.match.test(u));
    if (!r) throw new Error(`unstubbed provider call: ${u}`);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
      body: null,
      text: async () => JSON.stringify(r.body),
    } as unknown as Response;
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return { calls, spy };
}

const HUNTER_RX = /api\.hunter\.io/;
const PROSPEO_SEARCH_RX = /api\.prospeo\.io\/search-person/;
const PROSPEO_ENRICH_RX = /api\.prospeo\.io\/enrich-person/;
const PROSPEO_ACCOUNT_RX = /api\.prospeo\.io\/account-information/;

/** A Prospeo `search-person` page: emails present but MASKED, exactly as the
 *  live API returns them (verified 2026-08-28). */
const prospeoSearchBody = (people: Array<Record<string, unknown>>) => ({
  error: false,
  free: false,
  results: people.map((p) => ({ person: p, company: { name: 'Bosch', website: 'bosch.com' } })),
  pagination: { current_page: 1, per_page: 25, total_page: 1, total_count: people.length },
});

const MASKED = { status: 'VERIFIED', revealed: false, email: 'j*****@bosch.com' };

beforeEach(() => {
  __resetGuardMetersForTests();
  __setLivePullsForTests(true); // in-code only; can never reach a real provider
});
afterEach(() => {
  __setLivePullsForTests(null);
  __resetGuardMetersForTests();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.HUNTER_API_KEY;
  delete process.env.PROSPEO_API_KEY;
  delete process.env[PROVIDER_ORDER_ENV];
});

describe('providerOrder — the chain is CONFIG, not code', () => {
  it('defaults to the largest free quota first', () => {
    expect(providerOrder()).toEqual([...DEFAULT_PROVIDER_ORDER]);
    expect(DEFAULT_PROVIDER_ORDER[0]).toBe('prospeo');
  });

  it('is re-rankable from the environment with no deploy', () => {
    process.env[PROVIDER_ORDER_ENV] = 'hunter,prospeo';
    expect(providerOrder()).toEqual(['hunter', 'prospeo']);
  });

  it('accepts a SUBSET — parking one provider without removing its key', () => {
    process.env[PROVIDER_ORDER_ENV] = 'hunter';
    expect(providerOrder()).toEqual(['hunter']);
  });

  it('tolerates whitespace, case and duplicates', () => {
    process.env[PROVIDER_ORDER_ENV] = ' Hunter , hunter , PROSPEO ';
    expect(providerOrder()).toEqual(['hunter', 'prospeo']);
  });

  // A typo in an env var must degrade to a working chain, never take the paid
  // reveal down — this is the whole reason the parser drops instead of throwing.
  it('falls back to the default when the value names nothing valid', () => {
    process.env[PROVIDER_ORDER_ENV] = 'apollo,typo,';
    expect(providerOrder()).toEqual([...DEFAULT_PROVIDER_ORDER]);
  });

  it('never lets a plan-gated provider into the chain', () => {
    process.env[PROVIDER_ORDER_ENV] = 'apollo,prospeo';
    expect(providerOrder()).toEqual(['prospeo']);
    expect(Object.keys(ENRICHMENT_PROVIDERS)).not.toContain('apollo');
  });
});

describe('normalizeDomain — a free hint must not become a wasted credit', () => {
  it('reduces anything domain-shaped to the bare host', () => {
    expect(normalizeDomain('https://WWW.Bosch.com/en/us?a=1')).toBe('bosch.com');
    expect(normalizeDomain('bosch.com:8080')).toBe('bosch.com');
    expect(normalizeDomain('  us.bosch.com  ')).toBe('us.bosch.com');
  });
  it('rejects junk rather than passing it to a provider', () => {
    for (const junk of ['', '   ', 'not a domain', 'localhost', 'http://', '-bad-.com']) {
      expect(normalizeDomain(junk)).toBeNull();
    }
  });
});

describe('the precision guard is shared by the whole chain', () => {
  it('accepts a host that shares a distinctive token', () => {
    expect(domainMatchesCompany('Robert Bosch Tool Corp', 'bosch.com')).toBe(true);
    expect(domainMatchesCompany('Global Stone Impex', 'globalstoneimpex.com')).toBe(true);
  });
  it('rejects fuzzy drift, which is the failure that burns sender reputation', () => {
    expect(domainMatchesCompany('Robert Bosch Tool Corp', 'motopaja.fi')).toBe(false);
  });
});

describe('rule 2 — a domain-only provider is never called speculatively', () => {
  it('skips Prospeo entirely when no domain is known (ZERO calls, zero credits)', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    const { calls } = stubFetch([]);
    const out = await resolveViaChain('Robert Bosch Tool Corp');
    expect(calls).toEqual([]); // never asked a question it could not answer
    expect(out.called).toEqual([]);
    expect(out.hit).toBeNull();
  });

  it('calls Prospeo once ImportYeti has given us the website for free', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    const { calls } = stubFetch([
      {
        match: PROSPEO_SEARCH_RX,
        body: prospeoSearchBody([
          { person_id: 'p1', first_name: 'J', last_name: 'Smith', current_job_title: 'Head of Logistics', email: MASKED },
        ]),
      },
      {
        match: PROSPEO_ENRICH_RX,
        body: {
          error: false,
          person: {
            first_name: 'J',
            last_name: 'Smith',
            current_job_title: 'Head of Logistics',
            email: { status: 'VERIFIED', revealed: true, email: 'j.smith@bosch.com' },
          },
        },
      },
    ]);
    const out = await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'https://www.bosch.com/us' });
    expect(out.called).toEqual(['prospeo']);
    expect(out.hit?.domain).toBe('bosch.com');
    expect(out.hit?.people[0].email).toBe('j.smith@bosch.com');
    // STRICTLY TWO CALLS: one search page, one reveal. Never a per-person loop.
    expect(calls.length).toBe(2);
    expect(calls[0]).toMatch(PROSPEO_SEARCH_RX);
    expect(calls[1]).toMatch(PROSPEO_ENRICH_RX);
  });

  it('ignores a domain hint that is not plausibly this company', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    const { calls } = stubFetch([]);
    const out = await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'motopaja.fi' });
    expect(calls).toEqual([]); // a poisoned hint must not reach a provider
    expect(out.hit).toBeNull();
  });
});

describe('rule 4 — the cheapest quota that can answer, answers', () => {
  it('stops at Prospeo and never touches Hunter when Prospeo has an email', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    process.env.HUNTER_API_KEY = 'k';
    const { calls } = stubFetch([
      {
        match: PROSPEO_SEARCH_RX,
        body: prospeoSearchBody([{ person_id: 'p1', first_name: 'J', last_name: 'Smith', current_job_title: 'VP Supply Chain', email: MASKED }]),
      },
      {
        match: PROSPEO_ENRICH_RX,
        body: { error: false, person: { first_name: 'J', last_name: 'Smith', current_job_title: 'VP Supply Chain', email: { status: 'VERIFIED', revealed: true, email: 'j@bosch.com' } } },
      },
    ]);
    const out = await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'bosch.com' });
    expect(out.called).toEqual(['prospeo']);
    // THE POINT OF THE WHOLE CHANGE: Hunter's scarce quota is left alone.
    expect(calls.some((u) => HUNTER_RX.test(u))).toBe(false);
  });
});

describe('rule 5 — a domain-only hit is kept AND published forward', () => {
  it('hands Prospeo a domain that Hunter resolved from the name alone', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    process.env.HUNTER_API_KEY = 'k';
    process.env[PROVIDER_ORDER_ENV] = 'hunter,prospeo';
    const { calls } = stubFetch([
      // Hunter knows the domain but has nobody indexed there.
      { match: HUNTER_RX, body: { data: { domain: 'bosch.com', emails: [] } } },
      {
        match: PROSPEO_SEARCH_RX,
        body: prospeoSearchBody([{ person_id: 'p1', first_name: 'J', last_name: 'Smith', current_job_title: 'Director of Operations', email: MASKED }]),
      },
      {
        match: PROSPEO_ENRICH_RX,
        body: { error: false, person: { first_name: 'J', last_name: 'Smith', current_job_title: 'Director of Operations', email: { status: 'VERIFIED', revealed: true, email: 'j@bosch.com' } } },
      },
    ]);
    const out = await resolveViaChain('Robert Bosch Tool Corp');
    expect(out.called).toEqual(['hunter', 'prospeo']);
    expect(out.hit?.provider).toBe('prospeo');
    expect(out.hit?.people[0].email).toBe('j@bosch.com');
    // Prospeo was handed Hunter's domain rather than being skipped.
    const search = calls.find((u) => PROSPEO_SEARCH_RX.test(u));
    expect(search).toBeTruthy();
  });

  it('keeps a domain-only hit as the result when nothing better turns up', async () => {
    process.env.HUNTER_API_KEY = 'k';
    stubFetch([{ match: HUNTER_RX, body: { data: { domain: 'bosch.com', emails: [] } } }]);
    const out = await resolveViaChain('Robert Bosch Tool Corp');
    expect(out.hit?.domain).toBe('bosch.com');
    expect(out.hit?.people).toEqual([]); // → the role_based tier upstream
  });
});

describe('rule 3 — a per-provider kill switch routes AROUND, it does not take the reveal down', () => {
  it('still tries Hunter when the cost guard refuses Prospeo', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    process.env.HUNTER_API_KEY = 'k';
    process.env.PROSPEO_LIVE = '0'; // per-provider kill switch
    try {
      // Under a test runner the guard ignores env, so simulate the refusal at the
      // adapter seam: Prospeo returns the BLOCKED sentinel, Hunter answers.
      const blocked = vi
        .spyOn(prospeoProvider, 'resolve')
        .mockResolvedValue('blocked' as never);
      stubFetch([
        { match: HUNTER_RX, body: { data: { domain: 'bosch.com', emails: [{ value: 'j@bosch.com', first_name: 'J', last_name: 'S', position: 'Head of Logistics', confidence: 95 }] } } },
      ]);
      const out = await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'bosch.com' });
      expect(blocked).toHaveBeenCalledTimes(1);
      expect(out.blocked).toEqual(['prospeo']);
      expect(out.called).toEqual(['hunter']);
      expect(out.allBlocked).toBe(false); // we DID look — this is a real result
      expect(out.hit?.people[0].email).toBe('j@bosch.com');
    } finally {
      delete process.env.PROSPEO_LIVE;
    }
  });

  it('reports allBlocked ONLY when every eligible provider was refused', async () => {
    process.env.HUNTER_API_KEY = 'k';
    __setLivePullsForTests(null); // guard OFF → the real refusal path
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await resolveViaChain('Robert Bosch Tool Corp');
    expect(spy).not.toHaveBeenCalled(); // ZERO sockets
    expect(out.allBlocked).toBe(true);
    expect(out.blocked).toEqual(['hunter']);
  });

  // The distinction that decides whether a user is charged: "we did not look"
  // (guard) is not the same as "there was nothing to find" (no keys).
  it('an unconfigured chain is NOT allBlocked — nothing was refused', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'bosch.com' });
    expect(spy).not.toHaveBeenCalled();
    expect(out.allBlocked).toBe(false);
    expect(out.hit).toBeNull();
  });
});

describe('provider adapters normalise to ONE shape', () => {
  it('Prospeo never surfaces its masked search-page address as a real email', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    stubFetch([
      {
        match: PROSPEO_SEARCH_RX,
        body: prospeoSearchBody([{ person_id: 'p1', first_name: 'J', last_name: 'S', current_job_title: 'Logistics Manager', email: MASKED }]),
      },
      // The reveal fails, so all we have left is the masked page.
      { match: PROSPEO_ENRICH_RX, body: { error: true, error_code: 'NO_MATCH' } },
    ]);
    const out = await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'bosch.com' });
    // A masked address is NOT a contact. It must never be sold as one.
    expect(out.hit?.people.every((p) => p.email === null)).toBe(true);
    expect(out.hit?.domain).toBe('bosch.com'); // still a legitimate role_based hit
  });

  it('Prospeo signals failure in the BODY, so a 200 alone is not success', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    stubFetch([{ match: PROSPEO_SEARCH_RX, status: 200, body: { error: true, error_code: 'INSUFFICIENT_CREDITS' } }]);
    const out = await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'bosch.com' });
    expect(out.hit).toBeNull();
  });

  it('Prospeo reveals exactly ONE address — the best-ranked candidate', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    const { calls } = stubFetch([
      {
        match: PROSPEO_SEARCH_RX,
        body: prospeoSearchBody([
          { person_id: 'intern', first_name: 'A', last_name: 'B', current_job_title: 'Warehouse Intern', email: { status: 'UNVERIFIED', revealed: false } },
          { person_id: 'dm', first_name: 'J', last_name: 'Smith', current_job_title: 'Director of Logistics', email: MASKED },
        ]),
      },
      {
        match: PROSPEO_ENRICH_RX,
        body: { error: false, person: { first_name: 'J', last_name: 'Smith', current_job_title: 'Director of Logistics', email: { status: 'VERIFIED', revealed: true, email: 'j.smith@bosch.com' } } },
      },
    ]);
    await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'bosch.com' });
    const enrich = calls.filter((u) => PROSPEO_ENRICH_RX.test(u));
    expect(enrich.length).toBe(1); // one credit, not one per person
    const body = JSON.parse(String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].body));
    expect(body.data.person_id).toBe('dm'); // the verified decision-maker, not the intern
  });

  it('Hunter uses a known domain instead of re-resolving the name', async () => {
    process.env.HUNTER_API_KEY = 'k';
    const { calls } = stubFetch([{ match: HUNTER_RX, body: { data: { domain: 'bosch.com', emails: [] } } }]);
    await hunterProvider.resolve('Robert Bosch Tool Corp', 'bosch.com', 'unit');
    expect(calls[0]).toContain('domain=bosch.com');
    expect(calls[0]).not.toContain('company=');
    expect(calls[0]).toContain('limit=10'); // Hunter's hard cap
  });

  it('Hunter still rejects fuzzy drift through the chain', async () => {
    process.env.HUNTER_API_KEY = 'k';
    stubFetch([{ match: HUNTER_RX, body: { data: { domain: 'motopaja.fi', emails: [{ value: 'a@motopaja.fi', confidence: 90 }] } } }]);
    const out = await resolveViaChain('Robert Bosch Tool Corp');
    expect(out.hit).toBeNull();
  });
});

describe('the tier mapping above the chain is unchanged', () => {
  it('a chain email from Prospeo produces the SAME verified tier Hunter did', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    stubFetch([
      {
        match: PROSPEO_SEARCH_RX,
        body: prospeoSearchBody([{ person_id: 'p1', first_name: 'J', last_name: 'Smith', current_job_title: 'Head of Logistics', email: MASKED }]),
      },
      {
        match: PROSPEO_ENRICH_RX,
        body: { error: false, person: { first_name: 'J', last_name: 'Smith', current_job_title: 'Head of Logistics', email: { status: 'VERIFIED', revealed: true, email: 'j.smith@bosch.com' } } },
      },
    ]);
    const c = await resolveContactTiered('Robert Bosch Tool Corp', {
      phone: '555',
      address: 'A',
      website: 'www.bosch.com',
    });
    expect(c.contact_confidence).toBe('verified');
    expect(c.email).toBe('j.smith@bosch.com');
    expect(c.title).toBe('Head of Logistics');
  });

  it('a domain-only chain result is role_based, exactly as before', async () => {
    process.env.HUNTER_API_KEY = 'k';
    stubFetch([{ match: HUNTER_RX, body: { data: { domain: 'bosch.com', emails: [] } } }]);
    const c = await resolveContactTiered('Robert Bosch Tool Corp', { phone: '555', address: 'A' });
    expect(c.contact_confidence).toBe('role_based');
    expect(c.role_emails).toContain('purchasing@bosch.com');
  });

  // The pricing invariant from #444: a blocked lookup is "we did not look", and
  // the reveal above must not charge for it or cache it as a negative.
  it('an all-blocked chain degrades to a live_blocked phone_only', async () => {
    process.env.HUNTER_API_KEY = 'k';
    __setLivePullsForTests(null);
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const c = await resolveContactTiered('Robert Bosch Tool Corp', { phone: '555', address: 'A' });
    expect(spy).not.toHaveBeenCalled();
    expect(c.contact_confidence).toBe('phone_only');
    expect(c.live_blocked).toBe(true);
    expect(c.email).toBeNull();
  });

  it('never throws, even when every provider errors', async () => {
    process.env.HUNTER_API_KEY = 'k';
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const c = await resolveContactTiered('Robert Bosch Tool Corp', { phone: '555', address: 'A' });
    expect(c.contact_confidence).toBe('phone_only');
    expect(c.live_blocked).toBeUndefined(); // we DID look; there was just an error
  });
});

describe('quota introspection is free and still guarded', () => {
  it('reads each provider free quota without charging a credit', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    process.env[PROVIDER_ORDER_ENV] = 'prospeo';
    stubFetch([
      {
        match: PROSPEO_ACCOUNT_RX,
        body: {
          error: false,
          response: { current_plan: 'FREE', remaining_credits: 100, used_credits: 0, next_quota_renewal_days: 28 },
        },
      },
    ]);
    const [q] = await providerQuotas();
    expect(q.provider).toBe('prospeo');
    expect(q.configured).toBe(true);
    expect(q.plan).toBe('FREE');
    expect(q.remaining).toBe(100);
    expect(q.renewsInDays).toBe(28);
  });

  it('reports no-key rather than calling a provider it cannot authenticate', async () => {
    process.env[PROVIDER_ORDER_ENV] = 'prospeo';
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const [q] = await providerQuotas();
    expect(spy).not.toHaveBeenCalled();
    expect(q.unavailable).toBe('no-key');
  });

  it('reports blocked — never a fake zero — when the cost guard refuses', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    process.env[PROVIDER_ORDER_ENV] = 'prospeo';
    __setLivePullsForTests(null);
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const [q] = await providerQuotas();
    expect(spy).not.toHaveBeenCalled();
    expect(q.unavailable).toBe('blocked');
    expect(q.remaining).toBeNull();
  });
});

/* ── the belt-and-braces spec: this suite cannot cost money ─────────────────*/
describe('NO SPEC IN THIS FILE REACHES A REAL PROVIDER', () => {
  it('with the guard at its default, every chain entry point opens ZERO sockets', async () => {
    process.env.PROSPEO_API_KEY = 'k';
    process.env.HUNTER_API_KEY = 'k';
    __setLivePullsForTests(null); // the real deployment default
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await resolveViaChain('Robert Bosch Tool Corp', { domainHint: 'bosch.com' });
    await resolveContactTiered('Robert Bosch Tool Corp', { website: 'bosch.com' });
    await providerQuotas();
    expect(spy).not.toHaveBeenCalled();
  });
});
