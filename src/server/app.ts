import express from 'express';
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
  setAccessCookie,
  renderGatePage,
} from './access.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerTenantRoutes } from './routes/tenant.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAutocompleteRoutes } from './routes/autocomplete.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerMarketplaceRoutes } from './routes/marketplace.js';
import { registerToolsRoutes } from './routes/tools.js';
import { registerBillingRoutes, registerStripeWebhook } from './routes/billing.js';
import { registerMarketingChatRoute } from './routes/marketingChat.js';
import { registerQuoteDocRoutes } from './routes/quoteDoc.js';
import { registerQuoteActivityRoutes } from './routes/quoteActivity.js';
import { registerCarrierProfileRoutes } from './routes/carrierProfile.js';
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

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  registerStripeWebhook(app);

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
  registerPublicRoutes(app);
  registerTenantRoutes(app);
  registerAdminRoutes(app);
  registerAiRoutes(app);
  registerAutocompleteRoutes(app);
  registerIngestRoutes(app);
  registerMarketplaceRoutes(app);
  registerToolsRoutes(app);
  registerBillingRoutes(app);
  registerMarketingChatRoute(app);
  registerQuoteDocRoutes(app);
  registerQuoteActivityRoutes(app);
  registerCarrierProfileRoutes(app);

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
      const rows = await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      const tenant = rows[0];
      // Unknown tenant or public mode → serve the widget as before (widget.js
      // surfaces its own "tenant not found" state for missing slugs).
      if (!tenant || tenant.accessMode !== 'private') {
        return sendWidgetHtml(res, next, injectSlug ? slug : null);
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
      // Valid existing grant → serve the calculator.
      if (hasValidAccessCookie(tenant.id, req)) {
        return sendWidgetHtml(res, next, injectSlug ? slug : null);
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
  app.get(['/marketplace', '/marketplace/'], (_req, res, next) => {
    readFile(resolve(publicDir, 'marketplace.html'), 'utf8')
      .then((html) => res.type('html').send(applyToolsMarketplaceSkin(html)))
      .catch(next);
  });
  app.get('/marketplace/carrier/:slug', (_req, res, next) => {
    readFile(resolve(publicDir, 'marketplace-carrier.html'), 'utf8')
      .then((html) => res.type('html').send(applyToolsMarketplaceSkin(html)))
      .catch(next);
  });
  app.use(express.static(publicDir, { index: false, extensions: ['html'] }));

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
  app.get('/w/:slug', (req, res, next) => void serveWidgetPage(req, res, next, String(req.params.slug), false));
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
