import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
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
  app.use(express.static(publicDir, { index: false, extensions: ['html'] }));

  app.get('/', (req, res, next) => {
    if (req.tenantCustomDomainSlug) {
      const slug = req.tenantCustomDomainSlug.replace(/[^a-z0-9-]/gi, '');
      const file = resolve(publicDir, 'widget.html');
      readFile(file, 'utf8')
        .then((html) => {
          const inject = `<script>window.QF_TENANT_SLUG=${JSON.stringify(slug)};</script>\n`;
          res.type('html').send(html.replace('<script src="/widget.js"></script>', inject + '<script src="/widget.js"></script>'));
        })
        .catch(next);
      return;
    }
    if (req.tenantSubdomain) return res.sendFile(resolve(publicDir, 'widget.html'));
    return res.sendFile(resolve(publicDir, 'landing.html'));
  });

  app.get('/login', (_req, res) => res.sendFile(resolve(publicDir, 'login.html')));
  app.get('/signup', (_req, res) => res.sendFile(resolve(publicDir, 'signup.html')));
  app.get('/pricing', (_req, res) => res.sendFile(resolve(publicDir, 'pricing.html')));
  app.get('/security', (_req, res) => res.sendFile(resolve(publicDir, 'security.html')));
  app.get('/dpa', (_req, res) => res.sendFile(resolve(publicDir, 'dpa.html')));
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
  app.get('/app', (_req, res) => res.sendFile(resolve(publicDir, 'app.html')));
  app.get('/app/*splat', (_req, res) => res.sendFile(resolve(publicDir, 'app.html')));
  app.get('/admin', (_req, res) => res.sendFile(resolve(publicDir, 'admin.html')));
  app.get('/admin/*splat', (_req, res) => res.sendFile(resolve(publicDir, 'admin.html')));
  app.get('/w/:slug', (_req, res) => res.sendFile(resolve(publicDir, 'widget.html')));
  app.get('/chat/:refId', (_req, res) => res.sendFile(resolve(publicDir, 'chat.html')));
  app.get('/quote/:refId', (_req, res) => res.sendFile(resolve(publicDir, 'quote.html')));
  app.get(['/tools', '/tools/'], (_req, res) => res.sendFile(resolve(publicDir, 'tools.html')));
  app.get(['/marketplace', '/marketplace/'], (_req, res) => res.sendFile(resolve(publicDir, 'marketplace.html')));
  app.get('/marketplace/carrier/:slug', (_req, res) => res.sendFile(resolve(publicDir, 'marketplace-carrier.html')));
  app.get(['/for/brokers', '/for/brokers/'], (_req, res) => res.sendFile(resolve(publicDir, 'for-brokers.html')));
  app.get(['/for/ltl', '/for/ltl/'], (_req, res) => res.sendFile(resolve(publicDir, 'for-ltl.html')));
  app.get(['/for/forwarders', '/for/forwarders/'], (_req, res) => res.sendFile(resolve(publicDir, 'for-forwarders.html')));

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const reqId = (req as unknown as { id?: string }).id ?? '-';
    console.error(`[err] ${req.method} ${req.path} reqId=${reqId}:`, err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
