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
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerTenantRoutes } from './routes/tenant.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAiRoutes } from './routes/ai.js';
import { hostInfoMiddleware } from './hostInfo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
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

  // Healthcheck.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // Static files. Resolved relative to project root (dist/src/server/app.js
  // → ../../../src/server/public/), or relative to source-mode (tsx).
  const publicDir = resolve(process.cwd(), 'src/server/public');
  app.use(express.static(publicDir, { index: false, extensions: ['html'] }));

  // Friendly URLs that map to specific HTML files.
  // Root path is host-aware: `<slug>.<base>/` → widget; bare base → marketing.
  app.get('/', (req, res) => {
    if (req.tenantSubdomain) {
      return res.sendFile(resolve(publicDir, 'widget.html'));
    }
    return res.sendFile(resolve(publicDir, 'landing.html'));
  });
  app.get('/login', (_req, res) => res.sendFile(resolve(publicDir, 'login.html')));
  app.get('/signup', (_req, res) => res.sendFile(resolve(publicDir, 'signup.html')));
  app.get('/pricing', (_req, res) => res.sendFile(resolve(publicDir, 'pricing.html')));
  app.get('/app', (_req, res) => res.sendFile(resolve(publicDir, 'app.html')));
  app.get('/app/*splat', (_req, res) => res.sendFile(resolve(publicDir, 'app.html')));
  app.get('/admin', (_req, res) => res.sendFile(resolve(publicDir, 'admin.html')));
  app.get('/admin/*splat', (_req, res) => res.sendFile(resolve(publicDir, 'admin.html')));
  app.get('/w/:slug', (_req, res) => res.sendFile(resolve(publicDir, 'widget.html')));
  app.get('/chat/:refId', (_req, res) => res.sendFile(resolve(publicDir, 'chat.html')));

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
