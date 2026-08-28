/**
 * Free-text ENTRY PORT → directory facet.
 *
 * ImportYeti reports `entry_port` as free text with inconsistent state casing
 * and punctuation ("Savannah, Ga.", "Savannah, GA", "Savannah"), so both lookups
 * match on the CITY token only.
 *
 * Why this exists as its own module: BOTH the Importer Search result cards
 * (importerPages.ts) and the importer profile page (importerProfile.ts) build a
 * "Quote this lane" deep link, and importerPages already imports importerProfile
 * for its route registration — putting the helpers in either one would create an
 * import cycle. A leaf module keeps both sides honest and identical.
 *
 * Cost: $0. Everything here reads the static CONTAINER_PORTS table plus the
 * curated supplement below — no network, no DB, no credits.
 *
 * The consumer contract: `/directory/rfq` 302s straight back to `/directory`
 * unless the query carries a key from FACET_QUERY_KEYS. `port` and `state` are
 * both in it, so a link built from these resolves a real carrier set. When BOTH
 * return null, the caller MUST omit its CTA rather than render a link that
 * bounces.
 */
import { CONTAINER_PORTS } from './containerPorts.js';
import { US_STATES } from './usStates.js';

const US_PORTS = CONTAINER_PORTS.filter((p) => p.country === 'US');

/**
 * Curated supplement of additional real US entry ports that are NOT in the
 * container-gateway directory (CONTAINER_PORTS is container-only, so it lists
 * just one port for several states). `entry_port` on ImportYeti is a SUBSTRING
 * match on the city token (verified against the live API: `entry_port=Savannah`
 * and `entry_port=Savannah, GA` both match "Savannah, Ga." rows), so a
 * "City, ST" value here matches that city's bills regardless of the state
 * formatting upstream. Kept SEPARATE from CONTAINER_PORTS so the directory's
 * nearest-port derivation and port facets stay byte-for-byte unchanged.
 *
 * These four carry NO container code, so they resolve to the state facet only.
 */
export const EXTRA_STATE_ENTRY_PORTS: Readonly<Record<string, readonly string[]>> = {
  GA: ['Brunswick, GA'],
  CA: ['Oakland, CA'],
  WA: ['Tacoma, WA'],
  NY: ['New York, NY'],
};

/** City token of a free-text entry port, normalised for lookup. */
function portCityKey(entryPort: string | null | undefined): string {
  return String(entryPort ?? '')
    .split(',')[0]
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const US_STATE_CODES = new Set(US_STATES.map((s) => s.code));
const PORT_CITY_TO_CODE = new Map(US_PORTS.map((p) => [portCityKey(p.city), p.code] as const));
const PORT_CITY_TO_STATE = new Map<string, string>([
  ...US_PORTS.map((p) => [portCityKey(p.city), p.state] as const),
  ...Object.entries(EXTRA_STATE_ENTRY_PORTS).flatMap(([st, ports]) =>
    ports.map((v) => [portCityKey(v), st] as const),
  ),
]);

/** UN/LOCODE for a free-text entry port, or null when it has no container code
 *  (Brunswick GA, Oakland CA, Tacoma WA, New York NY) or is unknown. */
export function portCodeForEntryPort(entryPort: string | null | undefined): string | null {
  const k = portCityKey(entryPort);
  return k ? PORT_CITY_TO_CODE.get(k) ?? null : null;
}

/**
 * US state of a free-text ENTRY PORT — the fallback facet when the port carries
 * no container code. Deliberately derived from the PORT, never from an
 * importer's own `state`: that field is the HQ address, which is routinely a
 * different state than the gateway it clears freight through (see
 * ImporterFilters.state).
 */
export function portStateForEntryPort(entryPort: string | null | undefined): string | null {
  const k = portCityKey(entryPort);
  if (k) {
    const hit = PORT_CITY_TO_STATE.get(k);
    if (hit) return hit;
  }
  // Last resort: a trailing ", ST" the tables didn't cover. Validated against
  // the real state list — an unrecognised token must yield null so the caller
  // drops the CTA rather than deep-linking a facet that matches nothing.
  const m = String(entryPort ?? '').match(/,\s*([A-Za-z]{2})\.?\s*$/);
  const st = m ? m[1].toUpperCase() : '';
  return st && US_STATE_CODES.has(st) ? st : null;
}

/**
 * The "Quote this lane" href: a `/directory/rfq` deep link that resolves the
 * intermodal carriers at this entry port and pre-seeds the DRAYAGE leg they
 * would actually quote — origin = the gateway they collect from, destination =
 * where the importer takes delivery. NOT the ocean leg: a Savannah drayage
 * carrier cannot price a DE→US move.
 *
 * Returns null when the port resolves to no facet at all, which is the caller's
 * signal to render no CTA.
 */
export function quoteLaneHref(lane: {
  entryPort: string | null | undefined;
  /** Importer's delivery state — a region, never the street address. Drayage is
   *  priced to a delivery area, and this href is shareable, so the narrower
   *  field is both the correct input and the one that leaks nothing. */
  destinationState?: string | null;
  product?: string | null;
  hsCode?: string | null;
}): string | null {
  const code = portCodeForEntryPort(lane.entryPort);
  const state = code ? null : portStateForEntryPort(lane.entryPort);
  if (!code && !state) return null;
  const q = new URLSearchParams();
  if (code) {
    q.set('port', code);
    q.set('intermodal', '1');
  } else {
    q.set('state', state!);
  }
  q.set('origin', lane.entryPort ?? '');
  q.set('destination', lane.destinationState ?? '');
  const commodity = `${lane.product ?? ''}${lane.hsCode ? ` · HS ${lane.hsCode}` : ''}`;
  q.set('commodity', commodity);
  q.set('from', 'importers');
  return `/directory/rfq?${q.toString()}`;
}
