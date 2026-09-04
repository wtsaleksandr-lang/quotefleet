/**
 * REGISTRY INTEGRITY.
 *
 * The registry is the part of this feature a human edits, so it is the part
 * that will be edited wrongly. These tests pin the invariants that a careless
 * addition would break, and every one of them corresponds to a real way the
 * feature could lie:
 *
 *   • an aggregator URL sneaking in as a citation
 *   • a state marked `parse` with no parser, which would fail every poll
 *   • a state marked `local-only` that we nevertheless poll, wasting requests
 *     on a page that will never carry a state restriction
 *   • a posting window with no stated basis, which makes the schedule folklore
 */
import { describe, expect, it } from 'vitest';
import { SEASONAL_ADAPTERS } from '../../../server/seasonal/adapters.js';
import { SEASONAL_SOURCES, hasSeasonalProgramme, seasonalSourceFor } from './sources.js';

/** Commercial summaries of state bulletins. Useful as a map, never as a cite. */
const AGGREGATOR_HOSTS = [
  'oversize.io',
  'wcspermits.com',
  'heavyhaul',
  'permitservice',
  'truckstop.com',
  'wikipedia.org',
];

describe('every citation is the ISSUING AGENCY', () => {
  it('names no aggregator, anywhere', () => {
    for (const s of SEASONAL_SOURCES) {
      const urls = [s.authorityUrl, s.fetchUrl ?? ''].join(' ').toLowerCase();
      for (const host of AGGREGATOR_HOSTS) {
        expect(urls).not.toContain(host);
      }
    }
  });

  it('uses HTTPS for every fetched and linked URL', () => {
    for (const s of SEASONAL_SOURCES) {
      expect(s.authorityUrl.startsWith('https://')).toBe(true);
      if (s.fetchUrl) expect(s.fetchUrl.startsWith('https://')).toBe(true);
    }
  });

  it('is a .gov, a .us or a state DOT domain — never a vendor', () => {
    // modot.org and wsdot.com are the two official state DOT sites that do not
    // sit on .gov. Both are the agency's own primary domain; they are allowed
    // by name rather than by loosening the rule.
    for (const s of SEASONAL_SOURCES) {
      const host = new URL(s.authorityUrl).hostname;
      expect(
        /\.gov$|\.us$|wisconsindot\.gov$|wsdot\.com$|wyoroad\.info$|modot\.org$/.test(host),
        `${s.code} cites ${host}`,
      ).toBe(true);
    }
  });
});

describe('structural consistency', () => {
  it('has one row per state code', () => {
    const codes = SEASONAL_SOURCES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z]{2}$/);
  });

  it('has a unique, stable source id per state — a row must trace to its document', () => {
    const ids = SEASONAL_SOURCES.map((s) => s.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every `parse` state has a registered adapter, and no other state has one', () => {
    for (const s of SEASONAL_SOURCES) {
      if (s.ingestion === 'parse') {
        expect(s.adapter, `${s.code} is parsed but names no adapter`).not.toBeNull();
        expect(SEASONAL_ADAPTERS[s.adapter as string], `${s.code} names an unregistered adapter`).toBeTypeOf(
          'function',
        );
      } else {
        expect(s.adapter, `${s.code} is ${s.ingestion} but names an adapter`).toBeNull();
      }
    }
  });

  it('never polls a state that has no state-system programme', () => {
    for (const s of SEASONAL_SOURCES) {
      if (s.programme !== 'statewide') expect(s.ingestion).toBe('none');
      else expect(s.ingestion).not.toBe('none');
    }
  });

  it('gives every polled window a STATED BASIS — a schedule with no reason is folklore', () => {
    for (const s of SEASONAL_SOURCES) {
      if (s.ingestion === 'none') continue;
      expect(s.postingWindow.from).toMatch(/^\d{2}-\d{2}$/);
      expect(s.postingWindow.to).toMatch(/^\d{2}-\d{2}$/);
      expect(s.postingWindow.basis.length, `${s.code} window has no basis`).toBeGreaterThan(60);
    }
  });

  it('says something real about every state, including the ones that do not restrict', () => {
    for (const s of SEASONAL_SOURCES) {
      expect(s.note.length, `${s.code} has no note`).toBeGreaterThan(40);
    }
  });
});

describe('the correction this registry exists to make', () => {
  it('records the states whose FROST LAWS ARE LOCAL as a fact, not as missing coverage', () => {
    // Every one of these is priced by the OS/OW engine and every one is
    // routinely listed as a "frost law state" by the aggregators. The state
    // SYSTEM is not restricted; a county or township road on the route may be.
    for (const code of ['OH', 'IN', 'IL', 'MO', 'NY', 'PA']) {
      const s = seasonalSourceFor(code);
      expect(s?.programme, `${code} should be local-only`).toBe('local-only');
      expect(hasSeasonalProgramme(code)).toBe(false);
      expect(s?.note.toLowerCase()).toMatch(/local|county|township|posted/);
    }
  });

  it('marks the genuine northern-tier programmes as statewide', () => {
    for (const code of ['ND', 'MN', 'MI', 'WI', 'SD', 'MT', 'ME', 'AK', 'ID', 'NE', 'WY', 'WA']) {
      expect(hasSeasonalProgramme(code), `${code} should be statewide`).toBe(true);
    }
  });

  it('covers Washington, which the OS/OW engine already prices permits for', () => {
    // The states where a live restriction can change a quote we ALREADY issue
    // are the ones that had to be covered first.
    const wa = seasonalSourceFor('WA');
    expect(wa?.ingestion).toBe('parse');
    expect(wa?.machineReadable).toBe('full');
    // And it must cost nothing: a free access code, and skipped when absent.
    expect(wa?.freeApiKey?.envVar).toBe('WSDOT_TRAVELER_API_KEY');
  });

  it("North Dakota is the machine-readable one, and it is a real endpoint", () => {
    const nd = seasonalSourceFor('ND');
    expect(nd?.format).toBe('geojson');
    expect(nd?.machineReadable).toBe('full');
    expect(nd?.fetchUrl).toBe('https://travelfiles.dot.nd.gov/geojson_nc/loadrestrict-current.json');
  });
});

describe('the stale-failure direction is set from HOW the source publishes', () => {
  it('a source that publishes an END DATE under-restricts when stale; a presence feed over-restricts', () => {
    // Minnesota prints a start AND an end per zone: a stale copy expires itself
    // and we miss a NEW posting — a false clear, the dangerous direction.
    expect(seasonalSourceFor('MN')?.staleFailureDirection).toBe('under-restricts');
    // North Dakota lists only what is in force: a stale copy keeps showing a
    // lifted restriction — a false restriction, the safe direction.
    expect(seasonalSourceFor('ND')?.staleFailureDirection).toBe('over-restricts');
  });
});
