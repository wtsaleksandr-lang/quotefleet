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
 * That is what the hash-determinism test asserts.
 *
 * HONEST-CLAIMS: the template is marked "DRAFT — attorney review before live",
 * says plainly that filing is done "on your behalf" (no automated CBP API claim), and
 * never asserts any "verified" status.
 */
import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';

/** The current consent + ESIGN disclosure version. Bump when the disclosure
 *  copy changes; stored on each signed application so the exact text a signer
 *  accepted is always reproducible. */
export const CONSENT_DISCLOSURE_VERSION = 'poa-consent-2026-08-v1';

/** Everything the POA document needs, fully resolved. No DB/network in drawer. */
export interface PoaPdfInput {
  /** Grantor (the Principal / importer). */
  grantorLegalName: string;
  entityType: string | null;
  stateOfOrg: string | null;
  grantorAddress: string | null;
  einOrImporterNo: string | null;
  nameVariations: string[];
  addressVariations: string[];
  /** Signer (the natural person executing on the Principal's behalf). */
  signerName: string;
  signerTitle: string | null;
  signerEmail: string | null;
  /** ESIGN attribution — captured at signing. */
  signedAt: Date;
  signerIp: string | null;
  signerUa: string | null;
  consentDisclosureVersion: string;
  /** Drawn-signature canvas PNG bytes (decoded from the data: URL), or null. */
  signatureImage?: Buffer | null;
  /** Agent (QuoteFleet's filing entity). */
  agentLegalName: string;
  /** Expiration date (execution + 2 years) if known, else null → template says
   *  "two (2) years from execution". */
  expiresAt: Date | null;
  /** True while the template is not yet attorney-reviewed — draws the DRAFT band. */
  draftWatermark: boolean;
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
const ACCENT = '#2563eb';
const DRAFT_RED = '#b42318';

function fmtUtc(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function fmtDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Build the POA PDF to a Buffer and return it with its SHA-256. Deterministic:
 *  same input → identical bytes → identical hash (asserted by the tests). */
export function buildPoaPdf(input: PoaPdfInput): Promise<PoaPdfResult> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
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

  // ── DRAFT band (until attorney review) ──────────────────────────────────────
  if (input.draftWatermark) {
    doc.rect(0, 0, doc.page.width, 22).fill(DRAFT_RED);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('DRAFT — TEMPLATE PENDING ATTORNEY REVIEW BEFORE LIVE USE', left, 7, {
        width: contentW,
        align: 'center',
        characterSpacing: 0.5,
      });
    doc.y = 40;
  } else {
    doc.y = doc.page.margins.top;
  }

  // ── Title ───────────────────────────────────────────────────────────────────
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
    .text('U.S. Customs Vessel Manifest Confidentiality — 19 CFR 103.31(d)', left, doc.y + 4, {
      width: contentW,
      align: 'center',
    });
  doc.moveTo(left, doc.y + 10).lineTo(right, doc.y + 10).lineWidth(1).strokeColor(HAIRLINE).stroke();
  doc.y += 22;

  const para = (text: string, opts: { gap?: number; bold?: boolean } = {}) => {
    doc
      .fillColor(INK)
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(10)
      .text(text, left, doc.y, { width: contentW, align: 'left', lineGap: 2 });
    doc.y += opts.gap ?? 10;
  };

  const nameVars = input.nameVariations.length
    ? input.nameVariations.join('; ')
    : input.grantorLegalName;
  const addrVars = input.addressVariations.length
    ? input.addressVariations.join('; ')
    : input.grantorAddress || '[see principal address above]';

  para(
    `KNOW ALL PERSONS BY THESE PRESENTS, THAT ${input.grantorLegalName || '[GRANTOR]'}, a ` +
      `${input.entityType || '[entity type]'} duly organized under the laws of the State/Country of ` +
      `${input.stateOfOrg || '[state of organization]'}, with its principal place of business at ` +
      `${input.grantorAddress || '[principal address]'}, and bearing IRS Employer Identification ` +
      `Number / Importer Number ${input.einOrImporterNo || '[EIN / importer number]'} (the ` +
      `"Principal"), hereby constitutes and appoints ${input.agentLegalName} ("Agent") its true ` +
      `and lawful agent and attorney-in-fact, for the LIMITED purpose of preparing, certifying, ` +
      `submitting, maintaining, and renewing on the Principal's behalf requests for confidential ` +
      `treatment of the Principal's vessel manifest data (name(s), address(es), and identifying ` +
      `marks and numbers, including the name variations listed below) pursuant to 19 CFR ` +
      `103.31(d), with U.S. Customs and Border Protection, via CBP's Vessel Manifest ` +
      `Confidentiality Online Application, the CBP mailbox ` +
      `vesselmanifestconfidentiality@cbp.dhs.gov, and/or by mail.`,
  );

  // Coverage panel
  {
    const panelY = doc.y;
    const lineH = 13;
    const rows = 2;
    const panelH = 16 + rows * (lineH + 6) + 6;
    doc.roundedRect(left, panelY, contentW, panelH, 6).fill(PANEL);
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('NAME VARIATIONS TO BE COVERED', left + 12, panelY + 10, { width: contentW - 24 });
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9.5)
      .text(nameVars, left + 12, panelY + 10 + lineH, { width: contentW - 24 });
    const mid = panelY + 10 + lineH + 6 + lineH;
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('ADDRESS(ES) TO BE COVERED', left + 12, mid, { width: contentW - 24 });
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9.5)
      .text(addrVars, left + 12, mid + lineH, { width: contentW - 24 });
    doc.y = panelY + panelH + 12;
  }

  para(
    `The Principal grants the Agent full power and authority to do every lawful act requisite to ` +
      `carry out the foregoing LIMITED purpose, and no other. This authorization does NOT ` +
      `authorize the Agent to transact any other customs business, make entry, or act as customs ` +
      `broker for the Principal.`,
  );

  const expText = input.expiresAt
    ? `Valid from execution until and including ${fmtDate(input.expiresAt)}, or until written ` +
      `notice of revocation is duly given before that date.`
    : `Valid from execution for two (2) years, or until written notice of revocation is duly given ` +
      `before that date.`;
  para(expText);

  para(
    `The undersigned certifies he/she is authorized to execute this instrument on behalf of the ` +
      `Principal. Executed electronically under the ESIGN Act (15 U.S.C. §7001) and the Uniform ` +
      `Electronic Transactions Act (UETA).`,
  );

  // ── Signature block ─────────────────────────────────────────────────────────
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor(HAIRLINE).stroke();
  doc.y += 12;

  if (input.signatureImage && input.signatureImage.length > 0) {
    try {
      doc.image(input.signatureImage, left, doc.y, { fit: [200, 46] });
      doc.y += 50;
    } catch {
      // Unsupported / corrupt image — fall back to the typed signature only.
      doc.y += 4;
    }
  }

  const kv = (label: string, value: string) => {
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label, left, y, { width: 150 });
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(value || '—', left + 150, y, { width: contentW - 150 });
    doc.y = y + 15;
  };

  kv('Principal:', input.grantorLegalName || '—');
  kv('Signed by (typed e-signature):', input.signerName || '—');
  kv('Title / Capacity:', input.signerTitle || '—');
  kv('Signer email:', input.signerEmail || '—');
  kv('Date (UTC):', fmtUtc(input.signedAt));
  kv('Signer IP:', input.signerIp || '—');
  kv('Consent/disclosure version:', input.consentDisclosureVersion);
  if (input.signerUa) kv('Signer user-agent:', input.signerUa);

  doc.y += 6;
  doc
    .fillColor(MUTED)
    .font('Helvetica-Oblique')
    .fontSize(8)
    .text(
      'This electronic record and its append-only audit trail are retained by QuoteFleet as the ' +
        'reproducible record of this authorization. QuoteFleet prepares and submits this request to ' +
        'CBP on the Principal’s behalf; QuoteFleet is not CBP and has no automated filing connection to it.',
      left,
      doc.y,
      { width: contentW, lineGap: 1 },
    );

  // ── Footer on every page ────────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 40;
    doc.moveTo(left, fy).lineTo(right, fy).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        `Limited POA — 19 CFR 103.31(d) confidentiality filing only · Prepared by ${input.agentLegalName}`,
        left,
        fy + 8,
        { width: contentW, align: 'left', lineBreak: false },
      );
    void ACCENT;
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
