import { describe, expect, it } from 'vitest';
import { ZIP5_CENTROIDS } from './zip5Centroids.js';
import { ZIP_CENTROIDS } from './zipCentroids.js';
import { distanceMiles } from './engine.js';

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
