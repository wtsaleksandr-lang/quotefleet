/**
 * Server-rendered BRANDED quote PDF.
 *
 * Draws a clean, professional freight-quote document directly with PDFKit — a
 * dependency-light, pure-JS PDF library that ships the 14 standard fonts, so
 * there is NO headless browser (Puppeteer/Playwright) on the production request
 * path. `buildQuotePdf` is a pure function (no DB, no network): the route
 * assembles a normalized `QuotePdfInput` from the SAME lead/tenant/brand data
 * that powers the hosted quote + the branded quote email, so the PDF always
 * matches what the customer sees online.
 *
 * Branding / plan model (mirrors src/server/plans.ts + the QuoteFleet pricing
 * model): every tenant gets a functional PDF with their logo + brand colors.
 * The ONLY Pro difference is the footer badge — a non-Pro tenant's PDF carries
 * a subtle "Powered by QuoteFleet" line; a Pro (or trialing) tenant's does not.
 * A free tenant is never 500'd — it just gets the badged version.
 */
import PDFDocument from 'pdfkit';

/** A single customer-facing pricing line (already margin-folded upstream via
 *  customerFacingLines — this module never sees a raw margin row). */
export interface QuotePdfLine {
  name: string;
  amount: number;
  kind?: string;
  note?: string;
}

/** Everything the document needs, fully resolved. No DB/network in the drawer. */
export interface QuotePdfInput {
  refId: string;
  generatedAt: Date;
  expiresAt: Date;
  currency: string;
  total: number;
  distanceMiles: number | null;
  /** Estimated transit window text (e.g. "2–3 business days"), or null. */
  transitText: string | null;
  lane: { pickup: string; delivery: string };
  /** Human service / equipment label (e.g. "40' Standard Container"). */
  service: string | null;
  /** Customer-facing pricing breakdown (customerFacingLines output). */
  breakdown: QuotePdfLine[];
  /** Terms / disclaimer small print. */
  disclaimer: string;
  carrier: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    mcNumber?: string | null;
    dotNumber?: string | null;
  };
  brand: {
    primaryColor: string;
    accentColor: string;
    /** Pre-fetched PNG/JPEG logo bytes, or null. The route fetches + validates
     *  the content-type; the drawer only embeds what it's handed. */
    logo?: Buffer | null;
  };
  /** True → Pro (or trialing): drop the "Powered by QuoteFleet" footer badge. */
  proBranding: boolean;
}

export interface QuotePdfResult {
  buffer: Buffer;
  /** True when the "Powered by QuoteFleet" badge was drawn (non-Pro tenants). */
  hasBadge: boolean;
}

// Neutral ink palette for body text — brand color is reserved for accents so a
// pale brand color never renders unreadable body copy.
const INK = '#1a2230';
const MUTED = '#5b6472';
const HAIRLINE = '#dfe4ec';
const PANEL = '#f4f6fa';
const DEFAULT_PRIMARY = '#2563eb';
const DEFAULT_ACCENT = '#6e8bff';

/** Accept only a well-formed #rgb / #rrggbb hex; fall back otherwise so a
 *  malformed brand color can never throw inside PDFKit's fillColor. */
function safeHex(value: string | null | undefined, fallback: string): string {
  const s = String(value ?? '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : fallback;
}

function money(n: number | null | undefined, currency: string): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(v);
}

function shortDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

/** Group the flat breakdown into the SAME sections the hosted quote shows
 *  (quote.js renderPricing): Line Haul, Accessorials, Fuel, Notes. */
function groupLines(lines: QuotePdfLine[]): Array<{ heading: string; rows: QuotePdfLine[] }> {
  const of = (kinds: string[]) => lines.filter((l) => kinds.includes(String(l.kind || '')));
  return [
    { heading: 'Line Haul', rows: [...of(['linehaul']), ...of(['minimum'])] },
    { heading: 'Accessorials', rows: of(['accessorial']) },
    { heading: 'Fuel', rows: of(['fuel']) },
    { heading: 'Notes', rows: of(['note']) },
  ].filter((g) => g.rows.length > 0);
}

/**
 * Render the branded quote PDF to a Buffer. Resolves once PDFKit has flushed
 * the whole document. `compress:false` keeps the content streams as literal
 * text so tests (and search tools) can assert on the drawn strings.
 */
