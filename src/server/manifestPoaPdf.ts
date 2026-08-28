/**
 * Server-rendered LIMITED Power of Attorney PDF for Manifest Privacy.
 *
 * Draws the scope-restricted customs POA (19 CFR 103.31(d) confidentiality
 * filing ONLY — never general customs authority) directly with PDFKit, the same
 * dependency-light, pure-JS library that powers the branded quote PDF
 * (src/server/quotePdf.ts) — so there is NO headless browser on the request
 * path. `buildPoaPdf` is a pure function (no DB, no network): the route hands it
 * a fully-resolved `PoaPdfInput` and gets back the PDF bytes + their SHA-256.
 *
 * DETERMINISM: the SHA-256 is the tamper-evidence hash retained on the
 * application. The document is drawn deterministically — CreationDate is pinned
 * to the signing timestamp and `compress:false` keeps the content stream literal
 * — so the SAME input always yields the SAME bytes and therefore the SAME hash.
 * That is what the hash-determinism test asserts. It is ALSO why the audit-trail
 * block is built from the fields FROZEN on the record at execution (created /
 * consent / email-verified / signed) rather than from the live, still-growing
 * poa_audit_events table: a post-execution event must never change the bytes of
 * an already-hashed instrument.
 *
 * LEGAL POSTURE carried by this template — do not soften any of it:
 *   §3  enumerates the limited scope (a–h, including renewals)
 *   §4  EXPRESSLY excludes customs business (19 U.S.C. 1641(a)(2) / 19 CFR 111.1)
 *   §5  the GRANTOR makes the §103.31(d) certification — we only transmit
 *   §6  the signer warrants their own authority to bind
 *   §7  partnership term hard-capped at 2 years (19 CFR 141.34)
 *   §9  retention ≥5 years, produced to CBP on demand (19 CFR 141.46)
 *   §10 ESIGN/UETA consent
 *   §11 governing law fixed to a clean UETA state (never grantor domicile)
 *
 * HONEST-CLAIMS: the document says plainly that filing is done "on the
 * Principal's behalf" (no automated CBP API claim), never asserts any "verified"
 * status, and never describes the Agent as a customs broker.
 */
import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import {
  POA_GOVERNING_LAW_STATE,
  POA_RETENTION_YEARS,
  entityClass,
  poaTermYears,
  poaTermExpiresAt,
} from './manifestPoaValidation.js';

/** The current consent + ESIGN disclosure version. Bump when the disclosure
 *  copy changes; stored on each signed application so the exact text a signer
 *  accepted is always reproducible. */
export const CONSENT_DISCLOSURE_VERSION = 'poa-consent-2026-08-v2';

/** The template revision stamped into the executed instrument, so a produced
 *  document can always be tied back to the exact text that was signed. */
export const POA_TEMPLATE_VERSION = 'poa-template-2026-08-v1';

/** Everything the POA document needs, fully resolved. No DB/network in drawer. */
export interface PoaPdfInput {
  /** Grantor (the Principal / importer). */
  grantorLegalName: string;
  /** DBA / trade names the Principal also does business as. */
  dbaNames?: string[];
  entityType: string | null;
  stateOfOrg: string | null;
  countryOfOrg?: string | null;
  /** 'resident' | 'nonresident' (of the United States). */
  residency?: string | null;
  /** PHYSICAL address — never a PO box (validated upstream). */
  grantorAddress: string | null;
  /** Optional mailing address when it differs from the physical address. */
  mailingAddress?: string | null;
  /** IRS Employer Identification Number (or SSN for an individual). */
  einOrImporterNo: string | null;
  /** Importer of record number when it differs from the EIN. */
  iorNumber?: string | null;
  /** Every partner, when the Principal is a partnership (19 CFR 141.39). */
  partnerNames?: string[];
  nameVariations: string[];
  addressVariations: string[];
  /** Signer (the natural person executing on the Principal's behalf). */
  signerName: string;
  signerTitle: string | null;
  signerEmail: string | null;
  signerPhone?: string | null;
  /** Optional second-officer certification of the signer's authority. */
  certSignerName?: string | null;
  certSignerTitle?: string | null;
  certSignerEmail?: string | null;
  /** Free-text note on the supporting authority documentation held on file
   *  (nonresident corporations — 19 CFR 141.37). */
  authorityDocsNote?: string | null;
  /** ESIGN attribution — captured at signing. */
  signedAt: Date;
  signerIp: string | null;
  signerUa: string | null;
  consentDisclosureVersion: string;
  /** Frozen audit facts — see the DETERMINISM note in the file header. */
  applicationCreatedAt?: Date | null;
  consentAt?: Date | null;
  emailVerifiedAt?: Date | null;
  /** Drawn-signature canvas PNG bytes (decoded from the data: URL), or null. */
  signatureImage?: Buffer | null;
  /** Agent (QuoteFleet's filing entity). */
  agentLegalName: string;
  agentAddress?: string | null;
  /** CBP protection expiry once confirmed (informational); the POA's OWN term is
   *  computed from signedAt + the entity-capped term. */
  expiresAt: Date | null;
}

