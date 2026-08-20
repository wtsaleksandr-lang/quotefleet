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
      .then((html) => res.type('html').send(applyDpaPageSkin(html)))
      .catch(next);
  });
  app.get(['/tools', '/tools/'], (_req, res, next) => {
    readFile(resolve(publicDir, 'tools.html'), 'utf8')
      .then((html) => res.type('html').send(applyToolsMarketplaceSkin(html)))
      .catch(next);
  });
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
  app.get('/pricing', (_req, res) => res.sendFile('pricing.html', { root: publicDir }));
  app.get('/compare', (_req, res) => res.sendFile('compare.html', { root: publicDir }));
  app.get('/support', (_req, res) => res.sendFile('support.html', { root: publicDir }));
  app.get('/security', (_req, res) => res.sendFile('security.html', { root: publicDir }));
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
  app.get(['/for/brokers', '/for/brokers/'], (_req, res) => res.sendFile('for-brokers.html', { root: publicDir }));
  app.get(['/for/ltl', '/for/ltl/'], (_req, res) => res.sendFile('for-ltl.html', { root: publicDir }));
  app.get(['/for/forwarders', '/for/forwarders/'], (_req, res) => res.sendFile('for-forwarders.html', { root: publicDir }));

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const reqId = (req as unknown as { id?: string }).id ?? '-';
    console.error(`[err] ${req.method} ${req.path} reqId=${reqId}:`, err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
