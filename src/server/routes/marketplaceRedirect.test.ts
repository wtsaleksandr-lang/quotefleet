/**
 * Marketplace → directory 301 redirects (behavioural, over a real express
 * server — no DB, no network). Proves the retired /marketplace URLs permanently
 * redirect to /directory.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { registerMarketplaceRedirects } from './marketplaceRedirect.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  registerMarketplaceRedirects(app);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

describe('marketplace → directory redirects', () => {
  it('301s /marketplace to /directory', async () => {
    const r = await fetch(`${baseUrl}/marketplace`, { redirect: 'manual' });
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/directory');
  });

  it('301s the trailing-slash /marketplace/ to /directory', async () => {
    const r = await fetch(`${baseUrl}/marketplace/`, { redirect: 'manual' });
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/directory');
  });

  it('301s a /marketplace/carrier/:slug to /directory (safe fallback)', async () => {
    const r = await fetch(`${baseUrl}/marketplace/carrier/acme-drayage-inc`, { redirect: 'manual' });
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/directory');
  });
});