export interface PoaPdfResult {
  buffer: Buffer;
  /** Hex SHA-256 of the PDF bytes — the tamper-evidence document hash. */
  sha256: string;
}

const INK = '#1a2230';
const MUTED = '#5b6472';
const HAIRLINE = '#dfe4ec';
const PANEL = '#f4f6fa';

/** QuoteFleet's filing address as it appears on the instrument. */
export const AGENT_DEFAULT_ADDRESS = '1111B South Governors Avenue, Dover, DE 19904, United States';

function fmtUtc(d: Date | null | undefined): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function fmtDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

function list(v: string[] | null | undefined): string[] {
  return (v ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
}

/** The enumerated scope (§3). Exported so tests + the UI can assert the exact
 *  grants the Principal is making. */
export const POA_SCOPE_ITEMS: readonly string[] = [
  'prepare, execute, certify, and submit to U.S. Customs and Border Protection ("CBP") requests for confidential treatment of the Principal’s vessel manifest data under 19 CFR 103.31(d)(1), including the certification required by that subsection;',
  'request confidential treatment of the Principal’s identity as shipper, consignee, or notify party, and of the marks and numbers identifying its cargo, to the extent 19 CFR 103.31(d) permits;',
  'request confidential treatment with respect to outward (export) vessel manifest data under 19 CFR 103.31(d)(2) where applicable;',
  'submit, supplement, and update the schedule of the Principal’s name and address variations attached as Schedule A, including additional variations the Principal later identifies;',
  'transmit the foregoing to CBP through CBP’s Vessel Manifest Confidentiality online application, the vesselmanifestconfidentiality@cbp.dhs.gov mailbox, and/or by mail, and to receive CBP’s acknowledgements and correspondence relating to those submissions;',
  'monitor the two-year term of any confidential treatment granted and prepare, execute, and submit RENEWAL requests on the same limited basis before that term expires;',
  'correspond with CBP solely to confirm the status of, correct, supplement, or withdraw such a request; and',
  'receive from CBP acknowledgements, receipts, and reference numbers relating to such requests.',
];

/** The express exclusions (§4). Exported for the same reason as the scope. */
export const POA_EXCLUSION_ITEMS: readonly string[] = [
  'make, file, or amend any entry or entry summary, or transact any other "customs business" as that term is defined in 19 U.S.C. 1641(a)(2) and 19 CFR 111.1;',
  'classify merchandise, determine or declare value, or determine country of origin;',
  'determine, pay, protest, or seek refund of duties, taxes, fees, or drawback;',
  'file protests, petitions, prior disclosures, or requests for administrative review;',
  'obtain, pledge, or obligate any customs bond;',
  'act as, designate, or change the Principal’s importer of record, or prepare or file CBP Form 5106;',
  'delegate this authority to a sub-agent, or appoint a substitute attorney-in-fact; or',
  'receive, hold, or disburse any funds of the Principal.',
];

/** Build the POA PDF to a Buffer and return it with its SHA-256. Deterministic:
 *  same input → identical bytes → identical hash (asserted by the tests). */
export function buildPoaPdf(input: PoaPdfInput): Promise<PoaPdfResult> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    compress: false,
    bufferPages: true,
    // Pin CreationDate to the signing time so the bytes (and therefore the
    // SHA-256) are deterministic for a given input.
    info: {
      Title: `Limited Power of Attorney — ${input.grantorLegalName}`,
      Author: input.agentLegalName,
      Subject: 'US Customs Vessel Manifest Confidentiality (19 CFR 103.31(d))',
      Creator: 'QuoteFleet Manifest Privacy',
      CreationDate: input.signedAt,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<PoaPdfResult>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve({ buffer, sha256: createHash('sha256').update(buffer).digest('hex') });
    });
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

  /** Start a new page when `h` points of content would not fit. Keeps section
   *  headings from being orphaned at the foot of a page. */
  const ensure = (h: number) => {
    if (doc.y + h > bottomLimit()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  const para = (text: string, opts: { gap?: number; bold?: boolean; size?: number; indent?: number } = {}) => {
    const size = opts.size ?? 9.5;
    const x = left + (opts.indent ?? 0);
    const w = contentW - (opts.indent ?? 0);
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    ensure(Math.min(doc.heightOfString(text, { width: w, lineGap: 1.5 }), 120));
    doc.fillColor(INK).text(text, x, doc.y, { width: w, align: 'left', lineGap: 1.5 });
    doc.y += opts.gap ?? 8;
  };

  const section = (n: number, title: string) => {
    ensure(46);
    doc.y += 4;
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(`${n}. ${title}`, left, doc.y, { width: contentW });
    doc.y += 5;
  };

  /** An (a)-(h) enumerated item. */
  const item = (letter: string, text: string) => {
    doc.font('Helvetica').fontSize(9.5);
    const w = contentW - 22;
    ensure(Math.min(doc.heightOfString(text, { width: w, lineGap: 1.5 }) + 4, 120));
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9.5).text(`(${letter})`, left, y, { width: 20 });
    doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(text, left + 22, y, { width: w, lineGap: 1.5 });
    doc.y += 5;
  };

  const kv = (label: string, value: string, labelW = 168) => {
    doc.font('Helvetica').fontSize(9);
    const w = contentW - labelW;
    ensure(Math.max(14, doc.heightOfString(value || '—', { width: w }) + 3));
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label, left, y, { width: labelW - 8 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(value || '—', left + labelW, y, { width: w });
    doc.y = Math.max(doc.y, y + 12) + 2;
  };

  const rule = (gap = 10) => {
    ensure(gap + 4);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.75).strokeColor(HAIRLINE).stroke();
    doc.y += gap;
  };

  // ── derived values ─────────────────────────────────────────────────────────
  const cls = entityClass(input.entityType);
  const isPartnership = cls === 'partnership';
  const termYears = poaTermYears(input.entityType);
  const termEnds = poaTermExpiresAt(input.entityType, input.signedAt);
  const jurisdiction =
    [input.stateOfOrg, input.countryOfOrg].filter((s) => !!String(s ?? '').trim()).join(', ') ||
    '[state/country of organization]';
  const dbas = list(input.dbaNames);
  const partners = list(input.partnerNames);
  const nameVars = list(input.nameVariations);
  const addrVars = list(input.addressVariations);
  const agentAddress = input.agentAddress || AGENT_DEFAULT_ADDRESS;
  const residencyLabel =
    String(input.residency ?? '') === 'nonresident'
      ? 'a NONRESIDENT of the United States'
      : String(input.residency ?? '') === 'resident'
        ? 'a resident of the United States'
        : 'of the residency stated in its application';

  // ── Title ───────────────────────────────────────────────────────────────────
  doc.y = doc.page.margins.top;
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text('LIMITED POWER OF ATTORNEY & AGENT AUTHORIZATION', left, doc.y, {
      width: contentW,
      align: 'center',
    });
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(9.5)
    .text(
      'U.S. Customs Vessel Manifest Confidentiality — 19 CFR 103.31(d) — CONFIDENTIALITY FILING ONLY',
      left,
      doc.y + 4,
      { width: contentW, align: 'center' },
    );
  doc.y += 6;
  rule(12);

  para(
    `KNOW ALL PERSONS BY THESE PRESENTS, that the undersigned Principal identified in Section 1 ` +
      `constitutes and appoints ${input.agentLegalName} as its agent and attorney-in-fact for the ` +
      `SOLE AND LIMITED purposes enumerated in Section 3, and for no other purpose. This instrument ` +
      `grants NO general power of attorney and NO authority to transact customs business.`,
    { gap: 10 },
  );

  // ── 1. GRANTOR ──────────────────────────────────────────────────────────────
  section(1, 'GRANTOR (PRINCIPAL)');
  para(
    `The Principal is ${input.grantorLegalName || '[GRANTOR LEGAL NAME]'}, a ` +
      `${input.entityType || '[entity type]'} organized under the laws of ${jurisdiction}, ` +
      `${residencyLabel}. The Principal warrants that the legal name stated here is its legal name ` +
      `exactly as it appears in CBP's Automated Commercial Environment (ACE).`,
    { gap: 6 },
  );
  kv('Legal name (as in ACE):', input.grantorLegalName || '—');
  kv('DBA / trade name(s):', dbas.length ? dbas.join('; ') : 'None');
  kv('Entity type:', input.entityType || '—');
  kv('State / country of organization:', jurisdiction);
  kv(
    'U.S. residency status:',
    String(input.residency ?? '') === 'nonresident'
      ? 'Nonresident'
      : String(input.residency ?? '') === 'resident'
        ? 'Resident'
        : '—',
  );
  kv('Physical address (no PO box):', input.grantorAddress || '—');
  if (input.mailingAddress) kv('Mailing address:', input.mailingAddress);
  kv('IRS EIN (or SSN):', input.einOrImporterNo || '—');
  kv('Importer of record number:', input.iorNumber || 'Same as above');
  if (isPartnership) {
    kv('Partners (all, 19 CFR 141.39):', partners.length ? partners.join('; ') : '—');
  }

  // ── 2. APPOINTMENT OF AGENT ─────────────────────────────────────────────────
  section(2, 'APPOINTMENT OF AGENT');
  para(
    `The Principal hereby constitutes and appoints ${input.agentLegalName}, of ${agentAddress} (the ` +
      `"Agent"), as its true and lawful AGENT AND ATTORNEY-IN-FACT, and expressly as an ` +
      `"authorized agent and attorney" of the Principal within the meaning of 19 CFR 103.31(d), ` +
      `to act for and on behalf of the Principal solely as set out in Section 3 below. The Agent is ` +
      `a service provider that prepares and transmits the Principal's own certification to CBP; the ` +
      `Agent is not CBP, is not a customs broker, and does not hold itself out as one.`,
  );

  // ── 3. SCOPE ────────────────────────────────────────────────────────────────
  section(3, 'SCOPE OF AUTHORITY (LIMITED AND ENUMERATED)');
  para('The Agent is authorized, and is authorized only, to:', { gap: 6 });
  const letters = 'abcdefgh'.split('');
  POA_SCOPE_ITEMS.forEach((text, i) => item(letters[i] ?? String(i + 1), text));
  doc.y += 2;
  para(
    'The Agent may do every lawful act reasonably requisite to carry out the foregoing enumerated ' +
      'purposes, AND NO OTHER.',
    { bold: true },
  );

  // ── 4. EXPRESS LIMITATIONS ──────────────────────────────────────────────────
  section(4, 'EXPRESS LIMITATIONS — NO CUSTOMS BUSINESS');
  para(
    'This instrument does NOT authorize the Agent to transact "customs business" as that term is ' +
      'defined in 19 U.S.C. 1641(a)(2) and 19 CFR 111.1, and the Principal does NOT appoint the Agent ' +
      'as its customs broker. Without limiting the foregoing, the Agent is expressly NOT authorized to:',
    { gap: 6 },
  );
  POA_EXCLUSION_ITEMS.forEach((text, i) => item(letters[i] ?? String(i + 1), text));
  doc.y += 2;
  para(
    'Any act of the Agent purporting to exceed Section 3 is void as beyond the authority granted. ' +
      'The Principal remains solely responsible for all customs business relating to its imports and ' +
      'exports, and for the accuracy of the data underlying any request submitted under this instrument.',
  );

  // ── 5. GRANTOR'S CERTIFICATION ──────────────────────────────────────────────
  section(5, 'PRINCIPAL’S CERTIFICATION UNDER 19 CFR 103.31(d)');
  para(
    'THE PRINCIPAL — not the Agent — MAKES THE FOLLOWING CERTIFICATION, and the Agent transmits it ' +
      'to CBP as the Principal’s authorized agent:',
    { bold: true, gap: 6 },
  );
  para(
    `The Principal certifies that it is the importer or consignee (or the shipper, as applicable) ` +
      `whose name, address, and identifying marks and numbers are the subject of this request; that ` +
      `it requests confidential treatment of that information appearing in vessel manifest data ` +
      `pursuant to 19 CFR 103.31(d); that the names and addresses listed in Schedule A are the ` +
      `names and addresses (and the variations of them) under which it is identified in inward and ` +
      `outward vessel manifests; and that the information it has provided in support of this request ` +
      `is true and correct to the best of its knowledge and belief.`,
    { gap: 6 },
  );
  para(
    'The Principal acknowledges that CBP suppresses only records matching the certified name and ' +
      'address EXACTLY as submitted; that any variation not listed in Schedule A may continue to ' +
      'appear publicly; that confidential treatment applies PROSPECTIVELY and does not retroactively ' +
      'remove data already released; and that any confidential treatment granted expires two (2) ' +
      'years after CBP receives the request unless a further request is filed. The Principal ' +
      'acknowledges that the Agent has made no representation that CBP will grant the request.',
  );

  // ── 6. SIGNER'S AUTHORITY ───────────────────────────────────────────────────
  section(6, 'AUTHORITY OF THE PERSON SIGNING');
  para(
    `The individual executing this instrument represents and warrants that he or she is ` +
      `${input.signerName || '[signer]'}, holding the office or capacity of ` +
      `${input.signerTitle || '[title]'} with the Principal; that he or she is duly authorized to ` +
      `execute this instrument and to bind the Principal; that no further corporate, partnership, or ` +
      `member action is required to make this instrument binding on the Principal; and that this ` +
      `warranty is made to induce the Agent to act in reliance on it.`,
  );
  if (input.certSignerName && input.certSignerTitle) {
    para(
      `A corporate certification by a second officer of the Principal is attached in Section 12 and ` +
        `forms part of this instrument.`,
      { gap: 6 },
    );
  }
  if (input.authorityDocsNote) {
    para(
      `Supporting evidence of authority held on file by the Agent (19 CFR 141.37): ` +
        `${input.authorityDocsNote}`,
      { gap: 6 },
    );
  }

  // ── 7. TERM ─────────────────────────────────────────────────────────────────
  section(7, 'TERM AND EXPIRATION');
  para(
    `This instrument takes effect on the date of execution shown in Section 12 and, unless sooner ` +
      `revoked, EXPIRES on ${fmtDate(termEnds)} — ${termYears === 1 ? 'one (1) year' : 'two (2) years'} ` +
      `from execution.`,
    { gap: 6 },
  );
  if (isPartnership) {
    para(
      'BECAUSE THE PRINCIPAL IS A PARTNERSHIP, this instrument may not and does not run for more ' +
        'than TWO (2) YEARS from its date (19 CFR 141.34), and it TERMINATES AUTOMATICALLY upon any ' +
        'change in the membership of the partnership. A new instrument naming all then-current ' +
        'partners must be executed after any such change.',
      { bold: true, gap: 6 },
    );
  }
  para(
    'Expiration of this instrument does not by itself terminate confidential treatment already ' +
      'granted by CBP; conversely, confidential treatment granted by CBP expires two (2) years after ' +
      'CBP receives the request. CBP does NOT renew confidential treatment automatically and sends ' +
      'no expiry notice. The Principal authorizes the Agent to prepare and submit renewal requests ' +
      'under Section 3(f) while this instrument remains in force.',
  );

  // ── 8. REVOCATION ───────────────────────────────────────────────────────────
  section(8, 'REVOCATION');
  para(
    `The Principal may REVOKE this instrument at any time, with or without cause, by written notice ` +
      `to the Agent (including by email to the address the Agent designates for that purpose). ` +
      `Revocation is effective on the Agent's receipt of the notice and does not affect any act ` +
      `lawfully performed before receipt. The Principal will remain responsible for notifying CBP ` +
      `directly if it wishes to withdraw a request already submitted. This instrument SUPERSEDES and ` +
      `REVOKES any prior power of attorney granted by the Principal to the Agent for the limited ` +
      `purposes described in Section 3; it does not revoke any power of attorney granted to any other ` +
      `person, including the Principal's customs broker.`,
  );

  // ── 9. RETENTION ────────────────────────────────────────────────────────────
  section(9, 'RETENTION AND PRODUCTION');
  para(
    `The Agent will RETAIN this executed instrument, the electronic-signature audit trail set out ` +
      `below, and all records relating to submissions made under it for NOT LESS THAN ` +
      `${POA_RETENTION_YEARS} YEARS after the later of (i) the date of execution and (ii) the date ` +
      `of the last submission made under it, and in a form that accurately reflects the information ` +
      `and remains accessible and reproducible by all persons entitled to access it (15 U.S.C. ` +
      `7001(d)). Powers of attorney are not filed with CBP; the Agent will PRODUCE this instrument ` +
      `to CBP on demand (19 CFR 141.46). The Principal may obtain a copy at any time.`,
  );

  // ── 10. ELECTRONIC SIGNATURE ────────────────────────────────────────────────
  section(10, 'ELECTRONIC SIGNATURE AND CONSENT');
  para(
    `The Principal and the signer CONSENT to the use of electronic records and electronic ` +
      `signatures for this instrument under the Electronic Signatures in Global and National ` +
      `Commerce Act (15 U.S.C. 7001 et seq.) and the Uniform Electronic Transactions Act, and agree ` +
      `that this instrument executed electronically has the same legal effect as one signed on ` +
      `paper. The signer consents to receive this instrument and related records electronically, ` +
      `may withdraw that consent as to future records by notifying the Agent, and may request a ` +
      `paper copy at no charge. The typed name entered by the signer, together with the consent ` +
      `recorded in the audit trail below, constitutes that signer's signature. ` +
      `Consent/disclosure version: ${input.consentDisclosureVersion}. Template version: ` +
      `${POA_TEMPLATE_VERSION}.`,
  );

  // ── 11. GOVERNING LAW ───────────────────────────────────────────────────────
  section(11, 'GOVERNING LAW');
  para(
    `This instrument, and the validity, effect, and interpretation of the electronic signature ` +
      `applied to it, are GOVERNED BY THE LAWS OF THE STATE OF ${POA_GOVERNING_LAW_STATE.toUpperCase()}, ` +
      `without regard to its conflict-of-laws rules, and without regard to the domicile or place of ` +
      `organization of the Principal. The parties agree that ${POA_GOVERNING_LAW_STATE} has adopted ` +
      `the Uniform Electronic Transactions Act and that its law governs the agency relationship ` +
      `created here. Nothing in this Section limits CBP's authority to make its own determination ` +
      `as to the sufficiency of this instrument for its purposes. If any provision is held ` +
      `unenforceable, the remainder stays in force, and the limitations in Section 4 survive in all events.`,
  );

  // ── 12. EXECUTION ───────────────────────────────────────────────────────────
  section(12, 'EXECUTION');
  para(
    'IN WITNESS WHEREOF, the Principal has caused this Limited Power of Attorney to be executed by ' +
      'its duly authorized representative as of the date shown below.',
    { gap: 8 },
  );

  ensure(120);
  if (input.signatureImage && input.signatureImage.length > 0) {
    try {
      doc.image(input.signatureImage, left, doc.y, { fit: [200, 46] });
      doc.y += 50;
    } catch {
      // Unsupported / corrupt image — fall back to the typed signature only.
      doc.y += 4;
    }
  }
  kv('Principal:', input.grantorLegalName || '—');
  kv('Signature (typed e-signature):', `/s/ ${input.signerName || '—'}`);
  kv('Printed name:', input.signerName || '—');
  kv('Title / capacity:', input.signerTitle || '—');
  kv('Business email:', input.signerEmail || '—');
  kv('Business phone:', input.signerPhone || '—');
  kv('Date executed (UTC):', fmtUtc(input.signedAt));

  if (input.certSignerName && input.certSignerTitle) {
    doc.y += 6;
    rule(8);
    para('CORPORATE CERTIFICATION OF AUTHORITY (second officer)', { bold: true, gap: 6 });
    para(
      `The undersigned, an officer of the Principal other than the signer above, CERTIFIES that the ` +
        `person who executed this instrument held the office or capacity stated above on the date of ` +
        `execution and was duly authorized by the Principal to execute it and to bind the Principal.`,
      { gap: 6 },
    );
    kv('Certifying officer:', input.certSignerName);
    kv('Title:', input.certSignerTitle);
    kv('Business email:', input.certSignerEmail || '—');
  }

  // ── SCHEDULE A ──────────────────────────────────────────────────────────────
  doc.addPage();
  doc.y = doc.page.margins.top;
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('SCHEDULE A — NAME AND ADDRESS VARIATIONS', left, doc.y, { width: contentW });
  doc.y += 6;
  para(
    'Every name and address under which the Principal is or may be identified on inward or outward ' +
      'vessel manifests. CBP suppresses only records matching a certified name and address EXACTLY; ' +
      'a variation omitted here may continue to appear publicly.',
    { gap: 10 },
  );

  const scheduleBlock = (heading: string, rows: string[], fallback: string) => {
    ensure(40);
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(heading, left, doc.y, { width: contentW, characterSpacing: 0.4 });
    doc.y += 4;
    const values = rows.length ? rows : [fallback];
    values.forEach((v, i) => {
      doc.font('Helvetica').fontSize(9.5);
      const w = contentW - 34;
      ensure(doc.heightOfString(v, { width: w }) + 10);
      const y = doc.y;
      const h = doc.heightOfString(v, { width: w }) + 8;
      doc.roundedRect(left, y, contentW, h, 4).fill(i % 2 === 0 ? PANEL : '#ffffff');
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`${i + 1}.`, left + 10, y + 4, { width: 18 });
      doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(v, left + 32, y + 4, { width: w });
      doc.y = y + h + 2;
    });
    doc.y += 10;
  };

  scheduleBlock(
    'A-1 · NAMES TO BE KEPT CONFIDENTIAL (INCLUDING DBAs, ABBREVIATIONS, MISSPELLINGS, FORMER NAMES)',
    [...new Set([...(input.grantorLegalName ? [input.grantorLegalName] : []), ...dbas, ...nameVars])],
    '[no name variations supplied]',
  );
  scheduleBlock(
    'A-2 · ADDRESSES TO BE KEPT CONFIDENTIAL',
    [...new Set([...(input.grantorAddress ? [input.grantorAddress] : []), ...addrVars])],
    '[no address variations supplied]',
  );
  if (isPartnership) {
    scheduleBlock('A-3 · PARTNERS OF THE PRINCIPAL (19 CFR 141.39)', partners, '[no partners supplied]');
  }

  // ── AUDIT TRAIL (system-generated) ──────────────────────────────────────────
  ensure(200);
  doc.y += 4;
  rule(10);
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('ELECTRONIC SIGNATURE AUDIT TRAIL', left, doc.y, { width: contentW });
  doc.y += 5;
  para(
    'System-generated by ' +
      input.agentLegalName +
      '. Not editable by the signer. Recorded contemporaneously with execution and retained with the ' +
      'executed instrument as the reproducible record required by 15 U.S.C. 7001(d).',
    { gap: 8, size: 8.5 },
  );
  kv('Document created (UTC):', fmtUtc(input.applicationCreatedAt ?? null), 190);
  kv('ESIGN consent accepted (UTC):', fmtUtc(input.consentAt ?? null), 190);
  kv('Consent/disclosure version:', input.consentDisclosureVersion, 190);
  kv(
    'Signer email verified (UTC):',
    input.emailVerifiedAt ? fmtUtc(input.emailVerifiedAt) : 'Not verified at execution',
    190,
  );
  kv('Signed (UTC):', fmtUtc(input.signedAt), 190);
  kv('Signer IP address:', input.signerIp || '—', 190);
  kv('Signer user agent:', input.signerUa || '—', 190);
  kv('Signature method:', input.signatureImage ? 'Typed name + drawn signature' : 'Typed name', 190);
  kv('Template version:', POA_TEMPLATE_VERSION, 190);
  kv('Governing law:', `State of ${POA_GOVERNING_LAW_STATE}`, 190);
  kv('Retention:', `Not less than ${POA_RETENTION_YEARS} years`, 190);
  doc.y += 4;
  para(
    'A SHA-256 hash of these executed bytes is computed at execution and retained by the Agent ' +
      'separately from this document (a hash cannot be printed inside the bytes it measures); any ' +
      'later copy can be re-hashed and compared to detect alteration. The Agent also maintains an ' +
      'append-only event log for this instrument, including events recorded after execution, which ' +
      'is produced on request.',
    { size: 8.5 },
  );

  // ── Footer on every page ────────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 44;
    doc.moveTo(left, fy).lineTo(right, fy).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        `Limited POA — 19 CFR 103.31(d) confidentiality filing only · No customs business · ` +
          `${input.grantorLegalName || 'Principal'} · Prepared by ${input.agentLegalName} · ` +
          `Page ${i - range.start + 1} of ${total}`,
        left,
        fy + 8,
        { width: contentW, align: 'left', lineBreak: false },
      );
  }

  doc.end();
  return done;
}

/** Decode a data: PNG URL (or a bare base64 PNG) into raw bytes, or null. */
export function decodeSignaturePng(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl).trim());
  const b64 = m ? m[1] : /^[A-Za-z0-9+/=]+$/.test(String(dataUrl).trim()) ? String(dataUrl).trim() : null;
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}
