/**
 * Leads Pro entitlement — graceful "coming soon" degrade when the Stripe price
 * id is UNSET. Asserts leadsPriceId → null and leadsProPurchasable → false so the
 * checkout button never crashes and the reveal wall renders "coming soon".
 *
 * config + db + auth are mocked; no DB / network is touched.
 */
import { describe, it, expect, vi } from 'vitest';

// STRIPE_PRICE_LEADS_PRO intentionally UNSET → the "coming soon" degrade case.
vi.mock('../../config.js', () => ({
  loadEnv: () => ({
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PRICE_LEADS_PRO: undefined,
    PUBLIC_BASE_URL: 'http://localhost:5000',
  }),
}));
vi.mock('../../db/client.js', () => ({ db: () => ({}) }));
vi.mock('../../auth/session.js', () => ({
  lookupSession: async () => null,
  SESSION_COOKIE_NAME: 'qf_session',
}));

const { leadsPriceId, leadsProPurchasable, FREE_REVEAL_TASTE, LEADS_PRO_MONTHLY_ALLOWANCE } =
  await import('./leadsEntitlement.js');

describe('Leads Pro entitlement — coming-soon degrade (price unset)', () => {
  it('leadsPriceId is null and leadsProPurchasable is false when the price id is unset', () => {
    expect(leadsPriceId()).toBeNull();
    expect(leadsProPurchasable()).toBe(false);
  });
  it('ships the model defaults (2 free taste / 50 per Pro month)', () => {
    expect(FREE_REVEAL_TASTE).toBe(2);
    expect(LEADS_PRO_MONTHLY_ALLOWANCE).toBe(50);
  });
});
