import { describe, it, expect } from 'vitest';
import {
  WCAG,
  contrastRatio,
  relativeLuminance,
  pickForeground,
  ensureReadable,
  passes,
  hexToRgb,
  rgbToHex,
} from './contrast.js';

describe('WCAG contrast maths', () => {
  it('black vs white is the maximal 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5); // order-independent
  });

  it('identical colours are 1:1', () => {
    expect(contrastRatio('#3366cc', '#3366cc')).toBeCloseTo(1, 5);
  });

  it('luminance is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('parses 3-digit shorthand + tolerates missing #', () => {
    expect(hexToRgb('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(hexToRgb('ff0044')).toEqual({ r: 255, g: 0, b: 68 });
    expect(hexToRgb('nope')).toBeNull();
    expect(rgbToHex(255, 0, 68)).toBe('#ff0044');
  });
});

describe('pickForeground', () => {
  // Alex's example correct pairs — the picked foreground must clear AA normal.
  const pairs: Array<[string, string]> = [
    ['#000000', '#FFFFFF'], // black bg → white text… but engine may pick black-on-white
    ['#FFFFFF', '#000000'],
    ['#D14343', '#FFFFFF'], // red → white
    ['#F5D400', '#141414'], // yellow → dark
    ['#0B1220', '#E6E3E0'], // deep navy → light gray-ish
    ['#F3EEE4', '#241F16'], // cream/off-white → dark charcoal
  ];

  it("returns a foreground that meets AA (4.5:1) for Alex's example backgrounds", () => {
    for (const [bg] of pairs) {
      const fg = pickForeground(bg, { level: WCAG.NORMAL });
      const r = contrastRatio(fg, bg);
      expect(r, `${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(WCAG.NORMAL);
    }
  });

  it('picks a passing foreground for a large spread of random-ish backgrounds', () => {
    const bgs = [
      '#0D3CFC', '#2563EB', '#059669', '#7C3AED', '#F59E0B', '#EAB308',
      '#111827', '#161616', '#0B1220', '#F3EEE4', '#FBF8F1', '#E6E3E0',
      '#808080', '#777777', '#888888', '#6E8BFF', '#9EE8FF', '#ff0044',
      '#00A3A3', '#123456', '#abcdef', '#654321', '#3b22f4', '#c8e8ff',
    ];
    for (const bg of bgs) {
      const fg = pickForeground(bg, { level: WCAG.NORMAL });
      const r = contrastRatio(fg, bg);
      expect(r, `${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(WCAG.NORMAL);
    }
  });

  it('honours the LARGE (3:1) threshold when asked', () => {
    const bg = '#2563EB';
    const fg = pickForeground(bg, { level: WCAG.LARGE });
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG.LARGE);
  });

  it('drives a mid-grey background to a passing extreme (neither pure candidate passes)', () => {
    const bg = '#767676'; // classic edge grey
    const fg = pickForeground(bg, { level: WCAG.NORMAL });
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG.NORMAL);
  });
});

describe('ensureReadable', () => {
  it('keeps a preferred colour when it already passes', () => {
    expect(ensureReadable('#FFFFFF', '#0D3CFC', { level: WCAG.NORMAL })).toBe('#FFFFFF');
  });

  it('repairs a failing preferred colour to a passing one', () => {
    // Light grey on cream fails; ensureReadable must return something passing.
    const out = ensureReadable('#DDDDDD', '#F3EEE4', { level: WCAG.NORMAL });
    expect(passes(out, '#F3EEE4', WCAG.NORMAL)).toBe(true);
  });
});
