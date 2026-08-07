/**
 * Tests the vanilla-JS copilot form registry + registration factory
 * (copilot-form.js). The file is a classic browser script; we read it and
 * eval it so the same code that ships to the portal is what's tested. It
 * attaches its singleton + factory to globalThis (no `window` under Node).
 *
 * No DOM/jsdom needed: the factory only touches each element's value /
 * classList / dispatchEvent, so lightweight fake elements suffice, and Node's
 * global `Event` backs `new Event(...)`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FakeEl {
  value: string;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  events: string[];
  dispatchEvent(e: Event): boolean;
  scrollIntoView(): void;
  revealed?: boolean;
}

function makeEl(initial?: unknown): FakeEl {
  const classes = new Set<string>();
  const events: string[] = [];
  return {
    value: initial == null ? '' : String(initial),
    classList: {
      add: (c: string) => { classes.add(c); },
      remove: (c: string) => { classes.delete(c); },
      contains: (c: string) => classes.has(c),
    },
    events,
    dispatchEvent(e: Event) { events.push(e.type); return true; },
    scrollIntoView() { /* no-op */ },
  };
}

// Populated by eval of copilot-form.js.
let registry: any;
let makeReg: any;

beforeAll(() => {
  const code = readFileSync(join(__dirname, 'copilot-form.js'), 'utf8');
  // Indirect eval → runs in global scope; the script attaches to globalThis.
  (0, eval)(code);
  registry = (globalThis as any).__qfCopilotForm;
  makeReg = (globalThis as any).__qfCopilotFormFactory;
});

beforeEach(() => registry.clear());

describe('registry', () => {
  it('register / getActive returns the most-recently-registered form', () => {
    registry.register('a', { formLabel: 'A', fields: [] });
    registry.register('b', { formLabel: 'B', fields: [] });
    expect(registry.getActive().formLabel).toBe('B');
  });

  it('re-registering the same id replaces (and promotes) it', () => {
    registry.register('a', { formLabel: 'A', fields: [] });
    registry.register('b', { formLabel: 'B', fields: [] });
    registry.register('a', { formLabel: 'A2', fields: [] });
    expect(registry.getActive().formLabel).toBe('A2');
    expect(registry._size()).toBe(2);
  });

  it('unregister removes a form; getActive falls back to the previous one', () => {
    registry.register('a', { formLabel: 'A', fields: [] });
    registry.register('b', { formLabel: 'B', fields: [] });
    registry.unregister('b');
    expect(registry.getActive().formLabel).toBe('A');
  });

  it('clear empties the stack (getActive → null)', () => {
    registry.register('a', { formLabel: 'A', fields: [] });
    registry.clear();
    expect(registry.getActive()).toBeNull();
    expect(registry._size()).toBe(0);
  });
});

describe('makeCopilotFormReg', () => {
  it('exposes plain field descriptors (no element refs) with options', () => {
    const reg = makeReg('Add-on', [
      { key: 'name', label: 'Name', el: makeEl(), required: true },
      { key: 'kind', label: 'Kind', el: makeEl(), options: [{ value: 'flat' }] },
    ]);
    expect(reg.fields).toEqual([
      { key: 'name', label: 'Name', required: true },
      { key: 'kind', label: 'Kind', required: false, options: [{ value: 'flat' }] },
    ]);
  });

  it('getValues lazily reads live input values', () => {
    const name = makeEl('Harbor Link');
    const reg = makeReg('F', [{ key: 'name', label: 'Name', el: name }]);
    expect(reg.getValues()).toEqual({ name: 'Harbor Link' });
    name.value = 'Changed';
    expect(reg.getValues()).toEqual({ name: 'Changed' });
  });

  it('onApply writes the value, fires input+change, highlights, and reveals', () => {
    const el = makeEl('');
    let revealedWith: FakeEl | null = null;
    const reg = makeReg('F', [{ key: 'tagline', label: 'Tagline', el, reveal: (e: FakeEl) => { revealedWith = e; } }]);
    reg.onApply([{ field_key: 'tagline', value: 'Fast freight, fair rates' }]);
    expect(el.value).toBe('Fast freight, fair rates');
    expect(el.events).toEqual(['input', 'change']);
    expect(el.classList.contains('qf-copilot-pending')).toBe(true);
    expect(revealedWith).toBe(el);
  });

  it('onApply with {pending:false} restores values without highlighting (Undo path)', () => {
    const el = makeEl('new');
    const reg = makeReg('F', [{ key: 'tagline', label: 'Tagline', el }]);
    reg.onApply([{ field_key: 'tagline', value: 'prior' }], { pending: false });
    expect(el.value).toBe('prior');
    expect(el.events).toEqual(['input', 'change']);
    expect(el.classList.contains('qf-copilot-pending')).toBe(false);
  });

  it('onApply ignores fills whose key is not registered', () => {
    const el = makeEl('keep');
    const reg = makeReg('F', [{ key: 'tagline', label: 'Tagline', el }]);
    reg.onApply([{ field_key: 'unknown', value: 'x' }]);
    expect(el.value).toBe('keep');
    expect(el.events).toEqual([]);
  });

  it('clearPending removes the highlight from every field', () => {
    const el = makeEl('');
    const reg = makeReg('F', [{ key: 'tagline', label: 'Tagline', el }]);
    reg.onApply([{ field_key: 'tagline', value: 'v' }]);
    expect(el.classList.contains('qf-copilot-pending')).toBe(true);
    reg.clearPending();
    expect(el.classList.contains('qf-copilot-pending')).toBe(false);
  });

  it('default onConfirm dispatches blur on the applied keys (persist)', () => {
    const el = makeEl('v');
    const reg = makeReg('F', [{ key: 'tagline', label: 'Tagline', el }]);
    reg.onConfirm(['tagline']);
    expect(el.events).toEqual(['blur']);
  });
});
