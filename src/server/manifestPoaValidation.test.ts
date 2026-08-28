/**
 * Manifest Privacy — POA validation rules.
 *
 * These are the rules that keep a filing out of CBP's documented rejection
 * causes, so each test names the cause it defends against.
 */
import { describe, it, expect } from 'vitest';
import {
  POA_GOVERNING_LAW_STATE,
  POA_RETENTION_YEARS,
  PARTNERSHIP_MAX_TERM_YEARS,
  SIGNER_TITLE_ALLOWLIST,
  entityClass,
  normalizeTitle,
  signerTitleStatus,
  requiresCorporateCertification,
  allowedTitlesFor,
  isPoBoxAddress,
  poaTermYears,
  poaTermExpiresAt,
  poaRetainUntil,
  requiresPartnerNames,
  requiresAuthorityDocs,
  isCorporateEmail,
  requiresCorporateEmail,
  looksLikeEin,
  renewalPhase,
  validatePoaForFiling,
  validateBeforeSigning,
  type PoaValidatable,
} from './manifestPoaValidation.js';

const filable = (over: Partial<PoaValidatable> = {}): PoaValidatable => ({
  grantorLegalName: 'Acme Imports LLC',
  dbaNames: ['Acme Freight'],
  entityType: 'Limited Liability Company (LLC)',
  stateOfOrg: 'Delaware',
  countryOfOrg: 'United States',
  residency: 'resident',
  grantorAddress: '123 Harbor Way, Long Beach, CA 90802',
  einOrImporterNo: '12-3456789',
  partnerNames: [],
  nameVariations: ['Acme Imports LLC', 'Acme Imports'],
  addressVariations: ['123 Harbor Way'],
  signerName: 'Jane Doe',
  signerTitle: 'Manager',
  signerEmail: 'jane@acme.test',
  signerPhone: '+1 562 555 0142',
  signerEmailVerifiedAt: new Date('2026-08-20T15:29:00.000Z'),
  signedAt: new Date('2026-08-20T15:30:00.000Z'),
  docSha256: 'a'.repeat(64),
  ...over,
});

describe('entityClass', () => {
  it('normalizes the onboarding <select> values', () => {
    expect(entityClass('Limited Liability Company (LLC)')).toBe('llc');
    expect(entityClass('Corporation')).toBe('corporation');
    expect(entityClass('S-Corporation')).toBe('corporation');
    expect(entityClass('Partnership')).toBe('partnership');
    expect(entityClass('Sole Proprietorship')).toBe('sole_proprietorship');
    expect(entityClass('Individual')).toBe('individual');
    expect(entityClass('Other')).toBe('other');
    expect(entityClass('')).toBe('other');
    expect(entityClass(null)).toBe('other');
  });
});

describe('signer title allowlist (rejection cause E1 — signer lacked authority)', () => {
  it('accepts the classic officer titles per entity form', () => {
    expect(signerTitleStatus('Corporation', 'President')).toBe('allowed');
    expect(signerTitleStatus('Corporation', 'Vice President')).toBe('allowed');
    expect(signerTitleStatus('Corporation', 'Secretary')).toBe('allowed');
    expect(signerTitleStatus('Corporation', 'Treasurer')).toBe('allowed');
    expect(signerTitleStatus('Limited Liability Company (LLC)', 'Managing Member')).toBe('allowed');
    expect(signerTitleStatus('Limited Liability Company (LLC)', 'Manager')).toBe('allowed');
    expect(signerTitleStatus('Partnership', 'General Partner')).toBe('allowed');
    expect(signerTitleStatus('Sole Proprietorship', 'Owner')).toBe('allowed');
    expect(signerTitleStatus('Individual', 'Self')).toBe('allowed');
  });

  it('normalizes abbreviations and rank qualifiers onto the same office', () => {
    expect(normalizeTitle('V.P.')).toBe('vice president');
    expect(normalizeTitle('EVP')).toBe('vice president');
    expect(normalizeTitle('Executive Vice President')).toBe('vice president');
    expect(normalizeTitle('Asst. Secretary')).toBe('secretary');
    expect(normalizeTitle('G.P.')).toBe('general partner');
    expect(signerTitleStatus('Corporation', 'SVP')).toBe('allowed');
    expect(signerTitleStatus('Corporation', 'Pres.')).toBe('allowed');
  });

  it('routes the commonly-rejected titles to the corporate certification, never a hard block', () => {
    for (const t of ['Director', 'General Manager', 'Controller', 'CEO', 'CFO', 'Logistics Coordinator']) {
      expect(signerTitleStatus('Corporation', t), t).toBe('needs_certification');
      expect(requiresCorporateCertification('Corporation', t), t).toBe(true);
    }
  });

  it('an unrecognized entity form always needs the certification (nothing is on its list)', () => {
    expect(allowedTitlesFor('Other')).toEqual([]);
    expect(signerTitleStatus('Other', 'Owner')).toBe('needs_certification');
  });

  it('reports a missing title distinctly from an off-list one', () => {
    expect(signerTitleStatus('Corporation', '')).toBe('missing');
    expect(signerTitleStatus('Corporation', null)).toBe('missing');
  });

  it('exposes a narrow allowlist per entity form', () => {
    expect(SIGNER_TITLE_ALLOWLIST.corporation).toEqual(['president', 'vice president', 'secretary', 'treasurer']);
    expect(SIGNER_TITLE_ALLOWLIST.partnership).toEqual(['general partner']);
  });
});

