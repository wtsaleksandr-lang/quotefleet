/**
 * Branded carrier-list EXPORT generator — the printable/shareable HTML sheet,
 * the XLSX download and the CSV download for a FILTERED directory carrier list.
 *
 * This module is the ONE place the export's shape lives, so the three surfaces
 * (print/share HTML · .xlsx · .csv) never drift: they all consume the same
 * `ExportRow[]` produced by `carrierToExportRow`, in the same `EXPORT_COLUMNS`
 * order. It is deliberately split into:
 *
 *   • PURE generation  — `buildRows`, `renderExportHtml`, `buildExportXlsx`,
 *     `buildExportCsv`, `describeFilters`. No DB, no network → unit-testable by
 *     handing in a plain `VisibleCarrier[]`.
 *   • RESOLUTION       — `resolveExport` turns a directory filter querystring
 *     (or `?dots=`) into the capped carrier set. Its DB access is behind an
 *     injectable `ExportStore` (default `dbExportStore`) so tests inject a fake
 *     store and never touch a database.
 *
 * Data reuse: filters are parsed with the directory's own `normalizeFilters`
 * and rows are resolved with the directory's exported query primitives
 * (`buildConditions` + `orderForSort` + `visibleCarrier`) — the SAME carriers a
 * `/directory` filter querystring selects — so an export is always consistent
 * with the on-site results.
 *
 * Contact opt-out: a carrier with `contactHidden` (FMCSA opt-out OR an admin
 * `carrier_overrides.hidden`) has BOTH phone and email suppressed to "—", the
 * same rule the public profile applies. Suppressed contacts never leak into any
 * export surface.
 *
 * Account-gating seam: `EXPORT_MAX_ROWS` (env, default 500) caps every export
 * and `canExport(req)` (in the route module) is a single true-returning stub —
 * Pro limits / auth attach there later without reshaping this generator.
 */
import * as XLSX from 'xlsx';
import { and, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierDirectory } from '../../db/schema.js';
import {
  buildConditions,
  orderForSort,
  visibleCarrier,
  normalizeFilters,
  EQUIPMENT_OPTIONS,
  CARGO_OPTIONS,
  FLEET_BUCKETS,
  DRIVERS_BUCKETS,
  titleCaseCity,
  type DirectoryFilters,
  type VisibleCarrier,
} from './queries.js';
import { portByCode } from './containerPorts.js';
import { stateByCode, stateBySlug } from './usStates.js';
import { esc, carrierName, layout } from './pages.js';

/** Hard cap on export size (env-overridable). The account-gating seam: Pro
 *  limits later read/override this; today it's one number, one place. */
export const DEFAULT_EXPORT_MAX_ROWS = 500;

