/**
 * Web analytics + conversion tracking — the tag layer.
 *
 * WHY THIS EXISTS
 * ───────────────
 * QuoteFleet shipped with ZERO analytics and ZERO error monitoring. The cost of
 * that was not hypothetical: a branded carrier subdomain served HTTP 429 for an
 * unknown number of days, and the FMCSA ingest ran as a no-op for a week, and
 * neither was noticed, because nothing was watching. The tag layer here covers
 * the front half of that gap (what visitors do); src/server/opsHealth.ts covers
 * the back half (whether the machine is doing its job).
 *
 * WHAT IT LOADS — AND WHY THAT CHOICE
 * ───────────────────────────────────
 * Cloudflare Web Analytics for PAGEVIEWS, and our own first-party counter for
 * CONVERSIONS. Two layers, because one tool cannot do both:
 *
 *   • Pageviews/paths/referrers → the Cloudflare beacon. All 19 QuoteFleet
 *     domains already sit behind Cloudflare on the Free plan, so it is $0
 *     forever with no new vendor. Cloudflare documents that the beacon stores
 *     nothing in the browser — no cookies, no localStorage, no IndexedDB — and
 *     discards the IP at the nearest datacentre. (Cloudflare does NOT itself
 *     say "no consent banner required"; that is an inference from the
 *     no-storage property and remains a call for counsel. What IS true is that
 *     nothing here stores or reads anything on a visitor's device.)
 *
 *   • Conversions → src/server/conversionCounters.ts, NOT Cloudflare.
 *     Cloudflare Web Analytics supports no custom events on ANY plan — their
 *     FAQ answers "Does Web Analytics support custom events?" with "Not yet".
 *     So the funnel steps that actually matter (finder → signup → claim → RFQ)
 *     could not go through the beacon even if we paid. They go to a bounded
 *     first-party daily-rollup table instead, which is also $0 and which the
 *     ops health endpoint can read back.
 *
 * Nothing in either layer sets a cookie, reads one, or sends a field a visitor
 * typed.
 *
 * ⚠ AUTO-INJECTION — READ BEFORE ENABLING IN THE DASHBOARD
 * Since Sept 2025 Cloudflare auto-injects the beacon at the edge by default on
 * free-plan PROXIED domains. If that default is left on AND we emit the snippet
 * here, every pageview is counted twice and the numbers are quietly wrong. When
 * creating the site the owner must choose "Enable with JS snippet installation"
 * (see the PR body). Snippet mode is also the only mode where the tag is under
 * our control at all, which is what makes the DNT/GPC gate below possible —
 * edge injection happens before any client code can decline it.
 *
 * THREE SWITCHES, ALL ENV, NONE NEEDING A DEPLOY
 * ──────────────────────────────────────────────
 *   ANALYTICS_DISABLED=1      kill switch. Emits nothing, anywhere. One flag,
 *                             flip it in Replit Secrets, restart, done.
 *   CF_WEB_ANALYTICS_TOKEN    the beacon's site token. UNSET = no beacon, but
 *                             the conversion script still loads, so events are
 *                             counted in the browser console in dev and start
 *                             reporting the moment a token exists.
 *   ANALYTICS_DEBUG=1         console.debug every event. Dev only.
 *
 * WHERE IT IS INJECTED — AND WHERE IT DELIBERATELY IS NOT
 * ──────────────────────────────────────────────────────
 * `analyticsTags()` is appended to `HEADER_SCRIPTS` in siteChrome.ts. That
 * constant is the single thing every full-chrome surface interpolates at the
 * END of <body> — the static marketing/legal pages through applySiteChrome, the
 * server-rendered pages through renderMarketingShell, and the whole directory /
 * RFQ / claim / glossary / OS-OW tree through directory/pages.ts's `layout()`.
 * One append therefore covers every page a visitor can convert on, with no edit
 * to any page template.
 *
 * The embeddable widget — `/w/:slug`, `/widget.html`, `/embed.js` — renders
 * through NONE of those paths (app.ts `res.sendFile('widget.html')`, no chrome,
 * no HEADER_SCRIPTS). That is not an accident we are relying on: the widget
 * runs INSIDE third-party carrier websites, and shipping our beacon into
 * someone else's page would put our tracking on their visitors under their
 * domain. It must never carry analytics. `WIDGET_EXCLUDED_PATHS` states the
 * rule, `qf-analytics.js` re-checks it client-side as a second line of defence,
 * and analyticsWiring.test.ts asserts the rendered widget HTML is clean.
 *
 * COST: one ~6KB third-party beacon on the Cloudflare Free plan, plus a ~2KB
 * first-party script. No server calls, no new service, no dependency. $0.
 */

