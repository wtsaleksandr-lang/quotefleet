/**
 * Code minting uniqueness — mintUniqueCode retries past a collision — plus
 * code→owner resolution: resolveCodeOwner attributes ONLY to an ACTIVE affiliate
 * (a suspended/pending affiliate's link resolves to no-owner so it can't track
 * signups or estimate earnings), while tenant referral codes are unaffected.
 * DB mocked (FIFO of select() rows); code helpers run for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidCodeShape } from './programs.js';

// db().select().from().where().limit() → resolves to the next queued rows array.
const selectQueue: unknown[][] = [];
let selectCalls = 0;
function selectChain() {
  const rows = selectQueue.length ? selectQueue.shift()! : [];
  selectCalls++;
  const p: any = {
    from: () => p,
    where: () => p,
    limit: () => p,
    then: (res: (v: unknown) => void) => Promise.resolve(rows).then(res),
  };
  return p;
}
const dbStub: any = { select: () => selectChain() };
vi.mock('../../db/client.js', () => ({ db: () => dbStub }));

let mintUniqueCode: typeof import('./codes.js').mintUniqueCode;
let resolveCodeOwner: typeof import('./codes.js').resolveCodeOwner;

beforeEach(async () => {
  selectQueue.length = 0;
  selectCalls = 0;
  ({ mintUniqueCode, resolveCodeOwner } = await import('./codes.js'));
});

describe('mintUniqueCode', () => {
  it('returns a valid code on the first try when no collision', async () => {
    // Attempt 1: tenants=[], affiliates=[] → free.
    selectQueue.push([], []);
    const code = await mintUniqueCode();
    expect(isValidCodeShape(code)).toBe(true);
    expect(selectCalls).toBe(2); // one tenants + one affiliates check
  });

  it('retries past a collision, then returns a unique code', async () => {
    // Attempt 1: tenants=[{id:1}] (taken) → collision; Attempt 2: both empty.
    selectQueue.push([{ id: 1 }], []); // attempt 1 (taken)
    selectQueue.push([], []); // attempt 2 (free)
    const code = await mintUniqueCode();
    expect(isValidCodeShape(code)).toBe(true);
    expect(selectCalls).toBe(4); // two attempts × two table checks
  });
});

describe('resolveCodeOwner', () => {
  it('resolves a tenant referral code (peer) regardless of affiliate status', async () => {
    // First select (tenants) hits → returns immediately, affiliate select never runs.
    selectQueue.push([{ id: 5, email: 'peer@x.com' }]);
    const owner = await resolveCodeOwner('PEER2345');
    expect(owner).toEqual({ kind: 'referral', tenantId: 5, ownerEmail: 'peer@x.com' });
  });

  it('attributes to an ACTIVE affiliate', async () => {
    // tenants miss, then affiliate hit (status active).
    selectQueue.push([]); // tenants
    selectQueue.push([{ id: 8, email: 'aff@x.com', ownerTenantId: null, status: 'active' }]);
    const owner = await resolveCodeOwner('AFFCODE1');
    expect(owner).toEqual({
      kind: 'affiliate',
      affiliateId: 8,
      ownerEmail: 'aff@x.com',
      ownerTenantId: null,
    });
  });

  it('does NOT attribute to a SUSPENDED affiliate — treats it as no-owner', async () => {
    selectQueue.push([]); // tenants miss
    selectQueue.push([{ id: 8, email: 'aff@x.com', ownerTenantId: null, status: 'suspended' }]);
    const owner = await resolveCodeOwner('AFFCODE1');
    expect(owner).toBeNull();
  });

  it('does NOT attribute to a non-active (pending) affiliate', async () => {
    selectQueue.push([]); // tenants miss
    selectQueue.push([{ id: 9, email: 'aff2@x.com', ownerTenantId: 3, status: 'pending' }]);
    const owner = await resolveCodeOwner('AFFCODE2');
    expect(owner).toBeNull();
  });

  it('returns null for an unknown code', async () => {
    selectQueue.push([], []); // tenants miss, affiliates miss
    const owner = await resolveCodeOwner('NOPE2345');
    expect(owner).toBeNull();
  });

  it('returns null for an empty/blank code without touching the DB', async () => {
    const owner = await resolveCodeOwner('   ');
    expect(owner).toBeNull();
    expect(selectCalls).toBe(0);
  });
});
