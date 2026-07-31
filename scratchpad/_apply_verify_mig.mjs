import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) { console.error('NO DATABASE_URL'); process.exit(2); }
const c = postgres(url, { max: 1 });
try {
  await migrate(drizzle(c), { migrationsFolder: 'drizzle' });
  console.log('MIGRATE_OK');
  const cols = await c`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where (table_name='brand_configs' and column_name='map_blend')
       or (table_name='leads' and column_name='meta_json')
    order by table_name, column_name`;
  console.log(JSON.stringify(cols, null, 2));
} catch (e) {
  console.error('MIGRATE_FAIL', e?.message || e);
  process.exitCode = 1;
} finally {
  await c.end();
}
