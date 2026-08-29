/**
 * The render path. Two things must hold and neither is negotiable:
 *
 *   1. LLM OUTPUT IS UNTRUSTED. The article body is model-generated text stored
 *      in a database and served on our own domain. If a `<script>` in that body
 *      can reach the page, we have shipped stored XSS on quotefleet.net. The
 *      renderer escapes first and formats second, so these tests assert that no
 *      tag the model writes survives as a tag.
 *
 *   2. THE PAGE IS CDN-CACHEABLE, which means it must be identity-free and must
 *      carry correct SEO metadata — a wrong canonical or a leaked draft is a
 *      ranking problem that outlives the deploy that caused it.
 */
import { describe, expect, it } from 'vitest';
import { guideArticleJsonLd, renderGuideArticle, renderGuidesIndex, renderMarkdown } from './guidesPages.js';
import type { SeoContentPage } from '../../db/schema.js';

function page(over: Partial<SeoContentPage> = {}): SeoContentPage {
  return {
    id: 1,
    slug: 'trucking-companies-in-houston-tx',
    title: 'Trucking Companies in Houston, TX — 3,501 Carriers Compared',
    metaDescription: '3,501 carriers registered in Houston, TX.',
    excerpt: 'Real carrier-population data for Houston, TX.',
    content: '## Overview\n\nThere are **3,501 carriers** here.',
    status: 'published',
    jsonldType: 'Article',
    authorEntity: 'QuoteFleet Research',
    canonical: null,
    originalData: { totalInCut: 3501, computedAt: '2026-08-29T00:00:00.000Z', median: 3 },
    uniqueDataScore: 12,
    surface: 'qf_seo',
    publishedAt: new Date('2026-08-29T00:00:00Z'),
    createdAt: new Date('2026-08-28T00:00:00Z'),
    updatedAt: new Date('2026-08-29T00:00:00Z'),
    ...over,
  } as SeoContentPage;
}

describe('renderMarkdown — untrusted model output', () => {
  it('neutralises a script tag rather than emitting it', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralises an img onerror payload', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;img');
  });

  it('refuses a javascript: link target, keeping the label as plain text', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toMatch(/<a /);
    expect(html).toContain('click me');
  });

  it('refuses protocol-relative and http links', () => {
    expect(renderMarkdown('[x](//evil.com)')).not.toMatch(/<a /);
    expect(renderMarkdown('[x](http://evil.com)')).not.toMatch(/<a /);
  });

  it('allows same-site paths and https links', () => {
    expect(renderMarkdown('[tools](/tools)')).toContain('<a href="/tools">tools</a>');
    expect(renderMarkdown('[fmcsa](https://www.fmcsa.dot.gov/)')).toContain(
      '<a href="https://www.fmcsa.dot.gov/">fmcsa</a>',
    );
  });

  it('preserves query strings in same-site links', () => {
    const html = renderMarkdown('[dir](/directory?state=TX&city=Houston)');
    expect(html).toContain('href="/directory?state=TX&amp;city=Houston"');
  });

  it('renders the supported markdown subset', () => {
    const html = renderMarkdown(
      '## Heading\n\nSome **bold** and *italic*.\n\n- one\n- two\n\n1. first\n2. second',
    );
    expect(html).toContain('<h3>Heading</h3>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>one</li>');
  });

  it('demotes a body H1 so the stored title keeps sole ownership of the page H1', () => {
    // If the model renames the heading, a body <h1> would silently desynchronise
    // the H1 from the <title> and from what the reviewer approved.
    const html = renderMarkdown('# Model Heading\n\nBody.');
    expect(html).not.toContain('<h1>');
    expect(html).toContain('<h2>Model Heading</h2>');
  });

  it('renders a GFM table instead of leaving literal pipe soup on the page', () => {
    // The model reaches for a table whenever it is handed an equipment mix, so
    // this is the common case, not an exotic one.
    const html = renderMarkdown(
      '| Equipment | Carriers |\n|---|---|\n| Dry Van | 3,052 |\n| Flatbed | 664 |\n\nAfter.',
    );
    expect(html).toContain('<th>Equipment</th>');
    expect(html).toContain('<td>3,052</td>');
    expect(html).toContain('<td>Flatbed</td>');
    expect(html).not.toContain('|---|');
    expect(html).toContain('<p>After.</p>');
  });

  it('wraps a table so it scrolls itself rather than widening the page on mobile', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('gd-tablewrap');
  });

  it('escapes inside table cells too', () => {
    const html = renderMarkdown('| X |\n|---|\n| <script>alert(1)</script> |');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a horizontal rule without swallowing bullet lists', () => {
    expect(renderMarkdown('---')).toContain('<hr>');
    const list = renderMarkdown('- one\n- two');
    expect(list).toContain('<li>one</li>');
    expect(list).not.toContain('<hr>');
  });

  it('closes lists when a paragraph interrupts them', () => {
    const html = renderMarkdown('- a\n- b\n\nParagraph.');
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<p>Paragraph.</p>'));
  });
});

describe('article page', () => {
  it('self-canonicals to its own /guides URL', () => {
    const html = renderGuideArticle(page());
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/guides/trucking-companies-in-houston-tx">');
  });

  it('honours an editor-set canonical for a collapsed near-duplicate', () => {
    const html = renderGuideArticle(page({ canonical: 'https://quotefleet.net/guides/other' }));
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/guides/other">');
  });

  it('carries a unique title and meta description', () => {
    const html = renderGuideArticle(page());
    expect(html).toContain('<title>Trucking Companies in Houston, TX — 3,501 Carriers Compared | QuoteFleet</title>');
    expect(html).toContain('3,501 carriers registered in Houston, TX.');
  });

  it('emits Article JSON-LD as a real JSON string, not [object Object]', () => {
    const html = renderGuideArticle(page());
    expect(html).not.toContain('[object Object]');
    expect(html).toContain('"@type":"Article"');
  });

  it('names the real author entity in JSON-LD (E-E-A-T)', () => {
    const ld = JSON.parse(guideArticleJsonLd(page())) as Record<string, { name?: string }>;
    expect(ld.author.name).toBe('QuoteFleet Research');
    expect(ld.publisher.name).toBe('QuoteFleet');
  });

  it('attributes the underlying dataset', () => {
    const ld = JSON.parse(guideArticleJsonLd(page())) as Record<string, unknown>;
    expect(String(ld.isBasedOn)).toContain('fmcsa.dot.gov');
  });

  it('shows the provenance strip so a reader can see the data date and scope', () => {
    const html = renderGuideArticle(page());
    expect(html).toContain('3,501 carriers analysed');
    expect(html).toContain('Data as of 2026-08-29');
  });

  it('states plainly that this is not rate data', () => {
    // The corpus is carrier population, not pricing. Saying so keeps the page
    // honest and routes a pricing intent to the calculator that can answer it.
    expect(renderGuideArticle(page())).toContain('not rate or pricing data');
  });
});

describe('hub page', () => {
  it('lists published guides with links', () => {
    const html = renderGuidesIndex([
      { slug: 'a-guide', title: 'A Guide', excerpt: 'Excerpt.', sampleSize: 300 },
    ]);
    expect(html).toContain('href="/guides/a-guide"');
    expect(html).toContain('300 carriers analysed');
  });

  it('degrades to a useful empty state rather than a blank page', () => {
    const html = renderGuidesIndex([]);
    expect(html).toContain('/directory');
    expect(html).toContain('/glossary');
  });

  it('escapes titles from the database', () => {
    const html = renderGuidesIndex([
      { slug: 's', title: '<script>alert(1)</script>', excerpt: '', sampleSize: null },
    ]);
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
