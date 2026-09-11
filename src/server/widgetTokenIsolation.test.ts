/**
 * RULE tests for the embedded widget's token namespace.
 *
 * The quote widget is injected into third-party carrier pages, so two things
 * are correctness requirements rather than preferences:
 *
 *  1. `--w-*` is a CLOSED namespace. The widget must not read the marketing
 *     site's `:root` tokens (a host page can override those) and must not
 *     leak its own variables into the host document.
 *
 *  2. `--w-fg` / `--w-bg` are STATIC light-mode legacy tokens that
 *     `applyTheme()` does NOT emit (see the WidgetThemeTokens contract in
 *     widgetThemes.ts). They can never follow a tenant preset, so using
 *     `var(--w-fg)` BARE on a themed surface paints dark ink on the dark
 *     presets. The themed foregrounds are `--w-text` (shell),
 *     `--w-input-text` (input / options / result surfaces) and
 *     `--w-surface-2-text` (tinted panels); `--w-fg` is legal only as the
 *     final fallback inside a var() chain.
 *
 * These are RULE-grade: they encode a durable constraint, not a current value.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PUBLIC_DIR = join(process.cwd(), 'src', 'server', 'public');
// Every stylesheet that ships inside the embedded widget document.
const WIDGET_CSS = [
  'widget-style.css',
  'widget-ux-fixes.css',
  'widget-hazmat-pill.css',
  'widget-motion.css',
  // Ships in the widget document too (injected on the served widget page) and
  // was the one unguarded sheet — it repainted the hazmat class popover with
  // the static --w-bg, which came up near-WHITE inside a charcoal dialog.
  'widget-glass.css',
];

const read = (f: string) => readFile(join(PUBLIC_DIR, f), 'utf8');

/**
 * Blank out comments so prose about a token is never treated as usage.
 * Newlines inside a comment are PRESERVED so line indices keep matching the
 * raw file (a collapsing strip silently shifts every reported line number).
 */
const stripComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/**
 * A BARE `var(--w-fg)` is one that is NOT the fallback argument of an
 * enclosing var(). `var(--w-text, var(--w-fg))` is fine; `var(--w-fg)` and
 * `color-mix(in srgb, var(--w-fg) 4%, transparent)` are not.
 */
function bareFgUsages(css: string): string[] {
  const out: string[] = [];
  const rawLines = css.split('\n');
  const lines = stripComments(css).split('\n');
  lines.forEach((line, i) => {
    // Declarations only — skip the `:root` definition of the token itself.
    if (/--w-fg\s*:/.test(line)) return;
    if (!line.includes('var(--w-fg')) return;
    // Narrow, DOCUMENTED exemption: a handful of surfaces paint the equally
    // static `--w-bg` (white on every preset, since applyTheme emits neither
    // --w-bg nor --w-fg). There, dark --w-fg ink on white --w-bg is the
    // correct, internally consistent pair. The author must say so inline, so
    // the exemption is a deliberate claim rather than an oversight.
    if ((rawLines[i] ?? '').includes('static-pair')) return;
    // Any occurrence preceded by `<token>,` inside a var() is a fallback use.
    // Remove every well-formed fallback occurrence, then see if any remain.
    const withoutFallbacks = line.replace(/var\(\s*--w-[a-z0-9-]+\s*,\s*var\(--w-fg\)\s*\)/g, 'OK')
      // nested two-deep chains, e.g. var(--a, var(--b, var(--w-fg)))
      .replace(/var\(\s*--w-[a-z0-9-]+\s*,\s*OK\s*\)/g, 'OK');
    if (withoutFallbacks.includes('var(--w-fg')) {
      out.push(`${i + 1}: ${line.trim()}`);
    }
  });
  return out;
}

describe('widget token isolation (RULE)', () => {
  it('never uses var(--w-fg) bare — applyTheme() does not emit it', async () => {
    const offenders: string[] = [];
    for (const file of WIDGET_CSS) {
      for (const hit of bareFgUsages(await read(file))) offenders.push(`${file}:${hit}`);
    }
    expect(
      offenders,
      `--w-fg is a STATIC legacy token that no preset can update. On a themed ` +
        `surface it paints dark ink on the dark presets. Use --w-text (shell), ` +
        `--w-input-text (input/options/result) or --w-surface-2-text (tinted ` +
        `panels), keeping --w-fg only as a var() fallback:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps --w-* self-contained: the widget never reads site chrome tokens', async () => {
    // Tokens owned by the marketing site's :root (style.css). If the widget
    // consumed these, a host carrier page could restyle our widget by defining
    // them, and our values would leak into their document.
    const SITE_TOKENS = ['--ink', '--accent-fill', '--accent-soft', '--radius-btn', '--shadow-sm'];
    const offenders: string[] = [];
    for (const file of WIDGET_CSS) {
      const css = stripComments(await read(file));
      for (const t of SITE_TOKENS) {
        if (new RegExp(`var\\(\\s*${t}\\b`).test(css)) offenders.push(`${file} reads ${t}`);
      }
    }
    expect(offenders, `widget CSS must use only the --w-* namespace`).toEqual([]);
  });

  it('declares a static --w-text so pre-theme paint matches the themed value', async () => {
    const css = await read('widget-style.css');
    expect(css).toMatch(/--w-text:\s*#/);
  });
});
