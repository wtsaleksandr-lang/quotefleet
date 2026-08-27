/**
 * Manifest Privacy POA PDF — hash determinism + merge-field render.
 */
import { describe, it, expect } from 'vitest';
import { buildPoaPdf, decodeSignaturePng, type PoaPdfInput } from './manifestPoaPdf.js';

function input(overrides: Partial<PoaPdfInput> = {}): PoaPdfInput {
  return {
    grantorLegalName: 'Acme Imports LLC',
    entityType: 'Limited Liability Company (LLC)',
    stateOfOrg: 'Delaware',
    grantorAddress: '123 Harbor Way, Long Beach, CA 90802',
    einOrImporterNo: '12-3456789',
    nameVariations: ['Acme Imports LLC', 'Acme Imports', 'ACME IMPORT CO'],
    addressVariations: ['123 Harbor Way, Long Beach, CA'],
    signerName: 'Jane Doe',
    signerTitle: 'CFO',
    signerEmail: 'jane@acme.test',
    signedAt: new Date('2026-08-20T15:30:00.000Z'),
    signerIp: '203.0.113.5',
    signerUa: 'Mozilla/5.0 test',
    consentDisclosureVersion: 'poa-consent-2026-08-v1',
    signatureImage: null,
    agentLegalName: 'QuoteFleet, Inc.',
    expiresAt: new Date('2028-08-20T15:30:00.000Z'),
    draftWatermark: true,
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

describe('buildPoaPdf — produces a valid document whose bytes track the merge fields', () => {
  it('emits a well-formed, non-trivial PDF referencing 19 CFR 103.31', async () => {
    const { buffer } = await buildPoaPdf(input());
    // Valid PDF header + reasonable size (full multi-paragraph POA).
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(3000);
    // The 19 CFR reference is carried in the document metadata (Subject),
    // written as literal ASCII — so it IS searchable in the bytes. (The '(d)'
    // parens are PDF-escaped inside the string, so we match the digits only.)
    expect(buffer.toString('latin1')).toContain('103.31');
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
