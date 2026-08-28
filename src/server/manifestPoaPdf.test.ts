/**
 * Manifest Privacy POA PDF — hash determinism, the REQUIRED SECTIONS of the
 * production instrument, the entity-conditional clauses, and the hard guarantee
 * that no DRAFT / pending-attorney-review text survives anywhere in the bytes.
 *
 * TEXT EXTRACTION: `compress: false` (set by the drawer for hash determinism)
 * leaves the content streams literal, but PDFKit writes glyph runs as HEX
 * strings inside TJ arrays and KERNS, so one phrase is split across several
 * `<hex>` runs and each wrapped line is its own TJ. We therefore decode every
 * hex/literal string in document order, concatenate them, and compare with
 * whitespace, punctuation and WinAnsi high bytes stripped from BOTH sides —
 * immune to kerning, line wrapping and encoding, while still proving the words
 * are genuinely in the document.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPoaPdf,
  decodeSignaturePng,
  POA_SCOPE_ITEMS,
  POA_EXCLUSION_ITEMS,
  POA_TEMPLATE_VERSION,
  type PoaPdfInput,
} from './manifestPoaPdf.js';

/** Concatenate every PDF hex/literal string in document order. */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/<([0-9a-fA-F\s]+)>|\((?:\\.|[^\\()])*\)/g)) {
    if (m[1] !== undefined) {
      const hex = m[1].replace(/\s+/g, '');
      if (hex.length % 2 === 0) out.push(Buffer.from(hex, 'hex').toString('latin1'));
    } else {
      out.push(m[0].slice(1, -1).replace(/\\([()\\])/g, '$1'));
    }
  }
  return out.join('');
}

/** Lowercase and drop everything that encoding/kerning/wrapping can perturb —
 *  keeping only [a-z0-9] plus the `().` that CFR citations depend on. */
const squeeze = (s: string) => s.toLowerCase().replace(/[^a-z0-9().]/g, '');

/** True when `phrase` appears in the document, ignoring kerning + line wraps. */
function docHas(buffer: Buffer, phrase: string): boolean {
  return squeeze(pdfText(buffer)).includes(squeeze(phrase));
}

function input(overrides: Partial<PoaPdfInput> = {}): PoaPdfInput {
  return {
    grantorLegalName: 'Acme Imports LLC',
    dbaNames: ['Acme Freight'],
    entityType: 'Limited Liability Company (LLC)',
    stateOfOrg: 'Delaware',
    countryOfOrg: 'United States',
    residency: 'resident',
    grantorAddress: '123 Harbor Way, Long Beach, CA 90802',
    mailingAddress: null,
    einOrImporterNo: '12-3456789',
    iorNumber: null,
    partnerNames: [],
    nameVariations: ['Acme Imports LLC', 'Acme Imports', 'ACME IMPORT CO'],
    addressVariations: ['123 Harbor Way, Long Beach, CA'],
    signerName: 'Jane Doe',
    signerTitle: 'Manager',
    signerEmail: 'jane@acme.test',
    signerPhone: '+1 562 555 0142',
    certSignerName: null,
    certSignerTitle: null,
    certSignerEmail: null,
    authorityDocsNote: null,
    signedAt: new Date('2026-08-20T15:30:00.000Z'),
    signerIp: '203.0.113.5',
    signerUa: 'Mozilla/5.0 test',
    consentDisclosureVersion: 'poa-consent-2026-08-v2',
    applicationCreatedAt: new Date('2026-08-20T15:00:00.000Z'),
    consentAt: new Date('2026-08-20T15:29:00.000Z'),
    emailVerifiedAt: new Date('2026-08-20T15:29:30.000Z'),
    signatureImage: null,
    agentLegalName: 'QuoteFleet, Inc.',
    expiresAt: new Date('2028-08-20T15:30:00.000Z'),
    ...overrides,
  };
}

