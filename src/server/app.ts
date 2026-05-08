/**
 * Express app factory. Sets up:
 *   - JSON body parsing
 *   - Cookie parsing
 *   - Static files (the SPA dashboard, marketing site, embed.js, widget)
 *   - All API routes
 */
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
import { hostInfoMiddleware } from './hostInfo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  // Don't advertise Express version. Tiny but free hardening.
  app.disable('x-powered-by');

  // Security headers. Lightweight hand-rolled set (avoid bringing in
  // `helmet` as a new dep just to set five headers). Strict but does
  // not break the embedded widget — script-src needs 'unsafe-inline'
  // for the small bootstrap injected by /widget.html, and frame-src is
  // open so tenants can iframe their own embed onto third-party sites.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=()'
    );
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
    next();
  });

  // STRIPE WEBHOOK MUST come before the JSON body parser — Stripe's
  // signature is verified against the raw bytes. Once express.json()
  // runs, the original body is gone.
  registerStripeWebhook(app);

  // Global body parser limit covers small JSON payloads. Per-route caps
  // override this — `/api/tenant/ingest` accepts up to 6MB (5MB binary
  // → ~6.7MB base64); `/api/public/chat/:refId` is capped per-route.
  app.use(express.json({ limit: '7mb' }));
  app.use(express.urlencoded({ extended: true, limit: '7mb' }));
  app.use(cookieParser());
  app.use(hostInfoMiddleware);

  // CORS for the embed widget. Always permissive on /api/public/*; tenants can
  // configure allowed_domains for stricter checks at the widget level.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/public/') || req.path === '/embed.js') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });

  // Mount routes (order matters for static fallback below).
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

  // Healthcheck. Pings DB so a disconnected app marks unhealthy and
  // platform load balancers can shed traffic instead of black-holing.
  // Returns full error detail because /healthz is internal-only.
  app.get('/healthz', async (_req, res) => {
    const time = new Date().toISOString();
    try {
      const r = await db().select({ id: tenants.id }).from(tenants).limit(1);
      return res.json({ ok: true, time, db: 'up', tenantsRows: r.length });
    } catch (err) {
      console.error('[healthz] db ping failed:', err);
      // postgres-js wraps the underlying pg error in a generic
      // "Failed query: …" envelope. Drill into .cause / .severity /
      // .code to surface what's actually wrong (auth fail, DB unreachable,
      // missing table, etc.).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      const detail = {
        name: e?.name,
        message: e?.message,
        code: e?.code,
        severity: e?.severity,
        causeName: e?.cause?.name,
        causeMessage: e?.cause?.message,
        causeCode: e?.cause?.code,
        errno: e?.errno,
        syscall: e?.syscall,
        hostname: e?.hostname,
        // Sanity-check the env so we can see if DATABASE_URL is even set
        dbUrlSet: !!process.env.DATABASE_URL,
        dbUrlScheme: (process.env.DATABASE_URL || '').split(':')[0],
        dbUrlHasHost: /@[^/]+\//.test(process.env.DATABASE_URL || ''),
      };
      res.status(503).json({ ok: false, db: 'down', time, error: detail });
    }
  });

  // Static files. Resolved relative to project root (dist/src/server/app.js
  // → ../../../src/server/public/), or relative to source-mode (tsx).
  const publicDir = resolve(process.cwd(), 'src/server/public');
  app.use(express.static(publicDir, { index: false, extensions: ['html'] }));

  // Friendly URLs that map to specific HTML files.
  // Root path is host-aware: a tenant subdomain OR a verified custom
  // domain serves the widget; bare base serves marketing.
  app.get('/', (req, res, next) => {
    // Custom-domain path: inject the resolved slug so widget.js can use
    // it directly (the URL doesn't carry the slug — it's just the
    // customer's own domain).
    if (req.tenantCustomDomainSlug) {
      const slug = req.tenantCustomDomainSlug.replace(/[^a-z0-9-]/gi, '');
      const file = resolve(publicDir, 'widget.html');
      // Read + transform: inject window.QF_TENANT_SLUG before /widget.js loads.
      readFile(file, 'utf8')
        .then((html) => {
          const inject = `<script>window.QF_TENANT_SLUG=${JSON.stringify(slug)};</script>\n`;
          res.type('html').send(html.replace('<script src="/widget.js"></script>', inject + '<script src="/widget.js"></script>'));
        })
        .catch(next);
      return;
    }
    if (req.tenantSubdomain) {
      return res.sendFile(resolve(publicDir, 'widget.html'));
    }
    return res.sendFile(resolve(publicDir, 'landing.html'));
  });
  app.get('/login', (_req, res) => res.sendFile(resolve(publicDir, 'login.html')));
  app.get('/signup', (_req, res) => res.sendFile(resolve(publicDir, 'signup.html')));
  app.get('/pricing', (_req, res) => res.sendFile(resolve(publicDir, 'pricing.html')));
  app.get('/security', (_req, res) => res.sendFile(resolve(publicDir, 'security.html')));
  app.get('/dpa', (_req, res) => res.sendFile(resolve(publicDir, 'dpa.html')));
  // RFC 9116 vulnerability disclosure manifest. Plain-text, served at
  // the well-known path so security researchers' tooling can find it.
  // Expires 2 years out so we remember to refresh.
  app.get('/.well-known/security.txt', (_req, res) => {
    res.type('text/plain').send(
      [
        'Contact: mailto:security@quotefleet.net',
        'Expires: 2027-12-31T23:59:59.000Z',
        'Preferred-Languages: en',
        'Canonical: https://quotefleet.net/.well-known/security.txt',
        'Policy: https://quotefleet.net/security',
        'Acknowledgments: https://quotefleet.net/security#acknowledgments',
        '',
      ].join('\n')
    );
  });
  app.get('/app', (_req, res) => res.sendFile(resolve(publicDir, 'app.html')));
  app.get('/app/*splat', (_req, res) => res.sendFile(resolve(publicDir, 'app.html')));
  app.get('/admin', (_req, res) => res.sendFile(resolve(publicDir, 'admin.html')));
  app.get('/admin/*splat', (_req, res) => res.sendFile(resolve(publicDir, 'admin.html')));
  app.get('/w/:slug', (_req, res) => res.sendFile(resolve(publicDir, 'widget.html')));
  app.get('/chat/:refId', (_req, res) => res.sendFile(resolve(publicDir, 'chat.html')));
  // Public free SEO calculator. Indexable, no signup.
  app.get(['/tools', '/tools/'], (_req, res) => res.sendFile(resolve(publicDir, 'tools.html')));
  // Public marketplace browser.
  app.get(['/marketplace', '/marketplace/'], (_req, res) => res.sendFile(resolve(publicDir, 'marketplace.html')));
  app.get('/marketplace/carrier/:slug', (_req, res) => res.sendFile(resolve(publicDir, 'marketplace-carrier.html')));
  // Per-vertical landing pages (SEO).
  app.get(['/for/brokers', '/for/brokers/'], (_req, res) => res.sendFile(resolve(publicDir, 'for-brokers.html')));
  app.get(['/for/ltl', '/for/ltl/'], (_req, res) => res.sendFile(resolve(publicDir, 'for-ltl.html')));
  app.get(['/for/forwarders', '/for/forwarders/'], (_req, res) => res.sendFile(resolve(publicDir, 'for-forwarders.html')));

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Centralized 500 handler — never leak a stack trace to the client.
  // (Express 5 picks up 4-arg signatures as error handlers.)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const reqId = (req as unknown as { id?: string }).id ?? '-';
    console.error(`[err] ${req.method} ${req.path} reqId=${reqId}:`, err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
