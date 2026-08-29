/**
 * /guides — the public editorial surface.
 *
 * QuoteFleet has ~334k programmatic carrier pages and, until this, zero
 * editorial content. Programmatic pages rank on long-tail intent but they do
 * not earn links, and link-earning is now the binding constraint on the
 * domain. These are the linkable assets: analysis of the FMCSA carrier census
 * that nobody else publishes, each one deep-linking into the directory pages it
 * describes.
 *
 * ─── WHY /guides AND NOT /blog ────────────────────────────────────────────
 * "Blog" signals recency-ranked commentary; these pages are evergreen reference
 * documents about a market, re-generated when the census updates, and they sit
 * beside the existing evergreen reference surfaces (/glossary, /compliance,
 * /services) rather than beside news. A reader who lands on
 * "Trucking Companies in Houston, TX" from search is looking for a reference,
 * and /guides/... sets that expectation while /blog/... undercuts it. The
 * existing footer already groups /glossary and /compliance as reference; this
 * joins that group.
 *
 * ─── CDN-CACHEABLE, WHICH MEANS IDENTITY-FREE ─────────────────────────────
 * Both routes go through setPublicDirectoryCache (public, max-age=300,
 * s-maxage=86400, stale-while-revalidate). That is only sound because the HTML
 * is byte-identical for every visitor: there is NO per-user server branching on
 * these routes — no tenant, no session read, no entitlement check. Anything
 * user-specific here would be served to the wrong person out of the shared
 * cache. Keep it that way; hydrate client-side if per-user state is ever needed
 * (this mirrors the carrier-profile route's contract).
 *
 * The render path is deliberately NOT behind SEO_ENGINE_ENABLED. Once a human
 * has approved an article it is live SEO content; de-indexing it because a
 * generation flag flipped would be a self-inflicted ranking loss. Visibility is
 * governed solely by status='published'.
 */

import type { Express, Request, Response } from 'express';
import { esc, layout } from '../directory/pages.js';
import { setPublicDirectoryCache } from '../directory/httpCache.js';
import { listPublishedGuides, getPublishedSeoPageBySlug } from './store.js';
import type { SeoContentPage } from '../../db/schema.js';

const SITE = 'https://quotefleet.net';

/* ─── Markdown → HTML ─────────────────────────────────────────────────────
   A deliberately small renderer for the constrained subset the generator
   produces (H1-H3, paragraphs, bold, italic, links, bullet/numbered lists).

   SECURITY: the input is LLM output, so it is untrusted. Every line is
   HTML-ESCAPED FIRST, and only then are the markdown constructs turned into
   the small set of tags below. There is therefore no path by which raw HTML in
   the model's output reaches the page — the `<` is already `&lt;` before any
   tag is emitted. Link targets are additionally restricted to same-site paths
   and https:// URLs, so a generated `javascript:` href cannot exist.

   This is also why no markdown dependency was added: the safe subset is ~50
   lines, and a general-purpose parser would need a sanitizer bolted on top of
   it to reach the same place. */

function escapeHtml(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string,
  );
}

