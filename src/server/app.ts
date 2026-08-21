import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants, brandConfigs } from '../db/schema.js';
import {
  accessTokenFromReq,
  consumeAccessToken,
  hasValidAccessCookie,
  hasValidPreviewGrant,
  PREVIEW_GRANT_TTL_MS,
  setAccessCookie,
  renderGatePage,
} from './access.js';
import { renderHostedPage } from './hostedPage.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerTenantRoutes } from './routes/tenant.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAutocompleteRoutes } from './routes/autocomplete.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerInboundRoutes } from './routes/inbound.js';
import { registerMarketplaceRoutes } from './routes/marketplace.js';
import { registerMarketplaceRedirects } from './routes/marketplaceRedirect.js';
import { registerDirectoryRoutes } from './routes/directory.js';
import { registerDirectoryExportRoutes } from './routes/directoryExport.js';
import { registerRfqRoutes } from './routes/rfq.js';
import { registerServiceRoutes } from './directory/servicePages.js';
import { registerGlossaryRoutes } from './directory/glossary.js';
import { registerToolsRoutes } from './routes/tools.js';
import { registerBillingRoutes, registerStripeWebhook } from './routes/billing.js';
import { registerConnectRoutes, registerConnectWebhook } from './routes/connect.js';
import { registerMarketingChatRoute } from './routes/marketingChat.js';
import { registerQuoteDocRoutes } from './routes/quoteDoc.js';
import { registerQuoteMapRoutes } from './routes/quoteMap.js';
import { registerQuoteActivityRoutes } from './routes/quoteActivity.js';
import { registerCarrierProfileRoutes } from './routes/carrierProfile.js';
import { registerOutreachRoutes } from './routes/outreach.js';
import { registerProspectDemoRoutes } from './routes/prospectDemo.js';
import { registerUnsubscribeRoutes } from './routes/unsubscribe.js';
import { registerOutreachUnsubscribeRoutes } from './routes/outreachUnsubscribe.js';
import { registerInboundReviewRoutes } from './routes/inboundReview.js';
import { registerInboundWebhookRoutes } from './routes/inboundWebhook.js';
import { hostInfoMiddleware } from './hostInfo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function allowsExternalFraming(req: express.Request): boolean {
  const path = req.path;
  return (
    path === '/embed.js' ||
    path === '/widget.html' ||
    path.startsWith('/w/') ||
    path.startsWith('/quote/') ||
    path.startsWith('/chat/') ||
    path.startsWith('/api/public/') ||
    (path === '/' && !!(req.tenantSubdomain || req.tenantCustomDomainSlug))
  );
}

function applyPageSkin(html: string, extraCss: string[], bodyClass: string): string {
  const styles = extraCss.map((href) => `  <link rel="stylesheet" href="${href}">`).join('\n');
  const classes = ['qf-public-wft', bodyClass].filter(Boolean).join(' ');
  return html
    .replace('<link rel="stylesheet" href="/style.css">', `<link rel="stylesheet" href="/style.css">\n  <link rel="stylesheet" href="/public-pages-wefixtrades.css">\n${styles}`)
    .replace('<body>', `<body class="${classes}">`);
}

function applyDpaPageSkin(html: string): string {
  return applyPageSkin(html, ['/dpa-wefixtrades.css'], '');
}

function applyToolsMarketplaceSkin(html: string): string {
  return applyPageSkin(html, ['/tools-marketplace-wefixtrades.css'], 'qf-tools-marketplace');
}

