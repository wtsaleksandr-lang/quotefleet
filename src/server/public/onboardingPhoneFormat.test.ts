/**
 * Onboarding "Also added" note — phone is formatted for DISPLAY only.
 *
 * Glass-polish fix (2026-08): the finder-autofill confirmation note used to
 * print the raw FMCSA phone verbatim ("Also added: 4798200000 · …"). It now
 * runs through `formatPhoneDisplay()` for the note text only — the value
 * PERSISTED to the tenant (state.contactPhone → payload.contactPhone) stays the
 * raw string, untouched.
 *
 * `formatPhoneDisplay` lives inside the wizard IIFE (a plain client script, not
 * a module), so we extract its source from the shipped file and eval it. That
 * way this asserts the REAL behavior — a regression in the shipped helper fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(here, 'onboarding-wizard.js'), 'utf8');

/** Pull the `function formatPhoneDisplay(raw) { … }` body out of the source. */
function loadFormatter(): (raw: unknown) => string {
  const start = js.indexOf('function formatPhoneDisplay(');
  expect(start, 'formatPhoneDisplay must exist in the shipped wizard').toBeGreaterThanOrEqual(0);
  // Walk braces from the first "{" after the signature to find the body end.
  const open = js.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  expect(end).toBeGreaterThan(open);
  const src = js.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${src}; return formatPhoneDisplay;`)() as (raw: unknown) => string;
}

const formatPhoneDisplay = loadFormatter();

describe('formatPhoneDisplay — display-only US phone formatting', () => {
  it('formats a bare 10-digit number as (NNN) NNN-NNNN', () => {
    expect(formatPhoneDisplay('4798200000')).toBe('(479) 820-0000');
  });

  it('formats an 11-digit leading-1 number as +1 (NNN) NNN-NNNN', () => {
    expect(formatPhoneDisplay('14798200000')).toBe('+1 (479) 820-0000');
  });

  it('strips punctuation from a 10-digit value before formatting', () => {
    expect(formatPhoneDisplay('479-820-0000')).toBe('(479) 820-0000');
    expect(formatPhoneDisplay('479.820.0000')).toBe('(479) 820-0000');
  });

  it('passes an already-formatted number through unchanged', () => {
    expect(formatPhoneDisplay('(479) 820-0000')).toBe('(479) 820-0000');
  });

  it('passes a short / partial number through trimmed and unchanged', () => {
    expect(formatPhoneDisplay('  555-1234  ')).toBe('555-1234');
    expect(formatPhoneDisplay('12345')).toBe('12345');
  });

  it('passes an international (non-US-length) number through unchanged', () => {
    expect(formatPhoneDisplay('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });

  it('handles null/undefined/empty as an empty string', () => {
    expect(formatPhoneDisplay(null)).toBe('');
    expect(formatPhoneDisplay(undefined)).toBe('');
    expect(formatPhoneDisplay('')).toBe('');
  });
});
