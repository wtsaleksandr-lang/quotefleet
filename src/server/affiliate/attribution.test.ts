/**
 * Attribution linking on signup — self-referral ignored, referee reward applied,
 * referrer credit queued, affiliate link. DB + code resolution are mocked so this
 * exercises the real linkReferralOnSignup decision logic without infrastructure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenants, referralAttributions, referralCredits } from '../../db/schema.js';

// ── Code-owner resolution mock ──────────────────────────────────────────────
const resolveCodeOwner = vi.fn();
vi.mock('./codes.js', () => ({ resolveCodeOwner: (...a: unknown[]) => resolveCodeOwner(...a) }));

// ── DB mock: records updates/inserts, serves queued selects ─────────────────
type Rec = { table: unknown; payload: unknown };
const state = {
  selects: [] as unknown[][], // FIFO of select() results
  updates: [] as Rec[],
  inserts: [] as Rec[],
};

function selectChain() {
  const rows = state.selects.length ? state.selects.shift()! : [];
  const p: any = {
    from: () => p,
    where: () => p,
    orderBy: () => p,
    limit: () => p,
    groupBy: () => p,
    then: (res: (v: unknown) => void, rej: (e: unknown) => void) =>
      Promise.resolve(rows).then(res, rej),
  };
  return p;
}
function updateChain(table: unknown) {
  let captured: unknown;
  const p: any = {
    set: (obj: unknown) => {
      captured = obj;
      state.updates.push({ table, payload: obj });
      return p;
    },
    where: () => p,
    then: (res: (v: unknown) => void) => Promise.resolve([]).then(res),
  };
  return p;
}
function insertChain(table: unknown) {
  const p: any = {
    values: (obj: unknown) => {
      state.inserts.push({ table, payload: obj });
      const vp: any = {
        returning: () => Promise.resolve([{ id: 500, ...(obj as object) }]),
        then: (res: (v: unknown) => void) => Promise.resolve([{ id: 500 }]).then(res),
      };
      return vp;
    },
  };
  return p;
}

const dbStub: any = {
  select: () => selectChain(),
  update: (table: unknown) => updateChain(table),
  insert: (table: unknown) => insertChain(table),
};
vi.mock('../../db/client.js', () => ({ db: () => dbStub }));

let linkReferralOnSignup: typeof import('./attribution.js').linkReferralOnSignup;

beforeEach(async () => {
  state.selects = [];
  state.updates = [];
  state.inserts = [];
  resolveCodeOwner.mockReset();
  ({ linkReferralOnSignup } = await import('./attribution.js'));
});

const reqWith = (cookie: string) => ({ cookies: { qf_ref: cookie } }) as any;

describe('linkReferralOnSignup', () => {
  it('applies the referee reward + queues the referrer credit for a peer referral', async () => {
    resolveCodeOwner.mockResolvedValue({ kind: 'referral', tenantId: 99, ownerEmail: 'ref@x.com' });
    // 1) attribution lookup → an existing pending row; 2) credit-exists → none
    state.selects = [[{ id: 5, code: 'ABCD2345', visitorToken: 'tok', referredTenantId: null }], []];

    const out = await linkReferralOnSignup({
      req: reqWith('ABCD2345~tok'),
      tenantId: 1001,
      signupEmail: 'new@customer.com',
    });

    expect(out?.kind).toBe('referral');
    expect(out?.referrerTenantId).toBe(99);
    expect(out?.refereeTrialDays).toBe(30);
    expect(out?.refereeDiscountPct).toBe(0.2);

    // Referee's trial was extended (update on tenants with a future trialEndsAt).
    const tenantUpdate = state.updates.find((u) => u.table === tenants);
    expect(tenantUpdate).toBeTruthy();
    const trialEndsAt = (tenantUpdate!.payload as any).trialEndsAt as Date;
    const days = (trialEndsAt.getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    // Attribution linked to the new tenant + marked signed_up.
    const attrUpdate = state.updates.find((u) => u.table === referralAttributions);
    expect((attrUpdate!.payload as any).referredTenantId).toBe(1001);
    expect((attrUpdate!.payload as any).rewardStatus).toBe('signed_up');

    // Referrer credit queued: 1 free month to tenant 99, pending.
    const creditInsert = state.inserts.find((i) => i.table === referralCredits);
    expect(creditInsert).toBeTruthy();
    expect((creditInsert!.payload as any).tenantId).toBe(99);
    expect((creditInsert!.payload as any).monthsGranted).toBe(1);
    expect((creditInsert!.payload as any).status).toBe('pending');
  });

  it('IGNORES a self-referral (owner email == signup email) — no reward, no credit', async () => {
    resolveCodeOwner.mockResolvedValue({ kind: 'referral', tenantId: 42, ownerEmail: 'me@self.com' });
    state.selects = [[{ id: 7, code: 'SELFCODE', visitorToken: 'tok', referredTenantId: null }]];

    const out = await linkReferralOnSignup({
      req: reqWith('SELFCODE~tok'),
      tenantId: 1002,
      signupEmail: 'ME@self.com', // case-insensitive match
    });

    expect(out).toBeNull();
    // Attribution marked ignored; NO tenant trial update, NO credit insert.
    const attrUpdate = state.updates.find((u) => u.table === referralAttributions);
    expect((attrUpdate!.payload as any).rewardStatus).toBe('ignored');
    expect(state.updates.find((u) => u.table === tenants)).toBeUndefined();
    expect(state.inserts.find((i) => i.table === referralCredits)).toBeUndefined();
  });

  it('links an affiliate-code signup without a referee trial bonus', async () => {
    resolveCodeOwner.mockResolvedValue({
      kind: 'affiliate',
      affiliateId: 8,
      ownerEmail: 'aff@x.com',
      ownerTenantId: null,
    });
    state.selects = [[{ id: 9, code: 'AFFCODE1', visitorToken: 'tok', referredTenantId: null }]];

    const out = await linkReferralOnSignup({
      req: reqWith('AFFCODE1~tok'),
      tenantId: 1003,
      signupEmail: 'buyer@x.com',
    });

    expect(out?.kind).toBe('affiliate');
    expect(out?.affiliateId).toBe(8);
    // No trial extension for affiliate referrals, no referral credit.
    expect(state.updates.find((u) => u.table === tenants)).toBeUndefined();
    expect(state.inserts.find((i) => i.table === referralCredits)).toBeUndefined();
  });

  it('returns null when there is no ref cookie', async () => {
    const out = await linkReferralOnSignup({
      req: { cookies: {} } as any,
      tenantId: 1004,
      signupEmail: 'x@y.com',
    });
    expect(out).toBeNull();
    expect(resolveCodeOwner).not.toHaveBeenCalled();
  });
});