/** Kill switch. Truthy = the entire analytics layer emits nothing. */
export const ANALYTICS_DISABLED_ENV = 'ANALYTICS_DISABLED';

/** Cloudflare Web Analytics site token (the beacon's `data-cf-beacon` token). */
export const CF_BEACON_TOKEN_ENV = 'CF_WEB_ANALYTICS_TOKEN';

/** Verbose client-side event logging. Development aid only. */
export const ANALYTICS_DEBUG_ENV = 'ANALYTICS_DEBUG';

/** Cloudflare's beacon. Pinned to the documented stable path. */
export const CF_BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** Our first-party conversion-event script. Served from src/server/public. */
export const QF_ANALYTICS_SRC = '/qf-analytics.js';

/**
 * Paths that must NEVER receive an analytics tag, because the HTML they serve
 * is embedded in a third party's page.
 *
 * Enforced in three independent places on purpose — a single check that someone
 * later refactors away would silently start tracking carriers' customers on
 * carriers' own domains, and nothing would fail:
 *   1. by construction — the widget does not render through HEADER_SCRIPTS;
 *   2. client-side — qf-analytics.js aborts if it finds itself framed or on one
 *      of these paths;
 *   3. by test — analyticsWiring.test.ts renders widget.html and asserts clean.
 */
export const WIDGET_EXCLUDED_PATHS: readonly string[] = [
  '/w/',
  '/widget.html',
  '/embed.js',
];

/** True when `path` is widget surface and must stay untracked. */
export function isWidgetPath(path: string): boolean {
  const p = (path || '').split('?')[0] ?? '';
  return WIDGET_EXCLUDED_PATHS.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x));
}

export interface AnalyticsConfig {
  /** False when ANALYTICS_DISABLED is set — nothing is emitted at all. */
  enabled: boolean;
  /** Cloudflare beacon site token, or null when the owner has not created one. */
  beaconToken: string | null;
  /** Client-side console.debug of every event. */
  debug: boolean;
}

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * Read the analytics switches.
 *
 * Reads `process.env` DIRECTLY rather than going through loadEnv(), which
 * caches its result for the life of the process. The cache is right for
 * DATABASE_URL and wrong here: a test that flips the kill switch, and an
 * operator reasoning about what the flag does, both need the value to be read
 * when it is asked for rather than frozen at first import.
 *
 * The token is validated, not just read. Cloudflare site tokens are 32 hex
 * characters; anything else is a paste error (a whole snippet, a quoted value,
 * a truncated copy) and is refused with a warning rather than emitted into
 * every page as a beacon that silently reports nothing.
 */
export function analyticsConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsConfig {
  if (truthy(env[ANALYTICS_DISABLED_ENV])) {
    return { enabled: false, beaconToken: null, debug: false };
  }
  const raw = (env[CF_BEACON_TOKEN_ENV] ?? '').trim();
  let beaconToken: string | null = null;
  if (raw) {
    if (/^[0-9a-f]{32}$/i.test(raw)) {
      beaconToken = raw.toLowerCase();
    } else {
      console.warn(
        `[analytics] ${CF_BEACON_TOKEN_ENV} is set but is not a 32-character hex site token `
        + `(got ${raw.length} chars). The beacon is NOT being emitted. Copy only the token `
        + `value from Cloudflare → Web Analytics → your site → "JS snippet", not the whole tag.`,
      );
    }
  }
  return { enabled: true, beaconToken, debug: truthy(env[ANALYTICS_DEBUG_ENV]) };
}

