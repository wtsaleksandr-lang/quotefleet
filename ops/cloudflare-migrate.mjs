#!/usr/bin/env node
/**
 * Cloudflare migration script
 * --------------------------------------------------------------------
 * Adds your Namecheap-registered domains to a Cloudflare account so
 * they get free Universal SSL (covers <domain> AND *.<domain>).
 *
 * Two phases:
 *   1. Add zones to Cloudflare. Cloudflare assigns 2 nameservers.
 *      Existing DNS records are imported via Cloudflare's scanner.
 *   2. Update Namecheap nameservers to point at Cloudflare.
 *      DNS propagation: 5-60 minutes. SSL issues automatically.
 *
 * Safety:
 *   - Defaults to --dry-run. Pass --do-it to actually make changes.
 *   - Phase 2 (NS update) only runs if you pass --update-ns.
 *   - Excluded domains (in EXCLUDED) are never touched.
 *   - Existing zones on Cloudflare are skipped, not duplicated.
 *
 * Prerequisites (READ THIS):
 *   - Whitelist your *server* IP in Namecheap → Profile → Tools →
 *     Namecheap API Access. The script tells you the IP it sees.
 *   - The Cloudflare API token must have:
 *       Permissions: Zone → Zone → Edit
 *                    Zone → DNS  → Edit  (for record import)
 *                    Account → Zone → Edit  (to create zones in account)
 *       Resources:  Include → All zones from an account → <your account>
 *
 * Usage:
 *   node cloudflare-migrate.mjs --user <namecheap-username> --account <cf-account-id>
 *       [--dry-run | --do-it] [--update-ns]
 *
 * Env:
 *   CF_API_TOKEN     — Cloudflare API token
 *   NC_API_KEY       — Namecheap API key
 *   NC_USER          — Namecheap username (or pass --user)
 *   CF_ACCOUNT_ID    — Cloudflare account ID (or pass --account)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { argv } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// ── Config ──────────────────────────────────────────────────────────
const EXCLUDED = new Set([
  'curalabs.shop',
  'medicine.recipes',
  'snorezaway.com',
]);

const args = parseArgs(argv.slice(2));
const DRY_RUN = !args['do-it'];
const UPDATE_NS = !!args['update-ns'];
const NC_USER = args.user ?? process.env.NC_USER;
const CF_ACCOUNT_ID = args.account ?? process.env.CF_ACCOUNT_ID;
const CF_TOKEN = process.env.CF_API_TOKEN;
const NC_KEY = process.env.NC_API_KEY;
const LOG_PATH = `./cloudflare-migrate-${new Date().toISOString().slice(0, 10)}.log`;

if (!CF_TOKEN) die('Set CF_API_TOKEN in env.');
if (!NC_KEY) die('Set NC_API_KEY in env.');
if (!NC_USER) die('Set NC_USER in env or pass --user <namecheap-username>.');

// ── Pre-flight ──────────────────────────────────────────────────────
console.log(banner('Cloudflare migration'));
console.log(`Mode:           ${DRY_RUN ? 'DRY RUN (no changes)' : '*** MAKING CHANGES ***'}`);
console.log(`Update NS:      ${UPDATE_NS ? 'YES' : 'no (phase 1 only)'}`);
console.log(`Excluded:       ${[...EXCLUDED].join(', ')}`);
console.log(`Log:            ${LOG_PATH}`);
console.log('');

const myIp = await detectIp();
console.log(`Your public IP: ${myIp}`);
console.log(`(This must be whitelisted in Namecheap → Profile → Tools → Namecheap API Access.)`);
console.log('');

// ── Cloudflare verify ───────────────────────────────────────────────
console.log('Verifying Cloudflare token…');
const cfVerify = await cfFetch('/user/tokens/verify');
if (!cfVerify.success) die(`Cloudflare token failed: ${JSON.stringify(cfVerify.errors)}`);
console.log(`✓ Cloudflare token: ${cfVerify.result.status}`);

if (!CF_ACCOUNT_ID) {
  console.log('No --account given, looking up your accounts…');
  const accounts = await cfFetch('/accounts?per_page=50');
  if (!accounts.success) die(`Account list failed: ${JSON.stringify(accounts.errors)}`);
  for (const a of accounts.result) console.log(`   ${a.id}   ${a.name}`);
  die('Pick one and pass --account <id>.');
}
console.log(`✓ Cloudflare account: ${CF_ACCOUNT_ID}`);
console.log('');

// ── Namecheap verify + list domains ─────────────────────────────────
console.log('Listing Namecheap domains…');
const ncDomains = await ncListDomains(myIp);
console.log(`✓ ${ncDomains.length} domains in Namecheap.`);

// ── Cloudflare existing zones ───────────────────────────────────────
console.log('Listing Cloudflare zones…');
const cfZones = await cfListZones(CF_ACCOUNT_ID);
console.log(`✓ ${cfZones.length} zones already on Cloudflare.`);
console.log('');

// ── Plan ────────────────────────────────────────────────────────────
const cfByName = new Map(cfZones.map((z) => [z.name.toLowerCase(), z]));
const plan = [];
for (const d of ncDomains) {
  const name = d.name.toLowerCase();
  if (EXCLUDED.has(name)) {
    plan.push({ name, action: 'skip', reason: 'excluded by user' });
    continue;
  }
  const existing = cfByName.get(name);
  if (existing) {
    plan.push({ name, action: 'reuse', reason: 'already on Cloudflare', zoneId: existing.id, ns: existing.name_servers });
    continue;
  }
  plan.push({ name, action: 'add', reason: 'will create zone' });
}

console.log(banner('Plan'));
console.log(plan.map((p) => `  [${p.action.padEnd(5)}] ${p.name.padEnd(32)} ${p.reason}`).join('\n'));
console.log('');
const summary = {
  add: plan.filter((p) => p.action === 'add').length,
  reuse: plan.filter((p) => p.action === 'reuse').length,
  skip: plan.filter((p) => p.action === 'skip').length,
};
console.log(`Add: ${summary.add} · Reuse: ${summary.reuse} · Skip: ${summary.skip}`);
console.log('');

if (DRY_RUN) {
  console.log('Dry run only — pass --do-it to actually create zones.');
  console.log('After --do-it, you will get the assigned nameservers per domain.');
  console.log('Then re-run with --do-it --update-ns to point Namecheap at them.');
  process.exit(0);
}

// ── Confirm ─────────────────────────────────────────────────────────
const rl = createInterface({ input, output });
const ans = await rl.question(
  `About to create ${summary.add} zones on Cloudflare. Continue? (yes/no) > `
);
if (ans.trim().toLowerCase() !== 'yes') {
  console.log('Aborted.');
  process.exit(0);
}

// ── Phase 1: create zones ───────────────────────────────────────────
const nsByDomain = new Map();
for (const item of plan) {
  if (item.action !== 'add') {
    if (item.action === 'reuse' && item.ns) nsByDomain.set(item.name, item.ns);
    continue;
  }
  process.stdout.write(`Creating zone ${item.name}… `);
  try {
    const r = await cfFetch('/zones', {
      method: 'POST',
      body: JSON.stringify({
        name: item.name,
        account: { id: CF_ACCOUNT_ID },
        type: 'full',
      }),
    });
    if (!r.success) {
      console.log(`✗ ${JSON.stringify(r.errors)}`);
      log({ name: item.name, action: 'add_failed', error: r.errors });
      continue;
    }
    nsByDomain.set(item.name, r.result.name_servers);
    console.log(`✓ ${r.result.name_servers.join(', ')}`);
    log({ name: item.name, action: 'added', ns: r.result.name_servers, zoneId: r.result.id });
  } catch (err) {
    console.log(`✗ ${err.message}`);
    log({ name: item.name, action: 'add_error', error: err.message });
  }
}

console.log('');
console.log(banner('Cloudflare nameservers per domain'));
for (const [name, ns] of nsByDomain) {
  console.log(`  ${name.padEnd(32)} ${ns.join(', ')}`);
}
console.log('');

if (!UPDATE_NS) {
  console.log('Phase 1 done. Re-run with --update-ns to point Namecheap at Cloudflare.');
  console.log(`Log written to ${LOG_PATH}.`);
  process.exit(0);
}

// ── Phase 2: update Namecheap NS ────────────────────────────────────
const ans2 = await rl.question(
  `\n*** This will change DNS for ${nsByDomain.size} domains. Email + sites resolve via\n` +
  `*** Cloudflare from now on. Continue? (yes/no) > `
);
if (ans2.trim().toLowerCase() !== 'yes') {
  console.log('Aborted phase 2. Phase 1 zones still exist on Cloudflare.');
  process.exit(0);
}

for (const [name, ns] of nsByDomain) {
  process.stdout.write(`Updating Namecheap NS for ${name}… `);
  try {
    const ok = await ncSetCustomNs(name, ns, myIp);
    if (ok) { console.log('✓'); log({ name, action: 'ns_updated', ns }); }
    else    { console.log('✗ (see Namecheap response)'); }
  } catch (err) {
    console.log(`✗ ${err.message}`);
    log({ name, action: 'ns_error', error: err.message });
  }
}

await rl.close();
console.log(`\nDone. SSL issues automatically once DNS propagates (5–60 min).`);
console.log(`Check zone status: cfFetch('/zones?account.id=${CF_ACCOUNT_ID}')`);
console.log(`Log: ${LOG_PATH}`);

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

function parseArgs(arr) {
  const o = {};
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = arr[i + 1];
    if (next && !next.startsWith('--')) { o[k] = next; i++; }
    else o[k] = true;
  }
  return o;
}

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }
function banner(s) { return `\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`; }

function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try {
    const prev = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf8') : '';
    writeFileSync(LOG_PATH, prev + line);
  } catch { /* swallow */ }
}

