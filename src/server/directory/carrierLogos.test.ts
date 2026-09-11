/**
 * THE CURATED CARRIER-LOGO REGISTRY.
 *
 * What is actually at risk here is not rendering — it is IDENTITY. A logo on
 * the wrong profile is a misidentification, so most of this file is about the
 * things that would let one happen quietly:
 *
 *   1. EVERY ENTRY IS ATTACHED TO A REAL, WELL-FORMED USDOT, exactly once. A
 *      duplicate or a typo'd key is how a mark silently lands on nobody — or
 *      on the wrong somebody.
 *   2. EVERY PATH POINTS AT A FILE THAT EXISTS and is small enough to ship. A
 *      committed registry row whose asset was never committed renders a broken
 *      image on a carrier's public profile.
 *   3. THE CLAIM PATH STILL WINS. A carrier that uploads its own logo must
 *      outrank our curation of it.
 *   4. A CARRIER WITHOUT ARTWORK STILL RENDERS, as a monogram — the state we
 *      deliberately kept for the ~331,000 carriers we have no mark for, and
 *      for curated carriers whose artwork we could not obtain.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURATED_CARRIER_LOGOS,
  carrierLogoPaths,
  curatedCarrierForUsdot,
  curatedSquareLogoForUsdot,
  curatedWideLogoForUsdot,
} from './carrierLogos.js';
import { carrierLogoUrl } from './pages.js';
import type { VisibleCarrier } from './queries.js';

const publicDir = resolve(process.cwd(), 'src/server/public');

/** A VisibleCarrier stub — only the fields the logo slot reads. */
function carrier(over: Partial<VisibleCarrier> & Record<string, unknown> = {}): VisibleCarrier {
  return { usdot: '999999999', slug: 'test-carrier-999999999', legalName: 'TEST CARRIER LLC', ...over } as unknown as VisibleCarrier;
}

