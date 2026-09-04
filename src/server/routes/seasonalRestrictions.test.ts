/**
 * THE PUBLIC REFERENCE SURFACE.
 *
 * Two claims are worth a test here and they pull in opposite directions:
 *
 *   1. THE PAGE MUST WORK WITH THE DATABASE DOWN. The dev Neon branch is over
 *      quota and 500s, and prod's compute suspends. A reference page that
 *      returns a 500 in that state is worse than useless — the whole value is
 *      the link to the state, which lives in a compiled constant and needs no
 *      database at all.
 *   2. IT MUST NOT SAY "CLEAR" WHEN IT MEANS "UNKNOWN". With no data, every
 *      status has to read as unknown, and the copy has to send the reader to
 *      the state. That is the difference between a useful mirror and a
 *      dangerous one.
 */
import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import express from 'express';

const loadSeasonalContext = vi.fn();

vi.mock('../seasonal/store.js', () => ({
  loadSeasonalContext: (...a: unknown[]) => loadSeasonalContext(...a),
}));

import {
  SEASONAL_TOOL_PATH,
  registerSeasonalRestrictionRoutes,
  seasonalStatePath,
  specBySlug,
} from './seasonalRestrictions.js';
import { SEASONAL_SOURCES, seasonalSourceFor } from '../../calc/osow/seasonal/sources.js';
import { SITE_NAV_HTML, SITE_MOBILE_MENU_HTML, PREMIUM_FOOTER } from '../siteChrome.js';
import type { StateSeasonalSnapshot } from '../../calc/osow/seasonal/types.js';

function startServer(): Promise<{ base: string; close: () => void }> {
  const app = express();
  registerSeasonalRestrictionRoutes(app);
  return new Promise((res) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      res({ base: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function get(path: string): Promise<{ status: number; body: string }> {
  const s = await startServer();
  try {
    const r = await fetch(`${s.base}${path}`);
    return { status: r.status, body: await r.text() };
  } finally {
    s.close();
  }
}

/** What `loadSeasonalContext` returns when the store is unreachable. */
const DB_DOWN = { snapshots: new Map<string, StateSeasonalSnapshot>(), storeUnavailable: true };

function liveNd(): StateSeasonalSnapshot {
  const spec = seasonalSourceFor('ND')!;
  return {
    code: 'ND',
    name: spec.name,
    programme: spec.programme,
    rows: [
      {
        value: { scope: 'route-segment', area: 'ND 15 MP 46.3-52.3', limit: '7 Ton', orderRef: 'Order 2026-4' },
        source: {
          id: spec.sourceId,
          title: spec.authorityTitle,
          url: spec.authorityUrl,
          publisher: spec.publisher,
          revisedOn: '2026-03-10',
          retrievedOn: '2026-03-15',
        },
        effectiveFrom: '2026-03-11',
        effectiveTo: null,
      },
    ],
    retrievedOn: '2026-03-15',
    bulletinDate: '2026-03-10',
    fetchStatus: 'ok',
    verifiedClear: false,
    staleFailureDirection: spec.staleFailureDirection,
    authorityUrl: spec.authorityUrl,
    authorityTitle: spec.authorityTitle,
    lastError: null,
    ageDays: 0,
  };
}

describe('slugs', () => {
  it('round-trip every state in the registry', () => {
    for (const spec of SEASONAL_SOURCES) {
      const path = seasonalStatePath(spec);
      const slug = path.slice(`${SEASONAL_TOOL_PATH}/`.length);
      expect(specBySlug(slug)?.code).toBe(spec.code);
    }
  });

  it('accepts a two-letter code too, so a pasted state abbreviation works', () => {
    expect(specBySlug('nd')?.code).toBe('ND');
  });
});

describe('the index page, WITH THE DATABASE DOWN', () => {
  it('still renders 200 with every state and every authoritative link', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { status, body } = await get(SEASONAL_TOOL_PATH);
    expect(status).toBe(200);
    for (const spec of SEASONAL_SOURCES) {
      expect(body, `${spec.code} missing`).toContain(spec.name);
      expect(body, `${spec.code} link missing`).toContain(spec.authorityUrl);
    }
  });

  it('reads UNKNOWN, never clear, for every restricting state', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(SEASONAL_TOOL_PATH);
    expect(body).toContain('Status unknown — check the state');
    expect(body).not.toContain('No restriction in force');
    expect(body).toContain('We hold no current reading of this source.');
  });

  it('states the honesty contract in the hero, not in a footnote', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(SEASONAL_TOOL_PATH);
    expect(body).toContain('We never tell you a road is clear.');
    expect(body).toContain("The state's own page is the authority");
  });

  it('publishes the local-only correction the aggregators get wrong', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(SEASONAL_TOOL_PATH);
    expect(body).toContain('States where the restriction is local, or absent');
    expect(body).toContain('Local roads only');
    expect(body).toContain('county engineer');
  });
});

