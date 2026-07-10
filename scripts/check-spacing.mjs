#!/usr/bin/env node
/**
 * SPACING-1 — spacing / clickability / readability guard.
 *
 * Mirrors the architecture of check-hardcoded-colors.mjs: pure Node (no
 * dependencies), per-declaration scan of the QuoteFleet stylesheets, a
 * baseline file that tolerates the CURRENT debt so nothing fails today, and
 * only NEW violations fail CI. Runtime < 10s.
 *
 * Benchmarks (design-guardrails spec, 2026-07-10 — 8px grid / Apple HIG /
 * Material / WCAG 2.2). Canonical numbers live in design-tokens/spacing.json.
 *
 * What it flags:
 *   1. OFF-SCALE SPACING — any padding/margin/gap/inset numeric `px` value
 *      not in {0,4,8,12,16,24,32,48,60,80,120}.
 *   2. SUB-MIN TAP TARGETS — width/height/min-width/min-height on an
 *      interactive selector resolving < 24px  -> ERROR (fails).
 *      24-43px -> warn only ("below 44 target"), never fails.
 *   3. BAD BODY LINE-HEIGHT — unitless line-height outside 1.4-1.6 on a
 *      body/text selector (display headings, chips, labels, badges, tags,
 *      steppers, numeric totals, mono/code are skipped).
 *
 * Baseline strategy:
 *   scripts/spacing-violations-baseline.txt holds the snapshot of existing
 *   tech debt — entries there are tolerated. NEW violations fail the build.
 *   To clear an entry: snap the value to the 8px ramp (or bump the tap box to
 *   >=24), then delete the matching line and re-run.
 *
 * Regenerate baseline (first PR, or after a cleanup wave):
 *   node scripts/check-spacing.mjs --write-baseline
 *
 * No new dependencies — Node built-ins only.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/server/public"];
const EXTS = [".css"];
const BASELINE_FILE = "scripts/spacing-violations-baseline.txt";
const WRITE_BASELINE = process.argv.includes("--write-baseline");

// ── The one allowed ramp (design-tokens/spacing.json) ──────────────────────
const ALLOWED = new Set([0, 4, 8, 12, 16, 24, 32, 48, 60, 80, 120]);
const TAP_MIN = 24;
const TAP_TARGET = 44;
const LH_MIN = 1.4;
const LH_MAX = 1.6;

// Properties whose px values must land on the ramp.
const SPACING_PROPS = new Set([
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "padding-block", "padding-inline", "padding-block-start", "padding-block-end",
  "padding-inline-start", "padding-inline-end",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "margin-block", "margin-inline", "margin-block-start", "margin-block-end",
  "margin-inline-start", "margin-inline-end",
  "gap", "row-gap", "column-gap",
  "top", "right", "bottom", "left",
  "inset", "inset-block", "inset-inline",
]);

const SIZE_PROPS = new Set(["width", "height", "min-width", "min-height"]);

// ── Allowlist ──────────────────────────────────────────────────────────────
// Files that are exempt entirely (none today; kept for parity with the color
// guard). Dense-grid / rate-card selectors that deliberately render < 44px are
// NOT exempt from the >=24 floor — they are simply not flagged at 24-43 (warn).
const ALLOWLIST = new Set([]);
const ALLOWLIST_PREFIXES = [];

// Interactive selectors — a sub-24 width/height here is a hard fail.
const INTERACTIVE_PATTERNS = [
  /\bbutton\b/i,
  /\.btn(\b|-)/i,
  /\.qf-cta\b/i,
  /\.qf-help\b/i,
  /\.qf-acc-chip\b/i,
  /\.qf-tab\b/i,
  /\.qf-tabs\s+button/i,
  /\.dock-item\b/i,
  /(^|[\s,>+~])\.tab\b/i,
  /\.qf-flags\s+input\b/i,
  /input\[type=["']?(?:checkbox|radio)/i,
  /\.qf-theme-toggle\b/i,
  /\[role=["']?button/i,
  /\.qf-chat-send\b/i,
];

// Selectors whose line-height is display/decorative and therefore exempt.
const LH_SKIP = /h[1-6]\b|hero|title|\.tag\b|badge|chip|stepper|\.total|price|currency|brand|font-mono|\bcode\b|spinner|\.arr\b|\.dots\b|eyebrow|\.qf-cs|\.qf-ltl|\.field-label|\.group\b|thead|\bth\b|\.qf-eta\b|\.qf-flags\s+label|\.qf-help\b|keyframes|\.logo\b|\.qf-mini-stepper|\.qf-trust/i;

const toRel = (p) => relative(ROOT, p).replace(/\\/g, "/");

function isAllowlisted(relPath) {
  if (ALLOWLIST.has(relPath)) return true;
  return ALLOWLIST_PREFIXES.some((p) => relPath.startsWith(p));
}

// ── File discovery ───────────────────────────────────────────────────────
function walk(dir, exts) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// ── Comment stripping (preserve newlines so line numbers stay accurate) ────
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

// ── px-value extraction for a declaration value ────────────────────────────
function offGridPx(value) {
  // Skip values that aren't plain px literals we can reason about.
  const bad = [];
  const re = /(-?\d*\.?\d+)px\b/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    const n = Math.abs(parseFloat(m[1]));
    if (!ALLOWED.has(n)) bad.push(n);
  }
  return bad;
}

// ── Parse one file into declarations with selector context ─────────────────
function scanFile(absPath) {
  const relPath = toRel(absPath);
  if (isAllowlisted(relPath)) return [];

  const raw = readFileSync(absPath, "utf8");
  const src = stripComments(raw);

  // Precompute line-start offsets for offset -> line mapping.
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (off) => {
    // binary search
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const violations = [];
  const stack = []; // selector frames (strings)
  let buf = "";     // current token buffer (selector or declaration)
  let bufStart = 0;

  const innermostSelector = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i].startsWith("@")) return stack[i];
    }
    return stack[stack.length - 1] || "";
  };

  const handleDeclaration = (declText, startOff) => {
    const idx = declText.indexOf(":");
    if (idx < 0) return;
    const prop = declText.slice(0, idx).trim().toLowerCase();
    let value = declText.slice(idx + 1).trim();
    value = value.replace(/!important/gi, "").trim();
    if (!prop || prop.startsWith("--")) return; // custom-property DEFINITIONS are the token source
    if (/var\(|calc\(/.test(value)) return;      // token/calc usage is compliant by construction
    const line = lineOf(startOff);
    const sel = innermostSelector().replace(/\s+/g, " ").trim();

    // 1. Off-scale spacing
    if (SPACING_PROPS.has(prop)) {
      for (const n of offGridPx(value)) {
        violations.push({ file: relPath, line, kind: "spacing", sel, snippet: `${prop}: ${value}`, detail: `${n}px off-grid` });
      }
    }

    // 2. Tap targets on interactive selectors (pseudo-elements like ::before
    //    are decorative, never the tap target — exclude them).
    const isPseudoEl = /::?(?:before|after)\b/i.test(sel);
    if (SIZE_PROPS.has(prop) && !isPseudoEl) {
      const interactive = INTERACTIVE_PATTERNS.some((re) => re.test(sel));
      if (interactive) {
        const re = /(-?\d*\.?\d+)px\b/g; let m2;
        while ((m2 = re.exec(value)) !== null) {
          const n = Math.abs(parseFloat(m2[1]));
          if (n > 0 && n < TAP_MIN) {
            violations.push({ file: relPath, line, kind: "tap", sel, snippet: `${prop}: ${value}`, detail: `${n}px < ${TAP_MIN}px floor` });
          } else if (n >= TAP_MIN && n < TAP_TARGET) {
            violations.push({ file: relPath, line, kind: "tap-warn", sel, snippet: `${prop}: ${value}`, detail: `${n}px < ${TAP_TARGET}px target` });
          }
        }
      }
    }

    // 3. Body line-height
    if (prop === "line-height") {
      const num = parseFloat(value);
      if (!Number.isNaN(num) && !/px|%/.test(value) && !LH_SKIP.test(sel)) {
        if (num < LH_MIN || num > LH_MAX) {
          violations.push({ file: relPath, line, kind: "line-height", sel, snippet: `${prop}: ${value}`, detail: `outside ${LH_MIN}-${LH_MAX}` });
        }
      }
    }
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      stack.push(buf.trim());
      buf = ""; bufStart = i + 1;
    } else if (ch === "}") {
      const decl = buf.trim();
      if (decl) handleDeclaration(decl, bufStart);
      buf = ""; bufStart = i + 1;
      stack.pop();
    } else if (ch === ";") {
      const decl = buf.trim();
      if (decl) handleDeclaration(decl, bufStart);
      buf = ""; bufStart = i + 1;
    } else {
      if (buf === "") bufStart = i;
      buf += ch;
    }
  }

  return violations;
}

// ── Run ──────────────────────────────────────────────────────────────────
const all = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs, EXTS)) all.push(...scanFile(file));
}

// Warnings (24-43 tap) are informational and never fail CI or enter the
// baseline as failures — split them out.
const warns = all.filter((v) => v.kind === "tap-warn");
const hard = all.filter((v) => v.kind !== "tap-warn");

hard.sort((a, b) => {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  return a.snippet < b.snippet ? -1 : 1;
});

const fmt = (v) => `${v.file}:${v.line}\t${v.kind}\t${v.snippet}`;
const hardUnique = [...new Set(hard.map(fmt))].sort();

if (WRITE_BASELINE) {
  const body =
    "# SPACING-1 baseline — existing spacing / tap-target / line-height debt.\n" +
    "# Each entry is tolerated by check-spacing.mjs. To clear an entry: snap the\n" +
    "# value onto the 8px ramp (design-tokens/spacing.json) or bump the tap box\n" +
    "# to >=24px, then delete the matching line and re-run `pnpm check:spacing`.\n" +
    "# Format: <file>:<line>\\t<kind>\\t<snippet>\n" +
    hardUnique.join("\n") + (hardUnique.length ? "\n" : "");
  writeFileSync(join(ROOT, BASELINE_FILE), body, "utf8");
  console.log(`Baseline written: ${BASELINE_FILE} (${hardUnique.length} entries)`);
  process.exit(0);
}

const baseline = new Set();
const baselinePath = join(ROOT, BASELINE_FILE);
if (existsSync(baselinePath)) {
  for (const raw of readFileSync(baselinePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    baseline.add(line);
  }
}

const fresh = hard.filter((v) => !baseline.has(fmt(v)));

if (fresh.length === 0) {
  console.log(
    `OK spacing guard: 0 new violations (${hardUnique.length} known, ${baseline.size} baselined, ${warns.length} sub-44 warnings).`,
  );
  const currentSet = new Set(hard.map(fmt));
  const stale = [...baseline].filter((b) => !currentSet.has(b));
  if (stale.length) {
    console.log(`note: ${stale.length} baseline entr${stale.length === 1 ? "y is" : "ies are"} cleared and can be deleted from ${BASELINE_FILE}.`);
  }
  process.exit(0);
}

console.error(`✖ spacing guard: ${fresh.length} NEW violation${fresh.length === 1 ? "" : "s"}\n`);
for (const v of fresh) {
  console.error(`  ${v.file}:${v.line}  [${v.kind}]  ${v.sel}  {${v.snippet}}  — ${v.detail}`);
}
console.error("\nFix: snap the value onto the 8px ramp {0,4,8,12,16,24,32,48,60,80,120}");
console.error("via var(--space-*), or bump the interactive box to >=24px (44 preferred).");
console.error("See design-tokens/spacing.json + the design-guardrails spec.");
process.exit(1);
