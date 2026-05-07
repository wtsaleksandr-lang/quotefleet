#!/usr/bin/env node
/**
 * Cloudflare → Replit linker
 * --------------------------------------------------------------------
 * Points your Cloudflare zones at a Replit deployment by adding two
 * DNS records per zone:
 *   - apex   CNAME @  → <replit-host>  (proxied, orange cloud)
 *   - wild   CNAME *  → <replit-host>  (proxied, orange cloud)
 *
 * With Cloudflare's proxy on, the Host header reaches your Replit app
 * unchanged (e.g. acme.quotefleet.app), and Cloudflare terminates SSL
 * at the edge using its Universal cert. So you do NOT need to add each
 * custom domain in the Replit deployment settings.
 *
 * Two phases:
 *   1. Inspect mode (default). Lists every zone with its current state:
 *        SAFE             — no existing apex record; safe to link
 *        ALREADY_LINKED   — apex already CNAMEs to <replit-host>
 *        IN_USE           — apex has an A/CNAME to something else;
 *                           we WILL NOT touch it without --force
 *        UNKNOWN          — couldn't read records (skipped)
 *   2. With --do-it, links the SAFE zones (and only the IN_USE ones if
 *      you also pass --force).
 *
 * Usage:
 *   node cloudflare-replit-link.mjs --account <id> --target <host>
 *       [--exclude domain1.com,domain2.com] [--include domain1.com,...]
 *       [--do-it] [--force]
 *
 * Examples:
 *   # Inspect every zone — no changes:
 *   node cloudflare-replit-link.mjs --account efa414... --target quote-fleet.replit.app
 *
 *   # Link only the four QuoteFleet host domains, do it for real:
 *   node cloudflare-replit-link.mjs --account efa414... --target quote-fleet.replit.app \\
 *     --include quotefleet.app,quotefleet.net,truckrate.online,your-quote.online --do-it
 *
 *   # Link every SAFE zone (skipping IN_USE):
 *   node cloudflare-replit-link.mjs --account efa414... --target quote-fleet.replit.app --do-it
 *
 *   # Force-overwrite IN_USE zones (use only after inspecting):
 *   node cloudflare-replit-link.mjs --account efa414... --target quote-fleet.replit.app --do-it --force
 *
 * Env:
 *   CF_API_TOKEN — Cloudflare API token, scopes: Zone Edit + DNS Edit
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// ── Defaults you don't want to touch by accident. ──────────────────
const DEFAULT_EXCLUDE = new Set([
  'curalabs.shop',
  'medicine.recipes',
  'snorezaway.com',
]);

const args = parseArgs(argv.slice(2));
const TARGET = args.target;
const ACCOUNT = args.account ?? process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const DRY_RUN = !args['do-it'];
const FORCE = !!args.force;
const EXTRA_EXCLUDE = (args.exclude ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const INCLUDE = (args.include ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

if (!TOKEN) die('Set CF_API_TOKEN in env.');
if (!TARGET) die('Pass --target <replit-host>  e.g. --target quote-fleet.replit.app');
if (!ACCOUNT) die('Pass --account <cloudflare-account-id>');

const target = TARGET.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const excludeSet = new Set([...DEFAULT_EXCLUDE, ...EXTRA_EXCLUDE]);
const includeSet = INCLUDE.length ? new Set(INCLUDE) : null;
const LOG_PATH = `./cloudflare-replit-link-${new Date().toISOString().slice(0, 10)}.log`;

console.log(banner('Cloudflare → Replit linker'));
console.log(`Mode:           ${DRY_RUN ? 'DRY RUN (inspect only)' : '*** WILL WRITE DNS RECORDS ***'}`);
console.log(`Force:          ${FORCE ? 'YES (will overwrite IN_USE zones)' : 'no'}`);
console.log(`Target host:    ${target}`);
console.log(`Account:        ${ACCOUNT}`);
console.log(`Excluded:       ${[...excludeSet].join(', ') || '(none)'}`);
console.log(`Include filter: ${includeSet ? [...includeSet].join(', ') : 'ALL zones in account'}`);
console.log(`Log:            ${LOG_PATH}`);
console.log('');

// ── Verify token + load zones ──────────────────────────────────────
const verify = await cf('/user/tokens/verify');
if (!verify.success) die(`Cloudflare token failed: ${JSON.stringify(verify.errors)}`);
console.log(`✓ Cloudflare token: ${verify.result.status}`);

const zones = await listZones(ACCOUNT);
console.log(`✓ ${zones.length} zone(s) in account`);
console.log('');

// ── Inspect each zone ──────────────────────────────────────────────
const plan = [];
for (const z of zones) {
  const name = z.name.toLowerCase();
  if (excludeSet.has(name))           { plan.push({ name, zoneId: z.id, action: 'skip', reason: 'excluded' }); continue; }
  if (includeSet && !includeSet.has(name)) { plan.push({ name, zoneId: z.id, action: 'skip', reason: 'not in --include' }); continue; }
  const apex = await findRecord(z.id, name);
  const wild = await findRecord(z.id, `*.${name}`);
  if (apex && apex.type === 'CNAME' && apex.content === target) {
    plan.push({ name, zoneId: z.id, action: 'already_linked', reason: 'apex already CNAMEs to ' + target, apex, wild });
  } else if (apex) {
    plan.push({ name, zoneId: z.id, action: 'in_use', reason: `apex ${apex.type} → ${apex.content}`, apex, wild });
  } else {
    plan.push({ name, zoneId: z.id, action: 'safe', reason: 'no existing apex record', wild });
  }
}

console.log(banner('Plan'));
for (const p of plan) {
  const tag = p.action === 'safe' ? '[SAFE         ]'
            : p.action === 'already_linked' ? '[ALREADY_LINKED]'
            : p.action === 'in_use' ? '[IN_USE       ]'
            : '[SKIP         ]';
  console.log(`  ${tag} ${p.name.padEnd(32)} ${p.reason}`);
}
console.log('');

const summary = {
  safe:           plan.filter((p) => p.action === 'safe').length,
  alreadyLinked:  plan.filter((p) => p.action === 'already_linked').length,
  inUse:          plan.filter((p) => p.action === 'in_use').length,
  skip:           plan.filter((p) => p.action === 'skip').length,
};
console.log(
  `Safe to link: ${summary.safe} · Already linked: ${summary.alreadyLinked} · In use (need --force): ${summary.inUse} · Skipped: ${summary.skip}`
);
console.log('');

if (DRY_RUN) {
  console.log('Dry run only. Re-run with --do-it to link the SAFE zones.');
  if (summary.inUse > 0)
    console.log(`To overwrite the ${summary.inUse} IN_USE zone(s), add --force after reviewing the table.`);
  process.exit(0);
}

const willTouch = plan.filter((p) =>
  p.action === 'safe' || (p.action === 'in_use' && FORCE)
);
if (willTouch.length === 0) {
  console.log('Nothing to do. Pass --force to overwrite IN_USE zones.');
  process.exit(0);
}

const rl = createInterface({ input, output });
const ans = await rl.question(
  `\nAbout to write DNS for ${willTouch.length} zone(s) → ${target} (proxied). Continue? (yes/no) > `
);
if (ans.trim().toLowerCase() !== 'yes') { console.log('Aborted.'); process.exit(0); }
await rl.close();

// ── Apply ──────────────────────────────────────────────────────────
for (const p of willTouch) {
  process.stdout.write(`Linking ${p.name}…\n`);
  try {
    await upsertCname(p.zoneId, p.name, p.apex, '@');
    process.stdout.write(`  ✓ apex CNAME → ${target} (proxied)\n`);
    await upsertCname(p.zoneId, p.name, p.wild, '*');
    process.stdout.write(`  ✓ wildcard CNAME → ${target} (proxied)\n`);
    log({ zone: p.name, action: 'linked' });
  } catch (err) {
    process.stdout.write(`  ✗ ${err.message}\n`);
    log({ zone: p.name, action: 'failed', error: err.message });
  }
}

console.log('');
console.log(banner('Next steps (do these once on Cloudflare)'));
console.log(`  1. Cloudflare dash → SSL/TLS → Overview → set mode to **Full**`);
console.log(`     (or Full (strict) — your Repl URL has a valid Replit cert)`);
console.log(`  2. SSL/TLS → Edge Certificates → enable **Always Use HTTPS**`);
console.log(`  3. (Optional) Speed → Optimization → enable Brotli + Auto Minify`);
console.log('');
console.log(banner('Update your Replit Secrets'));
console.log(`  Set HOST_DOMAINS to the comma-separated list of domains you linked, e.g.:`);
const linked = willTouch.map((p) => p.name).join(',');
console.log(`    HOST_DOMAINS=${linked}`);
console.log(`  Then redeploy. New signups can pick from any of these as their hosted page.`);
console.log('');
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
    if (next != null && !next.startsWith('--')) { o[k] = next; i++; }
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

async function cf(path, init = {}) {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return res.json();
}

async function listZones(accountId) {
  const out = [];
  let page = 1;
  while (true) {
    const r = await cf(`/zones?account.id=${accountId}&per_page=50&page=${page}`);
    if (!r.success) {
      throw new Error(`Zone list failed: ${JSON.stringify(r.errors)}`);
    }
    out.push(...r.result);
    if (r.result.length < 50) break;
    page++;
  }
  return out;
}

async function findRecord(zoneId, fqdn) {
  const r = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}&type=CNAME`);
  if (r.success && r.result.length) return r.result[0];
  // Also check for an A at apex (people sometimes use A records).
  const r2 = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}&type=A`);
  if (r2.success && r2.result.length) return r2.result[0];
  return null;
}

async function upsertCname(zoneId, zoneName, existing, host) {
  // host is "@" or "*"
  const record = {
    type: 'CNAME',
    name: host === '@' ? zoneName : `${host}.${zoneName}`,
    content: target,
    proxied: true,
    ttl: 1,
  };
  if (existing) {
    const r = await cf(`/zones/${zoneId}/dns_records/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    if (!r.success) throw new Error(`update ${host}: ${JSON.stringify(r.errors)}`);
  } else {
    const r = await cf(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    });
    if (!r.success) throw new Error(`create ${host}: ${JSON.stringify(r.errors)}`);
  }
}
