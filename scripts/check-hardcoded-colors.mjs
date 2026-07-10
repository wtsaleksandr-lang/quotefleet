#!/usr/bin/env node
/**
 * CONTRAST-2 (QF port) — hardcoded color guard.
 *
 * Ported from the WeFixTrades guard so both stacks share the same two guards
 * (colors + spacing). Walks every .css and .html file under
 * src/server/public/, scans for raw #fff / #ffffff / white / #000 / #000000 /
 * black used as text/background/border, and reports VIOLATIONS that are NOT
 * inside a [data-theme="..."] scoped block or on an allowlisted file.
 *
 * Why: QF ships a light/dark theming system (html[data-theme="light"] +
 * runtime widget theme tokens computed through src/server/color/contrast.ts).
 * Hardcoding bright-on-bright / dark-on-dark colors breaks theme parity. This
 * makes that a CI failure for NEW code while tolerating existing debt via a
 * baseline.
 *
 * Regenerate baseline (first PR / after a cleanup wave):
 *   node scripts/check-hardcoded-colors.mjs --write-baseline
 *
 * No new dependencies — Node built-ins only. Target runtime < 10s.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/server/public"];
const BASELINE_FILE = "scripts/color-violations-baseline.txt";
const WRITE_BASELINE = process.argv.includes("--write-baseline");

// Files exempt entirely (brand-locked assets / effects). Add sparingly.
// widget-demo-shell.html is a bespoke marketing surface (phone bezel, browser
// chrome, brand-blue toggles); its few raw colors are white-on-brand-blue
// (WCAG-safe by design) and one-off physical-object styling, not theme tokens.
const ALLOWLIST = new Set(["src/server/public/widget-demo-shell.html"]);
const ALLOWLIST_PREFIXES = [];

const toRel = (p) => relative(ROOT, p).replace(/\\/g, "/");

function isAllowlisted(relPath) {
  if (ALLOWLIST.has(relPath)) return true;
  return ALLOWLIST_PREFIXES.some((p) => relPath.startsWith(p));
}

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

const COLOR_PROPS = [
  "color", "background", "background-color", "backgroundColor",
  "border-color", "borderColor", "outline-color", "outlineColor",
];
const RAW_VALUES = ["#fff", "#ffffff", "white", "#000", "#000000", "black"];
const RAW_VALUE_RE = new RegExp(
  "(?<![\\w-])(" + RAW_VALUES.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![\\w-])",
  "i",
);
const PROP_RE = new RegExp(
  "\\b(" + COLOR_PROPS.join("|") + ")\\s*:\\s*['\"]?" + RAW_VALUE_RE.source + "['\"]?",
  "gi",
);

// CSS-only theme-scope detection (QF public HTML has no data-theme subtrees;
// the site theme is scoped in style.css via html[data-theme="light"]).
function isInsideCssThemeBlock(lines, idx, violationCol) {
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    const line = lines[i];
    const startCol = i === idx ? Math.min(violationCol, line.length) - 1 : line.length - 1;
    for (let c = startCol; c >= 0; c--) {
      const ch = line[c];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) {
          let selector = line.slice(0, c);
          for (let j = i - 1; j >= 0; j--) {
            if (/[{}]/.test(lines[j])) break;
            selector = lines[j] + " " + selector;
          }
          if (/\[data-theme=["'](?:dark|light)["']\]/.test(selector)) return true;
        } else depth--;
      }
    }
  }
  return false;
}

function scanFile(absPath) {
  const relPath = toRel(absPath);
  if (isAllowlisted(relPath)) return [];
  const src = readFileSync(absPath, "utf8");
  const lines = src.split(/\r?\n/);
  const isCss = absPath.endsWith(".css");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("/*") && trimmed.endsWith("*/")) continue;
    let m;
    PROP_RE.lastIndex = 0;
    while ((m = PROP_RE.exec(line)) !== null) {
      const value = m[2];
      const col = m.index;
      const guarded = isCss ? isInsideCssThemeBlock(lines, i, col + 1) : false;
      if (!guarded) {
        violations.push({ file: relPath, line: i + 1, col: col + 1, value, snippet: m[0].trim() });
      }
    }
  }
  return violations;
}

const all = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs, [".css", ".html"])) all.push(...scanFile(file));
}

all.sort((a, b) => {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.col !== b.col) return a.col - b.col;
  return a.snippet < b.snippet ? -1 : 1;
});

const fmt = (v) => `${v.file}:${v.line}:${v.col}\t${v.snippet}`;

if (WRITE_BASELINE) {
  const body =
    "# CONTRAST-2 (QF) baseline — existing hardcoded color violations.\n" +
    "# Tolerated by check-hardcoded-colors.mjs. To clear: use a theme token\n" +
    "# (var(--*)) or wrap in a [data-theme=...] scope, then delete the line.\n" +
    "# Format: <file>:<line>:<col>\\t<snippet>\n" +
    all.map(fmt).join("\n") + (all.length ? "\n" : "");
  writeFileSync(join(ROOT, BASELINE_FILE), body, "utf8");
  console.log(`Baseline written: ${BASELINE_FILE} (${all.length} entries)`);
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

const fresh = all.filter((v) => !baseline.has(fmt(v)));

if (fresh.length === 0) {
  console.log(`OK hardcoded-color guard: 0 new violations (${all.length} known, ${baseline.size} baselined).`);
  process.exit(0);
}

console.error(`✖ hardcoded-color guard: ${fresh.length} NEW violation${fresh.length === 1 ? "" : "s"}\n`);
for (const v of fresh) console.error(`  ${v.file}:${v.line}:${v.col}  ${v.snippet}`);
console.error("\nFix: replace the raw color with a theme token (var(--*)), or wrap the");
console.error('selector in a [data-theme="dark"] / [data-theme="light"] scope.');
process.exit(1);