/** Resolve the effective row cap from the environment (clamped 1..5000). */
export function exportMaxRows(): number {
  const raw = parseInt(String(process.env.EXPORT_MAX_ROWS ?? ''), 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_EXPORT_MAX_ROWS;
  return Math.min(5000, raw);
}

// ─── Column model — SINGLE source of truth for order + labels ──────────────
export const EXPORT_COLUMNS = [
  { key: 'company', label: 'Company' },
  { key: 'usdot', label: 'USDOT' },
  { key: 'mc', label: 'MC' },
  { key: 'location', label: 'Location' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'powerUnits', label: 'Power units' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'authority', label: 'Authority' },
  { key: 'safety', label: 'Safety' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'cargo', label: 'Cargo specialties' },
  { key: 'nearestPort', label: 'Nearest port' },
] as const;

export interface ExportRow {
  company: string;
  usdot: string;
  mc: string;
  location: string;
  phone: string;
  email: string;
  powerUnits: number | null;
  drivers: number | null;
  authority: string;
  safety: string;
  equipment: string;
  cargo: string;
  nearestPort: string;
}

const DASH = '—';

/** FMCSA safety-rating letter → readable label (mirrors pages.ts safetyLabel). */
function safetyText(code: string | null): string {
  switch ((code || '').toUpperCase()) {
    case 'S':
      return 'Satisfactory';
    case 'C':
      return 'Conditional';
    case 'U':
      return 'Unsatisfactory';
    default:
      return 'Not rated';
  }
}

/** FMCSA authority_type → readable label (mirrors pages.ts authorityLabel). */
function authorityText(type: string | null): string {
  if (!type || !type.trim()) return DASH;
  const parts = type.split(',').map((p) => p.trim()).filter(Boolean);
  const nice = parts.map((p) => (p === 'common' ? 'Common' : p === 'contract' ? 'Contract' : p));
  return nice.length ? nice.join(' + ') + ' authority' : 'Authority on file';
}

/** Comma-joined labels for every equipment flag the carrier holds. */
function equipmentText(c: VisibleCarrier): string {
  const labels = EQUIPMENT_OPTIONS.filter((o) => c[o.column] === true).map((o) => o.label);
  return labels.length ? labels.join(', ') : DASH;
}

/** Comma-joined labels for every FMCSA cargo-specialty flag the carrier holds. */
function cargoText(c: VisibleCarrier): string {
  const labels = CARGO_OPTIONS.filter((o) => c[o.column] === true).map((o) => o.label);
  return labels.length ? labels.join(', ') : DASH;
}

function locationText(c: VisibleCarrier): string {
  const city = c.city ? titleCaseCity(c.city) : '';
  const parts = [city, c.state ?? ''].map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : DASH;
}

/**
 * Shape ONE carrier into an export row. Contact opt-out is applied HERE (the one
 * gate): a `contactHidden` carrier gets phone + email replaced by "—", so no
 * suppressed contact can reach any export surface.
 */
export function carrierToExportRow(c: VisibleCarrier): ExportRow {
  const hidden = c.contactHidden === true;
  const phone = hidden ? DASH : (c.phone && c.phone.trim()) || DASH;
  const email = hidden ? DASH : (c.email && c.email.trim()) || DASH;
  return {
    company: carrierName(c),
    usdot: c.usdot || DASH,
    mc: (c.mcNumber && c.mcNumber.trim()) || DASH,
    location: locationText(c),
    phone,
    email,
    powerUnits: c.powerUnits,
    drivers: c.drivers,
    authority: authorityText(c.authorityType),
    safety: safetyText(c.safetyRating),
    equipment: equipmentText(c),
    cargo: cargoText(c),
    nearestPort: portByCode(c.nearestPortCode)?.name ?? DASH,
  };
}

export function buildRows(carriers: VisibleCarrier[]): ExportRow[] {
  return carriers.map(carrierToExportRow);
}

// ─── Cell serialization per surface ────────────────────────────────────────
const NUMERIC_KEYS = new Set(['powerUnits', 'drivers']);

/** Display cell (HTML): thousands-formatted numbers, "—" for blanks. */
function cellDisplay(row: ExportRow, key: string): string {
  const v = (row as unknown as Record<string, unknown>)[key];
  if (v == null) return DASH;
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return String(v);
}

/** Raw scalar for spreadsheet/CSV: number stays a number, blank numeric → "". */
function cellRaw(row: ExportRow, key: string): string | number {
  const v = (row as unknown as Record<string, unknown>)[key];
  if (NUMERIC_KEYS.has(key)) return typeof v === 'number' ? v : '';
  if (v == null) return '';
  return String(v);
}

// ─── Filter summary ────────────────────────────────────────────────────────
/**
 * One-line, human-readable description of the active facet selection, e.g.
 * "Texas · Reefer · Good standing". Empty selection → "All carriers".
 */
export function describeFilters(filters: DirectoryFilters): string {
  const bits: string[] = [];
  if (filters.state) bits.push(stateByCode(filters.state)?.name ?? filters.state);
  if (filters.citySlug) {
    bits.push(
      filters.citySlug
        .split('-')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
    );
  }
  if (filters.port) bits.push(portByCode(filters.port)?.name ?? filters.port);
  for (const id of filters.equipment) {
    bits.push(EQUIPMENT_OPTIONS.find((o) => o.id === id)?.label ?? id);
  }
  for (const id of filters.cargo) {
    bits.push(CARGO_OPTIONS.find((o) => o.id === id)?.label ?? id);
  }
  if (filters.fleet) bits.push(FLEET_BUCKETS.find((b) => b.id === filters.fleet)?.label ?? filters.fleet);
  if (filters.drivers) bits.push(DRIVERS_BUCKETS.find((b) => b.id === filters.drivers)?.label ?? filters.drivers);
  if (filters.goodStandingOnly) bits.push('Good standing');
  if (filters.authorityActive) bits.push('Active authority');
  if (filters.recent) bits.push('Recently updated');
  return bits.length ? bits.join(' · ') : 'All carriers';
}

// ─── Resolution (DB-backed, injectable) ────────────────────────────────────
export interface ExportListResult {
  carriers: VisibleCarrier[];
  /** Full number of carriers matching the request BEFORE the cap (the "M"). */
  total: number;
}

/** DB access behind the export resolver — swapped for a fake in tests. */
export interface ExportStore {
  byFilters(filters: DirectoryFilters, limit: number): Promise<ExportListResult>;
  byDots(dots: string[], limit: number): Promise<ExportListResult>;
}

/**
 * Accept a state as EITHER a 2-letter code (`?state=TX`) or a directory slug
 * (`?state=texas`, `?state=new-york`). `normalizeFilters` only understands the
 * code, so coerce a slug to its code here — keeping the export link forgiving
 * of both the on-site facet form and a hand-typed share URL.
 */
function coerceStateSlug(rawQuery: Record<string, unknown>): Record<string, unknown> {
  const s = String(rawQuery.state ?? '').trim();
  if (!s || /^[A-Za-z]{2}$/.test(s)) return rawQuery;
  const code = stateBySlug(s)?.code;
  return code ? { ...rawQuery, state: code } : rawQuery;
}

/** Normalize a raw USDOT token: digits only, leading zeros stripped. */
function normalizeDot(raw: string): string {
  const digits = String(raw).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits;
}

/** Parse `?dots=D1,D2,…` (comma list or repeated param) → clean, de-duped dots. */
export function parseDots(raw: unknown): string[] {
  const parts: string[] = [];
  const push = (v: unknown) => {
    for (const piece of String(v ?? '').split(',')) {
      const d = normalizeDot(piece.trim());
      if (d) parts.push(d);
    }
  };
  if (Array.isArray(raw)) for (const v of raw) push(v);
  else push(raw);
  return [...new Set(parts)];
}

/** Default DB store: reuses the directory's exported query primitives. */
export const dbExportStore: ExportStore = {
  async byFilters(filters, limit) {
    try {
      const conditions = buildConditions(filters);
      const where = conditions.length ? and(...conditions) : undefined;
      const totalRow = await db().select({ n: sql<number>`count(*)::int` }).from(carrierDirectory).where(where);
      const total = totalRow[0]?.n ?? 0;
      const rows = await db()
        .select()
        .from(carrierDirectory)
        .where(where)
        .orderBy(...orderForSort(filters.sort, filters.dir))
        .limit(limit);
      return { carriers: rows.map(visibleCarrier), total };
    } catch (err) {
      console.warn('[directory-export] byFilters failed; serving empty export:', err);
      return { carriers: [], total: 0 };
    }
  },
  async byDots(dots, limit) {
    if (dots.length === 0) return { carriers: [], total: 0 };
    try {
      const rows = await db()
        .select()
        .from(carrierDirectory)
        .where(inArray(carrierDirectory.usdot, dots.slice(0, limit)))
        .orderBy(...orderForSort('featured'))
        .limit(limit);
      // Total = distinct requested dots (the shortlist the user asked for).
      return { carriers: rows.map(visibleCarrier), total: dots.length };
    } catch (err) {
      console.warn('[directory-export] byDots failed; serving empty export:', err);
      return { carriers: [], total: 0 };
    }
  },
};

export interface ResolvedExport {
  mode: 'filters' | 'dots';
  filters: DirectoryFilters;
  carriers: VisibleCarrier[];
  rows: ExportRow[];
  summary: string;
  /** Rows shown (capped) — the "N" in "showing first N of M". */
  shown: number;
  /** Full match count — the "M". */
  total: number;
  capped: boolean;
  maxRows: number;
  generatedAt: Date;
  /** The querystring that reproduces this export (for the .xlsx/.csv links). */
  query: string;
}

export interface ResolveExportOpts {
  store?: ExportStore;
  maxRows?: number;
  now?: Date;
  /** Raw querystring (no leading "?") to embed in the download links. */
  query?: string;
}

/**
 * Resolve a directory filter querystring (or `?dots=`) into the capped carrier
 * set + generated rows. Pure w.r.t. the DB via the injected `store`.
 */
export async function resolveExport(
  rawQuery: Record<string, unknown>,
  opts: ResolveExportOpts = {},
): Promise<ResolvedExport> {
  const store = opts.store ?? dbExportStore;
  const maxRows = Math.max(1, Math.floor(opts.maxRows ?? exportMaxRows()));
  const generatedAt = opts.now ?? new Date();
  const filters = normalizeFilters(coerceStateSlug(rawQuery));
  const dots = parseDots(rawQuery.dots);

  let mode: 'filters' | 'dots';
  let result: ExportListResult;
  let summary: string;
  if (dots.length > 0) {
    mode = 'dots';
    result = await store.byDots(dots, maxRows);
    summary = `Selected carriers (${dots.length})`;
  } else {
    mode = 'filters';
    result = await store.byFilters(filters, maxRows);
    summary = describeFilters(filters);
  }

  const carriers = result.carriers.slice(0, maxRows);
  const total = Math.max(result.total, carriers.length);
  return {
    mode,
    filters,
    carriers,
    rows: buildRows(carriers),
    summary,
    shown: carriers.length,
    total,
    capped: total > carriers.length,
    maxRows,
    generatedAt,
    query: opts.query ?? '',
  };
}

// ─── CSV ───────────────────────────────────────────────────────────────────
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV with three title rows (title · filter summary · generated), a blank line,
 * the column-header row, then data. Same columns + order as every surface.
 */
export function buildExportCsv(r: ResolvedExport): string {
  const lines: string[] = [];
  lines.push(csvCell('QuoteFleet — Carrier shortlist'));
  lines.push(csvCell(r.summary));
  lines.push(csvCell(`Showing ${r.shown} of ${r.total} carriers · Generated ${formatDate(r.generatedAt)}`));
  lines.push('');
  lines.push(EXPORT_COLUMNS.map((c) => csvCell(c.label)).join(','));
  for (const row of r.rows) {
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(cellRaw(row, c.key))).join(','));
  }
  return lines.join('\r\n');
}

