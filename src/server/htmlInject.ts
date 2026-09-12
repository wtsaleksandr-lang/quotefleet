/**
 * ROBUST HTML INJECTION — one helper, because the naive form silently deletes
 * stylesheets from production pages.
 *
 * THE DEFECT, AS MEASURED. Two places injected a stylesheet the obvious way:
 *
 *     out = out.replace('</head>', () => `  <link rel="stylesheet" ...>\n</head>`)
 *
 * `String.prototype.replace` with a STRING pattern replaces the FIRST textual
 * occurrence. The served pages carry long explanatory HTML comments inside
 * their own `<head>` (landing.html has one listing five unlinked stylesheets).
 * The moment somebody writes `</head>` inside such a comment — describing the
 * very mechanism this file implements, which is exactly how it happened — the
 * first textual `</head>` is the one INSIDE THE COMMENT. The link is spliced in
 * there, between `<!--` and `-->`, where the parser never sees it.
 *
 * Nothing failed. Not the type checker, not a test, not the boot-time
 * `verifySiteChromeSlots` audit — which called `applySiteChrome` and asserted
 * only that it did not throw. The homepage lost BOTH `/nav-unify.css` and
 * `/landing-logo-marquee.css` and still returned 200. It surfaced only because
 * someone measured the rendered document: height went 3997 → 9194 px, an
 * unstyled page.
 *
 * THE FIX, IN TWO PARTS.
 *
 *   1. AIM AT THE REAL TAG. Every lookup here runs against a MASKED copy of the
 *      document in which comments, `<script>` bodies and `<style>` bodies have
 *      been blanked to same-length filler. Same length is the point: an index
 *      found in the masked copy addresses the identical byte in the original,
 *      so we can splice with `slice` and no second search. A `</head>` inside a
 *      comment is not a closing head tag and is no longer treated as one.
 *
 *   2. REFUSE TO BE SILENT. A document with no real closing tag, or with two,
 *      has no single right insertion point. Today that is a no-op: the page
 *      ships without the stylesheet and the response still goes out. Here it
 *      throws `HtmlInjectionError`, and because `verifySiteChromeSlots` /
 *      `verifyHomeSectionSlots` run these paths over every registered page
 *      while `createApp()` is being constructed, it throws AT BOOT — in the
 *      test suite, in CI, and before a deploy can serve the broken page.
 *
 * A NOTE ON `$&`. The call sites used the `() => …` replacer form deliberately,
 * to stop a `$&` or `$'` in the injected markup from splicing the match back
 * in. Splicing with `slice` has no substitution semantics at all, so that
 * hazard is gone by construction rather than by remembering to pass a function.
 */

export class HtmlInjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HtmlInjectionError';
  }
}

/**
 * Regions whose contents are TEXT, not markup: comments, script bodies and
 * style bodies. A structural tag written inside any of them is a string that
 * merely looks like a tag, and aiming an injection at it is the bug above.
 *
 * Non-greedy on purpose — a comment ends at its first `-->`, exactly as a
 * parser reads it. An UNTERMINATED comment or script matches nothing, so its
 * contents stay visible to the counters below and surface as a loud "found 2"
 * rather than as a wrong-but-quiet insertion.
 */
const INERT_REGIONS = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;

/**
 * The document with every inert region blanked to spaces of the SAME LENGTH, so
 * `maskInertRegions(html).indexOf(x) === ` the byte offset of `x` in `html`.
 * Exported for the tests, which assert the index mapping directly.
 */
export function maskInertRegions(html: string): string {
  return html.replace(INERT_REGIONS, (m) => ' '.repeat(m.length));
}

/** Occurrences of `needle` that are real markup — i.e. not inside a comment,
 *  a script body or a style body. */
export function countLiveOccurrences(html: string, needle: string): number {
  return maskInertRegions(html).split(needle).length - 1;
}

/** Byte offset of the first real (non-inert) occurrence, or -1. */
export function liveIndexOf(html: string, needle: string): number {
  return maskInertRegions(html).indexOf(needle);
}

