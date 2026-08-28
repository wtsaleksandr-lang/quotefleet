/**
 * GET /directory/rfq lane prefill — the landing half of the Importer Search
 * "Quote this lane" CTA.
 *
 * Proves the deep link the card builds actually WORKS end to end: it resolves a
 * carrier set instead of 302-ing back to /directory, and the shipment fields
 * arrive filled in. Also proves the addition stayed additive — it cannot be used
 * to spoof the metered contact identity.
 *
 * In-memory store + injected resolver. NO DB, NO network, NO email.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { registerRfqRoutes, type RfqGate } from './rfq.js';
import type { ResolveDeps, CarrierLite } from '../rfq/resolve.js';
import type { EmailOut } from '../../email/send.js';
import type { RfqUsageStore } from '../directory/rfqUsage.js';

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';

const carriers: CarrierLite[] = [
  { usdot: '1', name: 'Savannah Drayage Co', email: 'ops@sav.example', contactHidden: false },
  { usdot: '2', name: 'Garden City Intermodal', email: 'quotes@gci.example', contactHidden: false },
];

const resolveDeps: ResolveDeps = {
  listByFilters: async () => ({ carriers, total: carriers.length }),
  listByDots: async () => carriers,
  optedOutDots: async () => new Set<string>(),
  isEmailSuppressed: async () => false,
};

class MemUsage implements RfqUsageStore {
  private m = new Map<string, number>();
  async getSends(a: string, p: string) {
    return this.m.get(`${a}|${p}`) ?? 0;
  }
  async increment(a: string, p: string) {
    const v = (this.m.get(`${a}|${p}`) ?? 0) + 1;
    this.m.set(`${a}|${p}`, v);
    return v;
  }
}

/** A signed-in shipper, so the identity-vs-query precedence is testable. */
const signedInGate: RfqGate = async () => ({
  ok: true,
  cap: 25,
  allowance: 50,
  used: 0,
  accountKey: 'user:test',
  period: '2026-08',
  email: 'real.account@example.com',
  name: 'Real Account',
});

async function boot() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  registerRfqRoutes(app, {
    store: {} as never,
    resolveDeps,
    isEmailSuppressed: async () => false,
    send: vi.fn(async (): Promise<EmailOut> => ({ ok: true, provider: 'resend', id: 'm' })),
    liveSend: false,
    baseUrl: 'https://test.local',
    throttleMs: 0,
    forceReingest: vi.fn(async () => 'started' as const),
    anthropicKey: '',
    gate: signedInGate,
    usage: new MemUsage(),
  });
  const server = await new Promise<Server>((r) => {
    const s = app.listen(0, () => r(s));
  });
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

/** The exact shape importerPages' ctaFor() builds for a coded gateway. */
const CODED_CTA =
  '/directory/rfq?port=USSAV&intermodal=1&origin=Savannah%2C%20Ga.&destination=NC' +
  '&commodity=Saw%20blades%20%26%20parts%20%C2%B7%20HS%20820299&from=importers';

describe('GET /directory/rfq — Importer Search lane deep link', () => {
  it('resolves carriers instead of bouncing to /directory (the 302 trap)', async () => {
    const { server, url } = await boot();
    try {
      const res = await fetch(url + CODED_CTA, { redirect: 'manual' });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Request rates from 2 carriers');
    } finally {
      server.close();
    }
  });

  it('prefills the shipment fields from the query', async () => {
    const { server, url } = await boot();
    try {
      const html = await (await fetch(url + CODED_CTA)).text();
      const valueOf = (name: string) =>
        html.match(new RegExp(`<input id="rfq-${name}"[^>]*value="([^"]*)"`))?.[1] ?? null;
      expect(valueOf('origin')).toBe('Savannah, Ga.');
      expect(valueOf('destination')).toBe('NC');
      expect(valueOf('commodity')).toBe('Saw blades &amp; parts · HS 820299');
    } finally {
      server.close();
    }
  });

  it('works on the state-fallback branch too (ports with no container code)', async () => {
    const { server, url } = await boot();
    try {
      const res = await fetch(
        url + '/directory/rfq?state=GA&origin=Brunswick%2C%20GA&destination=GA&from=importers',
        { redirect: 'manual' },
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('value="Brunswick, GA"');
    } finally {
      server.close();
    }
  });

  it('still 302s when the query carries no facet at all', async () => {
    const { server, url } = await boot();
    try {
      // Prefill alone must NOT be enough to open the form — this is exactly why
      // the card omits its CTA when no port/state resolves.
      const res = await fetch(url + '/directory/rfq?origin=Savannah&commodity=Widgets', {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/directory');
    } finally {
      server.close();
    }
  });

  it('cannot be used to override the metered contact identity', async () => {
    const { server, url } = await boot();
    try {
      const html = await (
        await fetch(
          url +
            '/directory/rfq?port=USSAV&shipper_email=attacker%40evil.example&shipper_name=Someone%20Else',
        )
      ).text();
      // Contact fields come from the gate, never the querystring.
      expect(html).toContain('value="real.account@example.com"');
      expect(html).toContain('value="Real Account"');
      expect(html).not.toContain('attacker@evil.example');
    } finally {
      server.close();
    }
  });
});
