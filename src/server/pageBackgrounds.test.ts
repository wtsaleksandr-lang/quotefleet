/**
 * resolvePageBackground / sanitizePageBackgroundPatch — the hosted-page
 * background selection stored in featuresJson.pageBackground.
 *
 * Locks the default ('solid' = no decoration, unchanged look), the null/
 * malformed handling, and the sanitizer's merge-safe behaviour so a corrupt
 * column can never render an undefined class or drop a sibling featuresJson key.
 */
import { describe, it, expect } from 'vitest';
import {
  PAGE_BACKGROUNDS,
  DEFAULT_PAGE_BACKGROUND,
  isPageBackgroundId,
  resolvePageBackground,
  sanitizePageBackgroundPatch,
} from './pageBackgrounds.js';

describe('PAGE_BACKGROUNDS — the option set', () => {
  it('ships at least 8 backgrounds plus the solid default (>= 9)', () => {
    expect(PAGE_BACKGROUNDS.length).toBeGreaterThanOrEqual(9);
  });

  it("the default is 'solid' and it is the FIRST entry", () => {
    expect(DEFAULT_PAGE_BACKGROUND).toBe('solid');
    expect(PAGE_BACKGROUNDS[0].id).toBe('solid');
  });

  it('includes the owner-requested grids (dots, dashed, stripes, blueprint)', () => {
    const ids = PAGE_BACKGROUNDS.map((b) => b.id);
    for (const id of ['dots', 'dashed', 'stripes', 'blueprint']) {
      expect(ids).toContain(id);
    }
  });

  it('includes the premium washes (mesh, aurora, glow, grain)', () => {
    const ids = PAGE_BACKGROUNDS.map((b) => b.id);
    for (const id of ['mesh', 'aurora', 'glow', 'grain']) {
      expect(ids).toContain(id);
    }
  });

  it('every id is unique and every entry has label + description + inspiration', () => {
    const ids = PAGE_BACKGROUNDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of PAGE_BACKGROUNDS) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.description.length).toBeGreaterThan(0);
      expect(b.inspiration.length).toBeGreaterThan(0);
    }
  });
});

describe('isPageBackgroundId', () => {
  it('accepts known ids', () => {
    expect(isPageBackgroundId('solid')).toBe(true);
    expect(isPageBackgroundId('aurora')).toBe(true);
  });
  it('rejects unknown / non-string values', () => {
    expect(isPageBackgroundId('nope')).toBe(false);
    expect(isPageBackgroundId(42)).toBe(false);
    expect(isPageBackgroundId(null)).toBe(false);
    expect(isPageBackgroundId(undefined)).toBe(false);
  });
});

describe('resolvePageBackground — defaults + malformed input', () => {
  it('null brand → solid', () => {
    expect(resolvePageBackground(null)).toBe('solid');
  });
  it('null featuresJson column → solid', () => {
    expect(resolvePageBackground({ featuresJson: null })).toBe('solid');
  });
  it('empty featuresJson → solid', () => {
    expect(resolvePageBackground({ featuresJson: {} })).toBe('solid');
  });
  it('a valid id is returned as-is', () => {
    expect(resolvePageBackground({ featuresJson: { pageBackground: 'dots' } })).toBe('dots');
    expect(resolvePageBackground({ featuresJson: { pageBackground: 'blueprint' } })).toBe('blueprint');
  });
  it('an unknown id falls back to solid (never an undefined class)', () => {
    expect(resolvePageBackground({ featuresJson: { pageBackground: 'lasers' } })).toBe('solid');
  });
  it('a non-string value falls back to solid', () => {
    expect(
      resolvePageBackground({ featuresJson: { pageBackground: 7 as unknown as string } }),
    ).toBe('solid');
  });
  it('leaves sibling featuresJson keys untouched (only reads its own key)', () => {
    expect(
      resolvePageBackground({ featuresJson: { quoteShare: false, pageBackground: 'mesh' } }),
    ).toBe('mesh');
  });
});

describe('sanitizePageBackgroundPatch — only a known id is persisted', () => {
  it('non-object input → undefined (nothing to write)', () => {
    expect(sanitizePageBackgroundPatch(null)).toBeUndefined();
    expect(sanitizePageBackgroundPatch('dots')).toBeUndefined();
  });
  it('object WITHOUT the key → undefined (do not touch the column)', () => {
    expect(sanitizePageBackgroundPatch({ quoteShare: true })).toBeUndefined();
  });
  it('a valid id passes through', () => {
    expect(sanitizePageBackgroundPatch({ pageBackground: 'aurora' })).toBe('aurora');
  });
  it('an unknown id is coerced to solid (never persisted as junk)', () => {
    expect(sanitizePageBackgroundPatch({ pageBackground: 'rgb-gamer' })).toBe('solid');
  });
  it('a non-string value is coerced to solid', () => {
    expect(sanitizePageBackgroundPatch({ pageBackground: { x: 1 } })).toBe('solid');
  });
});
