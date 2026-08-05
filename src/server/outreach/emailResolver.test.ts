/**
 * Email-resolver unit tests (Phase 2 outreach).
 *
 * Fully offline — DNS (resolveMx) and the site scrape are injected.
 * Covered:
 *   - valid census email + MX present  → accept, source 'census', verified
 *   - census email whose domain has NO MX → rejected (never accept no-MX mail)
 *   - census missing / bad → scrape a published address (MX-checked)
 *   - scrape empty → role mailbox on the MX-verified domain
 *   - no domain + no census → { null, null, false }
 *   - a domain with no MX yields nothing (scrape/role both refused)
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveEmail, isValidEmailSyntax, type MxResolver } from './emailResolver.js';

const withMx: MxResolver = async () => [{ exchange: 'mx.example.com', priority: 10 }];
const noMx: MxResolver = async () => {
  throw new Error('ENODATA');
};
/** MX only for the listed domains. */
function mxFor(domains: string[]): MxResolver {
  return async (d) => (domains.includes(d) ? [{ exchange: `mx.${d}`, priority: 10 }] : Promise.reject(new Error('ENODATA')));
}

describe('isValidEmailSyntax', () => {
  it('accepts normal addresses, rejects junk', () => {
    expect(isValidEmailSyntax('dispatch@acme-freight.com')).toBe(true);
    expect(isValidEmailSyntax('nope')).toBe(false);
    expect(isValidEmailSyntax('a@b')).toBe(false);
    expect(isValidEmailSyntax(null)).toBe(false);
  });
});

describe('resolveEmail', () => {
  it('accepts a valid census email whose domain has MX', async () => {
    const scrape = vi.fn(async () => null);
    const result = await resolveEmail(
      { censusEmail: 'Dispatch@Acme-Freight.com' },
      'acme-freight.com',
      { resolveMx: withMx, scrape },
    );
    expect(result).toEqual({ email: 'dispatch@acme-freight.com', source: 'census', verified: true });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('REJECTS a census email whose domain has NO MX, then tries the domain', async () => {
    // census domain (deadmail.com) has no MX; site domain (acme-freight.com) does,
    // and the scrape yields a good address on it.
    const scrape = vi.fn(async () => 'sales@acme-freight.com');
    const result = await resolveEmail(
      { censusEmail: 'owner@deadmail.com' },
      'acme-freight.com',
      { resolveMx: mxFor(['acme-freight.com']), scrape },
    );
    expect(result).toEqual({ email: 'sales@acme-freight.com', source: 'scrape', verified: true });
  });

  it('falls back to a ROLE mailbox when scrape finds nothing (domain has MX)', async () => {
    const scrape = vi.fn(async () => null);
    const result = await resolveEmail(
      { censusEmail: null },
      'acme-freight.com',
      { resolveMx: withMx, scrape, roles: ['info', 'dispatch', 'sales'] },
    );
    expect(result).toEqual({ email: 'info@acme-freight.com', source: 'role', verified: true });
  });

  it('never accepts a role address on a domain with NO MX', async () => {
    const scrape = vi.fn(async () => null);
    const result = await resolveEmail(
      { censusEmail: null },
      'no-mail-here.com',
      { resolveMx: noMx, scrape },
    );
    expect(result).toEqual({ email: null, source: null, verified: false });
    expect(scrape).not.toHaveBeenCalled(); // MX gate short-circuits before scrape
  });

  it('returns nothing when there is no census email and no domain', async () => {
    const result = await resolveEmail({ censusEmail: null }, null, { resolveMx: withMx });
    expect(result).toEqual({ email: null, source: null, verified: false });
  });

  it('rejects a scraped address whose (different) domain has no MX, then role-fills', async () => {
    // scrape returns an address on a THIRD-party domain with no MX → reject it,
    // fall back to a role mailbox on the MX-verified site domain.
    const scrape = vi.fn(async () => 'someone@spammy-nomx.com');
    const result = await resolveEmail(
      { censusEmail: null },
      'acme-freight.com',
      { resolveMx: mxFor(['acme-freight.com']), scrape },
    );
    expect(result).toEqual({ email: 'info@acme-freight.com', source: 'role', verified: true });
  });
});
