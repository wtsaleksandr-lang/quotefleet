/**
 * InboundProspectStore contract tests (DB-free).
 *
 * The concrete `dbInboundProspectStore` needs Postgres, so instead we lock the
 * INTERFACE + the harvest/dedupe/status-transition semantics with a lightweight
 * in-memory fake that implements `InboundProspectStore` (same pattern the other
 * outreach route tests use). If the interface or the intended behavior drifts,
 * this fails to compile or fails an assertion.
 */
import { describe, it, expect } from 'vitest';
import type { ProspectInbound } from '../../../db/schema.js';
import type {
  InboundProspectStore,
  UpsertInboundProspectInput,
  ListInboundProspectsOpts,
  InboundProspectStatusPatch,
} from './inboundProspectStore.js';

/** Minimal in-memory implementation mirroring dbInboundProspectStore semantics. */
function makeFakeStore(): InboundProspectStore & { rows: ProspectInbound[] } {
  const rows: ProspectInbound[] = [];
  let nextId = 1;

  function row(input: UpsertInboundProspectInput): ProspectInbound {
    const now = new Date();
    return {
      id: nextId++,
      harvestMailbox: input.harvestMailbox,
      fromEmail: input.fromEmail,
      fromDomain: input.fromDomain,
      originalMessageId: input.originalMessageId ?? null,
      originalReferences: input.originalReferences ?? null,
      originalSubject: input.originalSubject ?? null,
      receivedAt: input.receivedAt ?? null,
      signatureJson: input.signatureJson ?? null,
      classifyCategory: input.classifyCategory ?? null,
      status: input.status ?? 'harvested',
      demoToken: input.demoToken ?? null,
      outreachEmailId: input.outreachEmailId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    rows,
    async upsert(input: UpsertInboundProspectInput) {
      const messageId = input.originalMessageId ?? null;
      if (messageId) {
        const existing = rows.find((r) => r.originalMessageId === messageId);
        if (existing) {
          existing.harvestMailbox = input.harvestMailbox;
          existing.fromEmail = input.fromEmail;
          existing.fromDomain = input.fromDomain;
          existing.originalReferences = input.originalReferences ?? null;
          existing.originalSubject = input.originalSubject ?? null;
          existing.receivedAt = input.receivedAt ?? null;
          existing.signatureJson = input.signatureJson ?? null;
          if (input.classifyCategory !== undefined) existing.classifyCategory = input.classifyCategory ?? null;
          if (input.status !== undefined) existing.status = input.status;
          if (input.demoToken !== undefined) existing.demoToken = input.demoToken ?? null;
          if (input.outreachEmailId !== undefined) existing.outreachEmailId = input.outreachEmailId ?? null;
          existing.updatedAt = new Date();
          return existing;
        }
      }
      const created = row(input);
      rows.push(created);
      return created;
    },
    async getByMessageId(messageId: string) {
      if (!messageId) return null;
      return rows.find((r) => r.originalMessageId === messageId) ?? null;
    },
    async getById(id: number) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async list(opts?: ListInboundProspectsOpts) {
      let out = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (opts?.status) out = out.filter((r) => r.status === opts.status);
      if (opts?.limit != null) out = out.slice(0, opts.limit);
      return out;
    },
    async updateStatus(id: number, status: string, patch?: InboundProspectStatusPatch) {
      const r = rows.find((x) => x.id === id);
      if (!r) return;
      r.status = status;
      if (patch?.classifyCategory !== undefined) r.classifyCategory = patch.classifyCategory ?? null;
      if (patch?.demoToken !== undefined) r.demoToken = patch.demoToken ?? null;
      if (patch?.outreachEmailId !== undefined) r.outreachEmailId = patch.outreachEmailId ?? null;
      r.updatedAt = new Date();
    },
  };
}

const base: UpsertInboundProspectInput = {
  harvestMailbox: 'inbox@harborlink.example',
  fromEmail: 'sales@brokerco.com',
  fromDomain: 'brokerco.com',
  originalMessageId: '<msg-1@brokerco.com>',
  originalSubject: 'Reefer capacity out of Long Beach',
};

describe('InboundProspectStore.upsert', () => {
  it('inserts a new harvested prospect with default status', async () => {
    const store = makeFakeStore();
    const rec = await store.upsert(base);
    expect(rec.id).toBe(1);
    expect(rec.status).toBe('harvested');
    expect(rec.fromDomain).toBe('brokerco.com');
    expect(store.rows).toHaveLength(1);
  });

  it('dedupes by Message-ID: a re-harvest updates in place (no duplicate row)', async () => {
    const store = makeFakeStore();
    const first = await store.upsert(base);
    const again = await store.upsert({
      ...base,
      originalSubject: 'Reefer capacity — UPDATED',
      signatureJson: { name: 'Pat Broker' },
    });
    expect(again.id).toBe(first.id); // same row
    expect(store.rows).toHaveLength(1);
    expect(again.originalSubject).toBe('Reefer capacity — UPDATED');
    expect(again.signatureJson).toEqual({ name: 'Pat Broker' });
  });

  it('inserts distinct rows when Message-ID is absent (no false dedupe)', async () => {
    const store = makeFakeStore();
    await store.upsert({ ...base, originalMessageId: null });
    await store.upsert({ ...base, originalMessageId: null });
    expect(store.rows).toHaveLength(2);
  });

  it('getByMessageId / getById resolve the persisted row', async () => {
    const store = makeFakeStore();
    const rec = await store.upsert(base);
    expect(await store.getByMessageId('<msg-1@brokerco.com>')).toMatchObject({ id: rec.id });
    expect(await store.getById(rec.id)).toMatchObject({ id: rec.id });
    expect(await store.getByMessageId('<nope@x.com>')).toBeNull();
    expect(await store.getById(999)).toBeNull();
  });
});

describe('InboundProspectStore.list', () => {
  it('returns recent-first and honors status filter + limit', async () => {
    const store = makeFakeStore();
    const a = await store.upsert({ ...base, originalMessageId: '<a@x.com>' });
    const b = await store.upsert({ ...base, originalMessageId: '<b@x.com>' });
    // force distinct createdAt ordering (b newer than a)
    (a as ProspectInbound).createdAt = new Date(1000);
    (b as ProspectInbound).createdAt = new Date(2000);

    const all = await store.list();
    expect(all.map((r) => r.id)).toEqual([b.id, a.id]); // recent first

    await store.updateStatus(a.id, 'classified');
    const classified = await store.list({ status: 'classified' });
    expect(classified.map((r) => r.id)).toEqual([a.id]);

    expect(await store.list({ limit: 1 })).toHaveLength(1);
  });
});

describe('InboundProspectStore.updateStatus', () => {
  it('advances status and patches related fields', async () => {
    const store = makeFakeStore();
    const rec = await store.upsert(base);
    expect(rec.status).toBe('harvested');

    await store.updateStatus(rec.id, 'classified', { classifyCategory: 'broker_marketing' });
    let after = await store.getById(rec.id);
    expect(after?.status).toBe('classified');
    expect(after?.classifyCategory).toBe('broker_marketing');

    await store.updateStatus(rec.id, 'demoed', { demoToken: 'demo_xyz' });
    after = await store.getById(rec.id);
    expect(after?.status).toBe('demoed');
    expect(after?.demoToken).toBe('demo_xyz');

    await store.updateStatus(rec.id, 'replied', { outreachEmailId: 42 });
    after = await store.getById(rec.id);
    expect(after?.status).toBe('replied');
    expect(after?.outreachEmailId).toBe(42);
    // patch is additive — earlier fields survive later transitions
    expect(after?.classifyCategory).toBe('broker_marketing');
    expect(after?.demoToken).toBe('demo_xyz');
  });

  it('is a no-op for an unknown id', async () => {
    const store = makeFakeStore();
    await store.updateStatus(123, 'classified');
    expect(store.rows).toHaveLength(0);
  });
});
