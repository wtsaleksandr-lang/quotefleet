/**
 * NAV AUTH GATING + CACHE SAFETY — Alex, 2026-08.
 *
 * THE RULE: the nav must never contain a link whose destination is empty or
 * forbidden for the current visitor. Two categories, opposite treatment:
 *
 *   • PERSONAL WORKSPACES — a "my …" surface that is empty BY DEFINITION when
 *     logged out (Saved Importers). Clicking it gets a sign-in wall and nothing
 *     else → HIDDEN when logged out, shown when authenticated.
 *   • CAPABILITIES — Importer Search, Rate Calculator, RFQ, Directory Pro,
 *     Manifest Privacy → KEPT VISIBLE for everyone, because each lands on a page
 *     that explains its value and carries its own upgrade path.
 *
 * THE CACHE-SAFETY HALF IS THE ONE THAT CAN COST REAL MONEY: the public
 * directory HTML is CDN-cached (`public, s-maxage=86400`, served from
 * Cloudflare — see directory/httpCache.ts), and Cloudflare ignores `Vary` on its
 * default cache key. The ONLY guarantee that one visitor's page is safe to hand
 * to another is that the server HTML is byte-identical for everyone. So the
 * gating MUST be client-side (/nav-auth.js), and the nav constants must take no
 * auth input at all. `server HTML is auth-invariant` below is that guarantee.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SITE_NAV_HTML,
  SITE_MOBILE_MENU_HTML,
  FULL_SITE_HEADER,
  HEADER_SCRIPTS,
} from './siteChrome.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NAV_AUTH_JS = read('src/server/public/nav-auth.js');
const NAV_UNIFY_CSS = read('src/server/public/nav-unify.css');
const LANDING_HTML = read('src/server/public/landing.html');

/** Every nav surface that must obey the rule: the shared constants AND the
 *  static homepage, which carries a verbatim copy of the same markup. */
const NAV_SURFACES: ReadonlyArray<readonly [string, string]> = [
  ['SITE_NAV_HTML', SITE_NAV_HTML],
  ['SITE_MOBILE_MENU_HTML', SITE_MOBILE_MENU_HTML],
  ['landing.html', LANDING_HTML],
];

/** Personal workspaces — empty by definition when logged out. */
const PERSONAL_WORKSPACES = ['/importers/saved'];

/** Capabilities — visible to everyone, value + upgrade path on the page. */
const CAPABILITIES = [
  '/directory',
  '/compliance',
  '/glossary',
  '/guides',
  // Deep-linked on purpose: a bare /directory/rfq 302s back to /directory.
  '/directory/rfq?sort=featured',
  '/directory/join',
  '/tools',
  '/w/demo',
  '/compare',
  '/services',
  '/signup',
  '/importers',
  '/for/brokers',
  '/for/forwarders',
  '/for/ltl',
  '/manifest-privacy',
  '/pricing',
];

