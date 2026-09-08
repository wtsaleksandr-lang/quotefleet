/**
 * THE PLACE INDEX — what the autosuggest is allowed to offer, and what it must
 * never offer.
 *
 * These assertions are about the CONTRACT rather than the row count: the index
 * is rebuilt from a new Census vintage roughly once a year, and a test that
 * pinned 32,041 places would fail on that rebuild for no reason. What must not
 * change is that the descriptors are stripped, the collisions rank the way a
 * dispatcher expects, and the territories the calculator refuses are absent.
 */
import { describe, expect, it } from 'vitest';
import { loadPlaces, suggestPlaces, MIN_QUERY_LENGTH } from './placeIndex';

const places = loadPlaces();

describe('the committed place index', () => {
  it('loads a plausible number of US places, none of them territories', () => {
    // A range, not a number — a new Gazetteer vintage moves the count by a few
    // hundred and that is not a regression.
    expect(places.length).toBeGreaterThan(25_000);
    expect(places.length).toBeLessThan(40_000);
    // The OS/OW calculator refuses a territory leg as "not reachable by road
    // from the mainland". A suggestion list that offers what the form rejects
    // is two surfaces disagreeing about the product.
    for (const banned of ['PR', 'VI', 'GU', 'AS', 'MP']) {
      expect(places.some((p) => p.state === banned), `${banned} must not be offered`).toBe(false);
    }
  });

  it('strips the legal-class descriptor, including the multi-word ones', () => {
    // Single-token descriptors.
    expect(places.some((p) => p.name === 'Houston' && p.state === 'TX')).toBe(true);
    expect(places.some((p) => /\b(city|town|village|CDP)$/.test(p.name))).toBe(false);
    // The consolidated city-county governments, whose descriptors are phrases.
    // Getting these wrong mangles the name of a major freight destination.
    for (const [name, state] of [
      ['Indianapolis', 'IN'],
      ['Nashville-Davidson', 'TN'],
      ['Lexington-Fayette', 'KY'],
      ['Anchorage', 'AK'],
    ] as const) {
      expect(
        places.some((p) => p.name === name && p.state === state),
        `${name}, ${state}`,
      ).toBe(true);
    }
  });

  it('does not over-strip a name that merely ends in a descriptor-like word', () => {
    // "New York Mills village" must lose only "village". If the strip ran on
    // the whole trailing phrase it would collapse into "New York".
    expect(places.some((p) => p.name === 'New York Mills')).toBe(true);
    expect(places.some((p) => p.name === 'New York' && p.state === 'NY')).toBe(true);
  });
});

describe('suggestions', () => {
  it('leads with the place a freight dispatcher means', () => {
    for (const [query, name, state] of [
      ['hou', 'Houston', 'TX'],
      ['buff', 'Buffalo', 'NY'],
      ['chic', 'Chicago', 'IL'],
      ['dal', 'Dallas', 'TX'],
      ['mem', 'Memphis', 'TN'],
    ] as const) {
      const top = suggestPlaces(query)[0];
      expect(top, query).toBeDefined();
      expect(`${top!.name}, ${top!.state}`, query).toBe(`${name}, ${state}`);
    }
  });

  it('narrows on a state, typed with or without a comma', () => {
    for (const q of ['springfield, il', 'springfield il']) {
      const hits = suggestPlaces(q);
      expect(hits.length, q).toBeGreaterThan(0);
      expect(hits.every((h) => h.state === 'IL'), q).toBe(true);
      expect(hits[0]!.name, q).toBe('Springfield');
    }
  });

  it('folds accents so the name can be typed on a US keyboard', () => {
    const hits = suggestPlaces('espanola');
    expect(hits.some((h) => h.name === 'Española' && h.state === 'NM')).toBe(true);
  });

  it('keeps punctuation that separates words rather than matching through it', () => {
    expect(suggestPlaces('st. louis')[0]?.label).toBe('St. Louis, MO');
    expect(suggestPlaces('winston')[0]?.label).toBe('Winston-Salem, NC');
  });

  it('says nothing at all below the minimum query length', () => {
    // One character ranks on the weakest part of the prominence proxy — it can
    // lead with a physically enormous but obscure place. Two is where the
    // answer starts being about what was typed.
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(suggestPlaces('a')).toEqual([]);
    expect(suggestPlaces(' ')).toEqual([]);
    expect(suggestPlaces('')).toEqual([]);
  });

  it('matches a word start, but never mid-word', () => {
    /*
     * THIS IS WHERE THE WORD-START RULE EARNS ITS KEEP. People type the
     * distinctive half of a two-word city and expect to find it: none of these
     * four has a single place whose name STARTS with the typed text.
     *
     * ("palm" was the first example tried here and is a bad one — 51 places
     * begin with "Palm", so the prefix matches fill the list and the word-start
     * pass never gets a slot. That is the ranking working, not failing.)
     */
    for (const [query, want] of [
      ['vegas', 'Las Vegas'],
      ['angeles', 'Los Angeles'],
      ['antonio', 'San Antonio'],
    ] as const) {
      expect(suggestPlaces(query).some((p) => p.name === want), query).toBe(true);
    }

    // But mid-word must not match, or a substring search would offer four
    // hundred places nobody was typing towards.
    expect(suggestPlaces('ouston').some((p) => p.name === 'Houston')).toBe(false);
    expect(suggestPlaces('egas').some((p) => p.name === 'Las Vegas')).toBe(false);
  });

  it('ranks a literal prefix above a word-start match', () => {
    // "orleans" has both: five places begin with it, and New Orleans contains
    // it at a word boundary. The leading matches come first by construction.
    const hits = suggestPlaces('orleans');
    const firstWordStart = hits.findIndex((h) => !h.name.toLowerCase().startsWith('orleans'));
    const lastPrefix = hits.map((h) => h.name.toLowerCase().startsWith('orleans')).lastIndexOf(true);
    if (firstWordStart >= 0) expect(firstWordStart).toBeGreaterThan(lastPrefix);
  });

  it('honours the caller-supplied limit', () => {
    expect(suggestPlaces('a', 5).length).toBeLessThanOrEqual(5);
    expect(suggestPlaces('sa', 3).length).toBeLessThanOrEqual(3);
  });
});
