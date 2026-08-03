/**
 * Confirm-before-apply for AI rate changes (audit H1).
 *
 * Proves the two safety properties of the propose→apply split:
 *   1. A model MUTATION tool now PROPOSES — `proposeMutation` returns a
 *      structured diff and writes NOTHING to the DB.
 *   2. The Apply path (`applyRateMutation`) RE-VALIDATES the stored input
 *      against the RATE-C1 bounds before writing, so a tampered / out-of-range
 *      proposed value is rejected and nothing is persisted.
 *
 * The DB is mocked; we assert the exact update/insert side effects (or their
 * absence) rather than hitting Postgres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    row: null as Record<string, unknown> | null,
    updates: [] as Array<{ patch: Record<string, unknown> }>,
    inserts: [] as Array<{ values: unknown }>,
  };
  return { state };
});

vi.mock('../db/client.js', () => {
  function selectChain(rows: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {
      from() { return c; },
      where() { return c; },
      limit() { return Promise.resolve(rows); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(rows).then(res, rej);
      },
    };
    return c;
  }
  return {
    db: () => ({
      select: () => selectChain(h.state.row ? [h.state.row] : []),
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          h.state.updates.push({ patch });
          return { where: () => Promise.resolve() };
        },
      }),
      insert: () => ({
        values: (values: unknown) => {
          h.state.inserts.push({ values });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p: any = Promise.resolve();
          p.returning = () => Promise.resolve([{ id: 999 }]);
          return p;
        },
      }),
    }),
  };
});

import { buildRateChangeDiff, proposeMutation, applyRateMutation } from './rateAgent.js';

beforeEach(() => {
  h.state.row = null;
  h.state.updates = [];
  h.state.inserts = [];
});

describe('buildRateChangeDiff (pure)', () => {
  it('renders a rate-card per-mile change as a before→after diff', () => {
    const before = { id: 5, label: 'Dry Van FTL', service: 'ftl', equipment: 'dry_van', ratePerMile: 2.1 };
    const diff = buildRateChangeDiff('update_rate_card', { id: 5, ratePerMile: 2.35, reason: 'market shift' }, before);
    expect(diff.op).toBe('update');
    expect(diff.entity).toBe('rate_card');
    expect(diff.title).toBe('Dry Van FTL');
    expect(diff.changes).toEqual([
      { field: 'ratePerMile', label: 'Per-mile rate', from: '$2.10', to: '$2.35' },
    ]);
    expect(diff.summary).toBe('Dry Van FTL — Per-mile rate: $2.10 → $2.35');
  });

  it('skips a field the model re-sent unchanged', () => {
    const before = { id: 5, label: 'Dry Van FTL', ratePerMile: 2.1, minimumCharge: 250 };
    const diff = buildRateChangeDiff(
      'update_rate_card',
      { id: 5, ratePerMile: 2.1, minimumCharge: 300, reason: 'x' },
      before
    );
    expect(diff.changes.map((c) => c.field)).toEqual(['minimumCharge']);
    expect(diff.changes[0]).toMatchObject({ from: '$250.00', to: '$300.00' });
  });

  it('a create has null from-values', () => {
    const diff = buildRateChangeDiff(
      'create_accessorial',
      { code: 'chassis', label: 'Chassis', kind: 'flat', amount: 50, trigger: 'optional', reason: 'x' },
      null
    );
    expect(diff.op).toBe('create');
    expect(diff.title).toBe('Chassis');
    expect(diff.changes.find((c) => c.field === 'amount')).toMatchObject({ from: null, to: '$50.00' });
    expect(diff.summary).toContain('Create accessorial "Chassis"');
  });
});

describe('proposeMutation — proposes, writes nothing', () => {
  it('returns a structured proposal and persists NO DB change', async () => {
    h.state.row = { id: 5, tenantId: 1, label: 'Dry Van FTL', ratePerMile: 2.1 };
    const r = await proposeMutation(1, 'update_rate_card', { id: 5, ratePerMile: 2.35, reason: 'market shift' });
    expect(r.ok).toBe(true);
    expect(r.proposal).toBeTruthy();
    expect(r.proposal!.changes[0]).toMatchObject({ field: 'ratePerMile', from: '$2.10', to: '$2.35' });
    expect(r.message).toMatch(/pending your confirmation/i);
    // The whole point of H1: nothing was written.
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  it('rejects an out-of-range value at propose time (RATE-C1) and never writes', async () => {
    h.state.row = { id: 5, tenantId: 1, label: 'Dry Van FTL', ratePerMile: 2 };
    const r = await proposeMutation(1, 'update_rate_card', { id: 5, ratePerMile: 999_999, reason: 'oops' });
    expect(r.ok).toBe(false);
    expect(r.proposal).toBeUndefined();
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  it('rejects an unknown rate card (ownership) without writing', async () => {
    h.state.row = null; // no row for this tenant
    const r = await proposeMutation(1, 'update_rate_card', { id: 5, ratePerMile: 2.35, reason: 'x' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not found/i);
    expect(h.state.updates).toHaveLength(0);
  });
});

describe('applyRateMutation — re-validates server-side, then writes', () => {
  it('applies an in-range change: update + audit-log insert', async () => {
    h.state.row = { id: 5, tenantId: 1, label: 'Dry Van FTL', ratePerMile: 2.1 };
    const r = await applyRateMutation(1, 7, 'update_rate_card', { id: 5, ratePerMile: 2.35, reason: 'market shift' });
    expect(r.ok).toBe(true);
    expect(h.state.updates).toHaveLength(1);
    expect(h.state.updates[0].patch).toMatchObject({ ratePerMile: 2.35, lastAiEditReason: 'market shift' });
    // Exactly one audit-log insert with before/after captured.
    expect(h.state.inserts).toHaveLength(1);
    const audit = h.state.inserts[0].values as Record<string, unknown>;
    expect(audit).toMatchObject({ action: 'rate_card.update', actorKind: 'ai_agent' });
  });

  it('rejects a TAMPERED out-of-range proposed value and writes NOTHING', async () => {
    h.state.row = { id: 5, tenantId: 1, label: 'Dry Van FTL', ratePerMile: 2 };
    const r = await applyRateMutation(1, 7, 'update_rate_card', { id: 5, ratePerMile: 999_999, reason: 'tampered' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Invalid arguments/);
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  it('rejects a negative amount (RATE-C1 lower bound) before writing', async () => {
    h.state.row = { id: 5, tenantId: 1, label: 'Dry Van FTL', ratePerMile: 2 };
    const r = await applyRateMutation(1, 7, 'update_rate_card', { id: 5, minimumCharge: -50, reason: 'tampered' });
    expect(r.ok).toBe(false);
    expect(h.state.updates).toHaveLength(0);
  });
});