async function detectIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const j = await res.json();
    return j.ip;
  } catch {
    return '(unable to detect — set NC_CLIENT_IP env if needed)';
  }
}

async function cfFetch(path, init = {}) {
  const url = path.startsWith('http') ? path : `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return res.json();
}

async function cfListZones(accountId) {
  const out = [];
  let page = 1;
  while (true) {
    const r = await cfFetch(`/zones?account.id=${accountId}&per_page=50&page=${page}`);
    if (!r.success) throw new Error(`Zone list failed: ${JSON.stringify(r.errors)}`);
    out.push(...r.result);
    if (r.result.length < 50) break;
    page++;
  }
  return out;
}

// ── Namecheap (XML API, painful) ────────────────────────────────────
async function ncCall(command, params, clientIp) {
  const qs = new URLSearchParams({
    ApiUser: NC_USER,
    ApiKey: NC_KEY,
    UserName: NC_USER,
    ClientIp: clientIp,
    Command: command,
    ...params,
  });
  const url = `https://api.namecheap.com/xml.response?${qs}`;
  const res = await fetch(url);
  const xml = await res.text();
  if (!res.ok) throw new Error(`Namecheap HTTP ${res.status}: ${xml.slice(0, 200)}`);
  if (xml.includes('Status="ERROR"')) {
    const m = xml.match(/<Errors>([\s\S]*?)<\/Errors>/);
    throw new Error(`Namecheap API error: ${m ? m[1].trim() : xml.slice(0, 400)}`);
  }
  return xml;
}

async function ncListDomains(clientIp) {
  const out = [];
  let page = 1;
  while (true) {
    const xml = await ncCall('namecheap.domains.getList', { Page: String(page), PageSize: '100' }, clientIp);
    const matches = [...xml.matchAll(/<Domain[^>]*\sName="([^"]+)"/g)].map((m) => ({ name: m[1] }));
    out.push(...matches);
    if (matches.length < 100) break;
    page++;
  }
  return out;
}

async function ncSetCustomNs(name, ns, clientIp) {
  const [sld, ...rest] = name.split('.');
  const tld = rest.join('.');
  const params = { SLD: sld, TLD: tld };
  ns.forEach((n, i) => { params[`Nameservers`] = (params.Nameservers ? params.Nameservers + ',' : '') + n; });
  const xml = await ncCall('namecheap.domains.dns.setCustom', params, clientIp);
  return xml.includes('Updated="true"') || xml.includes('IsSuccess="true"');
}
