import { desc } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { leads } from '../src/db/schema.js';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((x) => x.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

async function main() {
  const limit = Math.min(100, Math.max(1, Number(arg('limit') || '10') || 10));
  const rows = await db()
    .select({
      refId: leads.refId,
      status: leads.status,
      customerName: leads.customerName,
      customerEmail: leads.customerEmail,
      pickupCity: leads.pickupCity,
      pickupState: leads.pickupState,
      deliveryCity: leads.deliveryCity,
      deliveryState: leads.deliveryState,
      total: leads.quotedTotal,
      currency: leads.quotedCurrency,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .orderBy(desc(leads.createdAt))
    .limit(limit);

  if (rows.length === 0) {
    console.log('No quote leads found. Submit a quote from the widget first.');
    return;
  }

  console.table(
    rows.map((r) => ({
      refId: r.refId,
      status: r.status,
      customer: r.customerName || r.customerEmail || '-',
      lane: `${[r.pickupCity, r.pickupState].filter(Boolean).join(', ') || '?'} -> ${[r.deliveryCity, r.deliveryState].filter(Boolean).join(', ') || '?'}`,
      total: r.total == null ? '-' : `${r.currency || 'USD'} ${Number(r.total).toFixed(2)}`,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      quoteUrl: `/quote/${r.refId}`,
    }))
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[quotes:recent] failed:', err);
    process.exit(1);
  });
