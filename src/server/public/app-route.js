/**
 * Owner-app SPA route parsing — the single source of truth for turning a
 * browser pathname into the route the dashboard should render.
 *
 * Pure + framework-free so it can run in the dashboard browser bundle
 * (window.QFAppRoute) AND be unit-tested under vitest (module.exports).
 * No DOM, no history — callers pass in the pathname string.
 *
 * The whole point (audit shell-H2 / leads-H1): parsing must preserve the FULL
 * nested route (e.g. "leads/QF-123"), not just the base segment. Boot, refresh,
 * Back/Forward and bookmarks all derive their target through fullRoute() so a
 * deep link lands on the detail view, while baseSegment() is used only to pick
 * the top-level handler + highlight the sidebar.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (root) root.QFAppRoute = mod;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var DEFAULT_ROUTE = 'overview';

  // Full nested route from a pathname, e.g. "/app/leads/QF-123" → "leads/QF-123".
  // Anything without an "/app/<route>" tail (bare "/app", "/app/", unknown) falls
  // back to the overview route so navigation never dead-ends.
  function fullRoute(pathname) {
    var tail = String(pathname == null ? '' : pathname).split('/app/')[1];
    if (!tail) return DEFAULT_ROUTE;
    // Trim a trailing slash so "leads/" and "leads" resolve identically.
    tail = tail.replace(/\/+$/, '');
    return tail || DEFAULT_ROUTE;
  }

  // Top-level segment of a route, e.g. "leads/QF-123" → "leads". Used to pick the
  // handler in ROUTES and to highlight the sidebar nav item.
  function baseSegment(route) {
    return String(route == null ? '' : route).split('/')[0] || DEFAULT_ROUTE;
  }

  // Sub-path after a given base, e.g. subPath("leads/QF-123", "leads") → "QF-123".
  // Returns '' when the route is just the base (or a different base). Callers use
  // this to decide list-vs-detail without re-reading location.
  function subPath(route, base) {
    var full = String(route == null ? '' : route);
    var prefix = base + '/';
    return full.indexOf(prefix) === 0 ? full.slice(prefix.length) : '';
  }

  return {
    DEFAULT_ROUTE: DEFAULT_ROUTE,
    fullRoute: fullRoute,
    baseSegment: baseSegment,
    subPath: subPath,
  };
});