/** Only same-site paths and https URLs may become links. */
function safeHref(href: string): string | null {
  const h = href.trim();
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  if (/^https:\/\/[^\s"']+$/i.test(h)) return h;
  return null;
}

/** Inline formatting on ALREADY-ESCAPED text. */
function inline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
      // The href arrives HTML-escaped; unescape only &amp; so query strings work.
      const safe = safeHref(href.replace(/&amp;/g, '&'));
      return safe ? `<a href="${escapeHtml(safe)}">${label}</a>` : label;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

/** Render the safe markdown subset. Returns HTML; H1 is intentionally dropped
 *  (the page renders its own H1 from the stored title, so a model that changed
 *  the heading cannot desynchronize the H1 from the <title>). */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const openList = (t: 'ul' | 'ol') => {
    if (listType !== t) {
      closeList();
      out.push(`<${t}>`);
      listType = t;
    }
  };

  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const e = escapeHtml(line.trim());

    // GFM table: a header row followed by a |---|---| separator. The model
    // reaches for these constantly when handed an equipment mix, and without
    // support they render as literal pipe soup on the page. Cells go through
    // the same escape-then-format path as everything else, so a tag inside a
    // cell is still inert.
    if (e.startsWith('|') && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim())) {
      closeList();
      const cells = (row: string): string[] =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => inline(escapeHtml(c.trim())));
      out.push('<div class="gd-tablewrap"><table><thead><tr>');
      out.push(cells(line).map((c) => `<th>${c}</th>`).join(''));
      out.push('</tr></thead><tbody>');
      i += 2; // skip the separator row
      for (; i < lines.length; i++) {
        const row = lines[i].trim();
        if (!row.startsWith('|')) {
          i--;
          break;
        }
        out.push(`<tr>${cells(row).map((c) => `<td>${c}</td>`).join('')}</tr>`);
      }
      out.push('</tbody></table></div>');
      continue;
    }

    // A horizontal rule — the model uses these as section breaks.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(e)) {
      closeList();
      out.push('<hr>');
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(e);
    if (h) {
      closeList();
      // Demote: the stored title owns the page's single H1, so a body "#"
      // becomes an H2 and everything below shifts with it.
      const level = Math.min(6, h[1].length + 1);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(e);
    if (ul) {
      openList('ul');
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(e);
    if (ol) {
      openList('ol');
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(e)}</p>`);
  }
  closeList();
  return out.join('\n');
}

/* ─── Section CSS (prefix `gd-`, tokens only — no hardcoded colors) ────── */

const GUIDES_CSS = `
.gd-wrap{max-width:820px;margin:0 auto;padding:0 24px 80px}
.gd-hero{max-width:820px;margin:0 auto;padding:48px 24px 24px;text-align:left}
.gd-hero .gd-eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.gd-hero h1{margin:0 0 12px;font-size:32px;line-height:1.2;color:var(--ink)}
.gd-hero p{margin:0;color:var(--muted);font-size:16px;line-height:1.6;max-width:640px}
.gd-meta{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:16px 0 0;font-size:13px;color:var(--muted)}
.gd-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border:1px solid var(--border);border-radius:var(--radius-chip);background:var(--surface-2);color:var(--ink-soft);font-size:12px;min-height:24px}
.gd-list{display:grid;gap:16px;margin:24px 0 0;list-style:none;padding:0}
.gd-card{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:24px}
.gd-card h2{margin:0 0 8px;font-size:19px;line-height:1.35}
.gd-card h2 a{color:var(--ink);text-decoration:none}
.gd-card h2 a:hover{color:var(--accent)}
.gd-card p{margin:0;color:var(--muted);font-size:14px;line-height:1.6}
.gd-body{margin:32px 0 0;color:var(--ink);font-size:16px;line-height:1.6}
.gd-body h2{margin:32px 0 12px;font-size:24px;line-height:1.3;color:var(--ink)}
.gd-body h3{margin:24px 0 8px;font-size:18px;line-height:1.4;color:var(--ink)}
.gd-body p{margin:0 0 16px}
.gd-body ul,.gd-body ol{margin:0 0 16px;padding-left:24px}
.gd-body li{margin:0 0 8px}
.gd-body a{color:var(--accent)}
.gd-body strong{color:var(--ink)}
.gd-body hr{border:0;border-top:1px solid var(--border);margin:32px 0}
.gd-tablewrap{overflow-x:auto;margin:0 0 16px;border:1px solid var(--border);border-radius:var(--radius)}
.gd-body table{border-collapse:collapse;width:100%;font-size:14px}
.gd-body th,.gd-body td{padding:12px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
.gd-body th{background:var(--surface-2);color:var(--ink);font-weight:600}
.gd-body tbody tr:last-child td{border-bottom:0}
.gd-source{margin:32px 0 0;padding:16px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);font-size:13px;color:var(--muted);line-height:1.6}
.gd-empty{margin:24px 0 0;padding:32px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface-2);color:var(--muted);text-align:left}
@media (max-width:560px){.gd-hero{padding:32px 16px 16px}.gd-hero h1{font-size:26px}.gd-wrap{padding:0 16px 48px}.gd-card{padding:16px}}
`;

/* ─── JSON-LD ─────────────────────────────────────────────────────────────
   Built as STRINGIFIED strings — layout()'s jsonLd param is string[], and
   passing a raw object coerces to "[object Object]". */

export function guideArticleJsonLd(page: SeoContentPage): string {
  const url = `${SITE}/guides/${page.slug}`;
  const published = page.publishedAt ? new Date(page.publishedAt).toISOString() : undefined;
  const modified = page.updatedAt ? new Date(page.updatedAt).toISOString() : published;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': page.jsonldType || 'Article',
    headline: page.title,
    description: page.metaDescription || page.excerpt || undefined,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    // The real author entity — this is what makes the content attributable
    // to us (E-E-A-T), the whole point of an owned-domain channel.
    author: { '@type': 'Organization', name: page.authorEntity },
    publisher: { '@type': 'Organization', name: 'QuoteFleet', url: SITE },
    datePublished: published,
    dateModified: modified,
    isBasedOn: 'https://www.fmcsa.dot.gov/registration/carrier-safety-measurement-system',
  });
}

function breadcrumbJsonLd(items: Array<{ name: string; path: string }>): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE}${it.path}`,
    })),
  });
}

/* ─── Renderers ───────────────────────────────────────────────────────── */

export interface GuideCard {
  slug: string;
  title: string;
  excerpt: string;
  sampleSize: number | null;
}