describe('PO box / mail-drop rejection (rejection cause E6)', () => {
  it('flags every PO-box spelling and the PMB mail drop', () => {
    for (const a of [
      'PO Box 4120, Long Beach, CA 90802',
      'P.O. Box 12',
      'p o box 7',
      'Post Office Box 991, Newark NJ',
      'Postal Box 55',
      'Post Box 55',
      'PO Bin 12',
      'Suite 4, PMB 118, 900 Main St',
      '1200 Ocean Ave\nBox 44',
    ]) {
      expect(isPoBoxAddress(a), a).toBe(true);
    }
  });

  it('does NOT flag ordinary street addresses that merely contain those letters', () => {
    for (const a of [
      '123 Harbor Way, Long Beach, CA 90802',
      '55 Boxwood Lane, Trenton NJ',
      '9 Post Road, Greenwich CT',
      '400 Boxer Street, Unit 12',
      '1 Poblano Court',
      '',
    ]) {
      expect(isPoBoxAddress(a), a).toBe(false);
    }
  });
});

describe('term: partnership 2-year hard cap (19 CFR 141.34 — rejection cause E8)', () => {
  it('caps a partnership at 2 years and cannot be raised by the caller', () => {
    expect(poaTermYears('Partnership')).toBe(PARTNERSHIP_MAX_TERM_YEARS);
    expect(poaTermYears('Partnership', 5)).toBe(2);
    expect(poaTermYears('Partnership', 99)).toBe(2);
  });

  it('caps every other entity form at 2 years as well (matching the CBP protection term)', () => {
    expect(poaTermYears('Corporation')).toBe(2);
    expect(poaTermYears('Corporation', 10)).toBe(2);
    expect(poaTermYears('Limited Liability Company (LLC)', 1)).toBe(1);
  });

  it('computes the term expiry from execution, in UTC, without leap drift', () => {
    const signed = new Date('2026-08-20T15:30:00.000Z');
    expect(poaTermExpiresAt('Partnership', signed).toISOString()).toBe('2028-08-20T15:30:00.000Z');
    expect(poaTermExpiresAt('Corporation', signed).toISOString()).toBe('2028-08-20T15:30:00.000Z');
    // A partnership can never be given a longer term than a corporation here.
    expect(poaTermExpiresAt('Partnership', signed, 10).getTime()).toBe(
      poaTermExpiresAt('Partnership', signed).getTime(),
    );
  });

  it('requires all partner names only for a partnership (19 CFR 141.39)', () => {
    expect(requiresPartnerNames('Partnership')).toBe(true);
    expect(requiresPartnerNames('Corporation')).toBe(false);
  });
});

describe('nonresident corporation authority docs (19 CFR 141.37 — rejection cause E9)', () => {
  it('is required only for a nonresident CORPORATION', () => {
    expect(requiresAuthorityDocs('Corporation', 'nonresident')).toBe(true);
    expect(requiresAuthorityDocs('Corporation', 'resident')).toBe(false);
    expect(requiresAuthorityDocs('Limited Liability Company (LLC)', 'nonresident')).toBe(false);
  });
});

