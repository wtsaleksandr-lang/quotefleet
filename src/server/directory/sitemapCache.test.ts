/**
 * SEO sitemap discovery layer — pure structure/logic unit tests (no DB required).
 *
 * These lock the contract that makes the 334k-carrier directory discoverable:
 *   • the index is a valid <sitemapindex> that references every child;
 *   • carrier chunks respect the 50,000-<loc> sitemaps.org cap (proven for a
 *     >50k count without a real DB, since the dev DB has far fewer carriers);
 *   • carrier <loc>s are the canonical /directory/carrier/{slug} URL with a
 *     well-formed W3C <lastmod>;
 *   • robots.txt points crawlers at the sitemap index.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SITEMAP_MAX_URLS,
  chunkArray,
  carrierChunkCount,
  carrierLoc,
  fmtLastmod,
  xmlEscape,
  buildUrlset,
  buildSitemapIndex,
  buildIndexXml,
  buildCarrierChunkXml,
  buildCitiesXml,
  buildPagesXml,
  childDocFilename,
  carrierChunkKey,
  pagesUrlCount,
  SITE,
} from './sitemapCache.js';
import { GLOSSARY_TERMS } from './glossary.js';
import { SERVICES } from './servicePages.js';
import { DRAYAGE_RATE_PORTS, DRAYAGE_RATE_SLUGS } from './drayageRatePages.js';
import { portGroupByCode } from './containerPorts.js';

describe('sitemap chunk boundary (50k cap)', () => {
  it('SITEMAP_MAX_URLS is the sitemaps.org 50,000-URL cap', () => {
    expect(SITEMAP_MAX_URLS).toBe(50_000);
  });

  it('chunks a >50k list into files that each hold at most 50,000 entries', () => {
    // 334k carriers → the exact production case. Build a cheap synthetic list.
    const n = 334_000;
    const rows = Array.from({ length: n }, (_v, i) => ({ slug: `carrier-${i + 1}`, updatedAt: null }));
    const chunks = chunkArray(rows, SITEMAP_MAX_URLS);
    expect(chunks.length).toBe(7); // ceil(334000 / 50000)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SITEMAP_MAX_URLS);
    // Full coverage: chunks partition the list with nothing dropped or duplicated.
    expect(chunks.reduce((s, c) => s + c.length, 0)).toBe(n);
    // The last chunk holds the remainder (334000 - 6*50000 = 34000).
    expect(chunks[chunks.length - 1].length).toBe(34_000);
  });

  it('carrierChunkCount matches the chunk split at and around the boundary', () => {
    expect(carrierChunkCount(0)).toBe(0);
    expect(carrierChunkCount(1)).toBe(1);
    expect(carrierChunkCount(50_000)).toBe(1);
    expect(carrierChunkCount(50_001)).toBe(2);
    expect(carrierChunkCount(334_000)).toBe(7);
  });

  it('chunkArray rejects a non-positive size', () => {
    expect(() => chunkArray([1, 2, 3], 0)).toThrow();
  });
});

describe('canonical carrier <loc> + <lastmod> format', () => {
  it('carrierLoc is the canonical absolute profile URL', () => {
    expect(carrierLoc('harbor-link-logistics-12345')).toBe(
      'https://quotefleet.net/directory/carrier/harbor-link-logistics-12345',
    );
  });

  it('fmtLastmod emits a W3C YYYY-MM-DD date in UTC', () => {
    expect(fmtLastmod(new Date('2026-08-18T14:32:00Z'))).toBe('2026-08-18');
    // A null/invalid timestamp falls back to the provided `now` (still valid XML).
    expect(fmtLastmod(null, new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02');
    expect(fmtLastmod(undefined, new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-31');
  });

  it('xmlEscape neutralizes the five XML metacharacters', () => {
    expect(xmlEscape(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });

  it('a carrier chunk is a valid <urlset> with canonical <loc> + <lastmod>', () => {
    const xml = buildCarrierChunkXml(
      [
        { slug: 'acme-freight-1', updatedAt: new Date('2026-08-01T00:00:00Z') },
        { slug: 'beta-trucking-2', updatedAt: new Date('2026-08-10T00:00:00Z') },
      ],
      new Date('2026-08-20T00:00:00Z'),
    );
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://quotefleet.net/directory/carrier/acme-freight-1</loc>');
    expect(xml).toContain('<lastmod>2026-08-01</lastmod>');
    expect(xml).toContain('<lastmod>2026-08-10</lastmod>');
    expect((xml.match(/<url>/g) || []).length).toBe(2);
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
  });

  it('an empty carrier chunk is still a valid (empty) urlset', () => {
    const xml = buildCarrierChunkXml([], new Date('2026-08-20T00:00:00Z'));
    expect(xml).toContain('<urlset');
    expect((xml.match(/<url>/g) || []).length).toBe(0);
  });
});

describe('sitemap index structure', () => {
  it('buildSitemapIndex wraps children in <sitemapindex> with <sitemap><loc>', () => {
    const xml = buildSitemapIndex([
      { loc: `${SITE}/sitemap-pages.xml`, lastmod: '2026-08-20' },
      { loc: `${SITE}/sitemap-carriers-1.xml` },
    ]);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect((xml.match(/<sitemap>/g) || []).length).toBe(2);
    expect(xml).toContain('<loc>https://quotefleet.net/sitemap-pages.xml</loc>');
  });

  it('childDocFilename maps a doc key to its served filename', () => {
    expect(childDocFilename('pages')).toBe('sitemap-pages.xml');
    expect(childDocFilename('cities')).toBe('sitemap-cities.xml');
    expect(childDocFilename('carriers-3')).toBe('sitemap-carriers-3.xml');
  });

  it('buildIndexXml references pages + cities + every carrier chunk', () => {
    const xml = buildIndexXml(['pages', 'cities', 'carriers-1', 'carriers-2', 'carriers-3'], new Date('2026-08-20T00:00:00Z'));
    expect(xml).toContain('<loc>https://quotefleet.net/sitemap-pages.xml</loc>');
    expect(xml).toContain('<loc>https://quotefleet.net/sitemap-cities.xml</loc>');
    for (const n of [1, 2, 3]) {
      expect(xml).toContain(`<loc>https://quotefleet.net/sitemap-carriers-${n}.xml</loc>`);
    }
    expect((xml.match(/<sitemap>/g) || []).length).toBe(5);
  });

  it('a 334k-carrier directory produces a 7-carrier-chunk index (the unlock)', () => {
    const chunkKeys = Array.from({ length: carrierChunkCount(334_000) }, (_v, i) => `carriers-${i + 1}`);
    const xml = buildIndexXml(['pages', 'cities', ...chunkKeys]);
    // pages + cities + 7 carrier chunks = 9 children.
    expect((xml.match(/<sitemap>/g) || []).length).toBe(9);
    expect(xml).toContain('<loc>https://quotefleet.net/sitemap-carriers-7.xml</loc>');
    expect(xml).not.toContain('sitemap-carriers-8.xml');
  });
});

describe('cities + pages children', () => {
  it('buildCitiesXml emits canonical /directory/{state}/{city} hub URLs', () => {
    const xml = buildCitiesXml(
      [
        { stateSlug: 'texas', citySlug: 'houston' },
        { stateSlug: 'california', citySlug: 'long-beach' },
      ],
      new Date('2026-08-20T00:00:00Z'),
    );
    expect(xml).toContain('<loc>https://quotefleet.net/directory/texas/houston</loc>');
    expect(xml).toContain('<loc>https://quotefleet.net/directory/california/long-beach</loc>');
    expect((xml.match(/<url>/g) || []).length).toBe(2);
  });

  it('buildPagesXml includes marketing, directory, all 50+ state hubs and port hubs', () => {
    const xml = buildPagesXml(new Date('2026-08-20T00:00:00Z'));
    expect(xml).toContain('<loc>https://quotefleet.net/</loc>');
    expect(xml).toContain('<loc>https://quotefleet.net/directory</loc>');
    expect(xml).toContain('<loc>https://quotefleet.net/compliance</loc>');
    // State hubs (a couple of representative slugs) + at least one port hub.
    expect(xml).toContain('<loc>https://quotefleet.net/directory/texas</loc>');
    expect(xml).toContain('<loc>https://quotefleet.net/directory/california</loc>');
    expect(xml).toMatch(/<loc>https:\/\/quotefleet\.net\/directory\/port\/US[A-Z]+<\/loc>/);
    // Far more than the old static ~50-URL file's marketing-only set.
    expect((xml.match(/<url>/g) || []).length).toBeGreaterThan(60);
  });

  // ── THE GAP THIS SECTION WAS WRITTEN FOR ────────────────────────────────
  // These pages were all LIVE, all returning 200 with a unique title, canonical
  // and JSON-LD — and all missing from every sitemap document, so the only way
  // Google could reach them was by crawling a nav link. A page worth rendering
  // is a page worth advertising.
  it('buildPagesXml advertises the content surfaces, not just the directory', () => {
    const xml = buildPagesXml(new Date('2026-08-20T00:00:00Z'));
    for (const path of [
      '/compare',
      '/glossary',
      '/services',
      '/importers',
      '/manifest-privacy',
      '/drayage-rates',
    ]) {
      expect(xml).toContain(`<loc>https://quotefleet.net${path}</loc>`);
    }
  });

  it('buildPagesXml enumerates every glossary term, service and drayage-rate page', () => {
    const xml = buildPagesXml(new Date('2026-08-20T00:00:00Z'));
    // Enumerated from the same static arrays the routes serve, so the sitemap
    // can never advertise a slug that would 302 back to its hub.
    for (const t of GLOSSARY_TERMS) {
      expect(xml).toContain(`<loc>https://quotefleet.net/glossary/${t.slug}</loc>`);
    }
    for (const s of SERVICES) {
      expect(xml).toContain(`<loc>https://quotefleet.net/services/${s.slug}</loc>`);
    }
    for (const slug of DRAYAGE_RATE_SLUGS) {
      expect(xml).toContain(`<loc>https://quotefleet.net/drayage-rates/${slug}</loc>`);
    }
  });

  it('pagesUrlCount matches the document it describes', () => {
    const xml = buildPagesXml(new Date('2026-08-20T00:00:00Z'));
    // The recompute persists this number as url_count; if the two drift, the
    // cache row lies about the document it holds.
    expect((xml.match(/<url>/g) || []).length).toBe(pagesUrlCount());
  });
});

describe('drayage rate pages — the published set stays honest', () => {
  it('only publishes gateways that have BOTH a real tariff and real editorial', () => {
    expect(DRAYAGE_RATE_PORTS.length).toBeGreaterThan(0);
    for (const p of DRAYAGE_RATE_PORTS) {
      // A real port group to cross-link to.
      expect(portGroupByCode(p.groupCode)).not.toBeNull();
      // Three real price rings, strictly increasing with distance.
      expect(p.rings.length).toBe(3);
      for (let i = 1; i < p.rings.length; i += 1) {
        expect(p.rings[i].radius).toBeGreaterThan(p.rings[i - 1].radius);
        expect(p.rings[i].price).toBeGreaterThan(p.rings[i - 1].price);
      }
      // Real editorial — this is the gate that stops a gateway slipping in on
      // tariff data alone and becoming a templated doorway page.
      expect(p.intro.length).toBeGreaterThan(200);
      expect(p.faqs.length).toBeGreaterThanOrEqual(3);
      for (const f of p.faqs) expect(f.a.length).toBeGreaterThan(60);
    }
  });

  it('every slug is unique and URL-safe', () => {
    const slugs = DRAYAGE_RATE_PORTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it('merged gateways collapse to one page (LA/Long Beach, Seattle/Tacoma)', () => {
    const groups = DRAYAGE_RATE_PORTS.map((p) => p.groupCode);
    expect(new Set(groups).size).toBe(groups.length);
    expect(groups).toContain('USLALB');
    expect(groups).not.toContain('USLAX');
    expect(groups).not.toContain('USLGB');
    expect(groups).not.toContain('USTIW');
  });
});

describe('carrier chunk route key validation', () => {
  it('accepts positive integers, rejects junk / leading zeros', () => {
    expect(carrierChunkKey('1')).toBe('carriers-1');
    expect(carrierChunkKey('42')).toBe('carriers-42');
    expect(carrierChunkKey('0')).toBeNull();
    expect(carrierChunkKey('01')).toBeNull();
    expect(carrierChunkKey('-1')).toBeNull();
    expect(carrierChunkKey('1.5')).toBeNull();
    expect(carrierChunkKey('abc')).toBeNull();
    expect(carrierChunkKey('')).toBeNull();
  });
});

describe('robots.txt references the sitemap index', () => {
  it('points crawlers at /sitemap.xml and keeps /directory crawlable', () => {
    const robots = readFileSync(resolve(process.cwd(), 'src/server/public/robots.txt'), 'utf8');
    expect(robots).toMatch(/Sitemap:\s*https:\/\/quotefleet\.net\/sitemap\.xml/);
    // The carrier/directory paths must NOT be disallowed (they are the SEO surface).
    expect(robots).not.toMatch(/Disallow:\s*\/directory/);
    expect(robots).not.toMatch(/Disallow:\s*\/$/m);
  });

  /**
   * The sitemap advertises every page worth indexing as a clean PATH, so the
   * combinatorial query-string space behind /directory is pure crawl cost: each
   * facet param multiplies the same rows into another indexable URL, `?page=`
   * reaches OFFSET ~334k, and `?q=` is an unbounded ILIKE '%..%' scan. Blocking
   * the params (never the paths) is what keeps a crawl bounded.
   */
  it('blocks the heavy facet/sort/pagination QUERY STRINGS, not the paths', () => {
    const robots = readFileSync(resolve(process.cwd(), 'src/server/public/robots.txt'), 'utf8');
    for (const p of [
      'page',
      'q',
      'sort',
      'dir',
      'equipment',
      'cargo',
      'fleet',
      'drivers',
      'standing',
      'authority',
      'recent',
    ]) {
      expect(robots).toContain(`Disallow: /*?*${p}=`);
    }
    // Crawl-delay for the bots that honour it (Googlebot ignores it by design).
    expect(robots).toMatch(/^Crawl-delay:\s*\d+/m);
  });
});

describe('buildUrlset shape', () => {
  it('produces a declaration + namespaced urlset', () => {
    const xml = buildUrlset([{ loc: 'https://quotefleet.net/x' }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });
});
