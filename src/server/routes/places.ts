/**
 * PLACE SUGGESTIONS OVER HTTP — the endpoint behind address autosuggest.
 *
 * One route, no database, no third party, no key. It reads the committed
 * Census place index described in `src/server/places/placeIndex.ts` and answers
 * from process memory, which is why it is safe to call on every keystroke and
 * why it keeps working with the database down.
 *
 * DEGRADES TO A PLAIN INPUT, NEVER TO AN ERROR. If the asset is missing from a
 * deployment the route answers `200` with an empty list rather than `500`. The
 * field it feeds is a text input that already works without suggestions; a
 * failing autocomplete must not colour a form the user can complete by typing.
 */
import type { Express, Request, Response } from 'express';
import { publicCalcLimiter } from '../rateLimits.js';
import { MAX_SUGGESTIONS, suggestPlaces } from '../places/placeIndex.js';

/** Long enough for "Louisville/Jefferson County, KY" and nothing like an essay. */
const MAX_QUERY_CHARS = 80;

export function registerPlacesRoutes(app: Express): void {
  app.get('/api/tools/place-suggest', publicCalcLimiter, (req: Request, res: Response) => {
    const raw = typeof req.query.q === 'string' ? req.query.q : '';
    const q = raw.slice(0, MAX_QUERY_CHARS);

    let places: ReturnType<typeof suggestPlaces> = [];
    try {
      places = suggestPlaces(q, MAX_SUGGESTIONS);
    } catch {
      // The asset failed to load. Answer empty — see the header.
      places = [];
    }

    // Suggestions come from a file that changes once a year, so they are
    // cacheable; a short public TTL keeps repeat keystrokes off the process
    // without pinning a stale index for long after a rebuild.
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      places: places.map((p) => ({
        label: p.label,
        name: p.name,
        state: p.state,
        lat: p.lat,
        lng: p.lng,
      })),
    });
  });
}