// ── Canonical full site header + mobile menu + premium footer ──────────────
// Single source of truth for the marketing/legal-page chrome. Kept identical to
// the homepage (landing.html) header so every page shares the same navigation:
// Solutions dropdown, Pricing, Compare, Demo, theme toggle, Sign in, CTA, and a
// working mobile hamburger. Styling lives in /nav-unify.css (token-first, so it
// is theme-aware and matches the homepage in both light and dark).
const FULL_SITE_HEADER = `<header class="site-header">
    <div class="site-header-inner">
      <a href="/" class="site-brand" aria-label="QuoteFleet home"><span class="site-logo" aria-hidden="true"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>QuoteFleet</a>
      <nav class="site-nav" aria-label="Main navigation"><div class="nav-dd" data-nav-dd><button type="button" class="nav-dd-trigger" id="solutions-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="solutions-menu">Solutions<svg class="nav-dd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button><div class="nav-dd-panel" id="solutions-menu" hidden><div class="nav-dd-group"><p class="nav-dd-head">Tools</p><a href="/tools">Rate calculator</a><a href="/directory">Carrier directory</a><a href="/compliance">Compliance tools</a><a href="/services">Carrier services</a><a href="/glossary">Freight glossary</a></div><div class="nav-dd-group"><p class="nav-dd-head">For your business</p><a href="/for/brokers">Freight brokers</a><a href="/for/forwarders">Freight forwarders</a><a href="/for/ltl">LTL</a></div></div></div><a href="/pricing">Pricing</a><a href="/compare">Compare</a><a href="/w/demo">Demo</a></nav>
      <div class="site-actions"><button type="button" class="qf-theme-btn" aria-label="Toggle light/dark theme" aria-pressed="false" title="Toggle theme"><svg class="qf-ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="qf-ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button><a class="signin" href="/login">Sign in</a><a class="btn btn-secondary" href="/w/demo">View demo <span class="arr">→</span></a><button type="button" class="site-burger" id="site-burger" aria-label="Open menu" aria-expanded="false" aria-controls="site-mobile-menu"><svg class="ico-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg><svg class="ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button></div>
    </div>
    <div class="site-mobile-menu" id="site-mobile-menu" hidden><p class="mm-head">Tools</p><a href="/tools">Rate calculator</a><a href="/directory">Carrier directory</a><a href="/compliance">Compliance tools</a><a href="/services">Carrier services</a><a href="/glossary">Freight glossary</a><p class="mm-head">For your business</p><a href="/for/brokers">Freight brokers</a><a href="/for/forwarders">Freight forwarders</a><a href="/for/ltl">LTL</a><p class="mm-head">More</p><a href="/pricing">Pricing</a><a href="/compare">Why QuoteFleet</a><a href="/w/demo">Demo</a><a href="/login">Sign in</a></div>
  </header>`;

const PREMIUM_FOOTER = `<footer class="premium-footer"><div class="premium-footer-inner"><div class="footer-brand"><a href="/" class="qf-footer-brand" aria-label="QuoteFleet home"><img class="qf-footer-logo" src="/brand/logo-full-ondark.png" alt="QuoteFleet — freight rate calculator" width="168" height="113" decoding="async"></a><div class="qf-footer-brandtext"><a href="/" class="qf-footer-wordmark">QuoteFleet</a><p class="qf-footer-tagline">Branded rate calculator pages, PDF quotes, and optional AI chat for trucking service providers.</p></div></div><div class="footer-col"><h4>Product</h4><a href="/w/demo">Demo</a><a href="/pricing">Pricing</a><a href="/compare">Why QuoteFleet</a><a href="/signup">Start free</a></div><div class="footer-col"><h4>Solutions</h4><a href="/tools">Free rate calculator</a><a href="/for/brokers">For freight brokers</a><a href="/for/forwarders">For freight forwarders</a><a href="/for/ltl">For LTL</a><a href="/directory">Carrier directory</a><a href="/services">Carrier services</a><a href="/compliance">Compliance tools</a><a href="/glossary">Freight glossary</a></div><div class="footer-col"><h4>Company</h4><a href="mailto:hello@quotefleet.net">Contact</a><a href="/support">Support</a><a href="/login">Sign in</a><a href="/security">Security</a></div><div class="footer-col"><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/refund">Refund &amp; Cancellation</a><a href="/dpa">Data Processing (DPA)</a><a href="/cookie">Cookie Policy</a><a href="/.well-known/security.txt">security.txt</a></div></div><ul class="qf-footer-trustbar" role="list"><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7.5a5 5 0 0 1 10 0V11"/></svg>Payments secured by Stripe</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v6c0 4.4 3.2 7.4 7.5 8.9 4.3-1.5 7.5-4.5 7.5-8.9V6z"/><path d="m9 12 2 2 4-4"/></svg>SSL/TLS encrypted</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 4 5.5v6c0 4.6 3.3 7.7 8 9.5 4.7-1.8 8-4.9 8-9.5v-6z"/><circle cx="12" cy="11" r="2.4"/><path d="M12 13.4V16"/></svg>GDPR &amp; CCPA-ready</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg>Per-tenant data isolation</li></ul><div class="footer-bottom"><span>© <span id="year"></span> QuoteFleet. All rights reserved.</span><span class="qf-foot-operator">QuoteFleet is a product of MR Holdings &amp; Trade LLC.</span></div></footer>`;

