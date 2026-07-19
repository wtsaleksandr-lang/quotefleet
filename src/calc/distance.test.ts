import { describe, expect, it } from 'vitest';
import { ZIP5_CENTROIDS } from './zip5Centroids.js';
import { ZIP_CENTROIDS } from './zipCentroids.js';
import { distanceMiles } from './engine.js';
import { geocode } from './distance.js';
import { CANADA_FSA_CENTROIDS } from './canadaFsa.js';

/**
 * FIX 5 — coarse ZIP3-prefix centroids collapsed same-metro cross-ZIP lanes to
 * exactly 0 mi (90001 and 90210 both → the "900" centroid). The 5-digit ZCTA
 * centroid table resolves each ZIP to its own point so short lanes price.
 */
describe('5-digit ZIP centroid resolution (FIX 5)', () => {
  const road = (aZip: string, bZip: string) => {
    const a = ZIP5_CENTROIDS[aZip];
    const b = ZIP5_CENTROIDS[bZip];
    expect(a, aZip).toBeDefined();
    expect(b, bZip).toBeDefined();
    return Math.round(distanceMiles({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1.18);
  };

  it('90001 → 90210 (same LA metro, different ZIPs) now returns non-zero miles', () => {
    expect(road('90001', '90210')).toBeGreaterThan(0);
  });

  it('60607 → 60601 (both Chicago "606" prefix) no longer collapses to 0 mi', () => {
    expect(road('60607', '60601')).toBeGreaterThan(0);
    // Prove the old path WOULD have been 0: same ZIP3 centroid → identical point.
    const p = ZIP_CENTROIDS['606'];
    if (p) expect(distanceMiles({ lat: p[0], lng: p[1] }, { lat: p[0], lng: p[1] })).toBe(0);
  });

  it('a genuine long lane still prices (LA 90001 → NYC 10001)', () => {
    expect(road('90001', '10001')).toBeGreaterThan(2000);
  });

  it('covers the bulk of US 5-digit ZIPs (ZCTA gazetteer)', () => {
    expect(Object.keys(ZIP5_CENTROIDS).length).toBeGreaterThan(30000);
  });
});

/**
 * Canadian FSA coverage — the CANADA_FSA_CENTROIDS table now spans every FSA
 * (GeoNames, CC-BY 4.0) incl. the territories, so CA postals resolve OFFLINE
 * via geocode()'s Tier-1 lookup (source:'fsa') — no DB, no Nominatim. In-table
 * FSA zips return before any db() call, so these run fully offline.
 */
describe('Canadian FSA offline resolution', () => {
  const roadCA = async (aZip: string, bZip: string) => {
    const a = await geocode({ zip: aZip, country: 'CA' });
    const b = await geocode({ zip: bZip, country: 'CA' });
    expect(a, aZip).toBeTruthy();
    expect(b, bZip).toBeTruthy();
    expect(a!.source, `${aZip} should resolve offline`).toBe('fsa');
    expect(b!.source, `${bZip} should resolve offline`).toBe('fsa');
    return Math.round(distanceMiles(a!, b!) * 1.18);
  };

  it('comprehensive coverage incl. territories (~1,650 FSAs)', () => {
    expect(Object.keys(CANADA_FSA_CENTROIDS).length).toBeGreaterThan(1600);
    // Territory FSAs present (NT / YT / NU).
    for (const fsa of ['X0A', 'X1A', 'Y1A']) {
      expect(CANADA_FSA_CENTROIDS[fsa], fsa).toBeDefined();
    }
  });

  it('Toronto M5V → Ottawa K1P prices a sensible cross-city lane', async () => {
    const mi = await roadCA('M5V 2T6', 'K1P 1J1');
    expect(mi).toBeGreaterThan(150);
    expect(mi).toBeLessThan(400);
  });

  it('Vancouver V6B → Calgary T2P (cross-province) is a long lane', async () => {
    const mi = await roadCA('V6B', 'T2P');
    expect(mi).toBeGreaterThan(400);
  });

  it('Montreal H2Y → Quebec City G1R prices non-zero', async () => {
    expect(await roadCA('H2Y', 'G1R')).toBeGreaterThan(100);
  });

  it('rural NL A0A resolves offline as source:fsa (not nominatim)', async () => {
    const p = await geocode({ zip: 'A0A 1A0', country: 'CA' });
    expect(p).toBeTruthy();
    expect(p!.source).toBe('fsa');
  });

  it('territory YT Y1A (Whitehorse) resolves offline as source:fsa', async () => {
    const p = await geocode({ zip: 'Y1A', country: 'CA' });
    expect(p).toBeTruthy();
    expect(p!.source).toBe('fsa');
    expect(p!.state).toBe('YT');
  });

  it('intra-metro M5V → M4W is non-zero (distinct FSA centroids)', async () => {
    expect(await roadCA('M5V', 'M4W')).toBeGreaterThan(0);
  });

  it('a US lane still resolves unchanged (source:zip)', async () => {
    const a = await geocode({ zip: '90001', country: 'US' });
    const b = await geocode({ zip: '10001', country: 'US' });
    expect(a!.source).toBe('zip');
    expect(b!.source).toBe('zip');
    expect(Math.round(distanceMiles(a!, b!) * 1.18)).toBeGreaterThan(2000);
  });
});
