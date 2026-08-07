import { readFileSync } from 'node:fs';
const KEY = process.env.CF_KEY;
const SECRET = process.env.INBOUND_WEBHOOK_SECRET;
const ACCT = '653c7ef13d4439532fb4a1a78b0555ad';
const NAME = 'qf-rate-email';
if (!KEY || !SECRET) { console.error('missing CF_KEY or INBOUND_WEBHOOK_SECRET'); process.exit(1); }

const code = readFileSync(new URL('./bundle.mjs', import.meta.url));
const metadata = {
  main_module: 'bundle.mjs',
  compatibility_date: '2024-11-01',
  bindings: [{ type: 'secret_text', name: 'INBOUND_WEBHOOK_SECRET', text: SECRET }],
};
const fd = new FormData();
fd.append('metadata', JSON.stringify(metadata));
fd.append('bundle.mjs', new Blob([code], { type: 'application/javascript+module' }), 'bundle.mjs');

const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/workers/scripts/${NAME}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${KEY}` },
  body: fd,
});
const j = await r.json();
if (j.success) {
  console.log('DEPLOY OK — worker:', NAME, '| has_email_handler check next | modified:', j.result?.modified_on);
} else {
  console.log('DEPLOY FAIL:', JSON.stringify(j.errors || j).slice(0, 400));
  process.exit(1);
}