describe('the curated carrier-logo registry', () => {
  it('keys every entry on a well-formed USDOT, with no duplicates', () => {
    const seen = new Set<string>();
    for (const c of CURATED_CARRIER_LOGOS) {
      expect(c.usdot, `${c.displayName}: USDOT must be digits with no leading zeros`).toMatch(/^[1-9][0-9]*$/);
      expect(seen.has(c.usdot), `USDOT ${c.usdot} is curated twice`).toBe(false);
      seen.add(c.usdot);
    }
  });

  it('carries the identity evidence that justified each entry', () => {
    // Not decoration: this is the record of WHY a given mark is on a given
    // USDOT, and the thing a reviewer checks. An entry without it is a guess.
    for (const c of CURATED_CARRIER_LOGOS) {
      expect(c.legalName.trim(), `${c.displayName}: FMCSA legal name`).not.toBe('');
      expect(c.displayName.trim(), `${c.usdot}: display name`).not.toBe('');
      expect(c.evidence.length, `${c.displayName}: evidence must be substantive`).toBeGreaterThan(40);
    }
  });

  it('ships BOTH crops of every mark, as real, same-origin, small WebP files', () => {
    // Both, because the marquee tile is wide and the directory tile is square.
    // A registry row whose square crop was never committed renders a broken
    // image on a carrier's public profile while the homepage looks perfect.
    for (const c of CURATED_CARRIER_LOGOS) {
      if (c.logo === null) continue;
      const paths = carrierLogoPaths(c.logo);
      expect(paths.wide).toBe(`/carrier-logos/${c.logo}.webp`);
      expect(paths.square).toBe(`/carrier-logos/square/${c.logo}.webp`);
      for (const [kind, p] of Object.entries(paths)) {
        // Same-origin only. A remote logo would be a third-party request on a
        // public page AND a mark that can change under us without review.
        expect(p, `${c.displayName} ${kind}`).toMatch(/^\/carrier-logos\/(square\/)?[a-z0-9-]+\.webp$/);
        const file = resolve(publicDir, p.slice(1));
        expect(() => statSync(file), `${c.displayName}: ${p} is not committed`).not.toThrow();
        // Well under the 30 KB budget — these ship on the homepage.
        expect(statSync(file).size, `${c.displayName}: ${p} is too heavy`).toBeLessThan(30 * 1024);
        // Really a WebP ("RIFF"…"WEBP"), not a renamed PNG.
        const head = readFileSync(file).subarray(0, 12);
        expect(head.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(head.subarray(8, 12).toString('ascii')).toBe('WEBP');
      }
    }
  });

  it('gives every carrier its OWN slug, so no two can share one mark', () => {
    // `logo` is the join between a row and a pair of files. Two rows pointing
    // at one slug is a misidentification with a single-character diff: both
    // carriers render the same mark and the registry still looks plausible.
    const slugs = CURATED_CARRIER_LOGOS.map((c) => c.logo).filter((s): s is string => s !== null);
    expect(new Set(slugs).size, 'two carriers share a logo slug').toBe(slugs.length);
  });

  it('commits no orphaned artwork — every file on disk belongs to a row', () => {
    // The failure this catches is a DROPPED row whose files stayed behind: a
    // carrier removed from the registry (a takedown, a mark that turned out not
    // to be theirs) is only really removed once its artwork is gone too, and a
    // stale pair is otherwise invisible because nothing renders it.
    const referenced = new Set(CURATED_CARRIER_LOGOS.map((c) => c.logo).filter(Boolean));
    for (const dir of ['carrier-logos', 'carrier-logos/square']) {
      for (const f of readdirSync(resolve(publicDir, dir))) {
        if (!f.endsWith('.webp')) continue;
        expect(referenced.has(f.replace(/\.webp$/, '')), `${dir}/${f} is not referenced by any registry row`).toBe(true);
      }
    }
  });

  it('holds enough marks for a continuous strip to read as a wall', () => {
    // A marquee this short repeats visibly: the renderer pads any list under
    // MIN_TILES_PER_ROW back up to twelve tiles by REPEATING it, so a viewer
    // sees the same handful of companies cycle past inside one screen. Twenty
    // is the floor at which a desktop row stops looking like a loop.
    const withArt = CURATED_CARRIER_LOGOS.filter((c) => c.logo !== null);
    expect(withArt.length, 'the strip needs at least 20 real marks').toBeGreaterThanOrEqual(20);
  });

  it('resolves a USDOT however it is spelled, and refuses anything that is not one', () => {
    const withArt = CURATED_CARRIER_LOGOS.find((c) => c.logo !== null);
    expect(withArt, 'the registry should hold at least one real mark').toBeTruthy();
    const dot = withArt!.usdot;
    const paths = carrierLogoPaths(withArt!.logo!);
    expect(curatedSquareLogoForUsdot(dot)).toBe(paths.square);
    expect(curatedWideLogoForUsdot(dot)).toBe(paths.wide);
    // The directory stores USDOT zero-stripped; a caller may not have.
    expect(curatedSquareLogoForUsdot(`000${dot}`)).toBe(paths.square);
    expect(curatedSquareLogoForUsdot(` ${dot} `)).toBe(paths.square);
    for (const bad of ['', '   ', 'abc', '12a34', null, undefined]) {
      expect(curatedSquareLogoForUsdot(bad)).toBeNull();
      expect(curatedWideLogoForUsdot(bad)).toBeNull();
    }
    expect(curatedSquareLogoForUsdot('999999999')).toBeNull();
    expect(curatedCarrierForUsdot(dot)?.displayName).toBe(withArt!.displayName);
  });
});

describe('the directory logo slot', () => {
  it('renders the real SQUARE image for a curated carrier', () => {
    const withArt = CURATED_CARRIER_LOGOS.find((c) => c.logo !== null)!;
    // The directory's tile is square, so it must get the square crop — the
    // wide one would render a postage stamp inside a 48px avatar.
    expect(carrierLogoUrl(carrier({ usdot: withArt.usdot }))).toBe(carrierLogoPaths(withArt.logo!).square);
  });

  it('falls back to a monogram for a carrier with no logo', () => {
    // The ~331,000-carrier default. `null` here is what makes the tile render
    // initials instead of an <img>.
    expect(carrierLogoUrl(carrier({ usdot: '999999999' }))).toBeNull();
  });

  it('falls back to a monogram for a CURATED carrier we have no artwork for', () => {
    const noArt = CURATED_CARRIER_LOGOS.find((c) => c.logo === null);
    if (!noArt) return; // legitimately empty once every curated carrier has a mark
    expect(carrierLogoUrl(carrier({ usdot: noArt.usdot }))).toBeNull();
  });

  it("lets a carrier's OWN uploaded logo outrank our curation of it", () => {
    const withArt = CURATED_CARRIER_LOGOS.find((c) => c.logo !== null)!;
    const claimed = carrier({ usdot: withArt.usdot, logoUrl: '/uploads/claimed-logo.webp' });
    expect(carrierLogoUrl(claimed)).toBe('/uploads/claimed-logo.webp');
  });

  it('never lets a hostile override reach an src attribute', () => {
    const withArt = CURATED_CARRIER_LOGOS.find((c) => c.logo !== null)!;
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'http://insecure.example/l.png']) {
      // Rejected as an override — and since it is still the same USDOT, the
      // curated mark is the right answer rather than a blank tile.
      expect(carrierLogoUrl(carrier({ usdot: withArt.usdot, logoUrl: bad }))).toBe(carrierLogoPaths(withArt.logo!).square);
      expect(carrierLogoUrl(carrier({ usdot: '999999999', logoUrl: bad }))).toBeNull();
    }
  });
});
