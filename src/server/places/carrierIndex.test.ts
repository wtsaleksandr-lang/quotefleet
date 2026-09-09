/**
 * THE CARRIER INDEX — what company autosuggest is allowed to offer.
 *
 * These assertions are about the CONTRACT rather than the row count. The index
 * is rebuilt from FMCSA whenever the authority file moves and the count changes
 * every time; what must not change is that a real carrier is findable by the
 * name a person would actually type, and that the established one leads a
 * shared prefix.
 */
import { describe, expect, it } from 'vitest';
import { suggestCarriers, MIN_QUERY_LENGTH, MAX_SUGGESTIONS } from './carrierIndex';

describe('company suggestions', () => {
  it('finds household-name carriers by their plain name', () => {
    for (const [query, expectName] of [
      ['old dominion', 'Old Dominion Freight Line'],
      ['estes express', 'Estes Express Lines'],
      ['werner', 'Werner Enterprises'],
    ] as const) {
      const top = suggestCarriers(query)[0];
      expect(top, query).toBeDefined();
      expect(top!.name, query).toContain(expectName);
    }
  });

  it('ignores punctuation and spacing, which is how people actually type', () => {
    /*
     * FMCSA stores this one as "J. B. Hunt Transport, INC.". Before the index
     * carried a normalised search key, "jb hunt" returned NOTHING — and that is
     * the single most likely thing a person types. Every spelling below has to
     * reach the same carrier.
     */
    const dots = ['jb hunt', 'j.b. hunt', 'J B Hunt', 'jbhunt'].map(
      (q) => suggestCarriers(q)[0]?.dot,
    );
    expect(dots[0], 'jb hunt must match at all').toBeDefined();
    expect(new Set(dots).size, `all spellings must reach one carrier, got ${dots.join()}`).toBe(1);
  });

  it('leads a shared prefix with the established carrier, not the alphabetical one', () => {
    /*
     * The original build sorted purely alphabetically and answered "schneider"
     * with Schneider Brothers Trucking and Schneider Cattle Trucking. FMCSA has
     * issued DOT numbers sequentially since the 1980s, so the reader ranks a
     * prefix's matches by ascending DOT — a lower number is a longer-established
     * carrier. This asserts the ordering rule, not any particular company.
     */
    for (const query of ['schneider', 'estes', 'werner', 'old dominion']) {
      const hits = suggestCarriers(query);
      expect(hits.length, query).toBeGreaterThan(0);
      const dots = hits.map((h) => Number(h.dot));
      expect([...dots].sort((a, b) => a - b), `${query} must be DOT-ascending`).toEqual(dots);
    }
  });

  it('carries the DOT number, which is the point of matching at all', () => {
    const top = suggestCarriers('old dominion')[0]!;
    // A carrier picking itself at signup hands us its verified FMCSA identity.
    expect(top.dot).toMatch(/^\d+$/);
    expect(Number(top.dot)).toBeGreaterThan(0);
    // And the label disambiguates two carriers of the same name by where they are.
    expect(top.label).toContain(top.name);
    if (top.city) expect(top.label).toContain(top.city);
  });

  it('says nothing below the minimum query length', () => {
    /*
     * Three, not the two the place index used. Company names share far longer
     * prefixes — "A", "AB" and "ABC" each match thousands — so a shorter minimum
     * returns an arbitrary slice rather than anything the user recognises.
     */
    expect(MIN_QUERY_LENGTH).toBe(3);
    expect(suggestCarriers('ab')).toEqual([]);
    expect(suggestCarriers('')).toEqual([]);
    expect(suggestCarriers('   ')).toEqual([]);
  });

  it('never returns more than it was asked for', () => {
    expect(suggestCarriers('abc').length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(suggestCarriers('abc', 3).length).toBeLessThanOrEqual(3);
  });

  it('returns nothing rather than throwing for a name that does not exist', () => {
    expect(suggestCarriers('zzzzqqqqnotarealcarrier')).toEqual([]);
  });
});