describe('the index page, with live data', () => {
  it('shows a restriction count for a state that has one', async () => {
    loadSeasonalContext.mockResolvedValue({ snapshots: new Map([['ND', liveNd()]]) });
    const { body } = await get(SEASONAL_TOOL_PATH);
    expect(body).toContain('1 restriction in force');
    expect(body).toContain('Read today (2026-03-15).');
    expect(body).toContain('The document itself is dated 2026-03-10.');
  });
});

describe('a per-state page', () => {
  it('renders the restriction, its window and the state link', async () => {
    loadSeasonalContext.mockResolvedValue({ snapshots: new Map([['ND', liveNd()]]) });
    const { status, body } = await get(`${SEASONAL_TOOL_PATH}/north-dakota`);
    expect(status).toBe(200);
    expect(body).toContain('North Dakota Spring Thaw Weight Restrictions');
    expect(body).toContain('ND 15 MP 46.3-52.3');
    expect(body).toContain('7 Ton');
    expect(body).toContain('no published lift date');
    expect(body).toContain('travelfiles.dot.nd.gov');
  });

  it('publishes the plumbing — format, readability, cadence and which way staleness errs', async () => {
    loadSeasonalContext.mockResolvedValue({ snapshots: new Map([['ND', liveNd()]]) });
    const { body } = await get(`${SEASONAL_TOOL_PATH}/north-dakota`);
    expect(body).toContain('GeoJSON feed');
    expect(body).toContain('Machine-readable');
    expect(body).toContain('Posting season');
    expect(body).toContain('Polling cadence today');
    expect(body).toContain('If our copy goes stale');
    expect(body).toContain('showing a restriction the state has already lifted');
  });

  it('for a local-only state, says who to ask instead', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(`${SEASONAL_TOOL_PATH}/ohio`);
    expect(body).toContain('posts no seasonal restriction on the state highway system');
    expect(body).toContain('county engineers');
  });

  it('with nothing held, says so in as many words rather than showing an empty list', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(`${SEASONAL_TOOL_PATH}/michigan`);
    expect(body).toContain('We hold no confirmed restriction list');
    expect(body).toContain('<strong>not</strong> the same as "no restrictions"');
  });

  it('404s an unknown state rather than rendering an empty shell', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { status } = await get(`${SEASONAL_TOOL_PATH}/atlantis`);
    expect(status).toBe(404);
  });
});

describe('the JSON mirror', () => {
  it('carries the disclaimer, the cadence and the source metadata for every state', async () => {
    loadSeasonalContext.mockResolvedValue({ snapshots: new Map([['ND', liveNd()]]) });
    const { status, body } = await get('/api/tools/seasonal-restrictions');
    expect(status).toBe(200);
    const json = JSON.parse(body) as {
      disclaimer: string;
      states: Array<{ code: string; cadence: { tier: string }; active: unknown[]; format: string }>;
    };
    expect(json.disclaimer).toContain('is not evidence that a road is clear');
    expect(json.states).toHaveLength(SEASONAL_SOURCES.length);
    const nd = json.states.find((s) => s.code === 'ND')!;
    expect(nd.format).toBe('geojson');
    expect(nd.active).toHaveLength(1);
    expect(nd.cadence.tier).toBeTruthy();
  });

  it('says the store was unavailable rather than reporting an empty world', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get('/api/tools/seasonal-restrictions');
    expect(JSON.parse(body).storeUnavailable).toBe(true);
  });
});

