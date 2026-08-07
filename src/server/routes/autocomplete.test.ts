/**
 * Autocomplete endpoints — local-data lanes (ports / cfs / terminals) serve the
 * directory-fill data. The DB client is mocked (these lanes never touch it when
 * no ?slug= is passed), so this exercises the REAL route handlers over the REAL
 * directory data.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({ db: () => { throw new Error('db() must not be called on local-data lanes'); } }));
vi.mock('../access.js', () => ({ enforceTenantAccess: vi.fn(async () => true) }));

import { registerAutocompleteRoutes } from './autocomplete.js';

type Handler = (req: unknown, res: unknown) => unknown;
function buildApp() {
  const routes = new Map<string, Handler>();
  const app = { get: (path: string, ...args: unknown[]) => { routes.set(path, args[args.length - 1] as Handler); } };
  registerAutocompleteRoutes(app as never);
  return routes;
}
const routes = buildApp();

async function call(path: string, query: Record<string, string>) {
  const handler = routes.get(path);
  if (!handler) throw new Error(`no handler for ${path}`);
  let captured: unknown;
  const res = { json: (v: unknown) => { captured = v; return res; }, status: () => res };
  await handler({ query, headers: {} }, res);
  return captured as { suggestions: Array<Record<string, unknown>> };
}

describe('GET /api/public/autocomplete/ports', () => {
  it('resolves the reconciliation code USEWR for a Newark query', async () => {
    const r = await call('/api/public/autocomplete/ports', { q: 'newark' });
    const codes = r.suggestions.map((s) => s.code);
    expect(codes).toContain('USEWR');
  });
  it('surfaces a previously-empty port (Jacksonville)', async () => {
    const r = await call('/api/public/autocomplete/ports', { q: 'jacksonville' });
    expect(r.suggestions.some((s) => s.code === 'USJAX')).toBe(true);
  });
  it('matches by code (USLALB pool)', async () => {
    const r = await call('/api/public/autocomplete/ports', { q: 'uslalb' });
    expect(r.suggestions.some((s) => s.code === 'USLALB')).toBe(true);
  });
});

describe('GET /api/public/autocomplete/cfs', () => {
  it('finds STG Logistics bonded CFS facilities', async () => {
    const r = await call('/api/public/autocomplete/cfs', { q: 'stg logistics' });
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.every((s) => String(s.code).startsWith('CFS_'))).toBe(true);
  });
  it('finds a neutral LCL consolidator network (Vanguard)', async () => {
    const r = await call('/api/public/autocomplete/cfs', { q: 'vanguard' });
    expect(r.suggestions.some((s) => s.code === 'LCL_VANGUARD')).toBe(true);
  });
  it('filters by gateway port', async () => {
    const r = await call('/api/public/autocomplete/cfs', { q: '', gateway: 'USLAX' });
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.every((s) => s.gatewayPort === 'USLAX')).toBe(true);
  });
});

describe('GET /api/public/autocomplete/terminals (platform-wide, no slug)', () => {
  it('finds a newly-added marine terminal by name (Blount Island)', async () => {
    const r = await call('/api/public/autocomplete/terminals', { q: 'blount' });
    expect(r.suggestions.some((s) => s.portCode === 'USJAX')).toBe(true);
  });
  it('filters terminals by port (Miami)', async () => {
    const r = await call('/api/public/autocomplete/terminals', { q: '', port: 'USMIA' });
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.every((s) => s.portCode === 'USMIA')).toBe(true);
  });
});
