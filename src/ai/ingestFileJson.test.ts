import { describe, expect, it } from 'vitest';
import { parseModelJson } from './ingestFile.js';

describe('parseModelJson — tolerant rate-sheet JSON extraction', () => {
  it('parses a clean JSON object', () => {
    const out = parseModelJson('{"summary":"ok","rateCards":[]}');
    expect(out.summary).toBe('ok');
  });

  it('salvages JSON when the model prepends a prose preamble', () => {
    // Real failure mode observed in the E2E run: Sonnet emitted a sentence of
    // reasoning before the JSON, and a bare JSON.parse threw, failing the job.
    const raw =
      'No point-to-point totals are present, so no distance lookup is needed. ' +
      'I have everything I need. {"summary":"parsed 2 rows","confidence":"high","rateCards":[{"service":"ftl"}]}';
    const out = parseModelJson(raw);
    expect(out.confidence).toBe('high');
    expect(Array.isArray(out.rateCards)).toBe(true);
  });

  it('does not trip over braces inside string values', () => {
    const out = parseModelJson('prefix {"note":"use {curly} braces","x":1} suffix text');
    expect(out.note).toBe('use {curly} braces');
    expect(out.x).toBe(1);
  });

  it('throws a clear error when there is no JSON object at all', () => {
    expect(() => parseModelJson('sorry, I cannot help with that')).toThrow(/non-JSON output/);
  });
});
