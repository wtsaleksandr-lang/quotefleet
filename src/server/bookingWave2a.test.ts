/**
 * Guards for the "Book this load" + per-tenant deposit wave (Wave 2a):
 *   - the widget config exposes the resolved booking deposit config
 *   - the widget renders "Book this load" ONLY when features.quoteBooking is on
 *     (default OFF), and posts the compact booking step to the EXISTING
 *     booking_requested flow (POST /api/public/accept/:refId)
 *   - the accept route computes the deposit server-side (authoritative), keeps
 *     dispatcher notes, and includes the deposit in the carrier notification
 *   - the dashboard exposes the toggle + deposit type/amount and merges the
 *     nested `booking` object into featuresJson without dropping other keys
 *   - Wave 2b (Stripe) has a clean seam and there is NO Stripe code here
 *
 * Source-level assertions in the same style as quoteFunnel.test.ts, so a future
 * edit that ungated the booking UI, dropped the deposit computation, or leaked
 * Stripe into this wave fails CI immediately.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const routesDir = resolve(process.cwd(), 'src/server/routes');

const pub = (n: string) => readFile(resolve(publicDir, n), 'utf8');
const route = (n: string) => readFile(resolve(routesDir, n), 'utf8');

describe('widget config exposes the booking deposit config', () => {
  it('the public widget config returns resolveBookingConfig(brand)', async () => {
    const p = await route('public.ts');
    expect(p).toContain('booking: resolveBookingConfig(brand)');
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
    // confirmation copy on success
    expect(js).toContain('Booking requested — ');
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

describe('Wave 2b (Stripe) seam — no Stripe code in this wave', () => {
  it('the accept route notes where the PaymentIntent will be created', async () => {
    const p = await route('public.ts');
    expect(p).toContain('Wave 2b (Stripe) creates the');
  });

  it('no Stripe SDK / charge code is introduced in the wave-2a surfaces', async () => {
    const p = await route('public.ts');
    const js = await pub('widget.js');
    // Comments may NAME the seam (Wave 2b), but no Stripe import / client /
    // charge/checkout call may exist yet.
    for (const src of [p, js]) {
      expect(src).not.toMatch(/from ['"]stripe['"]/);
      expect(src).not.toMatch(/require\(['"]stripe['"]\)/);
      expect(src).not.toMatch(/new Stripe\(/);
      expect(src).not.toMatch(/stripe\.(checkout|paymentIntents|charges)/);
    }
  });
});
