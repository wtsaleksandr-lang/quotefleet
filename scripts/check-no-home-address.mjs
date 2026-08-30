#!/usr/bin/env node
/**
 * Guard: the founder's home address must never appear in this repository.
 *
 * It once lived in `SENDER_ADDRESS` and was printed in the footer of every
 * outreach and RFQ email — our two highest-volume outbound surfaces. A home
 * address cannot be un-sent once it is in a stranger's inbox, so this is a
 * privacy defect, not a style one.
 *
 * The replacement is the registered office of the operating entity, which is
 * already public in our own Terms of Service.
 *
 * Matching is on the distinctive parts only — street name and postal code —
 * so the city on its own ("Hamilton, ON" as a customer's location, a service
 * area placeholder, a testimonial) stays legal. We are redacting one specific
 * residence, not banning a city.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** Distinctive tokens of the redacted residence. City alone is NOT a match. */
const PATTERNS = [
  { re: /\bangus\s*(road|rd)\b/i, what: 'street name' },
  { re: /\bL8K\s*-?\s*6L1\b/i, what: 'postal code' },
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo',
  'playwright-report', 'test-results', '.vite', 'drizzle-meta',
]);

/** Text-ish files worth scanning. Binary/media are skipped. */
const EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.html',
  '.css', '.sql', '.yaml', '.yml', '.txt', '.env.example',
]);

/** This guard necessarily contains the patterns it searches for. */
const SELF = join('scripts', 'check-no-home-address.mjs');

const hits = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    const rel = relative(ROOT, full);
    if (rel === SELF || rel.split(sep).join('/') === SELF.split(sep).join('/')) continue;
    const dot = name.lastIndexOf('.');
    if (dot < 0 || !EXT.has(name.slice(dot))) continue;
    if (st.size > 4 * 1024 * 1024) continue;

    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const { re, what } of PATTERNS) {
        if (re.test(lines[i])) {
          hits.push({ file: rel, line: i + 1, what, text: lines[i].trim().slice(0, 120) });
        }
      }
    }
  }
}

walk(ROOT);

if (hits.length) {
  console.error(
    `\n✗ check:no-home-address — the founder's home address appears in ${hits.length} place(s).\n`,
  );
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  (${h.what})`);
    console.error(`    ${h.text}`);
  }
  console.error(
    '\n  This address must not appear anywhere in the repo, and above all not in\n' +
      '  an email footer — outreach and RFQ publish it to strangers, and it cannot\n' +
      '  be un-sent. Use the operating entity\'s registered office instead (the\n' +
      '  SENDER_ADDRESS default), or override it via the SENDER_ADDRESS env var.\n',
  );
  process.exit(1);
}

console.log('✓ check:no-home-address — clean');
