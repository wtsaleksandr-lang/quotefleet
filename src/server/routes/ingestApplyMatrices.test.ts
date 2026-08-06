/**
 * Ingest APPLY → matrices persist (FIX 1 back half).
 *
 * The front-end review now includes `rateMatrices` in the apply POST body (the
 * gap was the payload, not the server). This asserts the server contract that
 * payload lands on: `applyDraftToTenant` writes the draft's matrix blocks into
 * rate_matrices (one row per cell) + rate_zones (one row per legend rule), and
 * the returned ApplyResult counts them. The transaction is mocked to record
 * every insert by table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = { inserts: [] as Array<{ table: string; values: Record<string, unknown> }> };
  return { state };
});

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  const tx = {
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown>) => {
        h.state.inserts.push({ table: getTableName(t as never), values: v });
        return Promise.resolve();
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  return {
    db: () => ({
      transaction: async (fn: (t: typeof tx) => Promise<void>) => { await fn(tx); },
    }),
  };
});

vi.mock('../../marketplace/sync.js', () => ({ syncTenantToMarketplace: vi.fn() }));

beforeEach(() => { h.state.inserts = []; });

describe('applyDraftToTenant — persists rate matrices from the apply payload', () => {
  it('writes one rate_matrices row per cell and one rate_zones row per legend rule', async () => {
    const { applyDraftToTenant } = await import('./ingest.js');
    const draft = {
      rateMatrices: [
        {
          mode: 'ftl', equipment: 'dryvan', unitBasis: 'flat', currency: 'USD', minCharge: null,
          cells: [
            { originKey: 'W', destKey: 'E', rate: 1900 },
            { originKey: 'E', destKey: 'W', rate: 1750 },
          ],
          zones: [
            { zoneId: 'W', matchKind: 'zip_range', matchFrom: '900', matchTo: '902', label: 'West' },
            { zoneId: 'E', matchKind: 'zip_range', matchFrom: '850', matchTo: '852', label: 'East' },
          ],
        },
      ],
    };
    const result = await applyDraftToTenant(1, 7, draft);

    const matrixInserts = h.state.inserts.filter((i) => i.table === 'rate_matrices');
    const zoneInserts = h.state.inserts.filter((i) => i.table === 'rate_zones');
    expect(matrixInserts).toHaveLength(2);
    expect(zoneInserts).toHaveLength(2);
    expect(result.rateMatrices).toBe(2);
    expect(result.rateZones).toBe(2);
    // The cell values carry through (tenant-scoped, keyed, priced).
    expect(matrixInserts.map((i) => i.values.rate).sort()).toEqual([1750, 1900]);
    expect(matrixInserts[0].values).toMatchObject({ tenantId: 1, mode: 'ftl', unitBasis: 'flat' });
  });

  it('a drayage per-container matrix persists the reefer cell with its equipment', async () => {
    const { applyDraftToTenant } = await import('./ingest.js');
    // Parser pattern 5 emits ONE block per container size (block-level equipment).
    const draft = {
      rateMatrices: [
        {
          mode: 'drayage', equipment: 'container_40', unitBasis: 'per_container', currency: 'USD', minCharge: null,
          cells: [{ originKey: 'USLAX', destKey: '90744', rate: 355 }], zones: null,
        },
        {
          mode: 'drayage', equipment: 'reefer', unitBasis: 'per_container', currency: 'USD', minCharge: null,
          cells: [{ originKey: 'USLAX', destKey: '90744', rate: 605 }], zones: null,
        },
      ],
    };
    const result = await applyDraftToTenant(1, 8, draft);
    const matrixInserts = h.state.inserts.filter((i) => i.table === 'rate_matrices');
    expect(matrixInserts).toHaveLength(2);
    expect(result.rateMatrices).toBe(2);
    // The reefer container cell persists with its equipment scope preserved.
    const reefer = matrixInserts.find((i) => i.values.equipment === 'reefer');
    expect(reefer).toBeTruthy();
    expect(reefer!.values.rate).toBe(605);
  });
});
