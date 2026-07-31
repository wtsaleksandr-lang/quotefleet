import 'dotenv/config';
import postgres from '../node_modules/postgres/src/index.js';
const sql = postgres(process.env.DATABASE_URL);
const ref = process.argv[2];
try {
  const rows = await sql`SELECT ref_id, service, freight_class, density_pcf, meta_json FROM leads WHERE ref_id=${ref} LIMIT 1`;
  console.log(JSON.stringify(rows[0] ?? { notfound: ref }, null, 2));
} finally { await sql.end(); }