export function renderGuidesIndex(guides: GuideCard[]): string {
  const cards = guides
    .map(
      (g) => `<li class="gd-card">
      <h2><a href="/guides/${esc(g.slug)}">${esc(g.title)}</a></h2>
      <p>${esc(g.excerpt)}</p>
      ${g.sampleSize ? `<div class="gd-meta"><span class="gd-badge">${g.sampleSize.toLocaleString('en-US')} carriers analysed</span></div>` : ''}
    </li>`,
    )
    .join('\n');

  const body = `<style>${GUIDES_CSS}</style>
  <section class="gd-hero">
    <p class="gd-eyebrow">Freight guides</p>
    <h1>Carrier market guides</h1>
    <p>Analysis of the FMCSA carrier census — fleet sizes, equipment availability and capacity by market. Every figure is computed from the ${'330,000+'} carriers in the QuoteFleet directory, not estimated.</p>
  </section>
  <div class="gd-wrap">
    ${
      guides.length
        ? `<ul class="gd-list">${cards}</ul>`
        : `<div class="gd-empty"><p>New guides are being prepared. In the meantime, browse the <a href="/directory">carrier directory</a> or the <a href="/glossary">freight glossary</a>.</p></div>`
    }
  </div>`;

  return layout({
    title: 'Carrier Market Guides — FMCSA Census Analysis | QuoteFleet',
    description:
      'Data-backed guides to US freight markets: fleet sizes, equipment mix and carrier capacity by city and state, computed from the FMCSA carrier census.',
    canonicalPath: '/guides',
    bodyHtml: body,
    jsonLd: [
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Carrier Market Guides',
        url: `${SITE}/guides`,
        publisher: { '@type': 'Organization', name: 'QuoteFleet', url: SITE },
      }),
      breadcrumbJsonLd([
        { name: 'QuoteFleet', path: '/' },
        { name: 'Guides', path: '/guides' },
      ]),
    ],
  });
}

export function renderGuideArticle(page: SeoContentPage): string {
  const data = (page.originalData ?? {}) as Record<string, unknown>;
  const computedAt = typeof data.computedAt === 'string' ? data.computedAt.slice(0, 10) : null;
  const totalInCut = typeof data.totalInCut === 'number' ? data.totalInCut : null;

  const body = `<style>${GUIDES_CSS}</style>
  <article class="gd-hero">
    <p class="gd-eyebrow"><a href="/guides">Freight guides</a></p>
    <h1>${esc(page.title)}</h1>
    ${page.excerpt ? `<p>${esc(page.excerpt)}</p>` : ''}
    <div class="gd-meta">
      <span class="gd-badge">${esc(page.authorEntity)}</span>
      ${totalInCut ? `<span class="gd-badge">${totalInCut.toLocaleString('en-US')} carriers analysed</span>` : ''}
      ${computedAt ? `<span class="gd-badge">Data as of ${esc(computedAt)}</span>` : ''}
    </div>
  </article>
  <div class="gd-wrap">
    <div class="gd-body">${renderMarkdown(page.content)}</div>
    <p class="gd-source">Source: the FMCSA carrier census as held in the QuoteFleet carrier directory${computedAt ? `, aggregated ${esc(computedAt)}` : ''}. Figures describe registered carrier populations and fleet sizes; they are not rate or pricing data. Use the <a href="/tools">rate calculator</a> for pricing.</p>
  </div>`;

  return layout({
    title: `${page.title} | QuoteFleet`,
    description: page.metaDescription ?? page.excerpt ?? page.title,
    // Self-canonical unless an editor collapsed this page onto another.
    canonicalPath: page.canonical ? page.canonical.replace(SITE, '') : `/guides/${page.slug}`,
    bodyHtml: body,
    jsonLd: [
      guideArticleJsonLd(page),
      breadcrumbJsonLd([
        { name: 'QuoteFleet', path: '/' },
        { name: 'Guides', path: '/guides' },
        { name: page.title, path: `/guides/${page.slug}` },
      ]),
    ],
  });
}

/* ─── Routes ──────────────────────────────────────────────────────────── */

export function registerGuidesRoutes(app: Express): void {
  app.get(['/guides', '/guides/'], async (req: Request, res: Response, next) => {
    try {
      const guides = await listPublishedGuides();
      setPublicDirectoryCache(req, res);
      res.type('html').send(
        renderGuidesIndex(
          guides.map((g) => ({
            slug: g.slug,
            title: g.title,
            excerpt: g.excerpt,
            sampleSize: g.sampleSize,
          })),
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  app.get('/guides/:slug', async (req: Request, res: Response, next) => {
    try {
      const page = await getPublishedSeoPageBySlug(String(req.params.slug).toLowerCase());
      // Missing / draft / in_review / archived all collapse to a redirect back
      // to the hub — the same contract as /glossary/:slug, so the sitemap can
      // never advertise a URL that dead-ends and no unpublished content leaks.
      if (!page) return res.redirect(302, '/guides');
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderGuideArticle(page));
    } catch (err) {
      next(err);
    }
  });
}
