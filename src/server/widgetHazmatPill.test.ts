import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The morphing hazmat control's state transitions are pure functions over the
// two source-of-truth elements (#qf-hazmat checkbox + #qf-hazmat-class select).
// widget-hazmat-pill.js is a CLASSIC browser <script> (the project is an ESM
// package, so the file can't carry static `export` statements without breaking
// browser loading). Its transitions are guarded by `typeof module` for exactly
// this reason — we evaluate it here in a CommonJS shim (window/document passed
// undefined so the DOM wiring short-circuits) and read module.exports.
const publicDir = resolve(process.cwd(), 'src/server/public');
function loadHazmat() {
  const src = readFileSync(resolve(publicDir, 'widget-hazmat-pill.js'), 'utf8');
  const mod: { exports: any } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', 'window', 'document', src);
  fn(mod, mod.exports, undefined, undefined);
  return mod.exports as {
    selectHazmat: (box: { checked: boolean }) => void;
    deselectHazmat: (box: { checked: boolean }, sel: { value: string }) => void;
    chooseClass: (box: { checked: boolean }, sel: { value: string }, v: string) => void;
    resetHazmat: (box: { checked: boolean }, sel: { value: string }) => void;
    parseClass: (full: string) => { badge: string; desc: string };
    shortClassLabel: (full: string) => string;
  };
}
const hazmat = loadHazmat();

function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('hazmat pill state transitions (payload source of truth)', () => {
  it('selecting → hazmat true; choosing a class sets the class value', () => {
    const box = { checked: false };
    const sel = { value: '' };
    hazmat.selectHazmat(box);
    expect(box.checked).toBe(true);
    hazmat.chooseClass(box, sel, 'Class 3 — Flammable liquids');
    expect(box.checked).toBe(true);
    expect(sel.value).toBe('Class 3 — Flammable liquids');
    // flags.hazmat is exactly box.checked in buildRequest → the payload carries it.
    expect(box.checked).toBe(true);
  });

  it('deselecting clears both hazmat and the class', () => {
    const box = { checked: true };
    const sel = { value: 'Class 3 — Flammable liquids' };
    hazmat.deselectHazmat(box, sel);
    expect(box.checked).toBe(false);
    expect(sel.value).toBe('');
  });

  it('mode-switch reset clears both hazmat and the class', () => {
    const box = { checked: true };
    const sel = { value: 'Class 7 — Radioactive material' };
    hazmat.resetHazmat(box, sel);
    expect(box.checked).toBe(false);
    expect(sel.value).toBe('');
  });

  it('collapses a full class label to its short badge', () => {
    expect(hazmat.shortClassLabel('Class 3 — Flammable liquids')).toBe('Class 3');
    expect(hazmat.parseClass('Class 9 — Miscellaneous dangerous goods')).toEqual({
      badge: 'Class 9',
      desc: 'Miscellaneous dangerous goods',
    });
  });
});

describe('widget markup wires the morph to the unchanged payload', () => {
  it('keeps the hidden checkbox + class select and drops the separate panel', async () => {
    const html = await file('widget.html');
    expect(html).toContain('id="qf-hazmat-control"');
    expect(html).toContain('id="qf-hazmat"'); // checkbox source of truth
    expect(html).toContain('id="qf-hazmat-class"'); // class source of truth
    expect(html).toContain('role="listbox"');
    expect(html).not.toContain('id="qf-hazmat-panel"'); // old separate panel gone
    expect(html).toContain('/widget-hazmat-pill.js');
    expect(html).toContain('/widget-hazmat-pill.css');
  });

  it('buildRequest still reads the hazmat checkbox for flags.hazmat', async () => {
    const js = await file('widget.js');
    expect(js).toContain("hazmat: $('qf-hazmat').checked");
  });

  it('no longer enhances qf-hazmat-class as a custom select', async () => {
    const js = await file('widget-custom-select.js');
    expect(js).not.toContain("'qf-hazmat-class'");
  });
});
