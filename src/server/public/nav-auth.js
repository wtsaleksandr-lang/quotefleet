/**
 * NAV AUTH GATING — client-side only, by design.
 *
 * THE RULE (Alex, 2026-08): the nav must never contain a link whose destination
 * is empty or forbidden for the current visitor. Two categories, opposite
 * treatment:
 *
 *   • PERSONAL WORKSPACES — a "my …" surface that is empty BY DEFINITION when
 *     logged out (Saved Importers). Clicking it gets a sign-in wall and nothing
 *     else, so it is HIDDEN until a session is confirmed. Markup opts in with
 *     `data-nav-auth="user" hidden`.
 *   • CAPABILITIES — Importer Search, Rate Calculator, RFQ, Directory Pro,
 *     Manifest Privacy. These stay visible for everyone; each lands on a page
 *     that explains its value and carries its own upgrade path. They are not
 *     touched by this script.
 *
 * `data-nav-auth="anon"` is the mirror case (shown only when logged OUT) and is
 * supported so an auth-only affordance never needs a server branch either.
 *
 * WHY CLIENT-SIDE — THIS IS A CACHE-SAFETY CONSTRAINT, NOT A PREFERENCE:
 * the public directory HTML is CDN-cached (`public, s-maxage=86400`, served
 * from Cloudflare — see src/server/directory/httpCache.ts). Cloudflare ignores
 * `Vary` on its default cache key, so the ONLY guarantee that one visitor's
 * page is safe to hand to another is that the server HTML is byte-identical for
 * everyone. Gating the nav server-side would silently poison that cache with a
 * signed-in nav. So the server always ships the anonymous shell and this script
 * hydrates it AFTER the cached HTML lands — exactly like NAV_SHIPPER_SCRIPT and
 * CARRIER_PRO_HYDRATE_SCRIPT in src/server/directory/pages.ts.
 *
 * The `/api/directory/auth/me` promise is memoized on `window.__qfDirMe` — the
 * same key those two hydrators use — so a directory page that runs all three
 * still makes exactly ONE request. That endpoint is soft-auth (never 401) and
 * sets `private, no-store`, so it is never itself cached.
 *
 * Fails OPEN-AS-ANONYMOUS: on any network/parse error the nav is left exactly
 * as the server rendered it, which is the anonymous state. A visitor never sees
 * a broken menu, only (at worst) one they would have seen logged out.
 *
 * The `hidden` attribute is made authoritative in /nav-unify.css — its UA rule
 * is only `display:none` at element specificity, and author rules like
 * `.nav-dd-panel a{display:block}` silently beat it.
 */
(function () {
  'use strict';

  var USER_SEL = '[data-nav-auth="user"]';
  var ANON_SEL = '[data-nav-auth="anon"]';

  function each(sel, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(sel), fn);
  }

  function setShown(el, shown) {
    if (shown) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  function apply(signedIn) {
    each(USER_SEL, function (el) { setShown(el, signedIn); });
    each(ANON_SEL, function (el) { setShown(el, !signedIn); });
  }

  // Nothing on this page opts in → don't spend a request.
  if (!document.querySelector(USER_SEL) && !document.querySelector(ANON_SEL)) return;

  window.__qfDirMe = window.__qfDirMe || fetch('/api/directory/auth/me', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin'
  }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });

  window.__qfDirMe
    .then(function (d) { apply(!!(d && d.user)); })
    .catch(function () { /* stay anonymous — the server-rendered state */ });
})();
