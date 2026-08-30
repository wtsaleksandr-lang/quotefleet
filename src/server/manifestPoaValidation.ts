/**
 * Manifest Privacy — POA validation rules (the "can this actually be filed?" brain).
 *
 * PURE + dependency-free so it can be shared by the onboarding routes (block a
 * bad execution before it is signed), the PDF drawer (term/governing-law), and
 * the admin filing queue (render the pre-filing gate as a checklist). No DB, no
 * network, no Express — every function here is unit-testable in isolation.
 *
 * WHY EACH RULE EXISTS (each maps to a CBP rejection cause we design against):
 *   • Signer title allowlist — the #1 cited rejection is "signer lacked authority
 *     to bind". CBP accepts the classic officer titles per entity form; anything
 *     else (Director, General Manager, Controller, CEO/CFO, an employee) is not
 *     REFUSED here — it routes to the optional corporate-certification block
 *     where a second officer attests the signer's authority. Strictness here only
 *     ever ADDS evidence; it never blocks a customer.
 *   • PO-box rejection — 19 CFR requires a physical address; a PO box (or a PMB
 *     mail-drop) is a documented rejection cause.
 *   • Partnership 2-year cap — 19 CFR 141.34: a POA from a partnership may not
 *     run more than two years from its date, and it terminates on a change in
 *     partnership membership. All partners must be named (19 CFR 141.39).
 *   • Nonresident corporation — 19 CFR 141.37 lets CBP require evidence of the
 *     signer's authority; we prompt for that documentation up front.
 *   • Schedule A non-empty — CBP suppresses only EXACT matches, so a filing with
 *     no name variations silently fails to protect the importer.
 *
 * GOVERNING LAW is fixed (not the grantor's domicile) because a handful of
 * states restrict electronic signatures on agency instruments; pinning a clean
 * UETA state inside the signed text is what keeps the e-signature enforceable.
 */

/** The UETA state whose law governs the executed instrument. Fixed on purpose —
 *  see the file header. Never defaults to the grantor's domicile. */
export const POA_GOVERNING_LAW_STATE = 'Delaware';

/** Minimum retention for an executed POA + its audit trail, in years. ESIGN
 *  (15 U.S.C. §7001(d)) requires an accurate, reproducible record; CBP may
 *  demand production of the POA (19 CFR 141.46) long after the filing. Nothing
 *  in this codebase may purge a POA application, its audit events, or its
 *  signature material before this horizon. */
export const POA_RETENTION_YEARS = 5;

/** Default POA term. Matches the CBP confidentiality term (2 years from CBP
 *  receipt) so one signature covers exactly one protection cycle. */
export const POA_DEFAULT_TERM_YEARS = 2;

/** HARD cap for a partnership grantor — 19 CFR 141.34. Not configurable. */
export const PARTNERSHIP_MAX_TERM_YEARS = 2;

/** Ceiling for every other entity form. */
export const POA_MAX_TERM_YEARS = 2;

/** Normalized entity forms. The onboarding <select> maps onto these. */
export type PoaEntityClass =
  | 'individual'
  | 'sole_proprietorship'
  | 'partnership'
  | 'corporation'
  | 'llc'
  | 'other';

/** 'resident' | 'nonresident' — 19 CFR 141.37 turns on this for corporations. */
export type PoaResidency = 'resident' | 'nonresident';

/** Normalize the free-text/select entity type onto a class. Unknown → 'other'
 *  (which routes the signer to the corporate-certification block). */
