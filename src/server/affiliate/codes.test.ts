/**
 * Code minting uniqueness — mintUniqueCode retries past a collision. DB mocked.
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

beforeEach(async () => {
  selectQueue.length = 0;
  selectCalls = 0;
  ({ mintUniqueCode } = await import('./codes.js'));
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