describe('retention (ESIGN 15 U.S.C. 7001(d))', () => {
  it('is at least five years past the anchor date', () => {
    expect(POA_RETENTION_YEARS).toBeGreaterThanOrEqual(5);
    expect(poaRetainUntil(new Date('2026-08-20T15:30:00.000Z')).toISOString()).toBe(
      '2031-08-20T15:30:00.000Z',
    );
  });
});

describe('governing law is a fixed clean-UETA state, never grantor domicile (E10)', () => {
  it('is Delaware and is not derived from any input', () => {
    expect(POA_GOVERNING_LAW_STATE).toBe('Delaware');
    expect(['New York', 'Minnesota']).not.toContain(POA_GOVERNING_LAW_STATE);
  });
});

describe('corporate signer email', () => {
  it('rejects consumer mailboxes for a company but not for a sole proprietor', () => {
    expect(isCorporateEmail('jane@gmail.com')).toBe(false);
    expect(isCorporateEmail('jane@acme.test')).toBe(true);
    expect(requiresCorporateEmail('Corporation')).toBe(true);
    expect(requiresCorporateEmail('Limited Liability Company (LLC)')).toBe(true);
    expect(requiresCorporateEmail('Sole Proprietorship')).toBe(false);
    expect(requiresCorporateEmail('Individual')).toBe(false);
  });
});

describe('looksLikeEin', () => {
  it('recognizes the 9-digit EIN shape, formatted or bare', () => {
    expect(looksLikeEin('12-3456789')).toBe(true);
    expect(looksLikeEin('123456789')).toBe(true);
    expect(looksLikeEin('12-345678')).toBe(false);
    expect(looksLikeEin('')).toBe(false);
  });
});

describe('renewalPhase — CBP does NOT auto-renew (rejection cause E14)', () => {
  const now = new Date('2026-08-20T00:00:00.000Z');
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

  it('walks tracking → remind (18 months in) → file window (60–90d) → overdue → expired', () => {
    expect(renewalPhase(inDays(400), now).phase).toBe('tracking');
    expect(renewalPhase(inDays(170), now).phase).toBe('remind');
    expect(renewalPhase(inDays(75), now).phase).toBe('file_now');
    expect(renewalPhase(inDays(30), now).phase).toBe('overdue');
    expect(renewalPhase(inDays(-5), now).phase).toBe('expired');
    expect(renewalPhase(null, now).phase).toBe('no_expiry');
  });
});

describe('validateBeforeSigning — the execution gate', () => {
  it('passes a complete application', () => {
    expect(validateBeforeSigning(filable())).toBeNull();
  });

  it('blocks a PO-box physical address', () => {
    const err = validateBeforeSigning(filable({ grantorAddress: 'PO Box 4120, Long Beach, CA' }));
    expect(err).toMatch(/physical street address/i);
  });

  it('blocks an empty Schedule A (CBP suppresses only exact matches — E3)', () => {
    expect(validateBeforeSigning(filable({ nameVariations: [] }))).toMatch(/at least one name variation/i);
  });

  it('blocks a partnership with no partners named', () => {
    const err = validateBeforeSigning(
      filable({ entityType: 'Partnership', signerTitle: 'General Partner', partnerNames: [] }),
    );
    expect(err).toMatch(/name every partner/i);
  });

  it('blocks an off-allowlist title UNLESS the corporate certification is completed', () => {
    const off = filable({ entityType: 'Corporation', signerTitle: 'Controller' });
    expect(validateBeforeSigning(off)).toMatch(/second officer/i);
    expect(
      validateBeforeSigning({ ...off, certSignerName: 'Robert Chen', certSignerTitle: 'Secretary' }),
    ).toBeNull();
  });

  it('blocks the missing required identity fields one by one', () => {
    expect(validateBeforeSigning(filable({ grantorLegalName: '' }))).toMatch(/legal business name/i);
    expect(validateBeforeSigning(filable({ entityType: '' }))).toMatch(/entity type/i);
    expect(validateBeforeSigning(filable({ stateOfOrg: '', countryOfOrg: '' }))).toMatch(/organized/i);
    expect(validateBeforeSigning(filable({ einOrImporterNo: '' }))).toMatch(/EIN/i);
    expect(validateBeforeSigning(filable({ signerTitle: '' }))).toMatch(/title/i);
    expect(validateBeforeSigning(filable({ signerPhone: '' }))).toMatch(/phone/i);
  });

  it('blocks a consumer mailbox for a company', () => {
    expect(validateBeforeSigning(filable({ signerEmail: 'jane@gmail.com' }))).toMatch(/business email/i);
    // …but a sole proprietor may legitimately use one.
    expect(
      validateBeforeSigning(
        filable({ entityType: 'Sole Proprietorship', signerTitle: 'Owner', signerEmail: 'jane@gmail.com' }),
      ),
    ).toBeNull();
  });
});

