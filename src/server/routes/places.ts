/**
 * COMPANY SUGGESTIONS OVER HTTP.
 *
 * One route, no database, no third party, no key. It reads the committed FMCSA
 * carrier index described in `src/server/places/carrierIndex.ts` and answers
 * from process memory, which is why it is safe to call on every keystroke and
 * why it keeps working with the database down.
 *
 * DELIBERATELY NOT A QUERY AGAINST `carrier_directory`. That table holds the
 * same carriers, and hitting it on every keypress is the mistake that took
 * production down on 2026-09-08: sustained directory load saturated the
 * aggregate limiter, which starved the platform health probe, which restarted
 * the VM every fifteen minutes for a day.
 *
 * DEGRADES TO A PLAIN INPUT, NEVER TO AN ERROR. If the asset is missing from a
 * deployment the route answers 200 with an empty list rather than 500. The
 * field it feeds is a text input that already works without suggestions; a
 * failing autocomplete must not colour a form the user can complete by typing.
 *
 * THERE WAS A PLACE ROUTE HERE TOO, AND IT WAS REMOVED RATHER THAN SHIPPED.
 * A US city index was built to autosuggest the heavy-haul tool's pickup and
 * delivery fields, and driving the finished form proved the idea wrong: that
 * tool geocodes an address to compute lane MILEAGE, and the US Census geocoder
 * matches street addresses only. It rejects "Houston, TX" with a 422 and an
 * explicit message. A city suggester on that field would have led users
 * straight to a value the tool refuses. The city index had no other consumer,
 * so it went with it — see the PR for the full reasoning.
 */
import type { Express, Request, Response } from 'express';
import { publicCalcLimiter } from '../rateLimits.js';
import { MAX_SUGGESTIONS, suggestCarriers } from '../places/carrierIndex.js';

/** Long enough for the longest real carrier names, and nothing like an essay. */
const MAX_QUERY_CHARS = 120;

export function registerPlacesRoutes(app: Express): void {
  app.get('/api/tools/company-suggest', publicCalcLimiter, (req: Request, res: Response) => {
    const raw = typeof req.query.q === 'string' ? req.query.q : '';
    const q = raw.slice(0, MAX_QUERY_CHARS);

    let carriers: ReturnType<typeof suggestCarriers> = [];
    try {
      carriers = suggestCarriers(q, MAX_SUGGESTIONS);
    } catch {
      // The asset failed to load. Answer empty — the field still works.
      carriers = [];
    }

    // The index is rebuilt from FMCSA on a human timescale, so a short public
    // TTL keeps repeat keystrokes off the process without pinning a stale
    // answer for long after a rebuild.
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      companies: carriers.map((c) => ({
        label: c.label,
        name: c.name,
        state: c.state,
        city: c.city,
        // The payload. A carrier picking itself at signup hands us its verified
        // FMCSA identity, which is worth more than the typing it saved.
        dot: c.dot,
      })),
    });
  });
}