export interface InjectOptions {
  /** Page name for the error message — the whole value of a loud failure. */
  label: string;
  /**
   * A marker that MUST be live in the result, checked after the splice. This is
   * the post-condition the old code lacked: `out.includes('/nav-unify.css')`
   * was satisfied by a link sitting inside a comment, which is precisely the
   * broken state. Typically the stylesheet href.
   */
  expect?: string;
}

/**
 * Insert `snippet` immediately before the document's one real `</head>` or
 * `</body>`, and throw if there is not exactly one to aim at.
 *
 * Byte-for-byte equivalent to the `replace('</head>', () => snippet + '</head>')`
 * it replaces whenever that call was already landing in the right place, which
 * is every page today — so this cannot restyle the site. It differs only in the
 * cases that were previously wrong or silent.
 */
export function injectBeforeClosingTag(
  html: string,
  tag: 'head' | 'body',
  snippet: string,
  opts: InjectOptions,
): string {
  const closer = `</${tag}>`;
  const masked = maskInertRegions(html);
  const count = masked.split(closer).length - 1;
  if (count !== 1) {
    throw new HtmlInjectionError(
      `${opts.label}: expected exactly 1 real ${closer} to inject before, found ${count}. `
      + (count === 0
        ? `Every occurrence is inside a comment, a <script> or a <style>, or the document has none. `
          + `Injecting would be a silent no-op and the page would ship without ${opts.expect ?? 'the injected markup'}.`
        : `With more than one there is no single right insertion point, so the markup could land in the wrong section of the document.`),
    );
  }

  const at = masked.indexOf(closer);
  const out = html.slice(0, at) + snippet + html.slice(at);

  if (opts.expect && countLiveOccurrences(out, opts.expect) < 1) {
    throw new HtmlInjectionError(
      `${opts.label}: injected before ${closer} but ${opts.expect} is not live in the result. `
      + `It is present only inside a comment, a <script> or a <style> — i.e. the browser will never load it.`,
    );
  }
  return out;
}

/**
 * Replace the first REAL occurrence of `needle`, and throw when there is none.
 *
 * The opening-tag counterpart of the above, for injections that key off a
 * `<body>` tag or an existing `<link>`. "First" is the right target for an
 * opening tag; "first that is actually markup" is the part the plain
 * `.replace(needle, replacement)` gets wrong. Zero matches is likewise a silent
 * no-op today — a page skin that quietly fails to apply — and throws here.
 *
 * Also unlike `.replace` with a string replacement, `$&` / `$1` / `` $` `` in
 * `replacement` are inserted literally rather than interpreted.
 */
export function replaceLiveOnce(
  html: string,
  needle: string,
  replacement: string,
  label: string,
): string {
  const at = liveIndexOf(html, needle);
  if (at < 0) {
    throw new HtmlInjectionError(
      `${label}: expected ${needle} in the document and found none outside comments/scripts/styles. `
      + `The substitution would be a silent no-op, shipping the page without it.`,
    );
  }
  return html.slice(0, at) + replacement + html.slice(at + needle.length);
}

/**
 * BOOT-TIME POST-CONDITION: `needle` is live AND sits before the real `</tag>`.
 *
 * This is the assertion that would have caught the original defect on its own.
 * A plain `html.includes('/nav-unify.css')` passes on the broken page, because
 * the string IS in the document — commented out. This checks the two things
 * that actually matter: the browser can see it, and it is in the right section.
 * Returns a problem description, or null when the document is fine, so callers
 * can aggregate across pages the way `verifySiteChromeSlots` already does.
 */
export function liveInSectionProblem(
  html: string,
  needle: string,
  tag: 'head' | 'body',
  label: string,
): string | null {
  const masked = maskInertRegions(html);
  const at = masked.indexOf(needle);
  if (at < 0) {
    const anywhere = html.includes(needle);
    return `${label}: ${needle} is ${anywhere
      ? 'present but INERT — it sits inside a comment, a <script> or a <style>, so the browser never loads it'
      : 'missing from the rendered page entirely'}.`;
  }
  const closer = masked.indexOf(`</${tag}>`);
  if (closer < 0) return `${label}: rendered page has no real </${tag}>.`;
  if (at > closer) {
    return `${label}: ${needle} appears after </${tag}>, not inside it.`;
  }
  return null;
}
