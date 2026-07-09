import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

/**
 * Regression guard for the public widget's lead submission.
 *
 * The server's LeadSchema (routes/public.ts) extends QuoteSchema, so the
 * quote fields — service / equipment / pickup / delivery — must arrive at
 * the TOP LEVEL of the POST body. A previous version of the widget wrapped
 * them under a `quoteRequest` key, which made every "Get written quote"
 * submission fail server validation with HTTP 400 — silently killing the
 * core lead-capture money path. These checks lock the flat shape in place.
 */
describe('widget lead submission payload', () => {
  it('submits the quote fields flat, not nested under quoteRequest', async () => {
    const js = await readFile(resolve(publicDir, 'widget.js'), 'utf8');
    // The onSubmit handler must spread the gathered request onto the payload
    // (flat) rather than nest it.
    expect(js).toContain('Object.assign({}, req, {');
    // The broken nested shape must never come back.
    expect(js).not.toContain('quoteRequest: req');
    expect(js).not.toMatch(/body:\s*JSON\.stringify\(\s*\{\s*quoteRequest/);
  });
});
