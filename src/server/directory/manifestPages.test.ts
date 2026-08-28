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

const {
  renderPrivacyLanding,
  renderPrivacyApply,
  renderAdminPrivacyQueue,
  renderPrivacyAccount,
  renderPrivacyLogin,
  renderPrivacyVerified,
  statusLabel,
  buildCbpCertText,
  DISCLOSURE_TEXT,
} = await import('./manifestPages.js');
const { validatePoaForFiling } = await import('../manifestPoaValidation.js');
const { MANIFEST_TIERS } = await import('./manifestEntitlement.js');
type ManifestIdentity = import('./manifestEntitlement.js').ManifestIdentity;
type PoaApplication = import('../../db/schema.js').PoaApplication;

const identity = (over: Partial<ManifestIdentity> = {}): ManifestIdentity => ({
  userId: 5,
  email: 'jane@acme.com',
  name: null,
  isSubscriber: false,
  tier: null,
  status: null,
  currentPeriodEnd: null,
  entityQuota: 0,
  ...over,
});
const poa = (over: Partial<PoaApplication> = {}): PoaApplication =>
  ({
    id: 1,
    publicToken: 'tok_abc',
    userId: 5,
    status: 'active',
    grantorLegalName: 'Acme Imports LLC',
    nameVariations: ['Acme Imports LLC', 'Acme Imports'],
    addressVariations: [],
    signerEmail: 'jane@acme.com',
    docSha256: 'deadbeef',
    signedAt: new Date('2026-01-02'),
    cbpSubmittedAt: new Date('2026-01-05'),
    cbpConfirmedAt: new Date('2026-01-10'),
    effectiveAt: new Date('2026-01-10'),
    expiresAt: new Date('2028-01-10'),
    ...over,
  }) as unknown as PoaApplication;

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

describe('production POA — the onboarding flow collects every CBP-required element', () => {
  const apply = renderPrivacyApply({ app: null, prefill: {} });

  it('has no DRAFT / attorney-review hedge left anywhere in the customer copy', () => {
    for (const html of [apply, renderPrivacyLanding(), DISCLOSURE_TEXT]) {
      expect(lower(html)).not.toContain('attorney review');
      expect(lower(html)).not.toContain('pending attorney');
      expect(lower(html)).not.toContain('is a draft');
      expect(lower(html)).not.toContain('draft pending');
    }
  });

  it('captures DBAs, entity type, jurisdiction, residency, physical address, EIN and IOR', () => {
    for (const id of [
      'f-legal',
      'f-entity',
      'f-state',
      'f-country',
      'f-residency',
      'f-addr',
      'f-mailaddr',
      'f-ein',
      'f-ior',
    ]) {
      expect(apply, `missing field ${id}`).toContain(`id="${id}"`);
    }
    expect(apply).toContain('data-chips="dba"');
    expect(apply).toContain('data-chips="partner"');
    // The physical-address rule is stated to the customer, not just enforced.
    expect(lower(apply)).toContain('physical street address');
    expect(lower(apply)).toContain('rejects po boxes');
  });

  it('captures the signer title, business email and phone, and the corporate certification', () => {
    for (const id of ['f-signer', 'f-title', 'f-email', 'f-phone', 'f-certname', 'f-certtitle', 'f-certemail']) {
      expect(apply, `missing field ${id}`).toContain(`id="${id}"`);
    }
    // The allowlist is embedded so the client can offer the accepted titles and
    // reveal the certification block when the typed title is off-list.
    expect(apply).toContain('"titleAllowlist"');
    expect(apply).toContain('general partner');
    expect(apply).toContain('Corporate certification (second officer)');
  });

  it('shows the partnership and nonresident-corporation conditional blocks', () => {
    expect(apply).toContain('id="f-partners-wrap"');
    expect(apply).toContain('19 CFR 141.39');
    expect(apply).toContain('19 CFR 141.34');
    expect(apply).toContain('id="f-nonres-note"');
    expect(apply).toContain('19 CFR 141.37');
    expect(apply).toContain('id="f-authdocs"');
  });

  it('states the e-sign hardening promises: audit trail, retention, governing law', () => {
    expect(lower(apply)).toContain('sha-256');
    expect(lower(apply)).toContain('audit trail');
    expect(apply).toContain('at least 5 years');
    expect(apply).toContain('State of Delaware');
    // The email round-trip is disclosed as a blocking step, honestly.
    expect(lower(apply)).toContain('confirmation link');
    expect(apply).toContain('id="mcp-verify-note"');
  });

  it('the disclosure carries the express no-customs-business exclusion and the exact-match warning', () => {
    expect(lower(DISCLOSURE_TEXT)).toContain('no authority to transact customs business');
    expect(lower(DISCLOSURE_TEXT)).toContain('form 5106');
    expect(lower(DISCLOSURE_TEXT)).toContain('does not act as your customs broker');
    expect(lower(DISCLOSURE_TEXT)).toContain('exactly');
    expect(lower(DISCLOSURE_TEXT)).not.toContain('cbp api');
    // Never marketed as brokerage anywhere.
    expect(lower(renderPrivacyLanding())).not.toContain('customs broker');
  });
});

