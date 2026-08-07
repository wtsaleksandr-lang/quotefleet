import { describe, it, expect } from 'vitest';
import {
  buildFormFillSystemPrompt,
  parseFormFills,
  stripFormFillBlock,
  type FormFillField,
} from './formFillAgent.js';

const FIELDS: FormFillField[] = [
  { key: 'displayName', label: 'Company name' },
  { key: 'tagline', label: 'Tagline' },
  {
    key: 'kind',
    label: "How it's charged",
    options: [
      { value: 'flat', label: 'Flat fee ($)' },
      { value: 'per_mile', label: 'Per mile' },
    ],
  },
];

function fenced(json: unknown): string {
  return `Here's what I'll set — review and confirm.\n<<<FORM_FILL>>>\n${JSON.stringify(json)}\n<<<END_FORM_FILL>>>`;
}

describe('buildFormFillSystemPrompt', () => {
  it('lists every field key + label and the FORM_FILL contract', () => {
    const sys = buildFormFillSystemPrompt({ formLabel: 'Customize', fields: FIELDS, currentValues: {} });
    expect(sys).toContain('[key: displayName]');
    expect(sys).toContain('[key: tagline]');
    expect(sys).toContain('<<<FORM_FILL>>>');
    expect(sys).toContain('"Customize"');
  });

  it('surfaces enum options for select fields', () => {
    const sys = buildFormFillSystemPrompt({ fields: FIELDS, currentValues: {} });
    expect(sys).toContain('"flat"');
    expect(sys).toContain('"per_mile"');
  });

  it('renders a "currently filled in" snapshot, skipping empty values', () => {
    const sys = buildFormFillSystemPrompt({
      fields: FIELDS,
      currentValues: { displayName: 'Harbor Link', tagline: '' },
    });
    expect(sys).toContain('displayName: Harbor Link');
    expect(sys).not.toContain('tagline: ');
  });
});

describe('parseFormFills', () => {
  const allowed = new Set(FIELDS.map((f) => f.key));

  it('extracts fills from a fenced block', () => {
    const text = fenced({ fills: [{ field_key: 'tagline', value: 'Fast freight, fair rates' }] });
    expect(parseFormFills(text, allowed)).toEqual([{ field_key: 'tagline', value: 'Fast freight, fair rates' }]);
  });

  it('drops fills whose key is not in the allowed set', () => {
    const text = fenced({ fills: [{ field_key: 'evil', value: 'x' }, { field_key: 'tagline', value: 'ok' }] });
    expect(parseFormFills(text, allowed)).toEqual([{ field_key: 'tagline', value: 'ok' }]);
  });

  it('coerces numeric/boolean values to strings and caps length', () => {
    const text = fenced({ fills: [{ field_key: 'tagline', value: 42 }] });
    expect(parseFormFills(text, allowed)).toEqual([{ field_key: 'tagline', value: '42' }]);
  });

  it('rejects object values (never applies a non-scalar)', () => {
    const text = fenced({ fills: [{ field_key: 'tagline', value: { a: 1 } }] });
    expect(parseFormFills(text, allowed)).toEqual([]);
  });

  it('enforces enum options when provided', () => {
    const opts = new Map([['kind', new Set(['flat', 'per_mile'])]]);
    const bad = fenced({ fills: [{ field_key: 'kind', value: 'gibberish' }] });
    expect(parseFormFills(bad, allowed, opts)).toEqual([]);
    const good = fenced({ fills: [{ field_key: 'kind', value: 'flat' }] });
    expect(parseFormFills(good, allowed, opts)).toEqual([{ field_key: 'kind', value: 'flat' }]);
  });

  it('de-duplicates repeated keys (first wins)', () => {
    const text = fenced({ fills: [{ field_key: 'tagline', value: 'a' }, { field_key: 'tagline', value: 'b' }] });
    expect(parseFormFills(text, allowed)).toEqual([{ field_key: 'tagline', value: 'a' }]);
  });

  it('returns [] when there is no FORM_FILL block or the JSON is malformed', () => {
    expect(parseFormFills('just a chat reply, no block', allowed)).toEqual([]);
    expect(parseFormFills('<<<FORM_FILL>>> not json <<<END_FORM_FILL>>>', allowed)).toEqual([]);
  });
});

describe('stripFormFillBlock', () => {
  it('removes the fenced block, leaving the human-visible reply', () => {
    const text = fenced({ fills: [{ field_key: 'tagline', value: 'ok' }] });
    expect(stripFormFillBlock(text)).toBe("Here's what I'll set — review and confirm.");
  });
});
