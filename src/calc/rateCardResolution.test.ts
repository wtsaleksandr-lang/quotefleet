/**
 * Regression tests for audit RATE-C2: two enabled rate cards for the same
 * (service, equipment) used to resolve NONDETERMINISTICALLY, so a customer
 * could get a random price depending on arbitrary DB row order.
 *
 * These cover both halves of the fix:
 *   1. Deterministic resolution — the SAME card always wins regardless of the
 *      order the cards arrive in (most-recently-updated enabled card wins; id
 *      is the deterministic tiebreak). Verified through the real `calculate`
 *      path so it exercises `findRateCard`.
 *   2. Write-time duplicate guard — `findConflictingEnabledCard` rejects a
 *      second enabled card for an existing (service, equipment), while
 *      allowing edits to the same card and allowing disabled duplicates.
 */
import { describe, it, expect } from 'vitest';
import {
  calculate,
  compareRateCardPriority,
  findConflictingEnabledCard,
  type CalcRequest,
} from './engine.js';
import type { RateCard } from '../db/schema.js';

const now = new Date('2026-01-01T00:00:00Z');

function rateCard(o: Partial<RateCard>): RateCard {
  return {
    id: 1, tenantId: 1, service: 'ftl', equipment: 'dryvan',
    label: null, ratePerMile: 2.0, minimumCharge: 50, flatFee: 0,
    fuelSurchargePct: 0, marginPct: 0, maxWeightLbs: null, maxMiles: null,
    ltlConfig: null,
    enabled: true, sortOrder: 0, notes: null,
    lastAiEditAt: null, lastAiEditReason: null,
    createdAt: now, updatedAt: now,
    ...o,
  };
}

const req: CalcRequest = { service: 'ftl', equipment: 'dryvan', miles: 500 };

describe('RATE-C2 · deterministic resolution of duplicate enabled cards', () => {
  // Two enabled ftl/dryvan cards priced differently. The most-recently-updated
  // one (B) must always win, so the customer never gets a random price.
  const cardA = rateCard({
    id: 1, ratePerMile: 2.0, updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  const cardB = rateCard({
    id: 2, ratePerMile: 5.0, updatedAt: new Date('2026-02-01T00:00:00Z'),
  });

  it('resolves to the SAME winner regardless of input array order', () => {
    const forward = calculate([cardA, cardB], [], [], req);
    const reversed = calculate([cardB, cardA], [], [], req);
    // Identical result both ways → resolution is deterministic.
    expect(forward).toEqual(reversed);
    // …and the winner is B (most-recently-updated), not A.
    const onlyB = calculate([cardB], [], [], req);
    expect(forward).toEqual(onlyB);
    expect(forward.subtotalLinehaul).toBe(2500); // 5.0/mi × 500 mi, not A's 1000
  });

  it('id is the deterministic tiebreak when updatedAt is equal', () => {
    const sameTime = new Date('2026-03-01T00:00:00Z');
    const lowId = rateCard({ id: 10, ratePerMile: 2.0, updatedAt: sameTime });
    const highId = rateCard({ id: 11, ratePerMile: 5.0, updatedAt: sameTime });
    const r1 = calculate([lowId, highId], [], [], req);
    const r2 = calculate([highId, lowId], [], [], req);
    expect(r1).toEqual(r2);
    expect(r1.subtotalLinehaul).toBe(2500); // higher id (11) wins
  });

  it('compareRateCardPriority orders updatedAt DESC then id DESC', () => {
    const older = rateCard({ id: 1, updatedAt: new Date('2026-01-01T00:00:00Z') });
    const newer = rateCard({ id: 2, updatedAt: new Date('2026-02-01T00:00:00Z') });
    expect([older, newer].slice().sort(compareRateCardPriority)[0].id).toBe(2);
    const a = rateCard({ id: 5, updatedAt: now });
    const b = rateCard({ id: 9, updatedAt: now });
    expect([a, b].slice().sort(compareRateCardPriority)[0].id).toBe(9);
  });
});

describe('RATE-C2 · write-time duplicate guard (findConflictingEnabledCard)', () => {
  const existing = [
    rateCard({ id: 1, service: 'ftl', equipment: 'dryvan', enabled: true }),
    rateCard({ id: 2, service: 'ftl', equipment: 'reefer', enabled: true }),
  ];

  it('REJECTS creating a second enabled card for an existing (service, equipment)', () => {
    const conflict = findConflictingEnabledCard(existing, {
      service: 'ftl', equipment: 'dryvan', enabled: true,
    });
    expect(conflict).toBeDefined();
    expect(conflict!.id).toBe(1);
  });

  it('REJECTS enabling a different card that collides with an enabled peer', () => {
    // Card #3 is being edited to enabled=true for ftl/dryvan → collides with #1.
    const conflict = findConflictingEnabledCard(existing, {
      id: 3, service: 'ftl', equipment: 'dryvan', enabled: true,
    });
    expect(conflict).toBeDefined();
    expect(conflict!.id).toBe(1);
  });

  it('ALLOWS editing the SAME card (matched by id)', () => {
    const conflict = findConflictingEnabledCard(existing, {
      id: 1, service: 'ftl', equipment: 'dryvan', enabled: true,
    });
    expect(conflict).toBeUndefined();
  });

  it('ALLOWS a disabled duplicate (disabled cards may duplicate freely)', () => {
    const conflict = findConflictingEnabledCard(existing, {
      service: 'ftl', equipment: 'dryvan', enabled: false,
    });
    expect(conflict).toBeUndefined();
  });

  it('ALLOWS a new enabled card for a distinct (service, equipment)', () => {
    const conflict = findConflictingEnabledCard(existing, {
      service: 'ftl', equipment: 'flatbed', enabled: true,
    });
    expect(conflict).toBeUndefined();
  });
});