describe('admin queue — the pre-filing gate is rendered as a per-application checklist', () => {
  const gateApp = poa({
    entityType: 'Limited Liability Company (LLC)',
    stateOfOrg: 'Delaware',
    grantorAddress: 'PO Box 4120, Long Beach, CA',
    einOrImporterNo: '12-3456789',
    signerName: 'Jane Doe',
    signerTitle: 'Manager',
    signerEmail: 'jane@acme.test',
    signerPhone: '+1 562 555 0142',
    signerEmailVerifiedAt: null,
  });

  it('lists each check with pass/fail and a blocking count', () => {
    const gate = validatePoaForFiling(gateApp);
    const html = renderAdminPrivacyQueue([{ app: gateApp, events: [], gate }]);
    expect(html).toContain('Pre-filing checks');
    expect(html).toContain('blocking');
    // The PO box and the unverified email are both surfaced by name.
    expect(html).toContain('Physical address (no PO box)');
    expect(html).toContain('Signer email round-trip verified');
    expect(html).toContain('Legal name matches ACE exactly');
    expect(html).toContain('Schedule A has at least one name variation');
  });

  it('says "Ready to file" only when every blocking check passes', () => {
    const good = poa({
      entityType: 'Limited Liability Company (LLC)',
      stateOfOrg: 'Delaware',
      grantorAddress: '123 Harbor Way, Long Beach, CA 90802',
      einOrImporterNo: '12-3456789',
      signerName: 'Jane Doe',
      signerTitle: 'Manager',
      signerEmail: 'jane@acme.test',
      signerPhone: '+1 562 555 0142',
      signerEmailVerifiedAt: new Date('2026-01-02'),
    });
    const html = renderAdminPrivacyQueue([{ app: good, events: [], gate: validatePoaForFiling(good) }]);
    expect(html).toContain('Ready to file');
  });

  it('gives the operator view / print / download of the executed PDF and the CBP text', () => {
    const html = renderAdminPrivacyQueue([{ app: gateApp, events: [], gate: validatePoaForFiling(gateApp) }]);
    expect(html).toContain('/api/privacy/application/tok_abc/pdf');
    expect(html).toContain('data-print="/api/privacy/application/tok_abc/pdf"');
    expect(html).toContain('download="poa-tok_abc.pdf"');
    expect(html).toContain('Copy CBP text');
    expect(html).toContain('Record submission');
  });

  it('shows renewal timing — CBP does not auto-renew', () => {
    const html = renderAdminPrivacyQueue([{ app: gateApp, events: [], gate: validatePoaForFiling(gateApp) }]);
    expect(html).toContain('CBP does not auto-renew');
    expect(html).toContain('60–90 days before expiry');
  });
});

describe('buildCbpCertText — carries the full identity set the importer certifies', () => {
  it('includes DBAs, jurisdiction, physical address, partners and the signer', () => {
    const text = buildCbpCertText(
      poa({
        dbaNames: ['Acme Freight'],
        entityType: 'Partnership',
        stateOfOrg: 'Delaware',
        countryOfOrg: 'United States',
        residency: 'resident',
        grantorAddress: '123 Harbor Way, Long Beach, CA 90802',
        einOrImporterNo: '12-3456789',
        iorNumber: 'IOR-99887',
        partnerNames: ['Dana Vine', 'Marcus Harbor'],
        signerName: 'Jane Doe',
        signerTitle: 'General Partner',
      }),
    );
    expect(text).toContain('Acme Freight');
    expect(text).toContain('Delaware, United States');
    expect(text).toContain('IOR-99887');
    expect(text).toContain('Dana Vine; Marcus Harbor');
    expect(text).toContain('Jane Doe, General Partner');
    // The IMPORTER certifies; we transmit. That posture must survive in the text.
    expect(text).toContain('The importer/consignee named above certifies');
    expect(text).toContain('its authorized agent and attorney under 19 CFR 103.31(d)');
    expect(lower(text)).not.toContain('cbp api');
  });
});