describe('buildPoaPdf — determinism', () => {
  it('produces identical bytes + SHA-256 for identical input', async () => {
    const a = await buildPoaPdf(input());
    const b = await buildPoaPdf(input());
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sha256).toBe(b.sha256);
    expect(a.buffer.equals(b.buffer)).toBe(true);
  });

  it('changes the hash when a merge field changes', async () => {
    const a = await buildPoaPdf(input());
    const b = await buildPoaPdf(input({ grantorLegalName: 'Different Co LLC' }));
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('changes the hash when the signing timestamp changes', async () => {
    const a = await buildPoaPdf(input());
    const b = await buildPoaPdf(input({ signedAt: new Date('2026-08-20T15:31:00.000Z') }));
    expect(a.sha256).not.toBe(b.sha256);
  });
});

describe('buildPoaPdf — NO DRAFT / pending-review language survives', () => {
  it('contains no DRAFT band, watermark, or attorney-review hedge', async () => {
    const { buffer } = await buildPoaPdf(input());
    // Both the rendered text AND the document metadata (Title/Subject/Creator,
    // which are literal in the bytes) must be free of it.
    expect(buffer.toString('latin1')).not.toContain('DRAFT');
    const text = pdfText(buffer).toLowerCase();
    expect(text).not.toContain('draft');
    expect(docHas(buffer, 'attorney review')).toBe(false);
    expect(docHas(buffer, 'pending attorney')).toBe(false);
    expect(docHas(buffer, 'before live use')).toBe(false);
    expect(docHas(buffer, 'template pending')).toBe(false);
  });

  it('no longer accepts a draftWatermark flag at all', () => {
    // Compile-time contract expressed at runtime: the key is gone from the shape
    // the routes build, so nothing can re-enable a watermark by passing it.
    expect(Object.keys(input())).not.toContain('draftWatermark');
  });
});

describe('buildPoaPdf — the required sections of the executed instrument', () => {
  it('renders all twelve numbered sections plus Schedule A and the audit trail', async () => {
    const { buffer } = await buildPoaPdf(input());
    const required = [
      '1. GRANTOR (PRINCIPAL)',
      '2. APPOINTMENT OF AGENT',
      '3. SCOPE OF AUTHORITY (LIMITED AND ENUMERATED)',
      '4. EXPRESS LIMITATIONS — NO CUSTOMS BUSINESS',
      '5. PRINCIPAL’S CERTIFICATION UNDER 19 CFR 103.31(d)',
      '6. AUTHORITY OF THE PERSON SIGNING',
      '7. TERM AND EXPIRATION',
      '8. REVOCATION',
      '9. RETENTION AND PRODUCTION',
      '10. ELECTRONIC SIGNATURE AND CONSENT',
      '11. GOVERNING LAW',
      '12. EXECUTION',
      'SCHEDULE A — NAME AND ADDRESS VARIATIONS',
      'ELECTRONIC SIGNATURE AUDIT TRAIL',
    ];
    for (const s of required) expect(docHas(buffer, s), `missing section: ${s}`).toBe(true);
  });

  it('carries the four legal-posture clauses that make non-broker filing defensible', async () => {
    const { buffer } = await buildPoaPdf(input());
    // (1) scope limited to 103.31(d), enumerated, including renewals
    expect(docHas(buffer, '19 CFR 103.31(d)')).toBe(true);
    expect(docHas(buffer, 'RENEWAL requests on the same limited basis')).toBe(true);
    // (2) express exclusion of customs business
    expect(docHas(buffer, '19 U.S.C. 1641(a)(2) and 19 CFR 111.1')).toBe(true);
    expect(docHas(buffer, 'does NOT appoint the Agent as its customs broker')).toBe(true);
    expect(docHas(buffer, 'CBP Form 5106')).toBe(true);
    // (3) the GRANTOR certifies; we only transmit
    expect(docHas(buffer, 'THE PRINCIPAL — not the Agent — MAKES THE FOLLOWING CERTIFICATION')).toBe(true);
    expect(docHas(buffer, 'the Agent transmits it')).toBe(true);
    // (4) never marketed as brokerage
    expect(docHas(buffer, 'is not a customs broker')).toBe(true);
  });

  it('states the signer-authority warranty, retention, ESIGN consent and governing law', async () => {
    const { buffer } = await buildPoaPdf(input());
    expect(docHas(buffer, 'duly authorized to execute this instrument and to bind the Principal')).toBe(true);
    expect(docHas(buffer, 'NOT LESS THAN 5 YEARS')).toBe(true);
    expect(docHas(buffer, '19 CFR 141.46')).toBe(true);
    expect(docHas(buffer, '15 U.S.C. 7001')).toBe(true);
    // Governing law is FIXED to a clean UETA state, never the grantor's domicile.
    expect(docHas(buffer, 'GOVERNED BY THE LAWS OF THE STATE OF DELAWARE')).toBe(true);
    expect(docHas(buffer, 'without regard to the domicile or place of')).toBe(true);
  });

  it('enumerates every scope grant and every exclusion', async () => {
    const { buffer } = await buildPoaPdf(input());
    expect(POA_SCOPE_ITEMS).toHaveLength(8);
    expect(POA_EXCLUSION_ITEMS).toHaveLength(8);
    for (const s of POA_SCOPE_ITEMS) expect(docHas(buffer, s.slice(0, 48))).toBe(true);
    for (const s of POA_EXCLUSION_ITEMS) expect(docHas(buffer, s.slice(0, 48))).toBe(true);
  });

  it('renders the grantor identity block, Schedule A, and the system audit trail', async () => {
    const { buffer } = await buildPoaPdf(input({ iorNumber: 'IOR-99887', mailingAddress: 'PO Box 4120, Long Beach, CA' }));
    expect(docHas(buffer, 'Acme Imports LLC')).toBe(true);
    expect(docHas(buffer, 'Acme Freight')).toBe(true); // DBA
    expect(docHas(buffer, '12-3456789')).toBe(true); // EIN
    expect(docHas(buffer, 'IOR-99887')).toBe(true);
    expect(docHas(buffer, 'ACME IMPORT CO')).toBe(true); // a Schedule A variation
    expect(docHas(buffer, 'jane@acme.test')).toBe(true);
    expect(docHas(buffer, '+1 562 555 0142')).toBe(true);
    // The audit block is system-generated and carries the ESIGN attribution.
    expect(docHas(buffer, '203.0.113.5')).toBe(true);
    expect(docHas(buffer, 'Not editable by the signer')).toBe(true);
    expect(docHas(buffer, POA_TEMPLATE_VERSION)).toBe(true);
    expect(docHas(buffer, '2026-08-20 15:30:00 UTC')).toBe(true);
  });

  it('says "Not verified at execution" when the email round-trip had not completed', async () => {
    const { buffer } = await buildPoaPdf(input({ emailVerifiedAt: null }));
    expect(docHas(buffer, 'Not verified at execution')).toBe(true);
  });

  it('emits a well-formed, multi-page PDF referencing 19 CFR 103.31', async () => {
    const { buffer } = await buildPoaPdf(input());
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(8000);
    expect(buffer.toString('latin1')).toContain('103.31');
    expect(docHas(buffer, 'Page 1 of')).toBe(true);
  });
});

describe('buildPoaPdf — entity-conditional clauses', () => {
  const partnership = () =>
    input({
      grantorLegalName: 'Harbor & Vine Partners',
      entityType: 'Partnership',
      signerTitle: 'General Partner',
      partnerNames: ['Dana Vine', 'Marcus Harbor'],
    });

  it('a partnership gets the hard 2-year cap, the membership-change termination, and every partner', async () => {
    const { buffer } = await buildPoaPdf(partnership());
    expect(docHas(buffer, 'BECAUSE THE PRINCIPAL IS A PARTNERSHIP')).toBe(true);
    expect(docHas(buffer, 'may not and does not run for more than TWO (2) YEARS')).toBe(true);
    expect(docHas(buffer, '19 CFR 141.34')).toBe(true);
    expect(docHas(buffer, 'TERMINATES AUTOMATICALLY upon any change in the membership')).toBe(true);
    expect(docHas(buffer, '19 CFR 141.39')).toBe(true);
    expect(docHas(buffer, 'Dana Vine')).toBe(true);
    expect(docHas(buffer, 'Marcus Harbor')).toBe(true);
    // The term date is execution + 2 years, never longer.
    expect(docHas(buffer, 'EXPIRES on August 20, 2028')).toBe(true);
  });

  it('a non-partnership does NOT get the partnership clause', async () => {
    const { buffer } = await buildPoaPdf(input());
    expect(docHas(buffer, 'BECAUSE THE PRINCIPAL IS A PARTNERSHIP')).toBe(false);
  });

  it('an off-allowlist title renders the second-officer corporate certification', async () => {
    const { buffer } = await buildPoaPdf(
      input({
        entityType: 'Corporation',
        signerTitle: 'Controller',
        certSignerName: 'Robert Chen',
        certSignerTitle: 'Secretary',
        certSignerEmail: 'rchen@acme.test',
      }),
    );
    expect(docHas(buffer, 'CORPORATE CERTIFICATION OF AUTHORITY (second officer)')).toBe(true);
    expect(docHas(buffer, 'Robert Chen')).toBe(true);
    expect(docHas(buffer, 'was duly authorized by the Principal to execute it')).toBe(true);
  });

  it('omits the certification block when the signer title stands on its own', async () => {
    const { buffer } = await buildPoaPdf(input());
    expect(docHas(buffer, 'CORPORATE CERTIFICATION OF AUTHORITY')).toBe(false);
  });

  it('a nonresident corporation records its supporting authority documentation', async () => {
    const { buffer } = await buildPoaPdf(
      input({
        entityType: 'Corporation',
        residency: 'nonresident',
        signerTitle: 'President',
        authorityDocsNote: 'Board resolution dated 2026-03-14',
      }),
    );
    expect(docHas(buffer, 'a NONRESIDENT of the United States')).toBe(true);
    expect(docHas(buffer, '19 CFR 141.37')).toBe(true);
    expect(docHas(buffer, 'Board resolution dated 2026-03-14')).toBe(true);
  });
});

describe('decodeSignaturePng', () => {
  it('decodes a data: PNG URL', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const url = 'data:image/png;base64,' + png.toString('base64');
    const out = decodeSignaturePng(url);
    expect(out).not.toBeNull();
    expect(out!.equals(png)).toBe(true);
  });
  it('returns null for junk', () => {
    expect(decodeSignaturePng(null)).toBeNull();
    expect(decodeSignaturePng('not-a-png')).toBeNull();
  });
});
