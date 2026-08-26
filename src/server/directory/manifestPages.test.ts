/**
 * Manifest Privacy pages — HONEST-CLAIMS copy guard + status honesty.
 *
 * These assert the non-negotiable claims rules directly on the rendered HTML
 * (plain text, unlike the kerned PDF stream):
 *   • no "CBP API" claim anywhere; filing is done "on your behalf"
 *   • no "Verified" badge language on the docs-only funnel
 *   • status vocabulary is honest (Draft→Signed→Submitted→Confirmed→Active) and
 *     never shows "Hidden/Protected" for a pre-confirm state
 *   • redaction is described as "Hidden on QuoteFleet", not removal from CBP
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  // ENT price unset → its plan card renders "Coming soon" (graceful degrade).
  loadEnv: () => ({
    STRIPE_PRICE_MANIFEST_BASIC: 'price_b',
    STRIPE_PRICE_MANIFEST_PRO: 'price_p',
    STRIPE_SECRET_KEY: 'sk_test',
    PUBLIC_BASE_URL: 'http://localhost:5000',
  }),
}));

const { renderPrivacyLanding, renderPrivacyApply, renderAdminPrivacyQueue, statusLabel, buildCbpCertText, DISCLOSURE_TEXT } =
  await import('./manifestPages.js');
const { MANIFEST_TIERS } = await import('./manifestEntitlement.js');

const lower = (s: string) => s.toLowerCase();

describe('honest-claims — landing + onboarding copy', () => {
  const landing = renderPrivacyLanding();
  const apply = renderPrivacyApply({ app: null, prefill: { slug: 'acme-imports', name: 'Acme Imports LLC' } });

  it('never claims a CBP API', () => {
    expect(lower(landing)).not.toContain('cbp api');
    expect(lower(apply)).not.toContain('cbp api');
    expect(lower(DISCLOSURE_TEXT)).not.toContain('cbp api'); // disclosure explicitly says "no CBP API"
  });

  it('says the filing is prepared/submitted on the customer’s behalf', () => {
    expect(lower(landing)).toContain('on your behalf');
    expect(lower(apply)).toContain('on your behalf');
  });

  it('does not use a "Verified" badge claim in manifest-specific copy (docs are self-reported)', () => {
    // Scope to the strings THIS feature owns — the shared site shell legitimately
    // carries "FMCSA-verified" for real FMCSA data, which is not ours to police.
    expect(lower(DISCLOSURE_TEXT)).not.toContain('verified');
    for (const t of MANIFEST_TIERS) {
      for (const f of t.features) expect(lower(f)).not.toContain('verified');
    }
    expect(lower(landing)).toContain('self-reported');
  });

  it('describes redaction as "Hidden on QuoteFleet", not removal from CBP', () => {
    expect(lower(landing)).toContain('hidden on quotefleet');
  });

  it('shows the ESIGN consent + disclosure on the sign step', () => {
    expect(lower(apply)).toContain('esign');
    expect(lower(apply)).toContain('sign electronically');
  });

  it('renders a "Coming soon" state for the unpriced Enterprise tier (graceful degrade)', () => {
    expect(landing).toContain('Coming soon');
  });
});

describe('status honesty', () => {
  it('uses the honest lifecycle vocabulary', () => {
    expect(statusLabel('draft')).toBe('Draft');
    expect(statusLabel('signed')).toBe('Signed');
    expect(statusLabel('submitted')).toBe('Submitted to CBP');
    expect(statusLabel('confirmed')).toBe('Confirmed by CBP');
    expect(statusLabel('renewal_due')).toBe('Renewal due');
  });
  it('never labels a pre-confirm state "Hidden" or "Protected"', () => {
    for (const s of ['draft', 'signed', 'submitted', 'confirmed'] as const) {
      expect(lower(statusLabel(s))).not.toContain('hidden');
      expect(lower(statusLabel(s))).not.toContain('protected');
    }
    // Only the post-confirm 'active' state mentions hidden-on-QuoteFleet.
    expect(lower(statusLabel('active'))).toContain('hidden on quotefleet');
  });
});

describe('buildCbpCertText — the human-filing certification', () => {
  it('includes the CFR reference + EIN + names, and no CBP API claim', () => {
    const app = {
      grantorLegalName: 'Acme Imports LLC',
      einOrImporterNo: '12-3456789',
      nameVariations: ['Acme Imports LLC', 'Acme Imports'],
      addressVariations: [],
      grantorAddress: '123 Harbor Way',
      docSha256: 'abc123',
    } as unknown as Parameters<typeof buildCbpCertText>[0];
    const text = buildCbpCertText(app);
    expect(text).toContain('103.31(d)');
    expect(text).toContain('12-3456789');
    expect(text).toContain('Acme Imports');
    expect(lower(text)).not.toContain('cbp api');
  });
});

describe('admin queue renders without a "Verified" badge on docs', () => {
  it('renders an empty queue safely', () => {
    const html = renderAdminPrivacyQueue([]);
    expect(html).toContain('CBP filing queue');
    expect(html).toContain('No applications yet.');
  });
});
