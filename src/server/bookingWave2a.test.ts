/**
 * Source-level guards for the "Book this load" + per-tenant deposit flow,
 * now through Wave 2b (the Stripe deposit CHARGE). These lock the wiring that
 * behavioural unit tests can't see from the outside:
 *   - the widget config exposes the resolved booking deposit config
 *   - the widget renders "Book this load" ONLY when features.quoteBooking is on
 *     (default OFF), and posts to the EXISTING accept route
 *   - the accept route computes the deposit SERVER-SIDE (authoritative) and,
 *     when the carrier is Connect-ready + a deposit is due, creates a Stripe
 *     Checkout DESTINATION CHARGE (createDepositCheckoutSession) and returns a
 *     checkoutUrl; otherwise it keeps the intent-only booking_requested flow
 *   - the dashboard exposes the toggle + deposit type/amount and merges the
 *     nested `booking` object into featuresJson without dropping other keys
 *   - Wave 2b money movement is a DESTINATION CHARGE with a platform fee, the
 *     billing webhook reconciles it, and the widget redirects to pay / renders
 *     the paid + cancelled return states
 *
 * The deposit MONEY MATH + the charge-path/fallback/idempotency BEHAVIOUR are
 * exercised with a mocked Stripe + db in bookingConfig.test.ts and
 * depositCharge.test.ts — this file only asserts the surfaces are wired.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const routesDir = resolve(process.cwd(), 'src/server/routes');

const pub = (n: string) => readFile(resolve(publicDir, n), 'utf8');
const route = (n: string) => readFile(resolve(routesDir, n), 'utf8');

describe('widget config exposes the booking deposit config + charge readiness', () => {
  it('the public widget config returns the resolved booking config + chargeReady', async () => {
    const p = await route('public.ts');
    expect(p).toContain('...resolveBookingConfig(brand), chargeReady: tenantChargeReady(tenant)');
    expect(p).toContain("import { resolveFeatures, resolveBookingConfig, computeDeposit } from '../features.js'");
  });
});

describe('"Book this load" is gated on features.quoteBooking (default OFF)', () => {
  it('the widget only renders booking when quoteBooking === true', async () => {
    const js = await pub('widget.js');
    expect(js).toContain('function bookingFeatureOn()');
    // default OFF — only an explicit true enables (mirrors resolveFeatures)
    expect(js).toContain('f.quoteBooking === true');
    expect(js).toContain('function renderBookingAffordance()');
    // rendering bails out when the feature is off
    expect(js).toMatch(/if \(!bookingFeatureOn\(\)\) return;/);
    // the affordance is invoked after the share bar on the thanks step
    expect(js).toContain('renderBookingAffordance();');
  });

  it('the booking step shows the deposit line and posts to the accept route', async () => {
    const js = await pub('widget.js');
    expect(js).toContain('Book this load');
    expect(js).toContain('deposit to book');
    expect(js).toContain('/api/public/accept/');
  });
});

describe('accept route records the booking + server-computed deposit', () => {
  it('computes the deposit from the saved quoted total (authoritative)', async () => {
    const p = await route('public.ts');
    expect(p).toContain('resolveBookingConfig(acceptBrand ?? null)');
    expect(p).toContain('computeDeposit(Number(lead.quotedTotal ?? 0), bookingCfg)');
  });

  it('still transitions to booking_requested and preserves dispatcher notes', async () => {
    const p = await route('public.ts');
    expect(p).toContain("lead.status === 'won' ? 'won' : 'booking_requested'");
    // dispatcher notes preserved: existing lead.notes leads the merged string
    expect(p).toContain('const mergedNotes = [lead.notes,');
    // the booking note carries the deposit + ready-by + phone
    expect(p).toContain('Deposit to book:');
    expect(p).toContain('Ready by:');
  });

  it('includes the deposit in the carrier notification email', async () => {
    const p = await route('public.ts');
    expect(p).toContain('deposit: depositLabel');
    expect(p).toContain('readyByTime: body.readyByTime || null');
  });
});

describe('dashboard exposes the booking toggle + deposit config', () => {
  it('renders the "Book this load" toggle + deposit type/amount', async () => {
    const js = await pub('app.js');
    expect(js).toContain('function brandBookingConfig(b)');
    expect(js).toContain('Let customers book this load');
    expect(js).toContain('Percent of quote');
    expect(js).toContain('Fixed amount');
    expect(js).toContain('brandBookingConfig(b)');
  });

  it('saves the nested booking object + the quoteBooking flag via the merge-PUT', async () => {
    const js = await pub('app.js');
    expect(js).toContain('saveBrandPatch({ featuresJson: { booking: payload } })');
    expect(js).toContain('saveBrandPatch({ featuresJson: { quoteBooking: next } })');
  });

  it('the brand PUT merges the sanitized booking object into featuresJson', async () => {
    const t = await route('tenant.ts');
    expect(t).toContain('sanitizeBookingPatch');
    expect(t).toContain('if (bookingPatch) merged.booking = bookingPatch;');
    // sibling boolean flags are still merged too, never dropped
    expect(t).toContain('if (featurePatch) Object.assign(merged, featurePatch);');
  });
});

describe('Wave 2b — the accept route runs the CHARGE path when Connect-ready', () => {
  it('imports the deposit-charge helpers and gates the charge on tenantCanCharge', async () => {
    const p = await route('public.ts');
    expect(p).toContain("from './depositCharge.js'");
    expect(p).toContain('tenantCanCharge(acceptTenant, deposit)');
    expect(p).toContain('createDepositCheckoutSession({');
    // the charged amount is the SERVER-computed `deposit`, never a client value
    expect(p).toMatch(/createDepositCheckoutSession\(\{[\s\S]*?deposit,[\s\S]*?currency: bookingCurrency/);
    // records a deposit-pending state with the session id, returns checkoutUrl
    expect(p).toContain("status: 'pending'");
    expect(p).toContain('checkoutUrl: created.url');
  });

  it('keeps the intent-only fallback (booking_requested + notify, no charge)', async () => {
    const p = await route('public.ts');
    // both the update and the carrier notification still exist for the fallback
    expect(p).toContain('INTENT-ONLY FALLBACK');
    expect(p).toContain('bookingAcceptedEmail(');
    // a failed session creation falls through to the fallback rather than 500ing
    expect(p).toContain('falling back to intent-only');
  });
});

describe('Wave 2b — the destination charge + webhook reconciliation', () => {
  it('builds a mode:payment Checkout session with an application fee + destination', async () => {
    const d = await route('depositCharge.ts');
    expect(d).toContain("mode: 'payment'");
    expect(d).toContain('application_fee_amount: applicationFeeAmount');
    expect(d).toContain('transfer_data: { destination }');
    // destination is THIS tenant's connected account, never another tenant's
    expect(d).toContain('const destination = tenant.stripeConnectAccountId');
    // metadata identifies the deposit session for the webhook
    expect(d).toContain("kind: 'deposit'");
  });

  it('defines the platform fee constant, env-overridable, capped at the deposit', async () => {
    const d = await route('depositCharge.ts');
    expect(d).toContain('export const PLATFORM_FEE_PCT = 2.9');
    expect(d).toContain('loadEnv().PLATFORM_FEE_PCT');
    // fee never exceeds the deposit
    expect(d).toContain('Math.min(Math.max(fee, 0), depositCents)');
  });

  it('the billing webhook routes deposit sessions to the deposit handler', async () => {
    const b = await route('billing.ts');
    expect(b).toContain("import { isDepositSession, handleDepositCheckoutCompleted } from './depositCharge.js'");
    expect(b).toContain('if (isDepositSession(session)) {');
    expect(b).toContain('await handleDepositCheckoutCompleted(session);');
  });

  it('the deposit webhook marks paid idempotently + records the fee', async () => {
    const d = await route('depositCharge.ts');
    // idempotency: a duplicate completed event for the same session no-ops
    expect(d).toContain("prior.status === 'paid' && prior.paidSessionId === session.id");
    expect(d).toContain("status: 'paid'");
    expect(d).toContain('applicationFeeAmount');
  });
});

describe('Wave 2b — the widget redirects to pay + renders the return states', () => {
  it('redirects to Stripe Checkout when the accept response carries a checkoutUrl', async () => {
    const js = await pub('widget.js');
    expect(js).toContain('r.body.checkoutUrl');
    expect(js).toContain('function gotoCheckout(url)');
    expect(js).toContain('gotoCheckout(r.body.checkoutUrl)');
  });

  it('renders the deposit paid + cancelled return states on return from Checkout', async () => {
    const js = await pub('widget.js');
    expect(js).toContain('function renderBookingReturn()');
    expect(js).toContain('renderBookingReturn();');
    expect(js).toContain('Deposit paid — booking confirmed');
    expect(js).toContain('Payment not completed');
    const css = await pub('widget-style.css');
    expect(css).toContain('.qf-book-return');
  });

  it('labels the CTA as a PAYMENT only when a charge will actually happen', async () => {
    const js = await pub('widget.js');
    // reads the server-provided charge-readiness flag
    expect(js).toContain('function bookingChargeReady()');
    expect(js).toContain('state.config.booking.chargeReady === true');
    // charge path → "Pay $X deposit to book"; fallback → "Request booking"
    expect(js).toContain('var willCharge = bookingChargeReady() && deposit > 0;');
    expect(js).toContain("'Pay ' + fmtAmount(deposit) + ' deposit to book'");
    expect(js).toContain("'Request booking'");
  });
});

describe('Wave 2b — the qf-book CSS uses runtime theme tokens (dark-safe)', () => {
  it('routes book text/island through --w-text / --w-success-bg|text, not the un-remapped --w-fg/--w-bg/--w-success', async () => {
    const css = await pub('widget-style.css');
    // deposit line + book text read on the shell via the runtime --w-text
    expect(css).toContain('.qf-book-deposit { margin-top: var(--space-1-5); font-size: 14px; font-weight: 750; color: var(--w-text, var(--w-fg)); }');
    // the paid island uses the runtime success PAIR (light panel, dark text),
    // never color-mix(--w-success, --w-bg) which is a bright mint island on dark
    expect(css).toContain('background: var(--w-success-bg, #dcfce7);');
    expect(css).toContain('color: var(--w-success-text, var(--w-fg))');
    // no qf-book rule paints text with the un-remapped legacy --w-fg alone
    expect(css).not.toMatch(/\.qf-book-[\w-]+\s*\{[^}]*color:\s*var\(--w-fg\)\s*;/);
  });
});
