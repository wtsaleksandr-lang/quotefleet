/**
 * Owner-app SPA route parsing (audit shell-H2 / leads-H1).
 *
 * The hard rule under test: parsing a pathname must preserve the FULL nested
 * route so boot / refresh / Back / Forward / bookmark of "/app/leads/QF-123"
 * derive "leads/QF-123" (→ detail view), NOT just "leads" (→ list view).
 * baseSegment() still yields the top-level handler key for dispatch + nav.
 */
import { describe, it, expect } from 'vitest';
import { fullRoute, baseSegment, subPath, DEFAULT_ROUTE } from './public/app-route.js';

describe('fullRoute', () => {
  it('preserves a nested route (deep link / refresh / back to detail)', () => {
    expect(fullRoute('/app/leads/QF-123')).toBe('leads/QF-123');
  });
  it('returns a plain base route unchanged', () => {
    expect(fullRoute('/app/leads')).toBe('leads');
  });
  it('trims a trailing slash so "leads/" == "leads"', () => {
    expect(fullRoute('/app/leads/')).toBe('leads');
  });
  it('deeply nested sub-paths survive intact', () => {
    expect(fullRoute('/app/rates/lane/ABC-999')).toBe('rates/lane/ABC-999');
  });
  it('falls back to overview for bare /app, empty, or null', () => {
    expect(fullRoute('/app')).toBe(DEFAULT_ROUTE);
    expect(fullRoute('/app/')).toBe(DEFAULT_ROUTE);
    expect(fullRoute('')).toBe(DEFAULT_ROUTE);
    expect(fullRoute(null)).toBe(DEFAULT_ROUTE);
  });
});

describe('baseSegment', () => {
  it('extracts the top-level segment from a nested route', () => {
    expect(baseSegment('leads/QF-123')).toBe('leads');
  });
  it('returns a base route unchanged', () => {
    expect(baseSegment('overview')).toBe('overview');
  });
  it('defaults empty/null to overview', () => {
    expect(baseSegment('')).toBe(DEFAULT_ROUTE);
    expect(baseSegment(null)).toBe(DEFAULT_ROUTE);
  });
});

describe('subPath', () => {
  it('returns the sub-path after the base', () => {
    expect(subPath('leads/QF-123', 'leads')).toBe('QF-123');
  });
  it('returns empty string when the route is just the base', () => {
    expect(subPath('leads', 'leads')).toBe('');
  });
  it('returns empty string for a different base', () => {
    expect(subPath('rates/lane', 'leads')).toBe('');
  });
});

describe('boot / popstate derivation (integration of the two helpers)', () => {
  // This mirrors exactly what boot() and the popstate handler now do: derive the
  // full route from location.pathname, then dispatch on its base segment.
  function deriveAndDispatch(pathname: string) {
    const route = fullRoute(pathname);
    return { route, base: baseSegment(route) };
  }

  it('deep link to a lead detail dispatches to leads WITH the ref preserved', () => {
    const { route, base } = deriveAndDispatch('/app/leads/QF-123');
    expect(base).toBe('leads'); // picks renderLeads handler + highlights nav
    expect(route).toBe('leads/QF-123'); // handler reads the ref → detail, not list
    expect(subPath(route, base)).toBe('QF-123');
  });

  it('list route dispatches to leads with no ref (list view)', () => {
    const { route, base } = deriveAndDispatch('/app/leads');
    expect(base).toBe('leads');
    expect(subPath(route, base)).toBe('');
  });
});
