/**
 * Admin subscription ops cores — comp/free-grant, Stripe refund, importer cache
 * purge. All superadmin-only + audited in the route layer; here we drive the
 * pure/DB cores against an in-memory db mock (and an injected fake Stripe for the
 * money-moving refund) so the logic is provable without a real DB or Stripe.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted control knobs the db mock reads (mirrors manifestPrivacyRoute.test.ts).
const ctl = vi.hoisted(() => ({
  userRows: [] as Record<string, unknown>[],
  deletedContact: [] as Record<string, unknown>[],
  deletedBol: [] as Record<string, unknown>[],
  lastInsert: null as { table: string; vals: Record<string, unknown> } | null,
}));

vi.mock('../../db/client.js', () => {
  const returningRows = (vals: Record<string, unknown>) => [{ id: 1, ...vals }];
  return {
    db: () => ({
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(ctl.userRows) }),
          limit: () => Promise.resolve(ctl.userRows),
        }),
      }),
      insert: (table: { [k: string]: unknown }) => ({
        values: (vals: Record<string, unknown>) => {
          const name = String((table as { _?: { name?: string } })._?.name ?? '');
          ctl.lastInsert = { table: name, vals };
          const done = Promise.resolve(returningRows(vals));
          return {
            onConflictDoUpdate: () => ({ returning: () => Promise.resolve(returningRows(vals)) }),
            returning: () => Promise.resolve(returningRows(vals)),
            // Awaitable for the best-effort audit insert (no .returning()).
            then: (res: (v: unknown) => unknown) => res(undefined),
            catch: () => done,
          };
        },
      }),
      // Both cache purges hit delete().where().returning(); the company (contact)
      // path is the only one the tests exercise, so return that canned set.
      delete: () => ({
        where: () => ({ returning: () => Promise.resolve(ctl.deletedContact) }),
      }),
    }),
  };
});

beforeEach(() => {
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  ctl.userRows = [];
  ctl.deletedContact = [];
  ctl.deletedBol = [];
  ctl.lastInsert = null;
});

describe('upsertCompSubscription', () => {
  it('404s when no user has that email', async () => {
    const { upsertCompSubscription } = await import('./admin.js');
    ctl.userRows = [];
    const r = await upsertCompSubscription({ product: 'directory', body: { email: 'nobody@x.com' } });
    expect(r.status).toBe(404);
  });

  it('grants an active comp directory entitlement for a known user', async () => {
    const { upsertCompSubscription } = await import('./admin.js');
    ctl.userRows = [{ id: 42 }];
    const r = await upsertCompSubscription({ product: 'directory', body: { email: 'a@b.com', months: 6, note: 'partner' } });
    expect(r.status).toBe(200);
    const sub = (r.json as { subscription: Record<string, unknown> }).subscription;
    expect(sub.userId).toBe(42);
    expect(sub.status).toBe('active');
    expect(sub.comp).toBe(true);
    expect(sub.compNote).toBe('partner');
    expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it('grants a manifest comp with the tier quota applied', async () => {
    const { upsertCompSubscription } = await import('./admin.js');
    ctl.userRows = [{ id: 7 }];
    const r = await upsertCompSubscription({ product: 'manifest', body: { email: 'c@d.com', tier: 'professional' } });
    expect(r.status).toBe(200);
    const sub = (r.json as { subscription: Record<string, unknown> }).subscription;
    expect(sub.tier).toBe('professional');
    expect(sub.entityQuota).toBe(5);
    expect(sub.comp).toBe(true);
  });

  it('rejects a bad email', async () => {
    const { upsertCompSubscription } = await import('./admin.js');
    const r = await upsertCompSubscription({ product: 'directory', body: { email: 'not-an-email' } });
    expect(r.status).toBe(400);
  });
});

describe('issueRefundAdmin', () => {
  it('requires a paymentIntent or charge id', async () => {
    const { issueRefundAdmin } = await import('./admin.js');
    const r = await issueRefundAdmin({ body: {}, stripe: { refunds: { create: vi.fn() } } });
    expect(r.status).toBe(400);
  });

  it('calls Stripe with the payment_intent + amount and returns the refund id', async () => {
    const { issueRefundAdmin } = await import('./admin.js');
    const create = vi.fn(async () => ({ id: 're_123', status: 'succeeded', amount: 500 }));
    const r = await issueRefundAdmin({
      body: { paymentIntentId: 'pi_abc', amountCents: 500, reason: 'requested_by_customer' },
      stripe: { refunds: { create } },
    });
    expect(create).toHaveBeenCalledWith({ payment_intent: 'pi_abc', amount: 500, reason: 'requested_by_customer' });
    expect(r.status).toBe(200);
    expect((r.json as { refundId: string }).refundId).toBe('re_123');
  });

  it('maps a Stripe failure to a 502', async () => {
    const { issueRefundAdmin } = await import('./admin.js');
    const create = vi.fn(async () => { throw new Error('No such charge'); });
    const r = await issueRefundAdmin({ body: { chargeId: 'ch_x' }, stripe: { refunds: { create } } });
    expect(r.status).toBe(502);
  });
});

describe('purgeImporterCacheAdmin', () => {
  it('requires a company or searchKey', async () => {
    const { purgeImporterCacheAdmin } = await import('./admin.js');
    const r = await purgeImporterCacheAdmin({ body: {} });
    expect(r.status).toBe(400);
  });

  it('purges the contact cache by company and reports the count', async () => {
    const { purgeImporterCacheAdmin } = await import('./admin.js');
    ctl.deletedContact = [{ id: 1 }];
    const r = await purgeImporterCacheAdmin({ body: { company: 'Acme Imports LLC' } });
    expect(r.status).toBe(200);
    expect((r.json as { contactPurged: number }).contactPurged).toBe(1);
  });
});