export function entityClass(entityType: string | null | undefined): PoaEntityClass {
  const s = String(entityType ?? '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'other';
  if (/\bllc\b|limited liability company|limited liability co\b/.test(s)) return 'llc';
  if (/\bsole proprietor|sole prop\b|\bdba\b/.test(s)) return 'sole_proprietorship';
  if (/\bpartnership\b|\bllp\b|\blp\b|\bgeneral partnership\b/.test(s)) return 'partnership';
  if (/\bcorporation\b|\bcorp\b|\binc\b|\bs corporation\b|\bc corporation\b/.test(s)) return 'corporation';
  if (/\bindividual\b|\bnatural person\b|\bself\b/.test(s)) return 'individual';
  return 'other';
}

/**
 * The accepted signer titles per entity form. Deliberately NARROW: an off-list
 * title is never refused, it just requires the corporate certification. See the
 * file header.
 */
export const SIGNER_TITLE_ALLOWLIST: Readonly<Record<PoaEntityClass, readonly string[]>> = {
  corporation: ['president', 'vice president', 'secretary', 'treasurer'],
  llc: ['member', 'managing member', 'manager'],
  partnership: ['general partner'],
  sole_proprietorship: ['owner', 'sole proprietor', 'proprietor'],
  individual: ['self', 'individual', 'owner'],
  other: [],
};

/** Human-facing list of the titles CBP accepts for this entity form. */
export function allowedTitlesFor(entityType: string | null | undefined): readonly string[] {
  return SIGNER_TITLE_ALLOWLIST[entityClass(entityType)];
}

/** Canonicalize a typed title: lowercase, strip punctuation, expand the handful
 *  of unambiguous abbreviations, drop rank qualifiers that do not change the
 *  office (Executive/Senior/Assistant Vice President is still a Vice President). */
export function normalizeTitle(title: string | null | undefined): string {
  let s = String(title ?? '')
    .toLowerCase()
    .replace(/[.,/&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  s = s
    .replace(/\bv\s?p\b/g, 'vice president')
    .replace(/\bevp\b|\bsvp\b/g, 'vice president')
    .replace(/\bpres\b/g, 'president')
    .replace(/\bsec\b|\bsecy\b/g, 'secretary')
    .replace(/\btreas\b/g, 'treasurer')
    .replace(/\bg\s?p\b/g, 'general partner')
    .replace(/\bmng\b|\bmgng\b/g, 'managing');
  // Rank qualifiers in front of a real office.
  s = s.replace(/^(executive|senior|sr|exec|assistant|asst|deputy|first|1st)\s+/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Outcome of the signer-title check. `needs_certification` is NOT a failure —
 *  it turns on the corporate-certification block. */
export type SignerTitleStatus = 'missing' | 'allowed' | 'needs_certification';

export function signerTitleStatus(
  entityType: string | null | undefined,
  title: string | null | undefined,
): SignerTitleStatus {
  const t = normalizeTitle(title);
  if (!t) return 'missing';
  return allowedTitlesFor(entityType).includes(t) ? 'allowed' : 'needs_certification';
}

/** True when an off-allowlist title means the second-officer certification block
 *  must be completed before we will file. */
export function requiresCorporateCertification(
  entityType: string | null | undefined,
  title: string | null | undefined,
): boolean {
  return signerTitleStatus(entityType, title) !== 'allowed';
}

/**
 * PO box / mail-drop detector. CBP requires a PHYSICAL address on the POA; a PO
 * box, postal box, or PMB (private mailbox at a commercial mail-receiving
 * agency) is a documented rejection cause.
 *
 * Anchored on word boundaries so ordinary street names ("Boxwood Lane",
 * "Post Road", "Boxer Street") are NOT false positives.
 */
export function isPoBoxAddress(address: string | null | undefined): boolean {
  const s = String(address ?? '').trim();
  if (!s) return false;
  const patterns: RegExp[] = [
    /\bp[.\s]*o[.\s]*box\b/i, //  PO Box / P.O. Box / P O Box
    /\bp[.\s]*o[.\s]*b\b/i, //    POB / P.O.B.
    /\bpost\s+office\s+box\b/i,
    /\bpostal\s+box\b/i,
    /\bpost\s+box\b/i,
    /\bpo\s+bin\b/i,
    /\bpmb\b\s*#?\s*\d/i, //      PMB 123 (mail-drop)
    /(^|[\n,;]\s*)box\s+(no\.?\s*)?#?\s*\d/i, // a line that IS just "Box 123"
  ];
  return patterns.some((re) => re.test(s));
}

/** The POA term in years for this grantor. Partnerships are hard-capped at 2
 *  (19 CFR 141.34) and the cap cannot be raised by a caller. */
export function poaTermYears(entityType: string | null | undefined, requestedYears?: number | null): number {
  const cap =
    entityClass(entityType) === 'partnership' ? PARTNERSHIP_MAX_TERM_YEARS : POA_MAX_TERM_YEARS;
  const want =
    typeof requestedYears === 'number' && Number.isFinite(requestedYears) && requestedYears > 0
      ? Math.floor(requestedYears)
      : POA_DEFAULT_TERM_YEARS;
  return Math.max(1, Math.min(want, cap));
}

/** Add whole years in UTC without drifting on leap days. */
function addYearsUtc(from: Date, years: number): Date {
  const d = new Date(from.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/** When the POA instrument itself expires: execution + the (capped) term. */
export function poaTermExpiresAt(
  entityType: string | null | undefined,
  signedAt: Date,
  requestedYears?: number | null,
): Date {
  return addYearsUtc(signedAt, poaTermYears(entityType, requestedYears));
}

/** The earliest date this record and its audit trail may be destroyed. */
export function poaRetainUntil(from: Date): Date {
  return addYearsUtc(from, POA_RETENTION_YEARS);
}

/** Partnerships must name every partner (19 CFR 141.39). */
export function requiresPartnerNames(entityType: string | null | undefined): boolean {
  return entityClass(entityType) === 'partnership';
}

/** A nonresident corporation may be asked for evidence of the signer's authority
 *  (19 CFR 141.37) — we collect a note/reference for it up front. */
export function requiresAuthorityDocs(
  entityType: string | null | undefined,
  residency: string | null | undefined,
): boolean {
  return entityClass(entityType) === 'corporation' && String(residency ?? '') === 'nonresident';
}

/**
 * Consumer/free mailbox providers. A POA signed from a free mailbox is weak
 * evidence that the signer speaks for the entity, so for a corporation, LLC, or
 * partnership we require a corporate-domain business email AND an email
 * round-trip. A sole proprietor or individual legitimately has no corporate
 * domain, so the requirement does not apply to them.
 */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'qq.com',
  '163.com',
  '126.com',
  'comcast.net',
  'verizon.net',
  'sbcglobal.net',
  'att.net',
  'cox.net',
  'bellsouth.net',
]);

export function emailDomain(email: string | null | undefined): string {
  const s = String(email ?? '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  return at > 0 ? s.slice(at + 1) : '';
}

/** True when the address is on a domain that is not a consumer mailbox provider. */
export function isCorporateEmail(email: string | null | undefined): boolean {
  const d = emailDomain(email);
  return d.length > 3 && d.includes('.') && !FREEMAIL_DOMAINS.has(d);
}

/** Entity forms for which a corporate-domain signer email is required. */
export function requiresCorporateEmail(entityType: string | null | undefined): boolean {
  const cls = entityClass(entityType);
  return cls === 'corporation' || cls === 'llc' || cls === 'partnership';
}

/** CBP's renewal reality: no auto-renewal. Remind at 18 months into the 2-year
 *  term, and file the replacement 60–90 days before expiry. */
export const RENEWAL_REMIND_MONTHS = 18;
export const RENEWAL_FILE_WINDOW_DAYS = { open: 90, close: 60 } as const;

/** Where an active filing sits relative to the renewal calendar. */
export type RenewalPhase = 'no_expiry' | 'tracking' | 'remind' | 'file_now' | 'overdue' | 'expired';

export function renewalPhase(expiresAt: Date | null | undefined, now: Date = new Date()): {
  phase: RenewalPhase;
  daysLeft: number | null;
  label: string;
} {
  if (!expiresAt) return { phase: 'no_expiry', daysLeft: null, label: 'Not yet confirmed by CBP' };
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
  if (daysLeft < 0) return { phase: 'expired', daysLeft, label: `Expired ${-daysLeft}d ago — refile now` };
  if (daysLeft < RENEWAL_FILE_WINDOW_DAYS.close)
    return { phase: 'overdue', daysLeft, label: `${daysLeft}d left — past the 60-day filing window` };
  if (daysLeft <= RENEWAL_FILE_WINDOW_DAYS.open)
    return { phase: 'file_now', daysLeft, label: `File now — ${daysLeft}d to expiry (60–90 day window)` };
  // 18 months into a 2-year term ≈ 6 months (183 days) before expiry.
  if (daysLeft <= 183) return { phase: 'remind', daysLeft, label: `Remind the customer — ${daysLeft}d to expiry` };
  return { phase: 'tracking', daysLeft, label: `Tracking — ${daysLeft}d to expiry` };
}

// ── the pre-filing validation gate ───────────────────────────────────────────

/** The subset of a POA application the gate reads. Structural so tests (and the
 *  admin page) can pass a plain object. */
export interface PoaValidatable {
  grantorLegalName?: string | null;
  dbaNames?: string[] | null;
  entityType?: string | null;
  stateOfOrg?: string | null;
  countryOfOrg?: string | null;
  residency?: string | null;
  grantorAddress?: string | null;
  einOrImporterNo?: string | null;
  iorNumber?: string | null;
  partnerNames?: string[] | null;
  nameVariations?: string[] | null;
  addressVariations?: string[] | null;
  signerName?: string | null;
  signerTitle?: string | null;
  signerEmail?: string | null;
  signerPhone?: string | null;
  signerEmailVerifiedAt?: Date | null;
  certSignerName?: string | null;
  certSignerTitle?: string | null;
  certSignerEmail?: string | null;
  authorityDocsNote?: string | null;
  consentDisclosureVersion?: string | null;
  signedAt?: Date | null;
  docSha256?: string | null;
}

export interface PoaCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  /** A blocking check must pass before we transmit anything to CBP. */
  blocking: boolean;
}

export interface PoaGateResult {
  checks: PoaCheck[];
  /** True when every BLOCKING check passes. */
  ok: boolean;
  failures: PoaCheck[];
  passed: number;
  total: number;
}

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
const listLen = (v: unknown): number => (Array.isArray(v) ? v.filter((x) => nonEmpty(x)).length : 0);

/** EIN is 9 digits (formatted NN-NNNNNNN or bare). We check SHAPE only — we make
 *  no claim of having verified it against IRS or ACE records. */
export function looksLikeEin(v: string | null | undefined): boolean {
  return /^\d{2}-?\d{7}$/.test(String(v ?? '').trim());
}

/**
 * Run the pre-filing gate. Returns EVERY check with pass/fail so the admin queue
 * can render it as a per-application checklist, plus `ok` = all blocking checks
 * pass. Checks marked non-blocking are operator judgement (an ACE exact-name
 * match, for instance, is a human lookup — we surface it, we do not claim it).
 */
export function validatePoaForFiling(
  app: PoaValidatable,
  opts?: {
    /** Whether the Agent's own physical address is configured
     *  (MANIFEST_AGENT_ADDRESS). 19 CFR 141.32's model form names the agent AND
     *  its address, and we refuse to print an unverified one — so an unset
     *  address blocks the filing instead of fabricating a fact. Omitted ⇒ not
     *  checked (the pure callers that don't read env, e.g. tests). */
    agentAddressConfigured?: boolean;
    /** Whether the Agent's registered legal name is configured
     *  (MANIFEST_AGENT_LEGAL_NAME). Unlike the address — which can degrade to an
     *  email notice address — a missing agent NAME has no safe fallback, so
     *  document generation refuses outright. Surfaced here so the admin queue
     *  explains WHY nothing generated. Omitted ⇒ not checked. */
    agentLegalNameConfigured?: boolean;
    /** The consent/disclosure version currently in force. When supplied, a
     *  record executed under an OLDER version fails a blocking check: the POA is
     *  regenerated deterministically from the stored row, so a row signed
     *  against a superseded template would re-render as a document its signer
     *  never saw — and its retained SHA-256 would no longer reproduce. Those
     *  must be re-signed, not filed. Omitted ⇒ not checked. */
    currentConsentVersion?: string;
  },
): PoaGateResult {
  const checks: PoaCheck[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string, blocking = true) =>
    checks.push({ key, label, ok, detail, blocking });

  const cls = entityClass(app.entityType);

  add(
    'legal_name',
    'Legal name present',
    nonEmpty(app.grantorLegalName),
    nonEmpty(app.grantorLegalName)
      ? String(app.grantorLegalName)
      : 'The grantor legal name is required and must match ACE exactly.',
  );

  add(
    'ace_name_match',
    'Legal name matches ACE exactly',
    false,
    'Operator step: confirm the legal name character-for-character against ACE. CBP suppresses only EXACT matches.',
    false,
  );

  add(
    'entity_type',
    'Entity type recorded',
    cls !== 'other' || nonEmpty(app.entityType),
    nonEmpty(app.entityType) ? String(app.entityType) : 'Entity type is required (it sets the term and title rules).',
  );

  add(
    'jurisdiction',
    'State / country of organization',
    nonEmpty(app.stateOfOrg) || nonEmpty(app.countryOfOrg),
    nonEmpty(app.stateOfOrg) || nonEmpty(app.countryOfOrg)
      ? [app.stateOfOrg, app.countryOfOrg].filter(nonEmpty).join(', ')
      : 'Where the entity is organized is required.',
  );

  const addr = String(app.grantorAddress ?? '');
  const addrOk = nonEmpty(addr) && !isPoBoxAddress(addr);
  add(
    'physical_address',
    'Physical address (no PO box)',
    addrOk,
    !nonEmpty(addr)
      ? 'A physical street address is required.'
      : isPoBoxAddress(addr)
        ? 'This looks like a PO box / mail drop. CBP requires a physical address.'
        : addr,
  );

  const einOk = nonEmpty(app.einOrImporterNo);
  add(
    'ein',
    'EIN / importer number present',
    einOk,
    einOk
      ? looksLikeEin(app.einOrImporterNo)
        ? `${app.einOrImporterNo} (EIN format)`
        : `${app.einOrImporterNo} (non-EIN format — confirm it matches ACE)`
      : 'The IRS EIN (or the importer of record number) is required.',
  );

  const titleStatus = signerTitleStatus(app.entityType, app.signerTitle);
  add(
    'signer_title',
    'Signer title on the accepted list',
    titleStatus === 'allowed',
    titleStatus === 'missing'
      ? 'A signer title is required.'
      : titleStatus === 'allowed'
        ? `${app.signerTitle} — accepted for a ${cls.replace(/_/g, ' ')}`
        : `${app.signerTitle} is off the accepted list for a ${cls.replace(/_/g, ' ')} (${allowedTitlesFor(app.entityType).join(', ') || 'no standard titles'}) — a corporate certification is required instead.`,
    false,
  );

  const needsCert = requiresCorporateCertification(app.entityType, app.signerTitle);
  const certPresent = nonEmpty(app.certSignerName) && nonEmpty(app.certSignerTitle);
  add(
    'signer_authority',
    'Signer authority established',
    titleStatus === 'allowed' || certPresent,
    titleStatus === 'allowed'
      ? 'Title is on the accepted list for this entity form.'
      : certPresent
        ? `Certified by ${app.certSignerName} (${app.certSignerTitle}).`
        : 'Off-list title with no corporate certification — a second officer must attest the signer’s authority.',
  );
  void needsCert;

  const scheduleA = listLen(app.nameVariations);
  add(
    'schedule_a',
    'Schedule A has at least one name variation',
    scheduleA > 0,
    scheduleA > 0
      ? `${scheduleA} name variation${scheduleA === 1 ? '' : 's'}, ${listLen(app.addressVariations)} address variation${listLen(app.addressVariations) === 1 ? '' : 's'}`
      : 'CBP suppresses only exact matches — a filing with no variations silently fails to protect the importer.',
  );

  if (requiresPartnerNames(app.entityType)) {
    const partners = listLen(app.partnerNames);
    add(
      'partners',
      'All partners named (19 CFR 141.39)',
      partners > 0,
      partners > 0 ? `${partners} partner${partners === 1 ? '' : 's'} named` : 'Every partner must be named on a partnership POA.',
    );
    add(
      'partnership_term',
      'Term capped at 2 years (19 CFR 141.34)',
      poaTermYears(app.entityType) <= PARTNERSHIP_MAX_TERM_YEARS,
      `Term is ${poaTermYears(app.entityType)} year(s); it also terminates on any change in partnership membership.`,
    );
  }

  if (requiresAuthorityDocs(app.entityType, app.residency)) {
    add(
      'authority_docs',
      'Nonresident corporation authority documentation (19 CFR 141.37)',
      nonEmpty(app.authorityDocsNote),
      nonEmpty(app.authorityDocsNote)
        ? String(app.authorityDocsNote)
        : 'CBP may require evidence of the signer’s authority for a nonresident corporation — record what is on file.',
    );
  }

  const corpEmailOk = !requiresCorporateEmail(app.entityType) || isCorporateEmail(app.signerEmail);
  add(
    'corporate_email',
    'Signer email is a corporate domain',
    corpEmailOk,
    corpEmailOk
      ? emailDomain(app.signerEmail)
        ? `@${emailDomain(app.signerEmail)}`
        : 'Not required for this entity form.'
      : `@${emailDomain(app.signerEmail)} is a consumer mailbox — a ${cls.replace(/_/g, ' ')} must sign from a business domain.`,
  );

  add(
    'signer_contact',
    'Signer business email + phone captured',
    nonEmpty(app.signerEmail) && nonEmpty(app.signerPhone),
    nonEmpty(app.signerEmail) && nonEmpty(app.signerPhone)
      ? `${app.signerEmail} · ${app.signerPhone}`
      : 'A business email and phone for the signer are required for the audit trail.',
  );

  add(
    'email_verified',
    'Signer email round-trip verified',
    app.signerEmailVerifiedAt instanceof Date,
    app.signerEmailVerifiedAt instanceof Date
      ? `Verified ${app.signerEmailVerifiedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
      : 'The signer must confirm the emailed verification link before we file.',
  );

  add(
    'executed',
    'Executed (signed) with a retained document hash',
    app.signedAt instanceof Date && nonEmpty(app.docSha256),
    app.signedAt instanceof Date && nonEmpty(app.docSha256)
      ? `Signed ${app.signedAt.toISOString().slice(0, 10)} · SHA-256 ${String(app.docSha256).slice(0, 16)}…`
      : 'Not yet executed.',
  );

  if (opts?.currentConsentVersion && app.signedAt instanceof Date) {
    const onCurrent = app.consentDisclosureVersion === opts.currentConsentVersion;
    add(
      'template_current',
      'Executed under the current authorization text',
      onCurrent,
      onCurrent
        ? String(app.consentDisclosureVersion)
        : `Signed under ${app.consentDisclosureVersion || 'an unrecorded version'}, superseded by ${opts.currentConsentVersion}. The document regenerates from the current template, so this record no longer reproduces what was signed — have the customer re-sign before filing.`,
    );
  }

  if (opts?.agentAddressConfigured !== undefined) {
    add(
      'agent_address',
      'Agent’s own filing address configured',
      opts.agentAddressConfigured,
      opts.agentAddressConfigured
        ? 'On the instrument.'
        : 'Set MANIFEST_AGENT_ADDRESS. Until it is set the POA names the Agent by its email notice address only — we will not print an address nobody verified.',
    );
  }

  if (opts?.agentLegalNameConfigured !== undefined) {
    add(
      'agent_legal_name',
      'Agent’s registered legal name configured',
      opts.agentLegalNameConfigured,
      opts.agentLegalNameConfigured
        ? 'On the instrument.'
        : 'Set MANIFEST_AGENT_LEGAL_NAME to the filing entity’s exact registered name. Unset, no POA is generated at all — an instrument that cannot name its attorney-in-fact is defective on its face and CBP will reject it.',
    );
  }

  const failures = checks.filter((c) => c.blocking && !c.ok);
  return {
    checks,
    ok: failures.length === 0,
    failures,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
  };
}

/**
 * The SUBSET of the gate that must pass before a signature is accepted — i.e.
 * everything knowable at execution time. (ACE match, email round-trip and the
 * operator's own checks come later; they are enforced at the filing step.)
 * Returns the first human-readable error, or null when the execution may proceed.
 */
export function validateBeforeSigning(app: PoaValidatable): string | null {
  if (!nonEmpty(app.grantorLegalName)) return 'Add your legal business name first.';
  if (!nonEmpty(app.entityType)) return 'Select your entity type.';
  if (!nonEmpty(app.stateOfOrg) && !nonEmpty(app.countryOfOrg))
    return 'Enter the state or country where your business is organized.';
  if (!nonEmpty(app.grantorAddress)) return 'Enter your physical business address.';
  if (isPoBoxAddress(app.grantorAddress))
    return 'CBP requires a physical street address — a PO box or mail drop can’t be used. Enter your physical address.';
  if (!nonEmpty(app.einOrImporterNo)) return 'Enter your EIN or importer of record number.';
  if (listLen(app.nameVariations) < 1)
    return 'Add at least one name variation to protect — CBP suppresses only exact matches.';
  if (!nonEmpty(app.signerName)) return 'Type your full name as your signature.';
  if (!nonEmpty(app.signerTitle)) return 'Enter your title with the business.';
  if (!nonEmpty(app.signerEmail)) return 'Enter your business email address.';
  if (requiresCorporateEmail(app.entityType) && !isCorporateEmail(app.signerEmail))
    return 'Use your business email address (your company’s own domain) — a personal mailbox weakens the authorization and is a common cause of CBP rejection.';
  if (!nonEmpty(app.signerPhone)) return 'Enter a business phone number.';
  if (requiresPartnerNames(app.entityType) && listLen(app.partnerNames) < 1)
    return 'A partnership authorization must name every partner. Add all partners.';
  if (
    requiresCorporateCertification(app.entityType, app.signerTitle) &&
    !(nonEmpty(app.certSignerName) && nonEmpty(app.certSignerTitle))
  )
    return 'Your title is outside the list CBP normally accepts for this entity type. Have a second officer complete the corporate certification (name and title) so your filing is not rejected.';
  return null;
}
