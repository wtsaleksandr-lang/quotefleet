/**
 * The analytics layer's contract, asserted where it can actually regress.
 *
 * Three properties matter more than the rest, and each is a one-line change
 * away from silently breaking:
 *
 *   1. OFF means OFF. The kill switch must produce pages with no tag at all,
 *      not a disabled tag or a comment.
 *   2. THE WIDGET IS NEVER TRACKED. /w/:slug renders inside third-party carrier
 *      websites. A tag there puts our measurement on their visitors, on their
 *      domain. The widget avoids it by construction (it renders through none of
 *      the chrome paths), which is exactly the kind of guarantee that a later
 *      refactor removes without anything failing — so it is asserted against
 *      the REAL widget HTML, not against a mock.
 *   3. ON means ON, on the pages that convert — including the auth-variant
 *      pages, which take no HEADER_SCRIPTS and so needed their own injection.
 *
 * The env is manipulated and modules are re-imported, because HEADER_SCRIPTS
 * resolves its tags once at module load (see the comment on that constant).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  analyticsConfig,
  analyticsTags,
  isWidgetPath,
  CONVERSION_EVENT_NAMES,
  CF_BEACON_SRC,
  QF_ANALYTICS_SRC,
  WIDGET_EXCLUDED_PATHS,
} from './analytics.js';

/** A real 32-hex Cloudflare-shaped site token (not a live one). */
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const ENV_KEYS = ['ANALYTICS_DISABLED', 'CF_WEB_ANALYTICS_TOKEN', 'ANALYTICS_DEBUG'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('analyticsConfig', () => {
  it('is enabled by default, with no beacon until a token exists', () => {
    const c = analyticsConfig({});
    expect(c.enabled).toBe(true);
    expect(c.beaconToken).toBeNull();
  });

  it('ANALYTICS_DISABLED turns the whole layer off', () => {
    for (const v of ['1', 'true', 'YES', 'on']) {
      expect(analyticsConfig({ ANALYTICS_DISABLED: v }).enabled).toBe(false);
    }
  });

  it('accepts a 32-hex token and normalises its case', () => {
    expect(analyticsConfig({ CF_WEB_ANALYTICS_TOKEN: TOKEN.toUpperCase() }).beaconToken).toBe(TOKEN);
  });

  it('REFUSES a malformed token rather than emitting a dead beacon', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The classic paste error: the whole snippet instead of the token.
    const c = analyticsConfig({
      CF_WEB_ANALYTICS_TOKEN: `<script data-cf-beacon='{"token":"${TOKEN}"}'></script>`,
    });
    expect(c.beaconToken).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('analyticsTags', () => {
  it('emits NOTHING at all when disabled — not a comment, not a stub', () => {
    expect(analyticsTags({ ANALYTICS_DISABLED: '1', CF_WEB_ANALYTICS_TOKEN: TOKEN })).toBe('');
  });

  it('emits the conversion script even with no beacon token', () => {
    const tags = analyticsTags({});
    expect(tags).toContain(QF_ANALYTICS_SRC);
    expect(tags).not.toContain(CF_BEACON_SRC);
  });

  it('emits the Cloudflare beacon with the token as data-cf-beacon JSON', () => {
    const tags = analyticsTags({ CF_WEB_ANALYTICS_TOKEN: TOKEN });
    expect(tags).toContain(CF_BEACON_SRC);
    expect(tags).toContain(`&quot;token&quot;:&quot;${TOKEN}&quot;`);
  });

  it('keeps both tags OUT of the render-blocking path', () => {
    const tags = analyticsTags({ CF_WEB_ANALYTICS_TOKEN: TOKEN });
    // Cloudflare's documented form since 2026-07-13 is type="module" (module
    // scripts defer by default); ours is explicitly deferred. Neither blocks
    // the parser, and both are injected at the end of <body>.
    expect(tags).toContain(`type="module" src="${CF_BEACON_SRC}"`);
    expect(tags).toContain(`<script defer src="${QF_ANALYTICS_SRC}"`);
    expect(tags).not.toMatch(/<script\s+src="https:\/\/static\.cloudflareinsights/);
  });
});

describe('widget exclusion', () => {
  it('classifies every widget surface as excluded', () => {
    expect(isWidgetPath('/w/demo')).toBe(true);
    expect(isWidgetPath('/w/acme-trucking?x=1')).toBe(true);
    expect(isWidgetPath('/widget.html')).toBe(true);
    expect(isWidgetPath('/embed.js')).toBe(true);
    expect(WIDGET_EXCLUDED_PATHS.length).toBeGreaterThan(0);
  });

  it('does not over-match normal pages', () => {
    for (const p of ['/', '/pricing', '/directory/tx', '/claim/acme', '/directory/rfq', '/signup']) {
      expect(isWidgetPath(p)).toBe(false);
    }
  });

  it('the widget HTML on disk carries NO analytics tag of any kind', () => {
    // The real file the /w/:slug route sends. If someone ever pastes a beacon
    // into it, or wires it through the site chrome, this fails.
    const html = readFileSync(resolve(process.cwd(), 'src/server/public/widget.html'), 'utf8');
    expect(html).not.toContain('cloudflareinsights');
    expect(html).not.toContain('data-cf-beacon');
    expect(html).not.toContain('qf-analytics.js');
  });

  it('the conversion script refuses to run on a widget path or in a frame', () => {
    const js = readFileSync(resolve(process.cwd(), 'src/server/public/qf-analytics.js'), 'utf8');
    // Second line of defence, asserted as source because it runs in a browser.
    expect(js).toContain("path.indexOf('/w/') === 0");
    expect(js).toContain("path === '/widget.html'");
    expect(js).toContain('window.top !== window.self');
  });
});

describe('privacy posture of the client script', () => {
  it('honours Do Not Track, Global Privacy Control and Save-Data', () => {
    const js = readFileSync(resolve(process.cwd(), 'src/server/public/qf-analytics.js'), 'utf8');
    expect(js).toContain('navigator.doNotTrack');
    expect(js).toContain('globalPrivacyControl');
    expect(js).toContain('saveData');
  });

  it('sends the event NAME and nothing else — no field values, no storage', () => {
    const js = readFileSync(resolve(process.cwd(), 'src/server/public/qf-analytics.js'), 'utf8');
    expect(js).toContain('JSON.stringify({ event: name })');
    // No storage API is touched anywhere in the file.
    expect(js).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    // Never reads a value out of a form field.
    expect(js).not.toMatch(/\.elements\[|new FormData|\.value\s*\)/);
  });

  it('fires only names the server will accept', () => {
    const js = readFileSync(resolve(process.cwd(), 'src/server/public/qf-analytics.js'), 'utf8');
    for (const name of CONVERSION_EVENT_NAMES) {
      expect(js).toContain(`'${name}'`);
    }
  });

  it('covers each required conversion path', () => {
    const js = readFileSync(resolve(process.cwd(), 'src/server/public/qf-analytics.js'), 'utf8');
    expect(js).toContain('qf-finder-input');          // homepage company finder
    expect(js).toContain("f.id === 'signup-form'");   // signup
    expect(js).toContain('data-claim-start');         // free profile claim
    expect(js).toContain("action === '/directory/rfq'"); // RFQ
  });
});

describe('site chrome injection', () => {
  /** Render a page through the real chrome with a given env. */
  async function render(
    env: Record<string, string | undefined>,
    variant: 'full' | 'auth' = 'full',
  ): Promise<string> {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
    const chrome = await import('./siteChrome.js');
    const page =
      `<!doctype html><html><head><title>t</title></head><body>`
      + `${chrome.SITE_HEADER_SLOT}<main></main>`
      + (variant === 'full' ? chrome.SITE_FOOTER_SLOT : '')
      + `</body></html>`;
    return variant === 'full'
      ? chrome.applyFullSiteHeader(page, 'test.html')
      : chrome.applyAuthChrome(page, { href: '/login', label: 'Sign in' }, 'test.html');
  }

  it('injects the beacon + conversion script on a normal page when ON', async () => {
    const html = await render({ CF_WEB_ANALYTICS_TOKEN: TOKEN });
    expect(html).toContain(CF_BEACON_SRC);
    expect(html).toContain(QF_ANALYTICS_SRC);
  });

  it('injects NOTHING on a normal page when the kill switch is on', async () => {
    const html = await render({ ANALYTICS_DISABLED: '1', CF_WEB_ANALYTICS_TOKEN: TOKEN });
    expect(html).not.toContain('cloudflareinsights');
    expect(html).not.toContain(QF_ANALYTICS_SRC);
    expect(html).not.toContain('data-cf-beacon');
  });

  it('injects on the AUTH variant too — signup is a conversion', async () => {
    const html = await render({ CF_WEB_ANALYTICS_TOKEN: TOKEN }, 'auth');
    expect(html).toContain(QF_ANALYTICS_SRC);
    expect(html).toContain(CF_BEACON_SRC);
  });

  it('injects the conversion script EXACTLY ONCE per page', async () => {
    // The full variant gets its tags inside HEADER_SCRIPTS; the auth variant
    // gets them separately. A refactor that ran both paths would double-count
    // every conversion, and nothing else would complain.
    for (const variant of ['full', 'auth'] as const) {
      const html = await render({ CF_WEB_ANALYTICS_TOKEN: TOKEN }, variant);
      expect(html.split(QF_ANALYTICS_SRC).length - 1, `${variant} variant`).toBe(1);
      expect(html.split(CF_BEACON_SRC).length - 1, `${variant} variant`).toBe(1);
    }
  });

  it('lands the tags at the END of the body, after the content', async () => {
    const html = await render({ CF_WEB_ANALYTICS_TOKEN: TOKEN });
    expect(html.indexOf('<main>')).toBeLessThan(html.indexOf(QF_ANALYTICS_SRC));
    expect(html.indexOf(QF_ANALYTICS_SRC)).toBeLessThan(html.indexOf('</body>'));
  });

  it('the auth variant stays free of HEADER_SCRIPTS chrome behaviour', async () => {
    // Guards the narrowness of the auth-variant injection: analytics only, not
    // the burger/dropdown bundle, which that bar has no markup for.
    const html = await render({ CF_WEB_ANALYTICS_TOKEN: TOKEN }, 'auth');
    expect(html).not.toContain('/nav-auth.js');
    expect(html).not.toContain('data-nav-dd');
  });
});