// Burger + Solutions-dropdown behaviour, mirrored from landing.html so the
// injected header is interactive. Idempotent #year setter included.
const HEADER_SCRIPTS = `<script>
  (function () {
    var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
    var b = document.getElementById('site-burger');
    var m = document.getElementById('site-mobile-menu');
    if (b && m) {
      var set = function (open) {
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        if (open) m.removeAttribute('hidden'); else m.setAttribute('hidden', '');
      };
      b.addEventListener('click', function (e) { e.stopPropagation(); set(b.getAttribute('aria-expanded') !== 'true'); });
      m.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
      document.addEventListener('click', function (e) { if (!m.hasAttribute('hidden') && !m.contains(e.target) && !b.contains(e.target)) set(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
    }
    var dd = document.querySelector('[data-nav-dd]');
    if (dd) {
      var trigger = dd.querySelector('.nav-dd-trigger');
      var panel = dd.querySelector('.nav-dd-panel');
      if (trigger && panel) {
        var hoverable = window.matchMedia('(hover: hover) and (pointer: fine)');
        var hoverTimer;
        var isOpen = function () { return trigger.getAttribute('aria-expanded') === 'true'; };
        var open = function (o) {
          trigger.setAttribute('aria-expanded', o ? 'true' : 'false');
          dd.classList.toggle('is-open', o);
          if (o) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
        };
        trigger.addEventListener('click', function (e) { e.stopPropagation(); if (hoverable.matches) open(true); else open(!isOpen()); });
        trigger.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); open(true); var f = panel.querySelector('a'); if (f) f.focus(); } });
        dd.addEventListener('mouseenter', function () { if (!hoverable.matches) return; clearTimeout(hoverTimer); open(true); });
        dd.addEventListener('mouseleave', function () { if (!hoverable.matches) return; hoverTimer = setTimeout(function () { open(false); }, 140); });
        dd.addEventListener('focusout', function (e) { if (!dd.contains(e.relatedTarget)) open(false); });
        document.addEventListener('click', function (e) { if (isOpen() && !dd.contains(e.target)) open(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) { open(false); trigger.focus(); } });
      }
    }
  })();
</script>`;

