import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { tenants, accessorials } from '../src/db/schema.js';
import { DEFAULT_ACCESSORIALS } from '../src/calc/defaults.js';
import { EXPANDED_ACCESSORIAL_LIBRARY } from '../src/calc/accessorialLibrary.js';

const ALL_LIBRARY_ITEMS = [...DEFAULT_ACCESSORIALS, ...EXPANDED_ACCESSORIAL_LIBRARY];

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

async function main() {
  const tenantSlug = argValue('tenant-slug') || process.env.TENANT_SLUG;
  const tenantRows = tenantSlug
    ? await db().select().from(tenants).where(eq(tenants.slug, tenantSlug))
    : await db().select().from(tenants);

  if (tenantSlug && tenantRows.length === 0) {
    throw new Error(`Tenant not found for slug: ${tenantSlug}`);
  }

  let insertedTotal = 0;

  for (const tenant of tenantRows) {
    const existing = await db()
      .select({ code: accessorials.code })
      .from(accessorials)
      .where(eq(accessorials.tenantId, tenant.id));
    const existingCodes = new Set(existing.map((row) => row.code));
    const missing = ALL_LIBRARY_ITEMS.filter((item) => !existingCodes.has(item.code));

    if (missing.length === 0) {
      console.log(`[accessorials] ${tenant.slug}: already up to date`);
      continue;
    }

    await db().insert(accessorials).values(
      missing.map((item) => ({
        ...item,
        tenantId: tenant.id,
      }))
    );

    insertedTotal += missing.length;
    console.log(`[accessorials] ${tenant.slug}: inserted ${missing.length} missing add-ons`);
  }

  console.log(`[accessorials] done. tenants=${tenantRows.length}, inserted=${insertedTotal}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[accessorials] failed:', err);
    process.exit(1);
  });