export function buildQuotePdf(input: QuotePdfInput): Promise<QuotePdfResult> {
  const primary = safeHex(input.brand.primaryColor, DEFAULT_PRIMARY);
  const accent = safeHex(input.brand.accentColor, DEFAULT_ACCENT);
  const currency = input.currency || 'USD';
  const hasBadge = !input.proBranding;

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 50, bottom: 56, left: 50, right: 50 },
    compress: false,
    bufferPages: true,
    info: {
      Title: `Freight quote ${input.refId}`,
      Author: input.carrier.name,
      Subject: `Quote ${input.refId} — ${input.lane.pickup} to ${input.lane.delivery}`,
      Creator: 'QuoteFleet',
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<QuotePdfResult>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), hasBadge }));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bottom()) doc.addPage();
  };

  // ── Header: brand accent rule + logo/company + quote meta box ──────────────
  doc.rect(0, 0, doc.page.width, 6).fill(primary);
  doc.y = doc.page.margins.top;

  const metaBoxW = 190;
  const headerLeftW = contentW - metaBoxW - 20;
  const headerTop = doc.y;

  // Left: logo (if we were handed valid image bytes) then company + contact.
  let leftY = headerTop;
  if (input.brand.logo) {
    try {
      doc.image(input.brand.logo, left, leftY, { fit: [headerLeftW, 46] });
      leftY += 46 + 10;
    } catch {
      // Unsupported / corrupt image — fall back to the company name only.
    }
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(input.carrier.name, left, leftY, { width: headerLeftW });
  leftY = doc.y + 2;
  const contactLine = [input.carrier.phone, input.carrier.email, input.carrier.address]
    .filter(Boolean)
    .join('  ·  ');
  if (contactLine) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(contactLine, left, leftY, { width: headerLeftW });
    leftY = doc.y;
  }
  const regLine = [
    input.carrier.mcNumber ? `MC ${input.carrier.mcNumber}` : '',
    input.carrier.dotNumber ? `US DOT ${input.carrier.dotNumber}` : '',
  ].filter(Boolean).join('  ·  ');
  if (regLine) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(regLine, left, leftY + 2, { width: headerLeftW });
    leftY = doc.y;
  }

  // Right: quote meta box.
  const metaX = right - metaBoxW;
  const metaRows: Array<[string, string]> = [
    ['Quote', input.refId],
    ['Issued', shortDate(input.generatedAt)],
    ['Valid until', shortDate(input.expiresAt)],
  ];
  const metaBoxH = 20 + metaRows.length * 16 + 8;
  doc.roundedRect(metaX, headerTop, metaBoxW, metaBoxH, 8).fill(PANEL);
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(9)
    .text('FREIGHT QUOTE', metaX + 12, headerTop + 10, { width: metaBoxW - 24, characterSpacing: 0.6 });
  let my = headerTop + 26;
  for (const [k, v] of metaRows) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(k, metaX + 12, my, { width: 70 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
      .text(v, metaX + 12, my, { width: metaBoxW - 24, align: 'right' });
    my += 16;
  }

  doc.y = Math.max(leftY, headerTop + metaBoxH) + 18;

  // ── Lane summary strip ─────────────────────────────────────────────────────
  const laneTop = doc.y;
  const laneH = 58;
  ensureSpace(laneH + 10);
  doc.roundedRect(left, laneTop, contentW, laneH, 8).fill(PANEL);
  const gutter = 34; // center lane for the pickup→delivery arrow
  const colW = (contentW - 24 - gutter) / 2;
  const pickupX = left + 12;
  const deliveryX = left + 12 + colW + gutter;
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('PICKUP', pickupX, laneTop + 10, { width: colW, characterSpacing: 0.5 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(input.lane.pickup, pickupX, laneTop + 22, { width: colW });
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('DELIVERY', deliveryX, laneTop + 10, { width: colW, characterSpacing: 0.5 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(input.lane.delivery, deliveryX, laneTop + 22, { width: colW });
  // Pickup→delivery arrow, drawn as a vector shape (the Unicode "→" glyph is
  // absent from the WinAnsi standard fonts, so drawing it keeps it crisp + safe).
  const arrY = laneTop + laneH / 2;
  const arrX = left + 12 + colW + 8;
  doc.save();
  doc.strokeColor(accent).lineWidth(1.5).moveTo(arrX, arrY).lineTo(arrX + 12, arrY).stroke();
  doc.fillColor(accent).moveTo(arrX + 11, arrY - 4).lineTo(arrX + 18, arrY).lineTo(arrX + 11, arrY + 4).fill();
  doc.restore();
  doc.y = laneTop + laneH + 16;

  // ── Shipment facts row ─────────────────────────────────────────────────────
  const facts: Array<[string, string]> = [];
  if (input.service) facts.push(['Service', input.service]);
  if (typeof input.distanceMiles === 'number' && Number.isFinite(input.distanceMiles)) {
    facts.push(['Distance', `${Math.round(input.distanceMiles).toLocaleString('en-US')} mi`]);
  }
  if (input.transitText) facts.push(['Est. transit', input.transitText]);
  if (facts.length) {
    ensureSpace(40);
    const factW = contentW / facts.length;
    const factY = doc.y;
    let maxValH = 0;
    facts.forEach(([k, v], i) => {
      const fx = left + i * factW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(k.toUpperCase(), fx, factY, { width: factW - 8, characterSpacing: 0.4 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(v, fx, factY + 12, { width: factW - 8 });
      // Advance past the TALLEST value cell so a wrapped label (e.g. a long
      // service name) never collides with the next section.
      maxValH = Math.max(maxValH, doc.heightOfString(v, { width: factW - 8 }));
    });
    doc.y = factY + 12 + maxValH + 14;
  }

  // ── Pricing breakdown ──────────────────────────────────────────────────────
  ensureSpace(40);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('Pricing breakdown', left, doc.y);
  doc.moveTo(left, doc.y + 4).lineTo(right, doc.y + 4).lineWidth(1).strokeColor(HAIRLINE).stroke();
  doc.y += 12;

  const amountW = 110;
  const labelW = contentW - amountW - 8;
  const groups = groupLines(input.breakdown);
  if (!groups.length) {
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10).text('No pricing breakdown is available for this quote.', left, doc.y, { width: contentW });
    doc.y += 6;
  }
  for (const group of groups) {
    ensureSpace(26);
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(9).text(group.heading.toUpperCase(), left, doc.y, { characterSpacing: 0.5 });
    doc.y += 4;
    for (const line of group.rows) {
      const label = line.name || 'Charge';
      const amount = money(line.amount, currency);
      doc.font('Helvetica').fontSize(10).fillColor(INK);
      const labelH = doc.heightOfString(label, { width: labelW });
      let noteH = 0;
      const rowY = doc.y;
      ensureSpace(labelH + 14);
      const y = doc.y;
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(label, left, y, { width: labelW });
      if (line.note) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(line.note, left, y + labelH + 1, { width: labelW });
        noteH = doc.heightOfString(line.note, { width: labelW }) + 1;
      }
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(amount, left, y, { width: contentW, align: 'right' });
      doc.y = y + labelH + noteH + 6;
      doc.moveTo(left, doc.y - 3).lineTo(right, doc.y - 3).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
      void rowY;
    }
    doc.y += 6;
  }

  // ── Grand total band ───────────────────────────────────────────────────────
  ensureSpace(46);
  const totalY = doc.y;
  const totalH = 40;
  doc.roundedRect(left, totalY, contentW, totalH, 8).fill(primary);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('Estimated Total', left + 16, totalY + 14, { width: contentW / 2 });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(money(input.total, currency), left, totalY + 10, { width: contentW - 16, align: 'right' });
  doc.y = totalY + totalH + 18;

  // ── Terms / disclaimer ─────────────────────────────────────────────────────
  if (input.disclaimer) {
    ensureSpace(40);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Terms & Conditions', left, doc.y);
    doc.y += 4;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(input.disclaimer, left, doc.y, { width: contentW, lineGap: 1 });
    doc.y += 10;
  }

  // ── Footer on every page: hairline, issued-by, optional badge ──────────────
  // The footer sits in the bottom-margin band; zero the bottom margin per page
  // first so PDFKit's flowing-text auto-pagination doesn't spill it to a new page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 40;
    doc.moveTo(left, fy).lineTo(right, fy).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(`Quote issued by ${input.carrier.name}`, left, fy + 8, { width: contentW * 0.7, lineBreak: false });
    if (hasBadge) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text('Powered by QuoteFleet', left, fy + 8, { width: contentW, align: 'right', lineBreak: false });
    }
  }

  doc.end();
  return done;
}