describe('chrome and house UI rules', () => {
  it('carries the site nav, the mobile menu and the premium footer', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(SEASONAL_TOOL_PATH);
    expect(body).toContain(SITE_NAV_HTML);
    expect(body).toContain(SITE_MOBILE_MENU_HTML);
    expect(body).toContain(PREMIUM_FOOTER);
  });

  it('is reachable from the nav and BOTH footers', async () => {
    // Nav + premium footer travel with the page. The DIRECTORY footer is a
    // second, separate footer on ~334k public pages, and a link added to one
    // and not the other is the inconsistency this asserts against.
    const { readFileSync } = await import('node:fs');
    const dirFooter = readFileSync(
      new URL('../directory/pages.ts', import.meta.url),
      'utf8',
    );
    expect(SITE_NAV_HTML).toContain(SEASONAL_TOOL_PATH);
    expect(SITE_MOBILE_MENU_HTML).toContain(SEASONAL_TOOL_PATH);
    expect(PREMIUM_FOOTER).toContain(SEASONAL_TOOL_PATH);
    expect(dirFooter).toContain(SEASONAL_TOOL_PATH);
  });

  it('uses theme tokens only — no raw hex can break light or dark', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(SEASONAL_TOOL_PATH);
    const ourCss = /<style>([\s\S]*?)<\/style>/.exec(body)?.[1] ?? '';
    expect(ourCss).toContain('.sr-shell');
    expect(ourCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('left-aligns the hero and puts the eyebrow above the H1', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(SEASONAL_TOOL_PATH);
    const ourCss = /<style>([\s\S]*?)<\/style>/.exec(body)?.[1] ?? '';
    // The shared .hero centres; the page must override it.
    expect(ourCss).toContain('.sr-hero { padding: 48px 24px 16px; text-align: left; }');
    expect(ourCss).toContain('.sr-hero h1 { font-size: 40px');
    expect(body.indexOf('class="sr-eyebrow"')).toBeLessThan(body.indexOf('<h1>'));
  });

  it('has a 375px story — the grid collapses to one column and the dl stacks', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(SEASONAL_TOOL_PATH);
    const ourCss = /<style>([\s\S]*?)<\/style>/.exec(body)?.[1] ?? '';
    expect(ourCss).toContain('@media (max-width: 760px)');
    expect(ourCss).toContain('.sr-cards { grid-template-columns: minmax(0, 1fr); }');
    expect(ourCss).toContain('.sr-dl { grid-template-columns: minmax(0, 1fr)');
  });

  it('uses OUTLINE pills, never a bright fill', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const { body } = await get(SEASONAL_TOOL_PATH);
    const ourCss = /<style>([\s\S]*?)<\/style>/.exec(body)?.[1] ?? '';
    expect(ourCss).toContain('.sr-pill { display: inline-flex');
    expect(ourCss).toContain('background: transparent');
    expect(ourCss).not.toMatch(/\.sr-pill\.is-live \{[^}]*background: var\(--warn\)/);
  });

  it('canonicalises each page to its own URL', async () => {
    loadSeasonalContext.mockResolvedValue(DB_DOWN);
    const idx = await get(SEASONAL_TOOL_PATH);
    expect(idx.body).toContain(`<link rel="canonical" href="https://quotefleet.net${SEASONAL_TOOL_PATH}">`);
    const state = await get(`${SEASONAL_TOOL_PATH}/minnesota`);
    expect(state.body).toContain(
      `<link rel="canonical" href="https://quotefleet.net${SEASONAL_TOOL_PATH}/minnesota">`,
    );
  });
});
