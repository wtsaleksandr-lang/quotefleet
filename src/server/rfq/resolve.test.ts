/**
 * RFQ recipient-resolution tests — pure logic, no DB / no network (deps injected).
 * Proves: classification (opted-out > no-email > pending), the dots path
 * (order + dedupe + cap), the filter path (cap + totalMatched/cappedOut), and
 * that opted-out (override) + suppressed (outreach list) carriers are skipped.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyCandidate,
  resolveRfqRecipients,
  normalizeDot,
  parseDots,
  type CarrierLite,
  type ResolveDeps,
} from './resolve.js';
import type { DirectoryFilters } from '../directory/queries.js';

const carrier = (over: Partial<CarrierLite> = {}): CarrierLite => ({
  usdot: '100',
  name: 'Acme Freight',
  email: 'ops@acme.example',
  contactHidden: false,
  ...over,
});

function deps(over: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    listByFilters: async () => ({ carriers: [], total: 0 }),
    listByDots: async () => [],
    optedOutDots: async () => new Set<string>(),
    isEmailSuppressed: async () => false,
    ...over,
  };
}

const filters = {} as DirectoryFilters;

describe('normalizeDot / parseDots', () => {
  it('strips non-digits and leading zeros', () => {
    expect(normalizeDot('USDOT 0012345')).toBe('12345');
    expect(normalizeDot('000')).toBe('0');
    expect(normalizeDot('abc')).toBe('');
  });
  it('parses + dedupes a comma/space list', () => {
    expect(parseDots('12, 34 34,,00056')).toEqual(['12', '34', '56']);
  });
});

describe('classifyCandidate', () => {
  it('opted_out when contactHidden (even with an email)', () => {
    expect(classifyCandidate(carrier({ contactHidden: true }), { optedOut: false, suppressed: false })).toBe('opted_out');
  });
  it('opted_out when override-opted-out or suppressed', () => {
    expect(classifyCandidate(carrier(), { optedOut: true, suppressed: false })).toBe('opted_out');
    expect(classifyCandidate(carrier(), { optedOut: false, suppressed: true })).toBe('opted_out');
  });
  it('no_email when no address and not opted out', () => {
    expect(classifyCandidate(carrier({ email: null }), { optedOut: false, suppressed: false })).toBe('no_email');
  });
  it('pending when it has an email and no opt-out', () => {
    expect(classifyCandidate(carrier(), { optedOut: false, suppressed: false })).toBe('pending');
  });
});

describe('resolveRfqRecipients — dots path', () => {
  it('preserves caller order, dedupes, drops unknown dots', async () => {
    const d = deps({
      listByDots: async () => [carrier({ usdot: '2', name: 'B' }), carrier({ usdot: '1', name: 'A' })],
    });
    const res = await resolveRfqRecipients({ dots: ['1', '2', '1', '999'] }, 25, d);
    expect(res.recipients.map((r) => r.usdot)).toEqual(['1', '2']);
    expect(res.totalMatched).toBe(2);
    expect(res.capped).toBe(false);
  });

  it('caps the recipient set and reports capped/cappedOut', async () => {
    const many = Array.from({ length: 5 }, (_, i) => carrier({ usdot: String(i + 1), name: `C${i}` }));
    const d = deps({ listByDots: async () => many });
    const res = await resolveRfqRecipients({ dots: many.map((c) => c.usdot) }, 3, d);
    expect(res.recipients).toHaveLength(3);
    expect(res.totalMatched).toBe(5);
    expect(res.capped).toBe(true);
    expect(res.cappedOut).toBe(2);
    expect(res.cap).toBe(3);
  });
});

describe('resolveRfqRecipients — filter path', () => {
  it('uses the filter total for totalMatched and caps the set', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => carrier({ usdot: String(i + 1) }));
    const d = deps({ listByFilters: async () => ({ carriers: rows, total: 120 }) });
    const res = await resolveRfqRecipients({ filters }, 3, d);
    expect(res.recipients).toHaveLength(3);
    expect(res.totalMatched).toBe(120);
    expect(res.capped).toBe(true);
    expect(res.cappedOut).toBe(117);
  });
});

describe('resolveRfqRecipients — skips no-email + opted-out carriers', () => {
  it('classifies each recipient by email/opt-out/suppression', async () => {
    const rows = [
      carrier({ usdot: '1', email: 'a@x.example' }), // pending
      carrier({ usdot: '2', email: null }), // no_email
      carrier({ usdot: '3', email: 'c@x.example', contactHidden: true }), // opted_out (hidden)
      carrier({ usdot: '4', email: 'd@x.example' }), // opted_out (override)
      carrier({ usdot: '5', email: 'e@x.example' }), // opted_out (suppressed)
    ];
    const d = deps({
      listByDots: async () => rows,
      optedOutDots: async () => new Set(['4']),
      isEmailSuppressed: async (email) => email === 'e@x.example',
    });
    const res = await resolveRfqRecipients({ dots: ['1', '2', '3', '4', '5'] }, 25, d);
    const byDot = Object.fromEntries(res.recipients.map((r) => [r.usdot, r.status]));
    expect(byDot).toEqual({ '1': 'pending', '2': 'no_email', '3': 'opted_out', '4': 'opted_out', '5': 'opted_out' });
  });
});
