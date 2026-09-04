/**
 * THE PARSERS, AGAINST REAL CAPTURED DOCUMENTS.
 *
 * Three of the four fixtures were fetched live from the state on 2026-09-04 and
 * committed verbatim (the fourth, Washington, is hand-built to WSDOT's published
 * field list and says so in its own header). No test in this file opens a
 * socket — vitest's global setup replaces `fetch` with a sentinel that throws
 * on any off-box call.
 *
 * The most important assertions here are the NEGATIVE ones. A parser for
 * somebody else's HTML fails by returning nothing, and "nothing" rendered as
 * "no restrictions" is the exact failure that puts a truck on a posted road. So
 * every adapter is tested for what it does when the payload is empty, and every
 * one of them must THROW rather than return an empty answer.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ROWS_PER_STATE,
  SeasonalParseError,
  parseDotNetDate,
  parseMiBulletins,
  parseMnZoneTable,
  parseNdGeoJson,
  parseUsLongDate,
  parseUsSlashDate,
  parseWaCvRestrictions,
  tonsToPounds,
} from './adapters.js';
import { seasonalSourceFor } from '../../calc/osow/seasonal/sources.js';
import { ND_LOADRESTRICT_FIXTURE } from './fixtures/ndLoadRestrict.js';
import { MN_LOAD_LIMITS_FIXTURE } from './fixtures/mnLoadLimits.js';
import { MI_SPRING_WEIGHT_FIXTURE } from './fixtures/miSpringWeightBulletins.js';
import { WA_CVRESTRICTIONS_FIXTURE } from './fixtures/waCvRestrictions.js';

const ND = seasonalSourceFor('ND')!;
const MN = seasonalSourceFor('MN')!;
const MI = seasonalSourceFor('MI')!;
const WA = seasonalSourceFor('WA')!;
const TODAY = '2026-09-04';

describe('small helpers', () => {
  it('reads the two date formats the states actually print', () => {
    expect(parseUsLongDate('Mar. 20, 2026')).toBe('2026-03-20');
    expect(parseUsLongDate('May 15, 2026')).toBe('2026-05-15');
    expect(parseUsSlashDate('05/15/2026')).toBe('2026-05-15');
    expect(parseUsLongDate('sometime in spring')).toBeNull();
  });

  it('never turns an unreadable WSDOT date into 1970 — that would read as permanently in force', () => {
    expect(parseDotNetDate('/Date(1772265600000-0800)/')).toBe('2026-02-28');
    expect(parseDotNetDate(null)).toBeNull();
    expect(parseDotNetDate('tomorrow')).toBeNull();
  });

  it('converts a stated ton figure and refuses to invent one', () => {
    expect(tonsToPounds('7 Ton')).toBe(14000);
    expect(tonsToPounds('Interstate System')).toBeUndefined();
  });
});

describe('North Dakota GeoJSON', () => {
  const parsed = parseNdGeoJson(ND_LOADRESTRICT_FIXTURE, ND, TODAY);

  it('keeps only the segments the state flags InEffect=Y', () => {
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.recordCount).toBe(4);
    expect(parsed.verifiedClear).toBe(false);
  });

  it("takes each row's effective date from the ORDER, not from our clock", () => {
    for (const r of parsed.rows) {
      expect(r.effectiveFrom).toBe('2026-06-25');
      expect(r.effectiveFrom).not.toBe(TODAY);
    }
  });

  it('keeps the state\'s own limit wording and parses the ton figure beside it', () => {
    const seven = parsed.rows.find((r) => r.value.limit === '7 Ton');
    expect(seven).toBeDefined();
    expect(seven?.value.axleLimitLbs).toBe(14000);
    expect(seven?.value.scope).toBe('route-segment');
    expect(seven?.value.orderRef).toBe('Order 2026-20');
  });

  it('leaves effectiveTo OPEN — NDDOT publishes no lift date, and inventing one would clear a live restriction', () => {
    for (const r of parsed.rows) expect(r.effectiveTo).toBeNull();
  });

  it("records the document's own date, separately from ours", () => {
    expect(parsed.bulletinDate).toBe('2026-06-24');
    for (const r of parsed.rows) {
      expect(r.source.revisedOn).toBe('2026-06-24');
      expect(r.source.retrievedOn).toBe(TODAY);
    }
  });

  it('an EMPTY FeatureCollection is a FAILURE, not a lifted season', () => {
    // This is the whole soft-failure rule. NDDOT publishes every segment
    // whether restricted or not, so zero features is a broken publish — and
    // writing it as an answer would clear every restriction in the state.
    expect(() => parseNdGeoJson('{"type":"FeatureCollection","features":[]}', ND, TODAY)).toThrow(
      SeasonalParseError,
    );
    expect(() => parseNdGeoJson('not json', ND, TODAY)).toThrow(SeasonalParseError);
    expect(() => parseNdGeoJson('{"type":"Feature"}', ND, TODAY)).toThrow(SeasonalParseError);
  });

  it('a full collection with nothing in effect IS a verified clear', () => {
    const cleared = JSON.parse(ND_LOADRESTRICT_FIXTURE) as {
      features: Array<{ properties: { InEffect: string } }>;
    };
    for (const f of cleared.features) f.properties.InEffect = 'N';
    const out = parseNdGeoJson(JSON.stringify(cleared), ND, TODAY);
    expect(out.rows).toHaveLength(0);
    expect(out.verifiedClear).toBe(true);
  });

  it('caps the rows it keeps but still reports the TRUE count', () => {
    const doc = JSON.parse(ND_LOADRESTRICT_FIXTURE) as { features: unknown[] };
    const one = doc.features[0];
    doc.features = Array.from({ length: MAX_ROWS_PER_STATE + 40 }, () =>
      JSON.parse(JSON.stringify(one)),
    );
    const out = parseNdGeoJson(JSON.stringify(doc), ND, TODAY);
    expect(out.rows).toHaveLength(MAX_ROWS_PER_STATE);
    expect(out.recordCount).toBe(MAX_ROWS_PER_STATE + 40);
    expect(out.truncated).toBe(true);
  });
});

describe('Minnesota zone table', () => {
  const parsed = parseMnZoneTable(MN_LOAD_LIMITS_FIXTURE, MN, TODAY);

  it('reads the six frost zones and their published windows', () => {
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.recordCount).toBe(6);
    const north = parsed.rows.find((r) => r.value.area.startsWith('North frost'));
    expect(north?.effectiveFrom).toBe('2026-03-20');
    expect(north?.effectiveTo).toBe('2026-05-15');
  });

  it('IGNORES the Winter Load Increase block, which moves the OPPOSITE way', () => {
    // MnDOT prints four programmes in one table. WLI RAISES limits from
    // December; publishing it as a restriction would invent a restriction in a
    // window when the state is MORE permissive than normal.
    for (const r of parsed.rows) {
      expect(r.effectiveFrom.slice(5, 7)).not.toBe('12');
      expect(r.value.limit.toLowerCase()).toContain('spring load restrictions');
    }
  });

  it('records that the page carries no revision date of its own', () => {
    expect(parsed.bulletinDate).toBeNull();
    for (const r of parsed.rows) expect(r.source.revisedOn).toBeNull();
  });

  it('is a VERIFIED CLEAR in September, because no published window covers today', () => {
    expect(parsed.verifiedClear).toBe(true);
  });

  it('is NOT clear inside a published window', () => {
    const inSeason = parseMnZoneTable(MN_LOAD_LIMITS_FIXTURE, MN, '2026-04-01');
    expect(inSeason.verifiedClear).toBe(false);
  });

  it('a table with no Spring Load Restriction rows is a FAILURE', () => {
    expect(() => parseMnZoneTable('<table><tr><td>nothing</td></tr></table>', MN, TODAY)).toThrow(
      SeasonalParseError,
    );
    expect(() => parseMnZoneTable('<p>no table at all</p>', MN, TODAY)).toThrow(SeasonalParseError);
  });
});

describe('Michigan bulletins — structure read, meaning NOT invented', () => {
  const parsed = parseMiBulletins(MI_SPRING_WEIGHT_FIXTURE, MI, TODAY);

  it("ranks by the bulletin's OWN date and reads the latest", () => {
    expect(parsed.bulletinDate).toBe('2026-05-15');
    expect(parsed.recordCount).toBeGreaterThanOrEqual(2);
  });

  it('recognises the statewide LIFT and reports a verified clear with no rows', () => {
    // Bulletin #8: "MDOT will lift the remaining seasonal weight restrictions
    // on all state trunkline highways..."
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.verifiedClear).toBe(true);
  });

  it('an unrecognised bulletin is UNKNOWN, never a clear', () => {
    const odd = MI_SPRING_WEIGHT_FIXTURE.replace(
      /<p class="swbodycontent">[\s\S]*?<\/p>/,
      '<p class="swbodycontent">A note about something else entirely.</p>',
    );
    const out = parseMiBulletins(odd, MI, TODAY);
    expect(out.rows).toHaveLength(0);
    // THE POINT OF THE FLAG: no rows, but emphatically not a green light.
    expect(out.verifiedClear).toBe(false);
  });

  it('a bulletin that IMPOSES produces one cited row quoting MDOT verbatim', () => {
    const imposing = MI_SPRING_WEIGHT_FIXTURE.replace(
      /<p class="swbodycontent">[\s\S]*?<\/p>/,
      '<p class="swbodycontent">Effective 6 a.m. Monday, MDOT will begin enforcing seasonal weight restrictions on state trunkline highways in the northern Lower Peninsula.</p>',
    );
    const out = parseMiBulletins(imposing, MI, TODAY);
    expect(out.rows).toHaveLength(1);
    expect(out.verifiedClear).toBe(false);
    expect(out.rows[0]?.value.scope).toBe('route-class');
    expect(out.rows[0]?.effectiveFrom).toBe('2026-05-15');
    expect(out.rows[0]?.effectiveTo).toBeNull();
    expect(out.rows[0]?.note).toContain('MDOT, verbatim');
  });

  it('a page with no bulletins is a FAILURE', () => {
    expect(() => parseMiBulletins('<html><body>maintenance</body></html>', MI, TODAY)).toThrow(
      SeasonalParseError,
    );
  });
});

describe('Washington CVRestrictions', () => {
  const parsed = parseWaCvRestrictions(WA_CVRESTRICTIONS_FIXTURE, WA, TODAY);

  it('keeps only the SEASONAL rows', () => {
    // A permanently posted bridge is not a frost law, and an undated advisory
    // is not evidence of a season.
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.recordCount).toBe(2);
    for (const r of parsed.rows) expect(r.value.area).not.toContain('Example Creek');
  });

  it('carries the state\'s own window, including an open-ended one', () => {
    expect(parsed.rows[0]?.effectiveFrom).toBe('2026-02-28');
    expect(parsed.rows[0]?.effectiveTo).toBe('2026-05-16');
    expect(parsed.rows[1]?.effectiveTo).toBeNull();
  });

  it('an EMPTY array is a FAILURE — Washington posts permanent restrictions year-round', () => {
    expect(() => parseWaCvRestrictions('[]', WA, TODAY)).toThrow(SeasonalParseError);
    expect(() => parseWaCvRestrictions('{}', WA, TODAY)).toThrow(SeasonalParseError);
  });

  it('a plausible feed with no seasonal rows IS a verified clear', () => {
    const permanentOnly = JSON.stringify([
      { IsPermanentRestriction: true, DateEffective: '/Date(1104537600000-0800)/', LocationName: 'x' },
    ]);
    const out = parseWaCvRestrictions(permanentOnly, WA, TODAY);
    expect(out.rows).toHaveLength(0);
    expect(out.verifiedClear).toBe(true);
  });
});
