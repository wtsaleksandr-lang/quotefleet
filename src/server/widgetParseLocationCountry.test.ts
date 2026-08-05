import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

/**
 * Lifts widget.js's parseLocation() out and evals it in a bare scope, so the
 * free-typed-text parsing logic is tested as behaviour (not just a
 * string-match). widget.js is a plain browser script (IIFE, no exports).
 * Sliced from the CA_PROVINCES const through the start of the next function
 * (hasPostalCode) so the province table parseLocation closes over comes
 * along with it.
 */
async function loadParseLocation(): Promise<(s: string) => Record<string, unknown>> {
  const js = await file('widget.js');
  const start = js.indexOf('var CA_PROVINCES');
  const end = js.indexOf('function hasPostalCode(');
  if (start < 0 || end < 0) throw new Error('parseLocation slice markers not found in widget.js');
  const src = js.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(src + '\nreturn parseLocation;')() as (s: string) => Record<string, unknown>;
}

/**
 * BUG — a Canadian city-only lane (e.g. pickup "Mississauga, ON", delivery
 * "Toronto, ON", no postal code, no autocomplete suggestion picked) hard-400'd
 * from /api/public/quote. Root cause: parseLocation()'s free-typed-text
 * branch (no zip, "City, ST" shape) hardcoded country:'US' regardless of the
 * state/province token, so the widget shipped {city:'Mississauga',
 * state:'ON', country:'US'} to the server. The route passes body.pickup/
 * delivery.country straight into distanceBetween → geocode(), which filters
 * Nominatim to countrycodes=us — Ontario isn't a US state, so it can never
 * match, geocode() returns null, and distanceBetween 400s. Fix: recognize
 * Canadian province/territory codes in the state slot and infer country:'CA'.
 */
describe('widget parseLocation() country inference (CA city-only lane fix)', () => {
  it('infers CA for a free-typed Canadian "City, PROVINCE" with no postal code', async () => {
    const parseLocation = await loadParseLocation();
    expect(parseLocation('Mississauga, ON')).toEqual({ city: 'Mississauga', state: 'ON', country: 'CA' });
    expect(parseLocation('Toronto, ON')).toEqual({ city: 'Toronto', state: 'ON', country: 'CA' });
    expect(parseLocation('Vancouver, BC')).toEqual({ city: 'Vancouver', state: 'BC', country: 'CA' });
    expect(parseLocation('Montreal, QC')).toEqual({ city: 'Montreal', state: 'QC', country: 'CA' });
  });

  it('still infers US for a free-typed US "City, ST" (no regression)', async () => {
    const parseLocation = await loadParseLocation();
    expect(parseLocation('Chicago, IL')).toEqual({ city: 'Chicago', state: 'IL', country: 'US' });
    expect(parseLocation('Atlanta, GA')).toEqual({ city: 'Atlanta', state: 'GA', country: 'US' });
  });

  it('leaves the ZIP/FSA and postal-code branches untouched', async () => {
    const parseLocation = await loadParseLocation();
    // Bare US ZIP (all-digit) — country US, unchanged.
    expect(parseLocation('60601')).toEqual({ zip: '60601', country: 'US' });
    // Bare CA FSA/postal (starts with a letter) — country CA, unchanged.
    expect(parseLocation('M5V 2T6')).toEqual({ zip: 'M5V2T6', country: 'CA' });
    // "City, POSTALCODE" shape (already had its own CA/US inference) — unchanged.
    expect(parseLocation('Toronto, M5V 2T6')).toEqual({
      city: 'Toronto',
      state: 'M5',
      zip: 'M5V2T6',
      country: 'CA',
    });
  });

  it('leaves the ambiguous single-token city-only case unchanged (no state to infer from)', async () => {
    const parseLocation = await loadParseLocation();
    expect(parseLocation('Mississauga')).toEqual({ city: 'Mississauga', country: 'US' });
  });
});
