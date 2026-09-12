/**
 * Unit contract for the injection helper. The end-to-end proof — that the real
 * served pages keep their stylesheets, and that the pre-fix code loses them —
 * lives in headInjectionRobustness.test.ts, which imports no helper from here
 * so it can be run against the previous commit and watched go red.
 *
 * What is pinned here is the mechanism: the mask preserves byte offsets (the
 * whole reason a masked lookup can drive an unmasked splice), inert regions are
 * not targets, and every ambiguous document raises instead of no-op'ing.
 */
import { describe, expect, it } from 'vitest';
import {
  HtmlInjectionError,
  countLiveOccurrences,
  injectBeforeClosingTag,
  liveInSectionProblem,
  liveIndexOf,
  maskInertRegions,
  replaceLiveOnce,
} from './htmlInject.js';

const doc = (head: string, body = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('maskInertRegions', () => {
  it('preserves length exactly, so an index in the mask addresses the same byte', () => {
    const html = doc('<!-- a comment with </head> in it --><title>t</title>');
    const masked = maskInertRegions(html);
    expect(masked).toHaveLength(html.length);
    // The mask's </head> is the real one; the same offset in the original is too.
    const at = masked.indexOf('</head>');
    expect(html.slice(at, at + 7)).toBe('</head>');
  });

  it('blanks comments, script bodies and style bodies', () => {
    const html = '<!--x--><script>var a="</head>";</script><style>a{}</style><p>keep</p>';
    const masked = maskInertRegions(html);
    expect(masked).not.toContain('</head>');
    expect(masked).not.toContain('var a');
    expect(masked).toContain('<p>keep</p>');
  });

  it('leaves an UNTERMINATED comment visible, so it surfaces as a loud count', () => {
    // Silently treating a broken comment as inert would hide a broken document.
    const html = '<!-- never closed </head>';
    expect(maskInertRegions(html)).toContain('</head>');
  });
});

describe('countLiveOccurrences / liveIndexOf', () => {
  it('does not count a needle that only appears inside a comment', () => {
    expect(countLiveOccurrences(doc('<!-- /nav-unify.css is injected here -->'), '/nav-unify.css')).toBe(0);
    // Two textual matches, one real: the naive `indexOf` finds the comment's,
    // and in this fixture the real tag is the last one.
    const html = doc('<!-- </head> -->');
    expect(html.indexOf('</head>')).not.toBe(html.lastIndexOf('</head>'));
    expect(liveIndexOf(html, '</head>')).toBe(html.lastIndexOf('</head>'));
  });

  it('counts real markup', () => {
    expect(countLiveOccurrences(doc('<link href="/nav-unify.css">'), '/nav-unify.css')).toBe(1);
  });
});

describe('injectBeforeClosingTag', () => {
  it('aims at the real </head>, not the one inside a comment', () => {
    const html = doc('<!-- injected before </head> --><title>t</title>');
    const out = injectBeforeClosingTag(html, 'head', '<link href="/x.css">', { label: 'p', expect: '/x.css' });
    expect(out).toContain('<title>t</title><link href="/x.css"></head>');
    expect(countLiveOccurrences(out, '/x.css')).toBe(1);
  });

  it('is byte-identical to the naive replace when the first match is already the real one', () => {
    const html = doc('<title>t</title>');
    const naive = html.replace('</head>', () => `<link href="/x.css"></head>`);
    expect(injectBeforeClosingTag(html, 'head', '<link href="/x.css">', { label: 'p' })).toBe(naive);
  });

  it('inserts $& and $1 literally — no substitution semantics at all', () => {
    const out = injectBeforeClosingTag(doc(''), 'head', '<meta content="$& $1 $\'">', { label: 'p' });
    expect(out).toContain(`<meta content="$& $1 $'">`);
  });

  it('throws when there is no real closing tag — previously a silent no-op', () => {
    expect(() => injectBeforeClosingTag('<html><body></body></html>', 'head', 'x', { label: 'p.html' }))
      .toThrow(HtmlInjectionError);
    expect(() => injectBeforeClosingTag('<!-- </head> -->', 'head', 'x', { label: 'p.html' }))
      .toThrow(/found 0/);
  });

  it('throws when there are two real closing tags — no single right target', () => {
    expect(() => injectBeforeClosingTag(doc('') + '</head>', 'head', 'x', { label: 'p.html' }))
      .toThrow(/found 2/);
  });

  it('names the page in the error, which is the point of failing loudly', () => {
    expect(() => injectBeforeClosingTag('<p>x</p>', 'head', 'x', { label: 'pricing.html' }))
      .toThrow(/pricing\.html/);
  });

  it('enforces the post-condition: the expected marker must be live afterwards', () => {
    expect(() => injectBeforeClosingTag(doc(''), 'head', '<link href="/a.css">', { label: 'p', expect: '/b.css' }))
      .toThrow(/not live in the result/);
  });
});

describe('replaceLiveOnce', () => {
  it('skips a commented-out copy of the needle and hits the real one', () => {
    const html = `<!-- add <body> classes here --><body>real</body>`;
    expect(replaceLiveOnce(html, '<body>', '<body class="skin">', 'skin'))
      .toBe(`<!-- add <body> classes here --><body class="skin">real</body>`);
  });

  it('throws when the needle is absent — previously a page skin that silently did not apply', () => {
    expect(() => replaceLiveOnce('<p>x</p>', '<body>', 'y', 'skin')).toThrow(HtmlInjectionError);
    expect(() => replaceLiveOnce('<p>x</p>', '<body>', 'y', 'skin')).toThrow(/silent no-op/);
  });

  it('inserts $& literally', () => {
    expect(replaceLiveOnce('<body>', '<body>', '<body data-x="$&">', 'skin')).toBe('<body data-x="$&">');
  });
});

describe('liveInSectionProblem — the boot-time post-condition', () => {
  it('returns null when the stylesheet is real markup inside the head', () => {
    expect(liveInSectionProblem(doc('<link href="/a.css">'), '/a.css', 'head', 'p.html')).toBeNull();
  });

  it('reports a stylesheet that is present but commented out — the exact broken state', () => {
    // `html.includes('/a.css')` is TRUE here. That is why the old audit passed.
    const html = doc('<!-- <link href="/a.css"> -->');
    expect(html).toContain('/a.css');
    expect(liveInSectionProblem(html, '/a.css', 'head', 'p.html')).toMatch(/INERT/);
  });

  it('reports a stylesheet that is missing outright', () => {
    expect(liveInSectionProblem(doc(''), '/a.css', 'head', 'p.html')).toMatch(/missing/);
  });

  it('reports a stylesheet that landed after </head> instead of inside it', () => {
    expect(liveInSectionProblem(doc('', '<link href="/a.css">'), '/a.css', 'head', 'p.html'))
      .toMatch(/appears after <\/head>/);
  });
});