// Replace a static page's stripped `.topnav` header + reduced `.site-footer`
// with the canonical full header + premium footer, and inject the header CSS +
// interactivity. Safe to compose on top of applyDpaPageSkin / applyToolsMarketplaceSkin.
function applyFullSiteHeader(html: string): string {
  let out = html;
  if (!out.includes('/nav-unify.css')) {
    out = out.replace('</head>', '  <link rel="stylesheet" href="/nav-unify.css">\n</head>');
  }
  out = out.replace(/<header class="topnav">[\s\S]*?<\/header>/, FULL_SITE_HEADER);
  out = out.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, PREMIUM_FOOTER);
  out = out.replace('</body>', `${HEADER_SCRIPTS}\n</body>`);
  return out;
}

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Gzip/brotli-compress all responses. Must run before the routes + static
  // handler so their HTML/CSS/JS bodies are compressed on the way out — the
  // origin was shipping ~280 KB of text uncompressed, the largest LCP cost.
  app.use(compression());

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  registerStripeWebhook(app);
  registerConnectWebhook(app);

  app.use(express.json({ limit: '7mb' }));
  app.use(express.urlencoded({ extended: true, limit: '7mb' }));
  app.use(cookieParser());
  app.use(hostInfoMiddleware);

  app.use((req, res, next) => {
    if (!allowsExternalFraming(req)) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    next();
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/public/') || req.path === '/embed.js') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });

  registerAuthRoutes(app);
  registerOAuthRoutes(app);
  // Prospect-demo routes MUST precede the tenant public routes: they get first
  // crack at the shared /api/public/{widget,quote,lead,route-preview}/:slug
  // paths and call next() when the slug is not a demo token (see prospectDemo.ts).
  registerProspectDemoRoutes(app);
  registerPublicRoutes(app);
  registerTenantRoutes(app);
  registerAdminRoutes(app);
  registerAiRoutes(app);
  registerAutocompleteRoutes(app);
  registerIngestRoutes(app);
  registerInboundRoutes(app);
  registerMarketplaceRoutes(app);
  // Export routes MUST precede the directory routes: their specific paths
  // (/directory/export/view, /directory/export.xlsx|.csv) would otherwise be
  // swallowed by /directory/:stateSlug(/:citySlug).
  registerDirectoryExportRoutes(app);
  registerDirectoryRoutes(app);
  registerRfqRoutes(app);
  registerServiceRoutes(app);
  registerGlossaryRoutes(app);
  registerToolsRoutes(app);
  registerBillingRoutes(app);
  registerConnectRoutes(app);
  registerMarketingChatRoute(app);
  registerQuoteDocRoutes(app);
  registerQuoteMapRoutes(app);
  registerQuoteActivityRoutes(app);
  registerCarrierProfileRoutes(app);
  registerOutreachRoutes(app);
  registerUnsubscribeRoutes(app);
  registerOutreachUnsubscribeRoutes(app);
  registerInboundReviewRoutes(app);
  registerInboundWebhookRoutes(app);

  app.get(['/healthz', '/api/health'], async (_req, res) => {
    const time = new Date().toISOString();
    try {
      await db().select({ id: tenants.id }).from(tenants).limit(1);
      return res.json({ ok: true, status: 'up', db: 'up', time });
    } catch (err) {
      console.error('[health] db ping failed:', err);
      return res.status(503).json({ ok: false, status: 'down', db: 'down', time });
    }
  });

  const publicDir = resolve(process.cwd(), 'src/server/public');

  // Serve the widget shell, optionally injecting the tenant slug (custom-
  // domain path, where there's no slug in the URL for widget.js to read).
  function sendWidgetHtml(
    res: express.Response,
    next: express.NextFunction,
    injectSlug: string | null
  ) {
    if (!injectSlug) return res.sendFile('widget.html', { root: publicDir });
    readFile(resolve(publicDir, 'widget.html'), 'utf8')
      .then((html) => {
        const inject = `<script>window.QF_TENANT_SLUG=${JSON.stringify(injectSlug)};</script>\n`;
        res
          .type('html')
          .send(html.replace('<script src="/widget.js"></script>', inject + '<script src="/widget.js"></script>'));
      })
      .catch(next);
  }

  // Hosted trust-wrap decision. The HOSTED page (the direct customer link:
  // `/w/:slug`, the subdomain, custom domains) gets the lean landing shell that
  // frames the calculator with the carrier's trust content. The EMBED path
  // (`?embed=1`, the iframe the JS snippet mounts) and any `?raw=1` request stay
  // the BARE calculator — the wrap must never leak into a third-party embed. The
  // calculator inside the wrap is the SAME served widget (iframed with
  // `?embed=1`), so its behaviour is unchanged. Non-breaking: if the brand read
  // or render throws (e.g. a DB behind on migration 0035), we serve the bare
  // widget, exactly as before.
  async function serveHostedOrBare(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
    tenant: { id: number; slug: string; name: string; dotNumber: string | null; mcNumber: string | null },
    injectSlug: boolean
  ): Promise<void> {
    const isEmbed = req.query.embed !== undefined;
    const isRaw = req.query.raw !== undefined;
    if (isEmbed || isRaw) return void sendWidgetHtml(res, next, injectSlug ? tenant.slug : null);
    try {
      const brand =
        (await db()
          .select()
          .from(brandConfigs)
          .where(eq(brandConfigs.tenantId, tenant.id))
          .limit(1))[0] ?? null;
      // Inner calculator src = this same URL, forced to the bare embed widget.
      // Forwarding the existing query (e.g. an owner-preview `?pk=` grant) keeps
      // the nested widget authorised + in preview context.
      const u = new URL(req.originalUrl, 'http://local');
      u.searchParams.set('embed', '1');
      u.searchParams.delete('raw');
      const calcSrc = u.pathname + '?' + u.searchParams.toString();
      res.type('html').send(renderHostedPage({ tenant, brand, calcSrc }));
    } catch (err) {
      console.warn('[hosted-wrap] render failed, serving bare widget:', (err as Error).message);
      sendWidgetHtml(res, next, injectSlug ? tenant.slug : null);
    }
  }

  // Access-aware widget page. For a PRIVATE tenant, an invite token (`?key=`)
  // is consumed → signed cookie set → redirect to the clean URL; a valid
  // existing cookie passes straight through; otherwise the branded gate page
  // is served (no calculator, no rates). PUBLIC tenants are unaffected.
  async function serveWidgetPage(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
    slug: string,
    injectSlug: boolean
  ) {
    try {
      // Select ONLY the columns the public widget/gate path needs (all present
      // since 0000_init), never `SELECT *`. This is the customer-facing entry
      // point: it must not 500 if the deployed DB is behind on a migration that
      // added a tenants column (e.g. public_contact_email / quote_disclaimer).
      // Scoping the select keeps the widget immune to that schema drift.
      const rows = await db()
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          accessMode: tenants.accessMode,
          // Surfaced by the hosted trust-wrap credibility badges (present since
          // 0000_init, so this stays immune to later-migration schema drift).
          dotNumber: tenants.dotNumber,
          mcNumber: tenants.mcNumber,
        })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      const tenant = rows[0];
      // Unknown slug → serve the bare widget as before (widget.js surfaces its
      // own "tenant not found" state).
      if (!tenant) {
        return sendWidgetHtml(res, next, injectSlug ? slug : null);
      }
      // Public tenant → hosted trust-wrap (bare widget for ?embed=1 / ?raw=1).
      if (tenant.accessMode !== 'private') {
        return serveHostedOrBare(req, res, next, tenant, injectSlug);
      }
      // Private tenant. Consume an invite token if present.
      const token = accessTokenFromReq(req);
      if (token && (await consumeAccessToken(tenant.id, token))) {
        setAccessCookie(res, tenant.id);
        // Strip ?key= so the token doesn't linger in the URL / referer.
        const u = new URL(req.originalUrl, 'http://local');
        u.searchParams.delete('key');
        const qs = u.searchParams.toString();
        return res.redirect(u.pathname + (qs ? `?${qs}` : ''));
      }
      // Signed owner-preview grant (`?pk=`, minted by the dashboard for the
      // tenant's OWN calculator). Serve the real widget and drop a matching
      // short-lived cookie so same-origin API calls pass. The grant also stays
      // in the iframe URL so widget.js can forward it to the public API across
      // origins (third-party-cookie safe). Never redirect-stripped, unlike the
      // one-shot invite token, because the SPA needs to keep reading it.
      if (hasValidPreviewGrant(tenant.id, req)) {
        setAccessCookie(res, tenant.id, PREVIEW_GRANT_TTL_MS);
        return serveHostedOrBare(req, res, next, tenant, injectSlug);
      }
      // Valid existing grant → serve the calculator (wrapped on the hosted path).
      if (hasValidAccessCookie(tenant.id, req)) {
        return serveHostedOrBare(req, res, next, tenant, injectSlug);
      }
      // No grant → branded private gate page.
      const brand =
        (await db()
          .select()
          .from(brandConfigs)
          .where(eq(brandConfigs.tenantId, tenant.id))
          .limit(1))[0] ?? null;
      return res.type('html').send(renderGatePage(tenant, brand));
    } catch (err) {
      return next(err);
    }
  }

  app.get('/dpa', (_req, res, next) => {
    readFile(resolve(publicDir, 'dpa.html'), 'utf8')
      .then((html) => res.type('html').send(applyFullSiteHeader(applyDpaPageSkin(html))))
      .catch(next);
  });
  app.get(['/tools', '/tools/'], (_req, res, next) => {
    readFile(resolve(publicDir, 'tools.html'), 'utf8')
      .then((html) => res.type('html').send(applyFullSiteHeader(applyToolsMarketplaceSkin(html))))
      .catch(next);
  });
  // Marketing + legal static pages: replace their stripped `.topnav` header and
  // reduced footer with the SAME full header (Solutions dropdown, mobile
  // hamburger) + premium footer as the homepage. These routes MUST precede the
  // static file handler below (which would otherwise serve the raw file via its
  // `extensions: ['html']` option). Auth pages (login/signup) and the directory
  // pages keep their own chrome and are intentionally excluded.
  const fullHeaderPages: Array<[string | string[], string]> = [
    ['/pricing', 'pricing.html'],
    ['/compare', 'compare.html'],
    ['/support', 'support.html'],
    ['/security', 'security.html'],
    ['/cookie', 'cookie.html'],
    ['/refund', 'refund.html'],
    ['/terms', 'terms.html'],
    ['/privacy', 'privacy.html'],
    [['/for/brokers', '/for/brokers/'], 'for-brokers.html'],
    [['/for/ltl', '/for/ltl/'], 'for-ltl.html'],
    [['/for/forwarders', '/for/forwarders/'], 'for-forwarders.html'],
  ];
  for (const [route, file] of fullHeaderPages) {
    app.get(route, (_req, res, next) => {
      readFile(resolve(publicDir, file), 'utf8')
        .then((html) => res.type('html').send(applyFullSiteHeader(html)))
        .catch(next);
    });
  }
  // The standalone /marketplace page has been retired in favour of the richer,
  // faceted /directory (same carriers, filters, RFQ + export). See
  // registerMarketplaceRedirects — only the PAGE is retired; the marketplace
  // BACKEND (marketplace/sync.ts, aggregates, calculator medians) is untouched.
  registerMarketplaceRedirects(app);
  app.use(
    express.static(publicDir, {
      index: false,
      extensions: ['html'],
      // Filenames aren't content-hashed, so keep conservative TTLs: long for
      // fonts/images/video (rarely change), REVALIDATE for CSS/JS (change on
      // deploy — see below), and no caching for HTML so page edits go live
      // immediately.
      setHeaders: (res, filePath) => {
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        if (['.woff2', '.woff', '.ttf', '.otf', '.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webm', '.mp4'].includes(ext)) {
          res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
        } else if (['.css', '.js', '.mjs'].includes(ext)) {
          // The app/widget bundles (app.js, widget.js, *.css) are NOT
          // content-hashed, so a positive max-age let a returning visitor keep
          // running the PREVIOUS deploy's cached bundle for up to that TTL — a
          // shipped fix (e.g. the CTA-hover + preview-scroll fix in #268) would
          // silently NOT reach anyone who had loaded the portal within the day.
          // `no-cache` = "store, but revalidate before every use": express.static
          // still emits ETag/Last-Modified, so an UNCHANGED file is a tiny 304 and
          // stays effectively free, while a CHANGED file (a new deploy) is fetched
          // immediately. Correctness of what the user runs > a saved round-trip.
          res.setHeader('Cache-Control', 'no-cache');
        } else if (ext === '.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.get('/', (req, res, next) => {
    if (req.tenantCustomDomainSlug) {
      const slug = req.tenantCustomDomainSlug.replace(/[^a-z0-9-]/gi, '');
      return void serveWidgetPage(req, res, next, slug, true);
    }
    if (req.tenantSubdomain) {
      return void serveWidgetPage(req, res, next, req.tenantSubdomain, false);
    }
    return res.sendFile('landing.html', { root: publicDir });
  });

  app.get('/login', (_req, res) => res.sendFile('login.html', { root: publicDir }));
  app.get('/signup', (_req, res) => res.sendFile('signup.html', { root: publicDir }));
  // /pricing, /compare, /support, /security are served with the full site
  // header + premium footer earlier (see fullHeaderPages, before the static
  // handler); no plain sendFile fallbacks here.
  app.get('/.well-known/security.txt', (_req, res) => {
    res.type('text/plain').send([
      'Contact: mailto:security@quotefleet.net',
      'Expires: 2027-12-31T23:59:59.000Z',
      'Preferred-Languages: en',
      'Canonical: https://quotefleet.net/.well-known/security.txt',
      'Policy: https://quotefleet.net/security',
      'Acknowledgments: https://quotefleet.net/security#acknowledgments',
      '',
    ].join('\n'));
  });
  // Sign in with Apple domain verification. Apple fetches this file to confirm
  // we own the domain before it will POST OAuth callbacks here. The content is
  // issued by Apple and pasted into the APPLE_DOMAIN_ASSOCIATION env var (kept
  // out of the repo); until it is set the file 404s, so this is a no-op with no
  // Apple app configured — exactly like the OAuth routes themselves.
  app.get('/.well-known/apple-developer-domain-association.txt', (_req, res) => {
    const content = process.env.APPLE_DOMAIN_ASSOCIATION;
    if (!content || !content.trim()) {
      return res.status(404).type('text/plain').send('Not found');
    }
    return res.type('text/plain').send(content);
  });
  app.get('/app', (_req, res) => res.sendFile('app.html', { root: publicDir }));
  app.get('/app/*splat', (_req, res) => res.sendFile('app.html', { root: publicDir }));
  app.get('/admin', (_req, res) => res.sendFile('admin.html', { root: publicDir }));
  app.get('/admin/*splat', (_req, res) => res.sendFile('admin.html', { root: publicDir }));
  // The public "demo" slug gets a showcase shell that frames the live widget
  // with device (desktop/mobile) + theme (light/dark) toggles. The shell's
  // iframe re-requests /w/demo?raw=1 to serve the bare widget (no recursion).
  app.get('/w/:slug', (req, res, next) => {
    if (req.params.slug === 'demo' && req.query.raw === undefined) {
      return res.sendFile('widget-demo-shell.html', { root: publicDir });
    }
    return void serveWidgetPage(req, res, next, String(req.params.slug), false);
  });
  app.get('/chat/:refId', (_req, res) => res.sendFile('chat.html', { root: publicDir }));
  app.get('/quote/:refId', (_req, res) => res.sendFile('quote.html', { root: publicDir }));
  // /for/brokers, /for/ltl, /for/forwarders are served with the full site header
  // + premium footer earlier (see fullHeaderPages, before the static handler).

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const reqId = (req as unknown as { id?: string }).id ?? '-';
    console.error(`[err] ${req.method} ${req.path} reqId=${reqId}:`, err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