describe('validatePoaForFiling — the pre-filing gate', () => {
  it('passes every blocking check for a complete, executed, verified application', () => {
    const gate = validatePoaForFiling(filable());
    expect(gate.ok, JSON.stringify(gate.failures)).toBe(true);
    expect(gate.total).toBeGreaterThanOrEqual(12);
  });

  it('always surfaces the operator-judgement ACE name match as a non-blocking check', () => {
    const gate = validatePoaForFiling(filable());
    const ace = gate.checks.find((c) => c.key === 'ace_name_match');
    expect(ace).toBeDefined();
    expect(ace!.blocking).toBe(false);
    expect(ace!.ok).toBe(false); // never auto-claimed — a human confirms it
    expect(gate.ok).toBe(true); // and it therefore cannot block the filing
  });

  it('blocks an unverified signer email (the round-trip is a filing gate)', () => {
    const gate = validatePoaForFiling(filable({ signerEmailVerifiedAt: null }));
    expect(gate.ok).toBe(false);
    expect(gate.failures.map((f) => f.key)).toContain('email_verified');
  });

  it('blocks a PO box, an empty Schedule A, and a partnership missing its partners', () => {
    expect(validatePoaForFiling(filable({ grantorAddress: 'PO Box 9' })).failures.map((f) => f.key)).toContain(
      'physical_address',
    );
    expect(validatePoaForFiling(filable({ nameVariations: [] })).failures.map((f) => f.key)).toContain(
      'schedule_a',
    );
    const partnership = validatePoaForFiling(
      filable({ entityType: 'Partnership', signerTitle: 'General Partner', partnerNames: [] }),
    );
    expect(partnership.failures.map((f) => f.key)).toContain('partners');
  });

  it('adds the nonresident-corporation authority-docs check only when it applies', () => {
    const resident = validatePoaForFiling(filable({ entityType: 'Corporation', signerTitle: 'President' }));
    expect(resident.checks.map((c) => c.key)).not.toContain('authority_docs');
    const nonres = validatePoaForFiling(
      filable({ entityType: 'Corporation', signerTitle: 'President', residency: 'nonresident' }),
    );
    expect(nonres.checks.map((c) => c.key)).toContain('authority_docs');
    expect(nonres.failures.map((f) => f.key)).toContain('authority_docs');
    expect(
      validatePoaForFiling(
        filable({
          entityType: 'Corporation',
          signerTitle: 'President',
          residency: 'nonresident',
          authorityDocsNote: 'Board resolution 2026-03-14',
        }),
      ).ok,
    ).toBe(true);
  });

  it('an off-list title fails the title check but passes authority once certified', () => {
    const off = validatePoaForFiling(filable({ entityType: 'Corporation', signerTitle: 'Controller' }));
    expect(off.checks.find((c) => c.key === 'signer_title')!.ok).toBe(false);
    expect(off.failures.map((f) => f.key)).toContain('signer_authority');
    const certified = validatePoaForFiling(
      filable({
        entityType: 'Corporation',
        signerTitle: 'Controller',
        certSignerName: 'Robert Chen',
        certSignerTitle: 'Secretary',
      }),
    );
    expect(certified.failures.map((f) => f.key)).not.toContain('signer_authority');
    expect(certified.ok).toBe(true);
  });

  it('blocks an application that was never executed', () => {
    const gate = validatePoaForFiling(filable({ signedAt: null, docSha256: null }));
    expect(gate.failures.map((f) => f.key)).toContain('executed');
  });
});
