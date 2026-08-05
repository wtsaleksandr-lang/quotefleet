/**
 * Domain-resolver unit tests (Phase 2 outreach).
 *
 * Fully offline — the Places lookup is injected, so nothing touches the wire.
 * Covered:
 *   - company census email → its domain, source 'email', NO Places call
 *   - freemail census email → falls through to the injected Places lookup
 *   - Places aggregator/directory result → rejected (domain null, source none)
 *   - mcNumber cache → a repeat lead never re-calls Places
 *   - no census email + no Places → { null, 'none' }
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveDomain,
  isFreemail,
  isAggregator,
  emailDomain,
  type ResolvableLead,
} from './domainResolver.js';

function lead(over: Partial<ResolvableLead> = {}): ResolvableLead {
  return {
    mcNumber: 'MC123456',
    legalName: 'ACME LOGISTICS LLC',
    dbaName: 'Acme Freight',
    addrCity: 'Long Beach',
    addrState: 'CA',
    censusEmail: null,
    ...over,
  };
}

describe('helpers', () => {
  it('emailDomain parses the host and lowercases it', () => {
    expect(emailDomain('Dispatch@Acme-Freight.com')).toBe('acme-freight.com');
    expect(emailDomain('not-an-email')).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });

  it('isFreemail matches consumer providers incl. subdomains', () => {
    expect(isFreemail('gmail.com')).toBe(true);
    expect(isFreemail('mail.yahoo.com')).toBe(true);
    expect(isFreemail('acme-freight.com')).toBe(false);
  });

  it('isAggregator matches directory/social hosts', () => {
    expect(isAggregator('facebook.com')).toBe(true);
    expect(isAggregator('m.facebook.com')).toBe(true); // apex compare catches subdomains
    expect(isAggregator('yelp.com')).toBe(true);
    expect(isAggregator('acme-freight.com')).toBe(false);
  });
});

describe('resolveDomain', () => {
  it('uses a COMPANY census email domain for free — no Places call', async () => {
    const places = vi.fn(async () => 'https://should-not-run.com');
    const result = await resolveDomain(
      lead({ censusEmail: 'dispatch@acme-freight.com' }),
      { placesLookup: places },
    );
    expect(result).toEqual({ domain: 'acme-freight.com', source: 'email' });
    expect(places).not.toHaveBeenCalled();
  });

  it('strips www + protocol from the census-email domain', async () => {
    const result = await resolveDomain(
      lead({ censusEmail: 'info@WWW.Acme-Freight.COM' }),
      { placesLookup: null },
    );
    // emailDomain already drops the protocol; normalizeDomain drops leading www.
    expect(result.source).toBe('email');
    expect(result.domain).toBe('acme-freight.com');
  });

  it('falls through to Places when the census email is FREEMAIL', async () => {
    const places = vi.fn(async () => 'https://acme-freight.com/contact');
    const result = await resolveDomain(
      lead({ censusEmail: 'acmefreight@gmail.com' }),
      { placesLookup: places },
    );
    expect(places).toHaveBeenCalledOnce();
    expect(places).toHaveBeenCalledWith('Acme Freight Long Beach CA');
    expect(result).toEqual({ domain: 'acme-freight.com', source: 'places' });
  });

  it('falls through to Places when there is NO census email', async () => {
    const places = vi.fn(async () => 'https://acme-freight.com');
    const result = await resolveDomain(lead({ censusEmail: null }), { placesLookup: places });
    expect(result).toEqual({ domain: 'acme-freight.com', source: 'places' });
  });

  it('REJECTS an aggregator/directory Places result', async () => {
    const places = vi.fn(async () => 'https://www.facebook.com/acmefreight');
    const result = await resolveDomain(
      lead({ censusEmail: 'acmefreight@yahoo.com' }),
      { placesLookup: places },
    );
    expect(result).toEqual({ domain: null, source: 'none' });
  });

  it('caches by mcNumber so a repeat lead never re-calls Places', async () => {
    const places = vi.fn(async () => 'https://acme-freight.com');
    const cache = new Map();
    const l = lead({ censusEmail: null });
    const first = await resolveDomain(l, { placesLookup: places, cache });
    const second = await resolveDomain(l, { placesLookup: places, cache });
    expect(first).toEqual({ domain: 'acme-freight.com', source: 'places' });
    expect(second).toEqual(first);
    expect(places).toHaveBeenCalledOnce(); // second served from cache
  });

  it('returns none when Places is disabled and no company email exists', async () => {
    const result = await resolveDomain(lead({ censusEmail: 'x@gmail.com' }), { placesLookup: null });
    expect(result).toEqual({ domain: null, source: 'none' });
  });

  it('falls back to legalName when dbaName is absent in the Places query', async () => {
    const places = vi.fn(async () => 'https://acme-logistics.com');
    await resolveDomain(
      lead({ dbaName: null, censusEmail: null }),
      { placesLookup: places },
    );
    expect(places).toHaveBeenCalledWith('ACME LOGISTICS LLC Long Beach CA');
  });
});