/** HTML-attribute-safe. The token is hex-validated above, so this is belt-and-
 *  braces against a future caller passing something else. */
function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * The tags to append at the END of <body>.
 *
 * Returns `''` — not a comment, not a stub — when analytics is off, so a
 * disabled build is byte-identical to one that never had the feature.
 *
 * NEITHER tag is in the render-blocking path. Both sit at the very end of
 * <body>, and both are deferred — the beacon by being `type="module"` (module
 * scripts defer by default, and since Cloudflare's 2026-07-13 change `module`
 * is the documented form, replacing the older `defer` snippet), ours by an
 * explicit `defer`. The parser never stops for either.
 *
 * The beacon carries `data-cf-beacon` with the site token as JSON, which is how
 * Cloudflare attributes the pageview.
 */
export function analyticsTags(env: NodeJS.ProcessEnv = process.env): string {
  const cfg = analyticsConfig(env);
  if (!cfg.enabled) return '';

  const flags = cfg.debug ? ' data-qf-debug="1"' : '';
  const beacon = cfg.beaconToken
    ? `\n<script type="module" src="${CF_BEACON_SRC}" data-cf-beacon="${attr(
        JSON.stringify({ token: cfg.beaconToken }),
      )}"></script>`
    : '';

  return `${beacon}\n<script defer src="${QF_ANALYTICS_SRC}"${flags}></script>`;
}

/**
 * The conversion events this codebase fires, as a frozen catalogue.
 *
 * Exported so the client script, the ingest endpoint's allow-list, the ops
 * health report, and the tests all share ONE list of names. Free-typed event
 * names drift ("signup" vs "sign_up" vs "signup_submit") and the drift is
 * invisible until a funnel is missing a step months later. The allow-list is
 * also the abuse bound on the public ingest endpoint: an unknown name is
 * rejected, so no caller can create rows.
 *
 * Every name here describes a VISITOR ACTION and carries no payload beyond the
 * name itself. No email, no company name, no USDOT, no query text, no session
 * identifier — the flows already collect what they need server-side, and an
 * analytics beacon is the wrong place to duplicate any of it.
 */
export const CONVERSION_EVENTS = Object.freeze({
  /** Homepage company-name finder: visitor typed enough to trigger a lookup. */
  FINDER_SEARCH: 'finder_search',
  /** Homepage company-name finder: visitor picked their company from the list. */
  FINDER_SELECT: 'finder_select',
  /** Trial signup form submitted. */
  SIGNUP_SUBMIT: 'signup_submit',
  /** Free profile claim (/claim/:slug): claim started. */
  CLAIM_START: 'claim_start',
  /** Free profile claim: verification code submitted. */
  CLAIM_VERIFY: 'claim_verify',
  /** Free profile claim: visitor accepted the trial upsell after claiming. */
  CLAIM_TRIAL: 'claim_trial',
  /** Multi-carrier rate request (RFQ) submitted by a shipper. */
  RFQ_SUBMIT: 'rfq_submit',
  /** A carrier submitted a quote back into an RFQ. */
  RFQ_QUOTE_SUBMIT: 'rfq_quote_submit',
} as const);

export type ConversionEvent = (typeof CONVERSION_EVENTS)[keyof typeof CONVERSION_EVENTS];

/** Every event name, for tests and for the client script's own allow-list. */
export const CONVERSION_EVENT_NAMES: readonly string[] = Object.freeze(
  Object.values(CONVERSION_EVENTS),
);
