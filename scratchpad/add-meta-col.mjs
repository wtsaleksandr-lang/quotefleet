import 'dotenv/config';
import postgres from '../node_modules/postgres/src/index.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('NO DATABASE_URL'); process.exit(2); }
const sql = postgres(url);
try {
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_json jsonb`;
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name='meta_json'`;
  console.log('meta_json present:', cols.length === 1);
} catch (e) {
  console.error('ERR', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
