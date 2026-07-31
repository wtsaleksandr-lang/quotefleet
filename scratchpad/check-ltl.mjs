import 'dotenv/config';
import postgres from '../node_modules/postgres/src/index.js';
const sql = postgres(process.env.DATABASE_URL);
try {
  const rows = await sql`SELECT ref_id, service, freight_class, quoted_total, meta_json FROM leads WHERE customer_email='ltl-verify@example.com' ORDER BY created_at DESC LIMIT 1`;
  console.log(JSON.stringify(rows[0] ?? {notfound:true}, null, 2));
} finally { await sql.end(); }
