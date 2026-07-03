import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { accessorials, laneZones, rateCards, tenants } from '../src/db/schema.js';

type Row = Record<string, unknown>;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((x) => x.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

function key(row: Row, names: string[]): unknown {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [k, v] of Object.entries(row)) {
    if (wanted.has(k.trim().toLowerCase())) return v;
  }
  return undefined;
}

function str(row: Row, names: string[], fallback = ''): string {
  const v = key(row, names);
  return v == null ? fallback : String(v).trim();
}

function num(row: Row, names: string[], fallback = 0): number {
  const v = key(row, names);
  if (v == null || v === '') return fallback;
  const n = Number(String(v).replace(/[$,%]/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function bool(row: Row, names: string[], fallback = true): boolean {
  const v = key(row, names);
  if (v == null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  return ['true', 'yes', 'y', '1', 'enabled', 'active'].includes(s);
}

function arr(row: Row, names: string[]): string[] | undefined {
  const v = str(row, names);
  if (!v) return undefined;
  return v.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
}

function nullableNumber(row: Row, names: string[]): number | null {
  const v = key(row, names);
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[$,%]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function workbookRows(filePath: string): Record<string, Row[]> {
  const wb = XLSX.readFile(filePath);
  const out: Record<string, Row[]> = {};
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    out[sheetName.toLowerCase().trim()] = XLSX.utils.sheet_to_json<Row>(ws, { defval: '' });
  }
  return out;
}

function firstSheet(sheets: Record<string, Row[]>, candidates: string[]): Row[] {
  for (const name of candidates) {
    const rows = sheets[name.toLowerCase()];
    if (rows) return rows;
  }
  return [];
}

async function tenantIdForSlug(slug: string): Promise<number> {
  const rows = await db().select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!rows[0]) throw new Error(`Tenant not found: ${slug}`);
  return rows[0].id;
}

async function upsertRateCards(tenantId: number, rows: Row[]) {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const service = str(row, ['service']);
    const equipment = str(row, ['equipment', 'equipment_type']);
    if (!service || !equipment) continue;
    const patch = {
      service,
      equipment,
      label: str(row, ['label', 'name']) || null,
      ratePerMile: num(row, ['ratePerMile', 'rate_per_mile', 'rpm'], 0),
      minimumCharge: num(row, ['minimumCharge', 'minimum_charge', 'minimum', 'min'], 0),
      flatFee: num(row, ['flatFee', 'flat_fee', 'flat'], 0),
      fuelSurchargePct: num(row, ['fuelSurchargePct', 'fuel_surcharge_pct', 'fuel'], 0),
      marginPct: num(row, ['marginPct', 'margin_pct', 'margin'], 0),
      maxWeightLbs: nullableNumber(row, ['maxWeightLbs', 'max_weight_lbs']),
      maxMiles: nullableNumber(row, ['maxMiles', 'max_miles']),
      enabled: bool(row, ['enabled', 'active'], true),
      sortOrder: num(row, ['sortOrder', 'sort_order'], 0),
      notes: str(row, ['notes']) || null,
      updatedAt: new Date(),
    };
    const existing = await db()
      .select({ id: rateCards.id })
      .from(rateCards)
      .where(and(eq(rateCards.tenantId, tenantId), eq(rateCards.service, service), eq(rateCards.equipment, equipment)))
      .limit(1);
    if (existing[0]) {
      await db().update(rateCards).set(patch).where(eq(rateCards.id, existing[0].id));
      updated++;
    } else {
      await db().insert(rateCards).values({ ...patch, tenantId });
      inserted++;
    }
  }
  return { inserted, updated };
}

async function upsertAccessorials(tenantId: number, rows: Row[]) {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const code = str(row, ['code']);
    const label = str(row, ['label', 'name']);
    if (!code || !label) continue;
    const patch = {
      code,
      label,
      description: str(row, ['description', 'desc']) || null,
      kind: str(row, ['kind', 'type'], 'flat'),
      amount: num(row, ['amount', 'rate', 'price'], 0),
      trigger: str(row, ['trigger'], 'optional'),
      appliesToServices: arr(row, ['appliesToServices', 'applies_to_services', 'services']),
      enabled: bool(row, ['enabled', 'active'], true),
      sortOrder: num(row, ['sortOrder', 'sort_order'], 0),
      updatedAt: new Date(),
    };
    const existing = await db()
      .select({ id: accessorials.id })
      .from(accessorials)
      .where(and(eq(accessorials.tenantId, tenantId), eq(accessorials.code, code)))
      .limit(1);
    if (existing[0]) {
      await db().update(accessorials).set(patch).where(eq(accessorials.id, existing[0].id));
      updated++;
    } else {
      await db().insert(accessorials).values({ ...patch, tenantId });
      inserted++;
    }
  }
  return { inserted, updated };
}

async function upsertLaneZones(tenantId: number, rows: Row[]) {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const label = str(row, ['label', 'name']);
    if (!label) continue;
    const patch = {
      label,
      anchorPortCode: str(row, ['anchorPortCode', 'anchor_port_code', 'portCode', 'port_code']) || null,
      anchorCity: str(row, ['anchorCity', 'anchor_city', 'city']) || null,
      anchorState: str(row, ['anchorState', 'anchor_state', 'state']) || null,
      radiusMiles: num(row, ['radiusMiles', 'radius_miles', 'radius'], 0),
      flatPrice: num(row, ['flatPrice', 'flat_price', 'price'], 0),
      equipmentScope: arr(row, ['equipmentScope', 'equipment_scope', 'equipment']),
      enabled: bool(row, ['enabled', 'active'], true),
      sortOrder: num(row, ['sortOrder', 'sort_order'], 0),
      updatedAt: new Date(),
    };
    const existing = await db()
      .select({ id: laneZones.id })
      .from(laneZones)
      .where(and(eq(laneZones.tenantId, tenantId), eq(laneZones.label, label)))
      .limit(1);
    if (existing[0]) {
      await db().update(laneZones).set(patch).where(eq(laneZones.id, existing[0].id));
      updated++;
    } else {
      await db().insert(laneZones).values({ ...patch, tenantId });
      inserted++;
    }
  }
  return { inserted, updated };
}

async function main() {
  const slug = arg('tenant-slug') || process.env.TENANT_SLUG;
  const file = arg('file') || process.argv[2];
  if (!slug) throw new Error('Missing --tenant-slug=YOUR_SLUG');
  if (!file) throw new Error('Missing --file=/path/to/rates.xlsx');
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const tenantId = await tenantIdForSlug(slug);
  const sheets = workbookRows(filePath);
  const rateRows = firstSheet(sheets, ['rate cards', 'rate_cards', 'rates']);
  const accessorialRows = firstSheet(sheets, ['accessorials', 'add-ons', 'addons']);
  const zoneRows = firstSheet(sheets, ['lane zones', 'lane_zones', 'zones']);

  const rates = await upsertRateCards(tenantId, rateRows);
  const extras = await upsertAccessorials(tenantId, accessorialRows);
  const zones = await upsertLaneZones(tenantId, zoneRows);

  console.log(JSON.stringify({ tenantSlug: slug, rateCards: rates, accessorials: extras, laneZones: zones }, null, 2));
}

main().catch((err) => {
  console.error('[rates:import] failed:', err);
  process.exit(1);
});