// ─── XLSX (SheetJS — already a dependency; no new package) ──────────────────
/**
 * Real .xlsx workbook: three title rows, the column-header row, then data. Sets
 * sensible per-column widths. (Frozen header panes are a SheetJS-Pro-only write
 * feature, so the community build we ship can't emit them — the header row is
 * still the first data row and clearly styled as a header.)
 */
export function buildExportXlsx(r: ResolvedExport): Buffer {
  const header = EXPORT_COLUMNS.map((c) => c.label);
  const aoa: (string | number)[][] = [
    ['QuoteFleet — Carrier shortlist'],
    [r.summary],
    [`Showing ${r.shown} of ${r.total} carriers · Generated ${formatDate(r.generatedAt)}`],
    [],
    header,
    ...r.rows.map((row) => EXPORT_COLUMNS.map((c) => cellRaw(row, c.key))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 30 }, // Company
    { wch: 10 }, // USDOT
    { wch: 10 }, // MC
    { wch: 22 }, // Location
    { wch: 18 }, // Phone
    { wch: 28 }, // Email
    { wch: 12 }, // Power units
    { wch: 10 }, // Drivers
    { wch: 22 }, // Authority
    { wch: 14 }, // Safety
    { wch: 30 }, // Equipment
    { wch: 30 }, // Cargo specialties
    { wch: 26 }, // Nearest port
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Carrier shortlist');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ─── Branded printable / shareable HTML ────────────────────────────────────
export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Scoped CSS for the export sheet. Tokens on-screen (both themes); print forces
 *  a clean light sheet, hides site chrome, and repeats the header row. */
const EXPORT_CSS = `
.qf-export { max-width: 1100px; margin: 0 auto; padding: 28px 16px 64px; }
.qf-export-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
.qf-export-btn { font: 600 13px/1 var(--font-mono, monospace); letter-spacing: 0.03em; padding: 10px 14px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--ink); text-decoration: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.qf-export-btn:hover { border-color: var(--border-strong); background: var(--surface-2); }
.qf-export-btn--primary { background: var(--accent-fill); border-color: var(--accent-fill); color: var(--accent-ink); }
.qf-export-sheet { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 28px; }
.qf-export-head { display: flex; align-items: center; gap: 20px; padding-bottom: 20px; margin-bottom: 20px; border-bottom: 2px solid var(--border-strong); flex-wrap: wrap; }
.qf-export-logo { height: 34px; width: auto; display: block; }
.qf-export-logo--light { display: none; }
html[data-theme="light"] .qf-export-logo--dark { display: none; }
html[data-theme="light"] .qf-export-logo--light { display: block; }
.qf-export-titles { text-align: left; }
.qf-export-titles h1 { margin: 0; font-size: 22px; line-height: 1.2; color: var(--ink); }
.qf-export-sub { margin: 6px 0 0; font-size: 14px; color: var(--ink-soft); }
.qf-export-meta { margin: 4px 0 0; font-size: 12px; color: var(--muted); font-family: var(--font-mono, monospace); letter-spacing: 0.02em; }
.qf-export-cap { margin: 0 0 16px; padding: 10px 14px; border-radius: 4px; background: var(--accent-soft); border: 1px solid var(--border); color: var(--ink-soft); font-size: 13px; }
.qf-export-tablewrap { overflow-x: auto; }
table.qf-export-table { width: 100%; border-collapse: collapse; font-size: 12px; }
table.qf-export-table th, table.qf-export-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
table.qf-export-table thead th { position: sticky; top: 0; background: var(--surface-2); color: var(--ink); font-weight: 700; white-space: nowrap; border-bottom: 2px solid var(--border-strong); }
table.qf-export-table td.num { font-family: var(--font-mono, monospace); white-space: nowrap; }
table.qf-export-table tbody tr:nth-child(even) { background: var(--surface-2); }
.qf-export-empty { padding: 32px; text-align: center; color: var(--muted); font-size: 14px; }
.qf-export-foot { margin: 20px 0 0; font-size: 11px; color: var(--muted); }
@media (max-width: 480px) {
  .qf-export { padding: 16px 10px 48px; }
  .qf-export-sheet { padding: 16px; }
  .qf-export-head { gap: 12px; }
}
@media print {
  .topnav, .site-footer, .qf-export-toolbar, .qf-theme-btn,
  .qf-mc-fab, .qf-mc-panel, .qf-mc-backdrop { display: none !important; }
  body { background: #ffffff !important; }
  .qf-export { max-width: none; padding: 0; }
  .qf-export-sheet { border: none; border-radius: 0; padding: 0; background: #ffffff !important; }
  .qf-export-titles h1, .qf-export-sub, table.qf-export-table th, table.qf-export-table td { color: #111111 !important; }
  .qf-export-logo--dark { display: none !important; }
  .qf-export-logo--light { display: block !important; }
  table.qf-export-table thead { display: table-header-group; }
  table.qf-export-table thead th { background: #f2f4f7 !important; color: #111111 !important; }
  table.qf-export-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
  table.qf-export-table tbody tr:nth-child(even) { background: #f7f9fb !important; }
  @page { margin: 14mm; }
}
`;

/** Render one <tr> for a carrier row, numeric cells right-tagged for styling. */
function rowHtml(row: ExportRow): string {
  const cells = EXPORT_COLUMNS.map((c) => {
    const cls = NUMERIC_KEYS.has(c.key) ? ' class="num"' : '';
    return `<td${cls}>${esc(cellDisplay(row, c.key))}</td>`;
  }).join('');
  return `<tr>${cells}</tr>`;
}

/**
 * The branded, print-optimized, shareable HTML page. Uses the shared `layout()`
 * shell (topnav/footer/fonts/theme) and drops the QuoteFleet logo + a clean
 * structured table into the body. This page IS the share link.
 */
export function renderExportHtml(r: ResolvedExport): string {
  const qs = r.query ? `?${r.query}` : '';
  const head = EXPORT_COLUMNS.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = r.rows.length
    ? r.rows.map(rowHtml).join('')
    : `<tr><td colspan="${EXPORT_COLUMNS.length}"><div class="qf-export-empty">No carriers match this filter.</div></td></tr>`;
  const capNote = r.capped
    ? `<p class="qf-export-cap">Showing the first ${r.shown.toLocaleString('en-US')} of ${r.total.toLocaleString(
        'en-US',
      )} matching carriers. Narrow the filters to see the rest.</p>`
    : '';
  const bodyHtml = `
  <style>${EXPORT_CSS}</style>
  <main class="qf-export">
    <div class="qf-export-toolbar" role="toolbar" aria-label="Export actions">
      <button type="button" class="qf-export-btn qf-export-btn--primary" onclick="window.print()">Print / Save PDF</button>
      <a class="qf-export-btn" href="/directory/export.xlsx${esc(qs)}">Download Excel</a>
      <a class="qf-export-btn" href="/directory/export.csv${esc(qs)}">Download CSV</a>
    </div>
    <section class="qf-export-sheet">
      <header class="qf-export-head">
        <img class="qf-export-logo qf-export-logo--dark" src="/brand/logo-full-ondark.png" alt="QuoteFleet" height="34" decoding="async">
        <img class="qf-export-logo qf-export-logo--light" src="/brand/logo-full.png" alt="QuoteFleet" height="34" decoding="async">
        <div class="qf-export-titles">
          <h1>Carrier shortlist</h1>
          <p class="qf-export-sub">${esc(r.summary)}</p>
          <p class="qf-export-meta">Showing ${r.shown.toLocaleString('en-US')} of ${r.total.toLocaleString(
            'en-US',
          )} carriers · Generated ${esc(formatDate(r.generatedAt))}</p>
        </div>
      </header>
      ${capNote}
      <div class="qf-export-tablewrap">
        <table class="qf-export-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="qf-export-foot">Carrier data sourced from public FMCSA records via QuoteFleet · quotefleet.net</p>
    </section>
  </main>`;
  return layout({
    title: 'Carrier shortlist — QuoteFleet',
    description: `QuoteFleet carrier shortlist — ${r.summary}. ${r.shown} carriers with contacts, equipment and cargo specialties.`,
    canonicalPath: `/directory/export/view${qs}`,
    bodyHtml,
  });
}
