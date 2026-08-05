/**
 * Broker-lead store tests — dedupe/upsert-by-mcNumber, updateStatus (+patch),
 * getByStatus, countByStatus. Uses a DB-free in-memory fake that implements the
 * LeadStore interface, so nothing touches Postgres.
 */
import { describe, it, expect } from 'vitest';
import type { BrokerLead } from '../../db/schema.js';
import type { LeadStore, UpsertLeadInput, LeadStatusPatch } from './leadStore.js';

/** In-memory LeadStore fake mirroring the dbLeadStore contract. */
function makeFakeStore(): LeadStore {
  const rows: BrokerLead[] = [];
  let nextId = 1;
  const now = () => new Date();

  function base(input: UpsertLeadInput): BrokerLead {
    return {
      id: nextId++,
      mcNumber: input.mcNumber,
      dotNumber: input.dotNumber ?? null,
      legalName: input.legalName,
      dbaName: input.dbaName ?? null,
      phone: input.phone ?? null,
      addrStreet: input.addrStreet ?? null,
      addrCity: input.addrCity ?? null,
      addrState: input.addrState ?? null,
      addrZip: input.addrZip ?? null,
      censusEmail: input.censusEmail ?? null,
      resolvedDomain: null,
      resolvedEmail: null,
      emailSource: null,
      emailVerified: false,
      powerUnits: input.powerUnits ?? null,
      segment: input.segment ?? 'broker',
      demoToken: null,
      outreachEmailId: null,
      status: 'new',
      createdAt: now(),
      updatedAt: now(),
    };
  }

  return {
    async upsert(input) {
      if (input.mcNumber) {
        const existing = rows.find((r) => r.mcNumber === input.mcNumber);
        if (existing) {
          existing.legalName = input.legalName;
          existing.dbaName = input.dbaName ?? null;
          existing.phone = input.phone ?? null;
          existing.censusEmail = input.censusEmail ?? null;
          existing.powerUnits = input.powerUnits ?? null;
          existing.updatedAt = now();
          return existing;
        }
      }
      const row = base(input);
      rows.push(row);
      return row;
    },
    async getById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async getByStatus(status, limit = 100) {
      return rows.filter((r) => r.status === status).reverse().slice(0, limit);
    },
    async list(limit = 100) {
      return [...rows].reverse().slice(0, limit);
    },
    async updateStatus(id, status, patch?: LeadStatusPatch) {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.status = status;
      if (patch) Object.assign(row, patch);
      row.updatedAt = now();
    },
    async countByStatus() {
      const out: Record<string, number> = {};
      for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
      return out;
    },
  };
}

const broker = (o: Partial<UpsertLeadInput> = {}): UpsertLeadInput => ({
  mcNumber: 'MC000001',
  dotNumber: '111',
  legalName: 'Acme Logistics LLC',
  ...o,
});

describe('leadStore upsert', () => {
  it('inserts a new broker and returns it with defaults', async () => {
    const store = makeFakeStore();
    const row = await store.upsert(broker({ censusEmail: 'ops@acme.com', powerUnits: 4 }));
    expect(row.id).toBe(1);
    expect(row.status).toBe('new');
    expect(row.segment).toBe('broker');
    expect(row.emailVerified).toBe(false);
    expect(row.censusEmail).toBe('ops@acme.com');
    expect(row.powerUnits).toBe(4);
  });

  it('dedupes by mcNumber — a re-ingest updates, does not duplicate', async () => {
    const store = makeFakeStore();
    await store.upsert(broker({ legalName: 'Old Name', censusEmail: null }));
    await store.upsert(broker({ legalName: 'New Name', censusEmail: 'new@acme.com' }));
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].legalName).toBe('New Name');
    expect(all[0].censusEmail).toBe('new@acme.com');
  });

  it('inserts distinct rows for distinct mcNumbers', async () => {
    const store = makeFakeStore();
    await store.upsert(broker({ mcNumber: 'MC000001' }));
    await store.upsert(broker({ mcNumber: 'MC000002' }));
    expect(await store.list()).toHaveLength(2);
  });

  it('rows with a null mcNumber are never deduped', async () => {
    const store = makeFakeStore();
    await store.upsert(broker({ mcNumber: null }));
    await store.upsert(broker({ mcNumber: null }));
    expect(await store.list()).toHaveLength(2);
  });
});

describe('leadStore status', () => {
  it('updateStatus changes status and applies a patch', async () => {
    const store = makeFakeStore();
    const row = await store.upsert(broker());
    await store.updateStatus(row.id, 'demoed', { demoToken: 'tok_123', resolvedEmail: 'ops@acme.com', emailSource: 'census' });
    const after = await store.getById(row.id);
    expect(after?.status).toBe('demoed');
    expect(after?.demoToken).toBe('tok_123');
    expect(after?.resolvedEmail).toBe('ops@acme.com');
    expect(after?.emailSource).toBe('census');
  });

  it('getByStatus returns only rows in that status', async () => {
    const store = makeFakeStore();
    const a = await store.upsert(broker({ mcNumber: 'MC000001' }));
    await store.upsert(broker({ mcNumber: 'MC000002' }));
    await store.updateStatus(a.id, 'contacted');
    const contacted = await store.getByStatus('contacted');
    const news = await store.getByStatus('new');
    expect(contacted.map((r) => r.mcNumber)).toEqual(['MC000001']);
    expect(news.map((r) => r.mcNumber)).toEqual(['MC000002']);
  });

  it('countByStatus tallies per status', async () => {
    const store = makeFakeStore();
    const a = await store.upsert(broker({ mcNumber: 'MC000001' }));
    await store.upsert(broker({ mcNumber: 'MC000002' }));
    await store.upsert(broker({ mcNumber: 'MC000003' }));
    await store.updateStatus(a.id, 'contacted');
    expect(await store.countByStatus()).toEqual({ new: 2, contacted: 1 });
  });
});