describe('renderPrivacyVerified — the email round-trip landing page', () => {
  it('confirms success and links back to the request', () => {
    const html = renderPrivacyVerified({ ok: true, token: 'tok_abc', email: 'jane@acme.test' });
    expect(html).toContain('Email confirmed');
    expect(html).toContain('/privacy/apply/tok_abc');
    expect(lower(html)).toContain('on your behalf');
    expect(lower(html)).not.toContain('cbp api');
  });
  it('degrades honestly on an expired/used link — nothing is lost', () => {
    const html = renderPrivacyVerified({ ok: false, token: null, email: null });
    expect(html).toContain('This link has expired');
    expect(lower(html)).toContain('nothing has been filed');
  });
});

describe('customer account portal — renderPrivacyAccount', () => {
  it('lists each entity with status, signed-POA download, and manage-billing + add-entity', () => {
    const html = renderPrivacyAccount({
      email: 'jane@acme.com',
      identity: identity({ isSubscriber: true, tier: 'professional', status: 'active', currentPeriodEnd: new Date('2027-01-10') }),
      applications: [poa()],
    });
    expect(html).toContain('Acme Imports LLC');
    expect(html).toContain('Download signed POA');
    expect(html).toContain('/api/privacy/application/tok_abc/pdf');
    expect(html).toContain('Manage billing');
    expect(html).toContain('Protect another entity');
    // Account-level plan shown.
    expect(html).toContain('Professional plan');
    // Signed in as the account email.
    expect(html).toContain('jane@acme.com');
    // Honest status vocabulary on the timeline.
    expect(lower(html)).toContain('hidden on quotefleet');
    expect(lower(html)).not.toContain('cbp api');
  });

  it('shows a friendly empty state (no entities) with a "Choose a plan" CTA when unsubscribed', () => {
    const html = renderPrivacyAccount({
      email: 'new@acme.com',
      identity: identity({ email: 'new@acme.com' }),
      applications: [],
    });
    expect(html).toContain('No entities yet');
    // No plan → prompts to choose one rather than a billing-portal button.
    expect(html).toContain('Choose a plan');
    expect(html).not.toContain('Manage billing');
  });

  it('marks a still-draft entity with a "Finish & sign" resume link', () => {
    const html = renderPrivacyAccount({
      email: 'jane@acme.com',
      identity: identity(),
      applications: [poa({ status: 'draft', docSha256: null, cbpConfirmedAt: null, effectiveAt: null, expiresAt: null })],
    });
    expect(html).toContain('Finish &amp; sign');
    expect(html).toContain('/privacy/apply/tok_abc');
    // A draft has no signed PDF to download.
    expect(html).not.toContain('Download signed POA');
  });
});

describe('renderPrivacyLogin — magic-link gate', () => {
  it('reuses the platform magic-link endpoint and redirects back to the account', () => {
    const html = renderPrivacyLogin();
    expect(html).toContain('/api/auth/magic-link/send');
    expect(html).toContain("redirectTo:'/privacy/account'");
    expect(html).toContain('Sign in to your account');
  });
});

describe('onboarding Done-copy branches on paid state (importer-audit C2)', () => {
  it('embeds isSubscriber:false for an unpaid signer', () => {
    const html = renderPrivacyApply({ app: null, prefill: {}, isSubscriber: false });
    expect(html).toContain('"isSubscriber":false');
    // Both honest variants live in the client script; the UNPAID one must be present.
    expect(html).toContain('until then nothing is submitted to CBP');
  });
  it('embeds isSubscriber:true for a paying subscriber', () => {
    const html = renderPrivacyApply({ app: null, prefill: {}, isSubscriber: true });
    expect(html).toContain('"isSubscriber":true');
  });
});

describe('drawn signature is OPTIONAL (importer-audit M1 — a11y)', () => {
  const apply = renderPrivacyApply({ app: null, prefill: {} });
  it('labels the canvas optional and no longer hard-blocks on a missing drawing', () => {
    expect(apply).toContain('(optional)');
    // The old blocker copy must be gone.
    expect(apply).not.toContain('Please draw your signature');
    // Typed name is still required (that IS the ESIGN signature).
    expect(apply).toContain('Type your full name as your signature.');
  });
});
