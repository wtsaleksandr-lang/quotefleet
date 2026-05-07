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
  // Provider precedence:
  //   1. GOOGLE_MAPS_API_KEY → Google Places Autocomplete (preferred)
  //   2. MAPBOX_TOKEN        → Mapbox Geocoding (fallback)
  //   3. neither             → empty results, widget accepts free text
  app.get('/api/public/autocomplete/locations', async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ suggestions: [] });
    const env = loadEnv();
    try {
      if (env.GOOGLE_MAPS_API_KEY) return res.json(await googleAutocomplete(q, env.GOOGLE_MAPS_API_KEY));
      if (env.MAPBOX_TOKEN) return res.json(await mapboxAutocomplete(q, env.MAPBOX_TOKEN));
      return res.json({ suggestions: [], note: 'autocomplete-disabled' });
    } catch (err) {
      console.warn('[autocomplete.locations] failed:', err);
      return res.json({ suggestions: [], note: 'autocomplete-error' });
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

/* ────────────────────────────────────────────────────────────────── *
 * Provider helpers
 * ────────────────────────────────────────────────────────────────── */

interface AutocompleteSuggestion {
  label: string;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
  lat?: number;
  lng?: number;
  kind: string;
}

async function googleAutocomplete(q: string, apiKey: string): Promise<{ suggestions: AutocompleteSuggestion[]; provider: string }> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', q);
  url.searchParams.set('components', 'country:us|country:ca'); // strict US/CA filter
  url.searchParams.set('types', 'geocode'); // addresses + cities + postcodes (no businesses)
  url.searchParams.set('language', 'en');
  url.searchParams.set('key', apiKey);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Google Places HTTP ${r.status}`);
  type GoogleResp = {
    status: string;
    error_message?: string;
    predictions: Array<{
      description: string;
      place_id: string;
      structured_formatting?: { main_text: string; secondary_text: string };
      terms?: Array<{ value: string; offset: number }>;
      types?: string[];
    }>;
  };
  const data = (await r.json()) as GoogleResp;
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places status ${data.status}: ${data.error_message ?? '(no message)'}`);
  }
  const suggestions: AutocompleteSuggestion[] = (data.predictions ?? []).slice(0, 6).map((p) => {
    const terms = p.terms ?? [];
    // Google's terms array typically goes [city, state, country] for places,
    // [street, city, state, country] for addresses. Last term = country.
    const last = terms[terms.length - 1]?.value;
    const country = last === 'USA' ? 'US' : last === 'Canada' ? 'CA' : null;
    const city = p.structured_formatting?.main_text ?? terms[0]?.value ?? null;
    // State is typically the second-to-last term (e.g. "CA" or "California").
    const stateRaw = terms.length >= 3 ? terms[terms.length - 2]?.value : null;
    const state = stateRaw ? abbreviateState(stateRaw) : null;
    // ZIP is included in description for postcode predictions; extract it.
    const zipMatch = p.description.match(/\b(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z][ -]?\d[A-Z]\d)\b/);
    const zip = zipMatch ? zipMatch[1].replace(/\s+/g, '') : null;
    return {
      label: p.description,
      city,
      state,
      country,
      zip,
      kind: (p.types ?? [])[0] ?? 'place',
    };
  });
  return { suggestions, provider: 'google' };
}

async function mapboxAutocomplete(q: string, token: string): Promise<{ suggestions: AutocompleteSuggestion[]; provider: string }> {
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
  );
  url.searchParams.set('access_token', token);
  url.searchParams.set('country', 'us,ca');
  url.searchParams.set('types', 'postcode,place,locality,address,district');
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('limit', '6');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Mapbox HTTP ${r.status}`);
  type MapboxFeature = {
    id: string;
    place_name: string;
    text: string;
    place_type: string[];
    center: [number, number];
    context?: Array<{ id: string; text: string; short_code?: string }>;
  };
  const data = (await r.json()) as { features: MapboxFeature[] };
  const suggestions: AutocompleteSuggestion[] = (data.features ?? []).map((f) => {
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
  return { suggestions, provider: 'mapbox' };
}

const STATE_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
  // Canadian provinces
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  'newfoundland and labrador': 'NL', 'nova scotia': 'NS', ontario: 'ON',
  'prince edward island': 'PE', quebec: 'QC', saskatchewan: 'SK',
  'northwest territories': 'NT', nunavut: 'NU', yukon: 'YT',
};

function abbreviateState(s: string): string {
  const k = s.toLowerCase().trim();
  if (STATE_ABBR[k]) return STATE_ABBR[k];
  // Already 2-char? Return upper.
  if (s.length === 2) return s.toUpperCase();
  return s;
}
