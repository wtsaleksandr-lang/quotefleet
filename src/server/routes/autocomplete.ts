/**
 * Type-ahead suggestions for the embeddable widget.
 *
 *   GET /api/public/autocomplete/locations?q=long+beach
 *       → ZIP / city / address suggestions, USA/Canada only.
 *       Mapbox-backed when MAPBOX_TOKEN is set; falls back to an
 *       empty result (the widget then accepts free-text).
 *
 *   GET /api/public/autocomplete/ports?q=norfolk
 *       → marine ports + inland intermodal hubs, search local data.
 *
 *   GET /api/public/autocomplete/terminals?q=APM&port=USLAX
 *       → terminals at a given port (or all terminals if `port` omitted).
 *       Searches the platform's TERMINALS_DATA — does NOT filter by tenant
 *       opt-in (the widget passes `slug` separately to constrain visibility).
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants, terminals as terminalsTable } from '../../db/schema.js';
import { PORTS_DATA } from '../../data/ports.js';
import { PORTS_INLAND, TERMINALS_DATA, type TerminalRow } from '../../data/terminals.js';
import { loadEnv } from '../../config.js';

const ALL_PORTS = [
  ...PORTS_DATA.map((p) => ({ code: p.code, name: p.name, city: p.city, state: p.state ?? null, country: p.country })),
  ...PORTS_INLAND.map((p) => ({ code: p.code, name: p.name, city: p.city, state: p.state, country: p.country })),
];

export function registerAutocompleteRoutes(app: Express) {
  // ── Locations (US/CA only) ───────────────────────────────────────
  app.get('/api/public/autocomplete/locations', async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ suggestions: [] });
    const env = loadEnv();
    if (!env.MAPBOX_TOKEN) {
      // No Mapbox key → return empty and let the widget accept free text.
      return res.json({ suggestions: [], note: 'autocomplete-disabled' });
    }
    try {
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
      );
      url.searchParams.set('access_token', env.MAPBOX_TOKEN);
      url.searchParams.set('country', 'us,ca'); // US + Canada only — strict filter
      url.searchParams.set('types', 'postcode,place,locality,address,district');
      url.searchParams.set('autocomplete', 'true');
      url.searchParams.set('limit', '6');
      const r = await fetch(url);
      if (!r.ok) return res.json({ suggestions: [], note: 'mapbox-error' });
      type MapboxFeature = {
        id: string;
        place_name: string;
        text: string;
        place_type: string[];
        center: [number, number];
        context?: Array<{ id: string; text: string; short_code?: string }>;
      };
      const data = (await r.json()) as { features: MapboxFeature[] };
      const suggestions = (data.features ?? []).map((f) => {
        const ctx = f.context ?? [];
        const region = ctx.find((c) => c.id.startsWith('region.'))?.short_code?.replace(/^[a-z]{2}-/i, '') ?? null;
        const country = ctx.find((c) => c.id.startsWith('country.'))?.short_code?.toUpperCase() ?? null;
        const postcode = ctx.find((c) => c.id.startsWith('postcode.'))?.text ?? null;
        const place = ctx.find((c) => c.id.startsWith('place.'))?.text ?? f.text;
        return {
          label: f.place_name,
          city: place,
          state: region,
          country,
          zip: postcode,
          lat: f.center[1],
          lng: f.center[0],
          kind: f.place_type[0] ?? 'place',
        };
      });
      return res.json({ suggestions });
    } catch (err) {
      console.warn('[autocomplete.locations] mapbox failed:', err);
      return res.json({ suggestions: [], note: 'mapbox-error' });
    }
  });

  // ── Ports + inland hubs (local data, no external call) ───────────
  app.get('/api/public/autocomplete/ports', (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (q.length < 1) return res.json({ suggestions: ALL_PORTS.slice(0, 12) });
    const matches = ALL_PORTS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.state ?? '').toLowerCase().includes(q)
    ).slice(0, 12);
    return res.json({ suggestions: matches });
  });

  // ── Terminals — tenant-scoped when ?slug=, else platform-wide ─────
  app.get('/api/public/autocomplete/terminals', async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const port = String(req.query.port ?? '').trim();
    const slug = String(req.query.slug ?? '').trim();

    type TermResult = {
      portCode: string;
      code: string;
      name: string;
      carrier: string | null;
      notes: string | null;
    };
    let pool: TermResult[];

    if (slug) {
      // Tenant-scoped: pull from their `terminals` table so disabled rows
      // are excluded.
      const t = (await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
      if (!t) return res.json({ suggestions: [] });
      const rows = await db().select().from(terminalsTable).where(eq(terminalsTable.tenantId, t.id));
      pool = rows
        .filter((r) => r.enabled)
        .map((r) => ({
          portCode: r.portCode,
          code: r.code,
          name: r.name,
          carrier: r.carrier ?? null,
          notes: r.notes ?? null,
        }));
    } else {
      // Platform default — full TERMINALS_DATA, normalized to TermResult.
      pool = TERMINALS_DATA.map((t: TerminalRow) => ({
        portCode: t.portCode,
        code: t.code,
        name: t.name,
        carrier: t.carrier ?? null,
        notes: t.notes ?? null,
      }));
    }

    let filtered = pool;
    if (port) filtered = filtered.filter((t) => t.portCode === port);
    if (q) {
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.carrier ?? '').toLowerCase().includes(q) ||
          t.code.toLowerCase().includes(q)
      );
    }
    return res.json({ suggestions: filtered.slice(0, 20) });
  });
}