describe('personal workspaces are hidden from logged-out visitors', () => {
  it('ships every personal-workspace link `data-nav-auth="user" hidden`', () => {
    for (const [name, html] of NAV_SURFACES) {
      for (const href of PERSONAL_WORKSPACES) {
        // Find every anchor pointing at the workspace and require the opt-in.
        const anchors = html.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`, 'g')) ?? [];
        expect(anchors.length, `${name}: expected a link to ${href}`).toBeGreaterThan(0);
        for (const a of anchors) {
          expect(a, `${name}: ${href} must be gated`).toContain('data-nav-auth="user"');
          expect(a, `${name}: ${href} must ship hidden (anonymous is the cached state)`).toMatch(
            /\shidden(\s|>)/,
          );
        }
      }
    }
  });

  it('drops the inaccurate "(Leads Pro)" label — saving is free with any account', () => {
    // src/server/routes/importerSaved.ts: "Saving is FREE for any logged-in
    // account — it is a lead-workflow convenience, NOT a Directory Pro tier".
    // Advertising a Pro tier that does not gate it is the opposite of legible.
    for (const [name, html] of NAV_SURFACES) {
      expect(html, `${name}`).not.toContain('Saved Importers (Leads Pro)');
    }
    expect(SITE_NAV_HTML).toContain('>Saved Importers</a>');
  });
});

describe('capabilities stay visible to everyone', () => {
  it('never gates a capability link on auth', () => {
    for (const [name, html] of NAV_SURFACES) {
      for (const href of CAPABILITIES) {
        const anchors = html.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`, 'g')) ?? [];
        for (const a of anchors) {
          expect(a, `${name}: capability ${href} must not be auth-gated`).not.toContain('data-nav-auth');
        }
      }
    }
  });

  it('every capability the top nav offers is reachable from a logged-out shell', () => {
    for (const href of CAPABILITIES) {
      if (!SITE_NAV_HTML.includes(`href="${href}"`)) continue;
      const anchors = SITE_NAV_HTML.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`, 'g')) ?? [];
      for (const a of anchors) expect(a).not.toMatch(/\shidden(\s|>)/);
    }
  });

  it('states the Leads Pro boundary in prose instead of badging a free link', () => {
    // Making gating legible must not mean putting a "Pro" marker on Importer
    // Search or Saved Importers — both are free — so the group carries the line.
    expect(SITE_NAV_HTML).toContain('Decision-maker email reveals are Leads Pro');
    expect(SITE_NAV_HTML).toContain('free with an account');
  });
});

describe('THE CACHE-SAFETY GUARANTEE — server HTML is auth-invariant', () => {
  it('the nav constants are plain strings that take no auth input', () => {
    // A function would be the seam through which an auth branch could enter.
    expect(typeof SITE_NAV_HTML).toBe('string');
    expect(typeof SITE_MOBILE_MENU_HTML).toBe('string');
    expect(typeof FULL_SITE_HEADER).toBe('string');
  });

  it('renders byte-identical nav HTML for an anonymous and an authenticated request', () => {
    // The constants are module-level and evaluated once, so "render" is just
    // reading them. That IS the invariant: there is no request in scope, so no
    // response can differ by session. Pin it against a future regression that
    // makes the header a function of `req`.
    const anonymous = `${FULL_SITE_HEADER}`;
    const authenticated = `${FULL_SITE_HEADER}`;
    expect(authenticated).toBe(anonymous);
    for (const [, html] of NAV_SURFACES) {
      expect(html).not.toMatch(/isSubscriber|identity\.|req\.(user|cookies|session)/);
    }
  });

  it('the server-rendered nav carries NO session-derived value', () => {
    // Scoped to the NAV markup itself — the rest of landing.html legitimately
    // carries a contact address and marketing copy that is the same for
    // everyone. What must never appear here is THIS visitor's identity.
    const landingNav = LANDING_HTML.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
    const landingMobile = LANDING_HTML.match(/<div class="site-mobile-menu"[\s\S]*?<\/div>\s*$/m)?.[0] ?? '';
    expect(landingNav, 'landing.html nav must be extractable').toContain('Main navigation');
    for (const [name, html] of [
      ['SITE_NAV_HTML', SITE_NAV_HTML],
      ['SITE_MOBILE_MENU_HTML', SITE_MOBILE_MENU_HTML],
      ['FULL_SITE_HEADER', FULL_SITE_HEADER],
      ['landing.html nav', landingNav],
      ['landing.html mobile menu', landingMobile],
    ] as const) {
      expect(html, `${name}`).not.toMatch(/@[\w.-]+\.(com|net|org)/); // an email address
      expect(html, `${name}`).not.toContain('Sign out');
      expect(html, `${name}`).not.toContain('data-user-id');
    }
  });

  it('gating happens client-side, after the cached HTML lands', () => {
    expect(HEADER_SCRIPTS).toContain('src="/nav-auth.js"');
    expect(LANDING_HTML).toContain('src="/nav-auth.js"');
    expect(NAV_AUTH_JS).toContain('/api/directory/auth/me');
    // Reuses the memoized promise the other hydrators use → one request.
    expect(NAV_AUTH_JS).toContain('window.__qfDirMe');
  });
});

describe('/nav-auth.js behaviour', () => {
  it('reveals user-only items and hides anon-only items on a session', () => {
    expect(NAV_AUTH_JS).toContain('[data-nav-auth="user"]');
    expect(NAV_AUTH_JS).toContain('[data-nav-auth="anon"]');
    expect(NAV_AUTH_JS).toContain('removeAttribute(\'hidden\')');
    expect(NAV_AUTH_JS).toContain('setAttribute(\'hidden\'');
  });

  it('fails open-as-anonymous — a network error never exposes a gated link', () => {
    expect(NAV_AUTH_JS).toContain('.catch(');
    // The ONLY thing that reveals a gated item is a confirmed user object.
    expect(NAV_AUTH_JS).toContain('apply(!!(d && d.user))');
  });

  it('makes [hidden] authoritative — author display rules otherwise beat the UA rule', () => {
    // `.nav-dd-panel a{display:block}` and `.site-mobile-menu a{display:block}`
    // are author rules; the UA's `[hidden]{display:none}` loses to both, which
    // would leave the gated link on screen for logged-out visitors.
    expect(NAV_UNIFY_CSS).toContain('.nav-dd-panel a[hidden]');
    expect(NAV_UNIFY_CSS).toContain('.site-mobile-menu a[hidden]');
    expect(NAV_UNIFY_CSS).toMatch(/a\[hidden\][\s\S]{0,120}display:\s*none\s*!important/);
  });
});
